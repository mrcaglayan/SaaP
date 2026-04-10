import { closePool, query } from "../src/db.js";
import { assignTestFullAccessRoleToUser } from "./ex05-test-helpers.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  activateAsset,
  createAssetDraft,
  getAssetDetail,
  ownershipTransferAsset,
  physicalMoveAsset,
  reactivateAsset,
  suspendAsset,
  writeoffAsset,
} from "../src/services/fixed-assets.service.js";
import {
  getAssetDepreciationSchedule,
  previewDepreciationRun,
} from "../src/services/fixed-assets.depreciation.service.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
} from "../src/services/cari.document.service.js";

const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA47_SMOKE_KEEP_ARTIFACTS,
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

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
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

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "fa47-lifecycle-blocker-disposal-preview-smoke",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function allowAllScopes() {}

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
        AND a.code IN ('150000', '257000', '770000', '632000', '600000', '320000')
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
  assert(byCode.get("320000"), "Smoke AP control account not found");
  return {
    assetAccountId: byCode.get("150000"),
    accumDeprAccountId: byCode.get("257000"),
    deprExpenseAccountId: byCode.get("770000"),
    disposalLossAccountId: byCode.get("632000"),
    disposalGainAccountId: byCode.get("600000"),
    apControlAccountId: byCode.get("320000"),
  };
}

async function createSmokeUser({ tenantId, uniqueSuffix }) {
  const email = `fa47.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      email,
      "not-used-in-direct-service-smoke",
      `FA47 Smoke ${uniqueSuffix}`,
    ]
  );
  const userId = Number(insertResult.rows?.insertId || 0);
  assert(userId > 0, "Failed to create smoke user");
  await assignTestFullAccessRoleToUser(tenantId, userId);

  return userId;
}

async function createSmokeProfile({
  tenantId,
  legalEntityId,
  uniqueSuffix,
  userId,
}) {
  const code = `FA47PF${uniqueSuffix.slice(-6)}`;
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
      `FA47 Lifecycle Smoke ${uniqueSuffix}`,
      "Smoke profile for lifecycle blocker and disposal preview coverage",
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
  const code = `FA47CT${uniqueSuffix.slice(-6)}`;
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
      `FA47 Smoke Category ${uniqueSuffix}`,
      "Smoke category for lifecycle blocker and disposal preview coverage",
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

async function createVendorCounterparty({
  tenantId,
  legalEntityId,
  operatingUnitId,
  currencyCode,
  apAccountId,
  uniqueSuffix,
}) {
  const result = await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        primary_operating_unit_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        ar_account_id,
        ap_account_id,
        status,
        notes
     ) VALUES (
        ?, ?, ?, ?, ?, 0, 1, ?, NULL, ?, 'ACTIVE', ?
     )`,
    [
      tenantId,
      legalEntityId,
      operatingUnitId,
      `FA47VND${uniqueSuffix.slice(-8)}`,
      `FA47 Smoke Vendor ${uniqueSuffix.slice(-8)}`,
      currencyCode,
      apAccountId,
      "Vendor for lifecycle blocker smoke coverage",
    ]
  );
  const counterpartyId = Number(result.rows?.insertId || 0);
  assert(counterpartyId > 0, "Failed to create smoke vendor");
  return counterpartyId;
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
    name: `FA47 ${uniqueSuffix}`,
    categoryId,
    acquisitionDate,
    currencyCode,
    description: "Smoke asset for lifecycle blocker and disposal preview coverage",
    assetTag: `FA47-${uniqueSuffix}`.slice(0, 40),
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

