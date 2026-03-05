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
  const pagePath = path.resolve(root, "frontend/src/pages/cari/CariSettlementsPage.jsx");
  const page = (await readFile(pagePath, "utf8")).replace(/\r\n/g, "\n");

  assert(
    page.includes("function resolveLegalEntityCurrencyCode(legalEntities, legalEntityId)"),
    "legal-entity currency resolver is missing"
  );
  assert(
    page.includes("if (applyCurrencyManuallyEdited)") &&
      page.includes("resolveLegalEntityCurrencyCode(\n      legalEntities,\n      applyForm.legalEntityId"),
    "apply currency auto-derive from legal entity is missing"
  );
  assert(
    page.includes("if (bankApplyCurrencyManuallyEdited)") &&
      page.includes("resolveLegalEntityCurrencyCode(\n      legalEntities,\n      bankApplyForm.legalEntityId"),
    "bank apply currency auto-derive from legal entity is missing"
  );

  assert(
    page.includes("Exchange first, then settle."),
    "linked register mismatch warning must direct exchange-first workflow"
  );
  assert(
    page.includes("${row.code || row.id} - ${row.name || \"-\"} (${row.currency_code || \"-\"})"),
    "linked cash register picker should show register code/name/currency labels"
  );
  assert(
    page.includes("Type account code/name") &&
      page.includes("Using counterparty ${mappedMeta.accountRoleLabel} mapped account"),
    "counterAccount picker should be code/name based with mapped-account hint"
  );

  assert(
    page.includes("<dt className=\"font-semibold text-slate-600\">settlementNo</dt>") &&
      page.includes("applyResult?.row?.settlementNo || \"-\""),
    "apply response block must surface settlementNo"
  );
  assert(
    page.includes("Type settlement no or counterparty") &&
      page.includes("selectedReverseSettlement.settlementNo"),
    "reverse lookup should prioritize settlementNo/counterparty labels"
  );

  console.log("PR-EX04 frontend settlement currency flow smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
