import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { loadFieldVisibilityPolicies } from "../src/middleware/fieldVisibility.js";
import { seedCore } from "../src/seedCore.js";
import {
  assertFieldVisibilityPolicyPermission,
  createFieldVisibilityPolicy,
  deactivateFieldVisibilityPolicy,
  listFieldVisibilityPolicies,
  listFieldVisibilityPoliciesForActor,
  updateFieldVisibilityPolicy,
} from "../src/services/fieldVisibilityPolicies.service.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function createRoleWithPermissions(tenantId, roleCode, permissionCodes) {
  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [tenantId, roleCode, roleCode]
  );
  const roleResult = await query(
    `SELECT id
       FROM roles
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = parsePositiveInt(roleResult.rows?.[0]?.id);
  assert(roleId, `Role ${roleCode} must exist`);

  await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
  const permissionResult = await query(
    `SELECT id, code
       FROM permissions
      WHERE code IN (${permissionCodes.map(() => "?").join(", ")})`,
    permissionCodes
  );
  assert.equal(
    (permissionResult.rows || []).length,
    permissionCodes.length,
    `All permissions for ${roleCode} must exist`
  );
  for (const permissionRow of permissionResult.rows || []) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, permissionRow.id]
    );
  }
  return roleId;
}

async function assignRole({
  tenantId,
  userId,
  roleId,
  scopeType,
  scopeId,
}) {
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
      ) VALUES (?, ?, ?, ?, ?, 'ALLOW')`,
    [tenantId, userId, roleId, scopeType, scopeId]
  );
}

