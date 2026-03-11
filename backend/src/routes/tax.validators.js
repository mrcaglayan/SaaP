import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeCode,
  normalizeCurrencyCode,
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseBooleanFlag,
  parsePagination,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const STATUSES = ["ACTIVE", "INACTIVE"];
const TAX_KINDS = ["VAT", "WITHHOLDING", "STAMP", "OTHER"];
const CALCULATION_MODES = ["EXCLUSIVE", "INCLUSIVE"];
const RECOVERABILITY_MODES = ["FULL", "PARTIAL", "NONE"];
const MODULE_CODES = ["CARI", "BANK", "PAYROLL", "CONTRACTS", "GL_MANUAL"];
const COUNTERPARTY_TYPES = ["CUSTOMER", "VENDOR", "EMPLOYEE", "GOVERNMENT", "OTHER"];
const TAX_PURPOSE_CODES = [
  "VAT_INPUT",
  "VAT_OUTPUT",
  "VAT_PAYABLE",
  "VAT_RECEIVABLE",
  "WITHHOLDING_PAYABLE",
  "WITHHOLDING_RECEIVABLE",
  "ROUNDING",
];
const PREVIEW_DIRECTIONS = ["PURCHASE", "SALE"];

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function parseOptionalEnum(value, label, allowedValues) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeEnum(value, label, allowedValues);
}

function parseOptionalDateOnly(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw badRequest(`${label} must be a valid date`);
  }
  return raw;
}

function parseRequiredDateOnly(value, label) {
  const parsed = parseOptionalDateOnly(value, label);
  if (!parsed) {
    throw badRequest(`${label} is required`);
  }
  return parsed;
}

function parseOptionalDecimal(value, label, { min = null, max = null } = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (min !== null && parsed < min) {
    throw badRequest(`${label} must be >= ${min}`);
  }
  if (max !== null && parsed > max) {
    throw badRequest(`${label} must be <= ${max}`);
  }
  return Number(parsed.toFixed(6));
}

function parseRequiredDecimal(value, label, { min = null, max = null } = {}) {
  const parsed = parseOptionalDecimal(value, label, { min, max });
  if (parsed === null) {
    throw badRequest(`${label} is required`);
  }
  return parsed;
}

function parseNullablePositiveIntField(body, camelKey, snakeKey, label) {
  const provided = hasOwn(body, camelKey) || hasOwn(body, snakeKey);
  if (!provided) {
    return { provided: false, value: undefined };
  }
  const raw = hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey];
  if (raw === null || raw === "") {
    return { provided: true, value: null };
  }
  return { provided: true, value: requirePositiveInt(raw, label) };
}

function parseNullableDateField(body, camelKey, snakeKey, label) {
  const provided = hasOwn(body, camelKey) || hasOwn(body, snakeKey);
  if (!provided) {
    return { provided: false, value: undefined };
  }
  const raw = hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey];
  if (raw === null || raw === "") {
    return { provided: true, value: null };
  }
  return { provided: true, value: parseOptionalDateOnly(raw, label) };
}

function parseNullableDecimalField(
  body,
  camelKey,
  snakeKey,
  label,
  { min = null, max = null } = {}
) {
  const provided = hasOwn(body, camelKey) || hasOwn(body, snakeKey);
  if (!provided) {
    return { provided: false, value: undefined };
  }
  const raw = hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey];
  if (raw === null || raw === "") {
    return { provided: true, value: null };
  }
  return {
    provided: true,
    value: parseOptionalDecimal(raw, label, { min, max }),
  };
}

function parseJsonValue(value, label, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw badRequest(`${label} is required`);
    }
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    throw badRequest(`${label} must be a JSON object or JSON text`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw badRequest(`${label} must be valid JSON`);
  }
}

function parseOptionalCode(value, label, maxLength) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeCode(value, label, maxLength);
}

function ensureDateRange(effectiveFrom, effectiveTo) {
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }
}

