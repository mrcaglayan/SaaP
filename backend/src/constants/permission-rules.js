import { PERMISSION_GROUPS } from "./permission-groups.js";
import {
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_LEGACY_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
} from "../../../shared/periodCloseGovernance.js";

export const RETIRED_PERMISSION_CODES = Object.freeze([
  PERIOD_CLOSE_LEGACY_PERMISSION_CODE,
]);

export const PERMISSION_DEPENDENCIES = Object.freeze({
  "gl.journal.post": Object.freeze(["gl.journal.read"]),
  "gl.journal.post_to_closed_period": Object.freeze(["gl.journal.post"]),
  "gl.journal.reverse": Object.freeze(["gl.journal.read"]),
  [PERIOD_CLOSE_EXECUTE_PERMISSION_CODE]: Object.freeze([
    "gl.journal.read",
    "gl.trial_balance.read",
  ]),
  [PERIOD_CLOSE_REOPEN_PERMISSION_CODE]: Object.freeze([
    "gl.journal.read",
    "gl.trial_balance.read",
  ]),
  [PERIOD_CLOSE_ADMIN_PERMISSION_CODE]: Object.freeze([
    "gl.journal.read",
    "gl.trial_balance.read",
  ]),
  "ouclose.approve": Object.freeze(["ouclose.read"]),
  "ouclose.lock": Object.freeze(["ouclose.read", "ouclose.approve"]),
  "close.task.template.write": Object.freeze(["close.task.template.read"]),
  "close.task.create": Object.freeze(["close.task.read"]),
  "close.task.assign": Object.freeze(["close.task.read"]),
  "close.task.work": Object.freeze(["close.task.read"]),
  "close.task.review": Object.freeze(["close.task.read"]),
  "close.task.waive": Object.freeze(["close.task.review"]),
  "close.task.admin": Object.freeze(["close.task.read"]),
  "bank.reconcile.write": Object.freeze(["bank.reconcile.read"]),
  "payments.batch.approve": Object.freeze(["payments.batch.read"]),
  "workflow.definition.write": Object.freeze(["workflow.definition.read"]),
  "workflow.assignment.write": Object.freeze(["workflow.assignment.read"]),
  "payroll.settlement.override.approve": Object.freeze(["payroll.settlement.override.read"]),
  "payroll.close.approve": Object.freeze(["payroll.close.read"]),
  "payroll.close.reopen": Object.freeze(["payroll.close.read"]),
  "tax.setup.read": Object.freeze(["org.tree.read"]),
  "tax.setup.upsert": Object.freeze(["tax.setup.read", "org.tree.read"]),
});

export const PERMISSION_CONFLICTS = Object.freeze([
  Object.freeze({
    leftPermissionCode: "payments.batch.create",
    rightPermissionCode: "payments.batch.approve",
    severity: "warn",
    reason: "Maker-checker: payment batch creators should not approve the same batch.",
  }),
  Object.freeze({
    leftPermissionCode: "gl.journal.create",
    rightPermissionCode: "gl.journal.post",
    severity: "warn",
    reason: "SoD: manual journal creators should not also post without review.",
  }),
  Object.freeze({
    leftPermissionCode: "payroll.settlement.override.request",
    rightPermissionCode: "payroll.settlement.override.approve",
    severity: "warn",
    reason: "SoD: settlement override requesters should not self-approve.",
  }),
  Object.freeze({
    leftPermissionCode: "payroll.close.request",
    rightPermissionCode: "payroll.close.approve",
    severity: "warn",
    reason: "Maker-checker: payroll close requesters should not also approve close.",
  }),
  Object.freeze({
    leftPermissionCode: "bank.approvals.requests.submit",
    rightPermissionCode: "bank.approvals.requests.approve",
    severity: "warn",
    reason: "Governance: manual bank approval submitters should not also approve requests.",
  }),
  Object.freeze({
    leftPermissionCode: "approvals.requests.submit",
    rightPermissionCode: "approvals.requests.approve",
    severity: "warn",
    reason: "Governance: approval request submitters should not also approve requests.",
  }),
  Object.freeze({
    leftPermissionCode: "cari.card.request",
    rightPermissionCode: "cari.request.review",
    severity: "warn",
    reason: "Review authority should stay distinct from counterparty request submission.",
  }),
  Object.freeze({
    leftPermissionCode: "org.fiscal_period.read",
    rightPermissionCode: PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    severity: "warn",
    reason: "SoD: readiness review and period-close approval should stay separate where practical.",
  }),
  Object.freeze({
    leftPermissionCode: PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    rightPermissionCode: PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
    severity: "warn",
    reason: "SoD: workflow approval and period-close execution should stay separate where practical.",
  }),
  Object.freeze({
    leftPermissionCode: PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
    rightPermissionCode: PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
    severity: "warn",
    reason: "SoD: period-close execution and reopen authority should be separated where practical.",
  }),
  Object.freeze({
    leftPermissionCode: "close.task.work",
    rightPermissionCode: "close.task.review",
    severity: "warn",
    reason:
      "Maker-checker: close task preparers should not review their own tasks; combining these permissions is an override risk, not a hard assignment error.",
  }),
  Object.freeze({
    leftPermissionCode: "close.task.work",
    rightPermissionCode: "close.task.waive",
    severity: "warn",
    reason:
      "Maker-checker: close task preparers should not waive their own tasks; combining these permissions is an override risk, not a hard assignment error.",
  }),
]);

