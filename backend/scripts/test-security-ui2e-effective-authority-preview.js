import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEffectiveAuthorityPreview } from "../../frontend/src/pages/security/userAssignmentAuthorityPreview.js";

function formatTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_, key) => {
    const value = values?.[key];
    return value == null ? "" : String(value);
  });
}

function l(english, _turkish, values) {
  return formatTemplate(english, values);
}

function buildRolesByCode() {
  return new Map(
    [
      {
        code: "BranchOperator",
        displayName: "Branch Accountant",
        permissionCodes: ["cari.doc.read", "cari.doc.submit"],
      },
      {
        code: "APApprover",
        displayName: "AP Approver",
        permissionCodes: ["approvals.requests.approve"],
      },
      {
        code: "TreasuryOperator",
        displayName: "Treasury Operator",
        permissionCodes: ["bank.txn.read"],
      },
    ].map((role) => [role.code, role])
  );
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );
  const assignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const rolesByCode = buildRolesByCode();

  const preview = buildEffectiveAuthorityPreview({
    userBundles: [
      {
        roleCodes: ["TreasuryOperator"],
        scopeType: "LEGAL_ENTITY",
        scopeId: 1,
        scopeLabel: "AF - AFGHANTURK MAARIF FOUNDATION",
        status: "ACTIVE",
        effect: "ALLOW",
      },
      {
        roleCodes: ["BranchOperator"],
        scopeType: "LEGAL_ENTITY",
        scopeId: 2,
        scopeLabel: "TR - Turkey Entity",
        status: "ACTIVE",
        effect: "ALLOW",
      },
      {
        roleCodes: ["APApprover"],
        scopeType: "LEGAL_ENTITY",
        scopeId: 3,
        scopeLabel: "TMV - Shared Services",
        status: "ACTIVE",
        effect: "ALLOW",
      },
    ],
    rolesByCode,
    l,
  });

  assert.equal(
    preview.governedAuthorityLines.some(
      (line) =>
        line.summaryText.includes("Draft and submit AP") &&
        line.scopeLabel === "TR - Turkey Entity"
    ),
    true,
    "UI-2E should summarize governed role authority in readable language"
  );
  assert.equal(
    preview.governedAuthorityLines.some(
      (line) =>
        line.summaryText.includes("View AP") &&
        line.missingText.includes("Post AP") &&
        line.scopeLabel === "TR - Turkey Entity"
    ),
    true,
    "UI-2E should make missing higher-stage AP authority visible at scope level"
  );
  assert.equal(
    preview.governedAuthorityLines.some(
      (line) =>
        line.summaryText.includes("Approve AP") &&
        line.scopeLabel === "TMV - Shared Services"
    ),
    true,
    "UI-2E should list governed approval authority from assigned roles"
  );
  assert.equal(
    preview.otherRoleLines.some(
      (line) =>
        line.roleLabel === "Treasury Operator" &&
        line.summaryText.includes("bank, cash, and settlement operations")
    ),
    true,
    "UI-2E should keep non-governed runtime authority readable for roles outside the governed model"
  );
  assert.equal(
    preview.warnings.length,
    0,
    "UI-2E should stay quiet for allow-only role assignments that have no deny-side caveat"
  );

  assert(
    assignmentsPageSource.includes("buildEffectiveAuthorityPreview") &&
      assignmentsPageSource.includes("selectedWorkbenchEffectiveAuthorityPreview") &&
      assignmentsPageSource.includes("selectedUserEffectiveAuthorityPreview"),
    "UserAssignmentsPage should memoize and pass the effective-authority preview into the workbench"
  );

  assert(
    workbenchSource.includes("Effective authority preview") &&
      workbenchSource.includes("Governed authority from roles") &&
      workbenchSource.includes("Other active role authority") &&
      workbenchSource.includes("Authority warnings") &&
      workbenchSource.includes("Still missing: {{missing}}."),
    "UserAssignmentWorkbench should render the role-native effective-authority preview card"
  );

  console.log("test-security-ui2e-effective-authority-preview passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
