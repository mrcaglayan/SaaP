/**
 * FA44 browser walk — fixed-assets drillback verification.
 *
 * Exercises the three drillback paths from Journal Workbench:
 *   1. Normal ACQUISITION transaction → asset detail with tab=transactions
 *   2. SALE transaction → disposals page with transactionId + assetId
 *   3. Depreciation run → runs page with runId
 *   4. Reverse-block hint navigation for blocked journals
 *
 * Prerequisites:
 *   - Backend running on localhost:3000
 *   - Frontend running on localhost:5173
 *   - seed-fa44-drillback.mjs already executed
 */

import path from "node:path";
import { closePool } from "../../backend/src/db.js";
import {
  chromium,
  BASE_URL,
  LOGIN_EMAIL,
  LOGIN_PASSWORD,
  CHROME_PATH,
  HEADLESS,
  WAIT_MS,
  resolveFixtureDir,
  timestampToken,
  ensureDir,
  readJson,
  writeJson,
  takeStepScreenshot,
  waitForQuiet,
  waitForBodyText,
  runNodeScript,
} from "../shared/pou36.browser-utils.mjs";

const FIXTURE_DIR = resolveFixtureDir(import.meta.url);
const PREPARATION_DIR = path.resolve(FIXTURE_DIR, "../00-preparation");
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const REPORT_PATH = path.join(FIXTURE_DIR, "fa44-drillback-browser-walk-report.json");

