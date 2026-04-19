import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertBookBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import {
  buildLocalClosePackScopeKey,
  LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS,
  LOCAL_CLOSE_PACK_SCOPE_TYPES,
  LOCAL_CLOSE_PACK_STATUS_VALUES,
  resolveLocalClosePackRowScope,
} from "./local.close-packs.shared.js";
import { LOCAL_CLOSE_PACK } from "../utils/source-ref-types.js";
import { autoLinkAndSyncSource } from "./close.cycle-items.service.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDateTime(value) {
  return value || null;
}

function pickLatestDateTime(...values) {
  let latest = null;
  let latestTs = 0;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = new Date(value);
    const ts = Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    if (!ts) {
      if (!latest) {
        latest = value;
      }
      continue;
    }
    if (ts >= latestTs) {
      latestTs = ts;
      latest = value;
    }
  }
  return latest;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function isDuplicateKeyError(err) {
  return Number(err?.errno) === 1062 || toUpperText(err?.code) === "ER_DUP_ENTRY";
}

function mapLocalClosePackRow(row) {
  if (!row) {
    return null;
  }

  const pendingReopenRequestCount =
    Number(row.pending_reopen_request_count || 0) || 0;
  const evidenceCount = Number(row.evidence_count || 0) || 0;
  const commentCount = Number(row.comment_count || 0) || 0;
  const reportReviewCount = Number(row.report_review_count || 0) || 0;
  const requiredReportCount = LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS.length;
  const completionPercentage = requiredReportCount
    ? Math.max(
        0,
        Math.min(100, Math.round((reportReviewCount / requiredReportCount) * 100))
      )
    : 0;
  const blockerCount = Math.max(requiredReportCount - reportReviewCount, 0);
  const warningCount = pendingReopenRequestCount + (evidenceCount === 0 ? 1 : 0);
  const updatedAt = toDateTime(row.updated_at);
  const lastReportReviewedAt = toDateTime(row.last_report_reviewed_at);
  const lastEvidenceAt = toDateTime(row.last_evidence_at);
  const lastCommentAt = toDateTime(row.last_comment_at);
  const lastAuditAt = toDateTime(row.last_audit_at);
  const certificationStatus = toUpperText(row.certification_status) || "NOT_STARTED";
  const certificationRequiredSectionCount =
    Number(row.certification_required_section_count || 0) || 0;
  const certificationCompletedRequiredSectionCount =
    Number(row.certification_completed_required_section_count || 0) || 0;
  const certificationIncompleteRequiredCount =
    Number(row.certification_incomplete_required_count || 0) || 0;
  const certificationProgressPercentage =
    Number(row.certification_progress_percentage || 0) || 0;

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    bookId: parsePositiveInt(row.book_id),
    bookCode: row.book_code || null,
    bookName: row.book_name || null,
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    fiscalYear: Number(row.fiscal_year || 0) || null,
    periodNo: Number(row.period_no || 0) || null,
    periodName: row.period_name || null,
    closeScopeType: toUpperText(row.close_scope_type),
    scopeKey: String(row.scope_key || ""),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    status: toUpperText(row.status),
    note: row.note || null,
    ownerUserId: parsePositiveInt(row.owner_user_id),
    ownerUserName: row.owner_user_name || null,
    reviewerUserId: parsePositiveInt(row.reviewer_user_id),
    reviewerUserName: row.reviewer_user_name || null,
    workflowInstanceId: parsePositiveInt(row.workflow_instance_id),
    workflowInstanceStatus: row.workflow_instance_status
      ? toUpperText(row.workflow_instance_status)
      : null,
    workflowCurrentStepNo: Number(row.workflow_current_step_no || 0) || null,
    pendingReopenRequestCount,
    evidenceCount,
    commentCount,
    reportReviewCount,
    requiredReportCount,
    completionPercentage,
    blockerCount,
    warningCount,
    certificationStatus,
    certificationRequiredSectionCount,
    certificationCompletedRequiredSectionCount,
    certificationIncompleteRequiredCount,
    certificationProgressPercentage,
    certifiedByUserId: parsePositiveInt(row.certified_by_user_id),
    certifiedByUserName: row.certified_by_user_name || null,
    certifiedAt: toDateTime(row.certified_at),
    lastReportReviewedAt,
    lastEvidenceAt,
    lastCommentAt,
    lastAuditAt,
    lastActivityAt: pickLatestDateTime(
      updatedAt,
      lastReportReviewedAt,
      lastEvidenceAt,
      lastCommentAt,
      lastAuditAt
    ),
    submittedAt: toDateTime(row.submitted_at),
    approvedAt: toDateTime(row.approved_at),
    lockedAt: toDateTime(row.locked_at),
    reopenedAt: toDateTime(row.reopened_at),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdByUserName: row.created_by_user_name || null,
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    updatedByUserName: row.updated_by_user_name || null,
    createdAt: toDateTime(row.created_at),
    updatedAt,
  };
}

