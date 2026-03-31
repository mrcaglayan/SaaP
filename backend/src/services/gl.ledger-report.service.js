import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { listJournalSourceLinksByJournalIds } from "./journal.source-link.service.js";
import { enrichSourceLinksWithDestinationsAsync } from "./gl.reverse-block-destination.service.js";

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPeriodLabel(periodRow) {
  if (!periodRow) {
    return "";
  }
  return `FY${periodRow.fiscal_year} P${String(periodRow.period_no).padStart(2, "0")} - ${periodRow.period_name}`;
}

function buildSortOrderSql(sortBy, sortDirection) {
  const safeDirection = String(sortDirection || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
  const columnMap = {
    ENTRY_DATE: "ledger_rows.entry_date",
    JOURNAL_NO: "ledger_rows.journal_no",
    REFERENCE_NO: "ledger_rows.reference_no",
    DOCUMENT_DATE: "ledger_rows.document_date",
  };
  const sortColumn = columnMap[String(sortBy || "ENTRY_DATE").toUpperCase()] || columnMap.ENTRY_DATE;
  return `${sortColumn} ${safeDirection}, ledger_rows.natural_row_no ${safeDirection}`;
}

async function loadAccountDisplayRow(tenantId, accountId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       a.id,
       a.coa_id,
       a.code,
       a.name,
       a.allow_posting,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );
  return result.rows[0] || null;
}

