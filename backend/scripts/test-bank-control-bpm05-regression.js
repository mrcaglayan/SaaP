import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runNodeScript(backendRoot, relativeScriptPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [relativeScriptPath], {
      cwd: backendRoot,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${relativeScriptPath} exited with code ${code}`));
    });
  });
}

function assertRunbookSections(runbookSource) {
  const requiredHeadings = [
    "## Tenant Audit Query",
    "## Backfill Sequence",
    "## Pilot Cohort",
    "## Compatibility And Sunset",
    "## Rollback Posture",
  ];
  for (const heading of requiredHeadings) {
    assert(runbookSource.includes(heading), `Runbook heading missing: ${heading}`);
  }

  const requiredTokens = [
    "BANK_CONTROL_PARENT",
    "FEATURE_SUBACCOUNTS_V1",
    "backfill:bank-control-parent",
    "/api/v1/bank/accounts/provision-control-parent-child",
    "/api/v1/bank/accounts/provision-102-child",
    "March 11, 2026",
    "GL Setup",
  ];
  for (const token of requiredTokens) {
    assert(runbookSource.includes(token), `Runbook token missing: ${token}`);
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const backendRoot = path.resolve(repoRoot, "backend");

  const [
    bankRouteSource,
    bankServiceSource,
    bankApiSource,
    glSetupSource,
    generateOpenapiSource,
    bpm02Source,
    bpm04Source,
    prh10Source,
    runbookSource,
    packageJsonSource,
  ] = await Promise.all([
    readFile(path.resolve(repoRoot, "backend/src/routes/bank.accounts.routes.js"), "utf8"),
    readFile(path.resolve(repoRoot, "backend/src/services/bank.accounts.service.js"), "utf8"),
    readFile(path.resolve(repoRoot, "frontend/src/api/bankAccounts.js"), "utf8"),
    readFile(path.resolve(repoRoot, "frontend/src/pages/settings/GlSetupPage.jsx"), "utf8"),
    readFile(path.resolve(repoRoot, "backend/scripts/generate-openapi.js"), "utf8"),
    readFile(
      path.resolve(repoRoot, "backend/scripts/test-bank-control-bpm02-service-cutover.js"),
      "utf8"
    ),
    readFile(
      path.resolve(repoRoot, "backend/scripts/test-bank-control-bpm04-policy-pack-backfill.js"),
      "utf8"
    ),
    readFile(
      path.resolve(repoRoot, "backend/scripts/test-hardening-prh10-bank-provisioning.js"),
      "utf8"
    ),
    readFile(path.resolve(repoRoot, "docs/runbooks/bank-control-parent-rollout.md"), "utf8"),
    readFile(path.resolve(repoRoot, "backend/package.json"), "utf8"),
  ]);

  const packageJson = JSON.parse(packageJsonSource);

  assert(
    bankRouteSource.includes('"/provision-control-parent-child"') &&
      !bankRouteSource.includes('"/provision-102-child"') &&
      bankRouteSource.includes("BANK_PROVISION_CONTROL_PARENT_CHILD"),
    "Bank route must expose only the neutral control-parent provisioning endpoint"
  );
  assert(
    bankServiceSource.includes("provisionBankAccountWithControlParentChild") &&
      !bankServiceSource.includes("provisionBankAccountWith102Child"),
    "Bank service should not expose deprecated 102 provisioning alias"
  );
  assert(
    bankApiSource.includes("provisionBankAccountControlParentChild") &&
      !bankApiSource.includes("provisionBankAccount102Child"),
    "Frontend bank API should not expose deprecated 102 wrapper"
  );
  assert(
    !generateOpenapiSource.includes("provision-102-child"),
    "OpenAPI generator should not carry deprecated 102 alias cleanup logic"
  );
  assert(
    glSetupSource.includes("BANK_CONTROL_PARENT") &&
      glSetupSource.includes(
        "Example: map the active ASSET parent that should own bank child accounts."
      ) &&
      !glSetupSource.includes("Example: map 102, 1000"),
    "GL Setup BANK helper copy should describe the mapped control parent without literal 102 guidance"
  );

  assert(
    bpm02Source.includes('"1000"') && bpm02Source.includes("BANK_CONTROL_PARENT"),
    "BPM02 regression coverage must include a non-102 mapped parent path"
  );
  assert(
    bpm04Source.includes("TR_UNIFORM_V1") &&
      bpm04Source.includes("AF_STARTER_V1") &&
      bpm04Source.includes("US_GAAP_STARTER_V1"),
    "BPM04 regression coverage must include TR and non-TR policy-pack paths"
  );
  assert(
    prh10Source.includes("CONTROL_PARENT_CODE") &&
      prh10Source.includes("mapped control parent"),
    "PRH10 hardening smoke should use neutral mapped control-parent terminology"
  );

  assertRunbookSections(runbookSource);

  assert(
    packageJson?.scripts?.["test:bank-control:bpm05"] ===
      "node scripts/test-bank-control-bpm05-regression.js",
    "backend/package.json missing test:bank-control:bpm05 script"
  );

  const scriptsToRun = [
    "scripts/test-bank-control-bpm01-purpose-mapping.js",
    "scripts/test-bank-control-bpm02-service-cutover.js",
    "scripts/test-bank-control-bpm03-readiness-api.js",
    "scripts/test-bank-control-bpm03-frontend-smoke.js",
    "scripts/test-bank-control-bpm04-policy-pack-backfill.js",
    "scripts/test-hardening-prh10-bank-provisioning.js",
    "scripts/test-followup-prf13-cross-track-idempotency.js",
  ];

  for (const scriptPath of scriptsToRun) {
    // Keep the regression chain explicit so failures point to the underlying slice.
    // eslint-disable-next-line no-await-in-loop
    await runNodeScript(backendRoot, scriptPath);
  }

  console.log("test-bank-control-bpm05-regression: OK");
}

main().catch((error) => {
  console.error("test-bank-control-bpm05-regression: FAILED");
  console.error(error);
  process.exit(1);
});