const GL_POSTING_PERMISSION_CODES = new Set(PERMISSION_GROUPS["gl.posting"]?.permissions || []);
const GL_POSTING_REQUIRED_READ_PERMISSION_CODES = Object.freeze([
  "gl.journal.read",
  "gl.trial_balance.read",
]);

function normalizePermissionCodes(permissionCodes) {
  return Array.from(
    new Set(
      (Array.isArray(permissionCodes) ? permissionCodes : [])
        .map((permissionCode) => String(permissionCode || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeCapabilityGroups(capabilityGroups) {
  return Array.from(
    new Set(
      (Array.isArray(capabilityGroups) ? capabilityGroups : [])
        .map((capabilityGroup) => String(capabilityGroup || "").trim())
        .filter(Boolean)
    )
  );
}

function buildDependencyErrors(permissionCodeSet, subjectLabel) {
  const errors = [];

  for (const [permissionCode, dependencyCodes] of Object.entries(PERMISSION_DEPENDENCIES)) {
    if (!permissionCodeSet.has(permissionCode)) {
      continue;
    }

    const missingPermissionCodes = dependencyCodes.filter(
      (dependencyCode) => !permissionCodeSet.has(dependencyCode)
    );
    if (missingPermissionCodes.length === 0) {
      continue;
    }

    errors.push({
      type: "missing_dependencies",
      permissionCode,
      missingPermissionCodes,
      message: `${subjectLabel} grants ${permissionCode} but is missing required dependencies: ${missingPermissionCodes.join(", ")}.`,
    });
  }

  return errors;
}

function buildRetiredPermissionErrors(permissionCodeSet, subjectLabel) {
  return RETIRED_PERMISSION_CODES.filter((permissionCode) =>
    permissionCodeSet.has(permissionCode)
  ).map((permissionCode) => ({
    type: "retired_permission",
    permissionCode,
    message: `${subjectLabel} grants retired permission ${permissionCode}. Use ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE} and/or ${PERIOD_CLOSE_EXECUTE_PERMISSION_CODE} instead.`,
  }));
}

function buildConflictWarnings(permissionCodeSet, subjectLabel) {
  const warnings = [];

  for (const rule of PERMISSION_CONFLICTS) {
    if (
      !permissionCodeSet.has(rule.leftPermissionCode) ||
      !permissionCodeSet.has(rule.rightPermissionCode)
    ) {
      continue;
    }

    warnings.push({
      type: "permission_conflict",
      severity: rule.severity,
      leftPermissionCode: rule.leftPermissionCode,
      rightPermissionCode: rule.rightPermissionCode,
      reason: rule.reason,
      message: `${subjectLabel} combines ${rule.leftPermissionCode} and ${rule.rightPermissionCode}. ${rule.reason}`,
    });
  }

  return warnings;
}

function buildGlPostingGuardrailErrors(permissionCodeSet, capabilityGroupSet, subjectLabel) {
  const grantsGlPosting =
    capabilityGroupSet.has("gl.posting") ||
    Array.from(GL_POSTING_PERMISSION_CODES).some((permissionCode) => permissionCodeSet.has(permissionCode));
  if (!grantsGlPosting) {
    return [];
  }

  const missingReadPermissionCodes = GL_POSTING_REQUIRED_READ_PERMISSION_CODES.filter(
    (permissionCode) => !permissionCodeSet.has(permissionCode)
  );
  if (missingReadPermissionCodes.length === 0) {
    return [];
  }

  return [
    {
      type: "gl_posting_read_guardrail",
      requiredPermissionCodes: GL_POSTING_REQUIRED_READ_PERMISSION_CODES,
      missingPermissionCodes: missingReadPermissionCodes,
      message: `${subjectLabel} uses GLPostingAuthority-style manual GL posting permissions but is missing required read visibility: ${missingReadPermissionCodes.join(", ")}.`,
    },
  ];
}

/**
 * Validate one role or combined role-set permission graph without mutating it.
 *
 * Dependency violations are returned as `errors`. Maker-checker overlaps and
 * similar SoD risks are returned as `warnings`.
 */
export function evaluatePermissionRuleSet({
  permissionCodes,
  capabilityGroups = [],
  subjectLabel = "Permission set",
}) {
  const normalizedPermissionCodes = normalizePermissionCodes(permissionCodes);
  const permissionCodeSet = new Set(normalizedPermissionCodes);
  const capabilityGroupSet = new Set(normalizeCapabilityGroups(capabilityGroups));

  return {
    normalizedPermissionCodes,
    errors: [
      ...buildRetiredPermissionErrors(permissionCodeSet, subjectLabel),
      ...buildDependencyErrors(permissionCodeSet, subjectLabel),
      ...buildGlPostingGuardrailErrors(permissionCodeSet, capabilityGroupSet, subjectLabel),
    ],
    warnings: buildConflictWarnings(permissionCodeSet, subjectLabel),
  };
}

/**
 * Validate one role definition and raise a hard failure only for dependency or
 * GL posting guardrail errors.
 */
export function assertValidPermissionRuleSet(input) {
  const evaluation = evaluatePermissionRuleSet(input);
  if (evaluation.errors.length > 0) {
    const error = new Error(
      evaluation.errors.map((ruleError) => ruleError.message).join(" ")
    );
    error.code = "INVALID_PERMISSION_RULE_SET";
    error.status = 400;
    error.details = evaluation;
    throw error;
  }
  return evaluation;
}
