import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CASH_CRO05_TEST_PORT || 3135);
const BASE_URL = process.env.CASH_CRO05_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_FISCAL_YEAR = 2026;
const TEST_DATE = "2026-03-10";
const TEST_DATETIME = "2026-03-10T09:30:00.000Z";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toErrorText(jsonPayload) {
  if (jsonPayload === null || jsonPayload === undefined) {
    return "";
  }
  if (typeof jsonPayload === "string") {
    return jsonPayload;
  }
  if (typeof jsonPayload.error === "string") {
    return jsonPayload.error;
  }
  if (typeof jsonPayload.message === "string") {
    return jsonPayload.message;
  }
  try {
    return JSON.stringify(jsonPayload);
  } catch {
    return String(jsonPayload);
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
  const tenantCode = `CRO05_${stamp}`;
  const tenantName = `Cash CRO05 ${stamp}`;
  const adminEmail = `cash_cro05_admin_${stamp}@example.com`;
  const password = "CashCRO05#12345";
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
  const tenantId = toNumber(tenantResult.rows[0]?.id);
  assert(tenantId > 0, "Failed to resolve tenant");

  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, adminEmail, passwordHash, "Cash CRO05 Admin"]
  );

  const userResult = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, adminEmail]
  );
  const userId = toNumber(userResult.rows[0]?.id);
  assert(userId > 0, "Failed to resolve admin user");

  const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId]
  );
  const roleId = toNumber(roleResult.rows[0]?.id);
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

async function createOperatingUnit({
  token,
  legalEntityId,
  code,
  name,
  centralDueFromAccountId,
  ouDueToCentralAccountId,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code,
      name,
      unitType: "BRANCH",
      hasSubledger: true,
      centralDueFromAccountId,
      ouDueToCentralAccountId,
    },
    expectedStatus: 201,
  });
  const operatingUnitId = toNumber(response.json?.id);
  assert(operatingUnitId > 0, `Operating unit not created for code=${code}`);
  return operatingUnitId;
}

async function createOperatingUnitPartnerCurrentAccount({
  token,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromAccountId,
  dueToAccountId,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/operating-unit-partner-current-accounts",
    body: {
      legalEntityId,
      operatingUnitId,
      partnerOperatingUnitId,
      dueFromAccountId,
      dueToAccountId,
    },
    expectedStatus: 201,
  });
  const id = toNumber(response.json?.id);
  assert(id > 0, "Operating unit partner current account mapping not created");
  return id;
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

async function createBankAccount({
  token,
  legalEntityId,
  operatingUnitId = null,
  glAccountId,
  code,
  name,
  currencyCode,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/bank/accounts",
    body: {
      legalEntityId,
      operatingUnitId,
      glAccountId,
      code,
      name,
      currencyCode,
      bankName: name,
      branchName: operatingUnitId ? "Branch" : "HQ",
      accountNo: `${code}-001`,
      isActive: true,
    },
    expectedStatus: 201,
  });
  const bankAccountId = toNumber(response.json?.row?.id);
  assert(bankAccountId > 0, `Bank account not created for code=${code}`);
  return bankAccountId;
}

