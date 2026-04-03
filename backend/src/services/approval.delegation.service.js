import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { checkUserHasPermissionAtScope } from "./authz.scope.service.js";
import {
  isApprovalScopeWithinBound,
  normalizeApprovalPolicyAssignmentScope,
} from "./approval.policy.validation.service.js";

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function parseDateOnly(value) {
  if (!value) return null;
  const dateOnlyMatch = String(value).match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) return dateOnlyMatch[0];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function scopeRank(scopeType) {
  if (scopeType === "OPERATING_UNIT") return 5;
  if (scopeType === "LEGAL_ENTITY") return 4;
  if (scopeType === "COUNTRY") return 3;
  if (scopeType === "GROUP") return 2;
  if (scopeType === "TENANT") return 1;
  return 0;
}

function normalizeModuleCode(value, { allowNull = true } = {}) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    if (allowNull) {
      return null;
    }
    throw badRequest("moduleCode is required");
  }
  if (normalized.length > 30) {
    throw badRequest("moduleCode cannot exceed 30 characters");
  }
  if (!/^[A-Z0-9_]+$/.test(normalized)) {
    throw badRequest("moduleCode is invalid");
  }
  return normalized;
}

function normalizeDateRange({ effectiveFrom, effectiveTo }) {
  const normalizedEffectiveFrom = parseDateOnly(effectiveFrom);
  const normalizedEffectiveTo = parseDateOnly(effectiveTo);
  if (effectiveFrom && !normalizedEffectiveFrom) {
    throw badRequest("effectiveFrom must be a valid date");
  }
  if (effectiveTo && !normalizedEffectiveTo) {
    throw badRequest("effectiveTo must be a valid date");
  }
  if (
    normalizedEffectiveFrom &&
    normalizedEffectiveTo &&
    normalizedEffectiveTo < normalizedEffectiveFrom
  ) {
    throw badRequest("effectiveTo must be on or after effectiveFrom");
  }
  return {
    effectiveFrom: normalizedEffectiveFrom,
    effectiveTo: normalizedEffectiveTo,
  };
}

function dateRangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const normalizedLeftStart = leftStart || "0001-01-01";
  const normalizedLeftEnd = leftEnd || "9999-12-31";
  const normalizedRightStart = rightStart || "0001-01-01";
  const normalizedRightEnd = rightEnd || "9999-12-31";
  return normalizedLeftStart <= normalizedRightEnd && normalizedRightStart <= normalizedLeftEnd;
}

function isActiveOn(row, asOfDate) {
  const effectiveOn = parseDateOnly(asOfDate) || new Date().toISOString().slice(0, 10);
  if (!row?.isActive || row?.revokedAt) {
    return false;
  }
  if (row.effectiveFrom && effectiveOn < row.effectiveFrom) {
    return false;
  }
  if (row.effectiveTo && effectiveOn > row.effectiveTo) {
    return false;
  }
  return true;
}

function resolveApprovalDelegationState(row, asOfDate = null) {
  const effectiveOn = parseDateOnly(asOfDate) || new Date().toISOString().slice(0, 10);
  if (row?.revokedAt || row?.isActive === false) {
    return "REVOKED";
  }
  if (row?.effectiveTo && effectiveOn > row.effectiveTo) {
    return "EXPIRED";
  }
  if (row?.effectiveFrom && effectiveOn < row.effectiveFrom) {
    return "UPCOMING";
  }
  return "ACTIVE";
}

