/**
 * Close checklist task browser smoke harness.
 *
 * Prerequisites:
 *   - Backend and frontend are running.
 *   - A user with close task permissions can log in.
 *   - Optional fixture task IDs exist for mutation steps.
 *
 * Runtime overrides:
 *   CLOSE_TASK_SMOKE_BASE_URL=http://localhost:5173
 *   CLOSE_TASK_SMOKE_EMAIL=test@example.com
 *   CLOSE_TASK_SMOKE_PASSWORD=123456
 *   CLOSE_TASK_SMOKE_REVIEWER_EMAIL=reviewer@example.com
 *   CLOSE_TASK_SMOKE_REVIEWER_PASSWORD=123456
 *   CLOSE_TASK_SMOKE_WAIVER_EMAIL=waiver@example.com
 *   CLOSE_TASK_SMOKE_WAIVER_PASSWORD=123456
 *   CLOSE_TASK_SMOKE_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
 *   CLOSE_TASK_SMOKE_HEADLESS=0|1
 *   CLOSE_TASK_SMOKE_CYCLE_ID=10
 *   CLOSE_TASK_SMOKE_BOOK_ID=8
 *   CLOSE_TASK_SMOKE_START_TASK_ID=101
 *   CLOSE_TASK_SMOKE_SUBMIT_TASK_ID=102
 *   CLOSE_TASK_SMOKE_RETURN_TASK_ID=103
 *   CLOSE_TASK_SMOKE_RESUBMIT_TASK_ID=104
 *   CLOSE_TASK_SMOKE_EVIDENCE_FILE=C:\tmp\evidence.txt
 *   CLOSE_TASK_SMOKE_APPROVE_TASK_ID=105
 *   CLOSE_TASK_SMOKE_WAIVE_TASK_ID=106
 *   CLOSE_TASK_SMOKE_CANCEL_TASK_ID=107
 *   CLOSE_TASK_SMOKE_SOURCE_TASK_ID=108
 */

import fs from "node:fs";
import path from "node:path";
import {
  chromium,
  BASE_URL as SHARED_BASE_URL,
  CHROME_PATH as SHARED_CHROME_PATH,
  HEADLESS as SHARED_HEADLESS,
  WAIT_MS,
  ensureDir,
  resolveFixtureDir,
  takeStepScreenshot,
  timestampToken,
  waitForQuiet,
  writeJson,
} from "../shared/pou36.browser-utils.mjs";

const FIXTURE_DIR = resolveFixtureDir(import.meta.url);
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const REPORT_PATH = path.join(FIXTURE_DIR, "close-task-smoke-report.json");

const BASE_URL = process.env.CLOSE_TASK_SMOKE_BASE_URL || SHARED_BASE_URL || "http://localhost:5173";
const CHROME_PATH = process.env.CLOSE_TASK_SMOKE_CHROME_PATH || SHARED_CHROME_PATH;
const HEADLESS = parseBooleanEnv(process.env.CLOSE_TASK_SMOKE_HEADLESS, SHARED_HEADLESS);
const CYCLE_ID = normalizeId(process.env.CLOSE_TASK_SMOKE_CYCLE_ID);
const BOOK_ID = normalizeId(process.env.CLOSE_TASK_SMOKE_BOOK_ID);
const EVIDENCE_FILE = process.env.CLOSE_TASK_SMOKE_EVIDENCE_FILE || "";

const BOARD_ROUTE = "/app/donem-sonu-islemler/yillik/kapanis-gorevleri";
const TEMPLATE_ROUTE = "/app/donem-sonu-islemler/yillik/kapanis-gorev-sablonlari";
const COCKPIT_ROUTE = "/app/donem-sonu-islemler/yillik/kapanis-kokpiti";

const ownerCredentials = {
  email: process.env.CLOSE_TASK_SMOKE_EMAIL || "test@example.com",
  password: process.env.CLOSE_TASK_SMOKE_PASSWORD || "123456",
};
const reviewerCredentials = {
  email: process.env.CLOSE_TASK_SMOKE_REVIEWER_EMAIL || ownerCredentials.email,
  password: process.env.CLOSE_TASK_SMOKE_REVIEWER_PASSWORD || ownerCredentials.password,
};
const waiverCredentials = {
  email: process.env.CLOSE_TASK_SMOKE_WAIVER_EMAIL || ownerCredentials.email,
  password: process.env.CLOSE_TASK_SMOKE_WAIVER_PASSWORD || ownerCredentials.password,
};

