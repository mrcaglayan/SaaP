
  import bcrypt from "bcrypt";
  import { spawn } from "node:child_process";
  import { once } from "node:events";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { setTimeout as sleep } from "node:timers/promises";
  import { closePool, query } from "../src/db.js";
import { assignTestFullAccessRoleToUser } from "./ex05-test-helpers.js";
  import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const TEST_PORT = Number(process.env.FA37_SMOKE_PORT || 3137);
const BASE_URL =
  process.env.FA37_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA37_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA37_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA37_SMOKE_LEGAL_ENTITY_ID
);
let TENANT_ID = ENV_TENANT_ID || 0;
let LEGAL_ENTITY_ID = ENV_LEGAL_ENTITY_ID || 0;
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA37_SMOKE_KEEP_ARTIFACTS,
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
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(v) {
  return Number(v || 0);
}

function toAmount(v) {
  return Math.round(Number(v || 0) * 10000) / 10000;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minDate(a, b) {
  return a <= b ? a : b;
}

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
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function apiRequest({
  cookie,
  method = "GET",
  pathName,
  body,
  expectedStatus,
}) {
  const headers = { Accept: "application/json" };
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const { response, payload } = await fetchJson(
    `${BASE_URL}${pathName}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    30000
  );

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${pathName} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        payload
      )}`
    );
  }

  return { status: response.status, payload, response };
}

async function isApiAlive() {
  try {
    const { response, payload } = await fetchJson(`${BASE_URL}/health`, {}, 2500);
    return (
      response.status >= 200 &&
      response.status < 600 &&
      payload &&
      typeof payload === "object" &&
      payload.checks
    );
  } catch {
    return false;
  }
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[fa37-smoke][server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[fa37-smoke][server] ${chunk}`);
  });

  return child;
}

async function ensureApiServer() {
  if (await isApiAlive()) {
    return { startedByScript: false, child: null };
  }

  const child = startServerProcess();
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited early with code ${child.exitCode}`);
    }
    if (await isApiAlive()) {
      return { startedByScript: true, child };
    }
    await sleep(400);
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    sleep(5000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
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
  const cookie = String(response.headers.get("set-cookie") || "")
    .split(";")[0]
    .trim();
  assert(cookie, `Login cookie missing for ${email}`);
  return cookie;
}

async function assignFullAccessRoleToUser(tenantId, userId) {
  await assignTestFullAccessRoleToUser(tenantId, userId);
}

/**
 * Find a legal entity with at least TWO active OUs that have partner
 * current-account mappings between them (required for self-balancing).
 */
async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA37" });
}

