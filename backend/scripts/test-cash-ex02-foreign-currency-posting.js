import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CASH_EX02_TEST_PORT || 3116);
const BASE_URL = process.env.CASH_EX02_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const BOOK_DATE = "2026-06-15";
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
  const tenantCode = `CASHEX02_${stamp}`;
  const tenantName = `Cash EX02 ${stamp}`;
  const adminEmail = `cash_ex02_admin_${stamp}@example.com`;
  const password = "CashEX02#12345";
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
    [tenantId, adminEmail, passwordHash, "Cash EX02 Admin"]
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
      ownershipScope: operatingUnitId ? "OPERATING_UNIT" : "CENTRAL",
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

async function createCashTransaction({
  token,
  tenantId,
  registerId,
  txnType,
  amount,
  currencyCode,
  counterAccountId,
  idempotencyKey,
  bookDate = BOOK_DATE,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: "/api/v1/cash/transactions",
    body: {
      tenantId,
      registerId,
      txnType,
      amount,
      currencyCode,
      counterAccountId,
      idempotencyKey,
      bookDate,
      description: `EX02 ${txnType}`,
    },
    expectedStatus,
  });
}

async function postCashTransaction({
  token,
  tenantId,
  transactionId,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: `/api/v1/cash/transactions/${transactionId}/post`,
    body: {
      tenantId,
    },
    expectedStatus,
  });
}

async function reverseCashTransaction({
  token,
  tenantId,
  transactionId,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: `/api/v1/cash/transactions/${transactionId}/reverse`,
    body: {
      tenantId,
      reverseReason: "EX02 reversal check",
    },
    expectedStatus,
  });
}

