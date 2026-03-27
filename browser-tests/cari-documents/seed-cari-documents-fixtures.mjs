/**
 * CARI documents fixture seed for the live tenant.
 *
 * Reset-safe bootstrap goals:
 *   - ensure a dedicated smoke group company exists
 *   - ensure a dedicated smoke legal entity exists
 *   - ensure default GL/bootstrap artifacts exist for that legal entity
 *   - ensure a dedicated smoke operating unit exists
 *   - ensure a dedicated smoke payment term exists
 *   - ensure a dedicated smoke customer exists
 *   - ensure a dedicated smoke vendor exists
 *   - ensure one AP draft invoice exists
 *   - ensure one AR draft invoice exists
 *
 * Runtime overrides:
 *   CARI_DOCS_FIXTURE_API_URL
 *   CARI_DOCS_FIXTURE_EMAIL
 *   CARI_DOCS_FIXTURE_PASSWORD
 *   CARI_DOCS_FIXTURE_GROUP_CODE
 *   CARI_DOCS_FIXTURE_LEGAL_ENTITY_CODE
 *   CARI_DOCS_FIXTURE_OU_CODE
 *   CARI_DOCS_FIXTURE_PAYMENT_TERM_CODE
 *   CARI_DOCS_FIXTURE_COUNTRY_CODE
 *   CARI_DOCS_FIXTURE_CURRENCY_CODE
 *   CARI_DOCS_FIXTURE_AP_AMOUNT
 *   CARI_DOCS_FIXTURE_AR_AMOUNT
 */

import path from "node:path";
import {
  API_URL as SHARED_API_URL,
  resolveFixtureDir,
  timestampToken,
  ensureDir,
  writeJson,
} from "../shared/pou36.browser-utils.mjs";

const FIXTURE_DIR = resolveFixtureDir(import.meta.url);
const ARTIFACT_ROOT = path.join(FIXTURE_DIR, "artifacts");
const REPORT_PATH = path.join(FIXTURE_DIR, "cari-documents-fixtures-report.json");

const API_URL =
  process.env.CARI_DOCS_FIXTURE_API_URL || SHARED_API_URL || "http://localhost:3000";
const LOGIN_EMAIL =
  process.env.CARI_DOCS_FIXTURE_EMAIL
  || process.env.CARI_DOCS_SMOKE_EMAIL
  || "tmv@gmail.com";
const LOGIN_PASSWORD =
  process.env.CARI_DOCS_FIXTURE_PASSWORD
  || process.env.CARI_DOCS_SMOKE_PASSWORD
  || "12121212";

const SMOKE_GROUP_CODE = normalizeUpperText(
  process.env.CARI_DOCS_FIXTURE_GROUP_CODE || "SMOKE_GRP"
);
const SMOKE_GROUP_NAME = "Smoke Group";
const SMOKE_LEGAL_ENTITY_CODE = normalizeUpperText(
  process.env.CARI_DOCS_FIXTURE_LEGAL_ENTITY_CODE || "SMOKE_CARI_LE"
);
const SMOKE_LEGAL_ENTITY_NAME = "Smoke Cari Legal Entity";
const SMOKE_OPERATING_UNIT_CODE = normalizeUpperText(
  process.env.CARI_DOCS_FIXTURE_OU_CODE || "SMOKE_OU"
);
const SMOKE_OPERATING_UNIT_NAME = "Smoke Operating Unit";
const SMOKE_PAYMENT_TERM_CODE = normalizeUpperText(
  process.env.CARI_DOCS_FIXTURE_PAYMENT_TERM_CODE || "SMOKE_NET_15"
);
const SMOKE_PAYMENT_TERM_NAME = "Smoke Net 15";
const PREFERRED_COUNTRY_CODE = normalizeUpperText(
  process.env.CARI_DOCS_FIXTURE_COUNTRY_CODE || "AF"
);
const PREFERRED_CURRENCY_CODE = normalizeUpperText(
  process.env.CARI_DOCS_FIXTURE_CURRENCY_CODE || "AFN"
);

const AP_FIXTURE_AMOUNT = parseAmountEnv(process.env.CARI_DOCS_FIXTURE_AP_AMOUNT, 111.11);
const AR_FIXTURE_AMOUNT = parseAmountEnv(process.env.CARI_DOCS_FIXTURE_AR_AMOUNT, 222.22);

const FIXTURE_PREFIX = "CARI SMOKE";
const CUSTOMER_FIXTURE_CODE = "SMOKE_CUSTOMER";
const VENDOR_FIXTURE_CODE = "SMOKE_VENDOR";
const CUSTOMER_FIXTURE_NAME = "Smoke Customer";
const VENDOR_FIXTURE_NAME = "Smoke Vendor";
const WAREHOUSE_FIXTURE_CODE = "SMOKE_WH";
const WAREHOUSE_FIXTURE_NAME = "Smoke Warehouse";
const ITEM_CARD_FIXTURE_CODE = "SMOKE_STOCK_ITEM";
const ITEM_CARD_FIXTURE_NAME = "Smoke Stock Item";
const FIXED_ASSET_PROFILE_CODE = "SMOKE_FA_SL";
const FIXED_ASSET_PROFILE_NAME = "Smoke Straight Line";
const FIXED_ASSET_CATEGORY_CODE = "SMOKE_FA_CAT";
const FIXED_ASSET_CATEGORY_NAME = "Smoke Asset Category";
const FIXED_ASSET_DRAFT_NAME = "Smoke Draft Asset";
const FIXED_ASSET_ACTIVE_NAME = "Smoke Active Asset";
const FIXED_ASSET_ACTIVE_TAG = "SMOKE-ACTIVE-001";
const AP_DRAFT_DESCRIPTION = `${FIXTURE_PREFIX} AP DRAFT`;
const AR_DRAFT_DESCRIPTION = `${FIXTURE_PREFIX} AR DRAFT`;
const FIXED_ASSET_DRAFT_COST = 333.33;
const FIXED_ASSET_ACTIVE_COST = 444.44;
const CARI_PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
  "CARI_SETTLEMENT_FX_GAIN",
  "CARI_SETTLEMENT_FX_LOSS",
  "CARI_AR_CONTROL_CASH",
  "CARI_AR_OFFSET_CASH",
  "CARI_AP_CONTROL_CASH",
  "CARI_AP_OFFSET_CASH",
  "CARI_AR_CONTROL_MANUAL",
  "CARI_AR_OFFSET_MANUAL",
  "CARI_AP_CONTROL_MANUAL",
  "CARI_AP_OFFSET_MANUAL",
  "CARI_AR_CONTROL_ON_ACCOUNT",
  "CARI_AR_OFFSET_ON_ACCOUNT",
  "CARI_AP_CONTROL_ON_ACCOUNT",
  "CARI_AP_OFFSET_ON_ACCOUNT",
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAmountEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundAmount(parsed) : fallback;
}

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function isTruthyFlag(value) {
  return value === true || Number(value) === 1;
}

function isActiveRow(row) {
  return normalizeUpperText(row?.status) === "ACTIVE";
}

function isPostingAllowed(row) {
  return isTruthyFlag(row?.allowPosting) || isTruthyFlag(row?.allow_posting);
}

