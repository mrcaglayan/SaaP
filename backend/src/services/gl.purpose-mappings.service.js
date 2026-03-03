import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const PURPOSE_MODULE_KEYS = Object.freeze({
  CARI: "CARI",
  REVREC: "REVREC",
});

const CARI_REQUIRED_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
]);
const CARI_CONTEXT_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL_CASH",
  "CARI_AR_OFFSET_CASH",
  "CARI_AP_CONTROL_CASH",
  "CARI_AP_OFFSET_CASH",
  "CARI_AR_CONTROL_MANUAL",
  "CARI_AR_OFFSET_MANUAL",
  "CARI_AP_CONTROL_MANUAL",
  "CARI_AP_OFFSET_MANUAL",
  "CARI_AR_CONTROL_ON_ACCOUNT",
  "CARI_AR_OFFSET_ON_ACCOUNT",
  "CARI_AP_CONTROL_ON_ACCOUNT",
  "CARI_AP_OFFSET_ON_ACCOUNT",
]);
const CARI_PURPOSE_CODES = Object.freeze([
  ...CARI_REQUIRED_PURPOSE_CODES,
  ...CARI_CONTEXT_PURPOSE_CODES,
]);
const CARI_PURPOSE_CODE_SET = new Set(CARI_PURPOSE_CODES);

const REVREC_PURPOSE_CODES = Object.freeze([
  "DEFREV_SHORT_LIABILITY",
  "DEFREV_LONG_LIABILITY",
  "DEFREV_REVENUE",
  "DEFREV_RECLASS",
  "PREPAID_EXP_SHORT_ASSET",
  "PREPAID_EXP_LONG_ASSET",
  "PREPAID_EXPENSE",
  "PREPAID_RECLASS",
  "ACCR_REV_SHORT_ASSET",
  "ACCR_REV_LONG_ASSET",
  "ACCR_REV_REVENUE",
  "ACCR_REV_RECLASS",
  "ACCR_EXP_SHORT_LIABILITY",
  "ACCR_EXP_LONG_LIABILITY",
  "ACCR_EXP_EXPENSE",
  "ACCR_EXP_RECLASS",
]);
const REVREC_PURPOSE_CODE_SET = new Set(REVREC_PURPOSE_CODES);

const PURPOSE_CODES_BY_MODULE = Object.freeze({
  [PURPOSE_MODULE_KEYS.CARI]: CARI_PURPOSE_CODES,
  [PURPOSE_MODULE_KEYS.REVREC]: REVREC_PURPOSE_CODES,
});

const PURPOSE_CODE_SET_BY_MODULE = Object.freeze({
  [PURPOSE_MODULE_KEYS.CARI]: CARI_PURPOSE_CODE_SET,
  [PURPOSE_MODULE_KEYS.REVREC]: REVREC_PURPOSE_CODE_SET,
});

const PURPOSE_CODE_TO_MODULE = (() => {
  const byCode = new Map();
  for (const [moduleKey, purposeCodes] of Object.entries(PURPOSE_CODES_BY_MODULE)) {
    for (const purposeCode of purposeCodes) {
      byCode.set(purposeCode, moduleKey);
    }
  }
  return byCode;
})();

const SHAREHOLDER_PURPOSE_PREFIX = "SHAREHOLDER_";
const SHAREHOLDER_CONFIG_ENDPOINT = "/api/v1/org/shareholder-journal-config";

function toDbBoolean(value) {
  return value === true || Number(value) === 1;
}

function normalizePurposeCode(value) {
  const purposeCode = String(value || "")
    .trim()
    .toUpperCase();
  if (!purposeCode) {
    throw badRequest("purposeCode is required");
  }
  return purposeCode;
}

function normalizePurposeModuleKey(value, { defaultValue = PURPOSE_MODULE_KEYS.CARI } = {}) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return defaultValue;
  }
  if (normalized === PURPOSE_MODULE_KEYS.CARI || normalized === PURPOSE_MODULE_KEYS.REVREC) {
    return normalized;
  }
  throw badRequest(
    `moduleKey must be one of: ${Object.values(PURPOSE_MODULE_KEYS).join(", ")}`
  );
}

function assertPurposeCodeSupportedForModule(purposeCode, moduleKey) {
  if (purposeCode.startsWith(SHAREHOLDER_PURPOSE_PREFIX)) {
    throw badRequest(
      `Shareholder purpose codes must be configured via ${SHAREHOLDER_CONFIG_ENDPOINT}`
    );
  }
  const allowedPurposeCodes = PURPOSE_CODES_BY_MODULE[moduleKey] || [];
  const allowedPurposeSet = PURPOSE_CODE_SET_BY_MODULE[moduleKey] || new Set();
  if (!allowedPurposeSet.has(purposeCode)) {
    throw badRequest(
      `purposeCode must be one of (${moduleKey}): ${allowedPurposeCodes.join(", ")}`
    );
  }
}

function resolvePurposeModuleKeyForUpsert(purposeCode, moduleKeyInput) {
  const moduleKey = normalizePurposeModuleKey(moduleKeyInput, { defaultValue: "" });
  if (moduleKey) {
    assertPurposeCodeSupportedForModule(purposeCode, moduleKey);
    return moduleKey;
  }
  const inferred = PURPOSE_CODE_TO_MODULE.get(purposeCode);
  if (!inferred) {
    throw badRequest("purposeCode is not supported for manual mapping");
  }
  return inferred;
}

