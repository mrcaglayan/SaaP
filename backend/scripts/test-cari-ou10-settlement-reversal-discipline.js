import { closePool } from "../src/db.js";
import {
  applyCariSettlement,
  reverseCariSettlementById,
} from "../src/services/cari.settlement.service.js";
import {
  applyCariFromCashTransactionById,
  createCashTransaction,
  postCashTransactionById,
  reverseCashTransactionById,
} from "../src/services/cash.transaction.service.js";
import {
  assert,
  assertScopeAccess,
  assertThrowsAsync,
  buildReq,
  setupCariOu09Fixture,
  toNumber,
  uniqueToken,
} from "./cari-ou09-test-helpers.js";

const TEST_DATE = "2026-03-13";

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function normalizeOperatingUnitId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toNumber(value) || null;
}

function normalizeJournalLine(line) {
  return {
    accountId: toNumber(line?.accountId ?? line?.account_id),
    operatingUnitId: normalizeOperatingUnitId(
      line?.operatingUnitId ?? line?.operating_unit_id
    ),
    amountTxn: Number(line?.amountTxn ?? line?.amount_txn ?? 0),
    debitBase: Number(line?.debitBase ?? line?.debit_base ?? 0),
    creditBase: Number(line?.creditBase ?? line?.credit_base ?? 0),
  };
}

function assertReversalMirrorsOriginal(originalLines, reversalLines, label) {
  assert(
    Array.isArray(originalLines) && Array.isArray(reversalLines),
    `${label}: journal lines must be arrays`
  );
  assert(
    originalLines.length === reversalLines.length,
    `${label}: expected ${originalLines.length} reversal lines, got ${reversalLines.length}`
  );

  for (let index = 0; index < originalLines.length; index += 1) {
    const original = normalizeJournalLine(originalLines[index]);
    const reversal = normalizeJournalLine(reversalLines[index]);
    assert(
      reversal.accountId === original.accountId,
      `${label}: line ${index + 1} should keep account ${original.accountId}`
    );
    assert(
      reversal.operatingUnitId === original.operatingUnitId,
      `${label}: line ${index + 1} should keep operatingUnitId ${String(original.operatingUnitId)}`
    );
    assert(
      amountsEqual(reversal.debitBase, original.creditBase),
      `${label}: line ${index + 1} should debit ${original.creditBase}, got ${reversal.debitBase}`
    );
    assert(
      amountsEqual(reversal.creditBase, original.debitBase),
      `${label}: line ${index + 1} should credit ${original.debitBase}, got ${reversal.creditBase}`
    );
    assert(
      amountsEqual(reversal.amountTxn, 0 - original.amountTxn),
      `${label}: line ${index + 1} should negate amountTxn ${original.amountTxn}, got ${reversal.amountTxn}`
    );
  }
}

async function applySettlement(fixture, req, payload) {
  return applyCariSettlement({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      direction: "AR",
      settlementDate: TEST_DATE,
      currencyCode: fixture.functionalCurrencyCode,
      useUnappliedCash: false,
      userId: fixture.userId,
      ...payload,
    },
  });
}

async function reverseSettlement(fixture, req, settlementBatchId, reason) {
  return reverseCariSettlementById({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      settlementBatchId,
      reversalDate: TEST_DATE,
      reason,
      userId: fixture.userId,
    },
  });
}

async function createPostedCashReceipt(fixture, req, amount, suffix) {
  const createResult = await createCashTransaction({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      registerId: fixture.collectorCashRegisterId,
      txnType: "RECEIPT",
      txnDatetime: `${TEST_DATE} 10:00:00`,
      bookDate: TEST_DATE,
      amount,
      currencyCode: fixture.functionalCurrencyCode,
      description: `OU10 cash receipt ${suffix}`,
      referenceNo: null,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: "CUSTOMER",
      counterpartyId: fixture.counterpartyId,
      counterAccountId: fixture.accounts.arControlAccountId,
      counterCashRegisterId: null,
      linkedCariSettlementBatchId: null,
      linkedCariUnappliedCashId: null,
      idempotencyKey: uniqueToken(`OU10-CASH-TXN-${suffix}-`),
      integrationEventUid: null,
      userId: fixture.userId,
    },
  });
  const cashTransactionId = toNumber(createResult?.row?.id);
  assert(cashTransactionId > 0, `Failed to create posted cash receipt ${suffix}`);

  await postCashTransactionById({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      transactionId: cashTransactionId,
      userId: fixture.userId,
      overrideCashControl: false,
      overrideReason: null,
    },
  });

  return cashTransactionId;
}

