
  import bcrypt from "bcrypt";
  import { spawn } from "node:child_process";
  import { once } from "node:events";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { setTimeout as sleep } from "node:timers/promises";
  import { closePool, query } from "../src/db.js";
  import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const TEST_PORT = Number(process.env.FA39_SMOKE_PORT || 3139);
const BASE_URL =
  process.env.FA39_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA39_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA39_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA39_SMOKE_LEGAL_ENTITY_ID
);
let TENANT_ID = ENV_TENANT_ID || 0;
let LEGAL_ENTITY_ID = ENV_LEGAL_ENTITY_ID || 0;
let SMOKE_CURRENCY_CODE = "USD";
const KEEP_ARTIFACTS = parseBooleanEnv(process.env.FA39_SMOKE_KEEP_ARTIFACTS, true);

function parseOptionalPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function parseBooleanEnv(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(n)) return true;
  if (["0", "false", "no", "off"].includes(n)) return false;
  return fallback;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function toNumber(v) { return Number(v || 0); }
function addDays(dateText, days) {
  const d = new Date(`${dateText}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function minDate(a, b) { return a <= b ? a : b; }

async function fetchJson(url, opts = {}, timeoutMs = 30000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal, redirect: "manual" });
    const text = await r.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = { raw: text }; } }
    return { response: r, payload };
  } finally { clearTimeout(t); }
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
  child.stdout.on("data", (c) => process.stdout.write(`[fa39-smoke][server] ${c}`));
  child.stderr.on("data", (c) => process.stderr.write(`[fa39-smoke][server] ${c}`));
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
    method: "POST", pathName: "/auth/login", body: { email, password }, expectedStatus: 200,
  });
  assert(status === 200, `Login failed for ${email}: ${JSON.stringify(payload)}`);
  const cookie = String(response.headers.get("set-cookie") || "").split(";")[0].trim();
  assert(cookie, `Login cookie missing for ${email}`);
  return cookie;
}

async function resolveTenantAdminRoleId(tenantId) {
  const r = await query(`SELECT id FROM roles WHERE tenant_id=? AND code='TenantAdmin' LIMIT 1`, [tenantId]);
  const roleId = Number(r.rows?.[0]?.id || 0);
  assert(roleId > 0, "TenantAdmin role not found");
  return roleId;
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA39" });
}

async function resolveActiveOuId(tenantId, legalEntityId) {
  const r = await query(
    `SELECT id FROM operating_units WHERE tenant_id=? AND legal_entity_id=? AND status='ACTIVE' ORDER BY id ASC LIMIT 1`,
    [tenantId, legalEntityId]);
  const ouId = Number(r.rows?.[0]?.id || 0);
  assert(ouId > 0, "No ACTIVE OU found");
  return ouId;
}

async function resolveAccountFixtures(tenantId, legalEntityId) {
  const assetR = await query(
    `SELECT a.id FROM accounts a JOIN charts_of_accounts c ON c.id=a.coa_id
     WHERE c.tenant_id=? AND c.legal_entity_id=? AND c.scope='LEGAL_ENTITY'
       AND a.is_active=1 AND a.allow_posting=1 AND a.account_type='ASSET' ORDER BY a.id ASC LIMIT 2`,
    [tenantId, legalEntityId]);
  const expR = await query(
    `SELECT a.id FROM accounts a JOIN charts_of_accounts c ON c.id=a.coa_id
     WHERE c.tenant_id=? AND c.legal_entity_id=? AND c.scope='LEGAL_ENTITY'
       AND a.is_active=1 AND a.allow_posting=1 AND a.account_type='EXPENSE' ORDER BY a.id ASC LIMIT 2`,
    [tenantId, legalEntityId]);
  const revR = await query(
    `SELECT a.id FROM accounts a JOIN charts_of_accounts c ON c.id=a.coa_id
     WHERE c.tenant_id=? AND c.legal_entity_id=? AND c.scope='LEGAL_ENTITY'
       AND a.is_active=1 AND a.allow_posting=1 AND a.account_type='REVENUE' ORDER BY a.id ASC LIMIT 1`,
    [tenantId, legalEntityId]);

  const assetAccounts = (assetR.rows || []).map((r) => Number(r.id));
  const expenseAccounts = (expR.rows || []).map((r) => Number(r.id));
  const revenueAccounts = (revR.rows || []).map((r) => Number(r.id));
  assert(assetAccounts.length >= 1 && expenseAccounts.length >= 1 && revenueAccounts.length >= 1,
    "Missing required account types");
  return {
    assetAccountId: assetAccounts[0],
    accumDeprAccountId: assetAccounts[1] || assetAccounts[0],
    deprExpenseAccountId: expenseAccounts[0],
    disposalLossAccountId: expenseAccounts[1] || expenseAccounts[0],
    disposalGainAccountId: revenueAccounts[0],
  };
}

async function resolveOpenPostingWindow(tenantId, legalEntityId) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await query(
    `SELECT b.id AS book_id, fp.id AS fiscal_period_id, fp.start_date, fp.end_date
       FROM books b JOIN fiscal_periods fp ON fp.calendar_id=b.calendar_id
       LEFT JOIN period_statuses ps ON ps.book_id=b.id AND ps.fiscal_period_id=fp.id
      WHERE b.tenant_id=? AND b.legal_entity_id=? AND b.book_type='LOCAL'
        AND fp.is_adjustment=0 AND COALESCE(ps.status,'OPEN')='OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC LIMIT 1`,
    [tenantId, legalEntityId, today]);
  const row = r.rows?.[0];
  assert(row, "No OPEN fiscal period found");
  const acqDate = row.start_date;
  return {
    startDate: row.start_date,
    endDate: row.end_date,
    acquisitionDate: acqDate,
    capitalizationDate: minDate(addDays(acqDate, 1), row.end_date),
    inServiceDate: minDate(addDays(acqDate, 2), row.end_date),
    postingDate: minDate(addDays(acqDate, 3), row.end_date),
    saleDate: minDate(addDays(acqDate, 5), row.end_date),
  };
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA39Smoke#12345";
  const hash = await bcrypt.hash(password, 10);
  const email = `fa39.smoke.${uniqueSuffix}@example.test`;
  const ins = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status) VALUES (?,?,?,?,'ACTIVE')`,
    [tenantId, email, hash, `FA39 Smoke ${uniqueSuffix}`]);
  const userId = Number(ins.rows?.insertId || 0);
  assert(userId > 0, "Failed to create smoke user");
  const roleId = await resolveTenantAdminRoleId(tenantId);
  await query(
    `INSERT INTO user_role_scopes (tenant_id,user_id,role_id,scope_type,scope_id,effect) VALUES (?,?,?,'TENANT',?,'ALLOW')`,
    [tenantId, userId, roleId, tenantId]);
  return { userId, email, password, roleId };
}

async function createSmokeCustomerCounterparty({ tenantId, legalEntityId, arAccountId, uniqueSuffix }) {
  const code = `FA39CU${uniqueSuffix.slice(-6)}`;
  const ins = await query(
    `INSERT INTO counterparties (tenant_id, legal_entity_id, code, name, is_customer, is_vendor, ar_account_id, status)
     VALUES (?,?,?,?,1,0,?,'ACTIVE')`,
    [tenantId, legalEntityId, code, `FA39 Smoke Customer ${uniqueSuffix}`, arAccountId]);
  const counterpartyId = Number(ins.rows?.insertId || 0);
  assert(counterpartyId > 0, "Failed to create customer counterparty");
  return { counterpartyId, code };
}

async function createSmokeProfile({ tenantId, legalEntityId, userId, uniqueSuffix }) {
  const code = `FA39PF${uniqueSuffix.slice(-6)}`;
  const ins = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id, legal_entity_id, code, name, status, method,
        declining_balance_rate_percent, switch_to_straight_line,
        description, created_by_user_id, updated_by_user_id
     ) VALUES (?,?,?,?,'ACTIVE','STRAIGHT_LINE',NULL,0,?,?,?)`,
    [tenantId, legalEntityId, code, `FA39 Smoke Profile ${uniqueSuffix}`,
     "Smoke profile for STEP-FA39", userId, userId]);
  const profileId = Number(ins.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create smoke profile");
  return { profileId, code };
}

