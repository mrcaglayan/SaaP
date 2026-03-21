import crypto from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildEvidenceStoragePath,
  deleteEvidenceBinary,
  readEvidenceBinary,
  writeEvidenceBinary,
} from "./evidence.storage.adapter.js";

const SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT";
const SOURCE_REF_TYPE_INVENTORY_TRANSFER = "INVENTORY_TRANSFER";
const SOURCE_REF_TYPE_FIXED_ASSET = "FIXED_ASSET";
const SOURCE_REF_TYPE_FIXED_ASSET_TRANSACTION = "FIXED_ASSET_TRANSACTION";
const SOURCE_REF_TYPE_FIXED_ASSET_DEPRECIATION_RUN = "FIXED_ASSET_DEPRECIATION_RUN";
const STATUS_PENDING_UPLOAD = "PENDING_UPLOAD";
const STATUS_ACTIVE = "ACTIVE";
const STATUS_DELETED = "DELETED";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const COMPRESSION_CODEC_NONE = "NONE";
const COMPRESSION_CODEC_GZIP = "GZIP";

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

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

function normalizeFileName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, " ");
  if (!normalized) {
    throw badRequest("fileName is required");
  }
  if (normalized.length > 255) {
    throw badRequest("fileName cannot exceed 255 characters");
  }
  return normalized;
}

function normalizeFileExtension(fileName) {
  const dotIndex = String(fileName || "").lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return null;
  }
  const raw = String(fileName).slice(dotIndex + 1).trim().toLowerCase();
  if (!raw) {
    return null;
  }
  return raw.replace(/[^a-z0-9_-]/g, "").slice(0, 16) || null;
}

function normalizeContentType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return DEFAULT_CONTENT_TYPE;
  }
  if (normalized.length > 120) {
    throw badRequest("contentType cannot exceed 120 characters");
  }
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalized)) {
    throw badRequest("contentType is invalid");
  }
  return normalized;
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeCompressionCodec(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === COMPRESSION_CODEC_GZIP) {
    return COMPRESSION_CODEC_GZIP;
  }
  return COMPRESSION_CODEC_NONE;
}

function resolveCompressionMode() {
  const normalized = String(
    process.env.EVIDENCE_STORAGE_COMPRESSION || "AUTO"
  )
    .trim()
    .toUpperCase();
  if (normalized === "NONE" || normalized === "GZIP" || normalized === "AUTO") {
    return normalized;
  }
  return "AUTO";
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function buildStoredEvidencePayload(binaryData) {
  const mode = resolveCompressionMode();
  if (mode === "NONE") {
    return {
      storedData: binaryData,
      compressionCodec: COMPRESSION_CODEC_NONE,
    };
  }

  const gzData = await gzip(binaryData);
  if (mode === "GZIP") {
    return {
      storedData: gzData,
      compressionCodec: COMPRESSION_CODEC_GZIP,
    };
  }

  // AUTO mode: keep gzip only when it actually saves disk space.
  if (gzData.length < binaryData.length) {
    return {
      storedData: gzData,
      compressionCodec: COMPRESSION_CODEC_GZIP,
    };
  }
  return {
    storedData: binaryData,
    compressionCodec: COMPRESSION_CODEC_NONE,
  };
}

function mapEvidenceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    sourceRefType: String(row.source_ref_type || ""),
    sourceRefId: parsePositiveInt(row.source_ref_id),
    status: normalizeStatus(row.status),
    displayName: row.display_name ?? null,
    note: row.note ?? null,
    fileName: row.file_name ?? null,
    fileExtension: row.file_extension ?? null,
    contentType: row.content_type ?? null,
    compressionCodec: normalizeCompressionCodec(row.compression_codec),
    fileSizeBytes: toNumberOrNull(row.file_size_bytes),
    storedSizeBytes: toNumberOrNull(row.stored_size_bytes),
    fileSha256: row.file_sha256 ?? null,
    storageDriver: row.storage_driver ?? null,
    storagePath: row.storage_path ?? null,
    uploadedAt: row.uploaded_at ?? null,
    createdByUserId: parsePositiveInt(row.created_by_user_id) || null,
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

async function findInventoryTransferRow({ tenantId, transferId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, legal_entity_id
       FROM inventory_transfers
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, transferId]
  );
  return result.rows?.[0] || null;
}

async function assertInventoryTransferScope({
  req,
  tenantId,
  transferId,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenant = parsePositiveInt(tenantId);
  const transfer = parsePositiveInt(transferId);
  if (!tenant) {
    throw badRequest("tenantId is required");
  }
  if (!transfer) {
    throw badRequest("transferId is required");
  }

  const row = await findInventoryTransferRow({
    tenantId: tenant,
    transferId: transfer,
    runQuery,
  });
  if (!row) {
    throw badRequest("Inventory transfer not found");
  }

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  if (!legalEntityId) {
    throw badRequest("Inventory transfer scope is invalid");
  }

  if (typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "transferId");
  }

  return {
    tenantId: tenant,
    transferId: transfer,
    legalEntityId,
  };
}

