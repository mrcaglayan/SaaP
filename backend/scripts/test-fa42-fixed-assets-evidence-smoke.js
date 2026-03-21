import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { deleteEvidenceBinary } from "../src/services/evidence.storage.adapter.js";
import {
  createFixedAssetEvidenceDraft,
  deleteFixedAssetEvidenceByIdForTenant,
  getFixedAssetEvidenceByIdForTenant,
  getFixedAssetEvidenceContentForTenant,
  listFixedAssetEvidenceForTenant,
  uploadFixedAssetEvidenceContent,
} from "../src/services/evidence.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertThrowsAsync(fn, expectedMessage) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `Expected async error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected async error containing "${expectedMessage}", got "${message}"`
  );
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function buildReq(tenantId, userId) {
  return {
    user: { tenantId, userId },
    body: {},
    query: {},
    params: {},
  };
}

// ── Context loaders ──────────────────────────────────────────────

async function loadSmokeContext() {
  const result = await query(
    `SELECT le.tenant_id, le.id AS legal_entity_id, u.id AS user_id
       FROM legal_entities le
       JOIN users u ON u.tenant_id = le.tenant_id
      WHERE le.status = 'ACTIVE'
      ORDER BY le.id ASC
      LIMIT 1`
  );
  const row = result.rows?.[0] || null;
  assert(row, "Expected one active legal entity with at least one user");
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    userId: Number(row.user_id),
  };
}

