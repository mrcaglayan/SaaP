import { closePool } from "../src/db.js";
import { recordCariSettlementCurrencyMismatchException } from "../src/services/cash.fx.ops.service.js";
import { enqueueJob, runOneAvailableJob } from "../src/services/jobs.service.js";
import {
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

const PORT = Number(process.env.CASH_EXF04_DASHBOARD_TEST_PORT || 3127);
const BASE_URL =
  process.env.CASH_EXF04_DASHBOARD_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF04Dash#12345";

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function createAndPostPayoutWithOverride({
  baseUrl,
  token,
  tenantId,
  registerId,
  counterAccountId,
  amount,
  currencyCode,
  stamp,
}) {
  const createRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/cash/transactions",
    body: {
      tenantId,
      registerId,
      txnType: "PAYOUT",
      txnDatetime: "2026-01-10T10:00:00",
      bookDate: "2026-01-10",
      amount,
      currencyCode: asUpper(currencyCode),
      counterAccountId,
      sourceModule: "MANUAL",
      idempotencyKey: `EXF04-PAYOUT-${stamp}`,
    },
    expectedStatus: 200,
  });
  const transactionId = toNumber(createRes.json?.row?.id);
  assert(transactionId > 0, "PAYOUT transaction id is required");

  await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: `/api/v1/cash/transactions/${transactionId}/post`,
    body: {
      tenantId,
      overrideCashControl: true,
      overrideReason: "EXF04 negative-balance ops test",
    },
    expectedStatus: 200,
  });

  return transactionId;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF04D_${stamp}`;
  const tenantName = `EXF04 Dashboard Tenant ${stamp}`;
  const adminEmail = `exf04_dashboard_admin_${stamp}@example.com`;

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
    const period1 = findRegularPeriodByNo(base.periods, 1);
    const period1Id = toNumber(period1?.id);
    const period1EndDate = String(period1?.end_date || "").slice(0, 10);
    assert(period1Id > 0, "Fiscal period 1 must exist");
    assert(period1EndDate.length === 10, "Fiscal period 1 end date is required");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04D_USD_${String(stamp).slice(-6)}`,
      name: "EXF04D USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04D_CNT_${String(stamp).slice(-6)}`,
      name: "EXF04D Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04D_FXG_${String(stamp).slice(-6)}`,
      name: "EXF04D FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04D_FXL_${String(stamp).slice(-6)}`,
      name: "EXF04D FX Loss",
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
      code: `EXF04D-RUSD-${stamp}`,
      name: "EXF04D USD Register",
      currencyCode: "USD",
    });

    await insertFxRate({
      tenantId: identity.tenantId,
      rateDate: "2026-01-10",
      fromCurrencyCode: "USD",
      toCurrencyCode: "TRY",
      rate: 38,
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
      idempotencyKey: `EXF04D-OPEN-${stamp}`,
      sourceEntityId: `EXF04D-OPEN-${stamp}`,
    });

    await createAndPostPayoutWithOverride({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      registerId: usdRegisterId,
      counterAccountId: cashCounterAccountId,
      amount: 150,
      currencyCode: "USD",
      stamp,
    });

    const enqueueRes = await enqueueJob({
      tenantId: identity.tenantId,
      userId: identity.userId,
      spec: {
        queue_name: "ops.cash.fx.revaluation",
        module_code: "CASH",
        job_type: "CASH_FX_REVALUATION_RUN",
        run_after_at: new Date(Date.now() - 1000),
        idempotency_key: `EXF04D-JOB-${stamp}`,
        payload: {
          tenant_id: identity.tenantId,
          legal_entity_id: base.legalEntityId,
          book_id: base.bookId,
          fiscal_period_id: period1Id,
          run_type: "MONTH_END",
          acting_user_id: identity.userId,
          run_idempotency_key: `EXF04D-RUN-${stamp}`,
        },
      },
    });
    const revalJobId = toNumber(enqueueRes?.job?.id);
    assert(revalJobId > 0, "Revaluation app job id is required");

    const workerResult = await runOneAvailableJob({
      tenantId: identity.tenantId,
      workerId: `exf04-dashboard-worker-${stamp}`,
      queueNames: ["ops.cash.fx.revaluation"],
    });
    assert(workerResult?.idle === false, "Worker must claim revaluation job");
    assert(workerResult?.ok === false, "Revaluation job should fail due to missing FX rate");
    assert(
      asUpper(workerResult?.status) === "FAILED_FINAL",
      `Expected FAILED_FINAL, got ${workerResult?.status}`
    );

    const mismatchException = await recordCariSettlementCurrencyMismatchException({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      settlementCurrencyCode: "EUR",
      registerId: usdRegisterId,
      registerCode: `EXF04D-RUSD-${stamp}`,
      registerCurrencyCode: "USD",
      counterpartyId: 999001,
      counterpartyType: "VENDOR",
      settlementIdempotencyKey: `EXF04D-SET-MISMATCH-${stamp}`,
    });
    assert(
      toNumber(mismatchException?.exceptionId) > 0,
      "Currency mismatch exception should be recorded"
    );

    const dashboard = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: `/api/v1/cash/reports/fx-ops-dashboard?tenantId=${identity.tenantId}&legalEntityId=${base.legalEntityId}&asOfDate=${period1EndDate}&dateFrom=2026-01-01&dateTo=2026-12-31&refresh=true&limit=50`,
      expectedStatus: 200,
    });

    assert(toNumber(dashboard.json?.summary?.missingRates) >= 1, "missingRates should be >= 1");
    assert(
      toNumber(dashboard.json?.summary?.revaluationJobs) >= 1,
      "revaluationJobs should be >= 1"
    );
    assert(
      toNumber(dashboard.json?.summary?.outOfPolicyBalances) >= 1,
      "outOfPolicyBalances should be >= 1"
    );
    assert(
      toNumber(dashboard.json?.summary?.settlementCurrencyMismatch) >= 1,
      "settlementCurrencyMismatch should be >= 1"
    );

    const missingRatesRows = Array.isArray(dashboard.json?.sections?.missingRates?.rows)
      ? dashboard.json.sections.missingRates.rows
      : [];
    const jobRows = Array.isArray(dashboard.json?.sections?.revaluationJobs?.rows)
      ? dashboard.json.sections.revaluationJobs.rows
      : [];
    const balanceRows = Array.isArray(dashboard.json?.sections?.outOfPolicyBalances?.rows)
      ? dashboard.json.sections.outOfPolicyBalances.rows
      : [];
    const mismatchRows = Array.isArray(dashboard.json?.sections?.settlementCurrencyMismatch?.rows)
      ? dashboard.json.sections.settlementCurrencyMismatch.rows
      : [];

    const missingRateRow = missingRatesRows.find((row) => {
      const payload = row?.payload || {};
      return (
        asUpper(payload.from_currency_code) === "USD" &&
        asUpper(payload.to_currency_code) === "TRY" &&
        String(payload.rate_date || "") === period1EndDate
      );
    });
    assert(Boolean(missingRateRow), "Missing FX rate row for USD/TRY period-end is required");

    const jobRow = jobRows.find((row) => toNumber(row?.sourceRefId) === revalJobId);
    assert(Boolean(jobRow), "Revaluation failed job row must be present");

    const balanceRow = balanceRows.find(
      (row) =>
        toNumber(row?.payload?.register_id) === usdRegisterId &&
        Boolean(row?.payload?.policy_flags?.negative_balance)
    );
    assert(Boolean(balanceRow), "Negative foreign cash balance row must be present");

    const mismatchRow = mismatchRows.find((row) => {
      const payload = row?.payload || {};
      return (
        asUpper(payload.register_currency_code) === "USD" &&
        asUpper(payload.settlement_currency_code) === "EUR"
      );
    });
    assert(Boolean(mismatchRow), "Settlement currency mismatch row must be present");

    console.log("PR-EXF04 FX ops dashboard checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          revaluationJobId: revalJobId,
          dashboardSummary: dashboard.json?.summary || null,
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
  console.error("PR-EXF04 FX ops dashboard test failed.");
  console.error(err);
  process.exitCode = 1;
});
