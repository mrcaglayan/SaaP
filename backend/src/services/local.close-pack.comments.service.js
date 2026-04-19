import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getLocalClosePackById } from "./local.close-packs.service.js";
import { LOCAL_CLOSE_PACK } from "../utils/source-ref-types.js";
import { refreshLocalClosePackCertification } from "./local.close-pack.certification.service.js";

const STATUS_ACTIVE = "ACTIVE";
const STATUS_DELETED = "DELETED";

function normalizeText(value, label, maxLength, { required = false } = {}) {
  const normalized = String(value ?? "").trim();
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

function mapInternalCommentRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    sourceRefType: String(row.source_ref_type || ""),
    sourceRefId: parsePositiveInt(row.source_ref_id),
    body: String(row.body || ""),
    status: String(row.status || "").trim().toUpperCase(),
    createdByUserId: parsePositiveInt(row.created_by_user_id) || null,
    createdByUserName: row.created_by_user_name ?? null,
    createdByUserEmail: row.created_by_user_email ?? null,
    updatedByUserId: parsePositiveInt(row.updated_by_user_id) || null,
    deletedByUserId: parsePositiveInt(row.deleted_by_user_id) || null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    deletedAt: row.deleted_at ?? null,
  };
}

async function assertLocalClosePackCommentScope({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  const row = await getLocalClosePackById({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });
  return {
    tenantId: parsePositiveInt(row?.tenantId),
    packId: parsePositiveInt(row?.id),
    legalEntityId: parsePositiveInt(row?.legalEntityId),
  };
}

async function findLocalClosePackCommentById({
  tenantId,
  legalEntityId,
  packId,
  commentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT c.*,
            u.name AS created_by_user_name,
            u.email AS created_by_user_email
     FROM internal_comments c
     LEFT JOIN users u
       ON u.tenant_id = c.tenant_id
      AND u.id = c.created_by_user_id
     WHERE c.tenant_id = ?
       AND c.legal_entity_id = ?
       AND c.source_ref_type = ?
       AND c.source_ref_id = ?
       AND c.id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, LOCAL_CLOSE_PACK, packId, commentId]
  );
  return result.rows?.[0] || null;
}

/**
 * List first-pass internal comments for one local close pack.
 */
export async function listLocalClosePackInternalCommentsForTenant({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  const scope = await assertLocalClosePackCommentScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });

  const result = await runQuery(
    `SELECT c.*,
            u.name AS created_by_user_name,
            u.email AS created_by_user_email
     FROM internal_comments c
     LEFT JOIN users u
       ON u.tenant_id = c.tenant_id
      AND u.id = c.created_by_user_id
     WHERE c.tenant_id = ?
       AND c.legal_entity_id = ?
       AND c.source_ref_type = ?
       AND c.source_ref_id = ?
       AND c.status <> ?
     ORDER BY c.created_at DESC, c.id DESC`,
    [scope.tenantId, scope.legalEntityId, LOCAL_CLOSE_PACK, scope.packId, STATUS_DELETED]
  );

  return (result.rows || []).map(mapInternalCommentRow);
}

/**
 * Create the first-pass internal comment row for one local close pack.
 */
export async function createLocalClosePackInternalComment({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const packId = parsePositiveInt(input?.packId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId);
  const body = normalizeText(input?.body, "body", 2000, { required: true });
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!packId) {
    throw badRequest("packId is required");
  }
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  const scope = await assertLocalClosePackCommentScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });

  const insertResult = await runQuery(
    `INSERT INTO internal_comments (
       tenant_id,
       legal_entity_id,
       source_ref_type,
       source_ref_id,
       body,
       status,
       created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      scope.tenantId,
      scope.legalEntityId,
      LOCAL_CLOSE_PACK,
      scope.packId,
      body,
      STATUS_ACTIVE,
      userId,
    ]
  );

  const commentId = parsePositiveInt(insertResult.rows?.insertId);
  if (!commentId) {
    throw new Error("Local close-pack comment record could not be created");
  }

  const created = await findLocalClosePackCommentById({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    packId: scope.packId,
    commentId,
    runQuery,
  });
  if (!created) {
    throw new Error("Local close-pack comment record readback failed");
  }

  await refreshLocalClosePackCertification({
    req,
    tenantId: scope.tenantId,
    packId: scope.packId,
    userId,
    assertScopeAccess,
    runQuery,
  });

  return mapInternalCommentRow(created);
}

export default {
  listLocalClosePackInternalCommentsForTenant,
  createLocalClosePackInternalComment,
};
