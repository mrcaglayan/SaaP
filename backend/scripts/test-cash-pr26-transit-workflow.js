import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const PORT = Number(process.env.CASH_PR26_TEST_PORT || 3126);
const BASE_URL = process.env.CASH_PR26_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_FISCAL_YEAR = 2026;

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
  const tenantCode = `CASH26_${stamp}`;
  const tenantName = `Cash PR26 ${stamp}`;
  const adminEmail = `cash_pr26_admin_${stamp}@example.com`;
  const password = "CashPR26#12345";
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
    [tenantId, adminEmail, passwordHash, "Cash PR26 Admin"]
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

async function bootstrapTransitContext(token, identity) {
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
      name: `Cash PR26 Group ${identity.stamp}`,
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
      name: `Cash PR26 Calendar ${identity.stamp}`,
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
      name: `Cash Transit LE ${identity.stamp}`,
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
      name: `Cash Transit Book ${identity.stamp}`,
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
      name: `Cash Transit CoA ${identity.stamp}`,
    },
    expectedStatus: 201,
  });
  const coaId = toNumber(coaRes.json?.id);
  assert(coaId > 0, "coaId not created");

  const sourceCentralDueFromAccountId = await createAccount({
    token,
    coaId,
    code: `CDA${identity.stamp}`,
    name: "OU A HQ Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const sourceOuDueToAccountId = await createAccount({
    token,
    coaId,
    code: `ODA${identity.stamp}`,
    name: "OU A Due To HQ",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const targetCentralDueFromAccountId = await createAccount({
    token,
    coaId,
    code: `CDB${identity.stamp}`,
    name: "OU B HQ Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const targetOuDueToAccountId = await createAccount({
    token,
    coaId,
    code: `ODB${identity.stamp}`,
    name: "OU B Due To HQ",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const registerAccountAId = await createAccount({
    token,
    coaId,
    code: `CRA${identity.stamp}`,
    name: "Transit Register A",
  });
  const registerAccountBId = await createAccount({
    token,
    coaId,
    code: `CRB${identity.stamp}`,
    name: "Transit Register B",
  });
  const transitAccountId = await createAccount({
    token,
    coaId,
    code: `TRN${identity.stamp}`,
    name: "Cash In Transit",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });

  const ouARes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code: `OUA${identity.stamp}`,
      name: "Transit OU A",
      unitType: "BRANCH",
      hasSubledger: true,
      centralDueFromAccountId: sourceCentralDueFromAccountId,
      ouDueToCentralAccountId: sourceOuDueToAccountId,
    },
    expectedStatus: 201,
  });
  const operatingUnitAId = toNumber(ouARes.json?.id);
  assert(operatingUnitAId > 0, "operatingUnitAId not created");

  const ouBRes = await apiRequest({
    token,
    method: "POST",
    path: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code: `OUB${identity.stamp}`,
      name: "Transit OU B",
      unitType: "BRANCH",
      hasSubledger: true,
      centralDueFromAccountId: targetCentralDueFromAccountId,
      ouDueToCentralAccountId: targetOuDueToAccountId,
    },
    expectedStatus: 201,
  });
  const operatingUnitBId = toNumber(ouBRes.json?.id);
  assert(operatingUnitBId > 0, "operatingUnitBId not created");

  const sourceRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId: operatingUnitAId,
    accountId: registerAccountAId,
    code: `RGA${identity.stamp}`,
    name: "Transit Register A",
    currencyCode,
  });
  const targetRegisterId = await createRegister({
    token,
    tenantId: identity.tenantId,
    legalEntityId,
    operatingUnitId: operatingUnitBId,
    accountId: registerAccountBId,
    code: `RGB${identity.stamp}`,
    name: "Transit Register B",
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
    currencyCode,
    legalEntityId,
    sourceRegisterId,
    targetRegisterId,
    sourceRegisterAccountId: registerAccountAId,
    targetRegisterAccountId: registerAccountBId,
    sourceCentralDueFromAccountId,
    sourceOuDueToAccountId,
    targetCentralDueFromAccountId,
    targetOuDueToAccountId,
    operatingUnitAId,
    operatingUnitBId,
    transitAccountId,
  };
}

