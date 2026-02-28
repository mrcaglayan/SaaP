import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT";
const ALLOWED_OPS_STATUSES = new Set(["OK", "AT_RISK", "BLOCKED"]);

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

function normalizeOpsStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_OPS_STATUSES.has(normalized)) {
    throw badRequest("opsStatus must be one of OK, AT_RISK, BLOCKED");
  }
  return normalized;
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

function mapOpsStatusRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    sourceRefType: String(row.source_ref_type || ""),
    sourceRefId: parsePositiveInt(row.source_ref_id),
    opsStatus: String(row.ops_status || "").toUpperCase(),
    blockedReason: row.blocked_reason ?? null,
    note: row.note ?? null,
    updatedByUserId: parsePositiveInt(row.updated_by_user_id) || null,
    updatedByUserName: row.updated_by_user_name ?? null,
    updatedByUserEmail: row.updated_by_user_email ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function findOpsStatusByScope({
  tenantId,
  legalEntityId,
  sourceRefType,
  sourceRefId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT os.*,
            u.name AS updated_by_user_name,
            u.email AS updated_by_user_email
     FROM ops_status_notes os
     LEFT JOIN users u
       ON u.tenant_id = os.tenant_id
      AND u.id = os.updated_by_user_id
     WHERE os.tenant_id = ?
       AND os.legal_entity_id = ?
       AND os.source_ref_type = ?
       AND os.source_ref_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, sourceRefType, sourceRefId]
  );
  return result.rows?.[0] || null;
}

export async function getCariDocumentOpsStatusForTenant({
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

  const row = await findOpsStatusByScope({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType: SOURCE_REF_TYPE_CARI_DOCUMENT,
    sourceRefId: scope.documentId,
  });

  if (!row) {
    return {
      id: null,
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      sourceRefType: SOURCE_REF_TYPE_CARI_DOCUMENT,
      sourceRefId: scope.documentId,
      opsStatus: "OK",
      blockedReason: null,
      note: null,
      updatedByUserId: null,
      updatedByUserName: null,
      updatedByUserEmail: null,
      createdAt: null,
      updatedAt: null,
      isDefault: true,
    };
  }

  return {
    ...mapOpsStatusRow(row),
    isDefault: false,
  };
}

export async function upsertCariDocumentOpsStatus({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const documentId = parsePositiveInt(input?.documentId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;
  const opsStatus = normalizeOpsStatus(input?.opsStatus);
  const blockedReason = normalizeText(input?.blockedReason, "blockedReason", 500);
  const note = normalizeText(input?.note, "note", 1000);

  if (opsStatus === "BLOCKED" && !blockedReason) {
    throw badRequest("blockedReason is required when opsStatus=BLOCKED");
  }

  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
  });

  await query(
    `INSERT INTO ops_status_notes (
       tenant_id,
       legal_entity_id,
       source_ref_type,
       source_ref_id,
       ops_status,
       blocked_reason,
       note,
       updated_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ops_status = VALUES(ops_status),
       blocked_reason = VALUES(blocked_reason),
       note = VALUES(note),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      scope.tenantId,
      scope.legalEntityId,
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      scope.documentId,
      opsStatus,
      blockedReason,
      note,
      userId,
    ]
  );

  const row = await findOpsStatusByScope({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType: SOURCE_REF_TYPE_CARI_DOCUMENT,
    sourceRefId: scope.documentId,
  });
  if (!row) {
    throw new Error("Ops status note readback failed");
  }
  return mapOpsStatusRow(row);
}
