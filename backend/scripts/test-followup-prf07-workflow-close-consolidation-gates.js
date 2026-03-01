import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as workflows from "../src/services/workflows.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  assert(
    typeof workflows.evaluateWorkflowApprovalGate === "function",
    "Missing evaluateWorkflowApprovalGate workflow gate service"
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const periodCloseRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/gl.period-closing.routes.js"),
    "utf8"
  );
  assert(
    periodCloseRouteSource.includes("evaluateWorkflowApprovalGate") &&
      periodCloseRouteSource.includes("APPROVAL_REQUIRED") &&
      periodCloseRouteSource.includes("WORKFLOW_NOT_ASSIGNED") &&
      periodCloseRouteSource.includes("APPROVAL_INSTANCE_REJECTED"),
    "Period close route is missing workflow gate integration or error contracts"
  );

  const consolidationRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    consolidationRouteSource.includes('"/runs/:runId/finalize"') &&
      consolidationRouteSource.includes("evaluateWorkflowApprovalGate") &&
      consolidationRouteSource.includes("APPROVAL_REQUIRED"),
    "Consolidation finalize route is missing workflow gate checks"
  );

  const workflowServiceSource = await readFile(
    path.resolve(root, "backend/src/services/workflows.service.js"),
    "utf8"
  );
  assert(
    workflowServiceSource.includes("FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1") &&
      workflowServiceSource.includes("WORKFLOW_NOT_ASSIGNED") &&
      workflowServiceSource.includes("APPROVAL_INSTANCE_REJECTED") &&
      workflowServiceSource.includes("APPROVAL_REQUIRED"),
    "Workflow gate service is missing feature flag and error-contract behavior"
  );

  console.log("PR-F07 workflow gate checks for close/finalize routes passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