function addDays(dateText, days) {
  const next = new Date(`${String(dateText).slice(0, 10)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAccountType(row) {
  return normalizeUpperText(row?.accountType || row?.account_type);
}

function normalizeNormalSide(row) {
  return normalizeUpperText(row?.normalSide || row?.normal_side);
}

function normalizeCountryCode(row) {
  return normalizeUpperText(row?.iso2 || row?.iso3 || row?.code);
}

function normalizeCurrencyCode(row) {
  return normalizeUpperText(row?.code || row?.currencyCode || row?.currency_code);
}

function normalizeGroupCode(row) {
  return normalizeUpperText(row?.code || row?.groupCompanyCode || row?.group_company_code);
}

function normalizeLegalEntityCode(row) {
  return normalizeUpperText(row?.code || row?.legalEntityCode || row?.legal_entity_code);
}

function normalizeOperatingUnitCode(row) {
  return normalizeUpperText(row?.code || row?.operatingUnitCode || row?.operating_unit_code);
}

function normalizeCounterpartyCode(row) {
  return normalizeUpperText(row?.code || row?.counterpartyCode || row?.counterparty_code);
}

function normalizeRowCode(row) {
  return normalizeUpperText(row?.code);
}

function normalizeAssetName(row) {
  return normalizeText(row?.name);
}

function normalizeAssetStatus(row) {
  return normalizeUpperText(row?.status);
}

function prefersCode(row, codes = []) {
  const normalized = normalizeUpperText(row?.code);
  return codes.some((code) => normalized === normalizeUpperText(code));
}

function prefersPrefix(row, prefixes = []) {
  const normalized = normalizeUpperText(row?.code);
  return prefixes.some((prefix) => normalized.startsWith(normalizeUpperText(prefix)));
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const finalHeaders = {
    Accept: "application/json",
    ...headers,
  };
  let payloadBody = body;
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    payloadBody = JSON.stringify(body);
  }
  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: payloadBody,
  });
  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText ? { raw: rawText } : null;
  }
  if (!response.ok) {
    const message =
      normalizeText(payload?.message)
      || `HTTP ${response.status} ${response.statusText} for ${method} ${url}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function login() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    }),
  });
  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText ? { raw: rawText } : null;
  }
  if (!response.ok) {
    throw new Error(
      normalizeText(payload?.message) || `Login failed with status ${response.status}`
    );
  }
  const cookie = String(response.headers.get("set-cookie") || "")
    .split(";")[0]
    .trim();
  if (!cookie) {
    throw new Error("Auth login succeeded but no auth cookie was returned.");
  }
  return cookie;
}

async function apiGet(cookie, pathName) {
  return fetchJson(`${API_URL}${pathName}`, {
    headers: {
      Cookie: cookie,
    },
  });
}

async function apiPost(cookie, pathName, body) {
  return fetchJson(`${API_URL}${pathName}`, {
    method: "POST",
    headers: {
      Cookie: cookie,
    },
    body,
  });
}

async function apiPut(cookie, pathName, body) {
  return fetchJson(`${API_URL}${pathName}`, {
    method: "PUT",
    headers: {
      Cookie: cookie,
    },
    body,
  });
}

async function listJournalPurposeAccounts(cookie, legalEntityId, moduleKey = "CARI") {
  return apiGet(
    cookie,
    `/api/v1/gl/journal-purpose-accounts?legalEntityId=${parsePositiveInt(legalEntityId)}&moduleKey=${normalizeUpperText(moduleKey)}`
  );
}

async function upsertJournalPurposeAccount(cookie, {
  legalEntityId,
  purposeCode,
  accountId,
  moduleKey = "CARI",
}) {
  return apiPost(cookie, "/api/v1/gl/journal-purpose-accounts", {
    legalEntityId: parsePositiveInt(legalEntityId),
    purposeCode: normalizeUpperText(purposeCode),
    accountId: parsePositiveInt(accountId),
    moduleKey: normalizeUpperText(moduleKey),
  });
}

function unwrapApiRow(payload) {
  return payload?.row || payload || null;
}

async function getDocumentDetail(cookie, documentId) {
  const payload = await apiGet(cookie, `/api/v1/cari/documents/${documentId}`);
  return payload?.row || null;
}

async function listFixedAssetsByStatuses(cookie, legalEntityId, statuses = []) {
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!normalizedLegalEntityId) {
    return [];
  }
  const normalizedStatuses = Array.from(
    new Set((statuses || []).map((status) => normalizeUpperText(status)).filter(Boolean))
  );
  if (normalizedStatuses.length <= 0) {
    return [];
  }
  const responses = await Promise.all(
    normalizedStatuses.map((status) =>
      apiGet(cookie, `/api/v1/fixed-assets?legalEntityId=${normalizedLegalEntityId}&status=${status}`)
    )
  );
  const merged = new Map();
  responses.forEach((response) => {
    (Array.isArray(response?.rows) ? response.rows : []).forEach((row) => {
      const id = parsePositiveInt(row?.id);
      if (id && !merged.has(id)) {
        merged.set(id, row);
      }
    });
  });
  return [...merged.values()];
}

function chooseCountry(rows = []) {
  const exact = rows.find((row) => {
    const code = normalizeCountryCode(row);
    return code === PREFERRED_COUNTRY_CODE || code === `${PREFERRED_COUNTRY_CODE}G`;
  });
  if (exact) {
    return exact;
  }
  const af = rows.find((row) => ["AF", "AFG"].includes(normalizeCountryCode(row)));
  if (af) {
    return af;
  }
  const us = rows.find((row) => ["US", "USA"].includes(normalizeCountryCode(row)));
  if (us) {
    return us;
  }
  return rows[0] || null;
}

function chooseCurrency(rows = [], preferredCode = "") {
  const preferred = normalizeUpperText(preferredCode) || PREFERRED_CURRENCY_CODE;
  const exact = rows.find((row) => normalizeCurrencyCode(row) === preferred);
  if (exact) {
    return exact;
  }
  const usd = rows.find((row) => normalizeCurrencyCode(row) === "USD");
  if (usd) {
    return usd;
  }
  return rows[0] || null;
}

function choosePaymentTerm(rows = []) {
  const activeRows = rows.filter(isActiveRow);
  const exact = activeRows.find(
    (row) => normalizeUpperText(row?.code) === SMOKE_PAYMENT_TERM_CODE
  );
  if (exact) {
    return exact;
  }
  return activeRows[0] || rows[0] || null;
}

function pickPostingAccount(rows = [], accountType, preferredCodes = [], preferredPrefixes = []) {
  const filtered = rows.filter(
    (row) => isPostingAllowed(row) && normalizeAccountType(row) === normalizeUpperText(accountType)
  );
  if (filtered.length <= 0) {
    return null;
  }
  const exactPreferred = filtered.find((row) => prefersCode(row, preferredCodes));
  if (exactPreferred) {
    return exactPreferred;
  }
  const prefixPreferred = filtered.find((row) => prefersPrefix(row, preferredPrefixes));
  if (prefixPreferred) {
    return prefixPreferred;
  }
  return filtered.sort((left, right) =>
    String(left?.code || "").localeCompare(String(right?.code || ""))
  )[0];
}

function listPostableAccountsByType(rows = [], accountType) {
  return rows
    .filter(
      (row) => isPostingAllowed(row) && normalizeAccountType(row) === normalizeUpperText(accountType)
    )
    .sort((left, right) =>
      String(left?.code || "").localeCompare(String(right?.code || ""))
    );
}

