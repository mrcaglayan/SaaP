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

  const preview = buildEffectiveAuthorityPreview({
    workflowPackageAssignments: [
      {
        packageCode: "PKG-AP-APPROVE",
        scopeType: "LEGAL_ENTITY",
        scopeId: 1,
        scopeLabel: "AF - AFGHANTURK MAARIF FOUNDATION",
        status: "ACTIVE",
        effect: "ALLOW",
        sourceType: "DIRECT",
      },
    ],
    userBundles: [
      {
        roleCodes: ["TreasuryOperator"],
        packageCodes: [],
        scopeType: "LEGAL_ENTITY",
        scopeId: 1,
        scopeLabel: "AF - AFGHANTURK MAARIF FOUNDATION",
        status: "ACTIVE",
        effect: "ALLOW",
        hasLegacyRole: false,
        isPresetBundle: false,
      },
      {
        roleCodes: ["BranchOperator"],
        packageCodes: ["PKG-AP-VIEW"],
        scopeType: "LEGAL_ENTITY",
        scopeId: 2,
        scopeLabel: "TR - Turkey Entity",
        status: "ACTIVE",
        effect: "ALLOW",
        hasLegacyRole: false,
        isPresetBundle: false,
      },
    ],
    l,
  });

  assert.equal(
    preview.workflowLines.some(
      (line) =>
        line.summaryText.includes("approve AP") &&
        line.scopeLabel === "AF - AFGHANTURK MAARIF FOUNDATION"
    ),
    true,
    "UI-2E should summarize package-backed workflow authority in readable language"
  );
  assert.equal(
    preview.workflowLines.some(
      (line) =>
        line.summaryText.includes("view AP") &&
        line.missingText.includes("post AP") &&
        line.scopeLabel === "TR - Turkey Entity"
    ),
    true,
    "UI-2E should make missing higher-stage AP authority visible at scope level"
  );
  assert.equal(
    preview.runtimeLines.some(
      (line) =>
        line.roleLabel === "TreasuryOperator" &&
        line.summaryText.includes("bank, cash, and settlement operations")
    ),
    true,
    "UI-2E should keep non-package runtime authority readable for roles outside the package model"
  );
  assert.equal(
    preview.warnings.length,
    0,
    "UI-2E should stay quiet for allow-only package and runtime mixes that have no deny-side caveat"
  );

  assert(
    assignmentsPageSource.includes("buildEffectiveAuthorityPreview") &&
      assignmentsPageSource.includes("selectedWorkbenchEffectiveAuthorityPreview") &&
      assignmentsPageSource.includes("selectedUserEffectiveAuthorityPreview"),
    "UserAssignmentsPage should memoize and pass the effective-authority preview into the workbench"
  );

  assert(
    workbenchSource.includes("Effective authority preview") &&
      workbenchSource.includes("Workflow & package authority") &&
      workbenchSource.includes("Direct runtime authority") &&
      workbenchSource.includes("Authority warnings") &&
      workbenchSource.includes("Still missing: {{missing}}."),
    "UserAssignmentWorkbench should render the UI-2E preview card and mismatch messaging"
  );

  console.log("test-security-ui2e-effective-authority-preview passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
