function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export const AP_DOCUMENT_WORKFLOW_PROCESS_TYPE = "AP_DOCUMENT_POSTING";
export const CARI_DOCUMENT_WORKFLOW_TARGET_TYPE = "CARI_DOCUMENT";
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
