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

const PORT = Number(process.env.CASH_EXF03_TEST_PORT || 3126);
const BASE_URL =
  process.env.CASH_EXF03_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF03#12345";

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF03_${stamp}`;
  const tenantName = `EXF03 Tenant ${stamp}`;
  const adminEmail = `exf03_admin_${stamp}@example.com`;

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
      code: `EXF03_USD_${String(stamp).slice(-6)}`,
      name: "EXF03 USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const tryRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF03_TRY_${String(stamp).slice(-6)}`,
      name: "EXF03 TRY Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const clearingAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF03_CLR_${String(stamp).slice(-6)}`,
      name: "EXF03 Exchange Clearing",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const feeExpenseAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF03_FEE_${String(stamp).slice(-6)}`,
      name: "EXF03 Exchange Fee Expense",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF03_CNT_${String(stamp).slice(-6)}`,
      name: "EXF03 Cash Counter",
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
      code: `EXF03-RUSD-${stamp}`,
      name: "EXF03 USD Register",
      currencyCode: "USD",
    });
    const tryRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: tryRegisterAccountId,
      code: `EXF03-RTRY-${stamp}`,
      name: "EXF03 TRY Register",
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
      idempotencyKey: `EXF03-OPEN-${stamp}`,
      sourceEntityId: `EXF03-OPEN-${stamp}`,
    });

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
        feeAccountId: feeExpenseAccountId,
        txnDatetime: "2026-01-20T12:00:00",
        bookDate: "2026-01-20",
        sourceAmountTxn: 40,
        targetAmountTxn: 1600,
        feeAmountTxn: 50,
        feeAmountBase: 50,
        providerRef: `BROKER-${stamp}`,
        spreadReferenceRate: 40.5,
        spreadRateDelta: -0.5,
        spreadAmountBase: 20,
        idempotencyKey: `EXF03-EXCHANGE-${stamp}`,
        integrationEventUid: `EXF03-EXCHANGE-${stamp}`,
      },
      expectedStatus: 201,
    });

    const exchangeBatchId = toNumber(exchangeCreate.json?.batch?.id);
    const exchangeOutTxnId = toNumber(exchangeCreate.json?.exchangeOutTransaction?.id);
    const exchangeInTxnId = toNumber(exchangeCreate.json?.exchangeInTransaction?.id);
    const feeTxnId = toNumber(exchangeCreate.json?.feeTransaction?.id);
    assert(exchangeBatchId > 0, "Exchange batch id should exist");
    assert(exchangeOutTxnId > 0, "Exchange out transaction id should exist");
    assert(exchangeInTxnId > 0, "Exchange in transaction id should exist");
    assert(feeTxnId > 0, "Fee transaction id should exist");

    const batch = (
      await query(
        `SELECT
           status,
           source_amount_base,
           target_amount_base,
           realized_fx_base,
           fee_amount_txn,
           fee_amount_base,
           fee_account_id,
           fee_cash_transaction_id,
           provider_ref,
           spread_reference_rate,
           spread_rate_delta,
           spread_amount_base
         FROM cash_exchange_batches
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, exchangeBatchId]
      )
    ).rows?.[0];
    assert(batch, "Exchange batch should exist in database");
    assert(asUpper(batch.status) === "POSTED", "Exchange batch should be POSTED");
    assert(amountsEqual(batch.source_amount_base, 1600), "source_amount_base should be 1600");
    assert(amountsEqual(batch.target_amount_base, 1600), "target_amount_base should be 1600");
    assert(amountsEqual(batch.realized_fx_base, 80), "realized_fx_base should be 80");
    assert(amountsEqual(batch.fee_amount_txn, 50), "fee_amount_txn should be 50");
    assert(amountsEqual(batch.fee_amount_base, 50), "fee_amount_base should be 50");
    assert(toNumber(batch.fee_account_id) === feeExpenseAccountId, "fee_account_id should match");
    assert(toNumber(batch.fee_cash_transaction_id) === feeTxnId, "fee cash txn id should match");
    assert(
      String(batch.provider_ref || "").includes(`BROKER-${stamp}`),
      "provider_ref should be persisted"
    );
    assert(amountsEqual(batch.spread_reference_rate, 40.5), "spread_reference_rate should be 40.5");
    assert(amountsEqual(batch.spread_rate_delta, -0.5), "spread_rate_delta should be -0.5");
    assert(amountsEqual(batch.spread_amount_base, 20), "spread_amount_base should be 20");

    const feeTxn = (
      await query(
        `SELECT
           txn_type,
           status,
           cash_register_id,
           currency_code,
           amount,
           amount_base,
           counter_account_id,
           posted_journal_entry_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, feeTxnId]
      )
    ).rows?.[0];
    assert(feeTxn, "Fee cash transaction should exist");
    assert(asUpper(feeTxn.txn_type) === "PAYOUT", "Fee transaction must be PAYOUT");
    assert(asUpper(feeTxn.status) === "POSTED", "Fee transaction must be POSTED");
    assert(toNumber(feeTxn.cash_register_id) === tryRegisterId, "Fee transaction register mismatch");
    assert(asUpper(feeTxn.currency_code) === "TRY", "Fee currency should be TRY");
    assert(amountsEqual(feeTxn.amount, 50), "Fee amount txn should be 50");
    assert(amountsEqual(feeTxn.amount_base, 50), "Fee amount base should be 50");
    assert(
      toNumber(feeTxn.counter_account_id) === feeExpenseAccountId,
      "Fee transaction counter account should be fee expense account"
    );

    const feeJournalLines = (
      await query(
        `SELECT account_id, debit_base, credit_base
         FROM journal_lines
         WHERE journal_entry_id = ?
         ORDER BY line_no ASC, id ASC`,
        [toNumber(feeTxn.posted_journal_entry_id)]
      )
    ).rows || [];
    assert(feeJournalLines.length >= 2, "Fee journal should include at least two lines");
    const feeExpenseLine = feeJournalLines.find(
      (line) => toNumber(line.account_id) === feeExpenseAccountId
    );
    const feeRegisterLine = feeJournalLines.find(
      (line) => toNumber(line.account_id) === tryRegisterAccountId
    );
    assert(feeExpenseLine, "Fee expense line must exist");
    assert(feeRegisterLine, "Fee register cash line must exist");
    assert(amountsEqual(feeExpenseLine.debit_base, 50), "Fee expense debit must be 50");
    assert(amountsEqual(feeRegisterLine.credit_base, 50), "Fee register credit must be 50");

    const outInFeeRows = (
      await query(
        `SELECT id, posted_journal_entry_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id IN (?, ?)`,
        [identity.tenantId, exchangeOutTxnId, exchangeInTxnId]
      )
    ).rows || [];
    for (const row of outInFeeRows) {
      // eslint-disable-next-line no-await-in-loop
      const lineCount = toNumber(
        (
          await query(
            `SELECT COUNT(*) AS total
             FROM journal_lines
             WHERE journal_entry_id = ?
               AND account_id = ?`,
            [toNumber(row.posted_journal_entry_id), feeExpenseAccountId]
          )
        ).rows?.[0]?.total
      );
      assert(lineCount === 0, "Principal exchange journals must not include fee expense account");
    }

    const outLotMovement = (
      await query(
        `SELECT COALESCE(SUM(realized_fx_base), 0) AS realized_fx_base
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?`,
        [identity.tenantId, exchangeOutTxnId]
      )
    ).rows?.[0];
    assert(
      amountsEqual(outLotMovement?.realized_fx_base, 80),
      `Expected realized lot FX 80, got ${outLotMovement?.realized_fx_base}`
    );

    const report = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: `/api/v1/cash/reports/exchange-history?tenantId=${identity.tenantId}&legalEntityId=${base.legalEntityId}&limit=20&offset=0`,
      expectedStatus: 200,
    });
    const reportRows = Array.isArray(report.json?.rows) ? report.json.rows : [];
    const reportRow = reportRows.find((row) => toNumber(row?.id) === exchangeBatchId);
    assert(reportRow, "Exchange report row should include EXF03 batch");
    assert(amountsEqual(reportRow.feeAmountTxn, 50), "Report feeAmountTxn should be 50");
    assert(amountsEqual(reportRow.feeAmountBase, 50), "Report feeAmountBase should be 50");
    assert(amountsEqual(reportRow.realizedFxBase, 80), "Report realizedFxBase should be 80");
    assert(amountsEqual(reportRow.spreadAmountBase, 20), "Report spreadAmountBase should be 20");

    assert(
      amountsEqual(report.json?.summary?.feeAmountBaseTotal, 50),
      "Report summary feeAmountBaseTotal should be 50"
    );
    assert(
      amountsEqual(report.json?.summary?.realizedFxBaseTotal, 80),
      "Report summary realizedFxBaseTotal should be 80"
    );
    assert(
      amountsEqual(report.json?.summary?.principalFxDifferenceBaseTotal, 0),
      "Report principalFxDifferenceBaseTotal should be 0"
    );

    const reverseRes = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/exchanges/${exchangeBatchId}/reverse`,
      body: {
        tenantId: identity.tenantId,
        reverseReason: "EXF03 reverse check",
      },
      expectedStatus: 200,
    });
    const reversalFeeTxnId = toNumber(reverseRes.json?.reversalFeeTransaction?.id);
    assert(reversalFeeTxnId > 0, "Reversal fee transaction id should exist");

    const reversedBatch = (
      await query(
        `SELECT
           status,
           reversal_fee_cash_transaction_id,
           reversal_realized_fx_base
         FROM cash_exchange_batches
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, exchangeBatchId]
      )
    ).rows?.[0];
    assert(asUpper(reversedBatch?.status) === "REVERSED", "Batch should be REVERSED");
    assert(
      toNumber(reversedBatch?.reversal_fee_cash_transaction_id) === reversalFeeTxnId,
      "Batch reversal fee txn id should be persisted"
    );
    assert(
      amountsEqual(reversedBatch?.reversal_realized_fx_base, -80),
      `Expected reversal_realized_fx_base -80, got ${reversedBatch?.reversal_realized_fx_base}`
    );

    console.log("PR-EXF03 exchange fee/spread accounting checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          exchangeBatchId,
          exchangeOutTxnId,
          exchangeInTxnId,
          feeTxnId,
          reversalFeeTxnId,
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
  console.error("PR-EXF03 exchange fee/spread accounting test failed.");
  console.error(err);
  process.exitCode = 1;
});