async function bootstrapSelfBalancingContext(token, identity) {
  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'US'
     LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows[0]?.id);
  const currencyCode = String(countryResult.rows[0]?.default_currency_code || "USD").toUpperCase();
  assert(countryId > 0, "US country row is required");

  const groupRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/group-companies",
    body: {
      code: `CG${identity.stamp}`,
      name: `Cash CRO05 Group ${identity.stamp}`,
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
      code: `CAL${identity.stamp}`,
      name: `Cash CRO05 Calendar ${identity.stamp}`,
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

  const legalEntityRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/legal-entities",
    body: {
      groupCompanyId,
      code: `LE${identity.stamp}`,
      name: `Cash CRO05 LE ${identity.stamp}`,
      countryId,
      functionalCurrencyCode: currencyCode,
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(legalEntityRes.json?.id);
  assert(legalEntityId > 0, "legalEntityId not created");

  await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `BOOK${identity.stamp}`,
      name: `Cash CRO05 Book ${identity.stamp}`,
      bookType: "LOCAL",
      baseCurrencyCode: currencyCode,
    },
    expectedStatus: 201,
  });

  const coaRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/coas",
    body: {
      scope: "LEGAL_ENTITY",
      legalEntityId,
      code: `COA${identity.stamp}`,
      name: `Cash CRO05 CoA ${identity.stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  const centralRegisterAccountId = await createAccount({
    token,
    coaId,
    code: `CRC${identity.stamp}`,
    name: "Central Register",
  });
  const centralBankAccountGlId = await createAccount({
    token,
    coaId,
    code: `CBK${identity.stamp}`,
    name: "Central Bank",
  });
  const branchBankAccountAGlId = await createAccount({
    token,
    coaId,
    code: `BBK${identity.stamp}`,
    name: "Branch Bank A",
  });
  const registerAccountAId = await createAccount({
    token,
    coaId,
    code: `CRA${identity.stamp}`,
    name: "Register A",
  });
  const registerAccountBId = await createAccount({
    token,
    coaId,
    code: `CRB${identity.stamp}`,
    name: "Register B",
  });
  const registerAccountCId = await createAccount({
    token,
    coaId,
    code: `CRCX${identity.stamp}`,
    name: "Register C",
  });
  const transitAccountId = await createAccount({
    token,
    coaId,
    code: `TRN${identity.stamp}`,
    name: "Cash In Transit",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const centralDueFromAccountAId = await createAccount({
    token,
    coaId,
    code: `CDA${identity.stamp}`,
    name: "OU A HQ Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const ouDueToAccountAId = await createAccount({
    token,
    coaId,
    code: `ODA${identity.stamp}`,
    name: "OU A Due To HQ",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const centralDueFromAccountBId = await createAccount({
    token,
    coaId,
    code: `CDB${identity.stamp}`,
    name: "OU B HQ Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const ouDueToAccountBId = await createAccount({
    token,
    coaId,
    code: `ODB${identity.stamp}`,
    name: "OU B Due To HQ",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const dueFromAccountABId = await createAccount({
    token,
    coaId,
    code: `DFAB${identity.stamp}`,
    name: "OU A Due From OU B",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const dueToAccountABId = await createAccount({
    token,
    coaId,
    code: `DTAB${identity.stamp}`,
    name: "OU A Due To OU B",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const dueFromAccountBAId = await createAccount({
    token,
    coaId,
    code: `DFBA${identity.stamp}`,
    name: "OU B Due From OU A",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const dueToAccountBAId = await createAccount({
    token,
    coaId,
    code: `DTBA${identity.stamp}`,
    name: "OU B Due To OU A",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });

  const operatingUnitAId = await createOperatingUnit({
    token,
    legalEntityId,
    code: `OUA${identity.stamp}`,
    name: "Branch A",
    centralDueFromAccountId: centralDueFromAccountAId,
    ouDueToCentralAccountId: ouDueToAccountAId,
  });
  const operatingUnitBId = await createOperatingUnit({
    token,
    legalEntityId,
    code: `OUB${identity.stamp}`,
    name: "Branch B",
    centralDueFromAccountId: centralDueFromAccountBId,
    ouDueToCentralAccountId: ouDueToAccountBId,
  });
  const operatingUnitCId = await createOperatingUnit({
    token,
    legalEntityId,
    code: `OUC${identity.stamp}`,
    name: "Branch Missing Setup",
    centralDueFromAccountId: undefined,
    ouDueToCentralAccountId: undefined,
  });

  await createOperatingUnitPartnerCurrentAccount({
    token,
    legalEntityId,
    operatingUnitId: operatingUnitAId,
    partnerOperatingUnitId: operatingUnitBId,
    dueFromAccountId: dueFromAccountABId,
    dueToAccountId: dueToAccountABId,
  });
  await createOperatingUnitPartnerCurrentAccount({
    token,
    legalEntityId,
    operatingUnitId: operatingUnitBId,
    partnerOperatingUnitId: operatingUnitAId,
    dueFromAccountId: dueFromAccountBAId,
    dueToAccountId: dueToAccountBAId,
  });

  const centralRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId: null,
    accountId: centralRegisterAccountId,
    code: `RGC${identity.stamp}`,
    name: "Central Register",
    currencyCode,
  });
  const registerAId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId: operatingUnitAId,
    accountId: registerAccountAId,
    code: `RGA${identity.stamp}`,
    name: "Register A",
    currencyCode,
  });
  const registerBId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId: operatingUnitBId,
    accountId: registerAccountBId,
    code: `RGB${identity.stamp}`,
    name: "Register B",
    currencyCode,
  });
  const registerCId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId: operatingUnitCId,
    accountId: registerAccountCId,
    code: `RGCX${identity.stamp}`,
    name: "Register C",
    currencyCode,
  });

  const centralBankAccountId = await createBankAccount({
    token,
    legalEntityId,
    operatingUnitId: null,
    glAccountId: centralBankAccountGlId,
    code: `BANKC${identity.stamp}`,
    name: "Central Bank",
    currencyCode,
  });
  const branchBankAccountAId = await createBankAccount({
    token,
    legalEntityId,
    operatingUnitId: operatingUnitAId,
    glAccountId: branchBankAccountAGlId,
    code: `BANKA${identity.stamp}`,
    name: "Branch Bank A",
    currencyCode,
  });

  await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/gl/journal-purpose-accounts",
    body: {
      legalEntityId,
      moduleKey: "CASH",
      purposeCode: "CASH_TRANSIT_CLEARING",
      accountId: transitAccountId,
    },
    expectedStatus: 201,
  });

  return {
    tenantId: identity.tenantId,
    legalEntityId,
    currencyCode,
    centralRegisterId,
    registerAId,
    registerBId,
    registerCId,
    operatingUnitAId,
    operatingUnitBId,
    operatingUnitCId,
    centralRegisterAccountId,
    centralBankAccountId,
    centralBankAccountGlId,
    branchBankAccountAId,
    branchBankAccountAGlId,
    registerAccountAId,
    registerAccountBId,
    transitAccountId,
    centralDueFromAccountAId,
    ouDueToAccountAId,
    centralDueFromAccountBId,
    ouDueToAccountBId,
    dueFromAccountABId,
    dueToAccountABId,
    dueFromAccountBAId,
    dueToAccountBAId,
  };
}

async function createCashTransaction({
  token,
  tenantId,
  registerId,
  txnType,
  amount,
  currencyCode,
  idempotencyKey,
  counterAccountId,
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
      txnDatetime: TEST_DATETIME,
      bookDate: TEST_DATE,
      description: `CRO05 bank/cash ${idempotencyKey}`,
      referenceNo: `CRO05-BANK-${idempotencyKey}`.slice(0, 100),
      idempotencyKey,
    },
    expectedStatus,
  });
}

async function initiateTransitTransfer({
  token,
  tenantId,
  registerId,
  targetRegisterId,
  amount,
  currencyCode,
  idempotencyKey,
  expectedStatus = 201,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: "/api/v1/cash/transactions/transit/initiate",
    body: {
      tenantId,
      registerId,
      targetRegisterId,
      amount,
      currencyCode,
      txnDatetime: TEST_DATETIME,
      bookDate: TEST_DATE,
      description: `CRO05 transit ${idempotencyKey}`,
      referenceNo: `CRO05-${idempotencyKey}`.slice(0, 100),
      idempotencyKey,
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
    body: { tenantId },
    expectedStatus,
  });
}

async function receiveTransitTransfer({
  token,
  tenantId,
  transitTransferId,
  idempotencyKey,
  expectedStatus = 201,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: `/api/v1/cash/transactions/transit/${transitTransferId}/receive`,
    body: {
      tenantId,
      txnDatetime: TEST_DATETIME,
      bookDate: TEST_DATE,
      description: `CRO05 receive ${idempotencyKey}`,
      referenceNo: `CRO05-RCV-${idempotencyKey}`.slice(0, 100),
      idempotencyKey,
    },
    expectedStatus,
  });
}

async function getTransitTransfer({ token, transitTransferId, expectedStatus = 200 }) {
  return apiRequest({
    token,
    method: "GET",
    path: `/api/v1/cash/transactions/transit/${transitTransferId}`,
    expectedStatus,
  });
}

async function loadPostedJournalLines({ tenantId, transactionId }) {
  const txnResult = await query(
    `SELECT posted_journal_entry_id
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, transactionId]
  );
  const journalEntryId = toNumber(txnResult.rows[0]?.posted_journal_entry_id);
  assert(journalEntryId > 0, `posted_journal_entry_id missing for cash transaction ${transactionId}`);

  const lineResult = await query(
    `SELECT account_id, operating_unit_id, subledger_reference_no, debit_base, credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY id ASC`,
    [journalEntryId]
  );
  return lineResult.rows || [];
}

