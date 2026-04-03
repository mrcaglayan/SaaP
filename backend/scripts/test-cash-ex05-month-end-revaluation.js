import { closePool, query } from "../src/db.js";
import { runCashFxRevaluation } from "../src/services/cash.fx.revaluation.service.js";
import {
  TEST_FISCAL_YEAR,
  apiRequest,
  assert,
  bootstrapOrgBookCoa,
  createAccount,
  createAndPostCashTransaction,
  createRegister,
  findRegularPeriodByNo,
  insertFxRate,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  upsertRevaluationPurposeAccounts,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EX05_MONTH_END_TEST_PORT || 3120);
const BASE_URL =
  process.env.CASH_EX05_MONTH_END_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEX05MonthEnd#12345";

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function toDateOnly(value) {
  return String(value || "").slice(0, 10);
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EX05M_${stamp}`;
  const tenantName = `EX05 Month-End Tenant ${stamp}`;
  const adminEmail = `ex05_month_admin_${stamp}@example.com`;

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
      fiscalYear: TEST_FISCAL_YEAR,
      baseCurrencyCode: "TRY",
      yearsToGenerate: [TEST_FISCAL_YEAR],
    });
    const period1 = findRegularPeriodByNo(base.periods, 1);
    const period1Id = toNumber(period1?.id);
    assert(period1Id > 0, "Fiscal period 1 must exist");
    const period1EndDate = toDateOnly(period1?.end_date || period1?.endDate);
    assert(period1EndDate.length === 10, "Fiscal period 1 end date is required");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05M_USD_${String(stamp).slice(-5)}`,
      name: "EX05M USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05M_CNT_${String(stamp).slice(-5)}`,
      name: "EX05M Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05M_FXG_${String(stamp).slice(-5)}`,
      name: "EX05M FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05M_FXL_${String(stamp).slice(-5)}`,
      name: "EX05M FX Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });

    await upsertRevaluationPurposeAccounts({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      gainAccountId: fxGainAccountId,
      lossAccountId: fxLossAccountId,
    });

    const usdRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: usdRegisterAccountId,
      code: `EX05M-RUSD-${stamp}`,
      name: "EX05M USD Register",
      currencyCode: "USD",
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
      rateDate: period1EndDate,
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
      txnDatetime: "2026-01-10T10:00:00",
      bookDate: "2026-01-10",
      amount: 100,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EX05M-TXN-${stamp}`,
      sourceEntityId: `EX05M-TXN-${stamp}`,
    });

    const firstRun = await runCashFxRevaluation({
      payload: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        legalEntityId: base.legalEntityId,
        bookId: base.bookId,
        fiscalPeriodId: period1Id,
        runType: "MONTH_END",
        idempotencyKey: `EX05M-RUN-${stamp}`,
      },
    });
    assert(firstRun?.idempotentReplay === false, "First revaluation run must not be idempotent");
    assert(toNumber(firstRun?.run?.id) > 0, "Revaluation run id missing");
    assert(
      String(firstRun?.run?.status || "").toUpperCase() === "COMPLETED",
      "Revaluation run must be COMPLETED"
    );
    assert(
      amountsEqual(firstRun?.run?.totalCarryingBase, 3800),
      `Expected carrying base 3800, got ${firstRun?.run?.totalCarryingBase}`
    );
    assert(
      amountsEqual(firstRun?.run?.totalClosingBase, 4000),
      `Expected closing base 4000, got ${firstRun?.run?.totalClosingBase}`
    );
    assert(
      amountsEqual(firstRun?.run?.totalDeltaBase, 200),
      `Expected total delta base 200, got ${firstRun?.run?.totalDeltaBase}`
    );
    assert(Array.isArray(firstRun?.lines) && firstRun.lines.length === 1, "Expected 1 line");
    assert(
      amountsEqual(firstRun?.lines?.[0]?.deltaBase, 200),
      `Expected line delta 200, got ${firstRun?.lines?.[0]?.deltaBase}`
    );

    const journalId = toNumber(firstRun?.run?.journalEntryId);
    assert(journalId > 0, "Revaluation journal entry id is required");
    const journalLines = (
      await query(
        `SELECT account_id, debit_base, credit_base
         FROM journal_lines
         WHERE journal_entry_id = ?
         ORDER BY line_no ASC`,
        [journalId]
      )
    ).rows || [];
    assert(journalLines.length === 2, "Revaluation journal should have 2 lines");
    const registerLine = journalLines.find(
      (line) => toNumber(line.account_id) === usdRegisterAccountId
    );
    const gainLine = journalLines.find((line) => toNumber(line.account_id) === fxGainAccountId);
    assert(registerLine, "Register revaluation line missing");
    assert(gainLine, "Gain revaluation line missing");
    assert(amountsEqual(registerLine.debit_base, 200), "Register line debit must be 200");
    assert(amountsEqual(gainLine.credit_base, 200), "Gain line credit must be 200");

    const replayRun = await runCashFxRevaluation({
      payload: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        legalEntityId: base.legalEntityId,
        bookId: base.bookId,
        fiscalPeriodId: period1Id,
        runType: "MONTH_END",
        idempotencyKey: `EX05M-RUN-${stamp}`,
      },
    });
    assert(replayRun?.idempotentReplay === true, "Second run with same key must replay");
    assert(
      toNumber(replayRun?.run?.id) === toNumber(firstRun?.run?.id),
      "Idempotent replay must return same run id"
    );

    console.log("PR-EX05 month-end revaluation checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          fiscalPeriodId: period1Id,
          revaluationRunId: firstRun?.run?.id || null,
          journalId,
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
  console.error("PR-EX05 month-end revaluation test failed.");
  console.error(err);
  process.exitCode = 1;
});
