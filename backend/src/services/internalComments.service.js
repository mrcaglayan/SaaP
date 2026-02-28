import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT";
const STATUS_ACTIVE = "ACTIVE";
const STATUS_DELETED = "DELETED";
const NOTIFICATION_STATUS_UNREAD = "UNREAD";
const NOTIFICATION_TYPE_INTERNAL_COMMENT_MENTION = "INTERNAL_COMMENT_MENTION";
const MENTION_EMAIL_REGEX =
  /(^|[\s(])@([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?=$|[\s),.;:!?])/gi;

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

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function extractMentionEmailsFromBody(value) {
  const body = String(value || "");
  const mentionEmails = new Set();
  MENTION_EMAIL_REGEX.lastIndex = 0;
  let match;
  while ((match = MENTION_EMAIL_REGEX.exec(body)) !== null) {
    const email = normalizeEmail(match[2]);
    if (email) {
      mentionEmails.add(email);
    }
  }
  return Array.from(mentionEmails);
}

function toPreviewText(value, maxLength = 280) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function buildMentionNotificationTitle(actorLabel) {
  const normalizedActor = String(actorLabel || "").trim();
  if (normalizedActor) {
    return `${normalizedActor} mentioned you in an internal comment`;
  }
  return "You were mentioned in an internal comment";
}

async function findTenantUserById({
  tenantId,
  userId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, email, name
     FROM users
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, userId]
  );
  return result.rows?.[0] || null;
}

async function findTenantUsersByEmails({
  tenantId,
  emails,
  runQuery = query,
}) {
  const normalizedEmails = Array.isArray(emails)
    ? Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)))
    : [];
  if (normalizedEmails.length === 0) {
    return [];
  }
  const placeholders = normalizedEmails.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id, email, name
     FROM users
     WHERE tenant_id = ?
       AND status = 'ACTIVE'
       AND LOWER(email) IN (${placeholders})`,
    [tenantId, ...normalizedEmails]
  );
  return result.rows || [];
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
  const mentionEmails = extractMentionEmailsFromBody(body);

  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  const row = await withTransaction(async (tx) => {
    const scope = await assertCariDocumentScope({
      req,
      tenantId,
      documentId,
      assertScopeAccess,
      runQuery: tx.query,
    });

    const insertResult = await tx.query(
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

    if (mentionEmails.length > 0) {
      const actorUser = await findTenantUserById({
        tenantId: scope.tenantId,
        userId,
        runQuery: tx.query,
      });
      const actorLabel =
        String(actorUser?.name || "").trim() ||
        String(actorUser?.email || "").trim() ||
        `User #${userId}`;
      const mentionedUsers = await findTenantUsersByEmails({
        tenantId: scope.tenantId,
        emails: mentionEmails,
        runQuery: tx.query,
      });
      const mentionedUserByEmail = new Map(
        mentionedUsers.map((row) => [normalizeEmail(row?.email), row])
      );
      const notificationTitle = buildMentionNotificationTitle(actorLabel);
      const previewText = toPreviewText(body, 320);
      const notificationBody = previewText ? `Comment: ${previewText}` : null;

      for (const email of mentionEmails) {
        const mentionedUser = mentionedUserByEmail.get(email);
        const mentionedUserId = parsePositiveInt(mentionedUser?.id);
        if (!mentionedUserId || mentionedUserId === userId) {
          continue;
        }

        const mentionToken = `@${email}`;
        await tx.query(
          `INSERT INTO internal_comment_mentions (
             tenant_id,
             internal_comment_id,
             mentioned_user_id,
             mention_token
           )
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             mention_token = VALUES(mention_token)`,
          [scope.tenantId, commentId, mentionedUserId, mentionToken]
        );

        const payload = {
          version: 1,
          internalCommentId: commentId,
          mentionToken,
          actorUserId: userId,
          actorUserName: actorUser?.name || null,
          actorUserEmail: actorUser?.email || null,
          sourceRefType: SOURCE_REF_TYPE_CARI_DOCUMENT,
          sourceRefId: scope.documentId,
        };

        await tx.query(
          `INSERT INTO in_app_notifications (
             tenant_id,
             user_id,
             notification_type,
             title,
             body,
             status,
             source_ref_type,
             source_ref_id,
             source_event_id,
             payload_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
          [
            scope.tenantId,
            mentionedUserId,
            NOTIFICATION_TYPE_INTERNAL_COMMENT_MENTION,
            notificationTitle,
            notificationBody,
            NOTIFICATION_STATUS_UNREAD,
            SOURCE_REF_TYPE_CARI_DOCUMENT,
            scope.documentId,
            commentId,
            JSON.stringify(payload),
          ]
        );
      }
    }

    const created = await findCariDocumentInternalCommentById({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      documentId: scope.documentId,
      commentId,
      runQuery: tx.query,
    });
    if (!created) {
      throw new Error("Internal comment record readback failed");
    }
    return created;
  });

  return mapInternalCommentRow(row);
}
