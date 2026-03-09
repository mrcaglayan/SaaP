import bcrypt from "bcrypt";
import { spawn } from "child_process";
import { once } from "events";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";
import { query } from "./db.js";
import { runMigrations } from "./migrationRunner.js";
import { seedCore } from "./seedCore.js";

const REQUIRED_REQUEST_IDS = Array.from({ length: 84 }, (_, index) => index + 1);

const DEFAULT_MARKDOWN_PATH = path.resolve(process.cwd(), "..", "hizlikurulum.md");
const DEFAULT_BASE_URL = String(process.env.STARTER_SEED_BASE_URL || "").trim() ||
  "http://localhost:3000";

const PAYMENT_TERM_NET_30 = "NET_30";
const SHAREHOLDER_PARENT_CAPITAL_CODE = "500";
const SHAREHOLDER_PARENT_COMMITMENT_CODE = "501";
const FX_CLEARANCE_PARENT_CODE = "108";
const CASH_PARENT_CODE = "100";
const BANK_PARENT_CODE = "102";
const AR_PARENT_CODE = "120";
const AP_PARENT_CODE = "320";
const CARI_OFFSET_ACCOUNT_CODE = "770";

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function ensureText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function extractBalancedJsonBlock(lines, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;
  const chunks = [];

  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    chunks.push(line);

    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const ch = line[charIndex];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
      }
    }

    if (started && depth === 0) {
      return {
        jsonText: chunks.join("\n"),
        nextIndex: lineIndex + 1,
      };
    }
  }

  throw new Error(`Unable to parse JSON block starting at line ${startIndex + 1}`);
}

function parseRequestBlocksFromMarkdown(content) {
  const lines = String(content || "").split(/\r?\n/);
  const requestByIndex = new Map();
  const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  let cursor = 0;
  while (cursor < lines.length) {
    const line = String(lines[cursor] || "").trim();
    let requestIndex = null;
    let requestUrl = "";

    let marker = line.match(/^(\d+)[-/]Request URL$/i);
    if (marker) {
      requestIndex = Number(marker[1]);
      cursor += 1;
      requestUrl = String(lines[cursor] || "").trim();
      cursor += 1;
    } else {
      marker = line.match(/^(\d+)-\s*(https?:\/\/\S+)$/i);
      if (marker) {
        requestIndex = Number(marker[1]);
        requestUrl = String(marker[2] || "").trim();
        cursor += 1;
      }
    }

    if (!requestIndex || !requestUrl) {
      cursor += 1;
      continue;
    }

    while (cursor < lines.length && String(lines[cursor] || "").trim() === "") {
      cursor += 1;
    }

    let method = "";
    const methodMarker = String(lines[cursor] || "").trim().toUpperCase();
    if (methodMarker === "REQUEST METHOD") {
      cursor += 1;
      method = String(lines[cursor] || "").trim().toUpperCase();
      cursor += 1;
    } else if (httpMethods.has(methodMarker)) {
      method = methodMarker;
      cursor += 1;
    } else {
      while (
        cursor < lines.length &&
        String(lines[cursor] || "").trim().toUpperCase() !== "REQUEST METHOD"
      ) {
        cursor += 1;
      }
      if (cursor >= lines.length) {
        break;
      }
      cursor += 1;
      method = String(lines[cursor] || "").trim().toUpperCase();
      cursor += 1;
    }

    while (cursor < lines.length && String(lines[cursor] || "").trim() === "") {
      cursor += 1;
    }

    let body = null;
    if (cursor < lines.length && String(lines[cursor] || "").trim().startsWith("{")) {
      const extracted = extractBalancedJsonBlock(lines, cursor);
      body = JSON.parse(extracted.jsonText);
      cursor = extracted.nextIndex;
    }

    requestByIndex.set(requestIndex, {
      index: requestIndex,
      url: requestUrl,
      method,
      body,
    });
  }

  return requestByIndex;
}

async function loadStarterRequests(markdownPath) {
  const raw = await readFile(markdownPath, "utf8");
  const requests = parseRequestBlocksFromMarkdown(raw);
  for (const index of REQUIRED_REQUEST_IDS) {
    if (!requests.has(index)) {
      throw new Error(`Unable to find request #${index} in ${markdownPath}`);
    }
  }
  return requests;
}

function getRequestBody(requests, index) {
  const block = requests.get(index);
  if (!block || !block.body || typeof block.body !== "object") {
    throw new Error(`Request #${index} body is missing or invalid`);
  }
  return deepClone(block.body);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { response, payload };
}

function isAliveStatus(statusCode) {
  return Number(statusCode) >= 200 && Number(statusCode) < 600;
}

async function isApiServerAlive(baseUrl) {
  try {
    const { response } = await fetchJson(`${baseUrl}/health`, {}, 2500);
    return isAliveStatus(response.status);
  } catch {
    return false;
  }
}

async function ensureApiServer(baseUrl) {
  if (await isApiServerAlive(baseUrl)) {
    return {
      startedByScript: false,
      stop: async () => {},
    };
  }

  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const parsedBase = new URL(baseUrl);
  const port = String(parsedBase.port || "3000");
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: port,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (text) {
      process.stdout.write(`[seed:starter][api] ${text}\n`);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (text) {
      process.stderr.write(`[seed:starter][api] ${text}\n`);
    }
  });

  const timeoutMs = 60000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited early with code ${child.exitCode}`);
    }
    if (await isApiServerAlive(baseUrl)) {
      return {
        startedByScript: true,
        stop: async () => {
          if (child.exitCode !== null) {
            return;
          }
          child.kill("SIGTERM");
          await Promise.race([
            once(child, "exit"),
            sleep(5000).then(() => {
              if (child.exitCode === null) {
                child.kill("SIGKILL");
              }
            }),
          ]);
        },
      };
    }
    await sleep(500);
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  throw new Error(`Timed out waiting for API server at ${baseUrl}`);
}

function extractErrorMessage(payload, fallback = "Request failed") {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.code === "string" && payload.code.trim()) {
    return payload.code.trim();
  }
  if (typeof payload.raw === "string" && payload.raw.trim()) {
    return payload.raw.trim();
  }
  return fallback;
}

async function requestJson({
  baseUrl,
  cookie,
  method,
  pathName,
  body = undefined,
  timeoutMs = 30000,
}) {
  const url = `${baseUrl}${pathName}`;
  const headers = {
    Accept: "application/json",
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const { response, payload } = await fetchJson(
    url,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs
  );

  if (!response.ok) {
    const message = extractErrorMessage(
      payload,
      `${method} ${pathName} failed with status ${response.status}`
    );
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function loginWithAdmin({ baseUrl, email, password }) {
  const { response, payload } = await fetchJson(
    `${baseUrl}/auth/login`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    },
    30000
  );

  if (!response.ok) {
    const message = extractErrorMessage(
      payload,
      `POST /auth/login failed with status ${response.status}`
    );
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const authCookie = String(response.headers.get("set-cookie") || "")
    .split(";")[0]
    .trim();
  if (!authCookie) {
    throw new Error("Auth login succeeded but no auth cookie was returned");
  }

  return authCookie;
}

async function queryOne(sql, params = [], errorMessage = "Record not found") {
  const result = await query(sql, params);
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error(errorMessage);
  }
  return row;
}

async function queryOptional(sql, params = []) {
  const result = await query(sql, params);
  return result.rows?.[0] || null;
}

async function ensureTenantAndAdmin(tenantPayload) {
  const tenantCode = ensureText(tenantPayload.tenantCode, "tenantCode").toUpperCase();
  const tenantName = ensureText(tenantPayload.tenantName, "tenantName");
  const adminName = ensureText(tenantPayload.adminName, "adminName");
  const adminEmail = ensureText(tenantPayload.adminEmail, "adminEmail").toLowerCase();
  const adminPassword = ensureText(tenantPayload.adminPassword, "adminPassword");

  await query(
    `INSERT INTO tenants (code, name, status)
     VALUES (?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       status = VALUES(status)`,
    [tenantCode, tenantName]
  );

  const tenantRow = await queryOne(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode],
    `Unable to resolve tenant by code: ${tenantCode}`
  );
  const tenantId = parsePositiveInt(tenantRow.id);
  if (!tenantId) {
    throw new Error(`Invalid tenant id for code: ${tenantCode}`);
  }

  await seedCore({
    ensureDefaultTenantIfMissing: false,
  });

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       tenant_id = VALUES(tenant_id),
       password_hash = VALUES(password_hash),
       name = VALUES(name),
       status = VALUES(status)`,
    [tenantId, adminEmail, passwordHash, adminName]
  );

  const userRow = await queryOne(
    `SELECT id
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [adminEmail],
    `Unable to resolve admin user by email: ${adminEmail}`
  );
  const userId = parsePositiveInt(userRow.id);
  if (!userId) {
    throw new Error(`Invalid user id for email: ${adminEmail}`);
  }

  const roleRow = await queryOne(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId],
    "TenantAdmin role not found for tenant"
  );
  const roleId = parsePositiveInt(roleRow.id);
  if (!roleId) {
    throw new Error("Invalid TenantAdmin role id");
  }

  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
     )
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE
       effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );

  return {
    tenantId,
    tenantCode,
    adminEmail,
    adminPassword,
    userId,
  };
}

async function findLegalEntityByCode(tenantId, code) {
  const row = await queryOne(
    `SELECT id, code, functional_currency_code, group_company_id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, toUpperText(code)],
    `Legal entity not found by code: ${code}`
  );
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || "").toUpperCase(),
    functionalCurrencyCode: toUpperText(row.functional_currency_code),
    groupCompanyId: parsePositiveInt(row.group_company_id),
  };
}