async function insertPostedRunHeader({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  periodKey,
  postingDate,
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
      amountBase,
      amountBase,
      amountBase,
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
  for (const period of periods) {
    const row = scheduleRows.find((candidate) => candidate.periodKey === period.periodKey);
    assert(row, `Missing schedule row for seeded period ${period.periodKey}`);

    const runId = await insertPostedRunHeader({
      tenantId,
      legalEntityId,
      bookId,
      fiscalPeriodId: period.id,
      periodKey: period.periodKey,
      postingDate: period.endDate,
      amountBase: row.depreciationAmountBase,
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
        `FA47 seeded posted depreciation ${period.periodKey}`,
        userId,
      ]
    );
    const transactionId = Number(txResult.rows?.insertId || 0);
    assert(
      transactionId > 0,
      `Failed to insert seeded depreciation transaction for ${period.periodKey}`
    );

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
    assert(scheduleLineId > 0, `Failed to insert seeded schedule line for ${period.periodKey}`);

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
    assert(runLineId > 0, `Failed to insert seeded run line for ${period.periodKey}`);

    await query(
      `UPDATE fixed_asset_depreciation_schedule_lines
          SET posted_run_line_id = ?
        WHERE tenant_id = ?
          AND id = ?`,
      [runLineId, tenantId, scheduleLineId]
    );

    latestClosingNbvBase = toNumber(row.nbvBase);
  }

  const nextRemainingUsefulLifeMonths = Math.max(
    Number(asset.usefulLifeMonths || 0) - periods.length,
    0
  );
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
      nextRemainingUsefulLifeMonths,
      latestClosingNbvBase,
      userId,
      tenantId,
      asset.id,
    ]
  );
}