function matchesLine(line, { accountId, operatingUnitId, side, amount }) {
  if (toNumber(line.account_id) !== toNumber(accountId)) {
    return false;
  }
  const actualOperatingUnitId = toNumber(line.operating_unit_id);
  const expectedOperatingUnitId = operatingUnitId ? toNumber(operatingUnitId) : 0;
  if (actualOperatingUnitId !== expectedOperatingUnitId) {
    return false;
  }
  const field = side === "credit" ? "credit_base" : "debit_base";
  return Number(line[field] || 0) >= Number(amount) - 0.000001;
}

function assertHasLine(lines, spec, message) {
  assert(lines.some((line) => matchesLine(line, spec)), message);
}

function assertNoAccount(lines, accountId, message) {
  assert(!lines.some((line) => toNumber(line.account_id) === toNumber(accountId)), message);
}

function assertNoOuLinesHaveNoSubledgerRef(lines, message) {
  assert(
    lines
      .filter((line) => !toNumber(line.operating_unit_id))
      .every((line) => !String(line.subledger_reference_no || "").trim()),
    message
  );
}

async function assertTransferState(token, transferId, expectedStatus) {
  const response = await getTransitTransfer({
    token,
    transitTransferId: transferId,
    expectedStatus: 200,
  });
  assert(
    String(response.json?.transfer?.status || "").toUpperCase() === expectedStatus,
    `Transit transfer ${transferId} expected status ${expectedStatus}`
  );
}