function mapApprovalDelegationRow(row) {
  if (!row) {
    return null;
  }
  const mapped = {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    delegatorUserId: parsePositiveInt(row.delegator_user_id),
    delegateUserId: parsePositiveInt(row.delegate_user_id),
    moduleCode: normalizeModuleCode(row.module_code, { allowNull: true }),
    scopeType: toUpper(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
    effectiveFrom: parseDateOnly(row.effective_from),
    effectiveTo: parseDateOnly(row.effective_to),
    note: row.note || null,
    isActive: Boolean(row.is_active),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    revokedByUserId: parsePositiveInt(row.revoked_by_user_id),
    revokedReason: row.revoked_reason || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    delegatorUserName: row.delegator_user_name || null,
    delegatorUserEmail: row.delegator_user_email || null,
    delegateUserName: row.delegate_user_name || null,
    delegateUserEmail: row.delegate_user_email || null,
    createdByUserName: row.created_by_user_name || null,
    revokedByUserName: row.revoked_by_user_name || null,
  };
  return {
    ...mapped,
    state: resolveApprovalDelegationState(mapped),
  };
}

async function assertTenantUserExists(tenantId, userId, label, runQuery = query) {
  const result = await runQuery(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, userId]
  );
  if (!result.rows?.[0]?.id) {
    throw badRequest(`${label} not found for tenant`);
  }
}

function normalizeCreateInput(input = {}) {
  const tenantId = parsePositiveInt(input.tenantId ?? input.tenant_id);
  const delegatorUserId = parsePositiveInt(
    input.delegatorUserId ?? input.delegator_user_id
  );
  const delegateUserId = parsePositiveInt(
    input.delegateUserId ?? input.delegate_user_id
  );
  const createdByUserId = parsePositiveInt(
    input.createdByUserId ?? input.created_by_user_id
  );
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!delegatorUserId) {
    throw badRequest("delegatorUserId is required");
  }
  if (!delegateUserId) {
    throw badRequest("delegateUserId is required");
  }
  if (!createdByUserId) {
    throw badRequest("createdByUserId is required");
  }
  if (delegatorUserId === delegateUserId) {
    throw badRequest("Delegator and delegate must be different users");
  }

  const scope = normalizeApprovalPolicyAssignmentScope({
    scopeType: input.scopeType ?? input.scope_type,
    scopeId: input.scopeId ?? input.scope_id,
  });
  const dateRange = normalizeDateRange({
    effectiveFrom: input.effectiveFrom ?? input.effective_from ?? null,
    effectiveTo: input.effectiveTo ?? input.effective_to ?? null,
  });
  const note = String(input.note || "").trim() || null;
  if (note && note.length > 255) {
    throw badRequest("note cannot exceed 255 characters");
  }

  return {
    tenantId,
    delegatorUserId,
    delegateUserId,
    moduleCode: normalizeModuleCode(input.moduleCode ?? input.module_code, {
      allowNull: true,
    }),
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    effectiveFrom: dateRange.effectiveFrom,
    effectiveTo: dateRange.effectiveTo,
    note,
    createdByUserId,
  };
}

function normalizeRevokeInput(input = {}) {
  const tenantId = parsePositiveInt(input.tenantId ?? input.tenant_id);
  const revokedByUserId = parsePositiveInt(
    input.revokedByUserId ?? input.revoked_by_user_id
  );
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!revokedByUserId) {
    throw badRequest("revokedByUserId is required");
  }
  const revokedReason = String(
    input.revokedReason ?? input.revoked_reason ?? ""
  ).trim();
  if (revokedReason.length > 255) {
    throw badRequest("revokedReason cannot exceed 255 characters");
  }
  return {
    tenantId,
    revokedByUserId,
    revokedReason: revokedReason || null,
  };
}

