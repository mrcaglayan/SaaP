import { closePool, query } from "../src/db.js";
import {
  TEST_FISCAL_YEAR,
  apiRequest,
  assert,
  bootstrapOrgBookCoa,
  findRegularPeriodByNo,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CLOSE_OFFICIAL_FROZEN_CURRENCY_TEST_PORT || 3143);
const BASE_URL =
  process.env.CLOSE_OFFICIAL_FROZEN_CURRENCY_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CloseOfficialFrozen#12345";

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

async function resolveGroupCompanyId(legalEntityId) {
  const result = await query(
    `SELECT group_company_id
     FROM legal_entities
     WHERE id = ?
     LIMIT 1`,
    [legalEntityId]
  );
  return toNumber(result.rows?.[0]?.group_company_id);
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `CLOFFC_${stamp}`;
  const tenantName = `Close Official Frozen Currency ${stamp}`;
  const adminEmail = `close_official_frozen_${stamp}@example.com`;

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
    const fiscalPeriod = findRegularPeriodByNo(base.periods, 1);
    const fiscalPeriodId = toNumber(fiscalPeriod?.id);
    assert(fiscalPeriodId > 0, "Target fiscal period is required");
    const groupCompanyId = await resolveGroupCompanyId(base.legalEntityId);
    assert(groupCompanyId > 0, "groupCompanyId is required");

    const consolidationGroupResult = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/consolidation/groups",
      body: {
        groupCompanyId,
        calendarId: base.calendarId,
        code: `OFFC_${stamp}`,
        name: `Official Frozen Group ${stamp}`,
        presentationCurrencyCode: "TRY",
      },
      expectedStatus: 201,
    });
    const consolidationGroupId = toNumber(consolidationGroupResult.json?.id);
    assert(consolidationGroupId > 0, "consolidationGroupId not created");

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/consolidation/groups/${consolidationGroupId}/members`,
      body: {
        legalEntityId: base.legalEntityId,
        consolidationMethod: "FULL",
        ownershipPct: 1,
        effectiveFrom: `${TEST_FISCAL_YEAR}-01-01`,
      },
      expectedStatus: 201,
    });

    const cycleResult = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/close/cycles",
      body: {
        cycleType: "MONTH_END",
        fiscalPeriodId,
        consolidationGroupId,
      },
      expectedStatus: 201,
    });
    const cycleId = toNumber(cycleResult.json?.row?.id);
    assert(cycleId > 0, "Close cycle id missing");

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/close/cycles/${cycleId}/provision`,
      expectedStatus: 200,
    });

    const mismatchedOfficialRun = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/consolidation/runs",
      body: {
        consolidationGroupId,
        fiscalPeriodId,
        runName: "OFFICIAL",
        presentationCurrencyCode: "USD",
      },
      expectedStatus: 400,
    });
    assert(
      String(mismatchedOfficialRun.json?.message || "") ===
        "presentationCurrencyCode must match the frozen close-cycle snapshot for OFFICIAL consolidation runs",
      `Expected OFFICIAL frozen-currency rejection, got ${toErrorText(
        mismatchedOfficialRun.json
      )}`
    );

    console.log("OFFICIAL frozen-currency rejection regression passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          cycleId,
          consolidationGroupId,
          fiscalPeriodId,
          requestedPresentationCurrencyCode: "USD",
          frozenPresentationCurrencyCode: "TRY",
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
  console.error("OFFICIAL frozen-currency rejection regression failed.");
  console.error(err);
  process.exitCode = 1;
});
