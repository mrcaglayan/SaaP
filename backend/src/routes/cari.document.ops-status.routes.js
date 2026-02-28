import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import { resolveCariDocumentScope } from "../services/cari.document.service.js";
import {
  getCariDocumentOpsStatusForTenant,
  upsertCariDocumentOpsStatus,
} from "../services/opsStatus.service.js";
import { requireTenantId, requireUserId } from "./cash.validators.common.js";
import { asyncHandler, badRequest, parsePositiveInt } from "./_utils.js";

const router = express.Router({ mergeParams: true });

function parseDocumentIdParam(req) {
  const documentId = parsePositiveInt(req.params?.documentId);
  if (!documentId) {
    throw badRequest("documentId must be a positive integer");
  }
  return documentId;
}

function parseOpsStatusUpsertInput(req) {
  const opsStatus = String(
    req.body?.opsStatus ?? req.body?.ops_status ?? ""
  ).trim();
  if (!opsStatus) {
    throw badRequest("opsStatus is required");
  }
  return {
    opsStatus,
    blockedReason: req.body?.blockedReason ?? req.body?.blocked_reason ?? null,
    note: req.body?.note ?? null,
  };
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
    const row = await getCariDocumentOpsStatusForTenant({
      req,
      tenantId,
      documentId,
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
  "/",
  requirePermission("cari.doc.update", {
    resolveScope: resolveDocumentScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const documentId = parseDocumentIdParam(req);
    const userId = requireUserId(req);
    const input = parseOpsStatusUpsertInput(req);
    const row = await upsertCariDocumentOpsStatus({
      req,
      input: {
        tenantId,
        documentId,
        userId,
        opsStatus: input.opsStatus,
        blockedReason: input.blockedReason,
        note: input.note,
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
