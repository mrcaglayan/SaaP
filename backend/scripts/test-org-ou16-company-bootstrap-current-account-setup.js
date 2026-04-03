import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.ORG_OU16_TEST_PORT || 3142);
const BASE_URL = process.env.ORG_OU16_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

function buildDefaultAccounts() {
  return [
    {
      code: "132",
      name: "Due From Branches",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    },
    {
      code: "339",
      name: "Due To Branches",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: true,
    },
  ];
}

function buildCompanyBootstrapPayload({
  stamp,
  legalEntityCode,
  legalEntityName,
  branches,
  currentAccountConfig = null,
}) {
  return {
    groupCompany: {
      code: `OU16GC${stamp}`,
      name: `OU16 Group ${stamp}`,
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
        name: legalEntityName,
        countryIso2: "US",
        functionalCurrencyCode: "USD",
        coaCode: `COA-${legalEntityCode}`,
        coaName: `${legalEntityName} CoA`,
        bookCode: `BOOK-${legalEntityCode}`,
        bookName: `${legalEntityName} Book`,
        defaultAccounts: buildDefaultAccounts(),
        branches,
        ...(currentAccountConfig ? { currentAccountConfig } : {}),
      },
    ],
  };
}

async function createBootstrapAdminSession(stamp, suffix) {
  const email = `ou16_${suffix}_${stamp}@example.com`;
  const password = "OU16Bootstrap#12345";
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `OU16_${suffix}_${stamp}`,
    tenantName: `OU16 ${suffix} ${stamp}`,
    adminEmail: email,
    adminPassword: password,
  });
  return {
    tenantId: identity.tenantId,
    email,
    password,
  };
}

async function fetchCurrentAccountConfigRow(tenantId, legalEntityId) {
  const result = await query(
    `SELECT
       cfg.tenant_id,
       cfg.legal_entity_id,
       cfg.due_from_parent_account_id,
       cfg.due_to_parent_account_id,
       cfg.auto_provision_on_operating_unit_create,
       cfg.last_applied_at,
       dfa.code AS due_from_parent_account_code,
       dta.code AS due_to_parent_account_code
     FROM operating_unit_current_account_configs cfg
     JOIN accounts dfa ON dfa.id = cfg.due_from_parent_account_id
     JOIN accounts dta ON dta.id = cfg.due_to_parent_account_id
     WHERE cfg.tenant_id = ?
       AND cfg.legal_entity_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  return result.rows?.[0] || null;
}

async function countOperatingUnitPartnerMappings(tenantId, legalEntityId) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
     FROM operating_unit_partner_current_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?`,
    [tenantId, legalEntityId]
  );
  return toNumber(result.rows?.[0]?.row_count);
}

async function countProvisionedChildrenUnderCodes(tenantId, legalEntityId, parentCodes) {
  const placeholders = parentCodes.map(() => "?").join(", ");
  const result = await query(
    `SELECT COUNT(*) AS row_count
     FROM accounts child
     JOIN accounts parent ON parent.id = child.parent_account_id
     JOIN charts_of_accounts coa ON coa.id = child.coa_id
     WHERE coa.tenant_id = ?
       AND coa.legal_entity_id = ?
       AND parent.code IN (${placeholders})`,
    [tenantId, legalEntityId, ...parentCodes]
  );
  return toNumber(result.rows?.[0]?.row_count);
}

async function fetchParentPostingStateByCodes(tenantId, legalEntityId, codes) {
  const placeholders = codes.map(() => "?").join(", ");
  const result = await query(
    `SELECT code, allow_posting
     FROM accounts
     WHERE coa_id IN (
       SELECT id
       FROM charts_of_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
     )
       AND code IN (${placeholders})
     ORDER BY code`,
    [tenantId, legalEntityId, ...codes]
  );
  return result.rows || [];
}

