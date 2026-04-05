import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { ROLE_CAPABILITY_GROUPS, seedCore } from "../src/seedCore.js";

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

async function getPermissionCodesByRole(tenantId, roleCodes) {
  const roleResult = await query(
    `SELECT id, code
     FROM roles
     WHERE tenant_id = ?
       AND code IN (${roleCodes.map(() => "?").join(", ")})
     ORDER BY code`,
    [tenantId, ...roleCodes]
  );

  const roleIdsByCode = new Map();
  for (const row of roleResult.rows || []) {
    roleIdsByCode.set(String(row.code || ""), toPositiveInt(row.id));
  }

  const missingRoleCodes = roleCodes.filter((roleCode) => !roleIdsByCode.get(roleCode));
  assert.equal(
    missingRoleCodes.length,
    0,
    `Missing seeded roles: ${missingRoleCodes.join(", ")}`
  );

  const roleIds = Array.from(roleIdsByCode.values());
  const permissionResult = await query(
    `SELECT r.code AS role_code, p.code AS permission_code
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.id IN (${roleIds.map(() => "?").join(", ")})
     ORDER BY r.code, p.code`,
    roleIds
  );

  const permissionCodesByRole = new Map();
  for (const roleCode of roleCodes) {
    permissionCodesByRole.set(roleCode, new Set());
  }
  for (const row of permissionResult.rows || []) {
    if (!permissionCodesByRole.has(row.role_code)) {
      permissionCodesByRole.set(row.role_code, new Set());
    }
    permissionCodesByRole.get(row.role_code).add(String(row.permission_code || ""));
  }

  return permissionCodesByRole;
}

function assertRoleHas(permissionCodesByRole, roleCode, permissionCode) {
  assert(
    permissionCodesByRole.get(roleCode)?.has(permissionCode),
    `${roleCode} should include ${permissionCode}`
  );
}

