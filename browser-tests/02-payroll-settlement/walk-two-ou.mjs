import path from "node:path";
import { closePool } from "../../backend/src/db.js";
import {
  chromium,
  BASE_URL,
  API_URL,
  LOGIN_EMAIL,
  LOGIN_PASSWORD,
  CHROME_PATH,
  HEADLESS,
  WAIT_MS,
  SCENARIO,
  resolveFixtureDir,
  timestampToken,
  sanitizeForFile,
  ensureDir,
  runNodeScript,
  readJson,
  writeJson,
  takeStepScreenshot,
  waitForQuiet,
  clickButtonByName,
  fillDateInput,
  fillInputByLabel,
  waitForBodyText,
  assertPreparedBatchBreakdown,
  findLatestPaymentBatchForRun,
} from "../shared/pou36.browser-utils.mjs";

const FIXTURE_DIR = resolveFixtureDir(import.meta.url);
const PREPARATION_DIR = path.resolve(FIXTURE_DIR, "../00-preparation");
const CREATION_DIR = path.resolve(FIXTURE_DIR, "../01-payroll-creation");
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const REPORT_PATH = path.join(FIXTURE_DIR, "two-ou-settlement-browser-walk-report.json");

async function main() {
  const runToken = timestampToken();
  const artifactDir = path.join(ARTIFACT_ROOT, `two-ou-settlement-${runToken}`);
  await ensureDir(artifactDir);

  const scriptRuns = [];
  scriptRuns.push(runNodeScript(PREPARATION_DIR, "seed-readiness.mjs"));
  scriptRuns.push(runNodeScript(CREATION_DIR, "seed-two-ou.mjs"));
  scriptRuns.push(runNodeScript(CREATION_DIR, "walk-two-ou-creation.mjs"));

  const creationReport = await readJson(
    path.join(CREATION_DIR, "two-ou-creation-browser-walk-report.json")
  );
  if (creationReport?.status !== "ok" || !creationReport?.runId) {
    throw new Error("Creation prerequisite report is missing or failed");
  }
  const baseSeedSummary = await readJson(path.join(CREATION_DIR, "seed-summary.json"));
  const centralBankAccountId = String(baseSeedSummary?.centralBankAccountId || "");
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
  const runId = Number(creationReport.runId);
  const runNo = String(creationReport.runNo || "").trim() || null;
  let batchId = null;
  let batchNo = null;
  let closeId = null;

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message || String(err));
  });

  async function runStep(name, fn) {
    stepCounter += 1;
    const stepName = sanitizeForFile(name);
    try {
      const data = (await fn()) || {};
      const screenshot = await takeStepScreenshot(page, artifactDir, stepCounter, stepName);
      results.push({
        name,
        status: "ok",
        url: page.url(),
        screenshot,
        ...data,
      });
      return data;
    } catch (err) {
      const screenshot = await takeStepScreenshot(page, artifactDir, stepCounter, `${stepName}-failed`);
      results.push({
        name,
        status: "failed",
        url: page.url(),
        screenshot,
        error: err?.stack || err?.message || String(err),
      });
      throw err;
    }
  }

  try {
    await runStep("login", async () => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await fillInputByLabel(page, /email/i, LOGIN_EMAIL);
      await fillInputByLabel(page, /password/i, LOGIN_PASSWORD);
      await clickButtonByName(page, /sign in/i);
      await page.waitForURL(/\/app/, { timeout: WAIT_MS });
      await waitForQuiet(page, 500);
      return {
        userEmail: LOGIN_EMAIL,
      };
    });

    await runStep("payroll-liabilities-settlement-entry", async () => {
      await page.goto(`${BASE_URL}/app/payroll-runs/${runId}/liabilities`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("heading", { name: /Bordro Liability & Payment Prep/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await waitForBodyText(page, "CENTRAL");
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou1);
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou2);
      return {
        runId,
        runNo,
      };
    });

    await runStep("payroll-batch-prepare", async () => {
      const existingBatch = await findLatestPaymentBatchForRun(runId);
      if (existingBatch?.id) {
        batchId = Number(existingBatch.id);
        batchNo = String(existingBatch.batch_no || "").trim() || null;
        await assertPreparedBatchBreakdown(page, { batchNo });
        return {
          batchId,
          batchNo,
          reusedExistingBatch: true,
        };
      }

      const bankSelect = page
        .locator("select")
        .filter({ hasText: SCENARIO.centralBankAccountCode })
        .first();
      await bankSelect.waitFor({ state: "visible", timeout: WAIT_MS });
      await bankSelect.selectOption(centralBankAccountId);
      await clickButtonByName(page, /Payment Batch Hazirla/i);
      await waitForBodyText(page, "Batch olustu:");
      const batchLink = page.locator('a[href*="/app/odeme-batchleri/"]').last();
      await batchLink.waitFor({ state: "visible", timeout: WAIT_MS });
      batchNo = (await batchLink.textContent())?.trim() || null;
      const href = await batchLink.getAttribute("href");
      const match = href?.match(/\/app\/odeme-batchleri\/(\d+)/);
      batchId = match?.[1] ? Number(match[1]) : null;
      await waitForBodyText(page, "Payer context: CENTRAL");
      await assertPreparedBatchBreakdown(page, { batchNo });
      return {
        batchId,
        batchNo,
      };
    });

    await runStep("payroll-beneficiary-snapshot", async () => {
      const snapshotButton = page.getByRole("button", { name: "Snapshot" }).first();
      await snapshotButton.waitFor({ state: "visible", timeout: WAIT_MS });
      await snapshotButton.click();
      await page.getByRole("heading", { name: /Beneficiary Snapshot/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      return {};
    });

    await runStep("payroll-sync-preview", async () => {
      await clickButtonByName(page, /Sync Preview Yenile/i);
      await page.getByText("Payment settlement sync preview yenilendi").waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await page.getByText("Scope: ALL").waitFor({ state: "visible", timeout: WAIT_MS });
      return {};
    });

    await runStep("payment-batch-detail", async () => {
      if (!batchId) {
        throw new Error("batchId missing after prepare");
      }
      await page.goto(`${BASE_URL}/app/odeme-batchleri/${batchId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText("Payer Context").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("Owner Context").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("Expected Settlement").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("Cross-context self-balancing").first().waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      return {};
    });

    await runStep("payroll-close-controls", async () => {
      await page.goto(
        `${BASE_URL}/app/payroll-close-controls?legalEntityId=${SCENARIO.legalEntityId}&payrollPeriod=${SCENARIO.payrollPeriod}`,
        { waitUntil: "domcontentloaded" }
      );
      await page.getByRole("heading", { name: "Payroll Close Controls" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await fillDateInput(page, /Period Start/i, "2026-02-01");
      await fillDateInput(page, /Period End/i, "2026-02-28");
      await clickButtonByName(page, /Prepare Checklist/i);
      await waitForBodyText(page, "Checklist prepared.");
      await page.getByRole("heading", { name: /Checklist Results/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      const closeLabel = page.getByText(/Close #\d+/).first();
      await closeLabel.waitFor({ state: "visible", timeout: WAIT_MS });
      const closeText = (await closeLabel.textContent()) || "";
      const match = closeText.match(/Close #(\d+)/);
      closeId = match?.[1] ? Number(match[1]) : null;
      return { closeId };
    });
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    flow: "settlement",
    status: "ok",
    baseUrl: BASE_URL,
    apiUrl: API_URL,
    headless: HEADLESS,
    runId,
    runNo,
    batchId,
    batchNo,
    closeId,
    artifactsDir: artifactDir,
    prerequisiteCreationReport: path.join(CREATION_DIR, "two-ou-creation-browser-walk-report.json"),
    seedScripts: scriptRuns,
    results,
    consoleErrors,
    pageErrors,
  };

  await writeJson(REPORT_PATH, report);
  await writeJson(path.join(artifactDir, "report.json"), report);
  console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, runId, batchId, closeId }, null, 2));
}

try {
  await main();
} catch (err) {
  await writeJson(REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    flow: "settlement",
    status: "failed",
    error: err?.stack || err?.message || String(err),
  });
  console.error(err);
  process.exitCode = 1;
} finally {
  await closePool();
}
