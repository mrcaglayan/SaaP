import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import router from "../src/routes/rbac.js";
import { evaluateAccessCheck } from "../src/services/rbac.diagnostics.service.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function expectThrow(asyncFn, expectedStatus) {
  let thrown = null;
  try {
    await asyncFn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, "Expected function to throw");
  assert.equal(Number(thrown.status || 0), expectedStatus);
  return thrown;
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
    `Expected all requested permissions for ${roleCode}`
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

async function loadRoleIdByCode(tenantId, roleCode) {
  const result = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  return parsePositiveInt(result.rows?.[0]?.id);
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
      )
     VALUES (?, ?, ?, ?, ?, 'ALLOW')`,
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
  assert(countryId, "Expected one seeded country");

  const tenantInsert = await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [`PR5B_${uniqueSuffix}`, `PR5B Tenant ${uniqueSuffix}`]
  );
  const tenantId = parsePositiveInt(tenantInsert.rows?.insertId);
  assert(tenantId, "Expected tenant insert id");

  await seedCore();

  const groupInsert = await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `GRP${uniqueSuffix}`, "PR5B Group"]
  );
  const groupCompanyId = parsePositiveInt(groupInsert.rows?.insertId);
  assert(groupCompanyId, "Expected group company id");

  const entityOneInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, `LEA${uniqueSuffix}`, "PR5B Entity A", countryId, currencyCode]
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
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, `LEB${uniqueSuffix}`, "PR5B Entity B", countryId, currencyCode]
  );
  const legalEntityTwoId = parsePositiveInt(entityTwoInsert.rows?.insertId);
  assert(legalEntityOneId && legalEntityTwoId, "Expected two legal entities");

  const subjectInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5b-subject-${uniqueSuffix}@example.com`, "x", "PR5B Subject"]
  );
  const subjectUserId = parsePositiveInt(subjectInsert.rows?.insertId);
  const adminInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5b-admin-${uniqueSuffix}@example.com`, "x", "PR5B Admin"]
  );
  const adminUserId = parsePositiveInt(adminInsert.rows?.insertId);
  const outsiderInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5b-outsider-${uniqueSuffix}@example.com`, "x", "PR5B Outsider"]
  );
  const outsiderUserId = parsePositiveInt(outsiderInsert.rows?.insertId);
  assert(subjectUserId && adminUserId && outsiderUserId, "Expected test users");

  const subjectRoleId = await createRoleWithPermissions(tenantId, "PR5B_SUBJECT_ROLE", [
    "payments.batch.approve",
    "bank.accounts.read",
  ]);
  await assignRole({
    tenantId,
    userId: subjectUserId,
    roleId: subjectRoleId,
    scopeType: "TENANT",
    scopeId: tenantId,
  });

  await query(
    `INSERT INTO data_scopes (
        tenant_id,
        user_id,
        scope_type,
        scope_id,
        effect,
        created_by_user_id
      )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, 'ALLOW', ?)`,
    [tenantId, subjectUserId, legalEntityOneId, adminUserId]
  );

  const securityAdminRoleId = await loadRoleIdByCode(tenantId, "SecurityAdmin");
  assert(securityAdminRoleId, "SecurityAdmin role must be seeded");
  await assignRole({
    tenantId,
    userId: adminUserId,
    roleId: securityAdminRoleId,
    scopeType: "TENANT",
    scopeId: tenantId,
  });

  const selfCheckResult = await evaluateAccessCheck({
    tenantId,
    actorUserId: subjectUserId,
    permissionCode: "payments.batch.approve",
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityTwoId,
    moduleCode: "BANK",
    objectType: "bank_account",
    fieldName: "iban",
    actionCode: "payments.batch.approve",
    recordType: "PAYMENT_BATCH",
    recordId: 5001,
    sodContext: {
      actorUserIds: {
        createdByUserId: subjectUserId,
      },
    },
    businessState: {
      allowed: false,
      statusCode: "PERIOD_CLOSED",
      message: "Period is closed for posting.",
      blockers: [{ code: "PERIOD_CLOSED", message: "Period is closed." }],
    },
  });

  assert.equal(selfCheckResult.selfCheck, true);
  assert.equal(selfCheckResult.targetUserId, subjectUserId);
  assert.equal(selfCheckResult.layers.capability.status, "PASS");
  assert.equal(selfCheckResult.layers.scopeEntitlement.status, "PASS");
  assert.equal(selfCheckResult.layers.visibilityPolicy.status, "FAIL");
  assert.equal(selfCheckResult.layers.fieldVisibility.status, "FAIL");
  assert.equal(selfCheckResult.layers.sod.status, "FAIL");
  assert.equal(selfCheckResult.layers.businessState.status, "FAIL");
  assert.equal(selfCheckResult.layers.workflow.status, "NOT_APPLICABLE");
  assert.equal(selfCheckResult.decision.status, "FAIL");
  assert.equal(selfCheckResult.entitlements.isVisibilityNarrowed, true);
  assert.equal(
    selfCheckResult.layers.fieldVisibility.details?.policy?.requiredPermissionCode,
    "security.sensitive_data.audit.read"
  );

  const missingPermissionResult = await evaluateAccessCheck({
    tenantId,
    actorUserId: subjectUserId,
    permissionCode: "security.admin.system",
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityOneId,
  });
  assert.equal(missingPermissionResult.layers.capability.status, "FAIL");
  assert.equal(missingPermissionResult.layers.scopeEntitlement.status, "SKIPPED");
  assert.equal(missingPermissionResult.layers.visibilityPolicy.status, "SKIPPED");

  await expectThrow(
    () =>
      evaluateAccessCheck({
        tenantId,
        actorUserId: outsiderUserId,
        targetUserId: subjectUserId,
        permissionCode: "payments.batch.approve",
        scopeType: "LEGAL_ENTITY",
        scopeId: legalEntityOneId,
      }),
    403
  );

  const adminDebugResult = await evaluateAccessCheck({
    tenantId,
    actorUserId: adminUserId,
    targetUserId: subjectUserId,
    permissionCode: "payments.batch.approve",
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityOneId,
  });
  assert.equal(adminDebugResult.selfCheck, false);
  assert.equal(adminDebugResult.targetUserId, subjectUserId);
  assert.equal(adminDebugResult.layers.capability.status, "PASS");
  assert.equal(adminDebugResult.layers.scopeEntitlement.status, "PASS");
  assert.equal(adminDebugResult.layers.visibilityPolicy.status, "PASS");

  const accessCheckRoute = (router.stack || []).find(
    (layer) => layer?.route?.path === "/access-check" && layer.route.methods?.post
  );
  assert(accessCheckRoute, "RBAC router must expose POST /access-check");

  console.log("PR-5B verification passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
