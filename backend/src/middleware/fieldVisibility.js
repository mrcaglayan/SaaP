import { query } from "../db.js";
import { parsePositiveInt, resolveTenantId } from "../routes/_utils.js";
import {
  checkUserHasPermissionAtScope,
  doesScopeIncludeScope,
  normalizeAuthzScope,
  resolveRowScope as resolveAuthzRowScope,
} from "../services/authz.scope.service.js";
import { applyVisibilityRule } from "../utils/redaction.js";

const FIELD_VISIBILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const fieldVisibilityPolicyCache = new Map();
const POLICY_SCOPE_RANK = Object.freeze({
  OPERATING_UNIT: 5,
  LEGAL_ENTITY: 4,
  COUNTRY: 3,
  GROUP: 2,
  TENANT: 1,
  GLOBAL: 0,
});

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeFieldName(value) {
  return String(value || "")
    .trim();
}

function buildPolicyCacheKey(tenantId, moduleCode, objectType) {
  return `${tenantId}:${moduleCode}:${objectType}`;
}

function getCachedPolicies(cacheKey) {
  const cached = fieldVisibilityPolicyCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    fieldVisibilityPolicyCache.delete(cacheKey);
    return null;
  }
  return cached.rows;
}

function setCachedPolicies(cacheKey, rows) {
  fieldVisibilityPolicyCache.set(cacheKey, {
    rows,
    expiresAt: Date.now() + FIELD_VISIBILITY_CACHE_TTL_MS,
  });
}

function normalizePolicyRow(row) {
  const appliesToScopeType = row?.applies_to_scope_type
    ? normalizeUpperText(row.applies_to_scope_type)
    : null;
  const appliesToScopeId = parsePositiveInt(row?.applies_to_scope_id);
  return {
    id: parsePositiveInt(row?.id),
    tenantId: parsePositiveInt(row?.tenant_id),
    moduleCode: normalizeUpperText(row?.module_code),
    objectType: normalizeUpperText(row?.object_type),
    fieldName: normalizeFieldName(row?.field_name),
    visibilityRule: normalizeUpperText(row?.visibility_rule || "FULL"),
    appliesToScopeType,
    appliesToScopeId,
    requiredPermissionCode: String(row?.required_permission_code || "").trim() || null,
    isActive:
      row?.is_active === true ||
      row?.is_active === 1 ||
      row?.is_active === "1",
    createdByUserId: parsePositiveInt(row?.created_by_user_id),
    updatedAt: row?.updated_at || null,
  };
}

/**
 * Clears the in-memory field-visibility policy cache for one tenant or all
 * tenants after admin updates.
 */
export function invalidateFieldVisibilityPolicyCache(tenantId = null) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    fieldVisibilityPolicyCache.clear();
    return;
  }
  const prefix = `${normalizedTenantId}:`;
  for (const cacheKey of fieldVisibilityPolicyCache.keys()) {
    if (cacheKey.startsWith(prefix)) {
      fieldVisibilityPolicyCache.delete(cacheKey);
    }
  }
}

/**
 * Loads active field-visibility policies for one tenant/module/object pair.
 */
