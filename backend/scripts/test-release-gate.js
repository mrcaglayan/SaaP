import { spawn } from "node:child_process";

const CORE_SCRIPT = "test:release-gate:core";
const CONTRACTS_REVENUE_SCRIPT = "test:contracts-revenue-gate";
const BANK_PAYROLL_SCRIPT = "test:e2e:bank-payroll";
const SKIP_CONTRACTS_REVENUE_ENV = "RELEASE_GATE_SKIP_CONTRACTS_REVENUE";
const SKIP_BANK_PAYROLL_ENV = "RELEASE_GATE_SKIP_BANK_PAYROLL";

function isTruthy(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

async function runNpmScript(scriptName) {
  await new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], {
          cwd: process.cwd(),
          env: { ...process.env },
          stdio: "inherit",
        })
      : spawn("npm", ["run", scriptName], {
          cwd: process.cwd(),
          env: { ...process.env },
          stdio: "inherit",
        });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm run ${scriptName} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const skipContractsRevenue = isTruthy(process.env[SKIP_CONTRACTS_REVENUE_ENV]);
  const skipBankPayroll = isTruthy(process.env[SKIP_BANK_PAYROLL_ENV]);

  console.log("Starting release gate...");
  await runNpmScript(CORE_SCRIPT);

  if (skipContractsRevenue) {
    console.log(
      `Skipping ${CONTRACTS_REVENUE_SCRIPT} because ${SKIP_CONTRACTS_REVENUE_ENV} is set.`
    );
  } else {
    await runNpmScript(CONTRACTS_REVENUE_SCRIPT);
  }

  if (skipBankPayroll) {
    console.log(`Skipping ${BANK_PAYROLL_SCRIPT} because ${SKIP_BANK_PAYROLL_ENV} is set.`);
  } else {
    await runNpmScript(BANK_PAYROLL_SCRIPT);
  }

  console.log("Release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
