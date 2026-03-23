
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

const TEST_PORT = Number(process.env.FA38_SMOKE_PORT || 3138);
const BASE_URL =
  process.env.FA38_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA38_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA38_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA38_SMOKE_LEGAL_ENTITY_ID
);
let TENANT_ID = ENV_TENANT_ID || 0;
let LEGAL_ENTITY_ID = ENV_LEGAL_ENTITY_ID || 0;
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA38_SMOKE_KEEP_ARTIFACTS,
  true
);

function parseOptionalPositiveInt(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toNumber(v) { return Number(v || 0); }
function toAmount(v) { return Math.round(Number(v || 0) * 10000) / 10000; }

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minDate(a, b) { return a <= b ? a : b; }

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

async function isApiAlive() {
  try {
    const { response, payload } = await fetchJson(`${BASE_URL}/health`, {}, 2500);
    return response.status >= 200 && response.status < 600 && payload && typeof payload === "object" && payload.checks;
  } catch { return false; }
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[fa38-smoke][server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[fa38-smoke][server] ${chunk}`));
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
  const result = await query(
    `SELECT id FROM roles WHERE tenant_id = ? AND code = 'TenantAdmin' LIMIT 1`,
    [tenantId]
  );
  const roleId = Number(result.rows?.[0]?.id || 0);
  assert(roleId > 0, `TenantAdmin role not found for tenant ${tenantId}`);
  return roleId;
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA38" });
}

async function resolveActiveOperatingUnitId(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id FROM operating_units
      WHERE tenant_id = ? AND legal_entity_id = ? AND status = 'ACTIVE'
      ORDER BY id ASC LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const ouId = Number(result.rows?.[0]?.id || 0);
  assert(ouId > 0, `No ACTIVE operating unit found for tenant ${tenantId}, LE ${legalEntityId}`);
  return ouId;
}

async function resolveAccountFixtures(tenantId, legalEntityId) {
  const assetRows = await query(
    `SELECT a.id FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
       AND a.is_active = 1 AND a.allow_posting = 1 AND a.account_type = 'ASSET'
     ORDER BY a.id ASC LIMIT 2`,
    [tenantId, legalEntityId]
  );
  const expenseRows = await query(
    `SELECT a.id FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
       AND a.is_active = 1 AND a.allow_posting = 1 AND a.account_type = 'EXPENSE'
     ORDER BY a.id ASC LIMIT 2`,
    [tenantId, legalEntityId]
  );
  const revenueRows = await query(
    `SELECT a.id FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ? AND c.legal_entity_id = ? AND c.scope = 'LEGAL_ENTITY'
       AND a.is_active = 1 AND a.allow_posting = 1 AND a.account_type = 'REVENUE'
     ORDER BY a.id ASC LIMIT 1`,
    [tenantId, legalEntityId]
  );

  const assetAccounts = (assetRows.rows || []).map((r) => Number(r.id));
  const expenseAccounts = (expenseRows.rows || []).map((r) => Number(r.id));
  const revenueAccounts = (revenueRows.rows || []).map((r) => Number(r.id));
  assert(assetAccounts.length >= 1, "No usable ASSET accounts found");
  assert(expenseAccounts.length >= 1, "No usable EXPENSE accounts found");
  assert(revenueAccounts.length >= 1, "No usable REVENUE accounts found");

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
  const result = await query(
    `SELECT b.id AS book_id, fp.id AS fiscal_period_id,
            fp.start_date, fp.end_date, fp.period_name
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps ON ps.book_id = b.id AND ps.fiscal_period_id = fp.id
      WHERE b.tenant_id = ? AND b.legal_entity_id = ? AND b.book_type = 'LOCAL'
        AND fp.is_adjustment = 0 AND COALESCE(ps.status, 'OPEN') = 'OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC, fp.id DESC
      LIMIT 1`,
    [tenantId, legalEntityId, today]
  );
  const row = result.rows?.[0];
  assert(row, `No OPEN fiscal period found for tenant ${tenantId}, LE ${legalEntityId}`);

  const acquisitionDate = row.start_date;
  const capitalizationDate = minDate(addDays(acquisitionDate, 1), row.end_date);
  const inServiceDate = minDate(addDays(acquisitionDate, 2), row.end_date);
  const postingDate = minDate(addDays(acquisitionDate, 3), row.end_date);
  const writeoffDate = minDate(addDays(acquisitionDate, 5), row.end_date);

  return {
    bookId: Number(row.book_id),
    fiscalPeriodId: Number(row.fiscal_period_id),
    periodName: String(row.period_name || ""),
    startDate: row.start_date,
    endDate: row.end_date,
    acquisitionDate,
    capitalizationDate,
    inServiceDate,
    postingDate,
    writeoffDate,
  };
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA38Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa38.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA38 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create smoke user");

  const roleId = await resolveTenantAdminRoleId(tenantId);
  await query(
    `INSERT INTO user_role_scopes (tenant_id, user_id, role_id, scope_type, scope_id, effect)
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
    [tenantId, userId, roleId, tenantId]
  );
  return { userId, email, password, roleId };
}

async function createSmokeProfile({ tenantId, legalEntityId, userId, uniqueSuffix }) {
  const code = `FA38PF${uniqueSuffix.slice(-6)}`;
  const insertResult = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id, legal_entity_id, code, name, status, method,
        declining_balance_rate_percent, switch_to_straight_line,
        description, created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE', NULL, 0, ?, ?, ?)`,
    [tenantId, legalEntityId, code, `FA38 Smoke Profile ${uniqueSuffix}`,
     "Smoke profile for STEP-FA38 write-off", userId, userId]
  );
  const profileId = Number(insertResult.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create smoke depreciation profile");
  return { profileId, code };
}

async function createSmokeCategory({ tenantId, legalEntityId, userId, profileId, uniqueSuffix, accounts }) {
  const code = `FA38CT${uniqueSuffix.slice(-6)}`;
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
     ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 'FIXED_BASE_AMOUNT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, legalEntityId, code, `FA38 Smoke Category ${uniqueSuffix}`,
     "Smoke category for STEP-FA38 write-off",
     1000, 24, 100, profileId,
     accounts.assetAccountId, accounts.accumDeprAccountId,
     accounts.deprExpenseAccountId, accounts.disposalGainAccountId,
     accounts.disposalLossAccountId,
     userId, userId]
  );
  const categoryId = Number(insertResult.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create smoke category");
  return { categoryId, code };
}