async function postImprovementDocument({
  tenantId,
  legalEntityId,
  userId,
  counterpartyId,
  currencyCode,
  documentDate,
  dueDate,
  assetId,
  effectiveDate,
  amountBase,
  stamp,
  suffix,
}) {
  const draft = await createCariDraftDocument({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: `${suffix}-draft` }),
    payload: {
      tenantId,
      userId,
      legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate,
      dueDate,
      currencyCode,
      lines: [
        {
          description: `FA47 ${suffix}`,
          subledgerType: "FIXED_ASSET",
          fixedAssetMode: "IMPROVE_EXISTING",
          targetFixedAssetId: assetId,
          improvementEffectiveDate: effectiveDate,
          quantity: 1,
          lineNetAmountTxn: amountBase,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: amountBase,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });

  return postCariDocumentById({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: `${suffix}-post` }),
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
}

function requireScheduleRow(schedule, periodKey, label) {
  const row = (schedule?.rows || []).find((candidate) => candidate.periodKey === periodKey) || null;
  assert(row, `${label}: missing schedule row for ${periodKey}`);
  return row;
}

function requirePreviewRow(previewRows, assetId, periodKey, label) {
  const row = (previewRows || []).find((candidate) => (
    Number(candidate.assetId) === Number(assetId)
    && String(candidate.periodKey || "") === String(periodKey || "")
  )) || null;
  assert(row, `${label}: missing preview row for assetId=${assetId}, period=${periodKey}`);
  return row;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const stamp = Date.now().toString();
  const uniqueSuffix = stamp.slice(-8);
  const summary = {
    stamp,
    keepArtifacts: KEEP_ARTIFACTS,
  };

  try {
    const smokeContext = await resolveOrPrepareSmokeContext({ prefix: "FA47" });
    const tenantId = Number(smokeContext.tenantId);
    const legalEntityId = Number(smokeContext.legalEntityId);
    const userId = await createSmokeUser({ tenantId, uniqueSuffix });
    const book = await resolveBookContext(tenantId, legalEntityId);
    const periods = await resolvePeriodTriplet(book.calendarId, today);
    const accounts = await resolveAccountFixtures(tenantId, legalEntityId);
    const profile = await createSmokeProfile({
      tenantId,
      legalEntityId,
      uniqueSuffix,
      userId,
    });
    const category = await createSmokeCategory({
      tenantId,
      legalEntityId,
      profileId: profile.profileId,
      accounts,
      uniqueSuffix,
      userId,
    });
    const vendorCounterpartyId = await createVendorCounterparty({
      tenantId,
      legalEntityId,
      operatingUnitId: smokeContext.sourceOuId,
      currencyCode: book.currencyCode,
      apAccountId: accounts.apControlAccountId,
      uniqueSuffix,
    });
    summary.context = {
      tenantId,
      legalEntityId,
      userId,
      currentPeriod: periods.current.periodKey,
      secondPriorPeriod: periods.secondPrior.periodKey,
    };

    const moveReplayAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `MOVE-${uniqueSuffix}`,
      originalCostBase: 1500,
    });
    const moveReplayBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: moveReplayAsset.id,
    });
    requireScheduleRow(moveReplayBaselineSchedule, periods.firstPrior.periodKey, "move replay baseline");
    requireScheduleRow(moveReplayBaselineSchedule, periods.secondPrior.periodKey, "move replay baseline");
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: moveReplayAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior],
      scheduleRows: moveReplayBaselineSchedule.rows || [],
      userId,
    });

    const moveCompatibleImprovementEffectiveDate = dateWithinPeriod(periods.current, 7);
    const moveEffectiveDate = dateWithinPeriod(periods.current, 14);
    const movedAsset = await physicalMoveAsset({
      tenantId,
      assetId: moveReplayAsset.id,
      effectiveDate: moveEffectiveDate,
      locationOperatingUnitId: smokeContext.sourceOuId,
      note: "FA47 physical move compatibility",
      userId,
    });
    assert(
      Number(movedAsset.locationOperatingUnitId || 0) === Number(smokeContext.sourceOuId),
      `Expected physical move to update location OU to ${smokeContext.sourceOuId}, got ${movedAsset.locationOperatingUnitId || "NULL"}`
    );

    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: dateWithinPeriod(periods.current, 21),
      dueDate: periods.current.endDate,
      assetId: moveReplayAsset.id,
      effectiveDate: moveCompatibleImprovementEffectiveDate,
      amountBase: 80,
      stamp,
      suffix: "later-physical-move-allow",
    });

    const moveReplayAfterImprovement = await getAssetDetail({
      tenantId,
      assetId: moveReplayAsset.id,
    });
    assert(
      Number(moveReplayAfterImprovement.locationOperatingUnitId || 0) === Number(smokeContext.sourceOuId),
      `Improvement inserted before a later posted physical move must preserve moved location OU ${smokeContext.sourceOuId}, got ${moveReplayAfterImprovement.locationOperatingUnitId || "NULL"}`
    );

    const moveReplayDetailsResult = await query(
      `SELECT from_location_operating_unit_id,
              to_location_operating_unit_id
         FROM fixed_asset_physical_move_details
        WHERE tenant_id = ?
          AND asset_id = ?
        ORDER BY id ASC`,
      [tenantId, moveReplayAsset.id]
    );
    assert(
      Number(moveReplayDetailsResult.rows?.length || 0) === 1,
      `Expected 1 physical move detail row for replay-safe move asset, found ${moveReplayDetailsResult.rows?.length || 0}`
    );
    assert(
      Number(moveReplayDetailsResult.rows?.[0]?.from_location_operating_unit_id || 0) === Number(smokeContext.targetOuId),
      `Expected replay-safe move detail from_location_operating_unit_id=${smokeContext.targetOuId}, got ${moveReplayDetailsResult.rows?.[0]?.from_location_operating_unit_id || "NULL"}`
    );
    assert(
      Number(moveReplayDetailsResult.rows?.[0]?.to_location_operating_unit_id || 0) === Number(smokeContext.sourceOuId),
      `Expected replay-safe move detail to_location_operating_unit_id=${smokeContext.sourceOuId}, got ${moveReplayDetailsResult.rows?.[0]?.to_location_operating_unit_id || "NULL"}`
    );

    const moveReplaySchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: moveReplayAsset.id,
    });
    const moveReplayCurrentRow = requireScheduleRow(
      moveReplaySchedule,
      periods.current.periodKey,
      "move replay current schedule"
    );

    const moveControlAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `MOVECTRL-${uniqueSuffix}`,
      originalCostBase: 1500,
    });
    const moveControlBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: moveControlAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: moveControlAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior],
      scheduleRows: moveControlBaselineSchedule.rows || [],
      userId,
    });
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: dateWithinPeriod(periods.current, 21),
      dueDate: periods.current.endDate,
      assetId: moveControlAsset.id,
      effectiveDate: moveCompatibleImprovementEffectiveDate,
      amountBase: 80,
      stamp,
      suffix: "physical-move-control-improvement",
    });
    await physicalMoveAsset({
      tenantId,
      assetId: moveControlAsset.id,
      effectiveDate: moveEffectiveDate,
      locationOperatingUnitId: smokeContext.sourceOuId,
      note: "FA47 physical move chronological control",
      userId,
    });
    const moveControlSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: moveControlAsset.id,
    });
    const moveControlCurrentRow = requireScheduleRow(
      moveControlSchedule,
      periods.current.periodKey,
      "move control current schedule"
    );

    assert(
      amountsEqual(moveReplayCurrentRow.openingNbvBase, moveControlCurrentRow.openingNbvBase),
      `Physical-move replay path should match chronological control opening NBV. ` +
      `replayed=${moveReplayCurrentRow.openingNbvBase}, control=${moveControlCurrentRow.openingNbvBase}`
    );
    assert(
      amountsEqual(moveReplayCurrentRow.depreciationAmountBase, moveControlCurrentRow.depreciationAmountBase),
      `Physical-move replay path should match chronological control depreciation. ` +
      `replayed=${moveReplayCurrentRow.depreciationAmountBase}, control=${moveControlCurrentRow.depreciationAmountBase}`
    );
    assert(
      amountsEqual(moveReplayCurrentRow.nbvBase, moveControlCurrentRow.nbvBase),
      `Physical-move replay path should match chronological control closing NBV. ` +
      `replayed=${moveReplayCurrentRow.nbvBase}, control=${moveControlCurrentRow.nbvBase}`
    );

    summary.physicalMoveCompatibility = {
      assetId: moveReplayAsset.id,
      assetNo: moveReplayAsset.assetNo,
      controlAssetId: moveControlAsset.id,
      controlAssetNo: moveControlAsset.assetNo,
      improvementEffectiveDate: moveCompatibleImprovementEffectiveDate,
      moveEffectiveDate,
      locationOperatingUnitIdAfterReplay: moveReplayAfterImprovement.locationOperatingUnitId,
      currentPeriodOpeningNbvBase: moveReplayCurrentRow.openingNbvBase,
      currentPeriodDepreciationBase: moveReplayCurrentRow.depreciationAmountBase,
      currentPeriodClosingNbvBase: moveReplayCurrentRow.nbvBase,
    };

    const blockerAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `BLOCK-${uniqueSuffix}`,
      originalCostBase: 1650,
    });
    const blockerBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: blockerAsset.id,
    });
    requireScheduleRow(blockerBaselineSchedule, periods.firstPrior.periodKey, "blocker baseline");
    requireScheduleRow(blockerBaselineSchedule, periods.secondPrior.periodKey, "blocker baseline");
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: blockerAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior],
      scheduleRows: blockerBaselineSchedule.rows || [],
      userId,
    });

    const blockerEffectiveDate = dateWithinPeriod(periods.current, 7);
    const transferEffectiveDate = dateWithinPeriod(periods.current, 14);
    const transferredAsset = await ownershipTransferAsset({
      tenantId,
      assetId: blockerAsset.id,
      effectiveDate: transferEffectiveDate,
      postingDate: transferEffectiveDate,
      targetOwnerOperatingUnitId: smokeContext.targetOuId,
      targetLocationOperatingUnitId: smokeContext.targetOuId,
      note: "FA47 ownership transfer blocker",
      userId,
    });
    assert(
      Number(transferredAsset.ownerOperatingUnitId || 0) === Number(smokeContext.targetOuId),
      `Expected ownership transfer to update owner OU to ${smokeContext.targetOuId}, got ${transferredAsset.ownerOperatingUnitId || "NULL"}`
    );

    let laterLifecycleBlocker = null;
    try {
      await postImprovementDocument({
        tenantId,
        legalEntityId,
        userId,
        counterpartyId: vendorCounterpartyId,
        currencyCode: book.currencyCode,
        documentDate: dateWithinPeriod(periods.current, 21),
        dueDate: periods.current.endDate,
        assetId: blockerAsset.id,
        effectiveDate: blockerEffectiveDate,
        amountBase: 80,
        stamp,
        suffix: "later-ownership-transfer-block",
      });
      throw new Error("Expected improvement to be blocked by later OWNERSHIP_TRANSFER activity");
    } catch (error) {
      if (error?.message === "Expected improvement to be blocked by later OWNERSHIP_TRANSFER activity") {
        throw error;
      }
      laterLifecycleBlocker = error;
    }

    const blockerReasonCode = String(
      laterLifecycleBlocker?.details?.reasonCode
      || laterLifecycleBlocker?.reasonCode
      || ""
    );
    assert(
      blockerReasonCode === "FA_IMPROVEMENT_LATER_FIXED_ASSET_ACTIVITY",
      `Expected later lifecycle blocker reason code, got ${blockerReasonCode || "EMPTY"}`
    );
    assert(
      String(laterLifecycleBlocker?.details?.blockingTransactionType || "") === "OWNERSHIP_TRANSFER",
      `Expected blockingTransactionType=OWNERSHIP_TRANSFER, got ${laterLifecycleBlocker?.details?.blockingTransactionType || "EMPTY"}`
    );
    assert(
      String(laterLifecycleBlocker?.details?.blockingEffectiveDate || "") === transferEffectiveDate,
      `Expected blockingEffectiveDate=${transferEffectiveDate}, got ${laterLifecycleBlocker?.details?.blockingEffectiveDate || "EMPTY"}`
    );
    assert(
      toPositiveInt(laterLifecycleBlocker?.details?.blockingTransactionId) > 0,
      "Expected positive blockingTransactionId for later OWNERSHIP_TRANSFER blocker"
    );

    summary.ownershipTransferBlocker = {
      assetId: blockerAsset.id,
      assetNo: blockerAsset.assetNo,
      attemptedImprovementEffectiveDate: blockerEffectiveDate,
      blockingTransactionId: toPositiveInt(
        laterLifecycleBlocker?.details?.blockingTransactionId
      ),
      blockingTransactionType: laterLifecycleBlocker?.details?.blockingTransactionType || null,
      blockingEffectiveDate: laterLifecycleBlocker?.details?.blockingEffectiveDate || null,
      reasonCode: blockerReasonCode,
    };

    const disposalAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `DISP-${uniqueSuffix}`,
      originalCostBase: 1800,
    });
    const disposalBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: disposalAsset.id,
    });
    requireScheduleRow(disposalBaselineSchedule, periods.firstPrior.periodKey, "disposal baseline");
    requireScheduleRow(disposalBaselineSchedule, periods.secondPrior.periodKey, "disposal baseline");
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: disposalAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior, periods.current],
      scheduleRows: disposalBaselineSchedule.rows || [],
      userId,
    });

    const writeoffEffectiveDate = periods.current.endDate;
    const writtenOffAsset = await writeoffAsset({
      tenantId,
      assetId: disposalAsset.id,
      effectiveDate: writeoffEffectiveDate,
      postingDate: writeoffEffectiveDate,
      note: "FA47 disposal preview smoke write-off",
      userId,
    });
    assert(
      String(writtenOffAsset.status || "") === "DISPOSED",
      `Expected written-off asset to be DISPOSED, got ${writtenOffAsset.status || "EMPTY"}`
    );

    const preview = await previewDepreciationRun({
      tenantId,
      legalEntityId,
      fiscalPeriodId: periods.current.id,
      postingDate: periods.current.endDate,
    });
    const previewRows = Array.isArray(preview?.rows) ? preview.rows : [];
    const disposalPreviewRow = requirePreviewRow(
      previewRows,
      disposalAsset.id,
      periods.current.periodKey,
      "disposal preview"
    );
    assert(
      String(disposalPreviewRow.status || "") === "SKIPPED",
      `Disposed asset preview row should be SKIPPED, got ${disposalPreviewRow.status || "EMPTY"}`
    );
    assert(
      String(disposalPreviewRow.skipReasonCode || "") === "PERIOD_ALREADY_PROCESSED_BY_DISPOSAL",
      `Expected skipReasonCode=PERIOD_ALREADY_PROCESSED_BY_DISPOSAL, got ${disposalPreviewRow.skipReasonCode || "EMPTY"}`
    );
    assert(
      !disposalPreviewRow.errorCode,
      `Disposed asset preview row should not carry errorCode, got ${disposalPreviewRow.errorCode || "EMPTY"}`
    );
    assert(
      toNumber(disposalPreviewRow.plannedAmountBase) === 0,
      `Disposed asset preview row should have plannedAmountBase=0, got ${disposalPreviewRow.plannedAmountBase}`
    );

    summary.disposalPreview = {
      assetId: disposalAsset.id,
      assetNo: disposalAsset.assetNo,
      writeoffEffectiveDate,
      previewPeriodKey: periods.current.periodKey,
      previewStatus: disposalPreviewRow.status,
      previewSkipReasonCode: disposalPreviewRow.skipReasonCode,
      previewErrorCode: disposalPreviewRow.errorCode || null,
    };

    const suspendedAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `SUSP-${uniqueSuffix}`,
      originalCostBase: 1600,
    });
    const suspendedBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: suspendedAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: suspendedAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior],
      scheduleRows: suspendedBaselineSchedule.rows || [],
      userId,
    });

    const suspendEffectiveDate = dateWithinPeriod(periods.current, 4);
    const improvementDuringSuspendDate = dateWithinPeriod(periods.current, 9);
    const reactivateEffectiveDate = dateWithinPeriod(periods.current, 19);

    const suspendedAfterSuspend = await suspendAsset({
      tenantId,
      assetId: suspendedAsset.id,
      effectiveDate: suspendEffectiveDate,
      note: "FA47 suspend for repair",
      userId,
    });
    assert(
      String(suspendedAfterSuspend.status || "") === "SUSPENDED",
      `Expected suspended asset status SUSPENDED after suspend, got ${suspendedAfterSuspend.status || "EMPTY"}`
    );

    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: improvementDuringSuspendDate,
      dueDate: periods.current.endDate,
      assetId: suspendedAsset.id,
      effectiveDate: improvementDuringSuspendDate,
      amountBase: 200,
      stamp,
      suffix: "suspended-improvement",
    });

    const suspendedAfterImprovement = await getAssetDetail({
      tenantId,
      assetId: suspendedAsset.id,
    });
    assert(
      String(suspendedAfterImprovement.status || "") === "SUSPENDED",
      `Improvement during suspension should keep asset SUSPENDED until reactivation; got ${suspendedAfterImprovement.status || "EMPTY"}`
    );
    assert(
      toNumber(suspendedAfterImprovement.originalCostBase) === 1800,
      `Suspended improvement should increase originalCostBase to 1800, got ${suspendedAfterImprovement.originalCostBase}`
    );

    const suspendedScheduleBeforeReactivate = await getAssetDepreciationSchedule({
      tenantId,
      assetId: suspendedAsset.id,
    });
    const suspendedCurrentRowBeforeReactivate = requireScheduleRow(
      suspendedScheduleBeforeReactivate,
      periods.current.periodKey,
      "suspended before reactivate"
    );
    const beforeReactivateSegments = Array.isArray(
      suspendedCurrentRowBeforeReactivate.allocationSegments
    )
      ? suspendedCurrentRowBeforeReactivate.allocationSegments
      : [];
    assert(
      beforeReactivateSegments.length === 1,
      `Expected 1 active allocation segment before reactivation, found ${beforeReactivateSegments.length}`
    );
    assert(
      String(beforeReactivateSegments[0]?.fromDate || "") === periods.current.startDate
      && String(beforeReactivateSegments[0]?.toDate || "") === addDays(suspendEffectiveDate, -1),
      `Expected only the pre-suspend active segment before reactivation, got ${beforeReactivateSegments[0]?.fromDate || "EMPTY"}..${beforeReactivateSegments[0]?.toDate || "EMPTY"}`
    );

    const reactivatedAsset = await reactivateAsset({
      tenantId,
      assetId: suspendedAsset.id,
      effectiveDate: reactivateEffectiveDate,
      note: "FA47 reactivate after repair",
      userId,
    });
    assert(
      String(reactivatedAsset.status || "") === "ACTIVE",
      `Expected reactivated asset status ACTIVE, got ${reactivatedAsset.status || "EMPTY"}`
    );

    const suspendedScheduleAfterReactivate = await getAssetDepreciationSchedule({
      tenantId,
      assetId: suspendedAsset.id,
    });
    const suspendedCurrentRowAfterReactivate = requireScheduleRow(
      suspendedScheduleAfterReactivate,
      periods.current.periodKey,
      "suspended after reactivate"
    );
    const afterReactivateSegments = Array.isArray(
      suspendedCurrentRowAfterReactivate.allocationSegments
    )
      ? suspendedCurrentRowAfterReactivate.allocationSegments
      : [];
    assert(
      afterReactivateSegments.length === 2,
      `Expected 2 active allocation segments after reactivation, found ${afterReactivateSegments.length}`
    );
    assert(
      String(afterReactivateSegments[0]?.fromDate || "") === periods.current.startDate
      && String(afterReactivateSegments[0]?.toDate || "") === addDays(suspendEffectiveDate, -1),
      `Expected first active segment ${periods.current.startDate}..${addDays(suspendEffectiveDate, -1)}, got ${afterReactivateSegments[0]?.fromDate || "EMPTY"}..${afterReactivateSegments[0]?.toDate || "EMPTY"}`
    );
    assert(
      String(afterReactivateSegments[1]?.fromDate || "") === reactivateEffectiveDate
      && String(afterReactivateSegments[1]?.toDate || "") === periods.current.endDate,
      `Expected second active segment ${reactivateEffectiveDate}..${periods.current.endDate}, got ${afterReactivateSegments[1]?.fromDate || "EMPTY"}..${afterReactivateSegments[1]?.toDate || "EMPTY"}`
    );
    assert(
      toNumber(suspendedCurrentRowAfterReactivate.plannedAmountBase)
      > toNumber(suspendedCurrentRowBeforeReactivate.plannedAmountBase),
      "Reactivated period depreciation should increase after the suspended improvement becomes eligible"
    );

    summary.suspendedImprovement = {
      assetId: suspendedAsset.id,
      assetNo: suspendedAsset.assetNo,
      suspendEffectiveDate,
      improvementDuringSuspendDate,
      reactivateEffectiveDate,
      beforeReactivateEligibleDays: suspendedCurrentRowBeforeReactivate.eligibleDays,
      afterReactivateEligibleDays: suspendedCurrentRowAfterReactivate.eligibleDays,
      originalCostBaseAfterImprovement: suspendedAfterImprovement.originalCostBase,
      beforeReactivateSegments: beforeReactivateSegments.map((segment) => ({
        fromDate: segment.fromDate,
        toDate: segment.toDate,
        eligibleDays: segment.eligibleDays,
      })),
      afterReactivateSegments: afterReactivateSegments.map((segment) => ({
        fromDate: segment.fromDate,
        toDate: segment.toDate,
        eligibleDays: segment.eligibleDays,
      })),
    };

    console.log("STEP-FA47 smoke passed.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error("STEP-FA47 smoke failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
