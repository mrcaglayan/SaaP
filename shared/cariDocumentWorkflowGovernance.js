function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export const AP_DOCUMENT_WORKFLOW_PROCESS_TYPE = "AP_DOCUMENT_POSTING";
export const CARI_DOCUMENT_WORKFLOW_TARGET_TYPE = "CARI_DOCUMENT";
export const AP_DOCUMENT_WORKFLOW_ACTION_CODES = Object.freeze([
  "DRAFT",
  "SUBMIT",
  "APPROVE",
  "POST",
]);
export const AP_DOCUMENT_REQUIRED_PERMISSION_BY_ACTION = Object.freeze({
  DRAFT: "cari.doc.update",
  SUBMIT: "cari.doc.submit",
  APPROVE: "approvals.requests.approve",
  POST: "cari.doc.post",
});
export const CARI_DOCUMENT_WORKFLOW_GATE_STATES = Object.freeze([
  "NONE",
  "PENDING",
  "RETURNED",
  "APPROVED",
  "BLOCKED",
]);

/**
 * Consolidated blocking reason codes for workflow-gate explainability.
 * Each code maps to a condition already evaluated in the codebase;
 * this enum gives them formal names for structured frontend consumption.
 */
export const WORKFLOW_GATE_BLOCKING_REASON_CODES = Object.freeze({
  // Workflow governance blocking
  WORKFLOW_APPROVAL_PENDING: "WORKFLOW_APPROVAL_PENDING",
  WORKFLOW_APPROVAL_REJECTED: "WORKFLOW_APPROVAL_REJECTED",
  WORKFLOW_APPROVAL_REQUIRED: "WORKFLOW_APPROVAL_REQUIRED",
  WORKFLOW_ASSIGNMENT_NOT_CONFIGURED: "WORKFLOW_ASSIGNMENT_NOT_CONFIGURED",
  WORKFLOW_ASSIGNMENT_NOT_RESOLVED: "WORKFLOW_ASSIGNMENT_NOT_RESOLVED",
  NO_WORKFLOW_INSTANCE: "NO_WORKFLOW_INSTANCE",

  // Permission blocking
  MISSING_PERMISSION_SUBMIT: "MISSING_PERMISSION_SUBMIT",
  MISSING_PERMISSION_APPROVE: "MISSING_PERMISSION_APPROVE",
  MISSING_PERMISSION_POST: "MISSING_PERMISSION_POST",
  MISSING_PERMISSION_REVERSE: "MISSING_PERMISSION_REVERSE",

  // Document status blocking
  INVALID_DOCUMENT_STATUS_FOR_SUBMIT: "INVALID_DOCUMENT_STATUS_FOR_SUBMIT",
  INVALID_DOCUMENT_STATUS_FOR_POST: "INVALID_DOCUMENT_STATUS_FOR_POST",
  INVALID_DOCUMENT_STATUS_FOR_APPROVAL: "INVALID_DOCUMENT_STATUS_FOR_APPROVAL",

  // Posting readiness
  CARI_POSTING_MODULE_NOT_READY: "CARI_POSTING_MODULE_NOT_READY",
  INVALID_BOOK_CONFIG: "INVALID_BOOK_CONFIG",
  INVALID_PERIOD_CONFIG: "INVALID_PERIOD_CONFIG",
  PERIOD_NOT_OPEN: "PERIOD_NOT_OPEN",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  ACCOUNT_NOT_POSTABLE: "ACCOUNT_NOT_POSTABLE",
  ACCOUNT_SCOPE_NOT_LEGAL_ENTITY: "ACCOUNT_SCOPE_NOT_LEGAL_ENTITY",
  ACCOUNT_LEGAL_ENTITY_MISMATCH: "ACCOUNT_LEGAL_ENTITY_MISMATCH",

  // Reverse blocking
  ACTIVE_LINKED_INVENTORY_MOVEMENTS: "ACTIVE_LINKED_INVENTORY_MOVEMENTS",
  ACTIVE_LANDED_COST_VOUCHER_SOURCE_APPLICATIONS: "ACTIVE_LANDED_COST_VOUCHER_SOURCE_APPLICATIONS",
  DOCUMENT_ALREADY_REVERSED: "DOCUMENT_ALREADY_REVERSED",
  POSTED_JOURNAL_LINKAGE_MISSING: "POSTED_JOURNAL_LINKAGE_MISSING",
  JOURNAL_ALREADY_REVERSED: "JOURNAL_ALREADY_REVERSED",
});

