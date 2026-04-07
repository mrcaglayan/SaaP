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

  const summary = buildAssignmentAuditSummary({
    businessRoleAssignments: [
      {
        assignmentId: 11,
        userId: 7,
        roleId: 501,
        roleCode: "BUSINESS_ROLE__BRANCH_ACCOUNTANT",
        businessRoleLabel: "Branch Accountant",
        scopeType: "OPERATING_UNIT",
        scopeId: 8,
        scopeLabel: "KBL - Kabul Branch",
        createdAt: "2026-02-01T09:00:00Z",
        effectiveFrom: "2026-02-01",
        effectiveTo: "",
        status: "ACTIVE",
      },
    ],
    workflowPackageAssignments: [
      {
        assignmentId: 12,
        userId: 7,
        roleId: 601,
        roleCode: "WORKFLOW_PACKAGE__PKG_AP_DRAFT_SUBMIT",
        packageCode: "PKG-AP-DRAFT-SUBMIT",
        packageLabel: "AP Documents / Draft & Submit",
        scopeType: "OPERATING_UNIT",
        scopeId: 8,
        scopeLabel: "KBL - Kabul Branch",
        createdAt: "2026-02-01T09:05:00Z",
        effectiveFrom: "2026-02-01",
        effectiveTo: "",
        status: "ACTIVE",
        effect: "ALLOW",
        sourceType: "DIRECT",
        sourceTypeLabel: "Direct / custom",
        sourceDetail: "Direct workflow package grant",
      },
      {
        assignmentId: 13,
        userId: 7,
        roleId: 602,
        roleCode: "WORKFLOW_PACKAGE__PKG_AP_APPROVE",
        packageCode: "PKG-AP-APPROVE",
        packageLabel: "AP Documents / Approve",
        scopeType: "OPERATING_UNIT",
        scopeId: 8,
        scopeLabel: "KBL - Kabul Branch",
        createdAt: "2026-02-01T09:10:00Z",
        effectiveFrom: "2026-02-01",
        effectiveTo: "",
        status: "ACTIVE",
        effect: "ALLOW",
        sourceType: "DIRECT",
        sourceTypeLabel: "Direct / custom",
        sourceDetail: "Direct workflow package grant",
      },
    ],
    userBundles: [
      {
        id: "bundle-1",
        status: "ACTIVE",
        effect: "ALLOW",
        scopeType: "GROUP",
        scopeId: 2,
        scopeLabel: "GRP - Holding",
        roleCodes: ["GroupController"],
        rows: [
          {
            id: 21,
            user_id: 7,
            role_id: 901,
            role_code: "GroupController",
            scope_type: "GROUP",
            scope_id: 2,
            created_at: "2026-02-02T10:00:00Z",
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
          roleCode: "WORKFLOW_PACKAGE__PKG_AP_DRAFT_SUBMIT",
        }),
        created_at: "2026-02-01T09:05:00Z",
      },
      {
        id: 101,
        action: "assignment.scope_replace",
        resource_type: "user_role_scope",
        resource_id: 12,
        target_user_id: 7,
        scope_type: "OPERATING_UNIT",
        scope_id: 8,
        actor_user_name: "Security Admin",
        actor_user_email: "security@example.com",
        payload_json: JSON.stringify({
          assignmentId: 12,
        }),
        created_at: "2026-02-03T12:00:00Z",
      },
    ],
    auditReadable: true,
    l,
  });

  assert.equal(
    summary.auditItems.some(
      (item) =>
        item.title === "AP Documents / Draft & Submit" &&
        item.grantedByLabel.includes("Security Admin") &&
        item.lastChangedByLabel.includes("Security Admin")
    ),
    true,
    "UI-2F should attribute direct package grants to the granting admin when audit logs are available"
  );
  assert.equal(
    summary.auditItems.some(
      (item) =>
        item.title === "Branch Accountant" &&
        item.kindLabel === "Business role label"
    ),
    true,
    "UI-2F should keep business-role labels in the audit timeline"
  );
  assert.equal(
    summary.sodWarnings.some((warning) => warning.title.includes("AP maker and reviewer overlap")),
    true,
    "UI-2F should surface AP maker-checker overlaps at the same scope"
  );
  assert.equal(
    summary.sodWarnings.some((warning) => warning.title.includes("Legacy group controller remains broad")),
    true,
    "UI-2F should warn about broad legacy runtime roles in the selected user's mix"
  );

  assert(
    assignmentsPageSource.includes("listAuditLogs") &&
      assignmentsPageSource.includes("selectedWorkbenchAssignmentAuditSummary") &&
      assignmentsPageSource.includes("selectedUserAuditLoading") &&
      assignmentsPageSource.includes("selectedUserAssignmentAuditSummary"),
    "UserAssignmentsPage should load selected-user audit logs and pass the UI-2F summary into the workbench"
  );

  assert(
    workbenchSource.includes("Assignment audit & SoD warnings") &&
      workbenchSource.includes("SoD warning summary") &&
      workbenchSource.includes("Assignment history") &&
      workbenchSource.includes("Granted by") &&
      workbenchSource.includes("Last scope change"),
    "UserAssignmentWorkbench should render the UI-2F audit and warning sections"
  );

  console.log("test-security-ui2f-assignment-audit-sod-warnings passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
