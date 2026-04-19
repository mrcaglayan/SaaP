import { query, withTransaction } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import { getEntityCloseReadiness } from "./entity.close-readiness.service.js";
import { getLocalClosePackById } from "./local.close-packs.service.js";
import {
  LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
  LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
  LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS,
  resolveLocalClosePackRowScope,
} from "./local.close-packs.shared.js";
import { getRevrecYearEndContinuityReview } from "./revrec.year-end-review.service.js";
import {
  cancelUnifiedWorkflowInstanceBridge,
  ensureUnifiedWorkflowInstanceBridge,
} from "./workflows.service.js";
import { syncCycleItemsBySource } from "./close.cycle-items.service.js";
import { listSourceActionDependencyBlockers } from "./close.blockers.service.js";
import { getLocalClosePackCertification } from "./local.close-pack.certification.service.js";

const SUBMITTABLE_LOCAL_CLOSE_PACK_STATUSES = new Set([
  "NOT_OPENED",
  "OPEN",
  "IN_PROGRESS",
  "RETURNED",
  "REOPENED",
]);
const RETURNABLE_LOCAL_CLOSE_PACK_STATUSES = new Set(["READY_FOR_REVIEW"]);
const APPROVABLE_LOCAL_CLOSE_PACK_STATUSES = new Set(["READY_FOR_REVIEW"]);
const LOCKABLE_LOCAL_CLOSE_PACK_STATUSES = new Set(["APPROVED"]);

const FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1 =
  "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message, details = null, code = "") {
  const err = new Error(message);
  err.status = 409;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  if (code) {
    err.code = code;
  }
  return err;
}

function mapWorkflowGateSummary(summary = {}) {
  return {
    enabled: Boolean(summary.enabled),
    required: Boolean(summary.required),
    assignmentFound: Boolean(summary.assignmentFound),
    approved: Boolean(summary.approved),
    errorCode: String(summary.errorCode || ""),
    message: String(summary.message || ""),
    workflowDefinitionId: parsePositiveInt(summary.workflowDefinitionId),
    workflowInstanceId: parsePositiveInt(summary.workflowInstanceId),
    workflowInstanceStatus: toUpperText(summary.workflowInstanceStatus) || null,
  };
}

function assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess) {
  const scope = resolveLocalClosePackRowScope(packRow);
  if (!scope) {
    return;
  }
  assertScopeAccess(req, scope.scopeKind, scope.scopeId, "localClosePack");
}

async function writeLocalClosePackAuditLog({
  runQuery,
  req,
  tenantId,
  userId,
  packRow,
  action,
  payload,
}) {
  if (typeof runQuery !== "function") {
    return;
  }
  const scope = resolveLocalClosePackRowScope(packRow);
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)[0];

  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(userId) || null,
      String(action || "ouclose.action"),
      "local_close_pack",
      String(packRow?.id || ""),
      scope?.scopeType || null,
      parsePositiveInt(scope?.scopeId) || null,
      req?.headers?.["x-request-id"] ? String(req.headers["x-request-id"]) : null,
      forwardedIp || req?.ip || req?.socket?.remoteAddress || null,
      req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 255) : null,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

async function loadLocalClosePackHeader({
  tenantId,
  packId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
       lcp.*,
       le.group_company_id,
       le.country_id,
       wi.status AS workflow_instance_status,
       wi.workflow_definition_id AS workflow_definition_id
     FROM local_close_packs lcp
     JOIN legal_entities le ON le.id = lcp.legal_entity_id
     LEFT JOIN workflow_instances wi ON wi.id = lcp.workflow_instance_id
     WHERE lcp.tenant_id = ?
       AND lcp.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, packId]
  );
  return result.rows?.[0] || null;
}

async function countPendingReopenRequests({
  tenantId,
  packId,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT COUNT(*) AS total
       FROM local_close_pack_reopen_requests
       WHERE tenant_id = ?
         AND local_close_pack_id = ?
         AND request_status = 'REQUESTED'`,
      [tenantId, packId]
    );
    return Number(result.rows?.[0]?.total || 0);
  } catch (err) {
    if (isMissingTableError(err)) {
      return 0;
    }
    throw err;
  }
}

async function countScopedDraftJournalsForPack({
  packRow,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(packRow?.tenant_id ?? packRow?.tenantId);
  const legalEntityId = parsePositiveInt(
    packRow?.legal_entity_id ?? packRow?.legalEntityId
  );
  const bookId = parsePositiveInt(packRow?.book_id ?? packRow?.bookId);
  const fiscalPeriodId = parsePositiveInt(
    packRow?.fiscal_period_id ?? packRow?.fiscalPeriodId
  );
  const closeScopeType = toUpperText(
    packRow?.close_scope_type ?? packRow?.closeScopeType
  );
  const operatingUnitId = parsePositiveInt(
    packRow?.operating_unit_id ?? packRow?.operatingUnitId
  );
  if (!tenantId || !legalEntityId || !bookId || !fiscalPeriodId || !closeScopeType) {
    return 0;
  }

  if (closeScopeType === "CENTRAL") {
    const result = await runQuery(
      `SELECT COUNT(*) AS total
       FROM journal_entries je
       WHERE je.tenant_id = ?
         AND je.legal_entity_id = ?
         AND je.book_id = ?
         AND je.fiscal_period_id = ?
         AND je.status = 'DRAFT'
         AND EXISTS (
           SELECT 1
           FROM journal_lines jl
           WHERE jl.journal_entry_id = je.id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM journal_lines jl
           WHERE jl.journal_entry_id = je.id
             AND jl.operating_unit_id IS NOT NULL
         )`,
      [tenantId, legalEntityId, bookId, fiscalPeriodId]
    );
    return Number(result.rows?.[0]?.total || 0);
  }

  if (closeScopeType === "OPERATING_UNIT" && operatingUnitId) {
    const result = await runQuery(
      `SELECT COUNT(*) AS total
       FROM journal_entries je
       WHERE je.tenant_id = ?
         AND je.legal_entity_id = ?
         AND je.book_id = ?
         AND je.fiscal_period_id = ?
         AND je.status = 'DRAFT'
         AND EXISTS (
           SELECT 1
           FROM journal_lines jl
           WHERE jl.journal_entry_id = je.id
             AND jl.operating_unit_id = ?
         )
         AND NOT EXISTS (
           SELECT 1
           FROM journal_lines jl
           WHERE jl.journal_entry_id = je.id
             AND (
               jl.operating_unit_id IS NULL
               OR jl.operating_unit_id <> ?
             )
         )`,
      [tenantId, legalEntityId, bookId, fiscalPeriodId, operatingUnitId, operatingUnitId]
    );
    return Number(result.rows?.[0]?.total || 0);
  }

  return 0;
}

async function listReviewedReportKeysForPack({
  tenantId,
  packId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT report_key
     FROM local_close_pack_report_reviews
     WHERE tenant_id = ?
       AND local_close_pack_id = ?`,
    [tenantId, packId]
  );
  return [...new Set((result.rows || [])
    .map((row) => String(row?.report_key || "").trim())
    .filter(Boolean))];
}

