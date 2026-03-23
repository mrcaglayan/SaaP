/**
 * STEP-FA27 smoke test — Draft-link revalidation, source drift refresh,
 * and activation-time safeguards.
 *
 * Proves:
 *  1. Safe amount drift auto-refreshes source-derived cost fields on activation.
 *  2. Quantity/unit-slot drift that invalidates the reserved slot blocks activation.
 *  3. Non-POSTED source document blocks activation.
 *  4. Threshold-path drift (low-value ↔ standard) blocks activation.
 *  5. User-owned fields (category, owner OU, etc.) are never overwritten by refresh.
 *
 * Approach: Uses direct service calls + DB manipulation to simulate source drift,
 * since CARI documents are normally immutable once POSTED.
 */

import bcrypt from "bcrypt";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query, withTransaction } from "../src/db.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
} from "../src/services/cari.document.service.js";
import {
  createAssetsFromCariDocumentLineFa06,
} from "../src/services/fixed-assets.service.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA27_SMOKE_KEEP_ARTIFACTS,
  true
);

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function minDate(a, b) {
  return a <= b ? a : b;
}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: { "user-agent": "fa27-revalidation-smoke" },
    ip: "127.0.0.1",
    user: { tenantId, userId },
    tenantId,
  };
}

function allowAllScopes() {}

// ── Fixture resolution ────────────────────────────────────────────

async function resolveTenantAdminRoleId(tenantId) {
  const result = await query(
    `SELECT id FROM roles WHERE tenant_id = ? AND code = 'TenantAdmin' LIMIT 1`,
    [tenantId]
  );
  const roleId = Number(result.rows?.[0]?.id || 0);
  assert(roleId > 0, `TenantAdmin role not found for tenant ${tenantId}`);
  return roleId;
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA27" });
}

async function resolveActiveOperatingUnitIds(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id FROM operating_units
      WHERE tenant_id = ? AND legal_entity_id = ? AND status = 'ACTIVE'
      ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  const rows = result.rows || [];
  assert(rows.length > 0, "No ACTIVE operating units found");
  return {
    ownerOuId: Number(rows[0].id),
    locationOuId: Number((rows[1] || rows[0]).id),
  };
}

async function resolveOpenPostingWindow(tenantId, legalEntityId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await query(
    `SELECT fp.start_date, fp.end_date
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id AND ps.fiscal_period_id = fp.id
      WHERE b.tenant_id = ? AND b.legal_entity_id = ?
        AND b.book_type = 'LOCAL' AND fp.is_adjustment = 0
        AND COALESCE(ps.status, 'OPEN') = 'OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC
      LIMIT 1`,
    [tenantId, legalEntityId, today]
  );
  const row = result.rows?.[0];
  assert(row, "No OPEN fiscal period found");
  return {
    documentDate: row.start_date,
    capitalizationDate: minDate(addDays(row.start_date, 1), row.end_date),
    inServiceDate: minDate(addDays(row.start_date, 2), row.end_date),
    postingDate: minDate(addDays(row.start_date, 3), row.end_date),
    dueDate: addDays(row.start_date, 10),
  };
}

async function resolvePostableAccountId(tenantId, legalEntityId, accountType) {
  const result = await query(
    `SELECT a.id FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
        AND a.account_type = ? AND a.is_active = 1 AND a.allow_posting = 1
      ORDER BY a.id ASC LIMIT 1`,
    [tenantId, legalEntityId, accountType]
  );
  const id = Number(result.rows?.[0]?.id || 0);
  assert(id > 0, `No usable ${accountType} account`);
  return id;
}

async function resolvePostableAccountIds(tenantId, legalEntityId, accountType) {
  const result = await query(
    `SELECT a.id FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
        AND a.account_type = ? AND a.is_active = 1 AND a.allow_posting = 1
      ORDER BY a.id ASC`,
    [tenantId, legalEntityId, accountType]
  );
  return (result.rows || []).slice(0, 2).map((r) => Number(r.id));
}

// ── Fixture creation ──────────────────────────────────────────────

