import { query } from "./db.js";
import { assertValidPermissionRuleSet } from "./constants/permission-rules.js";
import { runMigrations } from "./migrationRunner.js";
import {
  PERMISSION_GROUP_CODES,
  PERMISSION_GROUPS,
} from "./constants/permission-groups.js";
import { buildSystemRoleDefinitions } from "./services/systemRoles.service.js";
import {
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_CLOSED_POST_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
} from "../../shared/periodCloseGovernance.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const BASE_CURRENCIES = [
  ["USD", "US Dollar", 2],
  ["EUR", "Euro", 2],
  ["TRY", "Turkish Lira", 2],
  ["GBP", "Pound Sterling", 2],
  ["AFN", "Afghan Afghani", 2],
  ["PKR", "Pakistani Rupee", 2],
  ["JPY", "Japanese Yen", 0],
  ["INR", "Indian Rupee", 2],
  ["CAD", "Canadian Dollar", 2],
  ["AUD", "Australian Dollar", 2],
  ["CHF", "Swiss Franc", 2],
  ["AED", "UAE Dirham", 2],
  ["SAR", "Saudi Riyal", 2],
  ["BRL", "Brazilian Real", 2],
  ["MXN", "Mexican Peso", 2],
  ["ZAR", "South African Rand", 2],
  ["SGD", "Singapore Dollar", 2],
];

const BASE_COUNTRIES = [
  ["US", "USA", "United States", "USD"],
  ["TR", "TUR", "Turkey", "TRY"],
  ["GB", "GBR", "United Kingdom", "GBP"],
  ["DE", "DEU", "Germany", "EUR"],
  ["AF", "AFG", "Afghanistan", "AFN"],
  ["PK", "PAK", "Pakistan", "PKR"],
  ["FR", "FRA", "France", "EUR"],
  ["IT", "ITA", "Italy", "EUR"],
  ["ES", "ESP", "Spain", "EUR"],
  ["NL", "NLD", "Netherlands", "EUR"],
  ["CH", "CHE", "Switzerland", "CHF"],
  ["CA", "CAN", "Canada", "CAD"],
  ["AU", "AUS", "Australia", "AUD"],
  ["JP", "JPN", "Japan", "JPY"],
  ["IN", "IND", "India", "INR"],
  ["AE", "ARE", "United Arab Emirates", "AED"],
  ["SA", "SAU", "Saudi Arabia", "SAR"],
  ["BR", "BRA", "Brazil", "BRL"],
  ["MX", "MEX", "Mexico", "MXN"],
  ["ZA", "ZAF", "South Africa", "ZAR"],
  ["SG", "SGP", "Singapore", "SGD"],
];