async function getTransitTransfer({ token, transitTransferId, expectedStatus = 200 }) {
  return apiRequest({
    token,
    method: "GET",
    path: `/api/v1/cash/transactions/transit/${transitTransferId}`,
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

async function reverseCashTransaction({
  token,
  tenantId,
  transactionId,
  reverseReason,
  expectedStatus = 200,
}) {
  return apiRequest({
    token,
    method: "POST",
    path: `/api/v1/cash/transactions/${transactionId}/reverse`,
    body: { tenantId, reverseReason },
    expectedStatus,
  });
}

async function assertTransferOutPostingUsesSelfBalancingAccounts({
  tenantId,
  transactionId,
  sourceRegisterAccountId,
  sourceCentralDueFromAccountId,
  sourceOuDueToAccountId,
  targetCentralDueFromAccountId,
  sourceOperatingUnitId,
  amount,
  transitAccountId,
}) {
  const txnResult = await query(
    `SELECT posted_journal_entry_id
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, transactionId]
  );
  const journalEntryId = toNumber(txnResult.rows[0]?.posted_journal_entry_id);
  assert(journalEntryId > 0, "transfer-out posted_journal_entry_id is missing");

  const lineResult = await query(
    `SELECT account_id, operating_unit_id, debit_base, credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?`,
    [journalEntryId]
  );
  const lines = lineResult.rows || [];
  assert(lines.length >= 4, "Expected self-balancing transfer-out journal lines");

  const hasSourceOuDebit = lines.some(
    (line) =>
      toNumber(line.account_id) === sourceOuDueToAccountId &&
      toNumber(line.operating_unit_id) === sourceOperatingUnitId &&
      Number(line.debit_base || 0) >= Number(amount) - 0.000001
  );
  const hasTargetCentralDebit = lines.some(
    (line) =>
      toNumber(line.account_id) === targetCentralDueFromAccountId &&
      !toNumber(line.operating_unit_id) &&
      Number(line.debit_base || 0) >= Number(amount) - 0.000001
  );
  const hasSourceCredit = lines.some(
    (line) =>
      toNumber(line.account_id) === sourceRegisterAccountId &&
      toNumber(line.operating_unit_id) === sourceOperatingUnitId &&
      Number(line.credit_base || 0) >= Number(amount) - 0.000001
  );
  const hasSourceCentralCredit = lines.some(
    (line) =>
      toNumber(line.account_id) === sourceCentralDueFromAccountId &&
      !toNumber(line.operating_unit_id) &&
      Number(line.credit_base || 0) >= Number(amount) - 0.000001
  );
  const usesTransitAccount = lines.some(
    (line) => toNumber(line.account_id) === transitAccountId
  );
  assert(hasSourceOuDebit, "Transfer-out journal must debit source OU due-to account");
  assert(
    hasTargetCentralDebit,
    "Transfer-out journal must debit target OU HQ due-from account at no-OU scope"
  );
  assert(hasSourceCredit, "Transfer-out journal must credit source register account");
  assert(
    hasSourceCentralCredit,
    "Transfer-out journal must credit source OU HQ due-from account at no-OU scope"
  );
  assert(!usesTransitAccount, "Transfer-out journal should not post the transit clearing account");
}

async function assertTransferInPostingUsesSelfBalancingAccounts({
  tenantId,
  transactionId,
  targetRegisterAccountId,
  targetOuDueToAccountId,
  targetOperatingUnitId,
  amount,
  transitAccountId,
}) {
  const txnResult = await query(
    `SELECT posted_journal_entry_id
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, transactionId]
  );
  const journalEntryId = toNumber(txnResult.rows[0]?.posted_journal_entry_id);
  assert(journalEntryId > 0, "transfer-in posted_journal_entry_id is missing");

  const lineResult = await query(
    `SELECT account_id, operating_unit_id, debit_base, credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?`,
    [journalEntryId]
  );
  const lines = lineResult.rows || [];
  assert(lines.length >= 2, "Expected self-balancing transfer-in journal lines");

  const hasTargetRegisterDebit = lines.some(
    (line) =>
      toNumber(line.account_id) === targetRegisterAccountId &&
      toNumber(line.operating_unit_id) === targetOperatingUnitId &&
      Number(line.debit_base || 0) >= Number(amount) - 0.000001
  );
  const hasTargetOuCredit = lines.some(
    (line) =>
      toNumber(line.account_id) === targetOuDueToAccountId &&
      toNumber(line.operating_unit_id) === targetOperatingUnitId &&
      Number(line.credit_base || 0) >= Number(amount) - 0.000001
  );
  const usesTransitAccount = lines.some(
    (line) => toNumber(line.account_id) === transitAccountId
  );

  assert(hasTargetRegisterDebit, "Transfer-in journal must debit target register account");
  assert(hasTargetOuCredit, "Transfer-in journal must credit target OU due-to account");
  assert(!usesTransitAccount, "Transfer-in journal should not post the transit clearing account");
}

async function main() {
  const identity = await createTenantAndAdmin();
  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const adminToken = await login(identity.adminEmail, identity.password);
    const setup = await bootstrapTransitContext(adminToken, identity);

    const initiateRes = await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/cash/transactions/transit/initiate",
      body: {
        tenantId: identity.tenantId,
        registerId: setup.sourceRegisterId,
        targetRegisterId: setup.targetRegisterId,
        amount: "110.50",
        currencyCode: setup.currencyCode,
        idempotencyKey: `PR26-TRANSIT-INIT-${identity.stamp}`,
        description: "PR26 transit out",
      },
      expectedStatus: 201,
    });
    const transferId = toNumber(initiateRes.json?.transfer?.id);
    const transferOutTxnId = toNumber(initiateRes.json?.transferOutTransaction?.id);
    assert(transferId > 0, "Transit transfer id missing");
    assert(transferOutTxnId > 0, "Transfer-out transaction id missing");
    assert(
      String(initiateRes.json?.transfer?.status || "").toUpperCase() === "INITIATED",
      "Transit transfer must start in INITIATED status"
    );

    await postCashTransaction({
      token: adminToken,
      tenantId: identity.tenantId,
      transactionId: transferOutTxnId,
      expectedStatus: 200,
    });

    const inTransitRes = await getTransitTransfer({
      token: adminToken,
      transitTransferId: transferId,
      expectedStatus: 200,
    });
    assert(
      String(inTransitRes.json?.transfer?.status || "").toUpperCase() === "IN_TRANSIT",
      "Transit transfer must move to IN_TRANSIT after transfer-out post"
    );

    await assertTransferOutPostingUsesSelfBalancingAccounts({
      tenantId: identity.tenantId,
      transactionId: transferOutTxnId,
      sourceRegisterAccountId: setup.sourceRegisterAccountId,
      sourceCentralDueFromAccountId: setup.sourceCentralDueFromAccountId,
      sourceOuDueToAccountId: setup.sourceOuDueToAccountId,
      targetCentralDueFromAccountId: setup.targetCentralDueFromAccountId,
      sourceOperatingUnitId: setup.operatingUnitAId,
      amount: 110.5,
      transitAccountId: setup.transitAccountId,
    });

    const receiveRes = await apiRequest({
      token: adminToken,
      method: "POST",
      path: `/api/v1/cash/transactions/transit/${transferId}/receive`,
      body: {
        tenantId: identity.tenantId,
        idempotencyKey: `PR26-TRANSIT-RECEIVE-${identity.stamp}`,
        description: "PR26 transit receive",
      },
      expectedStatus: 201,
    });
    const transferInTxnId = toNumber(receiveRes.json?.transferInTransaction?.id);
    assert(transferInTxnId > 0, "Transfer-in transaction id missing");
    assert(
      String(receiveRes.json?.transfer?.status || "").toUpperCase() === "RECEIVED",
      "Transit transfer must move to RECEIVED after receive"
    );
    assert(
      String(receiveRes.json?.transferInTransaction?.status || "").toUpperCase() === "POSTED",
      "Transit receive should create a POSTED transfer-in transaction"
    );
    await assertTransferInPostingUsesSelfBalancingAccounts({
      tenantId: identity.tenantId,
      transactionId: transferInTxnId,
      targetRegisterAccountId: setup.targetRegisterAccountId,
      targetOuDueToAccountId: setup.targetOuDueToAccountId,
      targetOperatingUnitId: setup.operatingUnitBId,
      amount: 110.5,
      transitAccountId: setup.transitAccountId,
    });

    const duplicateReceiveRes = await apiRequest({
      token: adminToken,
      method: "POST",
      path: `/api/v1/cash/transactions/transit/${transferId}/receive`,
      body: {
        tenantId: identity.tenantId,
        idempotencyKey: `PR26-TRANSIT-RECEIVE-${identity.stamp}`,
      },
      expectedStatus: 200,
    });
    assert(
      duplicateReceiveRes.json?.idempotentReplay === true,
      "Duplicate receive call must return idempotent replay"
    );
    assert(
      toNumber(duplicateReceiveRes.json?.transferInTransaction?.id) === transferInTxnId,
      "Duplicate receive replay must return same transfer-in transaction"
    );

    const reverseReceiveRes = await reverseCashTransaction({
      token: adminToken,
      tenantId: identity.tenantId,
      transactionId: transferInTxnId,
      reverseReason: "PR26 reverse receive for audit trail",
      expectedStatus: 200,
    });
    assert(
      String(reverseReceiveRes.json?.original?.status || "").toUpperCase() === "REVERSED",
      "Transfer-in original transaction must be REVERSED"
    );
    assert(
      String(reverseReceiveRes.json?.reversal?.status || "").toUpperCase() === "POSTED",
      "Transfer-in reversal transaction must be POSTED"
    );

    const reversedTransitRes = await getTransitTransfer({
      token: adminToken,
      transitTransferId: transferId,
      expectedStatus: 200,
    });
    assert(
      String(reversedTransitRes.json?.transfer?.status || "").toUpperCase() === "REVERSED",
      "Transit transfer must move to REVERSED after linked reversal"
    );
    assert(
      String(reversedTransitRes.json?.transfer?.reverse_reason || "").includes("PR26 reverse receive"),
      "Transit transfer reverse_reason must keep audit reason"
    );

    const cancelInitRes = await apiRequest({
      token: adminToken,
      method: "POST",
      path: "/api/v1/cash/transactions/transit/initiate",
      body: {
        tenantId: identity.tenantId,
        registerId: setup.sourceRegisterId,
        targetRegisterId: setup.targetRegisterId,
        amount: "40.00",
        currencyCode: setup.currencyCode,
        idempotencyKey: `PR26-TRANSIT-CANCEL-${identity.stamp}`,
        description: "PR26 transit to cancel",
      },
      expectedStatus: 201,
    });
    const cancelTransferId = toNumber(cancelInitRes.json?.transfer?.id);
    const cancelOutTxnId = toNumber(cancelInitRes.json?.transferOutTransaction?.id);
    assert(cancelTransferId > 0 && cancelOutTxnId > 0, "Cancel scenario transfer IDs missing");

    const cancelRes = await apiRequest({
      token: adminToken,
      method: "POST",
      path: `/api/v1/cash/transactions/transit/${cancelTransferId}/cancel`,
      body: {
        tenantId: identity.tenantId,
        cancelReason: "PR26 cancel before post",
      },
      expectedStatus: 200,
    });
    assert(
      String(cancelRes.json?.transfer?.status || "").toUpperCase() === "CANCELED",
      "Transit transfer must move to CANCELED"
    );
    assert(
      String(cancelRes.json?.transferOutTransaction?.status || "").toUpperCase() === "CANCELLED",
      "Transfer-out transaction must be CANCELLED when transit is canceled"
    );

    const cancelReplayRes = await apiRequest({
      token: adminToken,
      method: "POST",
      path: `/api/v1/cash/transactions/transit/${cancelTransferId}/cancel`,
      body: {
        tenantId: identity.tenantId,
        cancelReason: "PR26 cancel replay",
      },
      expectedStatus: 200,
    });
    assert(cancelReplayRes.json?.idempotentReplay === true, "Duplicate transit cancel must replay");

    console.log("PR26 cash transit workflow checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          transferId,
          transferOutTxnId,
          transferInTxnId,
          canceledTransferId: cancelTransferId,
          canceledTransferOutTxnId: cancelOutTxnId,
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
    console.error("PR26 cash transit workflow test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