function assertLocalClosePackRowReadable(req, row, assertScopeAccess) {
  const scope = resolveLocalClosePackRowScope(row);
  if (!scope) {
    return;
  }
  assertScopeAccess(req, scope.scopeKind, scope.scopeId, "localClosePack");
}

function canReadLocalClosePackRow(req, row, assertScopeAccess) {
  try {
    assertLocalClosePackRowReadable(req, row, assertScopeAccess);
    return true;
  } catch (err) {
    if (Number(err?.status) === 403) {
      return false;
    }
    throw err;
  }
}

function buildLocalClosePackBaseSelect(whereSql) {
  return `SELECT
      lcp.*,
      le.code AS legal_entity_code,
      le.name AS legal_entity_name,
      b.code AS book_code,
      b.name AS book_name,
      fp.fiscal_year,
      fp.period_no,
      fp.period_name,
      ou.code AS operating_unit_code,
      ou.name AS operating_unit_name,
      owner_user.name AS owner_user_name,
      reviewer_user.name AS reviewer_user_name,
      creator.name AS created_by_user_name,
      updater.name AS updated_by_user_name,
      certifier.name AS certified_by_user_name,
      wi.status AS workflow_instance_status,
      wi.current_step_no AS workflow_current_step_no,
      certification.status AS certification_status,
      certification.required_section_count AS certification_required_section_count,
      certification.completed_required_section_count AS certification_completed_required_section_count,
      certification.incomplete_required_section_count AS certification_incomplete_required_count,
      certification.progress_percentage AS certification_progress_percentage,
      certification.certified_by_user_id AS certified_by_user_id,
      certification.certified_at AS certified_at,
      (
        SELECT COUNT(*)
        FROM local_close_pack_reopen_requests lcrr
        WHERE lcrr.tenant_id = lcp.tenant_id
          AND lcrr.local_close_pack_id = lcp.id
          AND lcrr.request_status = 'REQUESTED'
      ) AS pending_reopen_request_count,
      (
        SELECT COUNT(*)
        FROM evidence_objects eo
        WHERE eo.tenant_id = lcp.tenant_id
          AND eo.legal_entity_id = lcp.legal_entity_id
          AND eo.source_ref_type = '${LOCAL_CLOSE_PACK}'
          AND eo.source_ref_id = lcp.id
          AND eo.status <> 'DELETED'
      ) AS evidence_count,
      (
        SELECT MAX(eo.updated_at)
        FROM evidence_objects eo
        WHERE eo.tenant_id = lcp.tenant_id
          AND eo.legal_entity_id = lcp.legal_entity_id
          AND eo.source_ref_type = '${LOCAL_CLOSE_PACK}'
          AND eo.source_ref_id = lcp.id
          AND eo.status <> 'DELETED'
      ) AS last_evidence_at,
      (
        SELECT COUNT(*)
        FROM internal_comments ic
        WHERE ic.tenant_id = lcp.tenant_id
          AND ic.legal_entity_id = lcp.legal_entity_id
          AND ic.source_ref_type = '${LOCAL_CLOSE_PACK}'
          AND ic.source_ref_id = lcp.id
          AND ic.status <> 'DELETED'
      ) AS comment_count,
      (
        SELECT MAX(ic.updated_at)
        FROM internal_comments ic
        WHERE ic.tenant_id = lcp.tenant_id
          AND ic.legal_entity_id = lcp.legal_entity_id
          AND ic.source_ref_type = '${LOCAL_CLOSE_PACK}'
          AND ic.source_ref_id = lcp.id
          AND ic.status <> 'DELETED'
      ) AS last_comment_at,
      (
        SELECT COUNT(*)
        FROM local_close_pack_report_reviews lcprr
        WHERE lcprr.tenant_id = lcp.tenant_id
          AND lcprr.local_close_pack_id = lcp.id
      ) AS report_review_count,
      (
        SELECT MAX(lcprr.reviewed_at)
        FROM local_close_pack_report_reviews lcprr
        WHERE lcprr.tenant_id = lcp.tenant_id
          AND lcprr.local_close_pack_id = lcp.id
      ) AS last_report_reviewed_at,
      (
        SELECT MAX(al.created_at)
        FROM audit_logs al
        WHERE al.tenant_id = lcp.tenant_id
          AND al.resource_type = 'local_close_pack'
          AND (
            CAST(al.resource_id AS UNSIGNED) = lcp.id
            OR CAST(JSON_UNQUOTE(JSON_EXTRACT(al.payload_json, '$.localClosePackId')) AS UNSIGNED) = lcp.id
          )
      ) AS last_audit_at
    FROM local_close_packs lcp
    JOIN legal_entities le ON le.id = lcp.legal_entity_id
    JOIN books b ON b.id = lcp.book_id
    JOIN fiscal_periods fp ON fp.id = lcp.fiscal_period_id
    LEFT JOIN operating_units ou ON ou.id = lcp.operating_unit_id
    LEFT JOIN users owner_user ON owner_user.id = lcp.owner_user_id
    LEFT JOIN users reviewer_user ON reviewer_user.id = lcp.reviewer_user_id
    LEFT JOIN users creator ON creator.id = lcp.created_by_user_id
    LEFT JOIN users updater ON updater.id = lcp.updated_by_user_id
    LEFT JOIN local_close_pack_certifications certification
      ON certification.tenant_id = lcp.tenant_id
     AND certification.local_close_pack_id = lcp.id
    LEFT JOIN users certifier ON certifier.id = certification.certified_by_user_id
    LEFT JOIN workflow_instances wi ON wi.id = lcp.workflow_instance_id
    WHERE ${whereSql}`;
}