export const CARI_DOCUMENT_WORKFLOW_METADATA_DIRECTIONS = Object.freeze([
  "AR",
  "AP",
]);
export const CARI_DOCUMENT_WORKFLOW_METADATA_TYPES = Object.freeze([
  "INVOICE",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "PAYMENT",
  "ADJUSTMENT",
  "OPENING_BALANCE",
  "OTHER",
]);

export const CARI_ACCOUNTING_VISIBLE_DOCUMENT_STATUSES = Object.freeze([
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "REVERSED",
]);
export const CARI_SUBMITTABLE_DOCUMENT_STATUSES = Object.freeze([
  "DRAFT",
  "RETURNED",
]);
export const CARI_RETURNABLE_DOCUMENT_STATUSES = Object.freeze([
  "SUBMITTED",
  "APPROVED",
]);
export const CARI_CANCELLABLE_DOCUMENT_STATUSES = Object.freeze([
  "DRAFT",
  "RETURNED",
]);

export const CARI_DOCUMENT_CLASS_WORKFLOW_DEFAULTS = Object.freeze([
  { direction: "AR", documentType: "INVOICE", isWorkflowGoverned: false },
  { direction: "AR", documentType: "DEBIT_NOTE", isWorkflowGoverned: false },
  { direction: "AR", documentType: "CREDIT_NOTE", isWorkflowGoverned: false },
  { direction: "AR", documentType: "PAYMENT", isWorkflowGoverned: false },
  { direction: "AR", documentType: "ADJUSTMENT", isWorkflowGoverned: false },
  { direction: "AR", documentType: "OPENING_BALANCE", isWorkflowGoverned: false },
  { direction: "AR", documentType: "OTHER", isWorkflowGoverned: false },
  { direction: "AP", documentType: "INVOICE", isWorkflowGoverned: true },
  { direction: "AP", documentType: "DEBIT_NOTE", isWorkflowGoverned: true },
  { direction: "AP", documentType: "CREDIT_NOTE", isWorkflowGoverned: true },
  { direction: "AP", documentType: "PAYMENT", isWorkflowGoverned: false },
  { direction: "AP", documentType: "ADJUSTMENT", isWorkflowGoverned: false },
  { direction: "AP", documentType: "OPENING_BALANCE", isWorkflowGoverned: false },
  { direction: "AP", documentType: "OTHER", isWorkflowGoverned: false },
]);

const CARI_DOCUMENT_CLASS_WORKFLOW_DEFAULT_MAP = new Map(
  CARI_DOCUMENT_CLASS_WORKFLOW_DEFAULTS.map((row) => [
    `${row.direction}:${row.documentType}`,
    Boolean(row.isWorkflowGoverned),
  ])
);

/**
 * Resolves the normalized CARI document direction used by workflow governance
 * and metadata seeding.
 */
export function normalizeCariDocumentWorkflowDirection(value) {
  const normalized = normalizeUpperText(value);
  return CARI_DOCUMENT_WORKFLOW_METADATA_DIRECTIONS.includes(normalized)
    ? normalized
    : "";
}

/**
 * Resolves the normalized CARI document type used by workflow governance and
 * metadata seeding.
 */
export function normalizeCariDocumentWorkflowType(value) {
  const normalized = normalizeUpperText(value);
  return CARI_DOCUMENT_WORKFLOW_METADATA_TYPES.includes(normalized)
    ? normalized
    : "";
}

/**
 * Returns the seeded V1 governance default for a CARI doc class when a tenant
 * has not yet overridden that class in persisted metadata.
 */
export function getDefaultCariDocumentWorkflowGovernance(docClass) {
  const direction = normalizeCariDocumentWorkflowDirection(docClass?.direction);
  const documentType = normalizeCariDocumentWorkflowType(
    docClass?.documentType ?? docClass?.document_type
  );
  if (!direction || !documentType) {
    return false;
  }
  return Boolean(
    CARI_DOCUMENT_CLASS_WORKFLOW_DEFAULT_MAP.get(`${direction}:${documentType}`)
  );
}

