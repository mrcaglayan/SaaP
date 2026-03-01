import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const CANONICAL_TYPES = new Set(["ACCOUNT", "PURPOSE"]);
const MAPPING_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toNullableString(value, maxLength = 255) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function toDateOnlyString(value, label = "date") {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${label} must be a valid date`);
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid date`);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStatus(value, fallback = "ACTIVE") {
  const status = normalizeUpperText(value || fallback);
  if (!MAPPING_STATUSES.has(status)) {
    throw badRequest("status must be ACTIVE or INACTIVE");
  }
  return status;
}

function normalizeCanonicalType(value, fallback = "ACCOUNT") {
  const canonicalType = normalizeUpperText(value || fallback);
  if (!CANONICAL_TYPES.has(canonicalType)) {
    throw badRequest("canonicalType must be ACCOUNT or PURPOSE");
  }
  return canonicalType;
}

function normalizeListStatus(value) {
  const normalized = normalizeUpperText(value || "ALL");
  if (!["ALL", ...MAPPING_STATUSES].includes(normalized)) {
    throw badRequest("status must be ALL, ACTIVE, or INACTIVE");
  }
  return normalized;
}

function mapCanonicalKeyRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: normalizeUpperText(row.canonical_type || "ACCOUNT"),
    purposeCode: row.purpose_code || null,
    status: normalizeUpperText(row.status || "ACTIVE"),
    localMappingCount: Number(row.local_mapping_count || 0),
    groupMappingCount: Number(row.group_mapping_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapCanonicalMappingRow(row) {
  return {
    canonicalKeyId: parsePositiveInt(row.canonical_key_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: row.canonical_type || null,
    purposeCode: row.purpose_code || null,
    keyStatus: row.key_status || null,
    localMapping: {
      id: parsePositiveInt(row.local_mapping_id),
      legalEntityId: parsePositiveInt(row.legal_entity_id),
      localAccountId: parsePositiveInt(row.local_account_id),
      localAccountCode: row.local_account_code || null,
      localAccountName: row.local_account_name || null,
      status: row.local_mapping_status || null,
      effectiveFrom: row.local_effective_from || null,
      effectiveTo: row.local_effective_to || null,
    },
    groupMapping: {
      id: parsePositiveInt(row.group_mapping_id),
      groupAccountId: parsePositiveInt(row.group_account_id),
      groupAccountCode: row.group_account_code || null,
      groupAccountName: row.group_account_name || null,
      status: row.group_mapping_status || null,
      effectiveFrom: row.group_effective_from || null,
      effectiveTo: row.group_effective_to || null,
    },
  };
}

async function assertLocalAccountCompatible({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.coa_id,
       c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = ?
     JOIN group_coa_mappings gcm
       ON gcm.tenant_id = ?
      AND gcm.consolidation_group_id = ?
      AND gcm.legal_entity_id = ?
      AND gcm.local_coa_id = a.coa_id
      AND gcm.status = 'ACTIVE'
     WHERE a.id = ?
       AND a.is_active = TRUE
     LIMIT 1`,
    [tenantId, tenantId, consolidationGroupId, legalEntityId, localAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(
      "localAccountId must belong to an ACTIVE local CoA mapping for legalEntityId in this consolidation group"
    );
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("localAccountId must belong to legalEntityId");
  }
}

async function assertGroupAccountCompatible({
  tenantId,
  consolidationGroupId,
  groupAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.coa_id,
       c.scope AS coa_scope
     FROM accounts a
     JOIN charts_of_accounts c
       ON c.id = a.coa_id
      AND c.tenant_id = ?
     JOIN group_coa_mappings gcm
       ON gcm.tenant_id = ?
      AND gcm.consolidation_group_id = ?
      AND gcm.group_coa_id = a.coa_id
      AND gcm.status = 'ACTIVE'
     WHERE a.id = ?
       AND a.is_active = TRUE
     LIMIT 1`,
    [tenantId, tenantId, consolidationGroupId, groupAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(
      "groupAccountId must belong to an ACTIVE group CoA mapping in this consolidation group"
    );
  }
  if (normalizeUpperText(row.coa_scope) !== "GROUP") {
    throw badRequest("groupAccountId must belong to a GROUP chart of accounts");
  }
}

async function getCanonicalKeyById({
  tenantId,
  consolidationGroupId,
  canonicalKeyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM consolidation_canonical_keys
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, canonicalKeyId]
  );
  return result.rows?.[0] || null;
}

async function getCanonicalKeyByCode({
  tenantId,
  consolidationGroupId,
  canonicalKey,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM consolidation_canonical_keys
     WHERE tenant_id = ?
       AND consolidation_group_id = ?
       AND canonical_key = ?
     LIMIT 1`,
    [tenantId, consolidationGroupId, canonicalKey]
  );
  return result.rows?.[0] || null;
}

async function resolveCanonicalKey({
  tenantId,
  consolidationGroupId,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  runQuery = query,
}) {
  const parsedCanonicalKeyId = parsePositiveInt(canonicalKeyId);
  if (parsedCanonicalKeyId) {
    const row = await getCanonicalKeyById({
      tenantId,
      consolidationGroupId,
      canonicalKeyId: parsedCanonicalKeyId,
      runQuery,
    });
    if (!row) {
      throw badRequest("canonicalKeyId not found in consolidation group");
    }
    return row;
  }

  const normalizedCanonicalKey = normalizeUpperText(canonicalKey);
  if (!normalizedCanonicalKey) {
    throw badRequest("canonicalKeyId or canonicalKey is required");
  }

  await runQuery(
    `INSERT INTO consolidation_canonical_keys (
        tenant_id,
        consolidation_group_id,
        canonical_key,
        canonical_name,
        canonical_type,
        purpose_code,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonical_name = VALUES(canonical_name),
       canonical_type = VALUES(canonical_type),
       purpose_code = VALUES(purpose_code),
       status = VALUES(status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      consolidationGroupId,
      normalizedCanonicalKey,
      toNullableString(canonicalName, 255) || normalizedCanonicalKey,
      normalizeCanonicalType(canonicalType),
      toNullableString(purposeCode, 80),
      normalizeStatus(status),
    ]
  );

  const row = await getCanonicalKeyByCode({
    tenantId,
    consolidationGroupId,
    canonicalKey: normalizedCanonicalKey,
    runQuery,
  });
  if (!row) {
    throw new Error("Canonical key upsert readback failed");
  }
  return row;
}

export async function listCanonicalKeys({
  tenantId,
  consolidationGroupId,
  status = "ALL",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const normalizedStatus = normalizeListStatus(status);
  const params = [parsedTenantId, parsedGroupId];
  const where = ["ck.tenant_id = ?", "ck.consolidation_group_id = ?"];
  if (normalizedStatus !== "ALL") {
    where.push("ck.status = ?");
    params.push(normalizedStatus);
  }

  const result = await runQuery(
    `SELECT
       ck.*,
       COUNT(DISTINCT clm.id) AS local_mapping_count,
       COUNT(DISTINCT cgm.id) AS group_mapping_count
     FROM consolidation_canonical_keys ck
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = ck.tenant_id
      AND clm.consolidation_group_id = ck.consolidation_group_id
      AND clm.canonical_key_id = ck.id
     LEFT JOIN consolidation_canonical_group_account_mappings cgm
       ON cgm.tenant_id = ck.tenant_id
      AND cgm.consolidation_group_id = ck.consolidation_group_id
      AND cgm.canonical_key_id = ck.id
     WHERE ${where.join(" AND ")}
     GROUP BY ck.id
     ORDER BY ck.canonical_key ASC`,
    params
  );

  return (result.rows || []).map(mapCanonicalKeyRow);
}

export async function upsertCanonicalKey({
  tenantId,
  consolidationGroupId,
  canonicalKey,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const row = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKey,
    canonicalName,
    canonicalType,
    purposeCode,
    status,
    runQuery,
  });
  return mapCanonicalKeyRow(row);
}

export async function upsertLocalAccountCanonicalMapping({
  tenantId,
  consolidationGroupId,
  legalEntityId,
  localAccountId,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  effectiveFrom = null,
  effectiveTo = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const parsedLocalAccountId = parsePositiveInt(localAccountId);
  if (!parsedTenantId || !parsedGroupId || !parsedLegalEntityId || !parsedLocalAccountId) {
    throw badRequest(
      "tenantId, consolidationGroupId, legalEntityId, and localAccountId are required"
    );
  }

  await assertLocalAccountCompatible({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    legalEntityId: parsedLegalEntityId,
    localAccountId: parsedLocalAccountId,
    runQuery,
  });

  const canonicalKeyRow = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId,
    canonicalKey,
    canonicalName,
    canonicalType,
    purposeCode,
    status: "ACTIVE",
    runQuery,
  });
  const parsedCanonicalKeyId = parsePositiveInt(canonicalKeyRow.id);
  if (!parsedCanonicalKeyId) {
    throw new Error("canonicalKeyId resolve failed");
  }

  const normalizedStatus = normalizeStatus(status);
  const normalizedEffectiveFrom =
    toDateOnlyString(effectiveFrom, "effectiveFrom") ||
    toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (normalizedEffectiveTo && normalizedEffectiveTo < normalizedEffectiveFrom) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }

  await runQuery(
    `INSERT INTO consolidation_canonical_local_account_mappings (
        tenant_id,
        consolidation_group_id,
        legal_entity_id,
        local_account_id,
        canonical_key_id,
        status,
        effective_from,
        effective_to
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonical_key_id = VALUES(canonical_key_id),
       status = VALUES(status),
       effective_from = VALUES(effective_from),
       effective_to = VALUES(effective_to),
       updated_at = CURRENT_TIMESTAMP`,
    [
      parsedTenantId,
      parsedGroupId,
      parsedLegalEntityId,
      parsedLocalAccountId,
      parsedCanonicalKeyId,
      normalizedStatus,
      normalizedEffectiveFrom,
      normalizedEffectiveTo,
    ]
  );

  const result = await runQuery(
    `SELECT
       clm.id,
       clm.tenant_id,
       clm.consolidation_group_id,
       clm.legal_entity_id,
       clm.local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       clm.canonical_key_id,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.purpose_code,
       clm.status,
       clm.effective_from,
       clm.effective_to,
       clm.created_at,
       clm.updated_at
     FROM consolidation_canonical_local_account_mappings clm
     JOIN consolidation_canonical_keys ck ON ck.id = clm.canonical_key_id
     JOIN accounts local_acc ON local_acc.id = clm.local_account_id
     WHERE clm.tenant_id = ?
       AND clm.consolidation_group_id = ?
       AND clm.legal_entity_id = ?
       AND clm.local_account_id = ?
     LIMIT 1`,
    [parsedTenantId, parsedGroupId, parsedLegalEntityId, parsedLocalAccountId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error("local canonical mapping upsert readback failed");
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    localAccountId: parsePositiveInt(row.local_account_id),
    localAccountCode: row.local_account_code || null,
    localAccountName: row.local_account_name || null,
    canonicalKeyId: parsePositiveInt(row.canonical_key_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: row.canonical_type || null,
    purposeCode: row.purpose_code || null,
    status: row.status || null,
    effectiveFrom: row.effective_from || null,
    effectiveTo: row.effective_to || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function upsertGroupAccountCanonicalMapping({
  tenantId,
  consolidationGroupId,
  groupAccountId,
  canonicalKeyId = null,
  canonicalKey = null,
  canonicalName = null,
  canonicalType = "ACCOUNT",
  purposeCode = null,
  status = "ACTIVE",
  effectiveFrom = null,
  effectiveTo = null,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  const parsedGroupAccountId = parsePositiveInt(groupAccountId);
  if (!parsedTenantId || !parsedGroupId || !parsedGroupAccountId) {
    throw badRequest("tenantId, consolidationGroupId, and groupAccountId are required");
  }

  await assertGroupAccountCompatible({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    groupAccountId: parsedGroupAccountId,
    runQuery,
  });

  const canonicalKeyRow = await resolveCanonicalKey({
    tenantId: parsedTenantId,
    consolidationGroupId: parsedGroupId,
    canonicalKeyId,
    canonicalKey,
    canonicalName,
    canonicalType,
    purposeCode,
    status: "ACTIVE",
    runQuery,
  });
  const parsedCanonicalKeyId = parsePositiveInt(canonicalKeyRow.id);
  if (!parsedCanonicalKeyId) {
    throw new Error("canonicalKeyId resolve failed");
  }

  const normalizedStatus = normalizeStatus(status);
  const normalizedEffectiveFrom =
    toDateOnlyString(effectiveFrom, "effectiveFrom") ||
    toDateOnlyString(new Date(), "effectiveFrom");
  const normalizedEffectiveTo = toDateOnlyString(effectiveTo, "effectiveTo");
  if (normalizedEffectiveTo && normalizedEffectiveTo < normalizedEffectiveFrom) {
    throw badRequest("effectiveTo must be >= effectiveFrom");
  }

  await runQuery(
    `INSERT INTO consolidation_canonical_group_account_mappings (
        tenant_id,
        consolidation_group_id,
        canonical_key_id,
        group_account_id,
        status,
        effective_from,
        effective_to
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       group_account_id = VALUES(group_account_id),
       status = VALUES(status),
       effective_from = VALUES(effective_from),
       effective_to = VALUES(effective_to),
       updated_at = CURRENT_TIMESTAMP`,
    [
      parsedTenantId,
      parsedGroupId,
      parsedCanonicalKeyId,
      parsedGroupAccountId,
      normalizedStatus,
      normalizedEffectiveFrom,
      normalizedEffectiveTo,
    ]
  );

  const result = await runQuery(
    `SELECT
       cgm.id,
       cgm.tenant_id,
       cgm.consolidation_group_id,
       cgm.canonical_key_id,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.purpose_code,
       cgm.group_account_id,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name,
       cgm.status,
       cgm.effective_from,
       cgm.effective_to,
       cgm.created_at,
       cgm.updated_at
     FROM consolidation_canonical_group_account_mappings cgm
     JOIN consolidation_canonical_keys ck ON ck.id = cgm.canonical_key_id
     JOIN accounts group_acc ON group_acc.id = cgm.group_account_id
     WHERE cgm.tenant_id = ?
       AND cgm.consolidation_group_id = ?
       AND cgm.canonical_key_id = ?
     LIMIT 1`,
    [parsedTenantId, parsedGroupId, parsedCanonicalKeyId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error("group canonical mapping upsert readback failed");
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    canonicalKeyId: parsePositiveInt(row.canonical_key_id),
    canonicalKey: row.canonical_key || null,
    canonicalName: row.canonical_name || null,
    canonicalType: row.canonical_type || null,
    purposeCode: row.purpose_code || null,
    groupAccountId: parsePositiveInt(row.group_account_id),
    groupAccountCode: row.group_account_code || null,
    groupAccountName: row.group_account_name || null,
    status: row.status || null,
    effectiveFrom: row.effective_from || null,
    effectiveTo: row.effective_to || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listCanonicalAccountMappings({
  tenantId,
  consolidationGroupId,
  legalEntityId = null,
  status = "ALL",
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedGroupId = parsePositiveInt(consolidationGroupId);
  if (!parsedTenantId || !parsedGroupId) {
    throw badRequest("tenantId and consolidationGroupId are required");
  }

  const parsedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedStatus = normalizeListStatus(status);
  const params = [parsedTenantId, parsedGroupId];
  const where = ["ck.tenant_id = ?", "ck.consolidation_group_id = ?"];

  if (parsedLegalEntityId) {
    where.push("clm.legal_entity_id = ?");
    params.push(parsedLegalEntityId);
  }
  if (normalizedStatus !== "ALL") {
    where.push("(clm.status = ? OR cgm.status = ? OR ck.status = ?)");
    params.push(normalizedStatus, normalizedStatus, normalizedStatus);
  }

  const result = await runQuery(
    `SELECT
       ck.id AS canonical_key_id,
       ck.canonical_key,
       ck.canonical_name,
       ck.canonical_type,
       ck.purpose_code,
       ck.status AS key_status,
       clm.id AS local_mapping_id,
       clm.legal_entity_id,
       clm.local_account_id,
       local_acc.code AS local_account_code,
       local_acc.name AS local_account_name,
       clm.status AS local_mapping_status,
       clm.effective_from AS local_effective_from,
       clm.effective_to AS local_effective_to,
       cgm.id AS group_mapping_id,
       cgm.group_account_id,
       group_acc.code AS group_account_code,
       group_acc.name AS group_account_name,
       cgm.status AS group_mapping_status,
       cgm.effective_from AS group_effective_from,
       cgm.effective_to AS group_effective_to
     FROM consolidation_canonical_keys ck
     LEFT JOIN consolidation_canonical_local_account_mappings clm
       ON clm.tenant_id = ck.tenant_id
      AND clm.consolidation_group_id = ck.consolidation_group_id
      AND clm.canonical_key_id = ck.id
     LEFT JOIN accounts local_acc ON local_acc.id = clm.local_account_id
     LEFT JOIN consolidation_canonical_group_account_mappings cgm
       ON cgm.tenant_id = ck.tenant_id
      AND cgm.consolidation_group_id = ck.consolidation_group_id
      AND cgm.canonical_key_id = ck.id
     LEFT JOIN accounts group_acc ON group_acc.id = cgm.group_account_id
     WHERE ${where.join(" AND ")}
     ORDER BY ck.canonical_key ASC, clm.legal_entity_id ASC, local_acc.code ASC`,
    params
  );

  return (result.rows || []).map(mapCanonicalMappingRow);
}

export default {
  listCanonicalKeys,
  upsertCanonicalKey,
  upsertLocalAccountCanonicalMapping,
  upsertGroupAccountCanonicalMapping,
  listCanonicalAccountMappings,
};