async function ensureCategory(tenantId, legalEntityId) {
  const existing = await query(
    `SELECT id FROM fixed_asset_categories
      WHERE tenant_id = ? AND legal_entity_id = ? AND status = 'ACTIVE'
      ORDER BY id ASC LIMIT 1`,
    [tenantId, legalEntityId]
  );
  if (existing.rows?.[0]) return Number(existing.rows[0].id);

  const insertResult = await query(
    `INSERT INTO fixed_asset_categories (
        tenant_id, legal_entity_id, code, name, status
     ) VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, uniqueCode("FA42CAT"), "FA42 Smoke Category"]
  );
  const id = Number(insertResult.rows?.insertId || 0);
  assert(id > 0, "Expected category insert id");
  return id;
}

async function insertAssetFixture(context, categoryId) {
  const assetNo = uniqueCode("FA42-EVID-");
  const result = await query(
    `INSERT INTO fixed_assets (
        tenant_id, legal_entity_id, asset_no, sequence_no,
        name, category_id, status, currency_code,
        original_cost_txn, original_cost_base,
        acquisition_date, created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 'USD', 1000, 1000, ?, ?)`,
    [
      context.tenantId,
      context.legalEntityId,
      assetNo,
      Date.now(),
      "FA42 Evidence Smoke Asset",
      categoryId,
      todayDateOnly(),
      context.userId,
    ]
  );
  const assetId = Number(result.rows?.insertId || 0);
  assert(assetId > 0, "Expected asset fixture insert id");
  return assetId;
}

async function insertTransactionFixture(context, assetId) {
  const result = await query(
    `INSERT INTO fixed_asset_transactions (
        tenant_id, legal_entity_id, asset_id,
        transaction_type, status, effective_date, posting_date,
        currency_code,
        gross_amount_txn, gross_amount_base,
        accum_depr_amount_txn, accum_depr_amount_base,
        nbv_amount_txn, nbv_amount_base,
        created_by_user_id
     ) VALUES (?, ?, ?, 'ACQUISITION', 'POSTED', ?, ?, 'USD',
               1000, 1000, 0, 0, 1000, 1000, ?)`,
    [
      context.tenantId,
      context.legalEntityId,
      assetId,
      todayDateOnly(),
      todayDateOnly(),
      context.userId,
    ]
  );
  const transactionId = Number(result.rows?.insertId || 0);
  assert(transactionId > 0, "Expected transaction fixture insert id");
  return transactionId;
}

async function loadBookAndPeriod(tenantId, legalEntityId) {
  const bookResult = await query(
    `SELECT b.id AS book_id, b.calendar_id
       FROM books b
      WHERE b.tenant_id = ? AND b.legal_entity_id = ?
      ORDER BY b.id ASC LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const bookRow = bookResult.rows?.[0];
  assert(bookRow, "Expected at least one book for legal entity");

  const periodResult = await query(
    `SELECT id, fiscal_year, period_no FROM fiscal_periods
      WHERE calendar_id = ?
      ORDER BY id DESC LIMIT 1`,
    [bookRow.calendar_id]
  );
  const periodRow = periodResult.rows?.[0];
  assert(periodRow, "Expected at least one fiscal period");

  const periodKey = `${periodRow.fiscal_year}-${String(periodRow.period_no).padStart(2, "0")}`;

  return {
    bookId: Number(bookRow.book_id),
    fiscalPeriodId: Number(periodRow.id),
    periodKey,
  };
}

async function insertRunFixture(context) {
  const { bookId, fiscalPeriodId, periodKey } = await loadBookAndPeriod(
    context.tenantId,
    context.legalEntityId
  );

  const result = await query(
    `INSERT INTO fixed_asset_depreciation_runs (
        tenant_id, legal_entity_id, book_id,
        fiscal_period_id, period_key,
        status, created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)`,
    [
      context.tenantId,
      context.legalEntityId,
      bookId,
      fiscalPeriodId,
      periodKey,
      context.userId,
    ]
  );
  const runId = Number(result.rows?.insertId || 0);
  assert(runId > 0, "Expected run fixture insert id");
  return runId;
}

// ── Cleanup helpers ──────────────────────────────────────────────

async function cleanupEvidenceRows(sourceRefType, sourceRefId) {
  const result = await query(
    `SELECT id, storage_path
       FROM evidence_objects
      WHERE source_ref_type = ?
        AND source_ref_id = ?`,
    [sourceRefType, sourceRefId]
  );
  for (const row of result.rows || []) {
    if (row?.storage_path) {
      await deleteEvidenceBinary({ storagePath: row.storage_path }).catch(() => {});
    }
  }
  await query(
    `DELETE FROM evidence_objects
      WHERE source_ref_type = ?
        AND source_ref_id = ?`,
    [sourceRefType, sourceRefId]
  );
}

// ── Evidence lifecycle runner ────────────────────────────────────

async function runEvidenceLifecycleSurface({
  label,
  sourceRefType,
  sourceRefId,
  expectedScopeFieldName,
  context,
}) {
  const req = buildReq(context.tenantId, context.userId);
  const scopeCalls = [];
  const mockAssertScope = (_req, scopeType, scopeId, fieldName) => {
    scopeCalls.push({ scopeType, scopeId, fieldName });
  };

  // 1. Create draft
  const draft = await createFixedAssetEvidenceDraft({
    req,
    input: {
      tenantId: context.tenantId,
      sourceRefType,
      sourceRefId,
      userId: context.userId,
      fileName: `${label}-proof.txt`,
      displayName: `${label} Proof`,
      note: `FA42 smoke ${label}`,
    },
    assertScopeAccess: mockAssertScope,
  });

  assert(
    Number(draft.id) > 0 &&
      draft.sourceRefType === sourceRefType &&
      draft.status === "PENDING_UPLOAD",
    `[${label}] Evidence draft should be PENDING_UPLOAD with sourceRefType=${sourceRefType}`
  );

  // 2. Upload content
  const binaryPayload = Buffer.from(`FA42 ${label} evidence content`, "utf8");
  const uploaded = await uploadFixedAssetEvidenceContent({
    req,
    input: {
      tenantId: context.tenantId,
      sourceRefType,
      sourceRefId,
      evidenceId: draft.id,
      contentType: "text/plain",
    },
    binaryData: binaryPayload,
    assertScopeAccess: mockAssertScope,
  });

  assert(
    uploaded.status === "ACTIVE" &&
      uploaded.contentType === "text/plain" &&
      Number(uploaded.fileSizeBytes || 0) === binaryPayload.length,
    `[${label}] Evidence upload should activate and persist metadata`
  );

  // 3. List
  const listed = await listFixedAssetEvidenceForTenant({
    req,
    tenantId: context.tenantId,
    sourceRefType,
    sourceRefId,
    assertScopeAccess: mockAssertScope,
  });
  assert(
    listed.length === 1 && Number(listed[0]?.id) === Number(draft.id),
    `[${label}] Evidence list should return exactly one uploaded evidence row`
  );

  // 4. Get single
  const single = await getFixedAssetEvidenceByIdForTenant({
    req,
    tenantId: context.tenantId,
    sourceRefType,
    sourceRefId,
    evidenceId: draft.id,
    assertScopeAccess: mockAssertScope,
  });
  assert(
    Number(single.id) === Number(draft.id) && single.status === "ACTIVE",
    `[${label}] Single evidence read should return the uploaded record`
  );

  // 5. Download content
  const downloaded = await getFixedAssetEvidenceContentForTenant({
    req,
    tenantId: context.tenantId,
    sourceRefType,
    sourceRefId,
    evidenceId: draft.id,
    assertScopeAccess: mockAssertScope,
  });
  assert(
    String(downloaded?.data?.toString("utf8") || "") === binaryPayload.toString("utf8"),
    `[${label}] Evidence download should return the exact uploaded binary payload`
  );

  // 6. Delete
  const deleted = await deleteFixedAssetEvidenceByIdForTenant({
    req,
    input: {
      tenantId: context.tenantId,
      sourceRefType,
      sourceRefId,
      evidenceId: draft.id,
      userId: context.userId,
    },
    assertScopeAccess: mockAssertScope,
  });
  assert(
    deleted.status === "DELETED",
    `[${label}] Evidence delete should soft-delete the evidence row`
  );

  // 7. Verify deleted evidence no longer appears in list
  const listedAfterDelete = await listFixedAssetEvidenceForTenant({
    req,
    tenantId: context.tenantId,
    sourceRefType,
    sourceRefId,
    assertScopeAccess: mockAssertScope,
  });
  assert(
    listedAfterDelete.length === 0,
    `[${label}] Deleted evidence should no longer appear in list`
  );

  // 8. Verify download of deleted evidence fails
  await assertThrowsAsync(
    () =>
      getFixedAssetEvidenceContentForTenant({
        req,
        tenantId: context.tenantId,
        sourceRefType,
        sourceRefId,
        evidenceId: draft.id,
        assertScopeAccess: mockAssertScope,
      }),
    "Evidence object not found"
  );

  // 9. Verify RBAC scope assertions
  assert(
    scopeCalls.length > 0 &&
      scopeCalls.every(
        (call) =>
          call.scopeType === "legal_entity" &&
          Number(call.scopeId) === Number(context.legalEntityId) &&
          call.fieldName === expectedScopeFieldName
      ),
    `[${label}] Every evidence operation should assert legal_entity scope with fieldName="${expectedScopeFieldName}"`
  );

  return { scopeCallCount: scopeCalls.length };
}

// ── Source-code structure assertions ─────────────────────────────

async function runSourceCodeAssertions() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const evidenceServiceSource = await readFile(
    path.resolve(root, "backend/src/services/evidence.service.js"),
    "utf8"
  );
  const evidenceRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/fixed-assets.evidence.routes.js"),
    "utf8"
  );
  const faRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/fixed-assets.routes.js"),
    "utf8"
  );
  const sourceRefTypesSource = await readFile(
    path.resolve(root, "backend/src/utils/source-ref-types.js"),
    "utf8"
  );

  // Evidence service supports all three FA source types
  assert(
    evidenceServiceSource.includes('SOURCE_REF_TYPE_FIXED_ASSET = "FIXED_ASSET"') &&
      evidenceServiceSource.includes('SOURCE_REF_TYPE_FIXED_ASSET_TRANSACTION = "FIXED_ASSET_TRANSACTION"') &&
      evidenceServiceSource.includes('SOURCE_REF_TYPE_FIXED_ASSET_DEPRECIATION_RUN = "FIXED_ASSET_DEPRECIATION_RUN"'),
    "Evidence service should define all three fixed-assets source ref type constants"
  );
  assert(
    evidenceServiceSource.includes("createFixedAssetEvidenceDraft") &&
      evidenceServiceSource.includes("listFixedAssetEvidenceForTenant") &&
      evidenceServiceSource.includes("getFixedAssetEvidenceByIdForTenant") &&
      evidenceServiceSource.includes("uploadFixedAssetEvidenceContent") &&
      evidenceServiceSource.includes("getFixedAssetEvidenceContentForTenant") &&
      evidenceServiceSource.includes("deleteFixedAssetEvidenceByIdForTenant"),
    "Evidence service should export all six fixed-assets evidence CRUD+file functions"
  );
  assert(
    evidenceServiceSource.includes("assertFixedAssetEvidenceScope") &&
      evidenceServiceSource.includes("assertFixedAssetTransactionEvidenceScope") &&
      evidenceServiceSource.includes("assertFixedAssetRunEvidenceScope"),
    "Evidence service should include scope assertion helpers for all three surfaces"
  );

  // Source-ref-types registry
  assert(
    sourceRefTypesSource.includes('export const FIXED_ASSET = "FIXED_ASSET"') &&
      sourceRefTypesSource.includes('export const FIXED_ASSET_TRANSACTION = "FIXED_ASSET_TRANSACTION"') &&
      sourceRefTypesSource.includes('export const FIXED_ASSET_DEPRECIATION_RUN = "FIXED_ASSET_DEPRECIATION_RUN"'),
    "source-ref-types.js should export canonical FIXED_ASSET, FIXED_ASSET_TRANSACTION, FIXED_ASSET_DEPRECIATION_RUN constants"
  );

  // Evidence routes file uses mergeParams and the richer CARI pattern
  assert(
    evidenceRouteSource.includes("mergeParams: true"),
    "Fixed-assets evidence router should use mergeParams"
  );
  assert(
    evidenceRouteSource.includes('router.get(\n  "/"') &&
      evidenceRouteSource.includes('router.post(\n  "/"') &&
      evidenceRouteSource.includes('"/:evidenceId"') &&
      evidenceRouteSource.includes('"/:evidenceId/content"') &&
      evidenceRouteSource.includes('"/:evidenceId/download"'),
    "Fixed-assets evidence routes should provide list/create/read/upload/download/delete endpoints"
  );
  assert(
    evidenceRouteSource.includes("resolveEvidenceContext") &&
      evidenceRouteSource.includes("FIXED_ASSET_TRANSACTION") &&
      evidenceRouteSource.includes("FIXED_ASSET_DEPRECIATION_RUN") &&
      evidenceRouteSource.includes("FIXED_ASSET"),
    "Evidence routes should detect surface from merged params for all three source types"
  );

  // Fixed-assets routes mount evidence correctly with safe ordering
  const txEvidenceIdx = faRouteSource.indexOf(
    'router.use("/transactions/:transactionId/evidence", fixedAssetsEvidenceRoutes)'
  );
  const runEvidenceIdx = faRouteSource.indexOf(
    'router.use("/runs/:runId/evidence", fixedAssetsEvidenceRoutes)'
  );
  const assetEvidenceIdx = faRouteSource.indexOf(
    'router.use("/:assetId/evidence", fixedAssetsEvidenceRoutes)'
  );

  assert(
    txEvidenceIdx > 0,
    "Fixed-assets routes should mount /transactions/:transactionId/evidence"
  );
  assert(
    runEvidenceIdx > 0,
    "Fixed-assets routes should mount /runs/:runId/evidence"
  );
  assert(
    assetEvidenceIdx > 0,
    "Fixed-assets routes should mount /:assetId/evidence"
  );

  // Route ordering: transaction and run evidence BEFORE /:assetId evidence
  assert(
    txEvidenceIdx < assetEvidenceIdx,
    "Transaction evidence mount must appear before /:assetId/evidence to prevent route swallowing"
  );
  assert(
    runEvidenceIdx < assetEvidenceIdx,
    "Run evidence mount must appear before /:assetId/evidence to prevent route swallowing"
  );

  // No top-level app mount for fixed-assets evidence
  assert(
    !faRouteSource.includes('app.use') &&
      faRouteSource.includes("fixedAssetsEvidenceRoutes"),
    "Evidence routes should be nested under fixed-assets, not mounted at app level"
  );

  console.log("  Source-code structure assertions passed.");
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("FA42 fixed-assets evidence smoke test starting...\n");

  // Phase 1: Source code structure assertions
  console.log("Phase 1: Source-code structure checks");
  await runSourceCodeAssertions();

  // Phase 2: Service-level evidence lifecycle for all three surfaces
  console.log("\nPhase 2: Service-level evidence lifecycle");

  const context = await loadSmokeContext();
  const categoryId = await ensureCategory(context.tenantId, context.legalEntityId);
  const assetId = await insertAssetFixture(context, categoryId);
  const transactionId = await insertTransactionFixture(context, assetId);
  const runId = await insertRunFixture(context);

  const cleanupIds = { assetId, transactionId, runId, categoryId };
  let createdCategory = false;

  // Check if category was freshly created (for cleanup)
  const catCheck = await query(
    `SELECT code FROM fixed_asset_categories WHERE id = ? AND tenant_id = ?`,
    [categoryId, context.tenantId]
  );
  if (catCheck.rows?.[0]?.code?.startsWith("FA42CAT")) {
    createdCategory = true;
  }

  try {
    // ── Asset evidence ─────────────────────────────────────────
    console.log("  Running FIXED_ASSET evidence lifecycle...");
    const assetResult = await runEvidenceLifecycleSurface({
      label: "FIXED_ASSET",
      sourceRefType: "FIXED_ASSET",
      sourceRefId: assetId,
      expectedScopeFieldName: "assetId",
      context,
    });
    console.log(`    PASSED (${assetResult.scopeCallCount} scope assertions)`);

    // ── Transaction evidence ───────────────────────────────────
    console.log("  Running FIXED_ASSET_TRANSACTION evidence lifecycle...");
    const txResult = await runEvidenceLifecycleSurface({
      label: "FIXED_ASSET_TRANSACTION",
      sourceRefType: "FIXED_ASSET_TRANSACTION",
      sourceRefId: transactionId,
      expectedScopeFieldName: "transactionId",
      context,
    });
    console.log(`    PASSED (${txResult.scopeCallCount} scope assertions)`);

    // ── Depreciation run evidence ──────────────────────────────
    console.log("  Running FIXED_ASSET_DEPRECIATION_RUN evidence lifecycle...");
    const runResult = await runEvidenceLifecycleSurface({
      label: "FIXED_ASSET_DEPRECIATION_RUN",
      sourceRefType: "FIXED_ASSET_DEPRECIATION_RUN",
      sourceRefId: runId,
      expectedScopeFieldName: "runId",
      context,
    });
    console.log(`    PASSED (${runResult.scopeCallCount} scope assertions)`);

    // ── Cross-surface isolation ────────────────────────────────
    console.log("  Verifying cross-surface isolation...");
    const req = buildReq(context.tenantId, context.userId);
    const noop = () => {};

    // Evidence created for asset should not appear in transaction list
    const assetDraft = await createFixedAssetEvidenceDraft({
      req,
      input: {
        tenantId: context.tenantId,
        sourceRefType: "FIXED_ASSET",
        sourceRefId: assetId,
        userId: context.userId,
        fileName: "isolation-check.txt",
      },
      assertScopeAccess: noop,
    });

    const txList = await listFixedAssetEvidenceForTenant({
      req,
      tenantId: context.tenantId,
      sourceRefType: "FIXED_ASSET_TRANSACTION",
      sourceRefId: transactionId,
      assertScopeAccess: noop,
    });
    assert(
      txList.length === 0,
      "Asset evidence should not appear in transaction evidence list"
    );

    const runList = await listFixedAssetEvidenceForTenant({
      req,
      tenantId: context.tenantId,
      sourceRefType: "FIXED_ASSET_DEPRECIATION_RUN",
      sourceRefId: runId,
      assertScopeAccess: noop,
    });
    assert(
      runList.length === 0,
      "Asset evidence should not appear in run evidence list"
    );

    // Cleanup isolation evidence
    await deleteFixedAssetEvidenceByIdForTenant({
      req,
      input: {
        tenantId: context.tenantId,
        sourceRefType: "FIXED_ASSET",
        sourceRefId: assetId,
        evidenceId: assetDraft.id,
        userId: context.userId,
      },
      assertScopeAccess: noop,
    });
    console.log("    PASSED");

    // ── Invalid source type rejection ──────────────────────────
    console.log("  Verifying invalid source type rejection...");
    await assertThrowsAsync(
      () =>
        createFixedAssetEvidenceDraft({
          req,
          input: {
            tenantId: context.tenantId,
            sourceRefType: "INVALID_TYPE",
            sourceRefId: assetId,
            userId: context.userId,
            fileName: "should-fail.txt",
          },
          assertScopeAccess: noop,
        }),
      "Unsupported fixed-assets evidence source type"
    );
    console.log("    PASSED");

    console.log("\nFA42 fixed-assets evidence smoke PASSED.");
    console.log(
      JSON.stringify(
        {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          assetId,
          transactionId,
          runId,
          surfaces: ["FIXED_ASSET", "FIXED_ASSET_TRANSACTION", "FIXED_ASSET_DEPRECIATION_RUN"],
          scopeCallTotals: {
            asset: assetResult.scopeCallCount,
            transaction: txResult.scopeCallCount,
            run: runResult.scopeCallCount,
          },
        },
        null,
        2
      )
    );
  } finally {
    // Cleanup
    await cleanupEvidenceRows("FIXED_ASSET", assetId).catch(() => {});
    await cleanupEvidenceRows("FIXED_ASSET_TRANSACTION", transactionId).catch(() => {});
    await cleanupEvidenceRows("FIXED_ASSET_DEPRECIATION_RUN", runId).catch(() => {});
    await query(`DELETE FROM fixed_asset_depreciation_runs WHERE id = ?`, [runId]).catch(() => {});
    await query(`DELETE FROM fixed_asset_transactions WHERE id = ?`, [transactionId]).catch(() => {});
    await query(`DELETE FROM fixed_assets WHERE id = ?`, [assetId]).catch(() => {});
    if (createdCategory) {
      await query(`DELETE FROM fixed_asset_categories WHERE id = ?`, [categoryId]).catch(() => {});
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