async function createSmokeUser({ tenantId, uniqueSuffix, state }) {
  const password = "FA27Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa27.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA27 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create smoke user");

  const roleId = await resolveTenantAdminRoleId(tenantId);
  await query(
    `INSERT INTO user_role_scopes (tenant_id, user_id, role_id, scope_type, scope_id, effect)
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
    [tenantId, userId, roleId, tenantId]
  );
  state.createdUserIds.push(userId);
  state.createdUserRoleScopeUserIds.push(userId);
  return { userId, email, password };
}

async function ensureSmokeVendor({ tenantId, legalEntityId, currencyCode, liabilityAccountId, state }) {
  const reusable = await query(
    `SELECT id FROM counterparties
      WHERE tenant_id = ? AND legal_entity_id = ? AND is_vendor = 1
        AND status = 'ACTIVE' AND ap_account_id IS NOT NULL
      ORDER BY id ASC LIMIT 1`,
    [tenantId, legalEntityId]
  );
  if (reusable.rows?.[0]) return { counterpartyId: Number(reusable.rows[0].id), created: false };

  const insertResult = await query(
    `INSERT INTO counterparties (
        tenant_id, legal_entity_id, primary_operating_unit_id,
        code, name, is_customer, is_vendor,
        default_currency_code, ar_account_id, ap_account_id,
        status, notes
     ) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, NULL, ?, 'ACTIVE', ?)`,
    [
      tenantId, legalEntityId,
      `FA27VND${Date.now().toString().slice(-8)}`,
      `FA27 Smoke Vendor`,
      currencyCode, liabilityAccountId,
      "Vendor for FA27 smoke",
    ]
  );
  const counterpartyId = Number(insertResult.rows?.insertId || 0);
  assert(counterpartyId > 0, "Failed to create vendor");
  state.createdCounterpartyIds.push(counterpartyId);
  return { counterpartyId, created: true };
}

async function createSmokeProfile({ tenantId, legalEntityId, userId, uniqueSuffix, state }) {
  const insertResult = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id, legal_entity_id, code, name, status, method,
        declining_balance_rate_percent, switch_to_straight_line,
        description, created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE', NULL, 0, ?, ?, ?)`,
    [tenantId, legalEntityId, `FA27PF${uniqueSuffix.slice(-6)}`,
     `FA27 Smoke Profile`, "FA27 smoke", userId, userId]
  );
  const profileId = Number(insertResult.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create profile");
  state.createdProfileIds.push(profileId);
  return profileId;
}

