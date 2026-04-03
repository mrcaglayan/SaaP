import { query } from "../db.js";
import {
  checkUserHasPermissionAtScope,
  normalizeAuthzScope,
} from "./authz.scope.service.js";
import { invalidateFieldVisibilityPolicyCache } from "../middleware/fieldVisibility.js";

const VALID_VISIBILITY_RULES = new Set(["FULL", "MASKED", "HIDDEN", "LAST_4"]);
const VALID_SCOPE_TYPES = new Set([
  "GLOBAL",
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeFieldName(value) {
  return String(value || "").trim();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes"].includes(normalized);
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function normalizePolicyRow(row, tenantId = null) {
  const normalizedTenantId = parsePositiveInt(row?.tenant_id) || parsePositiveInt(tenantId);
  const appliesToScopeType = normalizeUpperText(row?.applies_to_scope_type || "");
  const normalizedScopeType = appliesToScopeType || null;
  const normalizedScopeId = parsePositiveInt(row?.applies_to_scope_id);
  return {
    id: parsePositiveInt(row?.id),
    tenantId: normalizedTenantId,
    moduleCode: normalizeUpperText(row?.module_code),
    objectType: normalizeUpperText(row?.object_type),
    fieldName: normalizeFieldName(row?.field_name),
    visibilityRule: normalizeUpperText(row?.visibility_rule || "FULL"),
    appliesToScopeType: normalizedScopeType,
    appliesToScopeId: normalizedScopeId,
    requiredPermissionCode: String(row?.required_permission_code || "").trim() || null,
    isActive: parseBoolean(row?.is_active, true),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    createdByUserId: parsePositiveInt(row?.created_by_user_id),
  };
}

function buildPolicyScope(input, tenantId) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const requestedScopeType = normalizeUpperText(input?.appliesToScopeType || input?.scopeType || "");
  const scopeType = requestedScopeType || "GLOBAL";
  if (!VALID_SCOPE_TYPES.has(scopeType)) {
    throw badRequest(
      "appliesToScopeType must be GLOBAL, TENANT, GROUP, COUNTRY, LEGAL_ENTITY, or OPERATING_UNIT"
    );
  }
  if (scopeType === "GLOBAL") {
    return {
      appliesToScopeType: null,
      appliesToScopeId: null,
    };
  }
  if (scopeType === "TENANT") {
    return {
      appliesToScopeType: "TENANT",
      appliesToScopeId: normalizedTenantId,
    };
  }

  const scopeId = parsePositiveInt(input?.appliesToScopeId ?? input?.scopeId);
  if (!scopeId) {
    throw badRequest(`appliesToScopeId is required when appliesToScopeType = ${scopeType}`);
  }
  return {
    appliesToScopeType: scopeType,
    appliesToScopeId: scopeId,
  };
}

function validateModuleObjectField({
  moduleCode,
  objectType,
  fieldName,
}) {
  if (!moduleCode) {
    throw badRequest("moduleCode is required");
  }
  if (!objectType) {
    throw badRequest("objectType is required");
  }
  if (!fieldName) {
    throw badRequest("fieldName is required");
  }
}

function validateVisibilityRule(visibilityRule) {
  if (!VALID_VISIBILITY_RULES.has(visibilityRule)) {
    throw badRequest("visibilityRule must be FULL, MASKED, HIDDEN, or LAST_4");
  }
}

function normalizePolicyInput(input, tenantId, existingPolicy = null) {
  const base = existingPolicy || {};
  const moduleCode = normalizeUpperText(input?.moduleCode || base.moduleCode);
  const objectType = normalizeUpperText(input?.objectType || base.objectType);
  const fieldName = normalizeFieldName(input?.fieldName || base.fieldName);
  const visibilityRule = normalizeUpperText(
    input?.visibilityRule || base.visibilityRule || "FULL"
  );
  const requiredPermissionCode =
    String(
      input?.requiredPermissionCode !== undefined
        ? input.requiredPermissionCode
        : base.requiredPermissionCode || ""
    ).trim() || null;
  const isActive = parseBoolean(
    input?.isActive !== undefined ? input.isActive : base.isActive,
    true
  );

  validateModuleObjectField({ moduleCode, objectType, fieldName });
  validateVisibilityRule(visibilityRule);

  const scope = buildPolicyScope(
    {
      appliesToScopeType:
        input?.appliesToScopeType !== undefined
          ? input.appliesToScopeType
          : base.appliesToScopeType || "GLOBAL",
      appliesToScopeId:
        input?.appliesToScopeId !== undefined
          ? input.appliesToScopeId
          : base.appliesToScopeId,
    },
    tenantId
  );

  return {
    moduleCode,
    objectType,
    fieldName,
    visibilityRule,
    appliesToScopeType: scope.appliesToScopeType,
    appliesToScopeId: scope.appliesToScopeId,
    requiredPermissionCode,
    isActive,
  };
}

/**
 * Resolve the concrete permission-check scope for one field-visibility policy.
 * Global policies still require tenant-scoped management permission.
 */
export function resolveFieldVisibilityPolicyManagementScope(policy, tenantId) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const requestedScope = normalizeAuthzScope(
    {
      scopeType:
        normalizeUpperText(policy?.appliesToScopeType || "") || "TENANT",
      scopeId:
        parsePositiveInt(policy?.appliesToScopeId) || normalizedTenantId,
    },
    normalizedTenantId
  );
  return requestedScope;
}

/**
 * Enforce that one actor holds the requested field-visibility admin permission
 * at the concrete policy scope they are trying to read or change.
 */
export async function assertFieldVisibilityPolicyPermission({
  actorUserId,
  tenantId,
  permissionCode,
  policyOrScope,
  runQuery = query,
}) {
  const normalizedActorUserId = parsePositiveInt(actorUserId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPermissionCode = String(permissionCode || "").trim();
  if (!normalizedActorUserId || !normalizedTenantId || !normalizedPermissionCode) {
    throw forbidden("Field visibility policy access could not be evaluated");
  }
  const resolvedScope = policyOrScope?.scopeType
    ? normalizeAuthzScope(policyOrScope, normalizedTenantId)
    : resolveFieldVisibilityPolicyManagementScope(policyOrScope, normalizedTenantId);
  const allowed = await checkUserHasPermissionAtScope(
    normalizedActorUserId,
    normalizedTenantId,
    normalizedPermissionCode,
    resolvedScope.scopeType,
    resolvedScope.scopeId,
    { runQuery }
  );
  if (!allowed) {
    throw forbidden(
      `${normalizedPermissionCode} is required at ${resolvedScope.scopeType} #${resolvedScope.scopeId}`
    );
  }
  return resolvedScope;
}

/**
 * List persisted field-visibility policies for one tenant.
 */
export async function listFieldVisibilityPolicies({
  tenantId,
  includeInactive = false,
  moduleCode = null,
  objectType = null,
  fieldName = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    return [];
  }
  const conditions = ["tenant_id = ?"];
  const params = [normalizedTenantId];

  if (!includeInactive) {
    conditions.push("is_active = 1");
  }
  if (moduleCode) {
    conditions.push("module_code = ?");
    params.push(normalizeUpperText(moduleCode));
  }
  if (objectType) {
    conditions.push("object_type = ?");
    params.push(normalizeUpperText(objectType));
  }
  if (fieldName) {
    conditions.push("field_name = ?");
    params.push(normalizeFieldName(fieldName));
  }

  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        module_code,
        object_type,
        field_name,
        visibility_rule,
        applies_to_scope_type,
        applies_to_scope_id,
        required_permission_code,
        is_active,
        created_at,
        updated_at,
        created_by_user_id
     FROM field_visibility_policies
     WHERE ${conditions.join(" AND ")}
     ORDER BY module_code ASC,
              object_type ASC,
              field_name ASC,
              applies_to_scope_type ASC,
              applies_to_scope_id ASC,
              id ASC`,
    params
  );

  return (result.rows || []).map((row) => normalizePolicyRow(row, normalizedTenantId));
}

/**
 * List only the field-visibility policies an actor is allowed to read at each
 * policy's own configured scope.
 */
export async function listFieldVisibilityPoliciesForActor({
  actorUserId,
  tenantId,
  includeInactive = false,
  moduleCode = null,
  objectType = null,
  fieldName = null,
  runQuery = query,
}) {
  const policies = await listFieldVisibilityPolicies({
    tenantId,
    includeInactive,
    moduleCode,
    objectType,
    fieldName,
    runQuery,
  });
  const visiblePolicies = [];
  for (const policy of policies) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await assertFieldVisibilityPolicyPermission({
        actorUserId,
        tenantId,
        permissionCode: "security.field_visibility.read",
        policyOrScope: policy,
        runQuery,
      });
      visiblePolicies.push(policy);
    } catch (err) {
      if (err?.status !== 403) {
        throw err;
      }
    }
  }
  return visiblePolicies;
}

/**
 * Load one field-visibility policy row for one tenant.
 */
export async function getFieldVisibilityPolicyById({
  tenantId,
  policyId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPolicyId = parsePositiveInt(policyId);
  if (!normalizedTenantId || !normalizedPolicyId) {
    return null;
  }
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        module_code,
        object_type,
        field_name,
        visibility_rule,
        applies_to_scope_type,
        applies_to_scope_id,
        required_permission_code,
        is_active,
        created_at,
        updated_at,
        created_by_user_id
     FROM field_visibility_policies
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [normalizedTenantId, normalizedPolicyId]
  );
  return normalizePolicyRow(result.rows?.[0] || null, normalizedTenantId);
}

/**
 * Create one field-visibility policy row and invalidate the runtime cache.
 */
export async function createFieldVisibilityPolicy({
  tenantId,
  actorUserId,
  input,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedActorUserId = parsePositiveInt(actorUserId);
  const normalizedInput = normalizePolicyInput(input, normalizedTenantId);

  const result = await runQuery(
    `INSERT INTO field_visibility_policies (
        tenant_id,
        module_code,
        object_type,
        field_name,
        visibility_rule,
        applies_to_scope_type,
        applies_to_scope_id,
        required_permission_code,
        is_active,
        created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedTenantId,
      normalizedInput.moduleCode,
      normalizedInput.objectType,
      normalizedInput.fieldName,
      normalizedInput.visibilityRule,
      normalizedInput.appliesToScopeType,
      normalizedInput.appliesToScopeId,
      normalizedInput.requiredPermissionCode,
      normalizedInput.isActive ? 1 : 0,
      normalizedActorUserId || null,
    ]
  );
  invalidateFieldVisibilityPolicyCache(normalizedTenantId);
  return getFieldVisibilityPolicyById({
    tenantId: normalizedTenantId,
    policyId: result.rows?.insertId,
    runQuery,
  });
}

/**
 * Update one persisted field-visibility policy row and invalidate the runtime
 * policy cache so masking reflects admin changes immediately.
 */
export async function updateFieldVisibilityPolicy({
  tenantId,
  policyId,
  input,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPolicyId = parsePositiveInt(policyId);
  const existingPolicy = await getFieldVisibilityPolicyById({
    tenantId: normalizedTenantId,
    policyId: normalizedPolicyId,
    runQuery,
  });
  if (!existingPolicy) {
    throw badRequest("Field visibility policy not found");
  }
  const normalizedInput = normalizePolicyInput(input, normalizedTenantId, existingPolicy);

  await runQuery(
    `UPDATE field_visibility_policies
     SET module_code = ?,
         object_type = ?,
         field_name = ?,
         visibility_rule = ?,
         applies_to_scope_type = ?,
         applies_to_scope_id = ?,
         required_permission_code = ?,
         is_active = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [
      normalizedInput.moduleCode,
      normalizedInput.objectType,
      normalizedInput.fieldName,
      normalizedInput.visibilityRule,
      normalizedInput.appliesToScopeType,
      normalizedInput.appliesToScopeId,
      normalizedInput.requiredPermissionCode,
      normalizedInput.isActive ? 1 : 0,
      normalizedTenantId,
      normalizedPolicyId,
    ]
  );
  invalidateFieldVisibilityPolicyCache(normalizedTenantId);
  return getFieldVisibilityPolicyById({
    tenantId: normalizedTenantId,
    policyId: normalizedPolicyId,
    runQuery,
  });
}

/**
 * Soft-delete one field-visibility policy so audit/history survive while the
 * runtime stops applying the rule.
 */
export async function deactivateFieldVisibilityPolicy({
  tenantId,
  policyId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPolicyId = parsePositiveInt(policyId);
  const existingPolicy = await getFieldVisibilityPolicyById({
    tenantId: normalizedTenantId,
    policyId: normalizedPolicyId,
    runQuery,
  });
  if (!existingPolicy) {
    throw badRequest("Field visibility policy not found");
  }

  await runQuery(
    `UPDATE field_visibility_policies
     SET is_active = 0
     WHERE tenant_id = ?
       AND id = ?`,
    [normalizedTenantId, normalizedPolicyId]
  );
  invalidateFieldVisibilityPolicyCache(normalizedTenantId);
  return getFieldVisibilityPolicyById({
    tenantId: normalizedTenantId,
    policyId: normalizedPolicyId,
    runQuery,
  });
}

