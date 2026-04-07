import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_SCRIPTS = Object.freeze([
  "test-followup-prf06-workflow-decisions-runtime.js",
  "test-cari-pr27-governed-ap-review-states.js",
  "test-cari-pr29-ap-workflow-rollout-and-uat.js",
  "test-followup-prf13-bootstrap-handoff.js",
  "test-cari-workflow-explainability-frontend-smoke.js",
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
    scripts["test:cari:workflow-explainability-frontend"] ===
      "node scripts/test-cari-workflow-explainability-frontend-smoke.js",
    "backend/package.json missing test:cari:workflow-explainability-frontend script"
  );
  assert(
    scripts["test:cari:workflow-explainability-release-gate"] ===
      "node scripts/test-cari-workflow-explainability-release-gate.js",
    "backend/package.json missing test:cari:workflow-explainability-release-gate script"
  );
  assert(
    String(scripts["test:cari-quality-gate"] || "").includes(
      "test:cari:workflow-explainability-release-gate"
    ),
    "test:cari-quality-gate must include test:cari:workflow-explainability-release-gate"
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

  console.log("CARI workflow explainability release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
