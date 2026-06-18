import crypto from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { CLOSE_TASK_INSTANCE } from "../utils/source-ref-types.js";
import { assertCloseTaskCycleEditable } from "./close.task-scope.service.js";
import { writeCloseTaskLifecycleEvent } from "./close.task-events.service.js";
import { loadCloseTaskForDependentService } from "./close.tasks.service.js";
import {
  deleteEvidenceBinary,
  readEvidenceBinary,
  writeEvidenceBinary,
} from "./evidence.storage.adapter.js";

const STATUS_ACTIVE = "ACTIVE";
const STATUS_DELETED = "DELETED";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const COMPRESSION_CODEC_NONE = "NONE";
const COMPRESSION_CODEC_GZIP = "GZIP";
const STORAGE_DRIVER_LOCAL_FS = "LOCAL_FS";

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
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

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

function normalizeCompressionCodec(value) {
  return normalizeStatus(value) === COMPRESSION_CODEC_GZIP
    ? COMPRESSION_CODEC_GZIP
    : COMPRESSION_CODEC_NONE;
}

function normalizeFileExtension(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return null;
  }
  const raw = rawValue.includes(".")
    ? rawValue.slice(rawValue.lastIndexOf(".") + 1)
    : rawValue;
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 16) || null
  );
}

function sanitizePathSegment(value, fallback = "x") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function buildCloseTaskEvidenceStoragePath({
  tenantId,
  taskId,
  evidenceObjectId,
  fileExtension = null,
}) {
  const tId = parsePositiveInt(tenantId);
  const ctiId = parsePositiveInt(taskId);
  const evId = parsePositiveInt(evidenceObjectId);
  if (!tId || !ctiId || !evId) {
    throw badRequest("Storage path scope identifiers are required");
  }

  const extension = sanitizePathSegment(fileExtension || "", "").slice(0, 16).toLowerCase();
  const extensionSuffix = extension ? `.${extension}` : "";
  const stamp = Date.now();
  const nonce = crypto.randomBytes(4).toString("hex");

  return [
    `tenant-${tId}`,
    "close-task",
    `task-${ctiId}`,
    `${evId}-${stamp}-${nonce}${extensionSuffix}`,
  ].join("/");
}

function resolveCompressionMode() {
  const normalized = String(process.env.EVIDENCE_STORAGE_COMPRESSION || "AUTO")
    .trim()
    .toUpperCase();
  if (normalized === "NONE" || normalized === "GZIP" || normalized === "AUTO") {
    return normalized;
  }
  return "AUTO";
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

  return gzData.length < binaryData.length
    ? { storedData: gzData, compressionCodec: COMPRESSION_CODEC_GZIP }
    : { storedData: binaryData, compressionCodec: COMPRESSION_CODEC_NONE };
}

async function readStoredEvidencePayload(row) {
  if (!row?.storage_path) {
    throw badRequest("Evidence content is not uploaded yet");
  }

  let storedData;
  try {
    const readResult = await readEvidenceBinary({ storagePath: row.storage_path });
    storedData = readResult.data;
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw badRequest("Evidence content file is missing");
    }
    throw err;
  }

  const compressionCodec = normalizeCompressionCodec(row.compression_codec);
  const data =
    compressionCodec === COMPRESSION_CODEC_GZIP ? await gunzip(storedData) : storedData;

  const expectedSha = String(row.file_sha256 || "").trim().toLowerCase();
  if (expectedSha) {
    const actualSha = crypto.createHash("sha256").update(data).digest("hex");
    if (actualSha !== expectedSha) {
      throw badRequest("Evidence content integrity check failed");
    }
  }

  return {
    data,
    storedData,
  };
}

function mapEvidenceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeTaskInstanceId: parsePositiveInt(row.close_task_instance_id),
    evidenceObjectId: parsePositiveInt(row.evidence_object_id),
    status: row.status || STATUS_ACTIVE,
    attachedByUserId: parsePositiveInt(row.attached_by_user_id),
    attachedAt: row.attached_at || null,
    removedByUserId: parsePositiveInt(row.removed_by_user_id),
    removedAt: row.removed_at || null,
    removeReason: row.remove_reason || null,
    evidence: {
      status: row.evidence_status || null,
      legalEntityId: parsePositiveInt(row.legal_entity_id),
      displayName: row.display_name || null,
      fileName: row.file_name || null,
      fileExtension: row.file_extension || null,
      contentType: row.content_type || null,
      compressionCodec: normalizeCompressionCodec(row.compression_codec),
      fileSizeBytes:
        row.file_size_bytes === null || row.file_size_bytes === undefined
          ? null
          : Number(row.file_size_bytes),
      storedSizeBytes:
        row.stored_size_bytes === null || row.stored_size_bytes === undefined
          ? null
          : Number(row.stored_size_bytes),
      uploadedAt: row.uploaded_at || null,
      sourceRefType: row.source_ref_type || null,
      sourceRefId: parsePositiveInt(row.source_ref_id),
    },
  };
}

