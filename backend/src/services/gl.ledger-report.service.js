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

function buildStatusFilter(reportQuery) {
  if (reportQuery.status) {
    return {
      sql: "je.status = ?",
      params: [reportQuery.status],
      reportBasis: reportQuery.status === "POSTED" ? "POSTED" : "STATUS_FILTERED",
    };
  }

  if (reportQuery.includeReversed) {
    return {
      sql: "je.status IN (?, ?)",
      params: ["POSTED", "REVERSED"],
      reportBasis: "STATUS_FILTERED",
    };
  }

  return {
    sql: "je.status = ?",
    params: ["POSTED"],
    reportBasis: "POSTED",
  };
}

function buildInSql(columnSql, values) {
  const normalizedValues = Array.isArray(values) ? values.filter(Boolean) : [];
  if (normalizedValues.length === 0) {
    throw badRequest("a non-empty filter list is required");
  }
  if (normalizedValues.length === 1) {
    return {
      sql: `${columnSql} = ?`,
      params: [normalizedValues[0]],
    };
  }
  return {
    sql: `${columnSql} IN (${normalizedValues.map(() => "?").join(", ")})`,
    params: normalizedValues,
  };
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

async function resolveAccountRangeIds({
  tenantId,
  legalEntityId,
  accountCodeFrom,
  accountCodeTo,
  runQuery = query,
}) {
  const params = [tenantId];
  const conditions = ["c.tenant_id = ?"];
  if (legalEntityId) {
    conditions.push("(c.legal_entity_id IS NULL OR c.legal_entity_id = ?)");
    params.push(legalEntityId);
  }
  conditions.push("a.code >= ?");
  params.push(accountCodeFrom);
  conditions.push("a.code <= ?");
  params.push(accountCodeTo);

  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.code ASC, a.id ASC`,
    params
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const accountIds = rows.map((row) => parsePositiveInt(row.id)).filter(Boolean);
  if (accountIds.length === 0) {
    throw badRequest("accountCodeFrom/accountCodeTo matched no accounts for this ledger scope");
  }

  return {
    accountIds,
    rows,
  };
}

async function resolveLedgerAccountScope({
  tenantId,
  legalEntityId,
  accountId,
  accountCodeFrom,
  accountCodeTo,
  runQuery = query,
}) {
  const parsedAccountId = parsePositiveInt(accountId);
  if (parsedAccountId) {
    const account = await loadAccountDisplayRow(tenantId, parsedAccountId, runQuery);
    if (!account) {
      throw badRequest("accountId not found for tenant");
    }

    const ledgerAccountScope = await resolveLedgerAccountIds(account, runQuery);
    return {
      accountFilter: buildInSql("jl.account_id", ledgerAccountScope.accountIds),
      account: {
        id: parsedAccountId,
        code: String(account.code || ""),
        name: String(account.name || ""),
        allowPosting: Boolean(account.allow_posting),
        includesDescendants: ledgerAccountScope.includesDescendants,
      },
      accountRange: null,
    };
  }

  const rangeIds = await resolveAccountRangeIds({
    tenantId,
    legalEntityId,
    accountCodeFrom,
    accountCodeTo,
    runQuery,
  });
  const firstAccount = rangeIds.rows[0] || null;
  const lastAccount = rangeIds.rows[rangeIds.rows.length - 1] || null;

  return {
    accountFilter: buildInSql("jl.account_id", rangeIds.accountIds),
    account: null,
    accountRange: {
      codeFrom: String(accountCodeFrom || ""),
      codeTo: String(accountCodeTo || ""),
      matchedAccountCount: rangeIds.accountIds.length,
      firstAccountCode: String(firstAccount?.code || ""),
      firstAccountName: String(firstAccount?.name || ""),
      lastAccountCode: String(lastAccount?.code || ""),
      lastAccountName: String(lastAccount?.name || ""),
    },
  };
}

async function loadBookDisplayRow(tenantId, bookId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       legal_entity_id,
       calendar_id,
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

function buildDimensionFilters(reportQuery, accountFilter) {
  const conditions = [accountFilter.sql];
  const params = [...accountFilter.params];

  if (reportQuery.operatingUnitScope === "OPERATING_UNIT") {
    conditions.push("jl.operating_unit_id = ?");
    params.push(reportQuery.operatingUnitId);
  } else if (reportQuery.operatingUnitScope === "CENTRAL") {
    conditions.push("jl.operating_unit_id IS NULL");
  }

  if (reportQuery.subledgerReferenceNo) {
    conditions.push("jl.subledger_reference_no LIKE ?");
    params.push(`%${reportQuery.subledgerReferenceNo}%`);
  }

  if (reportQuery.sourceType) {
    conditions.push("je.source_type = ?");
    params.push(reportQuery.sourceType);
  }

  return { conditions, params };
}

function buildGroupingSql(groupBy) {
  switch (String(groupBy || "NONE").toUpperCase()) {
    case "MONTH":
      return {
        keySql: "DATE_FORMAT(je.entry_date, '%Y-%m')",
        labelSql: "DATE_FORMAT(je.entry_date, '%Y-%m')",
      };
    case "SOURCE_TYPE":
      return {
        keySql: "COALESCE(NULLIF(TRIM(je.source_type), ''), 'UNSPECIFIED')",
        labelSql: "COALESCE(NULLIF(TRIM(je.source_type), ''), 'UNSPECIFIED')",
      };
    case "OPERATING_UNIT":
      return {
        keySql: "COALESCE(CAST(jl.operating_unit_id AS CHAR), 'CENTRAL')",
        labelSql:
          "CASE WHEN jl.operating_unit_id IS NULL THEN 'CENTRAL' ELSE COALESCE(NULLIF(TRIM(CONCAT(ou.code, ' - ', ou.name)), ' - '), NULLIF(TRIM(ou.code), ''), CONCAT('OU#', jl.operating_unit_id)) END",
      };
    case "SUBLEDGER_REF":
      return {
        keySql:
          "COALESCE(NULLIF(TRIM(jl.subledger_reference_no), ''), 'NO_SUBLEDGER_REF')",
        labelSql:
          "COALESCE(NULLIF(TRIM(jl.subledger_reference_no), ''), 'No subledger ref')",
      };
    default:
      return null;
  }
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
 * Build the report-grade local ledger payload used by Defter-i Kebir and Muavin modes.
 */
export async function getGeneralLedgerReport({
  tenantId,
  book,
  reportQuery,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedBookId = parsePositiveInt(book?.id);
  if (!parsedTenantId || !parsedBookId) {
    throw badRequest("tenantId and bookId are required");
  }

  const bookDisplay = await loadBookDisplayRow(parsedTenantId, parsedBookId, runQuery);
  if (!bookDisplay) {
    throw badRequest("bookId not found for tenant");
  }

  const accountScope = await resolveLedgerAccountScope({
    tenantId: parsedTenantId,
    legalEntityId: parsePositiveInt(book?.legal_entity_id) || null,
    accountId: reportQuery.accountId,
    accountCodeFrom: reportQuery.accountCodeFrom,
    accountCodeTo: reportQuery.accountCodeTo,
    runQuery,
  });
  const rangeContext = await resolveLedgerRange(bookDisplay, reportQuery, runQuery);
  const rangeSql = buildRangeSql(rangeContext);
  const openingSql = buildOpeningSql(rangeContext);
  const statusFilter = buildStatusFilter(reportQuery);
  const dimensionFilters = buildDimensionFilters(reportQuery, accountScope.accountFilter);
  const baseConditions = [
    "je.tenant_id = ?",
    "je.book_id = ?",
    statusFilter.sql,
    ...dimensionFilters.conditions,
    rangeSql.sql,
  ];
  const baseParams = [
    parsedTenantId,
    parsedBookId,
    ...statusFilter.params,
    ...dimensionFilters.params,
    ...rangeSql.params,
  ];

  let openingBalance = 0;
  if (openingSql.sql) {
    const openingResult = await runQuery(
      `SELECT COALESCE(SUM(jl.debit_base - jl.credit_base), 0) AS opening_balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       WHERE je.tenant_id = ?
         AND je.book_id = ?
         AND ${statusFilter.sql}
         AND ${dimensionFilters.conditions.join(" AND ")}
         AND ${openingSql.sql}`,
      [
        parsedTenantId,
        parsedBookId,
        ...statusFilter.params,
        ...dimensionFilters.params,
        ...openingSql.params,
      ]
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

  const groupingSql = buildGroupingSql(reportQuery.groupBy);
  const groupSummaryRows = groupingSql
    ? (
        await runQuery(
          `SELECT
             ${groupingSql.keySql} AS group_key,
             ${groupingSql.labelSql} AS group_label,
             COUNT(*) AS line_count,
             COALESCE(SUM(jl.debit_base), 0) AS debit_total,
             COALESCE(SUM(jl.credit_base), 0) AS credit_total,
             COALESCE(SUM(jl.debit_base - jl.credit_base), 0) AS balance_total
           FROM journal_entries je
           JOIN journal_lines jl ON jl.journal_entry_id = je.id
           LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
           WHERE ${baseConditions.join(" AND ")}
           GROUP BY group_key, group_label
           ORDER BY group_label ASC`,
          baseParams
        )
      ).rows || []
    : [];

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
         jl.account_id,
         a.code AS account_code,
         a.name AS account_name,
         jl.operating_unit_id,
         ou.code AS operating_unit_code,
         ou.name AS operating_unit_name,
         je.entry_date,
         je.document_date,
         je.journal_no,
         je.reference_no,
         je.description AS journal_description,
         jl.description AS line_description,
         COALESCE(NULLIF(TRIM(jl.description), ''), NULLIF(TRIM(je.description), ''), CONCAT('Line ', jl.line_no)) AS description,
         je.source_type,
         je.source_type AS source_module,
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
       JOIN accounts a ON a.id = jl.account_id
       LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
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
      reportBasis: statusFilter.reportBasis,
      periodBasis: rangeContext.periodBasis,
      legalEntityId:
        reportQuery.legalEntityId || parsePositiveInt(book?.legal_entity_id) || null,
      bookId: parsedBookId,
      accountId: parsePositiveInt(reportQuery.accountId) || null,
      accountCodeFrom: reportQuery.accountCodeFrom,
      accountCodeTo: reportQuery.accountCodeTo,
      fiscalPeriodId: reportQuery.fiscalPeriodId || null,
      fiscalPeriodIdFrom: rangeContext.fiscalPeriodIdFrom,
      fiscalPeriodIdTo: rangeContext.fiscalPeriodIdTo,
      dateFrom: rangeContext.periodBasis === "DATE_RANGE" ? rangeContext.startDate : "",
      dateTo: rangeContext.periodBasis === "DATE_RANGE" ? rangeContext.endDate : "",
      operatingUnitScope: reportQuery.operatingUnitScope,
      operatingUnitId: reportQuery.operatingUnitId || null,
      subledgerReferenceNo: reportQuery.subledgerReferenceNo || "",
      sourceType: reportQuery.sourceType || "",
      sourceModule: reportQuery.sourceModule || reportQuery.sourceType || "",
      status: reportQuery.status || "",
      includeReversed: Boolean(reportQuery.includeReversed),
      groupBy: reportQuery.groupBy || "NONE",
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
    account: accountScope.account,
    accountRange: accountScope.accountRange,
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
    grouping: {
      groupBy: reportQuery.groupBy || "NONE",
      rows: groupSummaryRows.map((row) => ({
        groupKey: String(row.group_key || ""),
        groupLabel: String(row.group_label || ""),
        lineCount: Number(row.line_count || 0),
        debitTotal: toAmount(row.debit_total),
        creditTotal: toAmount(row.credit_total),
        balanceTotal: toAmount(row.balance_total),
      })),
    },
    rows,
    total,
    limit: reportQuery.limit,
    offset: reportQuery.offset,
  };
}
