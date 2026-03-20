
  import bcrypt from "bcrypt";
  import { spawn } from "node:child_process";
  import { once } from "node:events";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { setTimeout as sleep } from "node:timers/promises";
  import { closePool, query } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const TEST_PORT = Number(process.env.FA21_SMOKE_PORT || 3121);
const BASE_URL =
  process.env.FA21_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA21_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);
const ENV_TENANT_ID = parseOptionalPositiveInt(process.env.FA21_SMOKE_TENANT_ID);
const ENV_LEGAL_ENTITY_ID = parseOptionalPositiveInt(
  process.env.FA21_SMOKE_LEGAL_ENTITY_ID
);
let TENANT_ID = ENV_TENANT_ID || 1;
let LEGAL_ENTITY_ID = ENV_LEGAL_ENTITY_ID || 1;
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA21_SMOKE_KEEP_ARTIFACTS,
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

function extractErrorMessage(payload, fallback = "Request failed") {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.code === "string" && payload.code.trim()) {
    return payload.code.trim();
  }
  if (typeof payload.raw === "string" && payload.raw.trim()) {
    return payload.raw.trim();
  }
  return fallback;
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
    process.stdout.write(`[fa21-smoke][server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[fa21-smoke][server] ${chunk}`);
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
  if (ENV_TENANT_ID && ENV_LEGAL_ENTITY_ID) {
    const explicit = await query(
      `SELECT le.id AS legal_entity_id
         FROM legal_entities le
        WHERE le.tenant_id = ?
          AND le.id = ?
          AND EXISTS (
                SELECT 1
                  FROM roles r
                 WHERE r.tenant_id = le.tenant_id
                   AND r.code = 'TenantAdmin'
              )
          AND EXISTS (
                SELECT 1
                  FROM operating_units ou
                 WHERE ou.tenant_id = le.tenant_id
                   AND ou.legal_entity_id = le.id
                   AND ou.status = 'ACTIVE'
              )
          AND EXISTS (
                SELECT 1
                  FROM accounts a
                  JOIN charts_of_accounts c ON c.id = a.coa_id
                 WHERE c.tenant_id = le.tenant_id
                   AND c.legal_entity_id = le.id
                   AND c.scope = 'LEGAL_ENTITY'
                   AND a.account_type = 'ASSET'
                   AND a.is_active = 1
                   AND a.allow_posting = 1
              )
          AND EXISTS (
                SELECT 1
                  FROM accounts a
                  JOIN charts_of_accounts c ON c.id = a.coa_id
                 WHERE c.tenant_id = le.tenant_id
                   AND c.legal_entity_id = le.id
                   AND c.scope = 'LEGAL_ENTITY'
                   AND a.account_type = 'EXPENSE'
                   AND a.is_active = 1
                   AND a.allow_posting = 1
              )
          AND EXISTS (
                SELECT 1
                  FROM accounts a
                  JOIN charts_of_accounts c ON c.id = a.coa_id
                 WHERE c.tenant_id = le.tenant_id
                   AND c.legal_entity_id = le.id
                   AND c.scope = 'LEGAL_ENTITY'
                   AND a.account_type = 'REVENUE'
                   AND a.is_active = 1
                   AND a.allow_posting = 1
              )
          AND EXISTS (
                SELECT 1
                  FROM books b
                  JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
                  LEFT JOIN period_statuses ps
                    ON ps.book_id = b.id
                   AND ps.fiscal_period_id = fp.id
                 WHERE b.tenant_id = le.tenant_id
                   AND b.legal_entity_id = le.id
                   AND b.book_type = 'LOCAL'
                   AND fp.is_adjustment = 0
                   AND COALESCE(ps.status, 'OPEN') = 'OPEN'
              )
        LIMIT 1`,
      [ENV_TENANT_ID, ENV_LEGAL_ENTITY_ID]
    );
    assert(
      explicit.rows?.[0],
      `Requested FA21 smoke context tenantId=${ENV_TENANT_ID}, legalEntityId=${ENV_LEGAL_ENTITY_ID} is not smoke-ready`
    );
    return {
      tenantId: ENV_TENANT_ID,
      legalEntityId: ENV_LEGAL_ENTITY_ID,
    };
  }

  const preferred = await query(
    `SELECT le.tenant_id,
            le.id AS legal_entity_id
       FROM legal_entities le
      WHERE le.tenant_id = 1
        AND EXISTS (
              SELECT 1
                FROM roles r
               WHERE r.tenant_id = le.tenant_id
                 AND r.code = 'TenantAdmin'
            )
        AND EXISTS (
              SELECT 1
                FROM operating_units ou
               WHERE ou.tenant_id = le.tenant_id
                 AND ou.legal_entity_id = le.id
                 AND ou.status = 'ACTIVE'
            )
        AND EXISTS (
              SELECT 1
                FROM accounts a
                JOIN charts_of_accounts c ON c.id = a.coa_id
               WHERE c.tenant_id = le.tenant_id
                 AND c.legal_entity_id = le.id
                 AND c.scope = 'LEGAL_ENTITY'
                 AND a.account_type = 'ASSET'
                 AND a.is_active = 1
                 AND a.allow_posting = 1
            )
        AND EXISTS (
              SELECT 1
                FROM accounts a
                JOIN charts_of_accounts c ON c.id = a.coa_id
               WHERE c.tenant_id = le.tenant_id
                 AND c.legal_entity_id = le.id
                 AND c.scope = 'LEGAL_ENTITY'
                 AND a.account_type = 'EXPENSE'
                 AND a.is_active = 1
                 AND a.allow_posting = 1
            )
        AND EXISTS (
              SELECT 1
                FROM accounts a
                JOIN charts_of_accounts c ON c.id = a.coa_id
               WHERE c.tenant_id = le.tenant_id
                 AND c.legal_entity_id = le.id
                 AND c.scope = 'LEGAL_ENTITY'
                 AND a.account_type = 'REVENUE'
                 AND a.is_active = 1
                 AND a.allow_posting = 1
            )
        AND EXISTS (
              SELECT 1
                FROM books b
                JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
                LEFT JOIN period_statuses ps
                  ON ps.book_id = b.id
                 AND ps.fiscal_period_id = fp.id
               WHERE b.tenant_id = le.tenant_id
                 AND b.legal_entity_id = le.id
                 AND b.book_type = 'LOCAL'
                 AND fp.is_adjustment = 0
                 AND COALESCE(ps.status, 'OPEN') = 'OPEN'
            )
      ORDER BY CASE WHEN le.id = 1 THEN 0 ELSE 1 END,
               le.id ASC
      LIMIT 1`
  );
  if (preferred.rows?.[0]) {
    return {
      tenantId: Number(preferred.rows[0].tenant_id),
      legalEntityId: Number(preferred.rows[0].legal_entity_id),
    };
  }

  const fallback = await query(
    `SELECT le.tenant_id,
            le.id AS legal_entity_id
       FROM legal_entities le
      WHERE EXISTS (
              SELECT 1
                FROM roles r
               WHERE r.tenant_id = le.tenant_id
                 AND r.code = 'TenantAdmin'
            )
        AND EXISTS (
              SELECT 1
                FROM operating_units ou
               WHERE ou.tenant_id = le.tenant_id
                 AND ou.legal_entity_id = le.id
                 AND ou.status = 'ACTIVE'
            )
        AND EXISTS (
              SELECT 1
                FROM accounts a
                JOIN charts_of_accounts c ON c.id = a.coa_id
               WHERE c.tenant_id = le.tenant_id
                 AND c.legal_entity_id = le.id
                 AND c.scope = 'LEGAL_ENTITY'
                 AND a.account_type = 'ASSET'
                 AND a.is_active = 1
                 AND a.allow_posting = 1
            )
        AND EXISTS (
              SELECT 1
                FROM accounts a
                JOIN charts_of_accounts c ON c.id = a.coa_id
               WHERE c.tenant_id = le.tenant_id
                 AND c.legal_entity_id = le.id
                 AND c.scope = 'LEGAL_ENTITY'
                 AND a.account_type = 'EXPENSE'
                 AND a.is_active = 1
                 AND a.allow_posting = 1
            )
        AND EXISTS (
              SELECT 1
                FROM accounts a
                JOIN charts_of_accounts c ON c.id = a.coa_id
               WHERE c.tenant_id = le.tenant_id
                 AND c.legal_entity_id = le.id
                 AND c.scope = 'LEGAL_ENTITY'
                 AND a.account_type = 'REVENUE'
                 AND a.is_active = 1
                 AND a.allow_posting = 1
            )
        AND EXISTS (
              SELECT 1
                FROM books b
                JOIN fiscal_periods fp ON fp.calendar_id = b.calendar_id
                LEFT JOIN period_statuses ps
                  ON ps.book_id = b.id
                 AND ps.fiscal_period_id = fp.id
               WHERE b.tenant_id = le.tenant_id
                 AND b.legal_entity_id = le.id
                 AND b.book_type = 'LOCAL'
                 AND fp.is_adjustment = 0
                 AND COALESCE(ps.status, 'OPEN') = 'OPEN'
            )
      ORDER BY le.tenant_id ASC, le.id ASC
      LIMIT 1`
  );

  const row = fallback.rows?.[0];
  assert(
    row,
    "No smoke-ready legal entity found. Set FA21_SMOKE_TENANT_ID and FA21_SMOKE_LEGAL_ENTITY_ID if needed."
  );
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
  };
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
    rows.length > 0,
    `No ACTIVE operating units found for tenant ${tenantId}, legal entity ${legalEntityId}`
  );

  const ownerOperatingUnitId = Number(rows[0].id);
  const locationOperatingUnitId = Number((rows[1] || rows[0]).id);
  return { ownerOperatingUnitId, locationOperatingUnitId };
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
    invalidRevenueAccountId: revenueAccounts[0],
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
  const password = "FA21Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa21.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA21 Smoke ${uniqueSuffix}`]
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

