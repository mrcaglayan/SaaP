import { closePool, query } from "../src/db.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  createAssetDraft,
  activateAsset,
  reverseFixedAssetTransaction,
} from "../src/services/fixed-assets.service.js";

const KEEP_ARTIFACTS = parseBooleanEnv(
  process.env.FA45_SMOKE_KEEP_ARTIFACTS,
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

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  assert(currentIndex >= 2, `Could not resolve two prior fiscal periods before ${today}`);
  return {
    firstPrior: periods[currentIndex - 2],
    secondPrior: periods[currentIndex - 1],
    current: periods[currentIndex],
  };
}

async function resolveAccountFixtures(tenantId, legalEntityId) {
  const result = await query(
    `SELECT a.id, a.code, a.account_type
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
  const byCode = new Map((result.rows || []).map((row) => [String(row.code), Number(row.id)]));
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
  const code = `FA45PF${uniqueSuffix.slice(-6)}`;
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
      `FA45 Late Catch-Up ${uniqueSuffix}`,
      "Smoke profile for late activation catch-up coverage",
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
  const code = `FA45CT${uniqueSuffix.slice(-6)}`;
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
      `FA45 Catch-Up Category ${uniqueSuffix}`,
      "Smoke category for immutable late catch-up coverage",
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

async function insertPostedRunHeader({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  periodKey,
  postingDate,
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
        ?, ?, ?, ?, ?, ?, 'POSTED', 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP
     )`,
    [
      tenantId,
      legalEntityId,
      bookId,
      fiscalPeriodId,
      postingDate,
      periodKey,
      userId,
      userId,
    ]
  );
  const runId = Number(result.rows?.insertId || 0);
  assert(runId > 0, `Failed to insert posted run header for ${periodKey}`);
  return runId;
}

async function resolveActorUserId(tenantId) {
  const result = await query(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [tenantId]
  );
  const userId = Number(result.rows?.[0]?.id || 0);
  assert(userId > 0, `No tenant user found for tenant ${tenantId}`);
  return userId;
}

