import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  bootstrapOrgBookCoa,
  login,
  seedAndCreateTenantAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.SHAREHOLDER_CAPITAL_TEST_PORT || 3138);
const BASE_URL =
  process.env.SHAREHOLDER_CAPITAL_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const TEST_DATE = "2026-03-15";
const TEST_DATETIME = `${TEST_DATE}T12:00:00.000Z`;
const MONEY_EPSILON = 0.000001;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, "..");

process.chdir(BACKEND_ROOT);

function assertClose(actual, expected, message) {
  if (Math.abs(Number(actual || 0) - Number(expected || 0)) > MONEY_EPSILON) {
    throw new Error(`${message}. expected=${expected} actual=${actual}`);
  }
}

function buildCode(suffix, prefix) {
  return `${prefix}${suffix}`.slice(0, 50);
}

async function createGlAccount({
  token,
  coaId,
  code,
  name,
  accountType,
  normalSide,
  allowPosting = true,
  parentAccountId = null,
}) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/gl/accounts",
    body: {
      coaId,
      code,
      name,
      accountType,
      normalSide,
      allowPosting,
      parentAccountId,
    },
    expectedStatus: 201,
  });
  const accountId = toNumber(response.json?.id);
  assert(accountId > 0, `GL account create failed for ${code}`);
  return accountId;
}

async function createBankAccount({
  token,
  legalEntityId,
  operatingUnitId = null,
  glAccountId,
  code,
  name,
  currencyCode = "USD",
}) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/bank/accounts",
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
  assert(bankAccountId > 0, `Bank account create failed for ${code}`);
  return bankAccountId;
}

async function createCashRegister({
  token,
  legalEntityId,
  operatingUnitId = null,
  accountId,
  code,
  name,
  sessionMode,
  currencyCode = "USD",
}) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/cash/registers",
    body: {
      legalEntityId,
      ownershipScope: operatingUnitId ? "OPERATING_UNIT" : "CENTRAL",
      operatingUnitId,
      accountId,
      code,
      name,
      registerType: "DRAWER",
      sessionMode,
      currencyCode,
      status: "ACTIVE",
    },
    expectedStatus: 200,
  });
  const registerId = toNumber(response.json?.row?.id);
  assert(registerId > 0, `Cash register create failed for ${code}`);
  return registerId;
}

async function openCashSession({ token, registerId, openingAmount = 0 }) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/cash/sessions/open",
    body: {
      registerId,
      openingAmount,
    },
    expectedStatus: 200,
  });
  const sessionId = toNumber(response.json?.row?.id);
  assert(sessionId > 0, `Cash session open failed for register ${registerId}`);
  return sessionId;
}

async function upsertOperatingUnitCurrentAccounts({
  token,
  legalEntityId,
  code,
  name,
  centralDueFromAccountId,
  ouDueToCentralAccountId,
}) {
  await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-units",
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
}

async function createShareholderFixture({
  token,
  legalEntityId,
  code,
  name,
  committedCapital,
  capitalCreditParentAccountId,
  commitmentDebitParentAccountId,
}) {
  await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/shareholder-journal-config",
    body: {
      legalEntityId,
      capitalCreditParentAccountId,
      commitmentDebitParentAccountId,
    },
    expectedStatus: 201,
  });

  const provision = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/shareholders/auto-provision-sub-accounts",
    body: {
      legalEntityId,
      shareholderCode: code,
      shareholderName: name,
    },
    expectedStatus: 201,
  });
  const capitalSubAccountId = toNumber(provision.json?.capitalSubAccount?.id);
  const commitmentDebitSubAccountId = toNumber(
    provision.json?.commitmentDebitSubAccount?.id
  );
  assert(capitalSubAccountId > 0, "Auto-provision capital sub-account id missing");
  assert(
    commitmentDebitSubAccountId > 0,
    "Auto-provision commitment debit sub-account id missing"
  );

  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/shareholders",
    body: {
      legalEntityId,
      code,
      name,
      shareholderType: "INDIVIDUAL",
      committedCapital,
      capitalSubAccountId,
      commitmentDebitSubAccountId,
      currencyCode: "USD",
      status: "ACTIVE",
      autoCommitmentJournal: false,
      commitmentDate: TEST_DATE,
    },
    expectedStatus: 201,
  });

  return {
    shareholderId: toNumber(response.json?.id),
    capitalSubAccountId,
    commitmentDebitSubAccountId,
  };
}