/**
 * Reads the persisted workflow-governance flag when present and otherwise
 * falls back to the shared seeded defaults so backend and frontend stay aligned
 * during rollout/bootstrap gaps.
 */
export function isDocClassWorkflowGoverned(docClass) {
  if (
    docClass?.isWorkflowGoverned === true ||
    docClass?.is_workflow_governed === true ||
    docClass?.isWorkflowGoverned === 1 ||
    docClass?.is_workflow_governed === 1
  ) {
    return true;
  }
  if (
    docClass?.isWorkflowGoverned === false ||
    docClass?.is_workflow_governed === false ||
    docClass?.isWorkflowGoverned === 0 ||
    docClass?.is_workflow_governed === 0
  ) {
    return false;
  }
  return getDefaultCariDocumentWorkflowGovernance(docClass);
}

export function canCariDocumentBeSubmitted(row) {
  return CARI_SUBMITTABLE_DOCUMENT_STATUSES.includes(
    normalizeUpperText(row?.status)
  );
}

export function canCariDocumentBeReturned(row) {
  return CARI_RETURNABLE_DOCUMENT_STATUSES.includes(
    normalizeUpperText(row?.status)
  );
}

export function canCariDocumentBeCancelled(row) {
  return CARI_CANCELLABLE_DOCUMENT_STATUSES.includes(
    normalizeUpperText(row?.status)
  );
}

/**
 * Normalize one AP workflow action code from either persisted or API shape.
 */
export function normalizeApWorkflowActionCode(value) {
  const normalized = normalizeUpperText(value);
  return AP_DOCUMENT_WORKFLOW_ACTION_CODES.includes(normalized)
    ? normalized
    : null;
}

/**
 * Resolves the one permission code that gates each explicit AP workflow
 * action. AP workflow definitions now persist this permission directly rather
 * than storing a package code indirection.
 */
export function getApWorkflowRequiredPermissionCode(actionCode) {
  const normalizedActionCode = normalizeApWorkflowActionCode(actionCode);
  return (
    AP_DOCUMENT_REQUIRED_PERMISSION_BY_ACTION[normalizedActionCode] || null
  );
}

/**
 * Normalize one saved AP workflow step from either workflow-definition rows or
 * bridged approval-policy snapshots.
 */
export function normalizeApWorkflowStep(step = {}) {
  const actionCode = normalizeApWorkflowActionCode(
    step?.actionCode ?? step?.action_code
  );
  const stepNo = Number(step?.stepNo ?? step?.step_no ?? 0);
  const rawAllowSelfApprove =
    step?.allowSelfApprove ?? step?.allow_self_approve ?? false;
  if (!actionCode || !Number.isInteger(stepNo) || stepNo <= 0) {
    return null;
  }
  return {
    stepNo,
    actionCode,
    stageScopeType: normalizeUpperText(
      step?.stageScopeType ?? step?.stage_scope_type ?? null
    ),
    scopeResolutionMode: normalizeUpperText(
      step?.scopeResolutionMode ?? step?.scope_resolution_mode ?? null
    ),
    requiredPermissionCode:
      String(
        step?.requiredPermissionCode ?? step?.required_permission_code ?? ""
      ).trim() || getApWorkflowRequiredPermissionCode(actionCode),
    minApproverCount: Math.max(
      1,
      Number(step?.minApproverCount ?? step?.min_approvals ?? 1) || 1
    ),
    allowSelfApprove:
      rawAllowSelfApprove === true ||
      rawAllowSelfApprove === 1 ||
      rawAllowSelfApprove === "1",
    escalationAfterHours:
      Number(step?.escalationAfterHours ?? step?.escalation_after_hours ?? 0) || null,
  };
}

/**
 * Return the explicit saved AP action chain in step order.
 */
export function listApWorkflowSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .map(normalizeApWorkflowStep)
    .filter(Boolean)
    .sort((left, right) => left.stepNo - right.stepNo);
}