function buildCariPurposeAccountTargets({
  customerControlAccount,
  vendorControlAccount,
  apLinePostingAccount,
  arLinePostingAccount,
  assetOffsetAccount,
}) {
  return {
    CARI_AR_CONTROL: customerControlAccount,
    CARI_AR_OFFSET: arLinePostingAccount,
    CARI_AP_CONTROL: vendorControlAccount,
    CARI_AP_OFFSET: apLinePostingAccount,
    CARI_SETTLEMENT_FX_GAIN: arLinePostingAccount,
    CARI_SETTLEMENT_FX_LOSS: apLinePostingAccount,
    CARI_AR_CONTROL_CASH: customerControlAccount,
    CARI_AR_OFFSET_CASH: assetOffsetAccount,
    CARI_AP_CONTROL_CASH: vendorControlAccount,
    CARI_AP_OFFSET_CASH: assetOffsetAccount,
    CARI_AR_CONTROL_MANUAL: customerControlAccount,
    CARI_AR_OFFSET_MANUAL: assetOffsetAccount,
    CARI_AP_CONTROL_MANUAL: vendorControlAccount,
    CARI_AP_OFFSET_MANUAL: assetOffsetAccount,
    CARI_AR_CONTROL_ON_ACCOUNT: customerControlAccount,
    CARI_AR_OFFSET_ON_ACCOUNT: vendorControlAccount,
    CARI_AP_CONTROL_ON_ACCOUNT: vendorControlAccount,
    CARI_AP_OFFSET_ON_ACCOUNT: assetOffsetAccount,
  };
}

function summarizePurposeMapping(row, desiredAccountId = null) {
  return {
    purposeCode: normalizeUpperText(row?.purposeCode || row?.purpose_code),
    accountId: parsePositiveInt(row?.accountId || row?.account_id),
    accountCode: row?.accountCode || row?.account_code || null,
    accountName: row?.accountName || row?.account_name || null,
    validForPurposeMapping: Boolean(
      row?.validForPurposeMapping ?? row?.valid_for_purpose_mapping
    ),
    desiredAccountId: parsePositiveInt(desiredAccountId),
  };
}

async function ensureCariPurposeMappings({
  cookie,
  legalEntityId,
  desiredMappings,
}) {
  const initialResponse = await listJournalPurposeAccounts(cookie, legalEntityId, "CARI");
  const initialRows = Array.isArray(initialResponse?.rows) ? initialResponse.rows : [];
  const byPurposeCode = new Map(
    initialRows.map((row) => [normalizeUpperText(row?.purposeCode || row?.purpose_code), row])
  );

  const upsertedPurposeCodes = [];
  for (const purposeCode of CARI_PURPOSE_CODES) {
    const desiredAccount = desiredMappings?.[purposeCode] || null;
    const desiredAccountId = parsePositiveInt(desiredAccount?.id);
    if (!desiredAccountId) {
      throw new Error(`No account target resolved for ${purposeCode}.`);
    }
    const existingRow = byPurposeCode.get(purposeCode) || null;
    const existingAccountId = parsePositiveInt(existingRow?.accountId || existingRow?.account_id);
    const isValid = Boolean(
      existingRow?.validForPurposeMapping ?? existingRow?.valid_for_purpose_mapping
    );
    if (existingAccountId === desiredAccountId && isValid) {
      continue;
    }
    await upsertJournalPurposeAccount(cookie, {
      legalEntityId,
      purposeCode,
      accountId: desiredAccountId,
      moduleKey: "CARI",
    });
    upsertedPurposeCodes.push(purposeCode);
  }

  const refreshedResponse = await listJournalPurposeAccounts(cookie, legalEntityId, "CARI");
  const refreshedRows = Array.isArray(refreshedResponse?.rows) ? refreshedResponse.rows : [];
  return {
    rows: refreshedRows.map((row) =>
      summarizePurposeMapping(
        row,
        desiredMappings?.[normalizeUpperText(row?.purposeCode || row?.purpose_code)]?.id
      )
    ),
    source: upsertedPurposeCodes.length > 0 ? "upserted" : "existing",
    created: upsertedPurposeCodes.length > 0,
    upsertedPurposeCodes,
  };
}

async function ensureGroupCompany(cookie, existingRows = []) {
  const exact = existingRows.find((row) => normalizeGroupCode(row) === SMOKE_GROUP_CODE);
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }
  const response = await apiPost(cookie, "/api/v1/org/group-companies", {
    code: SMOKE_GROUP_CODE,
    name: SMOKE_GROUP_NAME,
  });
  return {
    row: {
      id: parsePositiveInt(response?.id),
      code: SMOKE_GROUP_CODE,
      name: SMOKE_GROUP_NAME,
    },
    source: "created",
    created: true,
  };
}

async function ensureLegalEntity({
  cookie,
  existingRows = [],
  groupCompany,
  countries = [],
  currencies = [],
}) {
  const preferredCountry = chooseCountry(countries);
  if (!preferredCountry?.id) {
    throw new Error("No country is available for legal-entity bootstrap.");
  }
  const defaultCurrencyCode = normalizeUpperText(preferredCountry?.defaultCurrencyCode || preferredCountry?.default_currency_code);
  const preferredCurrency = chooseCurrency(currencies, defaultCurrencyCode || PREFERRED_CURRENCY_CODE);
  if (!preferredCurrency?.code) {
    throw new Error("No currency is available for legal-entity bootstrap.");
  }

  const response = await apiPost(cookie, "/api/v1/org/legal-entities", {
    groupCompanyId: parsePositiveInt(groupCompany?.id),
    code: SMOKE_LEGAL_ENTITY_CODE,
    name: SMOKE_LEGAL_ENTITY_NAME,
    countryId: parsePositiveInt(preferredCountry?.id),
    functionalCurrencyCode: normalizeCurrencyCode(preferredCurrency),
    autoProvisionDefaults: true,
    paymentTerms: [
      {
        code: SMOKE_PAYMENT_TERM_CODE,
        name: SMOKE_PAYMENT_TERM_NAME,
        dueDays: 15,
        graceDays: 0,
        isEndOfMonth: false,
        status: "ACTIVE",
      },
    ],
  });

  const legalEntityRowsResponse = await apiGet(cookie, "/api/v1/org/legal-entities?limit=500&includeInactive=true");
  const legalEntityRows = Array.isArray(legalEntityRowsResponse?.rows)
    ? legalEntityRowsResponse.rows
    : existingRows;
  const exact = legalEntityRows.find(
    (row) => normalizeLegalEntityCode(row) === SMOKE_LEGAL_ENTITY_CODE
  );
  if (!exact?.id) {
    throw new Error("Smoke legal entity was not resolvable after upsert.");
  }
  return {
    row: exact,
    source: existingRows.some((row) => normalizeLegalEntityCode(row) === SMOKE_LEGAL_ENTITY_CODE)
      ? "upsert-existing"
      : "created",
    created: !existingRows.some((row) => normalizeLegalEntityCode(row) === SMOKE_LEGAL_ENTITY_CODE),
    provisioning: response?.provisioning || null,
    paymentTermsProvisioning: response?.paymentTermsProvisioning || null,
  };
}

