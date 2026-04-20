import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";
import { __testOnboardingInternals } from "../src/routes/onboarding.js";

const PORT = Number(process.env.PRF13_BOOTSTRAP_HANDOFF_TEST_PORT || 3146);
const BASE_URL =
  process.env.PRF13_BOOTSTRAP_HANDOFF_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

async function createBootstrapAdminSession(stamp) {
  const email = `prf13_bootstrap_${stamp}@example.com`;
  const password = "PRF13Bootstrap#12345";
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `PRF13_BOOTSTRAP_${stamp}`,
    tenantName: `PRF13 Bootstrap ${stamp}`,
    adminEmail: email,
    adminPassword: password,
  });
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    email,
    password,
  };
}

async function createActiveTenantUser({ baseUrl, token, email, name, password }) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/security/users",
    body: {
      email,
      name,
      password,
      status: "ACTIVE",
    },
    expectedStatus: 201,
  });
  return response.json;
}

async function fetchAssignedRoleCodes({ tenantId, userId, scopeType, scopeId }) {
  const result = await query(
    `SELECT r.code
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?
       AND urs.scope_type = ?
       AND urs.scope_id = ?
     ORDER BY r.code`,
    [tenantId, userId, scopeType, scopeId]
  );
  return (result.rows || []).map((row) => String(row.code || "").trim());
}

function assertIncludesAll(actualRoleCodes, expectedRoleCodes, message) {
  const actualSet = new Set(actualRoleCodes);
  for (const roleCode of expectedRoleCodes) {
    assert(actualSet.has(roleCode), `${message}: missing role ${roleCode}`);
  }
}

