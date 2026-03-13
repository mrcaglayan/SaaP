import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildTaxJournalLines,
  computeTaxBreakdown,
  resolveTaxAccounts,
  resolveTaxCodeAndRule,
  resolveTaxRegime,
} from "./tax.engine.service.js";

const FEATURE_TAX_ENGINE_V1 = "FEATURE_TAX_ENGINE_V1";
const TAX_MODULE_CODE_CARI = "CARI";
const TAX_DIRECTION_SALE = "SALE";
const TAX_DIRECTION_PURCHASE = "PURCHASE";
const AMOUNT_SCALE = 6;
const TAX_ZERO_EPSILON = 0.000001;

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function toAmount(value, label = "amount") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  return Number(parsed.toFixed(AMOUNT_SCALE));
}

function toNullableString(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

async function isTaxEngineFeatureEnabled({ tenantId, runQuery = query }) {
  try {
    const result = await runQuery(
      `SELECT is_enabled
       FROM tenant_features
       WHERE tenant_id = ?
         AND feature_code = ?
       LIMIT 1`,
      [parsePositiveInt(tenantId), FEATURE_TAX_ENGINE_V1]
    );
    return toDbBoolean(result.rows?.[0]?.is_enabled);
  } catch (err) {
    if (isMissingTableError(err)) {
      return false;
    }
    throw err;
  }
}

function resolveCounterpartyType(direction) {
  const normalizedDirection = normalizeUpperText(direction);
  if (normalizedDirection === "AR") {
    return "CUSTOMER";
  }
  if (normalizedDirection === "AP") {
    return "VENDOR";
  }
  throw badRequest("direction must be AR or AP");
}

function resolveTaxDirection({ direction, reverseTaxSign = false }) {
  const normalizedDirection = normalizeUpperText(direction);
  if (normalizedDirection === "AR") {
    return reverseTaxSign ? TAX_DIRECTION_PURCHASE : TAX_DIRECTION_SALE;
  }
  if (normalizedDirection === "AP") {
    return reverseTaxSign ? TAX_DIRECTION_SALE : TAX_DIRECTION_PURCHASE;
  }
  throw badRequest("direction must be AR or AP");
}

export function buildControlBalancingTaxLine({
  controlAccountId,
  taxLine,
  currencyCode,
  subledgerReferenceNo,
  description,
}) {
  const parsedControlAccountId = parsePositiveInt(controlAccountId);
  if (!parsedControlAccountId) {
    throw badRequest("Resolved controlAccountId is invalid for tax balancing");
  }

  const debitBase = toAmount(taxLine.creditBase || 0, "taxLine.creditBase");
  const creditBase = toAmount(taxLine.debitBase || 0, "taxLine.debitBase");
  const amountTxn = toAmount(Number(taxLine.amountTxn || 0) * -1, "taxLine.amountTxn");

  return {
    accountId: parsedControlAccountId,
    debitBase,
    creditBase,
    amountTxn,
    description: toNullableString(description, 255),
    subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
    currencyCode: normalizeUpperText(currencyCode) || null,
    taxCode: null,
  };
}

export async function resolveCariTaxComputation({
  tenantId,
  legalEntityId,
  postingDate,
  direction,
  documentType = null,
  baseAmount,
  currencyCode,
  reverseTaxSign = false,
  taxCodeId = null,
  taxCode = null,
  taxPurposeCode = null,
  taxCategoryCode = null,
  lineKind = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!parsedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!parsedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!postingDate) {
    throw badRequest("postingDate is required");
  }
  const normalizedBaseAmount = Number(baseAmount);
  if (!Number.isFinite(normalizedBaseAmount) || normalizedBaseAmount <= 0) {
    throw badRequest("baseAmount must be > 0 for tax computation");
  }
  const normalizedCurrencyCode = normalizeUpperText(currencyCode);
  if (!normalizedCurrencyCode) {
    throw badRequest("currencyCode is required");
  }

  const taxFeatureEnabled = await isTaxEngineFeatureEnabled({
    tenantId: parsedTenantId,
    runQuery,
  });
  if (!taxFeatureEnabled) {
    return {
      enabled: false,
      summary: null,
      breakdown: null,
      resolvedAccounts: null,
      resolved: null,
      taxDirection: null,
      currencyCode: normalizedCurrencyCode,
      taxLines: [],
    };
  }

  const normalizedDirection = normalizeUpperText(direction);
  const counterpartyType = resolveCounterpartyType(normalizedDirection);
  const taxDirection = resolveTaxDirection({
    direction: normalizedDirection,
    reverseTaxSign: Boolean(reverseTaxSign),
  });

  const regimeRow = await resolveTaxRegime({
    tenantId: parsedTenantId,
    legalEntityId: parsedLegalEntityId,
    postingDate,
    runQuery,
  });

  const resolved = await resolveTaxCodeAndRule({
    tenantId: parsedTenantId,
    legalEntityId: parsedLegalEntityId,
    postingDate,
    regimeId: parsePositiveInt(regimeRow.id),
    moduleCode: TAX_MODULE_CODE_CARI,
    documentType: toNullableString(documentType, 60),
    counterpartyType,
    taxCategoryCode: toNullableString(taxCategoryCode, 60),
    lineKind: toNullableString(lineKind, 40),
    taxCodeId: parsePositiveInt(taxCodeId),
    taxCode: toNullableString(taxCode, 40),
    baseAmount: normalizedBaseAmount,
    runQuery,
  });
  const taxableBaseAmount =
    resolved.computation.taxableBaseAmount ?? normalizedBaseAmount;

  const breakdown = computeTaxBreakdown({
    baseAmount: taxableBaseAmount,
    mode: resolved.computation.calculationMode,
    ratePct: resolved.computation.ratePct,
    recoverability: resolved.computation.recoverability,
    recoverablePct: resolved.computation.recoverablePct,
  });

  const resolvedAccounts = await resolveTaxAccounts({
    tenantId: parsedTenantId,
    legalEntityId: parsedLegalEntityId,
    taxCodeId: parsePositiveInt(resolved.taxCodeRow.id),
    taxRegimeId: parsePositiveInt(regimeRow.id),
    taxPurposeCode: toNullableString(taxPurposeCode, 40),
    direction: taxDirection,
    runQuery,
  });

  const summary = {
    regimeId: parsePositiveInt(regimeRow.id),
    taxCodeId: parsePositiveInt(resolved.taxCodeRow.id),
    taxCode: toNullableString(resolved.taxCodeRow.code, 40),
    taxRuleId: parsePositiveInt(resolved.taxRuleRow.id),
    taxPurposeCode: normalizeUpperText(resolvedAccounts.taxPurposeCode),
    taxDirection,
    threshold: resolved.threshold || null,
    taxableBaseAmount,
    taxAmount: toAmount(breakdown.taxAmount || 0),
    netAmount: toAmount(breakdown.netAmount || 0),
    grossAmount: toAmount(breakdown.grossAmount || 0),
    calculationMode: normalizeUpperText(breakdown.calculationMode),
    recoverability: normalizeUpperText(breakdown.recoverability),
    mappingAccountId: parsePositiveInt(resolvedAccounts.mappingRow?.account_id),
    taxCategoryCode: toNullableString(taxCategoryCode, 60),
    lineKind: toNullableString(lineKind, 40),
  };

  const taxLines =
    Number(summary.taxAmount) <= TAX_ZERO_EPSILON
      ? []
      : buildTaxJournalLines({
          breakdown,
          taxCode: String(resolved.taxCodeRow.code || ""),
          taxPurposeCode: resolvedAccounts.taxPurposeCode,
          mappingRow: resolvedAccounts.mappingRow,
          direction: taxDirection,
          currencyCode: normalizedCurrencyCode,
        });

  return {
    enabled: true,
    summary,
    breakdown,
    resolvedAccounts,
    resolved,
    taxDirection,
    currencyCode: normalizedCurrencyCode,
    taxLines,
  };
}

export function buildCariTaxAugmentationFromStoredLineTaxes({
  lineTaxes,
  controlAccountId,
  direction,
  reverseTaxSign = false,
  currencyCode,
  subledgerReferenceNo = null,
  lineDescription = null,
  includeControlBalancing = true,
}) {
  const normalizedCurrencyCode = normalizeUpperText(currencyCode);
  const normalizedSubledgerReferenceNo = toNullableString(subledgerReferenceNo, 100);
  const normalizedLineDescription = toNullableString(lineDescription, 255);
  const taxDirection = resolveTaxDirection({
    direction: normalizeUpperText(direction),
    reverseTaxSign: Boolean(reverseTaxSign),
  });
  const aggregateMap = new Map();

  for (const lineTax of lineTaxes || []) {
    const accountId = parsePositiveInt(lineTax.accountId ?? lineTax.account_id);
    if (!accountId) {
      continue;
    }
    const taxAmountTxn = toAmount(lineTax.taxAmountTxn ?? lineTax.tax_amount_txn ?? 0);
    const taxAmountBase = toAmount(lineTax.taxAmountBase ?? lineTax.tax_amount_base ?? taxAmountTxn);
    if (taxAmountTxn <= TAX_ZERO_EPSILON && taxAmountBase <= TAX_ZERO_EPSILON) {
      continue;
    }
    const taxCode = toNullableString(lineTax.taxCode ?? lineTax.tax_code, 40);
    const taxPurposeCode = toNullableString(
      lineTax.taxPurposeCode ?? lineTax.tax_purpose_code,
      40
    );
    const key = [accountId, taxCode || "", taxPurposeCode || ""].join("|");
    const existing =
      aggregateMap.get(key) || {
        accountId,
        taxCode,
        taxPurposeCode,
        debitBase: 0,
        creditBase: 0,
        amountTxn: 0,
      };
    if (taxDirection === TAX_DIRECTION_SALE) {
      existing.creditBase = Number(
        (existing.creditBase + Number(taxAmountBase || 0)).toFixed(AMOUNT_SCALE)
      );
      existing.amountTxn = Number(
        (existing.amountTxn - Number(taxAmountTxn || 0)).toFixed(AMOUNT_SCALE)
      );
    } else {
      existing.debitBase = Number(
        (existing.debitBase + Number(taxAmountBase || 0)).toFixed(AMOUNT_SCALE)
      );
      existing.amountTxn = Number(
        (existing.amountTxn + Number(taxAmountTxn || 0)).toFixed(AMOUNT_SCALE)
      );
    }
    aggregateMap.set(key, existing);
  }

  const lines = [];
  for (const taxLine of aggregateMap.values()) {
    const description =
      normalizedLineDescription ||
      toNullableString(`Cari tax (${taxLine.taxCode || "UNSPECIFIED"})`, 255);
    lines.push({
      accountId: taxLine.accountId,
      debitBase: toAmount(taxLine.debitBase || 0),
      creditBase: toAmount(taxLine.creditBase || 0),
      amountTxn: toAmount(taxLine.amountTxn || 0),
      description,
      subledgerReferenceNo: normalizedSubledgerReferenceNo,
      currencyCode: normalizedCurrencyCode,
      taxCode: taxLine.taxCode || null,
      taxPurposeCode: taxLine.taxPurposeCode || null,
    });
    if (includeControlBalancing) {
      lines.push(
        buildControlBalancingTaxLine({
          controlAccountId,
          taxLine,
          currencyCode: normalizedCurrencyCode,
          subledgerReferenceNo: normalizedSubledgerReferenceNo,
          description: toNullableString(
            `${normalizedLineDescription || "Cari tax"} balancing (${taxLine.taxCode || "TAX"})`,
            255
          ),
        })
      );
    }
  }

  return lines;
}

export async function buildCariTaxAugmentation({
  tenantId,
  legalEntityId,
  postingDate,
  direction,
  documentType = null,
  baseAmount,
  controlAccountId,
  currencyCode,
  subledgerReferenceNo = null,
  lineDescription = null,
  reverseTaxSign = false,
  taxCodeId = null,
  taxCode = null,
  taxPurposeCode = null,
  taxCategoryCode = null,
  lineKind = null,
  includeControlBalancing = true,
  runQuery = query,
}) {
  const computation = await resolveCariTaxComputation({
    tenantId,
    legalEntityId,
    postingDate,
    direction,
    documentType,
    baseAmount,
    currencyCode,
    reverseTaxSign,
    taxCodeId,
    taxCode,
    taxPurposeCode,
    taxCategoryCode,
    lineKind,
    runQuery,
  });
  if (!computation.enabled) {
    return {
      enabled: false,
      lines: [],
      summary: null,
    };
  }
  const summary = computation.summary;
  if (Number(summary?.taxAmount || 0) <= TAX_ZERO_EPSILON) {
    return {
      enabled: true,
      lines: [],
      summary,
    };
  }
  const normalizedCurrencyCode = normalizeUpperText(currencyCode);
  const normalizedSubledgerReferenceNo = toNullableString(subledgerReferenceNo, 100);
  const normalizedLineDescription = toNullableString(lineDescription, 255);
  const integratedLines = [];

  for (const taxLine of computation.taxLines) {
    const accountId = parsePositiveInt(taxLine.accountId);
    if (!accountId) {
      throw badRequest("Resolved tax line account is invalid");
    }

    const debitBase = toAmount(taxLine.debitBase || 0, "taxLine.debitBase");
    const creditBase = toAmount(taxLine.creditBase || 0, "taxLine.creditBase");
    const amountTxn = toAmount(taxLine.amountTxn || 0, "taxLine.amountTxn");
    const resolvedTaxCode = toNullableString(
      taxLine.taxCode || summary.taxCode,
      40
    );
    const taxDescription =
      toNullableString(taxLine.description, 255) ||
      normalizedLineDescription ||
      toNullableString(`Cari tax (${resolvedTaxCode || "UNSPECIFIED"})`, 255);

    integratedLines.push({
      accountId,
      debitBase,
      creditBase,
      amountTxn,
      description: taxDescription,
      subledgerReferenceNo: normalizedSubledgerReferenceNo,
      currencyCode: normalizedCurrencyCode,
      taxCode: resolvedTaxCode,
    });

    if (includeControlBalancing) {
      integratedLines.push(
        buildControlBalancingTaxLine({
          controlAccountId,
          taxLine: { debitBase, creditBase, amountTxn },
          currencyCode: normalizedCurrencyCode,
          subledgerReferenceNo: normalizedSubledgerReferenceNo,
          description: toNullableString(
            `${normalizedLineDescription || "Cari tax"} balancing (${resolvedTaxCode || "TAX"})`,
            255
          ),
        })
      );
    }
  }

  return {
    enabled: true,
    lines: integratedLines,
    summary,
  };
}

export default {
  resolveCariTaxComputation,
  buildCariTaxAugmentationFromStoredLineTaxes,
  buildControlBalancingTaxLine,
  buildCariTaxAugmentation,
};