export function findApWorkflowStepByNo(steps = [], stepNo) {
  const normalizedStepNo = Number(stepNo || 0);
  if (!normalizedStepNo) {
    return null;
  }
  return listApWorkflowSteps(steps).find((step) => step.stepNo === normalizedStepNo) || null;
}

export function findFirstApWorkflowStepByAction(steps = [], actionCode) {
  const normalizedActionCode = normalizeApWorkflowActionCode(actionCode);
  if (!normalizedActionCode) {
    return null;
  }
  return listApWorkflowSteps(steps).find((step) => step.actionCode === normalizedActionCode) || null;
}

export function findNextApWorkflowStepAfter(steps = [], stepNo, predicate = null) {
  const normalizedSteps = listApWorkflowSteps(steps);
  const normalizedStepNo = Number(stepNo || 0);
  for (const step of normalizedSteps) {
    if (step.stepNo <= normalizedStepNo) {
      continue;
    }
    if (typeof predicate === "function" && !predicate(step)) {
      continue;
    }
    return step;
  }
  return null;
}

export function listApWorkflowApproveSteps(steps = []) {
  return listApWorkflowSteps(steps).filter((step) => step.actionCode === "APPROVE");
}

/**
 * Resolve the editable correction point for one AP workflow chain. Returned AP
 * documents fall back here before they can be resubmitted.
 */
export function resolveApWorkflowEditableStep(steps = []) {
  const normalizedSteps = listApWorkflowSteps(steps);
  return (
    findFirstApWorkflowStepByAction(normalizedSteps, "DRAFT") ||
    findFirstApWorkflowStepByAction(normalizedSteps, "SUBMIT") ||
    normalizedSteps[0] ||
    null
  );
}

/**
 * Resolve the runtime AP action context from the saved action chain plus the
 * document/workflow instance state. The returned `currentStep` is the current
 * actionable AP step, while `editableStep` surfaces who owns draft correction.
 */
export function resolveApWorkflowRuntimeStepContext({
  steps = [],
  documentStatus = null,
  workflowInstanceStatus = null,
  currentStepNo = null,
} = {}) {
  const normalizedSteps = listApWorkflowSteps(steps);
  const draftStep = findFirstApWorkflowStepByAction(normalizedSteps, "DRAFT");
  const submitStep = findFirstApWorkflowStepByAction(normalizedSteps, "SUBMIT");
  const postStep = findFirstApWorkflowStepByAction(normalizedSteps, "POST");
  const approveSteps = listApWorkflowApproveSteps(normalizedSteps);
  const editableStep = resolveApWorkflowEditableStep(normalizedSteps);
  const instanceStep = findApWorkflowStepByNo(normalizedSteps, currentStepNo);
  const normalizedDocumentStatus = normalizeUpperText(documentStatus);
  const normalizedWorkflowInstanceStatus = normalizeUpperText(workflowInstanceStatus);

  let currentStep = null;
  if (
    [
      "POSTED",
      "PARTIALLY_SETTLED",
      "SETTLED",
      "REVERSED",
      "CANCELLED",
    ].includes(normalizedDocumentStatus)
  ) {
    currentStep = null;
  } else if (normalizedDocumentStatus === "RETURNED") {
    currentStep = submitStep || editableStep;
  } else if (normalizedDocumentStatus === "DRAFT") {
    currentStep = draftStep || submitStep || instanceStep || null;
  } else if (instanceStep && ["APPROVE", "POST"].includes(instanceStep.actionCode)) {
    currentStep = instanceStep;
  } else if (
    normalizedDocumentStatus === "APPROVED" ||
    normalizedWorkflowInstanceStatus === "APPROVED"
  ) {
    currentStep = postStep;
  } else if (
    normalizedDocumentStatus === "SUBMITTED" ||
    normalizedWorkflowInstanceStatus === "PENDING"
  ) {
    currentStep = approveSteps[0] || postStep || instanceStep || null;
  }

  const nextStep = currentStep
    ? findNextApWorkflowStepAfter(normalizedSteps, currentStep.stepNo)
    : null;

  return {
    steps: normalizedSteps,
    draftStep,
    submitStep,
    approveSteps,
    postStep,
    editableStep,
    currentStep,
    currentActionCode: currentStep?.actionCode || null,
    nextStep,
    totalSteps: normalizedSteps.length,
  };
}