const PERMISSIONS = [
  ["org.tree.read", "Read org hierarchy tree"],
  ["org.fiscal_calendar.read", "Read fiscal calendars"],
  ["org.fiscal_period.read", "Read fiscal periods"],
  ["org.group_company.upsert", "Create/update group companies"],
  ["org.legal_entity.upsert", "Create/update legal entities"],
  ["org.operating_unit.upsert", "Create/update operating units/branches"],
  ["org.fiscal_calendar.upsert", "Create/update fiscal calendars"],
  ["org.fiscal_period.generate", "Generate fiscal periods"],
  [
    "org.shareholder.upsert",
    "Create/update shareholder setup and commitment journals",
  ],
  [
    "org.shareholder.capital_fulfillment.upsert",
    "Create/preview/reverse shareholder capital fulfillment",
  ],
  ["security.permission.read", "Read permission catalog"],
  ["security.role.read", "Read security roles"],
  ["security.role.upsert", "Create/update security roles"],
  ["security.role_permissions.assign", "Assign permissions to roles"],
  ["security.role_assignment.read", "Read role assignments"],
  ["security.role_assignment.upsert", "Assign roles to users and scopes"],
  ["security.data_scope.read", "Read user data scopes"],
  ["security.data_scope.upsert", "Create/update/delete user data scopes"],
  ["security.field_visibility.read", "Read field visibility policies"],
  [
    "security.field_visibility.write",
    "Create/update field visibility policies",
  ],
  [
    "security.user_admin.local",
    "Manage bounded local user administration within entity scope",
  ],
  [
    "security.user_admin.entity",
    "Manage legacy branch operator users within entity scope",
  ],
  [
    "security.operational_coverage.read",
    "Read temporary operational coverage requests",
  ],
  [
    "security.operational_coverage.request",
    "Request temporary operational coverage",
  ],
  [
    "security.operational_coverage.review",
    "Review temporary operational coverage requests",
  ],
  [
    "security.operational_coverage.revoke",
    "Revoke approved temporary operational coverage",
  ],
  ["security.audit.read", "Read RBAC audit logs"],
  ["security.audit.report.generate", "Generate compliance audit reports"],
  ["security.audit.report.export", "Export compliance audit reports as CSV"],
  [
    "security.admin.system",
    "Manage system administration and onboarding controls",
  ],
  ["gl.book.read", "Read books"],
  ["gl.book.upsert", "Create/update books"],
  ["gl.coa.read", "Read chart of accounts"],
  ["gl.coa.upsert", "Create/update chart of accounts"],
  ["gl.account.read", "Read accounts"],
  ["gl.account.upsert", "Create/update accounts"],
  ["gl.account_mapping.upsert", "Create/update account mappings"],
  ["gl.journal.read", "Read journals"],
  ["gl.journal.create", "Create journals"],
  ["gl.journal.update", "Update draft journals"],
  ["gl.journal.cancel", "Cancel draft journals"],
  ["gl.journal.post", "Post journals"],
  ["gl.journal.post_to_closed_period", "Post journals into SOFT_CLOSED periods (elevated override)"],
  ["gl.journal.reverse", "Reverse posted journals"],
  ["gl.trial_balance.read", "Read trial balance"],
  ["gl.report.local.read", "Read local summary reports"],
  ["gl.report.ledger.read", "Read local ledger detail reports"],
  ["gl.report.statement.read", "Read local financial statement reports"],
  [PERIOD_CLOSE_APPROVE_PERMISSION_CODE, "Approve period-close workflow steps"],
  [PERIOD_CLOSE_EXECUTE_PERMISSION_CODE, "Execute governed accounting period close"],
  ["gl.period.reopen", "Reopen closed accounting periods"],
  ["gl.period.admin", "Administer period close overrides and operational controls"],
  ["ouclose.read", "Read local close packs and status"],
  ["ouclose.prepare", "Prepare local close packs"],
  ["ouclose.submit", "Submit local close packs for review"],
  ["ouclose.review", "Review local close packs"],
  ["ouclose.approve", "Approve local close packs"],
  ["ouclose.lock", "Lock approved local close packs"],
  ["ouclose.request_reopen", "Request local close-pack reopen"],
  ["ouclose.reopen", "Reopen local close packs"],
  [
    "ouclose.override_post_lock",
    "Override approved or locked local close-pack controls",
  ],
  ["ouclose.admin", "Administer local close-pack configuration and governance"],
  ["close.cycle.read", "Read close cycles and provisioned close-cycle items"],
  ["close.cycle.write", "Create close cycles"],
  [
    "close.cycle.provision",
    "Provision close cycles and auto-create or reuse safe underlying local close packs",
  ],
  ["close.cycle.lock", "Lock close cycles once all required terminal dependencies are resolved"],
  ["close.cockpit.read", "Read the close cockpit, worklist, blockers, and readiness views"],
  ["cash.register.read", "Read cash registers"],
  ["cash.register.upsert", "Create/update cash registers"],
  ["cash.session.open", "Open cash sessions"],
  ["cash.session.close", "Close cash sessions"],
  ["cash.txn.read", "Read cash transactions"],
  ["cash.txn.create", "Create cash transactions"],
  ["cash.txn.cancel", "Cancel draft/submitted cash transactions"],
  ["cash.txn.post", "Post cash transactions"],
  ["cash.txn.reverse", "Reverse posted cash transactions"],
  ["cash.override.post", "Post cash entries with cash-control override"],
  ["cash.variance.approve", "Approve cash session variances"],
  ["cash.report.read", "Read cash reports"],
  [
    "cash.fx.revaluation.override",
    "Override cash FX revaluation close gate with explicit reason",
  ],
  ["bank.accounts.read", "Read bank account master records and GL links"],
  [
    "bank.accounts.write",
    "Create/update/activate/deactivate bank account master records",
  ],
  [
    "bank.connectors.read",
    "Read bank connector masters, account links, and sync run logs (B05)",
  ],
  [
    "bank.connectors.write",
    "Create/update bank connector masters and connector-account mappings (B05)",
  ],
  [
    "bank.connectors.sync",
    "Test bank connectors and pull statement feeds via B02 import pipeline (B05)",
  ],
  [
    "bank.statements.import",
    "Import bank statement files and create normalized bank statement lines",
  ],
  [
    "bank.statements.read",
    "Read bank statement imports and normalized statement line queue",
  ],
  [
    "bank.reconcile.read",
    "Read bank reconciliation queue, suggestions, and audit trail",
  ],
  [
    "bank.reconcile.write",
    "Create/reverse bank reconciliation matches and ignore actions",
  ],
  [
    "bank.reconcile.templates.read",
    "Read bank reconciliation auto-posting templates (B08-A)",
  ],
  [
    "bank.reconcile.templates.write",
    "Create/update bank reconciliation auto-posting templates (B08-A)",
  ],
  [
    "bank.reconcile.diffprofiles.read",
    "Read bank reconciliation difference profiles (B08-B)",
  ],
  [
    "bank.reconcile.diffprofiles.write",
    "Create/update bank reconciliation difference profiles (B08-B)",
  ],
  [
    "bank.reconcile.rules.read",
    "Read bank reconciliation automation rules (B07)",
  ],
  [
    "bank.reconcile.rules.write",
    "Create/update bank reconciliation automation rules (B07)",
  ],
  [
    "bank.reconcile.auto.run",
    "Run bank reconciliation automation preview/apply (B07)",
  ],
  [
    "bank.reconcile.exceptions.read",
    "Read bank reconciliation exception queue (B07)",
  ],
  [
    "bank.reconcile.exceptions.write",
    "Assign/resolve/ignore/retry bank reconciliation exceptions (B07)",
  ],
  [
    "payments.batch.read",
    "Read generic payment batches, lines, exports, and audit",
  ],
  ["payments.batch.create", "Create generic payment batches"],
  ["payments.batch.approve", "Approve generic payment batches (maker-checker)"],
  [
    "payments.batch.export",
    "Export generic payment batches to payment files (v1 CSV)",
  ],
  ["payments.batch.post", "Post generic payment batch settlement journals"],
  ["payments.batch.cancel", "Cancel non-posted generic payment batches"],
  [
    "bank.payments.export.read",
    "Read bank-facing payment file export runs for generic payment batches",
  ],
  [
    "bank.payments.export.create",
    "Create bank-facing payment files (B06 wrapper export) for generic payment batches",
  ],
  [
    "bank.payments.ack.read",
    "Read imported bank acknowledgement files for generic payment batches",
  ],
  [
    "bank.payments.ack.import",
    "Import bank acknowledgement files and update payment execution status (B06)",
  ],
  [
    "bank.payments.returns.read",
    "Read bank payment return/rejection events (B08-B)",
  ],
  [
    "bank.payments.returns.write",
    "Create/ignore bank payment return/rejection events (B08-B)",
  ],
  [
    "bank.approvals.policies.read",
    "Read bank governance approval policies (B09)",
  ],
  [
    "bank.approvals.policies.create",
    "Create bank governance approval policies (B09)",
  ],
  [
    "bank.approvals.policies.update",
    "Update bank governance approval policies (B09)",
  ],
  [
    "bank.approvals.requests.read",
    "Read bank governance approval request queue and decisions (B09)",
  ],
  [
    "bank.approvals.requests.submit",
    "Submit manual bank approval requests (B09)",
  ],
  ["bank.approvals.requests.approve", "Approve bank governance requests (B09)"],
  ["bank.approvals.requests.reject", "Reject bank governance requests (B09)"],
  [
    "bank.approvals.requests.approve.payment",
    "Approve bank payment export/release requests (B09)",
  ],
  [
    "bank.approvals.requests.approve.reconConfig",
    "Approve bank reconciliation rule/template/profile changes (B09)",
  ],
  [
    "bank.approvals.requests.approve.reconOverride",
    "Approve bank reconciliation exception override requests (B09)",
  ],
  [
    "bank.approvals.requests.approve.manualReturn",
    "Approve bank manual return/rejection creation requests (B09)",
  ],
  [
    "approvals.policies.read",
    "Read unified approval policies across bank and payroll (H04)",
  ],
  [
    "approvals.policies.write",
    "Create/update unified approval policies across bank and payroll (H04)",
  ],
  [
    "approvals.requests.read",
    "Read unified approval requests and decisions across bank and payroll (H04)",
  ],
  [
    "approvals.requests.submit",
    "Submit unified approval requests manually (H04)",
  ],
  ["approvals.requests.approve", "Approve unified approval requests (H04)"],
  ["approvals.requests.reject", "Reject unified approval requests (H04)"],
  ["workflow.definition.read", "Read workflow definitions"],
  ["workflow.definition.write", "Create/update workflow definitions"],
  ["workflow.assignment.read", "Read workflow assignments"],
  ["workflow.assignment.write", "Create/update workflow assignments"],
  [
    "payroll.runs.read",
    "Read payroll runs, lines, and payroll import audit trail",
  ],
  [
    "payroll.runs.import",
    "Import payroll provider CSV into payroll subledger runs",
  ],
  [
    "payroll.provider.read",
    "Read payroll provider adapters, connections, employee refs, and import jobs",
  ],
  ["payroll.provider.write", "Create/update payroll provider connections"],
  [
    "payroll.provider.mapping.read",
    "Read payroll external employee to internal employee mappings",
  ],
  [
    "payroll.provider.mapping.write",
    "Create/update payroll external employee to internal employee mappings",
  ],
  [
    "payroll.provider.import.read",
    "Read payroll provider import preview/apply jobs and audit trail",
  ],
  [
    "payroll.provider.import.preview",
    "Preview payroll provider imports and store normalized canonical payloads",
  ],
  [
    "payroll.provider.import.apply",
    "Apply payroll provider import previews into payroll runs (maker-checker)",
  ],
  [
    "payroll.provider.import.retention.manage",
    "Mask/purge raw payload retention for payroll provider import jobs",
  ],
  [
    "bank.integration.retention.manage",
    "Mask/purge raw payload retention for bank integration feeds/webhooks/imports",
  ],
  [
    "security.sensitive_data.audit.read",
    "Read sensitive data lifecycle audit trail (encryption, masking, purging)",
  ],
  ["ops.jobs.read", "Read tenant-scoped background jobs and attempts"],
  ["ops.jobs.manage", "Cancel/requeue tenant-scoped background jobs"],
  ["ops.jobs.run", "Run one tenant-scoped background job manually (admin/ops)"],
  ["ops.dashboard.read", "Read operational dashboard KPI/SLA/health summaries"],
  ["ops.exceptions.read", "Read unified exception workbench queue and audit"],
  ["ops.exceptions.manage", "Claim/resolve/ignore/reopen unified exceptions"],
  [
    "ops.retention.read",
    "Read data retention policies/runs and retention execution history (H07)",
  ],
  [
    "ops.retention.manage",
    "Create/update/execute data retention policies and runs (H07)",
  ],
  [
    "ops.export_snapshot.read",
    "Read closed-period immutable export snapshots and hashes (H07)",
  ],
  [
    "ops.export_snapshot.create",
    "Create immutable export snapshots for closed payroll periods (H07)",
  ],
  [
    "payroll.mappings.read",
    "Read effective-dated payroll component to GL mappings",
  ],
  ["payroll.mappings.write", "Create/update payroll component to GL mappings"],
  [
    "payroll.runs.review",
    "Mark payroll runs as reviewed before accrual posting",
  ],
  [
    "payroll.runs.finalize",
    "Finalize payroll runs and post accrual journals to GL",
  ],
  [
    "payroll.liabilities.read",
    "Read payroll liabilities, run-level liability summaries, and audit",
  ],
  [
    "payroll.liabilities.build",
    "Build payroll liabilities from finalized payroll runs",
  ],
  ["payroll.ownership.read", "Read payroll employee owner-context assignments"],
  [
    "payroll.ownership.write",
    "Create/update/deactivate payroll employee owner-context assignments",
  ],
  [
    "payroll.payment.prepare",
    "Prepare generic payment batches from payroll liabilities",
  ],
  [
    "payroll.payment.sync.read",
    "Preview payroll liability settlement sync from payments and bank reconciliation",
  ],
  [
    "payroll.payment.sync.apply",
    "Apply payroll liability settlement sync from payments and bank reconciliation",
  ],
  [
    "payroll.settlement.override.read",
    "Read payroll manual settlement override requests and liability override history",
  ],
  [
    "payroll.settlement.override.request",
    "Create payroll manual settlement override requests (maker)",
  ],
  [
    "payroll.settlement.override.approve",
    "Approve/apply or reject payroll manual settlement override requests (checker)",
  ],
  ["payroll.beneficiary.read", "Read payroll beneficiary bank master accounts"],
  [
    "payroll.beneficiary.write",
    "Create/update payroll beneficiary bank master accounts",
  ],
  [
    "payroll.beneficiary.set_primary",
    "Set primary payroll beneficiary bank account",
  ],
  [
    "payroll.beneficiary.snapshot.read",
    "Read payroll liability beneficiary bank snapshots",
  ],
  [
    "payroll.sensitive.read",
    "Override masking for payroll salary and payroll bank fields",
  ],
  [
    "payroll.close.read",
    "Read payroll close controls, checklist results, and close audit",
  ],
  [
    "payroll.close.prepare",
    "Prepare payroll close checklist and lock flags for a payroll period",
  ],
  [
    "payroll.close.request",
    "Request payroll period close after checklist passes (maker)",
  ],
  [
    "payroll.close.approve",
    "Approve and close payroll period after request (checker)",
  ],
  [
    "payroll.close.reopen",
    "Reopen closed payroll period close controls and release locks",
  ],
  [
    "payroll.corrections.read",
    "Read payroll correction links, reversal runs, and correction shell relationships",
  ],
  [
    "payroll.corrections.create",
    "Create payroll correction shells (OFF_CYCLE/RETRO)",
  ],
  [
    "payroll.corrections.reverse",
    "Reverse finalized payroll runs and create linked reversal runs",
  ],
  ["cari.card.read", "Read counterparty (cari) cards"],
  ["cari.card.request", "Submit/read counterparty (cari) master requests"],
  ["cari.request.review", "Approve/reject counterparty (cari) master requests"],
  ["cari.card.upsert", "Create/update counterparty (cari) cards"],
  ["item.card.read", "Read item cards"],
  ["item.card.upsert", "Create/update item cards"],
  [
    "inventory.read",
    "Read inventory warehouses, stock links, movements, and cost layers",
  ],
  ["inventory.materialize", "Materialize inventory movements from pending stock links"],
  ["inventory.movement.reverse", "Reverse posted inventory movements"],
  ["inventory.transfer.create", "Create inventory transfer drafts"],
  ["inventory.transfer.ship", "Ship inventory transfers"],
  ["inventory.transfer.receive", "Receive inventory transfers"],
  ["inventory.transfer.cancel", "Cancel inventory transfers before completion"],
  ["inventory.transfer.evidence.upsert", "Create/update inventory transfer evidence"],
  ["inventory.warehouse.upsert", "Create/update inventory warehouses and receipt policy"],
  ["inventory.landed_cost.upsert", "Create/reverse inventory landed-cost vouchers"],
  ["inventory.transfer.approve", "Approve inventory transfers"],
  ["inventory.transfer.reverse", "Reverse completed inventory transfers"],
  [
    "fixed_assets.read",
    "Read fixed asset register, detail, lifecycle transactions, and evidence metadata",
  ],
  [
    "fixed_assets.upsert",
    "Create/update draft fixed assets and category-defaulted asset masters",
  ],
  [
    "fixed_assets.post",
    "Activate and post fixed-asset acquisition or capitalization entries",
  ],
  [
    "fixed_assets.depreciation.run",
    "Preview/create/post fixed-asset depreciation runs",
  ],
  [
    "fixed_assets.depreciation.reverse",
    "Reverse posted fixed-asset depreciation runs",
  ],
  [
    "fixed_assets.transfer",
    "Transfer fixed-asset ownership between operating units",
  ],
  ["fixed_assets.dispose", "Dispose, write off, or sell fixed assets"],
  [
    "fixed_assets.settings.read",
    "Read fixed-asset categories, depreciation profiles, and account defaults",
  ],
  [
    "fixed_assets.settings.upsert",
    "Create/update fixed-asset categories, depreciation profiles, and account defaults",
  ],
  [
    "fixed_assets.custodian.read",
    "Read fixed-asset interim custodian setup records",
  ],
  [
    "fixed_assets.custodian.write",
    "Create/update fixed-asset interim custodian setup records",
  ],
  [
    "fixed_assets.account_override",
    "Override fixed-asset account defaults during acquisition, capitalization, or disposal posting",
  ],
  [
    "fixed_assets.report.read",
    "Read fixed-asset register, rollforward, depreciation, and disposal reports",
  ],
  ["cari.doc.read", "Read Cari documents"],
  ["cari.doc.create", "Create Cari documents"],
  ["cari.doc.update", "Update draft Cari documents"],
  ["cari.doc.submit", "Submit governed Cari documents for workflow review"],
  ["cari.doc.cancel", "Cancel draft or returned Cari documents"],
  ["cari.doc.post", "Post Cari documents"],
  ["cari.doc.reverse", "Reverse posted Cari documents"],
  ["cari.settlement.apply", "Apply Cari settlement allocations"],
  ["cari.settlement.reverse", "Reverse Cari settlement batches"],
  ["cari.report.read", "Read Cari reports"],
  ["cari.fx.override", "Override Cari FX rates during posting/settlement"],
  ["cari.audit.read", "Read Cari audit trail"],
  ["cari.bank.attach", "Attach Cari records to bank lines"],
  ["cari.bank.apply", "Apply Cari bank-linked settlements/unapplied cash"],
  ["contract.read", "Read contracts and linked document summaries"],
  ["contract.upsert", "Create/update draft contracts and line sets"],
  ["contract.activate", "Activate contracts"],
  ["contract.suspend", "Suspend active contracts"],
  ["contract.close", "Close contracts"],
  ["contract.cancel", "Cancel draft contracts"],
  ["contract.link_document", "Create contract-document links"],
  ["revenue.schedule.read", "Read revenue-recognition schedules"],
  ["revenue.schedule.generate", "Generate revenue-recognition schedules"],
  ["revenue.run.read", "Read revenue-recognition runs"],
  ["revenue.run.create", "Create revenue-recognition runs"],
  ["revenue.run.post", "Post revenue-recognition runs"],
  ["revenue.run.reverse", "Reverse revenue-recognition runs"],
  ["revenue.report.read", "Read revenue-recognition reports"],
  ["fx.rate.bulk_upsert", "Bulk upsert FX rates"],
  ["fx.rate.read", "Read FX rates"],
  ["intercompany.flag.read", "Read legal entity intercompany flags"],
  ["intercompany.flag.upsert", "Create/update legal entity intercompany flags"],
  ["intercompany.pair.upsert", "Create/update intercompany pairs"],
  ["intercompany.reconcile.run", "Run intercompany reconciliation"],
  ["consolidation.group.read", "Read consolidation groups"],
  ["consolidation.group.upsert", "Create/update consolidation groups"],
  ["consolidation.group_member.upsert", "Create/update consolidation members"],
  ["consolidation.coa_mapping.read", "Read group CoA mappings"],
  ["consolidation.coa_mapping.upsert", "Create/update group CoA mappings"],
  [
    "consolidation.elimination_placeholder.read",
    "Read elimination placeholders",
  ],
  [
    "consolidation.elimination_placeholder.upsert",
    "Create/update elimination placeholders",
  ],
  ["consolidation.run.read", "Read consolidation runs"],
  ["consolidation.run.create", "Create consolidation runs"],
  ["consolidation.run.execute", "Execute consolidation runs"],
  ["consolidation.elimination.create", "Create elimination entries"],
  ["consolidation.elimination.post", "Post elimination entries"],
  ["consolidation.adjustment.create", "Create consolidation adjustments"],
  ["consolidation.adjustment.post", "Post consolidation adjustments"],
  ["consolidation.run.finalize", "Finalize consolidation runs"],
  [
    "consolidation.report.trial_balance.read",
    "Read consolidation trial balance",
  ],
  ["consolidation.report.summary.read", "Read consolidation summary report"],
  [
    "consolidation.report.balance_sheet.read",
    "Read consolidation balance sheet",
  ],
  [
    "consolidation.report.income_statement.read",
    "Read consolidation income statement",
  ],
  ["onboarding.company.setup", "Run company onboarding bootstrap flow"],
];