async function previewCapitalFulfillment(token, payload, expectedStatus = 200) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/shareholders/capital-fulfillments/preview",
    body: payload,
    expectedStatus,
  });
}

async function createCapitalFulfillment(token, payload) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/shareholders/capital-fulfillments",
    body: payload,
    expectedStatus: 201,
  });
}

async function reverseCapitalFulfillment(token, fulfillmentId, reason) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: `/api/v1/org/shareholders/capital-fulfillments/${fulfillmentId}/reverse`,
    body: {
      reason,
    },
    expectedStatus: 200,
  });
}

async function listCapitalFulfillments(token, legalEntityId) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/shareholders/capital-fulfillments?legalEntityId=${legalEntityId}`,
    expectedStatus: 200,
  });
}

async function listShareholders(token, legalEntityId) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/shareholders?legalEntityId=${legalEntityId}`,
    expectedStatus: 200,
  });
}

async function initiateTransitTransfer({
  token,
  registerId,
  targetRegisterId,
  transitAccountId,
  amount,
  idempotencyKey,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/cash/transactions/transit/initiate",
    body: {
      registerId,
      targetRegisterId,
      transitAccountId,
      txnDatetime: TEST_DATETIME,
      bookDate: TEST_DATE,
      amount,
      currencyCode: "USD",
      description: "Shareholder capital transit from HQ to branch",
      referenceNo: `SCF-TR-${idempotencyKey}`.slice(0, 100),
      idempotencyKey,
    },
    expectedStatus: 201,
  });
}

async function postCashTransaction(token, transactionId) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: `/api/v1/cash/transactions/${transactionId}/post`,
    body: {
      overrideCashControl: false,
      overrideReason: null,
    },
    expectedStatus: 200,
  });
}

async function receiveTransitTransfer({ token, transitTransferId, cashSessionId, idempotencyKey }) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: `/api/v1/cash/transactions/transit/${transitTransferId}/receive`,
    body: {
      cashSessionId,
      txnDatetime: TEST_DATETIME,
      bookDate: TEST_DATE,
      description: "Receive shareholder capital transit at branch",
      referenceNo: `SCF-TR-IN-${idempotencyKey}`.slice(0, 100),
      idempotencyKey,
    },
    expectedStatus: 201,
  });
}