async function assertDelegationScopeBelongsToTenant(
  tenantId,
  scope,
  runQuery = query
) {
  if (scope.scopeType === "TENANT") {
    if (scope.scopeId !== tenantId) {
      throw badRequest("TENANT delegation scopeId must match tenantId");
    }
    return;
  }
  if (scope.scopeType === "GROUP") {
    const result = await runQuery(
      `SELECT id
         FROM group_companies
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1`,
      [tenantId, scope.scopeId]
    );
    if (!result.rows?.[0]?.id) {
      throw badRequest("scopeId not found for tenant");
    }
    return;
  }
  if (scope.scopeType === "COUNTRY") {
    const result = await runQuery(
      `SELECT id
         FROM countries
        WHERE id = ?
        LIMIT 1`,
      [scope.scopeId]
    );
    if (!result.rows?.[0]?.id) {
      throw badRequest("scopeId not found");
    }
    return;
  }
  if (scope.scopeType === "LEGAL_ENTITY") {
    const result = await runQuery(
      `SELECT id
         FROM legal_entities
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1`,
      [tenantId, scope.scopeId]
    );
    if (!result.rows?.[0]?.id) {
      throw badRequest("scopeId not found for tenant");
    }
    return;
  }
  const result = await runQuery(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, scope.scopeId]
  );
  if (!result.rows?.[0]?.id) {
    throw badRequest("scopeId not found for tenant");
  }
}

async function getApprovalDelegationRowById(
  delegationId,
  tenantId,
  runQuery = query,
  { forUpdate = false } = {}
) {
  const normalizedDelegationId = parsePositiveInt(delegationId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedDelegationId || !normalizedTenantId) {
    return null;
  }
  const result = await runQuery(
    `SELECT
        d.*,
        delegator.name AS delegator_user_name,
        delegator.email AS delegator_user_email,
        delegate_user.name AS delegate_user_name,
        delegate_user.email AS delegate_user_email,
        created_by_user.name AS created_by_user_name,
        revoked_by_user.name AS revoked_by_user_name
       FROM approval_delegations d
       LEFT JOIN users delegator
         ON delegator.tenant_id = d.tenant_id
        AND delegator.id = d.delegator_user_id
       LEFT JOIN users delegate_user
         ON delegate_user.tenant_id = d.tenant_id
        AND delegate_user.id = d.delegate_user_id
       LEFT JOIN users created_by_user
         ON created_by_user.tenant_id = d.tenant_id
        AND created_by_user.id = d.created_by_user_id
       LEFT JOIN users revoked_by_user
         ON revoked_by_user.tenant_id = d.tenant_id
        AND revoked_by_user.id = d.revoked_by_user_id
      WHERE d.tenant_id = ?
        AND d.id = ?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [normalizedTenantId, normalizedDelegationId]
  );
  return mapApprovalDelegationRow(result.rows?.[0] || null);
}

async function listPotentiallyOverlappingDelegations(
  input,
  runQuery = query
) {
  const result = await runQuery(
    `SELECT *
       FROM approval_delegations
      WHERE tenant_id = ?
        AND delegator_user_id = ?
        AND delegate_user_id = ?
        AND (module_code <=> ?)
        AND scope_type = ?
        AND scope_id = ?
        AND is_active = 1
        AND revoked_at IS NULL
      ORDER BY id DESC`,
    [
      input.tenantId,
      input.delegatorUserId,
      input.delegateUserId,
      input.moduleCode,
      input.scopeType,
      input.scopeId,
    ]
  );
  return (result.rows || []).map(mapApprovalDelegationRow);
}

/**
 * Create one scoped approval delegation row after tenant, scope, and overlap validation.
 */
export async function createApprovalDelegation(input, options = {}) {
  const normalizedInput = normalizeCreateInput(input);
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;

  await assertTenantUserExists(
    normalizedInput.tenantId,
    normalizedInput.delegatorUserId,
    "delegatorUserId",
    runQuery
  );
  await assertTenantUserExists(
    normalizedInput.tenantId,
    normalizedInput.delegateUserId,
    "delegateUserId",
    runQuery
  );
  await assertTenantUserExists(
    normalizedInput.tenantId,
    normalizedInput.createdByUserId,
    "createdByUserId",
    runQuery
  );
  await assertDelegationScopeBelongsToTenant(
    normalizedInput.tenantId,
    {
      scopeType: normalizedInput.scopeType,
      scopeId: normalizedInput.scopeId,
    },
    runQuery
  );

  const overlapping = await listPotentiallyOverlappingDelegations(normalizedInput, runQuery);
  const duplicate = overlapping.find((row) =>
    dateRangesOverlap(
      row.effectiveFrom,
      row.effectiveTo,
      normalizedInput.effectiveFrom,
      normalizedInput.effectiveTo
    )
  );
  if (duplicate) {
    throw conflict("An overlapping approval delegation already exists for this delegator, delegate, module, and scope");
  }

  const insertRes = await runQuery(
    `INSERT INTO approval_delegations (
       tenant_id,
       delegator_user_id,
       delegate_user_id,
       module_code,
       scope_type,
       scope_id,
       effective_from,
       effective_to,
       note,
       is_active,
       created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      normalizedInput.tenantId,
      normalizedInput.delegatorUserId,
      normalizedInput.delegateUserId,
      normalizedInput.moduleCode,
      normalizedInput.scopeType,
      normalizedInput.scopeId,
      normalizedInput.effectiveFrom,
      normalizedInput.effectiveTo,
      normalizedInput.note,
      normalizedInput.createdByUserId,
    ]
  );

  return getApprovalDelegationById({
    tenantId: normalizedInput.tenantId,
    delegationId: parsePositiveInt(insertRes.rows?.insertId),
    runQuery,
  });
}