function buildActionAvailability({
  currentStatus,
  blockerCodesByAction,
}) {
  return {
    currentStatus,
    submit: {
      allowed:
        SUBMITTABLE_LOCAL_CLOSE_PACK_STATUSES.has(currentStatus) &&
        blockerCodesByAction.submit.length === 0,
      blockedByCodes: blockerCodesByAction.submit,
    },
    return: {
      allowed: RETURNABLE_LOCAL_CLOSE_PACK_STATUSES.has(currentStatus),
      blockedByCodes: [],
    },
    approve: {
      allowed:
        APPROVABLE_LOCAL_CLOSE_PACK_STATUSES.has(currentStatus) &&
        blockerCodesByAction.approve.length === 0,
      blockedByCodes: blockerCodesByAction.approve,
    },
    lock: {
      allowed:
        LOCKABLE_LOCAL_CLOSE_PACK_STATUSES.has(currentStatus) &&
        blockerCodesByAction.lock.length === 0,
      blockedByCodes: blockerCodesByAction.lock,
    },
  };
}

function buildRecommendedAction(currentStatus, actionAvailability) {
  if (actionAvailability.lock.allowed) {
    return "LOCK";
  }
  if (actionAvailability.approve.allowed) {
    return "APPROVE";
  }
  if (actionAvailability.return.allowed) {
    return "RETURN";
  }
  if (actionAvailability.submit.allowed) {
    return "SUBMIT";
  }
  if (currentStatus === "LOCKED") {
    return "NONE";
  }
  return "RESOLVE_BLOCKERS";
}

function mapDependencyBlockerToLocalReviewItem(blocker, appliesToActions = []) {
  return {
    level: "BLOCKER",
    code: String(blocker?.code || "").trim().toUpperCase() || "CLOSE_DEPENDENCY_UNRESOLVED",
    message:
      String(blocker?.message || "").trim() ||
      "Close dependency remains unresolved for this local close pack",
    appliesToActions,
    ...(blocker?.drillPath
      ? {
          drill: {
            path: blocker.drillPath,
          },
        }
      : {}),
  };
}

function mapCertificationSectionToLocalReviewItem(section) {
  return {
    level: "BLOCKER",
    code:
      `LOCAL_CLOSE_CERTIFICATION_${String(section?.sectionKey || "")
        .trim()
        .toUpperCase()}_INCOMPLETE`,
    message:
      `${section?.sectionTitle || "Certification section"} is still incomplete before lock`,
    appliesToActions: ["lock"],
    drill: {
      tab: "certification",
    },
  };
}

async function loadRevrecYearEndContinuityReviewForPack({
  packRow,
  runQuery = query,
}) {
  if (toUpperText(packRow?.close_scope_type) !== "CENTRAL") {
    return null;
  }
  const tenantId = parsePositiveInt(packRow?.tenant_id);
  const legalEntityId = parsePositiveInt(packRow?.legal_entity_id);
  const bookId = parsePositiveInt(packRow?.book_id);
  const fiscalPeriodId = parsePositiveInt(packRow?.fiscal_period_id);
  if (!tenantId || !legalEntityId || !bookId || !fiscalPeriodId) {
    return null;
  }

  // RP12 reuses the existing year-end REVREC report seam only for CENTRAL
  // packs because the live continuity checks are entity/book/period controls,
  // not OU-scoped accounting rules.
  return getRevrecYearEndContinuityReview({
    tenantId,
    legalEntityId,
    bookId,
    fiscalPeriodId,
    runQuery,
  });
}

function buildRevrecContinuityBlockers(review = null) {
  if (!review?.applicable) {
    return [];
  }
  return (Array.isArray(review?.blockingRows) ? review.blockingRows : []).map((row) => {
    const primaryReasonCode =
      String(Array.isArray(row?.reasonCodes) ? row.reasonCodes[0] || "" : "")
        .trim()
        .toUpperCase() || "CONTINUITY_BLOCK";
    return {
      level: "BLOCKER",
      code: `REVREC_CONTINUITY_${primaryReasonCode}`,
      message: `${row?.title || row?.familyCode || "REVREC"}: ${row?.detail || "Continuity issue must be resolved before close"}`,
      appliesToActions: ["approve", "lock"],
      count: 1,
      drill: {
        tab: "reports",
        surface: "yearEndRevrec",
        path: String(row?.drill?.path || review?.drillPath || "").trim() || null,
        label: String(row?.drill?.label || "Open year-end REVREC"),
        familyCode: row?.familyCode || null,
        reasonCodes: Array.isArray(row?.reasonCodes) ? row.reasonCodes : [],
      },
    };
  });
}

