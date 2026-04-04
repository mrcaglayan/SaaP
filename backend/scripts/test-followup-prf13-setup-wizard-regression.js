import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const onboardingPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/CompanyOnboardingPage.jsx"),
    "utf8"
  );

  for (const stepKey of [
    "country",
    "entity",
    "handoff",
    "template",
    "accountTree",
    "branches",
    "currentAccounts",
  ]) {
    assert(
      onboardingPageSource.includes(`key: "${stepKey}"`),
      `Setup wizard is missing step key: ${stepKey}`
    );
  }

  assert(
    onboardingPageSource.includes("activeStep.key === \"accountTree\"") &&
      onboardingPageSource.includes("activeStep.key === \"branches\"") &&
      onboardingPageSource.includes("activeStep.key === \"currentAccounts\"") &&
      onboardingPageSource.includes("activeStep.key === \"handoff\""),
    "Setup wizard should render dedicated handoff, account-tree, branch, and current-account steps"
  );

  assert(
    onboardingPageSource.includes("policyPackId") &&
      onboardingPageSource.includes("parentCode") &&
      onboardingPageSource.includes("compactEntityPayload") &&
      onboardingPageSource.includes("groupCoa") &&
      onboardingPageSource.includes("currentAccountConfig") &&
      onboardingPageSource.includes("handoffAssignments") &&
      onboardingPageSource.includes("getCompanyBootstrapHandoffOptions"),
    "Setup wizard payload should include policyPackId, groupCoa, parentCode tree support, currentAccountConfig, and bootstrap handoff payload support"
  );

  const onboardingRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/onboarding.js"),
    "utf8"
  );

  assert(
    onboardingRouteSource.includes('"/company-bootstrap"') &&
      onboardingRouteSource.includes('"/company-bootstrap/handoff-options"') &&
      onboardingRouteSource.includes("normalizeEntityPolicyPackSelection") &&
      onboardingRouteSource.includes("applyPolicyPackTx") &&
      onboardingRouteSource.includes("normalizeCompanyBootstrapHandoffAssignments") &&
      onboardingRouteSource.includes("createInviteForTenantUser") &&
      onboardingRouteSource.includes("getTenantRoleIdsByCode"),
    "Onboarding backend should keep policy-pack bootstrap transaction integration and bootstrap handoff processing"
  );

  assert(
    onboardingRouteSource.includes("defaultAccounts") &&
      onboardingRouteSource.includes("parentCode") &&
      onboardingRouteSource.includes("entity.default_accounts") &&
      onboardingRouteSource.includes("groupCoa"),
    "Onboarding backend should keep groupCoa + tree payload + backward compatibility support"
  );

  console.log("PR-F13 setup wizard regression checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