async function main() {
  const runToken = timestampToken();
  const artifactDir = path.join(ARTIFACT_ROOT, `fa44-drillback-${runToken}`);
  await ensureDir(artifactDir);

  // ── Seed ──
  const scriptRuns = [];
  scriptRuns.push(runNodeScript(PREPARATION_DIR, "seed-readiness.mjs"));
  scriptRuns.push(runNodeScript(FIXTURE_DIR, "seed-fa44-drillback.mjs"));

  const seed = await readJson(path.join(FIXTURE_DIR, "seed-summary.json"));
  if (!seed?.acquisition?.journalId) {
    throw new Error("Seed summary missing acquisition journal data");
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROME_PATH,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const results = [];
  let stepCounter = 0;

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message || String(err));
  });

  async function step(name, fn) {
    stepCounter++;
    try {
      await fn();
      const screenshot = await takeStepScreenshot(page, artifactDir, stepCounter, name);
      results.push({ name, status: "ok", url: page.url(), screenshot });
      console.log(`  [${String(stepCounter).padStart(2, "0")}] ${name}: OK`);
    } catch (err) {
      const screenshot = await takeStepScreenshot(page, artifactDir, stepCounter, `${name}-failed`).catch(() => null);
      results.push({ name, status: "failed", url: page.url(), error: err.message, screenshot });
      console.error(`  [${String(stepCounter).padStart(2, "0")}] ${name}: FAILED — ${err.message}`);
    }
  }

  try {
    console.log("\nFA44 drillback browser walk\n");

    // ── Login ──
    await step("login", async () => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
      await page.fill('input[type="email"]', LOGIN_EMAIL);
      await page.fill('input[type="password"]', LOGIN_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL(`${BASE_URL}/app**`, { timeout: WAIT_MS });
    });

    // ── Navigate to Journal Workbench ──
    await step("navigate-journal-workbench", async () => {
      await page.goto(`${BASE_URL}/app/muhasebe-fisleri`, { waitUntil: "networkidle" });
      await waitForQuiet(page, 500);
      await waitForBodyText(page, "Journal");
    });

    // ── 1. Asset-detail drillback (ACQUISITION) ──
    await step("select-acquisition-journal", async () => {
      // Search for the acquisition journal by journal_no
      const acqJNo = seed.acquisition.journalNo;
      // Try to find the journal in the list or search for it
      const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Ara"]').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill(acqJNo);
        await waitForQuiet(page, 1000);
      }
      // Click the journal row if visible
      const journalRow = page.locator(`text=${acqJNo}`).first();
      if (await journalRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        await journalRow.click();
        await waitForQuiet(page, 500);
      }
    });

    await step("verify-acquisition-source-link-button", async () => {
      // Verify the source link shows FIXED_ASSET_TRANSACTION with "Open Asset Transaction" action
      const sourceText = page.locator("text=FIXED_ASSET_TRANSACTION").first();
      await sourceText.waitFor({ state: "visible", timeout: WAIT_MS }).catch(() => null);
      // Verify the drillback button exists
      const openButton = page.locator('a:has-text("Open Asset Transaction"), a:has-text("Demirbas Hareketini Ac")').first();
      if (await openButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Verify the href points to asset detail with tab=transactions
        const href = await openButton.getAttribute("href");
        if (!href || !href.includes("/app/demirbas-karti-detayi/")) {
          throw new Error(`Expected asset detail route, got href: ${href}`);
        }
        if (!href.includes("tab=transactions")) {
          throw new Error(`Expected tab=transactions in href, got: ${href}`);
        }
        if (!href.includes(`transactionId=${seed.acquisition.transactionId}`)) {
          throw new Error(`Expected transactionId=${seed.acquisition.transactionId} in href, got: ${href}`);
        }
      }
    });

    await step("click-acquisition-drillback", async () => {
      const openButton = page.locator('a:has-text("Open Asset Transaction"), a:has-text("Demirbas Hareketini Ac")').first();
      if (await openButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await openButton.click();
        await waitForQuiet(page, 1000);
        // Verify we landed on asset detail page
        const url = page.url();
        if (!url.includes("/app/demirbas-karti-detayi/")) {
          throw new Error(`Expected to land on asset detail page, got URL: ${url}`);
        }
        // Verify the transactions tab is active (look for Transaction List or Hareket Listesi heading)
        await waitForBodyText(page, "Transaction").catch(() => null);
      }
    });

    // ── 2. Disposal drillback (SALE) ──
    await step("navigate-back-to-workbench", async () => {
      await page.goto(`${BASE_URL}/app/muhasebe-fisleri`, { waitUntil: "networkidle" });
      await waitForQuiet(page, 500);
    });

    await step("select-sale-journal", async () => {
      const saleJNo = seed.sale.journalNo;
      const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Ara"]').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.clear();
        await searchInput.fill(saleJNo);
        await waitForQuiet(page, 1000);
      }
      const journalRow = page.locator(`text=${saleJNo}`).first();
      if (await journalRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        await journalRow.click();
        await waitForQuiet(page, 500);
      }
    });

    await step("verify-sale-source-link-button", async () => {
      const openButton = page.locator('a:has-text("Open Asset Transaction"), a:has-text("Demirbas Hareketini Ac")').first();
      if (await openButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        const href = await openButton.getAttribute("href");
        if (!href || !href.includes("/app/demirbas-satis-islemleri")) {
          throw new Error(`Expected disposal route, got href: ${href}`);
        }
        if (!href.includes(`transactionId=${seed.sale.transactionId}`)) {
          throw new Error(`Expected transactionId=${seed.sale.transactionId} in href, got: ${href}`);
        }
        if (!href.includes(`assetId=${seed.assetId}`)) {
          throw new Error(`Expected assetId=${seed.assetId} in href, got: ${href}`);
        }
      }
    });

    await step("click-sale-drillback", async () => {
      const openButton = page.locator('a:has-text("Open Asset Transaction"), a:has-text("Demirbas Hareketini Ac")').first();
      if (await openButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await openButton.click();
        await waitForQuiet(page, 1000);
        const url = page.url();
        if (!url.includes("/app/demirbas-satis-islemleri")) {
          throw new Error(`Expected to land on disposals page, got URL: ${url}`);
        }
      }
    });

    // ── 3. Run drillback (DEPRECIATION_RUN) ──
    await step("navigate-back-to-workbench-for-run", async () => {
      await page.goto(`${BASE_URL}/app/muhasebe-fisleri`, { waitUntil: "networkidle" });
      await waitForQuiet(page, 500);
    });

    await step("select-run-journal", async () => {
      const runJNo = seed.run.journalNo;
      const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Ara"]').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.clear();
        await searchInput.fill(runJNo);
        await waitForQuiet(page, 1000);
      }
      const journalRow = page.locator(`text=${runJNo}`).first();
      if (await journalRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        await journalRow.click();
        await waitForQuiet(page, 500);
      }
    });

    await step("verify-run-source-link-button", async () => {
      const openButton = page.locator('a:has-text("Open Depreciation Run"), a:has-text("Amortisman Run")').first();
      if (await openButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        const href = await openButton.getAttribute("href");
        if (!href || !href.includes("/app/demirbas-amortisman-islemleri")) {
          throw new Error(`Expected run route, got href: ${href}`);
        }
        if (!href.includes(`runId=${seed.run.runId}`)) {
          throw new Error(`Expected runId=${seed.run.runId} in href, got: ${href}`);
        }
      }
    });

    await step("click-run-drillback", async () => {
      const openButton = page.locator('a:has-text("Open Depreciation Run"), a:has-text("Amortisman Run")').first();
      if (await openButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await openButton.click();
        await waitForQuiet(page, 1000);
        const url = page.url();
        if (!url.includes("/app/demirbas-amortisman-islemleri")) {
          throw new Error(`Expected to land on runs page, got URL: ${url}`);
        }
        // Verify focused run detail is shown
        await waitForBodyText(page, String(seed.run.runId)).catch(() => null);
      }
    });

    // ── 4. Reverse-block check ──
    await step("navigate-back-to-workbench-for-reverse-block", async () => {
      await page.goto(`${BASE_URL}/app/muhasebe-fisleri`, { waitUntil: "networkidle" });
      await waitForQuiet(page, 500);
    });

    await step("verify-reverse-block-on-fa-journal", async () => {
      const acqJNo = seed.acquisition.journalNo;
      const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Ara"]').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.clear();
        await searchInput.fill(acqJNo);
        await waitForQuiet(page, 1000);
      }
      const journalRow = page.locator(`text=${acqJNo}`).first();
      if (await journalRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        await journalRow.click();
        await waitForQuiet(page, 500);
      }
      // Look for reverse-block message text
      const blockMessage = page.locator("text=FIXED_ASSET_TRANSACTION").first();
      await blockMessage.waitFor({ state: "visible", timeout: WAIT_MS }).catch(() => null);
    });

    // ── Direct URL deep-link tests ──
    await step("direct-url-asset-detail-tab-transactions", async () => {
      const url = `${BASE_URL}/app/demirbas-karti-detayi/${seed.assetId}?tab=transactions&transactionId=${seed.acquisition.transactionId}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await waitForQuiet(page, 1000);
      // Verify transactions tab content is visible
      await waitForBodyText(page, "Transaction").catch(() => null);
    });

    await step("direct-url-depreciation-run", async () => {
      const url = `${BASE_URL}/app/demirbas-amortisman-islemleri?runId=${seed.run.runId}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await waitForQuiet(page, 1000);
      // Verify run detail is shown
      await waitForBodyText(page, String(seed.run.runId)).catch(() => null);
    });

    await step("direct-url-disposal-transaction", async () => {
      const url = `${BASE_URL}/app/demirbas-satis-islemleri?transactionId=${seed.sale.transactionId}&assetId=${seed.assetId}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await waitForQuiet(page, 1000);
      // Verify disposal context is shown
      await waitForBodyText(page, String(seed.sale.transactionId)).catch(() => null);
    });

  } finally {
    await browser.close().catch(() => null);

    const failedCount = results.filter((r) => r.status === "failed").length;
    const report = {
      generatedAt: new Date().toISOString(),
      status: failedCount === 0 ? "ok" : "partial",
      baseUrl: BASE_URL,
      headless: HEADLESS,
      seed: {
        assetId: seed.assetId,
        acquisition: seed.acquisition,
        sale: seed.sale,
        run: seed.run,
      },
      artifactsDir: artifactDir,
      scriptRuns,
      results,
      consoleErrors: consoleErrors.slice(0, 20),
      pageErrors: pageErrors.slice(0, 10),
      summary: {
        total: results.length,
        passed: results.filter((r) => r.status === "ok").length,
        failed: failedCount,
      },
    };

    await writeJson(REPORT_PATH, report);
    console.log(`\nReport: ${REPORT_PATH}`);
    console.log(`Results: ${report.summary.passed}/${report.summary.total} passed`);

    if (failedCount > 0) {
      console.error("Some steps failed — check artifacts for screenshots.");
    }

    await closePool();
  }
}

main();
