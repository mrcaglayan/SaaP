import { query } from "../db.js";

const STATUS_UNREAD = "UNREAD";
const STATUS_READ = "READ";
const STATUS_ALL = "ALL";
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

function createBadRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStatusFilter(input) {
  const normalized = String(input || STATUS_UNREAD)
    .trim()
    .toUpperCase();
  if (
    normalized !== STATUS_UNREAD &&
    normalized !== STATUS_READ &&
    normalized !== STATUS_ALL
  ) {
    throw createBadRequest("status must be UNREAD, READ, or ALL");
  }
  return normalized;
}

function normalizeSourceRefType(input) {
  const normalized = String(input || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }
  if (!/^[A-Z0-9][A-Z0-9._:-]{1,59}$/.test(normalized)) {
    throw createBadRequest("sourceRefType is invalid");
  }
  return normalized;
}

function resolveLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function resolveOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function parseJsonValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function mapNotificationRow(row) {
  return {
    id: toPositiveInt(row?.id),
    userId: toPositiveInt(row?.user_id),
    notificationType: String(row?.notification_type || ""),
    title: String(row?.title || ""),
    body: row?.body ?? null,
    status: String(row?.status || "").toUpperCase(),
    sourceRefType: row?.source_ref_type || null,
    sourceRefId: toPositiveInt(row?.source_ref_id),
    sourceEventId: toPositiveInt(row?.source_event_id),
    payload: parseJsonValue(row?.payload_json),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    readAt: row?.read_at || null,
  };
}

export async function listUserInAppNotifications({
  tenantId,
  userId,
  status,
  sourceRefType,
  sourceRefId,
  limit,
  offset,
}) {
  const normalizedTenantId = toPositiveInt(tenantId);
  const normalizedUserId = toPositiveInt(userId);
  if (!normalizedTenantId || !normalizedUserId) {
    throw createBadRequest("tenantId and userId are required");
  }

  const normalizedStatus = normalizeStatusFilter(status);
  const normalizedSourceRefType = normalizeSourceRefType(sourceRefType);
  const normalizedSourceRefId = sourceRefId === undefined ? null : toPositiveInt(sourceRefId);
  if (sourceRefId !== undefined && sourceRefId !== null && !normalizedSourceRefId) {
    throw createBadRequest("sourceRefId must be a positive integer");
  }

  const normalizedLimit = resolveLimit(limit);
  const normalizedOffset = resolveOffset(offset);

  const params = [normalizedTenantId, normalizedUserId];
  const whereClauses = ["tenant_id = ?", "user_id = ?"];

  if (normalizedStatus !== STATUS_ALL) {
    whereClauses.push("status = ?");
    params.push(normalizedStatus);
  }
  if (normalizedSourceRefType) {
    whereClauses.push("source_ref_type = ?");
    params.push(normalizedSourceRefType);
  }
  if (normalizedSourceRefId) {
    whereClauses.push("source_ref_id = ?");
    params.push(normalizedSourceRefId);
  }

  const whereSql = whereClauses.join(" AND ");

  try {
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM in_app_notifications
       WHERE ${whereSql}`,
      params
    );
    const total = Number(countResult.rows?.[0]?.total || 0);

    const listResult = await query(
      `SELECT
         id,
         user_id,
         notification_type,
         title,
         body,
         status,
         source_ref_type,
         source_ref_id,
         source_event_id,
         payload_json,
         created_at,
         updated_at,
         read_at
       FROM in_app_notifications
       WHERE ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ${normalizedLimit}
       OFFSET ${normalizedOffset}`,
      params
    );

    return {
      rows: (listResult.rows || []).map(mapNotificationRow),
      total,
      limit: normalizedLimit,
      offset: normalizedOffset,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        rows: [],
        total: 0,
        limit: normalizedLimit,
        offset: normalizedOffset,
      };
    }
    throw err;
  }
}

export async function markUserInAppNotificationReadById({
  tenantId,
  userId,
  notificationId,
}) {
  const normalizedTenantId = toPositiveInt(tenantId);
  const normalizedUserId = toPositiveInt(userId);
  const normalizedNotificationId = toPositiveInt(notificationId);
  if (!normalizedTenantId || !normalizedUserId || !normalizedNotificationId) {
    throw createBadRequest("tenantId, userId, and notificationId are required");
  }

  try {
    await query(
      `UPDATE in_app_notifications
       SET status = ?,
           read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE tenant_id = ?
         AND user_id = ?
         AND id = ?`,
      [STATUS_READ, normalizedTenantId, normalizedUserId, normalizedNotificationId]
    );

    const rowResult = await query(
      `SELECT
         id,
         user_id,
         notification_type,
         title,
         body,
         status,
         source_ref_type,
         source_ref_id,
         source_event_id,
         payload_json,
         created_at,
         updated_at,
         read_at
       FROM in_app_notifications
       WHERE tenant_id = ?
         AND user_id = ?
         AND id = ?
       LIMIT 1`,
      [normalizedTenantId, normalizedUserId, normalizedNotificationId]
    );
    const row = rowResult.rows?.[0];
    return row ? mapNotificationRow(row) : null;
  } catch (err) {
    if (isMissingTableError(err)) {
      throw createBadRequest("Notifications table is not available. Run migrations first.");
    }
    throw err;
  }
}

export async function markAllUserInAppNotificationsRead({
  tenantId,
  userId,
}) {
  const normalizedTenantId = toPositiveInt(tenantId);
  const normalizedUserId = toPositiveInt(userId);
  if (!normalizedTenantId || !normalizedUserId) {
    throw createBadRequest("tenantId and userId are required");
  }

  try {
    const result = await query(
      `UPDATE in_app_notifications
       SET status = ?,
           read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE tenant_id = ?
         AND user_id = ?
         AND status = ?`,
      [STATUS_READ, normalizedTenantId, normalizedUserId, STATUS_UNREAD]
    );
    return Number(result?.rows?.affectedRows || 0);
  } catch (err) {
    if (isMissingTableError(err)) {
      throw createBadRequest("Notifications table is not available. Run migrations first.");
    }
    throw err;
  }
}