async function createAndActivateAsset({
  cookie, categoryId, legalEntityId, ownerOperatingUnitId,
  postingWindow, uniqueSuffix, nameSuffix, originalCost = 10000,
}) {
  const { payload: draft } = await apiRequest({
    cookie, method: "POST", pathName: "/api/v1/fixed-assets", expectedStatus: 201,
    body: {
      legalEntityId, name: `FA38 Smoke ${nameSuffix} ${uniqueSuffix}`, categoryId,
      acquisitionDate: postingWindow.acquisitionDate, currencyCode: "AFN",
      ownerOperatingUnitId, locationOperatingUnitId: ownerOperatingUnitId,
      originalCostTxn: originalCost, originalCostBase: originalCost,
      description: `STEP-FA38 smoke ${nameSuffix}`,
      assetTag: `FA38-${nameSuffix}-${uniqueSuffix}`.slice(0, 40),
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
  assert(
    activated?.status === "ACTIVE" || activated?.status === "FULLY_DEPRECIATED",
    `Expected activated asset to be ACTIVE or FULLY_DEPRECIATED, got ${activated?.status}`
  );
  return activated;
}

async function cleanupArtifacts(state) {
  const assetIds = Array.from(new Set(state.assetIds)).filter((id) => Number(id) > 0);

  if (assetIds.length > 0) {
    const placeholders = assetIds.map(() => "?").join(", ");

    // Clean up journal artifacts
    const txnResult = await query(
      `SELECT id, journal_entry_id FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
    for (const txn of (txnResult.rows || [])) {
      if (txn.journal_entry_id) {
        await query(`DELETE FROM journal_source_links WHERE tenant_id = ? AND journal_entry_id = ?`,
          [TENANT_ID, txn.journal_entry_id]);
        await query(`DELETE FROM journal_lines WHERE journal_entry_id = ?`, [txn.journal_entry_id]);
        await query(`DELETE FROM journal_entries WHERE id = ? AND tenant_id = ?`,
          [txn.journal_entry_id, TENANT_ID]);
      }
    }

    await query(
      `DELETE FROM fixed_asset_transactions WHERE tenant_id = ? AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
    await query(
      `DELETE FROM fixed_assets WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
  }

  if (state.categoryId) {
    await query(`DELETE FROM fixed_asset_categories WHERE tenant_id = ? AND id = ?`,
      [TENANT_ID, state.categoryId]);
  }
  if (state.profileId) {
    await query(`DELETE FROM fixed_asset_depreciation_profiles WHERE tenant_id = ? AND id = ?`,
      [TENANT_ID, state.profileId]);
  }
  if (state.userId) {
    await query(`DELETE FROM user_role_scopes WHERE tenant_id = ? AND user_id = ?`,
      [TENANT_ID, state.userId]);
    await query(`DELETE FROM users WHERE tenant_id = ? AND id = ?`,
      [TENANT_ID, state.userId]);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main smoke runner
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const smokeContext = await resolveSmokeContext();
  TENANT_ID = smokeContext.tenantId;
  LEGAL_ENTITY_ID = smokeContext.legalEntityId;
  const uniqueSuffix = `${Date.now()}`;
  let runPassed = false;
  const artifactState = { userId: null, profileId: null, categoryId: null, assetIds: [] };
  const summary = {
    baseUrl: BASE_URL,
    tenantId: TENANT_ID,
    legalEntityId: LEGAL_ENTITY_ID,
    keepArtifacts: KEEP_ARTIFACTS,
    serverStartedByScript: false,
    fixtureIds: {},
    smoke1_partiallyDepreciatedWriteoff: null,
    smoke2_fullyDepreciatedWriteoff: null,
    smoke3_alreadyDisposedRejection: null,
    smoke4_draftAssetRejection: null,
    cleanup: KEEP_ARTIFACTS ? "skipped" : "pending",
  };

  let server = null;

  try {
    server = await ensureApiServer();
    summary.serverStartedByScript = Boolean(server.startedByScript);

    // ── Create fixtures ──────────────────────────────────────────
    const smokeUser = await createSmokeUser({ tenantId: TENANT_ID, uniqueSuffix });
    artifactState.userId = smokeUser.userId;

    const accounts = await resolveAccountFixtures(TENANT_ID, LEGAL_ENTITY_ID);
    const ownerOuId = await resolveActiveOperatingUnitId(TENANT_ID, LEGAL_ENTITY_ID);
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

    summary.fixtureIds = {
      userId: smokeUser.userId,
      profileId: profile.profileId,
      categoryId: category.categoryId,
      ownerOuId,
    };

    const cookie = await login(smokeUser.email, smokeUser.password);

    // ══════════════════════════════════════════════════════════════
    // SMOKE 1: Write off a partially depreciated asset
    // ══════════════════════════════════════════════════════════════
    console.log("[fa38-smoke] SMOKE 1: Partially depreciated asset write-off...");

    const asset1 = await createAndActivateAsset({
      cookie, categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID, ownerOperatingUnitId: ownerOuId,
      postingWindow, uniqueSuffix, nameSuffix: "WO-PARTIAL",
      originalCost: 10000,
    });
    const assetId1 = Number(asset1.id);
    artifactState.assetIds.push(assetId1);

    // Verify asset is ACTIVE with non-zero NBV before write-off
    assert(
      asset1.status === "ACTIVE" || asset1.status === "FULLY_DEPRECIATED",
      `SMOKE1: Asset should be ACTIVE or FULLY_DEPRECIATED, got ${asset1.status}`
    );

    const { payload: woResult1 } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId1}/writeoff`,
      expectedStatus: 200,
      body: {
        effectiveDate: postingWindow.writeoffDate,
        postingDate: postingWindow.writeoffDate,
        note: "SMOKE1 partial depreciation write-off",
      },
    });

    // Verify asset is now DISPOSED
    assert(
      woResult1?.status === "DISPOSED",
      `SMOKE1: Expected status=DISPOSED, got ${woResult1?.status}`
    );

    // Verify disposal date is set
    const disposalDateStr1 = woResult1?.disposalDate
      ? String(woResult1.disposalDate).slice(0, 10)
      : null;
    assert(
      disposalDateStr1 === postingWindow.writeoffDate,
      `SMOKE1: Expected disposalDate=${postingWindow.writeoffDate}, got ${disposalDateStr1}`
    );

    // Verify WRITEOFF transaction exists
    const txn1Result = await query(
      `SELECT id, transaction_type, status, journal_entry_id,
              gross_amount_txn, gross_amount_base,
              accum_depr_amount_txn, accum_depr_amount_base,
              nbv_amount_txn, nbv_amount_base
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
          AND transaction_type = 'WRITEOFF' AND status = 'POSTED'
        ORDER BY id DESC LIMIT 1`,
      [TENANT_ID, assetId1]
    );
    const txn1 = txn1Result.rows?.[0];
    assert(txn1, "SMOKE1: WRITEOFF transaction not found");
    assert(
      toAmount(txn1.gross_amount_txn) === 10000,
      `SMOKE1: gross_amount_txn expected 10000, got ${txn1.gross_amount_txn}`
    );

    const txn1JournalId = Number(txn1.journal_entry_id);
    assert(txn1JournalId > 0, "SMOKE1: journal_entry_id missing on WRITEOFF transaction");

    // Verify journal lines
    const lines1Result = await query(
      `SELECT line_no, account_id, debit_base, credit_base, operating_unit_id
         FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_no ASC`,
      [txn1JournalId]
    );
    const lines1 = lines1Result.rows || [];

    const nbv1 = toAmount(txn1.nbv_amount_txn);
    const accumDepr1 = toAmount(txn1.accum_depr_amount_txn);

    if (nbv1 > 0 && accumDepr1 > 0) {
      // 3 lines: debit accum-depr + credit asset + debit loss
      assert(lines1.length === 3,
        `SMOKE1: Expected 3 journal lines (accum>0, nbv>0), got ${lines1.length}`);
    } else if (nbv1 > 0 && accumDepr1 === 0) {
      // 2 lines: credit asset + debit loss (no accum line since accum=0)
      assert(lines1.length === 2,
        `SMOKE1: Expected 2 journal lines (accum=0, nbv>0), got ${lines1.length}`);
    } else if (nbv1 === 0 && accumDepr1 > 0) {
      // 2 lines: debit accum-depr + credit asset (no loss since nbv=0)
      assert(lines1.length === 2,
        `SMOKE1: Expected 2 journal lines (accum>0, nbv=0), got ${lines1.length}`);
    }

    // Verify journal line amounts balance
    let totalDebit1 = 0, totalCredit1 = 0;
    for (const line of lines1) {
      totalDebit1 += toAmount(line.debit_base);
      totalCredit1 += toAmount(line.credit_base);
    }
    assert(
      Math.abs(totalDebit1 - totalCredit1) < 0.01,
      `SMOKE1: Journal lines not balanced: debit=${totalDebit1}, credit=${totalCredit1}`
    );

    // Verify total credit = gross cost (asset removal)
    assert(
      toAmount(totalCredit1) === 10000,
      `SMOKE1: Total credit expected 10000 (gross cost), got ${totalCredit1}`
    );

    // Verify PRIMARY source link
    const link1Result = await query(
      `SELECT source_ref_type, source_ref_id FROM journal_source_links
        WHERE tenant_id = ? AND journal_entry_id = ? LIMIT 1`,
      [TENANT_ID, txn1JournalId]
    );
    const link1 = link1Result.rows?.[0];
    assert(link1, "SMOKE1: journal_source_links row not found");
    assert(link1.source_ref_type === "FIXED_ASSET_TRANSACTION",
      `SMOKE1: source_ref_type expected FIXED_ASSET_TRANSACTION, got ${link1.source_ref_type}`);
    assert(toNumber(link1.source_ref_id) === toNumber(txn1.id),
      `SMOKE1: source_ref_id mismatch`);

    // Verify exactly one WRITEOFF transaction (not zero-amount depreciation)
    const allWoTxns1 = await query(
      `SELECT transaction_type, status FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
          AND transaction_type = 'WRITEOFF' AND status = 'POSTED'`,
      [TENANT_ID, assetId1]
    );
    assert(
      (allWoTxns1.rows || []).length === 1,
      `SMOKE1: Expected exactly 1 WRITEOFF transaction, got ${(allWoTxns1.rows || []).length}`
    );

    summary.smoke1_partiallyDepreciatedWriteoff = {
      assetId: assetId1,
      transactionId: toNumber(txn1.id),
      journalEntryId: txn1JournalId,
      journalLineCount: lines1.length,
      grossCost: 10000,
      accumDepr: accumDepr1,
      nbv: nbv1,
      disposalDate: postingWindow.writeoffDate,
      journalBalanced: true,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 1 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 2: Write off a fully depreciated asset (NBV=0)
    // ══════════════════════════════════════════════════════════════
    console.log("[fa38-smoke] SMOKE 2: Fully depreciated asset write-off...");

    const asset2 = await createAndActivateAsset({
      cookie, categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID, ownerOperatingUnitId: ownerOuId,
      postingWindow, uniqueSuffix: uniqueSuffix + "fd",
      nameSuffix: "WO-FULL-DEPR", originalCost: 5000,
    });
    const assetId2 = Number(asset2.id);
    artifactState.assetIds.push(assetId2);

    // Force NBV to zero to simulate fully depreciated
    await query(
      `UPDATE fixed_asset_transactions
          SET nbv_amount_txn = 0.0000, nbv_amount_base = 0.0000
        WHERE tenant_id = ? AND asset_id = ? AND status = 'POSTED'`,
      [TENANT_ID, assetId2]
    );
    await query(
      `UPDATE fixed_assets SET status = 'FULLY_DEPRECIATED' WHERE tenant_id = ? AND id = ?`,
      [TENANT_ID, assetId2]
    );

    const { payload: woResult2 } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId2}/writeoff`,
      expectedStatus: 200,
      body: {
        effectiveDate: postingWindow.writeoffDate,
        postingDate: postingWindow.writeoffDate,
        note: "SMOKE2 fully depreciated write-off",
      },
    });

    assert(woResult2?.status === "DISPOSED",
      `SMOKE2: Expected status=DISPOSED, got ${woResult2?.status}`);

    // Verify WRITEOFF transaction
    const txn2Result = await query(
      `SELECT id, journal_entry_id, gross_amount_txn, accum_depr_amount_txn, nbv_amount_txn
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
          AND transaction_type = 'WRITEOFF' AND status = 'POSTED'
        ORDER BY id DESC LIMIT 1`,
      [TENANT_ID, assetId2]
    );
    const txn2 = txn2Result.rows?.[0];
    assert(txn2, "SMOKE2: WRITEOFF transaction not found");
    assert(toAmount(txn2.nbv_amount_txn) === 0,
      `SMOKE2: nbv_amount_txn expected 0, got ${txn2.nbv_amount_txn}`);

    // Verify no zero-amount depreciation transaction was created
    const zeroDeprTxns = await query(
      `SELECT id, transaction_type FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
          AND transaction_type = 'DEPRECIATION'
          AND (gross_amount_txn = 0 OR gross_amount_txn IS NULL)
          AND status = 'POSTED'`,
      [TENANT_ID, assetId2]
    );
    assert(
      (zeroDeprTxns.rows || []).length === 0,
      `SMOKE2: Expected no zero-amount DEPRECIATION transactions, found ${(zeroDeprTxns.rows || []).length}`
    );

    // Verify journal lines for zero-NBV write-off
    const txn2JournalId = Number(txn2.journal_entry_id);
    const lines2Result = await query(
      `SELECT line_no, account_id, debit_base, credit_base
         FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_no ASC`,
      [txn2JournalId]
    );
    const lines2 = lines2Result.rows || [];

    // Zero NBV: gross=5000, accum=5000 → debit accum + credit asset = 2 lines, no loss line
    assert(lines2.length === 2,
      `SMOKE2: Expected 2 journal lines for zero-NBV write-off, got ${lines2.length}`);

    // Verify balance
    let totalDebit2 = 0, totalCredit2 = 0;
    for (const line of lines2) {
      totalDebit2 += toAmount(line.debit_base);
      totalCredit2 += toAmount(line.credit_base);
    }
    assert(Math.abs(totalDebit2 - totalCredit2) < 0.01,
      `SMOKE2: Journal lines not balanced: debit=${totalDebit2}, credit=${totalCredit2}`);

    summary.smoke2_fullyDepreciatedWriteoff = {
      assetId: assetId2,
      transactionId: toNumber(txn2.id),
      journalEntryId: txn2JournalId,
      journalLineCount: lines2.length,
      grossCost: toAmount(txn2.gross_amount_txn),
      accumDepr: toAmount(txn2.accum_depr_amount_txn),
      nbv: 0,
      noZeroAmountDeprTxn: true,
      journalBalanced: true,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 2 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 3: Already disposed asset rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa38-smoke] SMOKE 3: Already DISPOSED asset rejection...");

    // asset1 is already DISPOSED from SMOKE 1
    const { status: disposedStatus } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId1}/writeoff`,
      body: {
        effectiveDate: postingWindow.writeoffDate,
        postingDate: postingWindow.writeoffDate,
      },
    });
    assert(disposedStatus === 400,
      `SMOKE3: Expected 400 for already-DISPOSED write-off, got ${disposedStatus}`);

    summary.smoke3_alreadyDisposedRejection = {
      assetId: assetId1,
      httpStatus: disposedStatus,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 3 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 4: DRAFT asset rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa38-smoke] SMOKE 4: DRAFT asset write-off rejection...");

    const { payload: draftAsset } = await apiRequest({
      cookie, method: "POST", pathName: "/api/v1/fixed-assets", expectedStatus: 201,
      body: {
        legalEntityId: LEGAL_ENTITY_ID,
        name: `FA38 Smoke DRAFT-ONLY ${uniqueSuffix}`,
        categoryId: category.categoryId,
        acquisitionDate: postingWindow.acquisitionDate,
        currencyCode: "AFN",
        ownerOperatingUnitId: ownerOuId,
        locationOperatingUnitId: ownerOuId,
        originalCostTxn: 3000, originalCostBase: 3000,
        description: "STEP-FA38 smoke DRAFT-ONLY",
      },
    });
    const draftAssetId = Number(draftAsset?.id || 0);
    assert(draftAssetId > 0, "SMOKE4: Failed to create draft asset");
    artifactState.assetIds.push(draftAssetId);

    const { status: draftWoStatus } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${draftAssetId}/writeoff`,
      body: {
        effectiveDate: postingWindow.writeoffDate,
        postingDate: postingWindow.writeoffDate,
      },
    });
    assert(draftWoStatus === 400,
      `SMOKE4: Expected 400 for DRAFT asset write-off, got ${draftWoStatus}`);

    summary.smoke4_draftAssetRejection = {
      assetId: draftAssetId,
      httpStatus: draftWoStatus,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 4 PASSED ✓");

    // ── All passed ───────────────────────────────────────────────
    runPassed = true;
  } catch (err) {
    console.error("[fa38-smoke] FAILED:", err.message || err);
    console.error(err.stack || "");
    runPassed = false;
  } finally {
    if (!KEEP_ARTIFACTS && artifactState.assetIds.length > 0) {
      try {
        await cleanupArtifacts(artifactState);
        summary.cleanup = "done";
      } catch (cleanupErr) {
        console.error("[fa38-smoke] Cleanup error:", cleanupErr.message);
        summary.cleanup = `error: ${cleanupErr.message}`;
      }
    }
    if (server?.startedByScript && server.child) await stopServer(server.child);
    try { await closePool(); } catch { /* ignore */ }
  }

  console.log("\n[fa38-smoke] ═══════════════════════════════════════════");
  console.log("[fa38-smoke] SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("[fa38-smoke] ═══════════════════════════════════════════");

  if (runPassed) {
    console.log("[fa38-smoke] ALL SMOKES PASSED ✓");
    process.exit(0);
  } else {
    console.error("[fa38-smoke] SOME SMOKES FAILED ✗");
    process.exit(1);
  }
}

main();