const VALID_PERMISSION_GROUP_CODES = new Set(PERMISSION_GROUP_CODES);
const VALID_PERMISSION_CODES = new Set(PERMISSIONS.map(([code]) => code));

function assertKnownPermissionCode(permissionCode) {
  if (!VALID_PERMISSION_CODES.has(permissionCode)) {
    throw new Error(
      `Unknown permission code ${permissionCode} referenced by seeded role`,
    );
  }
}

function expandPermissionGroupPermissionCodes(
  permissionGroupCode,
  visited = new Set(),
) {
  const definition = PERMISSION_GROUPS[permissionGroupCode];
  if (!definition) {
    throw new Error(`Unknown permission group ${permissionGroupCode}`);
  }
  if (visited.has(permissionGroupCode)) {
    return [];
  }

  visited.add(permissionGroupCode);

  const expandedPermissionCodes = [];
  for (const includedGroupCode of definition.includes || []) {
    expandedPermissionCodes.push(
      ...expandPermissionGroupPermissionCodes(includedGroupCode, visited),
    );
  }
  for (const permissionCode of definition.permissions || []) {
    assertKnownPermissionCode(permissionCode);
    expandedPermissionCodes.push(permissionCode);
  }

  return expandedPermissionCodes;
}

function buildPermissionList({ permissionGroups = [], permissions = [] }) {
  const resolvedPermissionCodes = [];
  const seenPermissionCodes = new Set();

  for (const permissionGroupCode of permissionGroups) {
    for (const permissionCode of expandPermissionGroupPermissionCodes(
      permissionGroupCode,
    )) {
      if (seenPermissionCodes.has(permissionCode)) {
        continue;
      }
      seenPermissionCodes.add(permissionCode);
      resolvedPermissionCodes.push(permissionCode);
    }
  }

  for (const permissionCode of permissions) {
    assertKnownPermissionCode(permissionCode);
    if (seenPermissionCodes.has(permissionCode)) {
      continue;
    }
    seenPermissionCodes.add(permissionCode);
    resolvedPermissionCodes.push(permissionCode);
  }

  return Object.freeze(resolvedPermissionCodes);
}

