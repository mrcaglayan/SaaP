import { closePool, query } from "../src/db.js";
import { ensureLocalClosePack } from "../src/services/local.close-packs.service.js";
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

const PORT = Number(process.env.CLOSE_CONSOLIDATION_BOOK_AMBIGUITY_TEST_PORT || 3142);
const BASE_URL =
  process.env.CLOSE_CONSOLIDATION_BOOK_AMBIGUITY_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CloseBookAmbiguity#12345";

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

function includesBlockerCode(rows, code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).some(
    (row) => String(row?.code || "").trim().toUpperCase() === normalizedCode
  );
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

async function createLocalBook({
  baseUrl,
  token,
  legalEntityId,
  calendarId,
  stamp,
}) {
  const bookRes = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/gl/books",
    body: {
      legalEntityId,
      calendarId,
      code: `AMBIGBOOK${stamp}`,
      name: `Ambiguity Book ${stamp}`,
      bookType: "LOCAL",
      baseCurrencyCode: "TRY",
    },
    expectedStatus: 201,
  });
  const bookId = toNumber(bookRes.json?.id);
  assert(bookId > 0, "Second local book id not created");
  return bookId;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `CLAM_${stamp}`;
  const tenantName = `Close Ambiguity Tenant ${stamp}`;
  const adminEmail = `close_ambiguity_${stamp}@example.com`;

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

    const secondBookId = await createLocalBook({
      baseUrl: BASE_URL,
      token,
      legalEntityId: base.legalEntityId,
      calendarId: base.calendarId,
      stamp,
    });
    const groupCompanyId = await resolveGroupCompanyId(base.legalEntityId);
    assert(groupCompanyId > 0, "groupCompanyId is required");

    await ensureLocalClosePack({
      tenantId: identity.tenantId,
      userId: identity.userId,
      legalEntityId: base.legalEntityId,
      bookId: base.bookId,
      fiscalPeriodId,
      closeScopeType: "CENTRAL",
      status: "NOT_OPENED",
      note: "PR-D ambiguity regression primary book",
    });
    await ensureLocalClosePack({
      tenantId: identity.tenantId,
      userId: identity.userId,
      legalEntityId: base.legalEntityId,
      bookId: secondBookId,
      fiscalPeriodId,
      closeScopeType: "CENTRAL",
      status: "NOT_OPENED",
      note: "PR-D ambiguity regression secondary book",
    });

    const consolidationGroupResult = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/consolidation/groups",
      body: {
        groupCompanyId,
        calendarId: base.calendarId,
        code: `AMBIG_${stamp}`,
        name: `Ambiguity Group ${stamp}`,
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

    const runResult = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/consolidation/runs",
      body: {
        consolidationGroupId,
        fiscalPeriodId,
        runName: `AMBIG_${stamp}`,
        presentationCurrencyCode: "TRY",
      },
      expectedStatus: 201,
    });
    const runId = toNumber(runResult.json?.runId);
    assert(runId > 0, "Consolidation run id missing");

    const reviewGate = await apiRequest({
      baseUrl: BASE_URL,
      token,
      requestPath: `/api/v1/consolidation/runs/${runId}/review-gate`,
      expectedStatus: 200,
    });
    assert(
      includesBlockerCode(reviewGate.json?.blockers, "ENTITY_CLOSE_BOOK_AMBIGUOUS"),
      `Review gate should surface ENTITY_CLOSE_BOOK_AMBIGUOUS, got ${JSON.stringify(
        reviewGate.json?.blockers || []
      )}`
    );

    const finalizeAttempt = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/consolidation/runs/${runId}/finalize`,
      expectedStatus: 409,
    });
    assert(
      includesBlockerCode(
        finalizeAttempt.json?.details?.reviewGate?.blockers,
        "ENTITY_CLOSE_BOOK_AMBIGUOUS"
      ),
      `Finalize should preserve ENTITY_CLOSE_BOOK_AMBIGUOUS in reviewGate details, got ${toErrorText(
        finalizeAttempt.json
      )}`
    );

    console.log("Consolidation multi-book ambiguity regression passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          consolidationGroupId,
          fiscalPeriodId,
          runId,
          ambiguousBookIds: [base.bookId, secondBookId],
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
  console.error("Consolidation multi-book ambiguity regression failed.");
  console.error(err);
  process.exitCode = 1;
});
