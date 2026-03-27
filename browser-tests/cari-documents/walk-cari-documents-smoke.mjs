/**
 * CARI documents browser smoke seed.
 *
 * Current coverage for the refactor plan smoke matrix:
 *   - S1  List loads
 *   - S2  Saved views
 *   - S3  Create draft
 *   - S4  Edit draft
 *   - S5  Cancel draft
 *   - S6  Post draft
 *   - S7  Reverse posted
 *   - S8  Comments panel
 *   - S9  Evidence panel
 *   - S10 Ops status
 *   - S11 Fixed-asset quick-create modal
 *   - S12 Inline counterparty
 *   - S13 Charge allocation
 *   - S14 URL deep link
 *   - S15 Fixed-asset sale prefill
 *   - S16 Cross-domain clone flows
 *
 * Route coverage:
 *   - /app/alis-faturalari
 *   - /app/satis-faturalari
 *   - /app/cari-belgeler redirect -> /app/alis-faturalari
 *
 * Prerequisites:
 *   - Backend running and reachable from the frontend session
 *   - Frontend running on localhost:5173 unless overridden
 *   - Ready tenant credentials available
 *   - Optional baseline fixture seed:
 *       node browser-tests/cari-documents/seed-cari-documents-fixtures.mjs
 *
 * Runtime overrides:
 *   CARI_DOCS_SMOKE_BASE_URL
 *   CARI_DOCS_SMOKE_EMAIL
 *   CARI_DOCS_SMOKE_PASSWORD
 *   CARI_DOCS_SMOKE_BOOTSTRAP=0|1
 *   CARI_DOCS_SMOKE_HEADLESS=0|1
 *   CARI_DOCS_SMOKE_CHROME_PATH
 *   CARI_DOCS_SMOKE_STEPS=S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12,S13,S14,S15,S16
 *   CARI_DOCS_SMOKE_DIRECTIONS=AP,AR
 *   CARI_DOCS_SMOKE_CLEANUP=0|1
 */

import path from "node:path";
import {
  chromium,
  BASE_URL as SHARED_BASE_URL,
  CHROME_PATH as SHARED_CHROME_PATH,
  HEADLESS as SHARED_HEADLESS,
  WAIT_MS,
  resolveFixtureDir,
  timestampToken,
  sanitizeForFile,
  ensureDir,
  runNodeScript,
  readJson,
  takeStepScreenshot,
  waitForQuiet,
  writeJson,
} from "../shared/pou36.browser-utils.mjs";

const FIXTURE_DIR = resolveFixtureDir(import.meta.url);
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const REPORT_PATH = path.join(FIXTURE_DIR, "cari-documents-smoke-report.json");
const FIXTURE_REPORT_PATH = path.join(FIXTURE_DIR, "cari-documents-fixtures-report.json");
const EVIDENCE_SAMPLE_PATH = path.join(FIXTURE_DIR, "evidence-sample.txt");
const SUPPORTED_STEPS = [
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
  "S9",
  "S10",
  "S11",
  "S12",
  "S13",
  "S14",
  "S15",
  "S16",
];

const BASE_URL =
  process.env.CARI_DOCS_SMOKE_BASE_URL || SHARED_BASE_URL || "http://localhost:5173";
const LOGIN_EMAIL = process.env.CARI_DOCS_SMOKE_EMAIL || "tmv@gmail.com";
const LOGIN_PASSWORD = process.env.CARI_DOCS_SMOKE_PASSWORD || "12121212";
const CHROME_PATH =
  process.env.CARI_DOCS_SMOKE_CHROME_PATH || SHARED_CHROME_PATH;
const BOOTSTRAP_FIXTURES = parseBooleanEnv(
  process.env.CARI_DOCS_SMOKE_BOOTSTRAP,
  true
);
const HEADLESS = parseBooleanEnv(
  process.env.CARI_DOCS_SMOKE_HEADLESS,
  SHARED_HEADLESS
);
const CLEANUP = parseBooleanEnv(process.env.CARI_DOCS_SMOKE_CLEANUP, false);
const EXERCISE_STOCK_LOOKUPS = parseBooleanEnv(
  process.env.CARI_DOCS_SMOKE_EXERCISE_STOCK_LOOKUPS,
  false
);
const SELECTED_STEPS = normalizeStepList(
  process.env.CARI_DOCS_SMOKE_STEPS || SUPPORTED_STEPS.join(",")
);
const SELECTED_DIRECTIONS = normalizeDirectionList(
  process.env.CARI_DOCS_SMOKE_DIRECTIONS || "AP,AR"
);

