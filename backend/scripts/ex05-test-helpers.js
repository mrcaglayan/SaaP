import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

export const TEST_FISCAL_YEAR = 2026;

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

export async function apiRequest({
  baseUrl,
  token,
  method = "GET",
  requestPath,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Cookie = token;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const setCookieHeader = response.headers.get("set-cookie");
  const cookie = setCookieHeader
    ? String(setCookieHeader).split(";")[0].trim()
    : null;

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${requestPath} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }
  return { status: response.status, json, cookie };
}

export function startServerProcess({ port, env = {} }) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  return child;
}

export async function waitForServer({ baseUrl, timeoutMs = 25_000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(350);
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

export async function createTenant(code, name) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [code, name]
  );
  const result = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [code]
  );
  const tenantId = toNumber(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant id for ${code}`);
  return tenantId;
}

export async function createTenantAdmin({
  tenantId,
  email,
  password,
  name = "EX05 Admin",
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const userResult = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toNumber(userResult.rows?.[0]?.id);
  assert(userId > 0, `Failed to resolve user id for ${email}`);

  const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId]
  );
  const roleId = toNumber(roleResult.rows?.[0]?.id);
  assert(roleId > 0, "TenantAdmin role not found");

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
     ON DUPLICATE KEY UPDATE effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );

  return { userId };
}

export async function login({ baseUrl, email, password }) {
  const result = await apiRequest({
    baseUrl,
    method: "POST",
    requestPath: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(Boolean(result.cookie), `Login cookie missing for ${email}`);
  return result.cookie;
}

export async function bootstrapOrgBookCoa({
  baseUrl,
  token,
  stamp,
  fiscalYear = TEST_FISCAL_YEAR,
  baseCurrencyCode = "TRY",
  yearsToGenerate = [TEST_FISCAL_YEAR, TEST_FISCAL_YEAR + 1],
}) {
  const countryRes = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'TR'
     LIMIT 1`
  );
  const countryId = toNumber(countryRes.rows?.[0]?.id);
  assert(countryId > 0, "TR country row is required");

  const groupRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/group-companies",
    body: {
      code: `EX05GC${stamp}`,
      name: `EX05 Group ${stamp}`,
    },
    expectedStatus: 201,
  });
  const groupCompanyId = toNumber(groupRes.json?.id);

  const calRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/fiscal-calendars",
    body: {
      code: `EX05CAL${stamp}`,
      name: `EX05 Calendar ${stamp}`,
      yearStartMonth: 1,
      yearStartDay: 1,
    },
    expectedStatus: 201,
  });
  const calendarId = toNumber(calRes.json?.id);
  assert(calendarId > 0, "calendarId not created");

  for (const year of yearsToGenerate) {
    // eslint-disable-next-line no-await-in-loop
    await apiRequest({
      baseUrl,
      token,
      method: "POST",
      requestPath: "/api/v1/org/fiscal-periods/generate",
      body: { calendarId, fiscalYear: year },
      expectedStatus: 201,
    });
  }

  const entityRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/legal-entities",
    body: {
      groupCompanyId,
      code: `EX05LE${stamp}`,
      name: `EX05 Legal Entity ${stamp}`,
      countryId,
      functionalCurrencyCode: asUpper(baseCurrencyCode),
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(entityRes.json?.id);
  assert(legalEntityId > 0, "legalEntityId not created");

  const ouRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code: `EX05OU${stamp}`,
      name: `EX05 OU ${stamp}`,
      unitType: "BRANCH",
      hasSubledger: true,
    },
    expectedStatus: 201,
  });
  const operatingUnitId = toNumber(ouRes.json?.id);

  const bookRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `EX05BOOK${stamp}`,
      name: `EX05 Book ${stamp}`,
      bookType: "LOCAL",
      baseCurrencyCode: asUpper(baseCurrencyCode),
    },
    expectedStatus: 201,
  });
  const bookId = toNumber(bookRes.json?.id);
  assert(bookId > 0, "bookId not created");

  const coaRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/gl/coas",
    body: {
      scope: "LEGAL_ENTITY",
      legalEntityId,
      code: `EX05COA${stamp}`,
      name: `EX05 CoA ${stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);

  const periodListRes = await apiRequest({
    baseUrl,
    token,
    method: "GET",
    requestPath: `/api/v1/org/fiscal-calendars/${calendarId}/periods?fiscalYear=${fiscalYear}`,
    expectedStatus: 200,
  });

  return {
    calendarId,
    legalEntityId,
    operatingUnitId,
    bookId,
    coaId,
    periods: Array.isArray(periodListRes.json?.rows) ? periodListRes.json.rows : [],
  };
}

export async function createAccount({
  baseUrl,
  token,
  coaId,
  code,
  name,
  accountType,
  normalSide,
}) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/gl/accounts",
    body: {
      coaId,
      code,
      name,
      accountType,
      normalSide,
      allowPosting: true,
    },
    expectedStatus: 201,
  });
  const accountId = toNumber(response.json?.id);
  assert(accountId > 0, `Account create failed for ${code}`);
  return accountId;
}

export async function createRegister({
  baseUrl,
  token,
  tenantId,
  legalEntityId,
  operatingUnitId,
  accountId,
  code,
  name,
  currencyCode,
}) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/cash/registers",
    body: {
      tenantId,
      legalEntityId,
      operatingUnitId,
      accountId,
      code,
      name,
      registerType: "DRAWER",
      sessionMode: "OPTIONAL",
      currencyCode: asUpper(currencyCode),
      status: "ACTIVE",
    },
    expectedStatus: 200,
  });
  const registerId = toNumber(response.json?.row?.id);
  assert(registerId > 0, "Cash register create failed");
  return registerId;
}

export async function insertFxRate({
  tenantId,
  rateDate,
  fromCurrencyCode,
  toCurrencyCode,
  rate,
}) {
  await query(
    `INSERT INTO fx_rates (
        tenant_id,
        rate_date,
        from_currency_code,
        to_currency_code,
        rate_type,
        rate,
        source,
        is_locked
     )
     VALUES (?, ?, ?, ?, 'SPOT', ?, 'EX05_TEST', FALSE)
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       source = VALUES(source),
       is_locked = VALUES(is_locked)`,
    [tenantId, rateDate, asUpper(fromCurrencyCode), asUpper(toCurrencyCode), rate]
  );
}

export async function upsertRevaluationPurposeAccounts({
  tenantId,
  legalEntityId,
  gainAccountId,
  lossAccountId,
}) {
  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES
       (?, ?, 'CASH_FX_REVALUATION_GAIN', ?),
       (?, ?, 'CASH_FX_REVALUATION_LOSS', ?)
     ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
    [tenantId, legalEntityId, gainAccountId, tenantId, legalEntityId, lossAccountId]
  );
}

export async function seedAndCreateTenantAdmin({
  tenantCode,
  tenantName,
  adminEmail,
  adminPassword,
}) {
  await seedCore({ ensureDefaultTenantIfMissing: true });
  const tenantId = await createTenant(tenantCode, tenantName);
  await seedCore({ ensureDefaultTenantIfMissing: true });
  const { userId } = await createTenantAdmin({
    tenantId,
    email: adminEmail,
    password: adminPassword,
  });
  return { tenantId, userId };
}

export function findRegularPeriodByNo(periodRows, periodNo) {
  const rows = Array.isArray(periodRows) ? periodRows : [];
  return (
    rows.find(
      (row) =>
        Number(row?.period_no || row?.periodNo) === Number(periodNo) &&
        !Boolean(row?.is_adjustment || row?.isAdjustment)
    ) || null
  );
}

export async function createAndPostCashTransaction({
  baseUrl,
  token,
  tenantId,
  registerId,
  txnType,
  txnDatetime,
  bookDate,
  amount,
  currencyCode,
  counterAccountId,
  idempotencyKey,
  sourceEntityId = null,
}) {
  const createRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/cash/transactions",
    body: {
      tenantId,
      registerId,
      txnType,
      txnDatetime,
      bookDate,
      amount,
      currencyCode: asUpper(currencyCode),
      counterAccountId,
      sourceModule: "MANUAL",
      sourceEntityType: sourceEntityId ? "EX05_TEST" : null,
      sourceEntityId,
      integrationLinkStatus: sourceEntityId ? "UNLINKED" : null,
      idempotencyKey,
    },
    expectedStatus: 200,
  });
  const transactionId = toNumber(createRes.json?.row?.id);
  assert(transactionId > 0, "cash transaction create failed");

  const postRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: `/api/v1/cash/transactions/${transactionId}/post`,
    body: {
      tenantId,
      overrideCashControl: false,
      overrideReason: null,
    },
    expectedStatus: 200,
  });

  return {
    transactionId,
    row: postRes.json?.row || null,
  };
}
