/**
 * STEP-FA02 — Duplicate-PRIMARY preflight for journal_source_links
 *
 * Reports journals that violate the planned one-PRIMARY-per-journal rule
 * and defines deterministic normalization behavior for legacy rows.
 *
 * Usage:
 *   node scripts/preflight-journal-source-link-primary.js
 *   npm run preflight:journal-source-link-primary
 *
 * Exit codes:
 *   0 — clean (no duplicate-PRIMARY journals found)
 *   1 — blocking duplicates found or unexpected error
 *
 * Output ordering is deterministic: sorted by tenant_id ASC, journal_entry_id ASC.
 *
 * ─── Normalization rule (for later enforcement migration) ───────────
 *
 * DUPLICATE-PRIMARY (journal has N > 1 rows with link_role = 'PRIMARY'):
 *   Survivor:  the PRIMARY row whose source_ref_type is the module-specific
 *              owning type (not a shared infrastructure type).  When the
 *              journal has exactly one module-specific PRIMARY and one or more
 *              infrastructure-type PRIMARYs, the module-specific row survives.
 *              If all PRIMARYs are the same source_ref_type or multiple
 *              module-specific types compete, the row with the lowest id
 *              (earliest insert) survives.
 *   Demotion:  non-surviving PRIMARY rows are updated to link_role = 'SUPPORTING'.
 *
 *   Infrastructure types (shared plumbing, not the business owner):
 *     CASH_TRANSACTION
 *
 *   Module-specific types (the business-level owner of the journal):
 *     CARI_DOCUMENT, CARI_SETTLEMENT_BATCH, PAYMENT_BATCH, PAYROLL_RUN,
 *     INVENTORY_MOVEMENT, INVENTORY_TRANSFER, FIXED_ASSET_TRANSACTION,
 *     FIXED_ASSET_DEPRECIATION_RUN, and any other non-infrastructure type.
 *
 * ZERO-PRIMARY (journal has rows in journal_source_links but none with
 *               link_role = 'PRIMARY'):
 *   Classification: warning-only, NOT blocking for DB enforcement.
 *   Reason: the planned UNIQUE partial index enforces at-most-one PRIMARY,
 *           which zero satisfies.  Zero-PRIMARY journals are either:
 *           - pre-m069 journals that were never backfilled
 *           - manual journal entries (legitimately no source link)
 *   Remediation: optional backfill by module owners in later steps.
 *
 * ─── Writer modules that produce PRIMARY rows today ────────────────
 *
 *   source_ref_type          | writer service
 *   ─────────────────────────┼──────────────────────────────────────
 *   CASH_TRANSACTION         | cash.service.js
 *   CARI_DOCUMENT            | cari.document.service.js
 *   CARI_SETTLEMENT_BATCH    | cari.settlement.service.js
 *   PAYMENT_BATCH            | payments.service.js
 *   PAYROLL_RUN              | payroll.accruals.service.js
 *   INVENTORY_MOVEMENT       | inventory.service.js
 *   INVENTORY_TRANSFER       | inventory.transfer.service.js
 *
 *   Known cross-module duplicate-PRIMARY scenario:
 *     CARI settlement calls createAndPostCashJournalTx (→ cash.service
 *     writes PRIMARY/CASH_TRANSACTION) then writes its own
 *     PRIMARY/CARI_SETTLEMENT_BATCH to the same journal.
 *
 *   Modules that must be updated before DB guard is safe:
 *     1. cari.settlement.service.js — stop writing PRIMARY for the
 *        infrastructure CASH_TRANSACTION link (use SUPPORTING or
 *        RELATED_CASH_TXN instead), OR have cash.service.js accept a
 *        caller-supplied link_role override.
 *     2. Any future module that follows the same shared-journal pattern.
 * ────────────────────────────────────────────────────────────────────
 */

import "dotenv/config";
import { closePool, query } from "../src/db.js";

// Source-ref types that represent shared infrastructure plumbing rather
// than the business owner of the journal.
const INFRASTRUCTURE_TYPES = new Set(["CASH_TRANSACTION"]);

function isInfrastructureType(sourceRefType) {
  return INFRASTRUCTURE_TYPES.has(String(sourceRefType || "").toUpperCase());
}

