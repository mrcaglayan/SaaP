import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWorkflowPresetCatalogEntry,
  listAccessModelCatalogSections,
  listWorkflowPresetCatalogEntries,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const accessModelPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );

  const presetEntries = listWorkflowPresetCatalogEntries();
  const presetSection = listAccessModelCatalogSections().find(
    (section) => section.key === "workflow_presets"
  );
  const apLean = getWorkflowPresetCatalogEntry("AP_LEAN_ENTITY");
  const localCloseSupervised = getWorkflowPresetCatalogEntry("LOCAL_CLOSE_GROUP_SUPERVISED");
  const consolidationControlled = getWorkflowPresetCatalogEntry("CONSOLIDATION_CONTROLLED");

  assert(presetSection, "workflow_presets section should remain available in the access-model shell");
  assert(
    presetSection.entries.every((entry) => entry.modelType === "workflow_preset" && !entry.legacy),
    "workflow presets tab should stay separate from legacy runtime rows"
  );
  assert.equal(presetEntries.length, 12, "UI-1D should surface the 12 planned shipped workflow presets");

  assert.equal(apLean.statusLabel, "Active");
  assert.equal(apLean.usesExtensionLabel, "No");
  assert.equal(apLean.stepCount, 3);
  assert.deepEqual(apLean.typicalActorLabels, ["Branch Accountant", "Entity Accountant"]);
  assert.equal(apLean.steps[0].scopeType, "OPERATING_UNIT");
  assert.equal(apLean.steps[0].requiredPackageLabel, "AP Documents / Draft & Submit");
  assert.equal(apLean.steps[0].allowSelfApprove, false);

  assert.equal(localCloseSupervised.usesExtensionLabel, "Yes");
  assert.match(localCloseSupervised.extensionNote || "", /group supervision/i);

  assert.equal(consolidationControlled.stepCount, 4);
  assert.equal(consolidationControlled.steps[3].requiredPackageLabel, "Consolidation / Finalize");

  assert(
    accessModelPageSource.includes("Workflow preset guidance") &&
      accessModelPageSource.includes("Presets should read like business flows") &&
      accessModelPageSource.includes("Preset name") &&
      accessModelPageSource.includes("Primary scope") &&
      accessModelPageSource.includes("Step count") &&
      accessModelPageSource.includes("Typical actors") &&
      accessModelPageSource.includes("Uses extension?") &&
      accessModelPageSource.includes("Active / Draft") &&
      accessModelPageSource.includes("WorkflowPresetCatalogTable"),
    "AccessModelCatalogPage should expose the dedicated UI-1D preset table surface"
  );

  assert(
    accessModelPageSource.includes("ordered steps") ||
      accessModelPageSource.includes("Ordered steps"),
    "Preset drawer should keep the ordered step preview"
  );

  assert(
    accessModelPageSource.includes("Min approver count") &&
      accessModelPageSource.includes("Self-approve rule") &&
      accessModelPageSource.includes("Escalation rule") &&
      accessModelPageSource.includes('entry.modelType === "workflow_preset"') &&
      accessModelPageSource.includes("Required packages") &&
      accessModelPageSource.includes("Uses extension?"),
    "UI-1D should expose the richer preset detail view and step configuration preview"
  );

  assert(
    accessModelPageSource.includes('to="/app/ayarlar/workflow-kurulumu"') &&
      accessModelPageSource.includes('to="/app/ayarlar/rbac/access-model?tab=workflow_packages"'),
    "UI-1D should provide workflow-governance and package-catalog handoff paths"
  );

  console.log("test-security-ui1d-workflow-presets-tab passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
