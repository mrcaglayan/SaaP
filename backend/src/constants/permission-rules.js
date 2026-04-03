import { PERMISSION_GROUPS } from "./permission-groups.js";

export const PERMISSION_DEPENDENCIES = Object.freeze({
  "gl.journal.post": Object.freeze(["gl.journal.read"]),
  "gl.journal.reverse": Object.freeze(["gl.journal.read"]),
  "gl.period.close": Object.freeze(["gl.journal.read", "gl.trial_balance.read"]),
  "ouclose.approve": Object.freeze(["ouclose.read"]),
  "ouclose.lock": Object.freeze(["ouclose.read", "ouclose.approve"]),
  "bank.reconcile.write": Object.freeze(["bank.reconcile.read"]),
  "payments.batch.approve": Object.freeze(["payments.batch.read"]),
  "workflow.definition.write": Object.freeze(["workflow.definition.read"]),
  "workflow.assignment.write": Object.freeze(["workflow.assignment.read"]),
  "payroll.settlement.override.approve": Object.freeze(["payroll.settlement.override.read"]),
  "payroll.close.approve": Object.freeze(["payroll.close.read"]),
  "payroll.close.reopen": Object.freeze(["payroll.close.read"]),
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