async function bootstrapFxPostingContext(token, identity) {
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
      code: `CGEX02${identity.stamp}`,
      name: `Cash EX02 Group ${identity.stamp}`,
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
      code: `CALEX02${identity.stamp}`,
      name: `Cash EX02 Calendar ${identity.stamp}`,
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
      code: `LEEX02${identity.stamp}`,
      name: `Cash EX02 LE ${identity.stamp}`,
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
      code: `OUEX02${identity.stamp}`,
      name: `Cash EX02 OU ${identity.stamp}`,
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
      code: `BOOKEX02${identity.stamp}`,
      name: `Cash EX02 Book ${identity.stamp}`,
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
      code: `COAEX02${identity.stamp}`,
      name: `Cash EX02 CoA ${identity.stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  const registerUsdAccountId = await createAccount({
    token,
    coaId,
    code: `CRUSD${identity.stamp}`,
    name: "Cash Register USD",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const registerTryAccountId = await createAccount({
    token,
    coaId,
    code: `CRTRY${identity.stamp}`,
    name: "Cash Register TRY",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const counterExpenseAccountId = await createAccount({
    token,
    coaId,
    code: `CEX02${identity.stamp}`,
    name: "Cash Counter Expense",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  });

  const usdRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId,
    accountId: registerUsdAccountId,
    code: `RGUSD${identity.stamp}`,
    name: "USD Register",
    currencyCode: "USD",
  });
  const tryRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId,
    accountId: registerTryAccountId,
    code: `RGTRY${identity.stamp}`,
    name: "TRY Register",
    currencyCode: "TRY",
  });

  await query(
    `INSERT INTO fx_rates (
       tenant_id, rate_date, from_currency_code, to_currency_code, rate_type, rate, source, is_locked
     ) VALUES (?, ?, 'USD', 'TRY', 'SPOT', ?, 'EX02_TEST', 0)
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       source = VALUES(source)`,
    [identity.tenantId, BOOK_DATE, FX_USD_TRY]
  );

  return {
    legalEntityId,
    bookId,
    operatingUnitId,
    counterExpenseAccountId,
    usdRegisterId,
    tryRegisterId,
  };
}

async function fetchJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
       line_no,
       account_id,
       currency_code,
       amount_txn,
       debit_base,
       credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}

async function assertPostedCashJournal({
  tenantId,
  transactionId,
  expectedCurrencyCode,
  expectedTxnAmount,
  expectedBaseAmount,
}) {
  const cashTxnResult = await query(
    `SELECT status, posted_journal_entry_id
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, transactionId]
  );
  const cashTxn = cashTxnResult.rows?.[0] || null;
  assert(Boolean(cashTxn), `cash_transactions row missing for id=${transactionId}`);
  assert(asUpper(cashTxn.status) === "POSTED", "Cash transaction must be POSTED");
  const journalEntryId = toNumber(cashTxn.posted_journal_entry_id);
  assert(journalEntryId > 0, "posted_journal_entry_id must be populated");

  const journalResult = await query(
    `SELECT source_type, status, currency_code, total_debit_base, total_credit_base
     FROM journal_entries
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [journalEntryId, tenantId]
  );
  const journal = journalResult.rows?.[0] || null;
  assert(Boolean(journal), `Journal not found for id=${journalEntryId}`);
  assert(asUpper(journal.source_type) === "CASH", "Journal source_type must be CASH");
  assert(asUpper(journal.status) === "POSTED", "Journal status must be POSTED");
  assert(asUpper(journal.currency_code) === asUpper(expectedCurrencyCode), "Journal currency mismatch");
  assert(
    amountsEqual(journal.total_debit_base, expectedBaseAmount),
    `Journal total_debit_base mismatch, expected=${expectedBaseAmount}, got=${journal.total_debit_base}`
  );
  assert(
    amountsEqual(journal.total_credit_base, expectedBaseAmount),
    `Journal total_credit_base mismatch, expected=${expectedBaseAmount}, got=${journal.total_credit_base}`
  );

  const lines = await fetchJournalLines(journalEntryId);
  assert(lines.length >= 2, "Cash journal must have at least 2 lines");
  for (const line of lines) {
    assert(
      asUpper(line.currency_code) === asUpper(expectedCurrencyCode),
      "Journal line currency mismatch"
    );
  }
  const signedTxnAmounts = lines.map((line) => Number(line.amount_txn || 0)).sort((a, b) => a - b);
  assert(
    signedTxnAmounts.length >= 2 &&
      amountsEqual(signedTxnAmounts[0], Number(expectedTxnAmount) * -1) &&
      amountsEqual(signedTxnAmounts[signedTxnAmounts.length - 1], Number(expectedTxnAmount)),
    "journal_lines.amount_txn must be signed transaction currency amount"
  );

  return {
    journalEntryId,
    lines,
  };
}

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

async function main() {
  const identity = await createTenantAndAdmin();
  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const token = await login(identity.adminEmail, identity.password);
    const setup = await bootstrapFxPostingContext(token, identity);

    const createUsdRes = await createCashTransaction({
      token,
      tenantId: identity.tenantId,
      registerId: setup.usdRegisterId,
      txnType: "RECEIPT",
      amount: "100.00",
      currencyCode: "USD",
      counterAccountId: setup.counterExpenseAccountId,
      idempotencyKey: `EX02-USD-RECEIPT-${identity.stamp}`,
      expectedStatus: 200,
    });
    const usdDraft = createUsdRes.json?.row || null;
    const usdTxnId = toNumber(usdDraft?.id);
    assert(usdTxnId > 0, "USD draft transaction was not created");
    assert(amountsEqual(usdDraft?.amount, 100), "USD draft amount must be 100");
    assert(amountsEqual(usdDraft?.amount_base, 3850), "USD draft amount_base must derive from FX");
    assert(amountsEqual(usdDraft?.fx_rate, FX_USD_TRY), "USD draft fx_rate must come from fx_rates");
    assert(
      asUpper(usdDraft?.fx_rate_source) === "FX_TABLE_EXACT_SPOT",
      `USD draft fx_rate_source mismatch: ${usdDraft?.fx_rate_source}`
    );
    const usdFxDateResult = await query(
      `SELECT DATE_FORMAT(fx_rate_date, '%Y-%m-%d') AS fx_rate_date_text
       FROM cash_transactions
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [identity.tenantId, usdTxnId]
    );
    assert(
      String(usdFxDateResult.rows?.[0]?.fx_rate_date_text || "") === BOOK_DATE,
      "USD draft fx_rate_date must match exact-rate date"
    );

    const postUsdRes = await postCashTransaction({
      token,
      tenantId: identity.tenantId,
      transactionId: usdTxnId,
      expectedStatus: 200,
    });
    const postedUsd = postUsdRes.json?.row || null;
    assert(asUpper(postedUsd?.status) === "POSTED", "USD transaction must post successfully");

    const usdPosting = await assertPostedCashJournal({
      tenantId: identity.tenantId,
      transactionId: usdTxnId,
      expectedCurrencyCode: "USD",
      expectedTxnAmount: 100,
      expectedBaseAmount: 3850,
    });

    const reverseUsdRes = await reverseCashTransaction({
      token,
      tenantId: identity.tenantId,
      transactionId: usdTxnId,
      expectedStatus: 200,
    });
    const reversedOriginal = reverseUsdRes.json?.original || null;
    const usdReversal = reverseUsdRes.json?.reversal || null;
    const usdReversalTxnId = toNumber(usdReversal?.id);
    assert(usdReversalTxnId > 0, "USD reversal transaction id missing");
    assert(asUpper(reversedOriginal?.status) === "REVERSED", "Original USD txn must be REVERSED");
    assert(asUpper(usdReversal?.status) === "POSTED", "USD reversal must be POSTED");
    assert(
      amountsEqual(usdReversal?.amount_base, usdDraft?.amount_base),
      "USD reversal must preserve original amount_base"
    );
    assert(
      amountsEqual(usdReversal?.fx_rate, usdDraft?.fx_rate),
      "USD reversal must preserve original fx_rate"
    );

    const reversalPosting = await assertPostedCashJournal({
      tenantId: identity.tenantId,
      transactionId: usdReversalTxnId,
      expectedCurrencyCode: "USD",
      expectedTxnAmount: 100,
      expectedBaseAmount: 3850,
    });

    const netByAccount = await query(
      `SELECT
         account_id,
         ROUND(SUM(debit_base - credit_base), 6) AS net_base,
         ROUND(SUM(amount_txn), 6) AS net_txn
       FROM journal_lines
       WHERE journal_entry_id IN (?, ?)
       GROUP BY account_id`,
      [usdPosting.journalEntryId, reversalPosting.journalEntryId]
    );
    for (const row of netByAccount.rows || []) {
      assert(
        amountsEqual(row.net_base, 0),
        `USD reverse net_base must be zero per account, account=${row.account_id}, net_base=${row.net_base}`
      );
      assert(
        amountsEqual(row.net_txn, 0),
        `USD reverse net_txn must be zero per account, account=${row.account_id}, net_txn=${row.net_txn}`
      );
    }

    const createTryRes = await createCashTransaction({
      token,
      tenantId: identity.tenantId,
      registerId: setup.tryRegisterId,
      txnType: "RECEIPT",
      amount: "50.00",
      currencyCode: "TRY",
      counterAccountId: setup.counterExpenseAccountId,
      idempotencyKey: `EX02-TRY-RECEIPT-${identity.stamp}`,
      expectedStatus: 200,
    });
    const tryDraft = createTryRes.json?.row || null;
    const tryTxnId = toNumber(tryDraft?.id);
    assert(tryTxnId > 0, "TRY draft transaction was not created");
    assert(amountsEqual(tryDraft?.amount_base, 50), "TRY draft amount_base must equal amount");
    assert(amountsEqual(tryDraft?.fx_rate, 1), "TRY draft fx_rate must be 1");
    assert(asUpper(tryDraft?.fx_rate_source) === "PARITY", "TRY draft fx_rate_source must be PARITY");

    const postTryRes = await postCashTransaction({
      token,
      tenantId: identity.tenantId,
      transactionId: tryTxnId,
      expectedStatus: 200,
    });
    const postedTry = postTryRes.json?.row || null;
    assert(asUpper(postedTry?.status) === "POSTED", "TRY transaction must post successfully");

    await assertPostedCashJournal({
      tenantId: identity.tenantId,
      transactionId: tryTxnId,
      expectedCurrencyCode: "TRY",
      expectedTxnAmount: 50,
      expectedBaseAmount: 50,
    });

    console.log("PR-EX02 foreign-currency cash posting smoke test passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: setup.legalEntityId,
          bookId: setup.bookId,
          usdTxnId,
          usdReversalTxnId,
          tryTxnId,
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
    console.error(err);
    process.exitCode = 1;
  });