/**
 * Revoke one approval delegation row without deleting its audit history.
 */
export async function revokeApprovalDelegation(delegationId, input, options = {}) {
  const normalizedDelegationId = parsePositiveInt(delegationId);
  if (!normalizedDelegationId) {
    throw badRequest("delegationId is required");
  }

  const normalizedInput = normalizeRevokeInput(input);
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;

  await assertTenantUserExists(
    normalizedInput.tenantId,
    normalizedInput.revokedByUserId,
    "revokedByUserId",
    runQuery
  );

  const existing = await getApprovalDelegationRowById(
    normalizedDelegationId,
    normalizedInput.tenantId,
    runQuery,
    { forUpdate: true }
  );
  if (!existing) {
    throw notFound("Approval delegation not found");
  }

  if (!existing.isActive || existing.revokedAt) {
    return {
      idempotent: true,
      row: existing,
    };
  }

  await runQuery(
    `UPDATE approval_delegations
        SET is_active = 0,
            revoked_by_user_id = ?,
            revoked_reason = ?,
            revoked_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [
      normalizedInput.revokedByUserId,
      normalizedInput.revokedReason,
      normalizedInput.tenantId,
      normalizedDelegationId,
    ]
  );

  return {
    idempotent: false,
    row: await getApprovalDelegationById({
      tenantId: normalizedInput.tenantId,
      delegationId: normalizedDelegationId,
      runQuery,
    }),
  };
}

/**
 * Load one approval delegation row for admin/detail views.
 */
export async function getApprovalDelegationById({ tenantId, delegationId, runQuery = query }) {
  const row = await getApprovalDelegationRowById(delegationId, tenantId, runQuery);
  if (!row) {
    throw notFound("Approval delegation not found");
  }
  return row;
}

/**
 * Resolve one delegation id to its authoritative scope for RBAC route checks.
 */
export async function resolveApprovalDelegationScope(delegationId, tenantId, runQuery = query) {
  const row = await getApprovalDelegationRowById(delegationId, tenantId, runQuery);
  if (!row) {
    throw notFound("Approval delegation not found");
  }
  return {
    scopeType: row.scopeType,
    scopeId: row.scopeId,
  };
}

/**
 * List approval delegations for one tenant with optional delegate/delegator/module filters.
 */
export async function listApprovalDelegations(filters = {}, options = {}) {
  const tenantId = parsePositiveInt(filters.tenantId ?? filters.tenant_id);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const params = [tenantId];
  const where = ["d.tenant_id = ?"];
  const delegatorUserId = parsePositiveInt(filters.delegatorUserId ?? filters.delegator_user_id);
  const delegateUserId = parsePositiveInt(filters.delegateUserId ?? filters.delegate_user_id);
  const scopeType = filters.scopeType ?? filters.scope_type;
  const scopeId = parsePositiveInt(filters.scopeId ?? filters.scope_id);
  const activeOnly =
    filters.activeOnly === undefined
      ? false
      : Boolean(filters.activeOnly === true || String(filters.activeOnly).trim() === "true");

  if (delegatorUserId) {
    where.push("d.delegator_user_id = ?");
    params.push(delegatorUserId);
  }
  if (delegateUserId) {
    where.push("d.delegate_user_id = ?");
    params.push(delegateUserId);
  }
  const moduleCode = normalizeModuleCode(filters.moduleCode ?? filters.module_code, {
    allowNull: true,
  });
  if (moduleCode) {
    where.push("d.module_code = ?");
    params.push(moduleCode);
  }
  if (scopeType || scopeId) {
    const normalizedScope = normalizeApprovalPolicyAssignmentScope({ scopeType, scopeId });
    where.push("d.scope_type = ?");
    params.push(normalizedScope.scopeType);
    where.push("d.scope_id = ?");
    params.push(normalizedScope.scopeId);
  }
  if (activeOnly) {
    where.push("d.is_active = 1");
    where.push("d.revoked_at IS NULL");
  }

  const result = await runQuery(
    `SELECT
        d.*,
        delegator.name AS delegator_user_name,
        delegator.email AS delegator_user_email,
        delegate_user.name AS delegate_user_name,
        delegate_user.email AS delegate_user_email,
        created_by_user.name AS created_by_user_name,
        revoked_by_user.name AS revoked_by_user_name
       FROM approval_delegations d
       LEFT JOIN users delegator
         ON delegator.tenant_id = d.tenant_id
        AND delegator.id = d.delegator_user_id
       LEFT JOIN users delegate_user
         ON delegate_user.tenant_id = d.tenant_id
        AND delegate_user.id = d.delegate_user_id
       LEFT JOIN users created_by_user
         ON created_by_user.tenant_id = d.tenant_id
        AND created_by_user.id = d.created_by_user_id
       LEFT JOIN users revoked_by_user
         ON revoked_by_user.tenant_id = d.tenant_id
        AND revoked_by_user.id = d.revoked_by_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY d.id DESC`,
    params
  );
  return (result.rows || []).map(mapApprovalDelegationRow);
}

/**
 * Load one user's incoming and outgoing approval delegations for self-service
 * visibility without exposing tenant-wide admin delegation controls.
 */
export async function listUserApprovalDelegations(filters = {}, options = {}) {
  const tenantId = parsePositiveInt(filters.tenantId ?? filters.tenant_id);
  const userId = parsePositiveInt(filters.userId ?? filters.user_id);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  const moduleCode = normalizeModuleCode(filters.moduleCode ?? filters.module_code, {
    allowNull: true,
  });
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const [outgoing, incoming] = await Promise.all([
    listApprovalDelegations(
      {
        tenantId,
        delegatorUserId: userId,
        moduleCode,
      },
      { runQuery }
    ),
    listApprovalDelegations(
      {
        tenantId,
        delegateUserId: userId,
        moduleCode,
      },
      { runQuery }
    ),
  ]);

  return {
    outgoing,
    incoming,
  };
}

/**
 * Resolve one delegate actor into a concrete delegator authority at the request scope.
 *
 * The caller must pass the already-resolved request scope from the approval
 * request itself. This service never trusts arbitrary caller-supplied scope
 * values for decision authorization.
 */
export async function resolveApprovalDelegation({
  tenantId,
  actingUserId,
  moduleCode = null,
  permissionCode,
  requestScope,
  asOfDate = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedActingUserId = parsePositiveInt(actingUserId);
  const normalizedPermissionCode = String(permissionCode || "").trim();
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedActingUserId) {
    throw badRequest("actingUserId is required");
  }
  if (!normalizedPermissionCode) {
    throw badRequest("permissionCode is required");
  }
  const normalizedRequestScope = normalizeApprovalPolicyAssignmentScope(requestScope);
  const effectiveOn = parseDateOnly(asOfDate) || new Date().toISOString().slice(0, 10);
  const normalizedModuleCode = normalizeModuleCode(moduleCode, { allowNull: true });

  const result = await runQuery(
    `SELECT
        d.*,
        delegator.name AS delegator_user_name,
        delegator.email AS delegator_user_email,
        delegate_user.name AS delegate_user_name,
        delegate_user.email AS delegate_user_email,
        created_by_user.name AS created_by_user_name,
        revoked_by_user.name AS revoked_by_user_name
       FROM approval_delegations d
       LEFT JOIN users delegator
         ON delegator.tenant_id = d.tenant_id
        AND delegator.id = d.delegator_user_id
       LEFT JOIN users delegate_user
         ON delegate_user.tenant_id = d.tenant_id
        AND delegate_user.id = d.delegate_user_id
       LEFT JOIN users created_by_user
         ON created_by_user.tenant_id = d.tenant_id
        AND created_by_user.id = d.created_by_user_id
       LEFT JOIN users revoked_by_user
         ON revoked_by_user.tenant_id = d.tenant_id
        AND revoked_by_user.id = d.revoked_by_user_id
      WHERE d.tenant_id = ?
        AND d.delegate_user_id = ?
        AND d.is_active = 1
        AND d.revoked_at IS NULL
        AND (d.module_code IS NULL OR d.module_code = ?)
        AND (d.effective_from IS NULL OR d.effective_from <= ?)
        AND (d.effective_to IS NULL OR d.effective_to >= ?)
      ORDER BY d.id DESC`,
    [
      normalizedTenantId,
      normalizedActingUserId,
      normalizedModuleCode,
      effectiveOn,
      effectiveOn,
    ]
  );

  const candidates = [];
  for (const rawRow of result.rows || []) {
    const row = mapApprovalDelegationRow(rawRow);
    if (!row || !isActiveOn(row, effectiveOn)) {
      continue;
    }

    const scopeCoversRequest = await isApprovalScopeWithinBound({
      tenantId: normalizedTenantId,
      boundScope: {
        scopeType: row.scopeType,
        scopeId: row.scopeId,
      },
      childScope: normalizedRequestScope,
      runQuery,
    });
    if (!scopeCoversRequest) {
      continue;
    }

    const delegatorHasAuthority = await checkUserHasPermissionAtScope(
      row.delegatorUserId,
      normalizedTenantId,
      normalizedPermissionCode,
      normalizedRequestScope.scopeType,
      normalizedRequestScope.scopeId,
      { runQuery, asOfDate: effectiveOn }
    );
    if (!delegatorHasAuthority) {
      continue;
    }

    candidates.push(row);
  }

  candidates.sort((left, right) => {
    const moduleSpecificityDiff =
      Number(Boolean(right.moduleCode)) - Number(Boolean(left.moduleCode));
    if (moduleSpecificityDiff !== 0) {
      return moduleSpecificityDiff;
    }
    const scopeDiff = scopeRank(right.scopeType) - scopeRank(left.scopeType);
    if (scopeDiff !== 0) {
      return scopeDiff;
    }
    return Number(right.id || 0) - Number(left.id || 0);
  });

  return candidates[0] || null;
}

export default {
  createApprovalDelegation,
  revokeApprovalDelegation,
  getApprovalDelegationById,
  resolveApprovalDelegationScope,
  listApprovalDelegations,
  listUserApprovalDelegations,
  resolveApprovalDelegation,
};
