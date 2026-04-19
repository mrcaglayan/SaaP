import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildEvidenceStoragePath,
  deleteEvidenceBinary,
  readEvidenceBinary,
  writeEvidenceBinary,
} from "./evidence.storage.adapter.js";
import { getLocalClosePackById } from "./local.close-packs.service.js";
import { LOCAL_CLOSE_PACK } from "../utils/source-ref-types.js";
import { refreshLocalClosePackCertification } from "./local.close-pack.certification.service.js";

const STATUS_PENDING_UPLOAD = "PENDING_UPLOAD";
const STATUS_ACTIVE = "ACTIVE";
const STATUS_DELETED = "DELETED";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

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
    compressionCodec: String(row.compression_codec || "NONE").toUpperCase(),
    fileSizeBytes:
      row.file_size_bytes === null || row.file_size_bytes === undefined
        ? null
        : Number(row.file_size_bytes),
    storedSizeBytes:
      row.stored_size_bytes === null || row.stored_size_bytes === undefined
        ? null
        : Number(row.stored_size_bytes),
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

async function assertLocalClosePackEvidenceScope({
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

async function findLocalClosePackEvidenceRow({
  tenantId,
  legalEntityId,
  packId,
  evidenceId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
     FROM evidence_objects
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND source_ref_type = ?
       AND source_ref_id = ?
       AND id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, legalEntityId, LOCAL_CLOSE_PACK, packId, evidenceId]
  );
  return result.rows?.[0] || null;
}

/**
 * List evidence attachments scoped to one local close pack.
 */
export async function listLocalClosePackEvidenceForTenant({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  const scope = await assertLocalClosePackEvidenceScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
    runQuery,
  });

  const result = await runQuery(
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
      LOCAL_CLOSE_PACK,
      scope.packId,
      STATUS_DELETED,
    ]
  );

  return (result.rows || []).map(mapEvidenceRow);
}

/**
 * Create the metadata shell for one local close-pack evidence attachment.
 */
export async function createLocalClosePackEvidenceDraft({
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

  const scope = await assertLocalClosePackEvidenceScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
  });
  const fileName = normalizeFileName(input?.fileName);
  const fileExtension = normalizeFileExtension(fileName);
  const contentType = normalizeContentType(input?.contentType);
  const displayName = normalizeText(input?.displayName, "displayName", 190);
  const note = normalizeText(input?.note, "note", 500);

  const result = await query(
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
      LOCAL_CLOSE_PACK,
      scope.packId,
      STATUS_PENDING_UPLOAD,
      displayName,
      note,
      fileName,
      fileExtension,
      contentType,
      userId,
    ]
  );

  const evidenceId = parsePositiveInt(result.rows?.insertId);
  if (!evidenceId) {
    throw new Error("Local close-pack evidence draft could not be created");
  }

  const row = await findLocalClosePackEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    packId: scope.packId,
    evidenceId,
  });
  if (!row) {
    throw new Error("Local close-pack evidence draft readback failed");
  }
  return mapEvidenceRow(row);
}

/**
 * Upload binary evidence content for one local close-pack attachment shell.
 */
