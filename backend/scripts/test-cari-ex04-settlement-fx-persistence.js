import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CARI_EX04_FX_TEST_PORT || 3119);
const BASE_URL =
  process.env.CARI_EX04_FX_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_PASSWORD = "CariEX04Fx#12345";
const TEST_FISCAL_YEAR = 2026;
const SETTLEMENT_DATE = "2026-08-15";

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

function amountsEqual(left, right, epsilon = 0.000001) {
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
      CARI_SETTLEMENT_FX_FALLBACK_MAX_DAYS: "",
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
      code: `EX04FGC${stamp}`,
      name: `EX04 FX Group ${stamp}`,
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
      code: `EX04FCAL${stamp}`,
      name: `EX04 FX Calendar ${stamp}`,
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
      code: `EX04FLE${stamp}`,
      name: `EX04 FX Legal Entity ${stamp}`,
      countryId,
      functionalCurrencyCode: "TRY",
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(entityRes.json?.id);
  assert(legalEntityId > 0, "legalEntityId not created");

  const bookRes = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `EX04FBOOK${stamp}`,
      name: `EX04 FX Book ${stamp}`,
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
      code: `EX04FCOA${stamp}`,
      name: `EX04 FX CoA ${stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  return {
    legalEntityId,
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
    `SELECT
       id,
       status,
       reversal_of_settlement_batch_id,
       settlement_fx_rate,
       settlement_fx_source,
       DATE_FORMAT(settlement_fx_rate_date, '%Y-%m-%d') AS settlement_fx_rate_date,
       settlement_fx_fallback_mode,
       settlement_fx_fallback_max_days,
       realized_fx_net_base
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, settlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function fetchReversalBatchByOriginal({
  tenantId,
  originalSettlementBatchId,
}) {
  const result = await query(
    `SELECT
       id,
       status,
       reversal_of_settlement_batch_id,
       settlement_fx_rate,
       settlement_fx_source,
       DATE_FORMAT(settlement_fx_rate_date, '%Y-%m-%d') AS settlement_fx_rate_date,
       settlement_fx_fallback_mode,
       settlement_fx_fallback_max_days,
       realized_fx_net_base
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND reversal_of_settlement_batch_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, originalSettlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });
  const stamp = Date.now();
  const tenantId = await createTenant(`EX04F_${stamp}`, `EX04 FX Tenant ${stamp}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await createUserWithRole({
    tenantId,
    roleCode: "TenantAdmin",
    email: `ex04_fx_admin_${stamp}@example.com`,
    passwordHash,
    name: "EX04 FX Admin",
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
      code: `EX04F_ARC_${String(stamp).slice(-5)}`,
      name: "EX04F AR Control",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const arOffsetAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04F_ARO_${String(stamp).slice(-5)}`,
      name: "EX04F AR Offset",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const apControlAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04F_APC_${String(stamp).slice(-5)}`,
      name: "EX04F AP Control",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const apOffsetAccountId = await createAccount({
      token,
      coaId: base.coaId,
      code: `EX04F_APO_${String(stamp).slice(-5)}`,
      name: "EX04F AP Offset",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });

    await upsertCariPostingAccounts({
      tenantId,
      legalEntityId: base.legalEntityId,
      arControlAccountId,
      arOffsetAccountId,
      apControlAccountId,
      apOffsetAccountId,
    });

    const paymentTermId = await createPaymentTerm({
      tenantId,
      legalEntityId: base.legalEntityId,
      code: `EX04F_TERM_${stamp}`,
      name: `EX04F Term ${stamp}`,
    });
    const vendorCounterpartyId = await createCounterparty({
      tenantId,
      legalEntityId: base.legalEntityId,
      code: `EX04F_VENDOR_${stamp}`,
      name: `EX04F Vendor ${stamp}`,
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

    const doc = await createAndPostDocument({
      token,
      tenantId,
      legalEntityId: base.legalEntityId,
      counterpartyId: vendorCounterpartyId,
      paymentTermId,
      direction: "AP",
      documentDate: "2026-08-01",
      dueDate: "2026-08-30",
      amountTxn: 100,
      amountBase: 3800,
      currencyCode: "USD",
      fxRate: 38,
    });

    const applyResponse = await apiRequest({
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
        idempotencyKey: `EX04-FX-SETTLE-${stamp}`,
        autoAllocate: false,
        useUnappliedCash: false,
        allocations: [{ openItemId: doc.openItemId, amountTxn: 100 }],
        paymentChannel: "MANUAL",
      },
      expectedStatus: 201,
    });

    const settlementBatchId = toNumber(applyResponse.json?.row?.id);
    assert(settlementBatchId > 0, "Settlement batch id missing");
    assert(
      amountsEqual(applyResponse.json?.fx?.settlementFxRate, 39),
      "Apply response fx.settlementFxRate must be 39"
    );
    assert(
      amountsEqual(applyResponse.json?.fx?.realizedGainLossBase, 100),
      "Apply response fx.realizedGainLossBase must be 100"
    );

    const settlementRow = await fetchSettlementBatchById({
      tenantId,
      settlementBatchId,
    });
    assert(Boolean(settlementRow), "Settlement row not found");
    assert(toUpper(settlementRow.status) === "POSTED", "Settlement row must be POSTED");
    assert(
      amountsEqual(settlementRow.settlement_fx_rate, 39),
      `settlement_fx_rate must persist as 39, got=${settlementRow.settlement_fx_rate}`
    );
    assert(
      toUpper(settlementRow.settlement_fx_source) === "FX_TABLE_EXACT_SPOT",
      `settlement_fx_source must persist as FX_TABLE_EXACT_SPOT, got=${settlementRow.settlement_fx_source}`
    );
    assert(
      String(settlementRow.settlement_fx_rate_date || "") === SETTLEMENT_DATE,
      "settlement_fx_rate_date must persist settlement date"
    );
    assert(
      toUpper(settlementRow.settlement_fx_fallback_mode) === "EXACT_ONLY",
      `settlement_fx_fallback_mode must persist as EXACT_ONLY, got=${settlementRow.settlement_fx_fallback_mode}`
    );
    assert(
      settlementRow.settlement_fx_fallback_max_days === null,
      "settlement_fx_fallback_max_days must persist as null for EXACT_ONLY"
    );
    assert(
      amountsEqual(settlementRow.realized_fx_net_base, 100),
      `realized_fx_net_base must persist as 100, got=${settlementRow.realized_fx_net_base}`
    );

    const reverseResponse = await apiRequest({
      token,
      method: "POST",
      requestPath: `/api/v1/cari/settlements/${settlementBatchId}/reverse`,
      body: {
        reversalDate: "2026-08-20",
        reason: "EX04 FX persistence reverse",
      },
      expectedStatus: 201,
    });
    const reversalSettlementBatchId = toNumber(reverseResponse.json?.row?.id);
    assert(reversalSettlementBatchId > 0, "Reversal settlement batch id missing");

    const originalAfterReverse = await fetchSettlementBatchById({
      tenantId,
      settlementBatchId,
    });
    assert(
      toUpper(originalAfterReverse?.status) === "REVERSED",
      "Original settlement row must be REVERSED after reverse"
    );

    const reversalRow = await fetchReversalBatchByOriginal({
      tenantId,
      originalSettlementBatchId: settlementBatchId,
    });
    assert(Boolean(reversalRow), "Reversal settlement row not found");
    assert(
      toNumber(reversalRow.reversal_of_settlement_batch_id) === settlementBatchId,
      "Reversal row must point to original settlement batch"
    );
    assert(toUpper(reversalRow.status) === "REVERSED", "Reversal row status must be REVERSED");
    assert(
      amountsEqual(reversalRow.settlement_fx_rate, 39),
      "Reversal row must copy settlement_fx_rate"
    );
    assert(
      toUpper(reversalRow.settlement_fx_source) === "FX_TABLE_EXACT_SPOT",
      "Reversal row must copy settlement_fx_source"
    );
    assert(
      String(reversalRow.settlement_fx_rate_date || "") === SETTLEMENT_DATE,
      "Reversal row must copy settlement_fx_rate_date"
    );
    assert(
      toUpper(reversalRow.settlement_fx_fallback_mode) === "EXACT_ONLY",
      "Reversal row must copy settlement_fx_fallback_mode"
    );
    assert(
      reversalRow.settlement_fx_fallback_max_days === null,
      "Reversal row must copy settlement_fx_fallback_max_days"
    );
    assert(
      amountsEqual(reversalRow.realized_fx_net_base, -100),
      `Reversal row realized_fx_net_base must be -100, got=${reversalRow.realized_fx_net_base}`
    );

    console.log("PR-EX04 settlement FX persistence checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId,
          legalEntityId: base.legalEntityId,
          settlementBatchId,
          reversalSettlementBatchId,
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
    console.error("PR-EX04 settlement FX persistence test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
