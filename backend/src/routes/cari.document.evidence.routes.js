import express from "express";
import {
  assertScopeAccess,
  requirePermission,
} from "../middleware/rbac.js";
import { resolveCariDocumentScope } from "../services/cari.document.service.js";
import {
  createCariDocumentEvidenceDraft,
  deleteCariDocumentEvidenceByIdForTenant,
  getCariDocumentEvidenceByIdForTenant,
  getCariDocumentEvidenceContentForTenant,
  listCariDocumentEvidenceForTenant,
  uploadCariDocumentEvidenceContent,
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

function parseDocumentIdParam(req) {
  const documentId = parsePositiveInt(req.params?.documentId);
  if (!documentId) {
    throw badRequest("documentId must be a positive integer");
  }
  return documentId;
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

const resolveDocumentScope = async (req, tenantId) =>
  resolveCariDocumentScope(req.params?.documentId, tenantId);

router.get(
  "/",
  requirePermission("cari.doc.read", {
    resolveScope: resolveDocumentScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const rows = await listCariDocumentEvidenceForTenant({
      req,
      tenantId,
      documentId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      documentId,
      rows,
    });
  })
);

router.post(
  "/",
  requirePermission("cari.doc.update", {
    resolveScope: resolveDocumentScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const userId = requireUserId(req);
    const fileName = String(req.body?.fileName ?? req.body?.file_name ?? "").trim();
    if (!fileName) {
      throw badRequest("fileName is required");
    }

    const row = await createCariDocumentEvidenceDraft({
      req,
      input: {
        tenantId,
        documentId,
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
      documentId,
      row,
      uploadPath: `/api/v1/cari/documents/${documentId}/evidence/${row.id}/content`,
    });
  })
);

router.get(
  "/:evidenceId",
  requirePermission("cari.doc.read", {
    resolveScope: resolveDocumentScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    const row = await getCariDocumentEvidenceByIdForTenant({
      req,
      tenantId,
      documentId,
      evidenceId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      documentId,
      row,
    });
  })
);

router.put(
  "/:evidenceId/content",
  requirePermission("cari.doc.update", {
    resolveScope: resolveDocumentScope,
  }),
  evidenceBinaryUploadMiddleware,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    if (!(req.body instanceof Buffer)) {
      throw badRequest("Binary payload is required");
    }

    const row = await uploadCariDocumentEvidenceContent({
      req,
      input: {
        tenantId,
        documentId,
        evidenceId,
        contentType: sanitizeHeaderContentType(req.headers?.["content-type"]),
      },
      binaryData: req.body,
      assertScopeAccess,
    });

    return res.json({
      tenantId,
      documentId,
      row,
    });
  })
);

router.get(
  "/:evidenceId/download",
  requirePermission("cari.doc.read", {
    resolveScope: resolveDocumentScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    const payload = await getCariDocumentEvidenceContentForTenant({
      req,
      tenantId,
      documentId,
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
  requirePermission("cari.doc.update", {
    resolveScope: resolveDocumentScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const evidenceId = parseEvidenceIdParam(req);
    const userId = requireUserId(req);
    const row = await deleteCariDocumentEvidenceByIdForTenant({
      req,
      input: {
        tenantId,
        documentId,
        evidenceId,
        userId,
      },
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      documentId,
      row,
    });
  })
);

export default router;
