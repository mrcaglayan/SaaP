import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CARI_EX04_USAGE_TEST_PORT || 3118);
const BASE_URL =
  process.env.CARI_EX04_USAGE_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_PASSWORD = "CariEX04Usage#12345";
const TEST_FISCAL_YEAR = 2026;
const SETTLEMENT_DATE = "2026-07-20";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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
  requestPath,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Cookie = token;
  }

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

  return {
    status: response.status,
    json,
    cookie,
  };
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      CARI_SETTLEMENT_FX_FALLBACK_MODE: "EXACT_ONLY",
    },
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

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // wait for startup
    }
    await sleep(350);
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function login(email, password) {
  const response = await apiRequest({
    method: "POST",
    requestPath: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(Boolean(response.cookie), `Login cookie missing for ${email}`);
  return response.cookie;
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
  const tenantId = toNumber(result.rows?.[0]?.id);
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
  const userId = toNumber(userResult.rows?.[0]?.id);
  assert(userId > 0, `Failed to resolve user id for ${email}`);

  const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toNumber(roleResult.rows?.[0]?.id);
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

async function bootstrapOrgAndGlBase(token, stamp) {
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
    requestPath: "/api/v1/org/group-companies",
    body: {
      code: `EX04UGC${stamp}`,
      name: `EX04 Usage Group ${stamp}`,
    },
    expectedStatus: 201,
  });
  const groupCompanyId = toNumber(groupRes.json?.id);
  assert(groupCompanyId > 0, "groupCompanyId not created");

  const calendarRes = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/org/fiscal-calendars",
    body: {
      code: `EX04UCAL${stamp}`,
      name: `EX04 Usage Calendar ${stamp}`,
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
    requestPath: "/api/v1/org/fiscal-periods/generate",
    body: {
      calendarId,
      fiscalYear: TEST_FISCAL_YEAR,
    },
    expectedStatus: 201,
  });

  const entityRes = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/org/legal-entities",
    body: {
      groupCompanyId,
      code: `EX04ULE${stamp}`,
      name: `EX04 Usage Legal Entity ${stamp}`,
      countryId,
      functionalCurrencyCode: "TRY",
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(entityRes.json?.id);
  assert(legalEntityId > 0, "legalEntityId not created");

  const ouRes = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code: `EX04UOU${stamp}`,
      name: `EX04 Usage OU ${stamp}`,
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
    requestPath: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `EX04UBOOK${stamp}`,
      name: `EX04 Usage Book ${stamp}`,
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
    requestPath: "/api/v1/gl/coas",
    body: {
      scope: "LEGAL_ENTITY",
      legalEntityId,
      code: `EX04UCOA${stamp}`,
      name: `EX04 Usage CoA ${stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  return {
    legalEntityId,
    operatingUnitId,
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

async function assignOperatingUnitSelfBalancingAccounts({
  tenantId,
  legalEntityId,
  operatingUnitId,
  centralDueFromAccountId,
  centralDueToAccountId,
  ouDueFromCentralAccountId,
  ouDueToCentralAccountId,
}) {
  await query(
    `UPDATE operating_units
     SET central_due_from_account_id = ?,
         central_due_to_account_id = ?,
         ou_due_from_central_account_id = ?,
         ou_due_to_central_account_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [
      centralDueFromAccountId,
      centralDueToAccountId,
      ouDueFromCentralAccountId,
      ouDueToCentralAccountId,
      tenantId,
      legalEntityId,
      operatingUnitId,
    ]
  );
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
    requestPath: "/api/v1/cash/registers",
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
  assert(registerId > 0, "Cash register create failed");
  return registerId;
}

async function createPaymentTerm({ tenantId, legalEntityId, code, name }) {
  await query(
    `INSERT INTO payment_terms (
        tenant_id,
        legal_entity_id,
        code,
        name,
        due_days,
        grace_days,
        status
     )
     VALUES (?, ?, ?, ?, 30, 0, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name]
  );
  const result = await query(
    `SELECT id
     FROM payment_terms
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const paymentTermId = toNumber(result.rows?.[0]?.id);
  assert(paymentTermId > 0, "Payment term create failed");
  return paymentTermId;
}

async function createCounterparty({
  tenantId,
  legalEntityId,
  code,
  name,
  paymentTermId,
  currencyCode,
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      code,
      name,
      isCustomer ? 1 : 0,
      isVendor ? 1 : 0,
      currencyCode,
      paymentTermId,
    ]
  );
  const result = await query(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const counterpartyId = toNumber(result.rows?.[0]?.id);
  assert(counterpartyId > 0, `Counterparty create failed for ${code}`);
  return counterpartyId;
}

async function upsertCariPostingAccounts({
  tenantId,
  legalEntityId,
  arControlAccountId,
  arOffsetAccountId,
  apControlAccountId,
  apOffsetAccountId,
  fxGainAccountId,
  fxLossAccountId,
}) {
  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES
       (?, ?, 'CARI_AR_CONTROL', ?),
       (?, ?, 'CARI_AR_OFFSET', ?),
       (?, ?, 'CARI_AP_CONTROL', ?),
       (?, ?, 'CARI_AP_OFFSET', ?),
       (?, ?, 'CARI_SETTLEMENT_FX_GAIN', ?),
       (?, ?, 'CARI_SETTLEMENT_FX_LOSS', ?)
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
      tenantId,
      legalEntityId,
      fxGainAccountId,
      tenantId,
      legalEntityId,
      fxLossAccountId,
    ]
  );
}