async function main() {
  const stamp = Date.now();
  const admin = await createBootstrapAdminSession(stamp);
  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  let blockedPresetError = null;
  try {
    __testOnboardingInternals.assertBootstrapHandoffPresetAllowsAssignment({
      code: "InvalidPeriodCloseSupervisorPreset",
      roleCodes: ["PeriodCloseSupervisorAuthority"],
      optionalRoleCodes: [],
    });
  } catch (error) {
    blockedPresetError = error;
  }
  assert(
    blockedPresetError &&
      String(blockedPresetError.message || "").includes("centrally managed") &&
      String(blockedPresetError.message || "").includes(
        "PeriodCloseSupervisorAuthority"
      ),
    "Bootstrap handoff internals should reject centrally managed PeriodCloseSupervisorAuthority presets"
  );

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: admin.email,
      password: admin.password,
    });

    const existingUserEmail = `prf13_existing_${stamp}@example.com`;
    const existingUser = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token,
      email: existingUserEmail,
      name: "Existing Country Reviewer",
      password: "PRF13Existing#12345",
    });
    const existingUserId = Number(existingUser?.id || 0);
    assert(existingUserId > 0, "Existing user should be created before bootstrap handoff");

    const handoffOptionsResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: "/api/v1/onboarding/company-bootstrap/handoff-options",
      expectedStatus: 200,
    });
    const handoffUsers = Array.isArray(handoffOptionsResponse.json?.users)
      ? handoffOptionsResponse.json.users
      : [];
    const handoffPresetRoleCodes = Array.isArray(handoffOptionsResponse.json?.presets)
      ? handoffOptionsResponse.json.presets.flatMap((preset) => preset.roleCodes || [])
      : [];
    assert(
      handoffUsers.some((user) => Number(user.id) === existingUserId),
      "Bootstrap handoff options should list the existing active tenant user"
    );
    assert(
      !handoffPresetRoleCodes.includes("PeriodCloseSupervisorAuthority"),
      "Bootstrap handoff presets should not expose centrally managed PeriodCloseSupervisorAuthority"
    );

    const legalEntityCode = `LE${String(stamp).slice(-6)}`;
    const invitedUserEmail = `prf13_invited_${stamp}@example.com`;
    const bootstrapResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap",
      expectedStatus: 201,
      body: {
        groupCompany: {
          code: `GC${String(stamp).slice(-6)}`,
          name: `PRF13 Group ${stamp}`,
        },
        fiscalCalendar: {
          code: "MAIN",
          name: "Main Calendar",
          yearStartMonth: 1,
          yearStartDay: 1,
        },
        fiscalYear: 2026,
        legalEntities: [
          {
            code: legalEntityCode,
            name: "Bootstrap Handoff Entity",
            countryIso2: "US",
            functionalCurrencyCode: "USD",
            branches: [{ code: "HQ", name: "Headquarters" }],
          },
        ],
        handoffAssignments: [
          {
            presetCode: "EntityAPController",
            scopeType: "LEGAL_ENTITY",
            legalEntityCode,
            email: invitedUserEmail,
            name: "Invited Entity Setup Lead",
          },
          {
            presetCode: "CountryAPApprover",
            scopeType: "COUNTRY",
            countryIso2: "US",
            userId: existingUserId,
            includeGlPostingAuthority: true,
          },
        ],
      },
    });

    const handoffSummary = bootstrapResponse.json?.handoff || {};
    assert(
      Number(handoffSummary.assignmentCount) === 2,
      "Bootstrap response should summarize both handoff assignments"
    );
    assert(
      Number(handoffSummary.invitedCount) === 1 &&
        Number(handoffSummary.existingUserCount) === 1,
      "Bootstrap response should separate invited and existing handoff assignees"
    );

    const legalEntityId = Number(
      bootstrapResponse.json?.legalEntities?.[0]?.legalEntityId || 0
    );
    assert(legalEntityId > 0, "Bootstrap should return the created legal entity id");

    const invitedAssignment =
      (handoffSummary.assignments || []).find(
        (assignment) => assignment.email === invitedUserEmail
      ) || null;
    assert(invitedAssignment, "Bootstrap handoff summary should include invited entity lead");
    assert(
      invitedAssignment.presetCode === "EntityAPController",
      "Bootstrap handoff summary should return the canonical entity preset code"
    );

    const countryAssignment =
      (handoffSummary.assignments || []).find(
        (assignment) =>
          Number(assignment.userId) === existingUserId &&
          String(assignment.scopeType || "").toUpperCase() === "COUNTRY"
      ) || null;
    assert(
      countryAssignment && countryAssignment.includeGlPostingAuthority === true,
      "Bootstrap handoff summary should include the explicit country GL posting companion"
    );
    assert(
      countryAssignment?.presetCode === "CountryAPApprover",
      "Bootstrap handoff summary should return the canonical country preset code"
    );

    const invitedUserId = Number(invitedAssignment.userId || 0);
    assert(invitedUserId > 0, "Invited handoff user id should be returned");

    const entityRoleCodes = await fetchAssignedRoleCodes({
      tenantId: admin.tenantId,
      userId: invitedUserId,
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    });
    assertIncludesAll(
      entityRoleCodes,
      [
        "LocalUserAdmin",
        "MasterDataSteward",
        "APApprover",
        "GLOperator",
        "TreasuryOperator",
        "PayrollOperator",
        "LocalClosePreparer",
        "ShareholderCapitalOperator",
      ],
      "Entity handoff should grant the bounded entity setup preset roles"
    );
    assert(
      !entityRoleCodes.includes("GLPostingAuthority"),
      "Entity handoff should not silently grant GLPostingAuthority"
    );

    const countryIdResult = await query(
      `SELECT id
       FROM countries
       WHERE iso2 = 'US'
       LIMIT 1`
    );
    const countryId = Number(countryIdResult.rows?.[0]?.id || 0);
    assert(countryId > 0, "US country id should exist for country-scoped handoff verification");

    const countryRoleCodes = await fetchAssignedRoleCodes({
      tenantId: admin.tenantId,
      userId: existingUserId,
      scopeType: "COUNTRY",
      scopeId: countryId,
    });
    assertIncludesAll(
      countryRoleCodes,
      [
        "CountryAPApprover",
        "CountryAPPoster",
        "APApprover",
        "GLOperator",
        "TreasuryApprover",
        "PayrollApprover",
        "LocalCloseReviewer",
        "GLPostingAuthority",
      ],
      "Country handoff should grant the review preset plus explicit GLPostingAuthority"
    );
    assert(
      !countryRoleCodes.includes("LocalUserAdmin") &&
        !countryRoleCodes.includes("MasterDataSteward"),
      "Country handoff should not over-grant local setup admin roles"
    );

    console.log("PR-F13 bootstrap handoff smoke passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: admin.tenantId,
          legalEntityId,
          existingUserId,
          invitedUserId,
          handoffAssignmentCount: handoffSummary.assignmentCount,
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill();
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
