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
    "TaxConfigurationManager",
    "EntityAPController",
    "OUAPSubmitter",
    "CountryAPApprover",
    "CountryAPPoster",
    "GLOperator",
    "GLPostingAuthority",
    "PeriodCloseSupervisorAuthority",
    "PeriodCloseAuthority",
    "PeriodReopenAuthority",
    "PeriodAdminAuthority",
    "ShareholderCapitalOperator",
    "OUAccountant",
    "TreasuryOperator",
    "TreasuryApprover",
    "PayrollOperator",
    "PayrollApprover",
    "LocalClosePreparer",
    "LocalCloseReviewer",
    "GroupReportingController",
    "BranchInventoryViewer",
    "EntityInventoryViewer",
    "BranchInventoryExecutor",
    "BranchInventoryOperator",
    "EntityInventoryOperator",
    "BranchFixedAssetViewer",
    "EntityFixedAssetViewer",
    "BranchFixedAssetOperator",
    "EntityFixedAssetOperator",
    "AuditorReadOnly",
    "BranchOperator",
  ];

  const permissionCodesByRole = await getPermissionCodesByRole(tenantId, roleCodes);

  assert.deepEqual(ROLE_CAPABILITY_GROUPS.GLOperator, ["gl.operations"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.GLPostingAuthority, ["gl.posting"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.LocalUserAdmin, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.CounterpartyCardEditor, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.TaxConfigurationManager, ["tax.configuration"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.EntityAPController, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.OUAPSubmitter, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.CountryAPApprover, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.CountryAPPoster, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.ShareholderCapitalOperator, ["org.capital_fulfillment"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.LocalCloseReviewer, ["close.reviewer"]);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchInventoryViewer, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.EntityInventoryViewer, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchInventoryExecutor, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchInventoryOperator, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.EntityInventoryOperator, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchFixedAssetViewer, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.EntityFixedAssetViewer, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchFixedAssetOperator, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.EntityFixedAssetOperator, []);
  assert.deepEqual(ROLE_CAPABILITY_GROUPS.BranchOperator, ["gl.readonly"]);

  assertRoleHas(permissionCodesByRole, "SystemAdmin", "onboarding.company.setup");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "tax.setup.read");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "tax.setup.upsert");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "workflow.definition.write");
  assertRoleHas(permissionCodesByRole, "SystemAdmin", "workflow.assignment.write");
  assertRoleLacks(permissionCodesByRole, "SystemAdmin", "gl.account.upsert");
  assertRoleLacks(permissionCodesByRole, "SystemAdmin", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "TaxConfigurationManager", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "TaxConfigurationManager", "tax.setup.read");
  assertRoleHas(permissionCodesByRole, "TaxConfigurationManager", "tax.setup.upsert");
  assertRoleHas(permissionCodesByRole, "TaxConfigurationManager", "gl.account.read");
  assertRoleLacks(
    permissionCodesByRole,
    "TaxConfigurationManager",
    "onboarding.company.setup"
  );
  assertRoleLacks(permissionCodesByRole, "TaxConfigurationManager", "gl.account.upsert");

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

  assertRoleHas(permissionCodesByRole, "EntityAPController", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "EntityAPController", "org.fiscal_period.read");
  assertRoleHas(permissionCodesByRole, "EntityAPController", "cari.doc.read");
  assertRoleHas(permissionCodesByRole, "EntityAPController", "cari.doc.update");
  assertRoleHas(permissionCodesByRole, "EntityAPController", "cari.doc.submit");
  assertRoleLacks(permissionCodesByRole, "EntityAPController", "cari.doc.create");
  assertRoleLacks(permissionCodesByRole, "EntityAPController", "cari.doc.post");
  assertRoleLacks(permissionCodesByRole, "EntityAPController", "cari.doc.reverse");
  assertRoleLacks(permissionCodesByRole, "EntityAPController", "cari.card.read");
  assertRoleLacks(permissionCodesByRole, "EntityAPController", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "OUAPSubmitter", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "OUAPSubmitter", "org.fiscal_period.read");
  assertRoleHas(permissionCodesByRole, "OUAPSubmitter", "cari.doc.read");
  assertRoleHas(permissionCodesByRole, "OUAPSubmitter", "cari.doc.update");
  assertRoleHas(permissionCodesByRole, "OUAPSubmitter", "cari.doc.submit");
  assertRoleLacks(permissionCodesByRole, "OUAPSubmitter", "cari.doc.create");
  assertRoleLacks(permissionCodesByRole, "OUAPSubmitter", "cari.doc.post");
  assertRoleLacks(permissionCodesByRole, "OUAPSubmitter", "cari.doc.reverse");
  assertRoleLacks(permissionCodesByRole, "OUAPSubmitter", "cari.card.read");
  assertRoleLacks(permissionCodesByRole, "OUAPSubmitter", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "CountryAPApprover", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "CountryAPApprover", "org.fiscal_period.read");
  assertRoleHas(permissionCodesByRole, "CountryAPApprover", "cari.doc.read");
  assertRoleLacks(permissionCodesByRole, "CountryAPApprover", "cari.doc.submit");
  assertRoleLacks(permissionCodesByRole, "CountryAPApprover", "cari.doc.post");
  assertRoleLacks(permissionCodesByRole, "CountryAPApprover", "cari.doc.reverse");

  assertRoleHas(permissionCodesByRole, "CountryAPPoster", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "CountryAPPoster", "org.fiscal_period.read");
  assertRoleHas(permissionCodesByRole, "CountryAPPoster", "cari.doc.read");
  assertRoleHas(permissionCodesByRole, "CountryAPPoster", "cari.doc.post");
  assertRoleHas(permissionCodesByRole, "CountryAPPoster", "cari.doc.reverse");
  assertRoleLacks(permissionCodesByRole, "CountryAPPoster", "cari.doc.submit");
  assertRoleLacks(permissionCodesByRole, "CountryAPPoster", "cari.doc.update");
  assertRoleLacks(permissionCodesByRole, "CountryAPPoster", "cari.card.read");
  assertRoleLacks(permissionCodesByRole, "CountryAPPoster", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "GLOperator", "gl.journal.create");
  assertRoleHas(permissionCodesByRole, "GLOperator", "gl.journal.update");
  assertRoleHas(permissionCodesByRole, "GLOperator", "gl.journal.cancel");
  assertRoleLacks(permissionCodesByRole, "GLOperator", "gl.journal.post");

  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.journal.read");
  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.trial_balance.read");
  assertRoleHas(permissionCodesByRole, "GLPostingAuthority", "gl.journal.post");
  assertRoleLacks(permissionCodesByRole, "GLPostingAuthority", "gl.journal.create");
  assertRoleLacks(permissionCodesByRole, "GLPostingAuthority", "gl.period.close.execute");

  assertRoleHas(
    permissionCodesByRole,
    "PeriodCloseSupervisorAuthority",
    "gl.period.close.approve"
  );
  assertRoleLacks(
    permissionCodesByRole,
    "PeriodCloseSupervisorAuthority",
    "gl.period.close.execute"
  );
  assertRoleHas(permissionCodesByRole, "PeriodCloseAuthority", "gl.period.close.execute");
  assertRoleLacks(permissionCodesByRole, "PeriodCloseAuthority", "gl.period.close.approve");
  assertRoleHas(permissionCodesByRole, "PeriodReopenAuthority", "gl.period.reopen");
  assertRoleLacks(permissionCodesByRole, "PeriodReopenAuthority", "gl.period.close.execute");
  assertRoleHas(permissionCodesByRole, "PeriodAdminAuthority", "gl.period.admin");
  assertRoleLacks(permissionCodesByRole, "PeriodAdminAuthority", "gl.period.close.execute");

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

  assertRoleHas(permissionCodesByRole, "BranchInventoryViewer", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryViewer", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryViewer", "item.card.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryViewer", "inventory.read");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryViewer", "inventory.materialize");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryViewer", "item.card.upsert");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryViewer", "gl.account.upsert");

  assertRoleHas(permissionCodesByRole, "EntityInventoryViewer", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryViewer", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryViewer", "item.card.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryViewer", "inventory.read");
  assertRoleLacks(permissionCodesByRole, "EntityInventoryViewer", "inventory.transfer.create");
  assertRoleLacks(permissionCodesByRole, "EntityInventoryViewer", "item.card.upsert");

  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "item.card.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.materialize");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.movement.reverse");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.transfer.create");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.transfer.ship");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.transfer.receive");
  assertRoleHas(permissionCodesByRole, "BranchInventoryExecutor", "inventory.transfer.cancel");
  assertRoleHas(
    permissionCodesByRole,
    "BranchInventoryExecutor",
    "inventory.transfer.evidence.upsert"
  );
  assertRoleLacks(permissionCodesByRole, "BranchInventoryExecutor", "item.card.upsert");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryExecutor", "inventory.warehouse.upsert");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryExecutor", "inventory.landed_cost.upsert");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryExecutor", "inventory.transfer.approve");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryExecutor", "inventory.transfer.reverse");

  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "item.card.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "item.card.upsert");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.read");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.materialize");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.movement.reverse");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.transfer.create");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.transfer.ship");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.transfer.receive");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.transfer.cancel");
  assertRoleHas(
    permissionCodesByRole,
    "BranchInventoryOperator",
    "inventory.transfer.evidence.upsert"
  );
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.warehouse.upsert");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.landed_cost.upsert");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.transfer.approve");
  assertRoleHas(permissionCodesByRole, "BranchInventoryOperator", "inventory.transfer.reverse");
  assertRoleLacks(permissionCodesByRole, "BranchInventoryOperator", "gl.account.upsert");

  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "item.card.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "item.card.upsert");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.read");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.materialize");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.movement.reverse");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.transfer.create");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.transfer.ship");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.transfer.receive");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.transfer.cancel");
  assertRoleHas(
    permissionCodesByRole,
    "EntityInventoryOperator",
    "inventory.transfer.evidence.upsert"
  );
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.warehouse.upsert");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.landed_cost.upsert");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.transfer.approve");
  assertRoleHas(permissionCodesByRole, "EntityInventoryOperator", "inventory.transfer.reverse");
  assertRoleLacks(permissionCodesByRole, "EntityInventoryOperator", "gl.account.upsert");

  assertRoleHas(permissionCodesByRole, "BranchFixedAssetViewer", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetViewer", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.settings.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.custodian.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.report.read");
  assertRoleLacks(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.upsert");
  assertRoleLacks(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.post");
  assertRoleLacks(permissionCodesByRole, "BranchFixedAssetViewer", "fixed_assets.settings.upsert");

  assertRoleHas(permissionCodesByRole, "EntityFixedAssetViewer", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetViewer", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetViewer", "fixed_assets.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetViewer", "fixed_assets.settings.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetViewer", "fixed_assets.custodian.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetViewer", "fixed_assets.report.read");
  assertRoleLacks(permissionCodesByRole, "EntityFixedAssetViewer", "fixed_assets.upsert");
  assertRoleLacks(permissionCodesByRole, "EntityFixedAssetViewer", "fixed_assets.depreciation.run");

  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.upsert");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.settings.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.custodian.read");
  assertRoleHas(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.report.read");
  assertRoleLacks(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.post");
  assertRoleLacks(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.dispose");
  assertRoleLacks(permissionCodesByRole, "BranchFixedAssetOperator", "fixed_assets.settings.upsert");

  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "org.tree.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "org.fiscal_period.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "gl.account.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.upsert");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.post");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.transfer");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.dispose");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.settings.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.settings.upsert");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.custodian.read");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.custodian.write");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.depreciation.run");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.depreciation.reverse");
  assertRoleHas(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.report.read");
  assertRoleLacks(permissionCodesByRole, "EntityFixedAssetOperator", "fixed_assets.account_override");

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
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "fixed_assets.read");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "fixed_assets.upsert");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "fixed_assets.settings.read");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "fixed_assets.custodian.read");
  assertRoleLacks(permissionCodesByRole, "BranchOperator", "fixed_assets.report.read");

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
