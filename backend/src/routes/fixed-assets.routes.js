/**
 * Fixed-assets routes.
 *
 * Route declaration order is critical:
 *   1. Static prefixed families   (/categories, /depreciation-profiles,
 *      /custodians, /runs, /reports, /settings, /from-cari-document-line)
 *   2. Nested-prefixed families   (/transactions/:transactionId/...,
 *      /runs/:runId/...)
 *   3. Dynamic /:assetId routes   (detail, update, actions, evidence)
 *
 * This prevents Express from swallowing known static or nested paths
 * through the /:assetId param matcher.
 */

import express from "express";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { requirePermission } from "../middleware/rbac.js";
import {
  resolveLegalEntityScopeFromQuery,
  resolveLegalEntityScopeFromBody,
  resolveFixedAssetScope,
  resolveFixedAssetTransactionScope,
  resolveFixedAssetRunScope,
} from "../services/fixed-assets.scope.service.js";
import {
  parseCategoryListFilters,
  parseCategoryCreateInput,
  parseCategoryUpdateInput,
  parseProfileListFilters,
  parseProfileCreateInput,
  parseProfileUpdateInput,
  parseCustodianListFilters,
  parseCustodianCreateInput,
  parseCustodianUpdateInput,
} from "./fixed-assets.validators.js";
import {
  listCategories,
  createCategory,
  updateCategory,
  listProfiles,
  createProfile,
  updateProfile,
  listCustodians,
  createCustodian,
  updateCustodian,
} from "../services/fixed-assets.service.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// 1. STATIC PREFIXED ROUTES
//    Declared first so they are never captured by /:assetId.
// ═══════════════════════════════════════════════════════════════════

// ── Categories ────────────────────────────────────────────────────
router.get(
  "/categories",
  requirePermission("fixed_assets.settings.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCategoryListFilters(req);
    const result = await listCategories(filters);
    return res.json(result);
  })
);

router.post(
  "/categories",
  requirePermission("fixed_assets.settings.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCategoryCreateInput(req);
    const category = await createCategory({ payload });
    return res.status(201).json(category);
  })
);

router.patch(
  "/categories/:categoryId",
  requirePermission("fixed_assets.settings.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const { tenantId, categoryId, updates } = parseCategoryUpdateInput(req);
    const userId = req.user?.userId || null;
    const category = await updateCategory({ tenantId, categoryId, updates, userId });
    return res.json(category);
  })
);

// ── Depreciation Profiles ─────────────────────────────────────────
router.get(
  "/depreciation-profiles",
  requirePermission("fixed_assets.settings.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseProfileListFilters(req);
    const result = await listProfiles(filters);
    return res.json(result);
  })
);

router.post(
  "/depreciation-profiles",
  requirePermission("fixed_assets.settings.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseProfileCreateInput(req);
    const profile = await createProfile({ payload });
    return res.status(201).json(profile);
  })
);

router.patch(
  "/depreciation-profiles/:profileId",
  requirePermission("fixed_assets.settings.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const { tenantId, profileId, updates } = parseProfileUpdateInput(req);
    const userId = req.user?.userId || null;
    const profile = await updateProfile({ tenantId, profileId, updates, userId });
    return res.json(profile);
  })
);

// ── Custodians ────────────────────────────────────────────────────
router.get(
  "/custodians",
  requirePermission("fixed_assets.custodian.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCustodianListFilters(req);
    const result = await listCustodians(filters);
    return res.json(result);
  })
);

router.post(
  "/custodians",
  requirePermission("fixed_assets.custodian.write", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCustodianCreateInput(req);
    const custodian = await createCustodian({ payload });
    return res.status(201).json(custodian);
  })
);

router.patch(
  "/custodians/:custodianId",
  requirePermission("fixed_assets.custodian.write", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const { tenantId, custodianId, updates } = parseCustodianUpdateInput(req);
    const userId = req.user?.userId || null;
    const custodian = await updateCustodian({ tenantId, custodianId, updates, userId });
    return res.json(custodian);
  })
);

// ── Depreciation Runs (static /runs prefix) ──────────────────────
// STEP-FA31 to STEP-FA35 land real handlers here.
router.get(
  "/runs",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.json({ rows: [], total: 0 });
  })
);

