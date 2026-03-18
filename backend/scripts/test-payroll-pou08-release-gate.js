import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScriptChain } from "./_run-script-chain.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertReleaseGateWiring() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");

  const packageSource = await readFile(path.resolve(backendRoot, "package.json"), "utf8");
  const scripts = JSON.parse(packageSource)?.scripts || {};
  const payrollReleaseGate = String(scripts["test:payroll:release-gate"] || "");
  assert(
    payrollReleaseGate.includes("npm run test:payroll:pou08-release-gate"),
    "package.json must wire test:payroll:pou08-release-gate into test:payroll:release-gate"
  );

  const bankPayrollFixturesSource = await readFile(
    path.resolve(backendRoot, "scripts/fixtures/bank-payroll-e2e-fixtures.js"),
    "utf8"
  );
  assert(
    bankPayrollFixturesSource.includes('"test:payroll:release-gate"'),
    "Bank/payroll release gate must execute test:payroll:release-gate"
  );
}

async function main() {
  await runScriptChain({
    title: "PR-POU08 payroll ownership/settlement release-gate chain",
    scripts: [
      "test-payroll-pou01-employee-ownership-foundation.js",
      "test-payroll-pou02-run-line-ownership-snapshot.js",
      "test-payroll-pou03-finalize-ownership-validation.js",
      "test-payroll-prp02-accrual-posting.js",
      "test-payroll-prp03-liabilities-payment-prep.js",
      "test-payroll-pou07-settlement-self-balancing.js",
      "test-payroll-prp04-payment-settlement-sync.js",
      "test-payroll-prp08-close-controls-checklist-locks.js",
    ],
  });
  await assertReleaseGateWiring();

  console.log("PR-POU08 payroll release-gate checks passed.");
}

main().catch((error) => {
  console.error("PR-POU08 payroll release-gate checks failed.");
  console.error(error);
  process.exitCode = 1;
});