async function findCariDocumentEvidenceRow({
  tenantId,
  legalEntityId,
  documentId,
  evidenceId,
  runQuery = query,
  forUpdate = false,
}) {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT *
     FROM evidence_objects
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND source_ref_type = ?
       AND source_ref_id = ?
       AND id = ?
     LIMIT 1${suffix}`,
    [tenantId, legalEntityId, SOURCE_REF_TYPE_CARI_DOCUMENT, documentId, evidenceId]
  );
  return result.rows?.[0] || null;
}

async function loadCariDocumentEvidenceRow({
  req,
  tenantId,
  documentId,
  evidenceId,
  assertScopeAccess,
  runQuery = query,
  forUpdate = false,
}) {
  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
    runQuery,
  });
  const row = await findCariDocumentEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    documentId: scope.documentId,
    evidenceId: parsePositiveInt(evidenceId),
    runQuery,
    forUpdate,
  });
  return {
    scope,
    row,
  };
}

async function findInventoryTransferEvidenceRow({
  tenantId,
  legalEntityId,
  transferId,
  evidenceId,
  runQuery = query,
  forUpdate = false,
}) {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT *
       FROM evidence_objects
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND source_ref_type = ?
        AND source_ref_id = ?
        AND id = ?
      LIMIT 1${suffix}`,
    [tenantId, legalEntityId, SOURCE_REF_TYPE_INVENTORY_TRANSFER, transferId, evidenceId]
  );
  return result.rows?.[0] || null;
}

async function loadInventoryTransferEvidenceRow({
  req,
  tenantId,
  transferId,
  evidenceId,
  assertScopeAccess,
  runQuery = query,
  forUpdate = false,
}) {
  const scope = await assertInventoryTransferScope({
    req,
    tenantId,
    transferId,
    assertScopeAccess,
    runQuery,
  });
  const row = await findInventoryTransferEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    transferId: scope.transferId,
    evidenceId: parsePositiveInt(evidenceId),
    runQuery,
    forUpdate,
  });
  return {
    scope,
    row,
  };
}