async function resolveActiveOperatingUnitIdsWithPartner(tenantId, legalEntityId) {
  const result = await query(
    `SELECT
        map.operating_unit_id AS source_ou_id,
        map.partner_operating_unit_id AS target_ou_id,
        map.due_from_account_id,
        map.due_to_account_id
      FROM operating_unit_partner_current_accounts map
      JOIN operating_units ou1
        ON ou1.id = map.operating_unit_id
       AND ou1.tenant_id = ?
       AND ou1.legal_entity_id = ?
       AND ou1.status = 'ACTIVE'
      JOIN operating_units ou2
        ON ou2.id = map.partner_operating_unit_id
       AND ou2.tenant_id = ?
       AND ou2.legal_entity_id = ?
       AND ou2.status = 'ACTIVE'
      WHERE map.tenant_id = ?
        AND map.legal_entity_id = ?
        AND map.due_from_account_id IS NOT NULL
        AND map.due_to_account_id IS NOT NULL
      ORDER BY map.operating_unit_id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, tenantId, legalEntityId, tenantId, legalEntityId]
  );

  const row = result.rows?.[0];
  assert(
    row,
    `FA37 smoke needs at least 2 ACTIVE OUs with partner current-account mappings ` +
    `for tenant ${tenantId}, legal entity ${legalEntityId}`
  );

  return {
    sourceOwnerOuId: Number(row.source_ou_id),
    targetOwnerOuId: Number(row.target_ou_id),
    sourceDueFromAccountId: Number(row.due_from_account_id),
    sourceDueToAccountId: Number(row.due_to_account_id),
  };
}

async function resolveAccountFixtures(tenantId, legalEntityId) {
  const assetRows = await query(
    `SELECT a.id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.scope = 'LEGAL_ENTITY'
        AND a.is_active = 1
        AND a.allow_posting = 1
        AND a.account_type = 'ASSET'
      ORDER BY a.id ASC
      LIMIT 2`,
    [tenantId, legalEntityId]
  );
  const expenseRows = await query(
    `SELECT a.id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.scope = 'LEGAL_ENTITY'
        AND a.is_active = 1
        AND a.allow_posting = 1
        AND a.account_type = 'EXPENSE'
      ORDER BY a.id ASC
      LIMIT 2`,
    [tenantId, legalEntityId]
  );
  const revenueRows = await query(
    `SELECT a.id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.scope = 'LEGAL_ENTITY'
        AND a.is_active = 1
        AND a.allow_posting = 1
        AND a.account_type = 'REVENUE'
      ORDER BY a.id ASC
      LIMIT 1`,
    [tenantId, legalEntityId]
  );

  const assetAccounts = (assetRows.rows || []).map((row) => Number(row.id));
  const expenseAccounts = (expenseRows.rows || []).map((row) => Number(row.id));
  const revenueAccounts = (revenueRows.rows || []).map((row) => Number(row.id));

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
    `SELECT b.id AS book_id,
            fp.id AS fiscal_period_id,
            fp.start_date,
            fp.end_date,
            fp.period_name
       FROM books b
       JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id
        AND ps.fiscal_period_id = fp.id
      WHERE b.tenant_id = ?
        AND b.legal_entity_id = ?
        AND b.book_type = 'LOCAL'
        AND fp.is_adjustment = 0
        AND COALESCE(ps.status, 'OPEN') = 'OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC,
               fp.id DESC
      LIMIT 1`,
    [tenantId, legalEntityId, today]
  );

  const row = result.rows?.[0];
  assert(
    row,
    `No OPEN non-adjustment LOCAL fiscal period found for tenant ${tenantId}, legal entity ${legalEntityId}`
  );

  const acquisitionDate = row.start_date;
  const capitalizationDate = minDate(addDays(acquisitionDate, 1), row.end_date);
  const inServiceDate = minDate(addDays(acquisitionDate, 2), row.end_date);
  const postingDate = minDate(addDays(acquisitionDate, 3), row.end_date);
  const transferDate = minDate(addDays(acquisitionDate, 4), row.end_date);

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
    transferDate,
  };
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA37Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa37.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA37 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create smoke user");
    await assignFullAccessRoleToUser(tenantId, userId);

  return { userId, email, password, roleId };
}

async function createSmokeProfile({ tenantId, legalEntityId, userId, uniqueSuffix }) {
  const code = `FA37PF${uniqueSuffix.slice(-6)}`;
  const insertResult = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id, legal_entity_id, code, name, status, method,
        declining_balance_rate_percent, switch_to_straight_line,
        description, created_by_user_id, updated_by_user_id
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE',
        NULL, 0,
        ?, ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      code,
      `FA37 Smoke Profile ${uniqueSuffix}`,
      "Smoke profile for STEP-FA37 ownership transfer",
      userId,
      userId,
    ]
  );
  const profileId = Number(insertResult.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create smoke depreciation profile");
  return { profileId, code };
}

async function createSmokeCategory({
  tenantId,
  legalEntityId,
  userId,
  profileId,
  uniqueSuffix,
  accounts,
}) {
  const code = `FA37CT${uniqueSuffix.slice(-6)}`;
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
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', ?,
        ?, ?,
        'FIXED_BASE_AMOUNT', ?,
        ?,
        ?, ?, ?, ?, ?,
        ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      code,
      `FA37 Smoke Category ${uniqueSuffix}`,
      "Smoke category for STEP-FA37 ownership transfer",
      1000,
      24,
      100,
      profileId,
      accounts.assetAccountId,
      accounts.accumDeprAccountId,
      accounts.deprExpenseAccountId,
      accounts.disposalGainAccountId,
      accounts.disposalLossAccountId,
      userId,
      userId,
    ]
  );
  const categoryId = Number(insertResult.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create smoke category");
  return { categoryId, code };
}

async function createAndActivateAsset({
  cookie,
  categoryId,
  legalEntityId,
  ownerOperatingUnitId,
  locationOperatingUnitId,
  postingWindow,
  uniqueSuffix,
  nameSuffix,
  originalCost = 10000,
}) {
  // Create draft
  const { payload: draft } = await apiRequest({
    cookie,
    method: "POST",
    pathName: "/api/v1/fixed-assets",
    expectedStatus: 201,
    body: {
      legalEntityId,
      name: `FA37 Smoke ${nameSuffix} ${uniqueSuffix}`,
      categoryId,
      acquisitionDate: postingWindow.acquisitionDate,
      currencyCode: "AFN",
      ownerOperatingUnitId,
      locationOperatingUnitId,
      originalCostTxn: originalCost,
      originalCostBase: originalCost,
      departmentCode: "DEPT-ORIG",
      costCenterCode: "CC-ORIG",
      description: `STEP-FA37 smoke ${nameSuffix}`,
      assetTag: `FA37-${nameSuffix}-${uniqueSuffix}`.slice(0, 40),
    },
  });
  const assetId = Number(draft?.id || 0);
  assert(assetId > 0, `Failed to create draft asset for ${nameSuffix}`);

  // Activate
  const { payload: activated } = await apiRequest({
    cookie,
    method: "POST",
    pathName: `/api/v1/fixed-assets/${assetId}/activate`,
    expectedStatus: 200,
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

    // Clean up ownership transfer details
    await query(
      `DELETE FROM fixed_asset_ownership_transfer_details
        WHERE tenant_id = ?
          AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );

    // Clean up journal source links for asset transactions
    const txnResult = await query(
      `SELECT id, journal_entry_id
         FROM fixed_asset_transactions
        WHERE tenant_id = ?
          AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
    const txnRows = txnResult.rows || [];
    for (const txn of txnRows) {
      if (txn.journal_entry_id) {
        await query(
          `DELETE FROM journal_source_links
            WHERE tenant_id = ?
              AND journal_entry_id = ?`,
          [TENANT_ID, txn.journal_entry_id]
        );
        await query(
          `DELETE FROM journal_lines
            WHERE journal_entry_id = ?`,
          [txn.journal_entry_id]
        );
        await query(
          `DELETE FROM journal_entries
            WHERE id = ?
              AND tenant_id = ?`,
          [txn.journal_entry_id, TENANT_ID]
        );
      }
    }

    await query(
      `DELETE FROM fixed_asset_transactions
        WHERE tenant_id = ?
          AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
    await query(
      `DELETE FROM fixed_assets
        WHERE tenant_id = ?
          AND id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
  }

  if (state.categoryId) {
    await query(
      `DELETE FROM fixed_asset_categories
        WHERE tenant_id = ?
          AND id = ?`,
      [TENANT_ID, state.categoryId]
    );
  }

  if (state.profileId) {
    await query(
      `DELETE FROM fixed_asset_depreciation_profiles
        WHERE tenant_id = ?
          AND id = ?`,
      [TENANT_ID, state.profileId]
    );
  }

  if (state.userId) {
    await query(
      `DELETE FROM user_role_scopes
        WHERE tenant_id = ?
          AND user_id = ?`,
      [TENANT_ID, state.userId]
    );
    await query(
      `DELETE FROM users
        WHERE tenant_id = ?
          AND id = ?`,
      [TENANT_ID, state.userId]
    );
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
  const artifactState = {
    userId: null,
    profileId: null,
    categoryId: null,
    assetIds: [],
  };
  const summary = {
    baseUrl: BASE_URL,
    tenantId: TENANT_ID,
    legalEntityId: LEGAL_ENTITY_ID,
    keepArtifacts: KEEP_ARTIFACTS,
    serverStartedByScript: false,
    fixtureIds: {},
    smoke1_nonZeroNbvTransfer: null,
    smoke2_zeroNbvTransfer: null,
    smoke3_transferWithLocationUpdate: null,
    smoke4_sameOwnerOuRejection: null,
    smoke5_draftAssetRejection: null,
    cleanup: KEEP_ARTIFACTS ? "skipped" : "pending",
  };

  let server = null;

  try {
    server = await ensureApiServer();
    summary.serverStartedByScript = Boolean(server.startedByScript);

    // ── Create fixtures ──────────────────────────────────────────
    const smokeUser = await createSmokeUser({
      tenantId: TENANT_ID,
      uniqueSuffix,
    });
    artifactState.userId = smokeUser.userId;

    const accounts = await resolveAccountFixtures(TENANT_ID, LEGAL_ENTITY_ID);
    const operatingUnits = await resolveActiveOperatingUnitIdsWithPartner(
      TENANT_ID,
      LEGAL_ENTITY_ID
    );
    const postingWindow = await resolveOpenPostingWindow(
      TENANT_ID,
      LEGAL_ENTITY_ID
    );

    const profile = await createSmokeProfile({
      tenantId: TENANT_ID,
      legalEntityId: LEGAL_ENTITY_ID,
      userId: smokeUser.userId,
      uniqueSuffix,
    });
    artifactState.profileId = profile.profileId;

    const category = await createSmokeCategory({
      tenantId: TENANT_ID,
      legalEntityId: LEGAL_ENTITY_ID,
      userId: smokeUser.userId,
      profileId: profile.profileId,
      uniqueSuffix,
      accounts,
    });
    artifactState.categoryId = category.categoryId;

    summary.fixtureIds = {
      userId: smokeUser.userId,
      profileId: profile.profileId,
      categoryId: category.categoryId,
      sourceOwnerOuId: operatingUnits.sourceOwnerOuId,
      targetOwnerOuId: operatingUnits.targetOwnerOuId,
    };

    const cookie = await login(smokeUser.email, smokeUser.password);

    // ══════════════════════════════════════════════════════════════
    // SMOKE 1: Non-zero NBV transfer — verify journal lines match locked template
    // ══════════════════════════════════════════════════════════════
    console.log("[fa37-smoke] SMOKE 1: Non-zero NBV ownership transfer...");

    const asset1 = await createAndActivateAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.sourceOwnerOuId,
      locationOperatingUnitId: operatingUnits.sourceOwnerOuId,
      postingWindow,
      uniqueSuffix,
      nameSuffix: "XFER-NBV",
      originalCost: 10000,
    });
    const assetId1 = Number(asset1.id);
    artifactState.assetIds.push(assetId1);

    const { payload: xferResult1 } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId1}/ownership-transfer`,
      expectedStatus: 200,
      body: {
        effectiveDate: postingWindow.transferDate,
        postingDate: postingWindow.transferDate,
        targetOwnerOperatingUnitId: operatingUnits.targetOwnerOuId,
      },
    });

    // Verify owner OU changed
    assert(
      toNumber(xferResult1?.ownerOperatingUnitId) === operatingUnits.targetOwnerOuId,
      `SMOKE1: Expected ownerOperatingUnitId=${operatingUnits.targetOwnerOuId}, got ${xferResult1?.ownerOperatingUnitId}`
    );

    // Verify OWNERSHIP_TRANSFER transaction was created
    const txn1Result = await query(
      `SELECT id, transaction_type, status, journal_entry_id,
              gross_amount_txn, gross_amount_base,
              accum_depr_amount_txn, accum_depr_amount_base,
              nbv_amount_txn, nbv_amount_base
         FROM fixed_asset_transactions
        WHERE tenant_id = ?
          AND asset_id = ?
          AND transaction_type = 'OWNERSHIP_TRANSFER'
          AND status = 'POSTED'
        ORDER BY id DESC
        LIMIT 1`,
      [TENANT_ID, assetId1]
    );
    const txn1 = txn1Result.rows?.[0];
    assert(txn1, "SMOKE1: OWNERSHIP_TRANSFER transaction not found");
    assert(
      toAmount(txn1.gross_amount_txn) === 10000,
      `SMOKE1: gross_amount_txn expected 10000, got ${txn1.gross_amount_txn}`
    );
    const txn1JournalId = Number(txn1.journal_entry_id);
    assert(txn1JournalId > 0, "SMOKE1: journal_entry_id missing on transaction");

    // Verify journal lines match locked template
    const lines1Result = await query(
      `SELECT line_no, account_id, debit_base, credit_base,
              operating_unit_id, description
         FROM journal_lines
        WHERE journal_entry_id = ?
        ORDER BY line_no ASC`,
      [txn1JournalId]
    );
    const lines1 = lines1Result.rows || [];

    // Non-zero NBV should have 6 lines: gross debit/credit + accum debit/credit + due-from/due-to
    // For a freshly activated asset with cost=10000 and no depreciation yet,
    // NBV = 10000, accumDepr = 0, so accum lines are OMITTED (both 0).
    // Only gross lines + self-balancing lines = 4 lines
    const nbv1 = toAmount(txn1.nbv_amount_txn);
    const accumDepr1 = toAmount(txn1.accum_depr_amount_txn);

    if (accumDepr1 > 0) {
      // 6 lines: gross debit target + gross credit source + accum debit source + accum credit target + due-from source + due-to target
      assert(
        lines1.length === 6,
        `SMOKE1: Expected 6 journal lines for non-zero accum, got ${lines1.length}`
      );
    } else {
      // Freshly activated: accumDepr=0, but NBV=grossCost=10000
      // 4 lines: gross debit target + gross credit source + due-from source + due-to target
      assert(
        lines1.length === 4,
        `SMOKE1: Expected 4 journal lines (zero accum, non-zero NBV), got ${lines1.length}`
      );
    }

    // Line 1: Debit asset account in target OU for gross cost
    assert(
      toNumber(lines1[0].account_id) === accounts.assetAccountId,
      `SMOKE1: Line 1 account expected ${accounts.assetAccountId}, got ${lines1[0].account_id}`
    );
    assert(
      toAmount(lines1[0].debit_base) === 10000,
      `SMOKE1: Line 1 debit_base expected 10000, got ${lines1[0].debit_base}`
    );
    assert(
      toNumber(lines1[0].operating_unit_id) === operatingUnits.targetOwnerOuId,
      `SMOKE1: Line 1 OU expected target ${operatingUnits.targetOwnerOuId}, got ${lines1[0].operating_unit_id}`
    );

    // Line 2: Credit asset account in source OU for gross cost
    assert(
      toNumber(lines1[1].account_id) === accounts.assetAccountId,
      `SMOKE1: Line 2 account expected ${accounts.assetAccountId}, got ${lines1[1].account_id}`
    );
    assert(
      toAmount(lines1[1].credit_base) === 10000,
      `SMOKE1: Line 2 credit_base expected 10000, got ${lines1[1].credit_base}`
    );
    assert(
      toNumber(lines1[1].operating_unit_id) === operatingUnits.sourceOwnerOuId,
      `SMOKE1: Line 2 OU expected source ${operatingUnits.sourceOwnerOuId}, got ${lines1[1].operating_unit_id}`
    );

    // Self-balancing lines (last 2 for zero-accum case)
    const sbStartIdx = accumDepr1 > 0 ? 4 : 2;
    // Due-from in source OU
    assert(
      toAmount(lines1[sbStartIdx].debit_base) === nbv1,
      `SMOKE1: Due-from line debit_base expected ${nbv1}, got ${lines1[sbStartIdx].debit_base}`
    );
    assert(
      toNumber(lines1[sbStartIdx].operating_unit_id) === operatingUnits.sourceOwnerOuId,
      `SMOKE1: Due-from line OU expected source ${operatingUnits.sourceOwnerOuId}, got ${lines1[sbStartIdx].operating_unit_id}`
    );
    // Due-to in target OU
    assert(
      toAmount(lines1[sbStartIdx + 1].credit_base) === nbv1,
      `SMOKE1: Due-to line credit_base expected ${nbv1}, got ${lines1[sbStartIdx + 1].credit_base}`
    );
    assert(
      toNumber(lines1[sbStartIdx + 1].operating_unit_id) === operatingUnits.targetOwnerOuId,
      `SMOKE1: Due-to line OU expected target ${operatingUnits.targetOwnerOuId}, got ${lines1[sbStartIdx + 1].operating_unit_id}`
    );

    // Verify PRIMARY source link
    const link1Result = await query(
      `SELECT source_ref_type, source_ref_id
         FROM journal_source_links
        WHERE tenant_id = ?
          AND journal_entry_id = ?
        LIMIT 1`,
      [TENANT_ID, txn1JournalId]
    );
    const link1 = link1Result.rows?.[0];
    assert(link1, "SMOKE1: journal_source_links row not found");
    assert(
      link1.source_ref_type === "FIXED_ASSET_TRANSACTION",
      `SMOKE1: source_ref_type expected FIXED_ASSET_TRANSACTION, got ${link1.source_ref_type}`
    );
    assert(
      toNumber(link1.source_ref_id) === toNumber(txn1.id),
      `SMOKE1: source_ref_id expected ${txn1.id}, got ${link1.source_ref_id}`
    );

    // Verify ownership transfer detail row
    const detail1Result = await query(
      `SELECT from_owner_operating_unit_id, to_owner_operating_unit_id,
              from_location_operating_unit_id, to_location_operating_unit_id
         FROM fixed_asset_ownership_transfer_details
        WHERE tenant_id = ?
          AND asset_id = ?
          AND transaction_id = ?
        LIMIT 1`,
      [TENANT_ID, assetId1, txn1.id]
    );
    const detail1 = detail1Result.rows?.[0];
    assert(detail1, "SMOKE1: ownership_transfer_details row not found");
    assert(
      toNumber(detail1.from_owner_operating_unit_id) === operatingUnits.sourceOwnerOuId,
      `SMOKE1: from_owner expected ${operatingUnits.sourceOwnerOuId}, got ${detail1.from_owner_operating_unit_id}`
    );
    assert(
      toNumber(detail1.to_owner_operating_unit_id) === operatingUnits.targetOwnerOuId,
      `SMOKE1: to_owner expected ${operatingUnits.targetOwnerOuId}, got ${detail1.to_owner_operating_unit_id}`
    );

    summary.smoke1_nonZeroNbvTransfer = {
      assetId: assetId1,
      transactionId: toNumber(txn1.id),
      journalEntryId: txn1JournalId,
      journalLineCount: lines1.length,
      grossCost: 10000,
      accumDepr: accumDepr1,
      nbv: nbv1,
      fromOwnerOu: operatingUnits.sourceOwnerOuId,
      toOwnerOu: operatingUnits.targetOwnerOuId,
      PASS: true,
    };
    console.log("[fa37-smoke] SMOKE 1 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 2: Zero NBV transfer — verify no accum/self-balancing lines
    // ══════════════════════════════════════════════════════════════
    console.log("[fa37-smoke] SMOKE 2: Zero NBV ownership transfer...");

    // Create a FULLY_DEPRECIATED asset by using NONE method (low-value auto-expense)
    // OR: create with very low cost that goes below threshold → FULLY_DEPRECIATED
    // Simplest: create asset, activate, then manually zero out NBV
    const asset2 = await createAndActivateAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.sourceOwnerOuId,
      locationOperatingUnitId: operatingUnits.sourceOwnerOuId,
      postingWindow,
      uniqueSuffix: uniqueSuffix + "z",
      nameSuffix: "XFER-ZERO",
      originalCost: 5000,
    });
    const assetId2 = Number(asset2.id);
    artifactState.assetIds.push(assetId2);

    // Force the asset to zero NBV by updating the latest transaction's NBV fields
    // This simulates a fully depreciated asset
    await query(
      `UPDATE fixed_asset_transactions
          SET nbv_amount_txn = 0.0000, nbv_amount_base = 0.0000
        WHERE tenant_id = ?
          AND asset_id = ?
          AND status = 'POSTED'`,
      [TENANT_ID, assetId2]
    );

    // Also mark it FULLY_DEPRECIATED
    await query(
      `UPDATE fixed_assets
          SET status = 'FULLY_DEPRECIATED'
        WHERE tenant_id = ? AND id = ?`,
      [TENANT_ID, assetId2]
    );

    const { payload: xferResult2 } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId2}/ownership-transfer`,
      expectedStatus: 200,
      body: {
        effectiveDate: postingWindow.transferDate,
        postingDate: postingWindow.transferDate,
        targetOwnerOperatingUnitId: operatingUnits.targetOwnerOuId,
      },
    });

    assert(
      toNumber(xferResult2?.ownerOperatingUnitId) === operatingUnits.targetOwnerOuId,
      `SMOKE2: Expected ownerOperatingUnitId=${operatingUnits.targetOwnerOuId}, got ${xferResult2?.ownerOperatingUnitId}`
    );

    // Verify transaction
    const txn2Result = await query(
      `SELECT id, journal_entry_id,
              gross_amount_txn, accum_depr_amount_txn, nbv_amount_txn
         FROM fixed_asset_transactions
        WHERE tenant_id = ?
          AND asset_id = ?
          AND transaction_type = 'OWNERSHIP_TRANSFER'
          AND status = 'POSTED'
        ORDER BY id DESC
        LIMIT 1`,
      [TENANT_ID, assetId2]
    );
    const txn2 = txn2Result.rows?.[0];
    assert(txn2, "SMOKE2: OWNERSHIP_TRANSFER transaction not found");
    assert(
      toAmount(txn2.nbv_amount_txn) === 0,
      `SMOKE2: nbv_amount_txn expected 0, got ${txn2.nbv_amount_txn}`
    );

    const txn2JournalId = Number(txn2.journal_entry_id);
    const lines2Result = await query(
      `SELECT line_no, account_id, debit_base, credit_base, operating_unit_id
         FROM journal_lines
        WHERE journal_entry_id = ?
        ORDER BY line_no ASC`,
      [txn2JournalId]
    );
    const lines2 = lines2Result.rows || [];

    // Zero NBV: grossCost=5000, accumDepr=5000 (since NBV=0), NBV=0
    // Lines: gross debit target + gross credit source + accum debit source + accum credit target = 4
    // NO self-balancing lines (zero NBV)
    assert(
      lines2.length === 4,
      `SMOKE2: Expected 4 journal lines for zero-NBV transfer (gross+accum, no self-bal), got ${lines2.length}`
    );

    // Verify NO self-balancing lines exist — all lines should use asset or accum accounts only
    const uniqueAccounts2 = new Set(lines2.map((l) => toNumber(l.account_id)));
    // Should only contain assetAccountId and accumDeprAccountId
    assert(
      uniqueAccounts2.size <= 2,
      `SMOKE2: Expected at most 2 unique accounts (asset+accum), got ${uniqueAccounts2.size}`
    );

    summary.smoke2_zeroNbvTransfer = {
      assetId: assetId2,
      transactionId: toNumber(txn2.id),
      journalEntryId: txn2JournalId,
      journalLineCount: lines2.length,
      grossCost: toAmount(txn2.gross_amount_txn),
      accumDepr: toAmount(txn2.accum_depr_amount_txn),
      nbv: 0,
      selfBalancingLinesOmitted: true,
      PASS: true,
    };
    console.log("[fa37-smoke] SMOKE 2 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 3: Transfer with optional location update
    // ══════════════════════════════════════════════════════════════
    console.log("[fa37-smoke] SMOKE 3: Ownership transfer with location OU update...");

    const asset3 = await createAndActivateAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.sourceOwnerOuId,
      locationOperatingUnitId: operatingUnits.sourceOwnerOuId,
      postingWindow,
      uniqueSuffix: uniqueSuffix + "l",
      nameSuffix: "XFER-LOC",
      originalCost: 8000,
    });
    const assetId3 = Number(asset3.id);
    artifactState.assetIds.push(assetId3);

    const { payload: xferResult3 } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId3}/ownership-transfer`,
      expectedStatus: 200,
      body: {
        effectiveDate: postingWindow.transferDate,
        postingDate: postingWindow.transferDate,
        targetOwnerOperatingUnitId: operatingUnits.targetOwnerOuId,
        targetLocationOperatingUnitId: operatingUnits.targetOwnerOuId,
      },
    });

    // Verify both owner and location changed
    assert(
      toNumber(xferResult3?.ownerOperatingUnitId) === operatingUnits.targetOwnerOuId,
      `SMOKE3: Expected ownerOperatingUnitId=${operatingUnits.targetOwnerOuId}, got ${xferResult3?.ownerOperatingUnitId}`
    );
    assert(
      toNumber(xferResult3?.locationOperatingUnitId) === operatingUnits.targetOwnerOuId,
      `SMOKE3: Expected locationOperatingUnitId=${operatingUnits.targetOwnerOuId}, got ${xferResult3?.locationOperatingUnitId}`
    );

    // Verify detail row has location change
    const txn3Result = await query(
      `SELECT id FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ? AND transaction_type = 'OWNERSHIP_TRANSFER'
        ORDER BY id DESC LIMIT 1`,
      [TENANT_ID, assetId3]
    );
    const txn3Id = toNumber(txn3Result.rows?.[0]?.id);
    assert(txn3Id > 0, "SMOKE3: OWNERSHIP_TRANSFER transaction not found");

    const detail3Result = await query(
      `SELECT from_owner_operating_unit_id, to_owner_operating_unit_id,
              from_location_operating_unit_id, to_location_operating_unit_id
         FROM fixed_asset_ownership_transfer_details
        WHERE tenant_id = ? AND transaction_id = ?
        LIMIT 1`,
      [TENANT_ID, txn3Id]
    );
    const detail3 = detail3Result.rows?.[0];
    assert(detail3, "SMOKE3: ownership_transfer_details row not found");
    assert(
      toNumber(detail3.from_location_operating_unit_id) === operatingUnits.sourceOwnerOuId,
      `SMOKE3: from_location expected ${operatingUnits.sourceOwnerOuId}, got ${detail3.from_location_operating_unit_id}`
    );
    assert(
      toNumber(detail3.to_location_operating_unit_id) === operatingUnits.targetOwnerOuId,
      `SMOKE3: to_location expected ${operatingUnits.targetOwnerOuId}, got ${detail3.to_location_operating_unit_id}`
    );

    summary.smoke3_transferWithLocationUpdate = {
      assetId: assetId3,
      transactionId: txn3Id,
      fromLocationOu: operatingUnits.sourceOwnerOuId,
      toLocationOu: operatingUnits.targetOwnerOuId,
      fromOwnerOu: operatingUnits.sourceOwnerOuId,
      toOwnerOu: operatingUnits.targetOwnerOuId,
      PASS: true,
    };
    console.log("[fa37-smoke] SMOKE 3 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 4: Same owner OU rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa37-smoke] SMOKE 4: Same owner OU rejection...");

    // Use asset3 which is now owned by targetOwnerOuId
    const { status: sameOuStatus, payload: sameOuPayload } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId3}/ownership-transfer`,
      body: {
        effectiveDate: postingWindow.transferDate,
        postingDate: postingWindow.transferDate,
        targetOwnerOperatingUnitId: operatingUnits.targetOwnerOuId, // same as current owner
      },
    });

    assert(
      sameOuStatus === 400,
      `SMOKE4: Expected 400 for same-OU transfer, got ${sameOuStatus}`
    );

    summary.smoke4_sameOwnerOuRejection = {
      assetId: assetId3,
      httpStatus: sameOuStatus,
      PASS: true,
    };
    console.log("[fa37-smoke] SMOKE 4 PASSED ✓");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 5: DRAFT asset rejection
    // ══════════════════════════════════════════════════════════════
    console.log("[fa37-smoke] SMOKE 5: DRAFT asset transfer rejection...");

    // Create a draft asset (don't activate it)
    const { payload: draftAsset } = await apiRequest({
      cookie,
      method: "POST",
      pathName: "/api/v1/fixed-assets",
      expectedStatus: 201,
      body: {
        legalEntityId: LEGAL_ENTITY_ID,
        name: `FA37 Smoke DRAFT-ONLY ${uniqueSuffix}`,
        categoryId: category.categoryId,
        acquisitionDate: postingWindow.acquisitionDate,
        currencyCode: "AFN",
        ownerOperatingUnitId: operatingUnits.sourceOwnerOuId,
        locationOperatingUnitId: operatingUnits.sourceOwnerOuId,
        originalCostTxn: 3000,
        originalCostBase: 3000,
        description: "STEP-FA37 smoke DRAFT-ONLY",
      },
    });
    const draftAssetId = Number(draftAsset?.id || 0);
    assert(draftAssetId > 0, "SMOKE5: Failed to create draft asset");
    artifactState.assetIds.push(draftAssetId);

    const { status: draftXferStatus } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${draftAssetId}/ownership-transfer`,
      body: {
        effectiveDate: postingWindow.transferDate,
        postingDate: postingWindow.transferDate,
        targetOwnerOperatingUnitId: operatingUnits.targetOwnerOuId,
      },
    });

    assert(
      draftXferStatus === 400,
      `SMOKE5: Expected 400 for DRAFT asset transfer, got ${draftXferStatus}`
    );

    summary.smoke5_draftAssetRejection = {
      assetId: draftAssetId,
      httpStatus: draftXferStatus,
      PASS: true,
    };
    console.log("[fa37-smoke] SMOKE 5 PASSED ✓");

    // ── All passed ───────────────────────────────────────────────
    runPassed = true;
  } catch (err) {
    console.error("[fa37-smoke] FAILED:", err.message || err);
    console.error(err.stack || "");
    runPassed = false;
  } finally {
    if (!KEEP_ARTIFACTS && artifactState.assetIds.length > 0) {
      try {
        await cleanupArtifacts(artifactState);
        summary.cleanup = "done";
      } catch (cleanupErr) {
        console.error("[fa37-smoke] Cleanup error:", cleanupErr.message);
        summary.cleanup = `error: ${cleanupErr.message}`;
      }
    }

    if (server?.startedByScript && server.child) {
      await stopServer(server.child);
    }

    try {
      await closePool();
    } catch {
      // ignore
    }
  }

  console.log("\n[fa37-smoke] ═══════════════════════════════════════════");
  console.log("[fa37-smoke] SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("[fa37-smoke] ═══════════════════════════════════════════");

  if (runPassed) {
    console.log("[fa37-smoke] ALL SMOKES PASSED ✓");
    process.exit(0);
  } else {
    console.error("[fa37-smoke] SOME SMOKES FAILED ✗");
    process.exit(1);
  }
}

main();
