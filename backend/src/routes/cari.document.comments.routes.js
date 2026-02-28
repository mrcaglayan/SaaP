import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import { resolveCariDocumentScope } from "../services/cari.document.service.js";
import {
  createCariDocumentInternalComment,
  listCariDocumentInternalCommentsForTenant,
} from "../services/internalComments.service.js";
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

function parseCommentCreateInput(req) {
  const body = String(
    req.body?.body ?? req.body?.comment ?? req.body?.commentBody ?? ""
  ).trim();
  if (!body) {
    throw badRequest("body is required");
  }
  return { body };
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
    const rows = await listCariDocumentInternalCommentsForTenant({
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
    const input = parseCommentCreateInput(req);
    const row = await createCariDocumentInternalComment({
      req,
      input: {
        tenantId,
        documentId,
        userId,
        body: input.body,
      },
      assertScopeAccess,
    });
    return res.status(201).json({
      tenantId,
      documentId,
      row,
    });
  })
);

export default router;
