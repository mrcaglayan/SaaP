import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAccessDiagnosticsSummary } from "../../frontend/src/pages/security/accessDiagnosticsSummary.js";

function formatTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([.\w]+)\s*\}\}/g, (_, key) => {
    const resolvedValue = values?.[key];
    return resolvedValue == null ? "" : String(resolvedValue);
  });
}

function l(english, _turkish, values) {
  return formatTemplate(english, values);
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessDebuggerPage.jsx"),
    "utf8"
  );
  const sidebarSource = await readFile(
    path.resolve(rootDir, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );

  const lookups = {
    groups: [{ id: 7, code: "GRP", name: "Main Group" }],
    countries: [{ id: 4, iso2: "AF", iso3: "AFG", name: "Afghanistan" }],
    legalEntities: [
      {
        id: 1,
        code: "AF",
        name: "AFGHANTURK MAARIF FOUNDATION",
        group_company_id: 7,
        country_id: 4,
      },
    ],
    operatingUnits: [
      {
        id: 10,
        code: "KBL",
        name: "Kabul Branch",
        legal_entity_id: 1,
      },
    ],
  };

  const viewOnlySummary = buildAccessDiagnosticsSummary({
    assignments: [
      {
        id: 11,
        role_code: "WORKFLOW_PACKAGE__PKG-AP-VIEW",
        scope_type: "LEGAL_ENTITY",
        scope_id: 1,
        effect: "ALLOW",
      },
    ],
    workflowFamily: "AP_DOCUMENT_POSTING",
    scopeType: "LEGAL_ENTITY",
    scopeId: 1,
    lookups,
    tenantScopeId: 99,
    l,
  });

  assert.equal(
    viewOnlySummary.finalResult.title,
    "View only",
    "UI-5A should tell admins when a user can view but cannot act at the selected workflow family and scope"
  );
  assert.equal(
    viewOnlySummary.missingPackageText.includes("can view"),
    true,
    "UI-5A should call out missing action-package coverage when only view authority exists"
  );

  const scopeMismatchSummary = buildAccessDiagnosticsSummary({
    assignments: [
      {
        id: 21,
        role_code: "WORKFLOW_PACKAGE__PKG-AP-APPROVE",
        scope_type: "COUNTRY",
        scope_id: 88,
        effect: "ALLOW",
      },
    ],
    workflowFamily: "AP_DOCUMENT_POSTING",
    scopeType: "LEGAL_ENTITY",
    scopeId: 1,
    lookups,
    tenantScopeId: 99,
    l,
  });

  assert.equal(
    scopeMismatchSummary.finalResult.title,
    "Scope mismatch",
    "UI-5A should make scope mismatch explicit instead of hiding it inside technical details"
  );
  assert.equal(
    scopeMismatchSummary.missingScopeText.includes("other scopes"),
    true,
    "UI-5A should name that package authority exists only at other scopes"
  );

  const runtimeRoleSummary = buildAccessDiagnosticsSummary({
    assignments: [
      {
        id: 31,
        role_code: "CountryAPPoster",
        scope_type: "COUNTRY",
        scope_id: 4,
        effect: "ALLOW",
      },
    ],
    workflowFamily: "AP_DOCUMENT_POSTING",
    scopeType: "LEGAL_ENTITY",
    scopeId: 1,
    lookups,
    tenantScopeId: 99,
    l,
  });

  assert.equal(
    runtimeRoleSummary.matchingActionPackages.length,
    2,
    "UI-5A should project current runtime AP poster roles into action-package coverage"
  );
  assert.equal(
    runtimeRoleSummary.matchingActionPackages.every((item) =>
      Array.isArray(item.sourceLabels) && item.sourceLabels.includes("Runtime role source")
    ),
    true,
    "UI-5A should label runtime-role-derived package authority explicitly"
  );
  assert.equal(
    runtimeRoleSummary.matchingActionPackages.some((item) => item.packageCode === "PKG-AP-POST"),
    true,
    "UI-5A should surface the AP post package when CountryAPPoster covers the target scope"
  );

  assert(
    pageSource.includes("buildAccessDiagnosticsSummary") &&
      pageSource.includes("listRoleAssignments") &&
      pageSource.includes('l("Business-facing diagnosis", "Is-odakli tani")') &&
      pageSource.includes('l("Matching scopes", "Eslesen kapsamlar")') &&
      pageSource.includes('l("Matching scopes and blockers", "Eslesen kapsamlar ve engeller")') &&
      pageSource.includes('l("Technical access chain", "Teknik erisim zinciri")'),
    "AccessDebuggerPage should render the new UI-5A business diagnostics surface on top of the older technical checker"
  );

  assert(
    sidebarSource.includes('label: "Erisim Tanilari"'),
    "The sidebar entry should present the page as Access Diagnostics instead of the older debugger wording"
  );

  console.log("test-security-ui5a-access-diagnostics-page passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