async function evaluateLocalClosePackReviewGate({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  row = null,
  entityReadiness = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPackId = parsePositiveInt(packId);
  if (!normalizedTenantId) {
    throw notFound("tenantId is required");
  }
  if (!normalizedPackId) {
    throw notFound("packId is required");
  }

  const packRow =
    row ||
    (await getLocalClosePackById({
      req,
      tenantId: normalizedTenantId,
      packId: normalizedPackId,
      assertScopeAccess,
      runQuery,
    }));
  const headerRow = await loadLocalClosePackHeader({
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    runQuery,
  });
  if (!headerRow) {
    throw notFound("Local close pack not found");
  }

  const reviewedReportKeys = await listReviewedReportKeysForPack({
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    runQuery,
  });
  const reviewedReportKeySet = new Set(reviewedReportKeys);
  const missingReportKeys = LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.filter(
    (key) => !reviewedReportKeySet.has(key)
  );
  const draftJournalCount = await countScopedDraftJournalsForPack({
    packRow: headerRow,
    runQuery,
  });
  const pendingReopenRequestCount = await countPendingReopenRequests({
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    runQuery,
  });
  const workflowGate = await evaluateWorkflowGateForApproval({
    tenantId: normalizedTenantId,
    packRow: headerRow,
    runQuery,
  });
  const certification = await getLocalClosePackCertification({
    req,
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    assertScopeAccess,
    runQuery,
  });
  const revrecContinuity = await loadRevrecYearEndContinuityReviewForPack({
    packRow: headerRow,
    runQuery,
  });
  const readiness =
    entityReadiness ||
    (await getEntityCloseReadiness({
      tenantId: normalizedTenantId,
      legalEntityId: parsePositiveInt(packRow?.legalEntityId),
      bookId: parsePositiveInt(packRow?.bookId),
      fiscalPeriodId: parsePositiveInt(packRow?.fiscalPeriodId),
      runQuery,
    }));
  const invalidatingScopeCount = Array.isArray(readiness?.invalidatingScopes)
    ? readiness.invalidatingScopes.length
    : 0;
  const blockers = [];
  const warnings = [];

  if (missingReportKeys.length > 0) {
    blockers.push({
      level: "BLOCKER",
      code: "LOCAL_REPORT_REVIEW_MISSING",
      message: `Missing ${missingReportKeys.length} required report review(s) before approval`,
      appliesToActions: ["approve"],
      count: missingReportKeys.length,
      drill: {
        tab: "reports",
        reportKeys: missingReportKeys,
      },
    });
  }

  if (draftJournalCount > 0) {
    // Exact-scope draft journals are already real repo truth, so RP12 reuses
    // the same guard as a surfaced blocker instead of inventing a new rule.
    blockers.push({
      level: "BLOCKER",
      code: "LOCAL_CLOSE_PACK_DRAFT_JOURNALS_BLOCK",
      message: `Exact-scope draft journals still exist for this pack (${draftJournalCount})`,
      appliesToActions: ["submit", "approve"],
      count: draftJournalCount,
      drill: {
        tab: "reports",
        reportKey: "generalLedger",
        suggestedParams: {
          status: "DRAFT",
        },
      },
    });
  }

  if (workflowGate.required && !workflowGate.approved) {
    blockers.push({
      level: "BLOCKER",
      code: String(workflowGate.errorCode || "APPROVAL_REQUIRED"),
      message:
        String(workflowGate.message || "").trim() ||
        "Workflow approval is still pending for this local close pack",
      appliesToActions: ["approve"],
      drill: {
        tab: "overview",
        surface: "workflow",
        workflowInstanceId: workflowGate.workflowInstanceId || null,
      },
    });
  }

  if (pendingReopenRequestCount > 0) {
    blockers.push({
      level: "BLOCKER",
      code: "LOCAL_CLOSE_PACK_PENDING_REOPEN_BLOCK",
      message: `Pending reopen requests must be resolved before lock (${pendingReopenRequestCount})`,
      appliesToActions: ["lock"],
      count: pendingReopenRequestCount,
      drill: {
        tab: "exceptions",
      },
    });
  }

  blockers.push(...buildRevrecContinuityBlockers(revrecContinuity));

  const [approveDependencyBlockers, lockDependencyBlockers] = await Promise.all([
    listSourceActionDependencyBlockers(
      {
        sourceTargetType: "LOCAL_CLOSE_PACK",
        sourceTargetId: packId,
        action: "APPROVE",
      },
      {
        tenantId: normalizedTenantId,
        runQuery,
      }
    ),
    listSourceActionDependencyBlockers(
      {
        sourceTargetType: "LOCAL_CLOSE_PACK",
        sourceTargetId: packId,
        action: "LOCK",
      },
      {
        tenantId: normalizedTenantId,
        runQuery,
      }
    ),
  ]);

  // PR-02b keeps the existing local-close review gate intact, then layers the
  // explicit cycle dependency graph on top so operators can see and enforce the
  // same blocker family without replacing workflow or REVREC truth.
  blockers.push(
    ...(approveDependencyBlockers.rows || []).map((row) =>
      mapDependencyBlockerToLocalReviewItem(row, ["approve"])
    ),
    ...(lockDependencyBlockers.rows || []).map((row) =>
      mapDependencyBlockerToLocalReviewItem(row, ["lock"])
    )
  );
  blockers.push(
    ...(certification.incompleteRequiredSections || []).map((section) =>
      mapCertificationSectionToLocalReviewItem(section)
    )
  );

  if (!(Number(packRow?.evidenceCount || 0) > 0)) {
    warnings.push({
      level: "WARNING",
      code: "LOCAL_CLOSE_PACK_EVIDENCE_MISSING",
      message: "No evidence is attached for this pack yet",
      drill: {
        tab: "evidence",
      },
    });
  }

  if (invalidatingScopeCount > 0) {
    warnings.push({
      level: "WARNING",
      code: "ENTITY_CLOSE_READINESS_INVALIDATED",
      message: `Entity readiness is currently invalidated by ${invalidatingScopeCount} scope(s)`,
      count: invalidatingScopeCount,
      drill: {
        tab: "exceptions",
      },
    });
  }

  const currentStatus = toUpperText(packRow?.status);
  const blockerCodesByAction = {
    submit: blockers
      .filter((row) => row.appliesToActions?.includes("submit"))
      .map((row) => row.code),
    approve: blockers
      .filter((row) => row.appliesToActions?.includes("approve"))
      .map((row) => row.code),
    lock: blockers
      .filter((row) => row.appliesToActions?.includes("lock"))
      .map((row) => row.code),
  };
  const actionAvailability = buildActionAvailability({
    currentStatus,
    blockerCodesByAction,
  });

  return {
    currentStatus,
    reviewedReportKeys,
    missingReportKeys,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    counts: {
      reviewedReportCount: reviewedReportKeys.length,
      requiredReportCount: LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.length,
      draftJournalCount,
      pendingReopenRequestCount,
      revrecContinuityIssueCount: Array.isArray(revrecContinuity?.blockingRows)
        ? revrecContinuity.blockingRows.length
        : 0,
      evidenceCount: Number(packRow?.evidenceCount || 0),
      certificationRequiredSectionCount:
        certification.summary?.requiredSectionCount || 0,
      certificationCompletedRequiredSectionCount:
        certification.summary?.completedRequiredSectionCount || 0,
      certificationIncompleteRequiredCount:
        certification.summary?.incompleteRequiredSectionCount || 0,
      invalidatingScopeCount,
    },
    workflowGate,
    revrecContinuity: revrecContinuity
      ? {
          applicable: Boolean(revrecContinuity.applicable),
          nextFiscalPeriodId: parsePositiveInt(revrecContinuity.nextFiscalPeriodId),
          blockingRowCount: Array.isArray(revrecContinuity.blockingRows)
            ? revrecContinuity.blockingRows.length
            : 0,
        }
      : null,
    blockers,
    warnings,
    actionAvailability,
    nextRecommendedAction: buildRecommendedAction(
      currentStatus,
      actionAvailability
    ),
  };
}

/**
 * Read the surfaced RP12 review gate for one local close pack without mutating
 * the workflow state. This keeps pack blockers explainable from existing
 * report reviews, draft journals, workflow state, and reopen truth.
 */
export async function getLocalClosePackReviewGate({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  return evaluateLocalClosePackReviewGate({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });
}

async function isWorkflowGateFeatureEnabled({
  tenantId,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT is_enabled
       FROM tenant_features
       WHERE tenant_id = ?
         AND feature_code = ?
       LIMIT 1`,
      [tenantId, FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1]
    );
    return Boolean(Number(result.rows?.[0]?.is_enabled || 0));
  } catch (err) {
    if (isMissingTableError(err)) {
      return false;
    }
    throw err;
  }
}

async function findActiveWorkflowAssignmentForPack({
  packRow,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(packRow?.tenant_id);
  const operatingUnitId = parsePositiveInt(packRow?.operating_unit_id) || -1;
  const legalEntityId = parsePositiveInt(packRow?.legal_entity_id) || -1;
  const countryId = parsePositiveInt(packRow?.country_id) || -1;
  const groupCompanyId = parsePositiveInt(packRow?.group_company_id) || -1;
  const effectiveDate = new Date().toISOString().slice(0, 10);

  const result = await runQuery(
    `SELECT wa.*
     FROM workflow_assignments wa
     WHERE wa.tenant_id = ?
       AND wa.process_type = ?
       AND wa.status = 'ACTIVE'
       AND wa.effective_from <= ?
       AND (wa.effective_to IS NULL OR wa.effective_to >= ?)
       AND (
         (wa.operating_unit_id IS NOT NULL AND wa.operating_unit_id = ?)
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NOT NULL
           AND wa.legal_entity_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NOT NULL
           AND wa.country_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NULL
           AND wa.group_company_id IS NOT NULL
           AND wa.group_company_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NULL
           AND wa.group_company_id IS NULL
         )
       )
     ORDER BY
       CASE
         WHEN wa.operating_unit_id IS NOT NULL AND wa.operating_unit_id = ? THEN 1
         WHEN
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NOT NULL
           AND wa.legal_entity_id = ? THEN 2
         WHEN
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NOT NULL
           AND wa.country_id = ? THEN 3
         WHEN
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NULL
           AND wa.group_company_id IS NOT NULL
           AND wa.group_company_id = ? THEN 4
         ELSE 5
       END,
       wa.effective_from DESC,
       wa.id DESC
     LIMIT 1`,
    [
      tenantId,
      LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
      effectiveDate,
      effectiveDate,
      operatingUnitId,
      legalEntityId,
      countryId,
      groupCompanyId,
      operatingUnitId,
      legalEntityId,
      countryId,
      groupCompanyId,
    ]
  );
  return result.rows?.[0] || null;
}

async function getWorkflowDefinitionMaxStepNo({
  workflowDefinitionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT MAX(step_no) AS max_step_no
     FROM workflow_definition_steps
     WHERE workflow_definition_id = ?`,
    [workflowDefinitionId]
  );
  return Number(result.rows?.[0]?.max_step_no || 0);
}

async function loadWorkflowInstanceByTarget({
  tenantId,
  packId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
     FROM workflow_instances
     WHERE tenant_id = ?
       AND process_type = ?
       AND target_type = ?
       AND target_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [
      tenantId,
      LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
      LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
      packId,
    ]
  );
  return result.rows?.[0] || null;
}

async function loadWorkflowInstanceById({
  tenantId,
  workflowInstanceId,
  runQuery = query,
  forUpdate = false,
}) {
  if (!parsePositiveInt(workflowInstanceId)) {
    return null;
  }
  const result = await runQuery(
    `SELECT *
     FROM workflow_instances
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, workflowInstanceId]
  );
  return result.rows?.[0] || null;
}

async function prepareWorkflowInstanceForSubmission({
  tenantId,
  userId,
  packRow,
  runQuery = query,
}) {
  const workflowEnabled = await isWorkflowGateFeatureEnabled({
    tenantId,
    runQuery,
  });
  if (!workflowEnabled) {
    return mapWorkflowGateSummary({
      enabled: false,
      required: false,
      assignmentFound: false,
      approved: true,
      message: "Workflow approval gate is disabled for this tenant",
    });
  }

  const assignmentRow = await findActiveWorkflowAssignmentForPack({
    packRow,
    runQuery,
  });
  if (!assignmentRow) {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: false,
      approved: false,
      errorCode: "WORKFLOW_NOT_ASSIGNED",
      message:
        "Workflow approval gate is enabled but no ACTIVE local close-pack workflow assignment was found for scope",
    });
  }

  const workflowDefinitionId = parsePositiveInt(assignmentRow.workflow_definition_id);
  const maxStepNo = await getWorkflowDefinitionMaxStepNo({
    workflowDefinitionId,
    runQuery,
  });
  if (!(maxStepNo > 0)) {
    throw conflict(
      "Assigned local close-pack workflow definition has no approval steps",
      {
        workflowDefinitionId,
      },
      "WORKFLOW_NOT_ASSIGNED"
    );
  }

  let instanceRow =
    (await loadWorkflowInstanceById({
      tenantId,
      workflowInstanceId: parsePositiveInt(packRow.workflow_instance_id),
      runQuery,
      forUpdate: true,
    })) ||
    (await loadWorkflowInstanceByTarget({
      tenantId,
      packId: parsePositiveInt(packRow.id),
      runQuery,
      forUpdate: true,
    }));

  if (!instanceRow) {
    const insertResult = await runQuery(
      `INSERT INTO workflow_instances (
         tenant_id,
         process_type,
         target_type,
         target_id,
         workflow_definition_id,
         status,
         current_step_no,
         requested_by_user_id
       ) VALUES (?, ?, ?, ?, ?, 'PENDING', 1, ?)`,
      [
        tenantId,
        LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
        LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
        parsePositiveInt(packRow.id),
        workflowDefinitionId,
        userId,
      ]
    );
    instanceRow = await loadWorkflowInstanceById({
      tenantId,
      workflowInstanceId: parsePositiveInt(insertResult.rows?.insertId),
      runQuery,
      forUpdate: true,
    });
  } else {
    // Local close packs have one workflow target row per pack, so repeated
    // submit/return cycles must rearm the same instance in place.
    await runQuery(
      `DELETE FROM workflow_instance_decisions
       WHERE workflow_instance_id = ?`,
      [parsePositiveInt(instanceRow.id)]
    );
    await runQuery(
      `UPDATE workflow_instances
       SET workflow_definition_id = ?,
           status = 'PENDING',
           current_step_no = 1,
           requested_by_user_id = ?,
           requested_at = CURRENT_TIMESTAMP,
           resolved_at = NULL,
           resolution_note = NULL
       WHERE tenant_id = ?
         AND id = ?`,
      [
        workflowDefinitionId,
        userId,
        tenantId,
        parsePositiveInt(instanceRow.id),
      ]
    );
    instanceRow = await loadWorkflowInstanceById({
      tenantId,
      workflowInstanceId: parsePositiveInt(instanceRow.id),
      runQuery,
      forUpdate: true,
    });
  }

  instanceRow = await ensureUnifiedWorkflowInstanceBridge({
    tenantId,
    instanceId: parsePositiveInt(instanceRow.id),
    requestedByUserId: userId,
    fallbackScope: {
      groupCompanyId: parsePositiveInt(packRow.group_company_id),
      countryId: parsePositiveInt(packRow.country_id),
      legalEntityId: parsePositiveInt(packRow.legal_entity_id),
      operatingUnitId: parsePositiveInt(packRow.operating_unit_id),
    },
    resetToPending: true,
    runQuery,
  });

  return mapWorkflowGateSummary({
    enabled: true,
    required: true,
    assignmentFound: true,
    approved: false,
    message: "Workflow approval is required before local close-pack approval",
    workflowDefinitionId,
    workflowInstanceId: parsePositiveInt(instanceRow?.id),
    workflowInstanceStatus: instanceRow?.status || "PENDING",
  });
}

async function evaluateWorkflowGateForApproval({
  tenantId,
  packRow,
  runQuery = query,
}) {
  const workflowEnabled = await isWorkflowGateFeatureEnabled({
    tenantId,
    runQuery,
  });
  if (!workflowEnabled) {
    return mapWorkflowGateSummary({
      enabled: false,
      required: false,
      assignmentFound: false,
      approved: true,
      message: "Workflow approval gate is disabled for this tenant",
    });
  }

  const assignmentRow = await findActiveWorkflowAssignmentForPack({
    packRow,
    runQuery,
  });
  if (!assignmentRow) {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: false,
      approved: false,
      errorCode: "WORKFLOW_NOT_ASSIGNED",
      message:
        "Workflow approval gate is enabled but no ACTIVE local close-pack workflow assignment was found for scope",
    });
  }

  const workflowDefinitionId = parsePositiveInt(assignmentRow.workflow_definition_id);
  const maxStepNo = await getWorkflowDefinitionMaxStepNo({
    workflowDefinitionId,
    runQuery,
  });
  if (!(maxStepNo > 0)) {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: true,
      approved: false,
      errorCode: "WORKFLOW_NOT_ASSIGNED",
      message:
        "Assigned local close-pack workflow definition has no approval steps",
      workflowDefinitionId,
    });
  }

  const instanceRow =
    (await loadWorkflowInstanceById({
      tenantId,
      workflowInstanceId: parsePositiveInt(packRow.workflow_instance_id),
      runQuery,
    })) ||
    (await loadWorkflowInstanceByTarget({
      tenantId,
      packId: parsePositiveInt(packRow.id),
      runQuery,
    }));

  if (!instanceRow) {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: true,
      approved: false,
      errorCode: "APPROVAL_REQUIRED",
      message:
        "Workflow submission is not prepared for this local close pack; submit again before approval",
      workflowDefinitionId,
    });
  }

  const workflowInstanceStatus = toUpperText(instanceRow.status);
  if (workflowInstanceStatus === "APPROVED") {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: true,
      approved: true,
      message: "Workflow approval is complete",
      workflowDefinitionId,
      workflowInstanceId: parsePositiveInt(instanceRow.id),
      workflowInstanceStatus,
    });
  }
  if (workflowInstanceStatus === "REJECTED") {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: true,
      approved: false,
      errorCode: "APPROVAL_INSTANCE_REJECTED",
      message: "Workflow instance is REJECTED; return and resubmit the pack",
      workflowDefinitionId,
      workflowInstanceId: parsePositiveInt(instanceRow.id),
      workflowInstanceStatus,
    });
  }
  if (workflowInstanceStatus === "CANCELLED") {
    return mapWorkflowGateSummary({
      enabled: true,
      required: true,
      assignmentFound: true,
      approved: false,
      errorCode: "APPROVAL_REQUIRED",
      message: "Workflow instance is CANCELLED; resubmit the pack before approval",
      workflowDefinitionId,
      workflowInstanceId: parsePositiveInt(instanceRow.id),
      workflowInstanceStatus,
    });
  }

  return mapWorkflowGateSummary({
    enabled: true,
    required: true,
    assignmentFound: true,
    approved: false,
    errorCode: "APPROVAL_REQUIRED",
    message: "Workflow approval is still pending for this local close pack",
    workflowDefinitionId,
    workflowInstanceId: parsePositiveInt(instanceRow.id),
    workflowInstanceStatus,
  });
}

async function cancelWorkflowInstanceForReturn({
  tenantId,
  packRow,
  decisionNote,
  runQuery = query,
}) {
  let instanceRow =
    (await loadWorkflowInstanceById({
      tenantId,
      workflowInstanceId: parsePositiveInt(packRow.workflow_instance_id),
      runQuery,
      forUpdate: true,
    })) ||
    (await loadWorkflowInstanceByTarget({
      tenantId,
      packId: parsePositiveInt(packRow.id),
      runQuery,
      forUpdate: true,
    }));
  if (!instanceRow) {
    return null;
  }

  await runQuery(
    `UPDATE workflow_instances
     SET status = 'CANCELLED',
         resolved_at = CURRENT_TIMESTAMP,
         resolution_note = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [
      decisionNote || "Returned for correction",
      tenantId,
      parsePositiveInt(instanceRow.id),
    ]
  );

  await cancelUnifiedWorkflowInstanceBridge({
    tenantId,
    instanceId: parsePositiveInt(instanceRow.id),
    resolutionNote: decisionNote || "Returned for correction",
    runQuery,
  });

  instanceRow = await loadWorkflowInstanceById({
    tenantId,
    workflowInstanceId: parsePositiveInt(instanceRow.id),
    runQuery,
  });
  return instanceRow;
}

async function buildActionResult({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery,
  workflowGate = null,
  gateSummary = null,
}) {
  const row = await getLocalClosePackById({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });
  const entityReadiness = await getEntityCloseReadiness({
    tenantId,
    legalEntityId: parsePositiveInt(row.legalEntityId),
    bookId: parsePositiveInt(row.bookId),
    fiscalPeriodId: parsePositiveInt(row.fiscalPeriodId),
    runQuery,
  });
  return {
    row,
    entityReadiness,
    workflowGate: workflowGate ? mapWorkflowGateSummary(workflowGate) : null,
    gateSummary: gateSummary || null,
    reviewGate: await evaluateLocalClosePackReviewGate({
      req,
      tenantId,
      packId,
      assertScopeAccess,
      row,
      entityReadiness,
      runQuery,
    }),
  };
}

function assertActionStatus(packRow, allowedStatuses, actionLabel) {
  const currentStatus = toUpperText(packRow?.status);
  if (!allowedStatuses.has(currentStatus)) {
    throw conflict(
      `Local close pack status ${currentStatus} does not allow ${actionLabel}`,
      {
        currentStatus,
        allowedStatuses: Array.from(allowedStatuses),
      },
      "LOCAL_CLOSE_PACK_STATUS_CONFLICT"
    );
  }
}

/**
 * Submit a local close pack into review and rearm any target-bound workflow
 * instance needed for the next approval cycle.
 */
export async function submitLocalClosePack({
  req,
  input,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const packRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!packRow) {
      throw notFound("Local close pack not found");
    }
    assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);
    assertActionStatus(
      packRow,
      SUBMITTABLE_LOCAL_CLOSE_PACK_STATUSES,
      "submit"
    );

    const draftJournalCount = await countScopedDraftJournalsForPack({
      packRow,
      runQuery: tx.query,
    });
    if (draftJournalCount > 0) {
      throw conflict(
        `Local close pack cannot be submitted while ${draftJournalCount} exact-scope draft journal(s) remain`,
        {
          draftJournalCount,
        },
        "LOCAL_CLOSE_PACK_DRAFT_JOURNALS_BLOCK"
      );
    }

    const workflowGate = await prepareWorkflowInstanceForSubmission({
      tenantId: input.tenantId,
      userId: input.userId,
      packRow,
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE local_close_packs
       SET status = 'READY_FOR_REVIEW',
           owner_user_id = ?,
           reviewer_user_id = NULL,
           workflow_instance_id = ?,
           submitted_at = CURRENT_TIMESTAMP,
           approved_at = NULL,
           locked_at = NULL,
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        input.userId,
        parsePositiveInt(workflowGate.workflowInstanceId) || null,
        input.userId,
        input.tenantId,
        input.packId,
      ]
    );

    const updatedPackRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });
    await syncCycleItemsBySource("LOCAL_CLOSE_PACK", input.packId, {
      tenantId: input.tenantId,
      userId: input.userId,
      runQuery: tx.query,
    });
    await writeLocalClosePackAuditLog({
      runQuery: tx.query,
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      packRow: updatedPackRow || packRow,
      action: "ouclose.submit",
      payload: {
        workflowGate,
        draftJournalCount,
      },
    });

    return buildActionResult({
      req,
      tenantId: input.tenantId,
      packId: input.packId,
      assertScopeAccess,
      runQuery: tx.query,
      workflowGate,
      gateSummary: {
        draftJournalCount,
      },
    });
  });
}

