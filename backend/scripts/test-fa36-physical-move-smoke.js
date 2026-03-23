
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

const TEST_PORT = Number(process.env.FA36_SMOKE_PORT || 3136);
const BASE_URL =
  process.env.FA36_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA36_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA36_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA36_SMOKE_LEGAL_ENTITY_ID
);
let TENANT_ID = ENV_TENANT_ID || 0;
let LEGAL_ENTITY_ID = ENV_LEGAL_ENTITY_ID || 0;
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA36_SMOKE_KEEP_ARTIFACTS,
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
    process.stdout.write(`[fa36-smoke][server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[fa36-smoke][server] ${chunk}`);
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

async function resolveTenantAdminRoleId(tenantId) {
  const result = await query(
    `SELECT id
       FROM roles
      WHERE tenant_id = ?
        AND code = 'TenantAdmin'
      LIMIT 1`,
    [tenantId]
  );
  const roleId = Number(result.rows?.[0]?.id || 0);
  assert(roleId > 0, `TenantAdmin role not found for tenant ${tenantId}`);
  return roleId;
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "FA36" });
}

async function resolveActiveOperatingUnitIds(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND status = 'ACTIVE'
      ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  const rows = result.rows || [];
  assert(
    rows.length >= 2,
    `FA36 smoke needs at least 2 ACTIVE operating units for tenant ${tenantId}, legal entity ${legalEntityId}`
  );

  return {
    ownerOperatingUnitId: Number(rows[0].id),
    locationOperatingUnitId1: Number(rows[0].id),
    locationOperatingUnitId2: Number(rows[1].id),
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
  };
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA36Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa36.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA36 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create smoke user");

  const roleId = await resolveTenantAdminRoleId(tenantId);
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id, user_id, role_id, scope_type, scope_id, effect
     ) VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
    [tenantId, userId, roleId, tenantId]
  );

  return { userId, email, password, roleId };
}

