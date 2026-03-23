/**
 * STEP-FA26 smoke test — Cross-OU FA06 capitalization end-to-end.
 *
 * Proves:
 *  1. Valid cross-OU POST succeeds, persists asset + CAPITALIZATION txn +
 *     4-line journal (debit asset@owner, credit dueTo@owner,
 *     debit dueFrom@source, credit AP-control@source).
 *  2. Same-OU POST still bypasses cross-OU branch (2-line journal).
 *  3. Missing self-balancing setup blocks before persistence.
 */

import bcrypt from "bcrypt";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
} from "../src/services/cari.document.service.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const TEST_PORT = Number(process.env.FA26_SMOKE_PORT || 3126);
const BASE_URL =
  process.env.FA26_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA26_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA26_SMOKE_KEEP_ARTIFACTS,
  true
);

function parseOptionalPositiveInt(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

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

// ── HTTP helpers ──────────────────────────────────────────────────

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function apiRequest({ cookie, method = "GET", pathName, body, expectedStatus }) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const { response, payload } = await fetchJson(
    `${BASE_URL}${pathName}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    30000
  );

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${pathName} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(payload)}`
    );
  }
  return { status: response.status, payload, response };
}

// ── Server lifecycle ──────────────────────────────────────────────

async function isApiAlive() {
  try {
    const { response, payload } = await fetchJson(`${BASE_URL}/health`, {}, 2500);
    return response.status >= 200 && response.status < 600 && payload?.checks;
  } catch { return false; }
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[fa26-smoke][server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[fa26-smoke][server] ${chunk}`));
  return child;
}

async function ensureApiServer() {
  if (await isApiAlive()) return { startedByScript: false, child: null };
  const child = startServerProcess();
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`API process exited early with code ${child.exitCode}`);
    if (await isApiAlive()) return { startedByScript: true, child };
    await sleep(400);
  }
  if (child.exitCode === null) child.kill("SIGKILL");
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    sleep(5000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

async function login(email, password) {
  const { status, payload, response } = await apiRequest({
    method: "POST",
    pathName: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(status === 200, `Login failed for ${email}: ${JSON.stringify(payload)}`);
  const cookie = String(response.headers.get("set-cookie") || "").split(";")[0].trim();
  assert(cookie, `Login cookie missing for ${email}`);
  return cookie;
}

// ── Request context for direct service calls ──────────────────────

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: { "user-agent": "fa26-cross-ou-smoke" },
    ip: "127.0.0.1",
    user: { tenantId, userId },
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

/**
 * Find a legal entity with at least TWO active OUs that have a
 * partner current-account mapping between them (required for cross-OU).
 */
async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA26" });
}

async function resolveOpenPostingWindow(tenantId, legalEntityId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await query(
    `SELECT fp.start_date, fp.end_date
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id AND ps.fiscal_period_id = fp.id
      WHERE b.tenant_id = ?
        AND b.legal_entity_id = ?
        AND b.book_type = 'LOCAL'
        AND fp.is_adjustment = 0
        AND COALESCE(ps.status, 'OPEN') = 'OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC
      LIMIT 1`,
    [tenantId, legalEntityId, today]
  );
  const row = result.rows?.[0];
  assert(row, `No OPEN non-adjustment LOCAL fiscal period found for tenant ${tenantId}, LE ${legalEntityId}`);

  const documentDate = row.start_date;
  const capitalizationDate = minDate(addDays(documentDate, 1), row.end_date);
  const inServiceDate = minDate(addDays(documentDate, 2), row.end_date);

  return { documentDate, capitalizationDate, inServiceDate, dueDate: addDays(documentDate, 10) };
}

async function resolvePostableAccountId(tenantId, legalEntityId, accountType) {
  const result = await query(
    `SELECT a.id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
        AND a.account_type = ? AND a.is_active = 1 AND a.allow_posting = 1
      ORDER BY a.id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, accountType]
  );
  const id = Number(result.rows?.[0]?.id || 0);
  assert(id > 0, `No usable ${accountType} account for tenant ${tenantId}, LE ${legalEntityId}`);
  return id;
}

