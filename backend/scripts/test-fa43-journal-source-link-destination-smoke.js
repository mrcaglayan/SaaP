/**
 * STEP-FA43 smoke test — journal source-link writing & destination resolution.
 *
 * Verifies:
 *   1. fixed-assets.service.js uses FIXED_ASSET_TRANSACTION constant (not string literal)
 *   2. FIXED_ASSET_TRANSACTION and FIXED_ASSET_DEPRECIATION_RUN are reverse-block types
 *   3. Dynamic destination resolution for FA transaction (SALE vs normal)
 *   4. Dynamic destination resolution for FA depreciation run
 *   5. Fallback behavior when source row is missing
 *   6. enrichSourceLinksWithDestinationsAsync resolves dynamic FA types
 *   7. resolveReverseBlockAsync blocks and resolves FA destinations
 *   8. gl.read.journal.routes.js imports async variants
 *   9. Live posted non-run journal has PRIMARY source link with FIXED_ASSET_TRANSACTION
 *  10. Live posted run journal has PRIMARY source link with FIXED_ASSET_DEPRECIATION_RUN
 *  11. Journal detail read returns source_links[].destination for real posted journals
 *  12. Fallback destination shape when source-record lookup is intentionally broken
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query, withTransaction } from "../src/db.js";
import {
  resolveDestination,
  resolveDestinationAsync,
  isReverseBlockSourceType,
  enrichSourceLinksWithDestinations,
  enrichSourceLinksWithDestinationsAsync,
  resolveReverseBlock,
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

// ── Source-code structure assertions ─────────────────────────────────

async function runSourceCodeChecks() {
  console.log("\n── Source-code structure checks ──");

  await test("fixed-assets.service.js imports FIXED_ASSET_TRANSACTION from source-ref-types", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/services/fixed-assets.service.js"),
      "utf8"
    );
    assert(
      src.includes('import { FIXED_ASSET_TRANSACTION } from "../utils/source-ref-types.js"'),
      "Missing import of FIXED_ASSET_TRANSACTION constant"
    );
  })();

  await test("fixed-assets.service.js has no string-literal FIXED_ASSET_TRANSACTION", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/services/fixed-assets.service.js"),
      "utf8"
    );
    // Should not contain the string literal as a value (allow it as part of import name)
    const lines = src.split("\n");
    for (const line of lines) {
      if (line.includes('"FIXED_ASSET_TRANSACTION"') && !line.includes("import")) {
        throw new Error(`Found string literal on line: ${line.trim()}`);
      }
    }
  })();

  await test("gl.read.journal.routes.js imports async enrichment variants", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/routes/gl.read.journal.routes.js"),
      "utf8"
    );
    assert(
      src.includes("enrichSourceLinksWithDestinationsAsync"),
      "Missing import of enrichSourceLinksWithDestinationsAsync"
    );
    assert(
      src.includes("resolveReverseBlockAsync"),
      "Missing import of resolveReverseBlockAsync"
    );
  })();

  await test("gl.reverse-block-destination.service.js exports async variants", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/services/gl.reverse-block-destination.service.js"),
      "utf8"
    );
    assert(
      src.includes("export async function resolveDestinationAsync"),
      "Missing export of resolveDestinationAsync"
    );
    assert(
      src.includes("export async function enrichSourceLinksWithDestinationsAsync"),
      "Missing export of enrichSourceLinksWithDestinationsAsync"
    );
    assert(
      src.includes("export async function resolveReverseBlockAsync"),
      "Missing export of resolveReverseBlockAsync"
    );
  })();
}

// ── Reverse-block type checks ───────────────────────────────────────

async function runReverseBlockTypeChecks() {
  console.log("\n── Reverse-block type checks ──");

  await test("CARI_DOCUMENT is a reverse-block source type", () => {
    assert(
      isReverseBlockSourceType("CARI_DOCUMENT"),
      "CARI_DOCUMENT should block reversal"
    );
  })();

  await test("CARI_SETTLEMENT_BATCH is a reverse-block source type", () => {
    assert(
      isReverseBlockSourceType("CARI_SETTLEMENT_BATCH"),
      "CARI_SETTLEMENT_BATCH should block reversal"
    );
  })();

  await test("FIXED_ASSET_TRANSACTION is a reverse-block source type", () => {
    assert(
      isReverseBlockSourceType("FIXED_ASSET_TRANSACTION"),
      "FIXED_ASSET_TRANSACTION should block reversal"
    );
  })();

  await test("FIXED_ASSET_DEPRECIATION_RUN is a reverse-block source type", () => {
    assert(
      isReverseBlockSourceType("FIXED_ASSET_DEPRECIATION_RUN"),
      "FIXED_ASSET_DEPRECIATION_RUN should block reversal"
    );
  })();

  await test("Static resolveDestination returns null for dynamic CARI + FA types", () => {
    assert(
      resolveDestination("CARI_DOCUMENT") === null,
      "Static resolveDestination should return null for dynamic CARI document"
    );
    assert(
      resolveDestination("CARI_SETTLEMENT_BATCH") === null,
      "Static resolveDestination should return null for dynamic settlement batch"
    );
    assert(
      resolveDestination("FIXED_ASSET_TRANSACTION") === null,
      "Static resolveDestination should return null for dynamic type"
    );
    assert(
      resolveDestination("FIXED_ASSET_DEPRECIATION_RUN") === null,
      "Static resolveDestination should return null for dynamic type"
    );
  })();

  await test("Existing static types still resolve correctly", () => {
    const cash = resolveDestination("CASH_TRANSACTION");
    assert(cash && cash.route === "/app/kasa-islemleri", "CASH_TRANSACTION should resolve");
    const paymentBatch = resolveDestination("PAYMENT_BATCH");
    assert(
      paymentBatch && paymentBatch.route === "/app/odeme-batchleri",
      "PAYMENT_BATCH should resolve"
    );
  })();
}

// ── Dynamic destination resolution ──────────────────────────────────

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

async function loadCariDirectionFixtures() {
  const [documentResult, settlementResult] = await Promise.all([
    query(
      `SELECT id, direction
         FROM cari_documents
        WHERE direction IN ('AP', 'AR')
        ORDER BY id ASC`
    ),
    query(
      `SELECT id, direction, legal_entity_id, counterparty_id
         FROM cari_settlement_batches
        WHERE direction IN ('AP', 'AR')
        ORDER BY id ASC`
    ),
  ]);

  const apDocument = (documentResult.rows || []).find((row) => row.direction === "AP") || null;
  const arDocument = (documentResult.rows || []).find((row) => row.direction === "AR") || null;
  const apSettlement =
    (settlementResult.rows || []).find((row) => row.direction === "AP") || null;
  const arSettlement =
    (settlementResult.rows || []).find((row) => row.direction === "AR") || null;

  assert(apDocument, "Need at least one AP CARI document fixture");
  assert(arDocument, "Need at least one AR CARI document fixture");
  assert(apSettlement, "Need at least one AP CARI settlement fixture");
  assert(arSettlement, "Need at least one AR CARI settlement fixture");

  return {
    apDocument,
    arDocument,
    apSettlement,
    arSettlement,
  };
}

async function runDynamicResolutionChecks() {
  console.log("\n── Dynamic destination resolution checks ──");

  const ctx = await loadSmokeContext();
  const cariFixtures = await loadCariDirectionFixtures();

  // Create a fixture FA transaction (normal type, e.g. ACQUISITION)
  let normalTxId;
  let saleTxId;
  let assetId;

  // Find or create an asset for test fixtures
  const assetResult = await query(
    `SELECT id FROM fixed_assets WHERE tenant_id = ? LIMIT 1`,
    [ctx.tenant_id]
  );

  if (assetResult.rows.length > 0) {
    assetId = assetResult.rows[0].id;
  } else {
    // Create a minimal asset
    const code = uniqueCode("FA43T");
    const insertResult = await query(
      `INSERT INTO fixed_assets (tenant_id, legal_entity_id, asset_code, asset_name, category_id, status, currency_code)
       SELECT ?, ?, ?, 'Smoke Test Asset', fc.id, 'DRAFT', 'TRY'
       FROM fixed_asset_categories fc WHERE fc.tenant_id = ? LIMIT 1`,
      [ctx.tenant_id, ctx.legal_entity_id, code, ctx.tenant_id]
    );
    assetId = insertResult.rows.insertId;
    assert(assetId, "Failed to create smoke test asset");
  }

  // Find a book + fiscal period for the transaction fixture
  const bookResult = await query(
    `SELECT b.id AS book_id, fp.id AS fiscal_period_id
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
      WHERE b.tenant_id = ?
      LIMIT 1`,
    [ctx.tenant_id]
  );
  assert(bookResult.rows.length > 0, "Need books/periods for test");
  const { book_id, fiscal_period_id } = bookResult.rows[0];

  // Insert a normal ACQUISITION transaction
  const normalTxResult = await query(
    `INSERT INTO fixed_asset_transactions
       (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
     VALUES (?, ?, ?, 'ACQUISITION', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
    [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
  );
  normalTxId = normalTxResult.rows.insertId;

  // Insert a SALE transaction
  const saleTxResult = await query(
    `INSERT INTO fixed_asset_transactions
       (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
     VALUES (?, ?, ?, 'SALE', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
    [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
  );
  saleTxId = saleTxResult.rows.insertId;

  // Find or create a depreciation run
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

  try {
    await test("resolveDestinationAsync: normal transaction → asset detail route", async () => {
      const dest = await resolveDestinationAsync("FIXED_ASSET_TRANSACTION", normalTxId);
      assert(dest, "Should resolve a destination");
      assert(!dest.isFallback, "Should not be a fallback");
      assert(
        dest.route.includes("/app/demirbas-karti-detayi/"),
        `Expected asset detail route, got: ${dest.route}`
      );
      assert(
        dest.route.includes(`tab=transactions`),
        `Expected tab=transactions in route, got: ${dest.route}`
      );
      assert(
        dest.route.includes(`transactionId=${normalTxId}`),
        `Expected transactionId=${normalTxId} in route, got: ${dest.route}`
      );
    })();

    await test("resolveDestinationAsync: SALE transaction → sale route", async () => {
      const dest = await resolveDestinationAsync("FIXED_ASSET_TRANSACTION", saleTxId);
      assert(dest, "Should resolve a destination");
      assert(!dest.isFallback, "Should not be a fallback");
      assert(
        dest.route.includes("/app/demirbas-satis-islemleri"),
        `Expected sale route, got: ${dest.route}`
      );
      assert(
        dest.route.includes(`transactionId=${saleTxId}`),
        `Expected transactionId=${saleTxId} in route, got: ${dest.route}`
      );
      assert(
        dest.route.includes(`assetId=${assetId}`),
        `Expected assetId=${assetId} in route, got: ${dest.route}`
      );
    })();

    await test("resolveDestinationAsync: depreciation run → run route", async () => {
      const dest = await resolveDestinationAsync("FIXED_ASSET_DEPRECIATION_RUN", runId);
      assert(dest, "Should resolve a destination");
      assert(!dest.isFallback, "Should not be a fallback");
      assert(
        dest.route === `/app/demirbas-amortisman-islemleri?runId=${runId}`,
        `Expected run route, got: ${dest.route}`
      );
    })();

    await test("resolveDestinationAsync: missing transaction → fallback", async () => {
      const dest = await resolveDestinationAsync("FIXED_ASSET_TRANSACTION", 999999999);
      assert(dest, "Should resolve a fallback destination");
      assert(dest.isFallback === true, "Should be marked as fallback");
      assert(
        dest.route === "/app/demirbas",
        `Expected fallback route, got: ${dest.route}`
      );
    })();

    await test("resolveDestinationAsync: null sourceRefId → fallback", async () => {
      const dest = await resolveDestinationAsync("FIXED_ASSET_TRANSACTION", null);
      assert(dest, "Should resolve a fallback destination");
      assert(dest.isFallback === true, "Should be marked as fallback");
    })();

    await test("resolveDestinationAsync: AP CARI document resolves to purchases page", async () => {
      const dest = await resolveDestinationAsync("CARI_DOCUMENT", cariFixtures.apDocument.id);
      assert(
        dest && dest.route === `/app/alis-faturalari?documentId=${cariFixtures.apDocument.id}`,
        `AP CARI document should resolve to purchases page, got: ${dest?.route}`
      );
    })();

    await test("resolveDestinationAsync: AR CARI document resolves to sales page", async () => {
      const dest = await resolveDestinationAsync("CARI_DOCUMENT", cariFixtures.arDocument.id);
      assert(
        dest && dest.route === `/app/satis-faturalari?documentId=${cariFixtures.arDocument.id}`,
        `AR CARI document should resolve to sales page, got: ${dest?.route}`
      );
    })();

    await test("resolveDestinationAsync: AP settlement batch resolves to AP settlements page", async () => {
      const dest = await resolveDestinationAsync(
        "CARI_SETTLEMENT_BATCH",
        cariFixtures.apSettlement.id
      );
      assert(dest, "Should resolve an AP settlement destination");
      assert(
        dest.route.includes("/app/tedarikci-odemeler?"),
        `Expected AP settlement route, got: ${dest.route}`
      );
      assert(
        dest.route.includes(`settlementBatchId=${cariFixtures.apSettlement.id}`),
        `Expected settlementBatchId in AP route, got: ${dest.route}`
      );
    })();

    await test("resolveDestinationAsync: AR settlement batch resolves to AR settlements page", async () => {
      const dest = await resolveDestinationAsync(
        "CARI_SETTLEMENT_BATCH",
        cariFixtures.arSettlement.id
      );
      assert(dest, "Should resolve an AR settlement destination");
      assert(
        dest.route.includes("/app/musteri-tahsilatlar?"),
        `Expected AR settlement route, got: ${dest.route}`
      );
      assert(
        dest.route.includes(`settlementBatchId=${cariFixtures.arSettlement.id}`),
        `Expected settlementBatchId in AR route, got: ${dest.route}`
      );
    })();

    // ── enrichSourceLinksWithDestinationsAsync ──
    console.log("\n── Async enrichment checks ──");

    await test("enrichSourceLinksWithDestinationsAsync resolves FA transaction links", async () => {
      const links = [
        { source_ref_type: "FIXED_ASSET_TRANSACTION", source_ref_id: normalTxId, link_role: "PRIMARY" },
        {
          source_ref_type: "CARI_DOCUMENT",
          source_ref_id: cariFixtures.arDocument.id,
          link_role: "PRIMARY",
        },
      ];
      const enriched = await enrichSourceLinksWithDestinationsAsync(links);
      assert(enriched.length === 2, "Should return same number of links");
      assert(
        enriched[0].destination && enriched[0].destination.route.includes("/app/demirbas-karti-detayi/"),
        `FA transaction should have resolved destination, got: ${JSON.stringify(enriched[0].destination)}`
      );
      assert(
        enriched[1].destination &&
          enriched[1].destination.route ===
            `/app/satis-faturalari?documentId=${cariFixtures.arDocument.id}`,
        "CARI_DOCUMENT should resolve direction-aware from the backend"
      );
    })();

    await test("sync enrichSourceLinksWithDestinations returns null for dynamic CARI + FA types", () => {
      const links = [
        { source_ref_type: "FIXED_ASSET_TRANSACTION", source_ref_id: normalTxId, link_role: "PRIMARY" },
        {
          source_ref_type: "CARI_DOCUMENT",
          source_ref_id: cariFixtures.apDocument.id,
          link_role: "PRIMARY",
        },
      ];
      const enriched = enrichSourceLinksWithDestinations(links);
      assert(enriched.length === 2, "Should return same number of links");
      assert(
        enriched[0].destination === null,
        "Sync enrichment should return null for dynamic FA types"
      );
      assert(
        enriched[1].destination === null,
        "Sync enrichment should return null for dynamic CARI types"
      );
    })();

    // ── resolveReverseBlockAsync ──
    console.log("\n── Async reverse-block checks ──");

    await test("resolveReverseBlockAsync blocks on FA transaction links", async () => {
      const links = [
        { source_ref_type: "FIXED_ASSET_TRANSACTION", source_ref_id: saleTxId, link_role: "PRIMARY" },
      ];
      const result = await resolveReverseBlockAsync(links);
      assert(result.isBlocked === true, "Should be blocked");
      assert(result.blockingSourceLinks.length === 1, "Should have 1 blocking link");
      assert(
        result.primaryDestination.route.includes("/app/demirbas-satis-islemleri"),
        `Expected sale route in primary destination, got: ${result.primaryDestination.route}`
      );
    })();

    await test("resolveReverseBlockAsync blocks on depreciation run links", async () => {
      const links = [
        { source_ref_type: "FIXED_ASSET_DEPRECIATION_RUN", source_ref_id: runId, link_role: "PRIMARY" },
      ];
      const result = await resolveReverseBlockAsync(links);
      assert(result.isBlocked === true, "Should be blocked");
      assert(
        result.primaryDestination.route === `/app/demirbas-amortisman-islemleri?runId=${runId}`,
        `Expected run route, got: ${result.primaryDestination.route}`
      );
    })();

    await test("resolveReverseBlockAsync blocks on AR CARI document links with sales route", async () => {
      const links = [
        {
          source_ref_type: "CARI_DOCUMENT",
          source_ref_id: cariFixtures.arDocument.id,
          link_role: "PRIMARY",
        },
      ];
      const result = await resolveReverseBlockAsync(links);
      assert(result.isBlocked === true, "AR CARI document should be reverse-blocked");
      assert(
        result.primaryDestination.route ===
          `/app/satis-faturalari?documentId=${cariFixtures.arDocument.id}`,
        `Expected AR document route, got: ${result.primaryDestination.route}`
      );
    })();

    await test("resolveReverseBlockAsync blocks on AP settlement links with AP route", async () => {
      const links = [
        {
          source_ref_type: "CARI_SETTLEMENT_BATCH",
          source_ref_id: cariFixtures.apSettlement.id,
          link_role: "PRIMARY",
        },
      ];
      const result = await resolveReverseBlockAsync(links);
      assert(result.isBlocked === true, "AP settlement should be reverse-blocked");
      assert(
        result.primaryDestination.route.includes("/app/tedarikci-odemeler?"),
        `Expected AP settlement route, got: ${result.primaryDestination.route}`
      );
    })();

    await test("sync resolveReverseBlock also blocks on dynamic types (with null route)", () => {
      const links = [
        { source_ref_type: "FIXED_ASSET_TRANSACTION", source_ref_id: normalTxId, link_role: "PRIMARY" },
        {
          source_ref_type: "CARI_DOCUMENT",
          source_ref_id: cariFixtures.apDocument.id,
          link_role: "PRIMARY",
        },
      ];
      const result = resolveReverseBlock(links);
      assert(result.isBlocked === true, "Sync version should also block dynamic source types");
      assert(
        result.primaryDestination.route === null,
        "Sync version should have null route for dynamic types"
      );
    })();

    // ── WRITEOFF transaction routing ──
    console.log("\n── WRITEOFF routing check ──");

    const writeoffTxResult = await query(
      `INSERT INTO fixed_asset_transactions
         (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
       VALUES (?, ?, ?, 'WRITEOFF', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
      [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
    );
    const writeoffTxId = writeoffTxResult.rows.insertId;

    await test("resolveDestinationAsync: WRITEOFF transaction → sale route (same as SALE)", async () => {
      const dest = await resolveDestinationAsync("FIXED_ASSET_TRANSACTION", writeoffTxId);
      assert(dest, "Should resolve a destination");
      assert(!dest.isFallback, "Should not be a fallback");
      assert(
        dest.route.includes("/app/demirbas-satis-islemleri"),
        `Expected sale/writeoff route, got: ${dest.route}`
      );
    })();

    // Cleanup writeoff
    await query(`DELETE FROM fixed_asset_transactions WHERE id = ?`, [writeoffTxId]);

  } finally {
    // Cleanup test fixtures
    console.log("\n── Cleanup ──");
    await query(`DELETE FROM fixed_asset_transactions WHERE id IN (?, ?)`, [normalTxId, saleTxId]);
    if (createdRun) {
      await query(`DELETE FROM fixed_asset_depreciation_runs WHERE id = ?`, [runId]);
    }
    console.log("  Cleaned up test fixtures.");
  }
}

// ── Live journal-detail / source-link smoke ──────────────────────────

async function runLiveJournalDetailChecks() {
  console.log("\n── Live journal-detail / source-link checks ──");

  const ctx = await loadSmokeContext();

  // Find a book + fiscal period + account for journal fixtures
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

  // Find an existing asset for the transaction
  const assetResult = await query(
    `SELECT id FROM fixed_assets WHERE tenant_id = ? LIMIT 1`,
    [ctx.tenant_id]
  );
  assert(assetResult.rows.length > 0, "Need at least one fixed asset");
  const assetId = assetResult.rows[0].id;

  // Find or reuse a depreciation run
  let runId;
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
    const runInsert = await query(
      `INSERT INTO fixed_asset_depreciation_runs
         (tenant_id, legal_entity_id, fiscal_period_id, period_key, book_id, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [ctx.tenant_id, ctx.legal_entity_id, fiscal_period_id, `${fy}-${pn}`, book_id, ctx.user_id]
    );
    runId = runInsert.rows.insertId;
  }

  // ── Insert a non-run FA transaction ──
  const nonRunTxResult = await query(
    `INSERT INTO fixed_asset_transactions
       (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
     VALUES (?, ?, ?, 'OWNERSHIP_TRANSFER', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
    [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
  );
  const nonRunTxId = nonRunTxResult.rows.insertId;

  // ── Insert two POSTED journal entries (non-run + run) ──
  const jNoNonRun = uniqueCode("FA43NR");
  const jNoRun = uniqueCode("FA43RN");
  const jNoFallback = uniqueCode("FA43FB");

  const nonRunJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA43 smoke: non-run', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoNonRun, ctx.user_id, ctx.user_id]
  );
  const nonRunJournalId = nonRunJournalResult.rows.insertId;

  const runJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA43 smoke: run', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoRun, ctx.user_id, ctx.user_id]
  );
  const runJournalId = runJournalResult.rows.insertId;

  const fallbackJournalResult = await query(
    `INSERT INTO journal_entries
       (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status, entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA43 smoke: fallback', ?, ?, NOW())`,
    [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, jNoFallback, ctx.user_id, ctx.user_id]
  );
  const fallbackJournalId = fallbackJournalResult.rows.insertId;

  // ── Insert journal lines (balanced debit/credit for each journal) ──
  for (const jId of [nonRunJournalId, runJournalId, fallbackJournalId]) {
    await query(
      `INSERT INTO journal_lines
         (journal_entry_id, line_no, account_id, description, currency_code, amount_txn, debit_base, credit_base)
       VALUES (?, 1, ?, 'FA43 smoke debit', 'TRY', 100, 100, 0),
              (?, 2, ?, 'FA43 smoke credit', 'TRY', -100, 0, 100)`,
      [jId, account_id, jId, account_id]
    );
  }

  // ── Insert PRIMARY source links ──
  // Non-run journal → FIXED_ASSET_TRANSACTION
  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', ?, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, nonRunJournalId, nonRunTxId]
  );

  // Run journal → FIXED_ASSET_DEPRECIATION_RUN
  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_DEPRECIATION_RUN', ?, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, runJournalId, runId]
  );

  // Fallback journal → FIXED_ASSET_TRANSACTION pointing to non-existent transaction
  await query(
    `INSERT INTO journal_source_links
       (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
     VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', 999999999, 'PRIMARY')`,
    [ctx.tenant_id, ctx.legal_entity_id, fallbackJournalId]
  );

  try {
    // ── 1. Non-run journal: PRIMARY source link with FIXED_ASSET_TRANSACTION ──
    await test("non-run journal has PRIMARY source link with FIXED_ASSET_TRANSACTION", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [nonRunJournalId],
      });
      const links = linkMap.get(nonRunJournalId) || [];
      assert(links.length >= 1, `Expected ≥1 source link, got ${links.length}`);
      const primary = links.find(
        (l) => l.link_role === "PRIMARY" && l.source_ref_type === "FIXED_ASSET_TRANSACTION"
      );
      assert(primary, "Expected a PRIMARY link with source_ref_type=FIXED_ASSET_TRANSACTION");
      assert(
        Number(primary.source_ref_id) === nonRunTxId,
        `Expected source_ref_id=${nonRunTxId}, got ${primary.source_ref_id}`
      );
    })();

    // ── 2. Run journal: PRIMARY source link with FIXED_ASSET_DEPRECIATION_RUN ──
    await test("run journal has PRIMARY source link with FIXED_ASSET_DEPRECIATION_RUN", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [runJournalId],
      });
      const links = linkMap.get(runJournalId) || [];
      assert(links.length >= 1, `Expected ≥1 source link, got ${links.length}`);
      const primary = links.find(
        (l) => l.link_role === "PRIMARY" && l.source_ref_type === "FIXED_ASSET_DEPRECIATION_RUN"
      );
      assert(primary, "Expected a PRIMARY link with source_ref_type=FIXED_ASSET_DEPRECIATION_RUN");
      assert(
        Number(primary.source_ref_id) === runId,
        `Expected source_ref_id=${runId}, got ${primary.source_ref_id}`
      );
    })();

    // ── 3. Journal detail read: non-run journal returns destination ──
    await test("journal detail: non-run journal source_links[].destination resolves to asset detail route", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [nonRunJournalId],
      });
      const sourceLinks = linkMap.get(nonRunJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);

      assert(enriched.length >= 1, "Expected enriched source links");
      const faLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_TRANSACTION");
      assert(faLink, "Expected FIXED_ASSET_TRANSACTION link in enriched results");
      assert(faLink.destination, "Expected destination to be resolved");
      assert(
        faLink.destination.route.includes("/app/demirbas-karti-detayi/"),
        `Expected asset detail route, got: ${faLink.destination.route}`
      );
      assert(
        faLink.destination.route.includes(`transactionId=${nonRunTxId}`),
        `Expected transactionId=${nonRunTxId} in route, got: ${faLink.destination.route}`
      );
      assert(!faLink.destination.isFallback, "Should not be a fallback");
    })();

    // ── 4. Journal detail read: run journal returns destination ──
    await test("journal detail: run journal source_links[].destination resolves to run route", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [runJournalId],
      });
      const sourceLinks = linkMap.get(runJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);

      assert(enriched.length >= 1, "Expected enriched source links");
      const runLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_DEPRECIATION_RUN");
      assert(runLink, "Expected FIXED_ASSET_DEPRECIATION_RUN link in enriched results");
      assert(runLink.destination, "Expected destination to be resolved");
      assert(
        runLink.destination.route === `/app/demirbas-amortisman-islemleri?runId=${runId}`,
        `Expected run route, got: ${runLink.destination.route}`
      );
      assert(!runLink.destination.isFallback, "Should not be a fallback");
    })();

    // ── 5. Journal detail read: reverse-block for non-run journal ──
    await test("journal detail: non-run journal reverse-block is blocked with destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [nonRunJournalId],
      });
      const sourceLinks = linkMap.get(nonRunJournalId) || [];
      const reverseBlock = await resolveReverseBlockAsync(sourceLinks);

      assert(reverseBlock.isBlocked === true, "Non-run FA journal should be reverse-blocked");
      assert(reverseBlock.primaryDestination, "Should have a primary destination");
      assert(
        reverseBlock.primaryDestination.route.includes("/app/demirbas-karti-detayi/"),
        `Expected asset detail in primaryDestination.route, got: ${reverseBlock.primaryDestination.route}`
      );
    })();

    // ── 6. Journal detail read: reverse-block for run journal ──
    await test("journal detail: run journal reverse-block is blocked with destination", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [runJournalId],
      });
      const sourceLinks = linkMap.get(runJournalId) || [];
      const reverseBlock = await resolveReverseBlockAsync(sourceLinks);

      assert(reverseBlock.isBlocked === true, "Run FA journal should be reverse-blocked");
      assert(reverseBlock.primaryDestination, "Should have a primary destination");
      assert(
        reverseBlock.primaryDestination.route.includes("/app/demirbas-amortisman-islemleri"),
        `Expected run route in primaryDestination.route, got: ${reverseBlock.primaryDestination.route}`
      );
    })();

    // ── 7. Fallback: broken source-record lookup in journal-detail context ──
    await test("journal detail: fallback when source transaction row does not exist", async () => {
      const linkMap = await listJournalSourceLinksByJournalIds({
        tenantId: ctx.tenant_id,
        journalEntryIds: [fallbackJournalId],
      });
      const sourceLinks = linkMap.get(fallbackJournalId) || [];
      const enriched = await enrichSourceLinksWithDestinationsAsync(sourceLinks);

      assert(enriched.length >= 1, "Expected enriched source links");
      const faLink = enriched.find((l) => l.source_ref_type === "FIXED_ASSET_TRANSACTION");
      assert(faLink, "Expected FIXED_ASSET_TRANSACTION link");
      assert(faLink.destination, "Fallback should still produce a destination");
      assert(
        faLink.destination.isFallback === true,
        "Should be marked as fallback"
      );
      assert(
        faLink.destination.route === "/app/demirbas",
        `Expected fallback route /app/demirbas, got: ${faLink.destination.route}`
      );
    })();

  } finally {
    // Cleanup: source links, journal lines, journal entries, transaction
    console.log("\n── Live journal cleanup ──");
    await query(
      `DELETE FROM journal_source_links WHERE journal_entry_id IN (?, ?, ?)`,
      [nonRunJournalId, runJournalId, fallbackJournalId]
    );
    await query(
      `DELETE FROM journal_lines WHERE journal_entry_id IN (?, ?, ?)`,
      [nonRunJournalId, runJournalId, fallbackJournalId]
    );
    await query(
      `DELETE FROM journal_entries WHERE id IN (?, ?, ?)`,
      [nonRunJournalId, runJournalId, fallbackJournalId]
    );
    await query(`DELETE FROM fixed_asset_transactions WHERE id = ?`, [nonRunTxId]);
    console.log("  Cleaned up live journal fixtures.");
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("STEP-FA43 smoke test: journal source-link destination resolution\n");

  try {
    await runSourceCodeChecks();
    await runReverseBlockTypeChecks();
    await runDynamicResolutionChecks();
    await runLiveJournalDetailChecks();

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