async function countLegalEntitiesByCode(tenantId, code) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?`,
    [tenantId, code]
  );
  return toNumber(result.rows?.[0]?.row_count);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const onboardingPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/CompanyOnboardingPage.jsx"),
    "utf8"
  );
  const onboardingApiSource = await readFile(
    path.resolve(root, "frontend/src/api/onboarding.js"),
    "utf8"
  );
  const onboardingRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/onboarding.js"),
    "utf8"
  );

  assert(
    onboardingPageSource.includes('key: "currentAccounts"') &&
      onboardingPageSource.includes("previewCompanyBootstrapCurrentAccountEligibility") &&
      onboardingPageSource.includes("currentAccountEligibilityRows"),
    "Company onboarding wizard must include the current-accounts step and consume backend eligibility preview"
  );
  assert(
    onboardingApiSource.includes(
      "/api/v1/onboarding/company-bootstrap/current-account-eligibility-preview"
    ),
    "Onboarding API helper must expose the current-account eligibility preview route"
  );
  assert(
    onboardingRouteSource.includes(
      '"/company-bootstrap/current-account-eligibility-preview"'
    ) &&
      onboardingRouteSource.includes("normalizeCompanyBootstrapCurrentAccountConfig") &&
      onboardingRouteSource.includes("applyOperatingUnitCurrentAccountConfigTx"),
    "Onboarding backend must preview eligibility and apply current-account config inside the bootstrap transaction"
  );

  const previewSeed = await createBootstrapAdminSession(Date.now(), "preview");
  const configuredStamp = Date.now();
  const configuredSeed = await createBootstrapAdminSession(configuredStamp, "configured");
  const skippedStamp = Date.now();
  const skippedSeed = await createBootstrapAdminSession(skippedStamp, "skipped");
  const staleStamp = Date.now();
  const staleSeed = await createBootstrapAdminSession(staleStamp, "stale");

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });

    const previewSession = {
      ...previewSeed,
      token: await login({
        baseUrl: BASE_URL,
        email: previewSeed.email,
        password: previewSeed.password,
      }),
    };
    const previewResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: previewSession.token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap/current-account-eligibility-preview",
      body: {
        legalEntities: [
          {
            code: "LE_ONE",
            name: "Entity One",
            branches: [{ code: "HQ", name: "Head Office" }],
          },
          {
            code: "LE_TWO",
            name: "Entity Two",
            branches: [
              { code: "A", name: "Branch A" },
              { code: "B", name: "Branch B" },
            ],
          },
        ],
      },
      expectedStatus: 200,
    });
    const previewRows = Array.isArray(previewResponse.json?.rows)
      ? previewResponse.json.rows
      : [];
    assert(previewRows.length === 2, "Preview should return one eligibility row per draft legal entity");
    assert(
      toNumber(previewRows[0]?.effectiveActiveOperatingUnitCount) === 1 &&
        previewRows[0]?.currentAccountSetupRecommended === false,
      "Preview should treat one active branch as optional current-account setup"
    );
    assert(
      toNumber(previewRows[1]?.effectiveActiveOperatingUnitCount) === 2 &&
        previewRows[1]?.currentAccountSetupRecommended === true,
      "Preview should mark multi-branch draft legal entities as recommended for current-account setup"
    );

    const configuredSession = {
      ...configuredSeed,
      token: await login({
        baseUrl: BASE_URL,
        email: configuredSeed.email,
        password: configuredSeed.password,
      }),
    };
    const configuredPayload = buildCompanyBootstrapPayload({
      stamp: configuredStamp,
      legalEntityCode: `OU16LECFG${configuredStamp}`,
      legalEntityName: `OU16 Configured ${configuredStamp}`,
      branches: [
        {
          code: "BRA",
          name: "Branch A",
          unitType: "BRANCH",
          hasSubledger: true,
        },
        {
          code: "BRB",
          name: "Branch B",
          unitType: "BRANCH",
          hasSubledger: true,
        },
      ],
      currentAccountConfig: {
        dueFromParentAccountCode: "132",
        dueToParentAccountCode: "339",
      },
    });
    const configuredBootstrap = await apiRequest({
      baseUrl: BASE_URL,
      token: configuredSession.token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap",
      body: configuredPayload,
      expectedStatus: 201,
    });
    const configuredEntity = configuredBootstrap.json?.legalEntities?.[0] || null;
    const configuredLegalEntityId = toNumber(configuredEntity?.legalEntityId);
    assert(configuredLegalEntityId > 0, "Configured bootstrap should return legalEntityId");
    assert(
      configuredEntity?.currentAccountSetup?.configured === true,
      "Configured bootstrap should report applied current-account setup"
    );
    assert(
      toNumber(
        configuredEntity?.currentAccountSetup?.provisioningSummary?.createdAccountCount
      ) === 12,
      "Configured bootstrap should create 12 current-account children for two branches"
    );
    assert(
      toNumber(
        configuredEntity?.currentAccountSetup?.provisioningSummary?.updatedOperatingUnitCount
      ) === 2,
      "Configured bootstrap should update both operating-unit central mapping rows"
    );
    assert(
      toNumber(
        configuredEntity?.currentAccountSetup?.provisioningSummary?.updatedPartnerMappingCount
      ) === 2,
      "Configured bootstrap should create both directional partner mappings"
    );
    const configuredConfigRow = await fetchCurrentAccountConfigRow(
      configuredSession.tenantId,
      configuredLegalEntityId
    );
    assert(
      configuredConfigRow?.due_from_parent_account_code === "132" &&
        configuredConfigRow?.due_to_parent_account_code === "339",
      "Configured bootstrap should resolve parent account codes to persisted DB account ids"
    );
    assert(
      Boolean(configuredConfigRow?.last_applied_at),
      "Configured bootstrap should update last_applied_at after successful apply"
    );
    assert(
      await countOperatingUnitPartnerMappings(
        configuredSession.tenantId,
        configuredLegalEntityId
      ) === 2,
      "Configured bootstrap should persist both partner directions for two branches"
    );
    assert(
      await countProvisionedChildrenUnderCodes(
        configuredSession.tenantId,
        configuredLegalEntityId,
        ["132", "339"]
      ) === 12,
      "Configured bootstrap should persist all expected provisioned child accounts under the selected parent codes"
    );
    const configuredParentRows = await fetchParentPostingStateByCodes(
      configuredSession.tenantId,
      configuredLegalEntityId,
      ["132", "339"]
    );
    assert(
      configuredParentRows.length === 2 &&
        configuredParentRows.every(
          (row) => row?.allow_posting === false || row?.allow_posting === 0
        ),
      "Configured bootstrap should flip selected posting parent codes to non-postable after provisioning"
    );

    const configuredReplay = await apiRequest({
      baseUrl: BASE_URL,
      token: configuredSession.token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap",
      body: configuredPayload,
      expectedStatus: 201,
    });
    const replaySummary =
      configuredReplay.json?.legalEntities?.[0]?.currentAccountSetup?.provisioningSummary || null;
    assert(
      toNumber(replaySummary?.createdAccountCount) === 0,
      "Bootstrap replay should be idempotent for current-account provisioning"
    );
    assert(
      toNumber(replaySummary?.reusedAccountCount) >= 12,
      "Bootstrap replay should report reused current-account children instead of recreating them"
    );

    const skippedSession = {
      ...skippedSeed,
      token: await login({
        baseUrl: BASE_URL,
        email: skippedSeed.email,
        password: skippedSeed.password,
      }),
    };
    const skippedPayload = buildCompanyBootstrapPayload({
      stamp: skippedStamp,
      legalEntityCode: `OU16LESKIP${skippedStamp}`,
      legalEntityName: `OU16 Skipped ${skippedStamp}`,
      branches: [
        {
          code: "BRA",
          name: "Branch A",
          unitType: "BRANCH",
          hasSubledger: true,
        },
        {
          code: "BRB",
          name: "Branch B",
          unitType: "BRANCH",
          hasSubledger: true,
        },
      ],
      currentAccountConfig: {
        skipForNow: true,
      },
    });
    const skippedBootstrap = await apiRequest({
      baseUrl: BASE_URL,
      token: skippedSession.token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap",
      body: skippedPayload,
      expectedStatus: 201,
    });
    const skippedEntity = skippedBootstrap.json?.legalEntities?.[0] || null;
    const skippedLegalEntityId = toNumber(skippedEntity?.legalEntityId);
    assert(
      skippedEntity?.currentAccountSetup?.skipped === true,
      "Skip path should mark current-account setup as skipped"
    );
    assert(
      Array.isArray(skippedBootstrap.json?.currentAccountReadinessWarnings) &&
        skippedBootstrap.json.currentAccountReadinessWarnings.length === 1,
      "Skip path should return one structured readiness warning"
    );
    assert(
      skippedBootstrap.json.currentAccountReadinessWarnings[0]?.code ===
        "CURRENT_ACCOUNT_SETUP_SKIPPED",
      "Skip path should surface the explicit skip warning code"
    );
    assert(
      (await fetchCurrentAccountConfigRow(skippedSession.tenantId, skippedLegalEntityId)) ===
        null,
      "Skip path should not persist a saved current-account config row"
    );

    const staleSession = {
      ...staleSeed,
      token: await login({
        baseUrl: BASE_URL,
        email: staleSeed.email,
        password: staleSeed.password,
      }),
    };
    const staleLegalEntityCode = `OU16LEBAD${staleStamp}`;
    const stalePayload = buildCompanyBootstrapPayload({
      stamp: staleStamp,
      legalEntityCode: staleLegalEntityCode,
      legalEntityName: `OU16 Bad ${staleStamp}`,
      branches: [
        {
          code: "BRA",
          name: "Branch A",
          unitType: "BRANCH",
          hasSubledger: true,
        },
        {
          code: "BRB",
          name: "Branch B",
          unitType: "BRANCH",
          hasSubledger: true,
        },
      ],
      currentAccountConfig: {
        dueFromParentAccountCode: "MISSING_132",
        dueToParentAccountCode: "339",
      },
    });
    const staleBootstrap = await apiRequest({
      baseUrl: BASE_URL,
      token: staleSession.token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap",
      body: stalePayload,
      expectedStatus: 400,
    });
    assert(
      String(staleBootstrap.json?.message || "").includes(
        "currentAccountConfig.dueFromParentAccountCode could not be resolved"
      ),
      "Bootstrap should reject stale parent account codes with a clear validation message"
    );
    assert(
      (await countLegalEntitiesByCode(staleSession.tenantId, staleLegalEntityCode)) === 0,
      "Failed bootstrap should roll the legal-entity insert back with the rest of the transaction"
    );

    console.log("OU16 company bootstrap current-account setup checks passed.");
    console.log(
      JSON.stringify(
        {
          previewRows: previewRows.map((row) => ({
            legalEntityCode: row.legalEntityCode,
            effectiveActiveOperatingUnitCount: row.effectiveActiveOperatingUnitCount,
            currentAccountSetupRecommended: row.currentAccountSetupRecommended,
          })),
          configuredLegalEntityId,
          configuredCreatedAccounts:
            configuredEntity?.currentAccountSetup?.provisioningSummary?.createdAccountCount,
          replayCreatedAccounts: replaySummary?.createdAccountCount,
          skippedWarningCode:
            skippedBootstrap.json?.currentAccountReadinessWarnings?.[0]?.code || null,
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
    await sleep(500);
    await closePool();
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("OU16 company bootstrap current-account setup test failed.");
    console.error(error);
    process.exitCode = 1;
  });
