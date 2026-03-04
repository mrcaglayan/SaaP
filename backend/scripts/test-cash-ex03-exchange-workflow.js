import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CASH_EX03_TEST_PORT || 3117);
const BASE_URL = process.env.CASH_EX03_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const BOOK_DATE = "2026-06-20";
const FX_USD_TRY = 38.5;
const EPSILON = 0.0001;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function amountsEqual(left, right, epsilon = EPSILON) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

function toErrorText(payload) {
  if (payload === null || payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload.error === "string") {
    return payload.error;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
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
  const cookie = setCookieHeader ? String(setCookieHeader).split(";")[0].trim() : null;

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }

  return {
    status: response.status,
    json,
    cookie,
  };
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
      // keep waiting
    }
    await sleep(350);
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
  const sessionCookie = response.cookie;
  assert(Boolean(sessionCookie), "Login cookie missing");
  return sessionCookie;
}

async function createTenantAndAdmin() {
  const stamp = Date.now();
  const tenantCode = `CASHEX03_${stamp}`;
  const tenantName = `Cash EX03 ${stamp}`;
  const adminEmail = `cash_ex03_admin_${stamp}@example.com`;
  const password = "CashEX03#12345";
  const passwordHash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
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
    [tenantId, adminEmail, passwordHash, "Cash EX03 Admin"]
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
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );

  return {
    tenantId,
    userId,
    adminEmail,
    password,
    stamp,
  };
}

async function createAccount({
  token,
  coaId,
  code,
  name,
  accountType = "ASSET",
  normalSide = "DEBIT",
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
      allowPosting: true,
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
  operatingUnitId,
  accountId,
  code,
  name,
  currencyCode,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/cash/registers",
    body: {
      tenantId,
      legalEntityId,
      operatingUnitId,
      accountId,
      code,
      name,
      registerType: "DRAWER",
      sessionMode: "OPTIONAL",
      currencyCode,
      status: "ACTIVE",
    },
    expectedStatus: 200,
  });
  const registerId = toNumber(response.json?.row?.id);
  assert(registerId > 0, `Register not created for code=${code}`);
  return registerId;
}

