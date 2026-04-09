import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_SCRIPTS = Object.freeze([
  "test-workflows-amx01-routing-matrix.js",
  "test-workflows-amx02-assignment-resolution.js",
  "test-workflows-amx03-ap-gate-integration.js",
  "test-workflows-amx04-policy-snapshot-alignment.js",
  "test-cari-workflow-explainability-frontend-smoke.js",
  "test-security-ui4b-ap-runtime-explainability.js",
  "test-workflows-amx07-routing-hardening.js",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runNodeScript(scriptName, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn("node", [path.join("scripts", scriptName)], {
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
      reject(new Error(`node scripts/${scriptName} failed with exit code ${code}`));
    });
  });
}

function assertPackageScripts(packageSource) {
  const pkg = JSON.parse(packageSource);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};

  assert(
    scripts["test:workflows:amx07"] === "node scripts/test-workflows-amx07-release-gate.js",
    "backend/package.json missing test:workflows:amx07 script"
  );
  assert(
    String(scripts["test:cari-quality-gate"] || "").includes("test:workflows:amx07"),
    "test:cari-quality-gate must include test:workflows:amx07"
  );
}

async function main() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageSource = await readFile(path.resolve(backendRoot, "package.json"), "utf8");
  assertPackageScripts(packageSource);

  for (const scriptName of REQUIRED_NODE_SCRIPTS) {
    // eslint-disable-next-line no-await-in-loop
    await runNodeScript(scriptName, backendRoot);
  }

  console.log("AMX07 routing release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
