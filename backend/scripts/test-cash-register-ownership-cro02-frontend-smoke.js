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
  const pagePath = path.resolve(root, "frontend/src/pages/cash/CashRegistersPage.jsx");
  const messagesPath = path.resolve(root, "frontend/src/i18n/messages.js");
  const page = await readFile(pagePath, "utf8");
  const messages = await readFile(messagesPath, "utf8");

  assert(
    page.includes('const OWNERSHIP_SCOPES = ["CENTRAL", "OPERATING_UNIT"];'),
    "CashRegistersPage should define explicit ownership scope options"
  );
  assert(
    page.includes('ownershipScope: "OPERATING_UNIT"'),
    "CashRegistersPage empty form should default ownershipScope to OPERATING_UNIT"
  );
  assert(
    page.includes("normalizeOwnershipScope("),
    "CashRegistersPage should normalize ownership scope from API rows"
  );
  assert(
    page.includes("ownershipScope: normalizedOwnershipScope"),
    "CashRegistersPage submit payload should send ownershipScope"
  );
  assert(
    page.includes("isOperatingUnitOwned ? ("),
    "CashRegistersPage should render operating unit picker only for OU-owned registers"
  );
  assert(
    page.includes('t("cashRegisters.values.centralHq")'),
    "CashRegistersPage should render explicit Central / HQ copy"
  );
  assert(
    page.includes('t("cashRegisters.table.ownership")'),
    "CashRegistersPage table should include an ownership column"
  );
  assert(
    page.includes("resolveOwnershipMeta(row, t)"),
    "CashRegistersPage table rows should derive ownership labels and badges"
  );

  const requiredKeys = [
    "cashRegisters.form.ownershipScope",
    "cashRegisters.form.ownershipCentralHelp",
    "cashRegisters.form.ownershipOperatingUnitHelp",
    "cashRegisters.form.operatingUnitHiddenForCentral",
    "cashRegisters.table.ownership",
    "cashRegisters.values.ownershipCentral",
    "cashRegisters.values.ownershipOperatingUnit",
    "cashRegisters.values.centralHq",
    "cashRegisters.errors.operatingUnitRequiredForOwnership",
  ];
  for (const key of requiredKeys) {
    assert(messages.includes(key.split(".").pop()), `messages.js should include ${key}`);
  }

  console.log("Cash register ownership CRO02 frontend smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
