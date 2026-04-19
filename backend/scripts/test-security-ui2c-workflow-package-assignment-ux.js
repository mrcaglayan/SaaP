import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8",
  );
  const assignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8",
  );
  const securityRouteSource = await readFile(
    path.resolve(rootDir, "backend/src/routes/security.js"),
    "utf8",
  );

  const forbiddenAssignmentTokens = [
    "handleAssignWorkflowPackage",
    "handleRemoveWorkflowPackage",
    "workflowPackageAssignmentForm",
    "workflowPackageAssignmentWriteAccess",
    "workflowPackageCatalogEntries",
    "workflowPackageScopeOptions",
    "workflowPackageScopeTypeOptions",
    "onAssignWorkflowPackage",
    "onRemoveWorkflowPackage",
    "onUpdateWorkflowPackageAssignmentField",
    "selectedWorkflowPackageAssignments",
    "showWorkflowPackageTab",
  ];
  for (const token of forbiddenAssignmentTokens) {
    assert.equal(
      assignmentsPageSource.includes(token) ||
        workbenchSource.includes(token),
      false,
      `UI-2C should remove direct workflow-package assignment token: ${token}`,
    );
  }

  const forbiddenWorkbenchLabels = [
    "Direct workflow packages",
    "Assigned packages",
    "Assign package",
    "Workflow package",
    "No direct workflow packages assigned yet.",
  ];
  for (const label of forbiddenWorkbenchLabels) {
    assert.equal(
      workbenchSource.includes(label),
      false,
      `UI-2C should not render direct workflow-package label: ${label}`,
    );
  }

  assert(
    securityRouteSource.includes(
      'const WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX = "WORKFLOW_PACKAGE__";',
    ),
    "UI-2C should still recognize managed workflow-package role prefixes while old data exists",
  );
  assert(
    securityRouteSource.includes(
      "Workflow-package managed roles are retired and cannot be edited.",
    ),
    "UI-2C should reject permission edits for managed workflow-package roles",
  );
  assert(
    securityRouteSource.includes(
      "Workflow-package assignments are retired. Apply runtime roles instead.",
    ),
    "UI-2C should reject runtime assignment of retired workflow-package roles",
  );
  assert(
    securityRouteSource.includes("!isWorkflowPackageAssignmentRoleCode(row.code)"),
    "UI-2C should hide retired managed roles from the normal role list",
  );

  console.log("test-security-ui2c-workflow-package-assignment-ux passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
