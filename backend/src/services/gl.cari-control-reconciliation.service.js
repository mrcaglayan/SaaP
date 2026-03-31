import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { listCariOpenItemAsOfRows } from "./cari.report.service.js";
import { listPurposeMappings } from "./gl.purpose-mappings.service.js";

const AMOUNT_SCALE = 6;
const AMOUNT_EPSILON = 0.000001;
const ROW_TYPE_VALUES = Object.freeze(["COUNTERPARTY_SCOPE", "UNLINKED_GL"]);
const CARI_DOCUMENT_SOURCE_TYPE = "CARI_DOCUMENT";
const CARI_SETTLEMENT_SOURCE_TYPE = "CARI_SETTLEMENT_BATCH";
const AR_CONTROL_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_CONTROL_CASH",
  "CARI_AR_CONTROL_MANUAL",
  "CARI_AR_CONTROL_ON_ACCOUNT",
]);
const AP_CONTROL_PURPOSE_CODES = Object.freeze([
  "CARI_AP_CONTROL",
  "CARI_AP_CONTROL_CASH",
  "CARI_AP_CONTROL_MANUAL",
  "CARI_AP_CONTROL_ON_ACCOUNT",
]);

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value) {
  return Number(toAmount(value).toFixed(AMOUNT_SCALE));
}

function isNearlyZero(value) {
  return Math.abs(toAmount(value)) <= AMOUNT_EPSILON;
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function formatPeriodLabel(periodRow) {
  if (!periodRow) {
    return "";
  }
  return `FY${periodRow.fiscal_year} P${String(periodRow.period_no).padStart(2, "0")} - ${periodRow.period_name}`;
}

function formatOperatingUnitToken(operatingUnitId) {
  return operatingUnitId ? `OU:${operatingUnitId}` : "CENTRAL";
}

function buildRowKey({
  rowType,
  direction,
  operatingUnitId = null,
  counterpartyId = null,
}) {
  return [
    normalizeUpperText(rowType),
    normalizeUpperText(direction),
    formatOperatingUnitToken(parsePositiveInt(operatingUnitId)),
    `CP:${parsePositiveInt(counterpartyId) || 0}`,
  ].join("|");
}

function parseRowKey(rowKey) {
  const parts = String(rowKey || "").split("|");
  if (parts.length !== 4) {
    throw badRequest("rowKey is invalid");
  }

  const rowType = normalizeUpperText(parts[0]);
  const direction = normalizeUpperText(parts[1]);
  const operatingUnitToken = String(parts[2] || "").trim().toUpperCase();
  const counterpartyToken = String(parts[3] || "").trim().toUpperCase();

  if (!ROW_TYPE_VALUES.includes(rowType)) {
    throw badRequest("rowKey row type is invalid");
  }
  if (!["AR", "AP"].includes(direction)) {
    throw badRequest("rowKey direction is invalid");
  }
  if (!counterpartyToken.startsWith("CP:")) {
    throw badRequest("rowKey counterparty token is invalid");
  }

  let operatingUnitId = null;
  if (operatingUnitToken !== "CENTRAL") {
    if (!operatingUnitToken.startsWith("OU:")) {
      throw badRequest("rowKey operating unit token is invalid");
    }
    operatingUnitId = parsePositiveInt(operatingUnitToken.slice(3));
    if (!operatingUnitId) {
      throw badRequest("rowKey operating unit token is invalid");
    }
  }

  const counterpartyId = parsePositiveInt(counterpartyToken.slice(3)) || null;
  if (rowType === "COUNTERPARTY_SCOPE" && !counterpartyId) {
    throw badRequest("rowKey counterparty id is required for linked rows");
  }

  return {
    rowType,
    direction,
    operatingUnitId,
    counterpartyId,
    canonicalRowKey: buildRowKey({
      rowType,
      direction,
      operatingUnitId,
      counterpartyId,
    }),
  };
}

function formatOperatingUnitLabel({
  operatingUnitId,
  operatingUnitCode,
  operatingUnitName,
}) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  const code = String(operatingUnitCode || "").trim();
  const name = String(operatingUnitName || "").trim();
  if (!normalizedOperatingUnitId) {
    return "CENTRAL";
  }
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || `OU ${normalizedOperatingUnitId}`;
}

