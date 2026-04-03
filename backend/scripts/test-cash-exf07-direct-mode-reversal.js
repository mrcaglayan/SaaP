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
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EXF07_TEST_PORT || 3128);
const BASE_URL =
  process.env.CASH_EXF07_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF07#12345";

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF07_${stamp}`;
  const tenantName = `EXF07 Tenant ${stamp}`;
  const adminEmail = `exf07_admin_${stamp}@example.com`;

  const identity = await seedAndCreateBootstrapAdmin({
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
      code: `EXF07_USD_${String(stamp).slice(-6)}`,
      name: "EXF07 USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const tryRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF07_TRY_${String(stamp).slice(-6)}`,
      name: "EXF07 TRY Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const clearingAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF07_CLR_${String(stamp).slice(-6)}`,
      name: "EXF07 Exchange Clearing",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF07_CNT_${String(stamp).slice(-6)}`,
      name: "EXF07 Cash Counter",
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
      code: `EXF07-RUSD-${stamp}`,
      name: "EXF07 USD Register",
      currencyCode: "USD",
    });
    const tryRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: tryRegisterAccountId,
      code: `EXF07-RTRY-${stamp}`,
      name: "EXF07 TRY Register",
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

    const openingReceipt = await createAndPostCashTransaction({
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
      idempotencyKey: `EXF07-OPEN-${stamp}`,
      sourceEntityId: `EXF07-OPEN-${stamp}`,
    });
    const openingReceiptId = toNumber(openingReceipt?.transactionId);
    assert(openingReceiptId > 0, "Opening foreign-currency receipt should be posted");

    const openingLot = (
      await query(
        `SELECT id, remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND opened_by_cash_transaction_id = ?
         LIMIT 1`,
        [identity.tenantId, openingReceiptId]
      )
    ).rows?.[0];
    assert(openingLot, "Opening lot should exist");

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
        txnDatetime: "2026-01-20T12:00:00",
        bookDate: "2026-01-20",
        sourceAmountTxn: 40,
        targetAmountTxn: 1600,
        idempotencyKey: `EXF07-DIRECT-${stamp}`,
        integrationEventUid: `EXF07-DIRECT-${stamp}`,
      },
      expectedStatus: 201,
    });
    const exchangeBatchId = toNumber(exchangeCreate.json?.batch?.id);
    const exchangeOutTxnId = toNumber(exchangeCreate.json?.exchangeOutTransaction?.id);
    const exchangeInTxnId = toNumber(exchangeCreate.json?.exchangeInTransaction?.id);
    assert(exchangeBatchId > 0, "Direct exchange batch should be created");
    assert(exchangeOutTxnId > 0, "Direct exchange out should exist");
    assert(exchangeInTxnId > 0, "Direct exchange in should exist");

    const originalRows = (
      await query(
        `SELECT id, status, posted_journal_entry_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id IN (?, ?)
         ORDER BY id ASC`,
        [identity.tenantId, exchangeOutTxnId, exchangeInTxnId]
      )
    ).rows || [];
    assert(originalRows.length === 2, "Original direct transactions should exist");
    const originalJournalIds = new Set(originalRows.map((row) => toNumber(row.posted_journal_entry_id)));
    assert(originalJournalIds.size === 1, "Original direct transactions should share one journal");
    const originalJournalEntryId = Array.from(originalJournalIds)[0];

    const originalOutMovement = (
      await query(
        `SELECT id, movement_direction, movement_amount_txn, movement_amount_base, carrying_amount_base, realized_fx_base
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?
         ORDER BY line_no ASC
         LIMIT 1`,
        [identity.tenantId, exchangeOutTxnId]
      )
    ).rows?.[0];
    assert(originalOutMovement, "Original direct exchange should create an OUT lot movement");
    assert(asUpper(originalOutMovement.movement_direction) === "OUT", "Original movement should be OUT");
    assert(amountsEqual(originalOutMovement.realized_fx_base, 80), "Original realized FX should be 80");

    const reverseRes = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/exchanges/${exchangeBatchId}/reverse`,
      body: {
        tenantId: identity.tenantId,
        reverseReason: "EXF07 direct reversal",
      },
      expectedStatus: 200,
    });

    const reversalOutTxnId = toNumber(reverseRes.json?.reversalOutTransaction?.id);
    const reversalInTxnId = toNumber(reverseRes.json?.reversalInTransaction?.id);
    assert(reversalOutTxnId > 0, "Direct reversal out txn should exist");
    assert(reversalInTxnId > 0, "Direct reversal in txn should exist");

    const batchRow = (
      await query(
        `SELECT
           status,
           posting_mode,
           reversal_out_cash_transaction_id,
           reversal_in_cash_transaction_id,
           reversal_realized_fx_base
         FROM cash_exchange_batches
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, exchangeBatchId]
      )
    ).rows?.[0];
    assert(batchRow, "Reversed direct exchange batch should exist");
    assert(asUpper(batchRow.status) === "REVERSED", "Direct exchange batch should be REVERSED");
    assert(asUpper(batchRow.posting_mode) === "DIRECT", "Reversed batch should remain DIRECT");
    assert(
      toNumber(batchRow.reversal_out_cash_transaction_id) === reversalOutTxnId,
      "reversal_out_cash_transaction_id should match"
    );
    assert(
      toNumber(batchRow.reversal_in_cash_transaction_id) === reversalInTxnId,
      "reversal_in_cash_transaction_id should match"
    );
    assert(
      amountsEqual(batchRow.reversal_realized_fx_base, -80),
      "reversal_realized_fx_base should be -80"
    );

    const allRows = (
      await query(
        `SELECT id, status, posted_journal_entry_id, reversal_of_transaction_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id IN (?, ?, ?, ?)
         ORDER BY id ASC`,
        [identity.tenantId, exchangeOutTxnId, exchangeInTxnId, reversalOutTxnId, reversalInTxnId]
      )
    ).rows || [];
    assert(allRows.length === 4, "Original and reversal direct transactions should exist");

    const originalOutRow = allRows.find((row) => toNumber(row.id) === exchangeOutTxnId);
    const originalInRow = allRows.find((row) => toNumber(row.id) === exchangeInTxnId);
    const reversalOutRow = allRows.find((row) => toNumber(row.id) === reversalOutTxnId);
    const reversalInRow = allRows.find((row) => toNumber(row.id) === reversalInTxnId);
    assert(asUpper(originalOutRow?.status) === "REVERSED", "Original out should be REVERSED");
    assert(asUpper(originalInRow?.status) === "REVERSED", "Original in should be REVERSED");
    assert(asUpper(reversalOutRow?.status) === "POSTED", "Reversal out should be POSTED");
    assert(asUpper(reversalInRow?.status) === "POSTED", "Reversal in should be POSTED");
    assert(
      toNumber(reversalOutRow?.reversal_of_transaction_id) === exchangeOutTxnId,
      "Reversal out should point to original out"
    );
    assert(
      toNumber(reversalInRow?.reversal_of_transaction_id) === exchangeInTxnId,
      "Reversal in should point to original in"
    );

    const reversalJournalIds = new Set([
      toNumber(reversalOutRow?.posted_journal_entry_id),
      toNumber(reversalInRow?.posted_journal_entry_id),
    ]);
    assert(reversalJournalIds.size === 1, "Direct reversal legs should share one journal");
    const reversalJournalEntryId = Array.from(reversalJournalIds)[0];
    assert(
      reversalJournalEntryId > 0 && reversalJournalEntryId !== originalJournalEntryId,
      "Direct reversal should post to a new shared journal"
    );

    const reversalLines = (
      await query(
        `SELECT account_id, debit_base, credit_base
         FROM journal_lines
         WHERE journal_entry_id = ?
         ORDER BY line_no ASC, id ASC`,
        [reversalJournalEntryId]
      )
    ).rows || [];
    assert(reversalLines.length === 2, "Direct reversal journal should have exactly two lines");
    const reversalUsdLine = reversalLines.find(
      (line) => toNumber(line.account_id) === usdRegisterAccountId
    );
    const reversalTryLine = reversalLines.find(
      (line) => toNumber(line.account_id) === tryRegisterAccountId
    );
    const reversalClearingLine = reversalLines.find(
      (line) => toNumber(line.account_id) === clearingAccountId
    );
    assert(reversalUsdLine, "Direct reversal should debit source register");
    assert(reversalTryLine, "Direct reversal should credit target register");
    assert(!reversalClearingLine, "Direct reversal must not hit clearing even if mapping exists");
    assert(amountsEqual(reversalUsdLine.debit_base, 1600), "Direct reversal source debit should be 1600");
    assert(amountsEqual(reversalTryLine.credit_base, 1600), "Direct reversal target credit should be 1600");

    const reversalMovement = (
      await query(
        `SELECT movement_direction, movement_amount_txn, movement_amount_base, carrying_amount_base, realized_fx_base, reversal_of_movement_id
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?
         ORDER BY line_no ASC
         LIMIT 1`,
        [identity.tenantId, reversalOutTxnId]
      )
    ).rows?.[0];
    assert(reversalMovement, "Direct reversal should create a reversing lot movement");
    assert(asUpper(reversalMovement.movement_direction) === "IN", "Reversal movement should be IN");
    assert(amountsEqual(reversalMovement.movement_amount_txn, 40), "Reversal movement txn should be 40");
    assert(amountsEqual(reversalMovement.movement_amount_base, 1600), "Reversal movement base should be 1600");
    assert(amountsEqual(reversalMovement.carrying_amount_base, 1520), "Reversal carrying base should be 1520");
    assert(amountsEqual(reversalMovement.realized_fx_base, -80), "Reversal realized FX should be -80");
    assert(
      toNumber(reversalMovement.reversal_of_movement_id) === toNumber(originalOutMovement.id),
      "Reversal movement must point to original OUT movement"
    );

    const lotAfterReverse = (
      await query(
        `SELECT remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, toNumber(openingLot.id)]
      )
    ).rows?.[0];
    assert(lotAfterReverse, "Opening lot should still exist after direct reversal");
    assert(amountsEqual(lotAfterReverse.remaining_amount_txn, 100), "Lot quantity should be restored to 100");
    assert(amountsEqual(lotAfterReverse.remaining_amount_base, 3800), "Lot base should be restored to 3800");
    assert(asUpper(lotAfterReverse.status) === "OPEN", "Opening lot should be OPEN after reversal");

    console.log("PR-EXF07 direct-mode reversal test passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          exchangeBatchId,
          exchangeOutTxnId,
          exchangeInTxnId,
          reversalOutTxnId,
          reversalInTxnId,
          originalJournalEntryId,
          reversalJournalEntryId,
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
  console.error("PR-EXF07 direct-mode reversal test failed.");
  console.error(err);
  process.exitCode = 1;
});