async function loadEvidenceObject({ tenantId, evidenceObjectId, runQuery = query }) {
  const evidenceId = parsePositiveInt(evidenceObjectId);
  if (!evidenceId) {
    throw badRequest("evidenceObjectId is required");
  }
  const result = await runQuery(
    `SELECT *
     FROM evidence_objects
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsePositiveInt(tenantId), evidenceId],
  );
  return result.rows?.[0] || null;
}

async function findCloseTaskEvidenceLink({
  tenantId,
  taskId,
  evidenceId,
  runQuery = query,
  activeOnly = false,
  forUpdate = false,
}) {
  const parsedEvidenceId = parsePositiveInt(evidenceId);
  if (!parsedEvidenceId) {
    throw badRequest("evidenceId is required");
  }
  const activeClause = activeOnly ? "AND cte.status = 'ACTIVE'" : "";
  const result = await runQuery(
    `SELECT
       cte.*,
       eo.status AS evidence_status,
       eo.legal_entity_id,
       eo.display_name,
       eo.file_name,
       eo.file_extension,
       eo.content_type,
       eo.compression_codec,
       eo.file_size_bytes,
       eo.stored_size_bytes,
       eo.file_sha256,
       eo.storage_driver,
       eo.storage_path,
       eo.uploaded_at,
       eo.source_ref_type,
       eo.source_ref_id
     FROM close_task_evidence cte
     JOIN evidence_objects eo
       ON eo.id = cte.evidence_object_id
      AND eo.tenant_id = cte.tenant_id
     WHERE cte.tenant_id = ?
       AND cte.close_task_instance_id = ?
       AND (cte.evidence_object_id = ? OR cte.id = ?)
       ${activeClause}
     ORDER BY CASE WHEN cte.evidence_object_id = ? THEN 0 ELSE 1 END, cte.id DESC
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(taskId),
      parsedEvidenceId,
      parsedEvidenceId,
      parsedEvidenceId,
    ],
  );
  return result.rows?.[0] || null;
}

async function loadCloseTaskEvidenceLink({
  tenantId,
  taskId,
  evidenceId,
  actorCtx = {},
  runQuery = query,
  activeOnly = false,
  forUpdate = false,
}) {
  const task = await loadCloseTaskForDependentService({
    tenantId,
    taskId,
    actorCtx,
    runQuery,
    forUpdate,
  });
  const row = await findCloseTaskEvidenceLink({
    tenantId,
    taskId,
    evidenceId,
    runQuery,
    activeOnly,
    forUpdate,
  });
  if (!row) {
    throw notFound("Task evidence not found");
  }
  return { task, row };
}

async function assertEvidenceObjectAttachableToTask({
  tenantId,
  taskId,
  evidenceObject,
  runQuery = query,
}) {
  const evidenceObjectId = parsePositiveInt(evidenceObject?.id);
  const sourceType = normalizeStatus(evidenceObject?.source_ref_type);
  const sourceId = parsePositiveInt(evidenceObject?.source_ref_id);
  if (
    sourceType &&
    (sourceType !== CLOSE_TASK_INSTANCE || (sourceId && sourceId !== parsePositiveInt(taskId)))
  ) {
    throw badRequest("Evidence object is already attached to another source");
  }
  if (sourceType === CLOSE_TASK_INSTANCE && !sourceId) {
    throw badRequest("Evidence object source is invalid");
  }

  const result = await runQuery(
    `SELECT close_task_instance_id
     FROM close_task_evidence
     WHERE tenant_id = ?
       AND evidence_object_id = ?
       AND close_task_instance_id <> ?
       AND status = 'ACTIVE'
     LIMIT 1`,
    [parsePositiveInt(tenantId), evidenceObjectId, parsePositiveInt(taskId)],
  );
  if (result.rows?.[0]) {
    throw badRequest("Evidence object is already attached to another close task");
  }
}

