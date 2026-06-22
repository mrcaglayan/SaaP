import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOVERNANCE_BACKEND_TESTS = Object.freeze([
  "test-authz-pr2a-explicit-scope-model.js",
  "test-authz-pr2c-temporal-role-assignments.js",
  "test-authz-pr2d-shared-scope-utils.js",
  "test-security-pr1d-permission-rules.js",
  "test-security-pr1e-period-close-split-guardrails.js",
  "test-workflows-pr3e-unified-migration.js",
  "test-approvals-pr3f-remaining-adhoc-migration.js",
  "test-cari-pr3c-unified-approval-pilot.js",
  "test-followup-prf06-workflow-decisions-runtime.js",
  "test-security-pr4a-duty-boundary-roles.js",
  "test-security-pr73-tax-configuration-rbac.js",
  "test-security-pr73-tax-configuration-runtime.js",
  "test-security-pr4b-sod-service-integration.js",
  "test-payments-prb04-batches.js",
  "test-payroll-prp06-partial-settlement-and-manual-override.js",
  "test-security-pr5a-field-visibility.js",
  "test-security-pr5b-access-debugger.js",
  "test-approvals-pr5c-escalation-engine.js",
  "test-approvals-pr5d-delegation.js",
  "test-approvals-ui5d-delegation-ux.js",
  "test-security-pr5e-compliance-audit-report-package.js",
  "test-security-pr6e-field-visibility-policy-admin.js",
  "test-security-branch-operator-management-smoke.js",
  "test-security-pr7d-temporary-operational-coverage.js",
  "test-consolidation-fup-cm02-rbac-parity.js",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCommand(command, args, cwd, label = command) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function runNpmScript(scriptName, cwd) {
  if (process.platform === "win32") {
    await runCommand(
      "cmd.exe",
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      cwd,
      `npm run ${scriptName}`
    );
    return;
  }
  await runCommand("npm", ["run", scriptName], cwd, `npm run ${scriptName}`);
}

async function runNodeScript(scriptName, cwd) {
  await runCommand("node", [path.join("scripts", scriptName)], cwd, `node scripts/${scriptName}`);
}

function assertPackageScripts(packageSource) {
  const pkg = JSON.parse(packageSource);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};

  assert(
    typeof scripts["test:security:governance-release-gate"] === "string",
    "package.json script missing: test:security:governance-release-gate"
  );
  assert(
    String(scripts["test:release-gate:core"] || "").includes(
      "test:security:governance-release-gate"
    ),
    "test:release-gate:core must include test:security:governance-release-gate"
  );
}

async function main() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(backendRoot, "..");
  const frontendRoot = path.resolve(repoRoot, "frontend");

  const packageSource = await readFile(path.resolve(backendRoot, "package.json"), "utf8");
  assertPackageScripts(packageSource);

  // This gate intentionally focuses on the governance redesign seam rather
  // than the repo's full product matrix.
  for (const scriptName of GOVERNANCE_BACKEND_TESTS) {
    // eslint-disable-next-line no-await-in-loop
    await runNodeScript(scriptName, backendRoot);
  }

  await runNpmScript("openapi:generate", backendRoot);
  await runNpmScript("check:openapi:parse", backendRoot);
  await runNpmScript("check:openapi", backendRoot);
  await runNpmScript("lint", frontendRoot);
  await runNpmScript("build", frontendRoot);

  console.log("Security governance release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