async function main() {
  const fixture = await setupCariOu09Fixture({ prefix: "OU10" });
  const req = buildReq(fixture.tenantId, fixture.userId);

  const reversalRootOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 70,
    amountBase: 70,
  });
  const reversalRootBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 70,
  });
  const reversalRoot = await applySettlement(fixture, req, {
    incomingAmountTxn: 70,
    bankStatementLineId: reversalRootBankLine.id,
    idempotencyKey: uniqueToken("OU10-REV-ROOT-"),
    allocations: [{ openItemId: reversalRootOpenItem.openItemId, amountTxn: 70 }],
  });
  assert(
    reversalRoot?.row?.originatingCrossContextSettlementBatchId === null,
    "Original cross-context settlement should not set originating linkage on itself"
  );
  const reversalOfRoot = await reverseSettlement(
    fixture,
    req,
    reversalRoot?.row?.id,
    "OU10 reversal mirror test"
  );
  assertReversalMirrorsOriginal(
    reversalRoot?.journal?.lines || [],
    reversalOfRoot?.journal?.lines || [],
    "Cross-context settlement reversal"
  );
  assert(
    toNumber(reversalOfRoot?.row?.reversalOfSettlementBatchId) === toNumber(reversalRoot?.row?.id),
    "Reversal settlement should point back to the original root settlement batch"
  );
  assert(
    toNumber(reversalOfRoot?.row?.ownerOperatingUnitId) === fixture.ownerOperatingUnitId,
    "Reversal settlement should keep ownerOperatingUnitId on the original owner OU"
  );
  assert(
    reversalOfRoot?.row?.collectorOperatingUnitId === null,
    "Reversal settlement should keep collectorOperatingUnitId in central context"
  );

  const blockedRootOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 55,
    amountBase: 55,
  });
  const blockedRootBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 55,
  });
  const blockedRoot = await applySettlement(fixture, req, {
    incomingAmountTxn: 55,
    bankStatementLineId: blockedRootBankLine.id,
    idempotencyKey: uniqueToken("OU10-BLOCKED-ROOT-"),
    allocations: [{ openItemId: blockedRootOpenItem.openItemId, amountTxn: 55 }],
  });
  const downstreamOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.collectorOperatingUnitId,
    amountTxn: 20,
    amountBase: 20,
  });
  const downstreamBankLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 20,
  });
  const downstreamSettlement = await applySettlement(fixture, req, {
    incomingAmountTxn: 20,
    bankStatementLineId: downstreamBankLine.id,
    idempotencyKey: uniqueToken("OU10-DOWNSTREAM-"),
    sourceModule: "CARI",
    sourceEntityType: "cari_settlement_batch",
    sourceEntityId: String(blockedRoot?.row?.id),
    allocations: [{ openItemId: downstreamOpenItem.openItemId, amountTxn: 20 }],
  });
  assert(
    toNumber(downstreamSettlement?.row?.originatingCrossContextSettlementBatchId) ===
      toNumber(blockedRoot?.row?.id),
    "Downstream settlement should retain explicit linkage to the originating cross-context settlement"
  );
  await assertThrowsAsync(
    () =>
      reverseSettlement(
        fixture,
        req,
        blockedRoot?.row?.id,
        "OU10 dependency-order should block root reversal"
      ),
    "Reverse downstream internal settlement first."
  );
  await reverseSettlement(
    fixture,
    req,
    downstreamSettlement?.row?.id,
    "OU10 reverse downstream first"
  );
  const blockedRootReversal = await reverseSettlement(
    fixture,
    req,
    blockedRoot?.row?.id,
    "OU10 root reversal after downstream reverse"
  );
  assert(
    toNumber(blockedRootReversal?.row?.reversalOfSettlementBatchId) ===
      toNumber(blockedRoot?.row?.id),
    "Root reversal should succeed after downstream internal settlement is reversed"
  );

  const explicitRootOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 35,
    amountBase: 35,
  });
  const explicitRootBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 35,
  });
  const explicitRoot = await applySettlement(fixture, req, {
    incomingAmountTxn: 35,
    bankStatementLineId: explicitRootBankLine.id,
    idempotencyKey: uniqueToken("OU10-EXPLICIT-ROOT-"),
    allocations: [{ openItemId: explicitRootOpenItem.openItemId, amountTxn: 35 }],
  });
  const unrelatedOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 12,
    amountBase: 12,
  });
  const unrelatedBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 12,
  });
  const unrelatedSettlement = await applySettlement(fixture, req, {
    incomingAmountTxn: 12,
    bankStatementLineId: unrelatedBankLine.id,
    idempotencyKey: uniqueToken("OU10-UNRELATED-"),
    allocations: [{ openItemId: unrelatedOpenItem.openItemId, amountTxn: 12 }],
  });
  assert(
    unrelatedSettlement?.row?.originatingCrossContextSettlementBatchId === null,
    "Unrelated settlement should not inherit originating linkage without explicit source reference"
  );
  const explicitRootReversal = await reverseSettlement(
    fixture,
    req,
    explicitRoot?.row?.id,
    "OU10 explicit-link blocking only"
  );
  assert(
    toNumber(explicitRootReversal?.row?.reversalOfSettlementBatchId) ===
      toNumber(explicitRoot?.row?.id),
    "Root reversal should ignore unrelated posted settlements without explicit originating linkage"
  );

  const cashRootOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.ownerOperatingUnitId,
    amountTxn: 45,
    amountBase: 45,
  });
  const cashTransactionId = await createPostedCashReceipt(fixture, req, 45, "ROOT");
  const cashLinkedRoot = await applyCariFromCashTransactionById({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      transactionId: cashTransactionId,
      settlementDate: TEST_DATE,
      idempotencyKey: uniqueToken("OU10-CASH-APPLY-"),
      userId: fixture.userId,
      applications: [{ openItemId: cashRootOpenItem.openItemId, amountTxn: 45 }],
    },
  });
  assert(
    toNumber(cashLinkedRoot?.row?.cashTransactionId) === cashTransactionId,
    "Cash-linked settlement should persist cashTransactionId"
  );
  const cashDownstreamOpenItem = await fixture.createOpenItem({
    operatingUnitId: fixture.collectorOperatingUnitId,
    amountTxn: 8,
    amountBase: 8,
  });
  const cashDownstreamBankLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 8,
  });
  const cashDownstreamSettlement = await applySettlement(fixture, req, {
    incomingAmountTxn: 8,
    bankStatementLineId: cashDownstreamBankLine.id,
    idempotencyKey: uniqueToken("OU10-CASH-DOWNSTREAM-"),
    sourceModule: "CARI",
    sourceEntityType: "cari_settlement_batch",
    sourceEntityId: String(cashLinkedRoot?.row?.id),
    allocations: [{ openItemId: cashDownstreamOpenItem.openItemId, amountTxn: 8 }],
  });
  assert(
    toNumber(cashDownstreamSettlement?.row?.originatingCrossContextSettlementBatchId) ===
      toNumber(cashLinkedRoot?.row?.id),
    "Cash-linked downstream settlement should retain explicit originating cross-context linkage"
  );
  await assertThrowsAsync(
    () =>
      reverseCashTransactionById({
        req,
        assertScopeAccess,
        payload: {
          tenantId: fixture.tenantId,
          transactionId: cashTransactionId,
          reversalDate: TEST_DATE,
          reverseReason: "OU10 downstream-linked cash reverse should block",
          userId: fixture.userId,
        },
      }),
    "Reverse downstream internal settlement first."
  );
  await reverseSettlement(
    fixture,
    req,
    cashDownstreamSettlement?.row?.id,
    "OU10 reverse cash-linked downstream first"
  );
  const cashReversal = await reverseCashTransactionById({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      transactionId: cashTransactionId,
      reversalDate: TEST_DATE,
      reverseReason: "OU10 cash reversal after downstream reverse",
      userId: fixture.userId,
    },
  });
  assert(
    toNumber(cashReversal?.reversal?.id) > 0,
    "Cash reversal should succeed after downstream internal settlement is reversed"
  );

  console.log("test-cari-ou10-settlement-reversal-discipline: ok");
}

main()
  .catch((error) => {
    console.error("test-cari-ou10-settlement-reversal-discipline: failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