/**
 * Given an array of PRIMARY rows for one journal, returns the id of the
 * row that should survive as PRIMARY under the normalization rule.
 */
function pickSurvivor(primaryRows) {
  if (primaryRows.length <= 1) {
    return primaryRows[0]?.id ?? null;
  }

  const moduleSpecific = primaryRows.filter(
    (r) => !isInfrastructureType(r.source_ref_type)
  );
  const pool =
    moduleSpecific.length > 0 ? moduleSpecific : primaryRows;

  // Lowest id (earliest insert) wins among the candidate pool.
  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (Number(pool[i].id) < Number(best.id)) {
      best = pool[i];
    }
  }
  return best?.id ?? null;
}

async function tableExists(tableName) {
  try {
    const result = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = ?
       LIMIT 1`,
      [tableName]
    );
    return (result.rows || []).length > 0;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== STEP-FA02: journal_source_links duplicate-PRIMARY preflight ===\n");

  // ── guard: table must exist ───────────────────────────────────────
  const exists = await tableExists("journal_source_links");
  if (!exists) {
    console.log("journal_source_links table does not exist (pre-m069). Nothing to check.");
    console.log("\nResult: CLEAN (table absent)");
    return 0;
  }

  // ── 1. Find journals with multiple PRIMARY rows ───────────────────
  const duplicateResult = await query(
    `SELECT
        jsl.tenant_id,
        jsl.journal_entry_id,
        COUNT(*) AS primary_count
     FROM journal_source_links jsl
     WHERE jsl.link_role = 'PRIMARY'
     GROUP BY jsl.tenant_id, jsl.journal_entry_id
     HAVING COUNT(*) > 1
     ORDER BY jsl.tenant_id ASC, jsl.journal_entry_id ASC`
  );
  const duplicateJournals = duplicateResult.rows || [];

  // ── 2. Find journals that have rows but zero PRIMARY ──────────────
  const zeroPrimaryResult = await query(
    `SELECT
        jsl.tenant_id,
        jsl.journal_entry_id,
        COUNT(*) AS total_links,
        GROUP_CONCAT(DISTINCT jsl.link_role ORDER BY jsl.link_role SEPARATOR ', ') AS link_roles
     FROM journal_source_links jsl
     WHERE jsl.journal_entry_id NOT IN (
       SELECT journal_entry_id
       FROM journal_source_links
       WHERE link_role = 'PRIMARY'
     )
     GROUP BY jsl.tenant_id, jsl.journal_entry_id
     ORDER BY jsl.tenant_id ASC, jsl.journal_entry_id ASC`
  );
  const zeroPrimaryJournals = zeroPrimaryResult.rows || [];

  // ── 3. Overall stats ─────────────────────────────────────────────
  const statsResult = await query(
    `SELECT
        link_role,
        COUNT(*) AS row_count,
        COUNT(DISTINCT journal_entry_id) AS journal_count
     FROM journal_source_links
     GROUP BY link_role
     ORDER BY link_role ASC`
  );
  const stats = statsResult.rows || [];

  console.log("── Link-role distribution ──");
  for (const row of stats) {
    console.log(
      `  ${String(row.link_role).padEnd(20)} ${String(row.row_count).padStart(8)} rows across ${String(row.journal_count).padStart(8)} journals`
    );
  }
  console.log();

  // ── 4. Report duplicate-PRIMARY journals ──────────────────────────
  console.log(`── Duplicate-PRIMARY journals: ${duplicateJournals.length} ──`);

  if (duplicateJournals.length > 0) {
    // Fetch the actual PRIMARY rows for each duplicate journal
    const dupJournalIds = duplicateJournals.map((r) => r.journal_entry_id);
    const batchSize = 500;
    const allDupRows = [];

    for (let i = 0; i < dupJournalIds.length; i += batchSize) {
      const batch = dupJournalIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => "?").join(", ");
      const detailResult = await query(
        `SELECT
            id,
            tenant_id,
            journal_entry_id,
            source_ref_type,
            source_ref_id,
            link_role,
            created_at
         FROM journal_source_links
         WHERE link_role = 'PRIMARY'
           AND journal_entry_id IN (${placeholders})
         ORDER BY journal_entry_id ASC, id ASC`,
        batch
      );
      allDupRows.push(...(detailResult.rows || []));
    }

    // Group by journal
    const byJournal = new Map();
    for (const row of allDupRows) {
      const key = Number(row.journal_entry_id);
      if (!byJournal.has(key)) {
        byJournal.set(key, []);
      }
      byJournal.get(key).push(row);
    }

    // Group by source_ref_type combination for summary
    const comboCounts = new Map();

    for (const [journalId, rows] of [...byJournal.entries()].sort(
      (a, b) => a[0] - b[0]
    )) {
      const survivorId = pickSurvivor(rows);
      const types = rows
        .map((r) => r.source_ref_type)
        .sort()
        .join(" + ");
      comboCounts.set(types, (comboCounts.get(types) || 0) + 1);

      console.log(
        `\n  journal_entry_id=${journalId}  tenant_id=${rows[0].tenant_id}  primary_count=${rows.length}`
      );
      for (const r of rows) {
        const tag = Number(r.id) === Number(survivorId) ? "KEEP" : "DEMOTE→SUPPORTING";
        console.log(
          `    id=${r.id}  ${r.source_ref_type}:${r.source_ref_id}  [${tag}]`
        );
      }
    }

    console.log("\n── Duplicate-PRIMARY by source-ref-type combination ──");
    for (const [combo, count] of [...comboCounts.entries()].sort()) {
      console.log(`  ${combo.padEnd(50)} ${count}`);
    }
  }

  // ── 5. Report zero-PRIMARY journals ───────────────────────────────
  console.log(`\n── Zero-PRIMARY journals (warning-only): ${zeroPrimaryJournals.length} ──`);

  if (zeroPrimaryJournals.length > 0) {
    const roleCounts = new Map();
    for (const row of zeroPrimaryJournals) {
      const roles = String(row.link_roles || "(none)");
      roleCounts.set(roles, (roleCounts.get(roles) || 0) + 1);
    }

    console.log("  Grouped by existing link_roles:");
    for (const [roles, count] of [...roleCounts.entries()].sort()) {
      console.log(`    ${roles.padEnd(40)} ${count} journals`);
    }

    if (zeroPrimaryJournals.length <= 20) {
      for (const row of zeroPrimaryJournals) {
        console.log(
          `    journal_entry_id=${row.journal_entry_id}  tenant_id=${row.tenant_id}  links=${row.total_links}  roles=[${row.link_roles}]`
        );
      }
    }
  }

  // ── 6. Summary / exit code ────────────────────────────────────────
  console.log("\n── Normalization rule summary ──");
  console.log("  Duplicate-PRIMARY survivor: module-specific source_ref_type wins over");
  console.log("    infrastructure types (CASH_TRANSACTION). Ties broken by lowest id.");
  console.log("  Demotion target: link_role = 'SUPPORTING'");
  console.log("  Zero-PRIMARY: warning-only, not blocking for UNIQUE constraint.");

  console.log("\n── Modules requiring writer cleanup before DB enforcement ──");
  console.log("  1. cari.settlement.service.js (CARI_SETTLEMENT_BATCH + CASH_TRANSACTION)");
  console.log("     → cash.service PRIMARY should be demoted or the settlement should");
  console.log("       pass a non-PRIMARY role when creating cash journals on behalf of");
  console.log("       the settlement workflow.");
  console.log("  2. Any future shared-journal flow that writes PRIMARY from two modules.");

  if (duplicateJournals.length > 0) {
    console.log(
      `\nResult: BLOCKING — ${duplicateJournals.length} journal(s) have duplicate PRIMARY rows.`
    );
    console.log("These must be normalized before a UNIQUE partial index can be added.");
    return 1;
  }

  console.log(
    `\nResult: CLEAN — no duplicate PRIMARY rows found.${
      zeroPrimaryJournals.length > 0
        ? ` (${zeroPrimaryJournals.length} zero-PRIMARY warnings)`
        : ""
    }`
  );
  return 0;
}

main()
  .then(async (exitCode) => {
    await closePool();
    process.exit(exitCode);
  })
  .catch(async (err) => {
    console.error("Preflight failed:", err);
    await closePool().catch(() => {});
    process.exit(1);
  });