export async function createCariDocumentEvidenceDraft({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const documentId = parsePositiveInt(input?.documentId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;
  const fileName = normalizeFileName(input?.fileName);
  const fileExtension = normalizeFileExtension(fileName);
  const contentType = normalizeContentType(input?.contentType);
  const displayName = normalizeText(input?.displayName, "displayName", 190);
  const note = normalizeText(input?.note, "note", 500);

  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
  });

  const insertResult = await query(
    `INSERT INTO evidence_objects (
       tenant_id,
       legal_entity_id,
       source_ref_type,
       source_ref_id,
       status,
       display_name,
       note,
       file_name,
       file_extension,
       content_type,
       created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scope.tenantId,
      scope.legalEntityId,
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      scope.documentId,
      STATUS_PENDING_UPLOAD,
      displayName,
      note,
      fileName,
      fileExtension,
      contentType,
      userId,
    ]
  );

  const evidenceId = parsePositiveInt(insertResult.rows?.insertId);
  if (!evidenceId) {
    throw new Error("Evidence record could not be created");
  }

  const created = await findCariDocumentEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    documentId: scope.documentId,
    evidenceId,
  });
  if (!created) {
    throw new Error("Evidence record readback failed");
  }
  return mapEvidenceRow(created);
}

export async function listCariDocumentEvidenceForTenant({
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
    `SELECT *
     FROM evidence_objects
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND source_ref_type = ?
       AND source_ref_id = ?
       AND status <> ?
     ORDER BY created_at DESC, id DESC`,
    [
      scope.tenantId,
      scope.legalEntityId,
      SOURCE_REF_TYPE_CARI_DOCUMENT,
      scope.documentId,
      STATUS_DELETED,
    ]
  );
  return (result.rows || []).map(mapEvidenceRow);
}

export async function getCariDocumentEvidenceByIdForTenant({
  req,
  tenantId,
  documentId,
  evidenceId,
  assertScopeAccess,
}) {
  const { row } = await loadCariDocumentEvidenceRow({
    req,
    tenantId,
    documentId,
    evidenceId,
    assertScopeAccess,
  });
  if (!row || normalizeStatus(row.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }
  return mapEvidenceRow(row);
}

export async function uploadCariDocumentEvidenceContent({
  req,
  input,
  binaryData,
  assertScopeAccess,
}) {
  if (!(binaryData instanceof Buffer)) {
    throw badRequest("Evidence upload payload must be binary");
  }
  if (binaryData.length <= 0) {
    throw badRequest("Evidence upload payload is empty");
  }

  const tenantId = parsePositiveInt(input?.tenantId);
  const documentId = parsePositiveInt(input?.documentId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const overrideContentType = normalizeText(input?.contentType, "contentType", 120);
  const fileSha256 = crypto.createHash("sha256").update(binaryData).digest("hex");
  const fileSizeBytes = binaryData.length;
  const storedPayload = await buildStoredEvidencePayload(binaryData);
  const storedSizeBytes = storedPayload.storedData.length;
  const compressionCodec = storedPayload.compressionCodec;

  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
  });
  const existing = await findCariDocumentEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    documentId: scope.documentId,
    evidenceId,
  });
  if (!existing || normalizeStatus(existing.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }

  const fileExtension =
    normalizeText(existing.file_extension, "fileExtension", 16) ||
    normalizeFileExtension(existing.file_name);
  const storagePath = buildEvidenceStoragePath({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType: SOURCE_REF_TYPE_CARI_DOCUMENT,
    sourceRefId: scope.documentId,
    evidenceId,
    fileExtension,
  });
  const finalStoragePath =
    compressionCodec === COMPRESSION_CODEC_GZIP ? `${storagePath}.gz` : storagePath;

  await writeEvidenceBinary({
    storagePath: finalStoragePath,
    data: storedPayload.storedData,
  });

  let previousStoragePath = null;
  let updatedRow = null;

  try {
    updatedRow = await withTransaction(async (tx) => {
      const locked = await findCariDocumentEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        documentId: scope.documentId,
        evidenceId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked || normalizeStatus(locked.status) === STATUS_DELETED) {
        throw badRequest("Evidence object not found");
      }
      previousStoragePath = locked.storage_path || null;

      const nextContentType = normalizeContentType(
        overrideContentType || locked.content_type || DEFAULT_CONTENT_TYPE
      );

      await tx.query(
        `UPDATE evidence_objects
         SET status = ?,
             content_type = ?,
             compression_codec = ?,
             file_size_bytes = ?,
             stored_size_bytes = ?,
             file_sha256 = ?,
             storage_driver = 'LOCAL_FS',
             storage_path = ?,
             uploaded_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?`,
        [
          STATUS_ACTIVE,
          nextContentType,
          compressionCodec,
          fileSizeBytes,
          storedSizeBytes,
          fileSha256,
          finalStoragePath,
          scope.tenantId,
          scope.legalEntityId,
          evidenceId,
        ]
      );

      const fresh = await findCariDocumentEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        documentId: scope.documentId,
        evidenceId,
        runQuery: tx.query,
      });
      if (!fresh) {
        throw new Error("Evidence update readback failed");
      }
      return fresh;
    });
  } catch (err) {
    await deleteEvidenceBinary({ storagePath: finalStoragePath }).catch(() => {});
    throw err;
  }

  if (previousStoragePath && previousStoragePath !== storagePath) {
    await deleteEvidenceBinary({ storagePath: previousStoragePath }).catch(() => {});
  }

  return mapEvidenceRow(updatedRow);
}

export async function getCariDocumentEvidenceContentForTenant({
  req,
  tenantId,
  documentId,
  evidenceId,
  assertScopeAccess,
}) {
  const { row } = await loadCariDocumentEvidenceRow({
    req,
    tenantId,
    documentId,
    evidenceId,
    assertScopeAccess,
  });
  if (!row || normalizeStatus(row.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }
  if (normalizeStatus(row.status) !== STATUS_ACTIVE || !row.storage_path) {
    throw badRequest("Evidence content is not uploaded yet");
  }

  let data;
  try {
    const readResult = await readEvidenceBinary({ storagePath: row.storage_path });
    data = readResult.data;
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw badRequest("Evidence content file is missing");
    }
    throw err;
  }

  const compressionCodec = normalizeCompressionCodec(row.compression_codec);
  if (compressionCodec === COMPRESSION_CODEC_GZIP) {
    try {
      data = await gunzip(data);
    } catch {
      throw badRequest("Evidence content could not be decompressed");
    }
  }

  const expectedSha = String(row.file_sha256 || "").trim().toLowerCase();
  if (expectedSha) {
    const actualSha = crypto.createHash("sha256").update(data).digest("hex");
    if (actualSha !== expectedSha) {
      throw badRequest("Evidence content integrity check failed");
    }
  }

  return {
    row: mapEvidenceRow(row),
    data,
  };
}

export async function deleteCariDocumentEvidenceByIdForTenant({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const documentId = parsePositiveInt(input?.documentId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;

  const scope = await assertCariDocumentScope({
    req,
    tenantId,
    documentId,
    assertScopeAccess,
  });

  let storagePathToDelete = null;
  const nextRow = await withTransaction(async (tx) => {
    const current = await findCariDocumentEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      documentId: scope.documentId,
      evidenceId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw badRequest("Evidence object not found");
    }
    storagePathToDelete = current.storage_path || null;
    if (normalizeStatus(current.status) !== STATUS_DELETED) {
      await tx.query(
        `UPDATE evidence_objects
         SET status = ?,
             deleted_at = CURRENT_TIMESTAMP,
             deleted_by_user_id = ?
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?`,
        [STATUS_DELETED, userId, scope.tenantId, scope.legalEntityId, evidenceId]
      );
    }
    return findCariDocumentEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      documentId: scope.documentId,
      evidenceId,
      runQuery: tx.query,
    });
  });

  if (storagePathToDelete) {
    await deleteEvidenceBinary({ storagePath: storagePathToDelete }).catch(() => {});
  }

  return mapEvidenceRow(nextRow);
}

export async function createInventoryTransferEvidenceDraft({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const transferId = parsePositiveInt(input?.transferId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;
  const fileName = normalizeFileName(input?.fileName);
  const fileExtension = normalizeFileExtension(fileName);
  const contentType = normalizeContentType(input?.contentType);
  const displayName = normalizeText(input?.displayName, "displayName", 190);
  const note = normalizeText(input?.note, "note", 500);

  const scope = await assertInventoryTransferScope({
    req,
    tenantId,
    transferId,
    assertScopeAccess,
  });

  const insertResult = await query(
    `INSERT INTO evidence_objects (
       tenant_id,
       legal_entity_id,
       source_ref_type,
       source_ref_id,
       status,
       display_name,
       note,
       file_name,
       file_extension,
       content_type,
       created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scope.tenantId,
      scope.legalEntityId,
      SOURCE_REF_TYPE_INVENTORY_TRANSFER,
      scope.transferId,
      STATUS_PENDING_UPLOAD,
      displayName,
      note,
      fileName,
      fileExtension,
      contentType,
      userId,
    ]
  );

  const evidenceId = parsePositiveInt(insertResult.rows?.insertId);
  if (!evidenceId) {
    throw new Error("Evidence record could not be created");
  }

  const created = await findInventoryTransferEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    transferId: scope.transferId,
    evidenceId,
  });
  if (!created) {
    throw new Error("Evidence record readback failed");
  }
  return mapEvidenceRow(created);
}

