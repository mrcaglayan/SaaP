/**
 * FA44 browser-test seed script.
 *
 * Creates the minimal fixtures needed for drillback verification:
 *   - A fixed-asset with a POSTED ACQUISITION transaction + journal + source link
 *   - A POSTED SALE transaction + journal + source link
 *   - A depreciation run + journal + source link
 *
 * Outputs a JSON summary with all IDs needed by the walk script.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, closePool } from "../../backend/src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "seed-summary.json");

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

async function main() {
  try {
    // ── Resolve context ──
    const ctxResult = await query(
      `SELECT le.tenant_id, le.id AS legal_entity_id, u.id AS user_id
         FROM legal_entities le
         JOIN users u ON u.tenant_id = le.tenant_id
        LIMIT 1`
    );
    const ctx = ctxResult.rows[0];
    if (!ctx) throw new Error("No legal entity + user found");

    const bookResult = await query(
      `SELECT b.id AS book_id, fp.id AS fiscal_period_id, b.calendar_id
         FROM books b
         JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
        WHERE b.tenant_id = ?
        LIMIT 1`,
      [ctx.tenant_id]
    );
    if (!bookResult.rows.length) throw new Error("No book/period found");
    const { book_id, fiscal_period_id } = bookResult.rows[0];

    // Find an asset
    const assetResult = await query(
      `SELECT id FROM fixed_assets WHERE tenant_id = ? LIMIT 1`,
      [ctx.tenant_id]
    );
    if (!assetResult.rows.length) throw new Error("No fixed asset found");
    const assetId = assetResult.rows[0].id;

    // Find an account
    const accountResult = await query(
      `SELECT a.id AS account_id
         FROM accounts a
         JOIN charts_of_accounts coa ON coa.id = a.coa_id AND coa.tenant_id = ?
        WHERE a.allow_posting = 1
        LIMIT 1`,
      [ctx.tenant_id]
    );
    if (!accountResult.rows.length) throw new Error("No posting account found");
    const accountId = accountResult.rows[0].account_id;

    // ── 1. ACQUISITION transaction + journal ──
    const acqTxResult = await query(
      `INSERT INTO fixed_asset_transactions
         (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
       VALUES (?, ?, ?, 'ACQUISITION', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
      [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
    );
    const acqTxId = acqTxResult.rows.insertId;

    const acqJNo = uniqueCode("FA44ACQ");
    const acqJResult = await query(
      `INSERT INTO journal_entries
         (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status,
          entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
       VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 seed: acquisition', ?, ?, NOW())`,
      [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, acqJNo, ctx.user_id, ctx.user_id]
    );
    const acqJournalId = acqJResult.rows.insertId;

    await query(
      `INSERT INTO journal_lines
         (journal_entry_id, line_no, account_id, description, currency_code, amount_txn, debit_base, credit_base)
       VALUES (?, 1, ?, 'FA44 debit', 'TRY', 1000, 1000, 0),
              (?, 2, ?, 'FA44 credit', 'TRY', -1000, 0, 1000)`,
      [acqJournalId, accountId, acqJournalId, accountId]
    );

    await query(
      `INSERT INTO journal_source_links
         (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
       VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', ?, 'PRIMARY')`,
      [ctx.tenant_id, ctx.legal_entity_id, acqJournalId, acqTxId]
    );

    // ── 2. SALE transaction + journal ──
    const saleTxResult = await query(
      `INSERT INTO fixed_asset_transactions
         (tenant_id, legal_entity_id, asset_id, transaction_type, status, effective_date, currency_code, book_id, fiscal_period_id)
       VALUES (?, ?, ?, 'SALE', 'POSTED', CURDATE(), 'TRY', ?, ?)`,
      [ctx.tenant_id, ctx.legal_entity_id, assetId, book_id, fiscal_period_id]
    );
    const saleTxId = saleTxResult.rows.insertId;

    const saleJNo = uniqueCode("FA44SAL");
    const saleJResult = await query(
      `INSERT INTO journal_entries
         (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status,
          entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
       VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 seed: sale', ?, ?, NOW())`,
      [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, saleJNo, ctx.user_id, ctx.user_id]
    );
    const saleJournalId = saleJResult.rows.insertId;

    await query(
      `INSERT INTO journal_lines
         (journal_entry_id, line_no, account_id, description, currency_code, amount_txn, debit_base, credit_base)
       VALUES (?, 1, ?, 'FA44 debit', 'TRY', 500, 500, 0),
              (?, 2, ?, 'FA44 credit', 'TRY', -500, 0, 500)`,
      [saleJournalId, accountId, saleJournalId, accountId]
    );

    await query(
      `INSERT INTO journal_source_links
         (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
       VALUES (?, ?, ?, 'FIXED_ASSET_TRANSACTION', ?, 'PRIMARY')`,
      [ctx.tenant_id, ctx.legal_entity_id, saleJournalId, saleTxId]
    );

    // ── 3. Depreciation run + journal ──
    let runId;
    const existingRunResult = await query(
      `SELECT id FROM fixed_asset_depreciation_runs WHERE tenant_id = ? LIMIT 1`,
      [ctx.tenant_id]
    );
    if (existingRunResult.rows.length > 0) {
      runId = existingRunResult.rows[0].id;
    } else {
      const fpResult = await query(
        `SELECT fiscal_year, period_no FROM fiscal_periods WHERE id = ? LIMIT 1`,
        [fiscal_period_id]
      );
      const fy = fpResult.rows[0].fiscal_year;
      const pn = String(fpResult.rows[0].period_no).padStart(2, "0");
      const runInsert = await query(
        `INSERT INTO fixed_asset_depreciation_runs
           (tenant_id, legal_entity_id, fiscal_period_id, period_key, book_id, status, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)`,
        [ctx.tenant_id, ctx.legal_entity_id, fiscal_period_id, `${fy}-${pn}`, book_id, ctx.user_id]
      );
      runId = runInsert.rows.insertId;
    }

    const runJNo = uniqueCode("FA44RUN");
    const runJResult = await query(
      `INSERT INTO journal_entries
         (tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status,
          entry_date, document_date, currency_code, description, created_by_user_id, posted_by_user_id, posted_at)
       VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', CURDATE(), CURDATE(), 'TRY', 'FA44 seed: run', ?, ?, NOW())`,
      [ctx.tenant_id, ctx.legal_entity_id, book_id, fiscal_period_id, runJNo, ctx.user_id, ctx.user_id]
    );
    const runJournalId = runJResult.rows.insertId;

    await query(
      `INSERT INTO journal_lines
         (journal_entry_id, line_no, account_id, description, currency_code, amount_txn, debit_base, credit_base)
       VALUES (?, 1, ?, 'FA44 debit', 'TRY', 200, 200, 0),
              (?, 2, ?, 'FA44 credit', 'TRY', -200, 0, 200)`,
      [runJournalId, accountId, runJournalId, accountId]
    );

    await query(
      `INSERT INTO journal_source_links
         (tenant_id, legal_entity_id, journal_entry_id, source_ref_type, source_ref_id, link_role)
       VALUES (?, ?, ?, 'FIXED_ASSET_DEPRECIATION_RUN', ?, 'PRIMARY')`,
      [ctx.tenant_id, ctx.legal_entity_id, runJournalId, runId]
    );

    // ── Output summary ──
    const summary = {
      seededAt: new Date().toISOString(),
      tenantId: ctx.tenant_id,
      legalEntityId: ctx.legal_entity_id,
      userId: ctx.user_id,
      assetId,
      bookId: book_id,
      fiscalPeriodId: fiscal_period_id,
      accountId,
      acquisition: { transactionId: acqTxId, journalId: acqJournalId, journalNo: acqJNo },
      sale: { transactionId: saleTxId, journalId: saleJournalId, journalNo: saleJNo },
      run: { runId, journalId: runJournalId, journalNo: runJNo },
    };

    await fs.writeFile(OUT_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: true, outputPath: OUT_PATH, summary }, null, 2));
  } finally {
    await closePool();
  }
}

main();