async function bootstrapExchangeContext(token, identity) {
  const tryCurrency = await query(
    `SELECT code FROM currencies WHERE code = 'TRY' LIMIT 1`
  );
  const usdCurrency = await query(
    `SELECT code FROM currencies WHERE code = 'USD' LIMIT 1`
  );
  assert(Boolean(tryCurrency.rows?.[0]), "TRY currency must exist in seed data");
  assert(Boolean(usdCurrency.rows?.[0]), "USD currency must exist in seed data");

  const countryResult = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'TR'
     LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  assert(countryId > 0, "TR country row is required");

  const groupRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/group-companies",
    body: {
      code: `CGEX03${identity.stamp}`,
      name: `Cash EX03 Group ${identity.stamp}`,
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
      code: `CALEX03${identity.stamp}`,
      name: `Cash EX03 Calendar ${identity.stamp}`,
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
      fiscalYear: 2026,
    },
    expectedStatus: 201,
  });

  const legalEntityRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/legal-entities",
    body: {
      groupCompanyId,
      code: `LEEX03${identity.stamp}`,
      name: `Cash EX03 LE ${identity.stamp}`,
      countryId,
      functionalCurrencyCode: "TRY",
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(legalEntityRes.json?.id);
  assert(legalEntityId > 0, "legalEntityId not created");

  const ouRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code: `OUEX03${identity.stamp}`,
      name: `Cash EX03 OU ${identity.stamp}`,
      unitType: "BRANCH",
      hasSubledger: true,
    },
    expectedStatus: 201,
  });
  const operatingUnitId = toNumber(ouRes.json?.id);
  assert(operatingUnitId > 0, "operatingUnitId not created");

  const bookRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `BOOKEX03${identity.stamp}`,
      name: `Cash EX03 Book ${identity.stamp}`,
      bookType: "LOCAL",
      baseCurrencyCode: "TRY",
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
      code: `COAEX03${identity.stamp}`,
      name: `Cash EX03 CoA ${identity.stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  const sourceRegisterAccountId = await createAccount({
    token,
    coaId,
    code: `CR3USD${identity.stamp}`,
    name: "Cash Register USD",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const targetRegisterAccountId = await createAccount({
    token,
    coaId,
    code: `CR3TRY${identity.stamp}`,
    name: "Cash Register TRY",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const clearingAccountId = await createAccount({
    token,
    coaId,
    code: `CCLEX3${identity.stamp}`,
    name: "Cash Exchange Clearing",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });

  const sourceRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId,
    accountId: sourceRegisterAccountId,
    code: `RG3USD${identity.stamp}`,
    name: "USD Register",
    currencyCode: "USD",
  });
  const targetRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId,
    accountId: targetRegisterAccountId,
    code: `RG3TRY${identity.stamp}`,
    name: "TRY Register",
    currencyCode: "TRY",
  });

  await query(
    `INSERT INTO fx_rates (
       tenant_id, rate_date, from_currency_code, to_currency_code, rate_type, rate, source, is_locked
     ) VALUES (?, ?, 'USD', 'TRY', 'SPOT', ?, 'EX03_TEST', 0)
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       source = VALUES(source)`,
    [identity.tenantId, BOOK_DATE, FX_USD_TRY]
  );

  return {
    legalEntityId,
    bookId,
    operatingUnitId,
    sourceRegisterId,
    targetRegisterId,
    sourceRegisterAccountId,
    targetRegisterAccountId,
    clearingAccountId,
  };
}

async function createCashExchange({
  token,
  tenantId,
  sourceRegisterId,
  targetRegisterId,
  clearingAccountId,
  sourceAmountTxn,
  targetAmountTxn,
  idempotencyKey,
  expectedStatus = 201,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: "/api/v1/cash/exchanges",
    body: {
      tenantId,
      sourceRegisterId,
      targetRegisterId,
      clearingAccountId,
      sourceAmountTxn,
      targetAmountTxn,
      bookDate: BOOK_DATE,
      idempotencyKey,
      description: "EX03 USD->TRY",
      referenceNo: `EX03-${idempotencyKey}`,
      note: "EX03 smoke test",
    },
    expectedStatus,
  });
}

async function reverseCashExchange({
  token,
  tenantId,
  exchangeBatchId,
  reverseReason,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: `/api/v1/cash/exchanges/${exchangeBatchId}/reverse`,
    body: {
      tenantId,
      reverseReason,
    },
    expectedStatus,
  });
}

async function getCashExchange({
  token,
  tenantId,
  exchangeBatchId,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "GET",
    path: `/api/v1/cash/exchanges/${exchangeBatchId}?tenantId=${tenantId}`,
    expectedStatus,
  });
}

async function listCashExchanges({
  token,
  tenantId,
  legalEntityId,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "GET",
    path: `/api/v1/cash/exchanges?tenantId=${tenantId}&legalEntityId=${legalEntityId}&limit=10&offset=0`,
    expectedStatus,
  });
}

async function fetchCashTransactionById({
  tenantId,
  transactionId,
}) {
  const result = await query(
    `SELECT
       id,
       txn_type,
       status,
       cash_register_id,
       currency_code,
       amount,
       amount_base,
       posted_journal_entry_id,
       reversal_of_transaction_id
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, transactionId]
  );
  return result.rows?.[0] || null;
}

