import { query } from "../db.js";
import { getUserRoleScopeEffectiveDateGuard } from "./authz.scope.service.js";

export const SECURITY_ADMIN_ROLE_CODE = "SecurityAdmin";
export const SYSTEM_ADMIN_ROLE_CODE = "SystemAdmin";

export const SECURITY_ADMIN_ROLE_NAME = "Security Administrator";
export const SYSTEM_ADMIN_ROLE_NAME = "System Administrator";

const SECURITY_ADMIN_EXCLUDED_PERMISSION_CODES = new Set([
  "security.admin.system",
  "org.shareholder.upsert",
  "org.shareholder.capital_fulfillment.upsert",
]);

const SYSTEM_ADMIN_ADDITIONAL_PERMISSION_CODES = new Set([
  "security.admin.system",
  "workflow.definition.read",
  "workflow.definition.write",
  "workflow.assignment.read",
  "workflow.assignment.write",
  "approvals.policies.read",
  "approvals.policies.write",
  "approvals.requests.read",
  "approvals.requests.submit",
  "approvals.requests.approve",
  "approvals.requests.reject",
]);

const DEFAULT_BOOTSTRAP_ROLE_CODES = Object.freeze([
  SECURITY_ADMIN_ROLE_CODE,
  SYSTEM_ADMIN_ROLE_CODE,
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function isSecurityAdminPermission(permissionCode) {
  const normalizedPermissionCode = String(permissionCode || "").trim();
  if (!normalizedPermissionCode) {
    return false;
  }
  if (SECURITY_ADMIN_EXCLUDED_PERMISSION_CODES.has(normalizedPermissionCode)) {
    return false;
  }
  return (
    normalizedPermissionCode.startsWith("security.") ||
    normalizedPermissionCode.startsWith("org.")
  );
}

function isSystemAdminPermission(permissionCode) {
  const normalizedPermissionCode = String(permissionCode || "").trim();
  if (!normalizedPermissionCode) {
    return false;
  }
  return (
    normalizedPermissionCode.startsWith("ops.") ||
    normalizedPermissionCode.startsWith("onboarding.") ||
    SYSTEM_ADMIN_ADDITIONAL_PERMISSION_CODES.has(normalizedPermissionCode)
  );
}

async function loadPermissionIdsByCode(runQuery = query) {
  const result = await runQuery(
    `SELECT id, code
     FROM permissions
     ORDER BY id`,
  );

  const permissionIdByCode = new Map();
  for (const row of result.rows || []) {
    const permissionId = parsePositiveInt(row?.id);
    const permissionCode = String(row?.code || "").trim();
    if (permissionId && permissionCode) {
      permissionIdByCode.set(permissionCode, permissionId);
    }
  }
  return permissionIdByCode;
}

/**
 * Builds the fresh system-role catalog from the live permission set.
 */
export function buildSystemRoleDefinitions(permissionCodes = []) {
  const normalizedPermissionCodes = normalizeUniqueStrings(permissionCodes);

  return [
    {
      code: SECURITY_ADMIN_ROLE_CODE,
      name: SECURITY_ADMIN_ROLE_NAME,
      permissions: normalizedPermissionCodes.filter(isSecurityAdminPermission),
    },
    {
      code: SYSTEM_ADMIN_ROLE_CODE,
      name: SYSTEM_ADMIN_ROLE_NAME,
      permissions: normalizedPermissionCodes.filter(isSystemAdminPermission),
    },
  ];
}

/**
 * Returns the fresh role codes assigned to bootstrap admins.
 */
export function getBootstrapRoleCodes() {
  return [...DEFAULT_BOOTSTRAP_ROLE_CODES];
}

/**
 * Resolves tenant role ids for the requested role codes.
 */
export async function getTenantRoleIdsByCode(
  tenantId,
  roleCodes,
  runQuery = query,
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRoleCodes = normalizeUniqueStrings(roleCodes);
  if (!normalizedTenantId || normalizedRoleCodes.length === 0) {
    return new Map();
  }

  const result = await runQuery(
    `SELECT id, code
     FROM roles
     WHERE tenant_id = ?
       AND code IN (${normalizedRoleCodes.map(() => "?").join(", ")})`,
    [normalizedTenantId, ...normalizedRoleCodes],
  );

  const roleIdsByCode = new Map();
  for (const row of result.rows || []) {
    const roleId = parsePositiveInt(row?.id);
    const roleCode = String(row?.code || "").trim();
    if (roleId && roleCode) {
      roleIdsByCode.set(roleCode, roleId);
    }
  }
  return roleIdsByCode;
}

/**
 * Ensures fresh system roles exist for a tenant and have their permission bindings.
 */
export async function ensureSystemRolesForTenant(tenantId, options = {}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw new Error("tenantId is required to initialize system roles");
  }

  const runQuery = typeof options.runQuery === "function" ? options.runQuery : query;
  const permissionIdByCode =
    options.permissionIdByCode instanceof Map
      ? options.permissionIdByCode
      : await loadPermissionIdsByCode(runQuery);

  if (permissionIdByCode.size === 0) {
    throw new Error(
      "Permissions catalog is empty. Run core seed before initializing system roles.",
    );
  }

  const roleDefinitions = buildSystemRoleDefinitions(
    Array.from(permissionIdByCode.keys()),
  );

  for (const roleDefinition of roleDefinitions) {
    await runQuery(
      `INSERT INTO roles (tenant_id, code, name, is_system)
       VALUES (?, ?, ?, TRUE)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_system = VALUES(is_system)`,
      [normalizedTenantId, roleDefinition.code, roleDefinition.name],
    );
  }

  const roleIdsByCode = await getTenantRoleIdsByCode(
    normalizedTenantId,
    roleDefinitions.map((roleDefinition) => roleDefinition.code),
    runQuery,
  );

  for (const roleDefinition of roleDefinitions) {
    const roleId = roleIdsByCode.get(roleDefinition.code);
    if (!roleId) {
      throw new Error(`Failed to initialize system role ${roleDefinition.code}`);
    }

    for (const permissionCode of roleDefinition.permissions) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(
          `Permission ${permissionCode} is missing for system role ${roleDefinition.code}`,
        );
      }

      await runQuery(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         VALUES (?, ?)`,
        [roleId, permissionId],
      );
    }
  }

  return roleIdsByCode;
}

/**
 * Assigns the fresh bootstrap roles to a tenant user at tenant scope.
 */
export async function assignBootstrapRolesToUser(
  tenantId,
  userId,
  options = {},
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedTenantId || !normalizedUserId) {
    throw new Error("tenantId and userId are required to assign bootstrap roles");
  }

  const runQuery = typeof options.runQuery === "function" ? options.runQuery : query;
  const roleIdsByCode =
    options.roleIdsByCode instanceof Map
      ? options.roleIdsByCode
      : await getTenantRoleIdsByCode(
          normalizedTenantId,
          getBootstrapRoleCodes(),
          runQuery,
        );

  for (const roleCode of getBootstrapRoleCodes()) {
    const roleId = roleIdsByCode.get(roleCode);
    if (!roleId) {
      throw new Error(`Role ${roleCode} is not configured for tenant ${normalizedTenantId}`);
    }

    await runQuery(
      `INSERT INTO user_role_scopes (
          tenant_id,
          user_id,
          role_id,
          scope_type,
          scope_id,
          effect
       )
       VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
       ON DUPLICATE KEY UPDATE
         effect = VALUES(effect)`,
      [normalizedTenantId, normalizedUserId, roleId, normalizedTenantId],
    );
  }

  return roleIdsByCode;
}

async function userHasTenantRole(userId, tenantId, roleCodes, runQuery = query) {
  const normalizedUserId = parsePositiveInt(userId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRoleCodes = normalizeUniqueStrings(roleCodes);

  if (
    !normalizedUserId ||
    !normalizedTenantId ||
    normalizedRoleCodes.length === 0
  ) {
    return false;
  }

  const effectiveGuard = await getUserRoleScopeEffectiveDateGuard(runQuery);

  const result = await runQuery(
    `SELECT 1
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     WHERE urs.user_id = ?
       AND urs.tenant_id = ?
       AND urs.scope_type = 'TENANT'
       AND urs.scope_id = ?
       AND urs.effect = 'ALLOW'
       AND r.tenant_id = ?
       AND r.code IN (${normalizedRoleCodes.map(() => "?").join(", ")})${effectiveGuard.sql}
     LIMIT 1`,
    [
      normalizedUserId,
      normalizedTenantId,
      normalizedTenantId,
      normalizedTenantId,
      ...normalizedRoleCodes,
      ...effectiveGuard.params,
    ],
  );

  return Boolean(result.rows?.[0]);
}

/**
 * Returns true when the user can manage security-admin seams for the tenant.
 */
export async function canManageSecurity(userId, tenantId, runQuery = query) {
  return userHasTenantRole(
    userId,
    tenantId,
    [SECURITY_ADMIN_ROLE_CODE],
    runQuery,
  );
}

/**
 * Returns true when the user can manage ops/admin seams for the tenant.
 */
export async function canManageOps(userId, tenantId, runQuery = query) {
  return userHasTenantRole(
    userId,
    tenantId,
    [SYSTEM_ADMIN_ROLE_CODE],
    runQuery,
  );
}

/**
 * Returns true when the user can run tenant bootstrap/admin setup flows.
 */
export async function canBootstrapTenant(userId, tenantId, runQuery = query) {
  return userHasTenantRole(
    userId,
    tenantId,
    [SYSTEM_ADMIN_ROLE_CODE],
    runQuery,
  );
}
