import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getLocalClosePackById } from "./local.close-packs.service.js";
import { LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS } from "./local.close-packs.shared.js";
import { LOCAL_CLOSE_PACK } from "../utils/source-ref-types.js";

const CERTIFICATION_STATUS_VALUES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETE",
]);
const CERTIFICATION_SECTION_STATUS_VALUES = Object.freeze([
  "OPEN",
  "COMPLETE",
]);
const CERTIFICATION_SECTION_TYPE_VALUES = Object.freeze([
  "SYSTEM",
  "MANUAL",
]);

const LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES = Object.freeze([
  Object.freeze({
    sectionKey: "REPORTS_TIED_OUT",
    sectionTitle: "Reports tied out",
    sectionDescription:
      "All required local close reports were reviewed for this exact pack scope.",
    sectionType: "SYSTEM",
    sectionOrder: 10,
    isRequired: true,
  }),
  Object.freeze({
    sectionKey: "EVIDENCE_BOUND",
    sectionTitle: "Evidence binder attached",
    sectionDescription:
      "At least one close evidence file is attached to the pack before final lock.",
    sectionType: "SYSTEM",
    sectionOrder: 20,
    isRequired: true,
  }),
  Object.freeze({
    sectionKey: "FINAL_CERTIFICATION",
    sectionTitle: "Final certification attestation",
    sectionDescription:
      "Reviewer attests the pack is ready to be locked based on the reviewed reports and attached evidence.",
    sectionType: "MANUAL",
    sectionOrder: 30,
    isRequired: true,
  }),
  Object.freeze({
    sectionKey: "COMMENTARY_LOGGED",
    sectionTitle: "Commentary logged",
    sectionDescription:
      "Internal comments capture judgement, follow-up, or handoff context for the pack.",
    sectionType: "SYSTEM",
    sectionOrder: 40,
    isRequired: false,
  }),
]);

const CERTIFICATION_TEMPLATE_BY_KEY = new Map(
  LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES.map((template) => [
    template.sectionKey,
    template,
  ])
);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDateTime(value) {
  return value || null;
}

function normalizeNote(value, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (required) {
      throw badRequest("note is required");
    }
    return null;
  }
  if (normalized.length > 1000) {
    throw badRequest("note cannot exceed 1000 characters");
  }
  return normalized;
}

function mapCertificationRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    localClosePackId: parsePositiveInt(row.local_close_pack_id),
    status: toUpperText(row.status),
    requiredSectionCount: Number(row.required_section_count || 0) || 0,
    completedRequiredSectionCount:
      Number(row.completed_required_section_count || 0) || 0,
    incompleteRequiredSectionCount:
      Number(row.incomplete_required_section_count || 0) || 0,
    progressPercentage: Number(row.progress_percentage || 0) || 0,
    certifiedByUserId: parsePositiveInt(row.certified_by_user_id),
    certifiedByUserName: row.certified_by_user_name || null,
    certifiedAt: toDateTime(row.certified_at),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    createdAt: toDateTime(row.created_at),
    updatedAt: toDateTime(row.updated_at),
  };
}

function mapCertificationSectionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    localClosePackCertificationId: parsePositiveInt(
      row.local_close_pack_certification_id
    ),
    sectionKey: String(row.section_key || ""),
    sectionTitle: row.section_title || null,
    sectionDescription: row.section_description || null,
    sectionType: toUpperText(row.section_type),
    sectionOrder: Number(row.section_order || 0) || 0,
    isRequired: Boolean(Number(row.is_required || 0)),
    status: toUpperText(row.status),
    completionSource: row.completion_source
      ? toUpperText(row.completion_source)
      : null,
    note: row.note || null,
    completedByUserId: parsePositiveInt(row.completed_by_user_id),
    completedByUserName: row.completed_by_user_name || null,
    completedAt: toDateTime(row.completed_at),
    createdAt: toDateTime(row.created_at),
    updatedAt: toDateTime(row.updated_at),
  };
}

