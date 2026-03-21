/**
 * Fixed-assets evidence routes.
 *
 * One merged-params router serving evidence CRUD for three surfaces:
 *   - asset evidence       (mounted at /:assetId/evidence)
 *   - transaction evidence (mounted at /transactions/:transactionId/evidence)
 *   - run evidence         (mounted at /runs/:runId/evidence)
 *
 * The router detects which surface is active from the merged params
 * and delegates to the shared fixed-assets evidence service functions
 * with the correct source-ref type.
 */

import express from "express";
import {
  assertScopeAccess,
  assertSecondaryPermission,
  requirePermission,
} from "../middleware/rbac.js";
import {
  resolveFixedAssetScope,
  resolveFixedAssetTransactionScope,
  resolveFixedAssetRunScope,
} from "../services/fixed-assets.scope.service.js";
import {
  FIXED_ASSET,
  FIXED_ASSET_TRANSACTION,
  FIXED_ASSET_DEPRECIATION_RUN,
} from "../utils/source-ref-types.js";
import {
  createFixedAssetEvidenceDraft,
  deleteFixedAssetEvidenceByIdForTenant,
  getFixedAssetEvidenceByIdForTenant,
  getFixedAssetEvidenceContentForTenant,
  listFixedAssetEvidenceForTenant,
  uploadFixedAssetEvidenceContent,
} from "../services/evidence.service.js";
import { requireTenantId, requireUserId } from "./cash.validators.common.js";
import { asyncHandler, badRequest, parsePositiveInt } from "./_utils.js";

const router = express.Router({ mergeParams: true });

// ── Helpers ──────────────────────────────────────────────────────

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

/**
 * Detect evidence surface from merged params.
 * Returns { sourceRefType, sourceRefId, permission, resolveScope }.
 */
function resolveEvidenceContext(req) {
  const transactionId = parsePositiveInt(req.params?.transactionId);
  if (transactionId) {
    return {
      sourceRefType: FIXED_ASSET_TRANSACTION,
      sourceRefId: transactionId,
      readPermission: "fixed_assets.read",
      writePermission: "fixed_assets.post",
      resolveScope: async (r, tenantId) =>
        resolveFixedAssetTransactionScope(r.params?.transactionId, tenantId),
    };
  }

  const runId = parsePositiveInt(req.params?.runId);
  if (runId) {
    return {
      sourceRefType: FIXED_ASSET_DEPRECIATION_RUN,
      sourceRefId: runId,
      readPermission: "fixed_assets.depreciation.run",
      writePermission: "fixed_assets.depreciation.run",
      resolveScope: async (r, tenantId) =>
        resolveFixedAssetRunScope(r.params?.runId, tenantId),
    };
  }

  const assetId = parsePositiveInt(req.params?.assetId);
  if (assetId) {
    return {
      sourceRefType: FIXED_ASSET,
      sourceRefId: assetId,
      readPermission: "fixed_assets.read",
      writePermission: "fixed_assets.upsert",
      resolveScope: async (r, tenantId) =>
        resolveFixedAssetScope(r.params?.assetId, tenantId),
    };
  }

  throw badRequest("Cannot determine evidence context from request params");
}

/**
 * Dynamic scope resolver that picks the correct fixed-assets scope
 * resolver based on the merged params present in the request.
 */
function resolveDynamicScope(req, tenantId) {
  const ctx = resolveEvidenceContext(req);
  return ctx.resolveScope(req, tenantId);
}

// ── Routes ───────────────────────────────────────────────────────

// List evidence
router.get(
  "/",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveDynamicScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const ctx = resolveEvidenceContext(req);
    const rows = await listFixedAssetEvidenceForTenant({
      req,
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      rows,
    });
  })
);

// Create evidence metadata (draft)
router.post(
  "/",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveDynamicScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const userId = requireUserId(req);
    const ctx = resolveEvidenceContext(req);
    await assertSecondaryPermission(req, ctx.writePermission);
    const fileName = String(req.body?.fileName ?? req.body?.file_name ?? "").trim();
    if (!fileName) {
      throw badRequest("fileName is required");
    }

    const row = await createFixedAssetEvidenceDraft({
      req,
      input: {
        tenantId,
        sourceRefType: ctx.sourceRefType,
        sourceRefId: ctx.sourceRefId,
        userId,
        fileName,
        contentType: req.body?.contentType ?? req.body?.content_type ?? null,
        displayName: req.body?.displayName ?? req.body?.display_name ?? null,
        note: req.body?.note ?? null,
      },
      assertScopeAccess,
    });

    const basePath = buildUploadBasePath(req, ctx);
    return res.status(201).json({
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      row,
      uploadPath: `${basePath}/${row.id}/content`,
    });
  })
);

// Get single evidence record
router.get(
  "/:evidenceId",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveDynamicScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const ctx = resolveEvidenceContext(req);
    const evidenceId = parseEvidenceIdParam(req);
    const row = await getFixedAssetEvidenceByIdForTenant({
      req,
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      evidenceId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      row,
    });
  })
);

// Upload evidence content
router.put(
  "/:evidenceId/content",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveDynamicScope,
  }),
  evidenceBinaryUploadMiddleware,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const ctx = resolveEvidenceContext(req);
    await assertSecondaryPermission(req, ctx.writePermission);
    const evidenceId = parseEvidenceIdParam(req);
    if (!(req.body instanceof Buffer)) {
      throw badRequest("Binary payload is required");
    }

    const row = await uploadFixedAssetEvidenceContent({
      req,
      input: {
        tenantId,
        sourceRefType: ctx.sourceRefType,
        sourceRefId: ctx.sourceRefId,
        evidenceId,
        contentType: sanitizeHeaderContentType(req.headers?.["content-type"]),
      },
      binaryData: req.body,
      assertScopeAccess,
    });

    return res.json({
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      row,
    });
  })
);

// Download evidence content
router.get(
  "/:evidenceId/download",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveDynamicScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const ctx = resolveEvidenceContext(req);
    const evidenceId = parseEvidenceIdParam(req);
    const payload = await getFixedAssetEvidenceContentForTenant({
      req,
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
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

// Delete evidence
router.delete(
  "/:evidenceId",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveDynamicScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const ctx = resolveEvidenceContext(req);
    await assertSecondaryPermission(req, ctx.writePermission);
    const evidenceId = parseEvidenceIdParam(req);
    const userId = requireUserId(req);
    const row = await deleteFixedAssetEvidenceByIdForTenant({
      req,
      input: {
        tenantId,
        sourceRefType: ctx.sourceRefType,
        sourceRefId: ctx.sourceRefId,
        evidenceId,
        userId,
      },
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      sourceRefType: ctx.sourceRefType,
      sourceRefId: ctx.sourceRefId,
      row,
    });
  })
);

// ── Upload path builder ──────────────────────────────────────────

function buildUploadBasePath(req, ctx) {
  const prefix = "/api/v1/fixed-assets";
  if (ctx.sourceRefType === FIXED_ASSET_TRANSACTION) {
    return `${prefix}/transactions/${ctx.sourceRefId}/evidence`;
  }
  if (ctx.sourceRefType === FIXED_ASSET_DEPRECIATION_RUN) {
    return `${prefix}/runs/${ctx.sourceRefId}/evidence`;
  }
  return `${prefix}/${ctx.sourceRefId}/evidence`;
}

export default router;
