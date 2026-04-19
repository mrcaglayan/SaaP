import { closePool, query } from "../src/db.js";
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

const PORT = Number(process.env.CLOSE_PERIOD_BLOCKER_VISIBILITY_TEST_PORT || 3141);
const BASE_URL =
  process.env.CLOSE_PERIOD_BLOCKER_VISIBILITY_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "ClosePeriodBlocker#12345";

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

function includesBlockerCode(rows, code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).some(
    (row) => String(row?.code || "").trim().toUpperCase() === normalizedCode
  );
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `CLPB_${stamp}`;
  const tenantName = `Close Period Blocker Tenant ${stamp}`;
  const adminEmail = `close_period_blocker_${stamp}@example.com`;

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
    const fiscalPeriodId = toNumber(period12?.id);
    assert(fiscalPeriodId > 0, "Fiscal period 12 must exist");
    const period12EndDate = toDateOnly(period12?.end_date || period12?.endDate);
    assert(period12EndDate.length === 10, "Fiscal period 12 end date is required");

    const usdRegisterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_USD_${String(stamp).slice(-5)}`,
      name: "CLPB USD Register",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cashCounterAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_CNT_${String(stamp).slice(-5)}`,
      name: "CLPB Cash Counter",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxGainAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_FXG_${String(stamp).slice(-5)}`,
      name: "CLPB FX Gain",
      accountType: "REVENUE",
      normalSide: "CREDIT",
    });
    const fxLossAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_FXL_${String(stamp).slice(-5)}`,
      name: "CLPB FX Loss",
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    });
    const cariArControlAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_CAR_${String(stamp).slice(-5)}`,
      name: "CLPB CARI AR Control",
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const cariApControlAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_CAP_${String(stamp).slice(-5)}`,
      name: "CLPB CARI AP Control",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });
    const retainedEarningsAccountId = await createAccount({
      baseUrl: BASE_URL,
      token,
      coaId: base.coaId,
      code: `CLPB_RET_${String(stamp).slice(-5)}`,
      name: "CLPB Retained Earnings",
      accountType: "EQUITY",
      normalSide: "CREDIT",
    });

    await upsertRevaluationPurposeAccounts({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      gainAccountId: fxGainAccountId,
      lossAccountId: fxLossAccountId,
    });
    await query(
      `INSERT INTO journal_purpose_accounts (
         tenant_id,
         legal_entity_id,
         purpose_code,
         account_id
       )
       VALUES
         (?, ?, 'CARI_AR_CONTROL', ?),
         (?, ?, 'CARI_AP_CONTROL', ?)
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         updated_at = CURRENT_TIMESTAMP`,
      [
        identity.tenantId,
        base.legalEntityId,
        cariArControlAccountId,
        identity.tenantId,
        base.legalEntityId,
        cariApControlAccountId,
      ]
    );

    const usdRegisterId = await createRegister({
      baseUrl: BASE_URL,
      token,
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      operatingUnitId: base.operatingUnitId,
      accountId: usdRegisterAccountId,
      code: `CLPB-RUSD-${stamp}`,
      name: "CLPB USD Register",
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
      idempotencyKey: `CLPB-TXN-${stamp}`,
      sourceEntityId: `CLPB-TXN-${stamp}`,
    });

    const createCycle = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/close/cycles",
      body: {
        cycleType: "YEAR_END",
        fiscalPeriodId,
        legalEntityId: base.legalEntityId,
      },
      expectedStatus: 201,
    });
    const cycleId = toNumber(createCycle.json?.row?.id);
    assert(cycleId > 0, "Close cycle id missing");

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/close/cycles/${cycleId}/provision`,
      expectedStatus: 200,
    });

    const cockpit = await apiRequest({
      baseUrl: BASE_URL,
      token,
      requestPath: `/api/v1/close/cycles/${cycleId}/cockpit`,
      expectedStatus: 200,
    });
    const periodCloseRow = (cockpit.json?.worklist?.rows || []).find(
      (row) =>
        String(row?.itemType || "").trim().toUpperCase() === "PERIOD_CLOSE_RUN" &&
        toNumber(row?.bookId) === base.bookId
    );
    assert(periodCloseRow, "Cockpit worklist must include the provisioned period-close item");
    assert(
      includesBlockerCode(periodCloseRow?.blockers, "CASH_FX_REVALUATION_REQUIRED"),
      `Period-close worklist row should surface CASH_FX_REVALUATION_REQUIRED, got ${JSON.stringify(
        periodCloseRow?.blockers || []
      )}`
    );

    const blockerSurface = await apiRequest({
      baseUrl: BASE_URL,
      token,
      requestPath: `/api/v1/close/cycles/${cycleId}/blockers`,
      expectedStatus: 200,
    });
    assert(
      includesBlockerCode(blockerSurface.json?.rows, "CASH_FX_REVALUATION_REQUIRED"),
      `Cycle blocker surface should include CASH_FX_REVALUATION_REQUIRED, got ${JSON.stringify(
        blockerSurface.json?.rows || []
      )}`
    );

    const blockedClose = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${fiscalPeriodId}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        retainedEarningsAccountId,
        note: "PR-A period-close cockpit blocker visibility",
      },
      expectedStatus: 409,
    });
    assert(
      String(blockedClose.json?.code || "").toUpperCase() === "CASH_FX_REVALUATION_REQUIRED",
      `Expected CASH_FX_REVALUATION_REQUIRED from action path, got ${toErrorText(blockedClose.json)}`
    );

    console.log("Close-cycle period-close blocker visibility regression passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          cycleId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          fiscalPeriodId,
          surfacedBlockerCode: "CASH_FX_REVALUATION_REQUIRED",
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
  console.error("Close-cycle period-close blocker visibility regression failed.");
  console.error(err);
  process.exitCode = 1;
});
