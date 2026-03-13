import express from "express";
import {
  assertScopeAccess,
  requirePermission,
} from "../middleware/rbac.js";
import { resolveInventoryTransferScope } from "../services/inventory.transfer.service.js";
import {
  createInventoryTransferEvidenceDraft,
  deleteInventoryTransferEvidenceByIdForTenant,
  getInventoryTransferEvidenceContentForTenant,
  listInventoryTransferEvidenceForTenant,
  uploadInventoryTransferEvidenceContent,
} from "../services/evidence.service.js";
import { requireTenantId, requireUserId } from "./cash.validators.common.js";
import { asyncHandler, badRequest, parsePositiveInt } from "./_utils.js";

const router = express.Router({ mergeParams: true });

function resolveBinaryUploadLimit() {
  const fallbackBytes = 15 * 1024 * 1024;
  const parsed = Number(process.env.EVIDENCE_MAX_UPLOAD_BYTES || fallbackBytes);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallbackBytes;
  }
  return parsed;
}

const evidenceBinaryUploadMiddleware = express.raw({
  type: () => true,
  limit: resolveBinaryUploadLimit(),
});

function parseTransferIdParam(req) {
  const transferId = parsePositiveInt(req.params?.transferId);
  if (!transferId) {
    throw badRequest("transferId must be a positive integer");
  }
  return transferId;
}

function parseEvidenceIdParam(req) {
  const evidenceId = parsePositiveInt(req.params?.evidenceId);
  if (!evidenceId) {
    throw badRequest("evidenceId must be a positive integer");
  }
  return evidenceId;
}

function sanitizeHeaderContentType(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.split(";")[0].trim().toLowerCase();
}

function toSafeAttachmentFileName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/["\r\n]/g, "_")
    .replace(/[\\/]/g, "_");
  return normalized || "evidence.bin";
}

const resolveTransferScope = async (req, tenantId) =>
  resolveInventoryTransferScope(req.params?.transferId, tenantId);

router.get(
  "/",
  requirePermission("inventory.read", {
    resolveScope: resolveTransferScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const transferId = parseTransferIdParam(req);
    const rows = await listInventoryTransferEvidenceForTenant({
      req,
      tenantId,
      transferId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      transferId,
      rows,
    });
  })
);

router.post(
  "/",
  requirePermission("inventory.upsert", {
    resolveScope: resolveTransferScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const transferId = parseTransferIdParam(req);
    const userId = requireUserId(req);
    const fileName = String(req.body?.fileName ?? req.body?.file_name ?? "").trim();
    if (!fileName) {
      throw badRequest("fileName is required");
    }

    const row = await createInventoryTransferEvidenceDraft({
      req,
      input: {
        tenantId,
        transferId,
        userId,
        fileName,
        contentType: req.body?.contentType ?? req.body?.content_type ?? null,
        displayName: req.body?.displayName ?? req.body?.display_name ?? null,
        note: req.body?.note ?? null,
      },
      assertScopeAccess,
    });

    return res.status(201).json({
      tenantId,
      transferId,
      row,
      uploadPath: `/api/v1/inventory/transfers/${transferId}/evidence/${row.id}/content`,
    });
  })
);

router.put(
  "/:evidenceId/content",
  requirePermission("inventory.upsert", {
    resolveScope: resolveTransferScope,
  }),
  evidenceBinaryUploadMiddleware,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const transferId = parseTransferIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    if (!(req.body instanceof Buffer)) {
      throw badRequest("Binary payload is required");
    }

    const row = await uploadInventoryTransferEvidenceContent({
      req,
      input: {
        tenantId,
        transferId,
        evidenceId,
        contentType: sanitizeHeaderContentType(req.headers?.["content-type"]),
      },
      binaryData: req.body,
      assertScopeAccess,
    });

    return res.json({
      tenantId,
      transferId,
      row,
    });
  })
);

router.get(
  "/:evidenceId/download",
  requirePermission("inventory.read", {
    resolveScope: resolveTransferScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const transferId = parseTransferIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    const payload = await getInventoryTransferEvidenceContentForTenant({
      req,
      tenantId,
      transferId,
      evidenceId,
      assertScopeAccess,
    });

    const fileName = toSafeAttachmentFileName(payload.row?.fileName);
    res.setHeader("Content-Type", payload.row?.contentType || "application/octet-stream");
    if (payload.row?.fileSizeBytes !== null && payload.row?.fileSizeBytes !== undefined) {
      res.setHeader("Content-Length", String(payload.row.fileSizeBytes));
    }
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(payload.data);
  })
);

router.delete(
  "/:evidenceId",
  requirePermission("inventory.upsert", {
    resolveScope: resolveTransferScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const transferId = parseTransferIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    const userId = requireUserId(req);
    const row = await deleteInventoryTransferEvidenceByIdForTenant({
      req,
      input: {
        tenantId,
        transferId,
        evidenceId,
        userId,
      },
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      transferId,
      row,
    });
  })
);

export default router;
