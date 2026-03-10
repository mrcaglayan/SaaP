import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const bankApiSource = await readFile(
    path.resolve(root, "frontend/src/api/bankAccounts.js"),
    "utf8"
  );
  assert(
    bankApiSource.includes("provisionBankAccountControlParentChild") &&
      bankApiSource.includes("/api/v1/bank/accounts/provision-control-parent-child") &&
      !bankApiSource.includes("/api/v1/bank/accounts/provision-102-child"),
    "Bank accounts API must use the neutral control-parent provisioning endpoint"
  );

  const bankPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/bank/BankAccountsPage.jsx"),
    "utf8"
  );
  assert(
    bankPageSource.includes("provisionBankAccountControlParentChild") &&
      bankPageSource.includes("selectedBankControlParentReadiness") &&
      bankPageSource.includes('"bankControlParent"') &&
      bankPageSource.includes("configured bank control parent") &&
      bankPageSource.includes("Bank control-parent readiness") &&
      bankPageSource.includes("listJournalPurposeAccounts") &&
      !bankPageSource.includes("autoProvision102") &&
      !bankPageSource.includes("provisionBankAccount102Child") &&
      !bankPageSource.includes("102 child") &&
      !bankPageSource.includes("102 subtree"),
    "BankAccountsPage must surface control-parent readiness and remove user-facing 102 provisioning language"
  );

  const orgPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    orgPageSource.includes("provisionBankAccountControlParentChild") &&
      orgPageSource.includes("selectedBankControlParentReadiness") &&
      orgPageSource.includes('"bankControlParent"') &&
      orgPageSource.includes("Bank control-parent readiness") &&
      orgPageSource.includes("configured bank control parent") &&
      !orgPageSource.includes("autoProvision102") &&
      !orgPageSource.includes("provisionBankAccount102Child") &&
      !orgPageSource.includes("102 child") &&
      !orgPageSource.includes("102 auto"),
    "OrganizationManagementPage must use neutral control-parent copy and readiness for inline bank creation"
  );

  const glSetupSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/GlSetupPage.jsx"),
    "utf8"
  );
  assert(
    glSetupSource.includes("selectedManualBankReadiness") &&
      glSetupSource.includes('"bankControlParent"') &&
      glSetupSource.includes("getBankPurposeMappingStatus(") &&
      glSetupSource.includes("BANK rows define the control parent used by strict bank setup."),
    "GlSetupPage must wire BANK purpose status through bankControlParent module readiness"
  );

  console.log("PR-BPM03 frontend smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
