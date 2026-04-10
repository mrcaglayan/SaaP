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
  const posterPackageCodes = resolveWorkflowPackagesForRuntimeRoles(["CountryAPPoster"]).map(
    (entry) => entry.code
  );

  assert(
    submitterPackageCodes.includes("PKG-AP-VIEW") &&
      submitterPackageCodes.includes("PKG-AP-DRAFT-SUBMIT"),
    "UI-2A should keep explainability package coverage for AP submitter runtime roles"
  );
  assert(
    posterPackageCodes.includes("PKG-AP-POST") &&
      posterPackageCodes.includes("PKG-AP-REVERSE"),
    "UI-2A should keep explainability package coverage for AP poster runtime roles"
  );

  assert(
    pageSource.includes("UserAssignmentWorkbench") &&
      pageSource.includes('label={l("Assignment Workbench", "Atama Calisma Alani")}') &&
      pageSource.includes("useSearchParams") &&
      pageSource.includes("USER_ASSIGNMENT_TAB_ORDER") &&
      pageSource.includes("DELEGATION_TAB_ORDER") &&
      pageSource.includes('workspaceSectionKey="assignments"') &&
      pageSource.includes('tab: "delegations"') &&
      !pageSource.includes("userFilters.delegationState") &&
      !pageSource.includes("All delegation states"),
    "UserAssignmentsPage should swap the old users table for the dedicated UI-2A workbench and keep its workspace state in the URL"
  );

  assert(
    workbenchSource.includes("Assignment workbench") &&
      workbenchSource.includes("People list") &&
      workbenchSource.includes("Selected user authority detail") &&
      workbenchSource.includes("Runtime authority snapshot") &&
      workbenchSource.includes("Workflow package coverage") &&
      workbenchSource.includes("Scope targets") &&
      workbenchSource.includes("Open bulk assignment view") &&
      workbenchSource.includes("Preset-derived") &&
      workbenchSource.includes("Direct / custom") &&
      workbenchSource.includes("Legacy present") &&
      workbenchSource.includes("Composable only"),
    "UserAssignmentWorkbench should expose the planned two-panel UI-2A workbench language"
  );

  console.log("test-security-ui2a-user-assignment-workbench passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