async function main() {
  const uniqueSuffix = Date.now();

  await seedCore();

  const countryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      ORDER BY id
      LIMIT 1`
  );
  const countryId = parsePositiveInt(countryResult.rows?.[0]?.id);
  const currencyCode = String(countryResult.rows?.[0]?.default_currency_code || "USD");
  assert(countryId, "Seeded country is required for PR-6E verification");

  const tenantInsert = await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [`PR6E_${uniqueSuffix}`, `PR6E Tenant ${uniqueSuffix}`]
  );
  const tenantId = parsePositiveInt(tenantInsert.rows?.insertId);
  assert(tenantId, "Expected tenant insert id");

  const groupInsert = await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `GRP${uniqueSuffix}`, "PR6E Group"]
  );
  const groupCompanyId = parsePositiveInt(groupInsert.rows?.insertId);
  assert(groupCompanyId, "Expected group company insert id");

  const entityOneInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, `LEA${uniqueSuffix}`, "PR6E LE A", countryId, currencyCode]
  );
  const legalEntityOneId = parsePositiveInt(entityOneInsert.rows?.insertId);
  const entityTwoInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, `LEB${uniqueSuffix}`, "PR6E LE B", countryId, currencyCode]
  );
  const legalEntityTwoId = parsePositiveInt(entityTwoInsert.rows?.insertId);
  assert(legalEntityOneId && legalEntityTwoId, "Expected legal entities");

  const tenantAdminUserInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr6e-admin-${uniqueSuffix}@example.com`, "x", "PR6E Tenant Admin"]
  );
  const tenantAdminUserId = parsePositiveInt(tenantAdminUserInsert.rows?.insertId);
  const scopedUserInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr6e-scoped-${uniqueSuffix}@example.com`, "x", "PR6E Scoped Admin"]
  );
  const scopedUserId = parsePositiveInt(scopedUserInsert.rows?.insertId);
  assert(tenantAdminUserId && scopedUserId, "Expected tenant admin and scoped users");

  await seedCore();

  const tenantWriterRoleId = await createRoleWithPermissions(tenantId, "PR6E_TENANT_FIELD_ADMIN", [
    "security.field_visibility.read",
    "security.field_visibility.write",
  ]);
  const scopedWriterRoleId = await createRoleWithPermissions(tenantId, "PR6E_SCOPED_FIELD_ADMIN", [
    "security.field_visibility.read",
    "security.field_visibility.write",
  ]);

  await assignRole({
    tenantId,
    userId: tenantAdminUserId,
    roleId: tenantWriterRoleId,
    scopeType: "TENANT",
    scopeId: tenantId,
  });
  await assignRole({
    tenantId,
    userId: scopedUserId,
    roleId: scopedWriterRoleId,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityOneId,
  });

  const leOnePolicy = await createFieldVisibilityPolicy({
    tenantId,
    actorUserId: tenantAdminUserId,
    input: {
      moduleCode: "BANK",
      objectType: "BANK_ACCOUNT",
      fieldName: "swift_code",
      visibilityRule: "MASKED",
      appliesToScopeType: "LEGAL_ENTITY",
      appliesToScopeId: legalEntityOneId,
      requiredPermissionCode: "security.sensitive_data.audit.read",
      isActive: true,
    },
  });
  const leTwoPolicy = await createFieldVisibilityPolicy({
    tenantId,
    actorUserId: tenantAdminUserId,
    input: {
      moduleCode: "BANK",
      objectType: "BANK_ACCOUNT",
      fieldName: "swift_code",
      visibilityRule: "HIDDEN",
      appliesToScopeType: "LEGAL_ENTITY",
      appliesToScopeId: legalEntityTwoId,
      requiredPermissionCode: "security.sensitive_data.audit.read",
      isActive: true,
    },
  });
  assert(leOnePolicy?.id && leTwoPolicy?.id, "Expected custom field visibility policies");

  const scopedVisiblePolicies = await listFieldVisibilityPoliciesForActor({
    actorUserId: scopedUserId,
    tenantId,
    includeInactive: true,
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
    fieldName: "swift_code",
  });
  assert.equal(scopedVisiblePolicies.length, 1, "Scoped admin should only see LE1 policy");
  assert.equal(scopedVisiblePolicies[0].appliesToScopeId, legalEntityOneId);

  await assert.rejects(
    async () =>
      assertFieldVisibilityPolicyPermission({
        actorUserId: scopedUserId,
        tenantId,
        permissionCode: "security.field_visibility.write",
        policyOrScope: {
          scopeType: "LEGAL_ENTITY",
          scopeId: legalEntityTwoId,
        },
      }),
    (err) => Number(err?.status) === 403
  );

  const cachedBeforeUpdate = await loadFieldVisibilityPolicies({
    tenantId,
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
  });
  const cachedRowBeforeUpdate = cachedBeforeUpdate.find(
    (row) => row.fieldName === "swift_code" && row.appliesToScopeId === legalEntityOneId
  );
  assert.equal(cachedRowBeforeUpdate?.visibilityRule, "MASKED");

  const updatedPolicy = await updateFieldVisibilityPolicy({
    tenantId,
    policyId: leOnePolicy.id,
    input: {
      visibilityRule: "LAST_4",
      requiredPermissionCode: "payroll.sensitive.read",
    },
  });
  assert.equal(updatedPolicy?.visibilityRule, "LAST_4");
  assert.equal(updatedPolicy?.requiredPermissionCode, "payroll.sensitive.read");

  const cachedAfterUpdate = await loadFieldVisibilityPolicies({
    tenantId,
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
  });
  const cachedRowAfterUpdate = cachedAfterUpdate.find(
    (row) => row.fieldName === "swift_code" && row.appliesToScopeId === legalEntityOneId
  );
  assert.equal(
    cachedRowAfterUpdate?.visibilityRule,
    "LAST_4",
    "Policy cache should reflect the updated rule after admin change"
  );

  const deactivatedPolicy = await deactivateFieldVisibilityPolicy({
    tenantId,
    policyId: leOnePolicy.id,
  });
  assert.equal(deactivatedPolicy?.isActive, false, "Deactivation should soft-disable the policy");

  const activePoliciesAfterDeactivate = await loadFieldVisibilityPolicies({
    tenantId,
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
  });
  const stillActiveLeOnePolicy = activePoliciesAfterDeactivate.find(
    (row) => row.fieldName === "swift_code" && row.appliesToScopeId === legalEntityOneId
  );
  assert.equal(
    stillActiveLeOnePolicy,
    undefined,
    "Inactive policy should disappear from the runtime loader"
  );

  const allPoliciesIncludingInactive = await listFieldVisibilityPolicies({
    tenantId,
    includeInactive: true,
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
    fieldName: "swift_code",
  });
  assert.equal(allPoliciesIncludingInactive.length, 2);
  assert.equal(
    allPoliciesIncludingInactive.find((row) => row.id === leOnePolicy.id)?.isActive,
    false,
    "Inactive policy should stay visible in admin list mode"
  );

  console.log("PR-6E field visibility policy administration verification passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