export function parseTaxRegimeIdParam(req) {
  const id = parsePositiveInt(req.params?.regimeId ?? req.params?.id);
  if (!id) {
    throw badRequest("regimeId must be a positive integer");
  }
  return id;
}

export function parseTaxCodeIdParam(req) {
  const id = parsePositiveInt(req.params?.codeId ?? req.params?.id);
  if (!id) {
    throw badRequest("codeId must be a positive integer");
  }
  return id;
}

export function parseTaxRuleIdParam(req) {
  const id = parsePositiveInt(req.params?.ruleId ?? req.params?.id);
  if (!id) {
    throw badRequest("ruleId must be a positive integer");
  }
  return id;
}

export function parseTaxAccountMappingIdParam(req) {
  const id = parsePositiveInt(req.params?.mappingId ?? req.params?.id);
  if (!id) {
    throw badRequest("mappingId must be a positive integer");
  }
  return id;
}

export function parseTaxRegimesListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });
  return {
    tenantId,
    ...pagination,
    countryId: optionalPositiveInt(req.query?.countryId ?? req.query?.country_id, "countryId"),
    legalEntityId: optionalPositiveInt(
      req.query?.legalEntityId ?? req.query?.legal_entity_id,
      "legalEntityId"
    ),
    status: parseOptionalEnum(req.query?.status, "status", STATUSES),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

export function parseTaxCodesListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });
  return {
    tenantId,
    ...pagination,
    regimeId: optionalPositiveInt(req.query?.regimeId ?? req.query?.regime_id, "regimeId"),
    status: parseOptionalEnum(req.query?.status, "status", STATUSES),
    taxKind: parseOptionalEnum(req.query?.taxKind ?? req.query?.tax_kind, "taxKind", TAX_KINDS),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

export function parseTaxRulesListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });
  return {
    tenantId,
    ...pagination,
    regimeId: optionalPositiveInt(req.query?.regimeId ?? req.query?.regime_id, "regimeId"),
    taxCodeId: optionalPositiveInt(req.query?.taxCodeId ?? req.query?.tax_code_id, "taxCodeId"),
    moduleCode: parseOptionalEnum(
      req.query?.moduleCode ?? req.query?.module_code,
      "moduleCode",
      MODULE_CODES
    ),
    status: parseOptionalEnum(req.query?.status, "status", STATUSES),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

export function parseTaxAccountMappingsListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });
  return {
    tenantId,
    ...pagination,
    regimeId: optionalPositiveInt(req.query?.regimeId ?? req.query?.regime_id, "regimeId"),
    legalEntityId: optionalPositiveInt(
      req.query?.legalEntityId ?? req.query?.legal_entity_id,
      "legalEntityId"
    ),
    taxCodeId: optionalPositiveInt(req.query?.taxCodeId ?? req.query?.tax_code_id, "taxCodeId"),
    taxPurposeCode: parseOptionalEnum(
      req.query?.taxPurposeCode ?? req.query?.tax_purpose_code,
      "taxPurposeCode",
      TAX_PURPOSE_CODES
    ),
    status: parseOptionalEnum(req.query?.status, "status", STATUSES),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

export function parseTaxRegimeCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};

  const effectiveFrom = parseRequiredDateOnly(
    body.effectiveFrom ?? body.effective_from,
    "effectiveFrom"
  );
  const effectiveTo = parseOptionalDateOnly(
    body.effectiveTo ?? body.effective_to,
    "effectiveTo"
  );
  ensureDateRange(effectiveFrom, effectiveTo);

  return {
    tenantId,
    userId,
    countryId: requirePositiveInt(body.countryId ?? body.country_id, "countryId"),
    legalEntityId: optionalPositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    ),
    code: normalizeCode(body.code, "code", 60),
    name: normalizeText(body.name, "name", 255, { required: true }),
    currencyCode: normalizeCurrencyCode(body.currencyCode ?? body.currency_code, "currencyCode"),
    effectiveFrom,
    effectiveTo,
    status: normalizeEnum(body.status ?? "ACTIVE", "status", STATUSES),
  };
}