async function ensureOperatingUnit({
  cookie,
  legalEntity,
  existingRows = [],
}) {
  const exactExisting = existingRows.find(
    (row) => normalizeOperatingUnitCode(row) === SMOKE_OPERATING_UNIT_CODE
  );
  if (exactExisting?.id) {
    return {
      row: exactExisting,
      source: "existing",
      created: false,
    };
  }

  await apiPost(cookie, "/api/v1/org/operating-units", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    code: SMOKE_OPERATING_UNIT_CODE,
    name: SMOKE_OPERATING_UNIT_NAME,
    unitType: "BRANCH",
    hasSubledger: false,
  });

  const rowsResponse = await apiGet(
    cookie,
    `/api/v1/org/operating-units?legalEntityId=${parsePositiveInt(legalEntity?.id)}&limit=500&includeInactive=true`
  );
  const rows = Array.isArray(rowsResponse?.rows) ? rowsResponse.rows : existingRows;
  const exact = rows.find((row) => normalizeOperatingUnitCode(row) === SMOKE_OPERATING_UNIT_CODE);
  if (!exact?.id) {
    throw new Error("Smoke operating unit was not resolvable after upsert.");
  }
  return {
    row: exact,
    source: "created",
    created: true,
  };
}

async function ensurePaymentTerm({
  cookie,
  legalEntity,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) => normalizeUpperText(row?.code) === SMOKE_PAYMENT_TERM_CODE && isActiveRow(row)
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }

  const response = await apiPost(cookie, "/api/v1/cari/payment-terms", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    code: SMOKE_PAYMENT_TERM_CODE,
    name: SMOKE_PAYMENT_TERM_NAME,
    dueDays: 15,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  });
  return {
    row: response?.row || null,
    source: "created",
    created: true,
  };
}

async function ensureWarehouse({
  cookie,
  legalEntity,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) => normalizeRowCode(row) === WAREHOUSE_FIXTURE_CODE && isActiveRow(row)
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }

  const response = await apiPost(cookie, "/api/v1/inventory/warehouses", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    ownershipScope: "CENTRAL",
    code: WAREHOUSE_FIXTURE_CODE,
    name: WAREHOUSE_FIXTURE_NAME,
    status: "ACTIVE",
  });
  return {
    row: unwrapApiRow(response),
    source: "created",
    created: true,
  };
}

async function ensureDepreciationProfile({
  cookie,
  legalEntity,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) => normalizeRowCode(row) === FIXED_ASSET_PROFILE_CODE && isActiveRow(row)
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }

  const response = await apiPost(cookie, "/api/v1/fixed-assets/depreciation-profiles", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    code: FIXED_ASSET_PROFILE_CODE,
    name: FIXED_ASSET_PROFILE_NAME,
    status: "ACTIVE",
    method: "STRAIGHT_LINE",
    switchToStraightLine: false,
  });
  return {
    row: unwrapApiRow(response),
    source: "created",
    created: true,
  };
}

async function ensureFixedAssetCategory({
  cookie,
  legalEntity,
  profile,
  accounts,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) => normalizeRowCode(row) === FIXED_ASSET_CATEGORY_CODE && isActiveRow(row)
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }

  const assetAccounts = listPostableAccountsByType(accounts, "ASSET");
  const expenseAccounts = listPostableAccountsByType(accounts, "EXPENSE");
  const revenueAccounts = listPostableAccountsByType(accounts, "REVENUE");

  const defaultAssetAccount =
    assetAccounts.find((row) => normalizeRowCode(row) === "1000") || assetAccounts[0] || null;
  const defaultAccumDeprAccount =
    assetAccounts.find(
      (row) =>
        parsePositiveInt(row?.id) !== parsePositiveInt(defaultAssetAccount?.id)
        && normalizeRowCode(row) === "1100"
    )
    || assetAccounts.find(
      (row) => parsePositiveInt(row?.id) !== parsePositiveInt(defaultAssetAccount?.id)
    )
    || defaultAssetAccount;
  const defaultExpenseAccount =
    expenseAccounts.find((row) => normalizeRowCode(row) === "5000") || expenseAccounts[0] || null;
  const defaultRevenueAccount =
    revenueAccounts.find((row) => normalizeRowCode(row) === "4000") || revenueAccounts[0] || null;

  if (!defaultAssetAccount?.id || !defaultAccumDeprAccount?.id) {
    throw new Error("No postable ASSET accounts are available for fixed-asset category defaults.");
  }
  if (!defaultExpenseAccount?.id) {
    throw new Error("No postable EXPENSE account is available for fixed-asset category defaults.");
  }
  if (!defaultRevenueAccount?.id) {
    throw new Error("No postable REVENUE account is available for fixed-asset category defaults.");
  }

  const response = await apiPost(cookie, "/api/v1/fixed-assets/categories", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    code: FIXED_ASSET_CATEGORY_CODE,
    name: FIXED_ASSET_CATEGORY_NAME,
    status: "ACTIVE",
    capitalizationThresholdBase: 0,
    defaultUsefulLifeMonths: 36,
    defaultSalvageRuleType: "NONE",
    defaultDepreciationProfileId: parsePositiveInt(profile?.id),
    defaultAssetAccountId: parsePositiveInt(defaultAssetAccount?.id),
    defaultAccumDeprAccountId: parsePositiveInt(defaultAccumDeprAccount?.id),
    defaultDeprExpenseAccountId: parsePositiveInt(defaultExpenseAccount?.id),
    defaultDisposalGainAccountId: parsePositiveInt(defaultRevenueAccount?.id),
    defaultDisposalLossAccountId: parsePositiveInt(defaultExpenseAccount?.id),
  });
  return {
    row: unwrapApiRow(response),
    source: "created",
    created: true,
  };
}

async function ensureItemCard({
  cookie,
  legalEntity,
  accounts,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) => normalizeRowCode(row) === ITEM_CARD_FIXTURE_CODE && isActiveRow(row)
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }

  const salesAccount = pickPostingAccount(accounts, "REVENUE", ["4000"], ["4000"]);
  const purchaseAccount = pickPostingAccount(accounts, "EXPENSE", ["5000"], ["5000"]);
  const inventoryAssetAccount = pickPostingAccount(accounts, "ASSET", ["1000", "1100"], ["1000", "1100"]);
  const inventoryTransitAccount = inventoryAssetAccount;
  const cogsAccount = purchaseAccount;

  if (!salesAccount?.id) {
    throw new Error("No postable REVENUE account is available for the stock item card.");
  }
  if (!purchaseAccount?.id) {
    throw new Error("No postable EXPENSE account is available for the stock item card.");
  }
  if (!inventoryAssetAccount?.id) {
    throw new Error("No postable ASSET account is available for the stock item card.");
  }

  const response = await apiPost(cookie, "/api/v1/items/cards", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    code: ITEM_CARD_FIXTURE_CODE,
    name: ITEM_CARD_FIXTURE_NAME,
    itemType: "STOCK_ITEM",
    defaultSalesAccountId: parsePositiveInt(salesAccount?.id),
    defaultPurchaseAccountId: parsePositiveInt(purchaseAccount?.id),
    inventoryAssetAccountId: parsePositiveInt(inventoryAssetAccount?.id),
    inventoryTransitAccountId: parsePositiveInt(inventoryTransitAccount?.id),
    defaultCogsAccountId: parsePositiveInt(cogsAccount?.id),
    status: "ACTIVE",
  });
  return {
    row: unwrapApiRow(response),
    source: "created",
    created: true,
  };
}