async function resolvePostableAccountIds(tenantId, legalEntityId, accountType, count) {
  const result = await query(
    `SELECT a.id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
        AND a.account_type = ? AND a.is_active = 1 AND a.allow_posting = 1
      ORDER BY a.id ASC`,
    [tenantId, legalEntityId, accountType]
  );
  const ids = (result.rows || []).slice(0, count).map((r) => Number(r.id));
  assert(ids.length >= 1, `No usable ${accountType} accounts for tenant ${tenantId}, LE ${legalEntityId}`);
  return ids;
}

// ── Fixture creation ──────────────────────────────────────────────

async function createSmokeUser({ tenantId, uniqueSuffix, state }) {
  const password = "FA26Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa26.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA26 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create FA26 smoke user");

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

async function ensureSmokeVendor({ tenantId, legalEntityId, currencyCode, liabilityAccountId, operatingUnitId, uniqueSuffix, state }) {
  // Reuse only vendors that are unconstrained or explicitly compatible with the chosen source OU.
  const reusable = await query(
    `SELECT c.id
       FROM counterparties c
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.is_vendor = 1
        AND c.status = 'ACTIVE'
        AND c.ap_account_id IS NOT NULL
        AND (
              (
                c.primary_operating_unit_id IS NULL
                AND NOT EXISTS (
                      SELECT 1
                        FROM counterparty_operating_units cou
                       WHERE cou.tenant_id = c.tenant_id
                         AND cou.legal_entity_id = c.legal_entity_id
                         AND cou.counterparty_id = c.id
                    )
              )
              OR c.primary_operating_unit_id = ?
              OR EXISTS (
                    SELECT 1
                      FROM counterparty_operating_units cou
                     WHERE cou.tenant_id = c.tenant_id
                       AND cou.legal_entity_id = c.legal_entity_id
                       AND cou.counterparty_id = c.id
                       AND cou.operating_unit_id = ?
                  )
            )
      ORDER BY c.id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, operatingUnitId, operatingUnitId]
  );
  const reusableId = Number(reusable.rows?.[0]?.id || 0);
  if (reusableId > 0) return { counterpartyId: reusableId, created: false };

  const insertResult = await query(
    `INSERT INTO counterparties (
        tenant_id, legal_entity_id, primary_operating_unit_id,
        code, name, is_customer, is_vendor,
        default_currency_code, ar_account_id, ap_account_id,
        status, notes
     ) VALUES (
        ?, ?, ?,
        ?, ?, 0, 1,
        ?, NULL, ?,
        'ACTIVE', ?
     )`,
    [
      tenantId, legalEntityId, operatingUnitId,
      `FA26VND${uniqueSuffix.slice(-8)}`,
      `FA26 Smoke Vendor ${uniqueSuffix.slice(-8)}`,
      currencyCode, liabilityAccountId,
      "Vendor for STEP-FA26 cross-OU smoke",
    ]
  );
  const counterpartyId = Number(insertResult.rows?.insertId || 0);
  assert(counterpartyId > 0, "Failed to create FA26 smoke vendor");
  state.createdCounterpartyIds.push(counterpartyId);
  return { counterpartyId, created: true };
}

async function createSmokeProfile({ tenantId, legalEntityId, userId, uniqueSuffix, state }) {
  const code = `FA26PF${uniqueSuffix.slice(-6)}`;
  const insertResult = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id, legal_entity_id, code, name, status, method,
        declining_balance_rate_percent, switch_to_straight_line,
        description, created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE', NULL, 0, ?, ?, ?)`,
    [tenantId, legalEntityId, code, `FA26 Smoke Profile ${uniqueSuffix}`,
     "Smoke profile for STEP-FA26", userId, userId]
  );
  const profileId = Number(insertResult.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create FA26 smoke profile");
  state.createdProfileIds.push(profileId);
  return { profileId, code };
}

async function createSmokeCategory({ tenantId, legalEntityId, userId, profileId, uniqueSuffix, accounts, state }) {
  const code = `FA26CT${uniqueSuffix.slice(-6)}`;
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
     ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, 1000, 24, 'NONE', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId, legalEntityId, code,
      `FA26 Smoke Category ${uniqueSuffix}`,
      "Category for STEP-FA26 cross-OU smoke",
      profileId,
      accounts.assetAccountId,
      accounts.accumDeprAccountId,
      accounts.deprExpenseAccountId,
      accounts.disposalGainAccountId,
      accounts.disposalLossAccountId,
      userId, userId,
    ]
  );
  const categoryId = Number(insertResult.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create FA26 smoke category");
  state.createdCategoryIds.push(categoryId);
  return { categoryId, code };
}