export function parseTaxRegimeUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const regimeId = parseTaxRegimeIdParam(req);
  const body = req.body || {};

  const legalEntityField = parseNullablePositiveIntField(
    body,
    "legalEntityId",
    "legal_entity_id",
    "legalEntityId"
  );
  const effectiveFromField = parseNullableDateField(
    body,
    "effectiveFrom",
    "effective_from",
    "effectiveFrom"
  );
  const effectiveToField = parseNullableDateField(
    body,
    "effectiveTo",
    "effective_to",
    "effectiveTo"
  );

  const patch = {
    tenantId,
    userId,
    regimeId,
  };

  if (hasOwn(body, "countryId") || hasOwn(body, "country_id")) {
    patch.countryId = requirePositiveInt(body.countryId ?? body.country_id, "countryId");
  }
  if (legalEntityField.provided) {
    patch.legalEntityId = legalEntityField.value;
  }
  if (hasOwn(body, "code")) {
    patch.code = normalizeCode(body.code, "code", 60);
  }
  if (hasOwn(body, "name")) {
    patch.name = normalizeText(body.name, "name", 255, { required: true });
  }
  if (hasOwn(body, "currencyCode") || hasOwn(body, "currency_code")) {
    patch.currencyCode = normalizeCurrencyCode(
      body.currencyCode ?? body.currency_code,
      "currencyCode"
    );
  }
  if (effectiveFromField.provided) {
    patch.effectiveFrom = effectiveFromField.value;
  }
  if (effectiveToField.provided) {
    patch.effectiveTo = effectiveToField.value;
  }
  if (hasOwn(body, "status")) {
    patch.status = normalizeEnum(body.status, "status", STATUSES);
  }

  const patchKeys = Object.keys(patch).filter(
    (key) => !["tenantId", "userId", "regimeId"].includes(key)
  );
  if (patchKeys.length === 0) {
    throw badRequest("At least one updatable field is required");
  }
  if (
    patch.effectiveFrom !== undefined &&
    patch.effectiveTo !== undefined &&
    patch.effectiveFrom &&
    patch.effectiveTo &&
    patch.effectiveTo < patch.effectiveFrom
  ) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }

  return patch;
}

export function parseTaxCodeCreateInput(req) {
  const tenantId = requireTenantId(req);
  const body = req.body || {};

  return {
    tenantId,
    regimeId: requirePositiveInt(body.regimeId ?? body.regime_id, "regimeId"),
    code: normalizeCode(body.code, "code", 40),
    name: normalizeText(body.name, "name", 255, { required: true }),
    taxKind: normalizeEnum(body.taxKind ?? body.tax_kind, "taxKind", TAX_KINDS),
    ratePct: parseRequiredDecimal(body.ratePct ?? body.rate_pct, "ratePct", {
      min: 0,
      max: 100,
    }),
    calculationMode: normalizeEnum(
      body.calculationMode ?? body.calculation_mode,
      "calculationMode",
      CALCULATION_MODES
    ),
    recoverability: normalizeEnum(
      body.recoverability ?? "FULL",
      "recoverability",
      RECOVERABILITY_MODES
    ),
    isReverseCharge: parseBooleanFlag(
      body.isReverseCharge ?? body.is_reverse_charge,
      false
    ),
    status: normalizeEnum(body.status ?? "ACTIVE", "status", STATUSES),
  };
}

