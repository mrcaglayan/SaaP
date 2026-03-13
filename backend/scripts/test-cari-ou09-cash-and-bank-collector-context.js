import { closePool, query } from "../src/db.js";
import { applyCariSettlement } from "../src/services/cari.settlement.service.js";
import {
  assert,
  assertScopeAccess,
  buildReq,
  setupCariOu09Fixture,
  toNumber,
  uniqueToken,
} from "./cari-ou09-test-helpers.js";

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function normalizeOperatingUnitId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toNumber(value) || null;
}

function findLine(lines, matcher) {
  return (Array.isArray(lines) ? lines : []).find((line) => matcher(line)) || null;
}

function assertLine(lines, { accountId, operatingUnitId = null, debitBase = null, creditBase = null }, label) {
  const line = findLine(lines, (entry) => {
    if (toNumber(entry.account_id) !== toNumber(accountId)) {
      return false;
    }
    if (normalizeOperatingUnitId(entry.operating_unit_id) !== normalizeOperatingUnitId(operatingUnitId)) {
      return false;
    }
    if (debitBase !== null && !amountsEqual(entry.debit_base, debitBase)) {
      return false;
    }
    if (creditBase !== null && !amountsEqual(entry.credit_base, creditBase)) {
      return false;
    }
    return true;
  });
  assert(line, label);
  return line;
}

async function applySettlement(fixture, req, payload) {
  return applyCariSettlement({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      settlementDate: "2026-03-13",
      currencyCode: fixture.functionalCurrencyCode,
      useUnappliedCash: false,
      userId: fixture.userId,
      ...payload,
    },
  });
}

