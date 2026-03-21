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
import { query } from "../db.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  assertScopeAccess,
  assertSecondaryPermission,
  requirePermission,
} from "../middleware/rbac.js";
import {
  resolveLegalEntityScopeFromQuery,
  resolveLegalEntityScopeFromBody,
  resolveFixedAssetScope,
  resolveFixedAssetTransactionScope,
  resolveFixedAssetRunScope,
} from "../services/fixed-assets.scope.service.js";
import { resolveCariDocumentScope } from "../services/cari.document.service.js";
import {
  parseRegisterListFilters,
  parseAssetDetailParams,
  parseAssetDepreciationScheduleInput,
  parseDepreciationRunListInput,
  parseDepreciationRunParams,
  parseDepreciationRunPostInput,
  parseDepreciationRunReverseInput,
  parseFixedAssetTransactionReverseInput,
  parseDepreciationRunPreviewInput,
  parseDepreciationRunCreateInput,
  parseCariEligibleApLineReadInput,
  parseCariDocumentLineCapitalizationInput,
  parseActivateAssetInput,
  parseSuspendAssetInput,
  parseReactivateAssetInput,
  parsePhysicalMoveInput,
  parseOwnershipTransferInput,
  parseWriteoffInput,
  parseSaleCreateDraftArInput,
  parseSaleLinkArInput,
  parseSaleUpdateDraftArInput,
  parseSaleFinalizeInput,
  parseAssetCreateInput,
  parseAssetDraftUpdateInput,
  parseCategoryListFilters,
  parseCategoryCreateInput,
  parseCategoryUpdateInput,
  parseProfileListFilters,
  parseProfileCreateInput,
  parseProfileUpdateInput,
  parseCustodianListFilters,
  parseCustodianCreateInput,
  parseCustodianUpdateInput,
  parseReportFilters,
} from "./fixed-assets.validators.js";
import {
  listAssets,
  getAssetDetail,
  listCariEligibleApLinesForFa06,
  createAssetsFromCariDocumentLineFa06,
  activateAsset,
  suspendAsset,
  reactivateAsset,
  physicalMoveAsset,
  ownershipTransferAsset,
  writeoffAsset,
  saleCreateDraftArDocument,
  saleLinkArDocument,
  saleUpdateDraftArDocument,
  saleFinalizeAsset,
  reverseFixedAssetTransaction,
  createAssetDraft,
  updateAssetDraft,
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
import {
  getAssetDepreciationSchedule,
  listDepreciationRuns,
  getDepreciationRunDetail,
  deleteDepreciationRunDraft,
  postDepreciationRun,
  reverseDepreciationRun,
  previewDepreciationRun,
  createDepreciationRunDraft,
} from "../services/fixed-assets.depreciation.service.js";
import { getReportHandler } from "../services/fixed-assets.reporting.service.js";
import fixedAssetsEvidenceRoutes from "./fixed-assets.evidence.routes.js";

const router = express.Router();

function resolveSourceCariDocumentIdFromQuery(req) {
  return req.query?.sourceCariDocumentId
    ?? req.query?.source_cari_document_id
    ?? req.query?.cariDocumentId
    ?? req.query?.documentId
    ?? null;
}

function resolveSourceCariDocumentIdFromBody(req) {
  return req.body?.sourceCariDocumentId
    ?? req.body?.source_cari_document_id
    ?? req.body?.cariDocumentId
    ?? req.body?.documentId
    ?? null;
}

function resolveSaleLinkCariDocumentIdFromBody(req) {
  return req.body?.cariDocumentId
    ?? req.body?.cari_document_id
    ?? null;
}

async function resolveSaleLinkCariDocumentScope(req, tenantId) {
  const cariDocumentId = parsePositiveInt(resolveSaleLinkCariDocumentIdFromBody(req));
  if (!cariDocumentId || !tenantId) {
    return null;
  }
  return resolveCariDocumentScope(cariDocumentId, tenantId);
}

async function resolvePendingSaleCariDocumentScope(req, tenantId) {
  const assetId = parsePositiveInt(req.params?.assetId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!assetId || !normalizedTenantId) {
    return null;
  }

  const result = await query(
    `SELECT pending_sale_cari_document_id
       FROM fixed_assets
      WHERE tenant_id = ? AND id = ?
      LIMIT 1`,
    [normalizedTenantId, assetId]
  );
  const pendingCariDocumentId = parsePositiveInt(
    result.rows?.[0]?.pending_sale_cari_document_id
  );
  if (!pendingCariDocumentId) {
    return null;
  }

  return resolveCariDocumentScope(pendingCariDocumentId, normalizedTenantId);
}

async function resolveFixedAssetRouteScope(req, tenantId) {
  return resolveFixedAssetScope(req.params?.assetId, tenantId);
}

async function resolveFixedAssetTransactionRouteScope(req, tenantId) {
  return resolveFixedAssetTransactionScope(req.params?.transactionId, tenantId);
}

async function resolveFixedAssetRunRouteScope(req, tenantId) {
  return resolveFixedAssetRunScope(req.params?.runId, tenantId);
}

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
  asyncHandler(async (req, res) => {
    const filters = parseDepreciationRunListInput(req);
    const result = await listDepreciationRuns(filters);
    return res.json(result);
  })
);

