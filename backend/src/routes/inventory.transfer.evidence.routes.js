import express from "express";
import {
  assertScopeAccess,
  hasScopeAccess,
  requirePermission,
} from "../middleware/rbac.js";
import {
  resolveInventoryTransferParticipantScopes,
  resolveInventoryTransferScope,
} from "../services/inventory.transfer.service.js";
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

function resolveInventoryReadScopeFromQuery(req) {
  const operatingUnitId = parsePositiveInt(req.query?.operatingUnitId);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

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

function missingPermission(permissionCode) {
  const err = new Error(`Missing permission: ${permissionCode}`);
  err.status = 403;
  return err;
}

function hasResolvedScopeAccess(req, scope) {
  if (!scope?.scopeType || !parsePositiveInt(scope?.scopeId)) {
    return false;
  }
  const scopeType = String(scope.scopeType).trim().toUpperCase();
  if (scopeType === "OPERATING_UNIT") {
    return hasScopeAccess(req, "operating_unit", scope.scopeId);
  }
  if (scopeType === "LEGAL_ENTITY") {
    return hasScopeAccess(req, "legal_entity", scope.scopeId);
  }
  return false;
}

const resolveTransferScope = async (req, tenantId) =>
  resolveInventoryReadScopeFromQuery(req) ||
  resolveInventoryTransferScope(req.params?.transferId, tenantId);

async function assertTransferParticipantPermission(req, tenantId, permissionCode) {
  // Evidence writes are participant-scoped: either the source or target owner
  // may attach/delete supporting documents for the transfer.
  const scopes = await resolveInventoryTransferParticipantScopes(
    req.params?.transferId,
    tenantId
  );
  if (scopes.length === 0) {
    return;
  }
  if (scopes.some((scope) => hasResolvedScopeAccess(req, scope))) {
    return;
  }
  throw missingPermission(permissionCode);
}

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
  requirePermission("inventory.transfer.evidence.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    await assertTransferParticipantPermission(
      req,
      tenantId,
      "inventory.transfer.evidence.upsert"
    );
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
  requirePermission("inventory.transfer.evidence.upsert"),
  evidenceBinaryUploadMiddleware,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    await assertTransferParticipantPermission(
      req,
      tenantId,
      "inventory.transfer.evidence.upsert"
    );
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
  requirePermission("inventory.transfer.evidence.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    await assertTransferParticipantPermission(
      req,
      tenantId,
      "inventory.transfer.evidence.upsert"
    );
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
    });
    return res.json({
      tenantId,
      transferId,
      row,
    });
  })
);

export default router;