function formatCounterpartyLabel({
  counterpartyId,
  counterpartyCode,
  counterpartyName,
}) {
  const normalizedCounterpartyId = parsePositiveInt(counterpartyId);
  const code = String(counterpartyCode || "").trim();
  const name = String(counterpartyName || "").trim();
  if (!normalizedCounterpartyId) {
    return "Unlinked / Unknown";
  }
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || `Counterparty ${normalizedCounterpartyId}`;
}

function normalizeDirectionBalance(direction, rawBalance) {
  const amount = roundAmount(rawBalance);
  return direction === "AP" ? roundAmount(amount * -1) : amount;
}

function createAccumulator(seed = {}) {
  return {
    rowType: seed.rowType || "COUNTERPARTY_SCOPE",
    direction: seed.direction || "",
    operatingUnitId: parsePositiveInt(seed.operatingUnitId),
    operatingUnitCode: seed.operatingUnitCode || null,
    operatingUnitName: seed.operatingUnitName || null,
    counterpartyId: parsePositiveInt(seed.counterpartyId),
    counterpartyCode: seed.counterpartyCode || null,
    counterpartyName: seed.counterpartyName || null,
    glAmountBase: 0,
    sourceAmountBase: 0,
    glJournalLineCount: 0,
    openItemCount: 0,
    missingSourceLinkCount: 0,
    missingSubledgerRefCount: 0,
    accountCodes: new Set(),
    accountNames: new Set(),
    journalIds: new Set(),
    documentIds: new Set(),
  };
}

function mergeAccumulatorMeta(target, source) {
  if (!target.operatingUnitCode && source.operatingUnitCode) {
    target.operatingUnitCode = source.operatingUnitCode;
  }
  if (!target.operatingUnitName && source.operatingUnitName) {
    target.operatingUnitName = source.operatingUnitName;
  }
  if (!target.counterpartyCode && source.counterpartyCode) {
    target.counterpartyCode = source.counterpartyCode;
  }
  if (!target.counterpartyName && source.counterpartyName) {
    target.counterpartyName = source.counterpartyName;
  }
}

function buildIssueCodes(accumulator, differenceBase) {
  const issueCodes = [];
  if (accumulator.missingSourceLinkCount > 0) {
    issueCodes.push("MISSING_CARI_LINK");
  }
  if (accumulator.missingSubledgerRefCount > 0) {
    issueCodes.push("MISSING_SUBLEDGER_REF");
  }
  if (!isNearlyZero(differenceBase)) {
    issueCodes.push("BALANCE_DIFFERENCE");
  }
  return issueCodes;
}

function compareRows(left, right) {
  const leftExceptionRank = left.issueCodes.length > 0 ? 0 : 1;
  const rightExceptionRank = right.issueCodes.length > 0 ? 0 : 1;
  if (leftExceptionRank !== rightExceptionRank) {
    return leftExceptionRank - rightExceptionRank;
  }

  const leftAbsDifference = Math.abs(toAmount(left.differenceBase));
  const rightAbsDifference = Math.abs(toAmount(right.differenceBase));
  if (leftAbsDifference !== rightAbsDifference) {
    return rightAbsDifference - leftAbsDifference;
  }

  if (left.missingSourceLinkCount !== right.missingSourceLinkCount) {
    return right.missingSourceLinkCount - left.missingSourceLinkCount;
  }
  if (left.missingSubledgerRefCount !== right.missingSubledgerRefCount) {
    return right.missingSubledgerRefCount - left.missingSubledgerRefCount;
  }
  if (left.direction !== right.direction) {
    return String(left.direction).localeCompare(String(right.direction));
  }
  if (left.operatingUnitLabel !== right.operatingUnitLabel) {
    return String(left.operatingUnitLabel).localeCompare(String(right.operatingUnitLabel));
  }
  return String(left.counterpartyLabel).localeCompare(String(right.counterpartyLabel));
}

function paginateRows(rows, limit, offset) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  return {
    total: rows.length,
    limit: safeLimit,
    offset: safeOffset,
    rows: rows.slice(safeOffset, safeOffset + safeLimit),
  };
}

function matchesDirectionFilter(direction, reportQuery) {
  return reportQuery.direction === "ALL" || reportQuery.direction === direction;
}

function matchesOperatingUnitFilter(operatingUnitId, reportQuery) {
  if (reportQuery.operatingUnitScope === "ALL") {
    return true;
  }
  if (reportQuery.operatingUnitScope === "CENTRAL") {
    return !parsePositiveInt(operatingUnitId);
  }
  return parsePositiveInt(operatingUnitId) === reportQuery.operatingUnitId;
}