router.post(
  "/runs/preview",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const input = parseDepreciationRunPreviewInput(req);
    const result = await previewDepreciationRun(input);
    return res.json(result);
  })
);

router.post(
  "/runs",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const input = parseDepreciationRunCreateInput(req);
    const result = await createDepreciationRunDraft(input);
    return res.status(201).json(result);
  })
);

router.get(
  "/runs/:runId",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: resolveFixedAssetRunRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseDepreciationRunParams(req);
    const result = await getDepreciationRunDetail(input);
    return res.json(result);
  })
);

router.delete(
  "/runs/:runId",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: resolveFixedAssetRunRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseDepreciationRunParams(req);
    const result = await deleteDepreciationRunDraft(input);
    return res.json(result);
  })
);

router.post(
  "/runs/:runId/post",
  requirePermission("fixed_assets.depreciation.run", {
    resolveScope: resolveFixedAssetRunRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseDepreciationRunPostInput(req);
    const result = await postDepreciationRun(input);
    return res.json(result);
  })
);

router.post(
  "/runs/:runId/reverse",
  requirePermission("fixed_assets.depreciation.reverse", {
    resolveScope: resolveFixedAssetRunRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseDepreciationRunReverseInput(req);
    const result = await reverseDepreciationRun(input);
    return res.json(result);
  })
);

// ── Reports (static /reports prefix) ─────────────────────────────
router.get(
  "/reports/:reportName",
  requirePermission("fixed_assets.report.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseReportFilters(req);
    const handler = getReportHandler(filters.reportName);
    const result = await handler.report(filters);
    return res.json(result);
  })
);

router.get(
  "/reports/:reportName/export",
  requirePermission("fixed_assets.report.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseReportFilters(req);
    const handler = getReportHandler(filters.reportName);
    const result = await handler.export(filters);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    res.setHeader("X-Export-Row-Count", String(result.rowCount));
    return res.status(200).send(result.csv);
  })
);

// ── CARI capitalization entry point ──────────────────────────────
// STEP-FA25 lands the real handler here.
router.get(
  "/from-cari-document-line",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req, tenantId) =>
      resolveCariDocumentScope(resolveSourceCariDocumentIdFromQuery(req), tenantId),
  }),
  asyncHandler(async (req, res) => {
    await assertSecondaryPermission(req, "cari.doc.read");
    const input = parseCariEligibleApLineReadInput(req);
    const result = await listCariEligibleApLinesForFa06({
      req,
      ...input,
      assertScopeAccess,
    });
    return res.json(result);
  })
);