function mapPurposeMappingRow(row, legalEntityId) {
  if (!row) {
    return null;
  }

  const accountId = parsePositiveInt(row.account_id);
  const accountTenantId = parsePositiveInt(row.tenant_id);
  const accountLegalEntityId = parsePositiveInt(row.coa_legal_entity_id);
  const scope = String(row.coa_scope || "").toUpperCase();
  const isActive = toDbBoolean(row.is_active);
  const allowPosting = toDbBoolean(row.allow_posting);
  const accountInLegalEntityChart =
    scope === "LEGAL_ENTITY" && accountLegalEntityId === legalEntityId;
  const validForPurposePosting =
    Boolean(accountId) &&
    Boolean(accountTenantId) &&
    accountInLegalEntityChart &&
    isActive &&
    allowPosting;

  return {
    purposeCode: String(row.purpose_code || "").trim().toUpperCase(),
    accountId,
    accountCode: String(row.account_code || ""),
    accountName: String(row.account_name || ""),
    accountType: String(row.account_type || "").toUpperCase(),
    normalSide: String(row.normal_side || "").toUpperCase(),
    isActive,
    allowPosting,
    validForPurposePosting,
    validForCariPosting: validForPurposePosting,
  };
}

async function loadAccountForPurposeMapping({
  tenantId,
  legalEntityId,
  accountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       a.normal_side,
       a.is_active,
       a.allow_posting,
       c.tenant_id,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("accountId not found for tenant");
  }

  const scope = String(row.coa_scope || "").toUpperCase();
  if (scope !== "LEGAL_ENTITY") {
    throw badRequest("accountId must belong to a LEGAL_ENTITY chart");
  }

  const accountLegalEntityId = parsePositiveInt(row.coa_legal_entity_id);
  if (accountLegalEntityId !== legalEntityId) {
    throw badRequest("accountId must belong to selected legalEntityId");
  }

  if (!toDbBoolean(row.is_active)) {
    throw badRequest("accountId must reference an active account");
  }

  if (!toDbBoolean(row.allow_posting)) {
    throw badRequest("accountId must reference a postable account");
  }

  return row;
}

export function getCariPurposeCodes() {
  return [...CARI_PURPOSE_CODES];
}

export async function listPurposeMappings({
  tenantId,
  legalEntityId,
  moduleKey = PURPOSE_MODULE_KEYS.CARI,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedModuleKey = normalizePurposeModuleKey(moduleKey);
  const purposeCodes = PURPOSE_CODES_BY_MODULE[normalizedModuleKey] || [];
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!Array.isArray(purposeCodes) || purposeCodes.length === 0) {
    return [];
  }

  const placeholders = purposeCodes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       jpa.purpose_code,
       a.id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       a.normal_side,
       a.is_active,
       a.allow_posting,
       c.tenant_id,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id
     FROM journal_purpose_accounts jpa
     LEFT JOIN accounts a ON a.id = jpa.account_id
     LEFT JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE jpa.tenant_id = ?
      AND jpa.legal_entity_id = ?
       AND jpa.purpose_code IN (${placeholders})`,
    [normalizedTenantId, normalizedLegalEntityId, ...purposeCodes]
  );

  const byPurposeCode = new Map(
    (result.rows || []).map((row) => [
      String(row.purpose_code || "").trim().toUpperCase(),
      mapPurposeMappingRow(row, normalizedLegalEntityId),
    ])
  );

  return purposeCodes.map((purposeCode) => {
    const existing = byPurposeCode.get(purposeCode);
    if (existing) {
      return existing;
    }
    return {
      purposeCode,
      accountId: null,
      accountCode: null,
      accountName: null,
      accountType: null,
      normalSide: null,
      isActive: false,
      allowPosting: false,
      validForPurposePosting: false,
      validForCariPosting: false,
    };
  });
}

export async function upsertPurposeMapping({
  tenantId,
  legalEntityId,
  purposeCode,
  accountId,
  moduleKey = "",
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedAccountId = parsePositiveInt(accountId);
  const normalizedPurposeCode = normalizePurposeCode(purposeCode);
  const normalizedModuleKey = resolvePurposeModuleKeyForUpsert(
    normalizedPurposeCode,
    moduleKey
  );

  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!normalizedAccountId) {
    throw badRequest("accountId must be a positive integer");
  }

  const accountRow = await loadAccountForPurposeMapping({
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    accountId: normalizedAccountId,
    runQuery,
  });

  await runQuery(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_id = VALUES(account_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      normalizedTenantId,
      normalizedLegalEntityId,
      normalizedPurposeCode,
      normalizedAccountId,
    ]
  );

  return {
    moduleKey: normalizedModuleKey,
    purposeCode: normalizedPurposeCode,
    accountId: normalizedAccountId,
    accountCode: String(accountRow.account_code || ""),
    accountName: String(accountRow.account_name || ""),
    accountType: String(accountRow.account_type || "").toUpperCase(),
    normalSide: String(accountRow.normal_side || "").toUpperCase(),
    isActive: true,
    allowPosting: true,
    validForPurposePosting: true,
    validForCariPosting: true,
  };
}