async function createAndPostDocument({
  token,
  tenantId,
  legalEntityId,
  counterpartyId,
  paymentTermId,
  direction,
  documentDate,
  dueDate,
  amountTxn,
  amountBase,
  currencyCode,
  fxRate,
}) {
  const createResponse = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/cari/documents",
    body: {
      legalEntityId,
      counterpartyId,
      paymentTermId,
      direction,
      documentType: "INVOICE",
      documentDate,
      dueDate,
      amountTxn,
      amountBase,
      currencyCode,
      fxRate,
    },
    expectedStatus: 201,
  });
  const documentId = toNumber(createResponse.json?.row?.id);
  assert(documentId > 0, "Draft document id missing");

  await apiRequest({
    token,
    method: "POST",
    requestPath: `/api/v1/cari/documents/${documentId}/post`,
    body: {},
    expectedStatus: 200,
  });

  const openItemResult = await query(
    `SELECT id
     FROM cari_open_items
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND document_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId, legalEntityId, documentId]
  );
  const openItemId = toNumber(openItemResult.rows?.[0]?.id);
  assert(openItemId > 0, "Open item missing after post");

  return { documentId, openItemId };
}

async function insertFxRate({
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
     VALUES (?, ?, ?, ?, 'SPOT', ?, 'EX04_TEST', FALSE)
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       source = VALUES(source),
       is_locked = VALUES(is_locked)`,
    [tenantId, rateDate, fromCurrencyCode, toCurrencyCode, rate]
  );
}