export async function listInventoryTransferEvidenceForTenant({
  req,
  tenantId,
  transferId,
  assertScopeAccess,
}) {
  const scope = await assertInventoryTransferScope({
    req,
    tenantId,
    transferId,
    assertScopeAccess,
  });
  const result = await query(
    `SELECT *
       FROM evidence_objects
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND source_ref_type = ?
        AND source_ref_id = ?
        AND status <> ?
      ORDER BY created_at DESC, id DESC`,
    [
      scope.tenantId,
      scope.legalEntityId,
      SOURCE_REF_TYPE_INVENTORY_TRANSFER,
      scope.transferId,
      STATUS_DELETED,
    ]
  );
  return (result.rows || []).map(mapEvidenceRow);
}

export async function getInventoryTransferEvidenceByIdForTenant({
  req,
  tenantId,
  transferId,
  evidenceId,
  assertScopeAccess,
}) {
  const { row } = await loadInventoryTransferEvidenceRow({
    req,
    tenantId,
    transferId,
    evidenceId,
    assertScopeAccess,
  });
  if (!row || normalizeStatus(row.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }
  return mapEvidenceRow(row);
}

export async function uploadInventoryTransferEvidenceContent({
  req,
  input,
  binaryData,
  assertScopeAccess,
}) {
  if (!(binaryData instanceof Buffer)) {
    throw badRequest("Evidence upload payload must be binary");
  }
  if (binaryData.length <= 0) {
    throw badRequest("Evidence upload payload is empty");
  }

  const tenantId = parsePositiveInt(input?.tenantId);
  const transferId = parsePositiveInt(input?.transferId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const overrideContentType = normalizeText(input?.contentType, "contentType", 120);
  const fileSha256 = crypto.createHash("sha256").update(binaryData).digest("hex");
  const fileSizeBytes = binaryData.length;
  const storedPayload = await buildStoredEvidencePayload(binaryData);
  const storedSizeBytes = storedPayload.storedData.length;
  const compressionCodec = storedPayload.compressionCodec;

  const scope = await assertInventoryTransferScope({
    req,
    tenantId,
    transferId,
    assertScopeAccess,
  });
  const existing = await findInventoryTransferEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    transferId: scope.transferId,
    evidenceId,
  });
  if (!existing || normalizeStatus(existing.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }

  const fileExtension =
    normalizeText(existing.file_extension, "fileExtension", 16) ||
    normalizeFileExtension(existing.file_name);
  const storagePath = buildEvidenceStoragePath({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType: SOURCE_REF_TYPE_INVENTORY_TRANSFER,
    sourceRefId: scope.transferId,
    evidenceId,
    fileExtension,
  });
  const finalStoragePath =
    compressionCodec === COMPRESSION_CODEC_GZIP ? `${storagePath}.gz` : storagePath;

  await writeEvidenceBinary({
    storagePath: finalStoragePath,
    data: storedPayload.storedData,
  });

  let previousStoragePath = null;
  let updatedRow = null;

  try {
    updatedRow = await withTransaction(async (tx) => {
      const locked = await findInventoryTransferEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        transferId: scope.transferId,
        evidenceId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked || normalizeStatus(locked.status) === STATUS_DELETED) {
        throw badRequest("Evidence object not found");
      }
      previousStoragePath = locked.storage_path || null;

      const nextContentType = normalizeContentType(
        overrideContentType || locked.content_type || DEFAULT_CONTENT_TYPE
      );

      await tx.query(
        `UPDATE evidence_objects
            SET status = ?,
                content_type = ?,
                compression_codec = ?,
                file_size_bytes = ?,
                stored_size_bytes = ?,
                file_sha256 = ?,
                storage_driver = 'LOCAL_FS',
                storage_path = ?,
                uploaded_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ?
            AND legal_entity_id = ?
            AND id = ?`,
        [
          STATUS_ACTIVE,
          nextContentType,
          compressionCodec,
          fileSizeBytes,
          storedSizeBytes,
          fileSha256,
          finalStoragePath,
          scope.tenantId,
          scope.legalEntityId,
          evidenceId,
        ]
      );

      const fresh = await findInventoryTransferEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        transferId: scope.transferId,
        evidenceId,
        runQuery: tx.query,
      });
      if (!fresh) {
        throw new Error("Evidence update readback failed");
      }
      return fresh;
    });
  } catch (err) {
    await deleteEvidenceBinary({ storagePath: finalStoragePath }).catch(() => {});
    throw err;
  }

  if (previousStoragePath && previousStoragePath !== storagePath) {
    await deleteEvidenceBinary({ storagePath: previousStoragePath }).catch(() => {});
  }

  return mapEvidenceRow(updatedRow);
}