async function findCoaByCode(tenantId, code) {
  const row = await queryOne(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code || "").trim()],
    `CoA not found by code: ${code}`
  );
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
  };
}

async function findBookByCode(tenantId, code) {
  const row = await queryOne(
    `SELECT id, code, calendar_id
     FROM books
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code || "").trim()],
    `Book not found by code: ${code}`
  );
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    calendarId: parsePositiveInt(row.calendar_id),
  };
}

async function findFiscalCalendarByCode(tenantId, code) {
  const row = await queryOne(
    `SELECT id, code
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code || "").trim()],
    `Fiscal calendar not found by code: ${code}`
  );
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
  };
}

async function findFiscalPeriodId(calendarId, fiscalYear, periodNo) {
  const row = await queryOne(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND fiscal_year = ?
       AND period_no = ?
       AND is_adjustment = FALSE
     LIMIT 1`,
    [calendarId, fiscalYear, periodNo],
    `Fiscal period not found: calendarId=${calendarId}, year=${fiscalYear}, period=${periodNo}`
  );
  return parsePositiveInt(row.id);
}

async function findOperatingUnitId(tenantId, legalEntityId, code) {
  const row = await queryOne(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, toUpperText(code)],
    `Operating unit not found by code: ${code}`
  );
  return parsePositiveInt(row.id);
}

async function findAccountIdByCoaCode(tenantId, coaCode, accountCode) {
  const row = await queryOne(
    `SELECT a.id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.code = ?
       AND a.code = ?
     LIMIT 1`,
    [tenantId, String(coaCode || "").trim(), String(accountCode || "").trim()],
    `Account not found: coaCode=${coaCode}, accountCode=${accountCode}`
  );
  return parsePositiveInt(row.id);
}

async function findAccountIdByCoaId(coaId, accountCode) {
  const row = await queryOne(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, String(accountCode || "").trim()],
    `Account not found: coaId=${coaId}, accountCode=${accountCode}`
  );
  return parsePositiveInt(row.id);
}

async function findWorkflowDefinitionId(tenantId, code, versionNo) {
  const row = await queryOptional(
    `SELECT id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = ?
       AND version_no = ?
     LIMIT 1`,
    [tenantId, String(code || "").trim(), Number(versionNo || 1)]
  );
  return parsePositiveInt(row?.id);
}

async function findPaymentTermId(tenantId, legalEntityId, code) {
  const row = await queryOne(
    `SELECT id
     FROM payment_terms
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, String(code || "").trim()],
    `Payment term not found: ${code}`
  );
  return parsePositiveInt(row.id);
}

async function findShareholderByCode(tenantId, legalEntityId, code) {
  const row = await queryOne(
    `SELECT id, capital_sub_account_id, commitment_debit_sub_account_id
     FROM shareholders
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, String(code || "").trim().toUpperCase()],
    `Shareholder not found: legalEntityId=${legalEntityId}, code=${code}`
  );
  return {
    id: parsePositiveInt(row.id),
    capitalSubAccountId: parsePositiveInt(row.capital_sub_account_id),
    commitmentDebitSubAccountId: parsePositiveInt(row.commitment_debit_sub_account_id),
  };
}

async function findCounterpartyId(tenantId, legalEntityId, code) {
  const row = await queryOptional(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, String(code || "").trim().toUpperCase()]
  );
  return parsePositiveInt(row?.id);
}

async function findCashRegisterId(tenantId, code) {
  const row = await queryOptional(
    `SELECT id
     FROM cash_registers
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code || "").trim().toUpperCase()]
  );
  return parsePositiveInt(row?.id);
}