const LEGACY_ROUTE = "/app/cari-belgeler";
const AP_ROUTE = "/app/alis-faturalari";
const AR_ROUTE = "/app/satis-faturalari";
const FIXED_ASSET_DETAIL_ROUTE_PREFIX = "/app/demirbas-karti-detayi";

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeUpperList(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((item) => String(item || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function normalizeStepList(value) {
  return normalizeUpperList(value).filter((step) =>
    SUPPORTED_STEPS.includes(step)
  );
}

function normalizeDirectionList(value) {
  const directions = normalizeUpperList(value).filter((direction) =>
    ["AP", "AR"].includes(direction)
  );
  return directions.length > 0 ? directions : ["AP", "AR"];
}

function normalizeOptionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function matchesPreferredText(candidateText, preferredText = []) {
  const normalizedCandidate = normalizeOptionText(candidateText);
  return (preferredText || []).some((item) => {
    const normalizedItem = normalizeOptionText(item);
    return Boolean(normalizedItem) && normalizedCandidate.includes(normalizedItem);
  });
}

function buildFixturePreferences(fixtureReport, direction) {
  const legalEntity = fixtureReport?.legalEntity || null;
  const paymentTerm = fixtureReport?.paymentTerm || null;
  const counterparty =
    direction === "AR"
      ? fixtureReport?.counterparties?.customer || null
      : fixtureReport?.counterparties?.vendor || null;
  const postingAccount =
    direction === "AR"
      ? fixtureReport?.accountSelections?.arLinePostingAccount || null
      : fixtureReport?.accountSelections?.apLinePostingAccount || null;

  return {
    legalEntity: [legalEntity?.code, legalEntity?.name].filter(Boolean),
    counterparty: [counterparty?.code, counterparty?.name].filter(Boolean),
    paymentTerm: [paymentTerm?.code, paymentTerm?.name].filter(Boolean),
    postingAccount: [postingAccount?.code, postingAccount?.name].filter(Boolean),
    invoiceCurrencyCode: legalEntity?.functionalCurrencyCode || "",
  };
}

function routeForDirection(direction) {
  return direction === "AR" ? AR_ROUTE : AP_ROUTE;
}

function fixedAssetDetailRoute(assetId) {
  return `${FIXED_ASSET_DETAIL_ROUTE_PREFIX}/${assetId}`;
}

function pageTitlePattern(direction) {
  if (direction === "AR") {
    return /Sales Invoices|Satis Faturalari/i;
  }
  return /Vendor Bills|Alis Faturalari/i;
}

function createTitlePattern(direction) {
  if (direction === "AR") {
    return /Create Sales Invoice Draft|Satis Faturasi Taslagi Olustur/i;
  }
  return /Create Vendor Bill Draft|Alis Faturasi Taslagi Olustur/i;
}

function detailTitlePattern() {
  return /Detail \+ Actions|Detay \+ Islemler/i;
}

function addDays(dateText, days) {
  const next = new Date(`${String(dateText).slice(0, 10)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next.toISOString().slice(0, 10);
}

function sectionByHeading(page, headingPattern) {
  return page
    .getByRole("heading", { name: headingPattern })
    .first()
    .locator("xpath=ancestor::section[1]");
}

function formByButton(page, buttonPattern) {
  return page
    .getByRole("button", { name: buttonPattern })
    .first()
    .locator("xpath=ancestor::form[1]");
}

async function gotoRoute(page, routePath) {
  if (!/\/app(?:\/|$|\?)/i.test(page.url())) {
    await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" }).catch(() => null);
    await waitForQuiet(page, 500);
  }
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded" });
  await waitForQuiet(page, 900);
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await waitForQuiet(page, 500);
  if (/\/app(?:\/|$|\?)/i.test(page.url())) {
    return;
  }
  const emailInput = page.getByLabel(/Email/i).first();
  const passwordInput = page.getByLabel(/Password/i).first();
  await emailInput.waitFor({ state: "visible", timeout: WAIT_MS });
  await passwordInput.waitFor({ state: "visible", timeout: WAIT_MS });
  await emailInput.fill(LOGIN_EMAIL);
  await passwordInput.fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in|Giris|Oturum/i }).first().click();
  await page.waitForURL(/\/app/, { timeout: WAIT_MS });
  await waitForQuiet(page, 1200);
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded" }).catch(() => null);
  await waitForQuiet(page, 600);
}

async function getInputValue(locator) {
  return locator.evaluate((node) => String(node?.value || ""));
}

async function readOptionalInputValue(locator) {
  const first = locator.first();
  const visible = await first.isVisible().catch(() => false);
  if (!visible) {
    return "";
  }
  return getInputValue(first);
}

async function fillBufferedInput(locator, value) {
  await locator.waitFor({ state: "visible", timeout: WAIT_MS });
  await locator.click();
  await locator.press("Control+A");
  await locator.fill(String(value));
  await locator.press("Tab");
}

async function selectFirstComboboxOption(page, container, labelPattern, options = {}) {
  const preferredText = Array.isArray(options?.preferredText)
    ? options.preferredText.filter(Boolean)
    : [];
  const input = container.getByLabel(labelPattern).first();
  await input.waitFor({ state: "visible", timeout: WAIT_MS });
  if (await input.isDisabled()) {
    return { selected: false, reason: "disabled", label: "" };
  }
  const searchAttempts =
    preferredText.length > 0 ? [String(preferredText[0]), ""] : [""];

  for (const searchText of searchAttempts) {
    await input.click();
    if (searchText) {
      await input.press("Control+A").catch(() => null);
      await input.fill(searchText);
      await waitForQuiet(page, 400);
    } else {
      await waitForQuiet(page, 350);
    }
    const listId = await input.getAttribute("aria-controls");
    if (!listId) {
      continue;
    }
    const list = page.locator(`[id="${listId}"]`);
    await list.waitFor({ state: "visible", timeout: WAIT_MS }).catch(() => null);
    const optionsLocator = list.locator('[role="option"]:not([aria-disabled="true"])');
    const optionCount = await optionsLocator.count();
    if (optionCount <= 0) {
      await input.press("Escape").catch(() => null);
      continue;
    }

    let chosenOption = null;
    let chosenLabel = "";
    for (let index = 0; index < optionCount; index += 1) {
      const option = optionsLocator.nth(index);
      const label = String((await option.textContent()) || "")
        .replace(/\s+/g, " ")
        .trim();
      if (preferredText.length > 0 && matchesPreferredText(label, preferredText)) {
        chosenOption = option;
        chosenLabel = label;
        break;
      }
      if (!chosenOption) {
        chosenOption = option;
        chosenLabel = label;
      }
    }

    if (
      searchText
      && preferredText.length > 0
      && !matchesPreferredText(chosenLabel, preferredText)
    ) {
      await input.press("Escape").catch(() => null);
      continue;
    }

    await chosenOption.click();
    await waitForQuiet(page, 350);
    return {
      selected: true,
      reason: "",
      label: chosenLabel,
      matchedPreferred: matchesPreferredText(chosenLabel, preferredText),
    };
  }

  return { selected: false, reason: "no-options", label: "", matchedPreferred: false };
}

async function selectFirstRealOption(container, labelPattern, options = {}) {
  const preferredText = Array.isArray(options?.preferredText)
    ? options.preferredText.filter(Boolean)
    : [];
  const select = container.getByLabel(labelPattern).first();
  await select.waitFor({ state: "visible", timeout: WAIT_MS });
  if (await select.isDisabled()) {
    return { selected: false, reason: "disabled", value: "", label: "" };
  }
  const selectOptions = await select.evaluate((node) =>
    Array.from(node?.options || []).map((option, index) => ({
      index,
      value: String(option?.value || ""),
      label: String(option?.label || option?.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
      disabled: Boolean(option?.disabled),
    }))
  );
  const candidates = selectOptions.filter((option) => option.value && !option.disabled);
  let candidate = candidates.find((option) =>
    matchesPreferredText(option.label, preferredText)
  );
  if (!candidate) {
    candidate = candidates[0];
  }
  if (!candidate) {
    return { selected: false, reason: "no-real-options", value: "", label: "" };
  }
  await select.selectOption(candidate.value);
  return {
    selected: true,
    reason: "",
    value: candidate.value,
    label: candidate.label,
    matchedPreferred: matchesPreferredText(candidate.label, preferredText),
  };
}

async function ensureDueDate(container, dateValue) {
  const dueDateInput = container.getByLabel(/Due Date|Vade Tarihi/i).first();
  await dueDateInput.waitFor({ state: "visible", timeout: WAIT_MS });
  const currentValue = await getInputValue(dueDateInput);
  if (!currentValue) {
    await dueDateInput.fill(dateValue);
  }
  return await getInputValue(dueDateInput);
}

async function readPageIndicator(listSection) {
  const text = String((await listSection.textContent()) || "").replace(/\s+/g, " ");
  const match = text.match(/(?:Page|Sayfa)\s+(\d+)\s*\/\s*(\d+)/i);
  return {
    currentPage: match?.[1] ? Number(match[1]) : null,
    totalPages: match?.[2] ? Number(match[2]) : null,
    text,
  };
}

async function waitForSelectedDocumentId(page) {
  await page.waitForFunction(
    () => Boolean(new URL(window.location.href).searchParams.get("documentId")),
    { timeout: WAIT_MS }
  );
  return new URL(page.url()).searchParams.get("documentId");
}

function draftFixtureForDirection(fixtureReport, direction) {
  return direction === "AR"
    ? fixtureReport?.documents?.arDraft || null
    : fixtureReport?.documents?.apDraft || null;
}

function resolveFallbackDocumentId(fixtureReport, direction) {
  const fixtureDocument = draftFixtureForDirection(fixtureReport, direction);
  const documentId = fixtureDocument?.id;
  return documentId ? String(documentId) : "";
}

async function openDocumentDetail(page, direction, documentId) {
  if (!String(documentId || "").trim()) {
    throw new Error(`Missing documentId for ${direction} detail flow.`);
  }
  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${documentId}`);
  const detailSection = sectionByHeading(page, detailTitlePattern());
  await detailSection.waitFor({ state: "visible", timeout: WAIT_MS });
  await page.waitForFunction(
    (expected) => new URL(window.location.href).searchParams.get("documentId") === String(expected),
    documentId,
    { timeout: WAIT_MS }
  );
  await waitForQuiet(page, 900);
  return detailSection;
}

async function readDetailField(detailSection, fieldName) {
  return detailSection.evaluate(
    (section, targetField) => {
      const labels = Array.from(section.querySelectorAll("dt"));
      const match = labels.find(
        (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim() === targetField
      );
      return String(match?.nextElementSibling?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    },
    fieldName
  );
}

async function openSavedViewsPopover(page) {
  const listSection = sectionByHeading(page, /Document List|Belge Listesi/i);
  await listSection.waitFor({ state: "visible", timeout: WAIT_MS });
  await listSection
    .getByRole("button", { name: /Saved Views|Kayitli Gorunumler/i })
    .first()
    .click();
  const popover = page.locator("#document-list-saved-views-popover");
  await popover.waitFor({ state: "visible", timeout: WAIT_MS });
  return { listSection, popover };
}

async function resetListFilters(page) {
  const listSection = sectionByHeading(page, /Document List|Belge Listesi/i);
  await listSection.waitFor({ state: "visible", timeout: WAIT_MS });
  await listSection
    .getByRole("button", { name: /Reset Filters|Filtreleri Sifirla/i })
    .first()
    .click();
  await waitForQuiet(page, 1000);
  return listSection;
}

async function getCreateDraftSection(page, direction) {
  const createSection = sectionByHeading(page, createTitlePattern(direction));
  await createSection.waitFor({ state: "visible", timeout: WAIT_MS });
  return createSection;
}

async function typeComboboxQuery(page, container, labelPattern, value) {
  const input = container.getByLabel(labelPattern).first();
  await input.waitFor({ state: "visible", timeout: WAIT_MS });
  await input.click();
  await input.press("Control+A").catch(() => null);
  await input.fill(String(value || ""));
  await waitForQuiet(page, 450);
  return input;
}

async function dismissComboboxPopup(input) {
  await input.press("Escape").catch(() => null);
}

async function readCreateDraftSnapshot(page, direction) {
  const createSection = await getCreateDraftSection(page, direction);
  await ensureLineCount(createSection, 1);
  const line1 = getLineRow(createSection, 1);
  return {
    legalEntityText: await readOptionalInputValue(
      createSection.getByLabel(/Legal Entity|Tuzel Kisilik/i)
    ),
    counterpartyText: await readOptionalInputValue(
      createSection.getByLabel(/Counterparty|Cari/i)
    ),
    paymentTermText: await readOptionalInputValue(
      createSection.getByLabel(/Payment Term|Odeme Kosulu/i)
    ),
    documentDate: await readOptionalInputValue(
      createSection.getByLabel(/Document Date|Belge Tarihi/i)
    ),
    dueDate: await readOptionalInputValue(
      createSection.getByLabel(/Due Date|Vade Tarihi/i)
    ),
    lineDescription: await readOptionalInputValue(
      line1.getByLabel(/Description|Aciklama/i)
    ),
    lineType: await line1
      .getByLabel(/Line Type|Satir Tipi/i)
      .first()
      .evaluate((node) => String(node?.value || "")),
    quantity: await readOptionalInputValue(line1.getByLabel(/Quantity|Miktar/i)),
    targetAssetText: await readOptionalInputValue(
      line1.getByLabel(
        /^(Draft Asset|Target Asset|Asset|Taslak Varlik|Hedef Varlik|Varlik)/i
      )
    ),
  };
}

async function waitForCreateDraftSnapshotMatch(page, direction, predicate, errorMessage) {
  const deadline = Date.now() + WAIT_MS;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await readCreateDraftSnapshot(page, direction);
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await waitForQuiet(page, 500);
  }
  throw new Error(
    `${errorMessage}. lastSnapshot=${JSON.stringify(lastSnapshot || {})}`
  );
}

function assertMatchesPreferredLabel(actualText, preferredText, fieldLabel) {
  if (!matchesPreferredText(actualText, preferredText)) {
    throw new Error(
      `Expected ${fieldLabel} to match one of [${(preferredText || []).join(", ")}], got "${actualText}".`
    );
  }
}

async function waitForDetailStatus(page, direction, documentId, expectedStatus) {
  const normalizedExpectedStatus = String(expectedStatus || "").trim().toUpperCase();
  const deadline = Date.now() + WAIT_MS;
  let currentStatus = "";
  while (Date.now() < deadline) {
    const detailSection = await openDocumentDetail(page, direction, documentId);
    currentStatus = String(await readDetailField(detailSection, "status")).trim().toUpperCase();
    if (currentStatus === normalizedExpectedStatus) {
      return currentStatus;
    }
    await waitForQuiet(page, 700);
  }
  throw new Error(
    `Expected detail status ${normalizedExpectedStatus}, got "${currentStatus}".`
  );
}

function lineRowsLocator(container) {
  return container.locator(
    "xpath=.//div[contains(@class,'rounded-lg') and contains(@class,'shadow-sm') and .//p[contains(normalize-space(),'Line') or contains(normalize-space(),'Satir')]]"
  );
}

function getLineRow(container, lineNumber) {
  return lineRowsLocator(container).nth(Math.max(0, Number(lineNumber || 1) - 1));
}

async function ensureLineCount(container, expectedCount) {
  await lineRowsLocator(container)
    .nth(Math.max(0, Number(expectedCount || 1) - 1))
    .waitFor({ state: "visible", timeout: WAIT_MS });
}

async function fillGeneralLine(row, page, { description, quantity, unitPrice, postingAccountPreferred = [] }) {
  await row.waitFor({ state: "visible", timeout: WAIT_MS });
  await row.getByLabel(/Line Type|Satir Tipi/i).first().selectOption("NONE");
  await fillBufferedInput(row.getByLabel(/Description|Aciklama/i).first(), description);
  await row.getByLabel(/Quantity|Miktar/i).first().fill(String(quantity));
  await row.getByLabel(/Unit Price|Birim Fiyat/i).first().fill(String(unitPrice));
  const postingAccount = await selectFirstRealOption(row, /Posting Account|Kayit Hesabi/i, {
    preferredText: postingAccountPreferred,
  });
  return {
    postingAccountSelected: postingAccount.selected,
    postingAccountMatchedPreferred: Boolean(postingAccount.matchedPreferred),
  };
}

async function readCounterpartyInlineCreateMessage(container) {
  const messageLocator = container
    .getByText(/Counterparty created and selected\. counterpartyId=|Cari olusturuldu ve secildi\. counterpartyId=/i)
    .first();
  await messageLocator.waitFor({ state: "visible", timeout: WAIT_MS });
  const text = String((await messageLocator.textContent()) || "").replace(/\s+/g, " ").trim();
  const counterpartyId = text.match(/counterpartyId=(\d+)/i)?.[1] || "";
  return {
    message: text,
    counterpartyId,
  };
}

async function ensureListActionColumnVisible(page) {
  const listSection = sectionByHeading(page, /Document List|Belge Listesi/i);
  await listSection.waitFor({ state: "visible", timeout: WAIT_MS });
  const existingButtons = listSection.getByRole("button", { name: /View \/ Actions/i });
  if ((await existingButtons.count()) > 0) {
    return { changed: false };
  }

  const columnsButton = listSection.getByRole("button", { name: /Columns|Kolonlar/i }).first();
  await columnsButton.click();
  const popover = page.locator("#document-list-columns-popover");
  await popover.waitFor({ state: "visible", timeout: WAIT_MS });
  await popover
    .getByRole("button", { name: /Select all columns|Tum kolonlari sec/i })
    .first()
    .click();
  await waitForQuiet(page, 500);
  await columnsButton.click();
  await popover.waitFor({ state: "hidden", timeout: WAIT_MS }).catch(() => null);
  await waitForQuiet(page, 500);

  return {
    changed: true,
    visibleActionButtons: await listSection
      .getByRole("button", { name: /View \/ Actions/i })
      .count(),
  };
}

async function acceptNextDialog(page, trigger, acceptValue = undefined) {
  const dialogPromise = page.waitForEvent("dialog");
  const triggerPromise = Promise.resolve().then(() => trigger());
  const dialog = await dialogPromise;
  if (dialog.type() === "prompt") {
    await dialog.accept(acceptValue);
    await triggerPromise;
    return {
      type: dialog.type(),
      message: dialog.message(),
      acceptedValue: acceptValue,
    };
  }
  await dialog.accept();
  await triggerPromise;
  return {
    type: dialog.type(),
    message: dialog.message(),
    acceptedValue: null,
  };
}

async function findAlternateActionTarget(listSection, excludedDocumentId = "") {
  const rows = listSection.locator("tbody tr");
  const rowCount = await rows.count();
  let fallback = null;
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const actionButton = row.getByRole("button", { name: /View \/ Actions/i }).first();
    if ((await actionButton.count()) <= 0) {
      continue;
    }
    const rowText = String((await row.textContent()) || "").replace(/\s+/g, " ").trim();
    if (!fallback) {
      fallback = { actionButton, rowText };
    }
    if (excludedDocumentId && rowText.includes(String(excludedDocumentId))) {
      continue;
    }
    return { actionButton, rowText, excludedMatched: false };
  }
  if (fallback) {
    return { ...fallback, excludedMatched: true };
  }
  throw new Error("No document list action row is available.");
}

async function verifyLegacyRedirect(page) {
  await gotoRoute(page, LEGACY_ROUTE);
  await page.waitForURL((url) => url.pathname === AP_ROUTE, {
    timeout: WAIT_MS,
  });
  await sectionByHeading(page, pageTitlePattern("AP")).waitFor({
    state: "visible",
    timeout: WAIT_MS,
  });
  return {
    finalPath: new URL(page.url()).pathname,
  };
}

async function runS1(page, direction) {
  await gotoRoute(page, routeForDirection(direction));
  await sectionByHeading(page, pageTitlePattern(direction)).waitFor({
    state: "visible",
    timeout: WAIT_MS,
  });
  const listSection = sectionByHeading(page, /Document List|Belge Listesi/i);
  await listSection.waitFor({ state: "visible", timeout: WAIT_MS });

  const searchInput = listSection.getByLabel(/Search|Ara/i).first();
  await searchInput.fill(`__cari-smoke-no-match-${direction.toLowerCase()}__`);
  await listSection
    .getByRole("button", { name: /Apply Filters|Filtreleri Uygula|Loading|Yukleniyor/i })
    .first()
    .click();
  await listSection
    .getByText(/No documents found for current filters|Mevcut filtreler icin belge bulunamadi/i)
    .waitFor({ state: "visible", timeout: WAIT_MS });

  await listSection
    .getByRole("button", { name: /Reset Filters|Filtreleri Sifirla/i })
    .first()
    .click();
  await waitForQuiet(page, 900);

  const pageBefore = await readPageIndicator(listSection);
  let paginationExercised = false;
  if ((pageBefore.totalPages || 0) > 1) {
    await listSection
      .getByRole("button", { name: /Next|Sonraki/i })
      .first()
      .click();
    await page.waitForFunction(
      (expected) => {
        const bodyText = String(document?.body?.innerText || "");
        return bodyText.includes(`Page ${expected}/`) || bodyText.includes(`Sayfa ${expected}/`);
      },
      2,
      { timeout: WAIT_MS }
    );
    await listSection
      .getByRole("button", { name: /Previous|Onceki/i })
      .first()
      .click();
    paginationExercised = true;
  }

  const pageAfter = await readPageIndicator(listSection);
  return {
    currentPage: pageAfter.currentPage,
    totalPages: pageAfter.totalPages,
    paginationExercised,
  };
}

async function runS2(page, direction, token) {
  await gotoRoute(page, routeForDirection(direction));
  const listSection = sectionByHeading(page, /Document List|Belge Listesi/i);
  await listSection.waitFor({ state: "visible", timeout: WAIT_MS });
  const searchInput = listSection.getByLabel(/Search|Ara/i).first();
  const savedViewName = `${token}-${direction.toLowerCase()}-saved-view`;
  const filterToken = `__cari-smoke-s2-${direction.toLowerCase()}-${token}__`;

  await searchInput.fill(filterToken);
  await waitForQuiet(page, 300);

  const { popover } = await openSavedViewsPopover(page);
  const createDialog = await acceptNextDialog(
    page,
    () =>
      popover
        .getByRole("button", { name: /Save Current|Mevcutu Kaydet/i })
        .first()
        .click(),
    savedViewName
  );
  await popover
    .getByText(
      new RegExp(
        `Saved view created: ${savedViewName}|Kayitli gorunum olusturuldu: ${savedViewName}`,
        "i"
      )
    )
    .waitFor({ state: "visible", timeout: WAIT_MS });

  const savedViewSelect = popover.locator("select").first();
  const selectedSavedViewLabel = await savedViewSelect.evaluate(
    (node) => String(node?.selectedOptions?.[0]?.textContent || "").replace(/\s+/g, " ").trim()
  );
  if (!selectedSavedViewLabel.includes(savedViewName)) {
    throw new Error(`Saved view was not selected after create. got="${selectedSavedViewLabel}"`);
  }

  await listSection
    .getByRole("button", { name: /Reset Filters|Filtreleri Sifirla/i })
    .first()
    .click();
  await waitForQuiet(page, 900);
  if (await getInputValue(searchInput)) {
    throw new Error("Expected search filter to reset before saved view apply.");
  }

  const reopened = await openSavedViewsPopover(page);
  await reopened.popover
    .getByRole("button", { name: /Apply|Uygula/i })
    .first()
    .click();
  await waitForQuiet(page, 1200);
  if ((await getInputValue(searchInput)) !== filterToken) {
    throw new Error("Saved view apply did not restore the search filter.");
  }
  await listSection
    .getByText(/No documents found for current filters|Mevcut filtreler icin belge bulunamadi/i)
    .waitFor({ state: "visible", timeout: WAIT_MS });

  const deletePopover = await openSavedViewsPopover(page);
  const deleteDialog = await acceptNextDialog(page, () =>
    deletePopover.popover
      .getByRole("button", { name: /Delete|Sil/i })
      .first()
      .click()
  );
  await deletePopover.popover
    .getByText(/Saved view deleted\.|Kayitli gorunum silindi\./i)
    .waitFor({ state: "visible", timeout: WAIT_MS });

  const remainingOptions = await deletePopover.popover.locator("select option").allTextContents();
  const stillExists = remainingOptions.some((optionText) => optionText.includes(savedViewName));
  if (stillExists) {
    throw new Error(`Saved view "${savedViewName}" still exists after delete.`);
  }

  await listSection
    .getByRole("button", { name: /Reset Filters|Filtreleri Sifirla/i })
    .first()
    .click();
  await waitForQuiet(page, 900);

  return {
    direction,
    savedViewName,
    filterToken,
    createDialogType: createDialog.type,
    deleteDialogType: deleteDialog.type,
    applyRestoredSearch: true,
    deleted: true,
  };
}

async function exerciseQuickCreateModal(page, container, scope, token) {
  const lineType = container.getByLabel(/Line Type|Satir Tipi/i).first();
  await lineType.selectOption("FIXED_ASSET");
  await waitForQuiet(page, 500);

  const assetMode = container.getByLabel(/Asset Mode|Varlik Modu/i).first();
  await assetMode.waitFor({ state: "visible", timeout: WAIT_MS });
  await assetMode.selectOption("LINK_EXISTING");
  await waitForQuiet(page, 500);

  const openButton = container.getByRole("button", { name: /\+ New Asset|\+ Yeni Varlik/i }).first();
  await openButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await openButton.click();

  const modal = page
    .getByRole("heading", { name: /Create Draft Asset|Taslak Varlik Olustur/i })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  await modal.waitFor({ state: "visible", timeout: WAIT_MS });

  const assetName = modal.getByLabel(/Asset Name|Varlik Adi/i).first();
  await assetName.fill(`${token}-${scope}-asset`);
  const legalEntityText = await modal.getByText(/Legal Entity|Tuzel Kisilik/i).first().textContent();
  const currencyText = await modal.getByText(/Currency|Para Birimi/i).first().textContent();

  await modal.getByRole("button", { name: /Close|Kapat/i }).first().click();
  await modal.waitFor({ state: "hidden", timeout: WAIT_MS });

  await lineType.selectOption("NONE");
  await waitForQuiet(page, 350);

  return {
    scope,
    opened: true,
    legalEntityText: String(legalEntityText || "").replace(/\s+/g, " ").trim(),
    currencyText: String(currencyText || "").replace(/\s+/g, " ").trim(),
  };
}

async function runS3(page, direction, token, { runQuickCreate = false, fixtureReport = null } = {}) {
  await gotoRoute(page, routeForDirection(direction));
  const createSection = sectionByHeading(page, createTitlePattern(direction));
  await createSection.waitFor({ state: "visible", timeout: WAIT_MS });
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);

  const legalEntity = await selectFirstComboboxOption(
    page,
    createSection,
    /Legal Entity|Tuzel Kisilik/i,
    { preferredText: fixturePreferences.legalEntity }
  );
  await waitForQuiet(page, 900);

  const counterparty = await selectFirstComboboxOption(
    page,
    createSection,
    /Counterparty|Cari/i,
    { preferredText: fixturePreferences.counterparty }
  );
  await waitForQuiet(page, 700);

  const paymentTerm = await selectFirstComboboxOption(
    page,
    createSection,
    /Payment Term|Odeme Kosulu/i,
    { preferredText: fixturePreferences.paymentTerm }
  );

  const documentDateInput = createSection.getByLabel(/Document Date|Belge Tarihi/i).first();
  await documentDateInput.waitFor({ state: "visible", timeout: WAIT_MS });
  const documentDate = (await getInputValue(documentDateInput)) || new Date().toISOString().slice(0, 10);
  if (!(await getInputValue(documentDateInput))) {
    await documentDateInput.fill(documentDate);
  }
  const dueDate = await ensureDueDate(createSection, documentDate);
  const preferredInvoiceCurrencyCode = String(
    fixturePreferences.invoiceCurrencyCode || ""
  ).trim().toUpperCase();
  if (preferredInvoiceCurrencyCode) {
    const invoiceCurrencyInput = createSection
      .getByLabel(/Invoice Currency|Fatura Para Birimi/i)
      .first();
    await fillBufferedInput(invoiceCurrencyInput, preferredInvoiceCurrencyCode);
    await waitForQuiet(page, 450);
  }

  let quickCreateSeed = null;
  if (runQuickCreate && direction === "AP") {
    quickCreateSeed = await exerciseQuickCreateModal(page, createSection, "create", token);
  }

  const lineType = createSection.getByLabel(/Line Type|Satir Tipi/i).first();
  let itemLookup = { selected: false, reason: "item-lookup-skipped" };
  let itemLookupOnStock = { selected: false, reason: "stock-lookups-disabled" };
  let warehouseLookup = { selected: false, reason: "stock-lookups-disabled" };
  if (EXERCISE_STOCK_LOOKUPS) {
    await lineType.selectOption("STOCK");
    await waitForQuiet(page, 500);
    itemLookupOnStock = await selectFirstComboboxOption(
      page,
      createSection,
      /Item Card|Urun Karti/i
    );
    warehouseLookup = await selectFirstComboboxOption(
      page,
      createSection,
      /Warehouse|Depo/i
    );
    itemLookup = itemLookupOnStock;
    await lineType.selectOption("NONE");
    await waitForQuiet(page, 500);
  }

  const lineDescription = createSection.getByLabel(/Description|Aciklama/i).first();
  await fillBufferedInput(lineDescription, `${token}-${direction.toLowerCase()}-create`);
  await waitForQuiet(page, 450);

  await createSection.getByLabel(/Quantity|Miktar/i).first().fill("1");
  await createSection.getByLabel(/Unit Price|Birim Fiyat/i).first().fill("123.45");

  const postingAccount = await selectFirstRealOption(
    createSection,
    /Posting Account|Kayit Hesabi/i,
    { preferredText: fixturePreferences.postingAccount }
  );

  let taxPreviewRequested = false;
  let taxPreviewVisible = false;
  const taxCategory = await selectFirstRealOption(
    createSection,
    /Tax Category|Vergi Kategorisi/i
  );
  if (taxCategory.selected) {
    taxPreviewRequested = true;
    await createSection
      .getByRole("button", { name: /Preview tax|Vergiyi onizle/i })
      .first()
      .click();
    await waitForQuiet(page, 900);
    taxPreviewVisible = await createSection
      .getByText(/Tax preview|Vergi onizlemesi/i)
      .first()
      .isVisible()
      .catch(() => false);
  }

  await createSection
    .getByRole("button", { name: createTitlePattern(direction) })
    .first()
    .click();

  const documentId = await waitForSelectedDocumentId(page);
  const editForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await editForm.waitFor({ state: "visible", timeout: WAIT_MS });

  return {
    direction,
    documentId,
    legalEntitySelected: legalEntity.selected,
    legalEntityMatchedPreferred: Boolean(legalEntity.matchedPreferred),
    counterpartySelected: counterparty.selected,
    counterpartyMatchedPreferred: Boolean(counterparty.matchedPreferred),
    paymentTermSelected: paymentTerm.selected,
    paymentTermMatchedPreferred: Boolean(paymentTerm.matchedPreferred),
    documentDate,
    dueDate,
    postingAccountSelected: postingAccount.selected,
    postingAccountMatchedPreferred: Boolean(postingAccount.matchedPreferred),
    itemLookupSelected: itemLookup.selected || itemLookupOnStock.selected,
    warehouseLookupSelected: warehouseLookup.selected,
    taxCategorySelected: taxCategory.selected,
    taxPreviewRequested,
    taxPreviewVisible,
    quickCreateSeed,
  };
}

async function runS4(page, direction, documentId, token) {
  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${documentId}`);
  const editForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await editForm.waitFor({ state: "visible", timeout: WAIT_MS });

  const descriptionInput = editForm.getByLabel(/Description|Aciklama/i).first();
  const editedDescription = `${token}-${direction.toLowerCase()}-edited`;
  await fillBufferedInput(descriptionInput, editedDescription);
  await waitForQuiet(page, 500);

  const dueDateInput = editForm.getByLabel(/Due Date|Vade Tarihi/i).first();
  const currentDueDate = await getInputValue(dueDateInput);
  const nextDueDate = addDays(currentDueDate || new Date().toISOString().slice(0, 10), 1);
  await dueDateInput.fill(nextDueDate);

  await editForm
    .getByRole("button", { name: /Update Draft Document|Taslak Belgeyi Guncelle/i })
    .first()
    .click();
  await waitForQuiet(page, 1400);

  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${documentId}`);
  const refreshedEditForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await refreshedEditForm.waitFor({ state: "visible", timeout: WAIT_MS });

  const refreshedDescription = await getInputValue(
    refreshedEditForm.getByLabel(/Description|Aciklama/i).first()
  );
  const refreshedDueDate = await getInputValue(
    refreshedEditForm.getByLabel(/Due Date|Vade Tarihi/i).first()
  );
  if (!String(refreshedDescription || "").includes(editedDescription)) {
    throw new Error(
      `Expected edited description to persist. got="${refreshedDescription}"`
    );
  }
  if (String(refreshedDueDate || "").slice(0, 10) !== nextDueDate) {
    throw new Error(`Expected due date ${nextDueDate}, got ${refreshedDueDate}`);
  }

  return {
    direction,
    documentId,
    editedDescription,
    dueDate: nextDueDate,
  };
}

async function runS6PostExistingDraft(page, direction, documentId) {
  const detailSection = await openDocumentDetail(page, direction, documentId);
  const postButton = detailSection.getByRole("button", {
    name: /Post Draft|Taslagi Kaydet/i,
  }).first();
  await postButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await postButton.click();
  await waitForQuiet(page, 1200);

  const deadline = Date.now() + WAIT_MS;
  let status = "";
  let postedJournalEntryId = "";
  while (Date.now() < deadline) {
    const refreshedDetail = await openDocumentDetail(page, direction, documentId);
    status = String(await readDetailField(refreshedDetail, "status"));
    postedJournalEntryId = String(
      await readDetailField(refreshedDetail, "postedJournalEntryId")
    );
    if (String(status).toUpperCase() === "POSTED" && postedJournalEntryId !== "-") {
      break;
    }
    await waitForQuiet(page, 700);
  }

  if (String(status).toUpperCase() !== "POSTED") {
    throw new Error(`Expected POSTED status after post. got="${status}"`);
  }
  if (!postedJournalEntryId || postedJournalEntryId === "-") {
    throw new Error(
      `Expected postedJournalEntryId after post. got="${postedJournalEntryId}"`
    );
  }

  return {
    direction,
    documentId,
    status,
    postedJournalEntryId,
  };
}

async function runS6(page, direction, token, fixtureReport = null) {
  const createResult = await runS3(page, direction, `${token}-${direction.toLowerCase()}-post`, {
    fixtureReport,
  });
  if (!createResult?.documentId) {
    throw new Error(`S6 create target failed for ${direction}.`);
  }
  const postResult = await runS6PostExistingDraft(page, direction, createResult.documentId);
  return {
    direction,
    createdDocumentId: createResult.documentId,
    postedJournalEntryId: postResult.postedJournalEntryId,
    postedStatus: postResult.status,
  };
}

async function runS7ReverseExistingDocument(page, direction, documentId) {
  const detailSection = await openDocumentDetail(page, direction, documentId);
  const reversalDateInput = detailSection.getByLabel(/Reversal Date|Ters Kayit Tarihi/i).first();
  await reversalDateInput.waitFor({ state: "visible", timeout: WAIT_MS });
  const currentReversalDate = await getInputValue(reversalDateInput);
  if (!currentReversalDate) {
    await reversalDateInput.fill(new Date().toISOString().slice(0, 10));
  }
  const reverseButton = detailSection.getByRole("button", {
    name: /Reverse Document|Belgeyi Tersle/i,
  }).first();
  await reverseButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await reverseButton.click();
  await waitForQuiet(page, 1200);

  const deadline = Date.now() + WAIT_MS;
  let status = "";
  let reverseText = "";
  let reversalDocumentId = "";
  while (Date.now() < deadline) {
    const refreshedDetail = await openDocumentDetail(page, direction, documentId);
    status = String(await readDetailField(refreshedDetail, "status"));
    const reverseLinkage = refreshedDetail
      .getByText(/Reverse linkage|Ters baglanti/i)
      .first();
    const reverseLinkageVisible = await reverseLinkage.isVisible().catch(() => false);
    if (reverseLinkageVisible) {
      reverseText = String((await reverseLinkage.textContent()) || "")
        .replace(/\s+/g, " ")
        .trim();
      reversalDocumentId = reverseText.match(/response\.row\.id`?=(\d+)/i)?.[1] || "";
    }
    if (String(status).toUpperCase() === "REVERSED") {
      break;
    }
    await waitForQuiet(page, 700);
  }

  if (String(status).toUpperCase() !== "REVERSED") {
    throw new Error(`Expected REVERSED status after reverse. got="${status}"`);
  }

  return {
    direction,
    documentId,
    status,
    reversalDocumentId,
    reverseText,
  };
}

async function runS7(page, direction, token, fixtureReport = null) {
  const createResult = await runS3(page, direction, `${token}-${direction.toLowerCase()}-reverse`, {
    fixtureReport,
  });
  if (!createResult?.documentId) {
    throw new Error(`S7 create target failed for ${direction}.`);
  }
  const postResult = await runS6PostExistingDraft(page, direction, createResult.documentId);
  const reverseResult = await runS7ReverseExistingDocument(
    page,
    direction,
    createResult.documentId
  );
  return {
    direction,
    createdDocumentId: createResult.documentId,
    postedJournalEntryId: postResult.postedJournalEntryId,
    reversalDocumentId: reverseResult.reversalDocumentId,
    reversedStatus: reverseResult.status,
  };
}

async function runS12CreateInline(page, direction, token, fixtureReport = null) {
  await gotoRoute(page, routeForDirection(direction));
  const createSection = sectionByHeading(page, createTitlePattern(direction));
  await createSection.waitFor({ state: "visible", timeout: WAIT_MS });
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);
  await selectFirstComboboxOption(page, createSection, /Legal Entity|Tuzel Kisilik/i, {
    preferredText: fixturePreferences.legalEntity,
  });
  await waitForQuiet(page, 700);

  const inlineName = `SMOKE ${direction} CREATE ${token}`;
  const counterpartyInput = await typeComboboxQuery(
    page,
    createSection,
    /Counterparty|Cari/i,
    inlineName
  );
  await dismissComboboxPopup(counterpartyInput);
  const openButton = createSection.getByRole("button", {
    name: /Create ".+" with details|".+" icin detayli kart ac/i,
  }).first();
  await openButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await openButton.click();

  const modal = page
    .getByRole("heading", { name: /Create Counterparty|Cari Olustur/i })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  await modal.waitFor({ state: "visible", timeout: WAIT_MS });
  await modal.getByRole("button", { name: /Create \+ Select|Olustur \+ Sec/i }).first().click();
  await modal.waitFor({ state: "hidden", timeout: WAIT_MS });

  const message = await readCounterpartyInlineCreateMessage(createSection);
  return {
    direction,
    scope: "create",
    inlineName,
    counterpartyId: message.counterpartyId,
    message: message.message,
  };
}

async function runS12EditInline(page, direction, documentId, token) {
  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${documentId}`);
  const editForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await editForm.waitFor({ state: "visible", timeout: WAIT_MS });

  const inlineName = `SMOKE ${direction} EDIT ${token}`;
  const counterpartyLookupInput = await typeComboboxQuery(
    page,
    editForm,
    /Counterparty Lookup|Cari Arama/i,
    inlineName
  );
  await dismissComboboxPopup(counterpartyLookupInput);
  const openButton = editForm.getByRole("button", {
    name: /Create ".+" with details|".+" icin detayli kart ac/i,
  }).first();
  await openButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await openButton.click();

  const modal = page
    .getByRole("heading", { name: /Create Counterparty|Cari Olustur/i })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  await modal.waitFor({ state: "visible", timeout: WAIT_MS });
  await modal.getByRole("button", { name: /Create \+ Select|Olustur \+ Sec/i }).first().click();
  await modal.waitFor({ state: "hidden", timeout: WAIT_MS });

  const message = await readCounterpartyInlineCreateMessage(editForm);
  return {
    direction,
    scope: "edit",
    documentId,
    inlineName,
    counterpartyId: message.counterpartyId,
    message: message.message,
  };
}

async function runS13(page, token, fixtureReport = null) {
  const direction = "AP";
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);
  const createResult = await runS3(page, direction, `${token}-charge`, {
    fixtureReport,
  });
  if (!createResult?.documentId) {
    throw new Error("S13 create target failed for AP.");
  }

  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${createResult.documentId}`);
  const editForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await editForm.waitFor({ state: "visible", timeout: WAIT_MS });

  const addLineButton = editForm.getByRole("button", { name: /Add line|Satir ekle/i }).first();
  await addLineButton.click();
  await waitForQuiet(page, 400);
  await addLineButton.click();
  await waitForQuiet(page, 400);
  await ensureLineCount(editForm, 3);

  const line2 = getLineRow(editForm, 2);
  const line3 = getLineRow(editForm, 3);
  const line2Fill = await fillGeneralLine(line2, page, {
    description: `${token}-target-2`,
    quantity: 1,
    unitPrice: "40",
    postingAccountPreferred: fixturePreferences.postingAccount,
  });
  const line3Fill = await fillGeneralLine(line3, page, {
    description: `${token}-charge-line`,
    quantity: 1,
    unitPrice: "20",
    postingAccountPreferred: fixturePreferences.postingAccount,
  });

  const chargeToggle = line3
    .getByText(/Distribute as Charge|Masraf Olarak Dagit/i)
    .first()
    .locator("xpath=ancestor::label[1]//input[@type='checkbox']");
  await chargeToggle.check();
  await waitForQuiet(page, 500);

  const methodSelect = line3.getByLabel(/Charge Allocation Method|Masraf Dagitim Metodu/i).first();
  await methodSelect.waitFor({ state: "visible", timeout: WAIT_MS });
  await methodSelect.selectOption("EQUAL");
  const targetsPanel = line3
    .getByText(/Charge Targets|Masraf Hedefleri/i)
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-cyan-200')][1]");
  const targetLine1 = targetsPanel
    .getByText(/Line 1|Satir 1/i)
    .first()
    .locator("xpath=ancestor::label[1]//input[@type='checkbox']");
  const targetLine2 = targetsPanel
    .getByText(/Line 2|Satir 2/i)
    .first()
    .locator("xpath=ancestor::label[1]//input[@type='checkbox']");
  await targetLine1.check();
  await targetLine2.check();

  await editForm
    .getByRole("button", { name: /Update Draft Document|Taslak Belgeyi Guncelle/i })
    .first()
    .click();
  await waitForQuiet(page, 1400);

  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${createResult.documentId}`);
  const refreshedEditForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await refreshedEditForm.waitFor({ state: "visible", timeout: WAIT_MS });
  await ensureLineCount(refreshedEditForm, 3);
  const refreshedLine3 = getLineRow(refreshedEditForm, 3);
  const refreshedChargeToggle = refreshedLine3
    .getByText(/Distribute as Charge|Masraf Olarak Dagit/i)
    .first()
    .locator("xpath=ancestor::label[1]//input[@type='checkbox']");
  const refreshedMethod = await refreshedLine3
    .getByLabel(/Charge Allocation Method|Masraf Dagitim Metodu/i)
    .first()
    .evaluate((node) => String(node?.value || ""));
  const refreshedTargetsPanel = refreshedLine3
    .getByText(/Charge Targets|Masraf Hedefleri/i)
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-cyan-200')][1]");
  const refreshedTargetLine1 = refreshedTargetsPanel
    .getByText(/Line 1|Satir 1/i)
    .first()
    .locator("xpath=ancestor::label[1]//input[@type='checkbox']");
  const refreshedTargetLine2 = refreshedTargetsPanel
    .getByText(/Line 2|Satir 2/i)
    .first()
    .locator("xpath=ancestor::label[1]//input[@type='checkbox']");

  if (!(await refreshedChargeToggle.isChecked())) {
    throw new Error("Charge toggle did not persist on AP charge line.");
  }
  if (refreshedMethod !== "EQUAL") {
    throw new Error(`Expected EQUAL charge allocation method, got "${refreshedMethod}"`);
  }
  if (!(await refreshedTargetLine1.isChecked()) || !(await refreshedTargetLine2.isChecked())) {
    throw new Error("Charge target selection did not persist after save/reload.");
  }

  return {
    direction,
    documentId: createResult.documentId,
    lineCount: 3,
    chargeAllocationMethod: refreshedMethod,
    selectedTargetCount: 2,
    line2PostingAccountSelected: line2Fill.postingAccountSelected,
    line3PostingAccountSelected: line3Fill.postingAccountSelected,
  };
}

async function runS8(page, direction, documentId, token) {
  const detailSection = await openDocumentDetail(page, direction, documentId);
  const commentForm = formByButton(page, /Add Comment|Yorum Ekle/i);
  await commentForm.waitFor({ state: "visible", timeout: WAIT_MS });
  const textarea = commentForm
    .getByPlaceholder(/Add internal comment|Dahili yorum ekleyin/i)
    .first();
  const commentBody = `Smoke internal comment ${direction} ${token} @tmv`;

  await textarea.fill(commentBody);
  await waitForQuiet(page, 600);
  await detailSection
    .getByText(/Mention teammates|Ekip arkadaslarini etiketle/i)
    .waitFor({ state: "visible", timeout: WAIT_MS });

  await commentForm
    .getByRole("button", { name: /Add Comment|Yorum Ekle/i })
    .first()
    .click();
  await detailSection
    .getByText(commentBody, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: WAIT_MS });

  return {
    direction,
    documentId,
    commentBody,
    mentionPickerOpened: true,
  };
}

