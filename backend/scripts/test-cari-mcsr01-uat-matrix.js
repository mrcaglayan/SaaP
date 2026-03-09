import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CARI_MCSR01_TEST_PORT || 3120);
const BASE_URL =
  process.env.CARI_MCSR01_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_PASSWORD = "CariMcsr01#12345";
const TEST_FISCAL_YEAR = 2026;
const DOCUMENT_DATE = "2026-09-05";
const DUE_DATE = "2026-09-30";
const SETTLEMENT_DATE = "2026-09-20";
const LOCAL_CURRENCY = "TRY";
const EPSILON = 0.000001;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function up(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function round6(value) {
  return Number(num(value).toFixed(6));
}

function eq(left, right, epsilon = EPSILON) {
  return Math.abs(num(left) - num(right)) <= epsilon;
}

async function apiRequest({
  token,
  method = "GET",
  requestPath,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Cookie = token;

  const response = await fetch(`${BASE_URL}${requestPath}`, {
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

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${requestPath} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }

  const setCookieHeader = response.headers.get("set-cookie");
  const cookie = setCookieHeader
    ? String(setCookieHeader).split(";")[0].trim()
    : null;

  return { status: response.status, json, cookie };
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      CARI_SETTLEMENT_FX_FALLBACK_MODE: "EXACT_ONLY",
      CARI_SETTLEMENT_FX_FALLBACK_MAX_DAYS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  return child;
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // wait for startup
    }
    await sleep(350);
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function login(email, password) {
  const res = await apiRequest({
    method: "POST",
    requestPath: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(Boolean(res.cookie), `Login cookie missing for ${email}`);
  return res.cookie;
}

async function createTenant(code, name) {
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
  const tenantId = num(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant id for ${code}`);
  return tenantId;
}

async function createUserWithRole({
  tenantId,
  roleCode,
  email,
  passwordHash,
  name,
}) {
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
  const userId = num(userResult.rows?.[0]?.id);
  assert(userId > 0, `Failed to resolve user id for ${email}`);

  const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = num(roleResult.rows?.[0]?.id);
  assert(roleId > 0, `Role not found: ${roleCode}`);

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

  return { userId, email };
}

async function postApi(token, requestPath, body, expectedStatus = 201) {
  return apiRequest({
    token,
    method: "POST",
    requestPath,
    body,
    expectedStatus,
  });
}

async function bootstrap(token, stamp) {
  const countryResult = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'TR'
     LIMIT 1`
  );
  const countryId = num(countryResult.rows?.[0]?.id);
  assert(countryId > 0, "TR country row is required");

  const group = await postApi(token, "/api/v1/org/group-companies", {
    code: `MCSR1GC${stamp}`,
    name: `MCSR1 Group ${stamp}`,
  });
  const groupCompanyId = num(group.json?.id);
  assert(groupCompanyId > 0, "groupCompanyId missing");

  const calendar = await postApi(token, "/api/v1/org/fiscal-calendars", {
    code: `MCSR1CAL${stamp}`,
    name: `MCSR1 Calendar ${stamp}`,
    yearStartMonth: 1,
    yearStartDay: 1,
  });
  const calendarId = num(calendar.json?.id);
  assert(calendarId > 0, "calendarId missing");

  await postApi(token, "/api/v1/org/fiscal-periods/generate", {
    calendarId,
    fiscalYear: TEST_FISCAL_YEAR,
  });

  const entity = await postApi(token, "/api/v1/org/legal-entities", {
    groupCompanyId,
    code: `MCSR1LE${stamp}`,
    name: `MCSR1 Legal Entity ${stamp}`,
    countryId,
    functionalCurrencyCode: LOCAL_CURRENCY,
  });
  const legalEntityId = num(entity.json?.id);
  assert(legalEntityId > 0, "legalEntityId missing");

  const ou = await postApi(token, "/api/v1/org/operating-units", {
    legalEntityId,
    code: `MCSR1OU${stamp}`,
    name: `MCSR1 OU ${stamp}`,
    unitType: "BRANCH",
    hasSubledger: true,
  });
  const operatingUnitId = num(ou.json?.id);
  assert(operatingUnitId > 0, "operatingUnitId missing");

  const book = await postApi(token, "/api/v1/gl/books", {
    legalEntityId,
    calendarId,
    code: `MCSR1BOOK${stamp}`,
    name: `MCSR1 Book ${stamp}`,
    bookType: "LOCAL",
    baseCurrencyCode: LOCAL_CURRENCY,
  });
  const bookId = num(book.json?.id);
  assert(bookId > 0, "bookId missing");

  const coa = await postApi(token, "/api/v1/gl/coas", {
    scope: "LEGAL_ENTITY",
    legalEntityId,
    code: `MCSR1COA${stamp}`,
    name: `MCSR1 CoA ${stamp}`,
  });
  const coaId = num(coa.json?.id);
  assert(coaId > 0, "coaId missing");

  return { legalEntityId, operatingUnitId, bookId, coaId };
}

async function createAccount(token, coaId, code, name, accountType, normalSide) {
  const res = await postApi(token, "/api/v1/gl/accounts", {
    coaId,
    code,
    name,
    accountType,
    normalSide,
    allowPosting: true,
  });
  const accountId = num(res.json?.id);
  assert(accountId > 0, `Account create failed for ${code}`);
  return accountId;
}

async function createRegister(
  token,
  tenantId,
  legalEntityId,
  operatingUnitId,
  accountId,
  code,
  name,
  currencyCode
) {
  const res = await postApi(
    token,
    "/api/v1/cash/registers",
    {
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
    200
  );
  const registerId = num(res.json?.row?.id);
  assert(registerId > 0, `Register create failed for ${code}`);
  return registerId;
}

async function createPaymentTerm(tenantId, legalEntityId, code, name) {
  await query(
    `INSERT INTO payment_terms (
        tenant_id, legal_entity_id, code, name, due_days, grace_days, status
     )
     VALUES (?, ?, ?, ?, 30, 0, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name]
  );
  const res = await query(
    `SELECT id
     FROM payment_terms
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const paymentTermId = num(res.rows?.[0]?.id);
  assert(paymentTermId > 0, "Payment term create failed");
  return paymentTermId;
}

async function createCounterparty({
  tenantId,
  legalEntityId,
  code,
  name,
  paymentTermId,
  isCustomer,
  isVendor,
}) {
  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        default_payment_term_id,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name, isCustomer ? 1 : 0, isVendor ? 1 : 0, paymentTermId]
  );
  const res = await query(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const counterpartyId = num(res.rows?.[0]?.id);
  assert(counterpartyId > 0, `Counterparty create failed for ${code}`);
  return counterpartyId;
}

async function upsertCariPurposeMappings({
  tenantId,
  legalEntityId,
  arControlAccountId,
  arOffsetAccountId,
  apControlAccountId,
  apOffsetAccountId,
}) {
  await query(
    `INSERT INTO journal_purpose_accounts (tenant_id, legal_entity_id, purpose_code, account_id)
     VALUES
       (?, ?, 'CARI_AR_CONTROL', ?),
       (?, ?, 'CARI_AR_OFFSET', ?),
       (?, ?, 'CARI_AP_CONTROL', ?),
       (?, ?, 'CARI_AP_OFFSET', ?)
     ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
    [
      tenantId,
      legalEntityId,
      arControlAccountId,
      tenantId,
      legalEntityId,
      arOffsetAccountId,
      tenantId,
      legalEntityId,
      apControlAccountId,
      tenantId,
      legalEntityId,
      apOffsetAccountId,
    ]
  );
}

async function insertFxRate(tenantId, rateDate, fromCurrencyCode, toCurrencyCode, rate) {
  await query(
    `INSERT INTO fx_rates (
        tenant_id, rate_date, from_currency_code, to_currency_code, rate_type, rate, source, is_locked
     )
     VALUES (?, ?, ?, ?, 'SPOT', ?, 'MCSR01_TEST', FALSE)
     ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source), is_locked = VALUES(is_locked)`,
    [tenantId, rateDate, fromCurrencyCode, toCurrencyCode, rate]
  );
}

async function createAndPostDocument({
  token,
  tenantId,
  legalEntityId,
  counterpartyId,
  paymentTermId,
  direction,
  currencyCode,
  amountTxn,
  amountBase,
  fxRate,
}) {
  const created = await postApi(token, "/api/v1/cari/documents", {
    legalEntityId,
    counterpartyId,
    paymentTermId,
    direction,
    documentType: "INVOICE",
    documentDate: DOCUMENT_DATE,
    dueDate: DUE_DATE,
    amountTxn,
    amountBase,
    currencyCode,
    fxRate,
  });
  const documentId = num(created.json?.row?.id);
  assert(documentId > 0, "Document id missing");

  await postApi(token, `/api/v1/cari/documents/${documentId}/post`, {}, 200);

  const openItemResult = await query(
    `SELECT id
     FROM cari_open_items
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND document_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, documentId]
  );
  const openItemId = num(openItemResult.rows?.[0]?.id);
  assert(openItemId > 0, "Open item missing after post");
  return { documentId, openItemId };
}

function createUatMatrix() {
  const directions = ["AR", "AP"];
  const channels = ["MANUAL", "CASH_LINKED"];
  const scenarios = [];
  for (const direction of directions) {
    for (const channel of channels) {
      scenarios.push({ direction, channel, docKind: "LOCAL", settleKind: "LOCAL", mode: "N/A" });
      scenarios.push({ direction, channel, docKind: "LOCAL", settleKind: "FOREIGN", mode: "N/A" });
      scenarios.push({ direction, channel, docKind: "FOREIGN", settleKind: "LOCAL", mode: "N/A" });
      scenarios.push({
        direction,
        channel,
        docKind: "FOREIGN",
        settleKind: "FOREIGN",
        mode: "SAME_FOREIGN",
      });
      scenarios.push({
        direction,
        channel,
        docKind: "FOREIGN",
        settleKind: "FOREIGN",
        mode: "DIFFERENT_FOREIGN",
      });
    }
  }
  return scenarios.map((s) => ({
    ...s,
    id: `${s.direction}_${s.channel}_${s.docKind}_${s.settleKind}_${s.mode}`,
  }));
}

function resolveCurrencies(scenario) {
  if (scenario.docKind === "LOCAL" && scenario.settleKind === "LOCAL") {
    return { documentCurrencyCode: "TRY", settlementCurrencyCode: "TRY" };
  }
  if (scenario.docKind === "LOCAL" && scenario.settleKind === "FOREIGN") {
    return {
      documentCurrencyCode: "TRY",
      settlementCurrencyCode: scenario.direction === "AR" ? "USD" : "EUR",
    };
  }
  if (scenario.docKind === "FOREIGN" && scenario.settleKind === "LOCAL") {
    return {
      documentCurrencyCode: scenario.direction === "AR" ? "USD" : "EUR",
      settlementCurrencyCode: "TRY",
    };
  }
  if (scenario.docKind === "FOREIGN" && scenario.settleKind === "FOREIGN") {
    if (scenario.mode === "SAME_FOREIGN") {
      return { documentCurrencyCode: "USD", settlementCurrencyCode: "USD" };
    }
    return { documentCurrencyCode: "USD", settlementCurrencyCode: "EUR" };
  }
  throw new Error(`Unsupported scenario: ${scenario.id}`);
}

function docSnapshotRate(currencyCode) {
  const map = { TRY: 1, USD: 38, EUR: 42 };
  return num(map[up(currencyCode)]);
}

function settlementFunctionalRate(currencyCode) {
  const map = { TRY: 1, USD: 40, EUR: 44 };
  return num(map[up(currencyCode)]);
}

function deriveCrossRate(settlementCurrencyCode, documentCurrencyCode) {
  const settlement = up(settlementCurrencyCode);
  const document = up(documentCurrencyCode);
  if (settlement === document) return 1;
  return Number(
    (
      settlementFunctionalRate(settlementCurrencyCode) /
      settlementFunctionalRate(documentCurrencyCode)
    ).toFixed(10)
  );
}

function expectedCrossRateSource(settlementCurrencyCode, documentCurrencyCode) {
  const settlement = up(settlementCurrencyCode);
  const document = up(documentCurrencyCode);
  if (settlement === document) return "PARITY";
  if (document === LOCAL_CURRENCY && settlement !== LOCAL_CURRENCY) return "FX_TABLE_EXACT_SPOT";
  return "DERIVED_VIA_FUNCTIONAL";
}

async function runScenario({
  token,
  tenantId,
  legalEntityId,
  paymentTermId,
  customerCounterpartyId,
  vendorCounterpartyId,
  linkedCashCounterAccountId,
  registerByCurrency,
  scenario,
  scenarioIndex,
  stamp,
}) {
  const { documentCurrencyCode, settlementCurrencyCode } = resolveCurrencies(scenario);
  const direction = scenario.direction;
  const counterpartyId = direction === "AR" ? customerCounterpartyId : vendorCounterpartyId;
  const amountDocTxn = documentCurrencyCode === LOCAL_CURRENCY ? 4000 : 100;
  const docFxRate = docSnapshotRate(documentCurrencyCode);
  const amountDocBase = round6(amountDocTxn * docFxRate);
  const crossRate = deriveCrossRate(settlementCurrencyCode, documentCurrencyCode);
  const amountSettlementTxn = round6(amountDocTxn / crossRate);

  const doc = await createAndPostDocument({
    token,
    tenantId,
    legalEntityId,
    counterpartyId,
    paymentTermId,
    direction,
    currencyCode: documentCurrencyCode,
    amountTxn: amountDocTxn,
    amountBase: amountDocBase,
    fxRate: docFxRate,
  });

  const suffix = `${stamp}-${String(scenarioIndex + 1).padStart(2, "0")}`;
  const body = {
    legalEntityId,
    counterpartyId,
    direction,
    settlementDate: SETTLEMENT_DATE,
    currencyCode: settlementCurrencyCode,
    incomingAmountTxn: amountSettlementTxn,
    idempotencyKey: `MCSR01-APPLY-${scenario.id}-${suffix}`,
    autoAllocate: false,
    useUnappliedCash: false,
    allocations: [{ openItemId: doc.openItemId, amountTxn: amountDocTxn }],
    paymentChannel: scenario.channel === "CASH_LINKED" ? "CASH" : "MANUAL",
  };
  if (scenario.channel === "CASH_LINKED") {
    const registerId = registerByCurrency[up(settlementCurrencyCode)];
    assert(registerId > 0, `Missing register for ${settlementCurrencyCode}`);
    body.linkedCashTransaction = {
      registerId,
      counterAccountId: linkedCashCounterAccountId,
      bookDate: SETTLEMENT_DATE,
      txnDatetime: `${SETTLEMENT_DATE}T10:00:00`,
      idempotencyKey: `MCSR01-CASH-${scenario.id}-${suffix}`,
      integrationEventUid: `MCSR01-CASH-EVT-${scenario.id}-${suffix}`,
      description: `MCSR01 linked cash ${scenario.id}`,
    };
  }

  let applied;
  try {
    applied = await postApi(token, "/api/v1/cari/settlements/apply", body, 201);
  } catch (error) {
    const debugContext = {
      scenarioId: scenario.id,
      direction,
      channel: scenario.channel,
      documentCurrencyCode,
      settlementCurrencyCode,
      amountDocTxn,
      crossRate,
      amountSettlementTxn,
      incomingAmountTxn: body.incomingAmountTxn,
      paymentChannel: body.paymentChannel,
    };
    throw new Error(
      `Settlement apply failed for ${scenario.id}: ${error?.message || String(error)} | ctx=${JSON.stringify(
        debugContext
      )}`
    );
  }
  const settlementBatchId = num(applied.json?.row?.id);
  assert(settlementBatchId > 0, `Settlement batch id missing for ${scenario.id}`);

  const settlementRes = await query(
    `SELECT id, status, currency_code, cash_transaction_id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, settlementBatchId]
  );
  const settlementRow = settlementRes.rows?.[0] || null;
  assert(Boolean(settlementRow), `Settlement row missing for ${scenario.id}`);
  assert(up(settlementRow.status) === "POSTED", `Settlement must be POSTED for ${scenario.id}`);
  assert(
    up(settlementRow.currency_code) === up(settlementCurrencyCode),
    `Settlement currency mismatch for ${scenario.id}`
  );

  const allocationRes = await query(
    `SELECT
       allocation_amount_doc_txn,
       allocation_amount_settlement_txn,
       document_currency_code,
       settlement_currency_code,
       applied_cross_rate,
       cross_rate_source
     FROM cari_settlement_allocations
     WHERE tenant_id = ?
       AND settlement_batch_id = ?`,
    [tenantId, settlementBatchId]
  );
  const allocationRows = allocationRes.rows || [];
  assert(allocationRows.length === 1, `Expected 1 allocation row for ${scenario.id}`);
  const allocation = allocationRows[0];

  assert(
    eq(allocation.allocation_amount_doc_txn, amountDocTxn),
    `allocation_amount_doc_txn mismatch for ${scenario.id}`
  );
  assert(
    eq(allocation.allocation_amount_settlement_txn, amountSettlementTxn),
    `allocation_amount_settlement_txn mismatch for ${scenario.id}`
  );
  assert(
    up(allocation.document_currency_code) === up(documentCurrencyCode),
    `document_currency_code mismatch for ${scenario.id}`
  );
  assert(
    up(allocation.settlement_currency_code) === up(settlementCurrencyCode),
    `settlement_currency_code mismatch for ${scenario.id}`
  );
  assert(
    eq(
      num(allocation.allocation_amount_settlement_txn) * num(allocation.applied_cross_rate),
      num(allocation.allocation_amount_doc_txn),
      0.00001
    ),
    `Cross-rate multiplication mismatch for ${scenario.id}`
  );

  const expectedSource = expectedCrossRateSource(settlementCurrencyCode, documentCurrencyCode);
  const actualSource = up(allocation.cross_rate_source);
  if (expectedSource === "PARITY") {
    assert(actualSource === "PARITY", `Expected PARITY for ${scenario.id}, got ${actualSource}`);
    assert(eq(allocation.applied_cross_rate, 1), `Expected rate=1 for ${scenario.id}`);
  } else {
    assert(
      actualSource === expectedSource,
      `Expected ${expectedSource} for ${scenario.id}, got ${actualSource}`
    );
  }

  const openItemRes = await query(
    `SELECT residual_amount_txn
     FROM cari_open_items
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, doc.openItemId]
  );
  const residualTxn = num(openItemRes.rows?.[0]?.residual_amount_txn);
  assert(eq(residualTxn, 0), `Open item residual must be zero for ${scenario.id}`);

  let linkedCashTransactionId = null;
  if (scenario.channel === "CASH_LINKED") {
    linkedCashTransactionId =
      num(applied.json?.row?.cashTransactionId) || num(settlementRow.cash_transaction_id);
    assert(
      linkedCashTransactionId > 0,
      `Linked cash transaction id missing for ${scenario.id}`
    );
    const cashRes = await query(
      `SELECT status, txn_type, currency_code
       FROM cash_transactions
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, linkedCashTransactionId]
    );
    const cashRow = cashRes.rows?.[0] || null;
    assert(Boolean(cashRow), `Cash transaction missing for ${scenario.id}`);
    assert(up(cashRow.status) === "POSTED", `Cash txn must be POSTED for ${scenario.id}`);
    assert(
      up(cashRow.currency_code) === up(settlementCurrencyCode),
      `Cash txn currency mismatch for ${scenario.id}`
    );
    const expectedTxnType = direction === "AR" ? "RECEIPT" : "PAYOUT";
    assert(
      up(cashRow.txn_type) === expectedTxnType,
      `Cash txn type mismatch for ${scenario.id}`
    );
  }

  return {
    scenarioId: scenario.id,
    direction,
    channel: scenario.channel,
    documentCurrencyCode,
    settlementCurrencyCode,
    amountDocTxn,
    amountSettlementTxn,
    crossRateSource: allocation.cross_rate_source,
    settlementBatchId,
    linkedCashTransactionId,
  };
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });
  const stamp = Date.now();
  const tenantId = await createTenant(`MCSR01_${stamp}`, `MCSR01 Tenant ${stamp}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await createUserWithRole({
    tenantId,
    roleCode: "TenantAdmin",
    email: `mcsr01_admin_${stamp}@example.com`,
    passwordHash,
    name: "MCSR01 Admin",
  });

  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const token = await login(user.email, TEST_PASSWORD);
    const base = await bootstrap(token, stamp);

    const arControlAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_ARC_${String(stamp).slice(-5)}`,
      "MCSR1 AR Control",
      "ASSET",
      "DEBIT"
    );
    const arOffsetAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_ARO_${String(stamp).slice(-5)}`,
      "MCSR1 AR Offset",
      "REVENUE",
      "CREDIT"
    );
    const apControlAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_APC_${String(stamp).slice(-5)}`,
      "MCSR1 AP Control",
      "LIABILITY",
      "CREDIT"
    );
    const apOffsetAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_APO_${String(stamp).slice(-5)}`,
      "MCSR1 AP Offset",
      "EXPENSE",
      "DEBIT"
    );

    const registerTryAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_REGTRY_${String(stamp).slice(-4)}`,
      "MCSR1 Register TRY",
      "ASSET",
      "DEBIT"
    );
    const registerUsdAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_REGUSD_${String(stamp).slice(-4)}`,
      "MCSR1 Register USD",
      "ASSET",
      "DEBIT"
    );
    const registerEurAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_REGEUR_${String(stamp).slice(-4)}`,
      "MCSR1 Register EUR",
      "ASSET",
      "DEBIT"
    );
    const linkedCashCounterAccountId = await createAccount(
      token,
      base.coaId,
      `MCSR1_CNT_${String(stamp).slice(-5)}`,
      "MCSR1 Linked Cash Counter",
      "EXPENSE",
      "DEBIT"
    );

    await upsertCariPurposeMappings({
      tenantId,
      legalEntityId: base.legalEntityId,
      arControlAccountId,
      arOffsetAccountId,
      apControlAccountId,
      apOffsetAccountId,
    });

    const registerByCurrency = {
      TRY: await createRegister(
        token,
        tenantId,
        base.legalEntityId,
        base.operatingUnitId,
        registerTryAccountId,
        `MCSR1-RTRY-${stamp}`,
        "MCSR1 TRY Register",
        "TRY"
      ),
      USD: await createRegister(
        token,
        tenantId,
        base.legalEntityId,
        base.operatingUnitId,
        registerUsdAccountId,
        `MCSR1-RUSD-${stamp}`,
        "MCSR1 USD Register",
        "USD"
      ),
      EUR: await createRegister(
        token,
        tenantId,
        base.legalEntityId,
        base.operatingUnitId,
        registerEurAccountId,
        `MCSR1-REUR-${stamp}`,
        "MCSR1 EUR Register",
        "EUR"
      ),
    };

    const paymentTermId = await createPaymentTerm(
      tenantId,
      base.legalEntityId,
      `MCSR1_TERM_${stamp}`,
      `MCSR1 Term ${stamp}`
    );
    const customerCounterpartyId = await createCounterparty({
      tenantId,
      legalEntityId: base.legalEntityId,
      code: `MCSR1_CUST_${stamp}`,
      name: `MCSR1 Customer ${stamp}`,
      paymentTermId,
      isCustomer: true,
      isVendor: false,
    });
    const vendorCounterpartyId = await createCounterparty({
      tenantId,
      legalEntityId: base.legalEntityId,
      code: `MCSR1_VEND_${stamp}`,
      name: `MCSR1 Vendor ${stamp}`,
      paymentTermId,
      isCustomer: false,
      isVendor: true,
    });

    await insertFxRate(tenantId, SETTLEMENT_DATE, "USD", "TRY", 40);
    await insertFxRate(tenantId, SETTLEMENT_DATE, "EUR", "TRY", 44);

    const matrix = createUatMatrix();
    const results = [];
    for (let i = 0; i < matrix.length; i += 1) {
      // Keep deterministic sequence to avoid state interference between scenarios.
      // eslint-disable-next-line no-await-in-loop
      const result = await runScenario({
        token,
        tenantId,
        legalEntityId: base.legalEntityId,
        paymentTermId,
        customerCounterpartyId,
        vendorCounterpartyId,
        linkedCashCounterAccountId,
        registerByCurrency,
        scenario: matrix[i],
        scenarioIndex: i,
        stamp,
      });
      results.push(result);
    }

    const parityCount = results.filter((r) => up(r.crossRateSource) === "PARITY").length;
    const directCount = results.filter(
      (r) => up(r.crossRateSource) === "FX_TABLE_EXACT_SPOT"
    ).length;
    const derivedCount = results.filter(
      (r) => up(r.crossRateSource) === "DERIVED_VIA_FUNCTIONAL"
    ).length;
    const cashLinkedCount = results.filter((r) => r.channel === "CASH_LINKED").length;

    assert(results.length === 20, `Expected 20 scenario results, got ${results.length}`);
    assert(cashLinkedCount > 0, "Expected cash-linked scenarios");
    assert(parityCount > 0, "Expected parity scenarios");
    assert(directCount > 0, "Expected direct FX scenarios");
    assert(derivedCount > 0, "Expected derived FX scenarios");

    console.log("CARI MCSR01 UAT matrix integration test passed.");
    console.log(
      JSON.stringify(
        {
          tenantId,
          legalEntityId: base.legalEntityId,
          scenarioCount: results.length,
          cashLinkedCount,
          parityCount,
          directCount,
          derivedCount,
          results,
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
    await sleep(500);
    await closePool();
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("CARI MCSR01 UAT matrix integration test failed.");
    console.error(error?.message || String(error));
    console.error(error);
    process.exitCode = 1;
  });