async function createSmokeProfile({ tenantId, legalEntityId, userId, uniqueSuffix }) {
  const code = `FA36PF${uniqueSuffix.slice(-6)}`;
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
      `FA36 Smoke Profile ${uniqueSuffix}`,
      "Smoke profile for STEP-FA36 physical move",
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
  const code = `FA36CT${uniqueSuffix.slice(-6)}`;
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
      `FA36 Smoke Category ${uniqueSuffix}`,
      "Smoke category for STEP-FA36 physical move",
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
}) {
  // Create draft
  const { payload: draft } = await apiRequest({
    cookie,
    method: "POST",
    pathName: "/api/v1/fixed-assets",
    expectedStatus: 201,
    body: {
      legalEntityId,
      name: `FA36 Smoke ${nameSuffix} ${uniqueSuffix}`,
      categoryId,
      acquisitionDate: postingWindow.acquisitionDate,
      currencyCode: "AFN",
      ownerOperatingUnitId,
      locationOperatingUnitId,
      originalCostTxn: 5000,
      originalCostBase: 5000,
      departmentCode: "DEPT-ORIG",
      costCenterCode: "CC-ORIG",
      description: `STEP-FA36 smoke ${nameSuffix}`,
      assetTag: `FA36-${nameSuffix}-${uniqueSuffix}`.slice(0, 40),
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
    await query(
      `DELETE FROM fixed_asset_physical_move_details
        WHERE tenant_id = ?
          AND asset_id IN (${placeholders})`,
      [TENANT_ID, ...assetIds]
    );
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
    smoke1_locationCustodianMove: null,
    smoke2_departmentCostCenterOnlyMove: null,
    smoke3_repeatedMoveHistory: null,
    smoke4_noOpMoveRejection: null,
    smoke5_noChangeFieldRejection: null,
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
    const operatingUnits = await resolveActiveOperatingUnitIds(
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
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOU1: operatingUnits.locationOperatingUnitId1,
      locationOU2: operatingUnits.locationOperatingUnitId2,
    };

    const cookie = await login(smokeUser.email, smokeUser.password);

    // ── Create and activate test asset ───────────────────────────
    const asset = await createAndActivateAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId1,
      postingWindow,
      uniqueSuffix,
      nameSuffix: "MOVE-TARGET",
    });
    const assetId = Number(asset.id);
    artifactState.assetIds.push(assetId);

    const moveEffectiveDate = minDate(
      addDays(postingWindow.inServiceDate, 1),
      postingWindow.endDate
    );

    // ══════════════════════════════════════════════════════════════
    // SMOKE 1: Move active asset to new location + custodian
    // ══════════════════════════════════════════════════════════════
    console.log("[fa36-smoke] SMOKE 1: Location + custodian move...");

    // Resolve a custodian if one exists, otherwise skip custodian part
    const custodianResult = await query(
      `SELECT id FROM fixed_asset_custodian_employees
        WHERE tenant_id = ? LIMIT 1`,
      [TENANT_ID]
    );
    const custodianId = custodianResult.rows?.[0]?.id
      ? Number(custodianResult.rows[0].id)
      : null;

    const move1Body = {
      effectiveDate: moveEffectiveDate,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId2,
    };
    if (custodianId != null) {
      move1Body.custodianEmployeeId = custodianId;
    }

    const { payload: move1Result } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId}/physical-move`,
      expectedStatus: 200,
      body: move1Body,
    });

    // Verify asset master updated
    assert(
      Number(move1Result?.locationOperatingUnitId) === operatingUnits.locationOperatingUnitId2,
      `SMOKE1: Expected locationOperatingUnitId=${operatingUnits.locationOperatingUnitId2}, got ${move1Result?.locationOperatingUnitId}`
    );
    // Verify owner OU unchanged
    assert(
      Number(move1Result?.ownerOperatingUnitId) === operatingUnits.ownerOperatingUnitId,
      `SMOKE1: ownerOperatingUnitId must remain ${operatingUnits.ownerOperatingUnitId}, got ${move1Result?.ownerOperatingUnitId}`
    );

    // Verify DB: one PHYSICAL_MOVE transaction exists
    const txn1Result = await query(
      `SELECT id, transaction_type, status, effective_date
         FROM fixed_asset_transactions
        WHERE tenant_id = ? AND asset_id = ? AND transaction_type = 'PHYSICAL_MOVE'
        ORDER BY id ASC`,
      [TENANT_ID, assetId]
    );
    assert(
      txn1Result.rows?.length === 1,
      `SMOKE1: Expected 1 PHYSICAL_MOVE transaction, got ${txn1Result.rows?.length}`
    );
    assert(
      txn1Result.rows[0].status === "POSTED",
      `SMOKE1: PHYSICAL_MOVE transaction should be POSTED, got ${txn1Result.rows[0].status}`
    );

    // Verify DB: one detail row exists with correct from/to
    const detail1Result = await query(
      `SELECT *
         FROM fixed_asset_physical_move_details
        WHERE tenant_id = ? AND asset_id = ?
        ORDER BY id ASC`,
      [TENANT_ID, assetId]
    );
    assert(
      detail1Result.rows?.length === 1,
      `SMOKE1: Expected 1 detail row, got ${detail1Result.rows?.length}`
    );
    const detail1 = detail1Result.rows[0];
    assert(
      Number(detail1.from_location_operating_unit_id) === operatingUnits.locationOperatingUnitId1,
      `SMOKE1: from_location_ou should be ${operatingUnits.locationOperatingUnitId1}`
    );
    assert(
      Number(detail1.to_location_operating_unit_id) === operatingUnits.locationOperatingUnitId2,
      `SMOKE1: to_location_ou should be ${operatingUnits.locationOperatingUnitId2}`
    );

    // Verify no journal was created for this transaction
    const journalCheck = await query(
      `SELECT journal_entry_id FROM fixed_asset_transactions
        WHERE tenant_id = ? AND id = ?`,
      [TENANT_ID, txn1Result.rows[0].id]
    );
    assert(
      journalCheck.rows?.[0]?.journal_entry_id == null,
      "SMOKE1: No journal should be created for physical move"
    );

    summary.smoke1_locationCustodianMove = "PASSED";
    console.log("[fa36-smoke] SMOKE 1: PASSED");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 2: Department/cost-center-only move
    // ══════════════════════════════════════════════════════════════
    console.log("[fa36-smoke] SMOKE 2: Department/cost-center-only move...");

    const move2EffectiveDate = minDate(
      addDays(moveEffectiveDate, 1),
      postingWindow.endDate
    );

    const { payload: move2Result } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId}/physical-move`,
      expectedStatus: 200,
      body: {
        effectiveDate: move2EffectiveDate,
        departmentCode: "DEPT-NEW",
        costCenterCode: "CC-NEW",
      },
    });

    // Verify department/cost-center updated
    assert(
      move2Result?.departmentCode === "DEPT-NEW",
      `SMOKE2: Expected departmentCode=DEPT-NEW, got ${move2Result?.departmentCode}`
    );
    assert(
      move2Result?.costCenterCode === "CC-NEW",
      `SMOKE2: Expected costCenterCode=CC-NEW, got ${move2Result?.costCenterCode}`
    );

    // Verify owner OU still unchanged
    assert(
      Number(move2Result?.ownerOperatingUnitId) === operatingUnits.ownerOperatingUnitId,
      `SMOKE2: ownerOperatingUnitId must remain unchanged`
    );

    // Verify second detail row captures dept/cc from/to
    const detail2Result = await query(
      `SELECT *
         FROM fixed_asset_physical_move_details
        WHERE tenant_id = ? AND asset_id = ?
        ORDER BY id ASC`,
      [TENANT_ID, assetId]
    );
    assert(
      detail2Result.rows?.length === 2,
      `SMOKE2: Expected 2 detail rows after second move, got ${detail2Result.rows?.length}`
    );
    const detail2 = detail2Result.rows[1];
    assert(
      detail2.from_department_code === "DEPT-ORIG",
      `SMOKE2: from_department_code should be DEPT-ORIG, got ${detail2.from_department_code}`
    );
    assert(
      detail2.to_department_code === "DEPT-NEW",
      `SMOKE2: to_department_code should be DEPT-NEW, got ${detail2.to_department_code}`
    );
    assert(
      detail2.from_cost_center_code === "CC-ORIG",
      `SMOKE2: from_cost_center_code should be CC-ORIG, got ${detail2.from_cost_center_code}`
    );
    assert(
      detail2.to_cost_center_code === "CC-NEW",
      `SMOKE2: to_cost_center_code should be CC-NEW, got ${detail2.to_cost_center_code}`
    );

    summary.smoke2_departmentCostCenterOnlyMove = "PASSED";
    console.log("[fa36-smoke] SMOKE 2: PASSED");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 3: Repeated move history readable in chronological order
    // ══════════════════════════════════════════════════════════════
    console.log("[fa36-smoke] SMOKE 3: Repeated move history chronological order...");

    const allTxnResult = await query(
      `SELECT fat.id, fat.transaction_type, fat.effective_date,
              pmd.from_location_operating_unit_id,
              pmd.to_location_operating_unit_id,
              pmd.from_department_code,
              pmd.to_department_code,
              pmd.from_cost_center_code,
              pmd.to_cost_center_code
         FROM fixed_asset_transactions fat
         LEFT JOIN fixed_asset_physical_move_details pmd
           ON pmd.transaction_id = fat.id
        WHERE fat.tenant_id = ?
          AND fat.asset_id = ?
          AND fat.transaction_type = 'PHYSICAL_MOVE'
        ORDER BY fat.effective_date ASC, fat.id ASC`,
      [TENANT_ID, assetId]
    );

    const moveRows = allTxnResult.rows || [];
    assert(
      moveRows.length === 2,
      `SMOKE3: Expected 2 PHYSICAL_MOVE transactions in chronological order, got ${moveRows.length}`
    );

    // First move: location change
    assert(
      Number(moveRows[0].from_location_operating_unit_id) === operatingUnits.locationOperatingUnitId1,
      "SMOKE3: First move from_location should be original location"
    );
    assert(
      Number(moveRows[0].to_location_operating_unit_id) === operatingUnits.locationOperatingUnitId2,
      "SMOKE3: First move to_location should be new location"
    );

    // Second move: dept/cc change
    assert(
      moveRows[1].from_department_code === "DEPT-ORIG",
      "SMOKE3: Second move from_department_code should be DEPT-ORIG"
    );
    assert(
      moveRows[1].to_department_code === "DEPT-NEW",
      "SMOKE3: Second move to_department_code should be DEPT-NEW"
    );

    // Chronological order verified by effective_date ASC
    assert(
      String(moveRows[0].effective_date).slice(0, 10) <= String(moveRows[1].effective_date).slice(0, 10),
      "SMOKE3: Move transactions must be in chronological order"
    );

    summary.smoke3_repeatedMoveHistory = "PASSED";
    console.log("[fa36-smoke] SMOKE 3: PASSED");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 4: No-op move rejection (no field actually changes)
    // ══════════════════════════════════════════════════════════════
    console.log("[fa36-smoke] SMOKE 4: No-op move rejection...");

    const { payload: noOpResult } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId}/physical-move`,
      expectedStatus: 400,
      body: {
        effectiveDate: moveEffectiveDate,
        locationOperatingUnitId: operatingUnits.locationOperatingUnitId2, // already current
        departmentCode: "DEPT-NEW",   // already current
        costCenterCode: "CC-NEW",     // already current
      },
    });

    assert(
      String(noOpResult?.message || "").includes("at least one field to change"),
      `SMOKE4: Expected no-op rejection message, got ${noOpResult?.message}`
    );

    summary.smoke4_noOpMoveRejection = "PASSED";
    console.log("[fa36-smoke] SMOKE 4: PASSED");

    // ══════════════════════════════════════════════════════════════
    // SMOKE 5: Rejection when no move fields provided at all
    // ══════════════════════════════════════════════════════════════
    console.log("[fa36-smoke] SMOKE 5: No-field rejection...");

    const { payload: noFieldResult } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${assetId}/physical-move`,
      expectedStatus: 400,
      body: {
        effectiveDate: moveEffectiveDate,
      },
    });

    assert(
      String(noFieldResult?.message || "").includes("At least one physical-move field"),
      `SMOKE5: Expected missing-field rejection, got ${noFieldResult?.message}`
    );

    summary.smoke5_noChangeFieldRejection = "PASSED";
    console.log("[fa36-smoke] SMOKE 5: PASSED");

    // ══════════════════════════════════════════════════════════════
    runPassed = true;
  } catch (err) {
    console.error("[fa36-smoke] FAILED:", err.message);
    console.error(err.stack);
  } finally {
    if (!KEEP_ARTIFACTS) {
      try {
        await cleanupArtifacts(artifactState);
        summary.cleanup = "done";
      } catch (cleanupError) {
        console.error("[fa36-smoke] Cleanup error:", cleanupError.message);
        summary.cleanup = `error: ${cleanupError.message}`;
      }
    }

    if (server?.startedByScript) {
      await stopServer(server.child);
    }

    await closePool();
  }

  if (runPassed) {
    console.log(`\nSTEP-FA36 smoke passed. ${JSON.stringify(summary, null, 2)}`);
    process.exit(0);
  } else {
    console.error(`\nSTEP-FA36 smoke FAILED. ${JSON.stringify(summary, null, 2)}`);
    process.exit(1);
  }
}

main();
