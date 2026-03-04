import { closePool, query } from "../src/db.js";
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
  seedAndCreateTenantAdmin,
  startServerProcess,
  toNumber,
  upsertRevaluationPurposeAccounts,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CASH_EXF04_ACTIONS_TEST_PORT || 3128);
const BASE_URL =
  process.env.CASH_EXF04_ACTIONS_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CashEXF04Actions#12345";

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function setupFailedRevaluationJob({
  tenantId,
  userId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  stamp,
}) {
  const enqueueRes = await enqueueJob({
    tenantId,
    userId,
    spec: {
      queue_name: "ops.cash.fx.revaluation",
      module_code: "CASH",
      job_type: "CASH_FX_REVALUATION_RUN",
      run_after_at: new Date(Date.now() - 1000),
      idempotency_key: `EXF04A-JOB-${stamp}`,
      payload: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        book_id: bookId,
        fiscal_period_id: fiscalPeriodId,
        run_type: "MONTH_END",
        acting_user_id: userId,
        run_idempotency_key: `EXF04A-RUN-${stamp}`,
      },
    },
  });
  const jobId = toNumber(enqueueRes?.job?.id);
  assert(jobId > 0, "Revaluation app job id is required");

  const workerResult = await runOneAvailableJob({
    tenantId,
    workerId: `exf04-actions-worker-${stamp}`,
    queueNames: ["ops.cash.fx.revaluation"],
  });
  assert(workerResult?.idle === false, "Worker must claim revaluation job");
  assert(workerResult?.ok === false, "Revaluation job should fail for action test");
  assert(
    asUpper(workerResult?.status) === "FAILED_FINAL",
    `Expected FAILED_FINAL, got ${workerResult?.status}`
  );

  return jobId;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `EXF04A_${stamp}`;
  const tenantName = `EXF04 Actions Tenant ${stamp}`;
  const adminEmail = `exf04_actions_admin_${stamp}@example.com`;

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
    const period1 = findRegularPeriodByNo(base.periods, 1);
    const period1Id = toNumber(period1?.id);
    assert(period1Id > 0, "Fiscal period 1 must exist");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04A_USD_${String(stamp).slice(-6)}`,
      name: "EXF04A USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04A_CNT_${String(stamp).slice(-6)}`,
      name: "EXF04A Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04A_FXG_${String(stamp).slice(-6)}`,
      name: "EXF04A FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `EXF04A_FXL_${String(stamp).slice(-6)}`,
      name: "EXF04A FX Loss",
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
      code: `EXF04A-RUSD-${stamp}`,
      name: "EXF04A USD Register",
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
      idempotencyKey: `EXF04A-OPEN-${stamp}`,
      sourceEntityId: `EXF04A-OPEN-${stamp}`,
    });

    const revalJobId = await setupFailedRevaluationJob({
      tenantId: identity.tenantId,
      userId: identity.userId,
      legalEntityId: base.legalEntityId,
      bookId: base.bookId,
      fiscalPeriodId: period1Id,
      stamp,
    });

    const dashboard = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: `/api/v1/cash/reports/fx-ops-dashboard?tenantId=${identity.tenantId}&legalEntityId=${base.legalEntityId}&refresh=true&limit=50`,
      expectedStatus: 200,
    });
    const revaluationRows = Array.isArray(dashboard.json?.sections?.revaluationJobs?.rows)
      ? dashboard.json.sections.revaluationJobs.rows
      : [];
    const targetJobException = revaluationRows.find(
      (row) => toNumber(row?.sourceRefId) === revalJobId
    );
    const jobExceptionId = toNumber(targetJobException?.exceptionId);
    assert(jobExceptionId > 0, "FX revaluation job exception id should exist");

    const rerunResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/reports/fx-ops-exceptions/${jobExceptionId}/rerun-job`,
      body: {
        tenantId: identity.tenantId,
        delaySeconds: 0,
        maxAttempts: 3,
        resolutionNote: "Ops rerun requested from EXF04 action test",
      },
      expectedStatus: 200,
    });
    assert(
      toNumber(rerunResponse.json?.job?.id) === revalJobId,
      "rerun-job should target the expected app job"
    );
    assert(
      asUpper(rerunResponse.json?.job?.status) === "QUEUED",
      `Expected requeued job status QUEUED, got ${rerunResponse.json?.job?.status}`
    );
    assert(
      asUpper(rerunResponse.json?.exception?.status) === "RESOLVED",
      "rerun-job should resolve the exception"
    );

    const jobExceptionDb = (
      await query(
        `SELECT status, resolution_action, resolution_note
         FROM exception_workbench
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, jobExceptionId]
      )
    ).rows?.[0];
    assert(asUpper(jobExceptionDb?.status) === "RESOLVED", "Job exception row must be RESOLVED");
    assert(
      asUpper(jobExceptionDb?.resolution_action) === "RERUN_JOB",
      `Expected resolution_action=RERUN_JOB, got ${jobExceptionDb?.resolution_action}`
    );

    const jobAuditCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM exception_workbench_audit
           WHERE tenant_id = ?
             AND exception_workbench_id = ?
             AND event_type = 'RESOLVED'`,
          [identity.tenantId, jobExceptionId]
        )
      ).rows?.[0]?.total
    );
    assert(jobAuditCount >= 1, "Job exception must have RESOLVED audit event");

    const mismatchException = await recordCariSettlementCurrencyMismatchException({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      settlementCurrencyCode: "EUR",
      registerId: usdRegisterId,
      registerCode: `EXF04A-RUSD-${stamp}`,
      registerCurrencyCode: "USD",
      counterpartyId: 999002,
      counterpartyType: "VENDOR",
      settlementIdempotencyKey: `EXF04A-SET-MISMATCH-${stamp}`,
    });
    const mismatchExceptionId = toNumber(mismatchException?.exceptionId);
    assert(mismatchExceptionId > 0, "Settlement mismatch exception id should exist");

    const overrideReason = "Manual override approved by treasury lead";
    const overrideResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/cash/reports/fx-ops-exceptions/${mismatchExceptionId}/override`,
      body: {
        tenantId: identity.tenantId,
        reason: overrideReason,
      },
      expectedStatus: 200,
    });
    assert(
      asUpper(overrideResponse.json?.exception?.status) === "IGNORED",
      "override action should mark exception IGNORED"
    );

    const mismatchDb = (
      await query(
        `SELECT status, resolution_action, resolution_note
         FROM exception_workbench
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [identity.tenantId, mismatchExceptionId]
      )
    ).rows?.[0];
    assert(asUpper(mismatchDb?.status) === "IGNORED", "Mismatch exception must be IGNORED");
    assert(
      asUpper(mismatchDb?.resolution_action) === "MANUAL_OVERRIDE",
      `Expected resolution_action=MANUAL_OVERRIDE, got ${mismatchDb?.resolution_action}`
    );
    assert(
      String(mismatchDb?.resolution_note || "").includes("treasury lead"),
      "Mismatch resolution note should persist override reason"
    );

    const mismatchAuditCount = toNumber(
      (
        await query(
          `SELECT COUNT(*) AS total
           FROM exception_workbench_audit
           WHERE tenant_id = ?
             AND exception_workbench_id = ?
             AND event_type = 'IGNORED'`,
          [identity.tenantId, mismatchExceptionId]
        )
      ).rows?.[0]?.total
    );
    assert(mismatchAuditCount >= 1, "Mismatch exception must have IGNORED audit event");

    console.log("PR-EXF04 FX exception actions checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          revaluationJobId: revalJobId,
          jobExceptionId,
          mismatchExceptionId,
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
  console.error("PR-EXF04 FX exception actions test failed.");
  console.error(err);
  process.exitCode = 1;
});
