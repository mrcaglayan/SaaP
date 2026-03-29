
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

async function insertPostedLifecycleBlockerTransaction({
  tenantId,
  legalEntityId,
  assetId,
  effectiveDate,
  postingDate,
  bookId,
  fiscalPeriodId,
  currencyCode,
  userId,
}) {
  const insertResult = await query(
    `INSERT INTO fixed_asset_transactions (
        tenant_id, legal_entity_id, asset_id,
        transaction_type, status, effective_date, posting_date,
        book_id, fiscal_period_id, currency_code,
        note, created_by_user_id
     ) VALUES (
        ?, ?, ?,
        'PHYSICAL_MOVE', 'POSTED', ?, ?,
        ?, ?, ?,
        ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      assetId,
      effectiveDate,
      postingDate,
      bookId,
      fiscalPeriodId,
      currencyCode,
      "FA38 smoke chronology blocker",
      userId,
    ]
  );
  const transactionId = Number(insertResult.rows?.insertId || 0);
  assert(transactionId > 0, "Failed to create chronology blocker transaction");
  return transactionId;
}

async function cleanupArtifacts(state) {
  const assetIds = Array.from(new Set(state.assetIds)).filter((id) => Number(id) > 0);

  if (assetIds.length > 0) {
    const placeholders = assetIds.map(() => "?").join(", ");

    const txnResult = await query(
      `SELECT id, journal_entry_id FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
    const journalEntryIds = Array.from(new Set(
      (txnResult.rows || [])
        .map((txn) => Number(txn.journal_entry_id || 0))
        .filter((id) => id > 0)
    ));

    await query(
      `DELETE FROM fixed_asset_depreciation_schedule_lines
        WHERE tenant_id = ? AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );

    await query(
      `DELETE FROM fixed_asset_transactions WHERE tenant_id = ? AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );

    for (const journalEntryId of journalEntryIds) {
      await query(
        `DELETE FROM journal_source_links WHERE tenant_id = ? AND journal_entry_id = ?`,
        [TENANT_ID, journalEntryId]
      );
      await query(`DELETE FROM journal_lines WHERE journal_entry_id = ?`, [journalEntryId]);
      await query(
        `DELETE FROM journal_entries WHERE id = ? AND tenant_id = ?`,
        [journalEntryId, TENANT_ID]
      );
    }

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
    smoke3_chronologyBlockedWriteoff: null,
    smoke4_writeoffReversal: null,
    smoke5_alreadyDisposedRejection: null,
    smoke6_draftAssetRejection: null,
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

    assert(
      asset1.status === "ACTIVE" || asset1.status === "FULLY_DEPRECIATED",
      `SMOKE1: Asset should be ACTIVE or FULLY_DEPRECIATED, got ${asset1.status}`
    );

    const cutoffDate1 = addDays(postingWindow.writeoffDate, -1);
    const { payload: woResult1 } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId1}/writeoff`,
      expectedStatus: 200,
      body: {
        effectiveDate: postingWindow.writeoffDate,
        postingDate: postingWindow.writeoffDate,
        note: "SMOKE1 partial depreciation write-off",
      },
    });

    assert(
      woResult1?.status === "DISPOSED",
      `SMOKE1: Expected status=DISPOSED, got ${woResult1?.status}`
    );
    const disposalDateStr1 = woResult1?.disposalDate
      ? String(woResult1.disposalDate).slice(0, 10)
      : null;
    assert(
      disposalDateStr1 === postingWindow.writeoffDate,
      `SMOKE1: Expected disposalDate=${postingWindow.writeoffDate}, got ${disposalDateStr1}`
    );

    const txn1Result = await query(
      `SELECT id, status, journal_entry_id,
              gross_amount_txn, accum_depr_amount_txn, nbv_amount_txn
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

    const cutoffTxn1Result = await query(
      `SELECT id, journal_entry_id, effective_date, depreciation_kind
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
          AND transaction_type = 'DEPRECIATION' AND status = 'POSTED'
        ORDER BY id ASC`,
      [TENANT_ID, assetId1]
    );
    const cutoffTxn1 = (cutoffTxn1Result.rows || []).find(
      (row) => String(row.depreciation_kind || "").toUpperCase() === "RUN"
    );
    assert(cutoffTxn1, "SMOKE1: cutoff DEPRECIATION transaction not found");
    assert(
      String(cutoffTxn1.effective_date || "").slice(0, 10) === cutoffDate1,
      `SMOKE1: cutoff depreciation effective_date expected ${cutoffDate1}, got ${cutoffTxn1.effective_date}`
    );
    assert(
      toNumber(woResult1?.writeoff?.cutoffDepreciationTransactionId) === toNumber(cutoffTxn1.id),
      "SMOKE1: response cutoffDepreciationTransactionId mismatch"
    );
    assert(
      toNumber(woResult1?.writeoff?.cutoffDepreciationJournalEntryId) === toNumber(cutoffTxn1.journal_entry_id),
      "SMOKE1: response cutoffDepreciationJournalEntryId mismatch"
    );

    const txn1JournalId = Number(txn1.journal_entry_id);
    assert(txn1JournalId > 0, "SMOKE1: journal_entry_id missing on WRITEOFF transaction");

    const lines1Result = await query(
      `SELECT debit_base, credit_base
         FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_no ASC`,
      [txn1JournalId]
    );
    const lines1 = lines1Result.rows || [];
    const nbv1 = toAmount(txn1.nbv_amount_txn);
    const accumDepr1 = toAmount(txn1.accum_depr_amount_txn);

    if (nbv1 > 0 && accumDepr1 > 0) {
      assert(lines1.length === 3,
        `SMOKE1: Expected 3 journal lines (accum>0, nbv>0), got ${lines1.length}`);
    } else if (nbv1 > 0 && accumDepr1 === 0) {
      assert(lines1.length === 2,
        `SMOKE1: Expected 2 journal lines (accum=0, nbv>0), got ${lines1.length}`);
    } else if (nbv1 === 0 && accumDepr1 > 0) {
      assert(lines1.length === 2,
        `SMOKE1: Expected 2 journal lines (accum>0, nbv=0), got ${lines1.length}`);
    }

    let totalDebit1 = 0;
    let totalCredit1 = 0;
    for (const line of lines1) {
      totalDebit1 += toAmount(line.debit_base);
      totalCredit1 += toAmount(line.credit_base);
    }
    assert(
      Math.abs(totalDebit1 - totalCredit1) < 0.01,
      `SMOKE1: Journal lines not balanced: debit=${totalDebit1}, credit=${totalCredit1}`
    );
    assert(
      toAmount(totalCredit1) === 10000,
      `SMOKE1: Total credit expected 10000 (gross cost), got ${totalCredit1}`
    );

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
      "SMOKE1: source_ref_id mismatch");

    summary.smoke1_partiallyDepreciatedWriteoff = {
      assetId: assetId1,
      writeoffTransactionId: toNumber(txn1.id),
      writeoffJournalEntryId: txn1JournalId,
      cutoffDepreciationTransactionId: toNumber(cutoffTxn1.id),
      cutoffDepreciationJournalEntryId: toNumber(cutoffTxn1.journal_entry_id),
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
      postingWindow, uniqueSuffix: `${uniqueSuffix}fd`,
      nameSuffix: "WO-FULL-DEPR", originalCost: 5000,
    });
    const assetId2 = Number(asset2.id);
    artifactState.assetIds.push(assetId2);

    await query(
      `UPDATE fixed_asset_transactions
          SET nbv_amount_txn = 0.0000, nbv_amount_base = 0.0000
        WHERE tenant_id = ? AND asset_id = ? AND status = 'POSTED'`,
      [TENANT_ID, assetId2]
    );
    await query(
      `UPDATE fixed_assets
          SET status = 'FULLY_DEPRECIATED',
              remaining_useful_life_months = 0
        WHERE tenant_id = ? AND id = ?`,
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

    assert(
      woResult2?.writeoff?.cutoffDepreciationTransactionId == null,
      `SMOKE2: cutoffDepreciationTransactionId expected null, got ${woResult2?.writeoff?.cutoffDepreciationTransactionId}`
    );

    const postedDeprTxns2 = await query(
      `SELECT id FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ?
          AND transaction_type = 'DEPRECIATION'
          AND status = 'POSTED'`,
      [TENANT_ID, assetId2]
    );
    assert(
      (postedDeprTxns2.rows || []).length === 0,
      `SMOKE2: Expected no posted DEPRECIATION transactions, found ${(postedDeprTxns2.rows || []).length}`
    );

    // Verify journal lines for zero-NBV write-off
    const txn2JournalId = Number(txn2.journal_entry_id);
    const lines2Result = await query(
      `SELECT debit_base, credit_base
         FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_no ASC`,
      [txn2JournalId]
    );
    const lines2 = lines2Result.rows || [];

    // Zero NBV: gross=5000, accum=5000 → debit accum + credit asset = 2 lines, no loss line
    assert(lines2.length === 2,
      `SMOKE2: Expected 2 journal lines for zero-NBV write-off, got ${lines2.length}`);

    // Verify balance
    let totalDebit2 = 0;
    let totalCredit2 = 0;
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
      noCutoffDepreciationTxn: true,
      journalBalanced: true,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 2 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 3: Backdated write-off is blocked by later posted activity
    console.log("[fa38-smoke] SMOKE 3: Chronology blocker rejection...");

    const asset3 = await createAndActivateAsset({
      cookie, categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID, ownerOperatingUnitId: ownerOuId,
      postingWindow, uniqueSuffix: `${uniqueSuffix}blk`,
      nameSuffix: "WO-BLOCKED", originalCost: 7000,
    });
    const assetId3 = Number(asset3.id);
    artifactState.assetIds.push(assetId3);

    const blockedWriteoffDate = minDate(addDays(postingWindow.acquisitionDate, 4), postingWindow.endDate);
    const blockerEffectiveDate = minDate(addDays(postingWindow.acquisitionDate, 5), postingWindow.endDate);
    assert(
      blockerEffectiveDate > blockedWriteoffDate,
      `SMOKE3: Need blockerEffectiveDate > blockedWriteoffDate, got ${blockerEffectiveDate} and ${blockedWriteoffDate}`
    );

    const blockerTransactionId = await insertPostedLifecycleBlockerTransaction({
      tenantId: TENANT_ID,
      legalEntityId: LEGAL_ENTITY_ID,
      assetId: assetId3,
      effectiveDate: blockerEffectiveDate,
      postingDate: blockerEffectiveDate,
      bookId: postingWindow.bookId,
      fiscalPeriodId: postingWindow.fiscalPeriodId,
      currencyCode: "AFN",
      userId: smokeUser.userId,
    });

    const { payload: blockedPayload } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId3}/writeoff`,
      expectedStatus: 409,
      body: {
        effectiveDate: blockedWriteoffDate,
        postingDate: blockedWriteoffDate,
        note: "SMOKE3 chronology blocker",
      },
    });
    assert(
      blockedPayload?.code === "FA_DISPOSAL_LATER_POSTED_ACTIVITY",
      `SMOKE3: code expected FA_DISPOSAL_LATER_POSTED_ACTIVITY, got ${blockedPayload?.code}`
    );
    assert(
      toNumber(blockedPayload?.details?.blockingTransactionId) === blockerTransactionId,
      `SMOKE3: blockingTransactionId expected ${blockerTransactionId}, got ${blockedPayload?.details?.blockingTransactionId}`
    );

    summary.smoke3_chronologyBlockedWriteoff = {
      assetId: assetId3,
      blockingTransactionId: blockerTransactionId,
      blockedEffectiveDate: blockedWriteoffDate,
      blockerEffectiveDate,
      reasonCode: blockedPayload?.code || null,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 3 PASSED");

    // SMOKE 4: Mistaken write-off is corrected via reversal
    console.log("[fa38-smoke] SMOKE 4: Write-off reversal...");

    const { payload: reversalResult } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/transactions/${toNumber(txn1.id)}/reverse`,
      expectedStatus: 200,
      body: {
        note: "SMOKE4 reverse mistaken write-off",
      },
    });
    assert(
      reversalResult?.status !== "DISPOSED",
      `SMOKE4: Expected asset to leave DISPOSED after reversal, got ${reversalResult?.status}`
    );
    assert(
      reversalResult?.disposalDate == null,
      `SMOKE4: Expected disposalDate to clear after reversal, got ${reversalResult?.disposalDate}`
    );
    assert(
      toNumber(reversalResult?.reversal?.originalTransactionId) === toNumber(txn1.id),
      "SMOKE4: originalTransactionId mismatch"
    );
    assert(
      toNumber(reversalResult?.reversal?.reversalTransactionId) > 0,
      "SMOKE4: reversalTransactionId missing"
    );

    const reversedTxn1Result = await query(
      `SELECT status, reversal_transaction_id
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND id = ? LIMIT 1`,
      [TENANT_ID, toNumber(txn1.id)]
    );
    const reversedTxn1 = reversedTxn1Result.rows?.[0];
    assert(reversedTxn1?.status === "REVERSED",
      `SMOKE4: WRITEOFF transaction status expected REVERSED, got ${reversedTxn1?.status}`);

    const reversalTxnId = toNumber(reversedTxn1?.reversal_transaction_id);
    const reversalTxnRowResult = await query(
      `SELECT transaction_type, reversed_transaction_id
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND id = ? LIMIT 1`,
      [TENANT_ID, reversalTxnId]
    );
    const reversalTxnRow = reversalTxnRowResult.rows?.[0];
    assert(reversalTxnRow?.transaction_type === "REVERSAL",
      `SMOKE4: reversal transaction_type expected REVERSAL, got ${reversalTxnRow?.transaction_type}`);
    assert(toNumber(reversalTxnRow?.reversed_transaction_id) === toNumber(txn1.id),
      "SMOKE4: reversal transaction linkage mismatch");

    summary.smoke4_writeoffReversal = {
      assetId: assetId1,
      originalTransactionId: toNumber(txn1.id),
      reversalTransactionId: reversalTxnId,
      restoredStatus: reversalResult?.status || null,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 4 PASSED");

    // SMOKE 5: Already disposed asset rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa38-smoke] SMOKE 5: Already DISPOSED asset rejection...");

    // asset2 remains DISPOSED because only asset1 was reversed in SMOKE 4
    const { status: disposedStatus } = await apiRequest({
      cookie, method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId2}/writeoff`,
      body: {
        effectiveDate: postingWindow.writeoffDate,
        postingDate: postingWindow.writeoffDate,
      },
    });
    assert(disposedStatus === 400,
      `SMOKE5: Expected 400 for already-DISPOSED write-off, got ${disposedStatus}`);

    summary.smoke5_alreadyDisposedRejection = {
      assetId: assetId2,
      httpStatus: disposedStatus,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 5 PASSED");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 6: DRAFT asset rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa38-smoke] SMOKE 6: DRAFT asset write-off rejection...");

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
    assert(draftAssetId > 0, "SMOKE6: Failed to create draft asset");
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
      `SMOKE6: Expected 400 for DRAFT asset write-off, got ${draftWoStatus}`);

    summary.smoke6_draftAssetRejection = {
      assetId: draftAssetId,
      httpStatus: draftWoStatus,
      PASS: true,
    };
    console.log("[fa38-smoke] SMOKE 6 PASSED");

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
