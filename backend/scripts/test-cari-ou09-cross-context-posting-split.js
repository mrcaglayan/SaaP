import { closePool } from "../src/db.js";
import { applyCariSettlement } from "../src/services/cari.settlement.service.js";
import {
  assert,
  assertScopeAccess,
  assertThrowsAsync,
  buildReq,
  roundAmount,
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

function findJournalLine(lines, matcher) {
  return (Array.isArray(lines) ? lines : []).find((line) => matcher(line)) || null;
}

function assertJournalLine(
  lines,
  { accountId, operatingUnitId = null, debitBase = null, creditBase = null },
  label
) {
  const match = findJournalLine(lines, (line) => {
    if (toNumber(line.account_id) !== toNumber(accountId)) {
      return false;
    }
    if (normalizeOperatingUnitId(line.operating_unit_id) !== normalizeOperatingUnitId(operatingUnitId)) {
      return false;
    }
    if (debitBase !== null && !amountsEqual(line.debit_base, debitBase)) {
      return false;
    }
    if (creditBase !== null && !amountsEqual(line.credit_base, creditBase)) {
      return false;
    }
    return true;
  });
  assert(match, label);
  return match;
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
      useUnappliedCash: false,
      userId: fixture.userId,
      ...payload,
    },
  });
}

async function main() {
  const fixture = await setupCariOu09Fixture();
  const req = buildReq(fixture.tenantId, fixture.userId);
  const {
    accounts,
    ownerOperatingUnitId,
    collectorOperatingUnitId,
    missingCollectorOperatingUnitId,
  } = fixture;

  const sameContextOpenItem = await fixture.createOpenItem({
    operatingUnitId: collectorOperatingUnitId,
    amountTxn: 15,
    amountBase: 15,
  });
  const sameContextBankLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 15,
  });
  const sameContextResult = await applySettlement(fixture, req, {
    currencyCode: fixture.functionalCurrencyCode,
    incomingAmountTxn: 15,
    bankStatementLineId: sameContextBankLine.id,
    idempotencyKey: uniqueToken("OU09-SAME-"),
    allocations: [{ openItemId: sameContextOpenItem.openItemId, amountTxn: 15 }],
  });
  assert(
    toNumber(sameContextResult?.row?.ownerOperatingUnitId) === collectorOperatingUnitId,
    "Same-context settlement should keep ownerOperatingUnitId on the collector OU"
  );
  assert(
    toNumber(sameContextResult?.row?.collectorOperatingUnitId) === collectorOperatingUnitId,
    "Same-context settlement should keep collectorOperatingUnitId on the collector OU"
  );
  const sameContextLines = await fixture.loadJournalLines(
    sameContextResult?.row?.postedJournalEntryId
  );
  assert(
    sameContextLines.length === 2,
    `Same-context settlement should post 2 lines, got ${sameContextLines.length}`
  );
  assertJournalLine(
    sameContextLines,
    {
      accountId: accounts.collectorBankGlAccountId,
      debitBase: 15,
    },
    "Same-context settlement should still debit the collector bank account"
  );
  assertJournalLine(
    sameContextLines,
    {
      accountId: accounts.arControlAccountId,
      creditBase: 15,
    },
    "Same-context settlement should still credit AR control without internal balancing lines"
  );
  const sameContextCurrentLines = sameContextLines.filter((line) =>
    [
      accounts.centralDueToOwnerAccountId,
      accounts.ownerDueFromCentralAccountId,
      accounts.collectorDueToCentralAccountId,
      accounts.centralDueFromCollectorAccountId,
      accounts.collectorDueToOwnerAccountId,
      accounts.ownerDueFromCollectorAccountId,
    ].includes(toNumber(line.account_id))
  );
  assert(
    sameContextCurrentLines.length === 0,
    "Same-context settlement should not add cross-context internal current-account lines"
  );

  const centralCollectsOwnerOpenItem = await fixture.createOpenItem({
    operatingUnitId: ownerOperatingUnitId,
    amountTxn: 30,
    amountBase: 30,
  });
  const centralBankLine = await fixture.createBankStatementLine({
    contextKey: "CENTRAL",
    amount: 30,
  });
  const centralCollectsOwnerResult = await applySettlement(fixture, req, {
    currencyCode: fixture.functionalCurrencyCode,
    incomingAmountTxn: 30,
    bankStatementLineId: centralBankLine.id,
    idempotencyKey: uniqueToken("OU09-CENTRAL-AR-"),
    allocations: [{ openItemId: centralCollectsOwnerOpenItem.openItemId, amountTxn: 30 }],
  });
  assert(
    toNumber(centralCollectsOwnerResult?.row?.ownerOperatingUnitId) === ownerOperatingUnitId,
    "Central-collector settlement should persist ownerOperatingUnitId"
  );
  assert(
    centralCollectsOwnerResult?.row?.collectorOperatingUnitId === null,
    "Central-collector settlement should persist collectorOperatingUnitId=null"
  );
  const centralCollectsOwnerLines = await fixture.loadJournalLines(
    centralCollectsOwnerResult?.row?.postedJournalEntryId
  );
  assert(
    centralCollectsOwnerLines.length === 4,
    `Central collector settlement should post 4 lines, got ${centralCollectsOwnerLines.length}`
  );
  assertJournalLine(
    centralCollectsOwnerLines,
    {
      accountId: accounts.centralBankGlAccountId,
      operatingUnitId: null,
      debitBase: 30,
    },
    "Central collector settlement should debit central bank"
  );
  assertJournalLine(
    centralCollectsOwnerLines,
    {
      accountId: accounts.centralDueToOwnerAccountId,
      operatingUnitId: null,
      creditBase: 30,
    },
    "Central collector settlement should credit Central Due To Owner"
  );
  assertJournalLine(
    centralCollectsOwnerLines,
    {
      accountId: accounts.ownerDueFromCentralAccountId,
      operatingUnitId: ownerOperatingUnitId,
      debitBase: 30,
    },
    "Central collector settlement should debit Owner Due From Central"
  );
  assertJournalLine(
    centralCollectsOwnerLines,
    {
      accountId: accounts.arControlAccountId,
      operatingUnitId: ownerOperatingUnitId,
      creditBase: 30,
    },
    "Central collector settlement should credit AR control on the owner OU"
  );

  const collectorCollectsCentralOpenItem = await fixture.createOpenItem({
    operatingUnitId: null,
    amountTxn: 40,
    amountBase: 40,
  });
  const collectorBankLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 40,
  });
  const collectorCollectsCentralResult = await applySettlement(fixture, req, {
    currencyCode: fixture.functionalCurrencyCode,
    incomingAmountTxn: 40,
    bankStatementLineId: collectorBankLine.id,
    idempotencyKey: uniqueToken("OU09-OU-CENTRAL-"),
    allocations: [{ openItemId: collectorCollectsCentralOpenItem.openItemId, amountTxn: 40 }],
  });
  assert(
    collectorCollectsCentralResult?.row?.ownerOperatingUnitId === null,
    "Collector->central settlement should persist ownerOperatingUnitId=null"
  );
  assert(
    toNumber(collectorCollectsCentralResult?.row?.collectorOperatingUnitId) ===
      collectorOperatingUnitId,
    "Collector->central settlement should persist collectorOperatingUnitId"
  );
  const collectorCollectsCentralLines = await fixture.loadJournalLines(
    collectorCollectsCentralResult?.row?.postedJournalEntryId
  );
  assert(
    collectorCollectsCentralLines.length === 4,
    `Collector->central settlement should post 4 lines, got ${collectorCollectsCentralLines.length}`
  );
  assertJournalLine(
    collectorCollectsCentralLines,
    {
      accountId: accounts.collectorBankGlAccountId,
      operatingUnitId: collectorOperatingUnitId,
      debitBase: 40,
    },
    "Collector->central settlement should debit collector bank"
  );
  assertJournalLine(
    collectorCollectsCentralLines,
    {
      accountId: accounts.collectorDueToCentralAccountId,
      operatingUnitId: collectorOperatingUnitId,
      creditBase: 40,
    },
    "Collector->central settlement should credit Collector Due To Central"
  );
  assertJournalLine(
    collectorCollectsCentralLines,
    {
      accountId: accounts.centralDueFromCollectorAccountId,
      operatingUnitId: null,
      debitBase: 40,
    },
    "Collector->central settlement should debit Central Due From Collector"
  );
  assertJournalLine(
    collectorCollectsCentralLines,
    {
      accountId: accounts.arControlAccountId,
      operatingUnitId: null,
      creditBase: 40,
    },
    "Collector->central settlement should credit central AR control"
  );

  await fixture.upsertFxRate({
    fromCurrencyCode: "EUR",
    rate: 0.95,
  });
  const collectorCollectsOwnerFxOpenItem = await fixture.createOpenItem({
    operatingUnitId: ownerOperatingUnitId,
    amountTxn: 100,
    amountBase: 90,
    currencyCode: "EUR",
  });
  const collectorFxBankLine = await fixture.createBankStatementLine({
    contextKey: "COLLECTOR",
    amount: 100,
    currencyCode: "EUR",
  });
  const collectorCollectsOwnerFxResult = await applySettlement(fixture, req, {
    currencyCode: "EUR",
    incomingAmountTxn: 100,
    bankStatementLineId: collectorFxBankLine.id,
    idempotencyKey: uniqueToken("OU09-OU-OU-FX-"),
    allocations: [{ openItemId: collectorCollectsOwnerFxOpenItem.openItemId, amountTxn: 100 }],
  });
  assert(
    toNumber(collectorCollectsOwnerFxResult?.row?.ownerOperatingUnitId) === ownerOperatingUnitId,
    "Collector->owner FX settlement should persist ownerOperatingUnitId"
  );
  assert(
    toNumber(collectorCollectsOwnerFxResult?.row?.collectorOperatingUnitId) ===
      collectorOperatingUnitId,
    "Collector->owner FX settlement should persist collectorOperatingUnitId"
  );
  assert(
    amountsEqual(collectorCollectsOwnerFxResult?.row?.realizedFxNetBase, 5),
    `Collector->owner FX settlement should persist realizedFxNetBase=5, got ${collectorCollectsOwnerFxResult?.row?.realizedFxNetBase}`
  );
  const collectorCollectsOwnerFxLines = await fixture.loadJournalLines(
    collectorCollectsOwnerFxResult?.row?.postedJournalEntryId
  );
  assert(
    collectorCollectsOwnerFxLines.length === 5,
    `Collector->owner FX settlement should post 5 lines, got ${collectorCollectsOwnerFxLines.length}`
  );
  assertJournalLine(
    collectorCollectsOwnerFxLines,
    {
      accountId: accounts.collectorBankGlAccountId,
      operatingUnitId: collectorOperatingUnitId,
      debitBase: 95,
    },
    "Collector->owner FX settlement should debit collector bank at settlement base"
  );
  assertJournalLine(
    collectorCollectsOwnerFxLines,
    {
      accountId: accounts.collectorDueToOwnerAccountId,
      operatingUnitId: collectorOperatingUnitId,
      creditBase: 95,
    },
    "Collector->owner FX settlement should credit Collector Due To Owner"
  );
  assertJournalLine(
    collectorCollectsOwnerFxLines,
    {
      accountId: accounts.ownerDueFromCollectorAccountId,
      operatingUnitId: ownerOperatingUnitId,
      debitBase: 95,
    },
    "Collector->owner FX settlement should debit Owner Due From Collector"
  );
  assertJournalLine(
    collectorCollectsOwnerFxLines,
    {
      accountId: accounts.arControlAccountId,
      operatingUnitId: ownerOperatingUnitId,
      creditBase: 90,
    },
    "Collector->owner FX settlement should credit owner AR control at historical base"
  );
  const fxGainLine = assertJournalLine(
    collectorCollectsOwnerFxLines,
    {
      accountId: accounts.fxGainAccountId,
      operatingUnitId: ownerOperatingUnitId,
      creditBase: 5,
    },
    "Collector->owner FX settlement should keep realized FX gain on the owner OU"
  );
  assert(
    normalizeOperatingUnitId(fxGainLine.operating_unit_id) === ownerOperatingUnitId,
    "Realized FX line should stay on the owner OU"
  );

  const missingMappingOpenItem = await fixture.createOpenItem({
    operatingUnitId: ownerOperatingUnitId,
    amountTxn: 20,
    amountBase: 20,
  });
  const missingMappingBankLine = await fixture.createBankStatementLine({
    contextKey: "MISSING",
    amount: 20,
  });
  await assertThrowsAsync(
    () =>
      applySettlement(fixture, req, {
        currencyCode: fixture.functionalCurrencyCode,
        incomingAmountTxn: 20,
        bankStatementLineId: missingMappingBankLine.id,
        idempotencyKey: uniqueToken("OU09-MISSING-"),
        allocations: [{ openItemId: missingMappingOpenItem.openItemId, amountTxn: 20 }],
      }),
    "required partner-specific current-account mappings are missing"
  );
  assert(
    missingCollectorOperatingUnitId > 0,
    "Missing-mapping scenario should use a real collector OU without pair mappings"
  );

  console.log("test-cari-ou09-cross-context-posting-split: ok");
}

main()
  .catch((error) => {
    console.error("test-cari-ou09-cross-context-posting-split: failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
