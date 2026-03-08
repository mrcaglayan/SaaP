import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  asUpper,
  bootstrapOrgBookCoa,
  createAccount,
  createAndPostCashTransaction,
  createRegister,
  insertFxRate,
  login,
  seedAndCreateTenantAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EXF06_TEST_PORT || 3127);
const BASE_URL =
  process.env.CASH_EXF06_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF06#12345";

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF06_${stamp}`;
  const tenantName = `EXF06 Tenant ${stamp}`;
  const adminEmail = `exf06_admin_${stamp}@example.com`;

  const identity = await seedAndCreateTenantAdmin({
    tenantCode,
    tenantName,
    adminEmail,
    adminPassword: ADMIN_PASSWORD,
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: ADMIN_PASSWORD,
    });

    const base = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token,
      stamp,
      fiscalYear: 2026,
      baseCurrencyCode: "TRY",
      yearsToGenerate: [2026],
    });

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF06_USD_${String(stamp).slice(-6)}`,
      name: "EXF06 USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const tryRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF06_TRY_${String(stamp).slice(-6)}`,
      name: "EXF06 TRY Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const clearingAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF06_CLR_${String(stamp).slice(-6)}`,
      name: "EXF06 Exchange Clearing",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF06_CNT_${String(stamp).slice(-6)}`,
      name: "EXF06 Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });

    const usdRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: usdRegisterAccountId,
      code: `EXF06-RUSD-${stamp}`,
      name: "EXF06 USD Register",
      currencyCode: "USD",
    });
    const tryRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: tryRegisterAccountId,
      code: `EXF06-RTRY-${stamp}`,
      name: "EXF06 TRY Register",
      currencyCode: "TRY",
    });

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/gl/journal-purpose-accounts",
      body: {
        legalEntityId: base.legalEntityId,
        moduleKey: "CASH",
        purposeCode: "CASH_EXCHANGE_CLEARING",
        accountId: clearingAccountId,
      },
      expectedStatus: 201,
    });

    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-01-10",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 38,
    });
    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-01-20",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 40,
    });

    await createAndPostCashTransaction({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      registerId: usdRegisterId,
      txnType: "RECEIPT",
      txnDatetime: "2026-01-10T09:00:00",
      bookDate: "2026-01-10",
      amount: 100,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EXF06-OPEN-${stamp}`,
      sourceEntityId: `EXF06-OPEN-${stamp}`,
    });

    const openingLot = (
      await query(
        `SELECT id, original_amount_txn, original_amount_base, remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND cash_register_id = ?
         ORDER BY id ASC
         LIMIT 1`,
        [identity.tenantId, usdRegisterId]
      )
    ).rows?.[0];
    assert(openingLot, "Opening foreign-currency receipt should create a lot");
    assert(amountsEqual(openingLot.original_amount_txn, 100), "Opening lot txn should be 100");
    assert(amountsEqual(openingLot.original_amount_base, 3800), "Opening lot base should be 3800");

    const exchangeCreate = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/cash/exchanges",
      body: {
        tenantId: identity.tenantId,
        sourceRegisterId: usdRegisterId,
        targetRegisterId: tryRegisterId,
        postingMode: "DIRECT",
        txnDatetime: "2026-01-20T10:00:00",
        bookDate: "2026-01-20",
        sourceAmountTxn: 40,
        targetAmountTxn: 1600,
        idempotencyKey: `EXF06-DIRECT-${stamp}`,
        integrationEventUid: `EXF06-DIRECT-${stamp}`,
      },
      expectedStatus: 201,
    });

    const exchangeBatchId = toNumber(exchangeCreate.json?.batch?.id);
    const exchangeOutTxnId = toNumber(exchangeCreate.json?.exchangeOutTransaction?.id);
    const exchangeInTxnId = toNumber(exchangeCreate.json?.exchangeInTransaction?.id);
    assert(exchangeBatchId > 0, "Direct exchange batch id should exist");
    assert(exchangeOutTxnId > 0, "Direct exchange out txn id should exist");
    assert(exchangeInTxnId > 0, "Direct exchange in txn id should exist");

    const batchRow = (
      await query(
        `SELECT
           status,
           posting_mode,
           clearing_account_id,
           exchange_out_cash_transaction_id,
           exchange_in_cash_transaction_id
         FROM cash_exchange_batches
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, exchangeBatchId]
      )
    ).rows?.[0];
    assert(batchRow, "Direct exchange batch row should exist");
    assert(asUpper(batchRow.status) === "POSTED", "Direct exchange batch should be POSTED");
    assert(asUpper(batchRow.posting_mode) === "DIRECT", "posting_mode should be DIRECT");
    assert(batchRow.clearing_account_id === null, "Direct mode should not persist clearing_account_id");
    assert(
      toNumber(batchRow.exchange_out_cash_transaction_id) === exchangeOutTxnId,
      "exchange_out_cash_transaction_id should match"
    );
    assert(
      toNumber(batchRow.exchange_in_cash_transaction_id) === exchangeInTxnId,
      "exchange_in_cash_transaction_id should match"
    );

    const principalRows = (
      await query(
        `SELECT id, status, posted_journal_entry_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id IN (?, ?)
         ORDER BY id ASC`,
        [identity.tenantId, exchangeOutTxnId, exchangeInTxnId]
      )
    ).rows || [];
    assert(principalRows.length === 2, "Direct exchange principal transactions should exist");

    const sharedJournalIds = new Set();
    for (const row of principalRows) {
      assert(asUpper(row.status) === "POSTED", "Direct exchange principal txn should be POSTED");
      sharedJournalIds.add(toNumber(row.posted_journal_entry_id));
    }
    assert(sharedJournalIds.size === 1, "Direct exchange legs should share one journal");
    const directJournalEntryId = Array.from(sharedJournalIds)[0];
    assert(directJournalEntryId > 0, "Shared direct journal id must exist");

    const directJournalLines = (
      await query(
        `SELECT account_id, debit_base, credit_base
         FROM journal_lines
         WHERE journal_entry_id = ?
         ORDER BY line_no ASC, id ASC`,
        [directJournalEntryId]
      )
    ).rows || [];
    assert(directJournalLines.length === 2, "Direct exchange journal should have exactly two lines");
    const usdLine = directJournalLines.find(
      (line) => toNumber(line.account_id) === usdRegisterAccountId
    );
    const tryLine = directJournalLines.find(
      (line) => toNumber(line.account_id) === tryRegisterAccountId
    );
    const clearingLine = directJournalLines.find(
      (line) => toNumber(line.account_id) === clearingAccountId
    );
    assert(usdLine, "Direct exchange journal should credit source register");
    assert(tryLine, "Direct exchange journal should debit target register");
    assert(!clearingLine, "Direct exchange journal must not hit clearing even if mapping exists");
    assert(amountsEqual(usdLine.credit_base, 1600), "Source register credit should be 1600 base");
    assert(amountsEqual(tryLine.debit_base, 1600), "Target register debit should be 1600 base");

    const lotMovements = (
      await query(
        `SELECT id, movement_direction, movement_amount_txn, movement_amount_base, carrying_amount_base, realized_fx_base
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?
         ORDER BY line_no ASC`,
        [identity.tenantId, exchangeOutTxnId]
      )
    ).rows || [];
    assert(lotMovements.length === 1, "Direct exchange should consume one lot slice in this scenario");
    const outMovement = lotMovements[0];
    assert(asUpper(outMovement.movement_direction) === "OUT", "Direct exchange lot movement should be OUT");
    assert(amountsEqual(outMovement.movement_amount_txn, 40), "Direct exchange lot movement txn should be 40");
    assert(amountsEqual(outMovement.movement_amount_base, 1600), "Direct exchange lot movement base should be 1600");
    assert(amountsEqual(outMovement.carrying_amount_base, 1520), "Direct exchange carrying base should be 1520");
    assert(amountsEqual(outMovement.realized_fx_base, 80), "Direct exchange realized FX should be 80");

    const lotAfterExchange = (
      await query(
        `SELECT remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, toNumber(openingLot.id)]
      )
    ).rows?.[0];
    assert(lotAfterExchange, "Opening lot should still exist after direct exchange");
    assert(amountsEqual(lotAfterExchange.remaining_amount_txn, 60), "Remaining lot txn should be 60");
    assert(amountsEqual(lotAfterExchange.remaining_amount_base, 2280), "Remaining lot base should be 2280");
    assert(asUpper(lotAfterExchange.status) === "OPEN", "Opening lot should remain OPEN");

    console.log("PR-EXF06 direct-mode exchange test passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          exchangeBatchId,
          exchangeOutTxnId,
          exchangeInTxnId,
          directJournalEntryId,
          openingLotId: toNumber(openingLot.id),
          lotMovementId: toNumber(outMovement.id),
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
    await closePool();
  }
}

main().catch((err) => {
  console.error("PR-EXF06 direct-mode exchange test failed.");
  console.error(err);
  process.exitCode = 1;
});
