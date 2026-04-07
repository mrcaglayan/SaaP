import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflowSetupPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/settings/WorkflowSetupPage.jsx"),
    "utf8"
  );
  const workflowAssignmentStepSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowAssignmentStep.jsx"
    ),
    "utf8"
  );

  assert(
    workflowSetupPageSource.includes("listOrgTree") &&
      workflowSetupPageSource.includes("getOrgScopeTreeRoot") &&
      workflowSetupPageSource.includes("setOrgTreeRoot(getOrgScopeTreeRoot(orgTreeRes))"),
    "WorkflowSetupPage should load the canonical nested org tree"
  );

  assert(
    workflowSetupPageSource.includes("function handleAssignmentScopeSelect(nextSelection, node = null)") &&
      workflowSetupPageSource.includes(
        "function getAssignmentNodeDisabledReason(_node, selection)"
      ) &&
      workflowSetupPageSource.includes("scopeValue={assignmentScopeSelection}") &&
      workflowSetupPageSource.includes("scopeValueNodeKey={assignmentScopeNodeKey}") &&
      workflowSetupPageSource.includes("onSelectScope={handleAssignmentScopeSelect}") &&
      workflowSetupPageSource.includes(
        "allowedScopeTypes={Object.keys(text.scopeTypeLabels)}"
      ) &&
      workflowSetupPageSource.includes(
        "getNodeDisabledReason={getAssignmentNodeDisabledReason}"
      ),
    "WorkflowSetupPage should route workflow assignment scope selection through the shared tree picker"
  );

  assert(
    workflowSetupPageSource.includes("if (!orgTreeRoot)") &&
      workflowSetupPageSource.includes(
        '"Load the organization tree before saving the assignment."'
      ) &&
      workflowSetupPageSource.includes("if (!assignmentScopeSelection)") &&
      workflowSetupPageSource.includes('"Select an assignment scope first."'),
    "WorkflowSetupPage should block saving when the canonical tree or scope selection is missing"
  );

  assert(
    workflowSetupPageSource.includes(
      "payload.groupCompanyId = toPositiveInt(assignmentForm.groupCompanyId) || undefined;"
    ) &&
      workflowSetupPageSource.includes(
        "payload.countryId = toPositiveInt(assignmentForm.countryId) || undefined;"
      ) &&
      workflowSetupPageSource.includes(
        "payload.legalEntityId = toPositiveInt(assignmentForm.legalEntityId) || undefined;"
      ) &&
      workflowSetupPageSource.includes(
        "payload.operatingUnitId = toPositiveInt(assignmentForm.operatingUnitId) || undefined;"
      ),
    "WorkflowSetupPage should preserve the existing workflow assignment payload shape"
  );

  assert(
    workflowAssignmentStepSource.includes(
      'import OrgScopeTreePicker from "../../../../components/org/OrgScopeTreePicker.jsx";'
    ) &&
      workflowAssignmentStepSource.includes("<OrgScopeTreePicker") &&
      workflowAssignmentStepSource.includes('title={l("Target scope", "Hedef kapsam")}') &&
      workflowAssignmentStepSource.includes(
        "The workflow definition itself is chosen in the next step."
      ) &&
      workflowAssignmentStepSource.includes(
        "getNodeDisabledReason={getNodeDisabledReason}"
      ) &&
      workflowAssignmentStepSource.includes("allowedScopeTypes={allowedScopeTypes}"),
    "WorkflowAssignmentStep should render the shared org tree picker with workflow-specific tree rules"
  );

  assert(
    !workflowAssignmentStepSource.includes("Select group company") &&
      !workflowAssignmentStepSource.includes("Select country") &&
      !workflowAssignmentStepSource.includes("Select legal entity") &&
      !workflowAssignmentStepSource.includes("Select operating unit"),
    "WorkflowAssignmentStep should remove the legacy flat per-scope selectors"
  );

  console.log("test-org-wgx11-workflow-setup-tree-adoption passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