function matchesCounterpartyFilter(counterpartyId, reportQuery) {
  if (!reportQuery.counterpartyId) {
    return true;
  }
  return parsePositiveInt(counterpartyId) === reportQuery.counterpartyId;
}

function filterRowContext({ direction, operatingUnitId, counterpartyId }, reportQuery) {
  return (
    matchesDirectionFilter(direction, reportQuery) &&
    matchesOperatingUnitFilter(operatingUnitId, reportQuery) &&
    matchesCounterpartyFilter(counterpartyId, reportQuery)
  );
}

function finalizeRows(accumulatorByKey) {
  const rows = [];
  for (const [rowKey, accumulator] of accumulatorByKey.entries()) {
    const differenceBase = roundAmount(accumulator.glAmountBase - accumulator.sourceAmountBase);
    const issueCodes = buildIssueCodes(accumulator, differenceBase);
    rows.push({
      rowKey,
      rowType: accumulator.rowType,
      direction: accumulator.direction,
      operatingUnitId: accumulator.operatingUnitId,
      operatingUnitCode: accumulator.operatingUnitCode,
      operatingUnitName: accumulator.operatingUnitName,
      operatingUnitLabel: formatOperatingUnitLabel(accumulator),
      counterpartyId: accumulator.counterpartyId,
      counterpartyCode: accumulator.counterpartyCode,
      counterpartyName: accumulator.counterpartyName,
      counterpartyLabel: formatCounterpartyLabel(accumulator),
      glAmountBase: roundAmount(accumulator.glAmountBase),
      sourceAmountBase: roundAmount(accumulator.sourceAmountBase),
      differenceBase,
      glJournalLineCount: accumulator.glJournalLineCount,
      glJournalCount: accumulator.journalIds.size,
      openItemCount: accumulator.openItemCount,
      sourceDocumentCount: accumulator.documentIds.size,
      missingSourceLinkCount: accumulator.missingSourceLinkCount,
      missingSubledgerRefCount: accumulator.missingSubledgerRefCount,
      issueCodes,
      status: issueCodes[0] || "MATCH",
      accountCodes: Array.from(accumulator.accountCodes).sort(),
      accountNames: Array.from(accumulator.accountNames).sort(),
    });
  }

  return rows.sort(compareRows);
}

function buildSummary(rows) {
  let glAmountBaseTotal = 0;
  let sourceAmountBaseTotal = 0;
  let differenceBaseTotal = 0;
  let absoluteDifferenceBaseTotal = 0;
  let missingSourceLinkCount = 0;
  let missingSubledgerRefCount = 0;
  let exceptionRowCount = 0;

  for (const row of rows) {
    glAmountBaseTotal = roundAmount(glAmountBaseTotal + toAmount(row.glAmountBase));
    sourceAmountBaseTotal = roundAmount(
      sourceAmountBaseTotal + toAmount(row.sourceAmountBase)
    );
    differenceBaseTotal = roundAmount(differenceBaseTotal + toAmount(row.differenceBase));
    absoluteDifferenceBaseTotal = roundAmount(
      absoluteDifferenceBaseTotal + Math.abs(toAmount(row.differenceBase))
    );
    missingSourceLinkCount += Number(row.missingSourceLinkCount || 0);
    missingSubledgerRefCount += Number(row.missingSubledgerRefCount || 0);
    if (Array.isArray(row.issueCodes) && row.issueCodes.length > 0) {
      exceptionRowCount += 1;
    }
  }

  return {
    rowCount: rows.length,
    exceptionRowCount,
    matchedRowCount: rows.length - exceptionRowCount,
    glAmountBaseTotal,
    sourceAmountBaseTotal,
    differenceBaseTotal,
    absoluteDifferenceBaseTotal,
    missingSourceLinkCount,
    missingSubledgerRefCount,
  };
}

