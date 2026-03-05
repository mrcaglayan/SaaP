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

  const serviceSource = await readFile(
    path.resolve(
      root,
      "backend/src/services/consolidation.canonical-mappings.service.js"
    ),
    "utf8"
  );
  assert(
    serviceSource.includes("function buildSemanticWarnings"),
    "canonical mapping service must include semantic warning checks"
  );
  assert(
    serviceSource.includes("ACCOUNT_TYPE_MISMATCH") &&
      serviceSource.includes("NORMAL_SIDE_MISMATCH") &&
      serviceSource.includes("SUSPICIOUS_NAME_MISMATCH"),
    "canonical mapping service semantic warning codes are incomplete"
  );
  assert(
    serviceSource.includes("requireHighRiskReasonIfNeeded") &&
      serviceSource.includes("HIGH_RISK_REMAP_REASON_REQUIRED") &&
      serviceSource.includes("HIGH_RISK_SAFE_APPLY_REASON_REQUIRED"),
    "canonical mapping service must enforce reason for high-risk remap/apply flows"
  );
  assert(
    serviceSource.includes("insertCanonicalMappingAuditLog") &&
      serviceSource.includes("consolidation.canonical_mapping.candidates.apply"),
    "canonical mapping service must emit audit log entries for mapping changes/apply"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes("buildAuditRequestMeta") &&
      routeSource.includes("changeReason: req.body?.reason") &&
      routeSource.includes("changeSource: req.body?.source"),
    "consolidation routes must pass reason/source audit metadata to mapping service"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("canonicalCandidateReason"),
    "ConsolidationSetupPage must keep candidate apply reason state"
  );
  assert(
    setupPageSource.includes("semanticWarnings") &&
      setupPageSource.includes("HIGH_RISK"),
    "ConsolidationSetupPage must render semantic risk warning badges"
  );
  assert(
    setupPageSource.includes("Reason/note (required for high-risk remap)") &&
      setupPageSource.includes(
        "Apply reason (required when SAFE rows have high-risk semantic warnings)"
      ),
    "ConsolidationSetupPage must collect reasons for high-risk remaps and candidate apply"
  );

  console.log("PR-CM05 semantic quality + governance smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

