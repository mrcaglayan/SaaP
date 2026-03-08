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

function toErrorText(payload) {
  if (payload === null || payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload.error === "string") {
    return payload.error;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

async function fetchExchangeBatch(tenantId, exchangeBatchId) {
  return (
    await query(
      `SELECT
         status,
         posting_mode,
         clearing_account_id,
         source_amount_base,
         target_amount_base,
         realized_fx_base,
         fee_amount_txn,
         fee_amount_base,
         fee_account_id,
         fee_cash_transaction_id,
         reversal_fee_cash_transaction_id,
         reversal_realized_fx_base,
         provider_ref,
         spread_reference_rate,
         spread_rate_delta,
         spread_amount_base
       FROM cash_exchange_batches
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, exchangeBatchId]
    )
  ).rows?.[0];
}

async function fetchCashTransaction(tenantId, transactionId) {
  return (
    await query(
      `SELECT
         txn_type,
         status,
         cash_register_id,
         currency_code,
         amount,
         amount_base,
         counter_account_id,
         posted_journal_entry_id,
         reversal_of_transaction_id
       FROM cash_transactions
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, transactionId]
    )
  ).rows?.[0];
}

async function fetchJournalLines(journalEntryId) {
  return (
    await query(
      `SELECT account_id, debit_base, credit_base
       FROM journal_lines
       WHERE journal_entry_id = ?
       ORDER BY line_no ASC, id ASC`,
      [journalEntryId]
    )
  ).rows || [];
}

function findLine(lines, accountId) {
  return lines.find((line) => toNumber(line.account_id) === toNumber(accountId));
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

    const missingFeeAccountRes = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/cash/exchanges",
      body: {
        tenantId: identity.tenantId,
        sourceRegisterId: usdRegisterId,
        targetRegisterId: tryRegisterId,
        postingMode: "CLEARING",
        clearingAccountId,
        txnDatetime: "2026-01-20T11:00:00",
        bookDate: "2026-01-20",
        sourceAmountTxn: 10,
        targetAmountTxn: 400,
        feeAmountTxn: 5,
        idempotencyKey: `EXF03-MISSING-FEE-${stamp}`,
        integrationEventUid: `EXF03-MISSING-FEE-${stamp}`,
      },
      expectedStatus: 400,
    });
    assert(
      toErrorText(missingFeeAccountRes.json).includes("feeAccountId"),
      "feeAmountTxn without feeAccountId must be rejected"
    );

    const clearingCreate = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/cash/exchanges",
      body: {
        tenantId: identity.tenantId,
        sourceRegisterId: usdRegisterId,
        targetRegisterId: tryRegisterId,
        postingMode: "CLEARING",
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

    const clearingBatchId = toNumber(clearingCreate.json?.batch?.id);
    const clearingOutTxnId = toNumber(clearingCreate.json?.exchangeOutTransaction?.id);
    const clearingInTxnId = toNumber(clearingCreate.json?.exchangeInTransaction?.id);
    const clearingFeeTxnId = toNumber(clearingCreate.json?.feeTransaction?.id);
    assert(clearingBatchId > 0, "Clearing exchange batch id should exist");
    assert(clearingOutTxnId > 0, "Clearing exchange out transaction id should exist");
    assert(clearingInTxnId > 0, "Clearing exchange in transaction id should exist");
    assert(clearingFeeTxnId > 0, "Clearing fee transaction id should exist");

    const clearingBatch = await fetchExchangeBatch(identity.tenantId, clearingBatchId);
    assert(clearingBatch, "Clearing exchange batch should exist in database");
    assert(asUpper(clearingBatch.status) === "POSTED", "Clearing batch should be POSTED");
    assert(asUpper(clearingBatch.posting_mode) === "CLEARING", "Clearing batch must be CLEARING mode");
    assert(
      toNumber(clearingBatch.clearing_account_id) === clearingAccountId,
      "Clearing batch should persist clearing account"
    );
    assert(amountsEqual(clearingBatch.source_amount_base, 1600), "Clearing source_amount_base should be 1600");
    assert(amountsEqual(clearingBatch.target_amount_base, 1600), "Clearing target_amount_base should be 1600");
    assert(amountsEqual(clearingBatch.realized_fx_base, 80), "Clearing realized_fx_base should be 80");
    assert(amountsEqual(clearingBatch.fee_amount_txn, 50), "Clearing fee_amount_txn should be 50");
    assert(amountsEqual(clearingBatch.fee_amount_base, 50), "Clearing fee_amount_base should be 50");
    assert(
      toNumber(clearingBatch.fee_account_id) === feeExpenseAccountId,
      "Clearing fee_account_id should match"
    );
    assert(
      toNumber(clearingBatch.fee_cash_transaction_id) === clearingFeeTxnId,
      "Clearing fee_cash_transaction_id should match"
    );
    assert(
      String(clearingBatch.provider_ref || "").includes(`BROKER-${stamp}`),
      "Clearing provider_ref should be persisted"
    );
    assert(amountsEqual(clearingBatch.spread_reference_rate, 40.5), "spread_reference_rate should be 40.5");
    assert(amountsEqual(clearingBatch.spread_rate_delta, -0.5), "spread_rate_delta should be -0.5");
    assert(amountsEqual(clearingBatch.spread_amount_base, 20), "spread_amount_base should be 20");

    const clearingFeeTxn = await fetchCashTransaction(identity.tenantId, clearingFeeTxnId);
    assert(clearingFeeTxn, "Clearing fee cash transaction should exist");
    assert(asUpper(clearingFeeTxn.txn_type) === "PAYOUT", "Clearing fee transaction must be PAYOUT");
    assert(asUpper(clearingFeeTxn.status) === "POSTED", "Clearing fee transaction must be POSTED");
    assert(
      toNumber(clearingFeeTxn.cash_register_id) === tryRegisterId,
      "Clearing fee transaction should use target register"
    );
    assert(asUpper(clearingFeeTxn.currency_code) === "TRY", "Clearing fee currency should be TRY");
    assert(amountsEqual(clearingFeeTxn.amount, 50), "Clearing fee txn amount should be 50");
    assert(amountsEqual(clearingFeeTxn.amount_base, 50), "Clearing fee base amount should be 50");
    assert(
      toNumber(clearingFeeTxn.counter_account_id) === feeExpenseAccountId,
      "Clearing fee transaction counter account should be fee expense account"
    );

    const clearingFeeJournalLines = await fetchJournalLines(
      toNumber(clearingFeeTxn.posted_journal_entry_id)
    );
    const clearingFeeExpenseLine = findLine(clearingFeeJournalLines, feeExpenseAccountId);
    const clearingFeeRegisterLine = findLine(clearingFeeJournalLines, tryRegisterAccountId);
    assert(clearingFeeExpenseLine, "Clearing fee journal must include fee expense line");
    assert(clearingFeeRegisterLine, "Clearing fee journal must include target register line");
    assert(amountsEqual(clearingFeeExpenseLine.debit_base, 50), "Clearing fee expense debit must be 50");
    assert(amountsEqual(clearingFeeRegisterLine.credit_base, 50), "Clearing fee register credit must be 50");

    const clearingPrincipalRows = (
      await query(
        `SELECT id, posted_journal_entry_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id IN (?, ?)`,
        [identity.tenantId, clearingOutTxnId, clearingInTxnId]
      )
    ).rows || [];
    for (const row of clearingPrincipalRows) {
      const feeLineCount = toNumber(
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
      assert(feeLineCount === 0, "Clearing principal journals must not include fee expense account");
    }

    const clearingOutLotMovement = (
      await query(
        `SELECT COALESCE(SUM(realized_fx_base), 0) AS realized_fx_base
         FROM cash_fx_lot_movements
         WHERE tenant_id = ?
           AND cash_transaction_id = ?`,
        [identity.tenantId, clearingOutTxnId]
      )
    ).rows?.[0];
    assert(
      amountsEqual(clearingOutLotMovement?.realized_fx_base, 80),
      `Expected clearing realized lot FX 80, got ${clearingOutLotMovement?.realized_fx_base}`
    );

    const report = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: `/api/v1/cash/reports/exchange-history?tenantId=${identity.tenantId}&legalEntityId=${base.legalEntityId}&limit=20&offset=0`,
      expectedStatus: 200,
    });
    const reportRows = Array.isArray(report.json?.rows) ? report.json.rows : [];
    const reportRow = reportRows.find((row) => toNumber(row?.id) === clearingBatchId);
    assert(reportRow, "Exchange report row should include clearing EXF03 batch");
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

    const clearingReverse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/exchanges/${clearingBatchId}/reverse`,
      body: {
        tenantId: identity.tenantId,
        reverseReason: "EXF03 clearing reverse check",
      },
      expectedStatus: 200,
    });
    const clearingReversalFeeTxnId = toNumber(clearingReverse.json?.reversalFeeTransaction?.id);
    assert(clearingReversalFeeTxnId > 0, "Clearing reversal fee transaction id should exist");

    const reversedClearingBatch = await fetchExchangeBatch(identity.tenantId, clearingBatchId);
    assert(asUpper(reversedClearingBatch?.status) === "REVERSED", "Clearing batch should be REVERSED");
    assert(
      toNumber(reversedClearingBatch?.reversal_fee_cash_transaction_id) === clearingReversalFeeTxnId,
      "Clearing batch reversal fee txn id should be persisted"
    );
    assert(
      amountsEqual(reversedClearingBatch?.reversal_realized_fx_base, -80),
      `Expected clearing reversal_realized_fx_base -80, got ${reversedClearingBatch?.reversal_realized_fx_base}`
    );

    const clearingReversalFeeTxn = await fetchCashTransaction(
      identity.tenantId,
      clearingReversalFeeTxnId
    );
    assert(clearingReversalFeeTxn, "Clearing reversal fee transaction should exist");
    assert(
      asUpper(clearingReversalFeeTxn.txn_type) === "PAYOUT",
      "Clearing reversal fee transaction should preserve the original PAYOUT txn_type"
    );
    assert(asUpper(clearingReversalFeeTxn.status) === "POSTED", "Clearing reversal fee must be POSTED");
    assert(
      toNumber(clearingReversalFeeTxn.cash_register_id) === tryRegisterId,
      "Clearing reversal fee should return to target register"
    );
    assert(
      amountsEqual(clearingReversalFeeTxn.amount_base, 50),
      "Clearing reversal fee amount_base should be 50"
    );
    const clearingReversalFeeLines = await fetchJournalLines(
      toNumber(clearingReversalFeeTxn.posted_journal_entry_id)
    );
    const clearingReversalExpenseLine = findLine(clearingReversalFeeLines, feeExpenseAccountId);
    const clearingReversalRegisterLine = findLine(clearingReversalFeeLines, tryRegisterAccountId);
    assert(clearingReversalExpenseLine, "Clearing reversal fee journal must include fee expense line");
    assert(clearingReversalRegisterLine, "Clearing reversal fee journal must include target register line");
    assert(
      amountsEqual(clearingReversalExpenseLine.credit_base, 50),
      "Clearing reversal fee expense credit must be 50"
    );
    assert(
      amountsEqual(clearingReversalRegisterLine.debit_base, 50),
      "Clearing reversal target register debit must be 50"
    );

    const directCreate = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/cash/exchanges",
      body: {
        tenantId: identity.tenantId,
        sourceRegisterId: usdRegisterId,
        targetRegisterId: tryRegisterId,
        postingMode: "DIRECT",
        feeAccountId: feeExpenseAccountId,
        txnDatetime: "2026-01-20T15:00:00",
        bookDate: "2026-01-20",
        sourceAmountTxn: 30,
        targetAmountTxn: 1200,
        feeAmountTxn: 2,
        feeAmountBase: 80,
        providerRef: `DIRECT-${stamp}`,
        idempotencyKey: `EXF03-DIRECT-${stamp}`,
        integrationEventUid: `EXF03-DIRECT-${stamp}`,
      },
      expectedStatus: 201,
    });

    const directBatchId = toNumber(directCreate.json?.batch?.id);
    const directOutTxnId = toNumber(directCreate.json?.exchangeOutTransaction?.id);
    const directInTxnId = toNumber(directCreate.json?.exchangeInTransaction?.id);
    const directFeeTxnId = toNumber(directCreate.json?.feeTransaction?.id);
    assert(directBatchId > 0, "Direct batch id should exist");
    assert(directOutTxnId > 0, "Direct out transaction id should exist");
    assert(directInTxnId > 0, "Direct in transaction id should exist");
    assert(directFeeTxnId > 0, "Direct fee transaction id should exist");

    const directBatch = await fetchExchangeBatch(identity.tenantId, directBatchId);
    assert(directBatch, "Direct batch should exist");
    assert(asUpper(directBatch.status) === "POSTED", "Direct batch should be POSTED");
    assert(asUpper(directBatch.posting_mode) === "DIRECT", "Direct batch should be DIRECT mode");
    assert(directBatch.clearing_account_id === null, "Direct batch should not persist clearing account");
    assert(amountsEqual(directBatch.fee_amount_txn, 2), "Direct fee_amount_txn should be 2");
    assert(amountsEqual(directBatch.fee_amount_base, 80), "Direct fee_amount_base should be 80");
    assert(toNumber(directBatch.fee_cash_transaction_id) === directFeeTxnId, "Direct fee txn id should match");

    const directPrincipalRows = (
      await query(
        `SELECT id, posted_journal_entry_id
         FROM cash_transactions
         WHERE tenant_id = ?
           AND id IN (?, ?)
         ORDER BY id ASC`,
        [identity.tenantId, directOutTxnId, directInTxnId]
      )
    ).rows || [];
    assert(directPrincipalRows.length === 2, "Direct principal transactions should exist");
    const directPrincipalJournalIds = new Set(
      directPrincipalRows.map((row) => toNumber(row.posted_journal_entry_id))
    );
    assert(directPrincipalJournalIds.size === 1, "Direct principal transactions should share one journal");
    const directPrincipalJournalId = Array.from(directPrincipalJournalIds)[0];
    const directPrincipalFeeLineCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM journal_lines
           WHERE journal_entry_id = ?
             AND account_id = ?`,
          [directPrincipalJournalId, feeExpenseAccountId]
        )
      ).rows?.[0]?.total
    );
    assert(directPrincipalFeeLineCount === 0, "Direct principal journal must not include fee expense account");

    const directFeeTxn = await fetchCashTransaction(identity.tenantId, directFeeTxnId);
    assert(directFeeTxn, "Direct fee transaction should exist");
    assert(asUpper(directFeeTxn.txn_type) === "PAYOUT", "Direct fee transaction must be PAYOUT");
    assert(asUpper(directFeeTxn.status) === "POSTED", "Direct fee transaction must be POSTED");
    assert(
      toNumber(directFeeTxn.cash_register_id) === usdRegisterId,
      "Direct fee transaction should use source register"
    );
    assert(asUpper(directFeeTxn.currency_code) === "USD", "Direct fee currency should be USD");
    assert(amountsEqual(directFeeTxn.amount, 2), "Direct fee amount should be 2");
    assert(amountsEqual(directFeeTxn.amount_base, 80), "Direct fee amount base should be 80");
    assert(
      toNumber(directFeeTxn.counter_account_id) === feeExpenseAccountId,
      "Direct fee transaction counter account should be fee expense account"
    );

    const directFeeJournalLines = await fetchJournalLines(toNumber(directFeeTxn.posted_journal_entry_id));
    const directFeeExpenseLine = findLine(directFeeJournalLines, feeExpenseAccountId);
    const directFeeRegisterLine = findLine(directFeeJournalLines, usdRegisterAccountId);
    assert(directFeeExpenseLine, "Direct fee journal must include fee expense line");
    assert(directFeeRegisterLine, "Direct fee journal must include source register line");
    assert(amountsEqual(directFeeExpenseLine.debit_base, 80), "Direct fee expense debit must be 80");
    assert(amountsEqual(directFeeRegisterLine.credit_base, 80), "Direct fee register credit must be 80");

    const directReverse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/exchanges/${directBatchId}/reverse`,
      body: {
        tenantId: identity.tenantId,
        reverseReason: "EXF03 direct reverse check",
      },
      expectedStatus: 200,
    });
    const directReversalFeeTxnId = toNumber(directReverse.json?.reversalFeeTransaction?.id);
    assert(directReversalFeeTxnId > 0, "Direct reversal fee transaction id should exist");

    const reversedDirectBatch = await fetchExchangeBatch(identity.tenantId, directBatchId);
    assert(asUpper(reversedDirectBatch?.status) === "REVERSED", "Direct batch should be REVERSED");
    assert(
      toNumber(reversedDirectBatch?.reversal_fee_cash_transaction_id) === directReversalFeeTxnId,
      "Direct batch reversal fee txn id should be persisted"
    );

    const directReversalFeeTxn = await fetchCashTransaction(identity.tenantId, directReversalFeeTxnId);
    assert(directReversalFeeTxn, "Direct reversal fee transaction should exist");
    assert(
      asUpper(directReversalFeeTxn.txn_type) === "PAYOUT",
      "Direct reversal fee transaction should preserve the original PAYOUT txn_type"
    );
    assert(asUpper(directReversalFeeTxn.status) === "POSTED", "Direct reversal fee must be POSTED");
    assert(
      toNumber(directReversalFeeTxn.cash_register_id) === usdRegisterId,
      "Direct reversal fee should return to source register"
    );
    assert(amountsEqual(directReversalFeeTxn.amount, 2), "Direct reversal fee amount should be 2");
    assert(amountsEqual(directReversalFeeTxn.amount_base, 80), "Direct reversal fee amount base should be 80");
    const directReversalFeeLines = await fetchJournalLines(
      toNumber(directReversalFeeTxn.posted_journal_entry_id)
    );
    const directReversalExpenseLine = findLine(directReversalFeeLines, feeExpenseAccountId);
    const directReversalRegisterLine = findLine(directReversalFeeLines, usdRegisterAccountId);
    assert(directReversalExpenseLine, "Direct reversal fee journal must include fee expense line");
    assert(directReversalRegisterLine, "Direct reversal fee journal must include source register line");
    assert(
      amountsEqual(directReversalExpenseLine.credit_base, 80),
      "Direct reversal fee expense credit must be 80"
    );
    assert(
      amountsEqual(directReversalRegisterLine.debit_base, 80),
      "Direct reversal source register debit must be 80"
    );

    console.log("PR-EXF03 exchange fee/spread accounting checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          clearingBatchId,
          clearingOutTxnId,
          clearingInTxnId,
          clearingFeeTxnId,
          clearingReversalFeeTxnId,
          directBatchId,
          directOutTxnId,
          directInTxnId,
          directFeeTxnId,
          directReversalFeeTxnId,
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
