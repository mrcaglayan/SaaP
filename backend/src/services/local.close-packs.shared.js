const LOCAL_CLOSE_PACK_SCOPE_TYPES = Object.freeze([
  "OPERATING_UNIT",
  "CENTRAL",
]);

const LOCAL_CLOSE_PACK_STATUS_VALUES = Object.freeze([
  "NOT_OPENED",
  "OPEN",
  "IN_PROGRESS",
  "READY_FOR_REVIEW",
  "RETURNED",
  "APPROVED",
  "LOCKED",
  "REOPENED",
  "SUPERSEDED",
]);

const LOCAL_CLOSE_PACK_REOPEN_ACTION_TYPES = Object.freeze([
  "REVERSAL_REQUIRED",
  "LATE_POSTING_REQUIRED",
  "RECLASS_REQUIRED",
  "EVIDENCE_CORRECTION_ONLY",
  "AUDIT_ADJUSTMENT",
  "CONSOLIDATION_FEEDBACK",
]);

const LOCAL_CLOSE_PACK_REOPEN_REQUEST_STATUS_VALUES = Object.freeze([
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
]);

const LOCAL_CLOSE_PACK_ENTITY_READINESS_STATE_VALUES = Object.freeze([
  "NOT_READY",
  "PARTIALLY_READY",
  "READY_FOR_ENTITY_REVIEW",
  "ENTITY_IN_REVIEW",
  "ENTITY_APPROVED",
  "ENTITY_LOCKED",
  "ENTITY_REOPENED",
]);

const LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE = "LOCAL_CLOSE_PACK";
const LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE = "LOCAL_CLOSE_PACK";
const LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS = Object.freeze([
  "trialBalance",
  "generalLedger",
  "subsidiaryLedger",
  "balanceSheet",
  "incomeStatement",
]);
const LOCAL_CLOSE_PACK_REPORT_LAUNCH_MODES = Object.freeze([
  "PACK_SCOPE",
  "ENTITY_STATEMENT_FALLBACK",
]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Build the stable scope key used by the local close-pack unique constraint.
 */
export function buildLocalClosePackScopeKey({ closeScopeType, operatingUnitId = null }) {
  const normalizedScopeType = toUpperText(closeScopeType);
  if (normalizedScopeType === "CENTRAL") {
    return "CENTRAL";
  }
  const normalizedOperatingUnitId = Number(operatingUnitId || 0);
  return `OPERATING_UNIT:${normalizedOperatingUnitId}`;
}

/**
 * Resolve the RBAC data scope implied by a local close-pack row.
 */
export function resolveLocalClosePackRowScope(row) {
  const closeScopeType = toUpperText(row?.close_scope_type ?? row?.closeScopeType);
  const operatingUnitId = Number(row?.operating_unit_id ?? row?.operatingUnitId ?? 0);
  const legalEntityId = Number(row?.legal_entity_id ?? row?.legalEntityId ?? 0);

  if (closeScopeType === "OPERATING_UNIT" && operatingUnitId > 0) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
      scopeKind: "operating_unit",
    };
  }
  if (legalEntityId > 0) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      scopeKind: "legal_entity",
    };
  }
  return null;
}

/**
 * Return true when the reopen action is balance-neutral evidence maintenance.
 */
export function isEvidenceOnlyLocalClosePackReopenAction(actionType) {
  return toUpperText(actionType) === "EVIDENCE_CORRECTION_ONLY";
}

/**
 * Return true when the reopen action changes financially relied-on pack state.
 */
export function isFinancialLocalClosePackReopenAction(actionType) {
  const normalizedActionType = toUpperText(actionType);
  return (
    LOCAL_CLOSE_PACK_REOPEN_ACTION_TYPES.includes(normalizedActionType) &&
    normalizedActionType !== "EVIDENCE_CORRECTION_ONLY"
  );
}

/**
 * Resolve the local close-pack scope controlled by one journal.
 *
 * Mixed-scope journals intentionally return null because one OU pack must not
 * certify, block, or reopen a journal that spans multiple OUs or central + OU.
 */
export function resolveJournalLocalClosePackScope(lineRows) {
  const rows = Array.isArray(lineRows) ? lineRows : [];
  if (rows.length === 0) {
    return null;
  }

  const operatingUnitIds = new Set();
  let hasCentralLines = false;

  for (const row of rows) {
    const operatingUnitId = toPositiveInt(
      row?.operating_unit_id ?? row?.operatingUnitId ?? row?.operatingUnitID
    );
    if (operatingUnitId) {
      operatingUnitIds.add(operatingUnitId);
      continue;
    }
    hasCentralLines = true;
  }

  if (operatingUnitIds.size === 0) {
    return {
      closeScopeType: "CENTRAL",
      operatingUnitId: null,
      scopeKey: buildLocalClosePackScopeKey({
        closeScopeType: "CENTRAL",
      }),
    };
  }

  if (operatingUnitIds.size === 1 && !hasCentralLines) {
    const [operatingUnitId] = Array.from(operatingUnitIds);
    return {
      closeScopeType: "OPERATING_UNIT",
      operatingUnitId,
      scopeKey: buildLocalClosePackScopeKey({
        closeScopeType: "OPERATING_UNIT",
        operatingUnitId,
      }),
    };
  }

  return null;
}

export {
  LOCAL_CLOSE_PACK_SCOPE_TYPES,
  LOCAL_CLOSE_PACK_STATUS_VALUES,
  LOCAL_CLOSE_PACK_REOPEN_ACTION_TYPES,
  LOCAL_CLOSE_PACK_REOPEN_REQUEST_STATUS_VALUES,
  LOCAL_CLOSE_PACK_ENTITY_READINESS_STATE_VALUES,
  LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
  LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
  LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS,
  LOCAL_CLOSE_PACK_REPORT_LAUNCH_MODES,
};