async function resolveAsOfContext(book, fiscalPeriodId, runQuery = query) {
  const calendarId = parsePositiveInt(book?.calendar_id);
  if (!calendarId) {
    throw badRequest("book calendar context is incomplete for reconciliation");
  }

  const result = await runQuery(
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

  const periodRows = Array.isArray(result.rows) ? result.rows : [];
  const selectedIndex = periodRows.findIndex(
    (row) => Number(row.id) === Number(fiscalPeriodId)
  );
  if (selectedIndex < 0) {
    throw badRequest("fiscal period could not be resolved for the selected book");
  }

  const selectedPeriod = periodRows[selectedIndex];
  const throughPeriods = periodRows.slice(0, selectedIndex + 1);
  return {
    selectedPeriod,
    asOfDate: String(selectedPeriod.end_date || "").slice(0, 10),
    throughPeriodIds: throughPeriods
      .map((row) => parsePositiveInt(row.id))
      .filter(Boolean),
  };
}

async function resolveControlAccountContext({
  tenantId,
  legalEntityId,
  runQuery = query,
  loadPurposeMappings = listPurposeMappings,
}) {
  const mappingRows = await loadPurposeMappings({
    tenantId,
    legalEntityId,
    moduleKey: "CARI",
    runQuery,
  });

  const directionByPurposeCode = new Map(
    [
      ...AR_CONTROL_PURPOSE_CODES.map((purposeCode) => [purposeCode, "AR"]),
      ...AP_CONTROL_PURPOSE_CODES.map((purposeCode) => [purposeCode, "AP"]),
    ]
  );

  const directionByAccountId = new Map();
  const mappedRows = [];
  const missingPurposeCodes = [];

  for (const row of mappingRows) {
    const purposeCode = normalizeUpperText(row?.purposeCode);
    const direction = directionByPurposeCode.get(purposeCode);
    if (!direction) {
      continue;
    }

    const accountId = parsePositiveInt(row?.accountId);
    if (!accountId || row?.validForCariPosting !== true) {
      missingPurposeCodes.push(purposeCode);
      continue;
    }

    directionByAccountId.set(accountId, direction);
    mappedRows.push({
      direction,
      purposeCode,
      accountId,
      accountCode: row?.accountCode || null,
      accountName: row?.accountName || null,
    });
  }

  if (directionByAccountId.size === 0) {
    throw badRequest(
      "No valid CARI control-account mappings are configured for the selected legal entity"
    );
  }

  return {
    directionByAccountId,
    mappedRows,
    missingPurposeCodes: Array.from(new Set(missingPurposeCodes)).sort(),
  };
}

async function loadGlControlJournalLines({
  tenantId,
  bookId,
  throughPeriodIds,
  controlAccountIds,
  runQuery = query,
}) {
  const normalizedAccountIds = Array.from(
    new Set((controlAccountIds || []).map((value) => parsePositiveInt(value)).filter(Boolean))
  );
  if (normalizedAccountIds.length === 0) {
    return [];
  }
  const normalizedPeriodIds = Array.from(
    new Set((throughPeriodIds || []).map((value) => parsePositiveInt(value)).filter(Boolean))
  );
  if (normalizedPeriodIds.length === 0) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       je.id AS journal_id,
       je.journal_no,
       je.reference_no,
       je.entry_date,
       je.document_date,
       je.description AS journal_description,
       jl.id AS journal_line_id,
       jl.line_no,
       jl.description AS line_description,
       jl.account_id,
       a.code AS account_code,
       a.name AS account_name,
       jl.operating_unit_id AS journal_operating_unit_id,
       journal_ou.code AS journal_operating_unit_code,
       journal_ou.name AS journal_operating_unit_name,
       jl.subledger_reference_no,
       jl.debit_base,
       jl.credit_base,
       jsl.source_ref_type,
       jsl.source_ref_id,
       jsl.link_role,
       doc.id AS document_id,
       doc.document_no,
       doc.direction AS document_direction,
       doc.counterparty_id AS document_counterparty_id,
       doc.operating_unit_id AS document_operating_unit_id,
       doc_cp.code AS document_counterparty_code,
       doc_cp.name AS document_counterparty_name,
       doc_ou.code AS document_operating_unit_code,
       doc_ou.name AS document_operating_unit_name,
       settlement.id AS settlement_batch_id,
       settlement.settlement_no,
       settlement.counterparty_id AS settlement_counterparty_id,
       settlement.owner_operating_unit_id AS settlement_owner_operating_unit_id,
       settlement_cp.code AS settlement_counterparty_code,
       settlement_cp.name AS settlement_counterparty_name,
       settlement_ou.code AS settlement_owner_operating_unit_code,
       settlement_ou.name AS settlement_owner_operating_unit_name
     FROM journal_entries je
     JOIN journal_lines jl
       ON jl.journal_entry_id = je.id
     JOIN accounts a
       ON a.id = jl.account_id
     LEFT JOIN operating_units journal_ou
       ON journal_ou.id = jl.operating_unit_id
     LEFT JOIN journal_source_links jsl
       ON jsl.tenant_id = je.tenant_id
      AND jsl.journal_entry_id = je.id
      AND jsl.link_role = 'PRIMARY'
     LEFT JOIN cari_documents doc
       ON doc.tenant_id = je.tenant_id
      AND jsl.source_ref_type = '${CARI_DOCUMENT_SOURCE_TYPE}'
      AND doc.id = jsl.source_ref_id
     LEFT JOIN counterparties doc_cp
       ON doc_cp.tenant_id = doc.tenant_id
      AND doc_cp.legal_entity_id = doc.legal_entity_id
      AND doc_cp.id = doc.counterparty_id
     LEFT JOIN operating_units doc_ou
       ON doc_ou.tenant_id = doc.tenant_id
      AND doc_ou.legal_entity_id = doc.legal_entity_id
      AND doc_ou.id = doc.operating_unit_id
     LEFT JOIN cari_settlement_batches settlement
       ON settlement.tenant_id = je.tenant_id
      AND jsl.source_ref_type = '${CARI_SETTLEMENT_SOURCE_TYPE}'
      AND settlement.id = jsl.source_ref_id
     LEFT JOIN counterparties settlement_cp
       ON settlement_cp.tenant_id = settlement.tenant_id
      AND settlement_cp.legal_entity_id = settlement.legal_entity_id
      AND settlement_cp.id = settlement.counterparty_id
     LEFT JOIN operating_units settlement_ou
       ON settlement_ou.tenant_id = settlement.tenant_id
      AND settlement_ou.legal_entity_id = settlement.legal_entity_id
      AND settlement_ou.id = settlement.owner_operating_unit_id
     WHERE je.tenant_id = ?
       AND je.book_id = ?
       AND je.status = 'POSTED'
       AND je.fiscal_period_id IN (${normalizedPeriodIds.map(() => "?").join(", ")})
       AND jl.account_id IN (${normalizedAccountIds.map(() => "?").join(", ")})
     ORDER BY je.entry_date ASC, je.id ASC, jl.line_no ASC, jl.id ASC`,
    [tenantId, bookId, ...normalizedPeriodIds, ...normalizedAccountIds]
  );

  return Array.isArray(result.rows) ? result.rows : [];
}

function mapOpenItemGroupContext(row) {
  return {
    rowType: "COUNTERPARTY_SCOPE",
    direction: normalizeUpperText(row?.direction),
    operatingUnitId: parsePositiveInt(row?.operatingUnitId),
    operatingUnitCode: row?.operatingUnitCode || null,
    operatingUnitName: row?.operatingUnitName || null,
    counterpartyId: parsePositiveInt(row?.counterpartyId),
    counterpartyCode:
      row?.counterpartyCodeSnapshot || row?.counterpartyCodeCurrent || null,
    counterpartyName:
      row?.counterpartyNameSnapshot || row?.counterpartyNameCurrent || null,
  };
}

function mapGlLineContext(row, directionByAccountId) {
  const accountId = parsePositiveInt(row?.account_id);
  const direction = directionByAccountId.get(accountId) || "";
  const sourceRefType = normalizeUpperText(row?.source_ref_type);
  const sourceRefId = parsePositiveInt(row?.source_ref_id);
  const linkedToCariDocument =
    sourceRefType === CARI_DOCUMENT_SOURCE_TYPE && parsePositiveInt(row?.document_id);
  const linkedToSettlement =
    sourceRefType === CARI_SETTLEMENT_SOURCE_TYPE &&
    parsePositiveInt(row?.settlement_batch_id);

  if (linkedToCariDocument) {
    return {
      rowType: "COUNTERPARTY_SCOPE",
      direction,
      operatingUnitId: parsePositiveInt(row?.document_operating_unit_id),
      operatingUnitCode: row?.document_operating_unit_code || null,
      operatingUnitName: row?.document_operating_unit_name || null,
      counterpartyId: parsePositiveInt(row?.document_counterparty_id),
      counterpartyCode: row?.document_counterparty_code || null,
      counterpartyName: row?.document_counterparty_name || null,
      linkedToCariSource: true,
      sourceRefType,
      sourceRefId,
    };
  }

  if (linkedToSettlement) {
    return {
      rowType: "COUNTERPARTY_SCOPE",
      direction,
      operatingUnitId: parsePositiveInt(row?.settlement_owner_operating_unit_id),
      operatingUnitCode: row?.settlement_owner_operating_unit_code || null,
      operatingUnitName: row?.settlement_owner_operating_unit_name || null,
      counterpartyId: parsePositiveInt(row?.settlement_counterparty_id),
      counterpartyCode: row?.settlement_counterparty_code || null,
      counterpartyName: row?.settlement_counterparty_name || null,
      linkedToCariSource: true,
      sourceRefType,
      sourceRefId,
    };
  }

  return {
    rowType: "UNLINKED_GL",
    direction,
    operatingUnitId: parsePositiveInt(row?.journal_operating_unit_id),
    operatingUnitCode: row?.journal_operating_unit_code || null,
    operatingUnitName: row?.journal_operating_unit_name || null,
    counterpartyId: null,
    counterpartyCode: null,
    counterpartyName: null,
    linkedToCariSource: false,
    sourceRefType,
    sourceRefId,
  };
}

function summarizeDataset({
  openItemRows,
  glLineRows,
  reportQuery,
  directionByAccountId,
}) {
  const accumulatorByKey = new Map();

  for (const row of openItemRows) {
    const context = mapOpenItemGroupContext(row);
    if (!filterRowContext(context, reportQuery)) {
      continue;
    }

    const rowKey = buildRowKey(context);
    if (!accumulatorByKey.has(rowKey)) {
      accumulatorByKey.set(rowKey, createAccumulator(context));
    }
    const accumulator = accumulatorByKey.get(rowKey);
    mergeAccumulatorMeta(accumulator, context);
    accumulator.sourceAmountBase = roundAmount(
      accumulator.sourceAmountBase + toAmount(row?.residualAmountBaseAsOf)
    );
    accumulator.openItemCount += 1;
    if (parsePositiveInt(row?.documentId)) {
      accumulator.documentIds.add(parsePositiveInt(row.documentId));
    }
  }

  for (const row of glLineRows) {
    const context = mapGlLineContext(row, directionByAccountId);
    if (!context.direction || !filterRowContext(context, reportQuery)) {
      continue;
    }

    const rowKey = buildRowKey(context);
    if (!accumulatorByKey.has(rowKey)) {
      accumulatorByKey.set(rowKey, createAccumulator(context));
    }
    const accumulator = accumulatorByKey.get(rowKey);
    mergeAccumulatorMeta(accumulator, context);

    const rawBalance = roundAmount(toAmount(row?.debit_base) - toAmount(row?.credit_base));
    const normalizedBalance = normalizeDirectionBalance(context.direction, rawBalance);
    accumulator.glAmountBase = roundAmount(accumulator.glAmountBase + normalizedBalance);
    accumulator.glJournalLineCount += 1;
    if (parsePositiveInt(row?.journal_id)) {
      accumulator.journalIds.add(parsePositiveInt(row.journal_id));
    }
    if (parsePositiveInt(row?.document_id)) {
      accumulator.documentIds.add(parsePositiveInt(row.document_id));
    }
    if (row?.account_code) {
      accumulator.accountCodes.add(String(row.account_code));
    }
    if (row?.account_name) {
      accumulator.accountNames.add(String(row.account_name));
    }
    if (!context.linkedToCariSource) {
      accumulator.missingSourceLinkCount += 1;
    }
    if (!String(row?.subledger_reference_no || "").trim()) {
      accumulator.missingSubledgerRefCount += 1;
    }
  }

  const finalizedRows = finalizeRows(accumulatorByKey);
  const visibleRows =
    reportQuery.rowStatus === "EXCEPTIONS_ONLY"
      ? finalizedRows.filter((row) => row.issueCodes.length > 0)
      : finalizedRows;

  return {
    rows: visibleRows,
    summary: buildSummary(visibleRows),
  };
}

function buildGlDetailRows(glLineRows, parsedRowKey, directionByAccountId) {
  return glLineRows
    .map((row) => {
      const context = mapGlLineContext(row, directionByAccountId);
      if (!context.direction) {
        return null;
      }
      if (buildRowKey(context) !== parsedRowKey.canonicalRowKey) {
        return null;
      }

      const rawAmountBase = roundAmount(
        toAmount(row?.debit_base) - toAmount(row?.credit_base)
      );
      const normalizedAmountBase = normalizeDirectionBalance(
        context.direction,
        rawAmountBase
      );
      const sourceRefType = normalizeUpperText(row?.source_ref_type);
      const sourceRefId = parsePositiveInt(row?.source_ref_id);

      return {
        journalId: parsePositiveInt(row?.journal_id),
        journalNo: row?.journal_no || null,
        journalLineId: parsePositiveInt(row?.journal_line_id),
        lineNo: Number(row?.line_no || 0),
        entryDate: String(row?.entry_date || "").slice(0, 10) || null,
        documentDate: String(row?.document_date || "").slice(0, 10) || null,
        referenceNo: row?.reference_no || null,
        journalDescription: row?.journal_description || null,
        lineDescription: row?.line_description || null,
        accountId: parsePositiveInt(row?.account_id),
        accountCode: row?.account_code || null,
        accountName: row?.account_name || null,
        operatingUnitId: context.operatingUnitId,
        operatingUnitCode: context.operatingUnitCode,
        operatingUnitName: context.operatingUnitName,
        operatingUnitLabel: formatOperatingUnitLabel(context),
        counterpartyId: context.counterpartyId,
        counterpartyCode: context.counterpartyCode,
        counterpartyName: context.counterpartyName,
        counterpartyLabel: formatCounterpartyLabel(context),
        direction: context.direction,
        debitBase: roundAmount(row?.debit_base),
        creditBase: roundAmount(row?.credit_base),
        rawAmountBase,
        normalizedAmountBase,
        subledgerReferenceNo: row?.subledger_reference_no || null,
        linkedToCariSource: context.linkedToCariSource,
        sourceLinks:
          sourceRefType && sourceRefId
            ? [
                {
                  source_ref_type: sourceRefType,
                  source_ref_id: sourceRefId,
                  link_role: row?.link_role || "PRIMARY",
                },
              ]
            : [],
      };
    })
    .filter(Boolean);
}

function buildSourceDetailRows(openItemRows, parsedRowKey) {
  if (parsedRowKey.rowType !== "COUNTERPARTY_SCOPE") {
    return [];
  }

  return openItemRows
    .filter((row) => {
      const context = mapOpenItemGroupContext(row);
      return buildRowKey(context) === parsedRowKey.canonicalRowKey;
    })
    .map((row) => ({
      openItemId: parsePositiveInt(row?.openItemId),
      documentId: parsePositiveInt(row?.documentId),
      documentNo: row?.documentNo || null,
      direction: normalizeUpperText(row?.direction),
      documentType: row?.documentType || null,
      documentDate: String(row?.documentDate || "").slice(0, 10) || null,
      dueDate: String(row?.dueDate || "").slice(0, 10) || null,
      counterpartyId: parsePositiveInt(row?.counterpartyId),
      counterpartyCode:
        row?.counterpartyCodeSnapshot || row?.counterpartyCodeCurrent || null,
      counterpartyName:
        row?.counterpartyNameSnapshot || row?.counterpartyNameCurrent || null,
      operatingUnitId: parsePositiveInt(row?.operatingUnitId),
      operatingUnitCode: row?.operatingUnitCode || null,
      operatingUnitName: row?.operatingUnitName || null,
      operatingUnitLabel: formatOperatingUnitLabel({
        operatingUnitId: row?.operatingUnitId,
        operatingUnitCode: row?.operatingUnitCode,
        operatingUnitName: row?.operatingUnitName,
      }),
      residualAmountTxnAsOf: roundAmount(row?.residualAmountTxnAsOf),
      residualAmountBaseAsOf: roundAmount(row?.residualAmountBaseAsOf),
      asOfStatus: row?.asOfStatus || null,
    }));
}

async function buildDataset({
  tenantId,
  book,
  reportQuery,
  runQuery = query,
  loadPurposeMappings = listPurposeMappings,
  loadOpenItemRows = listCariOpenItemAsOfRows,
}) {
  const legalEntityId =
    reportQuery.legalEntityId || parsePositiveInt(book?.legal_entity_id);
  if (!legalEntityId) {
    throw badRequest("legalEntityId is required");
  }

  const asOfContext = await resolveAsOfContext(book, reportQuery.fiscalPeriodId, runQuery);
  const controlAccountContext = await resolveControlAccountContext({
    tenantId,
    legalEntityId,
    runQuery,
    loadPurposeMappings,
  });
  const openItemRows = await loadOpenItemRows({
    tenantId,
    legalEntityId,
    asOfDate: asOfContext.asOfDate,
    counterpartyId: reportQuery.counterpartyId || null,
    direction: reportQuery.direction === "ALL" ? null : reportQuery.direction,
    status: "OPEN",
    runQuery,
  });
  const glLineRows = await loadGlControlJournalLines({
    tenantId,
    bookId: parsePositiveInt(book?.id),
    throughPeriodIds: asOfContext.throughPeriodIds,
    controlAccountIds: Array.from(controlAccountContext.directionByAccountId.keys()),
    runQuery,
  });

  const reportResult = summarizeDataset({
    openItemRows,
    glLineRows,
    reportQuery,
    directionByAccountId: controlAccountContext.directionByAccountId,
  });

  return {
    legalEntityId,
    asOfContext,
    controlAccountContext,
    openItemRows,
    glLineRows,
    ...reportResult,
  };
}

/**
 * Build the first-pass RP10 reconciliation view for configured CARI control
 * accounts versus CARI open-item residuals. OU remains a grouping/filter axis,
 * not a separate accounting engine.
 */
export async function getCariControlReconciliationReport({
  tenantId,
  book,
  reportQuery,
  runQuery = query,
  loadPurposeMappings = listPurposeMappings,
  loadOpenItemRows = listCariOpenItemAsOfRows,
}) {
  const dataset = await buildDataset({
    tenantId,
    book,
    reportQuery,
    runQuery,
    loadPurposeMappings,
    loadOpenItemRows,
  });
  const pagedRows = paginateRows(dataset.rows, reportQuery.limit, reportQuery.offset);

  return {
    contract: {
      slice: "GL_VS_CARI_CONTROL_OPEN_ITEMS_V1",
      reconciliationBasis: "AS_OF_FISCAL_PERIOD_END",
      operatingUnitAxisPolicy: "FILTER_GROUP_RECONCILIATION_ONLY",
      localBookBasis: "POSTED_GL_VS_CARI_OPEN_ITEMS",
    },
    filters: {
      legalEntityId: dataset.legalEntityId,
      bookId: parsePositiveInt(book?.id),
      fiscalPeriodId: reportQuery.fiscalPeriodId,
      operatingUnitScope: reportQuery.operatingUnitScope,
      operatingUnitId: reportQuery.operatingUnitId || null,
      direction: reportQuery.direction,
      counterpartyId: reportQuery.counterpartyId || null,
      rowStatus: reportQuery.rowStatus,
    },
    book: {
      id: parsePositiveInt(book?.id),
      legalEntityId: dataset.legalEntityId,
      code: book?.code || null,
      name: book?.name || null,
      baseCurrencyCode: book?.base_currency_code || null,
    },
    period: {
      id: parsePositiveInt(dataset.asOfContext.selectedPeriod?.id),
      label: formatPeriodLabel(dataset.asOfContext.selectedPeriod),
      asOfDate: dataset.asOfContext.asOfDate,
    },
    controlAccounts: dataset.controlAccountContext.mappedRows,
    missingPurposeCodes: dataset.controlAccountContext.missingPurposeCodes,
    summary: dataset.summary,
    total: pagedRows.total,
    limit: pagedRows.limit,
    offset: pagedRows.offset,
    rows: pagedRows.rows,
  };
}

/**
 * Load journal/source drillthrough detail for one RP10 reconciliation row.
 */
export async function getCariControlReconciliationDetail({
  tenantId,
  book,
  reportQuery,
  rowKey,
  runQuery = query,
  loadPurposeMappings = listPurposeMappings,
  loadOpenItemRows = listCariOpenItemAsOfRows,
}) {
  const parsedRowKey = parseRowKey(rowKey);
  const dataset = await buildDataset({
    tenantId,
    book,
    reportQuery: {
      ...reportQuery,
      rowStatus: "ALL",
      limit: reportQuery.limit,
      offset: reportQuery.offset,
    },
    runQuery,
    loadPurposeMappings,
    loadOpenItemRows,
  });

  const row =
    dataset.rows.find((candidate) => candidate.rowKey === parsedRowKey.canonicalRowKey) || null;
  if (!row) {
    throw badRequest("rowKey does not match any reconciliation row for the selected filters");
  }

  return {
    contract: {
      slice: "GL_VS_CARI_CONTROL_OPEN_ITEMS_V1",
      drillthrough: "RECONCILIATION_ROW_TO_JOURNAL_AND_SOURCE",
    },
    period: {
      id: parsePositiveInt(dataset.asOfContext.selectedPeriod?.id),
      label: formatPeriodLabel(dataset.asOfContext.selectedPeriod),
      asOfDate: dataset.asOfContext.asOfDate,
    },
    row,
    glRows: buildGlDetailRows(
      dataset.glLineRows,
      parsedRowKey,
      dataset.controlAccountContext.directionByAccountId
    ),
    sourceRows: buildSourceDetailRows(dataset.openItemRows, parsedRowKey),
  };
}