export async function uploadLocalClosePackEvidenceContent({
  req,
  input,
  binaryData,
  assertScopeAccess,
}) {
  if (!(binaryData instanceof Buffer) || binaryData.length <= 0) {
    throw badRequest("Evidence upload payload is required");
  }

  const tenantId = parsePositiveInt(input?.tenantId);
  const packId = parsePositiveInt(input?.packId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!packId) {
    throw badRequest("packId is required");
  }
  if (!evidenceId) {
    throw badRequest("evidenceId is required");
  }

  const scope = await assertLocalClosePackEvidenceScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
  });

  const current = await findLocalClosePackEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    packId: scope.packId,
    evidenceId,
  });
  if (!current || normalizeStatus(current.status) === STATUS_DELETED) {
    throw badRequest("Evidence object not found");
  }

  const fileSha256 = crypto.createHash("sha256").update(binaryData).digest("hex");
  const fileSizeBytes = binaryData.length;
  const contentType = normalizeContentType(
    input?.contentType || current.content_type || DEFAULT_CONTENT_TYPE
  );
  const storagePath = buildEvidenceStoragePath({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    sourceRefType: LOCAL_CLOSE_PACK,
    sourceRefId: scope.packId,
    evidenceId,
    fileExtension:
      normalizeText(current.file_extension, "fileExtension", 16) ||
      normalizeFileExtension(current.file_name),
  });

  await writeEvidenceBinary({
    storagePath,
    data: binaryData,
  });

  let previousStoragePath = null;
  try {
    return await withTransaction(async (tx) => {
      const locked = await findLocalClosePackEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        packId: scope.packId,
        evidenceId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked || normalizeStatus(locked.status) === STATUS_DELETED) {
        throw badRequest("Evidence object not found");
      }
      previousStoragePath = locked.storage_path || null;

      await tx.query(
        `UPDATE evidence_objects
         SET status = ?,
             content_type = ?,
             compression_codec = 'NONE',
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
          contentType,
          fileSizeBytes,
          fileSizeBytes,
          fileSha256,
          storagePath,
          scope.tenantId,
          scope.legalEntityId,
          evidenceId,
        ]
      );

      const row = await findLocalClosePackEvidenceRow({
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        packId: scope.packId,
        evidenceId,
        runQuery: tx.query,
      });
      if (!row) {
        throw new Error("Local close-pack evidence upload readback failed");
      }

      await refreshLocalClosePackCertification({
        req,
        tenantId: scope.tenantId,
        packId: scope.packId,
        userId: parsePositiveInt(req?.user?.userId),
        assertScopeAccess,
        runQuery: tx.query,
      });

      return mapEvidenceRow(row);
    });
  } catch (err) {
    await deleteEvidenceBinary({ storagePath }).catch(() => {});
    throw err;
  } finally {
    if (previousStoragePath && previousStoragePath !== storagePath) {
      await deleteEvidenceBinary({ storagePath: previousStoragePath }).catch(() => {});
    }
  }
}

/**
 * Download one local close-pack evidence attachment.
 */
export async function getLocalClosePackEvidenceContentForTenant({
  req,
  tenantId,
  packId,
  evidenceId,
  assertScopeAccess,
}) {
  const scope = await assertLocalClosePackEvidenceScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
  });
  const row = await findLocalClosePackEvidenceRow({
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    packId: scope.packId,
    evidenceId,
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

/**
 * Soft-delete one local close-pack evidence attachment and remove its binary.
 */
export async function deleteLocalClosePackEvidenceByIdForTenant({
  req,
  input,
  assertScopeAccess,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const packId = parsePositiveInt(input?.packId);
  const evidenceId = parsePositiveInt(input?.evidenceId);
  const userId = parsePositiveInt(input?.userId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!packId) {
    throw badRequest("packId is required");
  }
  if (!evidenceId) {
    throw badRequest("evidenceId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  const scope = await assertLocalClosePackEvidenceScope({
    req,
    tenantId,
    packId,
    assertScopeAccess,
  });

  let storagePathToDelete = null;
  const row = await withTransaction(async (tx) => {
    const current = await findLocalClosePackEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      packId: scope.packId,
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

    await refreshLocalClosePackCertification({
      req,
      tenantId: scope.tenantId,
      packId: scope.packId,
      userId,
      assertScopeAccess,
      runQuery: tx.query,
    });

    return findLocalClosePackEvidenceRow({
      tenantId: scope.tenantId,
      legalEntityId: scope.legalEntityId,
      packId: scope.packId,
      evidenceId,
      runQuery: tx.query,
    });
  });

  if (storagePathToDelete) {
    await deleteEvidenceBinary({ storagePath: storagePathToDelete }).catch(() => {});
  }

  return mapEvidenceRow(row);
}

export default {
  listLocalClosePackEvidenceForTenant,
  createLocalClosePackEvidenceDraft,
  uploadLocalClosePackEvidenceContent,
  getLocalClosePackEvidenceContentForTenant,
  deleteLocalClosePackEvidenceByIdForTenant,
};