async function runCentralToOuScenario(token, setup, stamp) {
  const initiateRes = await initiateTransitTransfer({
    token,
    tenantId: setup.tenantId,
    registerId: setup.centralRegisterId,
    targetRegisterId: setup.registerAId,
    amount: "55.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `CENTRAL-OU-${stamp}`,
  });
  const transferId = toNumber(initiateRes.json?.transfer?.id);
  const transferOutTxnId = toNumber(initiateRes.json?.transferOutTransaction?.id);
  assert(transferId > 0 && transferOutTxnId > 0, "Central -> OU transfer ids missing");

  await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
    expectedStatus: 200,
  });
  await assertTransferState(token, transferId, "IN_TRANSIT");

  const transferOutLines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
  });
  assert(transferOutLines.length === 2, "Central -> OU transfer-out should post 2 journal lines");
  assertHasLine(
    transferOutLines,
    {
      accountId: setup.centralDueFromAccountAId,
      operatingUnitId: null,
      side: "debit",
      amount: 55,
    },
    "Central -> OU transfer-out should debit target OU HQ due-from at no-OU scope"
  );
  assertHasLine(
    transferOutLines,
    {
      accountId: setup.centralRegisterAccountId,
      operatingUnitId: null,
      side: "credit",
      amount: 55,
    },
    "Central -> OU transfer-out should credit central register"
  );
  assertNoAccount(
    transferOutLines,
    setup.transitAccountId,
    "Central -> OU transfer-out should not post transit clearing"
  );
  assertNoOuLinesHaveNoSubledgerRef(
    transferOutLines,
    "Central -> OU transfer-out no-OU lines should not carry subledger reference metadata"
  );

  const receiveRes = await receiveTransitTransfer({
    token,
    tenantId: setup.tenantId,
    transitTransferId: transferId,
    idempotencyKey: `CENTRAL-OU-RCV-${stamp}`,
    expectedStatus: 201,
  });
  const transferInTxnId = toNumber(receiveRes.json?.transferInTransaction?.id);
  assert(transferInTxnId > 0, "Central -> OU transfer-in transaction missing");
  await assertTransferState(token, transferId, "RECEIVED");

  const transferInLines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId: transferInTxnId,
  });
  assert(transferInLines.length === 2, "Central -> OU transfer-in should post 2 journal lines");
  assertHasLine(
    transferInLines,
    {
      accountId: setup.registerAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "debit",
      amount: 55,
    },
    "Central -> OU transfer-in should debit target register"
  );
  assertHasLine(
    transferInLines,
    {
      accountId: setup.ouDueToAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "credit",
      amount: 55,
    },
    "Central -> OU transfer-in should credit target OU due-to account"
  );
  assertNoAccount(
    transferInLines,
    setup.transitAccountId,
    "Central -> OU transfer-in should not post transit clearing"
  );

  return {
    transferId,
    transferOutTxnId,
    transferInTxnId,
  };
}

