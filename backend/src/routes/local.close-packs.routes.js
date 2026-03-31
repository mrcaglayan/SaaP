import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import {
  createLocalClosePack,
  getLocalClosePackById,
  listLocalClosePacks,
  resolveLocalClosePackScope,
} from "../services/local.close-packs.service.js";
import {
  approveLocalClosePack,
  lockLocalClosePack,
  returnLocalClosePack,
  submitLocalClosePack,
} from "../services/local.close-pack.workflow.service.js";
import {
  approveLocalClosePackReopenRequest,
  createLocalClosePackReopenRequest,
  getLocalClosePackEntityReadinessByPackId,
  listLocalClosePackReopenRequests,
  rejectLocalClosePackReopenRequest,
} from "../services/local.close-reopen.service.js";
import {
  createLocalClosePackEvidenceDraft,
  deleteLocalClosePackEvidenceByIdForTenant,
  getLocalClosePackEvidenceContentForTenant,
  listLocalClosePackEvidenceForTenant,
  uploadLocalClosePackEvidenceContent,
} from "../services/local.close-pack.evidence.service.js";
import {
  createLocalClosePackInternalComment,
  listLocalClosePackInternalCommentsForTenant,
} from "../services/local.close-pack.comments.service.js";
import {
  listLocalClosePackAuditTrail,
  listLocalClosePackReportReviews,
  upsertLocalClosePackReportReview,
} from "../services/local.close-pack.workspace.service.js";
import {
  parseLocalClosePackActionInput,
  parseLocalClosePackAuditListInput,
  parseLocalClosePackCommentCreateInput,
  parseLocalClosePackCreateInput,
  parseLocalClosePackEvidenceIdParam,
  parseLocalClosePackIdParam,
  parseLocalClosePackListInput,
  parseLocalClosePackReportReviewInput,
} from "./local.close-packs.validators.js";
import {
  parseLocalClosePackReopenRequestCreateInput,
  parseLocalClosePackReopenRequestDecisionInput,
  parseLocalClosePackReopenRequestListInput,
} from "./local.close-reopen.validators.js";

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

