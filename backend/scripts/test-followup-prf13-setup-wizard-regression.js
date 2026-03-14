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
      onboardingPageSource.includes("activeStep.key === \"currentAccounts\""),
    "Setup wizard should render dedicated account-tree, branch, and current-account steps"
  );

  assert(
    onboardingPageSource.includes("policyPackId") &&
      onboardingPageSource.includes("parentCode") &&
      onboardingPageSource.includes("compactEntityPayload") &&
      onboardingPageSource.includes("groupCoa") &&
      onboardingPageSource.includes("currentAccountConfig"),
    "Setup wizard payload should include policyPackId, groupCoa, parentCode tree support, and currentAccountConfig"
  );

  const onboardingRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/onboarding.js"),
    "utf8"
  );

  assert(
    onboardingRouteSource.includes('"/company-bootstrap"') &&
      onboardingRouteSource.includes("normalizeEntityPolicyPackSelection") &&
      onboardingRouteSource.includes("applyPolicyPackTx"),
    "Onboarding backend should keep policy-pack bootstrap transaction integration"
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