/**
 * Return a submitted local close pack for correction.
 */
export async function returnLocalClosePack({
  req,
  input,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const packRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!packRow) {
      throw notFound("Local close pack not found");
    }
    assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);
    assertActionStatus(
      packRow,
      RETURNABLE_LOCAL_CLOSE_PACK_STATUSES,
      "return"
    );

    const workflowInstance = await cancelWorkflowInstanceForReturn({
      tenantId: input.tenantId,
      packRow,
      decisionNote: input.decisionNote,
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE local_close_packs
       SET status = 'RETURNED',
           reviewer_user_id = ?,
           approved_at = NULL,
           locked_at = NULL,
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [input.userId, input.userId, input.tenantId, input.packId]
    );

    const updatedPackRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });
    await syncCycleItemsBySource("LOCAL_CLOSE_PACK", input.packId, {
      tenantId: input.tenantId,
      userId: input.userId,
      runQuery: tx.query,
    });
    await writeLocalClosePackAuditLog({
      runQuery: tx.query,
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      packRow: updatedPackRow || packRow,
      action: "ouclose.return",
      payload: {
        decisionNote: input.decisionNote || null,
        workflowInstanceId: parsePositiveInt(workflowInstance?.id),
      },
    });

    return buildActionResult({
      req,
      tenantId: input.tenantId,
      packId: input.packId,
      assertScopeAccess,
      runQuery: tx.query,
    });
  });
}

