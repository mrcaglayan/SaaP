/**
 * @typedef {{
 *   includes?: string[],
 *   permissions: string[],
 * }} PermissionGroupDefinition
 */

/**
 * Metadata-only capability groups for diagnostics and later role redesign.
 * These groups do not change runtime permission checks or role evaluation by themselves.
 *
 * `gl.readonly` preserves OU balance/report visibility even when manual posting authority
 * is removed from a branch or operating-unit role.
 *
 * `gl.posting` is only for free-form manual GL posting, reversal, and period close. It
 * does not imply source-module execution rights in cash, bank, payroll, inventory, or cari.
 *
 * @type {Record<string, PermissionGroupDefinition>}
 */
export const PERMISSION_GROUPS = {
  "gl.readonly": {
    permissions: [
      "gl.book.read",
      "gl.coa.read",
      "gl.account.read",
      "gl.journal.read",
      "gl.trial_balance.read",
      "gl.report.local.read",
      "gl.report.ledger.read",
      "gl.report.statement.read",
    ],
  },
  "gl.masterdata": {
    permissions: [
      "gl.book.upsert",
      "gl.coa.upsert",
      "gl.account.upsert",
      "gl.account_mapping.upsert",
    ],
  },
  "gl.operations": {
    includes: ["gl.readonly"],
    permissions: [
      "gl.journal.create",
      "gl.journal.update",
      "gl.journal.cancel",
    ],
  },
  "gl.posting": {
    permissions: [
      "gl.journal.post",
      "gl.journal.reverse",
      "gl.period.close",
    ],
  },
  "bank.readonly": {
    permissions: [
      "bank.accounts.read",
      "bank.connectors.read",
      "bank.statements.read",
      "bank.reconcile.read",
      "bank.reconcile.templates.read",
      "bank.reconcile.diffprofiles.read",
      "bank.reconcile.rules.read",
      "bank.reconcile.exceptions.read",
      "payments.batch.read",
      "bank.payments.export.read",
      "bank.payments.ack.read",
      "bank.payments.returns.read",
      "bank.approvals.policies.read",
      "bank.approvals.requests.read",
    ],
  },
  "bank.operations": {
    includes: ["bank.readonly"],
    permissions: [
      "bank.accounts.write",
      "bank.connectors.write",
      "bank.connectors.sync",
      "bank.statements.import",
      "bank.reconcile.write",
      "bank.reconcile.templates.write",
      "bank.reconcile.diffprofiles.write",
      "bank.reconcile.rules.write",
      "bank.reconcile.auto.run",
      "bank.reconcile.exceptions.write",
      "payments.batch.create",
      "payments.batch.export",
      "payments.batch.post",
      "payments.batch.cancel",
      "bank.payments.export.create",
      "bank.payments.ack.import",
      "bank.payments.returns.write",
    ],
  },
  "bank.governance": {
    permissions: [
      "bank.approvals.policies.read",
      "bank.approvals.policies.create",
      "bank.approvals.policies.update",
      "bank.approvals.requests.read",
      "bank.approvals.requests.submit",
      "bank.approvals.requests.approve",
      "bank.approvals.requests.reject",
      "bank.approvals.requests.approve.payment",
      "bank.approvals.requests.approve.reconConfig",
      "bank.approvals.requests.approve.reconOverride",
      "bank.approvals.requests.approve.manualReturn",
      "payments.batch.approve",
    ],
  },
  "close.operator": {
    permissions: [
      "ouclose.read",
      "ouclose.prepare",
      "ouclose.submit",
      "ouclose.request_reopen",
    ],
  },
  "close.reviewer": {
    permissions: [
      "ouclose.read",
      "ouclose.review",
      "ouclose.approve",
      "ouclose.lock",
      "ouclose.reopen",
      "ouclose.override_post_lock",
      "ouclose.admin",
    ],
  },
  "payroll.readonly": {
    permissions: [
      "payroll.runs.read",
      "payroll.provider.read",
      "payroll.provider.mapping.read",
      "payroll.provider.import.read",
      "payroll.mappings.read",
      "payroll.liabilities.read",
      "payroll.ownership.read",
      "payroll.payment.sync.read",
      "payroll.settlement.override.read",
      "payroll.beneficiary.read",
      "payroll.beneficiary.snapshot.read",
      "payroll.sensitive.read",
      "payroll.close.read",
      "payroll.corrections.read",
    ],
  },
  "payroll.operations": {
    includes: ["payroll.readonly"],
    permissions: [
      "payroll.runs.import",
      "payroll.provider.write",
      "payroll.provider.mapping.write",
      "payroll.provider.import.preview",
      "payroll.provider.import.apply",
      "payroll.provider.import.retention.manage",
      "payroll.mappings.write",
      "payroll.runs.review",
      "payroll.runs.finalize",
      "payroll.liabilities.build",
      "payroll.ownership.write",
      "payroll.payment.prepare",
      "payroll.payment.sync.apply",
      "payroll.settlement.override.request",
      "payroll.beneficiary.write",
      "payroll.beneficiary.set_primary",
      "payroll.close.prepare",
      "payroll.close.request",
      "payroll.corrections.create",
      "payroll.corrections.reverse",
    ],
  },
  "payroll.governance": {
    permissions: [
      "payroll.settlement.override.approve",
      "payroll.close.approve",
      "payroll.close.reopen",
    ],
  },
};

export const PERMISSION_GROUP_CODES = Object.keys(PERMISSION_GROUPS);
