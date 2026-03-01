
import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertCountryExists,
  assertCurrencyExists,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
function u(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function toDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}
function toDateOnly(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  const dateOnlyMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}
function toAmount(value, scale = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Number(parsed.toFixed(scale));
}
function safeParseJson(value) {
  if (value === null || value === undefined) {
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
function forbidden(message, code = "") {
  const err = new Error(message);
  err.status = 403;
  if (code) {
    err.code = code;
  }
  return err;
}
function isDuplicateKeyError(err) {
  return Number(err?.errno) === 1062 || u(err?.code) === "ER_DUP_ENTRY";
}
function assertTenantWideScope(req, label = "tenant-wide scope") {
  const isTenantWide = Boolean(req?.rbac?.scopeContext?.tenantWide);
  if (!isTenantWide) {
    throw forbidden(`Data scope denied: ${label}`);
  }
}
function assertLegalEntityWriteScope(req, legalEntityId, assertScopeAccess, label) {
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (parsedLegalEntityId) {
    assertScopeAccess(req, "legal_entity", parsedLegalEntityId, label || "legalEntityId");
    return;
  }
  assertTenantWideScope(req, label || "tenant fallback scope");
}
function canReadLegalEntityScopedRow(req, row, assertScopeAccess, key = "legal_entity_id") {
  const legalEntityId = parsePositiveInt(row?.[key]);
  if (legalEntityId) {
    try {
      assertScopeAccess(req, "legal_entity", legalEntityId, key);
      return true;
    } catch (err) {
      if (Number(err?.status) === 403) {
        return false;
      }
      throw err;
    }
  }
  return Boolean(req?.rbac?.scopeContext?.tenantWide);
}
function mapTaxRegimeRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    countryId: parsePositiveInt(row.country_id),
    countryIso2: row.country_iso2 || null,
    countryIso3: row.country_iso3 || null,
    countryName: row.country_name || null,
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    code: String(row.code || ""),
    name: String(row.name || ""),
    currencyCode: String(row.currency_code || ""),
    effectiveFrom: toDateOnly(row.effective_from),
    effectiveTo: toDateOnly(row.effective_to),
    status: u(row.status),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdByUserName: row.created_by_user_name || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
function mapTaxCodeRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    regimeId: parsePositiveInt(row.tax_regime_id),
    regimeCode: row.regime_code || null,
    regimeName: row.regime_name || null,
    regimeLegalEntityId: parsePositiveInt(row.regime_legal_entity_id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    taxKind: u(row.tax_kind),
    ratePct: toAmount(row.rate_pct, 4),
    calculationMode: u(row.calculation_mode),
    recoverability: u(row.recoverability),
    isReverseCharge: toDbBoolean(row.is_reverse_charge),
    status: u(row.status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
function mapTaxRuleRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    regimeId: parsePositiveInt(row.tax_regime_id),
    regimeCode: row.regime_code || null,
    regimeName: row.regime_name || null,
    regimeLegalEntityId: parsePositiveInt(row.regime_legal_entity_id),
    taxCodeId: parsePositiveInt(row.tax_code_id),
    taxCode: row.tax_code || null,
    taxCodeName: row.tax_code_name || null,
    moduleCode: u(row.module_code),
    documentType: row.document_type || null,
    counterpartyType: row.counterparty_type ? u(row.counterparty_type) : null,
    applyPriority: Number(row.apply_priority || 0),
    formulaJson: safeParseJson(row.formula_json),
    status: u(row.status),
    effectiveFrom: toDateOnly(row.effective_from),
    effectiveTo: toDateOnly(row.effective_to),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
function mapTaxAccountMappingRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    regimeId: parsePositiveInt(row.tax_regime_id),
    regimeCode: row.regime_code || null,
    regimeName: row.regime_name || null,
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    taxCodeId: parsePositiveInt(row.tax_code_id),
    taxCode: row.tax_code || null,
    taxCodeName: row.tax_code_name || null,
    taxPurposeCode: u(row.tax_purpose_code),
    accountId: parsePositiveInt(row.account_id),
    accountCode: row.account_code || null,
    accountName: row.account_name || null,
    status: u(row.status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
async function getTaxRegimeRowById({ tenantId, regimeId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       tr.*,
       c.iso2 AS country_iso2,
       c.iso3 AS country_iso3,
       c.name AS country_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       u.name AS created_by_user_name
     FROM tax_regimes tr
     LEFT JOIN countries c ON c.id = tr.country_id
     LEFT JOIN legal_entities le
       ON le.id = tr.legal_entity_id
      AND le.tenant_id = tr.tenant_id
     LEFT JOIN users u ON u.id = tr.created_by_user_id
     WHERE tr.tenant_id = ?
       AND tr.id = ?
     LIMIT 1`,
    [tenantId, regimeId]
  );
  return result.rows?.[0] || null;
}
async function getTaxCodeRowById({ tenantId, codeId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       tc.*,
       tr.code AS regime_code,
       tr.name AS regime_name,
       tr.legal_entity_id AS regime_legal_entity_id
     FROM tax_codes tc
     JOIN tax_regimes tr
       ON tr.id = tc.tax_regime_id
      AND tr.tenant_id = tc.tenant_id
     WHERE tc.tenant_id = ?
       AND tc.id = ?
     LIMIT 1`,
    [tenantId, codeId]
  );
  return result.rows?.[0] || null;
}
async function getTaxRuleRowById({ tenantId, ruleId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       trs.*,
       tr.code AS regime_code,
       tr.name AS regime_name,
       tr.legal_entity_id AS regime_legal_entity_id,
       tc.code AS tax_code,
       tc.name AS tax_code_name
     FROM tax_rule_sets trs
     JOIN tax_regimes tr
       ON tr.id = trs.tax_regime_id
      AND tr.tenant_id = trs.tenant_id
     JOIN tax_codes tc
       ON tc.id = trs.tax_code_id
      AND tc.tenant_id = trs.tenant_id
     WHERE trs.tenant_id = ?
       AND trs.id = ?
     LIMIT 1`,
    [tenantId, ruleId]
  );
  return result.rows?.[0] || null;
}
async function getTaxAccountMappingRowById({
  tenantId,
  mappingId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       tam.*,
       tr.code AS regime_code,
       tr.name AS regime_name,
       tc.code AS tax_code,
       tc.name AS tax_code_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       a.code AS account_code,
       a.name AS account_name
     FROM tax_account_mappings tam
     JOIN tax_regimes tr
       ON tr.id = tam.tax_regime_id
      AND tr.tenant_id = tam.tenant_id
     JOIN tax_codes tc
       ON tc.id = tam.tax_code_id
      AND tc.tenant_id = tam.tenant_id
     JOIN legal_entities le
       ON le.id = tam.legal_entity_id
      AND le.tenant_id = tam.tenant_id
     JOIN accounts a ON a.id = tam.account_id
     WHERE tam.tenant_id = ?
       AND tam.id = ?
     LIMIT 1`,
    [tenantId, mappingId]
  );
  return result.rows?.[0] || null;
}
async function assertTaxRegimeExists(tenantId, regimeId, runQuery = query) {
  const row = await getTaxRegimeRowById({ tenantId, regimeId, runQuery });
  if (!row) {
    throw notFound("Tax regime not found", "TAX_REGIME_NOT_FOUND");
  }
  return row;
}
async function assertTaxCodeExists(tenantId, codeId, runQuery = query) {
  const row = await getTaxCodeRowById({ tenantId, codeId, runQuery });
  if (!row) {
    throw notFound("Tax code not found");
  }
  return row;
}
async function assertTaxCodeInRegime(tenantId, codeId, regimeId, runQuery = query) {
  const row = await assertTaxCodeExists(tenantId, codeId, runQuery);
  if (parsePositiveInt(row.tax_regime_id) !== parsePositiveInt(regimeId)) {
    throw badRequest("taxCodeId must belong to selected regimeId");
  }
  return row;
}
async function assertAccountEligibleForTaxMapping({
  tenantId,
  legalEntityId,
  accountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.is_active,
       a.allow_posting,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND a.id = ?
     LIMIT 1`,
    [tenantId, accountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("accountId not found for tenant");
  }
  if (!toDbBoolean(row.is_active)) {
    throw badRequest("accountId must reference an active account");
  }
  if (!toDbBoolean(row.allow_posting)) {
    throw badRequest("accountId must reference a posting account");
  }
  if (u(row.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest("accountId must belong to LEGAL_ENTITY scope");
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("accountId must belong to selected legalEntityId");
  }
  return row;
}
function normalizeFormulaOrThrow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("formulaJson must be a JSON object");
  }
  return value;
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
function resolveComputationConfigFromFormula({
  taxCodeRow,
  taxRuleRow,
  previewInput,
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
    previewInput?.calculationMode ||
      formula.calculationMode ||
      taxCodeRow?.calculation_mode
  );
  if (!["EXCLUSIVE", "INCLUSIVE"].includes(calculationMode)) {
    throw taxInvalidFormula(`Unsupported calculationMode: ${calculationMode}`);
  }
  const recoverability = u(
    previewInput?.recoverability || formula.recoverability || taxCodeRow?.recoverability
  );
  if (!["FULL", "PARTIAL", "NONE"].includes(recoverability)) {
    throw taxInvalidFormula(`Unsupported recoverability: ${recoverability}`);
  }
  let recoverablePct = null;
  if (recoverability === "PARTIAL") {
    const explicitRecoverablePct =
      previewInput?.recoverablePct ?? formula.recoverablePct ?? null;
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
function computeTaxBreakdown({
  baseAmount,
  ratePct,
  calculationMode,
  recoverability,
  recoverablePct = null,
}) {
  const amount = Number(baseAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw taxInvalidFormula("baseAmount must be > 0");
  }
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
    throw taxInvalidFormula("ratePct must be between 0 and 100");
  }
  const rateFraction = Number((ratePct / 100).toFixed(8));
  let netAmount = 0;
  let taxAmount = 0;
  let grossAmount = 0;
  if (u(calculationMode) === "EXCLUSIVE") {
    netAmount = amount;
    taxAmount = Number((amount * rateFraction).toFixed(6));
    grossAmount = Number((netAmount + taxAmount).toFixed(6));
  } else if (u(calculationMode) === "INCLUSIVE") {
    if (rateFraction <= 0) {
      throw taxInvalidFormula("INCLUSIVE calculation requires a positive ratePct");
    }
    netAmount = Number((amount / (1 + rateFraction)).toFixed(6));
    taxAmount = Number((amount - netAmount).toFixed(6));
    grossAmount = amount;
  } else {
    throw taxInvalidFormula(`Unsupported calculationMode: ${calculationMode}`);
  }
  let recoverableTaxAmount = taxAmount;
  if (u(recoverability) === "NONE") {
    recoverableTaxAmount = 0;
  } else if (u(recoverability) === "PARTIAL") {
    recoverableTaxAmount = Number(((taxAmount * Number(recoverablePct || 0)) / 100).toFixed(6));
  }
  const nonRecoverableTaxAmount = Number((taxAmount - recoverableTaxAmount).toFixed(6));
  return {
    ratePct: toAmount(ratePct, 4),
    calculationMode: u(calculationMode),
    recoverability: u(recoverability),
    recoverablePct: recoverablePct === null ? null : toAmount(recoverablePct, 4),
    netAmount: toAmount(netAmount),
    taxAmount: toAmount(taxAmount),
    grossAmount: toAmount(grossAmount),
    recoverableTaxAmount: toAmount(recoverableTaxAmount),
    nonRecoverableTaxAmount: toAmount(nonRecoverableTaxAmount),
  };
}
async function resolvePreviewRegime({
  tenantId,
  countryId,
  legalEntityId,
  postingDate,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       tr.*,
       c.iso2 AS country_iso2,
       c.iso3 AS country_iso3,
       c.name AS country_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name
     FROM tax_regimes tr
     LEFT JOIN countries c ON c.id = tr.country_id
     LEFT JOIN legal_entities le
       ON le.id = tr.legal_entity_id
      AND le.tenant_id = tr.tenant_id
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
    [tenantId, countryId, postingDate, postingDate, legalEntityId, legalEntityId]
  );
  return result.rows?.[0] || null;
}
async function resolvePreviewTaxCode({
  tenantId,
  regimeId,
  taxCodeId,
  taxCode,
  runQuery = query,
}) {
  if (!taxCodeId && !taxCode) {
    return null;
  }
  const conditions = ["tc.tenant_id = ?", "tc.tax_regime_id = ?"];
  const params = [tenantId, regimeId];
  if (taxCodeId) {
    conditions.push("tc.id = ?");
    params.push(taxCodeId);
  }
  if (taxCode) {
    conditions.push("tc.code = ?");
    params.push(u(taxCode));
  }
  const result = await runQuery(
    `SELECT tc.*, tr.legal_entity_id AS regime_legal_entity_id
     FROM tax_codes tc
     JOIN tax_regimes tr
       ON tr.id = tc.tax_regime_id
      AND tr.tenant_id = tc.tenant_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY tc.id DESC
     LIMIT 1`,
    params
  );
  return result.rows?.[0] || null;
}
async function resolvePreviewRule({
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
async function resolvePreviewMapping({
  tenantId,
  regimeId,
  legalEntityId,
  taxCodeId,
  taxPurposeCode,
  runQuery = query,
}) {
  const result = await runQuery(
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
    [tenantId, regimeId, legalEntityId, taxCodeId, u(taxPurposeCode)]
  );
  return result.rows?.[0] || null;
}
async function getTaxRuleByIdForRead(tenantId, ruleId, runQuery = query) {
  const row = await getTaxRuleRowById({ tenantId, ruleId, runQuery });
  if (!row) {
    throw notFound("Tax rule not found");
  }
  return row;
}
export async function resolveTaxRegimeScope(regimeId, tenantId, runQuery = query) {
  const parsedRegimeId = parsePositiveInt(regimeId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedRegimeId || !parsedTenantId) {
    return null;
  }
  const row = await getTaxRegimeRowById({
    tenantId: parsedTenantId,
    regimeId: parsedRegimeId,
    runQuery,
  });
  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}
export async function resolveTaxCodeScope(codeId, tenantId, runQuery = query) {
  const parsedCodeId = parsePositiveInt(codeId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedCodeId || !parsedTenantId) {
    return null;
  }
  const row = await getTaxCodeRowById({
    tenantId: parsedTenantId,
    codeId: parsedCodeId,
    runQuery,
  });
  const legalEntityId = parsePositiveInt(row?.regime_legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}
export async function resolveTaxRuleScope(ruleId, tenantId, runQuery = query) {
  const parsedRuleId = parsePositiveInt(ruleId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedRuleId || !parsedTenantId) {
    return null;
  }
  const row = await getTaxRuleRowById({
    tenantId: parsedTenantId,
    ruleId: parsedRuleId,
    runQuery,
  });
  const legalEntityId = parsePositiveInt(row?.regime_legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}
export async function resolveTaxAccountMappingScope(mappingId, tenantId, runQuery = query) {
  const parsedMappingId = parsePositiveInt(mappingId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedMappingId || !parsedTenantId) {
    return null;
  }
  const row = await getTaxAccountMappingRowById({
    tenantId: parsedTenantId,
    mappingId: parsedMappingId,
    runQuery,
  });
  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}
export async function listTaxRegimes({
  req,
  tenantId,
  filters,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (filters?.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
  }
  const where = ["tr.tenant_id = ?"];
  const params = [normalizedTenantId];
  if (filters?.countryId) {
    where.push("tr.country_id = ?");
    params.push(parsePositiveInt(filters.countryId));
  }
  if (filters?.legalEntityId) {
    where.push("tr.legal_entity_id = ?");
    params.push(parsePositiveInt(filters.legalEntityId));
  }
  if (filters?.status) {
    where.push("tr.status = ?");
    params.push(u(filters.status));
  }
  if (filters?.q) {
    const wildcard = `%${filters.q}%`;
    where.push("(tr.code LIKE ? OR tr.name LIKE ?)");
    params.push(wildcard, wildcard);
  }
  const result = await runQuery(
    `SELECT
       tr.*,
       c.iso2 AS country_iso2,
       c.iso3 AS country_iso3,
       c.name AS country_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       u.name AS created_by_user_name
     FROM tax_regimes tr
     LEFT JOIN countries c ON c.id = tr.country_id
     LEFT JOIN legal_entities le
       ON le.id = tr.legal_entity_id
      AND le.tenant_id = tr.tenant_id
     LEFT JOIN users u ON u.id = tr.created_by_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY tr.country_id ASC, tr.code ASC, tr.effective_from DESC, tr.id DESC`,
    params
  );
  const scopedRows = (result.rows || []).filter((row) =>
    canReadLegalEntityScopedRow(req, row, assertScopeAccess, "legal_entity_id")
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;
  return {
    rows: scopedRows.slice(safeOffset, safeOffset + safeLimit).map(mapTaxRegimeRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}
export async function createTaxRegime({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const userId = parsePositiveInt(input?.userId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }
  assertLegalEntityWriteScope(req, input.legalEntityId, assertScopeAccess, "legalEntityId");
  const country = await assertCountryExists(input.countryId, "countryId");
  await assertCurrencyExists(input.currencyCode, "currencyCode");
  let legalEntity = null;
  if (parsePositiveInt(input.legalEntityId)) {
    legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      input.legalEntityId,
      "legalEntityId"
    );
    if (parsePositiveInt(legalEntity.country_id) !== parsePositiveInt(country.id)) {
      throw badRequest(
        "legalEntityId country does not match countryId; create regime in matching country scope"
      );
    }
  }
  try {
    const insertResult = await runQuery(
      `INSERT INTO tax_regimes (
         tenant_id,
         country_id,
         legal_entity_id,
         code,
         name,
         currency_code,
         effective_from,
         effective_to,
         status,
         created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        parsePositiveInt(country.id),
        parsePositiveInt(legalEntity?.id) || null,
        u(input.code),
        String(input.name || "").trim(),
        u(input.currencyCode),
        input.effectiveFrom,
        input.effectiveTo || null,
        u(input.status || "ACTIVE"),
        userId,
      ]
    );
    const regimeId = parsePositiveInt(insertResult.rows?.insertId);
    const row = await getTaxRegimeRowById({ tenantId, regimeId, runQuery });
    return mapTaxRegimeRow(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict(
        "Regime code already exists for tenant with same effective_from",
        "TAX_REGIME_DUPLICATE"
      );
    }
    throw err;
  }
}
export async function updateTaxRegime({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const regimeId = parsePositiveInt(input?.regimeId);
  if (!tenantId || !regimeId) {
    throw badRequest("tenantId and regimeId are required");
  }
  const existing = await assertTaxRegimeExists(tenantId, regimeId, runQuery);
  assertLegalEntityWriteScope(
    req,
    existing.legal_entity_id,
    assertScopeAccess,
    "existing regime scope"
  );
  const next = {
    countryId:
      input.countryId !== undefined
        ? parsePositiveInt(input.countryId)
        : parsePositiveInt(existing.country_id),
    legalEntityId:
      input.legalEntityId !== undefined
        ? parsePositiveInt(input.legalEntityId) || null
        : parsePositiveInt(existing.legal_entity_id) || null,
    code: input.code !== undefined ? u(input.code) : u(existing.code),
    name:
      input.name !== undefined
        ? String(input.name || "").trim()
        : String(existing.name || "").trim(),
    currencyCode:
      input.currencyCode !== undefined
        ? u(input.currencyCode)
        : u(existing.currency_code),
    effectiveFrom:
      input.effectiveFrom !== undefined
        ? input.effectiveFrom
        : toDateOnly(existing.effective_from),
    effectiveTo:
      input.effectiveTo !== undefined ? input.effectiveTo : toDateOnly(existing.effective_to),
    status: input.status !== undefined ? u(input.status) : u(existing.status),
  };
  if (next.effectiveFrom && next.effectiveTo && next.effectiveTo < next.effectiveFrom) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }
  assertLegalEntityWriteScope(req, next.legalEntityId, assertScopeAccess, "legalEntityId");
  const country = await assertCountryExists(next.countryId, "countryId");
  await assertCurrencyExists(next.currencyCode, "currencyCode");
  if (next.legalEntityId) {
    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      next.legalEntityId,
      "legalEntityId"
    );
    if (parsePositiveInt(legalEntity.country_id) !== parsePositiveInt(country.id)) {
      throw badRequest(
        "legalEntityId country does not match countryId; set matching scope for regime"
      );
    }
  }
  try {
    await runQuery(
      `UPDATE tax_regimes
       SET country_id = ?,
           legal_entity_id = ?,
           code = ?,
           name = ?,
           currency_code = ?,
           effective_from = ?,
           effective_to = ?,
           status = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        next.countryId,
        next.legalEntityId,
        next.code,
        next.name,
        next.currencyCode,
        next.effectiveFrom,
        next.effectiveTo,
        next.status,
        tenantId,
        regimeId,
      ]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict(
        "Regime code already exists for tenant with same effective_from",
        "TAX_REGIME_DUPLICATE"
      );
    }
    throw err;
  }
  const updated = await getTaxRegimeRowById({ tenantId, regimeId, runQuery });
  return mapTaxRegimeRow(updated);
}
export async function listTaxCodes({
  req,
  tenantId,
  filters,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (filters?.regimeId) {
    const regime = await assertTaxRegimeExists(
      normalizedTenantId,
      filters.regimeId,
      runQuery
    );
    assertLegalEntityWriteScope(req, regime.legal_entity_id, assertScopeAccess, "regimeId");
  }
  const where = ["tc.tenant_id = ?"];
  const params = [normalizedTenantId];
  if (filters?.regimeId) {
    where.push("tc.tax_regime_id = ?");
    params.push(parsePositiveInt(filters.regimeId));
  }
  if (filters?.status) {
    where.push("tc.status = ?");
    params.push(u(filters.status));
  }
  if (filters?.taxKind) {
    where.push("tc.tax_kind = ?");
    params.push(u(filters.taxKind));
  }
  if (filters?.q) {
    const wildcard = `%${filters.q}%`;
    where.push("(tc.code LIKE ? OR tc.name LIKE ?)");
    params.push(wildcard, wildcard);
  }
  const result = await runQuery(
    `SELECT
       tc.*,
       tr.code AS regime_code,
       tr.name AS regime_name,
       tr.legal_entity_id AS regime_legal_entity_id
     FROM tax_codes tc
     JOIN tax_regimes tr
       ON tr.id = tc.tax_regime_id
      AND tr.tenant_id = tc.tenant_id
     WHERE ${where.join(" AND ")}
     ORDER BY tc.tax_regime_id ASC, tc.code ASC, tc.id DESC`,
    params
  );
  const scopedRows = (result.rows || []).filter((row) =>
    canReadLegalEntityScopedRow(req, row, assertScopeAccess, "regime_legal_entity_id")
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;
  return {
    rows: scopedRows.slice(safeOffset, safeOffset + safeLimit).map(mapTaxCodeRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}
export async function createTaxCode({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const regime = await assertTaxRegimeExists(tenantId, input.regimeId, runQuery);
  assertLegalEntityWriteScope(req, regime.legal_entity_id, assertScopeAccess, "regimeId");
  try {
    const insertResult = await runQuery(
      `INSERT INTO tax_codes (
         tenant_id,
         tax_regime_id,
         code,
         name,
         tax_kind,
         rate_pct,
         calculation_mode,
         recoverability,
         is_reverse_charge,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        parsePositiveInt(input.regimeId),
        u(input.code),
        String(input.name || "").trim(),
        u(input.taxKind),
        toAmount(input.ratePct, 4),
        u(input.calculationMode),
        u(input.recoverability),
        input.isReverseCharge ? 1 : 0,
        u(input.status || "ACTIVE"),
      ]
    );
    const codeId = parsePositiveInt(insertResult.rows?.insertId);
    const row = await getTaxCodeRowById({ tenantId, codeId, runQuery });
    return mapTaxCodeRow(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict("Tax code already exists in regime", "TAX_CODE_DUPLICATE");
    }
    throw err;
  }
}
export async function updateTaxCode({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const codeId = parsePositiveInt(input?.codeId);
  if (!tenantId || !codeId) {
    throw badRequest("tenantId and codeId are required");
  }
  const existing = await assertTaxCodeExists(tenantId, codeId, runQuery);
  assertLegalEntityWriteScope(
    req,
    existing.regime_legal_entity_id,
    assertScopeAccess,
    "existing regime scope"
  );
  const nextRegimeId =
    input.regimeId !== undefined
      ? parsePositiveInt(input.regimeId)
      : parsePositiveInt(existing.tax_regime_id);
  const nextRegime = await assertTaxRegimeExists(tenantId, nextRegimeId, runQuery);
  assertLegalEntityWriteScope(req, nextRegime.legal_entity_id, assertScopeAccess, "regimeId");
  const next = {
    regimeId: nextRegimeId,
    code: input.code !== undefined ? u(input.code) : u(existing.code),
    name:
      input.name !== undefined
        ? String(input.name || "").trim()
        : String(existing.name || "").trim(),
    taxKind: input.taxKind !== undefined ? u(input.taxKind) : u(existing.tax_kind),
    ratePct:
      input.ratePct !== undefined ? toAmount(input.ratePct, 4) : toAmount(existing.rate_pct, 4),
    calculationMode:
      input.calculationMode !== undefined
        ? u(input.calculationMode)
        : u(existing.calculation_mode),
    recoverability:
      input.recoverability !== undefined
        ? u(input.recoverability)
        : u(existing.recoverability),
    isReverseCharge:
      input.isReverseCharge !== undefined
        ? Boolean(input.isReverseCharge)
        : toDbBoolean(existing.is_reverse_charge),
    status: input.status !== undefined ? u(input.status) : u(existing.status),
  };
  try {
    await runQuery(
      `UPDATE tax_codes
       SET tax_regime_id = ?,
           code = ?,
           name = ?,
           tax_kind = ?,
           rate_pct = ?,
           calculation_mode = ?,
           recoverability = ?,
           is_reverse_charge = ?,
           status = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        next.regimeId,
        next.code,
        next.name,
        next.taxKind,
        next.ratePct,
        next.calculationMode,
        next.recoverability,
        next.isReverseCharge ? 1 : 0,
        next.status,
        tenantId,
        codeId,
      ]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict("Tax code already exists in regime", "TAX_CODE_DUPLICATE");
    }
    throw err;
  }
  const updated = await getTaxCodeRowById({ tenantId, codeId, runQuery });
  return mapTaxCodeRow(updated);
}
export async function listTaxRules({
  req,
  tenantId,
  filters,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (filters?.regimeId) {
    const regime = await assertTaxRegimeExists(normalizedTenantId, filters.regimeId, runQuery);
    assertLegalEntityWriteScope(req, regime.legal_entity_id, assertScopeAccess, "regimeId");
  }
  const where = ["trs.tenant_id = ?"];
  const params = [normalizedTenantId];
  if (filters?.regimeId) {
    where.push("trs.tax_regime_id = ?");
    params.push(parsePositiveInt(filters.regimeId));
  }
  if (filters?.taxCodeId) {
    where.push("trs.tax_code_id = ?");
    params.push(parsePositiveInt(filters.taxCodeId));
  }
  if (filters?.moduleCode) {
    where.push("trs.module_code = ?");
    params.push(u(filters.moduleCode));
  }
  if (filters?.status) {
    where.push("trs.status = ?");
    params.push(u(filters.status));
  }
  if (filters?.q) {
    const wildcard = `%${filters.q}%`;
    where.push("(tc.code LIKE ? OR tc.name LIKE ? OR trs.document_type LIKE ?)");
    params.push(wildcard, wildcard, wildcard);
  }
  const result = await runQuery(
    `SELECT
       trs.*,
       tr.code AS regime_code,
       tr.name AS regime_name,
       tr.legal_entity_id AS regime_legal_entity_id,
       tc.code AS tax_code,
       tc.name AS tax_code_name
     FROM tax_rule_sets trs
     JOIN tax_regimes tr
       ON tr.id = trs.tax_regime_id
      AND tr.tenant_id = trs.tenant_id
     JOIN tax_codes tc
       ON tc.id = trs.tax_code_id
      AND tc.tenant_id = trs.tenant_id
     WHERE ${where.join(" AND ")}
     ORDER BY trs.tax_regime_id ASC, trs.module_code ASC, trs.apply_priority ASC, trs.id DESC`,
    params
  );
  const scopedRows = (result.rows || []).filter((row) =>
    canReadLegalEntityScopedRow(req, row, assertScopeAccess, "regime_legal_entity_id")
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;
  return {
    rows: scopedRows.slice(safeOffset, safeOffset + safeLimit).map(mapTaxRuleRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}
export async function createTaxRule({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const regime = await assertTaxRegimeExists(tenantId, input.regimeId, runQuery);
  assertLegalEntityWriteScope(req, regime.legal_entity_id, assertScopeAccess, "regimeId");
  await assertTaxCodeInRegime(tenantId, input.taxCodeId, input.regimeId, runQuery);
  const formula = normalizeFormulaOrThrow(input.formulaJson);
  const formulaText = JSON.stringify(formula);
  const insertResult = await runQuery(
    `INSERT INTO tax_rule_sets (
       tenant_id,
       tax_regime_id,
       tax_code_id,
       module_code,
       document_type,
       counterparty_type,
       apply_priority,
       formula_json,
       status,
       effective_from,
       effective_to
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [
      tenantId,
      parsePositiveInt(input.regimeId),
      parsePositiveInt(input.taxCodeId),
      u(input.moduleCode),
      input.documentType || null,
      input.counterpartyType || null,
      Number(input.applyPriority || 100),
      formulaText,
      u(input.status || "ACTIVE"),
      input.effectiveFrom,
      input.effectiveTo || null,
    ]
  );
  const ruleId = parsePositiveInt(insertResult.rows?.insertId);
  const row = await getTaxRuleRowById({ tenantId, ruleId, runQuery });
  return mapTaxRuleRow(row);
}
export async function updateTaxRule({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const ruleId = parsePositiveInt(input?.ruleId);
  if (!tenantId || !ruleId) {
    throw badRequest("tenantId and ruleId are required");
  }
  const existing = await getTaxRuleByIdForRead(tenantId, ruleId, runQuery);
  assertLegalEntityWriteScope(
    req,
    existing.regime_legal_entity_id,
    assertScopeAccess,
    "existing regime scope"
  );
  const nextRegimeId =
    input.regimeId !== undefined
      ? parsePositiveInt(input.regimeId)
      : parsePositiveInt(existing.tax_regime_id);
  const nextRegime = await assertTaxRegimeExists(tenantId, nextRegimeId, runQuery);
  assertLegalEntityWriteScope(req, nextRegime.legal_entity_id, assertScopeAccess, "regimeId");
  const nextTaxCodeId =
    input.taxCodeId !== undefined
      ? parsePositiveInt(input.taxCodeId)
      : parsePositiveInt(existing.tax_code_id);
  await assertTaxCodeInRegime(tenantId, nextTaxCodeId, nextRegimeId, runQuery);
  const nextFormula =
    input.formulaJson !== undefined ? normalizeFormulaOrThrow(input.formulaJson) : null;
  const existingFormula = safeParseJson(existing.formula_json);
  if (!nextFormula && (!existingFormula || typeof existingFormula !== "object")) {
    throw badRequest("formulaJson must be a JSON object");
  }
  const next = {
    regimeId: nextRegimeId,
    taxCodeId: nextTaxCodeId,
    moduleCode:
      input.moduleCode !== undefined ? u(input.moduleCode) : u(existing.module_code),
    documentType:
      input.documentType !== undefined
        ? input.documentType || null
        : existing.document_type || null,
    counterpartyType:
      input.counterpartyType !== undefined
        ? input.counterpartyType || null
        : existing.counterparty_type || null,
    applyPriority:
      input.applyPriority !== undefined
        ? Number(input.applyPriority)
        : Number(existing.apply_priority || 100),
    formulaJson: JSON.stringify(nextFormula || existingFormula),
    status: input.status !== undefined ? u(input.status) : u(existing.status),
    effectiveFrom:
      input.effectiveFrom !== undefined
        ? input.effectiveFrom
        : toDateOnly(existing.effective_from),
    effectiveTo:
      input.effectiveTo !== undefined ? input.effectiveTo : toDateOnly(existing.effective_to),
  };
  if (next.effectiveFrom && next.effectiveTo && next.effectiveTo < next.effectiveFrom) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }
  await runQuery(
    `UPDATE tax_rule_sets
     SET tax_regime_id = ?,
         tax_code_id = ?,
         module_code = ?,
         document_type = ?,
         counterparty_type = ?,
         apply_priority = ?,
         formula_json = CAST(? AS JSON),
         status = ?,
         effective_from = ?,
         effective_to = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [
      next.regimeId,
      next.taxCodeId,
      next.moduleCode,
      next.documentType,
      next.counterpartyType,
      next.applyPriority,
      next.formulaJson,
      next.status,
      next.effectiveFrom,
      next.effectiveTo,
      tenantId,
      ruleId,
    ]
  );
  const updated = await getTaxRuleRowById({ tenantId, ruleId, runQuery });
  return mapTaxRuleRow(updated);
}
export async function listTaxAccountMappings({
  req,
  tenantId,
  filters,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (filters?.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
  }
  if (filters?.regimeId) {
    const regime = await assertTaxRegimeExists(normalizedTenantId, filters.regimeId, runQuery);
    assertLegalEntityWriteScope(req, regime.legal_entity_id, assertScopeAccess, "regimeId");
  }
  const where = ["tam.tenant_id = ?"];
  const params = [normalizedTenantId];
  if (filters?.regimeId) {
    where.push("tam.tax_regime_id = ?");
    params.push(parsePositiveInt(filters.regimeId));
  }
  if (filters?.legalEntityId) {
    where.push("tam.legal_entity_id = ?");
    params.push(parsePositiveInt(filters.legalEntityId));
  }
  if (filters?.taxCodeId) {
    where.push("tam.tax_code_id = ?");
    params.push(parsePositiveInt(filters.taxCodeId));
  }
  if (filters?.taxPurposeCode) {
    where.push("tam.tax_purpose_code = ?");
    params.push(u(filters.taxPurposeCode));
  }
  if (filters?.status) {
    where.push("tam.status = ?");
    params.push(u(filters.status));
  }
  if (filters?.q) {
    const wildcard = `%${filters.q}%`;
    where.push(
      "(tc.code LIKE ? OR tc.name LIKE ? OR a.code LIKE ? OR a.name LIKE ? OR tam.tax_purpose_code LIKE ?)"
    );
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard);
  }
  const result = await runQuery(
    `SELECT
       tam.*,
       tr.code AS regime_code,
       tr.name AS regime_name,
       tc.code AS tax_code,
       tc.name AS tax_code_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       a.code AS account_code,
       a.name AS account_name
     FROM tax_account_mappings tam
     JOIN tax_regimes tr
       ON tr.id = tam.tax_regime_id
      AND tr.tenant_id = tam.tenant_id
     JOIN tax_codes tc
       ON tc.id = tam.tax_code_id
      AND tc.tenant_id = tam.tenant_id
     JOIN legal_entities le
       ON le.id = tam.legal_entity_id
      AND le.tenant_id = tam.tenant_id
     JOIN accounts a ON a.id = tam.account_id
     WHERE ${where.join(" AND ")}
     ORDER BY tam.legal_entity_id ASC, tam.tax_code_id ASC, tam.tax_purpose_code ASC, tam.id DESC`,
    params
  );
  const scopedRows = (result.rows || []).filter((row) =>
    canReadLegalEntityScopedRow(req, row, assertScopeAccess, "legal_entity_id")
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;
  return {
    rows: scopedRows.slice(safeOffset, safeOffset + safeLimit).map(mapTaxAccountMappingRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}
export async function createTaxAccountMapping({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  assertScopeAccess(req, "legal_entity", input.legalEntityId, "legalEntityId");
  const regime = await assertTaxRegimeExists(tenantId, input.regimeId, runQuery);
  const regimeLegalEntityId = parsePositiveInt(regime.legal_entity_id);
  if (regimeLegalEntityId && regimeLegalEntityId !== parsePositiveInt(input.legalEntityId)) {
    throw badRequest("regimeId is legal-entity scoped; mapping legalEntityId must match regime");
  }
  await assertLegalEntityBelongsToTenant(tenantId, input.legalEntityId, "legalEntityId");
  await assertTaxCodeInRegime(tenantId, input.taxCodeId, input.regimeId, runQuery);
  await assertAccountEligibleForTaxMapping({
    tenantId,
    legalEntityId: input.legalEntityId,
    accountId: input.accountId,
    runQuery,
  });
  try {
    const insertResult = await runQuery(
      `INSERT INTO tax_account_mappings (
         tenant_id,
         tax_regime_id,
         legal_entity_id,
         tax_code_id,
         tax_purpose_code,
         account_id,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        parsePositiveInt(input.regimeId),
        parsePositiveInt(input.legalEntityId),
        parsePositiveInt(input.taxCodeId),
        u(input.taxPurposeCode),
        parsePositiveInt(input.accountId),
        u(input.status || "ACTIVE"),
      ]
    );
    const mappingId = parsePositiveInt(insertResult.rows?.insertId);
    const row = await getTaxAccountMappingRowById({ tenantId, mappingId, runQuery });
    return mapTaxAccountMappingRow(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict(
        "Tax account mapping already exists for legalEntityId + taxCodeId + taxPurposeCode",
        "TAX_ACCOUNT_MAPPING_DUPLICATE"
      );
    }
    throw err;
  }
}
export async function updateTaxAccountMapping({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const mappingId = parsePositiveInt(input?.mappingId);
  if (!tenantId || !mappingId) {
    throw badRequest("tenantId and mappingId are required");
  }
  const existing = await getTaxAccountMappingRowById({
    tenantId,
    mappingId,
    runQuery,
  });
  if (!existing) {
    throw notFound("Tax account mapping not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "existing mapping scope");
  const next = {
    regimeId:
      input.regimeId !== undefined
        ? parsePositiveInt(input.regimeId)
        : parsePositiveInt(existing.tax_regime_id),
    legalEntityId:
      input.legalEntityId !== undefined
        ? parsePositiveInt(input.legalEntityId)
        : parsePositiveInt(existing.legal_entity_id),
    taxCodeId:
      input.taxCodeId !== undefined
        ? parsePositiveInt(input.taxCodeId)
        : parsePositiveInt(existing.tax_code_id),
    taxPurposeCode:
      input.taxPurposeCode !== undefined
        ? u(input.taxPurposeCode)
        : u(existing.tax_purpose_code),
    accountId:
      input.accountId !== undefined
        ? parsePositiveInt(input.accountId)
        : parsePositiveInt(existing.account_id),
    status: input.status !== undefined ? u(input.status) : u(existing.status),
  };
  assertScopeAccess(req, "legal_entity", next.legalEntityId, "legalEntityId");
  const regime = await assertTaxRegimeExists(tenantId, next.regimeId, runQuery);
  const regimeLegalEntityId = parsePositiveInt(regime.legal_entity_id);
  if (regimeLegalEntityId && regimeLegalEntityId !== next.legalEntityId) {
    throw badRequest("regimeId is legal-entity scoped; mapping legalEntityId must match regime");
  }
  await assertLegalEntityBelongsToTenant(tenantId, next.legalEntityId, "legalEntityId");
  await assertTaxCodeInRegime(tenantId, next.taxCodeId, next.regimeId, runQuery);
  await assertAccountEligibleForTaxMapping({
    tenantId,
    legalEntityId: next.legalEntityId,
    accountId: next.accountId,
    runQuery,
  });
  try {
    await runQuery(
      `UPDATE tax_account_mappings
       SET tax_regime_id = ?,
           legal_entity_id = ?,
           tax_code_id = ?,
           tax_purpose_code = ?,
           account_id = ?,
           status = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        next.regimeId,
        next.legalEntityId,
        next.taxCodeId,
        next.taxPurposeCode,
        next.accountId,
        next.status,
        tenantId,
        mappingId,
      ]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict(
        "Tax account mapping already exists for legalEntityId + taxCodeId + taxPurposeCode",
        "TAX_ACCOUNT_MAPPING_DUPLICATE"
      );
    }
    throw err;
  }
  const updated = await getTaxAccountMappingRowById({
    tenantId,
    mappingId,
    runQuery,
  });
  return mapTaxAccountMappingRow(updated);
}
export async function previewTaxComputation({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  assertScopeAccess(req, "legal_entity", input.legalEntityId, "legalEntityId");
  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    input.legalEntityId,
    "legalEntityId"
  );
  const resolvedCountryId = parsePositiveInt(input.countryId || legalEntity.country_id);
  if (!resolvedCountryId) {
    throw badRequest("Unable to resolve country for preview; provide countryId");
  }
  if (
    parsePositiveInt(input.countryId) &&
    parsePositiveInt(input.countryId) !== parsePositiveInt(legalEntity.country_id)
  ) {
    throw badRequest("countryId must match legalEntityId country");
  }
  const regimeRow = await resolvePreviewRegime({
    tenantId,
    countryId: resolvedCountryId,
    legalEntityId: parsePositiveInt(input.legalEntityId),
    postingDate: input.postingDate,
    runQuery,
  });
  if (!regimeRow) {
    throw notFound(
      "Active tax regime not found for selected country/legal entity/posting date",
      "TAX_REGIME_NOT_FOUND"
    );
  }
  let taxCodeRow = await resolvePreviewTaxCode({
    tenantId,
    regimeId: regimeRow.id,
    taxCodeId: input.taxCodeId,
    taxCode: input.taxCode,
    runQuery,
  });
  if (taxCodeRow && u(taxCodeRow.status) !== "ACTIVE") {
    throw conflict("Selected tax code is not ACTIVE", "TAX_CODE_NOT_ACTIVE");
  }
  const ruleRow = await resolvePreviewRule({
    tenantId,
    regimeId: regimeRow.id,
    postingDate: input.postingDate,
    moduleCode: input.moduleCode,
    documentType: input.documentType,
    counterpartyType: input.counterpartyType,
    taxCodeId: taxCodeRow ? parsePositiveInt(taxCodeRow.id) : null,
    runQuery,
  });
  if (!ruleRow) {
    throw notFound(
      "Active tax rule not found for selected module/context/date",
      "TAX_RULE_NOT_FOUND"
    );
  }
  if (!taxCodeRow) {
    taxCodeRow = await resolvePreviewTaxCode({
      tenantId,
      regimeId: regimeRow.id,
      taxCodeId: parsePositiveInt(ruleRow.tax_code_id),
      taxCode: null,
      runQuery,
    });
  }
  if (!taxCodeRow || u(taxCodeRow.status) !== "ACTIVE") {
    throw conflict("Resolved tax code is missing or inactive", "TAX_CODE_NOT_ACTIVE");
  }
  const config = resolveComputationConfigFromFormula({
    taxCodeRow,
    taxRuleRow: ruleRow,
    previewInput: input,
  });
  const breakdown = computeTaxBreakdown({
    baseAmount: input.baseAmount,
    ratePct: config.ratePct,
    calculationMode: config.calculationMode,
    recoverability: config.recoverability,
    recoverablePct: config.recoverablePct,
  });
  const taxPurposeCode =
    input.taxPurposeCode ||
    resolveDefaultTaxPurposeCode({
      taxKind: taxCodeRow.tax_kind,
      direction: input.direction,
    });
  if (!taxPurposeCode) {
    throw badRequest(
      "taxPurposeCode is required for selected tax kind; auto-derivation only supports VAT/WITHHOLDING"
    );
  }
  const mappingRow = await resolvePreviewMapping({
    tenantId,
    regimeId: parsePositiveInt(regimeRow.id),
    legalEntityId: parsePositiveInt(input.legalEntityId),
    taxCodeId: parsePositiveInt(taxCodeRow.id),
    taxPurposeCode,
    runQuery,
  });
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
    parsePositiveInt(mappingRow.account_legal_entity_id) !== parsePositiveInt(input.legalEntityId)
  ) {
    throw conflict(
      "Tax account mapping account scope legal entity mismatch",
      "TAX_ACCOUNT_MAPPING_MISSING"
    );
  }
  const direction = u(input.direction || "PURCHASE");
  const taxAmount = Number(breakdown.taxAmount || 0);
  const journalLine = {
    accountId: parsePositiveInt(mappingRow.account_id),
    accountCode: mappingRow.account_code || null,
    accountName: mappingRow.account_name || null,
    taxCode: String(taxCodeRow.code || ""),
    taxPurposeCode: u(taxPurposeCode),
    currencyCode: input.currencyCode || regimeRow.currency_code || null,
    amountTxn: direction === "SALE" ? Number((taxAmount * -1).toFixed(6)) : taxAmount,
    debitBase: direction === "SALE" ? 0 : taxAmount,
    creditBase: direction === "SALE" ? taxAmount : 0,
    description:
      direction === "SALE"
        ? `Tax preview (${taxCodeRow.code}) output`
        : `Tax preview (${taxCodeRow.code}) input`,
  };
  return {
    regime: mapTaxRegimeRow(regimeRow),
    taxCode: mapTaxCodeRow(taxCodeRow),
    rule: mapTaxRuleRow(ruleRow),
    mapping: {
      taxPurposeCode: u(taxPurposeCode),
      ...mapTaxAccountMappingRow(mappingRow),
    },
    formula: {
      type: config.formulaType,
      source: safeParseJson(ruleRow.formula_json),
    },
    breakdown,
    journalLines: [journalLine],
  };
}
export default {
  resolveTaxRegimeScope,
  resolveTaxCodeScope,
  resolveTaxRuleScope,
  resolveTaxAccountMappingScope,
  listTaxRegimes,
  createTaxRegime,
  updateTaxRegime,
  listTaxCodes,
  createTaxCode,
  updateTaxCode,
  listTaxRules,
  createTaxRule,
  updateTaxRule,
  listTaxAccountMappings,
  createTaxAccountMapping,
  updateTaxAccountMapping,
  previewTaxComputation,
};