async function ensureCounterparty({
  cookie,
  legalEntity,
  operatingUnit,
  paymentTerm,
  currencyCode,
  counterparties,
  accounts,
  role,
}) {
  const exactCode = role === "CUSTOMER" ? CUSTOMER_FIXTURE_CODE : VENDOR_FIXTURE_CODE;
  const exactExisting = counterparties.find(
    (row) =>
      normalizeCounterpartyCode(row) === exactCode
      && isActiveRow(row)
      && (role === "CUSTOMER" ? isTruthyFlag(row?.isCustomer) : isTruthyFlag(row?.isVendor))
  );

  const counterpartyAccount =
    role === "CUSTOMER"
      ? pickPostingAccount(accounts, "ASSET", ["1100"], ["1100"])
      : pickPostingAccount(accounts, "LIABILITY", ["2000"], ["2000"]);
  if (!counterpartyAccount?.id) {
    throw new Error(
      `No postable ${role === "CUSTOMER" ? "ASSET" : "LIABILITY"} account found for ${role}.`
    );
  }
  const desiredCurrencyCode = normalizeUpperText(currencyCode);
  const desiredPaymentTermId = parsePositiveInt(paymentTerm?.id);
  const desiredOperatingUnitId = parsePositiveInt(operatingUnit?.id);
  const desiredMappedAccountId = parsePositiveInt(counterpartyAccount?.id);

  if (exactExisting?.id) {
    const currentCurrencyCode = normalizeUpperText(exactExisting?.defaultCurrencyCode);
    const currentPaymentTermId = parsePositiveInt(exactExisting?.defaultPaymentTermId);
    const currentOperatingUnitId = parsePositiveInt(exactExisting?.primaryOperatingUnitId);
    const currentMappedAccountId =
      role === "CUSTOMER"
        ? parsePositiveInt(exactExisting?.arAccountId)
        : parsePositiveInt(exactExisting?.apAccountId);
    const needsUpdate =
      currentCurrencyCode !== desiredCurrencyCode
      || currentPaymentTermId !== desiredPaymentTermId
      || currentOperatingUnitId !== desiredOperatingUnitId
      || currentMappedAccountId !== desiredMappedAccountId;
    if (!needsUpdate) {
      return {
        row: exactExisting,
        source: "existing",
        created: false,
      };
    }

    const response = await apiPut(
      cookie,
      `/api/v1/cari/counterparties/${parsePositiveInt(exactExisting?.id)}`,
      {
        rowVersion: parsePositiveInt(exactExisting?.rowVersion) || 1,
        defaultCurrencyCode: desiredCurrencyCode || undefined,
        defaultPaymentTermId: desiredPaymentTermId || undefined,
        primaryOperatingUnitId: desiredOperatingUnitId || undefined,
        arAccountId:
          role === "CUSTOMER" ? desiredMappedAccountId || undefined : undefined,
        apAccountId:
          role === "VENDOR" ? desiredMappedAccountId || undefined : undefined,
      }
    );
    return {
      row: unwrapApiRow(response),
      source: "updated",
      created: false,
    };
  }

  const response = await apiPost(cookie, "/api/v1/cari/counterparties", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    code: exactCode,
    name: role === "CUSTOMER" ? CUSTOMER_FIXTURE_NAME : VENDOR_FIXTURE_NAME,
    isCustomer: role === "CUSTOMER",
    isVendor: role === "VENDOR",
    status: "ACTIVE",
    defaultCurrencyCode: desiredCurrencyCode || undefined,
    defaultPaymentTermId: parsePositiveInt(paymentTerm?.id) || undefined,
    primaryOperatingUnitId: parsePositiveInt(operatingUnit?.id) || undefined,
    arAccountId:
      role === "CUSTOMER" ? parsePositiveInt(counterpartyAccount?.id) || undefined : undefined,
    apAccountId:
      role === "VENDOR" ? parsePositiveInt(counterpartyAccount?.id) || undefined : undefined,
  });
  return {
    row: response?.row || null,
    source: "created",
    created: true,
  };
}

function matchesDraftFixture(detailRow, { direction, description, amount, counterpartyId }) {
  if (!detailRow || parsePositiveInt(detailRow?.counterpartyId) !== parsePositiveInt(counterpartyId)) {
    return false;
  }
  if (normalizeUpperText(detailRow?.status) !== "DRAFT") {
    return false;
  }
  if (normalizeUpperText(detailRow?.direction) !== normalizeUpperText(direction)) {
    return false;
  }
  if (normalizeUpperText(detailRow?.documentType) !== "INVOICE") {
    return false;
  }
  if (roundAmount(detailRow?.amountTxn) !== roundAmount(amount)) {
    return false;
  }
  const firstLine = Array.isArray(detailRow?.lines) ? detailRow.lines[0] : null;
  return normalizeText(firstLine?.description) === normalizeText(description);
}

async function ensureDraftFixture({
  cookie,
  legalEntity,
  operatingUnit,
  paymentTerm,
  counterparty,
  direction,
  description,
  amount,
  currencyCode,
  postingAccount,
}) {
  const listResponse = await apiGet(
    cookie,
    `/api/v1/cari/documents?legalEntityId=${parsePositiveInt(legalEntity?.id)}`
      + `&counterpartyId=${parsePositiveInt(counterparty?.id)}`
      + `&direction=${normalizeUpperText(direction)}`
      + "&status=DRAFT"
      + "&limit=100"
  );
  const rows = Array.isArray(listResponse?.rows) ? listResponse.rows : [];
  for (const row of rows) {
    const detail = await getDocumentDetail(cookie, row?.id);
    if (
      matchesDraftFixture(detail, {
        direction,
        description,
        amount,
        counterpartyId: counterparty?.id,
      })
    ) {
      return {
        row: detail,
        source: "existing",
        created: false,
      };
    }
  }

  const documentDate = todayIso();
  const response = await apiPost(cookie, "/api/v1/cari/documents", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    operatingUnitId:
      parsePositiveInt(counterparty?.primaryOperatingUnitId)
      || parsePositiveInt(operatingUnit?.id)
      || undefined,
    counterpartyId: parsePositiveInt(counterparty?.id),
    paymentTermId:
      parsePositiveInt(counterparty?.defaultPaymentTermId)
      || parsePositiveInt(paymentTerm?.id)
      || undefined,
    direction: normalizeUpperText(direction),
    documentType: "INVOICE",
    documentDate,
    dueDate: addDays(documentDate, 15),
    currencyCode: normalizeUpperText(currencyCode),
    fxRate: 1,
    settlementMode: "ACCRUAL",
    lines: [
      {
        lineKind: "STANDARD",
        description,
        subledgerType: "NONE",
        stockImpactMode: "NONE",
        quantity: 1,
        unitPriceTxn: roundAmount(amount),
        lineNetAmountTxn: roundAmount(amount),
        lineTaxAmountTxn: 0,
        lineGrossAmountTxn: roundAmount(amount),
        postingAccountId: parsePositiveInt(postingAccount?.id),
      },
    ],
  });
  return {
    row: response?.row || null,
    source: "created",
    created: true,
  };
}

async function ensureFixedAssetDraft({
  cookie,
  legalEntity,
  operatingUnit,
  category,
  counterparty,
  currencyCode,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) =>
      normalizeAssetName(row) === normalizeText(FIXED_ASSET_DRAFT_NAME)
      && normalizeAssetStatus(row) === "DRAFT"
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
    };
  }

  const response = await apiPost(cookie, "/api/v1/fixed-assets", {
    legalEntityId: parsePositiveInt(legalEntity?.id),
    name: FIXED_ASSET_DRAFT_NAME,
    description: `${FIXTURE_PREFIX} draft fixed asset`,
    categoryId: parsePositiveInt(category?.id),
    acquisitionDate: todayIso(),
    currencyCode: normalizeUpperText(currencyCode),
    ownerOperatingUnitId: parsePositiveInt(operatingUnit?.id) || undefined,
    locationOperatingUnitId: parsePositiveInt(operatingUnit?.id) || undefined,
    counterpartyId: parsePositiveInt(counterparty?.id) || undefined,
    originalCostTxn: FIXED_ASSET_DRAFT_COST,
    originalCostBase: FIXED_ASSET_DRAFT_COST,
  });
  return {
    row: unwrapApiRow(response),
    source: "created",
    created: true,
  };
}

