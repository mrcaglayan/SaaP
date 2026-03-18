import fs from "node:fs/promises";
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
  writeJson,
  takeStepScreenshot,
  waitForQuiet,
  clickButtonByName,
  fillInputByLabel,
  getInputFollowingLabel,
  waitForBodyText,
  findLatestPayrollRunBySignature,
} from "../shared/pou36.browser-utils.mjs";

const FIXTURE_DIR = resolveFixtureDir(import.meta.url);
const PREPARATION_DIR = path.resolve(FIXTURE_DIR, "../00-preparation");
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const CSV_PATH = path.join(FIXTURE_DIR, "payroll-starter-template.csv");
const REPORT_PATH = path.join(FIXTURE_DIR, "two-ou-creation-browser-walk-report.json");

async function main() {
  const runToken = timestampToken();
  const artifactDir = path.join(ARTIFACT_ROOT, `two-ou-creation-${runToken}`);
  await ensureDir(artifactDir);

  const scriptRuns = [];
  scriptRuns.push(runNodeScript(PREPARATION_DIR, "seed-readiness.mjs"));
  scriptRuns.push(runNodeScript(FIXTURE_DIR, "seed-two-ou.mjs"));

  const csvText = await fs.readFile(CSV_PATH, "utf8");
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
      return { userEmail: LOGIN_EMAIL };
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
        .waitFor({ state: "visible", timeout: WAIT_MS });
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
      await page.getByText(SCENARIO.employeeCodes.central).waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText(SCENARIO.employeeCodes.ou1).waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText(SCENARIO.employeeCodes.ou2).waitFor({ state: "visible", timeout: WAIT_MS });
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou1);
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou2);
      return {
        employees: Object.values(SCENARIO.employeeCodes),
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
        providerCode: SCENARIO.providerCode,
      };
    });

    await runStep("payroll-beneficiaries-ou1", async () => {
      await page.goto(`${BASE_URL}/app/payroll-beneficiaries`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Payroll Beneficiaries" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await fillInputByLabel(page, /Employee Code \*/i, SCENARIO.employeeCodes.ou1);
      await clickButtonByName(page, /^Load$/);
      await page.getByText(SCENARIO.employeeCodes.ou1).first().waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      return { employeeCode: SCENARIO.employeeCodes.ou1 };
    });

    await runStep("payroll-beneficiaries-ou2", async () => {
      await fillInputByLabel(page, /Employee Code \*/i, SCENARIO.employeeCodes.ou2);
      await clickButtonByName(page, /^Load$/);
      await page.getByText(SCENARIO.employeeCodes.ou2).first().waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      return { employeeCode: SCENARIO.employeeCodes.ou2 };
    });

    await runStep("payroll-import", async () => {
      await page.goto(`${BASE_URL}/app/payroll-runs/import`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Bordro Import" }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      const providerCodeInput = getInputFollowingLabel(page, "Provider Code");
      await providerCodeInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await providerCodeInput.fill(SCENARIO.providerCode);
      const payrollPeriodInput = getInputFollowingLabel(page, "Payroll Period");
      await payrollPeriodInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await payrollPeriodInput.fill(SCENARIO.payrollPeriod);
      const payDateInput = getInputFollowingLabel(page, "Pay Date");
      await payDateInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await payDateInput.fill(SCENARIO.payDate);
      const sourceBatchRefInput = getInputFollowingLabel(page, "Source Batch Ref");
      await sourceBatchRefInput.waitFor({ state: "visible", timeout: WAIT_MS });
      await sourceBatchRefInput.fill(`BROWSER-POU36-${runToken}`);
      await page.locator("textarea").first().fill(csvText);
      await clickButtonByName(page, /Payroll CSV Import/i);
      await page.waitForFunction(
        () => {
          const text = String(document?.body?.innerText || "");
          return (
            text.includes("Payroll CSV iceri aktarildi") ||
            text.includes("Payroll CSV already imported")
          );
        },
        { timeout: WAIT_MS }
      );

      const bodyText = await page.evaluate(() => String(document?.body?.innerText || ""));
      if (bodyText.includes("Payroll CSV already imported")) {
        const existingRun = await findLatestPayrollRunBySignature();
        if (!existingRun?.id) {
          throw new Error("Duplicate import detected but no matching existing payroll run was found");
        }
        runId = Number(existingRun.id);
        runNo = String(existingRun.run_no || "").trim() || null;
        return {
          runId,
          runNo,
          duplicateImportReused: true,
        };
      }

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
      if (!runId) {
        throw new Error("runId missing after import");
      }
      await page.goto(`${BASE_URL}/app/payroll-runs/${runId}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("link", { name: /Liabilities & Payment Prep/i }).waitFor({
        state: "visible",
        timeout: WAIT_MS,
      });
      await page.getByText(SCENARIO.employeeCodes.central).waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText(SCENARIO.employeeCodes.ou1).waitFor({ state: "visible", timeout: WAIT_MS });
      await page.getByText(SCENARIO.employeeCodes.ou2).waitFor({ state: "visible", timeout: WAIT_MS });
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou1);
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou2);
      return {};
    });

    await runStep("payroll-review-finalize", async () => {
      let bodyText = await page.evaluate(() => String(document?.body?.innerText || ""));
      if (!bodyText.includes("REVIEWED") && !bodyText.includes("FINALIZED")) {
        await clickButtonByName(page, /Mark Reviewed/i);
        await waitForBodyText(page, "REVIEWED");
        bodyText = await page.evaluate(() => String(document?.body?.innerText || ""));
      }
      if (!bodyText.includes("FINALIZED")) {
        await clickButtonByName(page, /Finalize \+ Post Accrual/i);
        await waitForBodyText(page, "Run FINALIZED.");
      } else {
        await waitForBodyText(page, "FINALIZED");
      }
      return {
        alreadyFinalized: bodyText.includes("FINALIZED"),
      };
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
      await page.waitForFunction(
        () => {
          const text = String(document?.body?.innerText || "");
          return (
            text.includes("Liabilities olusturuldu") ||
            text.includes("Liabilities zaten olusturulmus")
          );
        },
        { timeout: WAIT_MS }
      );
      await waitForBodyText(page, "CENTRAL");
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou1);
      await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou2);
      const bodyText = await page.evaluate(() => String(document?.body?.innerText || ""));
      return {
        liabilitiesAlreadyBuilt: bodyText.includes("Liabilities zaten olusturulmus"),
      };
    });
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    flow: "creation",
    status: "ok",
    baseUrl: BASE_URL,
    apiUrl: API_URL,
    headless: HEADLESS,
    runId,
    runNo,
    artifactsDir: artifactDir,
    seedScripts: scriptRuns,
    results,
    consoleErrors,
    pageErrors,
  };

  await writeJson(REPORT_PATH, report);
  await writeJson(path.join(artifactDir, "report.json"), report);
  console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, runId, runNo }, null, 2));
}

try {
  await main();
} catch (err) {
  await writeJson(REPORT_PATH, {
    generatedAt: new Date().toISOString(),
    flow: "creation",
    status: "failed",
    error: err?.stack || err?.message || String(err),
  });
  console.error(err);
  process.exitCode = 1;
} finally {
  await closePool();
}