async function fetchExchangeBatchById({
  tenantId,
  exchangeBatchId,
}) {
  const result = await query(
    `SELECT
       id,
       legal_entity_id,
       source_cash_register_id,
       target_cash_register_id,
       source_currency_code,
       target_currency_code,
       source_amount_txn,
       target_amount_txn,
       source_amount_base,
       target_amount_base,
       status,
       exchange_out_cash_transaction_id,
       exchange_in_cash_transaction_id,
       reversal_out_cash_transaction_id,
       reversal_in_cash_transaction_id,
       reverse_reason
     FROM cash_exchange_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, exchangeBatchId]
  );
  return result.rows?.[0] || null;
}

async function main() {
  const identity = await createTenantAndAdmin();
  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const token = await login(identity.adminEmail, identity.password);
    const setup = await bootstrapExchangeContext(token, identity);

    const exchangeCreateRes = await createCashExchange({
      token,
      tenantId: identity.tenantId,
      sourceRegisterId: setup.sourceRegisterId,
      targetRegisterId: setup.targetRegisterId,
      clearingAccountId: setup.clearingAccountId,
      sourceAmountTxn: "100.00",
      targetAmountTxn: "3850.00",
      idempotencyKey: `EX03-CREATE-${identity.stamp}`,
      expectedStatus: 201,
    });

    const createdBatch = exchangeCreateRes.json?.batch || null;
    assert(Boolean(createdBatch), "create exchange response must include batch");
    const exchangeBatchId = toNumber(createdBatch?.id);
    assert(exchangeBatchId > 0, "exchange batch id is required");
    assert(asUpper(createdBatch?.status) === "POSTED", "exchange batch must be POSTED");
    assert(
      asUpper(createdBatch?.sourceCurrencyCode) === "USD",
      "sourceCurrencyCode must be USD"
    );
    assert(
      asUpper(createdBatch?.targetCurrencyCode) === "TRY",
      "targetCurrencyCode must be TRY"
    );
    assert(
      amountsEqual(createdBatch?.sourceAmountTxn, 100),
      "sourceAmountTxn must be 100"
    );
    assert(
      amountsEqual(createdBatch?.targetAmountTxn, 3850),
      "targetAmountTxn must be 3850"
    );
    assert(exchangeCreateRes.json?.idempotentReplay === false, "first create must not replay");

    const outTxnId = toNumber(exchangeCreateRes.json?.exchangeOutTransaction?.id);
    const inTxnId = toNumber(exchangeCreateRes.json?.exchangeInTransaction?.id);
    assert(outTxnId > 0, "exchangeOutTransaction id is required");
    assert(inTxnId > 0, "exchangeInTransaction id is required");

    const outTxn = await fetchCashTransactionById({
      tenantId: identity.tenantId,
      transactionId: outTxnId,
    });
    assert(Boolean(outTxn), "exchange out cash transaction must exist");
    assert(asUpper(outTxn.txn_type) === "PAYOUT", "exchange out txn_type must be PAYOUT");
    assert(asUpper(outTxn.status) === "POSTED", "exchange out must be POSTED");
    assert(
      toNumber(outTxn.cash_register_id) === setup.sourceRegisterId,
      "exchange out must be linked to source register"
    );
    assert(asUpper(outTxn.currency_code) === "USD", "exchange out currency must be USD");
    assert(amountsEqual(outTxn.amount, 100), "exchange out amount must be 100");
    assert(amountsEqual(outTxn.amount_base, 3850), "exchange out amount_base must be 3850");
    assert(toNumber(outTxn.posted_journal_entry_id) > 0, "exchange out must have posted journal");

    const inTxn = await fetchCashTransactionById({
      tenantId: identity.tenantId,
      transactionId: inTxnId,
    });
    assert(Boolean(inTxn), "exchange in cash transaction must exist");
    assert(asUpper(inTxn.txn_type) === "RECEIPT", "exchange in txn_type must be RECEIPT");
    assert(asUpper(inTxn.status) === "POSTED", "exchange in must be POSTED");
    assert(
      toNumber(inTxn.cash_register_id) === setup.targetRegisterId,
      "exchange in must be linked to target register"
    );
    assert(asUpper(inTxn.currency_code) === "TRY", "exchange in currency must be TRY");
    assert(amountsEqual(inTxn.amount, 3850), "exchange in amount must be 3850");
    assert(amountsEqual(inTxn.amount_base, 3850), "exchange in amount_base must be 3850");
    assert(toNumber(inTxn.posted_journal_entry_id) > 0, "exchange in must have posted journal");

    const persistedBatch = await fetchExchangeBatchById({
      tenantId: identity.tenantId,
      exchangeBatchId,
    });
    assert(Boolean(persistedBatch), "persisted exchange batch must exist");
    assert(asUpper(persistedBatch.status) === "POSTED", "persisted exchange batch must be POSTED");
    assert(
      toNumber(persistedBatch.exchange_out_cash_transaction_id) === outTxnId,
      "persisted exchange out txn id must match"
    );
    assert(
      toNumber(persistedBatch.exchange_in_cash_transaction_id) === inTxnId,
      "persisted exchange in txn id must match"
    );
    assert(
      amountsEqual(persistedBatch.source_amount_base, 3850),
      "source_amount_base must be persisted as 3850"
    );
    assert(
      amountsEqual(persistedBatch.target_amount_base, 3850),
      "target_amount_base must be persisted as 3850"
    );

    const getRes = await getCashExchange({
      token,
      tenantId: identity.tenantId,
      exchangeBatchId,
      expectedStatus: 200,
    });
    assert(
      toNumber(getRes.json?.batch?.id) === exchangeBatchId,
      "GET exchange by id must return same batch id"
    );
    assert(
      toNumber(getRes.json?.exchangeOutTransaction?.id) === outTxnId,
      "GET exchange must return same exchangeOutTransaction id"
    );
    assert(
      toNumber(getRes.json?.exchangeInTransaction?.id) === inTxnId,
      "GET exchange must return same exchangeInTransaction id"
    );

    const listRes = await listCashExchanges({
      token,
      tenantId: identity.tenantId,
      legalEntityId: setup.legalEntityId,
      expectedStatus: 200,
    });
    const listRows = Array.isArray(listRes.json?.rows) ? listRes.json.rows : [];
    assert(listRows.length >= 1, "List endpoint must return at least one batch");
    const listed = listRows.find((row) => toNumber(row?.id) === exchangeBatchId);
    assert(Boolean(listed), "List endpoint must include created exchange batch");

    const replayCreateRes = await createCashExchange({
      token,
      tenantId: identity.tenantId,
      sourceRegisterId: setup.sourceRegisterId,
      targetRegisterId: setup.targetRegisterId,
      clearingAccountId: setup.clearingAccountId,
      sourceAmountTxn: "100.00",
      targetAmountTxn: "3850.00",
      idempotencyKey: `EX03-CREATE-${identity.stamp}`,
      expectedStatus: 200,
    });
    assert(
      replayCreateRes.json?.idempotentReplay === true,
      "duplicate create must return idempotent replay"
    );
    assert(
      toNumber(replayCreateRes.json?.batch?.id) === exchangeBatchId,
      "duplicate create must return same exchange batch id"
    );
    assert(
      toNumber(replayCreateRes.json?.exchangeOutTransaction?.id) === outTxnId,
      "duplicate create must return same exchange out transaction id"
    );
    assert(
      toNumber(replayCreateRes.json?.exchangeInTransaction?.id) === inTxnId,
      "duplicate create must return same exchange in transaction id"
    );

    const reverseRes = await reverseCashExchange({
      token,
      tenantId: identity.tenantId,
      exchangeBatchId,
      reverseReason: "EX03 reverse for deterministic audit trail",
      expectedStatus: 200,
    });
    assert(reverseRes.json?.idempotentReplay === false, "first reverse must not replay");
    assert(
      asUpper(reverseRes.json?.batch?.status) === "REVERSED",
      "reverse must set batch status to REVERSED"
    );

    const reversalOutTxnId = toNumber(reverseRes.json?.reversalOutTransaction?.id);
    const reversalInTxnId = toNumber(reverseRes.json?.reversalInTransaction?.id);
    assert(reversalOutTxnId > 0, "reversalOutTransaction id is required");
    assert(reversalInTxnId > 0, "reversalInTransaction id is required");

    const reversalOutTxn = await fetchCashTransactionById({
      tenantId: identity.tenantId,
      transactionId: reversalOutTxnId,
    });
    assert(Boolean(reversalOutTxn), "reversal out transaction must exist");
    assert(asUpper(reversalOutTxn.status) === "POSTED", "reversal out must be POSTED");
    assert(
      toNumber(reversalOutTxn.reversal_of_transaction_id) === outTxnId,
      "reversal out must point to original exchange out transaction"
    );

    const reversalInTxn = await fetchCashTransactionById({
      tenantId: identity.tenantId,
      transactionId: reversalInTxnId,
    });
    assert(Boolean(reversalInTxn), "reversal in transaction must exist");
    assert(asUpper(reversalInTxn.status) === "POSTED", "reversal in must be POSTED");
    assert(
      toNumber(reversalInTxn.reversal_of_transaction_id) === inTxnId,
      "reversal in must point to original exchange in transaction"
    );

    const reversedBatch = await fetchExchangeBatchById({
      tenantId: identity.tenantId,
      exchangeBatchId,
    });
    assert(Boolean(reversedBatch), "reversed batch must exist");
    assert(asUpper(reversedBatch.status) === "REVERSED", "batch must persist REVERSED status");
    assert(
      toNumber(reversedBatch.reversal_out_cash_transaction_id) === reversalOutTxnId,
      "reversal_out_cash_transaction_id must be persisted"
    );
    assert(
      toNumber(reversedBatch.reversal_in_cash_transaction_id) === reversalInTxnId,
      "reversal_in_cash_transaction_id must be persisted"
    );
    assert(
      String(reversedBatch.reverse_reason || "").includes("EX03 reverse"),
      "reverse_reason must be persisted"
    );

    const reverseReplayRes = await reverseCashExchange({
      token,
      tenantId: identity.tenantId,
      exchangeBatchId,
      reverseReason: "EX03 reverse replay",
      expectedStatus: 200,
    });
    assert(
      reverseReplayRes.json?.idempotentReplay === true,
      "second reverse call must idempotently replay"
    );
    assert(
      toNumber(reverseReplayRes.json?.reversalOutTransaction?.id) === reversalOutTxnId,
      "reverse replay must return same reversal out id"
    );
    assert(
      toNumber(reverseReplayRes.json?.reversalInTransaction?.id) === reversalInTxnId,
      "reverse replay must return same reversal in id"
    );

    console.log("PR-EX03 explicit cash exchange workflow smoke test passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: setup.legalEntityId,
          bookId: setup.bookId,
          exchangeBatchId,
          outTxnId,
          inTxnId,
          reversalOutTxnId,
          reversalInTxnId,
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill("SIGINT");
      serverStopped = true;
    }
    await sleep(400);
    await closePool();
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("PR-EX03 cash exchange workflow test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
