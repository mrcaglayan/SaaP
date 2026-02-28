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

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m069_journal_source_links.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const sourceLinkServiceSource = await readFile(
    path.resolve(root, "backend/src/services/journal.source-link.service.js"),
    "utf8"
  );
  const cariDocumentSource = await readFile(
    path.resolve(root, "backend/src/services/cari.document.service.js"),
    "utf8"
  );
  const cariSettlementSource = await readFile(
    path.resolve(root, "backend/src/services/cari.settlement.service.js"),
    "utf8"
  );
  const cashSource = await readFile(
    path.resolve(root, "backend/src/services/cash.service.js"),
    "utf8"
  );
  const payrollAccrualSource = await readFile(
    path.resolve(root, "backend/src/services/payroll.accruals.service.js"),
    "utf8"
  );
  const payrollCorrectionsSource = await readFile(
    path.resolve(root, "backend/src/services/payroll.corrections.service.js"),
    "utf8"
  );
  const paymentsSource = await readFile(
    path.resolve(root, "backend/src/services/payments.service.js"),
    "utf8"
  );
  const journalReadRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/gl.read.journal.routes.js"),
    "utf8"
  );

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS journal_source_links") &&
      migrationSource.includes("source_ref_type") &&
      migrationSource.includes("source_ref_id") &&
      migrationSource.includes("link_role"),
    "Migration m069 should create journal_source_links contract table with source/link fields"
  );
  assert(
    migrationIndexSource.includes('import migration069JournalSourceLinks from "./m069_journal_source_links.js"') &&
      migrationIndexSource.includes("migration069JournalSourceLinks"),
    "Migration index should register m069_journal_source_links"
  );
  assert(
    sourceLinkServiceSource.includes("export async function upsertJournalSourceLinkTx") &&
      sourceLinkServiceSource.includes("export async function listJournalSourceLinksByJournalIds") &&
      sourceLinkServiceSource.includes("INSERT INTO journal_source_links"),
    "Source-link service should expose transactional upsert + list helpers"
  );

  assert(
    cariDocumentSource.includes("sourceRefType: \"CARI_DOCUMENT\"") &&
      cariDocumentSource.includes("linkRole: \"REVERSAL_OF\""),
    "Cari document posting/reversal should write CARI_DOCUMENT source links"
  );
  assert(
    cariSettlementSource.includes("sourceRefType: \"CARI_SETTLEMENT_BATCH\"") &&
      cariSettlementSource.includes("linkRole: \"REVERSAL_OF\""),
    "Cari settlement posting/reversal should write CARI_SETTLEMENT_BATCH source links"
  );
  assert(
    cashSource.includes("sourceRefType: \"CASH_TRANSACTION\""),
    "Cash posting should write CASH_TRANSACTION source links"
  );
  assert(
    payrollAccrualSource.includes("sourceRefType: \"PAYROLL_RUN\""),
    "Payroll accrual posting should write PAYROLL_RUN source links"
  );
  assert(
    payrollCorrectionsSource.includes("sourceRefType: \"PAYROLL_RUN\"") &&
      payrollCorrectionsSource.includes("linkRole: \"REVERSAL_OF\""),
    "Payroll run reversal flow should link reversal journal back to payroll runs"
  );
  assert(
    paymentsSource.includes("sourceRefType: \"PAYMENT_BATCH\""),
    "Payment batch posting should write PAYMENT_BATCH source links"
  );
  assert(
    journalReadRouteSource.includes("includeSourceLinks") &&
      journalReadRouteSource.includes("source_links"),
    "GL journal read routes should expose source_links contract for journal detail/list"
  );

  console.log(
    "RS-DEP-02 smoke test passed (journal source-link contract migration + posting writes + journal read surface)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
