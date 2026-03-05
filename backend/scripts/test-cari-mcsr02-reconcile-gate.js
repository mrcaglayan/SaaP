import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readUtf8(relativePathFromBackend) {
  const absolutePath = path.resolve(process.cwd(), relativePathFromBackend);
  return readFile(absolutePath, "utf8");
}

function runHelpCommand(scriptFile) {
  const scriptPath = path.resolve(process.cwd(), "scripts", scriptFile);
  return spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf8",
  });
}

async function main() {
  const packageJsonSource = await readUtf8("package.json");
  const reconcileScriptSource = await readUtf8(
    "scripts/reconcile-cari-settlement-dual-currency.js"
  );

  assert(
    packageJsonSource.includes('"reconcile:cari:mcs01"'),
    "package.json must include reconcile:cari:mcs01 script"
  );

  const requiredCliOptions = [
    "--tenantId",
    "--legalEntityId",
    "--status",
    "--dateFrom",
    "--dateTo",
    "--failOnSuspicious",
    "--sampleLimit",
  ];
  for (const option of requiredCliOptions) {
    assert(
      reconcileScriptSource.includes(option),
      `Reconcile script must document CLI option ${option}`
    );
  }

  const requiredChecks = [
    "MISSING_METADATA",
    "PARITY_WITH_DIFFERENT_CURRENCIES",
    "PARITY_WITH_NON_ONE_RATE",
    "PARITY_WITH_AMOUNT_MISMATCH",
    "legacy_parity_signature_count",
  ];
  for (const check of requiredChecks) {
    assert(
      reconcileScriptSource.includes(check),
      `Reconcile script must include check token: ${check}`
    );
  }

  const helpRun = runHelpCommand("reconcile-cari-settlement-dual-currency.js");
  assert(helpRun.status === 0, "reconcile script --help must exit with code 0");
  const helpText = `${helpRun.stdout || ""}\n${helpRun.stderr || ""}`;
  assert(
    helpText.includes("Usage: node scripts/reconcile-cari-settlement-dual-currency.js"),
    "reconcile script --help output must include usage banner"
  );

  console.log("CARI MCSR02 reconcile gate smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