export function parseTaxCodeUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const codeId = parseTaxCodeIdParam(req);
  const body = req.body || {};

  const patch = {
    tenantId,
    codeId,
  };

  if (hasOwn(body, "regimeId") || hasOwn(body, "regime_id")) {
    patch.regimeId = requirePositiveInt(body.regimeId ?? body.regime_id, "regimeId");
  }
  if (hasOwn(body, "code")) {
    patch.code = normalizeCode(body.code, "code", 40);
  }
  if (hasOwn(body, "name")) {
    patch.name = normalizeText(body.name, "name", 255, { required: true });
  }
  if (hasOwn(body, "taxKind") || hasOwn(body, "tax_kind")) {
    patch.taxKind = normalizeEnum(body.taxKind ?? body.tax_kind, "taxKind", TAX_KINDS);
  }
  if (hasOwn(body, "ratePct") || hasOwn(body, "rate_pct")) {
    patch.ratePct = parseRequiredDecimal(body.ratePct ?? body.rate_pct, "ratePct", {
      min: 0,
      max: 100,
    });
  }
  if (hasOwn(body, "calculationMode") || hasOwn(body, "calculation_mode")) {
    patch.calculationMode = normalizeEnum(
      body.calculationMode ?? body.calculation_mode,
      "calculationMode",
      CALCULATION_MODES
    );
  }
  if (hasOwn(body, "recoverability")) {
    patch.recoverability = normalizeEnum(
      body.recoverability,
      "recoverability",
      RECOVERABILITY_MODES
    );
  }
  if (hasOwn(body, "isReverseCharge") || hasOwn(body, "is_reverse_charge")) {
    patch.isReverseCharge = parseBooleanFlag(
      body.isReverseCharge ?? body.is_reverse_charge,
      false
    );
  }
  if (hasOwn(body, "status")) {
    patch.status = normalizeEnum(body.status, "status", STATUSES);
  }

  const patchKeys = Object.keys(patch).filter((key) => !["tenantId", "codeId"].includes(key));
  if (patchKeys.length === 0) {
    throw badRequest("At least one updatable field is required");
  }

  return patch;
}

export function parseTaxRuleCreateInput(req) {
  const tenantId = requireTenantId(req);
  const body = req.body || {};
  const effectiveFrom = parseRequiredDateOnly(
    body.effectiveFrom ?? body.effective_from,
    "effectiveFrom"
  );
  const effectiveTo = parseOptionalDateOnly(
    body.effectiveTo ?? body.effective_to,
    "effectiveTo"
  );
  ensureDateRange(effectiveFrom, effectiveTo);

  return {
    tenantId,
    regimeId: requirePositiveInt(body.regimeId ?? body.regime_id, "regimeId"),
    taxCodeId: requirePositiveInt(body.taxCodeId ?? body.tax_code_id, "taxCodeId"),
    moduleCode: normalizeEnum(body.moduleCode ?? body.module_code, "moduleCode", MODULE_CODES),
    documentType: normalizeText(body.documentType ?? body.document_type, "documentType", 60),
    counterpartyType: parseOptionalEnum(
      body.counterpartyType ?? body.counterparty_type,
      "counterpartyType",
      COUNTERPARTY_TYPES
    ),
    applyPriority:
      body.applyPriority === undefined && body.apply_priority === undefined
        ? 100
        : requirePositiveInt(body.applyPriority ?? body.apply_priority, "applyPriority"),
    thresholdAmount: parseOptionalDecimal(
      body.thresholdAmount ?? body.threshold_amount,
      "thresholdAmount",
      { min: 0 }
    ),
    formulaJson: parseJsonValue(body.formulaJson ?? body.formula_json, "formulaJson", {
      required: true,
    }),
    status: normalizeEnum(body.status ?? "ACTIVE", "status", STATUSES),
    effectiveFrom,
    effectiveTo,
  };
}

