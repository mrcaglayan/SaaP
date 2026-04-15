import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWorkflowPackageCatalogEntry,
  getWorkflowPresetCatalogEntry,
  listAccessModelCatalogSections,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const accessModelPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );

  const sections = listAccessModelCatalogSections();
  const packageEntry = getWorkflowPackageCatalogEntry("PKG-PC-CLOSE");
  const presetEntry = getWorkflowPresetCatalogEntry("AP_LEAN_ENTITY");

  assert.equal(sections.length, 2, "matrix mode should stay on top of the package and preset catalog tabs");
  assert.match(
    packageEntry.runtimeMappingLabel || "",
    /GLPostingAuthority/i,
    "workflow-package comparison should surface companion-only mapping posture"
  );
  assert(presetEntry.steps.length > 0, "workflow-preset comparison should use ordered step metadata");

  assert(
    accessModelPageSource.includes("ACCESS_MODEL_VIEW_ORDER") &&
      accessModelPageSource.includes("Compare matrix") &&
      accessModelPageSource.includes("Matrix comparison") &&
      accessModelPageSource.includes("MatrixCandidatePicker") &&
      accessModelPageSource.includes("AccessModelComparisonMatrix") &&
      accessModelPageSource.includes("buildWorkflowPackageMatrixGroups") &&
      accessModelPageSource.includes("buildWorkflowPresetMatrixGroups") &&
      accessModelPageSource.includes("view: \"matrix\"") &&
      accessModelPageSource.includes("compare: joinMatrixCompareCodes("),
    "UX-RBAC-05 should add a URL-backed matrix mode without replacing the browse-first shell"
  );

  assert(
    accessModelPageSource.includes("Permission modules") &&
      accessModelPageSource.includes("Scope coverage") &&
      accessModelPageSource.includes("Granted") &&
      accessModelPageSource.includes("Not granted") &&
      accessModelPageSource.includes("Companion-only") &&
      accessModelPageSource.includes("Linked") &&
      accessModelPageSource.includes("Ordered steps"),
    "UX-RBAC-05 should compare module families, scopes, package links, and preset steps with distinct status indicators"
  );

  assert(
    accessModelPageSource.includes("Workflow assignment routing visibility") &&
      accessModelPageSource.includes("Amount-band routing stays reachable from matrix context") &&
      accessModelPageSource.includes("Open workflow routing matrix") &&
      accessModelPageSource.includes("Open access debugger") &&
      accessModelPageSource.includes("/app/ayarlar/security-admin/workflows?tab=definitions") &&
      accessModelPageSource.includes("/app/ayarlar/security-admin/diagnostics?tab=access"),
    "UX-RBAC-05 should keep workflow routing and diagnostics reachable from matrix context"
  );

  console.log("test-security-ux-rbac-05-matrix-view-upgrade passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
