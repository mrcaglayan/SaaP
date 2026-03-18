import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { query } from "../../backend/src/db.js";

const requireFromFrontend = createRequire(new URL("../../frontend/package.json", import.meta.url));

export const { chromium } = requireFromFrontend("playwright-core");

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BASE_URL = process.env.POU36_BASE_URL || "http://localhost:5173";
export const API_URL = process.env.POU36_API_URL || "http://localhost:3000";
export const LOGIN_EMAIL = process.env.POU36_EMAIL || "test@example.com";
export const LOGIN_PASSWORD = process.env.POU36_PASSWORD || "123456";
export const CHROME_PATH =
  process.env.POU36_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const HEADLESS = process.env.POU36_HEADLESS !== "0";
export const WAIT_MS = 30000;

export const SCENARIO = Object.freeze({
  legalEntityId: 1,
  providerCode: "BROWSER_POU36",
  payrollPeriod: "2026-02-01",
  payDate: "2026-02-15",
  centralBankAccountCode: "BROWSER_POU36_BANK_C",
  employeeCodes: Object.freeze({
    central: "EMP001",
    ou1: "EMP002",
    ou2: "EMP003",
  }),
  operatingUnitCodes: Object.freeze({
    ou1: "BROWSER_POU36_OU",
    ou2: "BROWSER_POU36_OU2",
  }),
});

export function resolveFixtureDir(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)));
}

export function timestampToken() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function sanitizeForFile(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function runNodeScript(baseDir, scriptName) {
  const scriptPath = path.resolve(baseDir, scriptName);
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

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function takeStepScreenshot(page, artifactDir, stepIndex, stepName) {
  const prefix = String(stepIndex).padStart(2, "0");
  const filePath = path.join(artifactDir, `${prefix}-${stepName}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function waitForQuiet(page, ms = 250) {
  await page.waitForTimeout(ms);
}

export async function clickButtonByName(page, name) {
  const button = page.getByRole("button", { name }).first();
  await button.waitFor({ state: "visible", timeout: WAIT_MS });
  await button.click();
}

export async function fillDateInput(page, label, value) {
  const input = page.getByLabel(label).first();
  await input.waitFor({ state: "visible", timeout: WAIT_MS });
  await input.fill(value);
}

export async function fillInputByLabel(page, label, value) {
  const input = page.getByLabel(label).first();
  await input.waitFor({ state: "visible", timeout: WAIT_MS });
  await input.fill(value);
}

export function getInputFollowingLabel(page, labelText) {
  return page
    .locator(`label:has-text("${labelText}")`)
    .locator("xpath=following-sibling::input[1]")
    .first();
}

export async function waitForBodyText(page, value) {
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

export async function assertPreparedBatchBreakdown(page, { batchNo = null } = {}) {
  await waitForBodyText(page, "Prepared Batch Breakdown");
  if (batchNo) {
    await waitForBodyText(page, batchNo);
  }
  await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou1);
  await waitForBodyText(page, SCENARIO.operatingUnitCodes.ou2);
}

export async function findLatestPayrollRunBySignature({
  legalEntityId = SCENARIO.legalEntityId,
  providerCode = SCENARIO.providerCode,
  payrollPeriod = SCENARIO.payrollPeriod,
  payDate = SCENARIO.payDate,
} = {}) {
  const result = await query(
    `SELECT id, run_no, status
     FROM payroll_runs
     WHERE tenant_id = 1
       AND legal_entity_id = ?
       AND provider_code = ?
       AND payroll_period = ?
       AND pay_date = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(legalEntityId), String(providerCode || "").trim().toUpperCase(), payrollPeriod, payDate]
  );
  return result.rows?.[0] || null;
}

export async function findLatestPaymentBatchForRun(runId) {
  const result = await query(
    `SELECT id, batch_no, status
     FROM payment_batches
     WHERE tenant_id = 1
       AND source_type = 'PAYROLL'
       AND source_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(runId)]
  );
  return result.rows?.[0] || null;
}
