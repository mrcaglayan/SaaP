import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createRoleMigrationPreviewRun,
  executeRoleMigrationRun,
  isRoleLegacyDisabled,
  rollbackRoleMigrationRun,
} from "../src/services/roleMigration.service.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadRoleIdsByCode(tenantId, roleCodes) {
  const result = await query(
    `SELECT id, code, is_system
     FROM roles
     WHERE tenant_id = ?
       AND code IN (${roleCodes.map(() => "?").join(", ")})
     ORDER BY code`,
    [tenantId, ...roleCodes]
  );
  return new Map((result.rows || []).map((row) => [row.code, row]));
}

async function insertRetainedLegacyRoleRow(tenantId, roleCode, roleName) {
  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       is_system = VALUES(is_system)`,
    [tenantId, roleCode, roleName]
  );
}

async function main() {
  const uniqueSuffix = Date.now();
  const tenantCode = `PR4C_${uniqueSuffix}`;
  const tenantName = `PR4C Tenant ${uniqueSuffix}`;

  await seedCore();

  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     ORDER BY id
     LIMIT 1`
  );
  const countryId = parsePositiveInt(countryResult.rows[0]?.id);
  const currencyCode = String(countryResult.rows[0]?.default_currency_code || "USD");
  assert(countryId, "A seeded country is required for PR-4C verification");

  const tenantInsert = await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, tenantName]
  );
  const tenantId = parsePositiveInt(tenantInsert.rows.insertId);
  assert(tenantId, "Expected tenant insert id");

  await seedCore();

  const groupInsert = await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `GRP${uniqueSuffix}`, "PR4C Group"]
  );
  const groupCompanyId = parsePositiveInt(groupInsert.rows.insertId);
  assert(groupCompanyId, "Expected group company insert id");

  const legalEntityInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      groupCompanyId,
      `LE${uniqueSuffix}`,
      "PR4C Legal Entity",
      countryId,
      currencyCode,
    ]
  );
  const legalEntityId = parsePositiveInt(legalEntityInsert.rows.insertId);
  assert(legalEntityId, "Expected legal entity insert id");

  const actorInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr4c-actor-${uniqueSuffix}@example.com`, "x", "PR4C Actor"]
  );
  const actorUserId = parsePositiveInt(actorInsert.rows.insertId);
  const userInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr4c-user-${uniqueSuffix}@example.com`, "x", "PR4C User"]
  );
  const subjectUserId = parsePositiveInt(userInsert.rows.insertId);
  assert(actorUserId && subjectUserId, "Expected seeded actor and subject users");

  const roleCodes = [
    "TenantAdmin",
    "GroupController",
    "CountryController",
    "EntityAccountant",
    "SecurityAdmin",
    "SystemAdmin",
    "GroupReportingController",
    "GLOperator",
    "GLPostingAuthority",
    "TreasuryApprover",
    "PayrollApprover",
    "LocalCloseReviewer",
    "TreasuryOperator",
    "PayrollOperator",
    "LocalClosePreparer",
  ];
  await insertRetainedLegacyRoleRow(tenantId, "TenantAdmin", "Tenant Administrator");
  await insertRetainedLegacyRoleRow(tenantId, "GroupController", "Group Controller");
  await insertRetainedLegacyRoleRow(tenantId, "CountryController", "Country Controller");
  await insertRetainedLegacyRoleRow(tenantId, "EntityAccountant", "Entity Accountant");
  const roleRowsByCode = await loadRoleIdsByCode(tenantId, roleCodes);
  for (const roleCode of roleCodes) {
    assert(roleRowsByCode.has(roleCode), `Expected seeded role ${roleCode}`);
  }

  const sourceAssignments = [
    {
      roleCode: "TenantAdmin",
      scopeType: "TENANT",
      scopeId: tenantId,
    },
    {
      roleCode: "GroupController",
      scopeType: "GROUP",
      scopeId: groupCompanyId,
    },
    {
      roleCode: "CountryController",
      scopeType: "COUNTRY",
      scopeId: countryId,
    },
    {
      roleCode: "EntityAccountant",
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    },
  ];

  for (const assignment of sourceAssignments) {
    const roleId = parsePositiveInt(roleRowsByCode.get(assignment.roleCode)?.id);
    // eslint-disable-next-line no-await-in-loop
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
      [tenantId, subjectUserId, roleId, assignment.scopeType, assignment.scopeId]
    );
  }

  const previewRun = await createRoleMigrationPreviewRun({
    tenantId,
    actorUserId,
  });
  assert(previewRun?.id, "Preview run id must exist");
  assert.equal(previewRun.status, "PREVIEWED");
  assert.equal(previewRun.previewSummary.totalSourceAssignments, 4);
  assert.equal(previewRun.previewSummary.readyItemCount, 4);

  const executedRun = await executeRoleMigrationRun({
    tenantId,
    runId: previewRun.id,
    actorUserId,
  });
  assert.equal(executedRun.status, "EXECUTED");
  assert.equal(executedRun.executionSummary.executedItemCount, 4);

  const legacyAssignmentResult = await query(
    `SELECT COUNT(*) AS assignment_count
     FROM user_role_scopes urs
     JOIN roles r
       ON r.id = urs.role_id
      AND r.tenant_id = urs.tenant_id
     WHERE urs.tenant_id = ?
       AND r.code IN ('TenantAdmin', 'GroupController', 'CountryController', 'EntityAccountant')`,
    [tenantId]
  );
  assert.equal(Number(legacyAssignmentResult.rows[0]?.assignment_count || 0), 0);

  const targetAssignmentResult = await query(
    `SELECT DISTINCT r.code
     FROM user_role_scopes urs
     JOIN roles r
       ON r.id = urs.role_id
      AND r.tenant_id = urs.tenant_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?`,
    [tenantId, subjectUserId]
  );
  const targetRoleCodes = new Set((targetAssignmentResult.rows || []).map((row) => row.code));
  [
    "SecurityAdmin",
    "SystemAdmin",
    "GroupReportingController",
    "GLOperator",
    "GLPostingAuthority",
    "TreasuryApprover",
    "PayrollApprover",
    "LocalCloseReviewer",
    "TreasuryOperator",
    "PayrollOperator",
    "LocalClosePreparer",
  ].forEach((roleCode) => {
    assert(targetRoleCodes.has(roleCode), `Expected migrated role assignment ${roleCode}`);
  });

  for (const legacyRoleCode of [
    "TenantAdmin",
    "GroupController",
    "CountryController",
    "EntityAccountant",
  ]) {
    const roleRow = roleRowsByCode.get(legacyRoleCode);
    assert(await isRoleLegacyDisabled(tenantId, roleRow.id), `${legacyRoleCode} should be disabled`);
  }

  await seedCore();

  const disabledRoleCheck = await query(
    `SELECT code, is_system
     FROM roles
     WHERE tenant_id = ?
       AND code IN ('TenantAdmin', 'GroupController', 'CountryController', 'EntityAccountant')
     ORDER BY code`,
    [tenantId]
  );
  for (const row of disabledRoleCheck.rows || []) {
    assert.equal(Number(row.is_system), 0, `${row.code} should stay disabled after reseed`);
  }

  const rolledBackRun = await rollbackRoleMigrationRun({
    tenantId,
    runId: previewRun.id,
    actorUserId,
  });
  assert.equal(rolledBackRun.status, "ROLLED_BACK");
  assert.equal(rolledBackRun.rollbackSummary.rolledBackItemCount, 4);

  const restoredAssignmentResult = await query(
    `SELECT COUNT(*) AS assignment_count
     FROM user_role_scopes urs
     JOIN roles r
       ON r.id = urs.role_id
      AND r.tenant_id = urs.tenant_id
     WHERE urs.tenant_id = ?
       AND r.code IN ('TenantAdmin', 'GroupController', 'CountryController', 'EntityAccountant')`,
    [tenantId]
  );
  assert.equal(Number(restoredAssignmentResult.rows[0]?.assignment_count || 0), 4);

  const reenabledRoleCheck = await query(
    `SELECT code, is_system
     FROM roles
     WHERE tenant_id = ?
       AND code IN ('TenantAdmin', 'GroupController', 'CountryController', 'EntityAccountant')
     ORDER BY code`,
    [tenantId]
  );
  for (const row of reenabledRoleCheck.rows || []) {
    assert.equal(Number(row.is_system), 1, `${row.code} should be reenabled after rollback`);
  }

  console.log("test-security-pr4c-role-migration-tool: ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