export async function getInventoryTransferEvidenceContentForTenant({
  req,
  tenantId,
  transferId,
  evidenceId,
  assertScopeAccess,
}) {
  const { row } = await loadInventoryTransferEvidenceRow({
    req,
    tenantId,
    transferId,
    evidenceId,
    assertScopeAccess,
  });
  if (!row || normalizeStatus(row.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }
  if (normalizeStatus(row.status) !== STATUS_ACTIVE || !row.storage_path) {
    throw badRequest("Evidence content is not uploaded yet");
  }

  let data;
  try {
    const readResult = await readEvidenceBinary({ storagePath: row.storage_path });
    data = readResult.data;
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw badRequest("Evidence content file is missing");
    }
    throw err;
  }

  const compressionCodec = normalizeCompressionCodec(row.compression_codec);
  if (compressionCodec === COMPRESSION_CODEC_GZIP) {
    try {
      data = await gunzip(data);
    } catch {
      throw badRequest("Evidence content could not be decompressed");
    }
  }

  const expectedSha = String(row.file_sha256 || "").trim().toLowerCase();
  if (expectedSha) {
    const actualSha = crypto.createHash("sha256").update(data).digest("hex");
    if (actualSha !== expectedSha) {
      throw badRequest("Evidence content integrity check failed");
    }
  }

  return {
    row: mapEvidenceRow(row),
    data,
  };
}

export async function deleteInventoryTransferEvidenceByIdForTenant({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const transferId = parsePositiveInt(input?.transferId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;

  const scope = await assertInventoryTransferScope({
    req,
    tenantId,
    transferId,
    assertScopeAccess,
  });

  let storagePathToDelete = null;
  const nextRow = await withTransaction(async (tx) => {
    const current = await findInventoryTransferEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      transferId: scope.transferId,
      evidenceId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw badRequest("Evidence object not found");
    }
    storagePathToDelete = current.storage_path || null;
    if (normalizeStatus(current.status) !== STATUS_DELETED) {
      await tx.query(
        `UPDATE evidence_objects
            SET status = ?,
                deleted_at = CURRENT_TIMESTAMP,
                deleted_by_user_id = ?
          WHERE tenant_id = ?
            AND legal_entity_id = ?
            AND id = ?`,
        [STATUS_DELETED, userId, scope.tenantId, scope.legalEntityId, evidenceId]
      );
    }
    return findInventoryTransferEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      transferId: scope.transferId,
      evidenceId,
      runQuery: tx.query,
    });
  });

  if (storagePathToDelete) {
    await deleteEvidenceBinary({ storagePath: storagePathToDelete }).catch(() => {});
  }

  return mapEvidenceRow(nextRow);
}

// ═══════════════════════════════════════════════════════════════════
// Fixed-assets evidence (FIXED_ASSET, FIXED_ASSET_TRANSACTION,
// FIXED_ASSET_DEPRECIATION_RUN)
// ═══════════════════════════════════════════════════════════════════

// ── Scope assertion helpers ──────────────────────────────────────