router.post(
  "/from-cari-document-line",
  requirePermission("fixed_assets.post", {
    resolveScope: async (req, tenantId) =>
      resolveCariDocumentScope(resolveSourceCariDocumentIdFromBody(req), tenantId),
  }),
  asyncHandler(async (req, res) => {
    await assertSecondaryPermission(req, "cari.doc.read");
    const input = parseCariDocumentLineCapitalizationInput(req);
    const result = await createAssetsFromCariDocumentLineFa06({
      req,
      ...input,
      assertScopeAccess,
    });
    return res.status(201).json(result);
  })
);

// ═══════════════════════════════════════════════════════════════════
// 2. NESTED-PREFIXED ROUTES
//    /transactions/:transactionId/... and /runs/:runId/evidence
//    must be declared before the generic /:assetId block.
// ═══════════════════════════════════════════════════════════════════

// ── Non-run transaction reversal ──────────────────────────────────
// STEP-FA41 lands the real handler here.
// Primary guard is fixed_assets.post (baseline mutation permission).
// The handler additionally asserts the owning permission family for the
// original transaction type so that e.g. reversing a TRANSFER requires
// fixed_assets.transfer, and reversing a SALE requires fixed_assets.dispose.
const REVERSAL_PERMISSION_BY_TX_TYPE = {
  OWNERSHIP_TRANSFER: "fixed_assets.transfer",
  PHYSICAL_MOVE: "fixed_assets.transfer",
  SALE: "fixed_assets.dispose",
  WRITEOFF: "fixed_assets.dispose",
};

