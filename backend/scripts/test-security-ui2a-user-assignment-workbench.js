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
        code: "EntityAPController",
        displayName: "Entity AP Controller",
        permissionCodes: ["cari.doc.read", "cari.doc.submit"],
      },
      {
        code: "OUAPSubmitter",
        displayName: "OU AP Submitter",
        permissionCodes: ["cari.doc.read", "cari.doc.submit"],
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
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );
  const pageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const rolesByCode = buildRolesByCode();

  const preview = buildEffectiveAuthorityPreview({
    userBundles: [
      {
        roleCodes: ["EntityAPController"],
        scopeType: "LEGAL_ENTITY",
        scopeId: 1,
        scopeLabel: "AF - Entity",
        status: "ACTIVE",
        effect: "ALLOW",
      },
      {
        roleCodes: ["OUAPSubmitter"],
        scopeType: "OPERATING_UNIT",
        scopeId: 10,
        scopeLabel: "KBL - Kabul Branch",
        status: "ACTIVE",
        effect: "ALLOW",
      },
      {
        roleCodes: ["CountryAPPoster"],
        scopeType: "COUNTRY",
        scopeId: 4,
        scopeLabel: "AF - Afghanistan",
        status: "ACTIVE",
        effect: "ALLOW",
      },
    ],
    rolesByCode,
    l,
  });

  assert(
    preview.governedAuthorityLines.some(
      (line) =>
        line.scopeLabel === "AF - Entity" &&
        line.summaryText.includes("Draft and submit AP")
    ),
    "UI-2A should keep explainability authority coverage for entity AP submitter roles"
  );
  assert(
    preview.governedAuthorityLines.some(
      (line) =>
        line.scopeLabel === "KBL - Kabul Branch" &&
        line.summaryText.includes("Draft and submit AP")
    ),
    "UI-2A should explain branch-scoped AP submitter roles through the authority catalog"
  );
  assert(
    preview.governedAuthorityLines.some(
      (line) =>
        line.scopeLabel === "AF - Afghanistan" &&
        line.summaryText.includes("Post AP") &&
        line.summaryText.includes("Reverse AP")
    ),
    "UI-2A should keep explainability authority coverage for AP poster runtime roles"
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
      workbenchSource.includes("Organizational scope") &&
      workbenchSource.includes("Effective authority preview") &&
      workbenchSource.includes("Governed authority from roles") &&
      workbenchSource.includes("Other active role authority") &&
      workbenchSource.includes("Assignment audit & SoD warnings"),
    "UserAssignmentWorkbench should expose the planned two-panel UI-2A workbench language with role-native explainability"
  );

  console.log("test-security-ui2a-user-assignment-workbench passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