async function assertLocalClosePackCertificationReadable({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  return getLocalClosePackById({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });
}

async function findCertificationRow({
  tenantId,
  packId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
       certification.*,
       certifier.name AS certified_by_user_name
     FROM local_close_pack_certifications certification
     LEFT JOIN users certifier
       ON certifier.id = certification.certified_by_user_id
     WHERE certification.tenant_id = ?
       AND certification.local_close_pack_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, packId]
  );
  return result.rows?.[0] || null;
}

async function listCertificationSectionRows({
  tenantId,
  certificationId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
       sections.*,
       completed_by_user.name AS completed_by_user_name
     FROM local_close_pack_certification_sections sections
     LEFT JOIN users completed_by_user
       ON completed_by_user.id = sections.completed_by_user_id
     WHERE sections.tenant_id = ?
       AND sections.local_close_pack_certification_id = ?
     ORDER BY sections.section_order ASC, sections.id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, certificationId]
  );
  return result.rows || [];
}

async function ensureCertificationScaffold({
  tenantId,
  packId,
  userId = null,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO local_close_pack_certifications (
       tenant_id,
       local_close_pack_id,
       status,
       created_by_user_id,
       updated_by_user_id
     )
     VALUES (?, ?, 'NOT_STARTED', ?, ?)
     ON DUPLICATE KEY UPDATE
       updated_by_user_id = COALESCE(VALUES(updated_by_user_id), updated_by_user_id)`,
    [tenantId, packId, parsePositiveInt(userId) || null, parsePositiveInt(userId) || null]
  );

  const certificationRow = await findCertificationRow({
    tenantId,
    packId,
    runQuery,
  });
  if (!certificationRow) {
    throw new Error("Local close-pack certification header readback failed");
  }

  for (const template of LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES) {
    // Keep one stable section row per template so the certification pack can be
    // strengthened over time without replacing the underlying local close pack.
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `INSERT INTO local_close_pack_certification_sections (
         tenant_id,
         local_close_pack_certification_id,
         section_key,
         section_title,
         section_description,
         section_type,
         section_order,
         is_required,
         status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
       ON DUPLICATE KEY UPDATE
         section_title = VALUES(section_title),
         section_description = VALUES(section_description),
         section_type = VALUES(section_type),
         section_order = VALUES(section_order),
         is_required = VALUES(is_required)`,
      [
        tenantId,
        certificationRow.id,
        template.sectionKey,
        template.sectionTitle,
        template.sectionDescription,
        template.sectionType,
        template.sectionOrder,
        template.isRequired ? 1 : 0,
      ]
    );
  }

  return certificationRow;
}

async function loadLocalClosePackCertificationMetrics({
  tenantId,
  packId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       lcp.status,
       (
         SELECT COUNT(*)
         FROM local_close_pack_report_reviews reviews
         WHERE reviews.tenant_id = lcp.tenant_id
           AND reviews.local_close_pack_id = lcp.id
       ) AS report_review_count,
       (
         SELECT COUNT(*)
         FROM evidence_objects eo
         WHERE eo.tenant_id = lcp.tenant_id
           AND eo.legal_entity_id = lcp.legal_entity_id
           AND eo.source_ref_type = ?
           AND eo.source_ref_id = lcp.id
           AND eo.status <> 'DELETED'
       ) AS evidence_count,
       (
         SELECT COUNT(*)
         FROM internal_comments ic
         WHERE ic.tenant_id = lcp.tenant_id
           AND ic.legal_entity_id = lcp.legal_entity_id
           AND ic.source_ref_type = ?
           AND ic.source_ref_id = lcp.id
           AND ic.status <> 'DELETED'
       ) AS comment_count
     FROM local_close_packs lcp
     WHERE lcp.tenant_id = ?
       AND lcp.id = ?
     LIMIT 1`,
    [LOCAL_CLOSE_PACK, LOCAL_CLOSE_PACK, tenantId, packId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("Local close pack not found");
  }

  return {
    packStatus: toUpperText(row.status),
    reportReviewCount: Number(row.report_review_count || 0) || 0,
    requiredReportCount: LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.length,
    evidenceCount: Number(row.evidence_count || 0) || 0,
    commentCount: Number(row.comment_count || 0) || 0,
  };
}

function deriveSystemSectionStatus(sectionKey, metrics) {
  switch (sectionKey) {
    case "REPORTS_TIED_OUT":
      return metrics.reportReviewCount >= metrics.requiredReportCount
        ? "COMPLETE"
        : "OPEN";
    case "EVIDENCE_BOUND":
      return metrics.evidenceCount > 0 ? "COMPLETE" : "OPEN";
    case "COMMENTARY_LOGGED":
      return metrics.commentCount > 0 ? "COMPLETE" : "OPEN";
    default:
      return "OPEN";
  }
}

function deriveCertificationStatus({
  requiredSectionCount,
  completedRequiredSectionCount,
}) {
  if (!requiredSectionCount || completedRequiredSectionCount <= 0) {
    return "NOT_STARTED";
  }
  if (completedRequiredSectionCount >= requiredSectionCount) {
    return "COMPLETE";
  }
  return "IN_PROGRESS";
}

function shouldResetManualCertification({
  metrics,
  allRequiredSystemSectionsComplete,
}) {
  return (
    !allRequiredSystemSectionsComplete ||
    ["REOPENED", "RETURNED"].includes(metrics.packStatus)
  );
}

function buildCertificationSummary(row, sectionRows) {
  const requiredSections = sectionRows.filter((section) => section.isRequired);
  const completedRequiredSections = requiredSections.filter(
    (section) => section.status === "COMPLETE"
  );
  return {
    status: row?.status || "NOT_STARTED",
    requiredSectionCount: requiredSections.length,
    completedRequiredSectionCount: completedRequiredSections.length,
    incompleteRequiredSectionCount: Math.max(
      requiredSections.length - completedRequiredSections.length,
      0
    ),
    progressPercentage: requiredSections.length
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (completedRequiredSections.length / requiredSections.length) * 100
            )
          )
        )
      : 0,
    availableToLock:
      requiredSections.length > 0 &&
      completedRequiredSections.length >= requiredSections.length,
  };
}