function noopAssertScopeAccess() {
  return true;
}

async function normalizeLocalClosePackInput({
  req = null,
  input,
  assertScopeAccess = null,
  runQuery = query,
  enforceScopeAccess = true,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const userId = parsePositiveInt(input?.userId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  const closeScopeType = toUpperText(input?.closeScopeType);
  const status = toUpperText(input?.status);
  if (!LOCAL_CLOSE_PACK_SCOPE_TYPES.includes(closeScopeType)) {
    throw badRequest("closeScopeType is invalid for local close packs");
  }
  if (!LOCAL_CLOSE_PACK_STATUS_VALUES.includes(status)) {
    throw badRequest("status is invalid for local close packs");
  }

  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    input?.legalEntityId,
    "legalEntityId"
  );
  const book = await assertBookBelongsToTenant(tenantId, input?.bookId, "bookId");
  if (parsePositiveInt(book.legal_entity_id) !== parsePositiveInt(legalEntity.id)) {
    throw badRequest("bookId must belong to the selected legalEntityId");
  }
  await assertFiscalPeriodBelongsToCalendar(
    parsePositiveInt(book.calendar_id),
    input?.fiscalPeriodId,
    "fiscalPeriodId"
  );

  let operatingUnitId = null;
  if (closeScopeType === "OPERATING_UNIT") {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      input?.operatingUnitId,
      "operatingUnitId"
    );
    if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntity.id)) {
      throw badRequest("operatingUnitId must belong to the selected legalEntityId");
    }
    operatingUnitId = parsePositiveInt(operatingUnit.id);
  }

  const scopeRow = {
    close_scope_type: closeScopeType,
    operating_unit_id: operatingUnitId,
    legal_entity_id: parsePositiveInt(legalEntity.id),
  };
  if (enforceScopeAccess && typeof assertScopeAccess === "function") {
    assertLocalClosePackRowReadable(req, scopeRow, assertScopeAccess);
  }

  return {
    tenantId,
    userId,
    legalEntityId: parsePositiveInt(legalEntity.id),
    bookId: parsePositiveInt(book.id),
    fiscalPeriodId: parsePositiveInt(input?.fiscalPeriodId),
    closeScopeType,
    operatingUnitId,
    scopeKey: buildLocalClosePackScopeKey({
      closeScopeType,
      operatingUnitId,
    }),
    status,
    note: input?.note || null,
    cycleId: parsePositiveInt(input?.cycleId) || null,
  };
}

