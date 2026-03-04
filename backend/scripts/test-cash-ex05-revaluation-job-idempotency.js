import { closePool } from "../src/db.js";
import { runOneAvailableJob } from "../src/services/jobs.service.js";
import { enqueueDueCashFxRevaluationJobs } from "../src/services/cash.fx.revaluation.scheduler.service.js";
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
  seedAndCreateTenantAdmin,
  startServerProcess,
  toNumber,
  upsertRevaluationPurposeAccounts,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EX05_JOB_TEST_PORT || 3122);
const BASE_URL =
  process.env.CASH_EX05_JOB_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEX05Job#12345";

function toDateOnly(value) {
  return String(value || "").slice(0, 10);
}

function toIsoStartOfDay(dateOnly) {
  return `${dateOnly}T00:00:00.000Z`;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EX05J_${stamp}`;
  const tenantName = `EX05 Job Tenant ${stamp}`;
  const adminEmail = `ex05_job_admin_${stamp}@example.com`;

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
    const period1Id = toNumber(period1?.id);
    assert(period1Id > 0, "Fiscal period 1 must exist");
    const period1EndDate = toDateOnly(period1?.end_date || period1?.endDate);
    assert(period1EndDate.length === 10, "Fiscal period 1 end date is required");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05J_USD_${String(stamp).slice(-5)}`,
      name: "EX05J USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05J_CNT_${String(stamp).slice(-5)}`,
      name: "EX05J Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05J_FXG_${String(stamp).slice(-5)}`,
      name: "EX05J FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EX05J_FXL_${String(stamp).slice(-5)}`,
      name: "EX05J FX Loss",
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
      code: `EX05J-RUSD-${stamp}`,
      name: "EX05J USD Register",
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
      idempotencyKey: `EX05J-TXN-${stamp}`,
      sourceEntityId: `EX05J-TXN-${stamp}`,
    });

    const scheduleNow = toIsoStartOfDay(addDays(period1EndDate, 1));
    const firstTick = await enqueueDueCashFxRevaluationJobs({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      userId: identity.userId,
      limit: 50,
      now: scheduleNow,
    });
    assert(firstTick.due_runs >= 1, "First scheduler tick should detect due run(s)");
    assert(firstTick.queued_jobs >= 1, "First scheduler tick should queue job(s)");

    const secondTick = await enqueueDueCashFxRevaluationJobs({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      userId: identity.userId,
      limit: 50,
      now: scheduleNow,
    });
    assert(
      secondTick.idempotent_hits >= 1,
      "Second scheduler tick in same bucket should hit job idempotency"
    );

    const runOne = await runOneAvailableJob({
      workerId: `ex05-job-worker-${stamp}`,
      queueNames: ["ops.cash.fx.revaluation"],
      tenantId: identity.tenantId,
    });
    assert(runOne?.idle === false, "Worker should claim queued revaluation job");
    assert(
      String(runOne?.status || "").toUpperCase() === "SUCCEEDED",
      `Expected SUCCEEDED job status, got ${runOne?.status}`
    );

    const runTwo = await runOneAvailableJob({
      workerId: `ex05-job-worker-${stamp}`,
      queueNames: ["ops.cash.fx.revaluation"],
      tenantId: identity.tenantId,
    });
    assert(runTwo?.idle === true, "Second worker pass should be idle");

    const thirdTick = await enqueueDueCashFxRevaluationJobs({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      userId: identity.userId,
      limit: 50,
      now: scheduleNow,
    });
    assert(
      thirdTick.skipped_already_completed >= 1,
      "Scheduler should skip once revaluation run is completed"
    );

    console.log("PR-EX05 revaluation job idempotency checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          fiscalPeriodId: period1Id,
          firstTickQueued: firstTick.queued_jobs,
          secondTickIdempotent: secondTick.idempotent_hits,
          workerStatus: runOne?.status || null,
          thirdTickSkippedCompleted: thirdTick.skipped_already_completed,
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
  console.error("PR-EX05 revaluation job idempotency test failed.");
  console.error(err);
  process.exitCode = 1;
});