async function runOuToCentralScenario(token, setup, stamp) {
  const initiateRes = await initiateTransitTransfer({
    token,
    tenantId: setup.tenantId,
    registerId: setup.registerAId,
    targetRegisterId: setup.centralRegisterId,
    amount: "66.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `OU-CENTRAL-${stamp}`,
  });
  const transferId = toNumber(initiateRes.json?.transfer?.id);
  const transferOutTxnId = toNumber(initiateRes.json?.transferOutTransaction?.id);
  assert(transferId > 0 && transferOutTxnId > 0, "OU -> Central transfer ids missing");

  await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
    expectedStatus: 200,
  });
  await assertTransferState(token, transferId, "IN_TRANSIT");

  const transferOutLines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
  });
  assert(transferOutLines.length === 2, "OU -> Central transfer-out should post 2 journal lines");
  assertHasLine(
    transferOutLines,
    {
      accountId: setup.ouDueToAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "debit",
      amount: 66,
    },
    "OU -> Central transfer-out should debit source OU due-to account"
  );
  assertHasLine(
    transferOutLines,
    {
      accountId: setup.registerAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "credit",
      amount: 66,
    },
    "OU -> Central transfer-out should credit source register"
  );
  assertNoAccount(
    transferOutLines,
    setup.transitAccountId,
    "OU -> Central transfer-out should not post transit clearing"
  );

  const receiveRes = await receiveTransitTransfer({
    token,
    tenantId: setup.tenantId,
    transitTransferId: transferId,
    idempotencyKey: `OU-CENTRAL-RCV-${stamp}`,
    expectedStatus: 201,
  });
  const transferInTxnId = toNumber(receiveRes.json?.transferInTransaction?.id);
  assert(transferInTxnId > 0, "OU -> Central transfer-in transaction missing");
  await assertTransferState(token, transferId, "RECEIVED");

  const transferInLines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId: transferInTxnId,
  });
  assert(transferInLines.length === 2, "OU -> Central transfer-in should post 2 journal lines");
  assertHasLine(
    transferInLines,
    {
      accountId: setup.centralRegisterAccountId,
      operatingUnitId: null,
      side: "debit",
      amount: 66,
    },
    "OU -> Central transfer-in should debit central register"
  );
  assertHasLine(
    transferInLines,
    {
      accountId: setup.centralDueFromAccountAId,
      operatingUnitId: null,
      side: "credit",
      amount: 66,
    },
    "OU -> Central transfer-in should credit source OU HQ due-from account at no-OU scope"
  );
  assertNoAccount(
    transferInLines,
    setup.transitAccountId,
    "OU -> Central transfer-in should not post transit clearing"
  );
  assertNoOuLinesHaveNoSubledgerRef(
    transferInLines,
    "OU -> Central transfer-in no-OU lines should not carry subledger reference metadata"
  );

  return {
    transferId,
    transferOutTxnId,
    transferInTxnId,
  };
}

