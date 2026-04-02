import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CASH_NEGATIVE_BALANCE_TEST_PORT || 3125);
const BASE_URL =
  process.env.CASH_NEGATIVE_BALANCE_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TODAY_DATE = new Date().toISOString().slice(0, 10);
const TEST_FISCAL_YEAR = Number(TODAY_DATE.slice(0, 4));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1";
}

async function apiRequest({
  token,
  method = "GET",
  path,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Cookie = token;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
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
      `${method} ${path} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }

  return { status: response.status, json, cookie };
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore until timeout
    }
    await sleep(300);
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  return child;
}

async function login(email, password) {
  const response = await apiRequest({
    method: "POST",
    path: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(Boolean(response.cookie), "Login cookie missing");
  return response.cookie;
}

async function createTenantAndAdmin() {
  const stamp = Date.now();
  const tenantCode = `CASHNEG_${stamp}`;
  const tenantName = `Cash Negative Balance ${stamp}`;
  const adminEmail = `cash_negative_balance_${stamp}@example.com`;
  const password = "CashNegative#12345";
  const passwordHash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, tenantName]
  );

  await seedCore({
    ensureDefaultTenantIfMissing: true,
  });

  const tenantResult = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantResult.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to resolve tenant");

  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, adminEmail, passwordHash, "Cash Negative Balance Admin"]
  );

  const userResult = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, adminEmail]
  );
  const userId = toNumber(userResult.rows?.[0]?.id);
  assert(userId > 0, "Failed to resolve admin user");

  const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId]
  );
  const roleId = toNumber(roleResult.rows?.[0]?.id);
  assert(roleId > 0, "Failed to resolve TenantAdmin role");

  await query(
    `INSERT INTO user_role_scopes (
        tenant_id, user_id, role_id, scope_type, scope_id, effect
     )
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
    [tenantId, userId, roleId, tenantId]
  );

  return {
    stamp,
    tenantId,
    userId,
    adminEmail,
    password,
  };
}