async function runS9(page, direction, documentId, token) {
  const detailSection = await openDocumentDetail(page, direction, documentId);
  const evidenceForm = formByButton(page, /Attach Evidence|Kanit Ekle/i);
  await evidenceForm.waitFor({ state: "visible", timeout: WAIT_MS });
  const note = `smoke-evidence-${direction.toLowerCase()}-${token}`;

  await evidenceForm.locator('input[type="file"]').first().setInputFiles(EVIDENCE_SAMPLE_PATH);
  await evidenceForm.getByPlaceholder(/Optional note|Opsiyonel not/i).first().fill(note);
  await evidenceForm
    .getByRole("button", { name: /Attach Evidence|Kanit Ekle/i })
    .first()
    .click();
  await detailSection.getByText(note, { exact: false }).first().waitFor({
    state: "visible",
    timeout: WAIT_MS,
  });

  const evidenceRow = detailSection
    .getByText(note, { exact: false })
    .first()
    .locator("xpath=ancestor::li[1]");
  const downloadPromise = page.waitForEvent("download");
  await evidenceRow.getByRole("button", { name: /Download|Indir/i }).first().click();
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();

  await evidenceRow.getByRole("button", { name: /Delete|Sil/i }).first().click();
  await evidenceRow.waitFor({ state: "hidden", timeout: WAIT_MS });

  return {
    direction,
    documentId,
    note,
    suggestedFilename,
    deleted: true,
  };
}