async function ensureFixedAssetActive({
  cookie,
  legalEntity,
  operatingUnit,
  category,
  counterparty,
  currencyCode,
  existingRows = [],
}) {
  const exact = existingRows.find(
    (row) =>
      normalizeAssetName(row) === normalizeText(FIXED_ASSET_ACTIVE_NAME)
      && ["ACTIVE", "SUSPENDED", "FULLY_DEPRECIATED"].includes(normalizeAssetStatus(row))
  );
  if (exact?.id) {
    return {
      row: exact,
      source: "existing",
      created: false,
      activated: false,
    };
  }

  const draftRows = await listFixedAssetsByStatuses(cookie, legalEntity?.id, ["DRAFT"]);
  let activationSource = draftRows.find(
    (row) =>
      normalizeAssetName(row) === normalizeText(FIXED_ASSET_ACTIVE_NAME)
      && normalizeAssetStatus(row) === "DRAFT"
  );

  let source = "activated-existing-draft";
  let created = false;
  if (!activationSource?.id) {
    const createResponse = await apiPost(cookie, "/api/v1/fixed-assets", {
      legalEntityId: parsePositiveInt(legalEntity?.id),
      name: FIXED_ASSET_ACTIVE_NAME,
      description: `${FIXTURE_PREFIX} active fixed asset`,
      assetTag: FIXED_ASSET_ACTIVE_TAG,
      categoryId: parsePositiveInt(category?.id),
      acquisitionDate: todayIso(),
      currencyCode: normalizeUpperText(currencyCode),
      ownerOperatingUnitId: parsePositiveInt(operatingUnit?.id) || undefined,
      locationOperatingUnitId: parsePositiveInt(operatingUnit?.id) || undefined,
      counterpartyId: parsePositiveInt(counterparty?.id) || undefined,
      originalCostTxn: FIXED_ASSET_ACTIVE_COST,
      originalCostBase: FIXED_ASSET_ACTIVE_COST,
    });
    activationSource = unwrapApiRow(createResponse);
    source = "created-and-activated";
    created = true;
  }

  if (!parsePositiveInt(activationSource?.id)) {
    throw new Error("Smoke active fixed asset could not be created or resolved for activation.");
  }

  const response = await apiPost(
    cookie,
    `/api/v1/fixed-assets/${parsePositiveInt(activationSource?.id)}/activate`,
    {
      postingDate: todayIso(),
      capitalizationDate: todayIso(),
      inServiceDate: todayIso(),
      assetTag: FIXED_ASSET_ACTIVE_TAG,
    }
  );
  return {
    row: unwrapApiRow(response),
    source,
    created,
    activated: true,
  };
}

function summarizeAccount(row) {
  return row
    ? {
        id: parsePositiveInt(row?.id),
        code: row?.code || null,
        name: row?.name || null,
        accountType: normalizeAccountType(row),
        normalSide: normalizeNormalSide(row),
      }
    : null;
}

function summarizeCounterpartyResult(result) {
  const row = result?.row || {};
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    id: parsePositiveInt(row?.id),
    code: row?.code || null,
    name: row?.name || null,
    isCustomer: Boolean(row?.isCustomer),
    isVendor: Boolean(row?.isVendor),
    defaultCurrencyCode: row?.defaultCurrencyCode || null,
    arAccountId: parsePositiveInt(row?.arAccountId),
    apAccountId: parsePositiveInt(row?.apAccountId),
    defaultPaymentTermId: parsePositiveInt(row?.defaultPaymentTermId),
    primaryOperatingUnitId: parsePositiveInt(row?.primaryOperatingUnitId),
  };
}

function summarizeDocumentResult(result) {
  const row = result?.row || {};
  const firstLine = Array.isArray(row?.lines) ? row.lines[0] : null;
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    id: parsePositiveInt(row?.id),
    documentNo: row?.documentNo || null,
    status: row?.status || null,
    direction: row?.direction || null,
    documentType: row?.documentType || null,
    counterpartyId: parsePositiveInt(row?.counterpartyId),
    paymentTermId: parsePositiveInt(row?.paymentTermId),
    operatingUnitId: parsePositiveInt(row?.operatingUnitId),
    amountTxn: roundAmount(row?.amountTxn),
    documentDate: row?.documentDate || null,
    dueDate: row?.dueDate || null,
    firstLineDescription: firstLine?.description || null,
    firstLinePostingAccountId: parsePositiveInt(firstLine?.postingAccountId),
  };
}

function summarizeWarehouseResult(result) {
  const row = result?.row || {};
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    id: parsePositiveInt(row?.id),
    code: row?.code || null,
    name: row?.name || null,
    ownershipScope: row?.ownershipScope || null,
    operatingUnitId: parsePositiveInt(row?.operatingUnitId),
    status: row?.status || null,
  };
}

function summarizeItemCardResult(result) {
  const row = result?.row || {};
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    id: parsePositiveInt(row?.id),
    code: row?.code || null,
    name: row?.name || null,
    itemType: row?.itemType || null,
    defaultSalesAccountId: parsePositiveInt(row?.defaultSalesAccountId),
    defaultPurchaseAccountId: parsePositiveInt(row?.defaultPurchaseAccountId),
    inventoryAssetAccountId: parsePositiveInt(row?.inventoryAssetAccountId),
    inventoryTransitAccountId: parsePositiveInt(row?.inventoryTransitAccountId),
    defaultCogsAccountId: parsePositiveInt(row?.defaultCogsAccountId),
    status: row?.status || null,
  };
}

function summarizeDepreciationProfileResult(result) {
  const row = result?.row || {};
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    id: parsePositiveInt(row?.id),
    code: row?.code || null,
    name: row?.name || null,
    method: row?.method || null,
    status: row?.status || null,
  };
}

function summarizeFixedAssetCategoryResult(result) {
  const row = result?.row || {};
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    id: parsePositiveInt(row?.id),
    code: row?.code || null,
    name: row?.name || null,
    defaultDepreciationProfileId: parsePositiveInt(row?.defaultDepreciationProfileId),
    defaultAssetAccountId: parsePositiveInt(row?.defaultAssetAccountId),
    defaultAccumDeprAccountId: parsePositiveInt(row?.defaultAccumDeprAccountId),
    defaultDeprExpenseAccountId: parsePositiveInt(row?.defaultDeprExpenseAccountId),
    defaultDisposalGainAccountId: parsePositiveInt(row?.defaultDisposalGainAccountId),
    defaultDisposalLossAccountId: parsePositiveInt(row?.defaultDisposalLossAccountId),
    status: row?.status || null,
  };
}

