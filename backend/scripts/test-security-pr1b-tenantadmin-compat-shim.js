import bcrypt from "bcrypt";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  canBootstrapTenant,
  canManageOps,
  canManageSecurity,
  ensureCompatibilitySystemRolesForTenant,
  getTenantRoleIdsByCode,
  LEGACY_TENANT_ADMIN_ROLE_CODE,
  SECURITY_ADMIN_ROLE_CODE,
  SYSTEM_ADMIN_ROLE_CODE,
} from "../src/services/systemRoles.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function createTenant(tenantCode) {
  await query(
    `INSERT INTO tenants (code, name, status)
     VALUES (?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       status = VALUES(status)`,
    [tenantCode, tenantCode]
  );

  const tenantResult = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toPositiveInt(tenantResult.rows[0]?.id);
  assert(tenantId, `Failed to resolve tenant ${tenantCode}`);
  return tenantId;
}

async function createUser(tenantId, email, name) {
  const passwordHash = await bcrypt.hash("compat-pass-123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       tenant_id = VALUES(tenant_id),
       password_hash = VALUES(password_hash),
       name = VALUES(name),
       status = VALUES(status)`,
    [tenantId, email, passwordHash, name]
  );

  const result = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toPositiveInt(result.rows[0]?.id);
  assert(userId, `Failed to resolve user ${email}`);
  return userId;
}

async function assignTenantRoleByCode(tenantId, userId, roleCode) {
  const roleIdsByCode = await getTenantRoleIdsByCode(tenantId, [roleCode]);
  const roleId = roleIdsByCode.get(roleCode);
  assert(roleId, `Role ${roleCode} not found for tenant ${tenantId}`);

  await query(
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
    [tenantId, userId, roleId, tenantId]
  );
}

async function getPermissionCodesByRole(tenantId, roleCodes) {
  const result = await query(
    `SELECT r.code AS role_code, p.code AS permission_code
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.tenant_id = ?
       AND r.code IN (${roleCodes.map(() => "?").join(", ")})
     ORDER BY r.code, p.code`,
    [tenantId, ...roleCodes]
  );

  const permissionCodesByRole = new Map();
  for (const roleCode of roleCodes) {
    permissionCodesByRole.set(roleCode, new Set());
  }
  for (const row of result.rows || []) {
    if (!permissionCodesByRole.has(row.role_code)) {
      permissionCodesByRole.set(row.role_code, new Set());
    }
    permissionCodesByRole.get(row.role_code).add(String(row.permission_code || ""));
  }
  return permissionCodesByRole;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(`PR1B_COMPAT_${stamp}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const bootstrapRoleCodes = [SECURITY_ADMIN_ROLE_CODE, SYSTEM_ADMIN_ROLE_CODE];
  const bootstrapRoleIdsByCode = await getTenantRoleIdsByCode(tenantId, bootstrapRoleCodes);
  for (const roleCode of bootstrapRoleCodes) {
    assert(bootstrapRoleIdsByCode.get(roleCode), `Missing compatibility role ${roleCode}`);
  }

  assert(
    !(await getTenantRoleIdsByCode(tenantId, [LEGACY_TENANT_ADMIN_ROLE_CODE])).get(
      LEGACY_TENANT_ADMIN_ROLE_CODE
    ),
    "Fresh tenants should not seed TenantAdmin by default after PR-6A"
  );

  await ensureCompatibilitySystemRolesForTenant(tenantId, {
    includeLegacyTenantAdmin: true,
  });

  const compatibilityRoleCodes = [
    LEGACY_TENANT_ADMIN_ROLE_CODE,
    SECURITY_ADMIN_ROLE_CODE,
    SYSTEM_ADMIN_ROLE_CODE,
  ];
  const roleIdsByCode = await getTenantRoleIdsByCode(tenantId, compatibilityRoleCodes);
  for (const roleCode of compatibilityRoleCodes) {
    assert(roleIdsByCode.get(roleCode), `Missing compatibility role ${roleCode}`);
  }

  const permissionCodesByRole = await getPermissionCodesByRole(
    tenantId,
    compatibilityRoleCodes
  );
  assert(
    permissionCodesByRole.get(SECURITY_ADMIN_ROLE_CODE)?.has("security.role.read"),
    "SecurityAdmin should include security.role.read"
  );
  assert(
    permissionCodesByRole.get(SECURITY_ADMIN_ROLE_CODE)?.has("org.tree.read"),
    "SecurityAdmin should include org.tree.read"
  );
  assert(
    !permissionCodesByRole.get(SECURITY_ADMIN_ROLE_CODE)?.has("security.admin.system"),
    "SecurityAdmin should not include security.admin.system"
  );
  assert(
    !permissionCodesByRole.get(SECURITY_ADMIN_ROLE_CODE)?.has("gl.journal.post"),
    "SecurityAdmin should not include gl.journal.post"
  );
  assert(
    permissionCodesByRole.get(SYSTEM_ADMIN_ROLE_CODE)?.has("ops.dashboard.read"),
    "SystemAdmin should include ops.dashboard.read"
  );
  assert(
    permissionCodesByRole.get(SYSTEM_ADMIN_ROLE_CODE)?.has("onboarding.company.setup"),
    "SystemAdmin should include onboarding.company.setup"
  );
  assert(
    permissionCodesByRole.get(SYSTEM_ADMIN_ROLE_CODE)?.has("security.admin.system"),
    "SystemAdmin should include security.admin.system"
  );
  assert(
    !permissionCodesByRole.get(SYSTEM_ADMIN_ROLE_CODE)?.has("gl.journal.post"),
    "SystemAdmin should not include gl.journal.post"
  );
  assert(
    permissionCodesByRole.get(LEGACY_TENANT_ADMIN_ROLE_CODE)?.has("gl.journal.post"),
    "TenantAdmin should remain the compatibility full-access role"
  );

  const securityAdminUserId = await createUser(
    tenantId,
    `security-admin-${stamp}@example.com`,
    "Security Admin"
  );
  const systemAdminUserId = await createUser(
    tenantId,
    `system-admin-${stamp}@example.com`,
    "System Admin"
  );
  const tenantAdminUserId = await createUser(
    tenantId,
    `tenant-admin-${stamp}@example.com`,
    "Tenant Admin"
  );

  await assignTenantRoleByCode(tenantId, securityAdminUserId, SECURITY_ADMIN_ROLE_CODE);
  await assignTenantRoleByCode(tenantId, systemAdminUserId, SYSTEM_ADMIN_ROLE_CODE);
  await assignTenantRoleByCode(tenantId, tenantAdminUserId, LEGACY_TENANT_ADMIN_ROLE_CODE);

  assert(
    await canManageSecurity(securityAdminUserId, tenantId),
    "SecurityAdmin should pass canManageSecurity"
  );
  assert(
    !(await canManageOps(securityAdminUserId, tenantId)),
    "SecurityAdmin should not pass canManageOps"
  );
  assert(
    !(await canBootstrapTenant(securityAdminUserId, tenantId)),
    "SecurityAdmin should not pass canBootstrapTenant"
  );

  assert(
    !(await canManageSecurity(systemAdminUserId, tenantId)),
    "SystemAdmin should not pass canManageSecurity"
  );
  assert(
    await canManageOps(systemAdminUserId, tenantId),
    "SystemAdmin should pass canManageOps"
  );
  assert(
    await canBootstrapTenant(systemAdminUserId, tenantId),
    "SystemAdmin should pass canBootstrapTenant"
  );

  assert(
    await canManageSecurity(tenantAdminUserId, tenantId),
    "TenantAdmin should still pass canManageSecurity"
  );
  assert(
    await canManageOps(tenantAdminUserId, tenantId),
    "TenantAdmin should still pass canManageOps"
  );
  assert(
    await canBootstrapTenant(tenantAdminUserId, tenantId),
    "TenantAdmin should still pass canBootstrapTenant"
  );

  const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const securityRouteSource = await readFile(
    path.resolve(backendRoot, "src/routes/security.js"),
    "utf8"
  );
  assert(
    securityRouteSource.includes("canManageSecurity"),
    "security.js should use canManageSecurity helper"
  );
  assert(
    !securityRouteSource.includes("Only TenantAdmin can manage system role assignments"),
    "security.js should not keep TenantAdmin-only system role messaging"
  );

  const providerRouteSource = await readFile(
    path.resolve(backendRoot, "src/routes/provider.js"),
    "utf8"
  );
  assert(
    providerRouteSource.includes("ensureCompatibilitySystemRolesForTenant"),
    "provider.js should initialize compatibility system roles"
  );

  console.log("PR-1B TenantAdmin compatibility shim test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
  });