function resolveScopeFromLocalClosePackInput(rawValue) {
  const closeScopeType = String(
    rawValue?.closeScopeType ?? rawValue?.close_scope_type ?? ""
  )
    .trim()
    .toUpperCase();
  const operatingUnitId = parsePositiveInt(
    rawValue?.operatingUnitId ?? rawValue?.operating_unit_id
  );
  if (closeScopeType === "OPERATING_UNIT" && operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }

  const legalEntityId = parsePositiveInt(
    rawValue?.legalEntityId ?? rawValue?.legal_entity_id
  );
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

/**
 * Register baseline local close-pack header routes for RP06.
 */
export function registerLocalClosePackRoutes(router) {
  router.get(
    "/local-close-packs",
    requirePermission("ouclose.read"),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackListInput(req);
      const result = await listLocalClosePacks({
        req,
        tenantId: input.tenantId,
        filters: input,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const row = await getLocalClosePackById({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      const entityReadiness = await getLocalClosePackEntityReadinessByPackId({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        row,
        entityReadiness,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/report-reviews",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const rows = await listLocalClosePackReportReviews({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        packId,
        rows,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/report-reviews",
    requirePermission("ouclose.prepare", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReportReviewInput(req);
      const row = await upsertLocalClosePackReportReview({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        packId: input.packId,
        row,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/evidence",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const rows = await listLocalClosePackEvidenceForTenant({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        packId,
        rows,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/evidence",
    requirePermission("ouclose.prepare", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const userId = parsePositiveInt(req.user?.userId);
      const packId = parseLocalClosePackIdParam(req);
      const fileName = String(req.body?.fileName ?? req.body?.file_name ?? "").trim();
      if (!fileName) {
        throw badRequest("fileName is required");
      }

      const row = await createLocalClosePackEvidenceDraft({
        req,
        input: {
          tenantId,
          packId,
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
        packId,
        row,
        uploadPath: `/api/v1/gl/local-close-packs/${packId}/evidence/${row.id}/content`,
      });
    })
  );

  router.put(
    "/local-close-packs/:packId/evidence/:evidenceId/content",
    requirePermission("ouclose.prepare", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    evidenceBinaryUploadMiddleware,
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const evidenceId = parseLocalClosePackEvidenceIdParam(req);
      if (!(req.body instanceof Buffer)) {
        throw badRequest("Binary payload is required");
      }

      const row = await uploadLocalClosePackEvidenceContent({
        req,
        input: {
          tenantId,
          packId,
          evidenceId,
          contentType: sanitizeHeaderContentType(req.headers?.["content-type"]),
        },
        binaryData: req.body,
        assertScopeAccess,
      });

      return res.json({
        tenantId,
        packId,
        row,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/evidence/:evidenceId/download",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const evidenceId = parseLocalClosePackEvidenceIdParam(req);
      const payload = await getLocalClosePackEvidenceContentForTenant({
        req,
        tenantId,
        packId,
        evidenceId,
        assertScopeAccess,
      });

      const fileName = toSafeAttachmentFileName(payload.row?.fileName);
      res.setHeader(
        "Content-Type",
        payload.row?.contentType || "application/octet-stream"
      );
      if (
        payload.row?.fileSizeBytes !== null &&
        payload.row?.fileSizeBytes !== undefined
      ) {
        res.setHeader("Content-Length", String(payload.row.fileSizeBytes));
      }
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(payload.data);
    })
  );

  router.delete(
    "/local-close-packs/:packId/evidence/:evidenceId",
    requirePermission("ouclose.prepare", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const userId = parsePositiveInt(req.user?.userId);
      const packId = parseLocalClosePackIdParam(req);
      const evidenceId = parseLocalClosePackEvidenceIdParam(req);
      const row = await deleteLocalClosePackEvidenceByIdForTenant({
        req,
        input: {
          tenantId,
          packId,
          evidenceId,
          userId,
        },
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        packId,
        row,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/comments",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const rows = await listLocalClosePackInternalCommentsForTenant({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        packId,
        rows,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/comments",
    requirePermission("ouclose.prepare", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackCommentCreateInput(req);
      const row = await createLocalClosePackInternalComment({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        tenantId: input.tenantId,
        packId: input.packId,
        row,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/audit",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackAuditListInput(req);
      const result = await listLocalClosePackAuditTrail({
        req,
        tenantId: input.tenantId,
        packId: input.packId,
        limit: input.limit,
        offset: input.offset,
        includePayload: input.includePayload,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        packId: input.packId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs",
    requirePermission("ouclose.prepare", {
      resolveScope: (req) => resolveScopeFromLocalClosePackInput(req.body),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackCreateInput(req);
      const row = await createLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        row,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/reopen-requests",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestListInput(req);
      const result = await listLocalClosePackReopenRequests({
        req,
        tenantId: input.tenantId,
        packId: input.packId,
        requestStatus: input.requestStatus,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/submit",
    requirePermission("ouclose.submit", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req);
      const result = await submitLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/return",
    requirePermission("ouclose.review", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req, {
        requireDecisionNote: true,
      });
      const result = await returnLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/approve",
    requirePermission("ouclose.approve", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req);
      const result = await approveLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/lock",
    requirePermission("ouclose.lock", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req);
      const result = await lockLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/reopen-requests",
    requirePermission("ouclose.request_reopen", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestCreateInput(req);
      const result = await createLocalClosePackReopenRequest({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/reopen-requests/:requestId/approve",
    requirePermission("ouclose.reopen", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestDecisionInput(req);
      const result = await approveLocalClosePackReopenRequest({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/reopen-requests/:requestId/reject",
    requirePermission("ouclose.reopen", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestDecisionInput(req);
      const result = await rejectLocalClosePackReopenRequest({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );
}

export default {
  registerLocalClosePackRoutes,
};
