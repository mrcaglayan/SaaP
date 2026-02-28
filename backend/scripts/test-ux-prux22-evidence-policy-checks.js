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
  const policyServiceSource = await readFile(
    path.resolve(root, "backend/src/services/evidence.policy.service.js"),
    "utf8"
  );
  const documentRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.routes.js"),
    "utf8"
  );
  const envExampleSource = await readFile(
    path.resolve(root, "backend/.env.example"),
    "utf8"
  );

  assert(
    policyServiceSource.includes("assertEvidencePolicyForCariDocumentAction") &&
      policyServiceSource.includes("EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST") &&
      policyServiceSource.includes("EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_REVERSE") &&
      policyServiceSource.includes("EVIDENCE_REQUIRED") &&
      policyServiceSource.includes("EVIDENCE_POLICY_MODE") &&
      policyServiceSource.includes("EVIDENCE_POLICY_RISKY_POST_AMOUNT_BASE_MIN"),
    "Evidence policy service should expose CARI action checks with env-driven risky policy rules"
  );

  assert(
    documentRouteSource.includes("assertEvidencePolicyForCariDocumentAction") &&
      documentRouteSource.includes("EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST") &&
      documentRouteSource.includes("EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_REVERSE") &&
      documentRouteSource.includes("actionCode: EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_POST") &&
      documentRouteSource.includes("actionCode: EVIDENCE_POLICY_ACTION_CARI_DOCUMENT_REVERSE"),
    "CARI document post/reverse routes should enforce evidence policy checks before mutations"
  );

  assert(
    envExampleSource.includes("EVIDENCE_POLICY_MODE") &&
      envExampleSource.includes("EVIDENCE_POLICY_RISKY_POST_AMOUNT_BASE_MIN"),
    "backend/.env.example should declare evidence policy controls"
  );

  console.log(
    "PR-UX22 smoke test passed (risk-action evidence policy wiring on CARI post/reverse)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