/**
 * Refresh the explicit PR-04 certification pack for one local close pack.
 *
 * The certification layer wraps the existing pack artifacts instead of
 * replacing them, so system sections are derived from live report/evidence
 * truth while the final attestation remains a reviewer-owned manual section.
 */
export async function refreshLocalClosePackCertification({
  req,
  tenantId,
  packId,
  userId = null,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPackId = parsePositiveInt(packId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedPackId) {
    throw badRequest("packId is required");
  }

  await assertLocalClosePackCertificationReadable({
    req,
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    assertScopeAccess,
    runQuery,
  });

  const certificationRow = await ensureCertificationScaffold({
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    userId,
    runQuery,
  });
  const metrics = await loadLocalClosePackCertificationMetrics({
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    runQuery,
  });

  const currentSectionRows = await listCertificationSectionRows({
    tenantId: normalizedTenantId,
    certificationId: certificationRow.id,
    runQuery,
  });
  const currentSectionByKey = new Map(
    currentSectionRows.map((row) => [String(row.section_key || ""), row])
  );

  const nextSectionStateByKey = new Map();
  for (const template of LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES) {
    if (template.sectionType !== "SYSTEM") {
      continue;
    }
    nextSectionStateByKey.set(
      template.sectionKey,
      deriveSystemSectionStatus(template.sectionKey, metrics)
    );
  }

  const allRequiredSystemSectionsComplete =
    LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES.filter(
      (template) => template.sectionType === "SYSTEM" && template.isRequired
    ).every(
      (template) => nextSectionStateByKey.get(template.sectionKey) === "COMPLETE"
    );

  for (const template of LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES) {
    const currentRow = currentSectionByKey.get(template.sectionKey) || null;
    let nextStatus = "OPEN";
    let nextCompletionSource = null;
    let nextCompletedByUserId = null;
    let nextCompletedAt = null;
    const nextNote =
      template.sectionType === "MANUAL" ? currentRow?.note || null : null;

    if (template.sectionType === "SYSTEM") {
      nextStatus = nextSectionStateByKey.get(template.sectionKey) || "OPEN";
      nextCompletionSource = nextStatus === "COMPLETE" ? "SYSTEM" : null;
      nextCompletedAt =
        nextStatus === "COMPLETE"
          ? currentRow?.completed_at || currentRow?.updated_at || new Date()
          : null;
    } else {
      nextStatus =
        toUpperText(currentRow?.status) === "COMPLETE" ? "COMPLETE" : "OPEN";
      nextCompletionSource = nextStatus === "COMPLETE" ? "USER" : null;
      nextCompletedByUserId =
        nextStatus === "COMPLETE"
          ? parsePositiveInt(currentRow?.completed_by_user_id)
          : null;
      nextCompletedAt =
        nextStatus === "COMPLETE" ? currentRow?.completed_at || null : null;

      // A reopen or an upstream section drifting back to OPEN invalidates the
      // previous final attestation. The reviewer must certify again against the
      // current report/evidence state instead of relying on an old sign-off.
      if (
        shouldResetManualCertification({
          metrics,
          allRequiredSystemSectionsComplete,
        })
      ) {
        nextStatus = "OPEN";
        nextCompletionSource = null;
        nextCompletedByUserId = null;
        nextCompletedAt = null;
      }
    }

    const currentStatus = toUpperText(currentRow?.status) || "OPEN";
    const currentCompletionSource = currentRow?.completion_source
      ? toUpperText(currentRow.completion_source)
      : null;
    const currentCompletedByUserId = parsePositiveInt(
      currentRow?.completed_by_user_id
    );
    const currentCompletedAt = currentRow?.completed_at || null;
    const currentNote = currentRow?.note || null;

    if (
      currentStatus === nextStatus &&
      currentCompletionSource === nextCompletionSource &&
      currentCompletedByUserId === nextCompletedByUserId &&
      String(currentCompletedAt || "") === String(nextCompletedAt || "") &&
      String(currentNote || "") === String(nextNote || "")
    ) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `UPDATE local_close_pack_certification_sections
       SET status = ?,
           completion_source = ?,
           note = ?,
           completed_by_user_id = ?,
           completed_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND local_close_pack_certification_id = ?
         AND section_key = ?`,
      [
        nextStatus,
        nextCompletionSource,
        nextNote,
        nextCompletedByUserId,
        nextCompletedAt,
        normalizedTenantId,
        certificationRow.id,
        template.sectionKey,
      ]
    );
  }

  const refreshedSectionRows = (await listCertificationSectionRows({
    tenantId: normalizedTenantId,
    certificationId: certificationRow.id,
    runQuery,
  })).map(mapCertificationSectionRow);

  const summary = buildCertificationSummary(
    certificationRow,
    refreshedSectionRows
  );
  const finalCertificationSection = refreshedSectionRows.find(
    (section) => section.sectionKey === "FINAL_CERTIFICATION"
  );
  const nextCertificationStatus = deriveCertificationStatus(summary);

  await runQuery(
    `UPDATE local_close_pack_certifications
     SET status = ?,
         required_section_count = ?,
         completed_required_section_count = ?,
         incomplete_required_section_count = ?,
         progress_percentage = ?,
         certified_by_user_id = ?,
         certified_at = ?,
         updated_by_user_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND local_close_pack_id = ?`,
    [
      nextCertificationStatus,
      summary.requiredSectionCount,
      summary.completedRequiredSectionCount,
      summary.incompleteRequiredSectionCount,
      summary.progressPercentage,
      finalCertificationSection?.status === "COMPLETE"
        ? finalCertificationSection.completedByUserId
        : null,
      finalCertificationSection?.status === "COMPLETE"
        ? finalCertificationSection.completedAt
        : null,
      parsePositiveInt(userId) || null,
      normalizedTenantId,
      normalizedPackId,
    ]
  );

  const refreshedCertificationRow = mapCertificationRow(
    await findCertificationRow({
      tenantId: normalizedTenantId,
      packId: normalizedPackId,
      runQuery,
    })
  );
  const refreshedSummary = buildCertificationSummary(
    refreshedCertificationRow,
    refreshedSectionRows
  );

  return {
    row: refreshedCertificationRow,
    summary: refreshedSummary,
    sections: refreshedSectionRows,
    incompleteRequiredSections: refreshedSectionRows.filter(
      (section) => section.isRequired && section.status !== "COMPLETE"
    ),
  };
}