const ROLE_SCOPE_CONTEXT_PERMISSION_CODES = Object.freeze([
  "org.tree.read",
  "org.fiscal_calendar.read",
  "org.fiscal_period.read",
]);

const OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES = Object.freeze([
  "security.operational_coverage.read",
  "security.operational_coverage.request",
]);

const OPERATIONAL_COVERAGE_MANAGER_PERMISSION_CODES = Object.freeze([
  ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
  "security.operational_coverage.review",
  "security.operational_coverage.revoke",
  "approvals.requests.read",
]);

const LOCAL_USER_ADMIN_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "security.user_admin.local",
    ...OPERATIONAL_COVERAGE_MANAGER_PERMISSION_CODES,
  ],
});

const MASTER_DATA_STEWARD_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["gl.masterdata"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
    "cari.card.read",
    // Counterparty master requests are governed master-data review, not a
    // legacy controller-only workflow.
    "cari.request.review",
    // Generic approval engine access — required to view and act on approval
    // requests (e.g. counterparty master-data requests) routed through the
    // unified H04 approval engine.
    "approvals.requests.read",
    "approvals.requests.approve",
    "approvals.requests.reject",
    "approvals.policies.read",
    "org.group_company.upsert",
    "org.legal_entity.upsert",
    "org.operating_unit.upsert",
    "org.fiscal_calendar.upsert",
    "org.fiscal_period.generate",
    "org.shareholder.upsert",
    "fx.rate.read",
    "fx.rate.bulk_upsert",
  ],
});

const COUNTERPARTY_CARD_EDITOR_PERMISSION_CODES = buildPermissionList({
  permissions: [
    // Live counterparty-card maintenance stays separate from request/review so
    // tenants do not need to fall back to retired broad accountant roles just
    // to set one vendor/customer account override.
    "cari.card.read",
    "cari.card.upsert",
    "gl.account.read",
  ],
});

const ENTITY_AP_CONTROLLER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    // Approve/return stay on workflow step assignment only. This role is the
    // legal-entity submitter/editor seam, not a parallel reviewer gate.
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "cari.doc.read",
    "cari.doc.update",
    "cari.doc.submit",
  ],
});

const OU_AP_SUBMITTER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    // Optional operating-unit submitter seam for branches that can hand off
    // their own AP drafts without inheriting legal-entity submit coverage.
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "cari.doc.read",
    "cari.doc.update",
    "cari.doc.submit",
  ],
});

const COUNTRY_AP_APPROVER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    // Country approval authority is workflow-driven, so CARI-side access stays
    // read-only here and step assignment provides the decision power.
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "cari.doc.read",
  ],
});

const COUNTRY_AP_POSTER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "cari.doc.read",
    "cari.doc.post",
    "cari.doc.reverse",
  ],
});