async function bootstrapOrgAndGlBase(token, stamp) {
  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'US'
     LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  const currencyCode = String(
    countryResult.rows?.[0]?.default_currency_code || "USD"
  ).toUpperCase();
  assert(countryId > 0, "US country row is required");

  const groupRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/group-companies",
    body: {
      code: `CG${stamp}`,
      name: `Cash Negative Group ${stamp}`,
    },
    expectedStatus: 201,
  });
  const groupCompanyId = toNumber(groupRes.json?.id);
  assert(groupCompanyId > 0, "groupCompanyId not created");

  const calendarRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/fiscal-calendars",
    body: {
      code: `CAL${stamp}`,
      name: `Cash Negative Calendar ${stamp}`,
      yearStartMonth: 1,
      yearStartDay: 1,
    },
    expectedStatus: 201,
  });
  const calendarId = toNumber(calendarRes.json?.id);
  assert(calendarId > 0, "calendarId not created");

  await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/fiscal-periods/generate",
    body: {
      calendarId,
      fiscalYear: TEST_FISCAL_YEAR,
    },
    expectedStatus: 201,
  });

  const entityRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/legal-entities",
    body: {
      groupCompanyId,
      code: `LE${stamp}`,
      name: `Cash Negative Legal Entity ${stamp}`,
      countryId,
      functionalCurrencyCode: currencyCode,
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(entityRes.json?.id);
  assert(legalEntityId > 0, "legalEntityId not created");

  const bookRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `BOOK${stamp}`,
      name: `Cash Negative Book ${stamp}`,
      bookType: "LOCAL",
      baseCurrencyCode: currencyCode,
    },
    expectedStatus: 201,
  });
  const bookId = toNumber(bookRes.json?.id);
  assert(bookId > 0, "bookId not created");

  const coaRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/coas",
    body: {
      scope: "LEGAL_ENTITY",
      legalEntityId,
      code: `COA${stamp}`,
      name: `Cash Negative CoA ${stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  return {
    legalEntityId,
    currencyCode,
    bookId,
    coaId,
  };
}

async function createAccount({
  token,
  coaId,
  code,
  name,
  accountType,
  normalSide,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/accounts",
    body: {
      coaId,
      code,
      name,
      accountType,
      normalSide,
    },
    expectedStatus: 201,
  });
  const accountId = toNumber(response.json?.id);
  assert(accountId > 0, `Account not created for code=${code}`);
  return accountId;
}

async function createRegister({
  token,
  tenantId,
  legalEntityId,
  accountId,
  currencyCode,
  varianceGainAccountId,
  varianceLossAccountId,
  allowNegative,
  code,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/cash/registers",
    body: {
      tenantId,
      legalEntityId,
      ownershipScope: "CENTRAL",
      accountId,
      code,
      name: code,
      registerType: "DRAWER",
      sessionMode: "OPTIONAL",
      currencyCode,
      allowNegative,
      varianceGainAccountId,
      varianceLossAccountId,
      status: "ACTIVE",
    },
    expectedStatus: 200,
  });
  const registerId = toNumber(response.json?.row?.id);
  assert(registerId > 0, `Register not created for code=${code}`);
  return registerId;
}

async function createPayout({
  token,
  tenantId,
  registerId,
  counterAccountId,
  currencyCode,
  amount,
  idempotencyKey,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/cash/transactions",
    body: {
      tenantId,
      registerId,
      txnType: "PAYOUT",
      amount,
      currencyCode,
      counterAccountId,
      description: "Negative balance policy payout",
      bookDate: TODAY_DATE,
      idempotencyKey,
    },
    expectedStatus: 200,
  });
  const transactionId = toNumber(response.json?.row?.id);
  assert(transactionId > 0, "Cash payout transaction not created");
  return transactionId;
}

async function postTransaction({
  token,
  tenantId,
  transactionId,
  expectedStatus,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: `/api/v1/cash/transactions/${transactionId}/post`,
    body: {
      tenantId,
      overrideCashControl: false,
    },
    expectedStatus,
  });
}

async function fetchRegisterPolicy(registerId) {
  const result = await query(
    `SELECT allow_negative
     FROM cash_registers
     WHERE id = ?
     LIMIT 1`,
    [registerId]
  );
  return toBoolean(result.rows?.[0]?.allow_negative);
}

async function fetchTransactionStatus(transactionId) {
  const result = await query(
    `SELECT status
     FROM cash_transactions
     WHERE id = ?
     LIMIT 1`,
    [transactionId]
  );
  return String(result.rows?.[0]?.status || "").trim().toUpperCase();
}

async function main() {
  const identity = await createTenantAndAdmin();
  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();

    const adminToken = await login(identity.adminEmail, identity.password);
    const context = await bootstrapOrgAndGlBase(adminToken, identity.stamp);

    const counterAccountId = await createAccount({
      token: adminToken,
      coaId: context.coaId,
      code: `EXP${identity.stamp}`,
      name: "Negative Balance Expense",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const varianceGainAccountId = await createAccount({
      token: adminToken,
      coaId: context.coaId,
      code: `VGN${identity.stamp}`,
      name: "Negative Balance Variance Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const varianceLossAccountId = await createAccount({
      token: adminToken,
      coaId: context.coaId,
      code: `VLS${identity.stamp}`,
      name: "Negative Balance Variance Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const blockedRegisterAccountId = await createAccount({
      token: adminToken,
      coaId: context.coaId,
      code: `CSF${identity.stamp}`,
      name: "Cash Register Negative False",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const allowedRegisterAccountId = await createAccount({
      token: adminToken,
      coaId: context.coaId,
      code: `CST${identity.stamp}`,
      name: "Cash Register Negative True",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });

    const blockedRegisterId = await createRegister({
      token: adminToken,
      tenantId: identity.tenantId,
      legalEntityId: context.legalEntityId,
      accountId: blockedRegisterAccountId,
      currencyCode: context.currencyCode,
      varianceGainAccountId,
      varianceLossAccountId,
      allowNegative: false,
      code: `NEG-FALSE-${identity.stamp}`,
    });
    const allowedRegisterId = await createRegister({
      token: adminToken,
      tenantId: identity.tenantId,
      legalEntityId: context.legalEntityId,
      accountId: allowedRegisterAccountId,
      currencyCode: context.currencyCode,
      varianceGainAccountId,
      varianceLossAccountId,
      allowNegative: true,
      code: `NEG-TRUE-${identity.stamp}`,
    });

    assert(
      (await fetchRegisterPolicy(blockedRegisterId)) === false,
      "Blocked register should persist allow_negative=false"
    );
    assert(
      (await fetchRegisterPolicy(allowedRegisterId)) === true,
      "Allowed register should persist allow_negative=true"
    );

    const blockedTransactionId = await createPayout({
      token: adminToken,
      tenantId: identity.tenantId,
      registerId: blockedRegisterId,
      counterAccountId,
      currencyCode: context.currencyCode,
      amount: "25.00",
      idempotencyKey: `neg-false-${identity.stamp}`,
    });
    const allowedTransactionId = await createPayout({
      token: adminToken,
      tenantId: identity.tenantId,
      registerId: allowedRegisterId,
      counterAccountId,
      currencyCode: context.currencyCode,
      amount: "25.00",
      idempotencyKey: `neg-true-${identity.stamp}`,
    });

    const blockedPost = await postTransaction({
      token: adminToken,
      tenantId: identity.tenantId,
      transactionId: blockedTransactionId,
      expectedStatus: 400,
    });
    assert(
      String(blockedPost.json?.message || "").includes("would drive cash register"),
      `Blocked register should reject negative balance posting, got ${JSON.stringify(
        blockedPost.json
      )}`
    );

    await postTransaction({
      token: adminToken,
      tenantId: identity.tenantId,
      transactionId: allowedTransactionId,
      expectedStatus: 200,
    });

    assert(
      (await fetchTransactionStatus(blockedTransactionId)) === "DRAFT",
      "Blocked negative-balance payout should remain DRAFT"
    );
    assert(
      (await fetchTransactionStatus(allowedTransactionId)) === "POSTED",
      "allowNegative=true payout should POST successfully"
    );

    console.log("Cash negative-balance policy test passed.");
  } finally {
    if (!serverStopped) {
      server.kill("SIGTERM");
      serverStopped = true;
    }
  }
}

main()
  .then(async () => {
    await closePool();
    process.exitCode = 0;
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exitCode = 1;
  });