async function resolveLedgerAccountIds(account, runQuery = query) {
  const parsedCoaId = parsePositiveInt(account?.coa_id);
  const parsedAccountId = parsePositiveInt(account?.id);
  if (!parsedCoaId || !parsedAccountId) {
    throw badRequest("account context is incomplete for ledger detail");
  }

  const hasActiveChildren = Boolean(account?.has_active_children);
  if (!hasActiveChildren) {
    return {
      accountIds: [parsedAccountId],
      includesDescendants: false,
    };
  }

  const result = await runQuery(
    `SELECT id, parent_account_id
     FROM accounts
     WHERE coa_id = ?
       AND is_active = TRUE`,
    [parsedCoaId]
  );

  const childrenByParentId = new Map();
  for (const row of result.rows || []) {
    const rowId = parsePositiveInt(row?.id);
    const parentAccountId = parsePositiveInt(row?.parent_account_id);
    if (!rowId) {
      continue;
    }
    if (!childrenByParentId.has(parentAccountId || 0)) {
      childrenByParentId.set(parentAccountId || 0, []);
    }
    childrenByParentId.get(parentAccountId || 0).push(rowId);
  }

  const visited = new Set();
  const queue = [parsedAccountId];
  while (queue.length > 0) {
    const currentAccountId = queue.shift();
    if (!currentAccountId || visited.has(currentAccountId)) {
      continue;
    }
    visited.add(currentAccountId);
    const childIds = childrenByParentId.get(currentAccountId) || [];
    for (const childId of childIds) {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return {
    accountIds: Array.from(visited),
    includesDescendants: true,
  };
}

async function loadBookDisplayRow(tenantId, bookId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       legal_entity_id,
       code,
       name,
       base_currency_code
     FROM books
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [bookId, tenantId]
  );
  return result.rows[0] || null;
}

async function resolveFiscalPeriodRange(calendarId, fiscalPeriodIdFrom, fiscalPeriodIdTo, runQuery) {
  const periodResult = await runQuery(
    `SELECT
       id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date,
       is_adjustment
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year ASC, period_no ASC, is_adjustment ASC, id ASC`,
    [calendarId]
  );
  const orderedPeriods = Array.isArray(periodResult.rows) ? periodResult.rows : [];
  const fromIndex = orderedPeriods.findIndex(
    (row) => Number(row.id) === Number(fiscalPeriodIdFrom)
  );
  const toIndex = orderedPeriods.findIndex(
    (row) => Number(row.id) === Number(fiscalPeriodIdTo)
  );

  if (fromIndex < 0 || toIndex < 0) {
    throw badRequest("fiscal period range could not be resolved for the selected book");
  }
  if (fromIndex > toIndex) {
    throw badRequest("fiscalPeriodIdFrom cannot be after fiscalPeriodIdTo");
  }

  const selectedPeriods = orderedPeriods.slice(fromIndex, toIndex + 1);
  const openingPeriods = orderedPeriods.slice(0, fromIndex);
  return {
    periodBasis: "FISCAL_PERIOD",
    selectedPeriods,
    selectedPeriodIds: selectedPeriods.map((row) => parsePositiveInt(row.id)).filter(Boolean),
    openingPeriodIds: openingPeriods.map((row) => parsePositiveInt(row.id)).filter(Boolean),
    startDate: String(selectedPeriods[0]?.start_date || "").slice(0, 10),
    endDate: String(selectedPeriods[selectedPeriods.length - 1]?.end_date || "").slice(0, 10),
    fiscalPeriodIdFrom,
    fiscalPeriodIdTo,
    fromPeriod: selectedPeriods[0] || null,
    toPeriod: selectedPeriods[selectedPeriods.length - 1] || null,
  };
}

async function resolveLedgerRange(book, reportQuery, runQuery = query) {
  if (reportQuery.periodBasis === "DATE_RANGE") {
    return {
      periodBasis: "DATE_RANGE",
      selectedPeriods: [],
      selectedPeriodIds: [],
      openingPeriodIds: [],
      startDate: reportQuery.dateFrom,
      endDate: reportQuery.dateTo,
      fiscalPeriodIdFrom: null,
      fiscalPeriodIdTo: null,
      fromPeriod: null,
      toPeriod: null,
    };
  }

  return resolveFiscalPeriodRange(
    parsePositiveInt(book.calendar_id),
    reportQuery.fiscalPeriodIdFrom,
    reportQuery.fiscalPeriodIdTo,
    runQuery
  );
}

function buildRangeSql(rangeContext, prefix = "je") {
  if (rangeContext.periodBasis === "DATE_RANGE") {
    return {
      sql: `${prefix}.entry_date >= ? AND ${prefix}.entry_date <= ?`,
      params: [rangeContext.startDate, rangeContext.endDate],
    };
  }

  const selectedIds = rangeContext.selectedPeriodIds || [];
  if (selectedIds.length === 0) {
    throw badRequest("selected fiscal period range is empty");
  }
  return {
    sql: `${prefix}.fiscal_period_id IN (${selectedIds.map(() => "?").join(", ")})`,
    params: selectedIds,
  };
}

function buildOpeningSql(rangeContext, prefix = "je") {
  if (rangeContext.periodBasis === "DATE_RANGE") {
    return {
      sql: `${prefix}.entry_date < ?`,
      params: [rangeContext.startDate],
    };
  }

  const openingIds = rangeContext.openingPeriodIds || [];
  if (openingIds.length === 0) {
    return { sql: "", params: [] };
  }
  return {
    sql: `${prefix}.fiscal_period_id IN (${openingIds.map(() => "?").join(", ")})`,
    params: openingIds,
  };
}

async function attachLedgerSourceLinks(tenantId, rows, runQuery = query) {
  const journalIds = Array.from(
    new Set(rows.map((row) => parsePositiveInt(row.journal_id)).filter(Boolean))
  );
  if (journalIds.length === 0) {
    return rows;
  }

  const sourceLinksByJournalId = await listJournalSourceLinksByJournalIds({
    tenantId,
    journalEntryIds: journalIds,
    runQuery,
  });

  const flatSourceLinks = [];
  for (const journalId of journalIds) {
    const journalLinks = sourceLinksByJournalId.get(journalId) || [];
    for (const linkRow of journalLinks) {
      flatSourceLinks.push(linkRow);
    }
  }
  const enrichedSourceLinks = await enrichSourceLinksWithDestinationsAsync(flatSourceLinks);
  const enrichedByJournalId = new Map();
  for (const linkRow of enrichedSourceLinks) {
    const journalId = parsePositiveInt(linkRow?.journal_entry_id);
    if (!journalId) {
      continue;
    }
    if (!enrichedByJournalId.has(journalId)) {
      enrichedByJournalId.set(journalId, []);
    }
    enrichedByJournalId.get(journalId).push(linkRow);
  }

  return rows.map((row) => ({
    ...row,
    source_links: enrichedByJournalId.get(parsePositiveInt(row.journal_id)) || [],
  }));
}

/**
 * Build the report-grade local ledger payload used by Defter-i Kebir and later Muavin modes.
 */
export async function getGeneralLedgerReport({
  tenantId,
  book,
  accountId,
  reportQuery,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedBookId = parsePositiveInt(book?.id);
  const parsedAccountId = parsePositiveInt(accountId);
  if (!parsedTenantId || !parsedBookId || !parsedAccountId) {
    throw badRequest("tenantId, bookId, and accountId are required");
  }

  const account = await loadAccountDisplayRow(parsedTenantId, parsedAccountId, runQuery);
  if (!account) {
    throw badRequest("accountId not found for tenant");
  }
  const bookDisplay = await loadBookDisplayRow(parsedTenantId, parsedBookId, runQuery);
  if (!bookDisplay) {
    throw badRequest("bookId not found for tenant");
  }
  const ledgerAccountScope = await resolveLedgerAccountIds(account, runQuery);
  const accountFilterSql =
    ledgerAccountScope.accountIds.length === 1
      ? "jl.account_id = ?"
      : `jl.account_id IN (${ledgerAccountScope.accountIds.map(() => "?").join(", ")})`;
  const accountFilterParams = ledgerAccountScope.accountIds;

  const rangeContext = await resolveLedgerRange(book, reportQuery, runQuery);
  const rangeSql = buildRangeSql(rangeContext);
  const openingSql = buildOpeningSql(rangeContext);
  const baseConditions = [
    "je.tenant_id = ?",
    "je.book_id = ?",
    "je.status = 'POSTED'",
    accountFilterSql,
    rangeSql.sql,
  ];
  const baseParams = [parsedTenantId, parsedBookId, ...accountFilterParams, ...rangeSql.params];

  let openingBalance = 0;
  if (openingSql.sql) {
    const openingResult = await runQuery(
      `SELECT COALESCE(SUM(jl.debit_base - jl.credit_base), 0) AS opening_balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       WHERE je.tenant_id = ?
         AND je.book_id = ?
         AND je.status = 'POSTED'
         AND ${accountFilterSql}
         AND ${openingSql.sql}`,
      [parsedTenantId, parsedBookId, ...accountFilterParams, ...openingSql.params]
    );
    openingBalance = toAmount(openingResult.rows[0]?.opening_balance);
  }

  const totalResult = await runQuery(
    `SELECT COUNT(*) AS total
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     WHERE ${baseConditions.join(" AND ")}`,
    baseParams
  );
  const total = Number(totalResult.rows[0]?.total || 0);

  const summaryResult = await runQuery(
    `SELECT
       COALESCE(SUM(jl.debit_base), 0) AS debit_total,
       COALESCE(SUM(jl.credit_base), 0) AS credit_total
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     WHERE ${baseConditions.join(" AND ")}`,
    baseParams
  );
  const debitTotal = toAmount(summaryResult.rows[0]?.debit_total);
  const creditTotal = toAmount(summaryResult.rows[0]?.credit_total);
  const closingBalance = openingBalance + debitTotal - creditTotal;

  const sortOrderSql = buildSortOrderSql(reportQuery.sortBy, reportQuery.sortDirection);
  const rowsResult = await runQuery(
    `SELECT *
     FROM (
       SELECT
         ROW_NUMBER() OVER (
           ORDER BY je.entry_date ASC, je.id ASC, jl.line_no ASC, jl.id ASC
         ) AS natural_row_no,
         je.id AS journal_id,
         jl.id AS journal_line_id,
         je.entry_date,
         je.document_date,
         je.journal_no,
         je.reference_no,
         je.description AS journal_description,
         jl.description AS line_description,
         COALESCE(NULLIF(TRIM(jl.description), ''), NULLIF(TRIM(je.description), ''), CONCAT('Line ', jl.line_no)) AS description,
         je.source_type,
         je.status,
         jl.line_no,
         jl.subledger_reference_no,
         jl.debit_base,
         jl.credit_base,
         SUM(jl.debit_base - jl.credit_base) OVER (
           ORDER BY je.entry_date ASC, je.id ASC, jl.line_no ASC, jl.id ASC
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) + ? AS running_balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       WHERE ${baseConditions.join(" AND ")}
     ) ledger_rows
     ORDER BY ${sortOrderSql}
     LIMIT ${reportQuery.limit}
     OFFSET ${reportQuery.offset}`,
    [openingBalance, ...baseParams]
  );

  const rows = await attachLedgerSourceLinks(
    parsedTenantId,
    Array.isArray(rowsResult.rows) ? rowsResult.rows : [],
    runQuery
  );

  return {
    filters: {
      scope: "LOCAL",
      reportType: "GENERAL_LEDGER",
      reportBasis: "POSTED",
      periodBasis: rangeContext.periodBasis,
      legalEntityId:
        reportQuery.legalEntityId || parsePositiveInt(book?.legal_entity_id) || null,
      bookId: parsedBookId,
      accountId: parsedAccountId,
      fiscalPeriodId: reportQuery.fiscalPeriodId || null,
      fiscalPeriodIdFrom: rangeContext.fiscalPeriodIdFrom,
      fiscalPeriodIdTo: rangeContext.fiscalPeriodIdTo,
      dateFrom: rangeContext.periodBasis === "DATE_RANGE" ? rangeContext.startDate : "",
      dateTo: rangeContext.periodBasis === "DATE_RANGE" ? rangeContext.endDate : "",
      sortBy: reportQuery.sortBy,
      sortDirection: reportQuery.sortDirection,
    },
    book: {
      id: parsedBookId,
      code: String(bookDisplay.code || ""),
      name: String(bookDisplay.name || ""),
      legalEntityId: parsePositiveInt(bookDisplay.legal_entity_id) || null,
      baseCurrencyCode: String(bookDisplay.base_currency_code || "").toUpperCase(),
    },
    account: {
      id: parsedAccountId,
      code: account.code,
      name: account.name,
      allowPosting: Boolean(account.allow_posting),
      includesDescendants: ledgerAccountScope.includesDescendants,
    },
    range: {
      periodBasis: rangeContext.periodBasis,
      startDate: rangeContext.startDate,
      endDate: rangeContext.endDate,
      fiscalPeriodIdFrom: rangeContext.fiscalPeriodIdFrom,
      fiscalPeriodIdTo: rangeContext.fiscalPeriodIdTo,
      fromPeriodLabel: formatPeriodLabel(rangeContext.fromPeriod),
      toPeriodLabel: formatPeriodLabel(rangeContext.toPeriod),
    },
    summary: {
      openingBalance,
      debitTotal,
      creditTotal,
      closingBalance,
      totalRows: total,
    },
    rows,
    total,
    limit: reportQuery.limit,
    offset: reportQuery.offset,
  };
}
