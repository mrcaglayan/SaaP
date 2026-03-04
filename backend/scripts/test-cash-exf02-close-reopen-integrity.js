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
  seedAndCreateTenantAdmin,
  startServerProcess,
  toNumber,
  upsertRevaluationPurposeAccounts,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EXF02_CLOSE_TEST_PORT || 3125);
const BASE_URL =
  process.env.CASH_EXF02_CLOSE_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF02Close#12345";

function toDateOnly(value) {
  return String(value || "").slice(0, 10);
}

function toErrorText(payload) {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload?.message === "string") return payload.message;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF02C_${stamp}`;
  const tenantName = `EXF02 Close Tenant ${stamp}`;
  const adminEmail = `exf02_close_admin_${stamp}@example.com`;

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
      code: `EXF02C_USD_${String(stamp).slice(-5)}`,
      name: "EXF02C USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02C_CNT_${String(stamp).slice(-5)}`,
      name: "EXF02C Clearing Liability",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02C_FXG_${String(stamp).slice(-5)}`,
      name: "EXF02C FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF02C_FXL_${String(stamp).slice(-5)}`,
      name: "EXF02C FX Loss",
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
      code: `EXF02C-RUSD-${stamp}`,
      name: "EXF02C USD Register",
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
    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-02-10",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 41,
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
      idempotencyKey: `EXF02C-OPEN-${stamp}`,
      sourceEntityId: `EXF02C-OPEN-${stamp}`,
    });

    await createAndPostCashTransaction({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      registerId: usdRegisterId,
      txnType: "PAYOUT",
      txnDatetime: "2026-02-10T09:00:00",
      bookDate: "2026-02-10",
      amount: 100,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EXF02C-CLEAR-${stamp}`,
      sourceEntityId: `EXF02C-CLEAR-${stamp}`,
    });

    const revaluation = await runCashFxRevaluation({
      payload: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        legalEntityId: base.legalEntityId,
        bookId: base.bookId,
        fiscalPeriodId: period1Id,
        runType: "MONTH_END",
        idempotencyKey: `EXF02C-RUN-${stamp}`,
      },
    });
    const revaluationRunId = toNumber(revaluation?.run?.id);
    const reversalJournalEntryId = toNumber(revaluation?.run?.reversalJournalEntryId);
    assert(revaluationRunId > 0, "Revaluation run id missing");
    assert(reversalJournalEntryId > 0, "Revaluation reversal journal must exist");

    const closeFirst = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period2Id}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        note: "EXF02 close integrity first close",
      },
      expectedStatus: 201,
    });
    assert(closeFirst.json?.ok === true, "First close should succeed");

    const reopen = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period2Id}/reopen`,
      body: {
        reason: "EXF02 reopen cycle check",
      },
      expectedStatus: 201,
    });
    assert(reopen.json?.ok === true, "Reopen should succeed before hard close");

    const closeSecond = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period2Id}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        note: "EXF02 close integrity second close",
      },
      expectedStatus: 201,
    });
    assert(closeSecond.json?.ok === true, "Second close after reopen should succeed");

    const reversalCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM journal_entries
           WHERE tenant_id = ?
             AND book_id = ?
             AND reference_no = ?
             AND status = 'POSTED'`,
          [
            identity.tenantId,
            base.bookId,
            `CASH_FX_REVAL_REVERSAL_RUN:${revaluationRunId}`,
          ]
        )
      ).rows?.[0]?.total
    );
    assert(
      reversalCount === 1,
      `Expected exactly one posted reversal journal across reopen/close cycles, got ${reversalCount}`
    );

    await query(
      `UPDATE cash_fx_revaluation_runs
       SET reversal_journal_entry_id = NULL,
           reversal_status = 'PENDING'
       WHERE tenant_id = ?
         AND id = ?`,
      [identity.tenantId, revaluationRunId]
    );

    const closeBlocked = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period2Id}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        note: "EXF02 reversal integrity block check",
      },
      expectedStatus: 409,
    });
    assert(
      String(closeBlocked.json?.code || "").toUpperCase() ===
        "CASH_FX_REVALUATION_REVERSAL_REQUIRED",
      `Expected CASH_FX_REVALUATION_REVERSAL_REQUIRED, got ${toErrorText(closeBlocked.json)}`
    );

    await query(
      `UPDATE cash_fx_revaluation_runs
       SET reversal_journal_entry_id = ?,
           reversal_status = 'POSTED'
       WHERE tenant_id = ?
         AND id = ?`,
      [reversalJournalEntryId, identity.tenantId, revaluationRunId]
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-statuses/${base.bookId}/${period2Id}/close`,
      body: {
        status: "HARD_CLOSED",
        note: "EXF02 hard close immutability check",
      },
      expectedStatus: 201,
    });

    const reopenHardClosed = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period2Id}/reopen`,
      body: {
        reason: "EXF02 should fail on hard closed period",
      },
      expectedStatus: 400,
    });
    assert(
      String(toErrorText(reopenHardClosed.json)).includes("HARD_CLOSED"),
      `Expected HARD_CLOSED reopen error, got ${toErrorText(reopenHardClosed.json)}`
    );

    console.log("PR-EXF02 close/reopen integrity checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          period1Id,
          period2Id,
          revaluationRunId,
          reversalJournalEntryId,
          reversalCount,
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
  console.error("PR-EXF02 close/reopen integrity test failed.");
  console.error(err);
  process.exitCode = 1;
});