async function getTransitTransfer(token, transitTransferId) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/cash/transactions/transit/${transitTransferId}`,
    expectedStatus: 200,
  });
}

async function loadJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
       line_no,
       account_id,
       operating_unit_id,
       debit_base,
       credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalEntryId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

function assertPreviewLine(line, expected) {
  assert(line, `Preview line missing for account ${expected.accountId}`);
  assert(
    toNumber(line.account_id) === toNumber(expected.accountId),
    `Unexpected preview account id on line ${line.line_no}`
  );
  assert(
    toNumber(line.operating_unit_id) === toNumber(expected.operatingUnitId),
    `Unexpected preview operating_unit_id on line ${line.line_no}`
  );
  assertClose(line.debit_base, expected.debitBase, `Unexpected preview debit on line ${line.line_no}`);
  assertClose(
    line.credit_base,
    expected.creditBase,
    `Unexpected preview credit on line ${line.line_no}`
  );
}

function findFulfillmentRow(rows, fulfillmentId) {
  return (Array.isArray(rows) ? rows : []).find(
    (row) => toNumber(row.id) === toNumber(fulfillmentId)
  );
}

function readPostedJournalEntryId(row) {
  return toNumber(row?.postedJournalEntryId || row?.posted_journal_entry_id);
}

async function main() {
  const stamp = String(Date.now());
  const suffix = stamp.slice(-4);
  const tenantCode = buildCode(suffix, "SCF");
  const adminEmail = `shareholder_capital_${stamp}@example.com`;
  const adminPassword = "ShareholderCapital#12345";
  const server = startServerProcess({ port: PORT });

  try {
    const identity = await seedAndCreateTenantAdmin({
      tenantCode,
      tenantName: `Shareholder Capital ${stamp}`,
      adminEmail,
      adminPassword,
    });
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: adminPassword,
    });

    const org = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token,
      stamp: suffix,
      baseCurrencyCode: "USD",
      fiscalYear: 2026,
    });
    const operatingUnitCode = `EX05OU${suffix}`;
    const operatingUnitName = `EX05 OU ${suffix}`;

    const capitalParentAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: "500",
      name: "Shareholder Capital Parent",
      accountType: "EQUITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });
    const commitmentParentAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: "501",
      name: "Shareholder Commitment Parent",
      accountType: "EQUITY",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const centralDueFromAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "136"),
      name: "HQ Due From Branch",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const ouDueToCentralAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "339"),
      name: "Branch Due To HQ",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const centralBankGlAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "1020"),
      name: "HQ Bank GL",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const branchBankGlAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "1021"),
      name: "Branch Bank GL",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const centralRegisterAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "1001"),
      name: "HQ Cash Register GL",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const branchRegisterAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "1002"),
      name: "Branch Cash Register GL",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const transitClearingAccountId = await createGlAccount({
      token,
      coaId: org.coaId,
      code: buildCode(suffix, "1080"),
      name: "Cash In Transit",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });

    await upsertOperatingUnitCurrentAccounts({
      token,
      legalEntityId: org.legalEntityId,
      code: operatingUnitCode,
      name: operatingUnitName,
      centralDueFromAccountId,
      ouDueToCentralAccountId,
    });

    const shareholder = await createShareholderFixture({
      token,
      legalEntityId: org.legalEntityId,
      code: `SH${suffix}`,
      name: `Shareholder ${suffix}`,
      committedCapital: 10000,
      capitalCreditParentAccountId: capitalParentAccountId,
      commitmentDebitParentAccountId: commitmentParentAccountId,
    });
    assert(shareholder.shareholderId > 0, "Shareholder create failed");

    const centralBankAccountId = await createBankAccount({
      token,
      legalEntityId: org.legalEntityId,
      glAccountId: centralBankGlAccountId,
      code: buildCode(suffix, "BANKHQ"),
      name: "HQ Bank Account",
    });
    const branchBankAccountId = await createBankAccount({
      token,
      legalEntityId: org.legalEntityId,
      operatingUnitId: org.operatingUnitId,
      glAccountId: branchBankGlAccountId,
      code: buildCode(suffix, "BANKBR"),
      name: "Branch Bank Account",
    });
    const centralRegisterId = await createCashRegister({
      token,
      legalEntityId: org.legalEntityId,
      accountId: centralRegisterAccountId,
      code: buildCode(suffix, "CASHHQ"),
      name: "HQ Cash Register",
      sessionMode: "OPTIONAL",
    });
    const branchRegisterId = await createCashRegister({
      token,
      legalEntityId: org.legalEntityId,
      operatingUnitId: org.operatingUnitId,
      accountId: branchRegisterAccountId,
      code: buildCode(suffix, "CASHBR"),
      name: "Branch Cash Register",
      sessionMode: "REQUIRED",
    });
    const branchSessionId = await openCashSession({
      token,
      registerId: branchRegisterId,
    });

    const centralBankPayload = {
      legalEntityId: org.legalEntityId,
      shareholderId: shareholder.shareholderId,
      destinationMode: "BANK_ACCOUNT",
      bankAccountId: centralBankAccountId,
      amount: 1000,
      contributionDate: TEST_DATE,
      note: "Central bank fulfillment",
    };
    const centralBankPreview = await previewCapitalFulfillment(token, centralBankPayload);
    assert(
      centralBankPreview.json?.lines?.length === 2,
      "Central bank preview should return 2 journal lines"
    );
    assertPreviewLine(centralBankPreview.json.lines[0], {
      accountId: centralBankGlAccountId,
      operatingUnitId: null,
      debitBase: 1000,
      creditBase: 0,
    });
    assertPreviewLine(centralBankPreview.json.lines[1], {
      accountId: shareholder.commitmentDebitSubAccountId,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 1000,
    });
    const centralBankCreate = await createCapitalFulfillment(token, centralBankPayload);
    const centralBankFulfillmentId = toNumber(centralBankCreate.json?.fulfillmentId);
    assert(centralBankFulfillmentId > 0, "Central bank fulfillment id missing");
    assert(
      !toNumber(centralBankCreate.json?.cashTransactionId),
      "Central bank fulfillment should not create a cash transaction"
    );

    const branchBankPayload = {
      legalEntityId: org.legalEntityId,
      shareholderId: shareholder.shareholderId,
      operatingUnitId: org.operatingUnitId,
      destinationMode: "BANK_ACCOUNT",
      bankAccountId: branchBankAccountId,
      amount: 1500,
      contributionDate: TEST_DATE,
      note: "OU bank fulfillment",
    };
    const branchBankPreview = await previewCapitalFulfillment(token, branchBankPayload);
    assert(
      branchBankPreview.json?.lines?.length === 4,
      "OU bank preview should return 4 journal lines"
    );
    assertPreviewLine(branchBankPreview.json.lines[0], {
      accountId: branchBankGlAccountId,
      operatingUnitId: org.operatingUnitId,
      debitBase: 1500,
      creditBase: 0,
    });
    assertPreviewLine(branchBankPreview.json.lines[1], {
      accountId: ouDueToCentralAccountId,
      operatingUnitId: org.operatingUnitId,
      debitBase: 0,
      creditBase: 1500,
    });
    assertPreviewLine(branchBankPreview.json.lines[2], {
      accountId: centralDueFromAccountId,
      operatingUnitId: null,
      debitBase: 1500,
      creditBase: 0,
    });
    assertPreviewLine(branchBankPreview.json.lines[3], {
      accountId: shareholder.commitmentDebitSubAccountId,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 1500,
    });
    const branchBankCreate = await createCapitalFulfillment(token, branchBankPayload);
    const branchBankFulfillmentId = toNumber(branchBankCreate.json?.fulfillmentId);
    assert(branchBankFulfillmentId > 0, "OU bank fulfillment id missing");

    const centralCashPayload = {
      legalEntityId: org.legalEntityId,
      shareholderId: shareholder.shareholderId,
      destinationMode: "CASH_REGISTER",
      cashRegisterId: centralRegisterId,
      amount: 700,
      contributionDate: TEST_DATE,
      note: "Central cash fulfillment",
    };
    const centralCashPreview = await previewCapitalFulfillment(token, centralCashPayload);
    assert(
      centralCashPreview.json?.lines?.length === 2,
      "Central cash preview should return 2 journal lines"
    );
    assertPreviewLine(centralCashPreview.json.lines[0], {
      accountId: centralRegisterAccountId,
      operatingUnitId: null,
      debitBase: 700,
      creditBase: 0,
    });
    assertPreviewLine(centralCashPreview.json.lines[1], {
      accountId: shareholder.commitmentDebitSubAccountId,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 700,
    });
    const centralCashCreate = await createCapitalFulfillment(token, centralCashPayload);
    const centralCashFulfillmentId = toNumber(centralCashCreate.json?.fulfillmentId);
    const centralCashTransactionId = toNumber(centralCashCreate.json?.cashTransactionId);
    assert(centralCashFulfillmentId > 0, "Central cash fulfillment id missing");
    assert(centralCashTransactionId > 0, "Central cash fulfillment should create cash transaction");

    const transitInit = await initiateTransitTransfer({
      token,
      registerId: centralRegisterId,
      targetRegisterId: branchRegisterId,
      transitAccountId: transitClearingAccountId,
      amount: 250,
      idempotencyKey: `SCF-TRANSIT-${stamp}`,
    });
    const transitTransferId = toNumber(transitInit.json?.transfer?.id);
    const transferOutTransactionId = toNumber(
      transitInit.json?.transferOutTransaction?.id
    );
    assert(transitTransferId > 0, "Transit transfer id missing");
    assert(transferOutTransactionId > 0, "Transit transfer-out transaction id missing");
    assert(
      String(transitInit.json?.transfer?.status || "").toUpperCase() === "INITIATED",
      "Transit transfer should start INITIATED"
    );

    const transferOutPost = await postCashTransaction(token, transferOutTransactionId);
    const transferOutPostedJournalEntryId = readPostedJournalEntryId(
      transferOutPost.json?.row
    );
    assert(
      transferOutPostedJournalEntryId > 0,
      "Transit transfer-out posting should create a journal"
    );
    const transferOutLines = await loadJournalLines(transferOutPostedJournalEntryId);
    const transferOutTransitLine = transferOutLines.find(
      (line) =>
        toNumber(line.account_id) === transitClearingAccountId &&
        Number(line.debit_base || 0) > 0
    );
    assert(
      toNumber(transferOutTransitLine?.operating_unit_id) === org.operatingUnitId,
      "Transit clearing debit should inherit the branch OU when the source register is central"
    );

    const transferAfterPost = await getTransitTransfer(token, transitTransferId);
    assert(
      String(transferAfterPost.json?.transfer?.status || "").toUpperCase() === "IN_TRANSIT",
      "Transit transfer should move to IN_TRANSIT after posting transfer-out"
    );

    const transitReceive = await receiveTransitTransfer({
      token,
      transitTransferId,
      cashSessionId: branchSessionId,
      idempotencyKey: `SCF-TRANSIT-IN-${stamp}`,
    });
    assert(
      String(transitReceive.json?.transfer?.status || "").toUpperCase() === "RECEIVED",
      "Transit transfer should become RECEIVED after receive"
    );
    assert(
      readPostedJournalEntryId(transitReceive.json?.transferInTransaction) > 0,
      "Transit receive should post transfer-in transaction"
    );

    const branchCashMissingSession = await previewCapitalFulfillment(
      token,
      {
        legalEntityId: org.legalEntityId,
        shareholderId: shareholder.shareholderId,
        operatingUnitId: org.operatingUnitId,
        destinationMode: "CASH_REGISTER",
        cashRegisterId: branchRegisterId,
        amount: 900,
        contributionDate: TEST_DATE,
        note: "Branch cash fulfillment without session",
      },
      400
    );
    assert(
      String(branchCashMissingSession.json?.message || "").includes(
        "cashSessionId is required because selected cash register has session_mode=REQUIRED."
      ),
      "Branch cash preview should require an explicit open session when session_mode=REQUIRED"
    );

    const branchCashPayload = {
      legalEntityId: org.legalEntityId,
      shareholderId: shareholder.shareholderId,
      operatingUnitId: org.operatingUnitId,
      destinationMode: "CASH_REGISTER",
      cashRegisterId: branchRegisterId,
      cashSessionId: branchSessionId,
      amount: 900,
      contributionDate: TEST_DATE,
      note: "Branch cash fulfillment",
    };
    const branchCashPreview = await previewCapitalFulfillment(token, branchCashPayload);
    assert(
      branchCashPreview.json?.lines?.length === 4,
      "Branch cash preview should return 4 journal lines"
    );
    assertPreviewLine(branchCashPreview.json.lines[0], {
      accountId: branchRegisterAccountId,
      operatingUnitId: org.operatingUnitId,
      debitBase: 900,
      creditBase: 0,
    });
    assertPreviewLine(branchCashPreview.json.lines[1], {
      accountId: ouDueToCentralAccountId,
      operatingUnitId: org.operatingUnitId,
      debitBase: 0,
      creditBase: 900,
    });
    assertPreviewLine(branchCashPreview.json.lines[2], {
      accountId: centralDueFromAccountId,
      operatingUnitId: null,
      debitBase: 900,
      creditBase: 0,
    });
    assertPreviewLine(branchCashPreview.json.lines[3], {
      accountId: shareholder.commitmentDebitSubAccountId,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 900,
    });
    const branchCashCreate = await createCapitalFulfillment(token, branchCashPayload);
    const branchCashFulfillmentId = toNumber(branchCashCreate.json?.fulfillmentId);
    assert(branchCashFulfillmentId > 0, "Branch cash fulfillment id missing");
    assert(
      toNumber(branchCashCreate.json?.cashTransactionId) > 0,
      "Branch cash fulfillment should create a linked cash transaction"
    );

    const branchCashReverse = await reverseCapitalFulfillment(
      token,
      branchCashFulfillmentId,
      "Reverse branch cash fulfillment"
    );
    assert(
      toNumber(branchCashReverse.json?.cashReversalTransactionId) > 0,
      "Branch cash reversal should create a reversal cash transaction"
    );
    assert(
      toNumber(branchCashReverse.json?.reversalJournalEntryId) > 0,
      "Branch cash reversal should return a reversal journal id"
    );

    const centralBankReverse = await reverseCapitalFulfillment(
      token,
      centralBankFulfillmentId,
      "Reverse central bank fulfillment"
    );
    assert(
      toNumber(centralBankReverse.json?.reversalJournalEntryId) > 0,
      "Central bank reversal should create a reversal journal"
    );

    const fulfillmentList = await listCapitalFulfillments(token, org.legalEntityId);
    const rows = Array.isArray(fulfillmentList.json?.rows) ? fulfillmentList.json.rows : [];
    assert(rows.length === 4, "Expected four shareholder capital fulfillments");

    const centralBankRow = findFulfillmentRow(rows, centralBankFulfillmentId);
    const branchBankRow = findFulfillmentRow(rows, branchBankFulfillmentId);
    const centralCashRow = findFulfillmentRow(rows, centralCashFulfillmentId);
    const branchCashRow = findFulfillmentRow(rows, branchCashFulfillmentId);

    assert(
      String(centralBankRow?.status || "").toUpperCase() === "REVERSED",
      "Central bank fulfillment should be REVERSED in history"
    );
    assert(
      String(branchBankRow?.status || "").toUpperCase() === "POSTED",
      "OU bank fulfillment should remain POSTED in history"
    );
    assert(
      String(centralCashRow?.status || "").toUpperCase() === "POSTED",
      "Central cash fulfillment should remain POSTED in history"
    );
    assert(
      String(branchCashRow?.status || "").toUpperCase() === "REVERSED",
      "Branch cash fulfillment should be REVERSED in history"
    );
    assert(
      toNumber(centralCashRow?.cash_transaction_id) === centralCashTransactionId,
      "Central cash history row should expose linked cash transaction"
    );
    assert(
      toNumber(branchCashRow?.cash_reversal_transaction_id) > 0,
      "Branch cash history row should expose reversal cash transaction"
    );

    const shareholderList = await listShareholders(token, org.legalEntityId);
    const shareholderRow = (shareholderList.json?.rows || []).find(
      (row) => toNumber(row.id) === shareholder.shareholderId
    );
    assert(shareholderRow, "Shareholder row should be returned from read API");
    assertClose(
      shareholderRow.paid_capital,
      2200,
      "Paid capital should reflect posted fulfillments net of reversals"
    );
    assertClose(
      shareholderRow.unpaid_capital,
      7800,
      "Unpaid capital should reflect posted fulfillments net of reversals"
    );

    console.log("Shareholder capital live integration passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: org.legalEntityId,
          operatingUnitId: org.operatingUnitId,
          shareholderId: shareholder.shareholderId,
          fulfillments: {
            centralBankFulfillmentId,
            branchBankFulfillmentId,
            centralCashFulfillmentId,
            branchCashFulfillmentId,
          },
          transitTransferId,
        },
        null,
        2
      )
    );
  } finally {
    server.kill();
    await sleep(250);
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