async function createPostedApDocument({
  tenantId, legalEntityId, userId, counterpartyId,
  operatingUnitId, currencyCode, documentDate, dueDate, postingAccountId,
}) {
  const stamp = `${Date.now()}`;
  const draft = await createCariDraftDocument({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: "fa26-ap-create" }),
    payload: {
      tenantId, userId, legalEntityId, counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate, dueDate, currencyCode,
      operatingUnitId,
      lines: [
        {
          description: "FA26 Smoke Cross-OU Source Line",
          quantity: 3,
          postingAccountId,
          lineNetAmountTxn: 3000,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 3000,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });

  const posted = await postCariDocumentById({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: "fa26-ap-post" }),
    payload: { tenantId, userId, documentId: draft.id },
    assertScopeAccess: allowAllScopes,
  });

  const documentId = Number(posted?.id || draft?.id || 0);
  assert(documentId > 0, "Failed to resolve posted CARI document id");

  // The posted document may have lines in .lines or .documentLines or we query directly
  const allLines = posted?.lines || posted?.documentLines || [];
  const line = allLines[0];
  if (line?.id) {
    return { documentId, lineId: Number(line.id), operatingUnitId };
  }

  // Fallback: query the DB directly for the document's lines
  const lineRows = await query(
    `SELECT id FROM cari_document_lines WHERE cari_document_id = ? AND tenant_id = ? ORDER BY id ASC LIMIT 1`,
    [documentId, tenantId]
  );
  const lineId = Number(lineRows.rows?.[0]?.id || 0);
  assert(lineId > 0, `Posted FA26 AP document (id=${documentId}) has no lines in DB`);
  return { documentId, lineId, operatingUnitId };
}

// ── Cleanup ───────────────────────────────────────────────────────

