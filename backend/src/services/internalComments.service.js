import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT";
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

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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
    status: normalizeStatus(row.status),
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

async function findCariDocumentRow({ tenantId, documentId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, legal_entity_id
     FROM cari_documents
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, documentId]
  );
  return result.rows?.[0] || null;
}

async function assertCariDocumentScope({
  req,
  tenantId,
  documentId,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenant = parsePositiveInt(tenantId);
  const document = parsePositiveInt(documentId);
  if (!tenant) {
    throw badRequest("tenantId is required");
  }
  if (!document) {
    throw badRequest("documentId is required");
  }

  const row = await findCariDocumentRow({
    tenantId: tenant,
    documentId: document,
    runQuery,
  });
  if (!row) {
    throw badRequest("Cari document not found");
  }

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  if (!legalEntityId) {
    throw badRequest("Cari document scope is invalid");
  }

  if (typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "documentId");
  }

  return {
    tenantId: tenant,
    documentId: document,
    legalEntityId,
  };
}

async function findCariDocumentInternalCommentById({
  tenantId,
  legalEntityId,
  documentId,
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
    [
      tenantId,
      legalEntityId,
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      documentId,
      commentId,
    ]
  );
  return result.rows?.[0] || null;
}

export async function listCariDocumentInternalCommentsForTenant({
  req,
  tenantId,
  documentId,
  assertScopeAccess,
}) {
  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
  });

  const result = await query(
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
    [
      scope.tenantId,
      scope.legalEntityId,
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      scope.documentId,
      STATUS_DELETED,
    ]
  );

  return (result.rows || []).map(mapInternalCommentRow);
}

export async function createCariDocumentInternalComment({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const documentId = parsePositiveInt(input?.documentId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId);
  const body = normalizeText(input?.body, "body", 2000, { required: true });

  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
  });

  const insertResult = await query(
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
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      scope.documentId,
      body,
      STATUS_ACTIVE,
      userId,
    ]
  );

  const commentId = parsePositiveInt(insertResult.rows?.insertId);
  if (!commentId) {
    throw new Error("Internal comment record could not be created");
  }

  const row = await findCariDocumentInternalCommentById({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    documentId: scope.documentId,
    commentId,
  });
  if (!row) {
    throw new Error("Internal comment record readback failed");
  }

  return mapInternalCommentRow(row);
}