function summarizeFixedAssetResult(result) {
  const row = result?.row || {};
  return {
    source: result?.source || null,
    created: Boolean(result?.created),
    activated: Boolean(result?.activated),
    id: parsePositiveInt(row?.id),
    assetNo: row?.assetNo || null,
    assetTag: row?.assetTag || null,
    name: row?.name || null,
    status: row?.status || null,
    categoryId: parsePositiveInt(row?.categoryId),
    counterpartyId: parsePositiveInt(row?.counterpartyId),
    ownerOperatingUnitId: parsePositiveInt(row?.ownerOperatingUnitId),
    locationOperatingUnitId: parsePositiveInt(row?.locationOperatingUnitId),
    currencyCode: row?.currencyCode || null,
    originalCostTxn:
      row?.originalCostTxn !== undefined && row?.originalCostTxn !== null
        ? roundAmount(row?.originalCostTxn)
        : null,
    acquisitionDate: row?.acquisitionDate || null,
    capitalizationDate: row?.capitalizationDate || null,
    inServiceDate: row?.inServiceDate || null,
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
  const artifactDir = path.join(ARTIFACT_ROOT, `cari-docs-fixtures-${runToken}`);
  await ensureDir(artifactDir);

  const cookie = await login();

  const [
    groupCompanyResponse,
    countryResponse,
    currencyResponse,
    initialLegalEntityResponse,
  ] = await Promise.all([
    apiGet(cookie, "/api/v1/org/group-companies"),
    apiGet(cookie, "/api/v1/org/countries"),
    apiGet(cookie, "/api/v1/org/currencies"),
    apiGet(cookie, "/api/v1/org/legal-entities?limit=500&includeInactive=true"),
  ]);

  const groupCompanyRows = Array.isArray(groupCompanyResponse?.rows) ? groupCompanyResponse.rows : [];
  const countries = Array.isArray(countryResponse?.rows) ? countryResponse.rows : [];
  const currencies = Array.isArray(currencyResponse?.rows) ? currencyResponse.rows : [];
  const initialLegalEntityRows = Array.isArray(initialLegalEntityResponse?.rows)
    ? initialLegalEntityResponse.rows
    : [];

  const groupCompanyResult = await ensureGroupCompany(cookie, groupCompanyRows);
  const legalEntityResult = await ensureLegalEntity({
    cookie,
    existingRows: initialLegalEntityRows,
    groupCompany: groupCompanyResult.row,
    countries,
    currencies,
  });

  const legalEntity = legalEntityResult.row;
  const legalEntityId = parsePositiveInt(legalEntity?.id);
  const legalEntityCode = normalizeLegalEntityCode(legalEntity);
  const currencyCode = normalizeUpperText(
    legalEntity?.functionalCurrencyCode || legalEntity?.functional_currency_code
  );
  if (!legalEntityId || !currencyCode) {
    throw new Error("Smoke legal entity is missing id or functional currency.");
  }

  const [
    operatingUnitResponse,
    paymentTermResponse,
    counterpartyResponse,
    accountResponse,
    profileResponse,
    categoryResponse,
    warehouseResponse,
    itemCardResponse,
    draftAssetRows,
    eligibleActiveAssetRows,
  ] = await Promise.all([
    apiGet(
      cookie,
      `/api/v1/org/operating-units?legalEntityId=${legalEntityId}&limit=500&includeInactive=true`
    ),
    apiGet(cookie, `/api/v1/cari/payment-terms?legalEntityId=${legalEntityId}&limit=500`),
    apiGet(cookie, `/api/v1/cari/counterparties?legalEntityId=${legalEntityId}&limit=500`),
    apiGet(cookie, `/api/v1/gl/accounts?legalEntityId=${legalEntityId}&limit=1000&includeInactive=true`),
    apiGet(cookie, `/api/v1/fixed-assets/depreciation-profiles?legalEntityId=${legalEntityId}&status=ACTIVE`),
    apiGet(cookie, `/api/v1/fixed-assets/categories?legalEntityId=${legalEntityId}&status=ACTIVE`),
    apiGet(cookie, `/api/v1/inventory/warehouses?legalEntityId=${legalEntityId}&limit=500&offset=0`),
    apiGet(cookie, `/api/v1/items/cards?legalEntityId=${legalEntityId}&status=ACTIVE&limit=500&offset=0`),
    listFixedAssetsByStatuses(cookie, legalEntityId, ["DRAFT"]),
    listFixedAssetsByStatuses(cookie, legalEntityId, ["ACTIVE", "SUSPENDED", "FULLY_DEPRECIATED"]),
  ]);

  const operatingUnitRows = Array.isArray(operatingUnitResponse?.rows)
    ? operatingUnitResponse.rows
    : [];
  const paymentTermRows = Array.isArray(paymentTermResponse?.rows)
    ? paymentTermResponse.rows
    : [];
  const counterpartyRows = Array.isArray(counterpartyResponse?.rows)
    ? counterpartyResponse.rows
    : [];
  const accountRows = Array.isArray(accountResponse?.rows) ? accountResponse.rows : [];
  const profileRows = Array.isArray(profileResponse?.rows) ? profileResponse.rows : [];
  const categoryRows = Array.isArray(categoryResponse?.rows) ? categoryResponse.rows : [];
  const warehouseRows = Array.isArray(warehouseResponse?.rows) ? warehouseResponse.rows : [];
  const itemCardRows = Array.isArray(itemCardResponse?.rows) ? itemCardResponse.rows : [];

  const operatingUnitResult = await ensureOperatingUnit({
    cookie,
    legalEntity,
    existingRows: operatingUnitRows,
  });
  const paymentTermResult = await ensurePaymentTerm({
    cookie,
    legalEntity,
    existingRows: paymentTermRows,
  });
  const profileResult = await ensureDepreciationProfile({
    cookie,
    legalEntity,
    existingRows: profileRows,
  });
  const fixedAssetCategoryResult = await ensureFixedAssetCategory({
    cookie,
    legalEntity,
    profile: profileResult.row,
    accounts: accountRows,
    existingRows: categoryRows,
  });
  const warehouseResult = await ensureWarehouse({
    cookie,
    legalEntity,
    existingRows: warehouseRows,
  });
  const itemCardResult = await ensureItemCard({
    cookie,
    legalEntity,
    accounts: accountRows,
    existingRows: itemCardRows,
  });

  const refreshedCounterpartyResponse = await apiGet(
    cookie,
    `/api/v1/cari/counterparties?legalEntityId=${legalEntityId}&limit=500`
  );
  const refreshedCounterpartyRows = Array.isArray(refreshedCounterpartyResponse?.rows)
    ? refreshedCounterpartyResponse.rows
    : counterpartyRows;

  const paymentTerm = paymentTermResult.row || choosePaymentTerm(paymentTermRows);
  const operatingUnit = operatingUnitResult.row;

  const customerControlAccount = pickPostingAccount(accountRows, "ASSET", ["1100"], ["1100"]);
  const vendorControlAccount = pickPostingAccount(accountRows, "LIABILITY", ["2000"], ["2000"]);
  const apLinePostingAccount = pickPostingAccount(accountRows, "EXPENSE", ["5000"], ["5000"]);
  const arLinePostingAccount = pickPostingAccount(accountRows, "REVENUE", ["4000"], ["4000"]);
  const assetOffsetAccount = pickPostingAccount(accountRows, "ASSET", ["1000", "1100"], ["1000", "1100"]);

  if (!customerControlAccount?.id) {
    throw new Error(`No postable ASSET control account is available for legalEntityId=${legalEntityId}.`);
  }
  if (!vendorControlAccount?.id) {
    throw new Error(`No postable LIABILITY control account is available for legalEntityId=${legalEntityId}.`);
  }
  if (!apLinePostingAccount?.id) {
    throw new Error(`No postable EXPENSE account is available for legalEntityId=${legalEntityId}.`);
  }
  if (!arLinePostingAccount?.id) {
    throw new Error(`No postable REVENUE account is available for legalEntityId=${legalEntityId}.`);
  }
  if (!assetOffsetAccount?.id) {
    throw new Error(`No postable ASSET offset account is available for legalEntityId=${legalEntityId}.`);
  }

  const cariPurposeMappingsResult = await ensureCariPurposeMappings({
    cookie,
    legalEntityId,
    desiredMappings: buildCariPurposeAccountTargets({
      customerControlAccount,
      vendorControlAccount,
      apLinePostingAccount,
      arLinePostingAccount,
      assetOffsetAccount,
    }),
  });

  const customerResult = await ensureCounterparty({
    cookie,
    legalEntity,
    operatingUnit,
    paymentTerm,
    currencyCode,
    counterparties: refreshedCounterpartyRows,
    accounts: accountRows,
    role: "CUSTOMER",
  });

  const vendorResult = await ensureCounterparty({
    cookie,
    legalEntity,
    operatingUnit,
    paymentTerm,
    currencyCode,
    counterparties: refreshedCounterpartyRows,
    accounts: accountRows,
    role: "VENDOR",
  });
  const fixedAssetDraftResult = await ensureFixedAssetDraft({
    cookie,
    legalEntity,
    operatingUnit,
    category: fixedAssetCategoryResult.row,
    counterparty: vendorResult.row,
    currencyCode,
    existingRows: draftAssetRows,
  });
  const fixedAssetActiveResult = await ensureFixedAssetActive({
    cookie,
    legalEntity,
    operatingUnit,
    category: fixedAssetCategoryResult.row,
    counterparty: vendorResult.row,
    currencyCode,
    existingRows: eligibleActiveAssetRows,
  });

  const apDraftResult = await ensureDraftFixture({
    cookie,
    legalEntity,
    operatingUnit,
    paymentTerm,
    counterparty: vendorResult.row,
    direction: "AP",
    description: AP_DRAFT_DESCRIPTION,
    amount: AP_FIXTURE_AMOUNT,
    currencyCode,
    postingAccount: apLinePostingAccount,
  });

  const arDraftResult = await ensureDraftFixture({
    cookie,
    legalEntity,
    operatingUnit,
    paymentTerm,
    counterparty: customerResult.row,
    direction: "AR",
    description: AR_DRAFT_DESCRIPTION,
    amount: AR_FIXTURE_AMOUNT,
    currencyCode,
    postingAccount: arLinePostingAccount,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    status: "ok",
    apiUrl: API_URL,
    loginEmail: LOGIN_EMAIL,
    artifactsDir: artifactDir,
    bootstrap: {
      groupCompany: {
        source: groupCompanyResult.source,
        created: Boolean(groupCompanyResult.created),
      },
      legalEntity: {
        source: legalEntityResult.source,
        created: Boolean(legalEntityResult.created),
        provisioning: legalEntityResult.provisioning,
        paymentTermsProvisioning: legalEntityResult.paymentTermsProvisioning,
      },
      operatingUnit: {
        source: operatingUnitResult.source,
        created: Boolean(operatingUnitResult.created),
      },
      paymentTerm: {
        source: paymentTermResult.source,
        created: Boolean(paymentTermResult.created),
      },
      cariPurposeMappings: {
        source: cariPurposeMappingsResult.source,
        created: Boolean(cariPurposeMappingsResult.created),
        updatedCount: cariPurposeMappingsResult.upsertedPurposeCodes.length,
      },
      depreciationProfile: {
        source: profileResult.source,
        created: Boolean(profileResult.created),
      },
      fixedAssetCategory: {
        source: fixedAssetCategoryResult.source,
        created: Boolean(fixedAssetCategoryResult.created),
      },
      warehouse: {
        source: warehouseResult.source,
        created: Boolean(warehouseResult.created),
      },
      itemCard: {
        source: itemCardResult.source,
        created: Boolean(itemCardResult.created),
      },
      fixedAssetDraft: {
        source: fixedAssetDraftResult.source,
        created: Boolean(fixedAssetDraftResult.created),
      },
      fixedAssetActive: {
        source: fixedAssetActiveResult.source,
        created: Boolean(fixedAssetActiveResult.created),
        activated: Boolean(fixedAssetActiveResult.activated),
      },
    },
    groupCompany: {
      id: parsePositiveInt(groupCompanyResult?.row?.id),
      code: groupCompanyResult?.row?.code || null,
      name: groupCompanyResult?.row?.name || null,
    },
    legalEntity: {
      id: legalEntityId,
      code: legalEntityCode || null,
      name: legalEntity?.name || null,
      functionalCurrencyCode: currencyCode,
    },
    operatingUnit: {
      id: parsePositiveInt(operatingUnit?.id),
      code: operatingUnit?.code || null,
      name: operatingUnit?.name || null,
      status: operatingUnit?.status || null,
    },
    paymentTerm: {
      id: parsePositiveInt(paymentTerm?.id),
      code: paymentTerm?.code || null,
      name: paymentTerm?.name || null,
      status: paymentTerm?.status || null,
    },
    accountSelections: {
      customerControlAccount: summarizeAccount(customerControlAccount),
      vendorControlAccount: summarizeAccount(vendorControlAccount),
      apLinePostingAccount: summarizeAccount(apLinePostingAccount),
      arLinePostingAccount: summarizeAccount(arLinePostingAccount),
      assetOffsetAccount: summarizeAccount(assetOffsetAccount),
    },
    purposeMappings: {
      cari: cariPurposeMappingsResult.rows,
    },
    inventory: {
      warehouse: summarizeWarehouseResult(warehouseResult),
      itemCard: summarizeItemCardResult(itemCardResult),
    },
    fixedAssets: {
      depreciationProfile: summarizeDepreciationProfileResult(profileResult),
      category: summarizeFixedAssetCategoryResult(fixedAssetCategoryResult),
      draftAsset: summarizeFixedAssetResult(fixedAssetDraftResult),
      activeAsset: summarizeFixedAssetResult(fixedAssetActiveResult),
    },
    counterparties: {
      customer: summarizeCounterpartyResult(customerResult),
      vendor: summarizeCounterpartyResult(vendorResult),
    },
    documents: {
      apDraft: summarizeDocumentResult(apDraftResult),
      arDraft: summarizeDocumentResult(arDraftResult),
    },
  };

  await buildReport(REPORT_PATH, report);
  console.log(
    JSON.stringify(
      {
        ok: true,
        reportPath: REPORT_PATH,
        legalEntityId: report.legalEntity.id,
        customerId: report.counterparties.customer.id,
        vendorId: report.counterparties.vendor.id,
        warehouseId: report.inventory.warehouse.id,
        itemCardId: report.inventory.itemCard.id,
        fixedAssetCategoryId: report.fixedAssets.category.id,
        fixedAssetDraftId: report.fixedAssets.draftAsset.id,
        fixedAssetActiveId: report.fixedAssets.activeAsset.id,
        apDraftId: report.documents.apDraft.id,
        arDraftId: report.documents.arDraft.id,
      },
      null,
      2
    )
  );
}

main().catch(async (error) => {
  const report = {
    generatedAt: new Date().toISOString(),
    status: "failed",
    apiUrl: API_URL,
    loginEmail: LOGIN_EMAIL,
    error: error?.stack || error?.message || String(error),
  };
  await buildReport(REPORT_PATH, report);
  console.error(error);
  process.exitCode = 1;
});