async function findBankAccountId(tenantId, legalEntityId, code) {
  const row = await queryOptional(
    `SELECT id
     FROM bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, String(code || "").trim().toUpperCase()]
  );
  return parsePositiveInt(row?.id);
}

async function findOpenCashSessionId(tenantId, registerId) {
  const row = await queryOptional(
    `SELECT id
     FROM cash_sessions
     WHERE tenant_id = ?
       AND cash_register_id = ?
       AND status = 'OPEN'
     LIMIT 1`,
    [tenantId, registerId]
  );
  return parsePositiveInt(row?.id);
}

async function findSettlementCashControlAccountId({
  tenantId,
  legalEntityId,
  direction,
}) {
  const normalizedDirection = String(direction || "").trim().toUpperCase();
  if (normalizedDirection !== "AP" && normalizedDirection !== "AR") {
    throw new Error(`Unsupported settlement direction: ${direction}`);
  }
  const prefix = normalizedDirection === "AP" ? "CARI_AP" : "CARI_AR";
  const purposeCandidates = [
    `${prefix}_CONTROL_CASH`,
    `${prefix}_CONTROL`,
    `${prefix}_CONTROL_MANUAL`,
  ];

  for (const purpose of purposeCandidates) {
    const row = await queryOptional(
      `SELECT a.id
       FROM journal_purpose_accounts jpa
       JOIN accounts a ON a.id = jpa.account_id
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE jpa.tenant_id = ?
         AND jpa.legal_entity_id = ?
         AND jpa.purpose_code = ?
         AND c.tenant_id = ?
         AND c.legal_entity_id = ?
         AND a.is_active = TRUE
         AND a.allow_posting = TRUE
       LIMIT 1`,
      [tenantId, legalEntityId, purpose, tenantId, legalEntityId]
    );
    const accountId = parsePositiveInt(row?.id);
    if (accountId) {
      return accountId;
    }
  }

  throw new Error(
    `Settlement cash control account not found for legalEntityId=${legalEntityId}, direction=${normalizedDirection}`
  );
}

async function hasOpenSession(tenantId, registerId) {
  const row = await queryOptional(
    `SELECT id
     FROM cash_sessions
     WHERE tenant_id = ?
       AND cash_register_id = ?
       AND status = 'OPEN'
     LIMIT 1`,
    [tenantId, registerId]
  );
  return Boolean(parsePositiveInt(row?.id));
}

function extractNestedId(value, fallback = null) {
  const parsed = parsePositiveInt(value);
  return parsed || fallback;
}

function extractAutoProvisionIds(payload, label) {
  const capitalSubAccountId = extractNestedId(
    payload?.capitalSubAccount?.id ?? payload?.capitalSubAccountId
  );
  const commitmentDebitSubAccountId = extractNestedId(
    payload?.commitmentDebitSubAccount?.id ??
      payload?.commitmentDebitSubAccountId
  );
  if (!capitalSubAccountId || !commitmentDebitSubAccountId) {
    throw new Error(`Unable to resolve sub-account ids for ${label}`);
  }
  return {
    capitalSubAccountId,
    commitmentDebitSubAccountId,
  };
}

function isAlreadyFullyJournaledSkipRow(row) {
  const skippedReason = String(row?.skipped_reason || row?.skippedReason || "")
    .trim()
    .toLowerCase();
  return skippedReason === "already fully journaled";
}

function hasNoJournalizableRowsValidation(payload) {
  const blockingErrors = Array.isArray(payload?.validation?.blocking_errors)
    ? payload.validation.blocking_errors
    : [];
  if (blockingErrors.length === 0) {
    return false;
  }
  return blockingErrors.every(
    (row) => String(row?.code || "").trim().toUpperCase() === "NO_JOURNALIZABLE_ROWS"
  );
}

function canSkipCommitmentBatchExecution(payload) {
  if (!hasNoJournalizableRowsValidation(payload)) {
    return false;
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length > 0) {
    return rows.every(isAlreadyFullyJournaledSkipRow);
  }
  const skipped = Array.isArray(payload?.skipped_shareholders)
    ? payload.skipped_shareholders
    : [];
  if (skipped.length > 0) {
    return skipped.every(isAlreadyFullyJournaledSkipRow);
  }
  return true;
}

async function ensureWorkflowDefinition({
  baseUrl,
  cookie,
  tenantId,
  payload,
}) {
  const existingId = await findWorkflowDefinitionId(
    tenantId,
    payload.code,
    payload.versionNo
  );
  if (existingId) {
    return existingId;
  }
  const response = await requestJson({
    baseUrl,
    cookie,
    method: "POST",
    pathName: "/api/v1/workflows/definitions",
    body: payload,
  });
  const createdId = parsePositiveInt(response?.row?.id);
  if (!createdId) {
    throw new Error(`Workflow definition id missing for code=${payload.code}`);
  }
  return createdId;
}

async function ensureCounterparty({
  baseUrl,
  cookie,
  tenantId,
  payload,
}) {
  const existingId = await findCounterpartyId(
    tenantId,
    payload.legalEntityId,
    payload.code
  );
  if (existingId) {
    return existingId;
  }

  const response = await requestJson({
    baseUrl,
    cookie,
    method: "POST",
    pathName: "/api/v1/cari/counterparties",
    body: payload,
  });
  const createdId = parsePositiveInt(response?.row?.id);
  if (!createdId) {
    throw new Error(`Counterparty id missing for code=${payload.code}`);
  }
  return createdId;
}

async function ensureOpenSession({
  baseUrl,
  cookie,
  tenantId,
  registerId,
  openingAmount = 0,
}) {
  if (await hasOpenSession(tenantId, registerId)) {
    return;
  }
  await requestJson({
    baseUrl,
    cookie,
    method: "POST",
    pathName: "/api/v1/cash/sessions/open",
    body: {
      registerId,
      openingAmount,
    },
  });
}

async function createCariDocument({
  baseUrl,
  cookie,
  payload,
  errorLabel,
}) {
  const response = await requestJson({
    baseUrl,
    cookie,
    method: "POST",
    pathName: "/api/v1/cari/documents",
    body: payload,
  });
  const documentId = parsePositiveInt(response?.row?.id);
  if (!documentId) {
    throw new Error(`Unable to resolve ${errorLabel} cari document id`);
  }
  return documentId;
}

async function postCariDocument({
  baseUrl,
  cookie,
  documentId,
  payload,
}) {
  await requestJson({
    baseUrl,
    cookie,
    method: "POST",
    pathName: `/api/v1/cari/documents/${documentId}/post`,
    body: payload,
  });
}

function info(message, details = null) {
  if (details) {
    console.log(`[seed:starter] ${message}`, details);
    return;
  }
  console.log(`[seed:starter] ${message}`);
}

export async function seedStarter(options = {}) {
  await runMigrations();

  const markdownPath = options.markdownPath || DEFAULT_MARKDOWN_PATH;
  info("Loading starter requests", { markdownPath });
  const requests = await loadStarterRequests(markdownPath);

  const tenantPayload = getRequestBody(requests, 1);
  const bootstrapPayload = getRequestBody(requests, 2);

  const tenantContext = await ensureTenantAndAdmin(tenantPayload);
  info("Tenant/admin ensured", {
    tenantCode: tenantContext.tenantCode,
    tenantId: tenantContext.tenantId,
    userId: tenantContext.userId,
  });

  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim();
  const apiServer = await ensureApiServer(baseUrl);
  info("API server ready", {
    baseUrl,
    startedByScript: apiServer.startedByScript,
  });

  try {
    const authCookie = await loginWithAdmin({
      baseUrl,
      email: tenantContext.adminEmail,
      password: tenantContext.adminPassword,
    });

    const legalEntityAConfig = bootstrapPayload?.legalEntities?.[0] || {};
    const legalEntityBConfig = bootstrapPayload?.legalEntities?.[1] || {};
    const legalEntityACode = toUpperText(legalEntityAConfig.code || "AFG");
    const legalEntityBCode = toUpperText(legalEntityBConfig.code || "PKR");
    const coaCodeA =
      String(legalEntityAConfig.coaCode || "").trim() || `COA-${legalEntityACode}`;
    const coaCodeB =
      String(legalEntityBConfig.coaCode || "").trim() || `COA-${legalEntityBCode}`;
    const bookCodeA =
      String(legalEntityAConfig.bookCode || "").trim() || `BOOK-${legalEntityACode}`;
    const bookCodeB =
      String(legalEntityBConfig.bookCode || "").trim() || `BOOK-${legalEntityBCode}`;
    const branchA1Code = toUpperText(legalEntityAConfig?.branches?.[0]?.code || "KEO");
    const branchA2Code = toUpperText(legalEntityAConfig?.branches?.[1]?.code || "MEO");
    const branchB1Code = toUpperText(legalEntityBConfig?.branches?.[0]?.code || "ISL");
    const fiscalCalendarCode =
      String(bootstrapPayload?.fiscalCalendar?.code || "").trim() || "MAIN";
    const fiscalYear = Number(bootstrapPayload?.fiscalYear || new Date().getFullYear());

    info("Applying company bootstrap");
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/onboarding/company-bootstrap",
      body: bootstrapPayload,
      timeoutMs: 120000,
    });

    const legalEntityA = await findLegalEntityByCode(
      tenantContext.tenantId,
      legalEntityACode
    );
    const legalEntityB = await findLegalEntityByCode(
      tenantContext.tenantId,
      legalEntityBCode
    );
    const coaA = await findCoaByCode(tenantContext.tenantId, coaCodeA);
    const coaB = await findCoaByCode(tenantContext.tenantId, coaCodeB);
    const bookA = await findBookByCode(tenantContext.tenantId, bookCodeA);
    const bookB = await findBookByCode(tenantContext.tenantId, bookCodeB);
    const fiscalCalendar = await findFiscalCalendarByCode(
      tenantContext.tenantId,
      fiscalCalendarCode
    );
    const fiscalPeriod03Id = await findFiscalPeriodId(fiscalCalendar.id, fiscalYear, 3);
    const fiscalPeriod12Id = await findFiscalPeriodId(fiscalCalendar.id, fiscalYear, 12);

    const operatingUnitA1Id = await findOperatingUnitId(
      tenantContext.tenantId,
      legalEntityA.id,
      branchA1Code
    );
    const operatingUnitA2Id = await findOperatingUnitId(
      tenantContext.tenantId,
      legalEntityA.id,
      branchA2Code
    );
    const operatingUnitB1Id = await findOperatingUnitId(
      tenantContext.tenantId,
      legalEntityB.id,
      branchB1Code
    );

    const workflowDefinitionPeriodPayload = getRequestBody(requests, 3);
    const workflowDefinitionConsolidationPayload = getRequestBody(requests, 4);
    const workflowDefinitionPeriodId = await ensureWorkflowDefinition({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      payload: workflowDefinitionPeriodPayload,
    });
    const workflowDefinitionConsolidationId = await ensureWorkflowDefinition({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      payload: workflowDefinitionConsolidationPayload,
    });

    const workflowStepsPeriodPayload = getRequestBody(requests, 5);
    const workflowStepsConsolidationPayload = getRequestBody(requests, 6);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/workflows/definitions/${workflowDefinitionPeriodId}/steps`,
      body: workflowStepsPeriodPayload,
    });
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/workflows/definitions/${workflowDefinitionConsolidationId}/steps`,
      body: workflowStepsConsolidationPayload,
    });

    const workflowAssignmentPeriodPayload = getRequestBody(requests, 7);
    workflowAssignmentPeriodPayload.workflowDefinitionId = workflowDefinitionPeriodId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/workflows/assignments",
      body: workflowAssignmentPeriodPayload,
    });

    const workflowAssignmentConsolidationPayload = getRequestBody(requests, 8);
    workflowAssignmentConsolidationPayload.workflowDefinitionId =
      workflowDefinitionConsolidationId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/workflows/assignments",
      body: workflowAssignmentConsolidationPayload,
    });

    const capitalParentAccountAId = await findAccountIdByCoaCode(
      tenantContext.tenantId,
      coaCodeA,
      SHAREHOLDER_PARENT_CAPITAL_CODE
    );
    const commitmentParentAccountAId = await findAccountIdByCoaCode(
      tenantContext.tenantId,
      coaCodeA,
      SHAREHOLDER_PARENT_COMMITMENT_CODE
    );
    const capitalParentAccountBId = await findAccountIdByCoaCode(
      tenantContext.tenantId,
      coaCodeB,
      SHAREHOLDER_PARENT_CAPITAL_CODE
    );
    const commitmentParentAccountBId = await findAccountIdByCoaCode(
      tenantContext.tenantId,
      coaCodeB,
      SHAREHOLDER_PARENT_COMMITMENT_CODE
    );

    const shareholderConfigA = getRequestBody(requests, 9);
    shareholderConfigA.legalEntityId = legalEntityA.id;
    shareholderConfigA.capitalCreditParentAccountId = capitalParentAccountAId;
    shareholderConfigA.commitmentDebitParentAccountId = commitmentParentAccountAId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholder-journal-config",
      body: shareholderConfigA,
    });

    const shareholderConfigB = getRequestBody(requests, 10);
    shareholderConfigB.legalEntityId = legalEntityB.id;
    shareholderConfigB.capitalCreditParentAccountId = capitalParentAccountBId;
    shareholderConfigB.commitmentDebitParentAccountId = commitmentParentAccountBId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholder-journal-config",
      body: shareholderConfigB,
    });

    const autoProvisionBPayload = getRequestBody(requests, 11);
    autoProvisionBPayload.legalEntityId = legalEntityB.id;
    const autoProvisionB = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholders/auto-provision-sub-accounts",
      body: autoProvisionBPayload,
    });
    const subAccountsB = extractAutoProvisionIds(autoProvisionB, legalEntityBCode);

    const autoProvisionAPayload = getRequestBody(requests, 12);
    autoProvisionAPayload.legalEntityId = legalEntityA.id;
    const autoProvisionA = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholders/auto-provision-sub-accounts",
      body: autoProvisionAPayload,
    });
    const subAccountsA = extractAutoProvisionIds(autoProvisionA, legalEntityACode);

    const shareholderPayloadA = getRequestBody(requests, 13);
    shareholderPayloadA.legalEntityId = legalEntityA.id;
    shareholderPayloadA.capitalSubAccountId = subAccountsA.capitalSubAccountId;
    shareholderPayloadA.commitmentDebitSubAccountId =
      subAccountsA.commitmentDebitSubAccountId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholders",
      body: shareholderPayloadA,
    });

    const shareholderPayloadB = deepClone(shareholderPayloadA);
    shareholderPayloadB.legalEntityId = legalEntityB.id;
    shareholderPayloadB.capitalSubAccountId = subAccountsB.capitalSubAccountId;
    shareholderPayloadB.commitmentDebitSubAccountId =
      subAccountsB.commitmentDebitSubAccountId;
    shareholderPayloadB.currencyCode = legalEntityB.functionalCurrencyCode || "PKR";
    shareholderPayloadB.committedCapital = 1500000;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholders",
      body: shareholderPayloadB,
    });

    const shareholderA = await findShareholderByCode(
      tenantContext.tenantId,
      legalEntityA.id,
      shareholderPayloadA.code
    );
    const shareholderB = await findShareholderByCode(
      tenantContext.tenantId,
      legalEntityB.id,
      shareholderPayloadB.code
    );

    const batchPreviewA = getRequestBody(requests, 14);
    batchPreviewA.legalEntityId = legalEntityA.id;
    batchPreviewA.shareholderIds = [shareholderA.id];
    const batchPreviewAResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholders/commitment-journal-batch/preview",
      body: batchPreviewA,
    });

    let batchJournalAId = null;
    if (!canSkipCommitmentBatchExecution(batchPreviewAResult)) {
      const batchExecuteA = getRequestBody(requests, 15);
      batchExecuteA.legalEntityId = legalEntityA.id;
      batchExecuteA.shareholderIds = [shareholderA.id];
      const batchExecuteAResult = await requestJson({
        baseUrl,
        cookie: authCookie,
        method: "POST",
        pathName: "/api/v1/org/shareholders/commitment-journal-batch",
        body: batchExecuteA,
      });
      batchJournalAId = parsePositiveInt(batchExecuteAResult?.journalEntryId);
      if (!batchJournalAId) {
        throw new Error("Unable to resolve batch journal id for legal entity A");
      }
    } else {
      info("Skipping LE A commitment batch execute: already fully journaled");
    }

    const mePreferencesPayload = getRequestBody(requests, 16);
    if (mePreferencesPayload?.workingContext) {
      mePreferencesPayload.workingContext.legalEntityId = String(legalEntityA.id);
      mePreferencesPayload.workingContext.fiscalCalendarId = String(fiscalCalendar.id);
      mePreferencesPayload.workingContext.fiscalPeriodId = String(fiscalPeriod12Id);
    }
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "PUT",
      pathName: "/me/preferences",
      body: mePreferencesPayload,
    });

    const batchPreviewB = getRequestBody(requests, 17);
    batchPreviewB.legalEntityId = legalEntityB.id;
    batchPreviewB.shareholderIds = [shareholderB.id];
    const batchPreviewBResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/org/shareholders/commitment-journal-batch/preview",
      body: batchPreviewB,
    });

    let batchJournalBId = null;
    if (!canSkipCommitmentBatchExecution(batchPreviewBResult)) {
      const batchExecuteB = getRequestBody(requests, 18);
      batchExecuteB.legalEntityId = legalEntityB.id;
      batchExecuteB.shareholderIds = [shareholderB.id];
      const batchExecuteBResult = await requestJson({
        baseUrl,
        cookie: authCookie,
        method: "POST",
        pathName: "/api/v1/org/shareholders/commitment-journal-batch",
        body: batchExecuteB,
      });
      batchJournalBId = parsePositiveInt(batchExecuteBResult?.journalEntryId);
      if (!batchJournalBId) {
        throw new Error("Unable to resolve batch journal id for legal entity B");
      }
    } else {
      info("Skipping LE B commitment batch execute: already fully journaled");
    }

    if (batchJournalAId) {
      const postBatchJournalA = getRequestBody(requests, 19);
      await requestJson({
        baseUrl,
        cookie: authCookie,
        method: "POST",
        pathName: `/api/v1/gl/journals/${batchJournalAId}/post`,
        body: postBatchJournalA,
      });
    }

    if (batchJournalBId) {
      const postBatchJournalB = getRequestBody(requests, 20);
      await requestJson({
        baseUrl,
        cookie: authCookie,
        method: "POST",
        pathName: `/api/v1/gl/journals/${batchJournalBId}/post`,
        body: postBatchJournalB,
      });
    }

    const createAfgCustomerAccount = getRequestBody(requests, 21);
    createAfgCustomerAccount.coaId = coaA.id;
    createAfgCustomerAccount.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      AR_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: createAfgCustomerAccount,
    });
    const afgCustomerAccountId = await findAccountIdByCoaId(
      coaA.id,
      createAfgCustomerAccount.code
    );

    const paymentTermAId = await findPaymentTermId(
      tenantContext.tenantId,
      legalEntityA.id,
      PAYMENT_TERM_NET_30
    );
    const paymentTermBId = await findPaymentTermId(
      tenantContext.tenantId,
      legalEntityB.id,
      PAYMENT_TERM_NET_30
    );

    const counterpartyAfgCustomer = getRequestBody(requests, 22);
    counterpartyAfgCustomer.legalEntityId = legalEntityA.id;
    counterpartyAfgCustomer.primaryOperatingUnitId = operatingUnitA1Id;
    counterpartyAfgCustomer.operatingUnitIds = [operatingUnitA1Id];
    counterpartyAfgCustomer.defaultPaymentTermId = paymentTermAId;
    counterpartyAfgCustomer.arAccountId = afgCustomerAccountId;
    counterpartyAfgCustomer.apAccountId = null;
    const counterpartyAfgCustomerId = await ensureCounterparty({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      payload: counterpartyAfgCustomer,
    });

    const createPkrCustomerAccount = getRequestBody(requests, 23);
    createPkrCustomerAccount.coaId = coaB.id;
    createPkrCustomerAccount.parentAccountId = await findAccountIdByCoaId(
      coaB.id,
      AR_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: createPkrCustomerAccount,
    });
    const pkrCustomerAccountId = await findAccountIdByCoaId(
      coaB.id,
      createPkrCustomerAccount.code
    );

    const counterpartyPkrCustomer = getRequestBody(requests, 24);
    counterpartyPkrCustomer.legalEntityId = legalEntityB.id;
    counterpartyPkrCustomer.primaryOperatingUnitId = operatingUnitB1Id;
    counterpartyPkrCustomer.operatingUnitIds = [operatingUnitB1Id];
    counterpartyPkrCustomer.arAccountId = pkrCustomerAccountId;
    counterpartyPkrCustomer.apAccountId = null;
    counterpartyPkrCustomer.defaultPaymentTermId = null;
    const counterpartyPkrCustomerId = await ensureCounterparty({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      payload: counterpartyPkrCustomer,
    });

    const createAfgVendorAccount = getRequestBody(requests, 25);
    createAfgVendorAccount.coaId = coaA.id;
    createAfgVendorAccount.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      AP_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: createAfgVendorAccount,
    });
    const afgVendorAccountId = await findAccountIdByCoaId(
      coaA.id,
      createAfgVendorAccount.code
    );

    const counterpartyAfgVendor = getRequestBody(requests, 26);
    counterpartyAfgVendor.legalEntityId = legalEntityA.id;
    counterpartyAfgVendor.primaryOperatingUnitId = operatingUnitA1Id;
    counterpartyAfgVendor.operatingUnitIds = [operatingUnitA1Id];
    counterpartyAfgVendor.defaultPaymentTermId = paymentTermAId;
    counterpartyAfgVendor.arAccountId = null;
    counterpartyAfgVendor.apAccountId = afgVendorAccountId;
    const counterpartyAfgVendorId = await ensureCounterparty({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      payload: counterpartyAfgVendor,
    });

    const createPkrVendorAccount = getRequestBody(requests, 28);
    createPkrVendorAccount.coaId = coaB.id;
    createPkrVendorAccount.parentAccountId = await findAccountIdByCoaId(
      coaB.id,
      AP_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: createPkrVendorAccount,
    });
    const pkrVendorAccountId = await findAccountIdByCoaId(
      coaB.id,
      createPkrVendorAccount.code
    );

    const counterpartyPkrVendor = getRequestBody(requests, 27);
    counterpartyPkrVendor.legalEntityId = legalEntityB.id;
    counterpartyPkrVendor.primaryOperatingUnitId = operatingUnitB1Id;
    counterpartyPkrVendor.operatingUnitIds = [operatingUnitB1Id];
    counterpartyPkrVendor.defaultPaymentTermId = null;
    counterpartyPkrVendor.arAccountId = null;
    counterpartyPkrVendor.apAccountId = pkrVendorAccountId;
    const counterpartyPkrVendorId = await ensureCounterparty({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      payload: counterpartyPkrVendor,
    });

    const account10001ARequest = getRequestBody(requests, 29);
    account10001ARequest.coaId = coaA.id;
    account10001ARequest.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      CASH_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10001ARequest,
    });
    const account10001AId = await findAccountIdByCoaId(
      coaA.id,
      account10001ARequest.code
    );

    const registerA1Payload = getRequestBody(requests, 30);
    registerA1Payload.legalEntityId = legalEntityA.id;
    registerA1Payload.ownershipScope = "OPERATING_UNIT";
    registerA1Payload.operatingUnitId = operatingUnitA1Id;
    registerA1Payload.accountId = account10001AId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/registers",
      body: registerA1Payload,
    });
    const registerA1Id = await findCashRegisterId(
      tenantContext.tenantId,
      registerA1Payload.code
    );

    const account10002ARequest = getRequestBody(requests, 31);
    account10002ARequest.coaId = coaA.id;
    account10002ARequest.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      CASH_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10002ARequest,
    });
    const account10002AId = await findAccountIdByCoaId(
      coaA.id,
      account10002ARequest.code
    );

    const registerA2Payload = getRequestBody(requests, 32);
    registerA2Payload.legalEntityId = legalEntityA.id;
    registerA2Payload.ownershipScope = "OPERATING_UNIT";
    registerA2Payload.operatingUnitId = operatingUnitA1Id;
    registerA2Payload.accountId = account10002AId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/registers",
      body: registerA2Payload,
    });
    const registerA2Id = await findCashRegisterId(
      tenantContext.tenantId,
      registerA2Payload.code
    );

    const account10003ARequest = getRequestBody(requests, 33);
    account10003ARequest.coaId = coaA.id;
    account10003ARequest.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      CASH_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10003ARequest,
    });
    const account10003AId = await findAccountIdByCoaId(
      coaA.id,
      account10003ARequest.code
    );

    const registerA3Payload = getRequestBody(requests, 34);
    registerA3Payload.legalEntityId = legalEntityA.id;
    registerA3Payload.ownershipScope = "OPERATING_UNIT";
    registerA3Payload.operatingUnitId = operatingUnitA2Id;
    registerA3Payload.accountId = account10003AId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/registers",
      body: registerA3Payload,
    });
    const registerA3Id = await findCashRegisterId(
      tenantContext.tenantId,
      registerA3Payload.code
    );

    const account10004ARequest = getRequestBody(requests, 35);
    account10004ARequest.coaId = coaA.id;
    account10004ARequest.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      CASH_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10004ARequest,
    });
    const account10004AId = await findAccountIdByCoaId(
      coaA.id,
      account10004ARequest.code
    );

    const registerA4Payload = getRequestBody(requests, 36);
    registerA4Payload.legalEntityId = legalEntityA.id;
    registerA4Payload.ownershipScope = "OPERATING_UNIT";
    registerA4Payload.operatingUnitId = operatingUnitA2Id;
    registerA4Payload.accountId = account10004AId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/registers",
      body: registerA4Payload,
    });
    const registerA4Id = await findCashRegisterId(
      tenantContext.tenantId,
      registerA4Payload.code
    );

    const account10001BRequest = getRequestBody(requests, 37);
    account10001BRequest.coaId = coaB.id;
    account10001BRequest.parentAccountId = await findAccountIdByCoaId(
      coaB.id,
      CASH_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10001BRequest,
    });
    const account10001BId = await findAccountIdByCoaId(
      coaB.id,
      account10001BRequest.code
    );

    const registerB1Payload = getRequestBody(requests, 38);
    registerB1Payload.legalEntityId = legalEntityB.id;
    registerB1Payload.ownershipScope = "OPERATING_UNIT";
    registerB1Payload.operatingUnitId = operatingUnitB1Id;
    registerB1Payload.accountId = account10001BId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/registers",
      body: registerB1Payload,
    });
    const registerB1Id = await findCashRegisterId(
      tenantContext.tenantId,
      registerB1Payload.code
    );

    const openSession1Payload = getRequestBody(requests, 39);
    await ensureOpenSession({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      registerId: registerA1Id,
      openingAmount: Number(openSession1Payload.openingAmount || 0),
    });

    const openSession2Payload = getRequestBody(requests, 40);
    await ensureOpenSession({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      registerId: registerA2Id,
      openingAmount: Number(openSession2Payload.openingAmount || 0),
    });

    const openSession3Payload = getRequestBody(requests, 41);
    await ensureOpenSession({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      registerId: registerA3Id,
      openingAmount: Number(openSession3Payload.openingAmount || 0),
    });

    const openSession4Payload = getRequestBody(requests, 42);
    await ensureOpenSession({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      registerId: registerA4Id,
      openingAmount: Number(openSession4Payload.openingAmount || 0),
    });
    await ensureOpenSession({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      registerId: registerB1Id,
      openingAmount: Number(openSession4Payload.openingAmount || 0),
    });

    const openingJournalA = getRequestBody(requests, 43);
    openingJournalA.legalEntityId = legalEntityA.id;
    openingJournalA.bookId = bookA.id;
    openingJournalA.fiscalPeriodId = fiscalPeriod03Id;
    if (Array.isArray(openingJournalA.lines) && openingJournalA.lines.length >= 2) {
      openingJournalA.lines[0].accountId = account10001AId;
      openingJournalA.lines[0].operatingUnitId = operatingUnitA1Id;
      openingJournalA.lines[1].accountId = shareholderA.commitmentDebitSubAccountId;
      delete openingJournalA.lines[1].operatingUnitId;
      delete openingJournalA.lines[1].subledgerReferenceNo;
    }
    const openingJournalAResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/journals",
      body: openingJournalA,
    });
    const openingJournalAId = parsePositiveInt(openingJournalAResult?.journalEntryId);
    if (!openingJournalAId) {
      throw new Error("Opening journal A id missing");
    }

    const openingJournalAPostPayload = getRequestBody(requests, 44);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/gl/journals/${openingJournalAId}/post`,
      body: openingJournalAPostPayload,
    });

    const openingJournalB = getRequestBody(requests, 45);
    openingJournalB.legalEntityId = legalEntityB.id;
    openingJournalB.bookId = bookB.id;
    openingJournalB.fiscalPeriodId = fiscalPeriod03Id;
    if (Array.isArray(openingJournalB.lines) && openingJournalB.lines.length >= 2) {
      openingJournalB.lines[0].accountId = account10001BId;
      openingJournalB.lines[0].operatingUnitId = operatingUnitB1Id;
      openingJournalB.lines[1].accountId = shareholderB.commitmentDebitSubAccountId;
      delete openingJournalB.lines[1].operatingUnitId;
      delete openingJournalB.lines[1].subledgerReferenceNo;
    }
    const openingJournalBResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/journals",
      body: openingJournalB,
    });
    const openingJournalBId = parsePositiveInt(openingJournalBResult?.journalEntryId);
    if (!openingJournalBId) {
      throw new Error("Opening journal B id missing");
    }

    const openingJournalBPostPayload = getRequestBody(requests, 46);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/gl/journals/${openingJournalBId}/post`,
      body: openingJournalBPostPayload,
    });

    const accountAfgFxClearancePayload = getRequestBody(requests, 47);
    accountAfgFxClearancePayload.coaId = coaA.id;
    accountAfgFxClearancePayload.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      FX_CLEARANCE_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: accountAfgFxClearancePayload,
    });

    const accountPkrFxClearancePayload = getRequestBody(requests, 48);
    accountPkrFxClearancePayload.coaId = coaB.id;
    accountPkrFxClearancePayload.parentAccountId = await findAccountIdByCoaId(
      coaB.id,
      FX_CLEARANCE_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: accountPkrFxClearancePayload,
    });

    const accountAfgBranchTransitPayload = getRequestBody(requests, 49);
    accountAfgBranchTransitPayload.coaId = coaA.id;
    accountAfgBranchTransitPayload.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      FX_CLEARANCE_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: accountAfgBranchTransitPayload,
    });

    const postedCariDocumentIds = [];
    const settlementBatchIds = [];
    const cariDocumentPlans = [
      {
        createRequestId: 50,
        postRequestId: 51,
        errorLabel: "first AP",
        legalEntityId: legalEntityA.id,
        operatingUnitId: operatingUnitA1Id,
        counterpartyId: counterpartyAfgVendorId,
        paymentTermId: paymentTermAId,
        offsetAccountCode: CARI_OFFSET_ACCOUNT_CODE,
      },
      {
        createRequestId: 52,
        postRequestId: 53,
        errorLabel: "second AP",
        legalEntityId: legalEntityA.id,
        operatingUnitId: operatingUnitA1Id,
        counterpartyId: counterpartyAfgVendorId,
        paymentTermId: paymentTermAId,
        offsetAccountCode: CARI_OFFSET_ACCOUNT_CODE,
      },
      {
        createRequestId: 54,
        postRequestId: 55,
        errorLabel: "first AR",
        legalEntityId: legalEntityA.id,
        operatingUnitId: operatingUnitA1Id,
        counterpartyId: counterpartyAfgCustomerId,
        paymentTermId: paymentTermAId,
      },
      {
        createRequestId: 56,
        postRequestId: 57,
        errorLabel: "second AR",
        legalEntityId: legalEntityA.id,
        operatingUnitId: operatingUnitA1Id,
        counterpartyId: counterpartyAfgCustomerId,
        paymentTermId: paymentTermAId,
      },
      {
        createRequestId: 58,
        postRequestId: 59,
        errorLabel: "third AP",
        legalEntityId: legalEntityB.id,
        operatingUnitId: operatingUnitB1Id,
        counterpartyId: counterpartyPkrVendorId,
        paymentTermId: paymentTermBId,
        offsetAccountCode: CARI_OFFSET_ACCOUNT_CODE,
      },
      {
        createRequestId: 60,
        postRequestId: 61,
        errorLabel: "fourth AP",
        legalEntityId: legalEntityB.id,
        operatingUnitId: operatingUnitB1Id,
        counterpartyId: counterpartyPkrVendorId,
        paymentTermId: null,
        offsetAccountCode: CARI_OFFSET_ACCOUNT_CODE,
      },
      {
        createRequestId: 62,
        postRequestId: 63,
        errorLabel: "third AR",
        legalEntityId: legalEntityB.id,
        operatingUnitId: operatingUnitB1Id,
        counterpartyId: counterpartyPkrCustomerId,
        paymentTermId: paymentTermBId,
      },
      {
        createRequestId: 64,
        postRequestId: 65,
        errorLabel: "fourth AR",
        legalEntityId: legalEntityB.id,
        operatingUnitId: operatingUnitB1Id,
        counterpartyId: counterpartyPkrCustomerId,
        paymentTermId: null,
      },
    ];

    for (const plan of cariDocumentPlans) {
      const documentCreatePayload = getRequestBody(requests, plan.createRequestId);
      documentCreatePayload.legalEntityId = plan.legalEntityId;
      documentCreatePayload.operatingUnitId = plan.operatingUnitId;
      documentCreatePayload.counterpartyId = plan.counterpartyId;
      documentCreatePayload.paymentTermId = plan.paymentTermId;

      const documentId = await createCariDocument({
        baseUrl,
        cookie: authCookie,
        payload: documentCreatePayload,
        errorLabel: plan.errorLabel,
      });

      const documentPostPayload = getRequestBody(requests, plan.postRequestId);
      delete documentPostPayload.offsetAccountId;
      if (plan.offsetAccountCode) {
        documentPostPayload.offsetAccountCode = plan.offsetAccountCode;
      }

      await postCariDocument({
        baseUrl,
        cookie: authCookie,
        documentId,
        payload: documentPostPayload,
      });
      postedCariDocumentIds.push(documentId);
    }

    const fxRateBulkUpsertDay1 = getRequestBody(requests, 66);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/fx/rates/bulk-upsert",
      body: fxRateBulkUpsertDay1,
    });

    const fxRateBulkUpsertDay2 = getRequestBody(requests, 67);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/fx/rates/bulk-upsert",
      body: fxRateBulkUpsertDay2,
    });

    const fxRateBulkUpsertDay3 = getRequestBody(requests, 72);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/fx/rates/bulk-upsert",
      body: fxRateBulkUpsertDay3,
    });

    const fxRateBulkUpsertDay4 = getRequestBody(requests, 73);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/fx/rates/bulk-upsert",
      body: fxRateBulkUpsertDay4,
    });

    const account10002BRequest = getRequestBody(requests, 68);
    account10002BRequest.coaId = coaB.id;
    account10002BRequest.parentAccountId = await findAccountIdByCoaId(
      coaB.id,
      CASH_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10002BRequest,
    });
    const account10002BId = await findAccountIdByCoaId(
      coaB.id,
      account10002BRequest.code
    );

    const registerB2Payload = getRequestBody(requests, 69);
    registerB2Payload.legalEntityId = legalEntityB.id;
    registerB2Payload.ownershipScope = "OPERATING_UNIT";
    registerB2Payload.operatingUnitId = operatingUnitB1Id;
    registerB2Payload.accountId = account10002BId;
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/registers",
      body: registerB2Payload,
    });
    const registerB2Id = await findCashRegisterId(
      tenantContext.tenantId,
      registerB2Payload.code
    );

    const openSession5Payload = getRequestBody(requests, 70);
    await ensureOpenSession({
      baseUrl,
      cookie: authCookie,
      tenantId: tenantContext.tenantId,
      registerId: registerB2Id,
      openingAmount: Number(openSession5Payload.openingAmount || 0),
    });

    const pkrUsdSettlementPayload = getRequestBody(requests, 71);
    pkrUsdSettlementPayload.legalEntityId = legalEntityB.id;
    pkrUsdSettlementPayload.operatingUnitId = operatingUnitB1Id;
    pkrUsdSettlementPayload.counterpartyId = counterpartyPkrCustomerId;
    const pkrUsdSettlementResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cari/settlements/apply",
      body: pkrUsdSettlementPayload,
    });
    const pkrUsdSettlementBatchId = parsePositiveInt(
      pkrUsdSettlementResult?.row?.id ?? pkrUsdSettlementResult?.row?.settlementBatchId
    );
    if (!pkrUsdSettlementBatchId) {
      throw new Error("Unable to resolve PKR USD settlement batch id");
    }
    settlementBatchIds.push(pkrUsdSettlementBatchId);

    const afnAfgSettlementPayload = getRequestBody(requests, 74);
    afnAfgSettlementPayload.legalEntityId = legalEntityA.id;
    afnAfgSettlementPayload.operatingUnitId = operatingUnitA1Id;
    afnAfgSettlementPayload.counterpartyId = counterpartyAfgVendorId;
    afnAfgSettlementPayload.linkedCashTransaction = {
      ...afnAfgSettlementPayload.linkedCashTransaction,
      registerId: registerA1Id,
    };
    delete afnAfgSettlementPayload.linkedCashTransaction.cashSessionId;
    afnAfgSettlementPayload.linkedCashTransaction.counterAccountId =
      await findSettlementCashControlAccountId({
        tenantId: tenantContext.tenantId,
        legalEntityId: legalEntityA.id,
        direction: afnAfgSettlementPayload.direction,
      });
    const afnAfgSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA1Id
    );
    if (afnAfgSessionId) {
      afnAfgSettlementPayload.linkedCashTransaction.cashSessionId = afnAfgSessionId;
    }
    const afnAfgSettlementResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cari/settlements/apply",
      body: afnAfgSettlementPayload,
    });
    const afnAfgSettlementBatchId = parsePositiveInt(
      afnAfgSettlementResult?.row?.id ?? afnAfgSettlementResult?.row?.settlementBatchId
    );
    if (!afnAfgSettlementBatchId) {
      throw new Error("Unable to resolve AFG AFN cash settlement batch id");
    }
    settlementBatchIds.push(afnAfgSettlementBatchId);

    const usdAfgSettlementPayload = getRequestBody(requests, 75);
    usdAfgSettlementPayload.legalEntityId = legalEntityA.id;
    usdAfgSettlementPayload.operatingUnitId = operatingUnitA1Id;
    usdAfgSettlementPayload.counterpartyId = counterpartyAfgVendorId;
    usdAfgSettlementPayload.linkedCashTransaction = {
      ...usdAfgSettlementPayload.linkedCashTransaction,
      registerId: registerA2Id,
    };
    delete usdAfgSettlementPayload.linkedCashTransaction.cashSessionId;
    usdAfgSettlementPayload.linkedCashTransaction.counterAccountId =
      await findSettlementCashControlAccountId({
        tenantId: tenantContext.tenantId,
        legalEntityId: legalEntityA.id,
        direction: usdAfgSettlementPayload.direction,
      });
    const usdAfgSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA2Id
    );
    if (usdAfgSessionId) {
      usdAfgSettlementPayload.linkedCashTransaction.cashSessionId = usdAfgSessionId;
    }
    const usdAfgSettlementResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cari/settlements/apply",
      body: usdAfgSettlementPayload,
    });
    const usdAfgSettlementBatchId = parsePositiveInt(
      usdAfgSettlementResult?.row?.id ?? usdAfgSettlementResult?.row?.settlementBatchId
    );
    if (!usdAfgSettlementBatchId) {
      throw new Error("Unable to resolve AFG USD cash settlement batch id");
    }
    settlementBatchIds.push(usdAfgSettlementBatchId);

    const arCustomerAfgSettlementPayload = getRequestBody(requests, 76);
    arCustomerAfgSettlementPayload.legalEntityId = legalEntityA.id;
    arCustomerAfgSettlementPayload.operatingUnitId = operatingUnitA1Id;
    arCustomerAfgSettlementPayload.counterpartyId = counterpartyAfgCustomerId;
    arCustomerAfgSettlementPayload.linkedCashTransaction = {
      ...arCustomerAfgSettlementPayload.linkedCashTransaction,
      registerId: registerA2Id,
    };
    delete arCustomerAfgSettlementPayload.linkedCashTransaction.cashSessionId;
    arCustomerAfgSettlementPayload.linkedCashTransaction.counterAccountId =
      await findSettlementCashControlAccountId({
        tenantId: tenantContext.tenantId,
        legalEntityId: legalEntityA.id,
        direction: arCustomerAfgSettlementPayload.direction,
      });
    const arCustomerAfgSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA2Id
    );
    if (arCustomerAfgSessionId) {
      arCustomerAfgSettlementPayload.linkedCashTransaction.cashSessionId =
        arCustomerAfgSessionId;
    }
    const arCustomerAfgSettlementResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cari/settlements/apply",
      body: arCustomerAfgSettlementPayload,
    });
    const arCustomerAfgSettlementBatchId = parsePositiveInt(
      arCustomerAfgSettlementResult?.row?.id ??
        arCustomerAfgSettlementResult?.row?.settlementBatchId
    );
    if (!arCustomerAfgSettlementBatchId) {
      throw new Error("Unable to resolve AFG AR cash settlement batch id");
    }
    settlementBatchIds.push(arCustomerAfgSettlementBatchId);

    const arAfgAfnSettlementPayload = getRequestBody(requests, 77);
    arAfgAfnSettlementPayload.legalEntityId = legalEntityA.id;
    arAfgAfnSettlementPayload.operatingUnitId = operatingUnitA1Id;
    arAfgAfnSettlementPayload.counterpartyId = counterpartyAfgCustomerId;
    arAfgAfnSettlementPayload.linkedCashTransaction = {
      ...arAfgAfnSettlementPayload.linkedCashTransaction,
      registerId: registerA1Id,
    };
    delete arAfgAfnSettlementPayload.linkedCashTransaction.cashSessionId;
    arAfgAfnSettlementPayload.linkedCashTransaction.counterAccountId =
      await findSettlementCashControlAccountId({
        tenantId: tenantContext.tenantId,
        legalEntityId: legalEntityA.id,
        direction: arAfgAfnSettlementPayload.direction,
      });
    const arAfgAfnSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA1Id
    );
    if (arAfgAfnSessionId) {
      arAfgAfnSettlementPayload.linkedCashTransaction.cashSessionId = arAfgAfnSessionId;
    }
    const arAfgAfnSettlementResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cari/settlements/apply",
      body: arAfgAfnSettlementPayload,
    });
    const arAfgAfnSettlementBatchId = parsePositiveInt(
      arAfgAfnSettlementResult?.row?.id ?? arAfgAfnSettlementResult?.row?.settlementBatchId
    );
    if (!arAfgAfnSettlementBatchId) {
      throw new Error("Unable to resolve AFG AR AFN cash settlement batch id");
    }
    settlementBatchIds.push(arAfgAfnSettlementBatchId);

    const interRegisterTransitPayload = getRequestBody(requests, 78);
    const branchTransitAccountPayload = getRequestBody(requests, 49);
    interRegisterTransitPayload.registerId = registerA1Id;
    interRegisterTransitPayload.targetRegisterId = registerA3Id;
    interRegisterTransitPayload.cashSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA1Id
    );
    if (!interRegisterTransitPayload.cashSessionId) {
      throw new Error("Unable to resolve open cash session for register A1");
    }
    interRegisterTransitPayload.transitAccountId = await findAccountIdByCoaId(
      coaA.id,
      String(branchTransitAccountPayload.code || "").trim()
    );
    const interRegisterTransitResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/transactions/transit/initiate",
      body: interRegisterTransitPayload,
    });
    const interRegisterTransitTransferId = parsePositiveInt(
      interRegisterTransitResult?.transfer?.id ??
        interRegisterTransitResult?.id ??
        interRegisterTransitResult?.result?.id
    );
    if (!interRegisterTransitTransferId) {
      throw new Error("Unable to resolve inter-register transit transfer id");
    }

    const interRegisterTransitTransferOutTransactionId = parsePositiveInt(
      interRegisterTransitResult?.transferOutTransaction?.id ??
        interRegisterTransitResult?.transfer?.transfer_out_cash_transaction_id
    );
    if (!interRegisterTransitTransferOutTransactionId) {
      throw new Error("Unable to resolve inter-register transit transfer-out cash transaction id");
    }

    const interRegisterTransitPostPayload = getRequestBody(requests, 79);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/cash/transactions/${interRegisterTransitTransferOutTransactionId}/post`,
      body: interRegisterTransitPostPayload,
    });

    const interRegisterTransitReceivePayload = getRequestBody(requests, 80);
    interRegisterTransitReceivePayload.cashSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA3Id
    );
    if (!interRegisterTransitReceivePayload.cashSessionId) {
      throw new Error("Unable to resolve open cash session for register A3");
    }
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/cash/transactions/transit/${interRegisterTransitTransferId}/receive`,
      body: interRegisterTransitReceivePayload,
    });

    const account10201ARequest = getRequestBody(requests, 81);
    account10201ARequest.coaId = coaA.id;
    account10201ARequest.parentAccountId = await findAccountIdByCoaId(
      coaA.id,
      BANK_PARENT_CODE
    );
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/gl/accounts",
      body: account10201ARequest,
    });
    const account10201AId = await findAccountIdByCoaId(
      coaA.id,
      account10201ARequest.code
    );

    const bankAccountAfgPayload = getRequestBody(requests, 82);
    bankAccountAfgPayload.legalEntityId = legalEntityA.id;
    bankAccountAfgPayload.glAccountId = account10201AId;
    let bankAccountAfgId = await findBankAccountId(
      tenantContext.tenantId,
      legalEntityA.id,
      bankAccountAfgPayload.code
    );
    if (!bankAccountAfgId) {
      const bankAccountAfgResult = await requestJson({
        baseUrl,
        cookie: authCookie,
        method: "POST",
        pathName: "/api/v1/bank/accounts",
        body: bankAccountAfgPayload,
      });
      bankAccountAfgId = parsePositiveInt(bankAccountAfgResult?.row?.id);
      if (!bankAccountAfgId) {
        throw new Error("Unable to resolve AFG bank account id");
      }
    }

    const depositToBankPayload = getRequestBody(requests, 83);
    depositToBankPayload.registerId = registerA1Id;
    depositToBankPayload.cashSessionId = await findOpenCashSessionId(
      tenantContext.tenantId,
      registerA1Id
    );
    if (!depositToBankPayload.cashSessionId) {
      throw new Error("Unable to resolve open cash session for register A1 bank deposit");
    }
    depositToBankPayload.counterAccountId = account10201AId;
    const depositToBankResult = await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: "/api/v1/cash/transactions",
      body: depositToBankPayload,
    });
    const depositToBankTransactionId = parsePositiveInt(depositToBankResult?.row?.id);
    if (!depositToBankTransactionId) {
      throw new Error("Unable to resolve deposit-to-bank cash transaction id");
    }

    const depositToBankPostPayload = getRequestBody(requests, 84);
    await requestJson({
      baseUrl,
      cookie: authCookie,
      method: "POST",
      pathName: `/api/v1/cash/transactions/${depositToBankTransactionId}/post`,
      body: depositToBankPostPayload,
    });

    return {
      ok: true,
      tenantId: tenantContext.tenantId,
      tenantCode: tenantContext.tenantCode,
      userId: tenantContext.userId,
      legalEntityIds: {
        [legalEntityACode]: legalEntityA.id,
        [legalEntityBCode]: legalEntityB.id,
      },
      counterparties: {
        [counterpartyAfgCustomer.code]: counterpartyAfgCustomerId,
        [counterpartyPkrCustomer.code]: counterpartyPkrCustomerId,
        [counterpartyAfgVendor.code]: counterpartyAfgVendorId,
        [counterpartyPkrVendor.code]: counterpartyPkrVendorId,
      },
      batchJournalIds: {
        [legalEntityACode]: batchJournalAId,
        [legalEntityBCode]: batchJournalBId,
      },
      openingJournalIds: {
        [legalEntityACode]: openingJournalAId,
        [legalEntityBCode]: openingJournalBId,
      },
      postedCariDocumentIds,
      settlementBatchIds,
      cashRegisterIds: {
        [registerA1Payload.code]: registerA1Id,
        [registerA2Payload.code]: registerA2Id,
        [registerA3Payload.code]: registerA3Id,
        [registerA4Payload.code]: registerA4Id,
        [registerB1Payload.code]: registerB1Id,
        [registerB2Payload.code]: registerB2Id,
      },
      bankAccountIds: {
        [bankAccountAfgPayload.code]: bankAccountAfgId,
      },
      cashTransactionIds: {
        depositToBank: depositToBankTransactionId,
      },
      periods: {
        fiscalCalendarId: fiscalCalendar.id,
        fiscalYear,
        period03Id: fiscalPeriod03Id,
        period12Id: fiscalPeriod12Id,
      },
    };
  } finally {
    await apiServer.stop();
  }
}