export function parseTaxRuleUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const ruleId = parseTaxRuleIdParam(req);
  const body = req.body || {};

  const effectiveFromField = parseNullableDateField(
    body,
    "effectiveFrom",
    "effective_from",
    "effectiveFrom"
  );
  const effectiveToField = parseNullableDateField(
    body,
    "effectiveTo",
    "effective_to",
    "effectiveTo"
  );
  const thresholdAmountField = parseNullableDecimalField(
    body,
    "thresholdAmount",
    "threshold_amount",
    "thresholdAmount",
    { min: 0 }
  );

  const patch = {
    tenantId,
    ruleId,
  };

  if (hasOwn(body, "regimeId") || hasOwn(body, "regime_id")) {
    patch.regimeId = requirePositiveInt(body.regimeId ?? body.regime_id, "regimeId");
  }
  if (hasOwn(body, "taxCodeId") || hasOwn(body, "tax_code_id")) {
    patch.taxCodeId = requirePositiveInt(body.taxCodeId ?? body.tax_code_id, "taxCodeId");
  }
  if (hasOwn(body, "moduleCode") || hasOwn(body, "module_code")) {
    patch.moduleCode = normalizeEnum(
      body.moduleCode ?? body.module_code,
      "moduleCode",
      MODULE_CODES
    );
  }
  if (hasOwn(body, "documentType") || hasOwn(body, "document_type")) {
    patch.documentType = normalizeText(
      body.documentType ?? body.document_type,
      "documentType",
      60
    );
  }
  if (hasOwn(body, "counterpartyType") || hasOwn(body, "counterparty_type")) {
    patch.counterpartyType = parseOptionalEnum(
      body.counterpartyType ?? body.counterparty_type,
      "counterpartyType",
      COUNTERPARTY_TYPES
    );
  }
  if (hasOwn(body, "applyPriority") || hasOwn(body, "apply_priority")) {
    patch.applyPriority = requirePositiveInt(
      body.applyPriority ?? body.apply_priority,
      "applyPriority"
    );
  }
  if (thresholdAmountField.provided) {
    patch.thresholdAmount = thresholdAmountField.value;
  }
  if (hasOwn(body, "formulaJson") || hasOwn(body, "formula_json")) {
    patch.formulaJson = parseJsonValue(body.formulaJson ?? body.formula_json, "formulaJson", {
      required: true,
    });
  }
  if (hasOwn(body, "status")) {
    patch.status = normalizeEnum(body.status, "status", STATUSES);
  }
  if (effectiveFromField.provided) {
    patch.effectiveFrom = effectiveFromField.value;
  }
  if (effectiveToField.provided) {
    patch.effectiveTo = effectiveToField.value;
  }

  const patchKeys = Object.keys(patch).filter((key) => !["tenantId", "ruleId"].includes(key));
  if (patchKeys.length === 0) {
    throw badRequest("At least one updatable field is required");
  }
  if (
    patch.effectiveFrom !== undefined &&
    patch.effectiveTo !== undefined &&
    patch.effectiveFrom &&
    patch.effectiveTo &&
    patch.effectiveTo < patch.effectiveFrom
  ) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }

  return patch;
}

export function parseTaxAccountMappingCreateInput(req) {
  const tenantId = requireTenantId(req);
  const body = req.body || {};

  return {
    tenantId,
    regimeId: requirePositiveInt(body.regimeId ?? body.regime_id, "regimeId"),
    legalEntityId: requirePositiveInt(body.legalEntityId ?? body.legal_entity_id, "legalEntityId"),
    taxCodeId: requirePositiveInt(body.taxCodeId ?? body.tax_code_id, "taxCodeId"),
    taxPurposeCode: normalizeEnum(
      body.taxPurposeCode ?? body.tax_purpose_code,
      "taxPurposeCode",
      TAX_PURPOSE_CODES
    ),
    accountId: requirePositiveInt(body.accountId ?? body.account_id, "accountId"),
    status: normalizeEnum(body.status ?? "ACTIVE", "status", STATUSES),
  };
}