async function loadLocalClosePackIdByIdentity({
  tenantId,
  bookId,
  fiscalPeriodId,
  scopeKey,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM local_close_packs
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
       AND scope_key = ?
     LIMIT 1`,
    [tenantId, bookId, fiscalPeriodId, scopeKey]
  );
  return parsePositiveInt(result.rows?.[0]?.id) || null;
}

async function writeLocalClosePackSystemAuditLog({
  runQuery = query,
  tenantId,
  userId,
  legalEntityId,
  packId,
  action,
  payload,
}) {
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
     VALUES (?, ?, ?, 'local_close_pack', ?, 'LEGAL_ENTITY', ?, NULL, NULL, NULL, ?)`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(userId) || null,
      String(action || "close.cycle.provision.local_close_pack"),
      String(packId || ""),
      parsePositiveInt(legalEntityId) || null,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

/**
 * Resolve the RBAC scope for a local close-pack row.
 */
export async function resolveLocalClosePackScope(packId, tenantId, runQuery = query) {
  const normalizedPackId = parsePositiveInt(packId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedPackId || !normalizedTenantId) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, legal_entity_id, operating_unit_id, close_scope_type
     FROM local_close_packs
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [normalizedTenantId, normalizedPackId]
  );
  const row = result.rows?.[0] || null;
  const scope = resolveLocalClosePackRowScope(row);
  return scope
    ? {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      }
    : null;
}

/**
 * List local close-pack headers with row-level scope filtering.
 */
export async function listLocalClosePacks({
  req,
  tenantId,
  filters,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const where = ["lcp.tenant_id = ?"];
  const params = [normalizedTenantId];

  if (filters?.legalEntityId) {
    where.push("lcp.legal_entity_id = ?");
    params.push(parsePositiveInt(filters.legalEntityId));
  }
  if (filters?.bookId) {
    where.push("lcp.book_id = ?");
    params.push(parsePositiveInt(filters.bookId));
  }
  if (filters?.fiscalPeriodId) {
    where.push("lcp.fiscal_period_id = ?");
    params.push(parsePositiveInt(filters.fiscalPeriodId));
  }
  if (filters?.closeScopeType) {
    where.push("lcp.close_scope_type = ?");
    params.push(toUpperText(filters.closeScopeType));
  }
  if (filters?.operatingUnitId) {
    where.push("lcp.operating_unit_id = ?");
    params.push(parsePositiveInt(filters.operatingUnitId));
  }
  if (filters?.status) {
    where.push("lcp.status = ?");
    params.push(toUpperText(filters.status));
  }
  if (filters?.q) {
    where.push(
      `(le.code LIKE ? OR le.name LIKE ? OR b.code LIKE ? OR b.name LIKE ? OR ou.code LIKE ? OR ou.name LIKE ?)`
    );
    const wildcard = `%${filters.q}%`;
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
  }

  const result = await runQuery(
    `${buildLocalClosePackBaseSelect(where.join(" AND "))}
     ORDER BY lcp.fiscal_period_id DESC, lcp.book_id ASC, lcp.id DESC`,
    params
  );

  const scopedRows = (result.rows || []).filter((row) =>
    canReadLocalClosePackRow(req, row, assertScopeAccess)
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;

  return {
    rows: scopedRows
      .slice(safeOffset, safeOffset + safeLimit)
      .map(mapLocalClosePackRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Load one local close-pack header and enforce row-level scope access.
 */
export async function getLocalClosePackById({
  req,
  tenantId,
  packId,
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

  const result = await runQuery(
    `${buildLocalClosePackBaseSelect("lcp.tenant_id = ? AND lcp.id = ?")}
     LIMIT 1`,
    [normalizedTenantId, normalizedPackId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw notFound("Local close pack not found");
  }

  assertLocalClosePackRowReadable(req, row, assertScopeAccess);
  return mapLocalClosePackRow(row);
}

/**
 * Create the baseline local close-pack header and validate its scope contract.
 */
export async function createLocalClosePack({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  await normalizeLocalClosePackInput({
    req,
    input,
    assertScopeAccess,
    runQuery,
    enforceScopeAccess: true,
  });

  const work = async (effectiveRunQuery) => {
    const ensured = await ensureLocalClosePack(input, {
      runQuery: effectiveRunQuery,
    });
    if (!ensured.created) {
      throw conflict(
        "Local close pack already exists for the selected book, fiscal period, and scope"
      );
    }
    return ensured.row;
  };

  if (runQuery === query) {
    return withTransaction(async (tx) => work(tx.query));
  }
  return work(runQuery);
}

/**
 * Create or reuse the exact local close pack identified by
 * `(tenant_id, book_id, fiscal_period_id, scope_key)` without routing through
 * the public request-bound prepare contract.
 */
export async function ensureLocalClosePack(input, options = {}) {
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const normalized = await normalizeLocalClosePackInput({
    input,
    runQuery,
    enforceScopeAccess: false,
  });

  const insertResult = await runQuery(
    `INSERT INTO local_close_packs (
       tenant_id,
       legal_entity_id,
       book_id,
       fiscal_period_id,
       close_scope_type,
       scope_key,
       operating_unit_id,
       status,
       note,
       created_by_user_id,
       updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id)`,
    [
      normalized.tenantId,
      normalized.legalEntityId,
      normalized.bookId,
      normalized.fiscalPeriodId,
      normalized.closeScopeType,
      normalized.scopeKey,
      normalized.operatingUnitId,
      normalized.status,
      normalized.note,
      normalized.userId,
      normalized.userId,
    ]
  );

  const packId =
    parsePositiveInt(insertResult.rows?.insertId) ||
    (await loadLocalClosePackIdByIdentity({
      tenantId: normalized.tenantId,
      bookId: normalized.bookId,
      fiscalPeriodId: normalized.fiscalPeriodId,
      scopeKey: normalized.scopeKey,
      runQuery,
    }));
  if (!packId) {
    throw badRequest("Failed to resolve local close-pack identity");
  }
  const created = Number(insertResult.rows?.affectedRows || 0) === 1;

  // Provision retries must converge on the same pack without resetting any
  // live status or note that may already have progressed on the existing row.
  await autoLinkAndSyncSource("LOCAL_CLOSE_PACK", packId, {
    tenantId: normalized.tenantId,
    userId: normalized.userId,
    runQuery,
  });
  await writeLocalClosePackSystemAuditLog({
    runQuery,
    tenantId: normalized.tenantId,
    userId: normalized.userId,
    legalEntityId: normalized.legalEntityId,
    packId,
    action: created
      ? "close.cycle.provision.local_close_pack_create"
      : "close.cycle.provision.local_close_pack_reuse",
    payload: {
      cycleId: normalized.cycleId,
      bookId: normalized.bookId,
      fiscalPeriodId: normalized.fiscalPeriodId,
      scopeKey: normalized.scopeKey,
    },
  });

  return {
    created,
    row: await getLocalClosePackById({
      req: null,
      tenantId: normalized.tenantId,
      packId,
      assertScopeAccess: noopAssertScopeAccess,
      runQuery,
    }),
  };
}

export default {
  resolveLocalClosePackScope,
  listLocalClosePacks,
  getLocalClosePackById,
  createLocalClosePack,
  ensureLocalClosePack,
};