async function runOuToOuScenario(token, setup, stamp) {
  const initiateRes = await initiateTransitTransfer({
    token,
    tenantId: setup.tenantId,
    registerId: setup.registerAId,
    targetRegisterId: setup.registerBId,
    amount: "77.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `OU-OU-${stamp}`,
  });
  const transferId = toNumber(initiateRes.json?.transfer?.id);
  const transferOutTxnId = toNumber(initiateRes.json?.transferOutTransaction?.id);
  assert(transferId > 0 && transferOutTxnId > 0, "OU -> OU transfer ids missing");

  await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
    expectedStatus: 200,
  });
  await assertTransferState(token, transferId, "IN_TRANSIT");

  const transferOutLines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
  });
  assert(transferOutLines.length === 2, "OU -> OU transfer-out should post 2 journal lines");
  assertHasLine(
    transferOutLines,
    {
      accountId: setup.dueFromAccountABId,
      operatingUnitId: setup.operatingUnitAId,
      side: "debit",
      amount: 77,
    },
    "OU -> OU transfer-out should debit source OU due-from-partner account"
  );
  assertHasLine(
    transferOutLines,
    {
      accountId: setup.registerAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "credit",
      amount: 77,
    },
    "OU -> OU transfer-out should credit source register"
  );
  assertNoAccount(
    transferOutLines,
    setup.transitAccountId,
    "OU -> OU transfer-out should not post transit clearing"
  );

  const receiveRes = await receiveTransitTransfer({
    token,
    tenantId: setup.tenantId,
    transitTransferId: transferId,
    idempotencyKey: `OU-OU-RCV-${stamp}`,
    expectedStatus: 201,
  });
  const transferInTxnId = toNumber(receiveRes.json?.transferInTransaction?.id);
  assert(transferInTxnId > 0, "OU -> OU transfer-in transaction missing");
  await assertTransferState(token, transferId, "RECEIVED");

  const transferInLines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId: transferInTxnId,
  });
  assert(transferInLines.length === 2, "OU -> OU transfer-in should post 2 journal lines");
  assertHasLine(
    transferInLines,
    {
      accountId: setup.registerAccountBId,
      operatingUnitId: setup.operatingUnitBId,
      side: "debit",
      amount: 77,
    },
    "OU -> OU transfer-in should debit target register"
  );
  assertHasLine(
    transferInLines,
    {
      accountId: setup.dueToAccountBAId,
      operatingUnitId: setup.operatingUnitBId,
      side: "credit",
      amount: 77,
    },
    "OU -> OU transfer-in should credit target OU due-to-partner account"
  );
  assertNoAccount(
    transferInLines,
    setup.transitAccountId,
    "OU -> OU transfer-in should not post transit clearing"
  );

  return {
    transferId,
    transferOutTxnId,
    transferInTxnId,
  };
}

async function runCentralBankToOuCashScenario(token, setup, stamp) {
  const createRes = await createCashTransaction({
    token,
    tenantId: setup.tenantId,
    registerId: setup.registerAId,
    txnType: "WITHDRAWAL_FROM_BANK",
    amount: "21.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `BANK-CENTRAL-OU-${stamp}`,
    counterAccountId: setup.centralBankAccountGlId,
    expectedStatus: 200,
  });
  const transactionId = toNumber(createRes.json?.row?.id);
  assert(transactionId > 0, "Central bank -> OU cash transaction id missing");

  await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId,
    expectedStatus: 200,
  });

  const lines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId,
  });
  assert(lines.length === 4, "Central bank -> OU cash should post 4 journal lines");
  assertHasLine(
    lines,
    {
      accountId: setup.registerAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "debit",
      amount: 21,
    },
    "Central bank -> OU cash should debit the target branch register"
  );
  assertHasLine(
    lines,
    {
      accountId: setup.ouDueToAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "credit",
      amount: 21,
    },
    "Central bank -> OU cash should credit the branch OU due-to-central account"
  );
  assertHasLine(
    lines,
    {
      accountId: setup.centralDueFromAccountAId,
      operatingUnitId: null,
      side: "debit",
      amount: 21,
    },
    "Central bank -> OU cash should debit the branch central due-from account at no-OU scope"
  );
  assertHasLine(
    lines,
    {
      accountId: setup.centralBankAccountGlId,
      operatingUnitId: null,
      side: "credit",
      amount: 21,
    },
    "Central bank -> OU cash should credit the central bank GL account at no-OU scope"
  );
  assertNoAccount(
    lines,
    setup.transitAccountId,
    "Central bank -> OU cash should not use transit clearing"
  );
  assertNoOuLinesHaveNoSubledgerRef(
    lines,
    "Central bank -> OU cash no-OU lines should not carry subledger reference metadata"
  );

  return {
    transactionId,
  };
}

