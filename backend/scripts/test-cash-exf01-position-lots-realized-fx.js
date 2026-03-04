import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
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

const PORT = Number(process.env.CASH_EXF01_TEST_PORT || 3123);
const BASE_URL =
  process.env.CASH_EXF01_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF01#12345";

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF01_${stamp}`;
  const tenantName = `EXF01 Tenant ${stamp}`;
  const adminEmail = `exf01_admin_${stamp}@example.com`;

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
      code: `EXF01_USD_${String(stamp).slice(-6)}`,
      name: "EXF01 USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const tryRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF01_TRY_${String(stamp).slice(-6)}`,
      name: "EXF01 TRY Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF01_CNT_${String(stamp).slice(-6)}`,
      name: "EXF01 Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const clearingAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF01_CLR_${String(stamp).slice(-6)}`,
      name: "EXF01 Exchange Clearing",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });

    const usdRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: usdRegisterAccountId,
      code: `EXF01-RUSD-${stamp}`,
      name: "EXF01 USD Register",
      currencyCode: "USD",
    });
    const tryRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: tryRegisterAccountId,
      code: `EXF01-RTRY-${stamp}`,
      name: "EXF01 TRY Register",
      currencyCode: "TRY",
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
      idempotencyKey: `EXF01-USD-OPEN-${stamp}`,
      sourceEntityId: `EXF01-USD-OPEN-${stamp}`,
    });
    const openingReceiptId = toNumber(openingReceipt?.transactionId);
    assert(openingReceiptId > 0, "Opening foreign-currency receipt should be posted");

    const lotAfterReceipt = (
      await query(
        `SELECT id, original_amount_txn, original_amount_base, remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND opened_by_cash_transaction_id = ?
         LIMIT 1`,
        [identity.tenantId, openingReceiptId]
      )
    ).rows?.[0];
    assert(lotAfterReceipt, "Lot must be created for inbound foreign-currency receipt");
    assert(
      amountsEqual(lotAfterReceipt.original_amount_txn, 100),
      `Expected original txn 100, got ${lotAfterReceipt.original_amount_txn}`
    );
    assert(
      amountsEqual(lotAfterReceipt.original_amount_base, 3800),
      `Expected original base 3800, got ${lotAfterReceipt.original_amount_base}`
    );

    const exchangeCreate = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/cash/exchanges",
      body: {
        tenantId: identity.tenantId,
        sourceRegisterId: usdRegisterId,
        targetRegisterId: tryRegisterId,
        clearingAccountId,
        txnDatetime: "2026-01-20T12:00:00",
        bookDate: "2026-01-20",
        sourceAmountTxn: 40,
        targetAmountTxn: 1600,
        idempotencyKey: `EXF01-EXCHANGE-${stamp}`,
        integrationEventUid: `EXF01-EXCHANGE-${stamp}`,
      },
      expectedStatus: 201,
    });
    const exchangeBatchId = toNumber(exchangeCreate.json?.batch?.id);
    const exchangeOutTxnId = toNumber(exchangeCreate.json?.exchangeOutTransaction?.id);
    assert(exchangeBatchId > 0, "Exchange batch should be created");
    assert(exchangeOutTxnId > 0, "Exchange out transaction should exist");

    const movementRows = (
      await query(
        `SELECT id, movement_direction, movement_amount_txn, movement_amount_base, carrying_amount_base, realized_fx_base
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?
         ORDER BY line_no ASC`,
        [identity.tenantId, exchangeOutTxnId]
      )
    ).rows || [];
    assert(movementRows.length === 1, "Exchange out should consume one lot slice in this scenario");
    const outMovement = movementRows[0];
    assert(
      String(outMovement.movement_direction || "").toUpperCase() === "OUT",
      "Exchange out movement should be OUT"
    );
    assert(
      amountsEqual(outMovement.movement_amount_txn, 40),
      `Expected consumed txn 40, got ${outMovement.movement_amount_txn}`
    );
    assert(
      amountsEqual(outMovement.movement_amount_base, 1600),
      `Expected movement base 1600, got ${outMovement.movement_amount_base}`
    );
    assert(
      amountsEqual(outMovement.carrying_amount_base, 1520),
      `Expected carrying base 1520, got ${outMovement.carrying_amount_base}`
    );
    assert(
      amountsEqual(outMovement.realized_fx_base, 80),
      `Expected realized FX +80, got ${outMovement.realized_fx_base}`
    );

    const lotAfterExchange = (
      await query(
        `SELECT remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND opened_by_cash_transaction_id = ?
         LIMIT 1`,
        [identity.tenantId, openingReceiptId]
      )
    ).rows?.[0];
    assert(lotAfterExchange, "Lot must still exist after partial disposal");
    assert(
      amountsEqual(lotAfterExchange.remaining_amount_txn, 60),
      `Expected remaining txn 60 after disposal, got ${lotAfterExchange.remaining_amount_txn}`
    );
    assert(
      amountsEqual(lotAfterExchange.remaining_amount_base, 2280),
      `Expected remaining base 2280 after disposal, got ${lotAfterExchange.remaining_amount_base}`
    );
    assert(
      String(lotAfterExchange.status || "").toUpperCase() === "OPEN",
      "Lot should remain OPEN after partial disposal"
    );

    const exchangeReverse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/exchanges/${exchangeBatchId}/reverse`,
      body: {
        tenantId: identity.tenantId,
        reverseReason: "EXF01 reversal check",
      },
      expectedStatus: 200,
    });
    const reversalOutTxnId = toNumber(exchangeReverse.json?.reversalOutTransaction?.id);
    assert(reversalOutTxnId > 0, "Exchange reversal out transaction should exist");

    const reversalMovementRows = (
      await query(
        `SELECT movement_direction, movement_amount_txn, movement_amount_base, carrying_amount_base, realized_fx_base, reversal_of_movement_id
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?
         ORDER BY line_no ASC`,
        [identity.tenantId, reversalOutTxnId]
      )
    ).rows || [];
    assert(
      reversalMovementRows.length === 1,
      "Exchange reversal out should create one deterministic reversal lot movement"
    );
    const reversalMovement = reversalMovementRows[0];
    assert(
      String(reversalMovement.movement_direction || "").toUpperCase() === "IN",
      "Reversal movement should be IN to restore lot quantity"
    );
    assert(
      amountsEqual(reversalMovement.movement_amount_txn, 40),
      `Expected reversal movement txn 40, got ${reversalMovement.movement_amount_txn}`
    );
    assert(
      amountsEqual(reversalMovement.movement_amount_base, 1600),
      `Expected reversal movement base 1600, got ${reversalMovement.movement_amount_base}`
    );
    assert(
      amountsEqual(reversalMovement.carrying_amount_base, 1520),
      `Expected reversal carrying base 1520, got ${reversalMovement.carrying_amount_base}`
    );
    assert(
      amountsEqual(reversalMovement.realized_fx_base, -80),
      `Expected reversal realized FX -80, got ${reversalMovement.realized_fx_base}`
    );
    assert(
      toNumber(reversalMovement.reversal_of_movement_id) === toNumber(outMovement.id),
      "Reversal movement must point to original consumed movement"
    );

    const lotAfterReverse = (
      await query(
        `SELECT remaining_amount_txn, remaining_amount_base, status
         FROM cash_fx_position_lots
         WHERE tenant_id = ?
           AND opened_by_cash_transaction_id = ?
         LIMIT 1`,
        [identity.tenantId, openingReceiptId]
      )
    ).rows?.[0];
    assert(lotAfterReverse, "Lot should still exist after reversal");
    assert(
      amountsEqual(lotAfterReverse.remaining_amount_txn, 100),
      `Expected restored remaining txn 100, got ${lotAfterReverse.remaining_amount_txn}`
    );
    assert(
      amountsEqual(lotAfterReverse.remaining_amount_base, 3800),
      `Expected restored remaining base 3800, got ${lotAfterReverse.remaining_amount_base}`
    );
    assert(
      String(lotAfterReverse.status || "").toUpperCase() === "OPEN",
      "Lot should be OPEN after reversal restores quantity"
    );

    console.log("PR-EXF01 lot tracking + realized FX lifecycle checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          exchangeBatchId,
          openingReceiptId,
          exchangeOutTxnId,
          reversalOutTxnId,
          lotId: toNumber(lotAfterReceipt.id),
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
  console.error("PR-EXF01 lot tracking + realized FX lifecycle test failed.");
  console.error(err);
  process.exitCode = 1;
});
