import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkflowPackagesForRuntimeRoles } from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );
  const pageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );

  const submitterPackageCodes = resolveWorkflowPackagesForRuntimeRoles(["EntityAPController"]).map(
    (entry) => entry.code
  );
  const branchSubmitterPackageCodes = resolveWorkflowPackagesForRuntimeRoles([
    "OUAPSubmitter",
  ]).map((entry) => entry.code);
  const posterPackageCodes = resolveWorkflowPackagesForRuntimeRoles(["CountryAPPoster"]).map(
    (entry) => entry.code
  );

  assert(
    submitterPackageCodes.includes("PKG-AP-VIEW") &&
      submitterPackageCodes.includes("PKG-AP-DRAFT-SUBMIT"),
    "UI-2A should keep explainability package coverage for AP submitter runtime roles"
  );
  assert(
    branchSubmitterPackageCodes.includes("PKG-AP-VIEW") &&
      branchSubmitterPackageCodes.includes("PKG-AP-DRAFT-SUBMIT"),
    "UI-2A should explain branch-scoped AP submitter runtime roles through the same package catalog"
  );
  assert(
    posterPackageCodes.includes("PKG-AP-POST") &&
      posterPackageCodes.includes("PKG-AP-REVERSE"),
    "UI-2A should keep explainability package coverage for AP poster runtime roles"
  );

  assert(
    pageSource.includes("UserAssignmentWorkbench") &&
      pageSource.includes('eyebrow={l("Security / Assignment Workspace", "Guvenlik / atama calisma alani")}') &&
      pageSource.includes("useSearchParams") &&
      pageSource.includes("USER_ASSIGNMENT_CANONICAL_TABS") &&
      pageSource.includes("DELEGATION_TAB_ORDER") &&
      pageSource.includes('workspaceSectionKey="users"') &&
      pageSource.includes('tab: "delegations"') &&
      !pageSource.includes("userFilters.delegationState") &&
      !pageSource.includes("All delegation states"),
    "UserAssignmentsPage should swap the old users table for the dedicated UI-2A workbench and keep its workspace state in the URL"
  );

  assert(
    workbenchSource.includes("Manage") &&
      workbenchSource.includes("Permissions") &&
      workbenchSource.includes("Raw roles") &&
      workbenchSource.includes("Workflow packages") &&
      workbenchSource.includes("Organizational scope") &&
      workbenchSource.includes("Effective authority preview") &&
      workbenchSource.includes("Workflow & package authority") &&
      workbenchSource.includes("Direct runtime authority") &&
      workbenchSource.includes("Assignment audit & SoD warnings"),
    "UserAssignmentWorkbench should expose the planned two-panel UI-2A workbench language"
  );

  console.log("test-security-ui2a-user-assignment-workbench passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