async function runS10(page, direction, documentId, token) {
  await openDocumentDetail(page, direction, documentId);
  const opsForm = formByButton(page, /Save Ops Status|Operasyon Durumunu Kaydet/i);
  await opsForm.waitFor({ state: "visible", timeout: WAIT_MS });
  const blockedReason = `Smoke blocker ${direction} ${token}`;
  const opsNote = `Smoke ops note ${direction} ${token}`;

  await opsForm.getByLabel(/Ops Status|Operasyon Durumu/i).first().selectOption("BLOCKED");
  await opsForm
    .getByPlaceholder(/Blocked reason|Engel nedeni/i)
    .first()
    .fill(blockedReason);
  await opsForm
    .getByPlaceholder(/Ops note|Operasyon notu/i)
    .first()
    .fill(opsNote);
  await opsForm
    .getByRole("button", { name: /Save Ops Status|Operasyon Durumunu Kaydet/i })
    .first()
    .click();
  await waitForQuiet(page, 1400);

  await openDocumentDetail(page, direction, documentId);
  const refreshedOpsForm = formByButton(page, /Save Ops Status|Operasyon Durumunu Kaydet/i);
  await refreshedOpsForm.waitFor({ state: "visible", timeout: WAIT_MS });
  const refreshedStatus = await refreshedOpsForm
    .getByLabel(/Ops Status|Operasyon Durumu/i)
    .first()
    .evaluate((node) => String(node?.value || ""));
  const refreshedBlockedReason = await getInputValue(
    refreshedOpsForm.getByPlaceholder(/Blocked reason|Engel nedeni/i).first()
  );
  const refreshedOpsNote = await getInputValue(
    refreshedOpsForm.getByPlaceholder(/Ops note|Operasyon notu/i).first()
  );
  if (refreshedStatus !== "BLOCKED") {
    throw new Error(`Expected persisted ops status BLOCKED, got "${refreshedStatus}"`);
  }
  if (refreshedBlockedReason !== blockedReason) {
    throw new Error("Blocked reason did not persist.");
  }
  if (refreshedOpsNote !== opsNote) {
    throw new Error("Ops note did not persist.");
  }

  return {
    direction,
    documentId,
    opsStatus: refreshedStatus,
    blockedReason,
    opsNote,
  };
}

