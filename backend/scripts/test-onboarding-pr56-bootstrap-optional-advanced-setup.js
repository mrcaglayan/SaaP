import { closePool } from "../src/db.js";
import {
  apiRequest,
  assert,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.PR56_BOOTSTRAP_OPTIONAL_ADVANCED_SETUP_PORT || 3153);
const BASE_URL =
  process.env.PR56_BOOTSTRAP_OPTIONAL_ADVANCED_SETUP_BASE_URL ||
  `http://127.0.0.1:${PORT}`;

function findActivationCheck(entityRow, key) {
  return (
    (Array.isArray(entityRow?.checks) ? entityRow.checks : []).find(
      (check) => String(check?.key || "").trim() === key,
    ) || null
  );
}

async function main() {
  const stamp = Date.now();
  const adminEmail = `pr56_bootstrap_${stamp}@example.com`;
  const adminPassword = "PR56Bootstrap#12345";
  await seedAndCreateBootstrapAdmin({
    tenantCode: `PR56_BOOTSTRAP_${stamp}`,
    tenantName: `PR56 Bootstrap ${stamp}`,
    adminEmail,
    adminPassword,
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: adminPassword,
    });

    const legalEntityCode = `US${String(stamp).slice(-6)}`;
    const bootstrapResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/onboarding/company-bootstrap",
      expectedStatus: 201,
      body: {
        groupCompany: {
          code: `GC${String(stamp).slice(-6)}`,
          name: `PR56 Group ${stamp}`,
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
            name: "PR56 Optional Advanced Setup Entity",
            countryIso2: "US",
            functionalCurrencyCode: "USD",
            policyPackId: "US_GAAP_STARTER_V1",
            defaultAccounts: [
              {
                code: "1000",
                name: "Cash and Cash Equivalents",
                accountType: "ASSET",
                normalSide: "DEBIT",
                allowPosting: true,
              },
              {
                code: "1100",
                name: "Accounts Receivable",
                accountType: "ASSET",
                normalSide: "DEBIT",
                allowPosting: true,
              },
              {
                code: "1150",
                name: "Cash and Bank",
                accountType: "ASSET",
                normalSide: "DEBIT",
                allowPosting: false,
              },
              {
                code: "2000",
                name: "Accounts Payable",
                accountType: "LIABILITY",
                normalSide: "CREDIT",
                allowPosting: true,
              },
              {
                code: "3000",
                name: "Retained Earnings",
                accountType: "EQUITY",
                normalSide: "CREDIT",
                allowPosting: true,
              },
              {
                code: "4000",
                name: "Revenue",
                accountType: "REVENUE",
                normalSide: "CREDIT",
                allowPosting: true,
              },
              {
                code: "4050",
                name: "Foreign Exchange Gain",
                accountType: "REVENUE",
                normalSide: "CREDIT",
                allowPosting: true,
              },
              {
                code: "5000",
                name: "Operating Expense",
                accountType: "EXPENSE",
                normalSide: "DEBIT",
                allowPosting: true,
              },
              {
                code: "7050",
                name: "Foreign Exchange Loss",
                accountType: "EXPENSE",
                normalSide: "DEBIT",
                allowPosting: true,
              },
            ],
            branches: [
              { code: "HQ", name: "Headquarters", unitType: "BRANCH", hasSubledger: true },
              { code: "OPS", name: "Operations", unitType: "BRANCH", hasSubledger: true },
            ],
          },
        ],
      },
    });

    const legalEntity = bootstrapResponse.json?.legalEntities?.[0] || null;
    const legalEntityId = Number(legalEntity?.legalEntityId || 0);
    assert(legalEntityId > 0, "Bootstrap should return the created legal entity id");
    assert(
      legalEntity?.shareholderParentSetup?.configured === false,
      "Bootstrap should allow shareholder parent setup to remain deferred",
    );
    assert(
      legalEntity?.currentAccountSetup?.configured === false,
      "Bootstrap should allow current-account setup to remain deferred",
    );
    assert(
      Array.isArray(bootstrapResponse.json?.currentAccountReadinessWarnings) &&
        bootstrapResponse.json.currentAccountReadinessWarnings.length === 1,
      "Deferred multi-branch current-account setup should return one activation-stage warning",
    );
    assert(
      String(
        bootstrapResponse.json?.currentAccountReadinessWarnings?.[0]?.message || "",
      ).includes("legal-entity activation remains incomplete"),
      "Deferred current-account warning should point to legal-entity activation, not tenant readiness",
    );

    const readinessResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: "/api/v1/onboarding/readiness",
      expectedStatus: 200,
    });
    assert(
      readinessResponse.json?.ready === true,
      "Tenant bootstrap readiness should turn green even when advanced local setup is deferred",
    );

    const activationResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "GET",
      requestPath: `/api/v1/onboarding/legal-entity-activation?legalEntityId=${legalEntityId}`,
      expectedStatus: 200,
    });
    const activationEntity =
      Array.isArray(activationResponse.json?.byLegalEntity) &&
      activationResponse.json.byLegalEntity.length > 0
        ? activationResponse.json.byLegalEntity[0]
        : null;
    assert(activationEntity, "Activation API should return the bootstrapped legal entity");
    assert(
      activationEntity.ready === false,
      "Deferred advanced local setup should remain visible in legal-entity activation",
    );
    assert(
      findActivationCheck(activationEntity, "shareholderActivation")?.ready === false,
      "Shareholder activation should remain blocked until local setup is completed later",
    );
    assert(
      findActivationCheck(activationEntity, "operatingUnitCurrentAccounts")?.ready === false,
      "Current-account activation should remain blocked until local setup is completed later",
    );

    console.log("PR-56 PR-4 bootstrap optional advanced setup smoke passed.");
  } finally {
    if (!serverStopped) {
      server.kill();
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error("test-onboarding-pr56-bootstrap-optional-advanced-setup failed");
  console.error(error);
  process.exit(1);
});