async function findFixedAssetRow({ tenantId, assetId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, legal_entity_id
       FROM fixed_assets
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, assetId]
  );
  return result.rows?.[0] || null;
}

async function assertFixedAssetEvidenceScope({
  req,
  tenantId,
  sourceRefId,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenant = parsePositiveInt(tenantId);
  const assetId = parsePositiveInt(sourceRefId);
  if (!tenant) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const row = await findFixedAssetRow({ tenantId: tenant, assetId, runQuery });
  if (!row) throw badRequest("Fixed asset not found");

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  if (!legalEntityId) throw badRequest("Fixed asset scope is invalid");

  if (typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "assetId");
  }

  return { tenantId: tenant, sourceRefId: assetId, legalEntityId };
}

async function findFixedAssetTransactionRow({ tenantId, transactionId, runQuery = query }) {
  const result = await runQuery(
    `SELECT fat.id, fa.legal_entity_id
       FROM fixed_asset_transactions fat
       JOIN fixed_assets fa ON fa.id = fat.asset_id
      WHERE fat.tenant_id = ?
        AND fat.id = ?
      LIMIT 1`,
    [tenantId, transactionId]
  );
  return result.rows?.[0] || null;
}

async function assertFixedAssetTransactionEvidenceScope({
  req,
  tenantId,
  sourceRefId,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenant = parsePositiveInt(tenantId);
  const transactionId = parsePositiveInt(sourceRefId);
  if (!tenant) throw badRequest("tenantId is required");
  if (!transactionId) throw badRequest("transactionId is required");

  const row = await findFixedAssetTransactionRow({
    tenantId: tenant,
    transactionId,
    runQuery,
  });
  if (!row) throw badRequest("Fixed asset transaction not found");

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  if (!legalEntityId) throw badRequest("Fixed asset transaction scope is invalid");

  if (typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "transactionId");
  }

  return { tenantId: tenant, sourceRefId: transactionId, legalEntityId };
}

async function findFixedAssetRunRow({ tenantId, runId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, legal_entity_id
       FROM fixed_asset_depreciation_runs
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, runId]
  );
  return result.rows?.[0] || null;
}

async function assertFixedAssetRunEvidenceScope({
  req,
  tenantId,
  sourceRefId,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenant = parsePositiveInt(tenantId);
  const runId = parsePositiveInt(sourceRefId);
  if (!tenant) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  const row = await findFixedAssetRunRow({ tenantId: tenant, runId, runQuery });
  if (!row) throw badRequest("Fixed asset depreciation run not found");

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  if (!legalEntityId) throw badRequest("Fixed asset depreciation run scope is invalid");

  if (typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "runId");
  }

  return { tenantId: tenant, sourceRefId: runId, legalEntityId };
}

// ── Generic fixed-assets evidence row helpers ────────────────────

const FA_SCOPE_RESOLVERS = {
  [SOURCE_REF_TYPE_FIXED_ASSET]: assertFixedAssetEvidenceScope,
  [SOURCE_REF_TYPE_FIXED_ASSET_TRANSACTION]: assertFixedAssetTransactionEvidenceScope,
  [SOURCE_REF_TYPE_FIXED_ASSET_DEPRECIATION_RUN]: assertFixedAssetRunEvidenceScope,
};

async function findFixedAssetEvidenceRow({
  tenantId,
  legalEntityId,
  sourceRefType,
  sourceRefId,
  evidenceId,
  runQuery: runQ = query,
  forUpdate = false,
}) {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  const result = await runQ(
    `SELECT *
       FROM evidence_objects
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND source_ref_type = ?
        AND source_ref_id = ?
        AND id = ?
      LIMIT 1${suffix}`,
    [tenantId, legalEntityId, sourceRefType, sourceRefId, evidenceId]
  );
  return result.rows?.[0] || null;
}

async function loadFixedAssetEvidenceRow({
  req,
  tenantId,
  sourceRefType,
  sourceRefId,
  evidenceId,
  assertScopeAccess,
  runQuery: runQ = query,
  forUpdate = false,
}) {
  const resolveFn = FA_SCOPE_RESOLVERS[sourceRefType];
  if (!resolveFn) throw badRequest(`Unsupported fixed-assets evidence source type: ${sourceRefType}`);

  const scope = await resolveFn({
    req,
    tenantId,
    sourceRefId,
    assertScopeAccess,
    runQuery: runQ,
  });
  const row = await findFixedAssetEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType,
    sourceRefId: scope.sourceRefId,
    evidenceId: parsePositiveInt(evidenceId),
    runQuery: runQ,
    forUpdate,
  });
  return { scope, row };
}

// ── Exported CRUD + file operations ──────────────────────────────