async function createSmokeCategory({
  tenantId, legalEntityId, userId, profileId, accounts,
  uniqueSuffix, state, thresholdBase = 1000,
}) {
  const insertResult = await query(
    `INSERT INTO fixed_asset_categories (
        tenant_id, legal_entity_id, code, name, status, description,
        capitalization_threshold_base, default_useful_life_months,
        default_salvage_rule_type, default_salvage_amount_base,
        default_depreciation_profile_id,
        default_asset_account_id, default_accum_depr_account_id,
        default_depr_expense_account_id, default_disposal_gain_account_id,
        default_disposal_loss_account_id,
        created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 24, 'NONE', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId, legalEntityId, `FA27CT${uniqueSuffix.slice(-6)}`,
      `FA27 Smoke Category`, "FA27 smoke",
      thresholdBase, profileId,
      accounts.assetAccountId, accounts.accumDeprAccountId,
      accounts.deprExpenseAccountId, accounts.disposalGainAccountId,
      accounts.disposalLossAccountId,
      userId, userId,
    ]
  );
  const categoryId = Number(insertResult.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create category");
  state.createdCategoryIds.push(categoryId);
  return categoryId;
}

/**
 * Create a posted AP document and return document id + line id.
 * lineQuantity and lineAmount control the source line shape.
 */
async function createPostedApDoc({
  tenantId, legalEntityId, userId, counterpartyId, operatingUnitId,
  currencyCode, documentDate, dueDate, postingAccountId,
  lineQuantity, lineAmount,
}) {
  const stamp = `${Date.now()}`;
  const draft = await createCariDraftDocument({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: "fa27-create" }),
    payload: {
      tenantId, userId, legalEntityId, counterpartyId,
      paymentTermId: null, direction: "AP", documentType: "INVOICE",
      documentDate, dueDate, currencyCode, operatingUnitId,
      lines: [{
        description: "FA27 Smoke Source Line",
        quantity: lineQuantity,
        postingAccountId,
        lineNetAmountTxn: lineAmount,
        lineTaxAmountTxn: 0,
        lineGrossAmountTxn: lineAmount,
      }],
    },
    assertScopeAccess: allowAllScopes,
  });

  const posted = await postCariDocumentById({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: "fa27-post" }),
    payload: { tenantId, userId, documentId: draft.id },
    assertScopeAccess: allowAllScopes,
  });

  const docId = Number(posted?.id || draft?.id || 0);
  assert(docId > 0, "Failed to create posted AP doc");

  const lineRows = await query(
    `SELECT id FROM cari_document_lines WHERE cari_document_id = ? AND tenant_id = ? ORDER BY id ASC LIMIT 1`,
    [docId, tenantId]
  );
  const lineId = Number(lineRows.rows?.[0]?.id || 0);
  assert(lineId > 0, "Posted doc has no lines");

  return { documentId: docId, lineId };
}

/**
 * Create a single FA06 asset (ACTIVE) from a source line,
 * then reset it to DRAFT so we can test revalidation on activation.
 */
async function createDraftLinkedAsset({
  tenantId, legalEntityId, userId, req,
  documentId, lineId, categoryId, ownerOuId, locationOuId,
  capitalizationDate, inServiceDate, state,
}) {
  const result = await createAssetsFromCariDocumentLineFa06({
    req,
    tenantId,
    sourceCariDocumentId: documentId,
    sourceCariDocumentLineId: lineId,
    unitCount: 1,
    categoryId,
    ownerOperatingUnitId: ownerOuId,
    locationOperatingUnitId: locationOuId,
    capitalizationDate,
    inServiceDate,
    userId,
    assertScopeAccess: allowAllScopes,
  });

  const assets = result?.assets || result?.rows || [result];
  const assetId = Number(assets[0]?.id || assets[0]?.assetId || 0);
  assert(assetId > 0, "Failed to create FA06 asset");
  state.createdAssetIds.push(assetId);

  // Reset to DRAFT so we can test revalidation during activation
  await query(
    `UPDATE fixed_assets SET status = 'DRAFT' WHERE id = ? AND tenant_id = ?`,
    [assetId, tenantId]
  );
  // Delete the CAPITALIZATION transaction so activateAsset can create ACQUISITION
  await query(
    `DELETE FROM fixed_asset_transactions WHERE asset_id = ? AND tenant_id = ?`,
    [assetId, tenantId]
  );

  return assetId;
}

// ── Cleanup ───────────────────────────────────────────────────────

async function cleanupState(state) {
  for (const assetId of state.createdAssetIds.slice().reverse()) {
    await query(`DELETE FROM fixed_asset_transactions WHERE asset_id = ?`, [assetId]);
  }
  for (const journalEntryId of state.createdJournalEntryIds.slice().reverse()) {
    await query(`DELETE FROM journal_source_links WHERE journal_entry_id = ?`, [journalEntryId]);
    await query(`DELETE FROM journal_lines WHERE journal_entry_id = ?`, [journalEntryId]);
    await query(`DELETE FROM journal_entries WHERE id = ?`, [journalEntryId]);
  }
  for (const assetId of state.createdAssetIds.slice().reverse()) {
    await query(`DELETE FROM fixed_assets WHERE id = ?`, [assetId]);
  }
  for (const categoryId of state.createdCategoryIds.slice().reverse()) {
    await query(`DELETE FROM fixed_asset_categories WHERE id = ?`, [categoryId]);
  }
  for (const profileId of state.createdProfileIds.slice().reverse()) {
    await query(`DELETE FROM fixed_asset_depreciation_profiles WHERE id = ?`, [profileId]);
  }
  for (const counterpartyId of state.createdCounterpartyIds.slice().reverse()) {
    await query(`DELETE FROM counterparties WHERE id = ?`, [counterpartyId]);
  }
  for (const userId of Array.from(new Set(state.createdUserRoleScopeUserIds)).reverse()) {
    await query(`DELETE FROM user_role_scopes WHERE user_id = ?`, [userId]);
  }
  for (const userId of state.createdUserIds.slice().reverse()) {
    await query(`DELETE FROM users WHERE id = ?`, [userId]);
  }
}

// ── Direct activateAsset import ───────────────────────────────────
import { activateAsset } from "../src/services/fixed-assets.service.js";

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const state = {
    createdUserIds: [],
    createdUserRoleScopeUserIds: [],
    createdCounterpartyIds: [],
    createdProfileIds: [],
    createdCategoryIds: [],
    createdAssetIds: [],
    createdJournalEntryIds: [],
  };
  const uniqueSuffix = `${Date.now()}`;

  try {
    console.log("[fa27-smoke] Resolving smoke context...");
    const ctx = await resolveSmokeContext();
    console.log(`[fa27-smoke] Context: tenant=${ctx.tenantId}, LE=${ctx.legalEntityId}`);

    const pw = await resolveOpenPostingWindow(ctx.tenantId, ctx.legalEntityId);
    const ous = await resolveActiveOperatingUnitIds(ctx.tenantId, ctx.legalEntityId);
    const assetAccountIds = await resolvePostableAccountIds(ctx.tenantId, ctx.legalEntityId, "ASSET");
    const expenseAccountIds = await resolvePostableAccountIds(ctx.tenantId, ctx.legalEntityId, "EXPENSE");
    const revenueAccountId = await resolvePostableAccountId(ctx.tenantId, ctx.legalEntityId, "REVENUE");
    const liabilityAccountId = await resolvePostableAccountId(ctx.tenantId, ctx.legalEntityId, "LIABILITY");
    const postingAccountId = expenseAccountIds[0];

    const accounts = {
      assetAccountId: assetAccountIds[0],
      accumDeprAccountId: assetAccountIds[1] || assetAccountIds[0],
      deprExpenseAccountId: expenseAccountIds[0],
      disposalLossAccountId: expenseAccountIds[1] || expenseAccountIds[0],
      disposalGainAccountId: revenueAccountId,
    };

    const smokeUser = await createSmokeUser({ tenantId: ctx.tenantId, uniqueSuffix, state });
    const vendor = await ensureSmokeVendor({
      tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
      currencyCode: ctx.currencyCode, liabilityAccountId, state,
    });
    const profileId = await createSmokeProfile({
      tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
      userId: smokeUser.userId, uniqueSuffix, state,
    });
    // Category with threshold 1000 (per-unit cost 1500 → standard; 500 → low-value)
    const categoryId = await createSmokeCategory({
      tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
      userId: smokeUser.userId, profileId, accounts,
      uniqueSuffix, state, thresholdBase: 1000,
    });

    const req = makeRequestContext({
      tenantId: ctx.tenantId, userId: smokeUser.userId,
      stamp: uniqueSuffix, suffix: "fa27-smoke",
    });

    // ════════════════════════════════════════════════════════════════
    // TEST 1: Safe amount drift → auto-refresh
    // ════════════════════════════════════════════════════════════════
    console.log("[fa27-smoke] TEST 1: Safe amount drift auto-refresh...");
    {
      // Create AP doc: qty=2, total=3000 → per-unit 1500 (above threshold 1000 → standard)
      const doc = await createPostedApDoc({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, counterpartyId: vendor.counterpartyId,
        operatingUnitId: ous.ownerOuId, currencyCode: ctx.currencyCode,
        documentDate: pw.documentDate, dueDate: pw.dueDate,
        postingAccountId, lineQuantity: 2, lineAmount: 3000,
      });

      const assetId = await createDraftLinkedAsset({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, req,
        documentId: doc.documentId, lineId: doc.lineId,
        categoryId, ownerOuId: ous.ownerOuId, locationOuId: ous.locationOuId,
        capitalizationDate: pw.capitalizationDate, inServiceDate: pw.inServiceDate,
        state,
      });

      // Verify draft cost is 1500 per unit
      const beforeRow = await query(
        `SELECT original_cost_txn, original_cost_base FROM fixed_assets WHERE id = ?`,
        [assetId]
      );
      assert(
        Math.abs(Number(beforeRow.rows[0].original_cost_txn) - 1500) < 0.01,
        `Expected draft cost 1500, got ${beforeRow.rows[0].original_cost_txn}`
      );

      // Simulate safe amount drift: change line amounts from 3000 → 3200
      // Per-unit becomes 1600 (still above threshold 1000 → still standard path)
      await query(
        `UPDATE cari_document_lines
            SET line_net_amount_txn = 3200, line_gross_amount_txn = 3200,
                line_net_amount_base = 3200, line_gross_amount_base = 3200
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      // Activate — should succeed with refreshed cost
      const activated = await activateAsset({
        tenantId: ctx.tenantId,
        assetId,
        postingDate: pw.postingDate,
        capitalizationDate: pw.capitalizationDate,
        inServiceDate: pw.inServiceDate,
        userId: smokeUser.userId,
      });

      const afterRow = await query(
        `SELECT original_cost_txn, original_cost_base, status,
                owner_operating_unit_id, category_id
           FROM fixed_assets WHERE id = ?`,
        [assetId]
      );
      const afterAsset = afterRow.rows[0];
      assert(afterAsset.status === "ACTIVE", `Expected ACTIVE, got ${afterAsset.status}`);
      assert(
        Math.abs(Number(afterAsset.original_cost_txn) - 1600) < 0.01,
        `Expected refreshed cost 1600, got ${afterAsset.original_cost_txn}`
      );
      assert(
        Math.abs(Number(afterAsset.original_cost_base) - 1600) < 0.01,
        `Expected refreshed cost_base 1600, got ${afterAsset.original_cost_base}`
      );
      // User-owned fields preserved
      assert(
        Number(afterAsset.owner_operating_unit_id) === ous.ownerOuId,
        "Owner OU should not be overwritten"
      );
      assert(
        Number(afterAsset.category_id) === categoryId,
        "Category should not be overwritten"
      );

      // Restore line amounts for other tests
      await query(
        `UPDATE cari_document_lines
            SET line_net_amount_txn = 3000, line_gross_amount_txn = 3000,
                line_net_amount_base = 3000, line_gross_amount_base = 3000
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      console.log("[fa27-smoke] TEST 1 PASSED: Safe amount drift auto-refreshed cost from 1500 → 1600");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 2: Non-POSTED source blocks activation
    // ════════════════════════════════════════════════════════════════
    console.log("[fa27-smoke] TEST 2: Non-POSTED source blocks activation...");
    {
      const doc = await createPostedApDoc({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, counterpartyId: vendor.counterpartyId,
        operatingUnitId: ous.ownerOuId, currencyCode: ctx.currencyCode,
        documentDate: pw.documentDate, dueDate: pw.dueDate,
        postingAccountId, lineQuantity: 2, lineAmount: 4000,
      });

      const assetId = await createDraftLinkedAsset({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, req,
        documentId: doc.documentId, lineId: doc.lineId,
        categoryId, ownerOuId: ous.ownerOuId, locationOuId: ous.locationOuId,
        capitalizationDate: pw.capitalizationDate, inServiceDate: pw.inServiceDate,
        state,
      });

      // Simulate non-POSTED: change document status to DRAFT
      await query(
        `UPDATE cari_documents SET status = 'DRAFT' WHERE id = ? AND tenant_id = ?`,
        [doc.documentId, ctx.tenantId]
      );

      let blocked = false;
      try {
        await activateAsset({
          tenantId: ctx.tenantId, assetId,
          postingDate: pw.postingDate, userId: smokeUser.userId,
        });
      } catch (err) {
        blocked = err.message.includes("no longer POSTED");
      }
      assert(blocked, "Non-POSTED source should block activation");

      // Verify asset is still DRAFT
      const row = await query(`SELECT status FROM fixed_assets WHERE id = ?`, [assetId]);
      assert(row.rows[0].status === "DRAFT", "Asset should remain DRAFT after blocked activation");

      // Restore document status
      await query(
        `UPDATE cari_documents SET status = 'POSTED' WHERE id = ? AND tenant_id = ?`,
        [doc.documentId, ctx.tenantId]
      );

      console.log("[fa27-smoke] TEST 2 PASSED: Non-POSTED source blocked activation");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 3: Quantity/unit-slot drift blocks activation
    // ════════════════════════════════════════════════════════════════
    console.log("[fa27-smoke] TEST 3: Quantity/unit-slot drift blocks activation...");
    {
      // Create doc with qty=2
      const doc = await createPostedApDoc({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, counterpartyId: vendor.counterpartyId,
        operatingUnitId: ous.ownerOuId, currencyCode: ctx.currencyCode,
        documentDate: pw.documentDate, dueDate: pw.dueDate,
        postingAccountId, lineQuantity: 2, lineAmount: 4000,
      });

      // Create asset on unit slot 2 (highest available = 2 when qty=2)
      // First consume slot 1
      const asset1Id = await createDraftLinkedAsset({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, req,
        documentId: doc.documentId, lineId: doc.lineId,
        categoryId, ownerOuId: ous.ownerOuId, locationOuId: ous.locationOuId,
        capitalizationDate: pw.capitalizationDate, inServiceDate: pw.inServiceDate,
        state,
      });
      // asset1 gets unit_no=1; now create asset on unit_no=2
      // Reset asset1 back to ACTIVE so its slot stays consumed
      await query(
        `UPDATE fixed_assets SET status = 'ACTIVE' WHERE id = ? AND tenant_id = ?`,
        [asset1Id, ctx.tenantId]
      );

      const asset2Id = await createDraftLinkedAsset({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, req,
        documentId: doc.documentId, lineId: doc.lineId,
        categoryId, ownerOuId: ous.ownerOuId, locationOuId: ous.locationOuId,
        capitalizationDate: pw.capitalizationDate, inServiceDate: pw.inServiceDate,
        state,
      });

      // Verify asset2 got unit_no=2
      const a2Row = await query(
        `SELECT source_cari_document_line_unit_no FROM fixed_assets WHERE id = ?`,
        [asset2Id]
      );
      assert(
        Number(a2Row.rows[0].source_cari_document_line_unit_no) === 2,
        `Expected unit_no=2, got ${a2Row.rows[0].source_cari_document_line_unit_no}`
      );

      // Simulate quantity drift: reduce from 2 → 1 (unit_no=2 no longer valid)
      await query(
        `UPDATE cari_document_lines
            SET quantity = 1,
                line_net_amount_txn = 2000, line_gross_amount_txn = 2000,
                line_net_amount_base = 2000, line_gross_amount_base = 2000
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      let blocked = false;
      try {
        await activateAsset({
          tenantId: ctx.tenantId, assetId: asset2Id,
          postingDate: pw.postingDate, userId: smokeUser.userId,
        });
      } catch (err) {
        blocked = err.message.includes("exceeds current source line quantity")
          || err.message.includes("no longer valid");
      }
      assert(blocked, "Quantity drift invalidating unit slot should block activation");

      // Restore quantity
      await query(
        `UPDATE cari_document_lines
            SET quantity = 2,
                line_net_amount_txn = 4000, line_gross_amount_txn = 4000,
                line_net_amount_base = 4000, line_gross_amount_base = 4000
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      console.log("[fa27-smoke] TEST 3 PASSED: Quantity drift blocking unit slot validated");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 4: Threshold-path drift blocks activation
    // ════════════════════════════════════════════════════════════════
    console.log("[fa27-smoke] TEST 4: Threshold-path drift blocks activation...");
    {
      // Create doc: qty=2, total=3000 → per-unit=1500 (above threshold 1000 → standard)
      const doc = await createPostedApDoc({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, counterpartyId: vendor.counterpartyId,
        operatingUnitId: ous.ownerOuId, currencyCode: ctx.currencyCode,
        documentDate: pw.documentDate, dueDate: pw.dueDate,
        postingAccountId, lineQuantity: 2, lineAmount: 3000,
      });

      const assetId = await createDraftLinkedAsset({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, req,
        documentId: doc.documentId, lineId: doc.lineId,
        categoryId, ownerOuId: ous.ownerOuId, locationOuId: ous.locationOuId,
        capitalizationDate: pw.capitalizationDate, inServiceDate: pw.inServiceDate,
        state,
      });

      // Simulate amount drift: per-unit drops from 1500 → 800 (below threshold 1000 → low-value)
      await query(
        `UPDATE cari_document_lines
            SET line_net_amount_txn = 1600, line_gross_amount_txn = 1600,
                line_net_amount_base = 1600, line_gross_amount_base = 1600
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      let blocked = false;
      let errorMsg = "";
      try {
        await activateAsset({
          tenantId: ctx.tenantId, assetId,
          postingDate: pw.postingDate, userId: smokeUser.userId,
        });
      } catch (err) {
        blocked = err.message.includes("activation path");
        errorMsg = err.message;
      }
      assert(blocked, `Threshold-path drift should block activation. Error: ${errorMsg}`);

      // Restore
      await query(
        `UPDATE cari_document_lines
            SET line_net_amount_txn = 3000, line_gross_amount_txn = 3000,
                line_net_amount_base = 3000, line_gross_amount_base = 3000
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      console.log("[fa27-smoke] TEST 4 PASSED: Threshold-path drift blocked activation");
    }

    // ════════════════════════════════════════════════════════════════
    // TEST 5: User-owned fields not overwritten by source refresh
    // ════════════════════════════════════════════════════════════════
    console.log("[fa27-smoke] TEST 5: User-owned fields preserved...");
    {
      const doc = await createPostedApDoc({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, counterpartyId: vendor.counterpartyId,
        operatingUnitId: ous.ownerOuId, currencyCode: ctx.currencyCode,
        documentDate: pw.documentDate, dueDate: pw.dueDate,
        postingAccountId, lineQuantity: 2, lineAmount: 4000,
      });

      const assetId = await createDraftLinkedAsset({
        tenantId: ctx.tenantId, legalEntityId: ctx.legalEntityId,
        userId: smokeUser.userId, req,
        documentId: doc.documentId, lineId: doc.lineId,
        categoryId, ownerOuId: ous.ownerOuId, locationOuId: ous.locationOuId,
        capitalizationDate: pw.capitalizationDate, inServiceDate: pw.inServiceDate,
        state,
      });

      // Read draft state
      const before = await query(
        `SELECT category_id, owner_operating_unit_id, location_operating_unit_id,
                capitalization_date, in_service_date
           FROM fixed_assets WHERE id = ?`,
        [assetId]
      );
      const b = before.rows[0];

      // Small safe drift
      await query(
        `UPDATE cari_document_lines
            SET line_net_amount_txn = 4200, line_gross_amount_txn = 4200,
                line_net_amount_base = 4200, line_gross_amount_base = 4200
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      await activateAsset({
        tenantId: ctx.tenantId, assetId,
        postingDate: pw.postingDate,
        capitalizationDate: pw.capitalizationDate,
        inServiceDate: pw.inServiceDate,
        userId: smokeUser.userId,
      });

      const after = await query(
        `SELECT category_id, owner_operating_unit_id, location_operating_unit_id,
                capitalization_date, in_service_date
           FROM fixed_assets WHERE id = ?`,
        [assetId]
      );
      const a = after.rows[0];

      assert(Number(a.category_id) === Number(b.category_id), "categoryId must not change");
      assert(
        Number(a.owner_operating_unit_id) === Number(b.owner_operating_unit_id),
        "ownerOperatingUnitId must not change"
      );
      assert(
        Number(a.location_operating_unit_id) === Number(b.location_operating_unit_id),
        "locationOperatingUnitId must not change"
      );

      // Restore
      await query(
        `UPDATE cari_document_lines
            SET line_net_amount_txn = 4000, line_gross_amount_txn = 4000,
                line_net_amount_base = 4000, line_gross_amount_base = 4000
          WHERE id = ? AND tenant_id = ?`,
        [doc.lineId, ctx.tenantId]
      );

      console.log("[fa27-smoke] TEST 5 PASSED: User-owned fields preserved after source refresh");
    }

    // ════════════════════════════════════════════════════════════════
    console.log("\n[fa27-smoke] ═══════════════════════════════════════════");
    console.log("[fa27-smoke] ALL 5 TESTS PASSED");
    console.log("[fa27-smoke] ═══════════════════════════════════════════");
  } finally {
    try {
      if (!KEEP_ARTIFACTS) {
        await cleanupState(state);
      }
    } finally {
      await closePool();
    }
  }
}

main().catch((error) => {
  console.error("[fa27-smoke] FAILED");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
