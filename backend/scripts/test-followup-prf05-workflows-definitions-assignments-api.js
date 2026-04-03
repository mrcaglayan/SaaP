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
    typeof validators.parseWorkflowDefinitionsListInput === "function",
    "Missing parseWorkflowDefinitionsListInput validator"
  );
  assert(
    typeof validators.parseWorkflowDefinitionCreateInput === "function",
    "Missing parseWorkflowDefinitionCreateInput validator"
  );
  assert(
    typeof validators.parseWorkflowAssignmentCreateInput === "function",
    "Missing parseWorkflowAssignmentCreateInput validator"
  );
  assert(
    typeof service.resolveWorkflowAssignmentScope === "function",
    "Missing resolveWorkflowAssignmentScope service"
  );
  assert(
    typeof service.listWorkflowDefinitions === "function",
    "Missing listWorkflowDefinitions service"
  );
  assert(
    typeof service.listWorkflowAssignments === "function",
    "Missing listWorkflowAssignments service"
  );

  const definitionInput = validators.parseWorkflowDefinitionCreateInput({
    user: { tenantId: 11, userId: 7 },
    body: {
      code: "wf_close_global",
      name: "Close Global Approval",
      processType: "period_close",
      isActive: true,
      versionNo: 2,
    },
  });
  assert(definitionInput.tenantId === 11, "definition tenantId parse failed");
  assert(definitionInput.userId === 7, "definition userId parse failed");
  assert(definitionInput.code === "WF_CLOSE_GLOBAL", "definition code normalization failed");
  assert(definitionInput.processType === "PERIOD_CLOSE", "definition processType normalization failed");

  const assignmentInput = validators.parseWorkflowAssignmentCreateInput({
    user: { tenantId: 11, userId: 7 },
    body: {
      processType: "CONSOLIDATION_RUN",
      workflowDefinitionId: 23,
      legalEntityId: 45,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      status: "active",
    },
  });
  assert(
    assignmentInput.processType === "CONSOLIDATION_RUN",
    "assignment processType parse failed"
  );
  assert(assignmentInput.workflowDefinitionId === 23, "assignment workflowDefinitionId parse failed");
  assert(assignmentInput.legalEntityId === 45, "assignment legalEntityId parse failed");
  assert(assignmentInput.status === "ACTIVE", "assignment status parse failed");

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/workflows.routes.js"),
    "utf8"
  );
  assert(
    routeSource.includes('"/definitions"') &&
      routeSource.includes('"/assignments"') &&
      routeSource.includes('"/definitions/:definitionId/steps"'),
    "workflow routes are missing expected API endpoints"
  );
  assert(
    routeSource.includes('requirePermission("workflow.definition.read")') &&
      routeSource.includes('requirePermission("workflow.definition.write")') &&
      routeSource.includes('requirePermission("workflow.assignment.read"') &&
      routeSource.includes('requirePermission("workflow.assignment.write"'),
    "workflow definitions/assignments routes should use workflow read/write permissions"
  );
  assert(
    !routeSource.includes('requirePermission("onboarding.company.setup"'),
    "workflow definitions/assignments routes should no longer use onboarding.company.setup"
  );

  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/workflows.service.js"),
    "utf8"
  );
  assert(
    serviceSource.includes("resolveWorkflowAssignmentScope") &&
      serviceSource.includes("listWorkflowDefinitions") &&
      serviceSource.includes("listWorkflowAssignments"),
    "workflow service is missing required definitions/assignments exports"
  );

  console.log("PR-F05 workflow definitions/assignments API test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