const AP_APPROVER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "approvals.policies.read",
    "approvals.requests.read",
    "approvals.requests.approve",
    "approvals.requests.reject",
  ],
});

// Dedicated runtime replacements for package-only governed authorities.
// Keep these explicit and narrow so role-only explainability and SoD can
// reason over real business duties without managed package-role indirection.
const WORKFLOW_GOVERNANCE_ADMIN_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "workflow.definition.read",
    "workflow.definition.write",
    "workflow.assignment.read",
    "workflow.assignment.write",
    "approvals.policies.read",
    "approvals.policies.write",
  ],
});

const WORKFLOW_QUEUE_VIEWER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "workflow.definition.read",
    "workflow.assignment.read",
    "approvals.requests.read",
  ],
});

const GL_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["gl.operations"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
    "fx.rate.read",
  ],
});

const GL_POSTING_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "org.tree.read",
    "org.fiscal_period.read",
    "gl.journal.read",
    "gl.trial_balance.read",
    "gl.journal.post",
    "gl.journal.reverse",
  ],
});

const SHAREHOLDER_CAPITAL_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["org.capital_fulfillment"],
  permissions: OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
});

const TREASURY_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["bank.operations"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
    "cash.register.read",
    "cash.register.upsert",
    "cash.session.open",
    "cash.session.close",
    "cash.txn.read",
    "cash.txn.create",
    "cash.txn.cancel",
    "cash.txn.post",
    "cash.txn.reverse",
    "cash.report.read",
    "cari.card.read",
    "cari.doc.read",
    "cari.report.read",
    "cari.bank.attach",
    "cari.bank.apply",
  ],
});

const TREASURY_APPROVER_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["bank.readonly"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "bank.approvals.policies.create",
    "bank.approvals.policies.update",
    "bank.approvals.requests.approve",
    "bank.approvals.requests.reject",
    "bank.approvals.requests.approve.payment",
    "bank.approvals.requests.approve.reconConfig",
    "bank.approvals.requests.approve.reconOverride",
    "bank.approvals.requests.approve.manualReturn",
    "payments.batch.approve",
    "cash.register.read",
    "cash.txn.read",
    "cash.report.read",
    "cash.variance.approve",
    "cash.fx.revaluation.override",
  ],
});

const PAYROLL_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["payroll.operations"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
  ],
});

const PAYROLL_APPROVER_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["payroll.readonly", "payroll.governance"],
  permissions: ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
});

const LOCAL_CLOSE_PREPARER_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["close.operator"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
    "close.cycle.read",
    "close.cockpit.read",
  ],
});

const LOCAL_CLOSE_REVIEWER_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["close.reviewer"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "close.cycle.read",
    "close.cycle.lock",
    "close.cockpit.read",
  ],
});

const LOCAL_CLOSE_APPROVE_LOCK_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "ouclose.read",
    "ouclose.approve",
    "ouclose.lock",
  ],
});

const LOCAL_CLOSE_REOPEN_ADMIN_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "ouclose.read",
    "ouclose.reopen",
    "ouclose.override_post_lock",
    "ouclose.admin",
  ],
});

const PERIOD_CLOSE_SUPERVISOR_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "gl.book.read",
    "gl.journal.read",
    "gl.trial_balance.read",
    "gl.report.local.read",
    "gl.report.ledger.read",
    "gl.report.statement.read",
    PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  ],
});

const PERIOD_CLOSE_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "gl.book.read",
    "gl.account.read",
    "gl.journal.read",
    "gl.trial_balance.read",
    "gl.report.local.read",
    "gl.report.ledger.read",
    "gl.report.statement.read",
    PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  ],
});

const PERIOD_REOPEN_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "gl.book.read",
    "gl.journal.read",
    "gl.trial_balance.read",
    PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
  ],
});

const PERIOD_ADMIN_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "gl.book.read",
    "gl.journal.read",
    "gl.trial_balance.read",
    PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  ],
});

const CLOSED_PERIOD_JOURNAL_OVERRIDE_AUTHORITY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "org.fiscal_period.read",
    "gl.book.read",
    "gl.journal.read",
    "gl.trial_balance.read",
    "gl.journal.post",
    PERIOD_CLOSE_CLOSED_POST_PERMISSION_CODE,
  ],
});

const GROUP_REPORTING_CONTROLLER_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["gl.readonly"],
  permissions: [
    ...ROLE_SCOPE_CONTEXT_PERMISSION_CODES,
    "fx.rate.read",
    "intercompany.flag.read",
    "intercompany.flag.upsert",
    "intercompany.pair.upsert",
    "intercompany.reconcile.run",
    "consolidation.group.read",
    "consolidation.group.upsert",
    "consolidation.group_member.upsert",
    "consolidation.coa_mapping.read",
    "consolidation.coa_mapping.upsert",
    "consolidation.elimination_placeholder.read",
    "consolidation.elimination_placeholder.upsert",
    "consolidation.run.read",
    "consolidation.run.create",
    "consolidation.run.execute",
    "consolidation.elimination.create",
    "consolidation.elimination.post",
    "consolidation.adjustment.create",
    "consolidation.adjustment.post",
    "consolidation.run.finalize",
    "consolidation.report.trial_balance.read",
    "consolidation.report.summary.read",
    "consolidation.report.balance_sheet.read",
    "consolidation.report.income_statement.read",
    "close.cycle.read",
    "close.cycle.lock",
    "close.cockpit.read",
  ],
});

const CONSOLIDATION_RUN_PREPARER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "consolidation.group.read",
    "consolidation.coa_mapping.read",
    "consolidation.elimination_placeholder.read",
    "consolidation.run.read",
    "consolidation.run.create",
  ],
});

const CONSOLIDATION_RUN_EXECUTOR_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "consolidation.run.read",
    "consolidation.run.execute",
  ],
});

const CONSOLIDATION_ADJUSTMENT_POSTER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "consolidation.run.read",
    "consolidation.adjustment.create",
    "consolidation.adjustment.post",
  ],
});

const CONSOLIDATION_ELIMINATION_POSTER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "consolidation.run.read",
    "consolidation.elimination.create",
    "consolidation.elimination.post",
  ],
});

const CONSOLIDATION_FINALIZER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "consolidation.run.read",
    "consolidation.run.finalize",
  ],
});

const CONSOLIDATION_SETUP_ADMIN_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "consolidation.group.read",
    "consolidation.group.upsert",
    "consolidation.group_member.upsert",
    "consolidation.coa_mapping.read",
    "consolidation.coa_mapping.upsert",
    "consolidation.elimination_placeholder.read",
    "consolidation.elimination_placeholder.upsert",
    "intercompany.flag.read",
    "intercompany.flag.upsert",
    "intercompany.pair.upsert",
  ],
});

const INVENTORY_VIEWER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "org.tree.read",
    // Item-card read screens need account lookup visibility to show mapped
    // posting accounts without granting GL master-data maintenance.
    "gl.account.read",
    "item.card.read",
    "inventory.read",
  ],
});

const INVENTORY_EXECUTOR_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...INVENTORY_VIEWER_PERMISSION_CODES,
    "inventory.materialize",
    "inventory.movement.reverse",
    "inventory.transfer.create",
    "inventory.transfer.ship",
    "inventory.transfer.receive",
    "inventory.transfer.cancel",
    "inventory.transfer.evidence.upsert",
  ],
});

const INVENTORY_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...INVENTORY_EXECUTOR_PERMISSION_CODES,
    "item.card.upsert",
    "inventory.warehouse.upsert",
    "inventory.landed_cost.upsert",
    "inventory.transfer.approve",
    "inventory.transfer.reverse",
  ],
});

