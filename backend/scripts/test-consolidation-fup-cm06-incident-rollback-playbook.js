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

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/consolidation-canonical-preflight.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Incident + Rollback Playbook (FUP-CM06)"),
    "Runbook must include FUP-CM06 section"
  );
  assert(
    runbookSource.includes("/canonical-mappings/local") &&
      runbookSource.includes("/canonical-mappings/group") &&
      runbookSource.includes("POST /api/v1/consolidation/runs"),
    "FUP-CM06 runbook must include mapping correction and re-run endpoints"
  );
  assert(
    runbookSource.includes("ON DUPLICATE KEY UPDATE") &&
      runbookSource.includes("history is preserved through `audit_logs`"),
    "FUP-CM06 runbook must document in-place update model and audit trail behavior"
  );
  assert(
    runbookSource.includes("consolidation-canonical-execute-blocked-notice.md"),
    "FUP-CM06 runbook must reference finance communication template"
  );

  const templateSource = await readFile(
    path.resolve(
      root,
      "docs/templates/consolidation-canonical-execute-blocked-notice.md"
    ),
    "utf8"
  );
  assert(
    templateSource.includes("{{tenantId}}") &&
      templateSource.includes("{{groupId}}") &&
      templateSource.includes("{{runId}}") &&
      templateSource.includes("{{requestId}}"),
    "Finance blocked-execute template must include incident context placeholders"
  );
  assert(
    templateSource.includes("Reason") &&
      templateSource.includes("What we are doing") &&
      templateSource.includes("Recovery confirmation"),
    "Finance blocked-execute template must include reason, action, and recovery sections"
  );

  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageSource.includes('"test:ux:consolidation-fup-cm06"'),
    "backend/package.json must expose FUP-CM06 smoke script"
  );
  const releaseGateCoreMatch = packageSource.match(
    /"test:release-gate:core"\s*:\s*"([^"]+)"/
  );
  assert(releaseGateCoreMatch, "backend/package.json must define test:release-gate:core");
  assert(
    String(releaseGateCoreMatch?.[1] || "").includes(
      "npm run test:ux:consolidation-fup-cm06"
    ),
    "FUP-CM06 smoke test must be included in test:release-gate:core chain"
  );

  console.log("FUP-CM06 incident + rollback playbook checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