async function fetchSettlementBatchById({ tenantId, settlementBatchId }) {
  const result = await query(
    `SELECT id, cash_transaction_id, currency_code, status
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, settlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function fetchCashTransactionById({ tenantId, cashTransactionId }) {
  const result = await query(
    `SELECT id, cash_register_id, currency_code, txn_type, status
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, cashTransactionId]
  );
  return result.rows?.[0] || null;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });
  const stamp = Date.now();
  const tenantId = await createTenant(`EX04U_${stamp}`, `EX04 Usage Tenant ${stamp}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await createUserWithRole({
    tenantId,
    roleCode: "TenantAdmin",
    email: `ex04_usage_admin_${stamp}@example.com`,
    passwordHash,
    name: "EX04 Usage Admin",
  });

  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const token = await login(user.email, TEST_PASSWORD);
    const base = await bootstrapOrgAndGlBase(token, stamp);

    const arControlAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_ARC_${String(stamp).slice(-5)}`,
      name: "EX04U AR Control",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const arOffsetAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_ARO_${String(stamp).slice(-5)}`,
      name: "EX04U AR Offset",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const apControlAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_APC_${String(stamp).slice(-5)}`,
      name: "EX04U AP Control",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const apOffsetAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_APO_${String(stamp).slice(-5)}`,
      name: "EX04U AP Offset",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const fxGainAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_FXG_${String(stamp).slice(-5)}`,
      name: "EX04U FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_FXL_${String(stamp).slice(-5)}`,
      name: "EX04U FX Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const centralDueFromAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_CDF_${String(stamp).slice(-5)}`,
      name: "EX04U Central Due From",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const centralDueToAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_CDT_${String(stamp).slice(-5)}`,
      name: "EX04U Central Due To",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const ouDueFromCentralAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_ODF_${String(stamp).slice(-5)}`,
      name: "EX04U OU Due From Central",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const ouDueToCentralAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_ODT_${String(stamp).slice(-5)}`,
      name: "EX04U OU Due To Central",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const usdRegisterAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_USD_${String(stamp).slice(-5)}`,
      name: "EX04U USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const tryRegisterAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_TRY_${String(stamp).slice(-5)}`,
      name: "EX04U TRY Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const linkedCashCounterAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04U_CNT_${String(stamp).slice(-5)}`,
      name: "EX04U Linked Cash Counter",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });

    await assignOperatingUnitSelfBalancingAccounts({
      tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      centralDueFromAccountId,
      centralDueToAccountId,
      ouDueFromCentralAccountId,
      ouDueToCentralAccountId,
    });

    await upsertCariPostingAccounts({
      tenantId,
      legalEntityId: base.legalEntityId,
      arControlAccountId,
      arOffsetAccountId,
      apControlAccountId,
      apOffsetAccountId,
      fxGainAccountId,
      fxLossAccountId,
    });

    const usdRegisterId = await createRegister({
      token,
      tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: usdRegisterAccountId,
      code: `EX04U-RUSD-${stamp}`,
      name: "EX04U USD Register",
      currencyCode: "USD",
    });
    const tryRegisterId = await createRegister({
      token,
      tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: tryRegisterAccountId,
      code: `EX04U-RTRY-${stamp}`,
      name: "EX04U TRY Register",
      currencyCode: "TRY",
    });

    const paymentTermId = await createPaymentTerm({
      tenantId,
      legalEntityId: base.legalEntityId,
      code: `EX04U_TERM_${stamp}`,
      name: `EX04U Term ${stamp}`,
    });
    const vendorCounterpartyId = await createCounterparty({
      tenantId,
      legalEntityId: base.legalEntityId,
      code: `EX04U_VENDOR_${stamp}`,
      name: `EX04U Vendor ${stamp}`,
      paymentTermId,
      currencyCode: "USD",
      isCustomer: false,
      isVendor: true,
    });

    await insertFxRate({
      tenantId,
      rateDate: SETTLEMENT_DATE,
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 39,
    });

    const successDoc = await createAndPostDocument({
      token,
      tenantId,
      legalEntityId: base.legalEntityId,
      counterpartyId: vendorCounterpartyId,
      paymentTermId,
      direction: "AP",
      documentDate: "2026-07-10",
      dueDate: "2026-07-25",
      amountTxn: 100,
      amountBase: 3800,
      currencyCode: "USD",
      fxRate: 38,
    });

    const successApply = await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: base.legalEntityId,
        counterpartyId: vendorCounterpartyId,
        direction: "AP",
        settlementDate: SETTLEMENT_DATE,
        currencyCode: "USD",
        incomingAmountTxn: 100,
        idempotencyKey: `EX04-USAGE-SUCCESS-${stamp}`,
        autoAllocate: false,
        useUnappliedCash: false,
        allocations: [{ openItemId: successDoc.openItemId, amountTxn: 100 }],
        paymentChannel: "CASH",
        linkedCashTransaction: {
          registerId: usdRegisterId,
          counterAccountId: apControlAccountId,
          bookDate: SETTLEMENT_DATE,
          txnDatetime: `${SETTLEMENT_DATE}T10:00:00`,
          idempotencyKey: `EX04-USAGE-CASH-SUCCESS-${stamp}`,
          integrationEventUid: `EX04-USAGE-CASH-EVT-SUCCESS-${stamp}`,
        },
      },
      expectedStatus: 201,
    });

    const settlementBatchId = toNumber(successApply.json?.row?.id);
    const linkedCashTransactionId = toNumber(successApply.json?.row?.cashTransactionId);
    assert(settlementBatchId > 0, "Success apply must create settlement batch");
    assert(linkedCashTransactionId > 0, "Success apply must link/create cash transaction");

    const settlementRow = await fetchSettlementBatchById({
      tenantId,
      settlementBatchId,
    });
    assert(Boolean(settlementRow), "Settlement batch row not found");
    assert(
      toNumber(settlementRow.cash_transaction_id) === linkedCashTransactionId,
      "Settlement batch must persist linked cash transaction id"
    );
    assert(
      toUpper(settlementRow.currency_code) === "USD",
      "Settlement currency should remain USD"
    );
    assert(toUpper(settlementRow.status) === "POSTED", "Settlement should be POSTED");

    const linkedCashTxn = await fetchCashTransactionById({
      tenantId,
      cashTransactionId: linkedCashTransactionId,
    });
    assert(Boolean(linkedCashTxn), "Linked cash transaction row not found");
    assert(
      toNumber(linkedCashTxn.cash_register_id) === usdRegisterId,
      "Linked cash transaction must use USD register"
    );
    assert(
      toUpper(linkedCashTxn.currency_code) === "USD",
      "Linked cash transaction currency must be USD"
    );
    assert(
      toUpper(linkedCashTxn.txn_type) === "PAYOUT",
      "AP settlement-linked cash transaction must be PAYOUT"
    );

    const mismatchDoc = await createAndPostDocument({
      token,
      tenantId,
      legalEntityId: base.legalEntityId,
      counterpartyId: vendorCounterpartyId,
      paymentTermId,
      direction: "AP",
      documentDate: "2026-07-11",
      dueDate: "2026-07-28",
      amountTxn: 80,
      amountBase: 3040,
      currencyCode: "USD",
      fxRate: 38,
    });

    const mismatchApply = await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: base.legalEntityId,
        counterpartyId: vendorCounterpartyId,
        direction: "AP",
        settlementDate: SETTLEMENT_DATE,
        currencyCode: "USD",
        incomingAmountTxn: 80,
        idempotencyKey: `EX04-USAGE-MISMATCH-${stamp}`,
        autoAllocate: false,
        useUnappliedCash: false,
        allocations: [{ openItemId: mismatchDoc.openItemId, amountTxn: 80 }],
        paymentChannel: "CASH",
        linkedCashTransaction: {
          registerId: tryRegisterId,
          counterAccountId: apControlAccountId,
          bookDate: SETTLEMENT_DATE,
          txnDatetime: `${SETTLEMENT_DATE}T11:00:00`,
          idempotencyKey: `EX04-USAGE-CASH-MISMATCH-${stamp}`,
          integrationEventUid: `EX04-USAGE-CASH-EVT-MISMATCH-${stamp}`,
        },
      },
      expectedStatus: 400,
    });

    const mismatchMessage = String(mismatchApply.json?.message || "");
    assert(
      mismatchMessage.toLowerCase().includes("exchange first") &&
        mismatchMessage.toLowerCase().includes("settle"),
      `Mismatch error must direct exchange-first flow. got="${mismatchMessage}"`
    );

    console.log("PR-EX04 foreign-cash settlement usage checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId,
          legalEntityId: base.legalEntityId,
          usdRegisterId,
          tryRegisterId,
          settlementBatchId,
          linkedCashTransactionId,
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
    console.error("PR-EX04 settlement foreign-cash usage test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
