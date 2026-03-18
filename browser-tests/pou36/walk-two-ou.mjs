import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const requireFromFrontend = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = requireFromFrontend("playwright-core");

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const CSV_PATH = path.join(FIXTURE_DIR, "payroll-starter-template.csv");
const BASE_URL = process.env.POU36_BASE_URL || "http://localhost:5173";
const API_URL = process.env.POU36_API_URL || "http://localhost:3000";
const LOGIN_EMAIL = process.env.POU36_EMAIL || "test@example.com";
const LOGIN_PASSWORD = process.env.POU36_PASSWORD || "123456";
const CHROME_PATH =
  process.env.POU36_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HEADLESS = process.env.POU36_HEADLESS !== "0";
const WAIT_MS = 30000;

function timestampToken() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-");
}

function sanitizeForFile(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function runNodeScript(scriptName) {
  const scriptPath = path.join(FIXTURE_DIR, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `Script failed: ${scriptName}\nSTDOUT:\n${result.stdout || ""}\nSTDERR:\n${result.stderr || ""}`
    );
  }
  return {
    scriptName,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function takeStepScreenshot(page, artifactDir, stepIndex, stepName) {
  const prefix = String(stepIndex).padStart(2, "0");
  const filePath = path.join(artifactDir, `${prefix}-${stepName}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function waitForQuiet(page, ms = 250) {
  await page.waitForTimeout(ms);
}

async function clickButtonByName(page, name) {
  const button = page.getByRole("button", { name }).first();
  await button.waitFor({ state: "visible", timeout: WAIT_MS });
  await button.click();
}

async function fillDateInput(page, label, value) {
  const input = page.getByLabel(label).first();
  await input.waitFor({ state: "visible", timeout: WAIT_MS });
  await input.fill(value);
}

async function fillInputByLabel(page, label, value) {
  const input = page.getByLabel(label).first();
  await input.waitFor({ state: "visible", timeout: WAIT_MS });
  await input.fill(value);
}

function getInputFollowingLabel(page, labelText) {
  return page
    .locator(`label:has-text("${labelText}")`)
    .locator("xpath=following-sibling::input[1]")
    .first();
}

async function waitForBodyText(page, value) {
  const expected = String(value || "").trim();
  if (!expected) {
    throw new Error("waitForBodyText requires a non-empty value");
  }
  await page.waitForFunction(
    (needle) => String(document?.body?.innerText || "").includes(needle),
    expected,
    { timeout: WAIT_MS }
  );
}

async function withDialog(page, handler, action) {
  const dialogPromise = page.waitForEvent("dialog", { timeout: WAIT_MS });
  await action();
  const dialog = await dialogPromise;
  await handler(dialog);
}

async function main() {
  const runToken = timestampToken();
  const artifactDir = path.join(ARTIFACT_ROOT, `two-ou-walk-${runToken}`);
  await ensureDir(artifactDir);

  const scriptRuns = [];
  scriptRuns.push(runNodeScript("seed-readiness.mjs"));
  scriptRuns.push(runNodeScript("seed-two-ou.mjs"));

  const csvText = await fs.readFile(CSV_PATH, "utf8");
  const baseSeedSummary = JSON.parse(
    await fs.readFile(path.join(FIXTURE_DIR, "seed-summary.json"), "utf8")
  );
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
  let runId = null;
  let runNo = null;
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

    await runStep("readiness-checklist-details", async () => {
      await page.goto(`${BASE_URL}/app/ayarlar/organizasyon-yonetimi`, {
        waitUntil: "domcontentloaded",
      });
      const checklist = page
        .locator("section")
        .filter({
          hasText: /Tenant Readiness Checklist|Kiraci Hazirlik Kontrol Listesi/i,
        })
        .first();
      await checklist.waitFor({ state: "visible", timeout: WAIT_MS });
      const detailsButton = checklist
        .getByRole("button", {
          name: /Show details|Detaylari Goster|Hide details|Detaylari Gizle/i,
        })
        .first();
      await detailsButton.waitFor({ state: "visible", timeout: WAIT_MS });
      const buttonLabel = ((await detailsButton.textContent()) || "").trim();
      if (/Show details|Detaylari Goster/i.test(buttonLabel)) {
        await detailsButton.click();
      }
      await checklist
        .getByText(
          /Operating-unit current-account readiness|Operasyon birimi cari hesap hazirligi/i
        )
        .first()
        .waitFor({
          state: "visible",
          timeout: WAIT_MS,
        });
      const checklistText = ((await checklist.textContent()) || "")
        .replace(/\s+/g, " ")
        .trim();
      return {
        checklistExcerpt: checklistText.slice(0, 600),
      };
    });

    await runStep("payroll-ownership", async () => {
      await page.goto(`${BASE_URL}/app/payroll-ownership`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Payroll Ownership" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await clickButtonByName(page, /^Load$/);
      await page.getByText("EMP001").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("EMP002").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("EMP003").waitFor({ state: "visible", timeout: WAIT_MS });
      await waitForBodyText(page, "BROWSER_POU36_OU");
      await waitForBodyText(page, "BROWSER_POU36_OU2");
      return {
        employees: ["EMP001", "EMP002", "EMP003"],
      };
    });

    await runStep("payroll-mappings", async () => {
      await page.goto(`${BASE_URL}/app/payroll-mappings`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Bordro Mappingleri" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await clickButtonByName(page, /Listele/i);
      await waitForBodyText(page, "Toplam kayit: 12");
      await waitForBodyText(page, "BASE_SALARY_EXPENSE");
      await waitForBodyText(page, "EMPLOYEE_SOCIAL_SECURITY_PAYABLE");
      return {
        providerCode: "BROWSER_POU36",
      };
    });

    await runStep("payroll-beneficiaries-ou1", async () => {
      await page.goto(`${BASE_URL}/app/payroll-beneficiaries`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Payroll Beneficiaries" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await fillInputByLabel(page, /Employee Code \*/i, "EMP002");
      await clickButtonByName(page, /^Load$/);
      await page.getByText("EMP002").first().waitFor({ state: "visible", timeout: WAIT_MS });
      return { employeeCode: "EMP002" };
    });

    await runStep("payroll-beneficiaries-ou2", async () => {
      await fillInputByLabel(page, /Employee Code \*/i, "EMP003");
      await clickButtonByName(page, /^Load$/);
      await page.getByText("EMP003").first().waitFor({ state: "visible", timeout: WAIT_MS });
      return { employeeCode: "EMP003" };
    });

    await runStep("payroll-import", async () => {
      await page.goto(`${BASE_URL}/app/payroll-runs/import`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Bordro Import" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      const providerCodeInput = getInputFollowingLabel(page, "Provider Code");
      await providerCodeInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await providerCodeInput.fill("BROWSER_POU36");
      const payrollPeriodInput = getInputFollowingLabel(page, "Payroll Period");
      await payrollPeriodInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await payrollPeriodInput.fill("2026-02-01");
      const payDateInput = getInputFollowingLabel(page, "Pay Date");
      await payDateInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await payDateInput.fill("2026-02-15");
      const sourceBatchRefInput = getInputFollowingLabel(page, "Source Batch Ref");
      await sourceBatchRefInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await sourceBatchRefInput.fill(`BROWSER-POU36-${runToken}`);
      await page.locator("textarea").first().fill(csvText);
      await clickButtonByName(page, /Payroll CSV Import/i);
      await page.getByText(/Payroll CSV iceri aktarildi/i).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      const hrefHandle = await page.waitForFunction(
        () => {
          const anchor = Array.from(document.querySelectorAll('a[href]')).find((node) =>
            /\/app\/payroll-runs\/\d+$/.test(node.getAttribute("href") || "")
          );
          return anchor ? anchor.getAttribute("href") : null;
        },
        { timeout: WAIT_MS }
      );
      const runHref = await hrefHandle.jsonValue();
      if (typeof runHref !== "string" || !runHref) {
        throw new Error("Imported payroll run link not found on result panel");
      }
      const runLink = page.locator(`a[href="${runHref}"]`).first();
      const label = (await runLink.textContent())?.trim() || "";
      runNo = label || null;
      const match = runHref.match(/\/app\/payroll-runs\/(\d+)/);
      runId = match?.[1] ? Number(match[1]) : null;
      return {
        runId,
        runNo,
      };
    });

    await runStep("payroll-run-detail", async () => {
      if (!runId) throw new Error("runId missing after import");
      await page.goto(`${BASE_URL}/app/payroll-runs/${runId}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("link", { name: /Liabilities & Payment Prep/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await page.getByText("EMP001").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("EMP002").waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText("EMP003").waitFor({ state: "visible", timeout: WAIT_MS });
      await waitForBodyText(page, "BROWSER_POU36_OU");
      await waitForBodyText(page, "BROWSER_POU36_OU2");
      return {};
    });

    await runStep("payroll-review-finalize", async () => {
      await clickButtonByName(page, /Mark Reviewed/i);
      await page.getByText("REVIEWED").first().waitFor({ state: "visible", timeout: WAIT_MS });
      await clickButtonByName(page, /Finalize \+ Post Accrual/i);
      await page.getByText("Run FINALIZED.").waitFor({ state: "visible", timeout: WAIT_MS });
      return {};
    });

    await runStep("payroll-liabilities-build", async () => {
      await page.goto(`${BASE_URL}/app/payroll-runs/${runId}/liabilities`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("heading", { name: /Bordro Liability & Payment Prep/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await clickButtonByName(page, /Liabilities Build/i);
      await page.getByText("Liabilities olusturuldu").waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await page.getByText("CENTRAL").first().waitFor({ state: "visible", timeout: WAIT_MS });
      await waitForBodyText(page, "BROWSER_POU36_OU");
      await waitForBodyText(page, "BROWSER_POU36_OU2");
      return {};
    });

    await runStep("payroll-batch-prepare", async () => {
      const bankSelect = page.locator("select").filter({ hasText: "BROWSER_POU36_BANK_C" }).first();
      await bankSelect.waitFor({ state: "visible", timeout: WAIT_MS });
      await bankSelect.selectOption(centralBankAccountId);
      await clickButtonByName(page, /Payment Batch Hazirla/i);
      const batchLink = page.locator('a[href*="/app/odeme-batchleri/"]').last();
      await batchLink.waitFor({ state: "visible", timeout: WAIT_MS });
      batchNo = (await batchLink.textContent())?.trim() || null;
      const href = await batchLink.getAttribute("href");
      const match = href?.match(/\/app\/odeme-batchleri\/(\d+)/);
      batchId = match?.[1] ? Number(match[1]) : null;
      await page.getByText("CENTRAL").first().waitFor({ state: "visible", timeout: WAIT_MS });
      await waitForBodyText(page, "BROWSER_POU36_OU");
      await waitForBodyText(page, "BROWSER_POU36_OU2");
      return {
        batchId,
        batchNo,
      };
    });

    await runStep("payroll-beneficiary-snapshot", async () => {
      const snapshotButton = page
        .getByRole("button", { name: "Snapshot" })
        .first();
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
      if (!batchId) throw new Error("batchId missing after prepare");
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
        `${BASE_URL}/app/payroll-close-controls?legalEntityId=1&payrollPeriod=2026-02-01`,
        { waitUntil: "domcontentloaded" }
      );
      await page.getByRole("heading", { name: "Payroll Close Controls" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await fillDateInput(page, /Period Start/i, "2026-02-01");
      await fillDateInput(page, /Period End/i, "2026-02-28");
      await clickButtonByName(page, /Prepare Checklist/i);
      await page.getByText("Checklist prepared.").waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await page.getByRole("heading", { name: /Checklist Results/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      const closeIdMatch = page.url().match(/close-controls(?:\?.*)?$/);
      void closeIdMatch;
      const closeLabel = page.getByText(/Close #\d+/).first();
      await closeLabel.waitFor({ state: "visible", timeout: WAIT_MS });
      const closeText = (await closeLabel.textContent()) || "";
      const match = closeText.match(/Close #(\d+)/);
      closeId = match?.[1] ? Number(match[1]) : null;
      return {
        closeId,
      };
    });
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
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
    seedScripts: scriptRuns,
    results,
    consoleErrors,
    pageErrors,
  };

  const reportPath = path.join(FIXTURE_DIR, "two-ou-browser-walk-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const artifactReportPath = path.join(artifactDir, "report.json");
  await fs.writeFile(artifactReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, reportPath, artifactReportPath, runId, batchId, closeId }, null, 2));
}

main().catch(async (err) => {
  const reportPath = path.join(FIXTURE_DIR, "two-ou-browser-walk-report.json");
  const failure = {
    generatedAt: new Date().toISOString(),
    status: "failed",
    error: err?.stack || err?.message || String(err),
  };
  await fs.writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  console.error(err);
  process.exit(1);
});
