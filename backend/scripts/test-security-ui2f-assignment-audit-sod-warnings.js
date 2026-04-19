import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssignmentAuditSummary } from "../../frontend/src/pages/security/userAssignmentAuditSummary.js";

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
        permissionCodes: ["cari.doc.submit"],
      },
      {
        code: "APApprover",
        displayName: "AP Approver",
        permissionCodes: ["approvals.requests.approve"],
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

  const summary = buildAssignmentAuditSummary({
    workflowPackageAssignments: [],
    userBundles: [
      {
        id: "bundle-1",
        presetDisplayName: "Branch Accountant",
        status: "ACTIVE",
        effect: "ALLOW",
        scopeType: "OPERATING_UNIT",
        scopeId: 8,
        scopeLabel: "KBL - Kabul Branch",
        roleCodes: ["BranchOperator", "APApprover"],
        rows: [
          {
            assignmentId: 12,
            userId: 7,
            roleId: 601,
            roleCode: "BranchOperator",
            scopeType: "OPERATING_UNIT",
            scopeId: 8,
            createdAt: "2026-02-01T09:05:00Z",
          },
          {
            assignmentId: 13,
            userId: 7,
            roleId: 602,
            roleCode: "APApprover",
            scopeType: "OPERATING_UNIT",
            scopeId: 8,
            createdAt: "2026-02-01T09:10:00Z",
          },
        ],
      },
    ],
    auditRows: [
      {
        id: 100,
        action: "assignment.create",
        resource_type: "user_role_scope",
        resource_id: 12,
        target_user_id: 7,
        scope_type: "OPERATING_UNIT",
        scope_id: 8,
        actor_user_name: "Security Admin",
        actor_user_email: "security@example.com",
        payload_json: JSON.stringify({
          userId: 7,
          roleId: 601,
          roleCode: "BranchOperator",
        }),
        created_at: "2026-02-01T09:05:00Z",
      },
      {
        id: 101,
        action: "assignment.create",
        resource_type: "user_role_scope",
        resource_id: 13,
        target_user_id: 7,
        scope_type: "OPERATING_UNIT",
        scope_id: 8,
        actor_user_name: "Security Admin",
        actor_user_email: "security@example.com",
        payload_json: JSON.stringify({
          userId: 7,
          roleId: 602,
          roleCode: "APApprover",
        }),
        created_at: "2026-02-01T09:10:00Z",
      },
      {
        id: 102,
        action: "assignment.scope_replace",
        resource_type: "user_role_scope",
        resource_id: 13,
        target_user_id: 7,
        scope_type: "OPERATING_UNIT",
        scope_id: 8,
        actor_user_name: "Security Admin",
        actor_user_email: "security@example.com",
        payload_json: JSON.stringify({
          assignmentId: 13,
        }),
        created_at: "2026-02-03T12:00:00Z",
      },
    ],
    auditReadable: true,
    l,
    rolesByCode,
  });

  assert.equal(
    summary.auditItems.some(
      (item) =>
        item.title === "Branch Accountant" &&
        item.kindLabel === "Runtime bundle" &&
        item.grantedByLabel.includes("Security Admin") &&
        item.lastChangedByLabel.includes("Security Admin")
    ),
    true,
    "UI-2F should attribute bundle grants to the granting admin when audit logs are available"
  );
  assert.equal(
    summary.sodWarnings.some((warning) => warning.title.includes("AP maker and reviewer overlap")),
    true,
    "UI-2F should surface AP maker-checker overlaps at the same scope without package assignments"
  );

  assert(
    assignmentsPageSource.includes("listAuditLogs") &&
      assignmentsPageSource.includes("selectedWorkbenchAssignmentAuditSummary") &&
      assignmentsPageSource.includes("rolesByCode") &&
      assignmentsPageSource.includes("rawAssignmentConflictWarnings"),
    "UserAssignmentsPage should load selected-user audit logs and pass role-native audit data into the workbench"
  );

  assert(
    workbenchSource.includes("Assignment audit & SoD warnings") &&
      workbenchSource.includes("SoD warnings") &&
      workbenchSource.includes("Audit items") &&
      workbenchSource.includes("Overlapping authorities") &&
      workbenchSource.includes("item.statusLabel"),
    "UserAssignmentWorkbench should render the role-native audit and warning sections"
  );

  console.log("test-security-ui2f-assignment-audit-sod-warnings passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
