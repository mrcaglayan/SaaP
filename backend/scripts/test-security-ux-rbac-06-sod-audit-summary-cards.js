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
  const assignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );

  const summary = buildAssignmentAuditSummary({
    businessRoleAssignments: [],
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
        packageCodes: [],
      },
    ],
    auditRows: [],
    auditReadable: false,
    l,
  });

  const packageWarning = summary.sodWarnings.find((warning) =>
    warning.title.includes("AP maker and reviewer overlap")
  );
  const roleWarning = summary.sodWarnings.find((warning) =>
    warning.title.includes("Legacy group controller remains broad")
  );

  assert.equal(packageWarning?.severity, "warn", "package-level SoD warnings should keep severity");
  assert.deepEqual(
    packageWarning?.packageLabels,
    ["AP Documents / Approve", "AP Documents / Draft & Submit"],
    "package-level SoD warnings should expose the affected package labels"
  );
  assert(
    Array.isArray(roleWarning?.roleLabels) && roleWarning.roleLabels.length > 0,
    "runtime-role SoD warnings should expose affected role labels"
  );

  assert(
    assignmentsPageSource.includes("Audit & SoD summary") &&
      assignmentsPageSource.includes("generateComplianceAuditReport") &&
      assignmentsPageSource.includes('reportType: "SOD_ANALYSIS"') &&
      assignmentsPageSource.includes("BLOCK conflicts") &&
      assignmentsPageSource.includes("WARN conflicts") &&
      assignmentsPageSource.includes("Open compliance reports") &&
      assignmentsPageSource.includes("Open RBAC audit logs") &&
      assignmentsPageSource.includes("Open access debugger") &&
      assignmentsPageSource.includes("<AuditSodSummarySurface"),
    "UX-RBAC-06 should add the SoD summary surface, tenant snapshot fetch, and handoff links"
  );

  assert(
    workbenchSource.includes("Affected packages") &&
      workbenchSource.includes("Affected roles") &&
      workbenchSource.includes("warning.severity"),
    "UX-RBAC-06 should keep affected-package and affected-role detail visible inside the detailed workbench warnings"
  );

  console.log("test-security-ux-rbac-06-sod-audit-summary-cards passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