const taskIds = {
  start: normalizeId(process.env.CLOSE_TASK_SMOKE_START_TASK_ID),
  submit: normalizeId(process.env.CLOSE_TASK_SMOKE_SUBMIT_TASK_ID),
  return: normalizeId(process.env.CLOSE_TASK_SMOKE_RETURN_TASK_ID),
  resubmit: normalizeId(process.env.CLOSE_TASK_SMOKE_RESUBMIT_TASK_ID),
  approve: normalizeId(process.env.CLOSE_TASK_SMOKE_APPROVE_TASK_ID),
  waive: normalizeId(process.env.CLOSE_TASK_SMOKE_WAIVE_TASK_ID),
  cancel: normalizeId(process.env.CLOSE_TASK_SMOKE_CANCEL_TASK_ID),
  source: normalizeId(process.env.CLOSE_TASK_SMOKE_SOURCE_TASK_ID),
};

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function boardUrl(params = {}) {
  const search = new URLSearchParams();
  if (CYCLE_ID) {
    search.set("cycleId", String(CYCLE_ID));
  }
  if (BOOK_ID) {
    search.set("bookId", String(BOOK_ID));
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return `${BASE_URL}${BOARD_ROUTE}${query ? `?${query}` : ""}`;
}

async function waitForAnyBodyText(page, patterns) {
  await page.waitForFunction(
    (sources) => {
      const body = String(document?.body?.innerText || "");
      return sources.some((source) => new RegExp(source, "i").test(body));
    },
    patterns.map((pattern) => pattern.source),
    { timeout: WAIT_MS },
  );
}

function attachDiagnostics(page, report) {
  page.on("pageerror", (err) => {
    report.errors.push(`pageerror:${err.message}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/") && response.status() >= 500) {
      report.errors.push(`api:${response.status()}:${url}`);
    }
  });
}

async function login(page, credentials) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  await page.locator('input[type="email"], input[name="email"]').first().fill(credentials.email);
  await page
    .locator('input[type="password"], input[autocomplete="current-password"]')
    .first()
    .fill(credentials.password);
  await page.getByRole("button", { name: /sign in|giris|oturum/i }).first().click();
  await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    throw new Error(`Login failed for ${credentials.email}`);
  }
}

async function withLoggedInPage(browser, credentials, report, callback) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  attachDiagnostics(page, report);
  try {
    await login(page, credentials);
    return await callback(page);
  } finally {
    await context.close();
  }
}

async function clickTaskAction(page, actionName, buttonName, { reason = "" } = {}) {
  if (reason) {
    await page.locator("textarea").last().fill(reason);
  }
  const button = page.getByRole("button", { name: buttonName }).first();
  await button.waitFor({ state: "visible", timeout: WAIT_MS });
  await button.click();
  await waitForQuiet(page, 750);
  await waitForAnyBodyText(page, [
    new RegExp(`Task ${actionName}`, "i"),
    /Gorev/i,
    /Evidence/i,
    /Kanit/i,
  ]);
}

async function openTask(page, taskId) {
  await page.goto(boardUrl({ taskId }), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  await waitForAnyBodyText(page, [/Evidence/i, /Kanit/i, /Task board/i, /Gorev panosu/i]);
}

async function runPageSmoke(browser, artifactDir, report) {
  await withLoggedInPage(browser, ownerCredentials, report, async (page) => {
    await page.goto(boardUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await waitForAnyBodyText(page, [/Task board/i, /Gorev panosu/i]);
    await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "task-board-loads");
    report.steps.push({ step: "task-board-loads", status: "passed" });

    await page.goto(`${BASE_URL}${TEMPLATE_ROUTE}`, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await waitForAnyBodyText(page, [/Template/i, /Sablon/i]);
    await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "template-admin-loads");
    report.steps.push({ step: "template-admin-loads", status: "passed" });

    if (CYCLE_ID) {
      await page.goto(`${BASE_URL}${COCKPIT_ROUTE}?cycleId=${CYCLE_ID}`, {
        waitUntil: "domcontentloaded",
        timeout: WAIT_MS,
      });
      await waitForAnyBodyText(page, [/Cockpit/i, /Kokpit/i, /Close/i, /Kapanis/i]);
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "cockpit-loads");
      report.steps.push({ step: "cockpit-loads", status: "passed" });
    } else {
      report.steps.push({ step: "cockpit-loads", status: "skipped", reason: "CLOSE_TASK_SMOKE_CYCLE_ID not set" });
    }
  });
}

async function runOptionalLifecycle(browser, artifactDir, report) {
  await withLoggedInPage(browser, ownerCredentials, report, async (page) => {
    if (taskIds.start) {
      await openTask(page, taskIds.start);
      await clickTaskAction(page, "started", /Start|Baslat/i);
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "owner-starts-task");
      report.steps.push({ step: "owner-starts-task", status: "passed" });
    } else {
      report.steps.push({ step: "owner-starts-task", status: "skipped", reason: "CLOSE_TASK_SMOKE_START_TASK_ID not set" });
    }

    if (taskIds.submit) {
      await openTask(page, taskIds.submit);
      await clickTaskAction(page, "submitted", /Submit|Gonder/i);
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "owner-submits-task");
      report.steps.push({ step: "owner-submits-task", status: "passed" });
    } else {
      report.steps.push({ step: "owner-submits-task", status: "skipped", reason: "CLOSE_TASK_SMOKE_SUBMIT_TASK_ID not set" });
    }

    if (taskIds.resubmit && EVIDENCE_FILE && fs.existsSync(EVIDENCE_FILE)) {
      await openTask(page, taskIds.resubmit);
      await page.locator('input[type="file"]').first().setInputFiles(EVIDENCE_FILE);
      await page.getByRole("button", { name: /Create & upload|Olustur ve yukle/i }).first().click();
      await waitForAnyBodyText(page, [/Evidence file uploaded/i, /Kanit dosyasi yuklendi/i]);
      await clickTaskAction(page, "submitted", /Submit|Gonder/i);
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "owner-resubmits-with-evidence");
      report.steps.push({ step: "owner-resubmits-with-evidence", status: "passed" });
    } else {
      report.steps.push({
        step: "owner-resubmits-with-evidence",
        status: "skipped",
        reason: "CLOSE_TASK_SMOKE_RESUBMIT_TASK_ID and CLOSE_TASK_SMOKE_EVIDENCE_FILE not set",
      });
    }

    if (taskIds.source) {
      await openTask(page, taskIds.source);
      await clickTaskAction(page, "source check refreshed", /Refresh source check|Kaynak kontrol/i);
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "source-check-refresh");
      report.steps.push({ step: "source-check-refresh", status: "passed" });
    } else {
      report.steps.push({ step: "source-check-refresh", status: "skipped", reason: "CLOSE_TASK_SMOKE_SOURCE_TASK_ID not set" });
    }
  });

  await withLoggedInPage(browser, reviewerCredentials, report, async (page) => {
    if (taskIds.return) {
      await openTask(page, taskIds.return);
      await clickTaskAction(page, "returned", /Return|Iade/i, { reason: "Browser smoke return" });
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "reviewer-returns-task");
      report.steps.push({ step: "reviewer-returns-task", status: "passed" });
    } else {
      report.steps.push({ step: "reviewer-returns-task", status: "skipped", reason: "CLOSE_TASK_SMOKE_RETURN_TASK_ID not set" });
    }

    if (taskIds.approve) {
      await openTask(page, taskIds.approve);
      await clickTaskAction(page, "approved", /Approve|Onayla/i);
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "reviewer-approves-task");
      report.steps.push({ step: "reviewer-approves-task", status: "passed" });
    } else {
      report.steps.push({ step: "reviewer-approves-task", status: "skipped", reason: "CLOSE_TASK_SMOKE_APPROVE_TASK_ID not set" });
    }
  });

  await withLoggedInPage(browser, waiverCredentials, report, async (page) => {
    if (taskIds.waive) {
      await openTask(page, taskIds.waive);
      await clickTaskAction(page, "waived", /Waive|Feragat/i, { reason: "Browser smoke waiver" });
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "waiver-authority-waives-task");
      report.steps.push({ step: "waiver-authority-waives-task", status: "passed" });
    } else {
      report.steps.push({ step: "waiver-authority-waives-task", status: "skipped", reason: "CLOSE_TASK_SMOKE_WAIVE_TASK_ID not set" });
    }

    if (taskIds.cancel) {
      await openTask(page, taskIds.cancel);
      await clickTaskAction(page, "cancelled", /Cancel|Iptal/i, { reason: "Browser smoke cancellation" });
      await takeStepScreenshot(page, artifactDir, report.steps.length + 1, "manual-task-cancelled");
      report.steps.push({ step: "manual-task-cancelled", status: "passed" });
    } else {
      report.steps.push({ step: "manual-task-cancelled", status: "skipped", reason: "CLOSE_TASK_SMOKE_CANCEL_TASK_ID not set" });
    }
  });
}

async function main() {
  const artifactDir = path.join(ARTIFACT_ROOT, `close-task-smoke-${timestampToken()}`);
  await ensureDir(artifactDir);
  const report = {
    baseUrl: BASE_URL,
    cycleId: CYCLE_ID,
    bookId: BOOK_ID,
    artifactDir,
    startedAt: new Date().toISOString(),
    steps: [],
    errors: [],
  };

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROME_PATH,
  });
  try {
    await runPageSmoke(browser, artifactDir, report);
    await runOptionalLifecycle(browser, artifactDir, report);
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  await writeJson(REPORT_PATH, report);
  await writeJson(path.join(artifactDir, "report.json"), report);
  if (report.errors.length > 0) {
    throw new Error(`Close task browser smoke found errors: ${report.errors.join("; ")}`);
  }
  console.log(`close task browser smoke completed: ${REPORT_PATH}`);
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});