async function runS14(page, direction, documentId, fixtureReport = null) {
  const detailSection = await openDocumentDetail(page, direction, documentId);
  const deepLinkedDocumentNo = await readDetailField(detailSection, "documentNo");
  if (!deepLinkedDocumentNo || deepLinkedDocumentNo === "-") {
    throw new Error("Deep link detail did not resolve a documentNo.");
  }

  await gotoRoute(page, routeForDirection(direction));
  const listSection = await resetListFilters(page);
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);
  await selectFirstComboboxOption(page, listSection, /Legal Entity|Tuzel Kisilik/i, {
    preferredText: fixturePreferences.legalEntity,
  });
  await waitForQuiet(page, 700);
  const searchInput = listSection.getByLabel(/Search|Ara/i).first();
  await searchInput.fill(deepLinkedDocumentNo);
  const filterButton = listSection.getByRole("button", { name: /Filter|Filtre/i }).first();
  await filterButton.click();
  const filterPopover = page.locator("#document-list-filters-popover");
  await filterPopover.waitFor({ state: "visible", timeout: WAIT_MS });
  await filterPopover.getByLabel(/Date From|Baslangic Tarihi/i).first().fill("");
  await filterPopover.getByLabel(/Date To|Bitis Tarihi/i).first().fill("");
  await filterPopover
    .getByRole("button", { name: /Apply Filters|Filtreleri Uygula|Loading|Yukleniyor/i })
    .first()
    .click();
  await waitForQuiet(page, 1200);
  const actionColumnState = await ensureListActionColumnVisible(page);
  await listSection.waitFor({ state: "visible", timeout: WAIT_MS });
  const matchingRowAction = listSection.getByRole("button", { name: /View \/ Actions/i }).first();
  await matchingRowAction.waitFor({ state: "visible", timeout: WAIT_MS });
  await matchingRowAction.scrollIntoViewIfNeeded().catch(() => null);
  await matchingRowAction.click();
  await waitForQuiet(page, 900);
  const selectedAfterClick = await waitForSelectedDocumentId(page);
  const clickedDetailSection = sectionByHeading(page, detailTitlePattern());
  await clickedDetailSection.waitFor({ state: "visible", timeout: WAIT_MS });
  const clickedDocumentNo = await readDetailField(clickedDetailSection, "documentNo");
  if (!clickedDocumentNo || clickedDocumentNo === "-") {
    throw new Error("List selection did not hydrate detail after URL sync.");
  }

  return {
    direction,
    deepLinkedDocumentId: String(documentId),
    deepLinkedDocumentNo,
    clickedDocumentId: selectedAfterClick,
    clickedDocumentNo,
    actionColumnChanged: actionColumnState.changed,
    legalEntityAligned: true,
    changedSelection: String(selectedAfterClick) !== String(documentId),
  };
}