const FIXED_ASSET_VIEWER_PERMISSION_CODES = buildPermissionList({
  permissions: [
    "org.tree.read",
    // Fixed-asset detail and settings-read pages surface account mappings but
    // should not imply GL master-data maintenance.
    "gl.account.read",
    "fixed_assets.read",
    "fixed_assets.settings.read",
    "fixed_assets.custodian.read",
    "fixed_assets.report.read",
  ],
});

const BRANCH_FIXED_ASSET_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...FIXED_ASSET_VIEWER_PERMISSION_CODES,
    "fixed_assets.upsert",
  ],
});

const ENTITY_FIXED_ASSET_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...FIXED_ASSET_VIEWER_PERMISSION_CODES,
    // Entity-side lifecycle governance needs fiscal-period visibility for
    // depreciation-run orchestration without inheriting broader GL posting.
    "org.fiscal_period.read",
    "fixed_assets.upsert",
    "fixed_assets.post",
    "fixed_assets.transfer",
    "fixed_assets.dispose",
    "fixed_assets.settings.upsert",
    "fixed_assets.custodian.write",
    "fixed_assets.depreciation.run",
    "fixed_assets.depreciation.reverse",
  ],
});

const BRANCH_OPERATOR_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["gl.readonly"],
  permissions: [
    ...OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES,
    "org.tree.read",
    "org.fiscal_calendar.read",
    "org.fiscal_period.read",
    "cash.register.read",
    "cash.session.open",
    "cash.session.close",
    "cash.txn.read",
    "cash.txn.create",
    "cash.txn.cancel",
    "cash.report.read",
    "cari.card.read",
    "cari.card.request",
    "item.card.read",
    "inventory.read",
    "cari.doc.read",
    "cari.doc.create",
    "cari.doc.update",
    "cari.doc.submit",
    "cari.doc.cancel",
    "cari.settlement.apply",
    "cari.report.read",
    "cari.bank.attach",
    "contract.read",
    "contract.upsert",
    "contract.link_document",
    "revenue.schedule.read",
    "revenue.schedule.generate",
    "revenue.run.read",
    "revenue.run.create",
    "revenue.report.read",
  ],
});

const AUDITOR_READ_ONLY_PERMISSION_CODES = buildPermissionList({
  permissions: [
    ...PERMISSIONS.map(([permissionCode]) => permissionCode).filter(
      (permissionCode) => permissionCode.endsWith(".read"),
    ),
    "security.operational_coverage.request",
    "security.audit.report.generate",
    "security.audit.report.export",
  ],
});

export const ROLE_CAPABILITY_GROUPS = Object.freeze({
  LocalUserAdmin: Object.freeze([]),
  MasterDataSteward: Object.freeze(["gl.masterdata"]),
  CounterpartyCardEditor: Object.freeze([]),
  EntityAPController: Object.freeze([]),
  OUAPSubmitter: Object.freeze([]),
  CountryAPApprover: Object.freeze([]),
  CountryAPPoster: Object.freeze([]),
  APApprover: Object.freeze([]),
  WorkflowGovernanceAdmin: Object.freeze([]),
  WorkflowQueueViewer: Object.freeze([]),
  GLOperator: Object.freeze(["gl.operations"]),
  GLPostingAuthority: Object.freeze(["gl.posting"]),
  ShareholderCapitalOperator: Object.freeze(["org.capital_fulfillment"]),
  OUAccountant: Object.freeze(["gl.operations"]),
  TreasuryOperator: Object.freeze(["bank.operations"]),
  TreasuryApprover: Object.freeze(["bank.readonly", "bank.governance"]),
  PayrollOperator: Object.freeze(["payroll.operations"]),
  PayrollApprover: Object.freeze(["payroll.readonly", "payroll.governance"]),
  LocalClosePreparer: Object.freeze(["close.operator"]),
  LocalCloseReviewer: Object.freeze(["close.reviewer"]),
  LocalCloseApproveLockAuthority: Object.freeze([]),
  LocalCloseReopenAdminAuthority: Object.freeze([]),
  PeriodCloseSupervisorAuthority: Object.freeze([]),
  PeriodCloseAuthority: Object.freeze([]),
  PeriodReopenAuthority: Object.freeze([]),
  PeriodAdminAuthority: Object.freeze([]),
  ClosedPeriodJournalOverrideAuthority: Object.freeze([]),
  GroupReportingController: Object.freeze(["gl.readonly"]),
  ConsolidationRunPreparer: Object.freeze([]),
  ConsolidationRunExecutor: Object.freeze([]),
  ConsolidationAdjustmentPoster: Object.freeze([]),
  ConsolidationEliminationPoster: Object.freeze([]),
  ConsolidationFinalizer: Object.freeze([]),
  ConsolidationSetupAdmin: Object.freeze([]),
  BranchInventoryViewer: Object.freeze([]),
  EntityInventoryViewer: Object.freeze([]),
  BranchInventoryExecutor: Object.freeze([]),
  BranchInventoryOperator: Object.freeze([]),
  EntityInventoryOperator: Object.freeze([]),
  BranchFixedAssetViewer: Object.freeze([]),
  EntityFixedAssetViewer: Object.freeze([]),
  BranchFixedAssetOperator: Object.freeze([]),
  EntityFixedAssetOperator: Object.freeze([]),
  BranchOperator: Object.freeze([
    // Branch/OU roles keep GL visibility even after manual posting is removed.
    "gl.readonly",
  ]),
  AuditorReadOnly: Object.freeze([
    "gl.readonly",
    "bank.readonly",
    "payroll.readonly",
  ]),
});

function validateRoleCapabilityGroups() {
  for (const [roleCode, capabilityGroups] of Object.entries(
    ROLE_CAPABILITY_GROUPS,
  )) {
    for (const capabilityGroup of capabilityGroups) {
      if (!VALID_PERMISSION_GROUP_CODES.has(capabilityGroup)) {
        throw new Error(
          `Unknown capability group ${capabilityGroup} referenced by role ${roleCode}`,
        );
      }
    }
  }
}

function attachRoleMetadata(roleDefinitions) {
  validateRoleCapabilityGroups();

  return roleDefinitions.map((roleDefinition) => {
    return {
      ...roleDefinition,
      permissions: [...roleDefinition.permissions],
      capabilityGroups: [
        ...(ROLE_CAPABILITY_GROUPS[roleDefinition.code] || []),
      ],
    };
  });
}

function validateSeedRoleDefinitions(roleDefinitions) {
  const warningMessages = [];

  for (const roleDefinition of roleDefinitions) {
    const subjectLabel = `Role ${roleDefinition.code}`;
    const evaluation = assertValidPermissionRuleSet({
      permissionCodes: roleDefinition.permissions,
      capabilityGroups: roleDefinition.capabilityGroups,
      subjectLabel,
    });

    if (
      roleDefinition.code === "SecurityAdmin" ||
      roleDefinition.code === "SystemAdmin"
    ) {
      continue;
    }

    for (const warning of evaluation.warnings) {
      warningMessages.push(warning.message);
    }
  }

  return warningMessages;
}

