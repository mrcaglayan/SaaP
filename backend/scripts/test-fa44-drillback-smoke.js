/**
 * STEP-FA44 smoke test — end-to-end drillback contract verification.
 *
 * Verifies:
 *   1. Frontend source-code structure (imports, registries, query-param usage)
 *   2. Live backend destination resolution → drillback URL verification
 *   3. Reverse-block navigation consistency
 *   4. Fallback behavior for missing source records
 *   5. Frontend build verification (vite build)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { closePool, query } from "../src/db.js";
import {
  enrichSourceLinksWithDestinationsAsync,
  resolveDestinationAsync,
  resolveReverseBlockAsync,
} from "../src/services/gl.reverse-block-destination.service.js";
import { listJournalSourceLinksByJournalIds } from "../src/services/journal.source-link.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function test(label, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${label}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${label}: ${err.message}`);
    }
  };
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

function frontendPath(...segments) {
  return path.resolve(__dirname, "../../frontend", ...segments);
}

// ── 1. Source-code structure assertions ──────────────────────────────

async function runSourceCodeStructureChecks() {
  console.log("\n── 1. Source-code structure assertions ──");

  // journalSourceLinkDestinations.js checks
  const destUtilPath = frontendPath("src/utils/journalSourceLinkDestinations.js");
  const destUtilSrc = readFileSync(destUtilPath, "utf8");

  await test("journalSourceLinkDestinations.js imports FIXED_ASSET_TRANSACTION", () => {
    assert(
      destUtilSrc.includes("FIXED_ASSET_TRANSACTION"),
      "Missing FIXED_ASSET_TRANSACTION import"
    );
    // Verify it's in the import block
    const importBlock = destUtilSrc.match(/import\s*\{[^}]*\}\s*from\s*["']\.\/sourceRefTypes/s);
    assert(importBlock, "Missing import from sourceRefTypes");
    assert(
      importBlock[0].includes("FIXED_ASSET_TRANSACTION"),
      "FIXED_ASSET_TRANSACTION not in sourceRefTypes import"
    );
  })();

  await test("journalSourceLinkDestinations.js imports FIXED_ASSET_DEPRECIATION_RUN", () => {
    const importBlock = destUtilSrc.match(/import\s*\{[^}]*\}\s*from\s*["']\.\/sourceRefTypes/s);
    assert(importBlock, "Missing import from sourceRefTypes");
    assert(
      importBlock[0].includes("FIXED_ASSET_DEPRECIATION_RUN"),
      "FIXED_ASSET_DEPRECIATION_RUN not in sourceRefTypes import"
    );
  })();

  await test("journalSourceLinkDestinations.js has BACKEND_OWNED_DESTINATION_TYPES with FA types", () => {
    assert(
      destUtilSrc.includes("BACKEND_OWNED_DESTINATION_TYPES"),
      "Missing BACKEND_OWNED_DESTINATION_TYPES"
    );
    // Verify both FA types are in the Set
    const setMatch = destUtilSrc.match(
      /BACKEND_OWNED_DESTINATION_TYPES\s*=\s*Object\.freeze\(\s*new\s+Set\(\[([^\]]*)\]\)/s
    );
    assert(setMatch, "Could not parse BACKEND_OWNED_DESTINATION_TYPES Set");
    assert(
      setMatch[1].includes("FIXED_ASSET_TRANSACTION"),
      "FIXED_ASSET_TRANSACTION not in BACKEND_OWNED_DESTINATION_TYPES"
    );
    assert(
      setMatch[1].includes("FIXED_ASSET_DEPRECIATION_RUN"),
      "FIXED_ASSET_DEPRECIATION_RUN not in BACKEND_OWNED_DESTINATION_TYPES"
    );
  })();

  await test("journalSourceLinkDestinations.js has both FA types in LOCAL_DESTINATION_REGISTRY", () => {
    const registryMatch = destUtilSrc.match(
      /LOCAL_DESTINATION_REGISTRY\s*=\s*Object\.freeze\(\{([^}]*)\}\)/s
    );
    assert(registryMatch, "Could not parse LOCAL_DESTINATION_REGISTRY");
    assert(
      registryMatch[1].includes("FIXED_ASSET_TRANSACTION"),
      "FIXED_ASSET_TRANSACTION not in LOCAL_DESTINATION_REGISTRY"
    );
    assert(
      registryMatch[1].includes("FIXED_ASSET_DEPRECIATION_RUN"),
      "FIXED_ASSET_DEPRECIATION_RUN not in LOCAL_DESTINATION_REGISTRY"
    );
  })();

  // FixedAssetDetailPage.jsx
  await test("FixedAssetDetailPage.jsx uses useSearchParams and reads 'tab' and 'transactionId'", () => {
    const src = readFileSync(
      frontendPath("src/pages/fixedAssets/FixedAssetDetailPage.jsx"),
      "utf8"
    );
    assert(src.includes("useSearchParams"), "Missing useSearchParams usage");
    assert(
      src.includes('searchParams.get("tab")'),
      "Missing searchParams.get('tab')"
    );
    assert(
      src.includes('searchParams.get("transactionId")'),
      "Missing searchParams.get('transactionId')"
    );
  })();

  // FixedAssetDepreciationRunsPage.jsx
  await test("FixedAssetDepreciationRunsPage.jsx uses useSearchParams and reads 'runId'", () => {
    const src = readFileSync(
      frontendPath("src/pages/fixedAssets/FixedAssetDepreciationRunsPage.jsx"),
      "utf8"
    );
    assert(src.includes("useSearchParams"), "Missing useSearchParams usage");
    assert(
      src.includes('searchParams.get("runId")'),
      "Missing searchParams.get('runId')"
    );
  })();

  // FixedAssetDisposalsPage.jsx
  await test("FixedAssetDisposalsPage.jsx uses useSearchParams and reads 'transactionId' and 'assetId'", () => {
    const src = readFileSync(
      frontendPath("src/pages/fixedAssets/FixedAssetDisposalsPage.jsx"),
      "utf8"
    );
    assert(src.includes("useSearchParams"), "Missing useSearchParams usage");
    assert(
      src.includes('searchParams.get("transactionId")'),
      "Missing searchParams.get('transactionId')"
    );
    assert(
      src.includes('searchParams.get("assetId")'),
      "Missing searchParams.get('assetId')"
    );
  })();

  // JournalWorkbenchPage.jsx
  await test("JournalWorkbenchPage.jsx has FIXED_ASSET_TRANSACTION in formatJournalSourceLinkAction", () => {
    const src = readFileSync(
      frontendPath("src/pages/JournalWorkbenchPage.jsx"),
      "utf8"
    );
    assert(
      src.includes('"FIXED_ASSET_TRANSACTION"') || src.includes("'FIXED_ASSET_TRANSACTION'"),
      "Missing FIXED_ASSET_TRANSACTION in JournalWorkbenchPage"
    );
  })();

  await test("JournalWorkbenchPage.jsx has FIXED_ASSET_DEPRECIATION_RUN in formatJournalSourceLinkAction", () => {
    const src = readFileSync(
      frontendPath("src/pages/JournalWorkbenchPage.jsx"),
      "utf8"
    );
    assert(
      src.includes('"FIXED_ASSET_DEPRECIATION_RUN"') || src.includes("'FIXED_ASSET_DEPRECIATION_RUN'"),
      "Missing FIXED_ASSET_DEPRECIATION_RUN in JournalWorkbenchPage"
    );
  })();

  // fixedAssets.js API exports
  await test("frontend/src/api/fixedAssets.js exports getFixedAssetRun and listFixedAssetTransactions", () => {
    const src = readFileSync(
      frontendPath("src/api/fixedAssets.js"),
      "utf8"
    );
    assert(
      /export\s+(async\s+)?function\s+getFixedAssetRun/.test(src),
      "Missing export of getFixedAssetRun"
    );
    assert(
      /export\s+(async\s+)?function\s+listFixedAssetTransactions/.test(src),
      "Missing export of listFixedAssetTransactions"
    );
  })();
}

// ── Helper: load smoke context ──────────────────────────────────────

async function loadSmokeContext() {
  const result = await query(
    `SELECT le.tenant_id, le.id AS legal_entity_id, u.id AS user_id
       FROM legal_entities le
       JOIN users u ON u.tenant_id = le.tenant_id
      LIMIT 1`
  );
  assert(result.rows.length > 0, "Need at least one legal entity + user");
  return result.rows[0];
}

// ── 2. Live backend destination resolution → drillback URL verification ──

async function runLiveDrillbackChecks() {
  console.log("\n── 2. Live backend drillback URL verification ──");

  const ctx = await loadSmokeContext();

  // Find book + fiscal period + account for journal fixtures
  const setupResult = await query(
    `SELECT b.id AS book_id, fp.id AS fiscal_period_id, a.id AS account_id
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
       JOIN charts_of_accounts coa ON coa.tenant_id = b.tenant_id
       JOIN accounts a ON a.coa_id = coa.id AND a.allow_posting = 1
      WHERE b.tenant_id = ?
      LIMIT 1`,
    [ctx.tenant_id]
  );
  assert(setupResult.rows.length > 0, "Need book/period/account for journal fixtures");
  const { book_id, fiscal_period_id, account_id } = setupResult.rows[0];

  // Find or create an asset
  let assetId;
  let createdAsset = false;
  const assetResult = await query(
    `SELECT id FROM fixed_assets WHERE tenant_id = ? LIMIT 1`,
    [ctx.tenant_id]
  );
  if (assetResult.rows.length > 0) {
    assetId = assetResult.rows[0].id;
  } else {
    const code = uniqueCode("FA44T");
    const insertResult = await query(
      `INSERT INTO fixed_assets (tenant_id, legal_entity_id, asset_code, asset_name, category_id, status, currency_code)
       SELECT ?, ?, ?, 'FA44 Smoke Test Asset', fc.id, 'DRAFT', 'TRY'
       FROM fixed_asset_categories fc WHERE fc.tenant_id = ? LIMIT 1`,
      [ctx.tenant_id, ctx.legal_entity_id, code, ctx.tenant_id]
    );
    assetId = insertResult.rows.insertId;
    createdAsset = true;
    assert(assetId, "Failed to create smoke test asset");
  }

  // Insert ACQUISITION transaction (normal)
  const acqTxResult = await query(
    `INSERT INTO fixed_asset_transactions
       (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
     VALUES (?, ?, ?, 'ACQUISITION', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
    [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
  );
  const acqTxId = acqTxResult.rows.insertId;

  // Insert SALE transaction (disposal)
  const saleTxResult = await query(
    `INSERT INTO fixed_asset_transactions
       (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
     VALUES (?, ?, ?, 'SALE', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
    [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
  );
  const saleTxId = saleTxResult.rows.insertId;

  // Find or create depreciation run
  let runId;
  let createdRun = false;
  const existingRunResult = await query(
    `SELECT id FROM fixed_asset_depreciation_runs WHERE tenant_id = ? LIMIT 1`,
    [ctx.tenant_id]
  );
  if (existingRunResult.rows.length > 0) {
    runId = existingRunResult.rows[0].id;
  } else {
    const fpResult = await query(
      `SELECT fiscal_year, period_no FROM fiscal_periods WHERE id = ? LIMIT 1`,
      [fiscal_period_id]
    );
    const fy = fpResult.rows[0].fiscal_year;
    const pn = String(fpResult.rows[0].period_no).padStart(2, "0");
    const periodKey = `${fy}-${pn}`;
    const runResult = await query(
      `INSERT INTO fixed_asset_depreciation_runs
         (tenant_id, legal_entity_id, fiscal_period_id, period_key, book_id, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [ctx.tenant_id, ctx.legal_entity_id, fiscal_period_id, periodKey, book_id, ctx.user_id]
    );
    runId = runResult.rows.insertId;
    createdRun = true;
  }

  // Insert three POSTED journal entries (acq, sale, run) + one for fallback
  const jNoAcq = uniqueCode("FA44AQ");
  const jNoSale = uniqueCode("FA44SL");
  const jNoRun = uniqueCode("FA44RN");
  const jNoFallback = uniqueCode("FA44FB");

  const acqJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 smoke: acquisition', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoAcq, ctx.user_id, ctx.user_id]
  );
  const acqJournalId = acqJournalResult.rows.insertId;

  const saleJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 smoke: sale', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoSale, ctx.user_id, ctx.user_id]
  );
  const saleJournalId = saleJournalResult.rows.insertId;

  const runJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 smoke: run', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoRun, ctx.user_id, ctx.user_id]
  );
  const runJournalId = runJournalResult.rows.insertId;

  const fallbackJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 smoke: fallback', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoFallback, ctx.user_id, ctx.user_id]
  );
  const fallbackJournalId = fallbackJournalResult.rows.insertId;

  const allJournalIds = [acqJournalId, saleJournalId, runJournalId, fallbackJournalId];

  // Insert balanced journal lines for all journals
  for (const jId of allJournalIds) {
    await query(
      `INSERT INTO journal_lines
         (journal_entry_id, line_no, account_id, description, currency_code, amount_txn, debit_base, credit_base)
       VALUES (?, 1, ?, 'FA44 smoke debit', 'TRY', 100, 100, 0),
              (?, 2, ?, 'FA44 smoke credit', 'TRY', -100, 0, 100)`,
      [jId, account_id, jId, account_id]
    );
  }

  // Insert PRIMARY source links
  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', ?, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, acqJournalId, acqTxId]
  );

  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', ?, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, saleJournalId, saleTxId]
  );

  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_DEPRECIATION_RUN', ?, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, runJournalId, runId]
  );

  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', 999999999, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, fallbackJournalId]
  );

  // Store resolved destinations for reverse-block cross-check
  let acqDirectRoute = null;
  let saleDirectRoute = null;
  let runDirectRoute = null;

  try {
    // ── 2a. Asset-detail drillback (ACQUISITION) ──
    console.log("\n  ── 2a. Asset-detail drillback (ACQUISITION) ──");

    await test("2a: listJournalSourceLinksByJournalIds returns acq source link", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [acqJournalId],
      });
      const links = linkMap.get(acqJournalId) || [];
      assert(links.length >= 1, `Expected >=1 source link, got ${links.length}`);
      const primary = links.find(
        (l) => l.link_role === "PRIMARY" && l.source_ref_type === "FIXED_ASSET_TRANSACTION"
      );
      assert(primary, "Expected PRIMARY FIXED_ASSET_TRANSACTION link");
      assert(Number(primary.source_ref_id) === acqTxId, `Expected source_ref_id=${acqTxId}`);
    })();

    await test("2a: enrichSourceLinksWithDestinationsAsync resolves acq destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [acqJournalId],
      });
      const sourceLinks = linkMap.get(acqJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);
      const faLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_TRANSACTION");
      assert(faLink && faLink.destination, "Expected resolved destination");
      assert(!faLink.destination.isFallback, "Should not be fallback");

      const route = faLink.destination.route;
      acqDirectRoute = route;

      // Pattern: /app/demirbas-karti-detayi/<assetId>?tab=transactions&transactionId=<txId>
      const expectedPrefix = `/app/demirbas-karti-detayi/${assetId}`;
      assert(
        route.startsWith(expectedPrefix),
        `Expected route starting with ${expectedPrefix}, got: ${route}`
      );
      assert(
        route.includes("tab=transactions"),
        `Expected tab=transactions in route, got: ${route}`
      );
      assert(
        route.includes(`transactionId=${acqTxId}`),
        `Expected transactionId=${acqTxId} in route, got: ${route}`
      );

      // Verify locked query param names
      const url = new URL(route, "http://dummy");
      assert(url.searchParams.has("tab"), "URL must contain 'tab' query param");
      assert(url.searchParams.has("transactionId"), "URL must contain 'transactionId' query param");
    })();

    // ── 2b. Disposal drillback (SALE) ──
    console.log("\n  ── 2b. Disposal drillback (SALE) ──");

    await test("2b: enrichSourceLinksWithDestinationsAsync resolves sale destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [saleJournalId],
      });
      const sourceLinks = linkMap.get(saleJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);
      const faLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_TRANSACTION");
      assert(faLink && faLink.destination, "Expected resolved destination");
      assert(!faLink.destination.isFallback, "Should not be fallback");

      const route = faLink.destination.route;
      saleDirectRoute = route;

      // Pattern: /app/demirbas-satis-islemleri?transactionId=<txId>&assetId=<assetId>
      assert(
        route.includes("/app/demirbas-satis-islemleri"),
        `Expected disposal route, got: ${route}`
      );
      assert(
        route.includes(`transactionId=${saleTxId}`),
        `Expected transactionId=${saleTxId} in route, got: ${route}`
      );
      assert(
        route.includes(`assetId=${assetId}`),
        `Expected assetId=${assetId} in route, got: ${route}`
      );

      // Verify locked query param names
      const url = new URL(route, "http://dummy");
      assert(url.searchParams.has("transactionId"), "URL must contain 'transactionId' query param");
      assert(url.searchParams.has("assetId"), "URL must contain 'assetId' query param");
    })();

    // ── 2c. Run drillback (depreciation run) ──
    console.log("\n  ── 2c. Run drillback (depreciation run) ──");

    await test("2c: enrichSourceLinksWithDestinationsAsync resolves run destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [runJournalId],
      });
      const sourceLinks = linkMap.get(runJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);
      const runLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_DEPRECIATION_RUN");
      assert(runLink && runLink.destination, "Expected resolved destination");
      assert(!runLink.destination.isFallback, "Should not be fallback");

      const route = runLink.destination.route;
      runDirectRoute = route;

      // Pattern: /app/demirbas-amortisman-islemleri?runId=<runId>
      assert(
        route === `/app/demirbas-amortisman-islemleri?runId=${runId}`,
        `Expected exact run route, got: ${route}`
      );

      // Verify locked query param name
      const url = new URL(route, "http://dummy");
      assert(url.searchParams.has("runId"), "URL must contain 'runId' query param");
    })();

    // ── 2d. Reverse-block navigation ──
    console.log("\n  ── 2d. Reverse-block navigation ──");

    await test("2d: acq journal reverse-block is blocked with matching destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [acqJournalId],
      });
      const sourceLinks = linkMap.get(acqJournalId) || [];
      const reverseBlock = await resolveReverseBlockAsync(sourceLinks);

      assert(reverseBlock.isBlocked === true, "Acq journal should be reverse-blocked");
      assert(reverseBlock.primaryDestination, "Should have primaryDestination");
      assert(
        reverseBlock.primaryDestination.route.includes("/app/demirbas-karti-detayi/"),
        `Expected asset detail in reverse-block route, got: ${reverseBlock.primaryDestination.route}`
      );
      // Cross-check: reverse-block route matches direct drillback route
      assert(
        reverseBlock.primaryDestination.route === acqDirectRoute,
        `Reverse-block route should match direct drillback.\n  reverse-block: ${reverseBlock.primaryDestination.route}\n  direct: ${acqDirectRoute}`
      );
    })();

    await test("2d: sale journal reverse-block is blocked with matching destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [saleJournalId],
      });
      const sourceLinks = linkMap.get(saleJournalId) || [];
      const reverseBlock = await resolveReverseBlockAsync(sourceLinks);

      assert(reverseBlock.isBlocked === true, "Sale journal should be reverse-blocked");
      assert(reverseBlock.primaryDestination, "Should have primaryDestination");
      assert(
        reverseBlock.primaryDestination.route.includes("/app/demirbas-satis-islemleri"),
        `Expected disposal route in reverse-block, got: ${reverseBlock.primaryDestination.route}`
      );
      assert(
        reverseBlock.primaryDestination.route === saleDirectRoute,
        `Reverse-block route should match direct drillback.\n  reverse-block: ${reverseBlock.primaryDestination.route}\n  direct: ${saleDirectRoute}`
      );
    })();

    await test("2d: run journal reverse-block is blocked with matching destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [runJournalId],
      });
      const sourceLinks = linkMap.get(runJournalId) || [];
      const reverseBlock = await resolveReverseBlockAsync(sourceLinks);

      assert(reverseBlock.isBlocked === true, "Run journal should be reverse-blocked");
      assert(reverseBlock.primaryDestination, "Should have primaryDestination");
      assert(
        reverseBlock.primaryDestination.route.includes("/app/demirbas-amortisman-islemleri"),
        `Expected run route in reverse-block, got: ${reverseBlock.primaryDestination.route}`
      );
      assert(
        reverseBlock.primaryDestination.route === runDirectRoute,
        `Reverse-block route should match direct drillback.\n  reverse-block: ${reverseBlock.primaryDestination.route}\n  direct: ${runDirectRoute}`
      );
    })();

    // ── 2e. Fallback behavior ──
    console.log("\n  ── 2e. Fallback behavior ──");

    await test("2e: source link with non-existent ID 999999999 produces fallback destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [fallbackJournalId],
      });
      const sourceLinks = linkMap.get(fallbackJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);
      const faLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_TRANSACTION");
      assert(faLink, "Expected FIXED_ASSET_TRANSACTION link");
      assert(faLink.destination, "Fallback should still produce a destination");
      assert(
        faLink.destination.isFallback === true,
        "Should be marked as fallback (isFallback: true)"
      );
      assert(
        faLink.destination.route === "/app/demirbas",
        `Expected fallback route /app/demirbas, got: ${faLink.destination.route}`
      );
    })();

  } finally {
    // Cleanup all test fixtures
    console.log("\n  ── Cleanup ──");
    await query(
      `DELETE FROM journal_source_links WHERE journal_entry_id IN (?, ?, ?, ?)`,
      allJournalIds
    );
    await query(
      `DELETE FROM journal_lines WHERE journal_entry_id IN (?, ?, ?, ?)`,
      allJournalIds
    );
    await query(
      `DELETE FROM journal_entries WHERE id IN (?, ?, ?, ?)`,
      allJournalIds
    );
    await query(
      `DELETE FROM fixed_asset_transactions WHERE id IN (?, ?)`,
      [acqTxId, saleTxId]
    );
    if (createdRun) {
      await query(`DELETE FROM fixed_asset_depreciation_runs WHERE id = ?`, [runId]);
    }
    if (createdAsset) {
      await query(`DELETE FROM fixed_assets WHERE id = ?`, [assetId]);
    }
    console.log("  Cleaned up all test fixtures.");
  }
}

// ── 3. Frontend build verification ──────────────────────────────────

async function runFrontendBuildCheck() {
  console.log("\n── 3. Frontend build verification ──");

  await test("3: npx vite build exits with code 0", () => {
    const frontendDir = path.resolve(__dirname, "../../frontend");
    try {
      execSync("npx vite build", {
        cwd: frontendDir,
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().slice(0, 500) : "";
      throw new Error(`Vite build failed (exit code ${err.status}):\n${stderr}`);
    }
  })();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("STEP-FA44 smoke test: end-to-end drillback contract verification\n");

  try {
    await runSourceCodeStructureChecks();
    await runLiveDrillbackChecks();
    await runFrontendBuildCheck();

    console.log(`\n══ Results: ${passed} passed, ${failed} failed ══`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
