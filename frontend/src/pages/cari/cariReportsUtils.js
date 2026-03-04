export const REPORT_TABS = Object.freeze({
  AR_AGING: "AR_AGING",
  AP_AGING: "AP_AGING",
  OPEN_ITEMS: "OPEN_ITEMS",
  STATEMENT: "STATEMENT",
  SETTLEMENT_REALIZED_FX: "SETTLEMENT_REALIZED_FX",
});

export const STATUS_FILTER_OPTIONS = ["OPEN", "PARTIALLY_SETTLED", "SETTLED", "ALL"];
export const ROLE_FILTER_OPTIONS = ["", "CUSTOMER", "VENDOR", "BOTH"];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeCurrencyCode(value) {
  const normalized = normalizeText(value).toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

export function buildCariReportQuery(filters, tab) {
  const limit = toPositiveInt(filters.limit) || 200;
  const offset =
    Number.isInteger(Number(filters.offset)) && Number(filters.offset) >= 0
      ? Number(filters.offset)
      : 0;

  if (tab === REPORT_TABS.SETTLEMENT_REALIZED_FX) {
    return {
      legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
      counterpartyId: toPositiveInt(filters.counterpartyId) || undefined,
      currencyCode: normalizeCurrencyCode(filters.currencyCode) || undefined,
      periodFrom: normalizeDate(filters.periodFrom) || undefined,
      periodTo: normalizeDate(filters.periodTo) || undefined,
      includeDetails: true,
      limit,
      offset,
    };
  }

  const params = {
    asOfDate: normalizeDate(filters.asOfDate),
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    counterpartyId: toPositiveInt(filters.counterpartyId) || undefined,
    role: normalizeText(filters.role) || undefined,
    status: normalizeText(filters.status) || undefined,
    includeDetails: true,
    limit,
    offset,
  };

  if (tab === REPORT_TABS.AR_AGING) {
    return {
      ...params,
      direction: "AR",
    };
  }
  if (tab === REPORT_TABS.AP_AGING) {
    return {
      ...params,
      direction: "AP",
    };
  }
  return params;
}

export function reconcileOpenItemsSummary(reportData) {
  const rows = Array.isArray(reportData?.rows) ? reportData.rows : [];
  const summary = reportData?.summary || {};
  const rowsResidualTxn = rows.reduce(
    (sum, row) => sum + toNumber(row?.residualAmountTxnAsOf),
    0
  );
  const rowsResidualBase = rows.reduce(
    (sum, row) => sum + toNumber(row?.residualAmountBaseAsOf),
    0
  );
  const summaryResidualTxn = toNumber(summary?.residualAmountTxnTotal);
  const summaryResidualBase = toNumber(summary?.residualAmountBaseTotal);

  return {
    rowsResidualTxn: Number(rowsResidualTxn.toFixed(6)),
    rowsResidualBase: Number(rowsResidualBase.toFixed(6)),
    summaryResidualTxn: Number(summaryResidualTxn.toFixed(6)),
    summaryResidualBase: Number(summaryResidualBase.toFixed(6)),
    txnDiff: Number((rowsResidualTxn - summaryResidualTxn).toFixed(6)),
    baseDiff: Number((rowsResidualBase - summaryResidualBase).toFixed(6)),
    matches:
      Math.abs(rowsResidualTxn - summaryResidualTxn) <= 0.000001 &&
      Math.abs(rowsResidualBase - summaryResidualBase) <= 0.000001,
  };
}

export function reconcileStatementSummary(reportData) {
  const reconcile = reportData?.summary?.reconcile || {};
  const txnDiff =
    toNumber(reconcile?.openResidualAmountTxnFromDocuments) -
    toNumber(reconcile?.openResidualAmountTxnFromOpenItems);
  const baseDiff =
    toNumber(reconcile?.openResidualAmountBaseFromDocuments) -
    toNumber(reconcile?.openResidualAmountBaseFromOpenItems);

  return {
    txnDiff: Number(txnDiff.toFixed(6)),
    baseDiff: Number(baseDiff.toFixed(6)),
    matches: Math.abs(txnDiff) <= 0.000001 && Math.abs(baseDiff) <= 0.000001,
  };
}

export function reconcileSettlementRealizedFxSummary(reportData) {
  const rows = Array.isArray(reportData?.rows) ? reportData.rows : [];
  const summary = reportData?.summary || {};
  const totalGroupedRows = toPositiveInt(reportData?.total) || 0;

  const rowsSettlementCount = rows.reduce(
    (sum, row) => sum + toNumber(row?.settlementCount),
    0
  );
  const rowsAllocatedTxn = rows.reduce(
    (sum, row) => sum + toNumber(row?.totalAllocatedTxn),
    0
  );
  const rowsAllocatedBase = rows.reduce(
    (sum, row) => sum + toNumber(row?.totalAllocatedBase),
    0
  );
  const rowsRealizedFxNetBase = rows.reduce(
    (sum, row) => sum + toNumber(row?.realizedFxNetBase),
    0
  );
  const rowsRealizedFxGainBase = rows.reduce(
    (sum, row) => sum + toNumber(row?.realizedFxGainBase),
    0
  );
  const rowsRealizedFxLossBase = rows.reduce(
    (sum, row) => sum + toNumber(row?.realizedFxLossBase),
    0
  );

  const summarySettlementCount = toNumber(summary?.settlementCount);
  const summaryAllocatedTxn = toNumber(summary?.totalAllocatedTxn);
  const summaryAllocatedBase = toNumber(summary?.totalAllocatedBase);
  const summaryRealizedFxNetBase = toNumber(summary?.realizedFxNetBase);
  const rowsCoverFullResult =
    totalGroupedRows === 0 || rows.length >= totalGroupedRows;

  const settlementCountDiff = rowsSettlementCount - summarySettlementCount;
  const allocatedTxnDiff = rowsAllocatedTxn - summaryAllocatedTxn;
  const allocatedBaseDiff = rowsAllocatedBase - summaryAllocatedBase;
  const realizedFxNetBaseDiff = rowsRealizedFxNetBase - summaryRealizedFxNetBase;

  return {
    totalGroupedRows,
    visibleGroupedRows: rows.length,
    rowsCoverFullResult,
    rowsSettlementCount: Number(rowsSettlementCount.toFixed(6)),
    rowsAllocatedTxn: Number(rowsAllocatedTxn.toFixed(6)),
    rowsAllocatedBase: Number(rowsAllocatedBase.toFixed(6)),
    rowsRealizedFxNetBase: Number(rowsRealizedFxNetBase.toFixed(6)),
    rowsRealizedFxGainBase: Number(rowsRealizedFxGainBase.toFixed(6)),
    rowsRealizedFxLossBase: Number(rowsRealizedFxLossBase.toFixed(6)),
    summarySettlementCount: Number(summarySettlementCount.toFixed(6)),
    summaryAllocatedTxn: Number(summaryAllocatedTxn.toFixed(6)),
    summaryAllocatedBase: Number(summaryAllocatedBase.toFixed(6)),
    summaryRealizedFxNetBase: Number(summaryRealizedFxNetBase.toFixed(6)),
    settlementCountDiff: Number(settlementCountDiff.toFixed(6)),
    allocatedTxnDiff: Number(allocatedTxnDiff.toFixed(6)),
    allocatedBaseDiff: Number(allocatedBaseDiff.toFixed(6)),
    realizedFxNetBaseDiff: Number(realizedFxNetBaseDiff.toFixed(6)),
    matches:
      rowsCoverFullResult &&
      Math.abs(settlementCountDiff) <= 0.000001 &&
      Math.abs(allocatedTxnDiff) <= 0.000001 &&
      Math.abs(allocatedBaseDiff) <= 0.000001 &&
      Math.abs(realizedFxNetBaseDiff) <= 0.000001,
  };
}
