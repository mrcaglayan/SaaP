import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { assignTestFullAccessRoleToUser } from "./ex05-test-helpers.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  activateAsset,
  createAssetDraft,
  getAssetDetail,
  postRetroOwnershipTransferCorrection,
  previewRetroOwnershipTransferCorrection,
  reverseFixedAssetTransaction,
} from "../src/services/fixed-assets.service.js";
import { getAssetDepreciationSchedule } from "../src/services/fixed-assets.depreciation.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function assignFullAccessRoleToUser(tenantId, userId) {
  await assignTestFullAccessRoleToUser(tenantId, userId);
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const password = "FA49Smoke#12345";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `fa49.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, `FA49 Smoke ${uniqueSuffix}`]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create FA49 smoke user");
  await assignFullAccessRoleToUser(tenantId, userId);
  return { userId };
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
  assert(row, `LOCAL book not found for tenant ${tenantId}, legal entity ${legalEntityId}`);
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
  assert(currentIndex >= 0, `Could not resolve fiscal period for ${today}`);
  return {
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

async function createSmokeProfile({
  tenantId,
  legalEntityId,
  uniqueSuffix,
  userId,
}) {
  const code = `FA49PF${uniqueSuffix.slice(-6)}`;
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
      `FA49 Retro Replacement ${uniqueSuffix}`,
      "Replacement-focused smoke profile for retro ownership correction",
      userId,
      userId,
    ]
  );
  const profileId = Number(result.rows?.insertId || 0);
  assert(profileId > 0, "Failed to create FA49 smoke depreciation profile");
  return { profileId };
}

async function createSmokeCategory({
  tenantId,
  legalEntityId,
  profileId,
  accounts,
  uniqueSuffix,
  userId,
}) {
  const code = `FA49CT${uniqueSuffix.slice(-6)}`;
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
      `FA49 Retro Category ${uniqueSuffix}`,
      "Replacement-focused smoke category for retro ownership correction",
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
  assert(categoryId > 0, "Failed to create FA49 smoke category");
  return { categoryId };
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
    name: `FA49 ${uniqueSuffix}`,
    categoryId,
    acquisitionDate,
    currencyCode,
    description: "Replacement-focused smoke asset for retro ownership correction",
    assetTag: `FA49-${uniqueSuffix}`.slice(0, 40),
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
  assert(assetId > 0, "Failed to create FA49 smoke asset");
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
  period,
  scheduleRows,
  userId,
}) {
  const row = requireScheduleRow(
    { rows: scheduleRows },
    period.periodKey,
    "FA49 seeded depreciation history"
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
      `FA49 seeded depreciation ${period.periodKey}`,
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
      period.periodKey,
      Math.max(Number(asset.usefulLifeMonths || 0) - 1, 0),
      toNumber(row.nbvBase),
      userId,
      tenantId,
      asset.id,
    ]
  );
}

async function loadCorrectionRows(tenantId, assetId) {
  const result = await query(
    `SELECT id,
            status,
            replaces_correction_id,
            replaced_by_correction_id,
            true_up_transaction_id,
            owner_move_transaction_id
       FROM fixed_asset_retro_transfer_corrections
      WHERE tenant_id = ?
        AND asset_id = ?
      ORDER BY id ASC`,
    [tenantId, assetId]
  );
  return result.rows || [];
}

async function loadAssetTransactions(tenantId, assetId) {
  const result = await query(
    `SELECT id,
            transaction_type,
            status,
            source_ref_type,
            source_ref_id,
            reversed_transaction_id,
            reversal_transaction_id
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
      ORDER BY id ASC`,
    [tenantId, assetId]
  );
  return result.rows || [];
}

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const stamp = `${Date.now()}`;
  const smokeContext = await resolveOrPrepareSmokeContext({ prefix: "FA49" });
  const tenantId = Number(smokeContext.tenantId);
  const legalEntityId = Number(smokeContext.legalEntityId);
  const smokeUser = await createSmokeUser({
    tenantId,
    uniqueSuffix: stamp,
  });
  const book = await resolveBookContext(tenantId, legalEntityId);
  const periods = await resolvePeriodTriplet(book.calendarId, today);
  const accounts = await resolveAccountFixtures(tenantId, legalEntityId);
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

  console.log("[fa49-smoke] CASE 1: create initial posted retro correction");
  const asset = await createActivatedSmokeAsset({
    tenantId,
    legalEntityId,
    userId: smokeUser.userId,
    categoryId: category.categoryId,
    ownerOperatingUnitId: smokeContext.sourceOuId,
    locationOperatingUnitId: smokeContext.sourceOuId,
    currencyCode: book.currencyCode,
    acquisitionDate: periods.current.startDate,
    uniqueSuffix: `REP-${stamp}`,
    originalCostBase: 1200,
  });
  const schedule = await getAssetDepreciationSchedule({
    tenantId,
    assetId: asset.id,
  });
  await seedPostedDepreciationHistory({
    tenantId,
    legalEntityId,
    asset,
    bookId: book.bookId,
    period: periods.current,
    scheduleRows: schedule.rows || [],
    userId: smokeUser.userId,
  });

  const initialPreview = await previewRetroOwnershipTransferCorrection({
    tenantId,
    assetId: asset.id,
    actualEffectiveDate: dateWithinPeriod(periods.current, 14),
    correctionPostingDate: periods.current.endDate,
    targetOwnerOperatingUnitId: smokeContext.targetOuId,
    note: "FA49 initial correction",
    userId: smokeUser.userId,
  });
  assert(
    initialPreview.resolutionMode === "CURRENT_PERIOD_TRUE_UP_REQUIRED",
    `Expected initial preview CURRENT_PERIOD_TRUE_UP_REQUIRED, got ${initialPreview.resolutionMode || "NULL"}`
  );
  const initialPost = await postRetroOwnershipTransferCorrection({
    tenantId,
    assetId: asset.id,
    actualEffectiveDate: dateWithinPeriod(periods.current, 14),
    correctionPostingDate: periods.current.endDate,
    targetOwnerOperatingUnitId: smokeContext.targetOuId,
    previewFingerprint: initialPreview.previewFingerprint,
    resolutionMode: initialPreview.resolutionMode,
    note: "FA49 initial correction",
    userId: smokeUser.userId,
  });
  assert(initialPost.posted === true, "Initial retro correction did not post");

  console.log("[fa49-smoke] CASE 2: overlapping preview routes into supported replacement flow");
  const replacementPreview = await previewRetroOwnershipTransferCorrection({
    tenantId,
    assetId: asset.id,
    actualEffectiveDate: dateWithinPeriod(periods.current, 9),
    correctionPostingDate: periods.current.endDate,
    targetOwnerOperatingUnitId: smokeContext.targetOuId,
    note: "FA49 replacement preview",
    userId: smokeUser.userId,
  });
  assert(
    replacementPreview.resolutionMode === "CURRENT_PERIOD_TRUE_UP_REQUIRED",
    `Expected replacement preview CURRENT_PERIOD_TRUE_UP_REQUIRED, got ${replacementPreview.resolutionMode || "NULL"}`
  );
  assert(
    replacementPreview.replacementRequired === true,
    "Replacement preview did not mark replacementRequired"
  );
  assert(
    replacementPreview.replacementSupported === true,
    "Replacement preview did not mark replacementSupported"
  );
  assert(
    Number(replacementPreview.replacesCorrectionId || 0) === Number(initialPost.retroCorrectionId || 0),
    `Expected replacement preview to replace correction ${initialPost.retroCorrectionId}, got ${replacementPreview.replacesCorrectionId || "NULL"}`
  );
  assert(
    Number(replacementPreview.fromOwnerOperatingUnitId || 0) === Number(smokeContext.sourceOuId),
    `Expected replacement preview fromOwnerOperatingUnitId ${smokeContext.sourceOuId}, got ${replacementPreview.fromOwnerOperatingUnitId || "NULL"}`
  );

  console.log("[fa49-smoke] CASE 3: replacement post supersedes prior correction and posts fresh journals");
  const replacementPost = await postRetroOwnershipTransferCorrection({
    tenantId,
    assetId: asset.id,
    actualEffectiveDate: dateWithinPeriod(periods.current, 9),
    correctionPostingDate: periods.current.endDate,
    targetOwnerOperatingUnitId: smokeContext.targetOuId,
    previewFingerprint: replacementPreview.previewFingerprint,
    resolutionMode: replacementPreview.resolutionMode,
    note: "FA49 replacement post",
    userId: smokeUser.userId,
  });
  assert(replacementPost.posted === true, "Replacement post did not succeed");
  assert(replacementPost.replacementApplied === true, "Replacement post did not report replacementApplied");
  assert(
    Number(replacementPost.replacesCorrectionId || 0) === Number(initialPost.retroCorrectionId || 0),
    `Expected replacement post to reference correction ${initialPost.retroCorrectionId}, got ${replacementPost.replacesCorrectionId || "NULL"}`
  );
  assert(
    replacementPost.replacementReversal
      && Number(replacementPost.replacementReversal.trueUpReversalTransactionId || 0) > 0
      && Number(replacementPost.replacementReversal.ownerMoveReversalTransactionId || 0) > 0,
    "Replacement post is missing reversal lineage for the superseded correction"
  );

  const correctionRows = await loadCorrectionRows(tenantId, asset.id);
  assert(correctionRows.length === 2, `Expected two correction rows, found ${correctionRows.length}`);
  assert(
    String(correctionRows[0].status || "").toUpperCase() === "SUPERSEDED",
    `Expected first correction to be SUPERSEDED, got ${correctionRows[0].status || "NULL"}`
  );
  assert(
    Number(correctionRows[0].replaced_by_correction_id || 0) === Number(replacementPost.retroCorrectionId || 0),
    "Superseded correction is missing replaced_by_correction_id linkage"
  );
  assert(
    String(correctionRows[1].status || "").toUpperCase() === "POSTED",
    `Expected replacement correction to remain POSTED, got ${correctionRows[1].status || "NULL"}`
  );
  assert(
    Number(correctionRows[1].replaces_correction_id || 0) === Number(initialPost.retroCorrectionId || 0),
    "Replacement correction is missing replaces_correction_id linkage"
  );

  const transactions = await loadAssetTransactions(tenantId, asset.id);
  const initialTrueUp = transactions.find((row) => Number(row.id || 0) === Number(initialPost.trueUpTransactionId || 0)) || null;
  const initialOwnerMove = transactions.find((row) => Number(row.id || 0) === Number(initialPost.ownerMoveTransactionId || 0)) || null;
  assert(initialTrueUp && String(initialTrueUp.status || "").toUpperCase() === "REVERSED", "Initial true-up transaction was not reversed");
  assert(initialOwnerMove && String(initialOwnerMove.status || "").toUpperCase() === "REVERSED", "Initial owner-move transaction was not reversed");
  assert(Number(initialTrueUp.reversal_transaction_id || 0) > 0, "Initial true-up is missing reversal transaction linkage");
  assert(Number(initialOwnerMove.reversal_transaction_id || 0) > 0, "Initial owner-move is missing reversal transaction linkage");

  const activePostedCorrections = correctionRows.filter((row) => String(row.status || "").toUpperCase() === "POSTED");
  assert(activePostedCorrections.length === 1, `Expected exactly one active POSTED correction, found ${activePostedCorrections.length}`);

  console.log("[fa49-smoke] CASE 4: generic reversal rejects RETRO_OWNERSHIP_CORRECTION transactions explicitly");
  let reversalError = null;
  try {
    await reverseFixedAssetTransaction({
      tenantId,
      transactionId: replacementPost.trueUpTransactionId,
      note: "FA49 forbidden generic reversal",
      userId: smokeUser.userId,
    });
  } catch (error) {
    reversalError = error;
  }
  assert(reversalError, "Expected generic reversal of RETRO_OWNERSHIP_CORRECTION to fail");
  assert(
    Number(reversalError.status || 0) === 400,
    `Expected generic reversal failure status 400, got ${reversalError.status || "NULL"}`
  );
  assert(
    String(reversalError.code || "") === "RETRO_CORRECTION_NOT_INDIVIDUALLY_REVERSIBLE",
    `Expected reversal error code RETRO_CORRECTION_NOT_INDIVIDUALLY_REVERSIBLE, got ${reversalError.code || "NULL"}`
  );

  console.log("[fa49-smoke] Retro correction replacement verification passed.");
  console.log(JSON.stringify({
    tenantId,
    legalEntityId,
    assetId: asset.id,
    initialCorrectionId: initialPost.retroCorrectionId,
    replacementCorrectionId: replacementPost.retroCorrectionId,
    initialTrueUpTransactionId: initialPost.trueUpTransactionId,
    initialOwnerMoveTransactionId: initialPost.ownerMoveTransactionId,
    replacementTrueUpTransactionId: replacementPost.trueUpTransactionId,
    replacementOwnerMoveTransactionId: replacementPost.ownerMoveTransactionId,
  }, null, 2));
  await closePool();
}

run().catch(async (error) => {
  console.error("[fa49-smoke] FAILED");
  console.error(error);
  try {
    await closePool();
  } catch {}
  process.exit(1);
});