/**
 * List active and removed evidence links for a close task.
 */
export async function listCloseTaskEvidence({ tenantId, taskId }, actorCtx = {}) {
  const runQuery = actorCtx.runQuery || query;
  await loadCloseTaskForDependentService({ tenantId, taskId, actorCtx, runQuery });
  const result = await runQuery(
    `SELECT
       cte.*,
       eo.status AS evidence_status,
       eo.legal_entity_id,
       eo.display_name,
       eo.file_name,
       eo.file_extension,
       eo.content_type,
       eo.compression_codec,
       eo.file_size_bytes,
       eo.stored_size_bytes,
       eo.uploaded_at,
       eo.source_ref_type,
       eo.source_ref_id
     FROM close_task_evidence cte
     JOIN evidence_objects eo
       ON eo.id = cte.evidence_object_id
      AND eo.tenant_id = cte.tenant_id
     WHERE cte.tenant_id = ?
       AND cte.close_task_instance_id = ?
     ORDER BY cte.attached_at DESC, cte.id DESC`,
    [parsePositiveInt(tenantId), parsePositiveInt(taskId)],
  );
  return { rows: (result.rows || []).map(mapEvidenceRow) };
}

/**
 * Create a close-task-owned evidence draft and link it to the task immediately.
 */
export async function createCloseTaskEvidenceDraft(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  const fileName = normalizeFileName(input.fileName);
  const displayName = normalizeText(input.displayName, "displayName", 190) || fileName;
  const note = normalizeText(input.note, "note", 500);
  const fileExtension = normalizeFileExtension(fileName);
  const contentType = normalizeContentType(input.contentType || DEFAULT_CONTENT_TYPE);

  return withTransaction(async (tx) => {
    const task = await loadCloseTaskForDependentService({
      tenantId,
      taskId,
      actorCtx,
      runQuery: tx.query,
      forUpdate: true,
    });
    assertCloseTaskCycleEditable(task, "Create task evidence draft");

    const result = await tx.query(
      `INSERT INTO evidence_objects (
         tenant_id,
         legal_entity_id,
         scope_type,
         scope_id,
         scope_key,
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
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_UPLOAD', ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        parsePositiveInt(task.legal_entity_id) || null,
        task.rbac_scope_type,
        task.rbac_scope_id,
        task.rbac_scope_key,
        CLOSE_TASK_INSTANCE,
        taskId,
        displayName,
        note,
        fileName,
        fileExtension,
        contentType,
        userId || null,
      ],
    );
    const evidenceObjectId = parsePositiveInt(result.rows?.insertId);
    if (!evidenceObjectId) {
      throw new Error("Close task evidence draft could not be created");
    }

    await tx.query(
      `INSERT INTO close_task_evidence (
         tenant_id,
         close_task_instance_id,
         evidence_object_id,
         status,
         attached_by_user_id,
         attached_at
       )
       VALUES (?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP)`,
      [tenantId, taskId, evidenceObjectId, userId || null],
    );

    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: task,
      eventType: "EVIDENCE_ATTACHED",
      fromStatus: task.status,
      toStatus: task.status,
      actorUserId: userId,
      payload: { evidenceObjectId, draftCreated: true },
    });

    const row = await findCloseTaskEvidenceLink({
      tenantId,
      taskId,
      evidenceId: evidenceObjectId,
      runQuery: tx.query,
      activeOnly: true,
    });
    if (!row) {
      throw new Error("Close task evidence draft readback failed");
    }
    return { row: mapEvidenceRow(row) };
  });
}

/**
 * Attach an existing evidence object to a close task, reactivating removed links.
 */
export async function attachCloseTaskEvidence(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    const task = await loadCloseTaskForDependentService({
      tenantId,
      taskId,
      actorCtx,
      runQuery: tx.query,
      forUpdate: true,
    });
    assertCloseTaskCycleEditable(task, "Attach task evidence");

    const evidenceObject = await loadEvidenceObject({
      tenantId,
      evidenceObjectId: input.evidenceObjectId,
      runQuery: tx.query,
    });
    if (!evidenceObject) {
      throw notFound("Evidence object not found");
    }
    if (normalizeStatus(evidenceObject.status) === STATUS_DELETED) {
      throw badRequest("Evidence object is deleted");
    }
    await assertEvidenceObjectAttachableToTask({
      tenantId,
      taskId,
      evidenceObject,
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE evidence_objects
       SET source_ref_type = ?,
           source_ref_id = ?,
           scope_type = ?,
           scope_id = ?,
           scope_key = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        CLOSE_TASK_INSTANCE,
        taskId,
        task.rbac_scope_type,
        task.rbac_scope_id,
        task.rbac_scope_key,
        tenantId,
        parsePositiveInt(input.evidenceObjectId),
      ],
    );

    await tx.query(
      `INSERT INTO close_task_evidence (
         tenant_id,
         close_task_instance_id,
         evidence_object_id,
         status,
         attached_by_user_id,
         attached_at
       )
       VALUES (?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         status = 'ACTIVE',
         attached_by_user_id = VALUES(attached_by_user_id),
         attached_at = CURRENT_TIMESTAMP,
         removed_by_user_id = NULL,
         removed_at = NULL,
         remove_reason = NULL`,
      [tenantId, taskId, parsePositiveInt(input.evidenceObjectId), userId || null],
    );

    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: task,
      eventType: "EVIDENCE_ATTACHED",
      fromStatus: task.status,
      toStatus: task.status,
      actorUserId: userId,
      payload: { evidenceObjectId: parsePositiveInt(input.evidenceObjectId) },
    });

    return listCloseTaskEvidence({ tenantId, taskId }, { ...actorCtx, runQuery: tx.query });
  });
}

/**
 * Soft-remove one evidence link from a close task.
 */
export async function removeCloseTaskEvidence(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const evidenceId = parsePositiveInt(input.evidenceId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    const { task, row: evidenceLink } = await loadCloseTaskEvidenceLink({
      tenantId,
      taskId,
      evidenceId,
      actorCtx,
      runQuery: tx.query,
      activeOnly: true,
      forUpdate: true,
    });
    assertCloseTaskCycleEditable(task, "Remove task evidence");

    await tx.query(
      `UPDATE close_task_evidence
       SET status = 'REMOVED',
           removed_by_user_id = ?,
           removed_at = CURRENT_TIMESTAMP,
           remove_reason = ?
       WHERE tenant_id = ?
         AND close_task_instance_id = ?
         AND evidence_object_id = ?`,
      [
        userId || null,
        input.reason || null,
        tenantId,
        taskId,
        parsePositiveInt(evidenceLink.evidence_object_id),
      ],
    );

    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: task,
      eventType: "EVIDENCE_REMOVED",
      fromStatus: task.status,
      toStatus: task.status,
      actorUserId: userId,
      note: input.reason || null,
      payload: { evidenceObjectId: parsePositiveInt(evidenceLink.evidence_object_id) },
    });

    return listCloseTaskEvidence({ tenantId, taskId }, { ...actorCtx, runQuery: tx.query });
  });
}

/**
 * Upload or replace binary content for an active close-task evidence link.
 */
export async function uploadCloseTaskEvidenceContent(input = {}, actorCtx = {}, binaryData = null) {
  if (!(binaryData instanceof Buffer) || binaryData.length <= 0) {
    throw badRequest("Evidence upload payload is required");
  }

  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const evidenceId = parsePositiveInt(input.evidenceId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);

  const { task, row: current } = await loadCloseTaskEvidenceLink({
    tenantId,
    taskId,
    evidenceId,
    actorCtx,
    activeOnly: true,
  });
  assertCloseTaskCycleEditable(task, "Upload task evidence");
  if (normalizeStatus(current.evidence_status) === STATUS_DELETED) {
    throw badRequest("Evidence object is deleted");
  }

  const fileSha256 = crypto.createHash("sha256").update(binaryData).digest("hex");
  const fileSizeBytes = binaryData.length;
  const contentType = normalizeContentType(
    input.contentType || current.content_type || DEFAULT_CONTENT_TYPE,
  );
  const fileExtension =
    normalizeText(current.file_extension, "fileExtension", 16) ||
    normalizeFileExtension(current.file_name);
  const { storedData, compressionCodec } = await buildStoredEvidencePayload(binaryData);
  const storagePath = buildCloseTaskEvidenceStoragePath({
    tenantId,
    taskId,
    evidenceObjectId: current.evidence_object_id,
    fileExtension,
  });

  let previousStoragePath = null;
  let committed = false;
  let storageCreated = false;
  try {
    const writeResult = await writeEvidenceBinary({
      storagePath,
      data: storedData,
    });
    storageCreated = true;
    if (writeResult.bytesWritten !== storedData.length) {
      throw badRequest("Evidence storage write verification failed");
    }

    const verifyRead = await readEvidenceBinary({ storagePath });
    if (verifyRead.data.length !== storedData.length) {
      throw badRequest("Evidence storage size verification failed");
    }
    const verifyPayload =
      compressionCodec === COMPRESSION_CODEC_GZIP
        ? await gunzip(verifyRead.data)
        : verifyRead.data;
    const verifySha = crypto.createHash("sha256").update(verifyPayload).digest("hex");
    if (verifySha !== fileSha256) {
      throw badRequest("Evidence storage integrity check failed");
    }

    const result = await withTransaction(async (tx) => {
      const { task: lockedTask, row: locked } = await loadCloseTaskEvidenceLink({
        tenantId,
        taskId,
        evidenceId,
        actorCtx,
        runQuery: tx.query,
        activeOnly: true,
        forUpdate: true,
      });
      assertCloseTaskCycleEditable(lockedTask, "Upload task evidence");
      if (normalizeStatus(locked.evidence_status) === STATUS_DELETED) {
        throw badRequest("Evidence object is deleted");
      }

      previousStoragePath = locked.storage_path || null;

      await tx.query(
        `UPDATE evidence_objects
         SET source_ref_type = ?,
             source_ref_id = ?,
             scope_type = ?,
             scope_id = ?,
             scope_key = ?,
             status = ?,
             content_type = ?,
             compression_codec = ?,
             file_size_bytes = ?,
             stored_size_bytes = ?,
             file_sha256 = ?,
             storage_driver = ?,
             storage_path = ?,
             uploaded_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND id = ?`,
        [
          CLOSE_TASK_INSTANCE,
          taskId,
          lockedTask.rbac_scope_type,
          lockedTask.rbac_scope_id,
          lockedTask.rbac_scope_key,
          STATUS_ACTIVE,
          contentType,
          compressionCodec,
          fileSizeBytes,
          storedData.length,
          fileSha256,
          STORAGE_DRIVER_LOCAL_FS,
          storagePath,
          tenantId,
          parsePositiveInt(locked.evidence_object_id),
        ],
      );

      await writeCloseTaskLifecycleEvent({
        runQuery: tx.query,
        req: actorCtx.req,
        tenantId,
        taskRow: lockedTask,
        eventType: "EVIDENCE_ATTACHED",
        fromStatus: lockedTask.status,
        toStatus: lockedTask.status,
        actorUserId: userId,
        payload: {
          evidenceObjectId: parsePositiveInt(locked.evidence_object_id),
          contentUploaded: true,
          contentType,
          fileSizeBytes,
          compressionCodec,
        },
      });

      const uploaded = await findCloseTaskEvidenceLink({
        tenantId,
        taskId,
        evidenceId: locked.evidence_object_id,
        runQuery: tx.query,
        activeOnly: true,
      });
      if (!uploaded) {
        throw new Error("Close task evidence upload readback failed");
      }
      return { row: mapEvidenceRow(uploaded) };
    });

    committed = true;
    return result;
  } catch (err) {
    if (storageCreated) {
      await deleteEvidenceBinary({ storagePath }).catch(() => {});
    }
    throw err;
  } finally {
    if (committed && previousStoragePath && previousStoragePath !== storagePath) {
      await deleteEvidenceBinary({ storagePath: previousStoragePath }).catch(() => {});
    }
  }
}

/**
 * Read verified binary content for a close-task evidence link.
 */
export async function downloadCloseTaskEvidence(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const evidenceId = parsePositiveInt(input.evidenceId);
  const { row } = await loadCloseTaskEvidenceLink({
    tenantId,
    taskId,
    evidenceId,
    actorCtx,
    activeOnly: true,
  });

  if (normalizeStatus(row.evidence_status) !== STATUS_ACTIVE) {
    throw badRequest("Evidence content is not uploaded yet");
  }
  if (normalizeStatus(row.storage_driver) !== STORAGE_DRIVER_LOCAL_FS) {
    throw badRequest("Evidence storage driver is not supported");
  }

  const { data } = await readStoredEvidencePayload(row);
  return {
    row: mapEvidenceRow(row),
    data,
  };
}
