import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOrgScopeTreePathLabelText,
  findOrgScopeTreeNodeByScopeSelection,
  getOrgScopeTreeNodeSummaryValue,
} from "../../frontend/src/shared/orgScopeTree.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflowSetupPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/settings/WorkflowSetupPage.jsx"),
    "utf8"
  );
  const workflowSetupHelpersSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js"
    ),
    "utf8"
  );
  const workflowAssignmentStepSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowAssignmentStep.jsx"
    ),
    "utf8"
  );
  const pickerSource = await readFile(
    path.resolve(rootDir, "frontend/src/components/org/OrgScopeTreePicker.jsx"),
    "utf8"
  );
  const planSource = await readFile(
    path.resolve(rootDir, "redesigning/05-CanonicalBackendOrgTreePlatformPlan.md"),
    "utf8"
  );

  const sampleRoot = {
    key: "TENANT:7",
    scopeType: "TENANT",
    scopeId: 7,
    label: "Tenant",
    code: null,
    selectable: true,
    pathLabels: ["Tenant"],
    meta: {},
    children: [
      {
        key: "GROUP:10",
        scopeType: "GROUP",
        scopeId: 10,
        label: "North Hub Group",
        code: "NHG",
        selectable: true,
        pathLabels: ["Tenant", "North Hub Group"],
        meta: {},
        children: [
          {
            key: "COUNTRY:1:GROUP:10",
            scopeType: "COUNTRY",
            scopeId: 1,
            label: "Germany",
            code: "DE",
            selectable: true,
            pathLabels: ["Tenant", "North Hub Group", "Germany"],
            meta: { iso2: "DE" },
            children: [],
          },
        ],
      },
      {
        key: "GROUP:20",
        scopeType: "GROUP",
        scopeId: 20,
        label: "South Hub Group",
        code: "SHG",
        selectable: true,
        pathLabels: ["Tenant", "South Hub Group"],
        meta: {},
        children: [
          {
            key: "COUNTRY:1:GROUP:20",
            scopeType: "COUNTRY",
            scopeId: 1,
            label: "Germany",
            code: "DE",
            selectable: true,
            pathLabels: ["Tenant", "South Hub Group", "Germany"],
            meta: { iso2: "DE" },
            children: [],
          },
        ],
      },
    ],
  };

  const countrySelection = { scopeType: "COUNTRY", scopeId: 1 };
  const defaultCountryNode = findOrgScopeTreeNodeByScopeSelection(sampleRoot, countrySelection);
  const preferredCountryNode = findOrgScopeTreeNodeByScopeSelection(
    sampleRoot,
    countrySelection,
    "COUNTRY:1:GROUP:20"
  );

  assert.equal(defaultCountryNode?.key, "COUNTRY:1:GROUP:10");
  assert.equal(preferredCountryNode?.key, "COUNTRY:1:GROUP:20");
  assert.equal(
    buildOrgScopeTreePathLabelText(preferredCountryNode?.pathLabels),
    "Tenant / South Hub Group / Germany"
  );
  assert.equal(getOrgScopeTreeNodeSummaryValue(preferredCountryNode), "DE");
  assert.equal(getOrgScopeTreeNodeSummaryValue(sampleRoot.children[0]), "NHG");

  assert(
    pickerSource.includes("valueNodeKey = \"\"") &&
      pickerSource.includes("const [internalValueNodeKey, setInternalValueNodeKey] = useState(\"\");") &&
      pickerSource.includes("valueNodeKey: effectiveValueNodeKey") &&
      pickerSource.includes("setInternalValueNodeKey(node.key);") &&
      pickerSource.includes("onChange(nodeState.selection, node);"),
    "OrgScopeTreePicker should preserve branch-stable selection hints while still emitting plain scope semantics"
  );

  assert(
    workflowAssignmentStepSource.includes("scopeValueNodeKey = \"\"") &&
      workflowAssignmentStepSource.includes("valueNodeKey={scopeValueNodeKey}"),
    "WorkflowAssignmentStep should pass stable selected-branch hints into the shared picker"
  );

  assert(
    workflowSetupPageSource.includes("findOrgScopeTreeNodeByScopeSelection") &&
      workflowSetupPageSource.includes(
        "const [assignmentScopeNodeKey, setAssignmentScopeNodeKey] = useState(\"\");"
      ) &&
      workflowSetupPageSource.includes("scopeNode: selectedAssignmentScopeNode") &&
      workflowSetupPageSource.includes("scopeValueNodeKey={assignmentScopeNodeKey}") &&
      workflowSetupPageSource.includes(
        "workflow scope summaries now come from the canonical tree itself"
      ),
    "WorkflowSetupPage should resolve summary text from canonical tree nodes and preserve the selected branch key"
  );

  assert(
    !workflowSetupPageSource.includes("const selectedCountry = useMemo(") &&
      !workflowSetupPageSource.includes("const selectedGroupCompany = useMemo(") &&
      !workflowSetupPageSource.includes("const selectedLegalEntity = useMemo(") &&
      !workflowSetupPageSource.includes("const selectedOperatingUnit = useMemo("),
    "WorkflowSetupPage should remove the duplicated flat lookup summary state"
  );

  assert(
    workflowSetupHelpersSource.includes("getOrgScopeTreeNodeSummaryValue(scopeNode)") &&
      !workflowSetupHelpersSource.includes("selectedCountry?.iso2") &&
      !workflowSetupHelpersSource.includes("selectedGroupCompany?.code") &&
      !workflowSetupHelpersSource.includes("selectedLegalEntity?.code") &&
      !workflowSetupHelpersSource.includes("selectedOperatingUnit?.code"),
    "Workflow summary helpers should derive compact scope text from shared tree nodes"
  );

  assert(
    planSource.includes("## 06/07 Integration Handoff") &&
      planSource.includes("GET /api/v1/org/tree?shape=nested") &&
      planSource.includes("allowed scope-type filters") &&
      planSource.includes("disabled node reasons") &&
      planSource.includes("shared node-key-aware helpers") &&
      planSource.includes("06 and 07 plans"),
    "The org-tree platform plan should document the WGX-13 handoff to the 06 and 07 companion tracks"
  );

  console.log("test-org-wgx13-platform-handoff passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
