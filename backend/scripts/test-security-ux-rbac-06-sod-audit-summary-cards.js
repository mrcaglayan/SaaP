import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAssignmentAuditSummary,
  buildCandidateRoleConflictWarnings,
} from "../../frontend/src/pages/security/userAssignmentAuditSummary.js";

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
        permissionCodes: ["cari.doc.submit", "org.fiscal_period.read", "gl.book.read"],
      },
      {
        code: "APApprover",
        displayName: "AP Approver",
        permissionCodes: ["approvals.requests.approve"],
      },
      {
        code: "CountryAPPoster",
        displayName: "Country AP Poster",
        permissionCodes: ["cari.doc.post", "cari.doc.reverse"],
      },
    ].map((role) => [role.code, role])
  );
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const assignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );
  const rolesByCode = buildRolesByCode();

  const summary = buildAssignmentAuditSummary({
    workflowPackageAssignments: [],
    userBundles: [
      {
        id: "bundle-1",
        status: "ACTIVE",
        effect: "ALLOW",
        scopeType: "OPERATING_UNIT",
        scopeId: 8,
        scopeLabel: "KBL - Kabul Branch",
        roleCodes: ["BranchOperator", "APApprover"],
        rows: [],
      },
    ],
    auditRows: [],
    auditReadable: false,
    l,
    rolesByCode,
  });

  const overlapWarning = summary.sodWarnings.find((warning) =>
    warning.title.includes("AP maker and reviewer overlap")
  );
  assert.equal(overlapWarning?.severity, "warn", "role-native SoD warnings should keep severity");
  assert.deepEqual(
    overlapWarning?.matchedRoleCodes,
    ["APApprover", "BranchOperator"],
    "role-native SoD warnings should expose the overlapping runtime roles"
  );
  assert.deepEqual(
    overlapWarning?.permissionFamilyLabels,
    ["AP approve", "AP draft & submit"],
    "role-native SoD warnings should expose the overlapping authority families"
  );

  const candidateWarnings = buildCandidateRoleConflictWarnings({
    candidateRoleCode: "CountryAPPoster",
    scopeType: "OPERATING_UNIT",
    scopeId: 8,
    scopeLabel: "KBL - Kabul Branch",
    userBundles: [
      {
        id: "bundle-2",
        status: "ACTIVE",
        effect: "ALLOW",
        scopeType: "OPERATING_UNIT",
        scopeId: 8,
        scopeLabel: "KBL - Kabul Branch",
        roleCodes: ["APApprover"],
      },
    ],
    rolesByCode,
    l,
  });
  assert.equal(candidateWarnings.length, 1, "candidate-role diagnostics should surface one AP reviewer/poster overlap");
  assert.deepEqual(
    candidateWarnings[0]?.candidateRoleLabels,
    ["Country AP Poster"],
    "candidate-role diagnostics should name the blocked role"
  );

  assert(
    assignmentsPageSource.includes("buildCandidateRoleConflictWarnings") &&
      assignmentsPageSource.includes("Overlapping authorities") &&
      assignmentsPageSource.includes("Candidate blocked roles") &&
      assignmentsPageSource.includes("function AuditSodSummarySurface"),
    "UX-RBAC-06 should keep the summary surface and show role-native overlap evidence"
  );

  assert(
    workbenchSource.includes("Current overlap evidence") &&
      workbenchSource.includes("Candidate blocked roles") &&
      workbenchSource.includes("warning.permissionFamilyLabels") &&
      workbenchSource.includes("item.kindLabel"),
    "UX-RBAC-06 should keep role-native warning evidence and audit item rendering in the workbench"
  );

  console.log("test-security-ux-rbac-06-sod-audit-summary-cards passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