router.post(
  "/runs/preview",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/runs",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.get(
  "/runs/:runId",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) =>
      resolveFixedAssetRunScope(req.params?.runId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.delete(
  "/runs/:runId",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) =>
      resolveFixedAssetRunScope(req.params?.runId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/runs/:runId/post",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) =>
      resolveFixedAssetRunScope(req.params?.runId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/runs/:runId/reverse",
  requirePermission("fixed_assets.depreciation.reverse", {
    resolveScope: async (req) =>
      resolveFixedAssetRunScope(req.params?.runId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── Reports (static /reports prefix) ─────────────────────────────
// STEP-FA47 lands real handlers here.
router.get(
  "/reports/:reportName",
  requirePermission("fixed_assets.report.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.get(
  "/reports/:reportName/export",
  requirePermission("fixed_assets.report.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── CARI capitalization entry point ──────────────────────────────
// STEP-FA25 lands the real handler here.
router.post(
  "/from-cari-document-line",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 2. NESTED-PREFIXED ROUTES
//    /transactions/:transactionId/... and /runs/:runId/evidence
//    must be declared before the generic /:assetId block.
// ═══════════════════════════════════════════════════════════════════

// ── Non-run transaction reversal ──────────────────────────────────
// STEP-FA41 lands the real handler here.
router.post(
  "/transactions/:transactionId/reverse",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req) =>
      resolveFixedAssetTransactionScope(
        req.params?.transactionId,
        req.tenantId
      ),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── Evidence: transaction-level ───────────────────────────────────
// STEP-FA42 mounts the real nested evidence router here.
// Placeholder ensures route ordering is locked now.

// ── Evidence: run-level ───────────────────────────────────────────
// STEP-FA42 mounts the real nested evidence router here.
// Placeholder ensures route ordering is locked now.

// ═══════════════════════════════════════════════════════════════════
// 3. ASSET REGISTER LIST (before /:assetId so GET / is not captured)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/",
  requirePermission("fixed_assets.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.json({ rows: [], total: 0 });
  })
);

// ── Asset create ──────────────────────────────────────────────────
// STEP-FA20 lands the real handler here.
router.post(
  "/",
  requirePermission("fixed_assets.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 4. DYNAMIC /:assetId ROUTES
//    These MUST come last to avoid swallowing known static paths.
// ═══════════════════════════════════════════════════════════════════

// ── Asset detail ──────────────────────────────────────────────────
router.get(
  "/:assetId",
  requirePermission("fixed_assets.read", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── Asset update (DRAFT only) ─────────────────────────────────────
router.patch(
  "/:assetId",
  requirePermission("fixed_assets.upsert", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── Asset transactions list ───────────────────────────────────────
router.get(
  "/:assetId/transactions",
  requirePermission("fixed_assets.read", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.json({ rows: [], total: 0 });
  })
);

// ── Asset depreciation schedule ───────────────────────────────────
router.get(
  "/:assetId/depreciation-schedule",
  requirePermission("fixed_assets.read", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.json({ rows: [], total: 0 });
  })
);

// ── Asset lifecycle actions ───────────────────────────────────────
router.post(
  "/:assetId/activate",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/suspend",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/reactivate",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/physical-move",
  requirePermission("fixed_assets.transfer", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/ownership-transfer",
  requirePermission("fixed_assets.transfer", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/writeoff",
  requirePermission("fixed_assets.dispose", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── Sale staged workflow ──────────────────────────────────────────
router.post(
  "/:assetId/sale/create-draft-ar-document",
  requirePermission("fixed_assets.dispose", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/sale/link-ar-document",
  requirePermission("fixed_assets.dispose", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.patch(
  "/:assetId/sale/draft-ar-document",
  requirePermission("fixed_assets.dispose", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

router.post(
  "/:assetId/sale/finalize",
  requirePermission("fixed_assets.dispose", {
    resolveScope: async (req) =>
      resolveFixedAssetScope(req.params?.assetId, req.tenantId),
  }),
  asyncHandler(async (_req, res) => {
    return res.status(501).json({ message: "Not implemented" });
  })
);

// ── Evidence: asset-level ─────────────────────────────────────────
// STEP-FA42 mounts the real nested evidence router here.
// Placeholder ensures route ordering is locked now.

export default router;