async function runOuCashToCentralBankScenario(token, setup, stamp) {
  const createRes = await createCashTransaction({
    token,
    tenantId: setup.tenantId,
    registerId: setup.registerAId,
    txnType: "DEPOSIT_TO_BANK",
    amount: "22.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `OU-CENTRAL-BANK-${stamp}`,
    counterAccountId: setup.centralBankAccountGlId,
    expectedStatus: 200,
  });
  const transactionId = toNumber(createRes.json?.row?.id);
  assert(transactionId > 0, "OU cash -> central bank transaction id missing");

  await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId,
    expectedStatus: 200,
  });

  const lines = await loadPostedJournalLines({
    tenantId: setup.tenantId,
    transactionId,
  });
  assert(lines.length === 4, "OU cash -> central bank should post 4 journal lines");
  assertHasLine(
    lines,
    {
      accountId: setup.centralBankAccountGlId,
      operatingUnitId: null,
      side: "debit",
      amount: 22,
    },
    "OU cash -> central bank should debit the central bank GL account at no-OU scope"
  );
  assertHasLine(
    lines,
    {
      accountId: setup.centralDueFromAccountAId,
      operatingUnitId: null,
      side: "credit",
      amount: 22,
    },
    "OU cash -> central bank should credit the branch central due-from account at no-OU scope"
  );
  assertHasLine(
    lines,
    {
      accountId: setup.ouDueToAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "debit",
      amount: 22,
    },
    "OU cash -> central bank should debit the branch OU due-to-central account"
  );
  assertHasLine(
    lines,
    {
      accountId: setup.registerAccountAId,
      operatingUnitId: setup.operatingUnitAId,
      side: "credit",
      amount: 22,
    },
    "OU cash -> central bank should credit the source branch register"
  );
  assertNoAccount(
    lines,
    setup.transitAccountId,
    "OU cash -> central bank should not use transit clearing"
  );
  assertNoOuLinesHaveNoSubledgerRef(
    lines,
    "OU cash -> central bank no-OU lines should not carry subledger reference metadata"
  );

  return {
    transactionId,
  };
}

async function runMissingSetupScenario(token, setup, stamp) {
  const initiateRes = await initiateTransitTransfer({
    token,
    tenantId: setup.tenantId,
    registerId: setup.centralRegisterId,
    targetRegisterId: setup.registerCId,
    amount: "10.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `MISSING-${stamp}`,
    expectedStatus: 201,
  });
  const transferId = toNumber(initiateRes.json?.transfer?.id);
  const transferOutTxnId = toNumber(initiateRes.json?.transferOutTransaction?.id);
  assert(transferId > 0 && transferOutTxnId > 0, "Missing-setup transfer ids missing");

  const failedPost = await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
    expectedStatus: 400,
  });
  const errorText = toErrorText(failedPost.json);
  assert(
    errorText.includes("self-balancing setup is invalid") &&
      errorText.includes("Kasa Islemleri") &&
      errorText.includes("saved current-account repair") &&
      errorText.includes("Organization Management"),
    "Missing setup post failure should direct users to saved-config repair in Kasa Islemleri or Organization Management"
  );
  await assertTransferState(token, transferId, "INITIATED");

  return {
    transferId,
    transferOutTxnId,
    errorText,
  };
}