function assertRoleLacks(permissionCodesByRole, roleCode, permissionCode) {
  assert(
    !permissionCodesByRole.get(roleCode)?.has(permissionCode),
    `${roleCode} should not include ${permissionCode}`
  );
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const tenantId = await createTenant(`PR4A_${Date.now()}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const roleCodes = [
    "SecurityAdmin",
    "SystemAdmin",
    "LocalUserAdmin",
    "MasterDataSteward",
    "CounterpartyCardEditor",
    "APDocumentPoster",
    "GLOperator",
    "GLPostingAuthority",
    "ShareholderCapitalOperator",
    "OUAccountant",
    "TreasuryOperator",
    "TreasuryApprover",
    "PayrollOperator",
    "PayrollApprover",
    "LocalClosePreparer",
    "LocalCloseReviewer",
    "GroupReportingController",
    "AuditorReadOnly",
    "BranchOperator",
  ];

  const permissionCodesByRole = await getPermissionCodesByRole(tenantId, roleCodes);

  assert.deepEqual(ROLE_CAPABILITY_GROUPS.GLOperator, ["gl.operations"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.GLPostingAuthority, ["gl.posting"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.LocalUserAdmin, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.CounterpartyCardEditor, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.APDocumentPoster, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.ShareholderCapitalOperator, ["org.capital_fulfillment"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.LocalCloseReviewer, ["close.reviewer"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchOperator, ["gl.readonly"]);

  assertRoleHas(permissionCodesByRole, "SystemAdmin", "onboarding.company.setup");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "workflow.definition.write");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "workflow.assignment.write");
  assertRoleLacks(permissionCodesByRole, "SystemAdmin", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "LocalUserAdmin", "security.user_admin.local");
  assertRoleLacks(permissionCodesByRole, "LocalUserAdmin", "security.role_assignment.upsert");
  assertRoleLacks(permissionCodesByRole, "LocalUserAdmin", "security.role.upsert");

  assertRoleHas(permissionCodesByRole, "MasterDataSteward", "org.legal_entity.upsert");
  assertRoleHas(permissionCodesByRole, "MasterDataSteward", "gl.account_mapping.upsert");
  assertRoleHas(permissionCodesByRole, "MasterDataSteward", "fx.rate.bulk_upsert");
  assertRoleHas(permissionCodesByRole, "MasterDataSteward", "cari.card.read");
  assertRoleHas(permissionCodesByRole, "MasterDataSteward", "cari.request.review");
  assertRoleLacks(permissionCodesByRole, "MasterDataSteward", "gl.journal.create");
  assertRoleLacks(permissionCodesByRole, "MasterDataSteward", "gl.journal.post");
  assertRoleLacks(permissionCodesByRole, "MasterDataSteward", "cari.card.request");

  assertRoleHas(permissionCodesByRole, "CounterpartyCardEditor", "cari.card.read");
  assertRoleHas(permissionCodesByRole, "CounterpartyCardEditor", "cari.card.upsert");
  assertRoleHas(permissionCodesByRole, "CounterpartyCardEditor", "gl.account.read");
  assertRoleLacks(permissionCodesByRole, "CounterpartyCardEditor", "cari.request.review");
  assertRoleLacks(permissionCodesByRole, "CounterpartyCardEditor", "gl.account.upsert");
  assertRoleLacks(permissionCodesByRole, "CounterpartyCardEditor", "gl.journal.create");
  assertRoleLacks(permissionCodesByRole, "CounterpartyCardEditor", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "APDocumentPoster", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "APDocumentPoster", "org.fiscal_period.read");
  assertRoleHas(permissionCodesByRole, "APDocumentPoster", "cari.doc.read");
  assertRoleHas(permissionCodesByRole, "APDocumentPoster", "cari.doc.update");
  assertRoleHas(permissionCodesByRole, "APDocumentPoster", "cari.doc.post");
  assertRoleLacks(permissionCodesByRole, "APDocumentPoster", "cari.doc.create");
  assertRoleLacks(permissionCodesByRole, "APDocumentPoster", "cari.doc.reverse");
  assertRoleLacks(permissionCodesByRole, "APDocumentPoster", "cari.card.read");
  assertRoleLacks(permissionCodesByRole, "APDocumentPoster", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "GLOperator", "gl.journal.create");
  assertRoleHas(permissionCodesByRole, "GLOperator", "gl.journal.update");
  assertRoleHas(permissionCodesByRole, "GLOperator", "gl.journal.cancel");
  assertRoleLacks(permissionCodesByRole, "GLOperator", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.journal.read");
  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.trial_balance.read");
  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.journal.post");
  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.period.close");
  assertRoleLacks(permissionCodesByRole, "GLPostingAuthority", "gl.journal.create");

  assertRoleHas(
    permissionCodesByRole,
    "ShareholderCapitalOperator",
    "org.shareholder.capital_fulfillment.upsert"
  );
  assertRoleHas(permissionCodesByRole, "ShareholderCapitalOperator", "bank.accounts.read");
  assertRoleHas(permissionCodesByRole, "ShareholderCapitalOperator", "cash.register.read");
  assertRoleHas(permissionCodesByRole, "ShareholderCapitalOperator", "gl.account.read");
  assertRoleLacks(permissionCodesByRole, "ShareholderCapitalOperator", "org.shareholder.upsert");
  assertRoleLacks(permissionCodesByRole, "ShareholderCapitalOperator", "bank.accounts.write");
  assertRoleLacks(permissionCodesByRole, "ShareholderCapitalOperator", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "OUAccountant", "gl.journal.create");
  assertRoleLacks(permissionCodesByRole, "OUAccountant", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "TreasuryOperator", "payments.batch.create");
  assertRoleHas(permissionCodesByRole, "TreasuryOperator", "cash.txn.post");
  assertRoleHas(permissionCodesByRole, "TreasuryOperator", "cari.bank.apply");
  assertRoleLacks(permissionCodesByRole, "TreasuryOperator", "payments.batch.approve");
  assertRoleLacks(permissionCodesByRole, "TreasuryOperator", "cash.variance.approve");

  assertRoleHas(permissionCodesByRole, "TreasuryApprover", "payments.batch.approve");
  assertRoleHas(permissionCodesByRole, "TreasuryApprover", "bank.approvals.requests.approve");
  assertRoleHas(permissionCodesByRole, "TreasuryApprover", "cash.variance.approve");
  assertRoleLacks(permissionCodesByRole, "TreasuryApprover", "payments.batch.create");
  assertRoleLacks(permissionCodesByRole, "TreasuryApprover", "bank.approvals.requests.submit");

  assertRoleHas(permissionCodesByRole, "PayrollOperator", "payroll.settlement.override.request");
  assertRoleHas(permissionCodesByRole, "PayrollOperator", "payroll.close.request");
  assertRoleLacks(permissionCodesByRole, "PayrollOperator", "payroll.settlement.override.approve");
  assertRoleLacks(permissionCodesByRole, "PayrollOperator", "payroll.close.approve");

  assertRoleHas(permissionCodesByRole, "PayrollApprover", "payroll.settlement.override.approve");
  assertRoleHas(permissionCodesByRole, "PayrollApprover", "payroll.close.approve");
  assertRoleLacks(permissionCodesByRole, "PayrollApprover", "payroll.settlement.override.request");
  assertRoleLacks(permissionCodesByRole, "PayrollApprover", "payroll.close.request");

  assertRoleHas(permissionCodesByRole, "LocalClosePreparer", "ouclose.prepare");
  assertRoleHas(permissionCodesByRole, "LocalClosePreparer", "ouclose.submit");
  assertRoleLacks(permissionCodesByRole, "LocalClosePreparer", "ouclose.approve");

  assertRoleHas(permissionCodesByRole, "LocalCloseReviewer", "ouclose.review");
  assertRoleHas(permissionCodesByRole, "LocalCloseReviewer", "ouclose.approve");
  assertRoleHas(permissionCodesByRole, "LocalCloseReviewer", "ouclose.lock");
  assertRoleLacks(permissionCodesByRole, "LocalCloseReviewer", "ouclose.prepare");

  assertRoleHas(permissionCodesByRole, "GroupReportingController", "intercompany.reconcile.run");
  assertRoleHas(permissionCodesByRole, "GroupReportingController", "consolidation.run.finalize");
  assertRoleLacks(permissionCodesByRole, "GroupReportingController", "gl.journal.post");
  assertRoleLacks(permissionCodesByRole, "GroupReportingController", "payments.batch.create");

  assertRoleHas(permissionCodesByRole, "AuditorReadOnly", "security.role.read");
  assertRoleHas(permissionCodesByRole, "AuditorReadOnly", "workflow.definition.read");
  assertRoleHas(permissionCodesByRole, "AuditorReadOnly", "consolidation.report.summary.read");
  assertRoleLacks(permissionCodesByRole, "AuditorReadOnly", "security.role.upsert");
  assertRoleLacks(permissionCodesByRole, "AuditorReadOnly", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "BranchOperator", "gl.trial_balance.read");
  assertRoleHas(permissionCodesByRole, "BranchOperator", "gl.report.statement.read");
  assertRoleHas(permissionCodesByRole, "BranchOperator", "cash.txn.create");
  assertRoleHas(permissionCodesByRole, "BranchOperator", "cari.doc.create");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "gl.journal.create");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "gl.journal.post");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "ouclose.prepare");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "workflow.definition.read");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "cari.request.review");

  const legacyRoleResult = await query(
    `SELECT code
     FROM roles
     WHERE tenant_id = ?
       AND code IN ('TenantAdmin', 'GroupController', 'CountryController', 'EntityAccountant')`,
    [tenantId]
  );
  assert.equal(
    (legacyRoleResult.rows || []).length,
    0,
    "Fresh tenants should not seed retired legacy roles after PR-6A"
  );

  console.log("test-security-pr4a-duty-boundary-roles passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