export async function loadFieldVisibilityPolicies({
  tenantId,
  moduleCode,
  objectType,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedModuleCode = normalizeUpperText(moduleCode);
  const normalizedObjectType = normalizeUpperText(objectType);
  if (!normalizedTenantId || !normalizedModuleCode || !normalizedObjectType) {
    return [];
  }

  const cacheKey = buildPolicyCacheKey(
    normalizedTenantId,
    normalizedModuleCode,
    normalizedObjectType
  );
  if (runQuery === query) {
    const cachedRows = getCachedPolicies(cacheKey);
    if (cachedRows) {
      return cachedRows;
    }
  }

  let rows;
  try {
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
          created_by_user_id,
          updated_at
       FROM field_visibility_policies
       WHERE tenant_id = ?
         AND module_code = ?
         AND object_type = ?
         AND is_active = 1
       ORDER BY updated_at DESC, id DESC`,
      [normalizedTenantId, normalizedModuleCode, normalizedObjectType]
    );
    rows = (result.rows || []).map(normalizePolicyRow);
  } catch (err) {
    if (Number(err?.errno) === 1146) {
      rows = [];
    } else {
      throw err;
    }
  }
  if (runQuery === query) {
    setCachedPolicies(cacheKey, rows);
  }
  return rows;
}

function resolveDefaultRowScope(row, tenantId) {
  return resolveAuthzRowScope({
    tenantId,
    groupCompanyId: row?.group_company_id ?? row?.groupCompanyId ?? row?.group_id ?? row?.groupId,
    countryId: row?.country_id ?? row?.countryId,
    legalEntityId: row?.legal_entity_id ?? row?.legalEntityId,
    operatingUnitId: row?.operating_unit_id ?? row?.operatingUnitId,
    allowTenantScope: true,
  });
}

function resolveDefaultObjectId(row) {
  return (
    parsePositiveInt(row?.id) ||
    parsePositiveInt(row?.object_id) ||
    parsePositiveInt(row?.objectId) ||
    0
  );
}

function resolveDefaultLegalEntityId(row, rowScope) {
  return (
    parsePositiveInt(row?.legal_entity_id) ||
    parsePositiveInt(row?.legalEntityId) ||
    (rowScope?.scopeType === "LEGAL_ENTITY" ? rowScope.scopeId : null)
  );
}

function getPolicyScopeRank(policy) {
  if (!policy?.appliesToScopeType || !policy?.appliesToScopeId) {
    return POLICY_SCOPE_RANK.GLOBAL;
  }
  return POLICY_SCOPE_RANK[policy.appliesToScopeType] || POLICY_SCOPE_RANK.GLOBAL;
}

async function doesPolicyApplyToScope({
  tenantId,
  policy,
  rowScope,
  runQuery = query,
}) {
  if (!policy?.isActive) {
    return false;
  }
  if (!policy.appliesToScopeType || !policy.appliesToScopeId) {
    return true;
  }
  return doesScopeIncludeScope(
    tenantId,
    {
      scopeType: policy.appliesToScopeType,
      scopeId: policy.appliesToScopeId,
    },
    rowScope,
    runQuery
  );
}

async function selectPoliciesForRow({
  tenantId,
  policies,
  rowScope,
  runQuery = query,
}) {
  const selectedByField = new Map();
  for (const policy of policies || []) {
    // eslint-disable-next-line no-await-in-loop
    const applies = await doesPolicyApplyToScope({
      tenantId,
      policy,
      rowScope,
      runQuery,
    });
    if (!applies || !policy.fieldName) {
      continue;
    }
    const current = selectedByField.get(policy.fieldName);
    if (!current || getPolicyScopeRank(policy) > getPolicyScopeRank(current)) {
      selectedByField.set(policy.fieldName, policy);
    }
  }
  return selectedByField;
}

async function resolveFieldVisibilityStateForRow({
  row,
  fieldName,
  tenantId,
  userId,
  policies,
  resolveRowScope,
  runQuery = query,
}) {
  if (!row || typeof row !== "object" || !fieldName) {
    return "FULL";
  }
  const rawRowScope =
    typeof resolveRowScope === "function"
      ? await resolveRowScope(row)
      : resolveDefaultRowScope(row, tenantId);
  const effectiveRowScope = rawRowScope
    ? normalizeAuthzScope(rawRowScope, tenantId)
    : normalizeAuthzScope({ scopeType: "TENANT", scopeId: tenantId }, tenantId);
  const selectedPolicies = await selectPoliciesForRow({
    tenantId,
    policies,
    rowScope: effectiveRowScope,
    runQuery,
  });
  const policy = selectedPolicies.get(fieldName);
  if (!policy) {
    return "FULL";
  }
  if (!policy.requiredPermissionCode) {
    return policy.visibilityRule;
  }
  const hasOverride = await checkUserHasPermissionAtScope(
    userId,
    tenantId,
    policy.requiredPermissionCode,
    effectiveRowScope.scopeType,
    effectiveRowScope.scopeId,
    { runQuery }
  );
  return hasOverride ? "FULL" : policy.visibilityRule;
}

async function writeMaskedAccessAudit({
  tenantId,
  legalEntityId = null,
  moduleCode,
  objectType,
  objectId,
  maskedFields,
  rowScope,
  userId = null,
  runQuery = query,
}) {
  if (!Array.isArray(maskedFields) || maskedFields.length === 0) {
    return;
  }
  await runQuery(
    `INSERT INTO sensitive_data_audit (
        tenant_id,
        legal_entity_id,
        module_code,
        object_type,
        object_id,
        action,
        payload_json,
        note,
        acted_by_user_id
      ) VALUES (?, ?, ?, ?, ?, 'FIELD_MASKED_ACCESS', ?, ?, ?)`,
    [
      tenantId,
      parsePositiveInt(legalEntityId) || null,
      normalizeUpperText(moduleCode),
      normalizeUpperText(objectType),
      parsePositiveInt(objectId) || 0,
      JSON.stringify({
        maskedFields: maskedFields.map((field) => ({
          fieldName: field.fieldName,
          visibilityRule: field.visibilityRule,
          requiredPermissionCode: field.requiredPermissionCode || null,
        })),
        rowScope: rowScope
          ? {
              scopeType: rowScope.scopeType,
              scopeId: rowScope.scopeId,
            }
          : null,
      }),
      `Field masking applied to ${normalizeUpperText(objectType)} #${parsePositiveInt(objectId) || 0}`,
      parsePositiveInt(userId) || null,
    ]
  );
}