async function createSmokeCategory({ tenantId, legalEntityId, userId, profileId, uniqueSuffix, accounts }) {
  const code = `FA39CT${uniqueSuffix.slice(-6)}`;
  const ins = await query(
    `INSERT INTO fixed_asset_categories (
        tenant_id, legal_entity_id, code, name, status, description,
        capitalization_threshold_base, default_useful_life_months,
        default_salvage_rule_type, default_salvage_amount_base,
        default_depreciation_profile_id,
        default_asset_account_id, default_accum_depr_account_id,
        default_depr_expense_account_id, default_disposal_gain_account_id,
        default_disposal_loss_account_id,
        created_by_user_id, updated_by_user_id
     ) VALUES (?,?,?,?,'ACTIVE',?,?,?,'FIXED_BASE_AMOUNT',?,?,?,?,?,?,?,?,?)`,
    [tenantId, legalEntityId, code, `FA39 Smoke Category ${uniqueSuffix}`,
     "Smoke category for STEP-FA39", 1000, 24, 100, profileId,
     accounts.assetAccountId, accounts.accumDeprAccountId,
     accounts.deprExpenseAccountId, accounts.disposalGainAccountId,
     accounts.disposalLossAccountId, userId, userId]);
  const categoryId = Number(ins.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create smoke category");
  return { categoryId, code };
}

async function createAndActivateAsset({
  cookie, categoryId, legalEntityId, ownerOuId, postingWindow, uniqueSuffix, nameSuffix, originalCost = 10000,
}) {
  const { payload: draft } = await apiRequest({
    cookie, method: "POST", pathName: "/api/v1/fixed-assets", expectedStatus: 201,
    body: {
      legalEntityId, name: `FA39 Smoke ${nameSuffix} ${uniqueSuffix}`, categoryId,
      acquisitionDate: postingWindow.acquisitionDate, currencyCode: SMOKE_CURRENCY_CODE,
      ownerOperatingUnitId: ownerOuId, locationOperatingUnitId: ownerOuId,
      originalCostTxn: originalCost, originalCostBase: originalCost,
      description: `STEP-FA39 smoke ${nameSuffix}`,
      assetTag: `FA39-${nameSuffix}-${uniqueSuffix}`.slice(0, 40),
    },
  });
  const assetId = Number(draft?.id || 0);
  assert(assetId > 0, `Failed to create draft asset for ${nameSuffix}`);

  const { payload: activated } = await apiRequest({
    cookie, method: "POST",
    pathName: `/api/v1/fixed-assets/${assetId}/activate`, expectedStatus: 200,
    body: {
      postingDate: postingWindow.postingDate,
      capitalizationDate: postingWindow.capitalizationDate,
      inServiceDate: postingWindow.inServiceDate,
    },
  });
  assert(activated?.status === "ACTIVE" || activated?.status === "FULLY_DEPRECIATED",
    `Expected ACTIVE or FULLY_DEPRECIATED, got ${activated?.status}`);
  return activated;
}

async function cleanupArtifacts(state) {
  const assetIds = Array.from(new Set(state.assetIds)).filter((id) => id > 0);

  // Clear pending sale linkage first
  if (assetIds.length > 0) {
    const ph = assetIds.map(() => "?").join(",");
    await query(`UPDATE fixed_assets SET pending_sale_cari_document_id=NULL, pending_sale_cari_document_line_id=NULL WHERE tenant_id=? AND id IN (${ph})`,
      [TENANT_ID, ...assetIds]);
  }

  // Clean up CARI documents created by smoke
  for (const docId of state.cariDocumentIds) {
    await query(`DELETE FROM cari_document_lines WHERE tenant_id=? AND cari_document_id=?`, [TENANT_ID, docId]);
    await query(`DELETE FROM cari_documents WHERE tenant_id=? AND id=?`, [TENANT_ID, docId]);
  }

  if (assetIds.length > 0) {
    const ph = assetIds.map(() => "?").join(",");
    const txnR = await query(`SELECT id, journal_entry_id FROM fixed_asset_transactions WHERE tenant_id=? AND asset_id IN (${ph})`, [TENANT_ID, ...assetIds]);
    for (const txn of (txnR.rows || [])) {
      if (txn.journal_entry_id) {
        await query(`DELETE FROM journal_source_links WHERE tenant_id=? AND journal_entry_id=?`, [TENANT_ID, txn.journal_entry_id]);
        await query(`DELETE FROM journal_lines WHERE journal_entry_id=?`, [txn.journal_entry_id]);
        await query(`DELETE FROM journal_entries WHERE id=? AND tenant_id=?`, [txn.journal_entry_id, TENANT_ID]);
      }
    }
    await query(`DELETE FROM fixed_asset_transactions WHERE tenant_id=? AND asset_id IN (${ph})`, [TENANT_ID, ...assetIds]);
    await query(`DELETE FROM fixed_assets WHERE tenant_id=? AND id IN (${ph})`, [TENANT_ID, ...assetIds]);
  }
  if (state.categoryId) await query(`DELETE FROM fixed_asset_categories WHERE tenant_id=? AND id=?`, [TENANT_ID, state.categoryId]);
  if (state.profileId) await query(`DELETE FROM fixed_asset_depreciation_profiles WHERE tenant_id=? AND id=?`, [TENANT_ID, state.profileId]);
  if (state.counterpartyId) await query(`DELETE FROM counterparties WHERE tenant_id=? AND id=?`, [TENANT_ID, state.counterpartyId]);
  if (state.restrictedUserId) {
    await query(`DELETE FROM user_role_scopes WHERE tenant_id=? AND user_id=?`, [TENANT_ID, state.restrictedUserId]);
    await query(`DELETE FROM users WHERE tenant_id=? AND id=?`, [TENANT_ID, state.restrictedUserId]);
  }
  if (state.restrictedRoleId) {
    await query(`DELETE FROM role_permissions WHERE role_id=?`, [state.restrictedRoleId]);
    await query(`DELETE FROM roles WHERE id=? AND tenant_id=?`, [state.restrictedRoleId, TENANT_ID]);
  }
  if (state.userId) {
    await query(`DELETE FROM user_role_scopes WHERE tenant_id=? AND user_id=?`, [TENANT_ID, state.userId]);
    await query(`DELETE FROM users WHERE tenant_id=? AND id=?`, [TENANT_ID, state.userId]);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main smoke runner
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const ctx = await resolveSmokeContext();
  TENANT_ID = ctx.tenantId;
  LEGAL_ENTITY_ID = ctx.legalEntityId;
  SMOKE_CURRENCY_CODE = String(ctx.currencyCode || "USD").trim().toUpperCase() || "USD";
  const uniqueSuffix = `${Date.now()}`;
  let runPassed = false;
  const artifactState = {
    userId: null, profileId: null, categoryId: null, counterpartyId: null,
    restrictedUserId: null, restrictedRoleId: null,
    assetIds: [], cariDocumentIds: [],
  };
  const summary = {
    baseUrl: BASE_URL, tenantId: TENANT_ID, legalEntityId: LEGAL_ENTITY_ID,
    keepArtifacts: KEEP_ARTIFACTS, serverStartedByScript: false,
    smoke1_createDraftAr: null,
    smoke2_linkArDocument: null,
    smoke3_updateDraftAr: null,
    smoke4_noSaleRow: null,
    smoke5_draftAssetRejection: null,
    cleanup: KEEP_ARTIFACTS ? "skipped" : "pending",
  };

  let server = null;

  try {
    server = await ensureApiServer();
    summary.serverStartedByScript = Boolean(server.startedByScript);

    // ── Fixtures ─────────────────────────────────────────────────
    const smokeUser = await createSmokeUser({ tenantId: TENANT_ID, uniqueSuffix });
    artifactState.userId = smokeUser.userId;

    const accounts = await resolveAccountFixtures(TENANT_ID, LEGAL_ENTITY_ID);
    const ownerOuId = await resolveActiveOuId(TENANT_ID, LEGAL_ENTITY_ID);
    const postingWindow = await resolveOpenPostingWindow(TENANT_ID, LEGAL_ENTITY_ID);

    const profile = await createSmokeProfile({
      tenantId: TENANT_ID, legalEntityId: LEGAL_ENTITY_ID,
      userId: smokeUser.userId, uniqueSuffix,
    });
    artifactState.profileId = profile.profileId;

    const category = await createSmokeCategory({
      tenantId: TENANT_ID, legalEntityId: LEGAL_ENTITY_ID,
      userId: smokeUser.userId, profileId: profile.profileId,
      uniqueSuffix, accounts,
    });
    artifactState.categoryId = category.categoryId;

    const customer = await createSmokeCustomerCounterparty({
      tenantId: TENANT_ID, legalEntityId: LEGAL_ENTITY_ID,
      arAccountId: accounts.assetAccountId,
      uniqueSuffix,
    });
    artifactState.counterpartyId = customer.counterpartyId;

    const cookie = await login(smokeUser.email, smokeUser.password);

    // ══════════════════════════════════════════════════════════════
    // SMOKE 1: Create draft AR document for asset sale
    // ══════════════════════════════════════════════════════════════
    console.log("[fa39-smoke] SMOKE 1: Create draft AR document...");

    const asset1 = await createAndActivateAsset({
      cookie, categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID, ownerOuId,
      postingWindow, uniqueSuffix, nameSuffix: "SALE-DRAFT",
      originalCost: 10000,
    });
    const assetId1 = Number(asset1.id);
    artifactState.assetIds.push(assetId1);

    const { payload: createResult } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId1}/sale/create-draft-ar-document`,
      expectedStatus: 201,
      body: {
        counterpartyId: customer.counterpartyId,
        documentDate: postingWindow.saleDate,
        saleAmountTxn: 8000,
      },
    });

    assert(createResult?.assetId === assetId1,
      `SMOKE1: Expected assetId=${assetId1}, got ${createResult?.assetId}`);
    assert(createResult?.pendingSaleCariDocumentId > 0,
      "SMOKE1: pendingSaleCariDocumentId missing");
    assert(createResult?.pendingSaleCariDocumentLineId > 0,
      "SMOKE1: pendingSaleCariDocumentLineId missing");

    const docId1 = createResult.pendingSaleCariDocumentId;
    const lineId1 = createResult.pendingSaleCariDocumentLineId;
    artifactState.cariDocumentIds.push(docId1);

    // Verify AR document is DRAFT
    assert(createResult?.document?.status === "DRAFT",
      `SMOKE1: Expected AR doc status=DRAFT, got ${createResult?.document?.status}`);
    assert(createResult?.document?.direction === "AR",
      `SMOKE1: Expected direction=AR, got ${createResult?.document?.direction}`);

    // Verify one dedicated line was created
    const lines1 = createResult?.document?.lines || [];
    assert(lines1.length >= 1,
      `SMOKE1: Expected at least 1 line, got ${lines1.length}`);

    // Verify pending sale linkage on asset
    const assetCheck1 = await query(
      `SELECT pending_sale_cari_document_id, pending_sale_cari_document_line_id, status
         FROM fixed_assets WHERE tenant_id=? AND id=?`, [TENANT_ID, assetId1]);
    const ac1 = assetCheck1.rows?.[0];
    assert(toNumber(ac1?.pending_sale_cari_document_id) === docId1,
      `SMOKE1: Asset pending_sale_cari_document_id expected ${docId1}, got ${ac1?.pending_sale_cari_document_id}`);
    assert(toNumber(ac1?.pending_sale_cari_document_line_id) === lineId1,
      `SMOKE1: Asset pending_sale_cari_document_line_id expected ${lineId1}`);

    // Verify asset is NOT disposed — still in pre-sale state
    assert(ac1?.status !== "DISPOSED",
      "SMOKE1: Asset should NOT be DISPOSED after create-draft");

    // Verify no SALE transaction exists
    const saleTxn1 = await query(
      `SELECT id FROM fixed_asset_transactions
        WHERE tenant_id=? AND asset_id=? AND transaction_type='SALE'`, [TENANT_ID, assetId1]);
    assert((saleTxn1.rows || []).length === 0,
      "SMOKE1: No SALE transaction should exist after create-draft");

    summary.smoke1_createDraftAr = {
      assetId: assetId1, docId: docId1, lineId: lineId1,
      docStatus: "DRAFT", direction: "AR",
      assetStatus: ac1?.status, noSaleRow: true, PASS: true,
    };
    console.log("[fa39-smoke] SMOKE 1 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 2: Link an existing AR document/line
    // ══════════════════════════════════════════════════════════════
    console.log("[fa39-smoke] SMOKE 2: Link existing AR document/line...");

    const asset2 = await createAndActivateAsset({
      cookie, categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID, ownerOuId,
      postingWindow, uniqueSuffix: uniqueSuffix + "lk",
      nameSuffix: "SALE-LINK", originalCost: 12000,
    });
    const assetId2 = Number(asset2.id);
    artifactState.assetIds.push(assetId2);

    // Create a separate AR draft document via CARI endpoint first
    const { payload: cariDoc } = await apiRequest({
      cookie, method: "POST", pathName: "/api/v1/cari/documents",
      expectedStatus: 201,
      body: {
        legalEntityId: LEGAL_ENTITY_ID,
        counterpartyId: customer.counterpartyId,
        direction: "AR",
        documentType: "INVOICE",
        currencyCode: SMOKE_CURRENCY_CODE,
        documentDate: postingWindow.saleDate,
        dueDate: postingWindow.saleDate,
        amountTxn: 9000,
        lines: [
          {
            description: "Sale line for asset linkage",
            quantity: 1,
            unitPriceTxn: 9000,
            lineNetAmountTxn: 9000,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 9000,
          },
        ],
      },
    });
    const cariDocRow2 = cariDoc?.row || cariDoc;
    const cariDocId2 = Number(cariDocRow2?.id || 0);
    assert(cariDocId2 > 0, "SMOKE2: Failed to create CARI AR document");
    artifactState.cariDocumentIds.push(cariDocId2);
    const cariLineId2 = Number((cariDocRow2?.lines || [])[0]?.id || 0);
    assert(cariLineId2 > 0, "SMOKE2: Failed to get CARI line ID");

    // Link the existing AR document/line to the asset
    const { payload: linkResult } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId2}/sale/link-ar-document`,
      expectedStatus: 200,
      body: {
        cariDocumentId: cariDocId2,
        cariDocumentLineId: cariLineId2,
      },
    });

    assert(linkResult?.assetId === assetId2,
      `SMOKE2: Expected assetId=${assetId2}`);
    assert(linkResult?.pendingSaleCariDocumentId === cariDocId2,
      `SMOKE2: Expected pendingSaleCariDocumentId=${cariDocId2}`);
    assert(linkResult?.pendingSaleCariDocumentLineId === cariLineId2,
      `SMOKE2: Expected pendingSaleCariDocumentLineId=${cariLineId2}`);

    // Verify DB state
    const assetCheck2 = await query(
      `SELECT pending_sale_cari_document_id, pending_sale_cari_document_line_id, status
         FROM fixed_assets WHERE tenant_id=? AND id=?`, [TENANT_ID, assetId2]);
    const ac2 = assetCheck2.rows?.[0];
    assert(toNumber(ac2?.pending_sale_cari_document_id) === cariDocId2,
      "SMOKE2: pending_sale_cari_document_id mismatch");
    assert(ac2?.status !== "DISPOSED", "SMOKE2: Asset should NOT be DISPOSED after link");

    // Verify shared-line rejection: try to link same line to asset1
    // First clear asset1's existing pending linkage
    await query(
      `UPDATE fixed_assets SET pending_sale_cari_document_id=NULL, pending_sale_cari_document_line_id=NULL
        WHERE tenant_id=? AND id=?`, [TENANT_ID, assetId1]);

    const { status: sharedStatus } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId1}/sale/link-ar-document`,
      body: {
        cariDocumentId: cariDocId2,
        cariDocumentLineId: cariLineId2,
      },
    });
    assert(sharedStatus === 400,
      `SMOKE2: Expected 400 for shared-line linkage, got ${sharedStatus}`);

    summary.smoke2_linkArDocument = {
      assetId: assetId2, docId: cariDocId2, lineId: cariLineId2,
      assetStatus: ac2?.status, sharedLineRejected: true, PASS: true,
    };
    console.log("[fa39-smoke] SMOKE 2 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 3: Update draft AR document
    // ══════════════════════════════════════════════════════════════
    console.log("[fa39-smoke] SMOKE 3: Update draft AR document...");

    // Re-link asset1 to its original draft doc for update testing
    await query(
      `UPDATE fixed_assets SET pending_sale_cari_document_id=?, pending_sale_cari_document_line_id=?
        WHERE tenant_id=? AND id=?`, [docId1, lineId1, TENANT_ID, assetId1]);

    const { payload: updateResult } = await apiRequest({
      cookie, method: "PATCH",
      pathName: `/api/v1/fixed-assets/${assetId1}/sale/draft-ar-document`,
      expectedStatus: 200,
      body: {
        saleAmountTxn: 7500,
        description: "Updated sale description for smoke test",
      },
    });

    assert(updateResult?.assetId === assetId1,
      `SMOKE3: Expected assetId=${assetId1}`);
    assert(updateResult?.pendingSaleCariDocumentId === docId1,
      `SMOKE3: Expected same docId=${docId1}`);
    const updatedDraftLineId = Number((updateResult?.document?.lines || [])[0]?.id || 0);
    assert(updatedDraftLineId > 0,
      "SMOKE3: Updated draft document line ID missing");
    assert(Number(updateResult?.pendingSaleCariDocumentLineId || 0) === updatedDraftLineId,
      `SMOKE3: Expected pendingSaleCariDocumentLineId=${updatedDraftLineId}, got ${updateResult?.pendingSaleCariDocumentLineId}`);

    // Verify asset is still NOT disposed
    const assetCheck3 = await query(
      `SELECT status, pending_sale_cari_document_line_id
         FROM fixed_assets WHERE tenant_id=? AND id=?`, [TENANT_ID, assetId1]);
    assert(assetCheck3.rows?.[0]?.status !== "DISPOSED",
      "SMOKE3: Asset should NOT be DISPOSED after update");
    assert(toNumber(assetCheck3.rows?.[0]?.pending_sale_cari_document_line_id) === updatedDraftLineId,
      `SMOKE3: Expected asset pending_sale_cari_document_line_id=${updatedDraftLineId}, got ${assetCheck3.rows?.[0]?.pending_sale_cari_document_line_id}`);

    // Verify no SALE transaction
    const saleTxn3 = await query(
      `SELECT id FROM fixed_asset_transactions
        WHERE tenant_id=? AND asset_id=? AND transaction_type='SALE'`, [TENANT_ID, assetId1]);
    assert((saleTxn3.rows || []).length === 0,
      "SMOKE3: No SALE transaction should exist after update");

    summary.smoke3_updateDraftAr = {
      assetId: assetId1, docId: docId1,
      lineId: updatedDraftLineId,
      assetStatus: assetCheck3.rows?.[0]?.status, noSaleRow: true, PASS: true,
    };
    console.log("[fa39-smoke] SMOKE 3 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 4: Verify no SALE rows across all test assets
    // ══════════════════════════════════════════════════════════════
    console.log("[fa39-smoke] SMOKE 4: No SALE transactions exist...");

    const allSaleTxns = await query(
      `SELECT id, asset_id FROM fixed_asset_transactions
        WHERE tenant_id=? AND transaction_type='SALE'
          AND asset_id IN (?, ?)`, [TENANT_ID, assetId1, assetId2]);
    assert((allSaleTxns.rows || []).length === 0,
      "SMOKE4: No SALE transactions should exist for any staged assets");

    summary.smoke4_noSaleRow = { totalSaleRows: 0, PASS: true };
    console.log("[fa39-smoke] SMOKE 4 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 5: DRAFT asset rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa39-smoke] SMOKE 5: DRAFT asset sale staging rejection...");

    const { payload: draftAsset } = await apiRequest({
      cookie, method: "POST", pathName: "/api/v1/fixed-assets", expectedStatus: 201,
      body: {
        legalEntityId: LEGAL_ENTITY_ID,
        name: `FA39 Smoke DRAFT ${uniqueSuffix}`,
        categoryId: category.categoryId,
        acquisitionDate: postingWindow.acquisitionDate,
        currencyCode: SMOKE_CURRENCY_CODE,
        ownerOperatingUnitId: ownerOuId,
        locationOperatingUnitId: ownerOuId,
        originalCostTxn: 5000, originalCostBase: 5000,
      },
    });
    const draftId = Number(draftAsset?.id || 0);
    assert(draftId > 0, "SMOKE5: Failed to create draft asset");
    artifactState.assetIds.push(draftId);

    const { status: draftStatus } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${draftId}/sale/create-draft-ar-document`,
      body: {
        counterpartyId: customer.counterpartyId,
        documentDate: postingWindow.saleDate,
        saleAmountTxn: 3000,
      },
    });
    assert(draftStatus === 400,
      `SMOKE5: Expected 400 for DRAFT asset sale staging, got ${draftStatus}`);

    summary.smoke5_draftAssetRejection = { assetId: draftId, httpStatus: draftStatus, PASS: true };
    console.log("[fa39-smoke] SMOKE 5 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 6/7/8: Permission rejection – missing cari.doc.* perms
    // ══════════════════════════════════════════════════════════════
    console.log("[fa39-smoke] SMOKE 6: Permission rejection – create-draft-ar (missing cari.doc.create)...");

    // Create restricted user with fixed_assets.dispose but NO cari.doc.* permissions
    const restrictedPassword = "FA39Restricted#12345";
    const restrictedHash = await bcrypt.hash(restrictedPassword, 10);
    const restrictedEmail = `fa39.restricted.${uniqueSuffix}@example.test`;
    const restrictedUserIns = await query(
      `INSERT INTO users (tenant_id, email, password_hash, name, status) VALUES (?,?,?,?,'ACTIVE')`,
      [TENANT_ID, restrictedEmail, restrictedHash, `FA39 Restricted ${uniqueSuffix}`]);
    const restrictedUserId = Number(restrictedUserIns.rows?.insertId || 0);
    assert(restrictedUserId > 0, "Failed to create restricted user");
    artifactState.restrictedUserId = restrictedUserId;

    // Create a custom role with ONLY fixed_assets.dispose
    const restrictedRoleIns = await query(
      `INSERT INTO roles (tenant_id, code, name, is_system) VALUES (?,?,?,0)`,
      [TENANT_ID, `FA39RSTR${uniqueSuffix.slice(-8)}`, `FA39 Restricted ${uniqueSuffix.slice(-8)}`]);
    const restrictedRoleId = Number(restrictedRoleIns.rows?.insertId || 0);
    assert(restrictedRoleId > 0, "Failed to create restricted role");
    artifactState.restrictedRoleId = restrictedRoleId;

    const permIdR = await query(
      `SELECT id FROM permissions WHERE code='fixed_assets.dispose' LIMIT 1`, []);
    const disposePermId = Number(permIdR.rows?.[0]?.id || 0);
    assert(disposePermId > 0, "fixed_assets.dispose permission not found");

    await query(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)`,
      [restrictedRoleId, disposePermId]);
    await query(
      `INSERT INTO user_role_scopes (tenant_id,user_id,role_id,scope_type,scope_id,effect) VALUES (?,?,?,'TENANT',?,'ALLOW')`,
      [TENANT_ID, restrictedUserId, restrictedRoleId, TENANT_ID]);

    const restrictedCookie = await login(restrictedEmail, restrictedPassword);

    // Use assetId1 (already active) for permission tests
    // SMOKE 6: create-draft-ar-document → requires cari.doc.create → expect 403
    const { status: permStatus6, payload: permPayload6 } = await apiRequest({
      cookie: restrictedCookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId2}/sale/create-draft-ar-document`,
      body: {
        counterpartyId: customer.counterpartyId,
        documentDate: postingWindow.saleDate,
        saleAmountTxn: 5000,
      },
    });
    assert(permStatus6 === 403,
      `SMOKE6: Expected 403 for missing cari.doc.create, got ${permStatus6}`);
    const permMsg6 = String(permPayload6?.message || "");
    assert(permMsg6.includes("Missing secondary permission") || permMsg6.includes("cari.doc.create"),
      `SMOKE6: Expected secondary permission failure message, got: ${permMsg6}`);

    summary.smoke6_permCreateDraft = { httpStatus: permStatus6, message: permMsg6, PASS: true };
    console.log("[fa39-smoke] SMOKE 6 PASSED ✓");

    // SMOKE 7: link-ar-document → requires cari.doc.read → expect 403
    console.log("[fa39-smoke] SMOKE 7: Permission rejection – link-ar (missing cari.doc.read)...");

    const { status: permStatus7, payload: permPayload7 } = await apiRequest({
      cookie: restrictedCookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId2}/sale/link-ar-document`,
      body: { cariDocumentId: 1, cariDocumentLineId: 1 },
    });
    assert(permStatus7 === 403,
      `SMOKE7: Expected 403 for missing cari.doc.read, got ${permStatus7}`);
    const permMsg7 = String(permPayload7?.message || "");
    assert(permMsg7.includes("Missing secondary permission") || permMsg7.includes("cari.doc.read"),
      `SMOKE7: Expected secondary permission failure message, got: ${permMsg7}`);

    summary.smoke7_permLinkAr = { httpStatus: permStatus7, message: permMsg7, PASS: true };
    console.log("[fa39-smoke] SMOKE 7 PASSED ✓");

    // SMOKE 8: draft-ar-document → requires cari.doc.update → expect 403
    console.log("[fa39-smoke] SMOKE 8: Permission rejection – update-draft-ar (missing cari.doc.update)...");

    const { status: permStatus8, payload: permPayload8 } = await apiRequest({
      cookie: restrictedCookie, method: "PATCH",
      pathName: `/api/v1/fixed-assets/${assetId1}/sale/draft-ar-document`,
      body: { saleAmountTxn: 9999 },
    });
    assert(permStatus8 === 403,
      `SMOKE8: Expected 403 for missing cari.doc.update, got ${permStatus8}`);
    const permMsg8 = String(permPayload8?.message || "");
    assert(permMsg8.includes("Missing secondary permission") || permMsg8.includes("cari.doc.update"),
      `SMOKE8: Expected secondary permission failure message, got: ${permMsg8}`);

    summary.smoke8_permUpdateDraft = { httpStatus: permStatus8, message: permMsg8, PASS: true };
    console.log("[fa39-smoke] SMOKE 8 PASSED ✓");

    runPassed = true;
  } catch (err) {
    console.error("[fa39-smoke] FAILED:", err.message || err);
    console.error(err.stack || "");
    runPassed = false;
  } finally {
    if (!KEEP_ARTIFACTS) {
      try { await cleanupArtifacts(artifactState); summary.cleanup = "done"; }
      catch (e) { console.error("[fa39-smoke] Cleanup error:", e.message); summary.cleanup = `error: ${e.message}`; }
    }
    if (server?.startedByScript && server.child) await stopServer(server.child);
    try { await closePool(); } catch { /* ignore */ }
  }

  console.log("\n[fa39-smoke] ═══════════════════════════════════════════");
  console.log("[fa39-smoke] SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("[fa39-smoke] ═══════════════════════════════════════════");

  if (runPassed) {
    console.log("[fa39-smoke] ALL SMOKES PASSED ✓");
    process.exit(0);
  } else {
    console.error("[fa39-smoke] SOME SMOKES FAILED ✗");
    process.exit(1);
  }
}

main();