async function createSmokeProfile({
  tenantId,
  legalEntityId,
  userId,
  uniqueSuffix,
}) {
  const code = `FA21PF${uniqueSuffix.slice(-6)}`;
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
      `FA21 Smoke Profile ${uniqueSuffix}`,
      "Smoke profile for STEP-FA21 activation coverage",
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
  const code = `FA21CT${uniqueSuffix.slice(-6)}`;
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
      `FA21 Smoke Category ${uniqueSuffix}`,
      "Smoke category for STEP-FA21 activation coverage",
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

async function createDraftAsset({
  cookie,
  categoryId,
  legalEntityId,
  ownerOperatingUnitId,
  locationOperatingUnitId,
  acquisitionDate,
  uniqueSuffix,
  nameSuffix,
}) {
  const { payload } = await apiRequest({
    cookie,
    method: "POST",
    pathName: "/api/v1/fixed-assets",
    expectedStatus: 201,
    body: {
      legalEntityId,
      name: `FA21 Smoke ${nameSuffix} ${uniqueSuffix}`,
      categoryId,
      acquisitionDate,
      currencyCode: "AFN",
      ownerOperatingUnitId,
      locationOperatingUnitId,
      originalCostTxn: 5000,
      originalCostBase: 5000,
      description: `STEP-FA21 smoke ${nameSuffix}`,
      assetTag: `FA21-${nameSuffix}-${uniqueSuffix}`.slice(0, 40),
    },
  });

  const assetId = Number(payload?.id || 0);
  assert(assetId > 0, `Failed to create draft asset for ${nameSuffix}`);
  return payload;
}

async function getAssetDbState(assetId) {
  const assetResult = await query(
    `SELECT id,
            status,
            capitalization_date,
            in_service_date,
            salvage_value_txn,
            salvage_value_base,
            depreciation_method,
            remaining_useful_life_months,
            asset_account_id
       FROM fixed_assets
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [TENANT_ID, assetId]
  );
  const txnResult = await query(
    `SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN transaction_type = 'ACQUISITION' THEN 1 ELSE 0 END) AS acquisition_count,
        SUM(CASE WHEN transaction_type = 'CAPITALIZATION' THEN 1 ELSE 0 END) AS capitalization_count
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?`,
    [TENANT_ID, assetId]
  );
  const acquisitionResult = await query(
    `SELECT transaction_type,
            status,
            effective_date,
            posting_date,
            book_id,
            fiscal_period_id,
            gross_amount_base,
            nbv_amount_base
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
        AND transaction_type = 'ACQUISITION'
      LIMIT 1`,
    [TENANT_ID, assetId]
  );

  return {
    asset: assetResult.rows?.[0] || null,
    txnCounts: txnResult.rows?.[0] || null,
    acquisition: acquisitionResult.rows?.[0] || null,
  };
}

async function expectActivationFailure({
  cookie,
  assetId,
  body,
  expectedMessagePart,
}) {
  const { payload } = await apiRequest({
    cookie,
    method: "POST",
    pathName: `/api/v1/fixed-assets/${assetId}/activate`,
    expectedStatus: 400,
    body,
  });

  const message = String(payload?.message || "");
  assert(
    message.includes(expectedMessagePart),
    `Expected activation failure for asset ${assetId} to include "${expectedMessagePart}", got "${message}"`
  );

  const dbState = await getAssetDbState(assetId);
  assert(
    dbState.asset?.status === "DRAFT",
    `Asset ${assetId} should remain DRAFT after failed activation`
  );
  assert(
    Number(dbState.txnCounts?.total_count || 0) === 0,
    `Asset ${assetId} should not create transactions on failed activation`
  );

  return { message };
}

async function cleanupArtifacts(state) {
  const assetIds = Array.from(new Set(state.assetIds)).filter((id) => Number(id) > 0);

  if (assetIds.length > 0) {
    const placeholders = assetIds.map(() => "?").join(", ");
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
    period: null,
    validActivation: null,
    invalidActivations: [],
    postActivationPatch: null,
    cleanup: KEEP_ARTIFACTS ? "skipped" : "pending",
  };

  let server = null;

  try {
    server = await ensureApiServer();
    summary.serverStartedByScript = Boolean(server.startedByScript);

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

    const cookie = await login(smokeUser.email, smokeUser.password);

    summary.fixtureIds = {
      userId: smokeUser.userId,
      profileId: profile.profileId,
      categoryId: category.categoryId,
    };
    summary.period = {
      periodName: postingWindow.periodName,
      startDate: postingWindow.startDate,
      endDate: postingWindow.endDate,
      bookId: postingWindow.bookId,
      fiscalPeriodId: postingWindow.fiscalPeriodId,
      acquisitionDate: postingWindow.acquisitionDate,
      capitalizationDate: postingWindow.capitalizationDate,
      inServiceDate: postingWindow.inServiceDate,
      postingDate: postingWindow.postingDate,
    };

    const validDraft = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "valid",
    });
    artifactState.assetIds.push(Number(validDraft.id));

    const { payload: activatedAsset } = await apiRequest({
      cookie,
      method: "POST",
      pathName: `/api/v1/fixed-assets/${validDraft.id}/activate`,
      expectedStatus: 200,
      body: {
        postingDate: postingWindow.postingDate,
        capitalizationDate: postingWindow.capitalizationDate,
        inServiceDate: postingWindow.inServiceDate,
      },
    });

    const validDbState = await getAssetDbState(validDraft.id);
    assert(activatedAsset.status === "ACTIVE", "Valid asset did not activate");
    assert(
      activatedAsset.capitalizationDate === postingWindow.capitalizationDate,
      "capitalizationDate was not persisted"
    );
    assert(
      activatedAsset.inServiceDate === postingWindow.inServiceDate,
      "inServiceDate was not persisted"
    );
    assert(
      activatedAsset.depreciationMethod === "STRAIGHT_LINE",
      "depreciation method snapshot did not persist"
    );
    assert(
      Number(activatedAsset.salvageValueBase) === 100,
      "salvageValueBase did not persist"
    );
    assert(
      Number(validDbState.txnCounts?.acquisition_count || 0) === 1,
      "Valid activation did not create exactly one ACQUISITION transaction"
    );
    assert(
      Number(validDbState.txnCounts?.capitalization_count || 0) === 0,
      "Valid activation created a CAPITALIZATION transaction"
    );
    assert(
      validDbState.acquisition?.status === "POSTED",
      "ACQUISITION transaction was not POSTED"
    );
    assert(
      validDbState.acquisition?.effective_date === postingWindow.capitalizationDate,
      "ACQUISITION effective_date mismatch"
    );
    assert(
      validDbState.acquisition?.posting_date === postingWindow.postingDate,
      "ACQUISITION posting_date mismatch"
    );
    assert(
      Number(validDbState.acquisition?.book_id || 0) === postingWindow.bookId,
      "ACQUISITION book_id mismatch"
    );
    assert(
      Number(validDbState.acquisition?.fiscal_period_id || 0) ===
        postingWindow.fiscalPeriodId,
      "ACQUISITION fiscal_period_id mismatch"
    );

    summary.validActivation = {
      assetId: Number(validDraft.id),
      status: activatedAsset.status,
      capitalizationDate: activatedAsset.capitalizationDate,
      inServiceDate: activatedAsset.inServiceDate,
      depreciationMethod: activatedAsset.depreciationMethod,
      salvageValueBase: activatedAsset.salvageValueBase,
      acquisitionTransactionCount: Number(
        validDbState.txnCounts?.acquisition_count || 0
      ),
      capitalizationTransactionCount: Number(
        validDbState.txnCounts?.capitalization_count || 0
      ),
    };

    const invalidMissingCap = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "missing-cap",
    });
    artifactState.assetIds.push(Number(invalidMissingCap.id));
    summary.invalidActivations.push({
      assetId: Number(invalidMissingCap.id),
      case: "missing capitalizationDate",
      ...(await expectActivationFailure({
        cookie,
        assetId: Number(invalidMissingCap.id),
        body: {
          postingDate: postingWindow.postingDate,
          inServiceDate: postingWindow.inServiceDate,
        },
        expectedMessagePart: "capitalizationDate is required",
      })),
    });

    const invalidMissingInService = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "missing-in-service",
    });
    artifactState.assetIds.push(Number(invalidMissingInService.id));
    summary.invalidActivations.push({
      assetId: Number(invalidMissingInService.id),
      case: "missing inServiceDate",
      ...(await expectActivationFailure({
        cookie,
        assetId: Number(invalidMissingInService.id),
        body: {
          postingDate: postingWindow.postingDate,
          capitalizationDate: postingWindow.capitalizationDate,
        },
        expectedMessagePart: "inServiceDate is required",
      })),
    });

    const invalidBeforeAcquisition = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "before-acquisition",
    });
    artifactState.assetIds.push(Number(invalidBeforeAcquisition.id));
    summary.invalidActivations.push({
      assetId: Number(invalidBeforeAcquisition.id),
      case: "inServiceDate before acquisitionDate",
      ...(await expectActivationFailure({
        cookie,
        assetId: Number(invalidBeforeAcquisition.id),
        body: {
          postingDate: postingWindow.postingDate,
          capitalizationDate: postingWindow.capitalizationDate,
          inServiceDate: addDays(postingWindow.acquisitionDate, -1),
        },
        expectedMessagePart: "cannot precede acquisitionDate",
      })),
    });

    const invalidMissingProfile = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "missing-profile",
    });
    artifactState.assetIds.push(Number(invalidMissingProfile.id));
    await query(
      `UPDATE fixed_assets
          SET depreciation_profile_id = NULL
        WHERE tenant_id = ?
          AND id = ?`,
      [TENANT_ID, Number(invalidMissingProfile.id)]
    );
    summary.invalidActivations.push({
      assetId: Number(invalidMissingProfile.id),
      case: "missing depreciationProfileId",
      ...(await expectActivationFailure({
        cookie,
        assetId: Number(invalidMissingProfile.id),
        body: {
          postingDate: postingWindow.postingDate,
          capitalizationDate: postingWindow.capitalizationDate,
          inServiceDate: postingWindow.inServiceDate,
        },
        expectedMessagePart: "depreciationProfileId is required",
      })),
    });

    const invalidMissingLife = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "missing-life",
    });
    artifactState.assetIds.push(Number(invalidMissingLife.id));
    await query(
      `UPDATE fixed_assets
          SET useful_life_months = NULL,
              remaining_useful_life_months = NULL
        WHERE tenant_id = ?
          AND id = ?`,
      [TENANT_ID, Number(invalidMissingLife.id)]
    );
    summary.invalidActivations.push({
      assetId: Number(invalidMissingLife.id),
      case: "missing usefulLifeMonths",
      ...(await expectActivationFailure({
        cookie,
        assetId: Number(invalidMissingLife.id),
        body: {
          postingDate: postingWindow.postingDate,
          capitalizationDate: postingWindow.capitalizationDate,
          inServiceDate: postingWindow.inServiceDate,
        },
        expectedMessagePart: "usefulLifeMonths is required",
      })),
    });

    const invalidAccountType = await createDraftAsset({
      cookie,
      categoryId: category.categoryId,
      legalEntityId: LEGAL_ENTITY_ID,
      ownerOperatingUnitId: operatingUnits.ownerOperatingUnitId,
      locationOperatingUnitId: operatingUnits.locationOperatingUnitId,
      acquisitionDate: postingWindow.acquisitionDate,
      uniqueSuffix,
      nameSuffix: "invalid-account",
    });
    artifactState.assetIds.push(Number(invalidAccountType.id));
    await query(
      `UPDATE fixed_assets
          SET asset_account_id = ?
        WHERE tenant_id = ?
          AND id = ?`,
      [
        accounts.invalidRevenueAccountId,
        TENANT_ID,
        Number(invalidAccountType.id),
      ]
    );
    summary.invalidActivations.push({
      assetId: Number(invalidAccountType.id),
      case: "invalid account mapping type",
      ...(await expectActivationFailure({
        cookie,
        assetId: Number(invalidAccountType.id),
        body: {
          postingDate: postingWindow.postingDate,
          capitalizationDate: postingWindow.capitalizationDate,
          inServiceDate: postingWindow.inServiceDate,
        },
        expectedMessagePart: "asset account must be an ASSET account",
      })),
    });

    const { payload: patchPayload } = await apiRequest({
      cookie,
      method: "PATCH",
      pathName: `/api/v1/fixed-assets/${validDraft.id}`,
      expectedStatus: 400,
      body: {
        usefulLifeMonths: 36,
      },
    });
    const patchMessage = String(patchPayload?.message || "");
    assert(
      patchMessage.includes("not in DRAFT"),
      `Unexpected post-activation patch rejection: ${patchMessage}`
    );
    summary.postActivationPatch = {
      assetId: Number(validDraft.id),
      message: patchMessage,
    };
    runPassed = true;
  } finally {
    try {
      if (KEEP_ARTIFACTS) {
        summary.cleanup = "skipped";
      } else {
        await cleanupArtifacts(artifactState);
        summary.cleanup = "completed";
      }
    } catch (cleanupError) {
      summary.cleanup = `failed: ${cleanupError?.message || cleanupError}`;
      console.error("STEP-FA21 smoke cleanup failed.");
      console.error(cleanupError?.stack || cleanupError);
      process.exitCode = 1;
    }

    if (runPassed) {
      console.log("STEP-FA21 smoke passed.");
      console.log(JSON.stringify(summary, null, 2));
    }

    await stopServer(server?.child);
    await closePool();
  }
}

main().catch((error) => {  console.error("STEP-FA21 smoke failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
