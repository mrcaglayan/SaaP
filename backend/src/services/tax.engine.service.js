import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function u(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toAmount(value, scale = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Number(parsed.toFixed(scale));
}

function toDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function safeParseJson(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function notFound(message, code = "") {
  const err = new Error(message);
  err.status = 404;
  if (code) {
    err.code = code;
  }
  return err;
}

function conflict(message, code = "") {
  const err = new Error(message);
  err.status = 409;
  if (code) {
    err.code = code;
  }
  return err;
}

function taxInvalidFormula(message) {
  return conflict(message, "TAX_INVALID_FORMULA");
}

function resolveDefaultTaxPurposeCode({ taxKind, direction }) {
  const normalizedKind = u(taxKind);
  const normalizedDirection = u(direction || "PURCHASE");
  if (normalizedKind === "VAT") {
    return normalizedDirection === "SALE" ? "VAT_OUTPUT" : "VAT_INPUT";
  }
  if (normalizedKind === "WITHHOLDING") {
    return normalizedDirection === "SALE"
      ? "WITHHOLDING_RECEIVABLE"
      : "WITHHOLDING_PAYABLE";
  }
  return null;
}

async function getTaxRegimeById({ tenantId, regimeId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM tax_regimes
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, regimeId]
  );
  return result.rows?.[0] || null;
}

async function getLegalEntityForTenant({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, tenant_id, country_id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  return result.rows?.[0] || null;
}

async function resolvePreferredBookCalendarId({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT calendar_id
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [parsePositiveInt(tenantId), parsePositiveInt(legalEntityId)]
  );
  return parsePositiveInt(result.rows?.[0]?.calendar_id);
}

async function resolveFiscalPeriodForDate({
  calendarId,
  postingDate,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, fiscal_year, period_no, start_date, end_date
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND ? BETWEEN start_date AND end_date
     ORDER BY is_adjustment ASC, id ASC
     LIMIT 1`,
    [parsePositiveInt(calendarId), postingDate]
  );
  return result.rows?.[0] || null;
}

function resolveCariDirectionFromCounterpartyType(counterpartyType) {
  const normalized = u(counterpartyType);
  if (normalized === "VENDOR") {
    return "AP";
  }
  if (normalized === "CUSTOMER") {
    return "AR";
  }
  return null;
}

function resolveCariThresholdDocumentSign(documentType) {
  const normalized = u(documentType);
  if (["INVOICE", "DEBIT_NOTE"].includes(normalized)) {
    return 1;
  }
  if (normalized === "CREDIT_NOTE") {
    return -1;
  }
  return 0;
}

async function resolveThresholdBaseContext({
  tenantId,
  legalEntityId,
  postingDate,
  moduleCode,
  documentType,
  counterpartyType,
  taxRuleRow,
  baseAmount,
  runQuery = query,
}) {
  const thresholdAmount = toAmount(taxRuleRow?.threshold_amount);
  if (thresholdAmount === null) {
    return null;
  }

  if (u(moduleCode) !== "CARI" || u(counterpartyType) !== "VENDOR") {
    throw conflict(
      "thresholdAmount is supported only for CARI vendor tax rules",
      "TAX_RULE_UNSUPPORTED_THRESHOLD"
    );
  }

  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!parsedLegalEntityId) {
    throw badRequest("legalEntityId is required for threshold-based tax rules");
  }

  const normalizedBaseAmount = toAmount(baseAmount);
  if (normalizedBaseAmount === null || normalizedBaseAmount <= 0) {
    throw badRequest("baseAmount must be > 0 for threshold-based tax rules");
  }

  const currentDocumentSign = resolveCariThresholdDocumentSign(documentType);
  if (currentDocumentSign === 0) {
    return {
      mode: "CUMULATIVE_FISCAL_PERIOD_EXCESS_ONLY",
      thresholdAmount,
      cumulativeBaseBefore: null,
      cumulativeBaseAfter: null,
      signedCurrentBaseAmount: 0,
      signedAppliedBaseAmount: 0,
      appliedBaseAmount: 0,
      periodId: null,
      fiscalYear: null,
      periodNo: null,
      periodStartDate: null,
      periodEndDate: null,
    };
  }

  const calendarId = await resolvePreferredBookCalendarId({
    tenantId,
    legalEntityId: parsedLegalEntityId,
    runQuery,
  });
  if (!calendarId) {
    throw conflict(
      "Unable to resolve fiscal calendar for threshold-based tax rule",
      "TAX_RULE_UNSUPPORTED_THRESHOLD"
    );
  }

  const periodRow = await resolveFiscalPeriodForDate({
    calendarId,
    postingDate,
    runQuery,
  });
  if (!periodRow) {
    throw conflict(
      "Unable to resolve fiscal period for threshold-based tax rule",
      "TAX_RULE_UNSUPPORTED_THRESHOLD"
    );
  }

  const conditions = [
    "tenant_id = ?",
    "legal_entity_id = ?",
    "direction = ?",
    "status IN ('POSTED', 'PARTIALLY_SETTLED', 'SETTLED')",
    "document_date >= ?",
    "document_date <= ?",
  ];
  const params = [
    parsePositiveInt(tenantId),
    parsedLegalEntityId,
    resolveCariDirectionFromCounterpartyType(counterpartyType),
    String(periodRow.start_date || ""),
    postingDate,
  ];

  const cumulativeResult = await runQuery(
    `SELECT COALESCE(
        SUM(
          CASE
            WHEN document_type IN ('INVOICE', 'DEBIT_NOTE') THEN amount_base
            WHEN document_type = 'CREDIT_NOTE' THEN amount_base * -1
            ELSE 0
          END
        ),
        0
      ) AS cumulative_amount_base
     FROM cari_documents
     WHERE ${conditions.join(" AND ")}`,
    params
  );

  const cumulativeBaseBefore = toAmount(
    cumulativeResult.rows?.[0]?.cumulative_amount_base || 0
  );
  const signedCurrentBaseAmount = toAmount(normalizedBaseAmount * currentDocumentSign);
  const cumulativeBaseAfter = toAmount(
    Number(cumulativeBaseBefore || 0) + Number(signedCurrentBaseAmount || 0)
  );
  const excessBefore = Math.max(0, Number(cumulativeBaseBefore || 0) - thresholdAmount);
  const excessAfter = Math.max(0, Number(cumulativeBaseAfter || 0) - thresholdAmount);
  const signedAppliedBaseAmount = toAmount(excessAfter - excessBefore);
  const appliedBaseAmount = toAmount(Math.abs(Number(signedAppliedBaseAmount || 0)));

  return {
    mode: "CUMULATIVE_FISCAL_PERIOD_EXCESS_ONLY",
    thresholdAmount,
    cumulativeBaseBefore,
    cumulativeBaseAfter,
    signedCurrentBaseAmount,
    signedAppliedBaseAmount,
    appliedBaseAmount,
    periodId: parsePositiveInt(periodRow.id),
    fiscalYear: Number(periodRow.fiscal_year || 0) || null,
    periodNo: Number(periodRow.period_no || 0) || null,
    periodStartDate: String(periodRow.start_date || "") || null,
    periodEndDate: String(periodRow.end_date || "") || null,
  };
}

async function resolveTaxCodeByInput({
  tenantId,
  regimeId,
  taxCodeId,
  taxCode,
  runQuery = query,
}) {
  if (!taxCodeId && !taxCode) {
    return null;
  }
  const where = ["tc.tenant_id = ?", "tc.tax_regime_id = ?"];
  const params = [tenantId, regimeId];
  if (taxCodeId) {
    where.push("tc.id = ?");
    params.push(parsePositiveInt(taxCodeId));
  }
  if (taxCode) {
    where.push("tc.code = ?");
    params.push(u(taxCode));
  }
  const result = await runQuery(
    `SELECT tc.*
     FROM tax_codes tc
     WHERE ${where.join(" AND ")}
     ORDER BY tc.id DESC
     LIMIT 1`,
    params
  );
  return result.rows?.[0] || null;
}

async function resolveTaxRule({
  tenantId,
  regimeId,
  postingDate,
  moduleCode,
  documentType,
  counterpartyType,
  taxCodeId = null,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT trs.*
     FROM tax_rule_sets trs
     WHERE trs.tenant_id = ?
       AND trs.tax_regime_id = ?
       AND trs.status = 'ACTIVE'
       AND trs.effective_from <= ?
       AND (trs.effective_to IS NULL OR trs.effective_to >= ?)
       AND trs.module_code = ?
       AND (? IS NULL OR trs.tax_code_id = ?)
       AND (trs.document_type IS NULL OR trs.document_type = ?)
       AND (trs.counterparty_type IS NULL OR trs.counterparty_type = ?)
     ORDER BY
       CASE
         WHEN ? IS NULL THEN 0
         WHEN trs.tax_code_id = ? THEN 0
         ELSE 1
       END,
       CASE
         WHEN trs.document_type IS NOT NULL AND trs.document_type = ? THEN 0
         WHEN trs.document_type IS NULL THEN 1
         ELSE 2
       END,
       CASE
         WHEN trs.counterparty_type IS NOT NULL AND trs.counterparty_type = ? THEN 0
         WHEN trs.counterparty_type IS NULL THEN 1
         ELSE 2
       END,
       trs.apply_priority ASC,
       trs.id ASC
     LIMIT 1`,
    [
      tenantId,
      regimeId,
      postingDate,
      postingDate,
      u(moduleCode),
      taxCodeId || null,
      taxCodeId || null,
      documentType || null,
      counterpartyType || null,
      taxCodeId || null,
      taxCodeId || null,
      documentType || null,
      counterpartyType || null,
    ]
  );
  return result.rows?.[0] || null;
}

function resolveComputationConfigFromFormula({
  taxCodeRow,
  taxRuleRow,
  overrides = {},
}) {
  const formula = safeParseJson(taxRuleRow?.formula_json);
  if (!formula || typeof formula !== "object" || Array.isArray(formula)) {
    throw taxInvalidFormula("Tax rule formula_json must be a JSON object");
  }

  const formulaType = u(formula.type || "RATE");
  if (!["RATE", "FIXED_RATE"].includes(formulaType)) {
    throw taxInvalidFormula(`Unsupported formula type: ${formulaType}`);
  }

  let ratePct = toAmount(taxCodeRow?.rate_pct, 4);
  if (formulaType === "FIXED_RATE") {
    ratePct = toAmount(formula.ratePct, 4);
    if (ratePct === null) {
      throw taxInvalidFormula("FIXED_RATE formula must include numeric ratePct");
    }
  } else if (formula.ratePct !== undefined && formula.ratePct !== null) {
    ratePct = toAmount(formula.ratePct, 4);
  }

  if (ratePct === null || !Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
    throw taxInvalidFormula("Resolved tax rate must be between 0 and 100");
  }

  const calculationMode = u(
    overrides.calculationMode ||
      formula.calculationMode ||
      taxCodeRow?.calculation_mode
  );
  if (!["EXCLUSIVE", "INCLUSIVE"].includes(calculationMode)) {
    throw taxInvalidFormula(`Unsupported calculationMode: ${calculationMode}`);
  }

  const recoverability = u(
    overrides.recoverability || formula.recoverability || taxCodeRow?.recoverability
  );
  if (!["FULL", "PARTIAL", "NONE"].includes(recoverability)) {
    throw taxInvalidFormula(`Unsupported recoverability: ${recoverability}`);
  }

  let recoverablePct = null;
  if (recoverability === "PARTIAL") {
    const explicitRecoverablePct =
      overrides.recoverablePct ?? formula.recoverablePct ?? null;
    recoverablePct = toAmount(explicitRecoverablePct, 4);
    if (
      recoverablePct === null ||
      !Number.isFinite(recoverablePct) ||
      recoverablePct < 0 ||
      recoverablePct > 100
    ) {
      throw taxInvalidFormula(
        "PARTIAL recoverability requires recoverablePct between 0 and 100"
      );
    }
  }

  return {
    formula,
    formulaType,
    ratePct,
    calculationMode,
    recoverability,
    recoverablePct,
  };
}

export async function resolveTaxRegime({
  tenantId,
  legalEntityId,
  postingDate,
  countryId = null,
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

  const legalEntity = await getLegalEntityForTenant({
    tenantId: parsedTenantId,
    legalEntityId: parsedLegalEntityId,
    runQuery,
  });
  if (!legalEntity) {
    throw badRequest("legalEntityId not found for tenant");
  }

  const resolvedCountryId =
    parsePositiveInt(countryId) || parsePositiveInt(legalEntity.country_id);
  if (!resolvedCountryId) {
    throw badRequest("Unable to resolve country for tax regime");
  }

  if (parsePositiveInt(countryId) && parsePositiveInt(countryId) !== parsePositiveInt(legalEntity.country_id)) {
    throw badRequest("countryId must match legalEntityId country");
  }

  const result = await runQuery(
    `SELECT tr.*
     FROM tax_regimes tr
     WHERE tr.tenant_id = ?
       AND tr.country_id = ?
       AND tr.status = 'ACTIVE'
       AND tr.effective_from <= ?
       AND (tr.effective_to IS NULL OR tr.effective_to >= ?)
       AND (tr.legal_entity_id = ? OR tr.legal_entity_id IS NULL)
     ORDER BY
       CASE WHEN tr.legal_entity_id = ? THEN 0 ELSE 1 END,
       tr.effective_from DESC,
       tr.id DESC
     LIMIT 1`,
    [
      parsedTenantId,
      resolvedCountryId,
      postingDate,
      postingDate,
      parsedLegalEntityId,
      parsedLegalEntityId,
    ]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw notFound(
      "Active tax regime not found for selected country/legal entity/posting date",
      "TAX_REGIME_NOT_FOUND"
    );
  }
  return row;
}

export async function resolveTaxCodeAndRule({
  tenantId,
  legalEntityId,
  postingDate,
  regimeId = null,
  countryId = null,
  moduleCode,
  documentType = null,
  counterpartyType = null,
  taxCodeId = null,
  taxCode = null,
  baseAmount = null,
  calculationMode = null,
  recoverability = null,
  recoverablePct = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!postingDate) {
    throw badRequest("postingDate is required");
  }
  if (!moduleCode) {
    throw badRequest("moduleCode is required");
  }

  let regimeRow = null;
  if (parsePositiveInt(regimeId)) {
    regimeRow = await getTaxRegimeById({
      tenantId: parsedTenantId,
      regimeId: parsePositiveInt(regimeId),
      runQuery,
    });
    if (!regimeRow) {
      throw notFound("Tax regime not found", "TAX_REGIME_NOT_FOUND");
    }
  } else {
    regimeRow = await resolveTaxRegime({
      tenantId: parsedTenantId,
      legalEntityId,
      postingDate,
      countryId,
      runQuery,
    });
  }

  let taxCodeRow = await resolveTaxCodeByInput({
    tenantId: parsedTenantId,
    regimeId: parsePositiveInt(regimeRow.id),
    taxCodeId: parsePositiveInt(taxCodeId),
    taxCode,
    runQuery,
  });
  if (taxCodeRow && u(taxCodeRow.status) !== "ACTIVE") {
    throw conflict("Selected tax code is not ACTIVE", "TAX_CODE_NOT_ACTIVE");
  }

  const taxRuleRow = await resolveTaxRule({
    tenantId: parsedTenantId,
    regimeId: parsePositiveInt(regimeRow.id),
    postingDate,
    moduleCode,
    documentType,
    counterpartyType,
    taxCodeId: taxCodeRow ? parsePositiveInt(taxCodeRow.id) : null,
    runQuery,
  });
  if (!taxRuleRow) {
    throw notFound(
      "Active tax rule not found for selected module/context/date",
      "TAX_RULE_NOT_FOUND"
    );
  }

  if (!taxCodeRow) {
    taxCodeRow = await resolveTaxCodeByInput({
      tenantId: parsedTenantId,
      regimeId: parsePositiveInt(regimeRow.id),
      taxCodeId: parsePositiveInt(taxRuleRow.tax_code_id),
      taxCode: null,
      runQuery,
    });
  }
  if (!taxCodeRow || u(taxCodeRow.status) !== "ACTIVE") {
    throw conflict("Resolved tax code is missing or inactive", "TAX_CODE_NOT_ACTIVE");
  }

  const threshold = await resolveThresholdBaseContext({
    tenantId: parsedTenantId,
    legalEntityId,
    postingDate,
    moduleCode,
    documentType,
    counterpartyType,
    taxRuleRow,
    baseAmount,
    runQuery,
  });
  const computation = resolveComputationConfigFromFormula({
    taxCodeRow,
    taxRuleRow,
    overrides: {
      calculationMode,
      recoverability,
      recoverablePct,
    },
  });

  return {
    regimeRow,
    taxCodeRow,
    taxRuleRow,
    formula: {
      type: computation.formulaType,
      source: computation.formula,
    },
    threshold,
    computation: {
      formulaType: computation.formulaType,
      ratePct: computation.ratePct,
      calculationMode: computation.calculationMode,
      recoverability: computation.recoverability,
      recoverablePct: computation.recoverablePct,
      taxableBaseAmount:
        threshold?.appliedBaseAmount !== undefined && threshold?.appliedBaseAmount !== null
          ? threshold.appliedBaseAmount
          : baseAmount === null || baseAmount === undefined
          ? null
          : toAmount(baseAmount),
      signedTaxableBaseAmount:
        threshold?.signedAppliedBaseAmount !== undefined &&
        threshold?.signedAppliedBaseAmount !== null
          ? threshold.signedAppliedBaseAmount
          : baseAmount === null || baseAmount === undefined
          ? null
          : toAmount(baseAmount),
    },
  };
}

export function computeTaxBreakdown({
  baseAmount,
  mode,
  ratePct,
  recoverability,
  recoverablePct = null,
}) {
  const amount = Number(baseAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw taxInvalidFormula("baseAmount must be >= 0");
  }

  const normalizedMode = u(mode);
  if (!["EXCLUSIVE", "INCLUSIVE"].includes(normalizedMode)) {
    throw taxInvalidFormula(`Unsupported calculation mode: ${normalizedMode}`);
  }

  const parsedRate = Number(ratePct);
  if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
    throw taxInvalidFormula("ratePct must be between 0 and 100");
  }
  const rateFraction = Number((parsedRate / 100).toFixed(8));

  let netAmount = 0;
  let taxAmount = 0;
  let grossAmount = 0;
  if (normalizedMode === "EXCLUSIVE") {
    netAmount = amount;
    taxAmount = Number((amount * rateFraction).toFixed(6));
    grossAmount = Number((netAmount + taxAmount).toFixed(6));
  } else {
    if (rateFraction <= 0 && amount > 0) {
      throw taxInvalidFormula("INCLUSIVE calculation requires a positive ratePct");
    }
    if (amount === 0) {
      netAmount = 0;
      taxAmount = 0;
      grossAmount = 0;
    } else {
      netAmount = Number((amount / (1 + rateFraction)).toFixed(6));
      taxAmount = Number((amount - netAmount).toFixed(6));
      grossAmount = amount;
    }
  }

  const normalizedRecoverability = u(recoverability || "FULL");
  if (!["FULL", "PARTIAL", "NONE"].includes(normalizedRecoverability)) {
    throw taxInvalidFormula(`Unsupported recoverability: ${normalizedRecoverability}`);
  }

  let parsedRecoverablePct = null;
  let recoverableTaxAmount = taxAmount;
  if (normalizedRecoverability === "NONE") {
    recoverableTaxAmount = 0;
  } else if (normalizedRecoverability === "PARTIAL") {
    parsedRecoverablePct = toAmount(recoverablePct, 4);
    if (
      parsedRecoverablePct === null ||
      !Number.isFinite(parsedRecoverablePct) ||
      parsedRecoverablePct < 0 ||
      parsedRecoverablePct > 100
    ) {
      throw taxInvalidFormula(
        "PARTIAL recoverability requires recoverablePct between 0 and 100"
      );
    }
    recoverableTaxAmount = Number(
      ((taxAmount * Number(parsedRecoverablePct)) / 100).toFixed(6)
    );
  }
  const nonRecoverableTaxAmount = Number((taxAmount - recoverableTaxAmount).toFixed(6));

  return {
    ratePct: toAmount(parsedRate, 4),
    calculationMode: normalizedMode,
    recoverability: normalizedRecoverability,
    recoverablePct: parsedRecoverablePct,
    netAmount: toAmount(netAmount),
    taxAmount: toAmount(taxAmount),
    grossAmount: toAmount(grossAmount),
    recoverableTaxAmount: toAmount(recoverableTaxAmount),
    nonRecoverableTaxAmount: toAmount(nonRecoverableTaxAmount),
  };
}

export async function resolveTaxAccounts({
  tenantId,
  legalEntityId,
  taxCodeId,
  taxRegimeId = null,
  taxPurposeCode = null,
  direction = "PURCHASE",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const parsedTaxCodeId = parsePositiveInt(taxCodeId);
  if (!parsedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!parsedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!parsedTaxCodeId) {
    throw badRequest("taxCodeId is required");
  }

  const codeResult = await runQuery(
    `SELECT tc.*
     FROM tax_codes tc
     WHERE tc.tenant_id = ?
       AND tc.id = ?
     LIMIT 1`,
    [parsedTenantId, parsedTaxCodeId]
  );
  const taxCodeRow = codeResult.rows?.[0] || null;
  if (!taxCodeRow || u(taxCodeRow.status) !== "ACTIVE") {
    throw conflict("Resolved tax code is missing or inactive", "TAX_CODE_NOT_ACTIVE");
  }

  const resolvedTaxRegimeId =
    parsePositiveInt(taxRegimeId) || parsePositiveInt(taxCodeRow.tax_regime_id);
  if (!resolvedTaxRegimeId) {
    throw conflict("Resolved tax regime is invalid", "TAX_REGIME_NOT_FOUND");
  }
  if (
    parsePositiveInt(taxRegimeId) &&
    parsePositiveInt(taxRegimeId) !== parsePositiveInt(taxCodeRow.tax_regime_id)
  ) {
    throw badRequest("taxCodeId does not belong to selected taxRegimeId");
  }

  const resolvedPurposeCode =
    u(taxPurposeCode) ||
    resolveDefaultTaxPurposeCode({
      taxKind: taxCodeRow.tax_kind,
      direction,
    });
  if (!resolvedPurposeCode) {
    throw badRequest(
      "taxPurposeCode is required for selected tax kind; auto-derivation supports VAT/WITHHOLDING only"
    );
  }

  const mappingResult = await runQuery(
    `SELECT
       tam.*,
       a.code AS account_code,
       a.name AS account_name,
       a.is_active AS account_is_active,
       a.allow_posting AS account_allow_posting,
       c.scope AS account_scope,
       c.legal_entity_id AS account_legal_entity_id
     FROM tax_account_mappings tam
     JOIN accounts a ON a.id = tam.account_id
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = tam.tenant_id
     WHERE tam.tenant_id = ?
       AND tam.tax_regime_id = ?
       AND tam.legal_entity_id = ?
       AND tam.tax_code_id = ?
       AND tam.tax_purpose_code = ?
       AND tam.status = 'ACTIVE'
     LIMIT 1`,
    [
      parsedTenantId,
      resolvedTaxRegimeId,
      parsedLegalEntityId,
      parsedTaxCodeId,
      resolvedPurposeCode,
    ]
  );
  const mappingRow = mappingResult.rows?.[0] || null;
  if (!mappingRow) {
    throw conflict(
      "Missing ACTIVE tax account mapping for legalEntity + taxCode + taxPurposeCode",
      "TAX_ACCOUNT_MAPPING_MISSING"
    );
  }
  if (!toDbBoolean(mappingRow.account_is_active)) {
    throw conflict(
      "Tax account mapping references inactive account",
      "TAX_ACCOUNT_MAPPING_MISSING"
    );
  }
  if (!toDbBoolean(mappingRow.account_allow_posting)) {
    throw conflict(
      "Tax account mapping references non-posting account",
      "TAX_ACCOUNT_MAPPING_MISSING"
    );
  }
  if (u(mappingRow.account_scope) !== "LEGAL_ENTITY") {
    throw conflict(
      "Tax account mapping references non-LEGAL_ENTITY account scope",
      "TAX_ACCOUNT_MAPPING_MISSING"
    );
  }
  if (
    parsePositiveInt(mappingRow.account_legal_entity_id) !== parsedLegalEntityId
  ) {
    throw conflict(
      "Tax account mapping account scope legal entity mismatch",
      "TAX_ACCOUNT_MAPPING_MISSING"
    );
  }

  return {
    taxCodeRow,
    mappingRow,
    taxPurposeCode: resolvedPurposeCode,
  };
}

export function buildTaxJournalLines({
  breakdown,
  taxCode,
  taxPurposeCode,
  mappingRow,
  direction = "PURCHASE",
  currencyCode = null,
}) {
  const normalizedDirection = u(direction || "PURCHASE");
  const taxAmount = Number(breakdown?.taxAmount || 0);
  if (!Number.isFinite(taxAmount) || taxAmount < 0) {
    throw taxInvalidFormula("taxAmount must be a valid non-negative number");
  }

  const lineAmount = Number(taxAmount.toFixed(6));
  return [
    {
      accountId: parsePositiveInt(mappingRow?.account_id),
      accountCode: mappingRow?.account_code || null,
      accountName: mappingRow?.account_name || null,
      taxCode: String(taxCode || ""),
      taxPurposeCode: u(taxPurposeCode),
      currencyCode: currencyCode || null,
      amountTxn:
        normalizedDirection === "SALE"
          ? Number((lineAmount * -1).toFixed(6))
          : lineAmount,
      debitBase: normalizedDirection === "SALE" ? 0 : lineAmount,
      creditBase: normalizedDirection === "SALE" ? lineAmount : 0,
      description:
        normalizedDirection === "SALE"
          ? `Tax line (${taxCode}) output`
          : `Tax line (${taxCode}) input`,
    },
  ];
}

export default {
  resolveTaxRegime,
  resolveTaxCodeAndRule,
  computeTaxBreakdown,
  resolveTaxAccounts,
  buildTaxJournalLines,
};