async function runS15(page, fixtureReport = null) {
  const asset = fixtureReport?.fixedAssets?.activeAsset || null;
  const assetId = asset?.id;
  if (!assetId) {
    throw new Error("S15 requires fixtureReport.fixedAssets.activeAsset.id.");
  }

  await page.goto(`${BASE_URL}${fixedAssetDetailRoute(assetId)}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForQuiet(page, 1200);

  const saleButton = page
    .getByRole("button", { exact: true, name: /^(Sale|Satis)$/i })
    .first();
  await saleButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await saleButton.click();
  await waitForQuiet(page, 800);

  const salePrefillLink = page
    .getByRole("link", {
      name: /Open Sale Invoice Draft|Satis Faturasi Taslagi Ac/i,
    })
    .first();
  await salePrefillLink.waitFor({ state: "visible", timeout: WAIT_MS });
  const prefillHref = String(
    (await salePrefillLink.evaluate((node) => node.getAttribute("href") || "")) || ""
  );
  if (!/prefillMode=FA_SALE/i.test(prefillHref) || !/prefillDirection=AR/i.test(prefillHref)) {
    throw new Error(`Expected fixed-asset sale prefill href, got "${prefillHref}".`);
  }

  await salePrefillLink.click();
  await page.waitForURL(/\/app\/satis-faturalari/i, { timeout: WAIT_MS });
  const createSection = await getCreateDraftSection(page, "AR");
  const prefillMessage = createSection
    .getByText(
      /Sale draft was prefilled from fixed asset detail|satis taslagi duran varlik detayindan hazirlandi/i
    )
    .first();
  await prefillMessage.waitFor({ state: "visible", timeout: WAIT_MS });

  await page.waitForFunction(
    () => {
      const url = new URL(window.location.href);
      return ![
        "prefillMode",
        "prefillDirection",
        "prefillTargetFixedAssetId",
        "prefillLegalEntityId",
        "prefillOperatingUnitId",
        "prefillSourceAssetNo",
        "prefillSourceAssetName",
      ].some((key) => url.searchParams.has(key));
    },
    { timeout: WAIT_MS }
  );

  const fixturePreferences = buildFixturePreferences(fixtureReport, "AR");
  const assetLabelHints = [asset?.assetNo, asset?.name].filter(Boolean);
  const snapshot = await waitForCreateDraftSnapshotMatch(
    page,
    "AR",
    (candidate) =>
      candidate.lineType === "FIXED_ASSET" &&
      String(candidate.quantity || "").trim() === "1" &&
      assetLabelHints.some((hint) =>
        normalizeOptionText(candidate.lineDescription).includes(normalizeOptionText(hint))
      ) &&
      assetLabelHints.some((hint) =>
        normalizeOptionText(candidate.targetAssetText).includes(normalizeOptionText(hint))
      ),
    "S15 create draft prefill did not settle"
  );

  assertMatchesPreferredLabel(
    snapshot.legalEntityText,
    fixturePreferences.legalEntity,
    "prefilled legal entity"
  );
  if (String(snapshot.counterpartyText || "").trim()) {
    throw new Error(
      `Expected S15 counterparty to stay blank for manual completion, got "${snapshot.counterpartyText}".`
    );
  }

  return {
    direction: "AR",
    assetId: String(assetId),
    assetNo: asset?.assetNo || null,
    prefillHref,
    finalUrl: page.url(),
    queryCleared: true,
    lineType: snapshot.lineType,
    lineDescription: snapshot.lineDescription,
    targetAssetText: snapshot.targetAssetText,
  };
}

async function runS16CloneSelected(page, direction, token, fixtureReport = null) {
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);
  const sourceToken = `${token}-${direction.toLowerCase()}-selected`;
  const expectedDescription = `${sourceToken}-${direction.toLowerCase()}-create`;
  const createResult = await runS3(page, direction, sourceToken, {
    fixtureReport,
  });
  if (!createResult?.documentId) {
    throw new Error(`S16 clone-selected seed failed for ${direction}.`);
  }

  await openDocumentDetail(page, direction, createResult.documentId);
  const createSection = await getCreateDraftSection(page, direction);
  const cloneButton = createSection.getByRole("button", {
    name: /Clone Selected Document|Secili Belgeyi Kopyala/i,
  }).first();
  await cloneButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await cloneButton.click();

  const snapshot = await waitForCreateDraftSnapshotMatch(
    page,
    direction,
    (candidate) =>
      String(candidate.lineDescription || "").includes(expectedDescription) &&
      matchesPreferredText(candidate.legalEntityText, fixturePreferences.legalEntity) &&
      matchesPreferredText(candidate.counterpartyText, fixturePreferences.counterparty),
    `S16 clone-selected create snapshot did not settle for ${direction}`
  );

  return {
    direction,
    sourceDocumentId: createResult.documentId,
    lineDescription: snapshot.lineDescription,
    legalEntityText: snapshot.legalEntityText,
    counterpartyText: snapshot.counterpartyText,
  };
}

async function runS16CancelAndCopy(page, direction, token, fixtureReport = null) {
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);
  const sourceToken = `${token}-${direction.toLowerCase()}-cancel-copy`;
  const expectedDescription = `${sourceToken}-${direction.toLowerCase()}-create`;
  const createResult = await runS3(page, direction, sourceToken, {
    fixtureReport,
  });
  if (!createResult?.documentId) {
    throw new Error(`S16 cancel-and-copy seed failed for ${direction}.`);
  }

  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${createResult.documentId}`);
  const editForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await editForm.waitFor({ state: "visible", timeout: WAIT_MS });
  const cancelAndCopyButton = editForm.getByRole("button", {
    name: /Cancel \+ Copy to Draft|Iptal Et \+ Taslaga Kopyala/i,
  }).first();
  await cancelAndCopyButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await cancelAndCopyButton.click();

  const snapshot = await waitForCreateDraftSnapshotMatch(
    page,
    direction,
    (candidate) =>
      String(candidate.lineDescription || "").includes(expectedDescription) &&
      matchesPreferredText(candidate.legalEntityText, fixturePreferences.legalEntity) &&
      matchesPreferredText(candidate.counterpartyText, fixturePreferences.counterparty),
    `S16 cancel-and-copy create snapshot did not settle for ${direction}`
  );
  const finalStatus = await waitForDetailStatus(
    page,
    direction,
    createResult.documentId,
    "CANCELLED"
  );

  return {
    direction,
    sourceDocumentId: createResult.documentId,
    sourceStatus: finalStatus,
    lineDescription: snapshot.lineDescription,
    counterpartyText: snapshot.counterpartyText,
  };
}