export function parseTaxAccountMappingUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const mappingId = parseTaxAccountMappingIdParam(req);
  const body = req.body || {};

  const patch = {
    tenantId,
    mappingId,
  };

  if (hasOwn(body, "regimeId") || hasOwn(body, "regime_id")) {
    patch.regimeId = requirePositiveInt(body.regimeId ?? body.regime_id, "regimeId");
  }
  if (hasOwn(body, "legalEntityId") || hasOwn(body, "legal_entity_id")) {
    patch.legalEntityId = requirePositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    );
  }
  if (hasOwn(body, "taxCodeId") || hasOwn(body, "tax_code_id")) {
    patch.taxCodeId = requirePositiveInt(body.taxCodeId ?? body.tax_code_id, "taxCodeId");
  }
  if (hasOwn(body, "taxPurposeCode") || hasOwn(body, "tax_purpose_code")) {
    patch.taxPurposeCode = normalizeEnum(
      body.taxPurposeCode ?? body.tax_purpose_code,
      "taxPurposeCode",
      TAX_PURPOSE_CODES
    );
  }
  if (hasOwn(body, "accountId") || hasOwn(body, "account_id")) {
    patch.accountId = requirePositiveInt(body.accountId ?? body.account_id, "accountId");
  }
  if (hasOwn(body, "status")) {
    patch.status = normalizeEnum(body.status, "status", STATUSES);
  }

  const patchKeys = Object.keys(patch).filter(
    (key) => !["tenantId", "mappingId"].includes(key)
  );
  if (patchKeys.length === 0) {
    throw badRequest("At least one updatable field is required");
  }

  return patch;
}

export function parseTaxPreviewInput(req) {
  const tenantId = requireTenantId(req);
  const body = req.body || {};

  const baseAmount = parseRequiredDecimal(body.baseAmount ?? body.base_amount, "baseAmount", {
    min: 0,
  });
  if (baseAmount <= 0) {
    throw badRequest("baseAmount must be > 0");
  }

  return {
    tenantId,
    postingDate: parseRequiredDateOnly(body.postingDate ?? body.posting_date, "postingDate"),
    legalEntityId: requirePositiveInt(body.legalEntityId ?? body.legal_entity_id, "legalEntityId"),
    countryId: optionalPositiveInt(body.countryId ?? body.country_id, "countryId"),
    moduleCode: normalizeEnum(body.moduleCode ?? body.module_code, "moduleCode", MODULE_CODES),
    documentType: normalizeText(body.documentType ?? body.document_type, "documentType", 60),
    counterpartyType: parseOptionalEnum(
      body.counterpartyType ?? body.counterparty_type,
      "counterpartyType",
      COUNTERPARTY_TYPES
    ),
    taxCodeId: optionalPositiveInt(body.taxCodeId ?? body.tax_code_id, "taxCodeId"),
    taxCode: parseOptionalCode(body.taxCode ?? body.tax_code, "taxCode", 40),
    baseAmount,
    calculationMode: parseOptionalEnum(
      body.calculationMode ?? body.calculation_mode,
      "calculationMode",
      CALCULATION_MODES
    ),
    recoverability: parseOptionalEnum(
      body.recoverability,
      "recoverability",
      RECOVERABILITY_MODES
    ),
    recoverablePct: parseOptionalDecimal(
      body.recoverablePct ?? body.recoverable_pct,
      "recoverablePct",
      { min: 0, max: 100 }
    ),
    direction: normalizeEnum(
      body.direction ?? "PURCHASE",
      "direction",
      PREVIEW_DIRECTIONS
    ),
    taxPurposeCode: parseOptionalEnum(
      body.taxPurposeCode ?? body.tax_purpose_code,
      "taxPurposeCode",
      TAX_PURPOSE_CODES
    ),
    currencyCode:
      body.currencyCode !== undefined || body.currency_code !== undefined
        ? normalizeCurrencyCode(body.currencyCode ?? body.currency_code, "currencyCode")
        : null,
    formulaContext: parseJsonValue(body.formulaContext ?? body.formula_context, "formulaContext"),
  };
}

export default {
  parseTaxRegimeIdParam,
  parseTaxCodeIdParam,
  parseTaxRuleIdParam,
  parseTaxAccountMappingIdParam,
  parseTaxRegimesListInput,
  parseTaxCodesListInput,
  parseTaxRulesListInput,
  parseTaxAccountMappingsListInput,
  parseTaxRegimeCreateInput,
  parseTaxRegimeUpdateInput,
  parseTaxCodeCreateInput,
  parseTaxCodeUpdateInput,
  parseTaxRuleCreateInput,
  parseTaxRuleUpdateInput,
  parseTaxAccountMappingCreateInput,
  parseTaxAccountMappingUpdateInput,
  parseTaxPreviewInput,
};