async function main() {
  const fixture = await setupCariOu09Fixture({ prefix: "OU09CB" });
  const req = buildReq(fixture.tenantId, fixture.userId);
  const { accounts, ownerOperatingUnitId, collectorOperatingUnitId } = fixture;

  const bankOpenItem = await fixture.createOpenItem({
    operatingUnitId: ownerOperatingUnitId,
    amountTxn: 25,
    amountBase: 25,
  });
  const bankStatementLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 25,
  });
  const bankResult = await applySettlement(fixture, req, {
    incomingAmountTxn: 25,
    bankStatementLineId: bankStatementLine.id,
    idempotencyKey: uniqueToken("OU09-BANK-"),
    allocations: [{ openItemId: bankOpenItem.openItemId, amountTxn: 25 }],
  });
  assert(
    toNumber(bankResult?.row?.ownerOperatingUnitId) === ownerOperatingUnitId,
    "Bank-linked settlement should persist ownerOperatingUnitId"
  );
  assert(
    toNumber(bankResult?.row?.collectorOperatingUnitId) === collectorOperatingUnitId,
    "Bank-linked settlement should persist collectorOperatingUnitId"
  );
  const bankLines = await fixture.loadJournalLines(bankResult?.row?.postedJournalEntryId);
  assert(bankLines.length === 4, `Bank-linked cross-context settlement should post 4 lines, got ${bankLines.length}`);
  assertLine(
    bankLines,
    {
      accountId: accounts.collectorBankGlAccountId,
      operatingUnitId: collectorOperatingUnitId,
      debitBase: 25,
    },
    "Bank-linked settlement should debit collector bank"
  );
  assertLine(
    bankLines,
    {
      accountId: accounts.collectorDueToOwnerAccountId,
      operatingUnitId: collectorOperatingUnitId,
      creditBase: 25,
    },
    "Bank-linked settlement should credit Collector Due To Owner"
  );
  assertLine(
    bankLines,
    {
      accountId: accounts.ownerDueFromCollectorAccountId,
      operatingUnitId: ownerOperatingUnitId,
      debitBase: 25,
    },
    "Bank-linked settlement should debit Owner Due From Collector"
  );
  assertLine(
    bankLines,
    {
      accountId: accounts.arControlAccountId,
      operatingUnitId: ownerOperatingUnitId,
      creditBase: 25,
    },
    "Bank-linked settlement should credit owner AR control"
  );

  const cashOpenItem = await fixture.createOpenItem({
    operatingUnitId: ownerOperatingUnitId,
    amountTxn: 25,
    amountBase: 25,
  });
  const cashResult = await applySettlement(fixture, req, {
    paymentChannel: "CASH",
    incomingAmountTxn: 25,
    idempotencyKey: uniqueToken("OU09-CASH-"),
    allocations: [{ openItemId: cashOpenItem.openItemId, amountTxn: 25 }],
    linkedCashTransaction: {
      registerId: fixture.collectorCashRegisterId,
      counterAccountId: accounts.arControlAccountId,
      txnDatetime: "2026-03-13 10:15:00",
      bookDate: "2026-03-13",
      referenceNo: uniqueToken("OU09-CASH-REF-").slice(0, 60),
      description: "OU09 collector cash settlement",
      idempotencyKey: uniqueToken("OU09-CASH-TXN-").slice(0, 100),
      integrationEventUid: uniqueToken("OU09-CASH-EVT-").slice(0, 100),
    },
  });
  assert(
    toNumber(cashResult?.row?.ownerOperatingUnitId) === ownerOperatingUnitId,
    "Cash-linked settlement should persist ownerOperatingUnitId"
  );
  assert(
    toNumber(cashResult?.row?.collectorOperatingUnitId) === collectorOperatingUnitId,
    "Cash-linked settlement should persist collectorOperatingUnitId"
  );
  assert(
    toNumber(cashResult?.row?.cashTransactionId) > 0,
    "Cash-linked settlement should create or link a cash transaction"
  );
  const cashLines = await fixture.loadJournalLines(cashResult?.row?.postedJournalEntryId);
  assert(cashLines.length === 4, `Cash-linked cross-context settlement should post 4 lines, got ${cashLines.length}`);
  assertLine(
    cashLines,
    {
      accountId: accounts.collectorCashGlAccountId,
      operatingUnitId: collectorOperatingUnitId,
      debitBase: 25,
    },
    "Cash-linked settlement should debit collector cash"
  );
  assertLine(
    cashLines,
    {
      accountId: accounts.collectorDueToOwnerAccountId,
      operatingUnitId: collectorOperatingUnitId,
      creditBase: 25,
    },
    "Cash-linked settlement should credit Collector Due To Owner"
  );
  assertLine(
    cashLines,
    {
      accountId: accounts.ownerDueFromCollectorAccountId,
      operatingUnitId: ownerOperatingUnitId,
      debitBase: 25,
    },
    "Cash-linked settlement should debit Owner Due From Collector"
  );
  assertLine(
    cashLines,
    {
      accountId: accounts.arControlAccountId,
      operatingUnitId: ownerOperatingUnitId,
      creditBase: 25,
    },
    "Cash-linked settlement should credit owner AR control"
  );

  const linkedCashRowResult = await query(
    `SELECT
        ct.status,
        ct.posted_journal_entry_id,
        ct.counter_account_id,
        cr.operating_unit_id
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
     WHERE ct.tenant_id = ?
       AND ct.id = ?
     LIMIT 1`,
    [fixture.tenantId, cashResult?.row?.cashTransactionId]
  );
  const linkedCashRow = linkedCashRowResult.rows?.[0] || null;
  assert(linkedCashRow, "Expected the linked cash transaction to persist");
  assert(
    String(linkedCashRow.status || "").toUpperCase() === "POSTED",
    "Cash-linked settlement should post the linked cash transaction immediately"
  );
  assert(
    toNumber(linkedCashRow.posted_journal_entry_id) === toNumber(cashResult?.row?.postedJournalEntryId),
    "Cash-linked settlement should reuse the posted cash journal as the settlement journal"
  );
  assert(
    toNumber(linkedCashRow.counter_account_id) === accounts.arControlAccountId,
    "Cash-linked settlement should still require the owner control account on the linked cash transaction"
  );
  assert(
    toNumber(linkedCashRow.operating_unit_id) === collectorOperatingUnitId,
    "Cash-linked settlement should keep the linked cash transaction in the collector OU"
  );

  const bankInternalLines = bankLines.filter((line) =>
    [
      accounts.collectorDueToOwnerAccountId,
      accounts.ownerDueFromCollectorAccountId,
      accounts.arControlAccountId,
    ].includes(toNumber(line.account_id))
  );
  const cashInternalLines = cashLines.filter((line) =>
    [
      accounts.collectorDueToOwnerAccountId,
      accounts.ownerDueFromCollectorAccountId,
      accounts.arControlAccountId,
    ].includes(toNumber(line.account_id))
  );
  assert(
    bankInternalLines.length === 3 && cashInternalLines.length === 3,
    "Bank and cash settlements should both produce the same three non-asset balancing/control lines"
  );
  for (const expected of [
    {
      accountId: accounts.collectorDueToOwnerAccountId,
      operatingUnitId: collectorOperatingUnitId,
      creditBase: 25,
    },
    {
      accountId: accounts.ownerDueFromCollectorAccountId,
      operatingUnitId: ownerOperatingUnitId,
      debitBase: 25,
    },
    {
      accountId: accounts.arControlAccountId,
      operatingUnitId: ownerOperatingUnitId,
      creditBase: 25,
    },
  ]) {
    assertLine(bankInternalLines, expected, "Bank settlement should use the expected internal/control line");
    assertLine(cashInternalLines, expected, "Cash settlement should use the same internal/control line");
  }

  console.log("test-cari-ou09-cash-and-bank-collector-context: ok");
}

main()
  .catch((error) => {
    console.error("test-cari-ou09-cash-and-bank-collector-context: failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