const ALL_ROLE_DEFINITIONS = attachRoleMetadata([
  ...buildSystemRoleDefinitions(PERMISSIONS.map(([code]) => code)),
  {
    code: "LocalUserAdmin",
    name: "Local User Admin",
    permissions: LOCAL_USER_ADMIN_PERMISSION_CODES,
  },
  {
    code: "MasterDataSteward",
    name: "Master Data Steward",
    permissions: MASTER_DATA_STEWARD_PERMISSION_CODES,
  },
  {
    code: "CounterpartyCardEditor",
    name: "Counterparty Card Editor",
    permissions: COUNTERPARTY_CARD_EDITOR_PERMISSION_CODES,
  },
  {
    code: "EntityAPController",
    name: "Entity AP Controller",
    permissions: ENTITY_AP_CONTROLLER_PERMISSION_CODES,
  },
  {
    code: "OUAPSubmitter",
    name: "OU AP Submitter",
    permissions: OU_AP_SUBMITTER_PERMISSION_CODES,
  },
  {
    code: "CountryAPApprover",
    name: "Country AP Approver",
    permissions: COUNTRY_AP_APPROVER_PERMISSION_CODES,
  },
  {
    code: "CountryAPPoster",
    name: "Country AP Poster",
    permissions: COUNTRY_AP_POSTER_PERMISSION_CODES,
  },
  {
    code: "APApprover",
    name: "AP Approver",
    permissions: AP_APPROVER_PERMISSION_CODES,
  },
  {
    code: "WorkflowGovernanceAdmin",
    name: "Workflow Governance Admin",
    permissions: WORKFLOW_GOVERNANCE_ADMIN_PERMISSION_CODES,
  },
  {
    code: "WorkflowQueueViewer",
    name: "Workflow Queue Viewer",
    permissions: WORKFLOW_QUEUE_VIEWER_PERMISSION_CODES,
  },
  {
    code: "GLOperator",
    name: "GL Operator",
    permissions: GL_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "GLPostingAuthority",
    name: "GL Posting Authority",
    permissions: GL_POSTING_AUTHORITY_PERMISSION_CODES,
  },
  {
    // Shareholder capital fulfillment posts and reverses real accounting events,
    // but it should not drag broader org-master-data or treasury-admin powers
    // into the steady-state role model.
    code: "ShareholderCapitalOperator",
    name: "Shareholder Capital Operator",
    permissions: SHAREHOLDER_CAPITAL_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "OUAccountant",
    name: "OU Accountant",
    permissions: GL_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "TreasuryOperator",
    name: "Treasury Operator",
    permissions: TREASURY_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "TreasuryApprover",
    name: "Treasury Approver",
    permissions: TREASURY_APPROVER_PERMISSION_CODES,
  },
  {
    code: "PayrollOperator",
    name: "Payroll Operator",
    permissions: PAYROLL_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "PayrollApprover",
    name: "Payroll Approver",
    permissions: PAYROLL_APPROVER_PERMISSION_CODES,
  },
  {
    code: "LocalClosePreparer",
    name: "Local Close Preparer",
    permissions: LOCAL_CLOSE_PREPARER_PERMISSION_CODES,
  },
  {
    code: "LocalCloseReviewer",
    name: "Local Close Reviewer",
    permissions: LOCAL_CLOSE_REVIEWER_PERMISSION_CODES,
  },
  {
    code: "LocalCloseApproveLockAuthority",
    name: "Local Close Approve & Lock Authority",
    permissions: LOCAL_CLOSE_APPROVE_LOCK_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "LocalCloseReopenAdminAuthority",
    name: "Local Close Reopen / Admin Authority",
    permissions: LOCAL_CLOSE_REOPEN_ADMIN_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "PeriodCloseSupervisorAuthority",
    name: "Period Close Supervisor Authority",
    permissions: PERIOD_CLOSE_SUPERVISOR_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "PeriodCloseAuthority",
    name: "Period Close Authority",
    permissions: PERIOD_CLOSE_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "PeriodReopenAuthority",
    name: "Period Reopen Authority",
    permissions: PERIOD_REOPEN_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "PeriodAdminAuthority",
    name: "Period Close Admin Authority",
    permissions: PERIOD_ADMIN_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "ClosedPeriodJournalOverrideAuthority",
    name: "Closed-Period Journal Override Authority",
    permissions: CLOSED_PERIOD_JOURNAL_OVERRIDE_AUTHORITY_PERMISSION_CODES,
  },
  {
    code: "GroupReportingController",
    name: "Group Reporting Controller",
    permissions: GROUP_REPORTING_CONTROLLER_PERMISSION_CODES,
  },
  {
    code: "ConsolidationRunPreparer",
    name: "Consolidation Run Preparer",
    permissions: CONSOLIDATION_RUN_PREPARER_PERMISSION_CODES,
  },
  {
    code: "ConsolidationRunExecutor",
    name: "Consolidation Run Executor",
    permissions: CONSOLIDATION_RUN_EXECUTOR_PERMISSION_CODES,
  },
  {
    code: "ConsolidationAdjustmentPoster",
    name: "Consolidation Adjustment Poster",
    permissions: CONSOLIDATION_ADJUSTMENT_POSTER_PERMISSION_CODES,
  },
  {
    code: "ConsolidationEliminationPoster",
    name: "Consolidation Elimination Poster",
    permissions: CONSOLIDATION_ELIMINATION_POSTER_PERMISSION_CODES,
  },
  {
    code: "ConsolidationFinalizer",
    name: "Consolidation Finalizer",
    permissions: CONSOLIDATION_FINALIZER_PERMISSION_CODES,
  },
  {
    code: "ConsolidationSetupAdmin",
    name: "Consolidation Setup Admin",
    permissions: CONSOLIDATION_SETUP_ADMIN_PERMISSION_CODES,
  },
  {
    code: "BranchInventoryViewer",
    name: "Branch Inventory Viewer",
    permissions: INVENTORY_VIEWER_PERMISSION_CODES,
  },
  {
    code: "BranchInventoryExecutor",
    name: "Branch Inventory Executor",
    permissions: INVENTORY_EXECUTOR_PERMISSION_CODES,
  },
  {
    code: "EntityInventoryViewer",
    name: "Entity Inventory Viewer",
    permissions: INVENTORY_VIEWER_PERMISSION_CODES,
  },
  {
    code: "BranchInventoryOperator",
    name: "Branch Inventory Operator",
    permissions: INVENTORY_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "EntityInventoryOperator",
    name: "Entity Inventory Operator",
    permissions: INVENTORY_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "BranchFixedAssetViewer",
    name: "Branch Fixed Asset Viewer",
    permissions: FIXED_ASSET_VIEWER_PERMISSION_CODES,
  },
  {
    code: "EntityFixedAssetViewer",
    name: "Entity Fixed Asset Viewer",
    permissions: FIXED_ASSET_VIEWER_PERMISSION_CODES,
  },
  {
    code: "BranchFixedAssetOperator",
    name: "Branch Fixed Asset Operator",
    permissions: BRANCH_FIXED_ASSET_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "EntityFixedAssetOperator",
    name: "Entity Fixed Asset Operator",
    permissions: ENTITY_FIXED_ASSET_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "BranchOperator",
    name: "Branch Operator",
    permissions: BRANCH_OPERATOR_PERMISSION_CODES,
  },
  {
    code: "AuditorReadOnly",
    name: "Auditor (Read Only)",
    permissions: AUDITOR_READ_ONLY_PERMISSION_CODES,
  },
]);

const FIELD_VISIBILITY_ROLE_PERMISSION_ADDITIONS = Object.freeze({
  PayrollOperator: ["payroll.sensitive.read"],
  PayrollApprover: ["payroll.sensitive.read"],
});