/**
 * Read the explicit PR-04 certification pack for one local close pack.
 */
export async function getLocalClosePackCertification({
  req,
  tenantId,
  packId,
  userId = null,
  assertScopeAccess,
  runQuery = query,
}) {
  return refreshLocalClosePackCertification({
    req,
    tenantId,
    packId,
    userId,
    assertScopeAccess,
    runQuery,
  });
}

/**
 * Update one manual certification section for a local close pack.
 */
export async function updateLocalClosePackCertificationSection({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const packId = parsePositiveInt(input?.packId);
  const userId = parsePositiveInt(input?.userId);
  const sectionKey = toUpperText(input?.sectionKey);
  const status = toUpperText(input?.status);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!packId) {
    throw badRequest("packId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }
  if (!CERTIFICATION_TEMPLATE_BY_KEY.has(sectionKey)) {
    throw badRequest("sectionKey is invalid");
  }
  if (!CERTIFICATION_SECTION_STATUS_VALUES.includes(status)) {
    throw badRequest("status is invalid");
  }

  const note = normalizeNote(input?.note, {
    required: status === "COMPLETE",
  });

  return withTransaction(async (tx) => {
    await assertLocalClosePackCertificationReadable({
      req,
      tenantId,
      packId,
      assertScopeAccess,
      runQuery: tx.query,
    });

    const certification = await refreshLocalClosePackCertification({
      req,
      tenantId,
      packId,
      userId,
      assertScopeAccess,
      runQuery: tx.query,
    });
    const targetSection = certification.sections.find(
      (section) => section.sectionKey === sectionKey
    );
    if (!targetSection) {
      throw badRequest("Certification section not found");
    }
    if (targetSection.sectionType !== "MANUAL") {
      throw badRequest("System certification sections are read-only");
    }

    await tx.query(
      `UPDATE local_close_pack_certification_sections
       SET status = ?,
           completion_source = ?,
           note = ?,
           completed_by_user_id = ?,
           completed_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND local_close_pack_certification_id = ?
         AND section_key = ?`,
      [
        status,
        status === "COMPLETE" ? "USER" : null,
        note,
        status === "COMPLETE" ? userId : null,
        status === "COMPLETE" ? new Date() : null,
        tenantId,
        certification.row.id,
        sectionKey,
      ]
    );

    return refreshLocalClosePackCertification({
      req,
      tenantId,
      packId,
      userId,
      assertScopeAccess,
      runQuery: tx.query,
    });
  });
}

export {
  CERTIFICATION_STATUS_VALUES,
  CERTIFICATION_SECTION_STATUS_VALUES,
  CERTIFICATION_SECTION_TYPE_VALUES,
  LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES,
};

export default {
  refreshLocalClosePackCertification,
  getLocalClosePackCertification,
  updateLocalClosePackCertificationSection,
  CERTIFICATION_STATUS_VALUES,
  CERTIFICATION_SECTION_STATUS_VALUES,
  CERTIFICATION_SECTION_TYPE_VALUES,
  LOCAL_CLOSE_PACK_CERTIFICATION_SECTION_TEMPLATES,
};