async function runS16ReverseAndCopy(page, direction, token, fixtureReport = null) {
  const fixturePreferences = buildFixturePreferences(fixtureReport, direction);
  const sourceToken = `${token}-${direction.toLowerCase()}-reverse-copy`;
  const expectedDescription = `${sourceToken}-${direction.toLowerCase()}-create`;
  const createResult = await runS3(page, direction, sourceToken, {
    fixtureReport,
  });
  if (!createResult?.documentId) {
    throw new Error(`S16 reverse-and-copy seed failed for ${direction}.`);
  }

  await runS6PostExistingDraft(page, direction, createResult.documentId);
  const detailSection = await openDocumentDetail(page, direction, createResult.documentId);
  const reversalDateInput = detailSection.getByLabel(/Reversal Date|Ters Kayit Tarihi/i).first();
  await reversalDateInput.waitFor({ state: "visible", timeout: WAIT_MS });
  const currentReversalDate = await getInputValue(reversalDateInput);
  if (!currentReversalDate) {
    await reversalDateInput.fill(new Date().toISOString().slice(0, 10));
  }
  const reverseAndCopyButton = detailSection.getByRole("button", {
    name: /Reverse \+ Copy to Draft|Tersle \+ Taslaga Kopyala/i,
  }).first();
  await reverseAndCopyButton.waitFor({ state: "visible", timeout: WAIT_MS });
  await reverseAndCopyButton.click();

  const snapshot = await waitForCreateDraftSnapshotMatch(
    page,
    direction,
    (candidate) =>
      String(candidate.lineDescription || "").includes(expectedDescription) &&
      matchesPreferredText(candidate.legalEntityText, fixturePreferences.legalEntity) &&
      matchesPreferredText(candidate.counterpartyText, fixturePreferences.counterparty),
    `S16 reverse-and-copy create snapshot did not settle for ${direction}`
  );
  const finalStatus = await waitForDetailStatus(
    page,
    direction,
    createResult.documentId,
    "REVERSED"
  );

  return {
    direction,
    sourceDocumentId: createResult.documentId,
    sourceStatus: finalStatus,
    lineDescription: snapshot.lineDescription,
    counterpartyText: snapshot.counterpartyText,
  };
}

async function cleanupDraft(page, direction, documentId) {
  await gotoRoute(page, `${routeForDirection(direction)}?documentId=${documentId}`);
  const editForm = formByButton(page, /Update Draft Document|Taslak Belgeyi Guncelle/i);
  await editForm.waitFor({ state: "visible", timeout: WAIT_MS });
  const cancelButton = editForm.getByRole("button", {
    name: /Cancel Draft|Taslagi Iptal Et/i,
  }).first();
  await cancelButton.click();
  await waitForQuiet(page, 1500);
  await page.waitForFunction(
    () => {
      const bodyText = String(document?.body?.innerText || "");
      return /\bCancelled\b/i.test(bodyText) || /\bIptal edildi\b/i.test(bodyText);
    },
    { timeout: WAIT_MS }
  );
  return {
    direction,
    documentId,
    cleanedUp: true,
  };
}

async function buildReport(reportPath, payload) {
  await writeJson(reportPath, payload);
  if (payload?.artifactsDir) {
    await writeJson(path.join(payload.artifactsDir, "report.json"), payload);
  }
}

