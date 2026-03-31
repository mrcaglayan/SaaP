import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getLocalClosePackById } from "./local.close-packs.service.js";
import {
  LOCAL_CLOSE_PACK_REPORT_LAUNCH_MODES,
  LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS,
} from "./local.close-packs.shared.js";

function toDateTime(value) {
  return value || null;
}

function normalizeText(value, label, maxLength, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (required) {
      throw badRequest(`${label} is required`);
    }
    return null;
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${label} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function normalizeEnum(value, label, allowedValues) {
  const normalized = String(value || "")
    .trim();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${label} must be one of ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function normalizeObjectPayload(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`);
  }
  return value;
}

function stableSortValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }
  if (value && typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = stableSortValue(value[key]);
    }
    return normalized;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSortValue(value));
}

function mapLocalClosePackReportReviewRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    localClosePackId: parsePositiveInt(row.local_close_pack_id),
    reportKey: String(row.report_key || ""),
    routePath: row.route_path || null,
    launchMode: String(row.launch_mode || ""),
    query: parseJsonPayload(row.query_json) || {},
    responseSnapshot: parseJsonPayload(row.response_snapshot_json) || {},
    fingerprintSha256: row.fingerprint_sha256 || null,
    reviewNote: row.review_note || null,
    reviewedByUserId: parsePositiveInt(row.reviewed_by_user_id),
    reviewedByUserName: row.reviewed_by_user_name || null,
    reviewedAt: toDateTime(row.reviewed_at),
    createdAt: toDateTime(row.created_at),
    updatedAt: toDateTime(row.updated_at),
  };
}

function parseJsonPayload(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function mapAuditRow(row, includePayload) {
  return {
    auditLogId: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    action: row.action || null,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id || null,
    scopeType: row.scope_type || null,
    scopeId: parsePositiveInt(row.scope_id),
    actorUserId: parsePositiveInt(row.user_id),
    actorEmail: row.actor_email || null,
    actorName: row.actor_name || null,
    requestId: row.request_id || null,
    ipAddress: row.ip_address || null,
    userAgent: row.user_agent || null,
    createdAt: row.created_at || null,
    ...(includePayload ? { payload: parseJsonPayload(row.payload_json) } : {}),
  };
}

async function assertLocalClosePackReadable({
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

function buildFingerprintBasis({
  reportKey,
  routePath,
  launchMode,
  queryPayload,
  responseSnapshot,
}) {
  return {
    reportKey,
    routePath,
    launchMode,
    query: stableSortValue(queryPayload),
    responseSnapshot: stableSortValue(responseSnapshot),
  };
}

/**
 * List first-pass report review fingerprints captured for one local close pack.
 */
export async function listLocalClosePackReportReviews({
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

  await assertLocalClosePackReadable({
    req,
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    assertScopeAccess,
    runQuery,
  });

  const result = await runQuery(
    `SELECT
       reviews.*,
       users.name AS reviewed_by_user_name
     FROM local_close_pack_report_reviews reviews
     LEFT JOIN users
       ON users.tenant_id = reviews.tenant_id
      AND users.id = reviews.reviewed_by_user_id
     WHERE reviews.tenant_id = ?
       AND reviews.local_close_pack_id = ?
     ORDER BY reviews.report_key ASC`,
    [normalizedTenantId, normalizedPackId]
  );

  return (result.rows || []).map(mapLocalClosePackReportReviewRow);
}

/**
 * Upsert the current reviewed-report fingerprint for one local close pack.
 */
export async function upsertLocalClosePackReportReview({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const packId = parsePositiveInt(input?.packId);
  const userId = parsePositiveInt(input?.userId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!packId) {
    throw badRequest("packId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  const reportKey = normalizeEnum(
    input?.reportKey,
    "reportKey",
    LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS
  );
  const routePath = normalizeText(input?.routePath, "routePath", 255, {
    required: true,
  });
  const launchMode = normalizeEnum(
    input?.launchMode,
    "launchMode",
    LOCAL_CLOSE_PACK_REPORT_LAUNCH_MODES
  );
  const reviewNote = normalizeText(input?.reviewNote, "reviewNote", 500);
  const queryPayload = normalizeObjectPayload(input?.query, "query");
  const responseSnapshot = normalizeObjectPayload(
    input?.responseSnapshot,
    "responseSnapshot"
  );

  const fingerprintBasis = buildFingerprintBasis({
    reportKey,
    routePath,
    launchMode,
    queryPayload,
    responseSnapshot,
  });
  const fingerprintSha256 = crypto
    .createHash("sha256")
    .update(stableStringify(fingerprintBasis))
    .digest("hex");

  return withTransaction(async (tx) => {
    await assertLocalClosePackReadable({
      req,
      tenantId,
      packId,
      assertScopeAccess,
      runQuery: tx.query,
    });

    await tx.query(
      `INSERT INTO local_close_pack_report_reviews (
         tenant_id,
         local_close_pack_id,
         report_key,
         route_path,
         launch_mode,
         query_json,
         response_snapshot_json,
         fingerprint_sha256,
         review_note,
         reviewed_by_user_id,
         reviewed_at
       )
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         route_path = VALUES(route_path),
         launch_mode = VALUES(launch_mode),
         query_json = VALUES(query_json),
         response_snapshot_json = VALUES(response_snapshot_json),
         fingerprint_sha256 = VALUES(fingerprint_sha256),
         review_note = VALUES(review_note),
         reviewed_by_user_id = VALUES(reviewed_by_user_id),
         reviewed_at = CURRENT_TIMESTAMP`,
      [
        tenantId,
        packId,
        reportKey,
        routePath,
        launchMode,
        stableStringify(queryPayload),
        stableStringify(responseSnapshot),
        fingerprintSha256,
        reviewNote || null,
        userId,
      ]
    );

    const result = await tx.query(
      `SELECT
         reviews.*,
         users.name AS reviewed_by_user_name
       FROM local_close_pack_report_reviews reviews
       LEFT JOIN users
         ON users.tenant_id = reviews.tenant_id
        AND users.id = reviews.reviewed_by_user_id
       WHERE reviews.tenant_id = ?
         AND reviews.local_close_pack_id = ?
         AND reviews.report_key = ?
       LIMIT 1`,
      [tenantId, packId, reportKey]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      throw new Error("Local close-pack report review readback failed");
    }
    return mapLocalClosePackReportReviewRow(row);
  });
}

/**
 * Read the first-pass local close-pack audit history from audit_logs.
 */
export async function listLocalClosePackAuditTrail({
  req,
  tenantId,
  packId,
  limit = 50,
  offset = 0,
  includePayload = false,
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

  await assertLocalClosePackReadable({
    req,
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    assertScopeAccess,
    runQuery,
  });

  const params = [
    normalizedTenantId,
    normalizedPackId,
    normalizedPackId,
  ];
  const whereSql = `al.tenant_id = ?
    AND al.resource_type = 'local_close_pack'
    AND (
      CAST(al.resource_id AS UNSIGNED) = ?
      OR CAST(JSON_UNQUOTE(JSON_EXTRACT(al.payload_json, '$.localClosePackId')) AS UNSIGNED) = ?
    )`;

  const [countResult, rowsResult] = await Promise.all([
    runQuery(
      `SELECT COUNT(*) AS total
       FROM audit_logs al
       WHERE ${whereSql}`,
      params
    ),
    runQuery(
      `SELECT
         al.*,
         users.email AS actor_email,
         users.name AS actor_name
       FROM audit_logs al
       LEFT JOIN users
         ON users.tenant_id = al.tenant_id
        AND users.id = al.user_id
       WHERE ${whereSql}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ${Math.max(1, Number(limit || 50) || 50)}
       OFFSET ${Math.max(0, Number(offset || 0) || 0)}`,
      params
    ),
  ]);

  return {
    total: Number(countResult.rows?.[0]?.total || 0),
    limit: Math.max(1, Number(limit || 50) || 50),
    offset: Math.max(0, Number(offset || 0) || 0),
    rows: (rowsResult.rows || []).map((row) =>
      mapAuditRow(row, Boolean(includePayload))
    ),
  };
}

export default {
  listLocalClosePackReportReviews,
  upsertLocalClosePackReportReview,
  listLocalClosePackAuditTrail,
};
