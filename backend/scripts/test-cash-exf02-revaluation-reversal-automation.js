import { closePool, query } from "../src/db.js";
import { runCashFxRevaluation } from "../src/services/cash.fx.revaluation.service.js";
import {
  TEST_FISCAL_YEAR,
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

const PORT = Number(process.env.CASH_EXF02_REV_TEST_PORT || 3124);
const BASE_URL =
  process.env.CASH_EXF02_REV_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF02Rev#12345";

function toDateOnly(value) {
  return String(value || "").slice(0, 10);
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF02R_${stamp}`;
  const tenantName = `EXF02 Reversal Tenant ${stamp}`;
  const adminEmail = `exf02_reversal_admin_${stamp}@example.com`;

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
    const period2 = findRegularPeriodByNo(base.periods, 2);
    const period1Id = toNumber(period1?.id);
    const period2Id = toNumber(period2?.id);
    const period1EndDate = toDateOnly(period1?.end_date || period1?.endDate);
    assert(period1Id > 0, "Fiscal period 1 must exist");
    assert(period2Id > 0, "Fiscal period 2 must exist");
    assert(period1EndDate.length === 10, "Fiscal period 1 end date is required");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02R_USD_${String(stamp).slice(-5)}`,
      name: "EXF02R USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02R_CNT_${String(stamp).slice(-5)}`,
      name: "EXF02R Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02R_FXG_${String(stamp).slice(-5)}`,
      name: "EXF02R FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02R_FXL_${String(stamp).slice(-5)}`,
      name: "EXF02R FX Loss",
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
      code: `EXF02R-RUSD-${stamp}`,
      name: "EXF02R USD Register",
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
      txnDatetime: "2026-01-10T09:00:00",
      bookDate: "2026-01-10",
      amount: 100,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EXF02R-TXN-${stamp}`,
      sourceEntityId: `EXF02R-TXN-${stamp}`,
    });

    const run = await runCashFxRevaluation({
      payload: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        legalEntityId: base.legalEntityId,
        bookId: base.bookId,
        fiscalPeriodId: period1Id,
        runType: "MONTH_END",
        idempotencyKey: `EXF02R-RUN-${stamp}`,
      },
    });
    const runId = toNumber(run?.run?.id);
    const reversalJournalEntryId = toNumber(run?.run?.reversalJournalEntryId);
    assert(run?.idempotentReplay === false, "First run should execute");
    assert(runId > 0, "Revaluation run id missing");
    assert(reversalJournalEntryId > 0, "Auto reversal journal id missing");
    assert(
      String(run?.run?.reversalStatus || "").toUpperCase() === "POSTED",
      `Expected reversalStatus=POSTED, got ${run?.run?.reversalStatus}`
    );

    const reversalJournal = (
      await query(
        `SELECT id, fiscal_period_id, status, reference_no
         FROM journal_entries
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, reversalJournalEntryId]
      )
    ).rows?.[0];
    assert(reversalJournal, "Reversal journal row must exist");
    assert(
      toNumber(reversalJournal.fiscal_period_id) === period2Id,
      `Expected reversal fiscal period ${period2Id}, got ${reversalJournal.fiscal_period_id}`
    );
    assert(
      String(reversalJournal.status || "").toUpperCase() === "POSTED",
      "Reversal journal must be POSTED"
    );
    assert(
      String(reversalJournal.reference_no || "") === `CASH_FX_REVAL_REVERSAL_RUN:${runId}`,
      `Unexpected reversal reference_no: ${reversalJournal.reference_no}`
    );

    const firstCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM journal_entries
           WHERE tenant_id = ?
             AND book_id = ?
             AND reference_no = ?
             AND status = 'POSTED'`,
          [identity.tenantId, base.bookId, `CASH_FX_REVAL_REVERSAL_RUN:${runId}`]
        )
      ).rows?.[0]?.total
    );
    assert(firstCount === 1, `Expected exactly 1 posted reversal journal, got ${firstCount}`);

    const replay = await runCashFxRevaluation({
      payload: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        legalEntityId: base.legalEntityId,
        bookId: base.bookId,
        fiscalPeriodId: period1Id,
        runType: "MONTH_END",
        idempotencyKey: `EXF02R-RUN-${stamp}`,
      },
    });
    assert(replay?.idempotentReplay === true, "Replay must be idempotent");
    assert(
      toNumber(replay?.run?.reversalJournalEntryId) === reversalJournalEntryId,
      "Replay must return the same reversal journal id"
    );

    const secondCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM journal_entries
           WHERE tenant_id = ?
             AND book_id = ?
             AND reference_no = ?
             AND status = 'POSTED'`,
          [identity.tenantId, base.bookId, `CASH_FX_REVAL_REVERSAL_RUN:${runId}`]
        )
      ).rows?.[0]?.total
    );
    assert(secondCount === 1, `Reversal journal should remain unique, got ${secondCount}`);

    console.log("PR-EXF02 revaluation reversal automation checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          fiscalPeriodId: period1Id,
          revaluationRunId: runId,
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
  console.error("PR-EXF02 revaluation reversal automation test failed.");
  console.error(err);
  process.exitCode = 1;
});