async function main() {
  const runToken = timestampToken();
  const artifactDir = path.join(ARTIFACT_ROOT, `cari-docs-smoke-${runToken}`);
  await ensureDir(artifactDir);

  let fixtureBootstrap = null;
  if (BOOTSTRAP_FIXTURES) {
    fixtureBootstrap = runNodeScript(FIXTURE_DIR, "seed-cari-documents-fixtures.mjs");
  }
  const fixtureReport = await readJson(FIXTURE_REPORT_PATH).catch(() => null);

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROME_PATH,
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const results = [];
  const cleanupResults = [];
  const createdDrafts = [];
  let stepCounter = 0;

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error?.message || String(error));
  });

  async function runStep(name, fn) {
    stepCounter += 1;
    const safeName = sanitizeForFile(name);
    try {
      const data = (await fn()) || {};
      const screenshot = await takeStepScreenshot(page, artifactDir, stepCounter, safeName);
      results.push({
        name,
        status: "ok",
        url: page.url(),
        screenshot,
        ...data,
      });
      console.log(`[ok] ${name}`);
      return data;
    } catch (error) {
      const screenshot = await takeStepScreenshot(
        page,
        artifactDir,
        stepCounter,
        `${safeName}-failed`
      ).catch(() => null);
      results.push({
        name,
        status: "failed",
        url: page.url(),
        screenshot,
        error: error?.stack || error?.message || String(error),
      });
      console.error(`[failed] ${name}: ${error?.message || error}`);
      return null;
    }
  }

  try {
    const loginResult = await runStep("login", async () => {
      await login(page);
      return {
        loginEmail: LOGIN_EMAIL,
      };
    });
    if (!loginResult) {
      throw new Error("Login failed. Cannot continue smoke.");
    }

    await runStep("legacy-redirect", async () => verifyLegacyRedirect(page));
    const orderedSteps = SUPPORTED_STEPS.filter((step) => SELECTED_STEPS.includes(step));
    const createResultsByDirection = Object.fromEntries(
      SELECTED_DIRECTIONS.map((direction) => [direction, null])
    );

    function pushSkipped(name, reason) {
      results.push({
        name,
        status: "skipped",
        reason,
      });
    }

    function resolveBaseDocumentId(direction) {
      return (
        createResultsByDirection[direction]?.documentId ||
        resolveFallbackDocumentId(fixtureReport, direction)
      );
    }

    for (const step of orderedSteps) {
      switch (step) {
        case "S1": {
          for (const direction of SELECTED_DIRECTIONS) {
            await runStep(`${direction}-S1-list-loads`, async () => runS1(page, direction));
          }
          break;
        }
        case "S2": {
          for (const direction of SELECTED_DIRECTIONS) {
            await runStep(`${direction}-S2-saved-views`, async () =>
              runS2(page, direction, `cari-smoke-${runToken}`)
            );
          }
          break;
        }
        case "S3": {
          for (const direction of SELECTED_DIRECTIONS) {
            const createResult = await runStep(`${direction}-S3-create-draft`, async () =>
              runS3(page, direction, `cari-smoke-${runToken}`, {
                runQuickCreate: direction === "AP" && orderedSteps.includes("S11"),
                fixtureReport,
              })
            );
            createResultsByDirection[direction] = createResult || null;
            if (createResult?.documentId) {
              createdDrafts.push({
                direction,
                documentId: createResult.documentId,
              });
            }
          }
          break;
        }
        case "S4": {
          for (const direction of SELECTED_DIRECTIONS) {
            const createResult = createResultsByDirection[direction];
            if (!createResult?.documentId) {
              pushSkipped(
                `${direction}-S4-edit-draft`,
                "S3 draft creation did not produce a documentId"
              );
              continue;
            }
            await runStep(`${direction}-S4-edit-draft`, async () =>
              runS4(page, direction, createResult.documentId, `cari-smoke-${runToken}`)
            );
          }
          break;
        }
        case "S5": {
          for (const direction of SELECTED_DIRECTIONS) {
            const cancelSeed = await runStep(`${direction}-S5-create-cancel-target`, async () =>
              runS3(page, direction, `cari-smoke-cancel-${runToken}`, {
                fixtureReport,
              })
            );
            if (!cancelSeed?.documentId) {
              pushSkipped(
                `${direction}-S5-cancel-draft`,
                "Cancel target draft creation did not produce a documentId"
              );
              continue;
            }
            await runStep(`${direction}-S5-cancel-draft`, async () =>
              cleanupDraft(page, direction, cancelSeed.documentId)
            );
          }
          break;
        }
        case "S6": {
          for (const direction of SELECTED_DIRECTIONS) {
            await runStep(`${direction}-S6-post-draft`, async () =>
              runS6(page, direction, `cari-smoke-s6-${runToken}`, fixtureReport)
            );
          }
          break;
        }
        case "S7": {
          for (const direction of SELECTED_DIRECTIONS) {
            await runStep(`${direction}-S7-reverse-posted`, async () =>
              runS7(page, direction, `cari-smoke-s7-${runToken}`, fixtureReport)
            );
          }
          break;
        }
        case "S8": {
          for (const direction of SELECTED_DIRECTIONS) {
            const baseDocumentId = resolveBaseDocumentId(direction);
            if (!baseDocumentId) {
              pushSkipped(
                `${direction}-S8-comments-panel`,
                "No created or fixture document is available"
              );
              continue;
            }
            await runStep(`${direction}-S8-comments-panel`, async () =>
              runS8(page, direction, baseDocumentId, `cari-smoke-${runToken}`)
            );
          }
          break;
        }
        case "S9": {
          for (const direction of SELECTED_DIRECTIONS) {
            const baseDocumentId = resolveBaseDocumentId(direction);
            if (!baseDocumentId) {
              pushSkipped(
                `${direction}-S9-evidence-panel`,
                "No created or fixture document is available"
              );
              continue;
            }
            await runStep(`${direction}-S9-evidence-panel`, async () =>
              runS9(page, direction, baseDocumentId, `cari-smoke-${runToken}`)
            );
          }
          break;
        }
        case "S10": {
          for (const direction of SELECTED_DIRECTIONS) {
            const baseDocumentId = resolveBaseDocumentId(direction);
            if (!baseDocumentId) {
              pushSkipped(
                `${direction}-S10-ops-status`,
                "No created or fixture document is available"
              );
              continue;
            }
            await runStep(`${direction}-S10-ops-status`, async () =>
              runS10(page, direction, baseDocumentId, `cari-smoke-${runToken}`)
            );
          }
          break;
        }
        case "S11": {
          const apCreateResult = createResultsByDirection.AP;
          if (!apCreateResult?.quickCreateSeed) {
            pushSkipped(
              "AP-S11-quick-create-from-create",
              "AP create draft did not capture create-side quick-create seed"
            );
          } else {
            results.push({
              name: "AP-S11-quick-create-from-create",
              status: "ok",
              url: page.url(),
              scope: "create",
              ...apCreateResult.quickCreateSeed,
            });
          }

          if (!apCreateResult?.documentId) {
            pushSkipped("AP-S11-quick-create-from-edit", "AP draft was not created");
          } else {
            await runStep("AP-S11-quick-create-from-edit", async () => {
              await gotoRoute(page, `${routeForDirection("AP")}?documentId=${apCreateResult.documentId}`);
              const editForm = formByButton(
                page,
                /Update Draft Document|Taslak Belgeyi Guncelle/i
              );
              await editForm.waitFor({ state: "visible", timeout: WAIT_MS });
              return exerciseQuickCreateModal(
                page,
                editForm,
                "edit",
                `cari-smoke-${runToken}`
              );
            });
          }
          break;
        }
        case "S12": {
          for (const direction of SELECTED_DIRECTIONS) {
            await runStep(`${direction}-S12-inline-counterparty-create-form`, async () =>
              runS12CreateInline(
                page,
                direction,
                `cari-smoke-s12-create-${runToken}`,
                fixtureReport
              )
            );

            const baseDocumentId = resolveBaseDocumentId(direction);
            if (!baseDocumentId) {
              pushSkipped(
                `${direction}-S12-inline-counterparty-edit-form`,
                "No created or fixture draft document is available"
              );
            } else {
              await runStep(`${direction}-S12-inline-counterparty-edit-form`, async () =>
                runS12EditInline(
                  page,
                  direction,
                  baseDocumentId,
                  `cari-smoke-s12-edit-${runToken}`
                )
              );
            }
          }
          break;
        }
        case "S13": {
          const s13Result = await runStep("AP-S13-charge-allocation", async () =>
            runS13(page, `cari-smoke-s13-${runToken}`, fixtureReport)
          );
          if (s13Result?.documentId) {
            createdDrafts.push({
              direction: "AP",
              documentId: s13Result.documentId,
            });
          }
          break;
        }
        case "S14": {
          for (const direction of SELECTED_DIRECTIONS) {
            const baseDocumentId = resolveBaseDocumentId(direction);
            if (!baseDocumentId) {
              pushSkipped(
                `${direction}-S14-url-deep-link`,
                "No created or fixture document is available"
              );
              continue;
            }
            await runStep(`${direction}-S14-url-deep-link`, async () =>
              runS14(page, direction, baseDocumentId, fixtureReport)
            );
          }
          break;
        }
        case "S15": {
          if (!SELECTED_DIRECTIONS.includes("AR")) {
            pushSkipped(
              "AR-S15-fixed-asset-sale-prefill",
              "S15 is AR-only and AR direction is not selected"
            );
            break;
          }
          if (!fixtureReport?.fixedAssets?.activeAsset?.id) {
            pushSkipped(
              "AR-S15-fixed-asset-sale-prefill",
              "Fixture seed did not provide an active fixed asset"
            );
            break;
          }
          await runStep("AR-S15-fixed-asset-sale-prefill", async () =>
            runS15(page, fixtureReport)
          );
          break;
        }
        case "S16": {
          for (const direction of SELECTED_DIRECTIONS) {
            await runStep(`${direction}-S16-clone-selected`, async () =>
              runS16CloneSelected(
                page,
                direction,
                `cari-smoke-s16-clone-${runToken}`,
                fixtureReport
              )
            );
            await runStep(`${direction}-S16-cancel-and-copy`, async () =>
              runS16CancelAndCopy(
                page,
                direction,
                `cari-smoke-s16-cancel-copy-${runToken}`,
                fixtureReport
              )
            );
            await runStep(`${direction}-S16-reverse-and-copy`, async () =>
              runS16ReverseAndCopy(
                page,
                direction,
                `cari-smoke-s16-reverse-copy-${runToken}`,
                fixtureReport
              )
            );
          }
          break;
        }
        default:
          break;
      }
    }

    if (CLEANUP) {
      for (const draft of createdDrafts) {
        const cleanupResult = await runStep(
          `cleanup-${draft.direction}-${draft.documentId}`,
          async () => cleanupDraft(page, draft.direction, draft.documentId)
        );
        if (cleanupResult) {
          cleanupResults.push(cleanupResult);
        }
      }
    }
  } finally {
    await browser.close().catch(() => null);
  }

  const failed = results.filter((row) => row.status === "failed").length;
  const skipped = results.filter((row) => row.status === "skipped").length;
  const report = {
    generatedAt: new Date().toISOString(),
    status: failed === 0 ? "ok" : "failed",
    baseUrl: BASE_URL,
    loginEmail: LOGIN_EMAIL,
    fixtureBootstrapEnabled: BOOTSTRAP_FIXTURES,
    fixtureBootstrap,
    fixtureReportPath: FIXTURE_REPORT_PATH,
    fixtureSummary: fixtureReport
      ? {
          status: fixtureReport?.status || null,
          legalEntityCode: fixtureReport?.legalEntity?.code || null,
          customerCode: fixtureReport?.counterparties?.customer?.code || null,
          vendorCode: fixtureReport?.counterparties?.vendor?.code || null,
          apDraftId: fixtureReport?.documents?.apDraft?.id || null,
          arDraftId: fixtureReport?.documents?.arDraft?.id || null,
        }
      : null,
    headless: HEADLESS,
    selectedSteps: SELECTED_STEPS,
    selectedDirections: SELECTED_DIRECTIONS,
    cleanupEnabled: CLEANUP,
    artifactsDir: artifactDir,
    results,
    cleanupResults,
    consoleErrors: consoleErrors.slice(0, 50),
    pageErrors: pageErrors.slice(0, 20),
    summary: {
      total: results.length,
      passed: results.filter((row) => row.status === "ok").length,
      failed,
      skipped,
    },
  };

  await buildReport(REPORT_PATH, report);
  console.log(JSON.stringify({ ok: failed === 0, reportPath: REPORT_PATH, summary: report.summary }, null, 2));
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  const report = {
    generatedAt: new Date().toISOString(),
    status: "failed",
    baseUrl: BASE_URL,
    loginEmail: LOGIN_EMAIL,
    headless: HEADLESS,
    selectedSteps: SELECTED_STEPS,
    selectedDirections: SELECTED_DIRECTIONS,
    cleanupEnabled: CLEANUP,
    error: error?.stack || error?.message || String(error),
  };
  await buildReport(REPORT_PATH, report);
  console.error(error);
  process.exitCode = 1;
});