const DEFAULT_FIELD_VISIBILITY_POLICY_DEFINITIONS = Object.freeze([
  {
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
    fieldName: "iban",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "security.sensitive_data.audit.read",
  },
  {
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
    fieldName: "account_no",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "security.sensitive_data.audit.read",
  },
  {
    moduleCode: "BANK",
    objectType: "BANK_CONNECTOR",
    fieldName: "credentials_json",
    visibilityRule: "HIDDEN",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "security.admin.system",
  },
  {
    moduleCode: "PAYROLL",
    objectType: "PAYROLL_RUN_LINE",
    fieldName: "base_salary",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "payroll.sensitive.read",
  },
  {
    moduleCode: "PAYROLL",
    objectType: "PAYROLL_RUN_LINE",
    fieldName: "net_pay",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "payroll.sensitive.read",
  },
  {
    moduleCode: "PAYROLL",
    objectType: "BENEFICIARY",
    fieldName: "iban",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "payroll.sensitive.read",
  },
  {
    moduleCode: "PAYROLL",
    objectType: "BENEFICIARY",
    fieldName: "account_number",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    requiredPermissionCode: "payroll.sensitive.read",
  },
]);

for (const role of ALL_ROLE_DEFINITIONS) {
  const additions = FIELD_VISIBILITY_ROLE_PERMISSION_ADDITIONS[role.code] || [];
  if (additions.length === 0) {
    continue;
  }
  role.permissions = Array.from(
    new Set([...(role.permissions || []), ...additions]),
  );
}

const ROLE_DEFINITION_WARNING_MESSAGES =
  validateSeedRoleDefinitions(ALL_ROLE_DEFINITIONS);

async function upsertCurrencies() {
  for (const [code, name, minorUnits] of BASE_CURRENCIES) {
    await query(
      `INSERT INTO currencies (code, name, minor_units)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         minor_units = VALUES(minor_units)`,
      [code, name, minorUnits],
    );
  }
}

async function upsertCountries() {
  for (const [iso2, iso3, name, defaultCurrencyCode] of BASE_COUNTRIES) {
    await query(
      `INSERT INTO countries (iso2, iso3, name, default_currency_code)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         iso3 = VALUES(iso3),
         name = VALUES(name),
         default_currency_code = VALUES(default_currency_code)`,
      [iso2, iso3, name, defaultCurrencyCode],
    );
  }
}

async function upsertPermissions() {
  for (const [code, description] of PERMISSIONS) {
    await query(
      `INSERT INTO permissions (code, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         description = VALUES(description)`,
      [code, description],
    );
  }
}

async function ensureDefaultTenant(defaultTenantCode, defaultTenantName) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [defaultTenantCode, defaultTenantName],
  );
}

async function getTenantIds() {
  const tenantRows = await query("SELECT id, code FROM tenants ORDER BY id");
  return tenantRows.rows;
}

async function getPermissionIdMap() {
  const { rows } = await query("SELECT id, code FROM permissions");
  const map = new Map();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

async function getRoleIdsByTenant(tenantId) {
  const { rows } = await query(
    "SELECT id, code FROM roles WHERE tenant_id = ?",
    [tenantId],
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

async function upsertRolesForTenant(tenantId, roleDefinitions) {
  for (const role of roleDefinitions) {
    await query(
      `INSERT INTO roles (tenant_id, code, name, is_system)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_system = VALUES(is_system)`,
      [
        tenantId,
        role.code,
        role.name,
        true,
      ],
    );
  }
}

async function upsertFieldVisibilityPoliciesForTenant(tenantId) {
  for (const policy of DEFAULT_FIELD_VISIBILITY_POLICY_DEFINITIONS) {
    const scopeType = String(policy.appliesToScopeType || "").trim() || null;
    const scopeId =
      scopeType === "TENANT"
        ? tenantId
        : parsePositiveInt(policy.appliesToScopeId);
    await query(
      `INSERT INTO field_visibility_policies (
          tenant_id,
          module_code,
          object_type,
          field_name,
          visibility_rule,
          applies_to_scope_type,
          applies_to_scope_id,
          required_permission_code,
          is_active,
          created_by_user_id
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
       ON DUPLICATE KEY UPDATE
         visibility_rule = VALUES(visibility_rule),
         required_permission_code = VALUES(required_permission_code),
         is_active = VALUES(is_active),
         updated_at = CURRENT_TIMESTAMP`,
      [
        tenantId,
        policy.moduleCode,
        policy.objectType,
        policy.fieldName,
        policy.visibilityRule,
        scopeType,
        scopeId,
        policy.requiredPermissionCode || null,
      ],
    );
  }
}

async function assignRolePermissionsForTenant(
  tenantId,
  permissionIdByCode,
  roleDefinitions,
) {
  const roleIdsByCode = await getRoleIdsByTenant(tenantId);

  for (const role of roleDefinitions) {
    const roleId = roleIdsByCode.get(role.code);
    if (!roleId) {
      throw new Error(`Role not found after upsert: ${role.code}`);
    }

    for (const permissionCode of role.permissions) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(
          `Permission not found for role binding: ${permissionCode}`,
        );
      }

      await query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         VALUES (?, ?)`,
        [roleId, permissionId],
      );
    }

    const desiredPermissionIds = role.permissions
      .map((permissionCode) => permissionIdByCode.get(permissionCode))
      .filter(Boolean);

    // Seeded system roles are authoritative here so transitional SoD cleanup
    // removes stale checker/posting powers during reseed as well as fresh seed.
    if (desiredPermissionIds.length === 0) {
      await query("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      continue;
    }

    await query(
      `DELETE FROM role_permissions
       WHERE role_id = ?
         AND permission_id NOT IN (${desiredPermissionIds.map(() => "?").join(", ")})`,
      [roleId, ...desiredPermissionIds],
    );
  }
}

/**
 * Seeds the core reference data, permission catalog, and authoritative seeded
 * system-role definitions for every tenant.
 */
export async function seedCore(options = {}) {
  const {
    defaultTenantCode = "DEFAULT",
    defaultTenantName = "Default Tenant",
    ensureDefaultTenantIfMissing = true,
  } = options;

  await runMigrations();
  await upsertCurrencies();
  await upsertCountries();
  await upsertPermissions();

  for (const warningMessage of ROLE_DEFINITION_WARNING_MESSAGES) {
    // Seed/build-time validation should surface soft conflicts without silently mutating them.
    console.warn(`[seedCore][permission-rules] ${warningMessage}`);
  }

  if (ensureDefaultTenantIfMissing) {
    await ensureDefaultTenant(defaultTenantCode, defaultTenantName);
  }

  const tenants = await getTenantIds();
  const roleDefinitionsByTenantId = new Map();
  for (const tenant of tenants) {
    roleDefinitionsByTenantId.set(tenant.id, ALL_ROLE_DEFINITIONS);
    await upsertRolesForTenant(tenant.id, ALL_ROLE_DEFINITIONS);
  }

  const permissionIdByCode = await getPermissionIdMap();
  for (const tenant of tenants) {
    await assignRolePermissionsForTenant(
      tenant.id,
      permissionIdByCode,
      roleDefinitionsByTenantId.get(tenant.id) || ALL_ROLE_DEFINITIONS,
    );
    await upsertFieldVisibilityPoliciesForTenant(tenant.id);
  }

  return {
    tenantCount: tenants.length,
    currencyCount: BASE_CURRENCIES.length,
    countryCount: BASE_COUNTRIES.length,
    permissionCount: PERMISSIONS.length,
    roleCountPerTenant: ALL_ROLE_DEFINITIONS.length,
    fieldVisibilityPolicyCountPerTenant:
      DEFAULT_FIELD_VISIBILITY_POLICY_DEFINITIONS.length,
  };
}
