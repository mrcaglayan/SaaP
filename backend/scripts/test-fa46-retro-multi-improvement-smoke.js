
import { closePool, query } from "../src/db.js";
import { assignTestFullAccessRoleToUser } from "./ex05-test-helpers.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  createAssetDraft,
  activateAsset,
  getAssetDetail,
} from "../src/services/fixed-assets.service.js";
import {
  getAssetDepreciationSchedule,
} from "../src/services/fixed-assets.depreciation.service.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
} from "../src/services/cari.document.service.js";
const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA46_SMOKE_KEEP_ARTIFACTS,
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
function amountsEqual(left, right, epsilon = 0.000001) {
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
      "user-agent": "fa46-retro-multi-improvement-smoke",
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
  const byCode = new Map((result.rows || []).map((row) => [String(row.code), Number(row.id)]));
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
  const email = `fa46.smoke.${uniqueSuffix}@example.test`;
  const insertResult = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      email,
      "not-used-in-direct-service-smoke",
      `FA46 Smoke ${uniqueSuffix}`,
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
  const code = `FA46PF${uniqueSuffix.slice(-6)}`;
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
      `FA46 Multi-Improvement ${uniqueSuffix}`,
      "Smoke profile for repeated retro improvement coverage",
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
  const code = `FA46CT${uniqueSuffix.slice(-6)}`;
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
      `FA46 Smoke Category ${uniqueSuffix}`,
      "Smoke category for repeated fixed-asset improvement coverage",
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
      `FA46VND${uniqueSuffix.slice(-8)}`,
      `FA46 Smoke Vendor ${uniqueSuffix.slice(-8)}`,
      currencyCode,
      apAccountId,
      "Vendor for repeated-improvement smoke coverage",
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
    name: `FA46 ${uniqueSuffix}`,
    categoryId,
    acquisitionDate,
    currencyCode,
    description: "Smoke asset for repeated-improvement coverage",
    assetTag: `FA46-${uniqueSuffix}`.slice(0, 40),
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
        `FA46 seeded posted depreciation ${period.periodKey}`,
        userId,
      ]
    );
    const transactionId = Number(txResult.rows?.insertId || 0);
    assert(transactionId > 0, `Failed to insert seeded depreciation transaction for ${period.periodKey}`);
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
  lifeExtensionMonths = null,
  revisedUsefulLifeMonths = null,
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
          description: `FA46 ${suffix}`,
          subledgerType: "FIXED_ASSET",
          fixedAssetMode: "IMPROVE_EXISTING",
          targetFixedAssetId: assetId,
          improvementEffectiveDate: effectiveDate,
          quantity: 1,
          lineNetAmountTxn: amountBase,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: amountBase,
          revisedUsefulLifeMonths,
          lifeExtensionMonths,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  const posted = await postCariDocumentById({
    req: makeRequestContext({ tenantId, userId, stamp, suffix: `${suffix}-post` }),
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  return {
    draftId: Number(draft.id),
    posted,
  };
}
async function loadImprovementTransactions(tenantId, assetId) {
  const result = await query(
    `SELECT id,
            effective_date,
            posting_date,
            gross_amount_base,
            improvement_pre_cost_base,
            improvement_pre_useful_life_months,
            improvement_pre_remaining_life_months,
            improvement_revised_useful_life_months,
            improvement_life_extension_months
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
        AND status = 'POSTED'
        AND transaction_type = 'IMPROVEMENT'
      ORDER BY effective_date ASC, id ASC`,
    [tenantId, assetId]
  );
  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    effectiveDate: String(row.effective_date || "").slice(0, 10),
    postingDate: String(row.posting_date || "").slice(0, 10),
    grossAmountBase: toNumber(row.gross_amount_base),
    improvementPreCostBase: toNumber(row.improvement_pre_cost_base),
    improvementPreUsefulLifeMonths: row.improvement_pre_useful_life_months != null
      ? Number(row.improvement_pre_useful_life_months)
      : null,
    improvementPreRemainingLifeMonths: row.improvement_pre_remaining_life_months != null
      ? Number(row.improvement_pre_remaining_life_months)
      : null,
    revisedUsefulLifeMonths: row.improvement_revised_useful_life_months != null
      ? Number(row.improvement_revised_useful_life_months)
      : null,
    lifeExtensionMonths: row.improvement_life_extension_months != null
      ? Number(row.improvement_life_extension_months)
      : null,
  }));
}
async function loadCatchUpTransactions(tenantId, assetId) {
  const result = await query(
    `SELECT id, journal_entry_id, effective_date, posting_date
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
        AND status = 'POSTED'
        AND transaction_type = 'DEPRECIATION'
        AND depreciation_kind = 'CATCH_UP'
      ORDER BY id ASC`,
    [tenantId, assetId]
  );
  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    journalEntryId: Number(row.journal_entry_id || 0),
    effectiveDate: String(row.effective_date || "").slice(0, 10),
    postingDate: String(row.posting_date || "").slice(0, 10),
  }));
}
async function sumJournalDebitBaseByEntryIds(journalEntryIds) {
  if (!Array.isArray(journalEntryIds) || !journalEntryIds.length) {
    return 0;
  }
  const placeholders = journalEntryIds.map(() => "?").join(", ");
  const result = await query(
    `SELECT COALESCE(SUM(debit_base), 0) AS total_debit_base
       FROM journal_lines
      WHERE journal_entry_id IN (${placeholders})`,
    journalEntryIds
  );
  return toNumber(result.rows?.[0]?.total_debit_base || 0);
}
function requireScheduleRow(schedule, periodKey, label) {
  const row = (schedule?.rows || []).find((candidate) => candidate.periodKey === periodKey) || null;
  assert(row, `${label}: missing schedule row for ${periodKey}`);
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
    const smokeContext = await resolveOrPrepareSmokeContext({ prefix: "FA46" });
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
    const retroAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `RETRO-${uniqueSuffix}`,
      originalCostBase: 1200,
    });
    const retroBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: retroAsset.id,
    });
    const retroFirstPriorRow = requireScheduleRow(
      retroBaselineSchedule,
      periods.firstPrior.periodKey,
      "retro baseline"
    );
    const retroSecondPriorRow = requireScheduleRow(
      retroBaselineSchedule,
      periods.secondPrior.periodKey,
      "retro baseline"
    );
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: retroAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior],
      scheduleRows: retroBaselineSchedule.rows || [],
      userId,
    });
    const laterRetroEffectiveDate = dateWithinPeriod(periods.secondPrior, 19);
    const earlierRetroEffectiveDate = dateWithinPeriod(periods.secondPrior, 9);
    const firstPostingDate = dateWithinPeriod(periods.current, 19);
    const secondPostingDate = dateWithinPeriod(periods.current, 24);
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: firstPostingDate,
      dueDate: periods.current.endDate,
      assetId: retroAsset.id,
      effectiveDate: laterRetroEffectiveDate,
      amountBase: 60,
      stamp,
      suffix: "retro-later",
    });
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: secondPostingDate,
      dueDate: periods.current.endDate,
      assetId: retroAsset.id,
      effectiveDate: earlierRetroEffectiveDate,
      amountBase: 120,
      stamp,
      suffix: "retro-earlier",
    });
    const retroCatchUps = await loadCatchUpTransactions(tenantId, retroAsset.id);
    assert(
      retroCatchUps.length === 2,
      `Expected 2 posted CATCH_UP transactions after dual retro improvements, found ${retroCatchUps.length}`
    );
    const retroScheduleAfter = await getAssetDepreciationSchedule({
      tenantId,
      assetId: retroAsset.id,
    });
    const correctedRetroSecondPriorRow = requireScheduleRow(
      retroScheduleAfter,
      periods.secondPrior.periodKey,
      "retro corrected schedule"
    );
    assert(
      correctedRetroSecondPriorRow.correctedByCatchUp === true,
      "Retro corrected historical schedule row must be flagged correctedByCatchUp"
    );
    const retroImprovementTransactions = await loadImprovementTransactions(
      tenantId,
      retroAsset.id
    );
    assert(
      retroImprovementTransactions.length === 2,
      `Expected 2 posted retro improvement transactions, found ${retroImprovementTransactions.length}`
    );
    const resequencedLaterImprovement = retroImprovementTransactions.find(
      (row) => row.effectiveDate === laterRetroEffectiveDate
    );
    assert(
      resequencedLaterImprovement,
      `Missing later retro improvement transaction for ${laterRetroEffectiveDate}`
    );
    assert(
      amountsEqual(resequencedLaterImprovement.improvementPreCostBase, 1320),
      `Resequenced later improvement pre-cost should be 1320, got ${resequencedLaterImprovement.improvementPreCostBase}`
    );
    assert(
      amountsEqual(resequencedLaterImprovement.grossAmountBase, 1380),
      `Resequenced later improvement gross should be 1380, got ${resequencedLaterImprovement.grossAmountBase}`
    );

    const controlAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.firstPrior.startDate,
      uniqueSuffix: `CTRL-${uniqueSuffix}`,
      originalCostBase: 1200,
    });
    const controlBaselineSchedule = await getAssetDepreciationSchedule({
      tenantId,
      assetId: controlAsset.id,
    });
    await seedPostedDepreciationHistory({
      tenantId,
      legalEntityId,
      asset: controlAsset,
      bookId: book.bookId,
      periods: [periods.firstPrior, periods.secondPrior],
      scheduleRows: controlBaselineSchedule.rows || [],
      userId,
    });
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: firstPostingDate,
      dueDate: periods.current.endDate,
      assetId: controlAsset.id,
      effectiveDate: earlierRetroEffectiveDate,
      amountBase: 120,
      stamp,
      suffix: "retro-control-earlier",
    });
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: secondPostingDate,
      dueDate: periods.current.endDate,
      assetId: controlAsset.id,
      effectiveDate: laterRetroEffectiveDate,
      amountBase: 60,
      stamp,
      suffix: "retro-control-later",
    });
    const controlScheduleAfter = await getAssetDepreciationSchedule({
      tenantId,
      assetId: controlAsset.id,
    });
    const controlSecondPriorRow = requireScheduleRow(
      controlScheduleAfter,
      periods.secondPrior.periodKey,
      "retro control schedule"
    );
    const retroCurrentRow = requireScheduleRow(
      retroScheduleAfter,
      periods.current.periodKey,
      "retro reordered schedule"
    );
    const controlCurrentRow = requireScheduleRow(
      controlScheduleAfter,
      periods.current.periodKey,
      "retro control current schedule"
    );
    assert(
      amountsEqual(
        correctedRetroSecondPriorRow.depreciationAmountBase,
        controlSecondPriorRow.depreciationAmountBase
      ),
      `Reordered retro path should match chronological control for corrected historical depreciation. ` +
      `reordered=${correctedRetroSecondPriorRow.depreciationAmountBase}, control=${controlSecondPriorRow.depreciationAmountBase}`
    );
    assert(
      amountsEqual(correctedRetroSecondPriorRow.nbvBase, controlSecondPriorRow.nbvBase),
      `Reordered retro path should match chronological control for corrected historical NBV. ` +
      `reordered=${correctedRetroSecondPriorRow.nbvBase}, control=${controlSecondPriorRow.nbvBase}`
    );
    assert(
      amountsEqual(retroCurrentRow.openingNbvBase, controlCurrentRow.openingNbvBase),
      `Reordered retro path should match chronological control for next-period opening NBV. ` +
      `reordered=${retroCurrentRow.openingNbvBase}, control=${controlCurrentRow.openingNbvBase}`
    );
    assert(
      amountsEqual(retroCurrentRow.depreciationAmountBase, controlCurrentRow.depreciationAmountBase),
      `Reordered retro path should match chronological control for next-period depreciation. ` +
      `reordered=${retroCurrentRow.depreciationAmountBase}, control=${controlCurrentRow.depreciationAmountBase}`
    );
    summary.retroSameMonth = {
      assetId: retroAsset.id,
      assetNo: retroAsset.assetNo,
      controlAssetId: controlAsset.id,
      controlAssetNo: controlAsset.assetNo,
      laterRetroEffectiveDate,
      earlierRetroEffectiveDate,
      seededHistoricalDepreciationBase: retroSecondPriorRow.depreciationAmountBase,
      correctedHistoricalDepreciationBase:
        correctedRetroSecondPriorRow.depreciationAmountBase,
      controlHistoricalDepreciationBase:
        controlSecondPriorRow.depreciationAmountBase,
      catchUpTransactionIds: retroCatchUps.map((row) => row.id),
      resequencedLaterImprovementTransactionId: resequencedLaterImprovement.id,
    };
    const sameDayAsset = await createActivatedSmokeAsset({
      tenantId,
      legalEntityId,
      userId,
      categoryId: category.categoryId,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      currencyCode: book.currencyCode,
      acquisitionDate: periods.current.startDate,
      uniqueSuffix: `DAY-${uniqueSuffix}`,
      originalCostBase: 1000,
    });
    const sameDayDate = dateWithinPeriod(periods.current, 12);
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: dateWithinPeriod(periods.current, 20),
      dueDate: periods.current.endDate,
      assetId: sameDayAsset.id,
      effectiveDate: sameDayDate,
      amountBase: 40,
      stamp,
      suffix: "same-day-cost-1",
    });
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: dateWithinPeriod(periods.current, 21),
      dueDate: periods.current.endDate,
      assetId: sameDayAsset.id,
      effectiveDate: sameDayDate,
      amountBase: 60,
      stamp,
      suffix: "same-day-cost-2",
    });
    await postImprovementDocument({
      tenantId,
      legalEntityId,
      userId,
      counterpartyId: vendorCounterpartyId,
      currencyCode: book.currencyCode,
      documentDate: dateWithinPeriod(periods.current, 22),
      dueDate: periods.current.endDate,
      assetId: sameDayAsset.id,
      effectiveDate: sameDayDate,
      amountBase: 20,
      lifeExtensionMonths: 2,
      stamp,
      suffix: "same-day-life-1",
    });
    let sameDayLifeConflict = null;
    try {
      await postImprovementDocument({
        tenantId,
        legalEntityId,
        userId,
        counterpartyId: vendorCounterpartyId,
        currencyCode: book.currencyCode,
        documentDate: dateWithinPeriod(periods.current, 23),
        dueDate: periods.current.endDate,
        assetId: sameDayAsset.id,
        effectiveDate: sameDayDate,
        amountBase: 10,
        revisedUsefulLifeMonths: 18,
        stamp,
        suffix: "same-day-life-2",
      });
      throw new Error("Expected second same-day life-changing improvement to be rejected");
    } catch (error) {
      if (error?.message === "Expected second same-day life-changing improvement to be rejected") {
        throw error;
      }
      sameDayLifeConflict = error;
    }
    const sameDayReasonCode = String(
      sameDayLifeConflict?.details?.reasonCode
      || sameDayLifeConflict?.reasonCode
      || ""
    );
    assert(
      sameDayReasonCode === "FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT",
      `Expected same-day life-change conflict reason code, got ${sameDayReasonCode || "EMPTY"}`
    );
    const sameDayImprovementTransactions = await loadImprovementTransactions(
      tenantId,
      sameDayAsset.id
    );
    assert(
      sameDayImprovementTransactions.length === 3,
      `Expected 3 posted same-day improvements (2 cost-only + 1 life-changing), found ${sameDayImprovementTransactions.length}`
    );
    const refreshedSameDayAsset = await getAssetDetail({
      tenantId,
      assetId: sameDayAsset.id,
    });
    assert(
      toNumber(refreshedSameDayAsset.originalCostBase) === 1120,
      `Same-day cost-only improvements should remain allowed and update cost to 1120; got ${refreshedSameDayAsset.originalCostBase}`
    );
    assert(
      Number(refreshedSameDayAsset.remainingUsefulLifeMonths || 0) > 12,
      `Life-changing improvement should extend remaining useful life beyond 12; got ${refreshedSameDayAsset.remainingUsefulLifeMonths}`
    );
    summary.sameDayRules = {
      assetId: sameDayAsset.id,
      assetNo: sameDayAsset.assetNo,
      sameDayDate,
      postedImprovementTransactionIds: sameDayImprovementTransactions.map((row) => row.id),
      finalOriginalCostBase: refreshedSameDayAsset.originalCostBase,
      finalRemainingUsefulLifeMonths: refreshedSameDayAsset.remainingUsefulLifeMonths,
      rejectedReasonCode: sameDayReasonCode,
      rejectedBlockingTransactionId:
        sameDayLifeConflict?.details?.blockingTransactionId || null,
    };
    console.log("STEP-FA46 smoke passed.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closePool();
  }
}
main().catch((error) => {
  console.error("STEP-FA46 smoke failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