router.post(
  "/transactions/:transactionId/reverse",
  requirePermission("fixed_assets.post", {
    resolveScope: resolveFixedAssetTransactionRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseFixedAssetTransactionReverseInput(req);

    // Look up the original transaction type and assert type-specific permission
    if (input.transactionId) {
      const txRow = await query(
        `SELECT transaction_type FROM fixed_asset_transactions WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [input.transactionId, input.tenantId]
      );
      const txType = String(txRow.rows?.[0]?.transaction_type || "").toUpperCase();
      const additionalPerm = REVERSAL_PERMISSION_BY_TX_TYPE[txType];
      if (additionalPerm) {
        await assertSecondaryPermission(req, additionalPerm);
      }
    }

    const result = await reverseFixedAssetTransaction(input);
    return res.json(result);
  })
);

// ── Evidence: transaction-level ───────────────────────────────────
router.use("/transactions/:transactionId/evidence", fixedAssetsEvidenceRoutes);

// ── Evidence: run-level ───────────────────────────────────────────
router.use("/runs/:runId/evidence", fixedAssetsEvidenceRoutes);

// ═══════════════════════════════════════════════════════════════════
// 3. ASSET REGISTER LIST (before /:assetId so GET / is not captured)
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/",
  requirePermission("fixed_assets.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseRegisterListFilters(req);
    const result = await listAssets(filters);
    return res.json(result);
  })
);

// ── Asset create ──────────────────────────────────────────────────
router.post(
  "/",
  requirePermission("fixed_assets.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const input = parseAssetCreateInput(req);
    const asset = await createAssetDraft(input);
    return res.status(201).json(asset);
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
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const { tenantId, assetId } = parseAssetDetailParams(req);
    const detail = await getAssetDetail({ tenantId, assetId });
    return res.json(detail);
  })
);

// ── Asset update (DRAFT only) ─────────────────────────────────────
router.patch(
  "/:assetId",
  requirePermission("fixed_assets.upsert", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const { tenantId, assetId, updates, userId } = parseAssetDraftUpdateInput(req);
    const asset = await updateAssetDraft({ tenantId, assetId, updates, userId });
    return res.json(asset);
  })
);

// ── Asset transactions list ───────────────────────────────────────
router.get(
  "/:assetId/transactions",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const { tenantId, assetId } = parseAssetDetailParams(req);
    const result = await query(
      `SELECT id, asset_id, legal_entity_id, transaction_type, status,
              effective_date, posting_date, book_id, fiscal_period_id,
              currency_code, depreciation_kind,
              gross_amount_txn, gross_amount_base,
              accum_depr_amount_txn, accum_depr_amount_base,
              nbv_amount_txn, nbv_amount_base,
              reversed_transaction_id, reversal_transaction_id,
              journal_entry_id, note, created_at
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
        ORDER BY effective_date DESC, id DESC`,
      [tenantId, assetId]
    );
    return res.json({ rows: result.rows, total: result.rows.length });
  })
);

// ── Asset depreciation schedule ───────────────────────────────────
router.get(
  "/:assetId/depreciation-schedule",
  requirePermission("fixed_assets.read", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseAssetDepreciationScheduleInput(req);
    const result = await getAssetDepreciationSchedule(input);
    return res.json(result);
  })
);

// ── Asset lifecycle actions ───────────────────────────────────────
router.post(
  "/:assetId/activate",
  requirePermission("fixed_assets.post", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseActivateAssetInput(req);
    const asset = await activateAsset(input);
    return res.json(asset);
  })
);

router.post(
  "/:assetId/suspend",
  requirePermission("fixed_assets.post", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseSuspendAssetInput(req);
    const asset = await suspendAsset(input);
    return res.json(asset);
  })
);

router.post(
  "/:assetId/reactivate",
  requirePermission("fixed_assets.post", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseReactivateAssetInput(req);
    const asset = await reactivateAsset(input);
    return res.json(asset);
  })
);

router.post(
  "/:assetId/physical-move",
  requirePermission("fixed_assets.transfer", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parsePhysicalMoveInput(req);
    const result = await physicalMoveAsset(input);
    return res.json(result);
  })
);

router.post(
  "/:assetId/ownership-transfer",
  requirePermission("fixed_assets.transfer", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseOwnershipTransferInput(req);
    const result = await ownershipTransferAsset(input);
    return res.json(result);
  })
);

router.post(
  "/:assetId/writeoff",
  requirePermission("fixed_assets.dispose", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    const input = parseWriteoffInput(req);
    const result = await writeoffAsset(input);
    return res.json(result);
  })
);

// ── Sale staged workflow ──────────────────────────────────────────
router.post(
  "/:assetId/sale/create-draft-ar-document",
  requirePermission("fixed_assets.dispose", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    await assertSecondaryPermission(req, "cari.doc.create");
    const input = parseSaleCreateDraftArInput(req);
    const result = await saleCreateDraftArDocument({ req, ...input, assertScopeAccess });
    return res.status(201).json(result);
  })
);

router.post(
  "/:assetId/sale/link-ar-document",
  requirePermission("fixed_assets.dispose", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    await assertSecondaryPermission(req, "cari.doc.read", {
      resolveScope: resolveSaleLinkCariDocumentScope,
      matchPrimaryScope: false,
    });
    const input = parseSaleLinkArInput(req);
    const result = await saleLinkArDocument({ req, ...input, assertScopeAccess });
    return res.json(result);
  })
);

router.patch(
  "/:assetId/sale/draft-ar-document",
  requirePermission("fixed_assets.dispose", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    await assertSecondaryPermission(req, "cari.doc.update", {
      resolveScope: resolvePendingSaleCariDocumentScope,
      matchPrimaryScope: false,
    });
    const input = parseSaleUpdateDraftArInput(req);
    const result = await saleUpdateDraftArDocument({ req, ...input, assertScopeAccess });
    return res.json(result);
  })
);

router.post(
  "/:assetId/sale/finalize",
  requirePermission("fixed_assets.dispose", {
    resolveScope: resolveFixedAssetRouteScope,
  }),
  asyncHandler(async (req, res) => {
    await assertSecondaryPermission(req, "cari.doc.post", {
      resolveScope: resolvePendingSaleCariDocumentScope,
      matchPrimaryScope: false,
    });
    const input = parseSaleFinalizeInput(req);
    const result = await saleFinalizeAsset({ req, ...input, assertScopeAccess });
    return res.json(result);
  })
);

// ── Evidence: asset-level ─────────────────────────────────────────
router.use("/:assetId/evidence", fixedAssetsEvidenceRoutes);

export default router;