export async function createFixedAssetEvidenceDraft({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const sourceRefType = input?.sourceRefType;
  const sourceRefId = parsePositiveInt(input?.sourceRefId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;
  const fileName = normalizeFileName(input?.fileName);
  const fileExtension = normalizeFileExtension(fileName);
  const contentType = normalizeContentType(input?.contentType);
  const displayName = normalizeText(input?.displayName, "displayName", 190);
  const note = normalizeText(input?.note, "note", 500);

  const resolveFn = FA_SCOPE_RESOLVERS[sourceRefType];
  if (!resolveFn) throw badRequest(`Unsupported fixed-assets evidence source type: ${sourceRefType}`);

  const scope = await resolveFn({
    req,
    tenantId,
    sourceRefId,
    assertScopeAccess,
  });

  const insertResult = await query(
    `INSERT INTO evidence_objects (
       tenant_id,
       legal_entity_id,
       source_ref_type,
       source_ref_id,
       status,
       display_name,
       note,
       file_name,
       file_extension,
       content_type,
       created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scope.tenantId,
      scope.legalEntityId,
      sourceRefType,
      scope.sourceRefId,
      STATUS_PENDING_UPLOAD,
      displayName,
      note,
      fileName,
      fileExtension,
      contentType,
      userId,
    ]
  );

  const evidenceId = parsePositiveInt(insertResult.rows?.insertId);
  if (!evidenceId) {
    throw new Error("Evidence record could not be created");
  }

  const created = await findFixedAssetEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType,
    sourceRefId: scope.sourceRefId,
    evidenceId,
  });
  if (!created) {
    throw new Error("Evidence record readback failed");
  }
  return mapEvidenceRow(created);
}

export async function listFixedAssetEvidenceForTenant({
  req,
  tenantId,
  sourceRefType,
  sourceRefId,
  assertScopeAccess,
}) {
  const resolveFn = FA_SCOPE_RESOLVERS[sourceRefType];
  if (!resolveFn) throw badRequest(`Unsupported fixed-assets evidence source type: ${sourceRefType}`);

  const scope = await resolveFn({
    req,
    tenantId,
    sourceRefId,
    assertScopeAccess,
  });
  const result = await query(
    `SELECT *
       FROM evidence_objects
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND source_ref_type = ?
        AND source_ref_id = ?
        AND status <> ?
      ORDER BY created_at DESC, id DESC`,
    [
      scope.tenantId,
      scope.legalEntityId,
      sourceRefType,
      scope.sourceRefId,
      STATUS_DELETED,
    ]
  );
  return (result.rows || []).map(mapEvidenceRow);
}

export async function getFixedAssetEvidenceByIdForTenant({
  req,
  tenantId,
  sourceRefType,
  sourceRefId,
  evidenceId,
  assertScopeAccess,
}) {
  const { row } = await loadFixedAssetEvidenceRow({
    req,
    tenantId,
    sourceRefType,
    sourceRefId,
    evidenceId,
    assertScopeAccess,
  });
  if (!row || normalizeStatus(row.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }
  return mapEvidenceRow(row);
}

export async function uploadFixedAssetEvidenceContent({
  req,
  input,
  binaryData,
  assertScopeAccess,
}) {
  if (!(binaryData instanceof Buffer)) {
    throw badRequest("Evidence upload payload must be binary");
  }
  if (binaryData.length <= 0) {
    throw badRequest("Evidence upload payload is empty");
  }

  const tenantId = parsePositiveInt(input?.tenantId);
  const sourceRefType = input?.sourceRefType;
  const sourceRefId = parsePositiveInt(input?.sourceRefId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const overrideContentType = normalizeText(input?.contentType, "contentType", 120);
  const fileSha256 = crypto.createHash("sha256").update(binaryData).digest("hex");
  const fileSizeBytes = binaryData.length;
  const storedPayload = await buildStoredEvidencePayload(binaryData);
  const storedSizeBytes = storedPayload.storedData.length;
  const compressionCodec = storedPayload.compressionCodec;

  const resolveFn = FA_SCOPE_RESOLVERS[sourceRefType];
  if (!resolveFn) throw badRequest(`Unsupported fixed-assets evidence source type: ${sourceRefType}`);

  const scope = await resolveFn({
    req,
    tenantId,
    sourceRefId,
    assertScopeAccess,
  });
  const existing = await findFixedAssetEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType,
    sourceRefId: scope.sourceRefId,
    evidenceId,
  });
  if (!existing || normalizeStatus(existing.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }

  const fileExtension =
    normalizeText(existing.file_extension, "fileExtension", 16) ||
    normalizeFileExtension(existing.file_name);
  const storagePath = buildEvidenceStoragePath({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType,
    sourceRefId: scope.sourceRefId,
    evidenceId,
    fileExtension,
  });
  const finalStoragePath =
    compressionCodec === COMPRESSION_CODEC_GZIP ? `${storagePath}.gz` : storagePath;

  await writeEvidenceBinary({
    storagePath: finalStoragePath,
    data: storedPayload.storedData,
  });

  let previousStoragePath = null;
  let updatedRow = null;

  try {
    updatedRow = await withTransaction(async (tx) => {
      const locked = await findFixedAssetEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        sourceRefType,
        sourceRefId: scope.sourceRefId,
        evidenceId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked || normalizeStatus(locked.status) === STATUS_DELETED) {
        throw badRequest("Evidence object not found");
      }
      previousStoragePath = locked.storage_path || null;

      const nextContentType = normalizeContentType(
        overrideContentType || locked.content_type || DEFAULT_CONTENT_TYPE
      );

      await tx.query(
        `UPDATE evidence_objects
            SET status = ?,
                content_type = ?,
                compression_codec = ?,
                file_size_bytes = ?,
                stored_size_bytes = ?,
                file_sha256 = ?,
                storage_driver = 'LOCAL_FS',
                storage_path = ?,
                uploaded_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ?
            AND legal_entity_id = ?
            AND id = ?`,
        [
          STATUS_ACTIVE,
          nextContentType,
          compressionCodec,
          fileSizeBytes,
          storedSizeBytes,
          fileSha256,
          finalStoragePath,
          scope.tenantId,
          scope.legalEntityId,
          evidenceId,
        ]
      );

      const fresh = await findFixedAssetEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        sourceRefType,
        sourceRefId: scope.sourceRefId,
        evidenceId,
        runQuery: tx.query,
      });
      if (!fresh) {
        throw new Error("Evidence update readback failed");
      }
      return fresh;
    });
  } catch (err) {
    await deleteEvidenceBinary({ storagePath: finalStoragePath }).catch(() => {});
    throw err;
  }

  if (previousStoragePath && previousStoragePath !== storagePath) {
    await deleteEvidenceBinary({ storagePath: previousStoragePath }).catch(() => {});
  }

  return mapEvidenceRow(updatedRow);
}

export async function getFixedAssetEvidenceContentForTenant({
  req,
  tenantId,
  sourceRefType,
  sourceRefId,
  evidenceId,
  assertScopeAccess,
}) {
  const { row } = await loadFixedAssetEvidenceRow({
    req,
    tenantId,
    sourceRefType,
    sourceRefId,
    evidenceId,
    assertScopeAccess,
  });
  if (!row || normalizeStatus(row.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }
  if (normalizeStatus(row.status) !== STATUS_ACTIVE || !row.storage_path) {
    throw badRequest("Evidence content is not uploaded yet");
  }

  let data;
  try {
    const readResult = await readEvidenceBinary({ storagePath: row.storage_path });
    data = readResult.data;
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw badRequest("Evidence content file is missing");
    }
    throw err;
  }

  const compressionCodec = normalizeCompressionCodec(row.compression_codec);
  if (compressionCodec === COMPRESSION_CODEC_GZIP) {
    try {
      data = await gunzip(data);
    } catch {
      throw badRequest("Evidence content could not be decompressed");
    }
  }

  const expectedSha = String(row.file_sha256 || "").trim().toLowerCase();
  if (expectedSha) {
    const actualSha = crypto.createHash("sha256").update(data).digest("hex");
    if (actualSha !== expectedSha) {
      throw badRequest("Evidence content integrity check failed");
    }
  }

  return {
    row: mapEvidenceRow(row),
    data,
  };
}

export async function deleteFixedAssetEvidenceByIdForTenant({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const sourceRefType = input?.sourceRefType;
  const sourceRefId = parsePositiveInt(input?.sourceRefId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const userId = parsePositiveInt(input?.userId ?? req?.user?.userId) || null;

  const resolveFn = FA_SCOPE_RESOLVERS[sourceRefType];
  if (!resolveFn) throw badRequest(`Unsupported fixed-assets evidence source type: ${sourceRefType}`);

  const scope = await resolveFn({
    req,
    tenantId,
    sourceRefId,
    assertScopeAccess,
  });

  let storagePathToDelete = null;
  const nextRow = await withTransaction(async (tx) => {
    const current = await findFixedAssetEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      sourceRefType,
      sourceRefId: scope.sourceRefId,
      evidenceId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw badRequest("Evidence object not found");
    }
    storagePathToDelete = current.storage_path || null;
    if (normalizeStatus(current.status) !== STATUS_DELETED) {
      await tx.query(
        `UPDATE evidence_objects
            SET status = ?,
                deleted_at = CURRENT_TIMESTAMP,
                deleted_by_user_id = ?
          WHERE tenant_id = ?
            AND legal_entity_id = ?
            AND id = ?`,
        [STATUS_DELETED, userId, scope.tenantId, scope.legalEntityId, evidenceId]
      );
    }
    return findFixedAssetEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      sourceRefType,
      sourceRefId: scope.sourceRefId,
      evidenceId,
      runQuery: tx.query,
    });
  });

  if (storagePathToDelete) {
    await deleteEvidenceBinary({ storagePath: storagePathToDelete }).catch(() => {});
  }

  return mapEvidenceRow(nextRow);
}
