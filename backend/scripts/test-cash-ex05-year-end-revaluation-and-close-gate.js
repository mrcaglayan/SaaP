import { closePool } from "../src/db.js";
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

const PORT = Number(process.env.CASH_EX05_YEAR_END_TEST_PORT || 3121);
const BASE_URL =
  process.env.CASH_EX05_YEAR_END_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEX05YearEnd#12345";

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

function toDateOnly(value) {
  return String(value || "").slice(0, 10);
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EX05Y_${stamp}`;
  const tenantName = `EX05 Year-End Tenant ${stamp}`;
  const adminEmail = `ex05_year_admin_${stamp}@example.com`;

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
      yearsToGenerate: [TEST_FISCAL_YEAR, TEST_FISCAL_YEAR + 1],
    });
    const period12 = findRegularPeriodByNo(base.periods, 12);
    const period12Id = toNumber(period12?.id);
    assert(period12Id > 0, "Fiscal period 12 must exist");
    const period12EndDate = toDateOnly(period12?.end_date || period12?.endDate);
    assert(period12EndDate.length === 10, "Fiscal period 12 end date is required");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05Y_USD_${String(stamp).slice(-5)}`,
      name: "EX05Y USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05Y_CNT_${String(stamp).slice(-5)}`,
      name: "EX05Y Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05Y_FXG_${String(stamp).slice(-5)}`,
      name: "EX05Y FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05Y_FXL_${String(stamp).slice(-5)}`,
      name: "EX05Y FX Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const retainedEarningsAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05Y_RET_${String(stamp).slice(-5)}`,
      name: "EX05Y Retained Earnings",
      accountType: "EQUITY",
      normalSide: "CREDIT",
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
      code: `EX05Y-RUSD-${stamp}`,
      name: "EX05Y USD Register",
      currencyCode: "USD",
    });

    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-12-20",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 38,
    });
    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: period12EndDate,
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
      txnDatetime: "2026-12-20T10:00:00",
      bookDate: "2026-12-20",
      amount: 100,
      currencyCode: "USD",
      counterAccountId: cashCounterAccountId,
      idempotencyKey: `EX05Y-TXN-${stamp}`,
      sourceEntityId: `EX05Y-TXN-${stamp}`,
    });

    const blockedClose = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period12Id}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        retainedEarningsAccountId,
        note: "EX05 year-end close gate check",
      },
      expectedStatus: 409,
    });
    assert(
      String(blockedClose.json?.code || "").toUpperCase() === "CASH_FX_REVALUATION_REQUIRED",
      `Expected CASH_FX_REVALUATION_REQUIRED, got ${toErrorText(blockedClose.json)}`
    );

    const revaluation = await runCashFxRevaluation({
      payload: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        legalEntityId: base.legalEntityId,
        bookId: base.bookId,
        fiscalPeriodId: period12Id,
        runType: "YEAR_END",
        idempotencyKey: `EX05Y-RUN-${stamp}`,
      },
    });
    assert(revaluation?.idempotentReplay === false, "Year-end revaluation should execute");
    assert(
      String(revaluation?.run?.status || "").toUpperCase() === "COMPLETED",
      "Year-end revaluation status must be COMPLETED"
    );

    const closeAfterRevaluation = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${period12Id}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        retainedEarningsAccountId,
        note: "EX05 year-end close after revaluation",
      },
      expectedStatus: 201,
    });
    assert(closeAfterRevaluation.json?.ok === true, "Close-run should succeed after revaluation");
    assert(toNumber(closeAfterRevaluation.json?.run?.id) > 0, "Close-run id missing");

    console.log("PR-EX05 year-end close gate checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          period12Id,
          revaluationRunId: revaluation?.run?.id || null,
          closeRunId: closeAfterRevaluation.json?.run?.id || null,
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
  console.error("PR-EX05 year-end close gate test failed.");
  console.error(err);
  process.exitCode = 1;
});