async function applyMaskingForRow({
  row,
  tenantId,
  userId,
  moduleCode,
  objectType,
  policies,
  resolveRowScope,
  resolveObjectId,
  resolveLegalEntityId,
  runQuery = query,
}) {
  if (!row || typeof row !== "object") {
    return row;
  }

  const rawRowScope =
    typeof resolveRowScope === "function"
      ? await resolveRowScope(row)
      : resolveDefaultRowScope(row, tenantId);
  const effectiveRowScope = rawRowScope
    ? normalizeAuthzScope(rawRowScope, tenantId)
    : normalizeAuthzScope({ scopeType: "TENANT", scopeId: tenantId }, tenantId);
  const selectedPolicies = await selectPoliciesForRow({
    tenantId,
    policies,
    rowScope: effectiveRowScope,
    runQuery,
  });
  if (selectedPolicies.size === 0) {
    return row;
  }

  const maskedRow = { ...row };
  const maskedFields = [];

  for (const [fieldName, policy] of selectedPolicies.entries()) {
    if (!Object.prototype.hasOwnProperty.call(maskedRow, fieldName)) {
      continue;
    }

    let hasOverride = false;
    if (policy.requiredPermissionCode) {
      // Row-scoped sensitive overrides must be evaluated at the concrete row
      // scope instead of via a tenant-wide permission shortcut.
      // eslint-disable-next-line no-await-in-loop
      hasOverride = await checkUserHasPermissionAtScope(
        userId,
        tenantId,
        policy.requiredPermissionCode,
        effectiveRowScope.scopeType,
        effectiveRowScope.scopeId,
        { runQuery }
      );
    }
    if (hasOverride || policy.visibilityRule === "FULL") {
      continue;
    }

    const nextValue = applyVisibilityRule(maskedRow[fieldName], policy.visibilityRule);
    if (nextValue === undefined) {
      delete maskedRow[fieldName];
    } else {
      maskedRow[fieldName] = nextValue;
    }
    maskedFields.push({
      fieldName,
      visibilityRule: policy.visibilityRule,
      requiredPermissionCode: policy.requiredPermissionCode || null,
    });
  }

  if (maskedFields.length > 0) {
    const objectId =
      typeof resolveObjectId === "function"
        ? resolveObjectId(row)
        : resolveDefaultObjectId(row);
    const legalEntityId =
      typeof resolveLegalEntityId === "function"
        ? resolveLegalEntityId(row, effectiveRowScope)
        : resolveDefaultLegalEntityId(row, effectiveRowScope);

    await writeMaskedAccessAudit({
      tenantId,
      legalEntityId,
      moduleCode,
      objectType,
      objectId,
      maskedFields,
      rowScope: effectiveRowScope,
      userId,
      runQuery,
    });
  }

  return maskedRow;
}

/**
 * Attaches row-aware field masking helpers to the request so routes can apply
 * one shared policy engine to list and detail responses without duplicating
 * masking rules per endpoint.
 */
export function applyFieldVisibility(
  moduleCode,
  objectType,
  {
    resolveRowScope = null,
    resolveObjectId = null,
    resolveLegalEntityId = null,
    runQuery = query,
  } = {}
) {
  const normalizedModuleCode = normalizeUpperText(moduleCode);
  const normalizedObjectType = normalizeUpperText(objectType);

  return async (req, res, next) => {
    try {
      const tenantId = parsePositiveInt(req?.rbac?.tenantId) || resolveTenantId(req);
      const userId = parsePositiveInt(req?.user?.userId);
      if (!tenantId || !userId) {
        return next();
      }

      const policies = await loadFieldVisibilityPolicies({
        tenantId,
        moduleCode: normalizedModuleCode,
        objectType: normalizedObjectType,
        runQuery,
      });

      req.fieldVisibility = {
        ...(req.fieldVisibility || {}),
        moduleCode: normalizedModuleCode,
        objectType: normalizedObjectType,
        applyToRow: async (row) =>
          applyMaskingForRow({
            row,
            tenantId,
            userId,
            moduleCode: normalizedModuleCode,
            objectType: normalizedObjectType,
            policies,
            resolveRowScope,
            resolveObjectId,
            resolveLegalEntityId,
            runQuery,
          }),
        applyToRows: async (rows) =>
          Promise.all(
            (Array.isArray(rows) ? rows : []).map((row) =>
              applyMaskingForRow({
                row,
                tenantId,
                userId,
                moduleCode: normalizedModuleCode,
                objectType: normalizedObjectType,
                policies,
                resolveRowScope,
                resolveObjectId,
                resolveLegalEntityId,
                runQuery,
              })
            )
          ),
        isFieldVisible: async (fieldName, row) => {
          const visibilityState = await resolveFieldVisibilityStateForRow({
            row,
            tenantId,
            userId,
            policies,
            resolveRowScope,
            runQuery,
          });
          return visibilityState === "FULL";
        },
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default {
  applyFieldVisibility,
  invalidateFieldVisibilityPolicyCache,
  loadFieldVisibilityPolicies,
};