async function runMissingBankSetupScenario(token, setup, stamp) {
  const createRes = await createCashTransaction({
    token,
    tenantId: setup.tenantId,
    registerId: setup.registerCId,
    txnType: "WITHDRAWAL_FROM_BANK",
    amount: "9.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `BANK-MISSING-${stamp}`,
    counterAccountId: setup.centralBankAccountGlId,
    expectedStatus: 200,
  });
  const transactionId = toNumber(createRes.json?.row?.id);
  assert(transactionId > 0, "Missing-setup bank/cash transaction id missing");

  const failedPost = await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId,
    expectedStatus: 400,
  });
  const errorText = toErrorText(failedPost.json);
  assert(
    errorText.includes("self-balancing setup is invalid") &&
      errorText.includes("Kasa Islemleri") &&
      errorText.includes("saved current-account repair") &&
      errorText.includes("Organization Management"),
    "Missing bank/cash setup post failure should direct users to saved-config repair in Kasa Islemleri or Organization Management"
  );

  return {
    transactionId,
    errorText,
  };
}

async function runDuplicateMappingScenario(token, setup, stamp) {
  await query(
    `UPDATE operating_unit_partner_current_accounts
     SET due_from_account_id = ?
     WHERE tenant_id = ?
       AND operating_unit_id = ?
       AND partner_operating_unit_id = ?`,
    [setup.dueFromAccountABId, setup.tenantId, setup.operatingUnitBId, setup.operatingUnitAId]
  );

  const initiateRes = await initiateTransitTransfer({
    token,
    tenantId: setup.tenantId,
    registerId: setup.registerAId,
    targetRegisterId: setup.registerBId,
    amount: "12.00",
    currencyCode: setup.currencyCode,
    idempotencyKey: `DUPLICATE-${stamp}`,
    expectedStatus: 201,
  });
  const transferId = toNumber(initiateRes.json?.transfer?.id);
  const transferOutTxnId = toNumber(initiateRes.json?.transferOutTransaction?.id);
  assert(transferId > 0 && transferOutTxnId > 0, "Duplicate-mapping transfer ids missing");

  const failedPost = await postCashTransaction({
    token,
    tenantId: setup.tenantId,
    transactionId: transferOutTxnId,
    expectedStatus: 400,
  });
  const errorText = toErrorText(failedPost.json);
  assert(
    errorText.includes("direct inter-branch current-account setup is invalid") &&
      errorText.includes("also assigned to operating unit pair"),
    "Duplicate branch-pair mappings should block cross-context posting with actionable error text"
  );
  await assertTransferState(token, transferId, "INITIATED");

  return {
    transferId,
    transferOutTxnId,
    errorText,
  };
}

async function main() {
  const identity = await createTenantAndAdmin();
  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const adminToken = await login(identity.adminEmail, identity.password);
    const setup = await bootstrapSelfBalancingContext(adminToken, identity);

    const centralToOu = await runCentralToOuScenario(adminToken, setup, identity.stamp);
    const ouToCentral = await runOuToCentralScenario(adminToken, setup, identity.stamp);
    const ouToOu = await runOuToOuScenario(adminToken, setup, identity.stamp);
    const centralBankToOuCash = await runCentralBankToOuCashScenario(
      adminToken,
      setup,
      identity.stamp
    );
    const ouCashToCentralBank = await runOuCashToCentralBankScenario(
      adminToken,
      setup,
      identity.stamp
    );
    const missingSetup = await runMissingSetupScenario(adminToken, setup, identity.stamp);
    const missingBankSetup = await runMissingBankSetupScenario(
      adminToken,
      setup,
      identity.stamp
    );
    const duplicateMapping = await runDuplicateMappingScenario(adminToken, setup, identity.stamp);

    console.log("Cash register ownership CRO05 self-balancing checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          centralToOu,
          ouToCentral,
          ouToOu,
          centralBankToOuCash,
          ouCashToCentralBank,
          missingSetup: {
            transferId: missingSetup.transferId,
            transferOutTxnId: missingSetup.transferOutTxnId,
          },
          missingBankSetup: {
            transactionId: missingBankSetup.transactionId,
          },
          duplicateMapping: {
            transferId: duplicateMapping.transferId,
            transferOutTxnId: duplicateMapping.transferOutTxnId,
          },
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
    console.error("Cash register ownership CRO05 self-balancing test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