/**
 * Approve a local close pack once the current review cycle and any configured
 * workflow gate both pass.
 */
export async function approveLocalClosePack({
  req,
  input,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const packRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!packRow) {
      throw notFound("Local close pack not found");
    }
    assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);
    assertActionStatus(
      packRow,
      APPROVABLE_LOCAL_CLOSE_PACK_STATUSES,
      "approve"
    );

    const draftJournalCount = await countScopedDraftJournalsForPack({
      packRow,
      runQuery: tx.query,
    });
    if (draftJournalCount > 0) {
      throw conflict(
        `Local close pack cannot be approved while ${draftJournalCount} exact-scope draft journal(s) remain`,
        {
          draftJournalCount,
        },
        "LOCAL_CLOSE_PACK_DRAFT_JOURNALS_BLOCK"
      );
    }

    const reviewedReportKeys = await listReviewedReportKeysForPack({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });
    const missingReportKeys = LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.filter(
      (key) => !reviewedReportKeys.includes(key)
    );
    if (missingReportKeys.length > 0) {
      throw conflict(
        `Local close pack cannot be approved until all required report reviews are captured (${missingReportKeys.join(", ")})`,
        {
          reviewedReportCount: reviewedReportKeys.length,
          requiredReportCount: LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.length,
          missingReportKeys,
        },
        "LOCAL_REPORT_REVIEW_MISSING"
      );
    }

    const workflowGate = await evaluateWorkflowGateForApproval({
      tenantId: input.tenantId,
      packRow,
      runQuery: tx.query,
    });
    if (!workflowGate.approved) {
      throw conflict(
        workflowGate.message || "Workflow approval is required before local close-pack approval",
        {
          workflowGate,
        },
        workflowGate.errorCode || "APPROVAL_REQUIRED"
      );
    }

    const revrecContinuity = await loadRevrecYearEndContinuityReviewForPack({
      packRow,
      runQuery: tx.query,
    });
    if (Array.isArray(revrecContinuity?.blockingRows) && revrecContinuity.blockingRows.length > 0) {
      const firstBlockingRow = revrecContinuity.blockingRows[0];
      throw conflict(
        `${firstBlockingRow?.title || "REVREC"}: ${firstBlockingRow?.detail || "Continuity issue must be resolved before approval"}`,
        {
          revrecContinuity,
        },
        `REVREC_CONTINUITY_${toUpperText(firstBlockingRow?.reasonCodes?.[0] || "CONTINUITY_BLOCK")}`
      );
    }

    const dependencyBlockers = await listSourceActionDependencyBlockers(
      {
        sourceTargetType: "LOCAL_CLOSE_PACK",
        sourceTargetId: input.packId,
        action: "APPROVE",
      },
      {
        tenantId: input.tenantId,
        runQuery: tx.query,
      }
    );
    if ((dependencyBlockers.rows || []).length > 0) {
      const firstBlocker = dependencyBlockers.rows[0];
      throw conflict(
        firstBlocker?.message || "Local close pack approval is blocked by unresolved close dependencies",
        {
          dependencyBlockers: dependencyBlockers.rows,
        },
        firstBlocker?.code || "LOCAL_CLOSE_PACK_DEPENDENCY_BLOCK"
      );
    }

    await tx.query(
      `UPDATE local_close_packs
       SET status = 'APPROVED',
           reviewer_user_id = ?,
           approved_at = CURRENT_TIMESTAMP,
           locked_at = NULL,
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [input.userId, input.userId, input.tenantId, input.packId]
    );

    const updatedPackRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });
    await syncCycleItemsBySource("LOCAL_CLOSE_PACK", input.packId, {
      tenantId: input.tenantId,
      userId: input.userId,
      runQuery: tx.query,
    });
    await writeLocalClosePackAuditLog({
      runQuery: tx.query,
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      packRow: updatedPackRow || packRow,
      action: "ouclose.approve",
      payload: {
        workflowGate,
        draftJournalCount,
        decisionNote: input.decisionNote || null,
      },
    });

    return buildActionResult({
      req,
      tenantId: input.tenantId,
      packId: input.packId,
      assertScopeAccess,
      runQuery: tx.query,
      workflowGate,
      gateSummary: {
        draftJournalCount,
      },
    });
  });
}

/**
 * Lock an approved local close pack once there are no pending reopen requests.
 */
export async function lockLocalClosePack({
  req,
  input,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const packRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!packRow) {
      throw notFound("Local close pack not found");
    }
    assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);
    assertActionStatus(packRow, LOCKABLE_LOCAL_CLOSE_PACK_STATUSES, "lock");

    const pendingReopenRequestCount = await countPendingReopenRequests({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });
    if (pendingReopenRequestCount > 0) {
      throw conflict(
        "Local close pack cannot be locked while reopen requests are pending",
        {
          pendingReopenRequestCount,
        },
        "LOCAL_CLOSE_PACK_PENDING_REOPEN_BLOCK"
      );
    }

    const revrecContinuity = await loadRevrecYearEndContinuityReviewForPack({
      packRow,
      runQuery: tx.query,
    });
    if (Array.isArray(revrecContinuity?.blockingRows) && revrecContinuity.blockingRows.length > 0) {
      const firstBlockingRow = revrecContinuity.blockingRows[0];
      throw conflict(
        `${firstBlockingRow?.title || "REVREC"}: ${firstBlockingRow?.detail || "Continuity issue must be resolved before lock"}`,
        {
          revrecContinuity,
        },
        `REVREC_CONTINUITY_${toUpperText(firstBlockingRow?.reasonCodes?.[0] || "CONTINUITY_BLOCK")}`
      );
    }

    const dependencyBlockers = await listSourceActionDependencyBlockers(
      {
        sourceTargetType: "LOCAL_CLOSE_PACK",
        sourceTargetId: input.packId,
        action: "LOCK",
      },
      {
        tenantId: input.tenantId,
        runQuery: tx.query,
      }
    );
    if ((dependencyBlockers.rows || []).length > 0) {
      const firstBlocker = dependencyBlockers.rows[0];
      throw conflict(
        firstBlocker?.message || "Local close pack lock is blocked by unresolved close dependencies",
        {
          dependencyBlockers: dependencyBlockers.rows,
        },
        firstBlocker?.code || "LOCAL_CLOSE_PACK_DEPENDENCY_BLOCK"
      );
    }

    const certification = await getLocalClosePackCertification({
      req,
      tenantId: input.tenantId,
      packId: input.packId,
      userId: input.userId,
      assertScopeAccess,
      runQuery: tx.query,
    });
    if ((certification.incompleteRequiredSections || []).length > 0) {
      const firstIncompleteSection = certification.incompleteRequiredSections[0];
      throw conflict(
        `${firstIncompleteSection?.sectionTitle || "Certification section"} must be completed before lock`,
        {
          certification,
        },
        "LOCAL_CLOSE_PACK_CERTIFICATION_INCOMPLETE"
      );
    }

    await tx.query(
      `UPDATE local_close_packs
       SET status = 'LOCKED',
           reviewer_user_id = ?,
           locked_at = CURRENT_TIMESTAMP,
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [input.userId, input.userId, input.tenantId, input.packId]
    );

    const updatedPackRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });
    await syncCycleItemsBySource("LOCAL_CLOSE_PACK", input.packId, {
      tenantId: input.tenantId,
      userId: input.userId,
      runQuery: tx.query,
    });
    await writeLocalClosePackAuditLog({
      runQuery: tx.query,
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      packRow: updatedPackRow || packRow,
      action: "ouclose.lock",
      payload: {
        pendingReopenRequestCount,
        decisionNote: input.decisionNote || null,
      },
    });

    return buildActionResult({
      req,
      tenantId: input.tenantId,
      packId: input.packId,
      assertScopeAccess,
      runQuery: tx.query,
      gateSummary: {
        pendingReopenRequestCount,
      },
    });
  });
}

export default {
  getLocalClosePackReviewGate,
  submitLocalClosePack,
  returnLocalClosePack,
  approveLocalClosePack,
  lockLocalClosePack,
};