async function loadAssetCatchUpState(tenantId, assetId) {
  const assetResult = await query(
    `SELECT status,
            last_depreciation_period,
            remaining_useful_life_months
       FROM fixed_assets
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, assetId]
  );
  const txResult = await query(
    `SELECT id,
            transaction_type,
            status,
            depreciation_kind,
            effective_date,
            posting_date,
            journal_entry_id
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
      ORDER BY id ASC`,
    [tenantId, assetId]
  );
  const scheduleResult = await query(
    `SELECT id,
            period_key,
            status,
            posted_transaction_id
       FROM fixed_asset_depreciation_schedule_lines
      WHERE tenant_id = ?
        AND asset_id = ?
      ORDER BY period_key ASC, id ASC`,
    [tenantId, assetId]
  );

  return {
    asset: assetResult.rows?.[0] || null,
    transactions: (txResult.rows || []).map((row) => ({
      id: Number(row.id),
      transactionType: String(row.transaction_type || "").toUpperCase(),
      status: String(row.status || "").toUpperCase(),
      depreciationKind: row.depreciation_kind ? String(row.depreciation_kind).toUpperCase() : null,
      effectiveDate: String(row.effective_date || "").slice(0, 10),
      postingDate: String(row.posting_date || "").slice(0, 10),
      journalEntryId: Number(row.journal_entry_id || 0) || null,
    })),
    scheduleLines: (scheduleResult.rows || []).map((row) => ({
      id: Number(row.id),
      periodKey: String(row.period_key || ""),
      status: String(row.status || "").toUpperCase(),
      postedTransactionId: Number(row.posted_transaction_id || 0) || null,
    })),
  };
}

async function cleanupArtifacts({
  tenantId,
  assetId,
  categoryId,
  profileId,
  runIds,
}) {
  if (assetId) {
    const txResult = await query(
      `SELECT id, journal_entry_id
         FROM fixed_asset_transactions
        WHERE tenant_id = ?
          AND asset_id = ?`,
      [tenantId, assetId]
    );
    const transactionIds = (txResult.rows || []).map((row) => Number(row.id)).filter(Boolean);
    const journalIds = Array.from(
      new Set((txResult.rows || []).map((row) => Number(row.journal_entry_id || 0)).filter(Boolean))
    );

    await query(
      `DELETE FROM fixed_asset_depreciation_schedule_lines
        WHERE tenant_id = ?
          AND asset_id = ?`,
      [tenantId, assetId]
    );
    if (transactionIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
          WHERE tenant_id = ?
            AND source_ref_type = 'FIXED_ASSET_TRANSACTION'
            AND source_ref_id IN (${transactionIds.map(() => "?").join(", ")})`,
        [tenantId, ...transactionIds]
      );
    }
    if (journalIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
          WHERE tenant_id = ?
            AND journal_entry_id IN (${journalIds.map(() => "?").join(", ")})`,
        [tenantId, ...journalIds]
      );
      await query(
        `DELETE FROM journal_lines
          WHERE journal_entry_id IN (${journalIds.map(() => "?").join(", ")})`,
        journalIds
      );
    }
    await query(
      `DELETE FROM fixed_asset_transactions
        WHERE tenant_id = ?
          AND asset_id = ?`,
      [tenantId, assetId]
    );
    if (journalIds.length > 0) {
      await query(
        `DELETE FROM journal_entries
          WHERE id IN (${journalIds.map(() => "?").join(", ")})`,
        journalIds
      );
    }
    await query(
      `DELETE FROM fixed_assets
        WHERE tenant_id = ?
          AND id = ?`,
      [tenantId, assetId]
    );
  }

  if (Array.isArray(runIds) && runIds.length > 0) {
    await query(
      `DELETE FROM fixed_asset_depreciation_runs
        WHERE tenant_id = ?
          AND id IN (${runIds.map(() => "?").join(", ")})`,
      [tenantId, ...runIds]
    );
  }

  if (categoryId) {
    await query(
      `DELETE FROM fixed_asset_categories
        WHERE tenant_id = ?
          AND id = ?`,
      [tenantId, categoryId]
    );
  }

  if (profileId) {
    await query(
      `DELETE FROM fixed_asset_depreciation_profiles
        WHERE tenant_id = ?
          AND id = ?`,
      [tenantId, profileId]
    );
  }
}

async function main() {
  const smokeContext = await resolveOrPrepareSmokeContext({ prefix: "FA45" });
  const tenantId = smokeContext.tenantId;
  const legalEntityId = smokeContext.legalEntityId;
  const uniqueSuffix = `${Date.now()}`;
  const summary = {
    tenantId,
    legalEntityId,
    keepArtifacts: KEEP_ARTIFACTS,
    priorPeriods: [],
    activation: null,
    reversal: null,
    cleanup: KEEP_ARTIFACTS ? "skipped" : "pending",
  };

  const artifactState = {
    assetId: null,
    categoryId: null,
    profileId: null,
    runIds: [],
  };

  try {
    const today = new Date().toISOString().slice(0, 10);
    const book = await resolveBookContext(tenantId, legalEntityId);
    const periods = await resolvePeriodTriplet(book.calendarId, today);
    const accounts = await resolveAccountFixtures(tenantId, legalEntityId);
    const actorUserId = await resolveActorUserId(tenantId);

    summary.priorPeriods = [periods.firstPrior.periodKey, periods.secondPrior.periodKey];

    const profile = await createSmokeProfile({
      tenantId,
      legalEntityId,
      uniqueSuffix,
      userId: actorUserId,
    });
    artifactState.profileId = profile.profileId;

    const category = await createSmokeCategory({
      tenantId,
      legalEntityId,
      profileId: profile.profileId,
      accounts,
      uniqueSuffix,
      userId: actorUserId,
    });
    artifactState.categoryId = category.categoryId;

    artifactState.runIds.push(
      await insertPostedRunHeader({
        tenantId,
        legalEntityId,
        bookId: book.bookId,
        fiscalPeriodId: periods.firstPrior.id,
        periodKey: periods.firstPrior.periodKey,
        postingDate: periods.firstPrior.endDate,
        userId: actorUserId,
      })
    );
    artifactState.runIds.push(
      await insertPostedRunHeader({
        tenantId,
        legalEntityId,
        bookId: book.bookId,
        fiscalPeriodId: periods.secondPrior.id,
        periodKey: periods.secondPrior.periodKey,
        postingDate: periods.secondPrior.endDate,
        userId: actorUserId,
      })
    );

    const acquisitionDate = addDays(periods.firstPrior.startDate, 4);
    const createdAsset = await createAssetDraft({
      tenantId,
      legalEntityId,
      name: `FA45 Late Catch-Up ${uniqueSuffix}`,
      categoryId: category.categoryId,
      acquisitionDate,
      currencyCode: book.currencyCode,
      description: "Smoke asset for immutable late catch-up coverage",
      assetTag: `FA45-${uniqueSuffix}`.slice(0, 40),
      serialNo: null,
      ownerOperatingUnitId: smokeContext.sourceOuId,
      locationOperatingUnitId: smokeContext.targetOuId,
      departmentCode: null,
      costCenterCode: null,
      custodianEmployeeId: null,
      counterpartyId: null,
      originalCostTxn: 1200,
      originalCostBase: 1200,
      userId: actorUserId,
    });
    const assetId = Number(createdAsset?.id || 0);
    assert(assetId > 0, "Failed to create smoke draft asset");
    artifactState.assetId = assetId;

    await activateAsset({
      tenantId,
      assetId,
      postingDate: today,
      capitalizationDate: acquisitionDate,
      inServiceDate: acquisitionDate,
      userId: actorUserId,
    });

    const afterActivation = await loadAssetCatchUpState(tenantId, assetId);
    const catchUpTransaction = afterActivation.transactions.find((row) => (
      row.transactionType === "DEPRECIATION"
      && row.depreciationKind === "CATCH_UP"
      && row.status === "POSTED"
    )) || null;
    assert(catchUpTransaction, "Late activation did not create a posted CATCH_UP depreciation transaction");

    const postedScheduleLines = afterActivation.scheduleLines.filter((row) => (
      row.status === "POSTED"
      && row.postedTransactionId === catchUpTransaction.id
    ));
    assert(
      postedScheduleLines.length === 2,
      `Expected 2 posted catch-up schedule lines, found ${postedScheduleLines.length}`
    );
    assert(
      postedScheduleLines[0].periodKey === periods.firstPrior.periodKey
      && postedScheduleLines[1].periodKey === periods.secondPrior.periodKey,
      "Catch-up schedule lines do not match the missed posted periods"
    );
    assert(
      String(afterActivation.asset?.last_depreciation_period || "") === periods.secondPrior.periodKey,
      `Expected last_depreciation_period=${periods.secondPrior.periodKey}, got ${afterActivation.asset?.last_depreciation_period || "NULL"}`
    );
    assert(
      Number(afterActivation.asset?.remaining_useful_life_months || 0) === 10,
      `Expected remaining_useful_life_months=10 after catch-up, got ${afterActivation.asset?.remaining_useful_life_months || "NULL"}`
    );

    summary.activation = {
      assetId,
      catchUpTransactionId: catchUpTransaction.id,
      catchUpPeriods: postedScheduleLines.map((row) => row.periodKey),
      lastDepreciationPeriod: afterActivation.asset?.last_depreciation_period || null,
      remainingUsefulLifeMonths: Number(afterActivation.asset?.remaining_useful_life_months || 0),
    };

    const reversalResult = await reverseFixedAssetTransaction({
      tenantId,
      transactionId: catchUpTransaction.id,
      userId: actorUserId,
    });
    const afterReversal = await loadAssetCatchUpState(tenantId, assetId);
    const reversedScheduleLines = afterReversal.scheduleLines.filter((row) => (
      row.status === "REVERSED"
    ));
    assert(
      reversedScheduleLines.length === 2,
      `Expected 2 reversed catch-up schedule lines, found ${reversedScheduleLines.length}`
    );
    assert(
      afterReversal.transactions.some((row) => (
        row.id === catchUpTransaction.id
        && row.status === "REVERSED"
      )),
      "Catch-up depreciation transaction was not marked REVERSED"
    );
    assert(
      Number(afterReversal.asset?.remaining_useful_life_months || 0) === 12,
      `Expected remaining_useful_life_months=12 after reversal, got ${afterReversal.asset?.remaining_useful_life_months || "NULL"}`
    );
    assert(
      afterReversal.asset?.last_depreciation_period == null,
      `Expected last_depreciation_period to clear after catch-up reversal, got ${afterReversal.asset?.last_depreciation_period || "NULL"}`
    );

    summary.reversal = {
      reversalTransactionId: Number(reversalResult?.reversal?.reversalTransactionId || 0) || null,
      reversedScheduleLineCount: Number(reversalResult?.reversal?.reversedScheduleLineCount || 0),
      syncedRemainingUsefulLifeMonths: Number(reversalResult?.reversal?.syncedRemainingUsefulLifeMonths || 0),
      assetStatus: String(afterReversal.asset?.status || ""),
      lastDepreciationPeriod: afterReversal.asset?.last_depreciation_period || null,
      remainingUsefulLifeMonths: Number(afterReversal.asset?.remaining_useful_life_months || 0),
    };

    console.log("STEP-FA45 smoke passed.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    try {
      if (!KEEP_ARTIFACTS) {
        await cleanupArtifacts({
          tenantId,
          assetId: artifactState.assetId,
          categoryId: artifactState.categoryId,
          profileId: artifactState.profileId,
          runIds: artifactState.runIds,
        });
        summary.cleanup = "completed";
      }
    } catch (cleanupError) {
      summary.cleanup = `failed: ${cleanupError?.message || cleanupError}`;
      console.error("STEP-FA45 smoke cleanup failed.");
      console.error(cleanupError?.stack || cleanupError);
      process.exitCode = 1;
    } finally {
      await closePool();
    }
  }
}

main().catch((error) => {
  console.error("STEP-FA45 smoke failed.");
  console.error(error?.stack || error);
  process.exit(1);
});
