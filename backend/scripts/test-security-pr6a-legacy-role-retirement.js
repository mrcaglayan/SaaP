import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  assignCompatibilityBootstrapRolesToUser,
  getTenantRoleIdsByCode,
  SECURITY_ADMIN_ROLE_CODE,
  SYSTEM_ADMIN_ROLE_CODE,
} from "../src/services/systemRoles.service.js";

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

  const result = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toPositiveInt(result.rows[0]?.id);
  assert(tenantId, `Failed to resolve tenant ${tenantCode}`);
  return tenantId;
}

async function createUser(tenantId, email) {
  const passwordHash = await bcrypt.hash("pr6a-pass-123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, email]
  );
  const result = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  return toPositiveInt(result.rows[0]?.id);
}

async function loadRoleCodesForTenant(tenantId) {
  const result = await query(
    `SELECT code
     FROM roles
     WHERE tenant_id = ?
     ORDER BY code`,
    [tenantId]
  );
  return new Set((result.rows || []).map((row) => String(row.code || "").trim()));
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(`PR6A_${stamp}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const freshRoleCodes = await loadRoleCodesForTenant(tenantId);
  for (const retiredRoleCode of [
    "TenantAdmin",
    "GroupController",
    "CountryController",
    "EntityAccountant",
    "APDocumentPoster",
  ]) {
    assert(
      !freshRoleCodes.has(retiredRoleCode),
      `Fresh tenant should not seed retired role ${retiredRoleCode}`
    );
  }

  const userId = await createUser(tenantId, `pr6a-${stamp}@example.com`);
  const bootstrapRoleIds = await assignCompatibilityBootstrapRolesToUser(tenantId, userId);
  assert.deepEqual(
    [...bootstrapRoleIds.keys()].sort(),
    [SECURITY_ADMIN_ROLE_CODE, SYSTEM_ADMIN_ROLE_CODE].sort(),
    "Fresh bootstrap should assign only SecurityAdmin and SystemAdmin"
  );

  const assignmentResult = await query(
    `SELECT r.code
     FROM user_role_scopes urs
     JOIN roles r
       ON r.id = urs.role_id
      AND r.tenant_id = urs.tenant_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?
     ORDER BY r.code`,
    [tenantId, userId]
  );
  assert.deepEqual(
    (assignmentResult.rows || []).map((row) => row.code),
    [SECURITY_ADMIN_ROLE_CODE, SYSTEM_ADMIN_ROLE_CODE].sort(),
    "Fresh bootstrap assignments should not include TenantAdmin"
  );

  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, 'TenantAdmin', 'Tenant Administrator', TRUE)`,
    [tenantId]
  );
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const retainedRoleIds = await getTenantRoleIdsByCode(tenantId, ["TenantAdmin"]);
  const retainedRoleId = retainedRoleIds.get("TenantAdmin");
  assert(retainedRoleId, "Existing retired TenantAdmin row should remain recoverable on reseed");

  const retainedPermissionResult = await query(
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?
       AND p.code = 'gl.journal.post'
     LIMIT 1`,
    [retainedRoleId]
  );
  assert(
    retainedPermissionResult.rows?.[0]?.code === "gl.journal.post",
    "Retained TenantAdmin should recover its legacy compatibility permission set on reseed"
  );

  console.log("test-security-pr6a-legacy-role-retirement passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
