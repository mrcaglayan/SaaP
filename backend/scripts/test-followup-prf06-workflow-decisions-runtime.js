import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as validators from "../src/routes/workflows.validators.js";
import * as service from "../src/services/workflows.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  assert(
    typeof validators.parseWorkflowInstancesListInput === "function",
    "Missing parseWorkflowInstancesListInput validator"
  );
  assert(
    typeof validators.parseWorkflowInstanceDecisionInput === "function",
    "Missing parseWorkflowInstanceDecisionInput validator"
  );
  assert(
    typeof validators.parseWorkflowInstanceIdParam === "function",
    "Missing parseWorkflowInstanceIdParam validator"
  );

  assert(
    typeof service.resolveWorkflowDecisionPermissionAccess === "function",
    "Missing resolveWorkflowDecisionPermissionAccess service"
  );
  assert(
    typeof service.approveWorkflowInstance === "function",
    "Missing approveWorkflowInstance service"
  );
  assert(
    typeof service.rejectWorkflowInstance === "function",
    "Missing rejectWorkflowInstance service"
  );
  assert(
    typeof service.listWorkflowInstances === "function",
    "Missing listWorkflowInstances service"
  );
  assert(
    typeof service.getWorkflowInstanceById === "function",
    "Missing getWorkflowInstanceById service"
  );

  const listInput = validators.parseWorkflowInstancesListInput({
    user: { tenantId: 17, userId: 5 },
    query: {
      processType: "period_close",
      status: "pending",
      targetType: "period_close_run",
      targetId: "101",
      workflowDefinitionId: "9",
      limit: "50",
      offset: "10",
    },
  });
  assert(listInput.tenantId === 17, "instance list tenantId parse failed");
  assert(listInput.processType === "PERIOD_CLOSE", "instance list processType normalization failed");
  assert(listInput.status === "PENDING", "instance list status normalization failed");
  assert(listInput.targetType === "PERIOD_CLOSE_RUN", "instance list targetType normalization failed");
  assert(listInput.targetId === 101, "instance list targetId parse failed");
  assert(
    listInput.workflowDefinitionId === 9,
    "instance list workflowDefinitionId parse failed"
  );
  assert(listInput.limit === 50, "instance list limit parse failed");
  assert(listInput.offset === 10, "instance list offset parse failed");

  const decisionInput = validators.parseWorkflowInstanceDecisionInput({
    user: { tenantId: 17, userId: 25 },
    params: { instanceId: "77" },
    body: { decision_note: "Approve after branch-level control check" },
  });
  assert(decisionInput.tenantId === 17, "decision tenantId parse failed");
  assert(decisionInput.userId === 25, "decision userId parse failed");
  assert(decisionInput.instanceId === 77, "decision instanceId parse failed");
  assert(
    decisionInput.decisionNote === "Approve after branch-level control check",
    "decisionNote parse failed"
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/workflows.routes.js"),
    "utf8"
  );
  assert(
    routeSource.includes('"/instances"') &&
      routeSource.includes('"/instances/:instanceId"') &&
      routeSource.includes('"/instances/:instanceId/approve"') &&
      routeSource.includes('"/instances/:instanceId/reject"'),
    "workflow routes are missing expected instances/decision endpoints"
  );
  assert(
    routeSource.includes("resolveWorkflowDecisionPermissionAccess") &&
      routeSource.includes("requirePermission(access.requiredPermissionCode"),
    "workflow decision route should enforce dynamic required_permission_code"
  );

  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/workflows.service.js"),
    "utf8"
  );
  assert(
    serviceSource.includes("Maker-checker violation") &&
      serviceSource.includes("min_approver_count") &&
      serviceSource.includes("current_step_no") &&
      serviceSource.includes("required_permission_code"),
    "workflow decision runtime rules are missing maker-checker/min_approver/step permission checks"
  );

  console.log("PR-F06 workflow instance decisions runtime test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

