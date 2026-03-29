
  import bcrypt from "bcrypt";
  import { spawn } from "node:child_process";
  import { once } from "node:events";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { setTimeout as sleep } from "node:timers/promises";
  import { closePool, query } from "../src/db.js";
  import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
  import {
  activateAsset,
  createAssetDraft,
  getAssetDetail,
  ownershipTransferAsset,
  physicalMoveAsset,
} from "../src/services/fixed-assets.service.js";
  import { getAssetDepreciationSchedule } from "../src/services/fixed-assets.depreciation.service.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));const BACKEND_ROOT = path.resolve(__dirname, "..");
const TEST_PORT = Number(process.env.FA48_SMOKE_PORT || 3148);const BASE_URL =
  process.env.FA48_SMOKE_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;const SERVER_START_TIMEOUT_MS = Number(
  process.env.FA48_SMOKE_SERVER_START_TIMEOUT_MS || 60000
);const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA48_SMOKE_KEEP_ARTIFACTS,
  true
);
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
function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function amountsEqual(left, right, epsilon = 0.0001) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}
function addDays(dateText, days) {
  const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}
function minDate(left, right) {
  return left <= right ? left : right;
}
function dateWithinPeriod(period, offset) {
  return minDate(addDays(period.startDate, offset), period.endDate);
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
  const headers = {
    Accept: "application/json",
  };
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
    process.stdout.write(`[fa48-smoke][server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[fa48-smoke][server] ${chunk}`);
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
async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA48Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa48.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA48 Smoke ${uniqueSuffix}`]
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
  return { userId, email, password };
}
async function resolveBookContext(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id, calendar_id, base_currency_code
       FROM books
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND book_type = 'LOCAL'
      ORDER BY id ASC
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const row = result.rows?.[0] || null;
  assert(
    row,
    `LOCAL book not found for tenant ${tenantId}, legal entity ${legalEntityId}`
  );
  return {
    bookId: Number(row.id),
    calendarId: Number(row.calendar_id),
    currencyCode: String(row.base_currency_code || "USD"),
  };
}
async function resolvePeriodTriplet(calendarId, today) {
  const result = await query(
    `SELECT id, period_name, start_date, end_date
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND is_adjustment = 0
      ORDER BY start_date ASC, id ASC`,
    [calendarId]
  );
  const periods = (result.rows || []).map((row) => ({
    id: Number(row.id),
    periodName: String(row.period_name || ""),
    startDate: String(row.start_date || "").slice(0, 10),
    endDate: String(row.end_date || "").slice(0, 10),
    periodKey: String(row.start_date || "").slice(0, 7),
  }));
  const currentIndex = periods.findIndex((row) => (
    row.startDate <= today && today <= row.endDate
  ));
  assert(currentIndex >= 2, `Could not resolve two prior fiscal periods before ${today}`);
  return {
    firstPrior: periods[currentIndex - 2],
    secondPrior: periods[currentIndex - 1],
    current: periods[currentIndex],
  };
}
async function resolveAccountFixtures(tenantId, legalEntityId) {
  const result = await query(
    `SELECT a.id, a.code
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.scope = 'LEGAL_ENTITY'
        AND a.is_active = 1
        AND a.allow_posting = 1
        AND a.code IN ('150000', '257000', '770000', '632000', '600000')
      ORDER BY a.id ASC`,
    [tenantId, legalEntityId]
  );
  const byCode = new Map(
    (result.rows || []).map((row) => [String(row.code), Number(row.id)])
  );
  assert(byCode.get("150000"), "Smoke asset account not found");
  assert(byCode.get("257000"), "Smoke accumulated depreciation account not found");
  assert(byCode.get("770000"), "Smoke depreciation expense account not found");
  assert(byCode.get("632000"), "Smoke disposal loss account not found");
  assert(byCode.get("600000"), "Smoke disposal gain account not found");
  return {
    assetAccountId: byCode.get("150000"),
    accumDeprAccountId: byCode.get("257000"),
    deprExpenseAccountId: byCode.get("770000"),
    disposalLossAccountId: byCode.get("632000"),
    disposalGainAccountId: byCode.get("600000"),
  };
}
async function resolveOuCId({
  tenantId,
  legalEntityId,
  sourceOuId,
  targetOuId,
}) {
  const result = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND status = 'ACTIVE'
        AND id NOT IN (?, ?)
      ORDER BY id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, sourceOuId, targetOuId]
  );
  const ouId = Number(result.rows?.[0]?.id || 0);
  assert(ouId > 0, "Smoke third OU not found");
  return ouId;
}
async function createSmokeProfile({
  tenantId,
  legalEntityId,
  uniqueSuffix,
  userId,
}) {
  const code = `FA48PF${uniqueSuffix.slice(-6)}`;
  const result = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id,
        legal_entity_id,
        code,
        name,
        status,
        method,
        declining_balance_rate_percent,
        switch_to_straight_line,
        description,
        created_by_user_id,
        updated_by_user_id
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE', NULL, 0, ?, ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      code,
      `FA48 Retro Correction ${uniqueSuffix}`,
      "Focused smoke profile for retro ownership transfer correction verification",
      userId,
      userId,
    ]
  );
  const profileId = Number(result.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create smoke depreciation profile");
  return { profileId, code };
}
async function createSmokeCategory({
  tenantId,
  legalEntityId,
  profileId,
  accounts,
  uniqueSuffix,
  userId,
}) {
  const code = `FA48CT${uniqueSuffix.slice(-6)}`;
  const result = await query(
    `INSERT INTO fixed_asset_categories (
        tenant_id,
        legal_entity_id,
        code,
        name,
        status,
        description,
        capitalization_threshold_base,
        default_useful_life_months,
        default_salvage_rule_type,
        default_salvage_percent,
        default_salvage_amount_base,
        default_depreciation_profile_id,
        default_asset_account_id,
        default_accum_depr_account_id,
        default_depr_expense_account_id,
        default_disposal_gain_account_id,
        default_disposal_loss_account_id,
        created_by_user_id,
        updated_by_user_id
     ) VALUES (
        ?, ?, ?, ?, 'ACTIVE', ?, 100, 12, 'NONE', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      code,
      `FA48 Retro Category ${uniqueSuffix}`,
      "Focused smoke category for retro ownership transfer correction verification",
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
  const categoryId = Number(result.rows?.insertId || 0);
  assert(categoryId > 0, "Failed to create smoke category");
  return { categoryId, code };
}
async function createActivatedSmokeAsset({
  tenantId,
  legalEntityId,
  userId,
  categoryId,
  ownerOperatingUnitId,
  locationOperatingUnitId,
  currencyCode,
  acquisitionDate,
  uniqueSuffix,
  originalCostBase,
}) {
  const asset = await createAssetDraft({
    tenantId,
    legalEntityId,
    name: `FA48 ${uniqueSuffix}`,
    categoryId,
    acquisitionDate,
    currencyCode,
    description: "Focused smoke asset for retro ownership transfer correction verification",
    assetTag: `FA48-${uniqueSuffix}`.slice(0, 40),
    serialNo: null,
    ownerOperatingUnitId,
    locationOperatingUnitId,
    departmentCode: null,
    costCenterCode: null,
    custodianEmployeeId: null,
    counterpartyId: null,
    originalCostTxn: originalCostBase,
    originalCostBase,
    userId,
  });
  const assetId = Number(asset?.id || 0);
  assert(assetId > 0, `Failed to create smoke asset ${uniqueSuffix}`);
  await activateAsset({
    tenantId,
    assetId,
    postingDate: acquisitionDate,
    capitalizationDate: acquisitionDate,
    inServiceDate: acquisitionDate,
    userId,
  });
  return getAssetDetail({ tenantId, assetId });
}
function requireScheduleRow(schedule, periodKey, label) {
  const row = (schedule?.rows || []).find((candidate) => candidate.periodKey === periodKey) || null;
  assert(row, `Missing ${label} schedule row for period ${periodKey}`);
  return row;
}
async function insertPostedRunHeader({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  periodKey,
  postingDate,
  amountTxn,
  amountBase,
  userId,
}) {
  const result = await query(
    `INSERT INTO fixed_asset_depreciation_runs (
        tenant_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        posting_date,
        period_key,
        status,
        asset_count,
        posted_asset_count,
        skipped_asset_count,
        error_count,
        total_planned_amount_txn,
        total_planned_amount_base,
        total_posted_amount_txn,
        total_posted_amount_base,
        created_by_user_id,
        posted_by_user_id,
        posted_at
     ) VALUES (
        ?, ?, ?, ?, ?, ?, 'POSTED', 1, 1, 0, 0, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
     )`,
    [
      tenantId,
      legalEntityId,
      bookId,
      fiscalPeriodId,
      postingDate,
      periodKey,
      amountTxn,
      amountBase,
      amountTxn,
      amountBase,
      userId,
      userId,
    ]
  );
  const runId = Number(result.rows?.insertId || 0);
  assert(runId > 0, `Failed to insert posted run header for ${periodKey}`);
  return runId;
}
async function seedPostedDepreciationHistory({
  tenantId,
  legalEntityId,
  asset,
  bookId,
  periods,
  scheduleRows,
  userId,
}) {
  let latestClosingNbvBase = toNumber(asset.originalCostBase);
  let latestClosingNbvTxn = toNumber(asset.originalCostTxn);
  const seeded = [];
  for (const period of periods) {
    const row = requireScheduleRow(
      { rows: scheduleRows },
      period.periodKey,
      "seeded depreciation history"
    );
    const runId = await insertPostedRunHeader({
      tenantId,
      legalEntityId,
      bookId,
      fiscalPeriodId: period.id,
      periodKey: period.periodKey,
      postingDate: period.endDate,
      amountTxn: toNumber(row.depreciationAmountTxn),
      amountBase: toNumber(row.depreciationAmountBase),
      userId,
    });
    const txResult = await query(
      `INSERT INTO fixed_asset_transactions (
          tenant_id,
          legal_entity_id,
          asset_id,
          transaction_type,
          status,
          effective_date,
          posting_date,
          book_id,
          fiscal_period_id,
          currency_code,
          depreciation_kind,
          journal_entry_id,
          source_ref_type,
          source_ref_id,
          source_ref_line_id,
          gross_amount_txn,
          gross_amount_base,
          accum_depr_amount_txn,
          accum_depr_amount_base,
          nbv_amount_txn,
          nbv_amount_base,
          reversed_transaction_id,
          note,
          created_by_user_id
       ) VALUES (
          ?, ?, ?, 'DEPRECIATION', 'POSTED', ?, ?, ?, ?, ?, 'RUN', NULL, NULL, NULL, NULL,
          ?, ?, ?, ?, ?, ?, NULL, ?, ?
       )`,
      [
        tenantId,
        legalEntityId,
        asset.id,
        period.endDate,
        period.endDate,
        bookId,
        period.id,
        asset.currencyCode,
        toNumber(asset.originalCostTxn),
        toNumber(asset.originalCostBase),
        toNumber(row.accumDepreciationTxn),
        toNumber(row.accumDepreciationBase),
        toNumber(row.nbvTxn),
        toNumber(row.nbvBase),
        `FA48 seeded depreciation ${period.periodKey}`,
        userId,
      ]
    );
    const transactionId = Number(txResult.rows?.insertId || 0);
    assert(transactionId > 0, `Failed to insert depreciation transaction for ${period.periodKey}`);
    const scheduleResult = await query(
      `INSERT INTO fixed_asset_depreciation_schedule_lines (
          tenant_id,
          legal_entity_id,
          asset_id,
          period_key,
          line_no,
          planned_amount_txn,
          planned_amount_base,
          opening_nbv_txn,
          opening_nbv_base,
          closing_nbv_txn,
          closing_nbv_base,
          status,
          posted_run_line_id,
          posted_transaction_id
       ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', NULL, ?
       )`,
      [
        tenantId,
        legalEntityId,
        asset.id,
        period.periodKey,
        Number(row.lineNo || 0),
        toNumber(row.depreciationAmountTxn),
        toNumber(row.depreciationAmountBase),
        toNumber(row.openingNbvTxn),
        toNumber(row.openingNbvBase),
        toNumber(row.nbvTxn),
        toNumber(row.nbvBase),
        transactionId,
      ]
    );
    const scheduleLineId = Number(scheduleResult.rows?.insertId || 0);
    assert(scheduleLineId > 0, `Failed to insert schedule line for ${period.periodKey}`);
    const runLineResult = await query(
      `INSERT INTO fixed_asset_depreciation_run_lines (
          tenant_id,
          legal_entity_id,
          run_id,
          asset_id,
          fiscal_period_id,
          period_key,
          schedule_line_id,
          eligible_days,
          days_in_period,
          planned_amount_txn,
          planned_amount_base,
          status,
          posted_transaction_id,
          skip_reason_code,
          skip_reason_text,
          error_code,
          error_message
       ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, NULL, NULL, NULL, NULL
       )`,
      [
        tenantId,
        legalEntityId,
        runId,
        asset.id,
        period.id,
        period.periodKey,
        scheduleLineId,
        Number(row.eligibleDays || 0),
        Number(row.daysInPeriod || 0),
        toNumber(row.depreciationAmountTxn),
        toNumber(row.depreciationAmountBase),
        transactionId,
      ]
    );
    const runLineId = Number(runLineResult.rows?.insertId || 0);
    assert(runLineId > 0, `Failed to insert run line for ${period.periodKey}`);
    await query(
      `UPDATE fixed_asset_depreciation_schedule_lines
          SET posted_run_line_id = ?
        WHERE tenant_id = ?
          AND id = ?`,
      [runLineId, tenantId, scheduleLineId]
    );
    for (const allocation of row.allocationSegments || []) {
      await query(
        `INSERT INTO fixed_asset_depreciation_run_line_allocations (
            tenant_id,
            legal_entity_id,
            run_line_id,
            asset_id,
            fiscal_period_id,
            period_key,
            allocation_type,
            operating_unit_id,
            from_date,
            to_date,
            eligible_days,
            planned_amount_txn,
            planned_amount_base
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          runLineId,
          asset.id,
          period.id,
          period.periodKey,
          allocation.allocationType,
          Number(allocation.operatingUnitId || 0),
          allocation.fromDate,
          allocation.toDate,
          Number(allocation.eligibleDays || 0),
          toNumber(allocation.plannedAmountTxn),
          toNumber(allocation.plannedAmountBase),
        ]
      );
    }
    latestClosingNbvBase = toNumber(row.nbvBase);
    latestClosingNbvTxn = toNumber(row.nbvTxn);
    seeded.push({
      periodKey: period.periodKey,
      runId,
      runLineId,
      transactionId,
      scheduleLineId,
    });
  }
  await query(
    `UPDATE fixed_assets
        SET last_depreciation_period = ?,
            remaining_useful_life_months = ?,
            status = CASE
              WHEN ? <= COALESCE(salvage_value_base, 0) THEN 'FULLY_DEPRECIATED'
              ELSE 'ACTIVE'
            END,
            updated_by_user_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [
      periods.at(-1)?.periodKey || null,
      Math.max(Number(asset.usefulLifeMonths || 0) - periods.length, 0),
      latestClosingNbvBase,
      userId,
      tenantId,
      asset.id,
    ]
  );
  return {
    seeded,
    latestClosingNbvBase,
    latestClosingNbvTxn,
  };
}
async function previewRetroCorrection(cookie, assetId, body, expectedStatus = 200) {
  return apiRequest({
    cookie,
    method: "POST",
    pathName: `/api/v1/fixed-assets/${assetId}/retro-ownership-transfer-correction/preview`,
    body,
    expectedStatus,
  });
}
async function postRetroCorrection(cookie, assetId, body, expectedStatus = 200) {
  return apiRequest({
    cookie,
    method: "POST",
    pathName: `/api/v1/fixed-assets/${assetId}/retro-ownership-transfer-correction`,
    body,
    expectedStatus,
  });
}
async function loadLatestTransactionId(tenantId, assetId) {
  const result = await query(
    `SELECT id
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
        AND status = 'POSTED'
      ORDER BY effective_date DESC, id DESC
      LIMIT 1`,
    [tenantId, assetId]
  );
  return Number(result.rows?.[0]?.id || 0);
}
async function loadJournalOuBalances(journalEntryId) {
  const result = await query(
    `SELECT
        operating_unit_id,
        SUM(debit_base) AS total_debit_base,
        SUM(credit_base) AS total_credit_base
      FROM journal_lines
     WHERE journal_entry_id = ?
     GROUP BY operating_unit_id
     ORDER BY operating_unit_id ASC`,
    [journalEntryId]
  );
  return (result.rows || []).map((row) => ({
    operatingUnitId: Number(row.operating_unit_id || 0),
    totalDebitBase: toNumber(row.total_debit_base),
    totalCreditBase: toNumber(row.total_credit_base),
  }));
}
async function loadRetroCorrectionPersistence(correctionId) {
  const headerResult = await query(
    `SELECT *
       FROM fixed_asset_retro_transfer_corrections
      WHERE id = ?
      LIMIT 1`,
    [correctionId]
  );
  const periodResult = await query(
    `SELECT *
       FROM fixed_asset_retro_transfer_correction_periods
      WHERE correction_id = ?
      ORDER BY period_key ASC, id ASC`,
    [correctionId]
  );
  return {
    header: headerResult.rows?.[0] || null,
    periods: periodResult.rows || [],
  };
}
async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const stamp = `${Date.now()}`;
  const smokeContext = await resolveOrPrepareSmokeContext({ prefix: "FA48" });
  const tenantId = Number(smokeContext.tenantId);
  const legalEntityId = Number(smokeContext.legalEntityId);
  const book = await resolveBookContext(tenantId, legalEntityId);
  const periods = await resolvePeriodTriplet(book.calendarId, today);
  const accounts = await resolveAccountFixtures(tenantId, legalEntityId);
  const ouCId = await resolveOuCId({
    tenantId,
    legalEntityId,
    sourceOuId: smokeContext.sourceOuId,
    targetOuId: smokeContext.targetOuId,
  });
  const smokeUser = await createSmokeUser({
    tenantId,
    uniqueSuffix: stamp,
  });
  const profile = await createSmokeProfile({
    tenantId,
    legalEntityId,
    uniqueSuffix: stamp,
    userId: smokeUser.userId,
  });
  const category = await createSmokeCategory({
    tenantId,
    legalEntityId,
    profileId: profile.profileId,
    accounts,
    uniqueSuffix: stamp,
    userId: smokeUser.userId,
  });
  const server = await ensureApiServer();
  let serverChild = server.child;
  try {
    const cookie = await login(smokeUser.email, smokeUser.password);
    console.log("[fa48-smoke] CASE 1: preview success with one impacted month");
    const oneMonthAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId: smokeUser.userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.current.startDate,
      uniqueSuffix: `ONE-${stamp}`,
      originalCostBase: 1200,
    });
    const oneMonthSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: oneMonthAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: oneMonthAsset,
      bookId: book.bookId,
      periods: [periods.current],
      scheduleRows: oneMonthSchedule.rows || [],
      userId: smokeUser.userId,
    });
    const oneMonthPreviewBody = {
      actualEffectiveDate: dateWithinPeriod(periods.current, 14),
      correctionPostingDate: periods.current.endDate,
      targetOwnerOperatingUnitId: smokeContext.targetOuId,
      note: "FA48 one-month preview success",
    };
    const oneMonthPreview = await previewRetroCorrection(
      cookie,
      oneMonthAsset.id,
      oneMonthPreviewBody,
      200
    );
    assert(
      oneMonthPreview.payload?.resolutionMode === "CURRENT_PERIOD_TRUE_UP_REQUIRED",
      `Expected one-month preview resolutionMode CURRENT_PERIOD_TRUE_UP_REQUIRED, got ${oneMonthPreview.payload?.resolutionMode || "NULL"}`
    );
    assert(
      Number(oneMonthPreview.payload?.impactedPostedPeriodCount || 0) === 1,
      `Expected one impacted period, got ${oneMonthPreview.payload?.impactedPostedPeriodCount || 0}`
    );
    assert(
      Array.isArray(oneMonthPreview.payload?.impactedPostedPeriods)
      && oneMonthPreview.payload.impactedPostedPeriods.length === 1,
      "One-month preview did not return exactly one impacted period row"
    );
    assert(
      String(oneMonthPreview.payload?.previewFingerprint || "").length > 0,
      "One-month preview fingerprint is missing"
    );
    console.log("[fa48-smoke] CASE 2: preview success with multiple impacted months");
    const multiMonthAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId: smokeUser.userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.secondPrior.startDate,
      uniqueSuffix: `MULTI-${stamp}`,
      originalCostBase: 1200,
    });
    const multiMonthSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: multiMonthAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: multiMonthAsset,
      bookId: book.bookId,
      periods: [periods.secondPrior, periods.current],
      scheduleRows: multiMonthSchedule.rows || [],
      userId: smokeUser.userId,
    });
    const multiMonthPreview = await previewRetroCorrection(
      cookie,
      multiMonthAsset.id,
      {
        actualEffectiveDate: dateWithinPeriod(periods.secondPrior, 14),
        correctionPostingDate: periods.current.endDate,
        targetOwnerOperatingUnitId: smokeContext.targetOuId,
        note: "FA48 multi-month preview success",
      },
      200
    );
    assert(
      multiMonthPreview.payload?.resolutionMode === "CURRENT_PERIOD_TRUE_UP_REQUIRED",
      `Expected multi-month preview resolutionMode CURRENT_PERIOD_TRUE_UP_REQUIRED, got ${multiMonthPreview.payload?.resolutionMode || "NULL"}`
    );
    assert(
      Number(multiMonthPreview.payload?.impactedPostedPeriodCount || 0) === 2,
      `Expected two impacted periods, got ${multiMonthPreview.payload?.impactedPostedPeriodCount || 0}`
    );
    console.log("[fa48-smoke] CASE 3: preview blocker when posted owner allocations contain a third OU");
    const thirdOuAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId: smokeUser.userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.current.startDate,
      uniqueSuffix: `3OU-${stamp}`,
      originalCostBase: 1200,
    });
    const thirdOuSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: thirdOuAsset.id,
    });
    const thirdOuSeed = await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: thirdOuAsset,
      bookId: book.bookId,
      periods: [periods.current],
      scheduleRows: thirdOuSchedule.rows || [],
      userId: smokeUser.userId,
    });
    await query(
      `UPDATE fixed_asset_depreciation_run_line_allocations
          SET operating_unit_id = ?
        WHERE run_line_id = ?
          AND allocation_type = 'OWNER_OU'
        LIMIT 1`,
      [ouCId, thirdOuSeed.seeded[0].runLineId]
    );
    const thirdOuPreview = await previewRetroCorrection(
      cookie,
      thirdOuAsset.id,
      {
        actualEffectiveDate: dateWithinPeriod(periods.current, 14),
        correctionPostingDate: periods.current.endDate,
        targetOwnerOperatingUnitId: smokeContext.targetOuId,
        note: "FA48 third OU blocker",
      },
      409
    );
    assert(
      thirdOuPreview.payload?.reasonCode === "UNSUPPORTED_OWNER_ALLOCATION_OPERATING_UNIT",
      `Expected third-OU blocker reason UNSUPPORTED_OWNER_ALLOCATION_OPERATING_UNIT, got ${thirdOuPreview.payload?.reasonCode || "NULL"}`
    );
    console.log("[fa48-smoke] CASE 4: preview blocker when a later owner-changing event exists");
    const laterOwnerAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId: smokeUser.userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.current.startDate,
      uniqueSuffix: `LATE-${stamp}`,
      originalCostBase: 1200,
    });
    const transferEffectiveDate = dateWithinPeriod(periods.current, 21);
    await ownershipTransferAsset({
      tenantId,
      assetId: laterOwnerAsset.id,
      effectiveDate: transferEffectiveDate,
      postingDate: transferEffectiveDate,
      targetOwnerOperatingUnitId: smokeContext.targetOuId,
      targetLocationOperatingUnitId: smokeContext.targetOuId,
      note: "FA48 later owner event setup",
      userId: smokeUser.userId,
    });
    const laterOwnerPreview = await previewRetroCorrection(
      cookie,
      laterOwnerAsset.id,
      {
        actualEffectiveDate: dateWithinPeriod(periods.current, 7),
        correctionPostingDate: periods.current.endDate,
        targetOwnerOperatingUnitId: smokeContext.targetOuId,
        note: "FA48 later owner blocker",
      },
      409
    );
    assert(
      laterOwnerPreview.payload?.reasonCode === "LATER_OWNER_CHANGING_EVENT_EXISTS",
      `Expected later-owner blocker reason LATER_OWNER_CHANGING_EVENT_EXISTS, got ${laterOwnerPreview.payload?.reasonCode || "NULL"}`
    );
    console.log("[fa48-smoke] CASE 5: post success persists correction header/detail and balanced journals");
    const postSuccess = await postRetroCorrection(
      cookie,
      oneMonthAsset.id,
      {
        ...oneMonthPreviewBody,
        previewFingerprint: oneMonthPreview.payload.previewFingerprint,
        resolutionMode: oneMonthPreview.payload.resolutionMode,
      },
      200
    );
    assert(
      postSuccess.payload?.posted === true,
      `Expected retro correction post success payload, got ${JSON.stringify(postSuccess.payload)}`
    );
    const correctionId = Number(postSuccess.payload?.retroCorrectionId || 0);
    assert(correctionId > 0, "Post success did not return retroCorrectionId");
    const persistence = await loadRetroCorrectionPersistence(correctionId);
    assert(persistence.header, `Retro correction header ${correctionId} not found`);
    assert(
      Number(persistence.header.true_up_transaction_id || 0) > 0
      && Number(persistence.header.owner_move_transaction_id || 0) > 0,
      "Retro correction header is missing posted transaction links"
    );
    assert(
      Number(persistence.header.true_up_journal_entry_id || 0) > 0
      && Number(persistence.header.owner_move_journal_entry_id || 0) > 0,
      "Retro correction header is missing journal entry links"
    );
    assert(
      persistence.periods.length === 1,
      `Expected one persisted correction period row, found ${persistence.periods.length}`
    );
    const correctedAsset = await getAssetDetail({
      tenantId,
      assetId: oneMonthAsset.id,
    });
    assert(
      Number(correctedAsset.ownerOperatingUnitId || 0) === Number(smokeContext.targetOuId),
      `Expected corrected asset owner OU to be ${smokeContext.targetOuId}, got ${correctedAsset.ownerOperatingUnitId || "NULL"}`
    );
    const trueUpBalances = await loadJournalOuBalances(
      Number(persistence.header.true_up_journal_entry_id)
    );
    const ownerMoveBalances = await loadJournalOuBalances(
      Number(persistence.header.owner_move_journal_entry_id)
    );
    for (const balance of trueUpBalances) {
      assert(
        amountsEqual(balance.totalDebitBase, balance.totalCreditBase),
        `True-up journal is not balanced within OU ${balance.operatingUnitId}: debit=${balance.totalDebitBase}, credit=${balance.totalCreditBase}`
      );
    }
    for (const balance of ownerMoveBalances) {
      assert(
        amountsEqual(balance.totalDebitBase, balance.totalCreditBase),
        `Owner-move journal is not balanced within OU ${balance.operatingUnitId}: debit=${balance.totalDebitBase}, credit=${balance.totalCreditBase}`
      );
    }
    console.log("[fa48-smoke] CASE 6: post blocker returns 409 STALE_PREVIEW after history changes");
    const staleAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId: smokeUser.userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.current.startDate,
      uniqueSuffix: `STALE-${stamp}`,
      originalCostBase: 1200,
    });
    const staleSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: staleAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: staleAsset,
      bookId: book.bookId,
      periods: [periods.current],
      scheduleRows: staleSchedule.rows || [],
      userId: smokeUser.userId,
    });
    const stalePreviewBody = {
      actualEffectiveDate: dateWithinPeriod(periods.current, 14),
      correctionPostingDate: periods.current.endDate,
      targetOwnerOperatingUnitId: smokeContext.targetOuId,
      note: "FA48 stale preview setup",
    };
    const stalePreview = await previewRetroCorrection(
      cookie,
      staleAsset.id,
      stalePreviewBody,
      200
    );
    await physicalMoveAsset({
      tenantId,
      assetId: staleAsset.id,
      effectiveDate: periods.current.endDate,
      postingDate: periods.current.endDate,
      locationOperatingUnitId: smokeContext.targetOuId,
      note: "FA48 stale preview physical move",
      userId: smokeUser.userId,
    });
    const stalePost = await postRetroCorrection(
      cookie,
      staleAsset.id,
      {
        ...stalePreviewBody,
        previewFingerprint: stalePreview.payload.previewFingerprint,
        resolutionMode: stalePreview.payload.resolutionMode,
      },
      409
    );
    assert(
      stalePost.payload?.reasonCode === "STALE_PREVIEW",
      `Expected stale preview reason STALE_PREVIEW, got ${stalePost.payload?.reasonCode || "NULL"}`
    );
    console.log("[fa48-smoke] CASE 7: post blocker returns negative corrected source carrying value");
    const negativeAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId: smokeUser.userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.current.startDate,
      uniqueSuffix: `NEG-${stamp}`,
      originalCostBase: 1200,
    });
    const negativeSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: negativeAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: negativeAsset,
      bookId: book.bookId,
      periods: [periods.current],
      scheduleRows: negativeSchedule.rows || [],
      userId: smokeUser.userId,
    });
    const negativeBody = {
      actualEffectiveDate: dateWithinPeriod(periods.current, 14),
      correctionPostingDate: periods.current.endDate,
      targetOwnerOperatingUnitId: smokeContext.targetOuId,
      note: "FA48 negative carrying blocker",
    };
    const negativePreview = await previewRetroCorrection(
      cookie,
      negativeAsset.id,
      negativeBody,
      200
    );
    const latestTransactionId = await loadLatestTransactionId(tenantId, negativeAsset.id);
    assert(latestTransactionId > 0, "Could not resolve latest transaction for negative-carrying test");
    const forcedNegativeNbv = -Math.abs(
      toNumber(negativePreview.payload?.cumulativeDelta?.amountBase || 0) + 10
    );
    await query(
      `UPDATE fixed_asset_transactions
          SET nbv_amount_txn = ?,
              nbv_amount_base = ?
        WHERE id = ?`,
      [forcedNegativeNbv, forcedNegativeNbv, latestTransactionId]
    );
    const negativePost = await postRetroCorrection(
      cookie,
      negativeAsset.id,
      {
        ...negativeBody,
        previewFingerprint: negativePreview.payload.previewFingerprint,
        resolutionMode: negativePreview.payload.resolutionMode,
      },
      409
    );
    assert(
      negativePost.payload?.reasonCode === "NEGATIVE_CORRECTED_SOURCE_CARRYING_VALUE",
      `Expected negative carrying blocker reason NEGATIVE_CORRECTED_SOURCE_CARRYING_VALUE, got ${negativePost.payload?.reasonCode || "NULL"}`
    );
    console.log("[fa48-smoke] Focused retro correction verification passed.");
    console.log(JSON.stringify({
      keepArtifacts: KEEP_ARTIFACTS,
      tenantId,
      legalEntityId,
      oneMonthAssetId: oneMonthAsset.id,
      multiMonthAssetId: multiMonthAsset.id,
      thirdOuAssetId: thirdOuAsset.id,
      laterOwnerAssetId: laterOwnerAsset.id,
      staleAssetId: staleAsset.id,
      negativeAssetId: negativeAsset.id,
      correctionId,
    }, null, 2));
  } finally {
    await stopServer(serverChild);
    await closePool();
  }
}
run().catch(async (error) => {
  console.error("[fa48-smoke] FAILED");
  console.error(error);
  try {
    await closePool();
  } catch {}
  process.exit(1);
});