async function cleanupState(state) {
  // Delete FA transactions first (FK to fixed_assets)
  for (const assetId of state.createdAssetIds.slice().reverse()) {
    await query(`DELETE FROM fixed_asset_transactions WHERE asset_id = ?`, [assetId]);
  }
  // Delete journal source links and lines, then journal entries
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
  let server = null;

  try {
    // ── Resolve fixtures ──────────────────────────────────────────
    console.log("[fa26-smoke] Resolving smoke context...");
    const ctx = await resolveSmokeContext();
    console.log(
      `[fa26-smoke] Context: tenant=${ctx.tenantId}, LE=${ctx.legalEntityId}, ` +
      `sourceOU=${ctx.sourceOuId}, targetOU=${ctx.targetOuId}, currency=${ctx.currencyCode}`
    );

    const postingWindow = await resolveOpenPostingWindow(ctx.tenantId, ctx.legalEntityId);
    const assetAccountIds = await resolvePostableAccountIds(ctx.tenantId, ctx.legalEntityId, "ASSET", 2);
    const expenseAccountIds = await resolvePostableAccountIds(ctx.tenantId, ctx.legalEntityId, "EXPENSE", 2);
    const revenueAccountId = await resolvePostableAccountId(ctx.tenantId, ctx.legalEntityId, "REVENUE");
    const liabilityAccountId = await resolvePostableAccountId(ctx.tenantId, ctx.legalEntityId, "LIABILITY");

    const accounts = {
      assetAccountId: assetAccountIds[0],
      accumDeprAccountId: assetAccountIds[1] || assetAccountIds[0],
      deprExpenseAccountId: expenseAccountIds[0],
      disposalLossAccountId: expenseAccountIds[1] || expenseAccountIds[0],
      disposalGainAccountId: revenueAccountId,
    };

    const smokeUser = await createSmokeUser({ tenantId: ctx.tenantId, uniqueSuffix, state });
    const vendor = await ensureSmokeVendor({
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      currencyCode: ctx.currencyCode,
      liabilityAccountId,
      operatingUnitId: ctx.sourceOuId,
      uniqueSuffix,
      state,
    });
    const profile = await createSmokeProfile({
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      userId: smokeUser.userId,
      uniqueSuffix,
      state,
    });
    const category = await createSmokeCategory({
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      userId: smokeUser.userId,
      profileId: profile.profileId,
      uniqueSuffix,
      accounts,
      state,
    });

    // Find the posting account used by the source CARI doc line
    const postingAccountId = await resolvePostableAccountId(
      ctx.tenantId, ctx.legalEntityId, "EXPENSE"
    );

    // Create posted AP document on sourceOU
    console.log("[fa26-smoke] Creating posted AP document on source OU...");
    const sourceDoc = await createPostedApDocument({
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      userId: smokeUser.userId,
      counterpartyId: vendor.counterpartyId,
      operatingUnitId: ctx.sourceOuId,
      currencyCode: ctx.currencyCode,
      documentDate: postingWindow.documentDate,
      dueDate: postingWindow.dueDate,
      postingAccountId,
    });
    console.log(`[fa26-smoke] Posted AP doc id=${sourceDoc.documentId}, lineId=${sourceDoc.lineId}`);

    // ── Start server ──────────────────────────────────────────────
    server = await ensureApiServer();
    const cookie = await login(smokeUser.email, smokeUser.password);

    // ════════════════════════════════════════════════════════════════
    // TEST 1: Cross-OU capitalization (owner OU ≠ source OU)
    // ════════════════════════════════════════════════════════════════
    console.log("[fa26-smoke] TEST 1: Cross-OU capitalization POST...");
    const crossOuResult = await apiRequest({
      cookie,
      method: "POST",
      pathName: "/api/v1/fixed-assets/from-cari-document-line",
      body: {
        sourceCariDocumentId: sourceDoc.documentId,
        sourceCariDocumentLineId: sourceDoc.lineId,
        unitCount: 1,
        categoryId: category.categoryId,
        ownerOperatingUnitId: ctx.targetOuId,        // different from sourceOU → cross-OU
        locationOperatingUnitId: ctx.targetOuId,
        capitalizationDate: postingWindow.capitalizationDate,
        inServiceDate: postingWindow.inServiceDate,
      },
      expectedStatus: 201,
    });

    const crossOuAssets = crossOuResult.payload?.assets || crossOuResult.payload?.rows || [crossOuResult.payload];
    assert(crossOuAssets.length >= 1, "Cross-OU POST must create at least one asset");
    const crossOuAsset = crossOuAssets[0];
    const crossOuAssetId = Number(crossOuAsset?.id || crossOuAsset?.assetId || 0);
    assert(crossOuAssetId > 0, "Cross-OU POST must return an asset with an id");
    state.createdAssetIds.push(crossOuAssetId);

    // Verify asset persisted
    const assetRow = await query(
      `SELECT * FROM fixed_assets WHERE id = ? AND tenant_id = ?`,
      [crossOuAssetId, ctx.tenantId]
    );
    assert(assetRow.rows?.[0], "Cross-OU asset row must exist in DB");
    assert(
      String(assetRow.rows[0].status) === "ACTIVE",
      `Cross-OU asset status should be ACTIVE, got ${assetRow.rows[0].status}`
    );
    assert(
      Number(assetRow.rows[0].owner_operating_unit_id) === ctx.targetOuId,
      "Cross-OU asset ownerOperatingUnitId must be the target OU"
    );

    // Verify CAPITALIZATION transaction
    const txnRows = await query(
      `SELECT * FROM fixed_asset_transactions
        WHERE asset_id = ? AND tenant_id = ? AND transaction_type = 'CAPITALIZATION'`,
      [crossOuAssetId, ctx.tenantId]
    );
    assert(txnRows.rows?.length === 1, "Cross-OU must create exactly 1 CAPITALIZATION transaction");
    const capTxn = txnRows.rows[0];
    assert(
      capTxn.note && capTxn.note.includes("Cross-OU"),
      `CAPITALIZATION note should mention Cross-OU, got: ${capTxn.note}`
    );

    // Verify NO ACQUISITION transaction (CARI-linked assets use CAPITALIZATION, not ACQUISITION)
    const acqTxnRows = await query(
      `SELECT * FROM fixed_asset_transactions
        WHERE asset_id = ? AND tenant_id = ? AND transaction_type = 'ACQUISITION'`,
      [crossOuAssetId, ctx.tenantId]
    );
    assert(
      (acqTxnRows.rows || []).length === 0,
      "Cross-OU CARI capitalization must NOT create an ACQUISITION transaction"
    );

    // Verify journal entry and 4-line template
    const journalEntryId = Number(capTxn.journal_entry_id || 0);
    assert(journalEntryId > 0, "CAPITALIZATION transaction must have a journal_entry_id");
    state.createdJournalEntryIds.push(journalEntryId);

    const journalLines = await query(
      `SELECT jl.*, a.account_type, a.code AS account_code
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.journal_entry_id = ?
        ORDER BY jl.line_no ASC, jl.id ASC`,
      [journalEntryId]
    );
    assert(
      journalLines.rows?.length === 4,
      `Cross-OU journal must have exactly 4 lines, got ${journalLines.rows?.length}`
    );

    const lines = journalLines.rows;

    // Line 1: debit fixed-asset account in owner OU
    assert(
      Number(lines[0].account_id) === accounts.assetAccountId,
      `Line 1 account must be asset account (${accounts.assetAccountId}), got ${lines[0].account_id}`
    );
    assert(
      Number(lines[0].debit_base || 0) > 0,
      "Line 1 must be a DEBIT"
    );
    assert(
      Number(lines[0].operating_unit_id) === ctx.targetOuId,
      `Line 1 OU must be owner/target OU (${ctx.targetOuId}), got ${lines[0].operating_unit_id}`
    );

    // Line 2: credit targetDueToAccount in owner OU
    assert(
      Number(lines[1].credit_base || 0) > 0,
      "Line 2 must be a CREDIT"
    );
    assert(
      Number(lines[1].operating_unit_id) === ctx.targetOuId,
      `Line 2 OU must be owner/target OU (${ctx.targetOuId}), got ${lines[1].operating_unit_id}`
    );

    // Line 3: debit sourceDueFromAccount in source/payer OU
    assert(
      Number(lines[2].debit_base || 0) > 0,
      "Line 3 must be a DEBIT"
    );
    assert(
      Number(lines[2].operating_unit_id) === ctx.sourceOuId,
      `Line 3 OU must be source/payer OU (${ctx.sourceOuId}), got ${lines[2].operating_unit_id}`
    );

    // Line 4: credit AP control in source/payer OU
    assert(
      Number(lines[3].credit_base || 0) > 0,
      "Line 4 must be a CREDIT"
    );
    assert(
      Number(lines[3].operating_unit_id) === ctx.sourceOuId,
      `Line 4 OU must be source/payer OU (${ctx.sourceOuId}), got ${lines[3].operating_unit_id}`
    );

    // Verify total debits = total credits (balanced)
    const totalDebits = lines.reduce((s, l) => s + Number(l.debit_base || 0), 0);
    const totalCredits = lines.reduce((s, l) => s + Number(l.credit_base || 0), 0);
    assert(
      Math.abs(totalDebits - totalCredits) < 0.01,
      `Journal must balance: debits=${totalDebits}, credits=${totalCredits}`
    );

    console.log("[fa26-smoke] TEST 1 PASSED: Cross-OU capitalization created asset, CAPITALIZATION txn, 4-line journal");

    // ════════════════════════════════════════════════════════════════
    // TEST 2: Same-OU capitalization (owner OU = source OU)
    // ════════════════════════════════════════════════════════════════
    console.log("[fa26-smoke] TEST 2: Same-OU capitalization POST...");
    const sameOuResult = await apiRequest({
      cookie,
      method: "POST",
      pathName: "/api/v1/fixed-assets/from-cari-document-line",
      body: {
        sourceCariDocumentId: sourceDoc.documentId,
        sourceCariDocumentLineId: sourceDoc.lineId,
        unitCount: 1,
        categoryId: category.categoryId,
        ownerOperatingUnitId: ctx.sourceOuId,         // same as source → same-OU
        locationOperatingUnitId: ctx.sourceOuId,
        capitalizationDate: postingWindow.capitalizationDate,
        inServiceDate: postingWindow.inServiceDate,
      },
      expectedStatus: 201,
    });

    const sameOuAssets = sameOuResult.payload?.assets || sameOuResult.payload?.rows || [sameOuResult.payload];
    assert(sameOuAssets.length >= 1, "Same-OU POST must create at least one asset");
    const sameOuAsset = sameOuAssets[0];
    const sameOuAssetId = Number(sameOuAsset?.id || sameOuAsset?.assetId || 0);
    assert(sameOuAssetId > 0, "Same-OU POST must return an asset with an id");
    state.createdAssetIds.push(sameOuAssetId);

    // Verify same-OU CAPITALIZATION transaction
    const sameOuTxn = await query(
      `SELECT * FROM fixed_asset_transactions
        WHERE asset_id = ? AND tenant_id = ? AND transaction_type = 'CAPITALIZATION'`,
      [sameOuAssetId, ctx.tenantId]
    );
    assert(sameOuTxn.rows?.length === 1, "Same-OU must create exactly 1 CAPITALIZATION transaction");
    const sameOuCapTxn = sameOuTxn.rows[0];
    assert(
      sameOuCapTxn.note && sameOuCapTxn.note.includes("Same-OU"),
      `Same-OU CAPITALIZATION note should mention Same-OU, got: ${sameOuCapTxn.note}`
    );

    const sameOuJournalId = Number(sameOuCapTxn.journal_entry_id || 0);
    assert(sameOuJournalId > 0, "Same-OU CAPITALIZATION must have journal_entry_id");
    state.createdJournalEntryIds.push(sameOuJournalId);

    const sameOuJournalLines = await query(
      `SELECT jl.*, a.account_type, a.code AS account_code
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.journal_entry_id = ?
        ORDER BY jl.line_no ASC, jl.id ASC`,
      [sameOuJournalId]
    );
    assert(
      sameOuJournalLines.rows?.length === 2,
      `Same-OU journal must have exactly 2 lines (no due-to/due-from), got ${sameOuJournalLines.rows?.length}`
    );

    console.log("[fa26-smoke] TEST 2 PASSED: Same-OU capitalization still uses 2-line journal (no cross-OU branch)");

    // ════════════════════════════════════════════════════════════════
    // TEST 3: Missing self-balancing setup blocks before persistence
    // ════════════════════════════════════════════════════════════════
    console.log("[fa26-smoke] TEST 3: Missing setup failure...");

    // Find an OU that has NO partner current-account mapping with sourceOU
    const unmappedOuResult = await query(
      `SELECT ou.id
         FROM operating_units ou
        WHERE ou.tenant_id = ?
          AND ou.legal_entity_id = ?
          AND ou.status = 'ACTIVE'
          AND ou.id != ?
          AND ou.id NOT IN (
            SELECT map.partner_operating_unit_id
              FROM operating_unit_partner_current_accounts map
             WHERE map.tenant_id = ?
               AND map.operating_unit_id = ?
          )
        ORDER BY ou.id ASC
        LIMIT 1`,
      [ctx.tenantId, ctx.legalEntityId, ctx.sourceOuId, ctx.tenantId, ctx.sourceOuId]
    );

    if (unmappedOuResult.rows?.[0]) {
      const unmappedOuId = Number(unmappedOuResult.rows[0].id);

      // Count assets before
      const assetCountBefore = await query(
        `SELECT COUNT(*) AS cnt FROM fixed_assets WHERE tenant_id = ?`,
        [ctx.tenantId]
      );
      const beforeCount = Number(assetCountBefore.rows?.[0]?.cnt || 0);

      const failResult = await apiRequest({
        cookie,
        method: "POST",
        pathName: "/api/v1/fixed-assets/from-cari-document-line",
        body: {
          sourceCariDocumentId: sourceDoc.documentId,
          sourceCariDocumentLineId: sourceDoc.lineId,
          unitCount: 1,
          categoryId: category.categoryId,
          ownerOperatingUnitId: unmappedOuId,
          locationOperatingUnitId: unmappedOuId,
          capitalizationDate: postingWindow.capitalizationDate,
          inServiceDate: postingWindow.inServiceDate,
        },
      });
      assert(
        failResult.status >= 400,
        `Missing-setup request should fail, got status ${failResult.status}`
      );

      // Verify no persistence on failure
      const assetCountAfter = await query(
        `SELECT COUNT(*) AS cnt FROM fixed_assets WHERE tenant_id = ?`,
        [ctx.tenantId]
      );
      const afterCount = Number(assetCountAfter.rows?.[0]?.cnt || 0);
      assert(
        afterCount === beforeCount,
        `No asset should be created on failure: before=${beforeCount}, after=${afterCount}`
      );

      console.log(
        `[fa26-smoke] TEST 3 PASSED: Missing setup (unmapped OU ${unmappedOuId}) blocked with status ${failResult.status}, no persistence`
      );
    } else {
      // All OUs have mappings — try with a fake high OU id
      const failResult = await apiRequest({
        cookie,
        method: "POST",
        pathName: "/api/v1/fixed-assets/from-cari-document-line",
        body: {
          sourceCariDocumentId: sourceDoc.documentId,
          sourceCariDocumentLineId: sourceDoc.lineId,
          unitCount: 1,
          categoryId: category.categoryId,
          ownerOperatingUnitId: 999999,
          locationOperatingUnitId: 999999,
          capitalizationDate: postingWindow.capitalizationDate,
          inServiceDate: postingWindow.inServiceDate,
        },
      });
      assert(
        failResult.status >= 400,
        `Invalid OU request should fail, got status ${failResult.status}`
      );
      console.log(
        `[fa26-smoke] TEST 3 PASSED: Invalid OU (999999) blocked with status ${failResult.status}`
      );
    }

    // ════════════════════════════════════════════════════════════════
    // Summary
    // ════════════════════════════════════════════════════════════════
    console.log("\n[fa26-smoke] ═══════════════════════════════════════════");
    console.log("[fa26-smoke] ALL 3 TESTS PASSED");
    console.log("[fa26-smoke] ═══════════════════════════════════════════");
    console.log(
      JSON.stringify(
        {
          tenantId: ctx.tenantId,
          legalEntityId: ctx.legalEntityId,
          sourceOuId: ctx.sourceOuId,
          targetOuId: ctx.targetOuId,
          crossOuAssetId,
          crossOuJournalEntryId: journalEntryId,
          crossOuJournalLineCount: 4,
          sameOuAssetId,
          sameOuJournalEntryId: sameOuJournalId,
          sameOuJournalLineCount: 2,
          cleanup: KEEP_ARTIFACTS ? "skipped" : "completed",
        },
        null,
        2
      )
    );
  } finally {
    try {
      if (!KEEP_ARTIFACTS) {
        await cleanupState(state);
      }
    } finally {
      await stopServer(server?.child || null);
      await closePool();
    }
  }
}

main().catch((error) => {
  console.error("[fa26-smoke] FAILED");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
