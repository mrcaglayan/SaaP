/**
 * Fixed-assets depreciation service.
 *
 * Owns schedule generation, run preview, run create/post/reverse,
 * and depreciation calculation logic.
 */
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildCariDirectionalJournalLine,
  insertPostedJournalWithLinesTx,
} from "./cari.document.service.js";
import { reverseJournalEntryTx } from "./gl.journal-reversal.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";
import {
  FIXED_ASSET_DEPRECIATION_RUN,
  FIXED_ASSET_TRANSACTION,
} from "../utils/source-ref-types.js";
import {
  loadAssetDepreciationSnapshot,
  loadAssetDepreciationLifecycleHistory,
  listDepreciationRunAssetSnapshots,
  resolveSupportedFixedAssetFiscalPeriod,
  resolveBookForLegalEntity,
  ensurePeriodOpenForFixedAssets,
  upsertDisposalCutoffPostedScheduleLineTx,
} from "./fixed-assets.service.js";

const AMOUNT_SCALE = 10000;
const ROUNDING_UNIT = 1 / AMOUNT_SCALE;
const DEFAULT_RUN_SNAPSHOT_WRITE_CHUNK_SIZE = 100;
const DEFAULT_RUN_LINE_WRITE_CHUNK_SIZE = 100;
const DEFAULT_RUN_ALLOCATION_WRITE_CHUNK_SIZE = 250;

function normalizeUpperText(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim().toUpperCase();
}

function roundAmount(value) {
  return Math.round(Number(value || 0) * AMOUNT_SCALE) / AMOUNT_SCALE;
}

function resolveChunkSize(rawValue, fallback) {
  const parsed = parsePositiveInt(rawValue);
  if (!parsed) return fallback;
  return Math.max(1, Math.min(parsed, 1000));
}

function getRunPersistenceChunkSizes() {
  return {
    scheduleSnapshots: resolveChunkSize(
      process.env.FIXED_ASSET_RUN_SNAPSHOT_WRITE_CHUNK_SIZE,
      DEFAULT_RUN_SNAPSHOT_WRITE_CHUNK_SIZE
    ),
    runLines: resolveChunkSize(
      process.env.FIXED_ASSET_RUN_LINE_WRITE_CHUNK_SIZE,
      DEFAULT_RUN_LINE_WRITE_CHUNK_SIZE
    ),
    allocations: resolveChunkSize(
      process.env.FIXED_ASSET_RUN_ALLOCATION_WRITE_CHUNK_SIZE,
      DEFAULT_RUN_ALLOCATION_WRITE_CHUNK_SIZE
    ),
  };
}

function sliceIntoChunks(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const normalizedChunkSize = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += normalizedChunkSize) {
    chunks.push(items.slice(index, index + normalizedChunkSize));
  }
  return chunks;
}

function maybeInjectRunWriteChunkFailure(stage, chunkNumber) {
  const configuredStage = normalizeUpperText(process.env.FIXED_ASSET_RUN_WRITE_FAIL_STAGE);
  const configuredChunkNumber = parsePositiveInt(process.env.FIXED_ASSET_RUN_WRITE_FAIL_CHUNK);
  if (!configuredStage || !configuredChunkNumber) {
    return;
  }
  if (configuredStage === stage && configuredChunkNumber === chunkNumber) {
    throw badRequest(
      `Injected fixed-assets run write failure at ${stage} chunk ${chunkNumber}`
    );
  }
}

function collectInsertedAutoIncrementIds(insertResult, expectedRowCount, label) {
  const firstInsertId = Number(insertResult.rows?.insertId || 0);
  const affectedRows = Number(insertResult.rows?.affectedRows || 0);

  if (affectedRows !== expectedRowCount || !firstInsertId) {
    throw badRequest(
      `Failed to persist ${label} chunk (expected ${expectedRowCount} rows, affected ${affectedRows})`
    );
  }

  // MySQL allocates consecutive AUTO_INCREMENT ids for the rows created by one
  // multi-value INSERT statement, so the inserted ids can be reconstructed from
  // insertId + chunk-local offset while preserving input order.
  return Array.from({ length: expectedRowCount }, (_unused, index) => firstInsertId + index);
}

async function insertChunkedRowsTx({
  tx,
  tableName,
  columns,
  rows,
  chunkSize,
  label,
  failureStage,
  expectInsertedIds = true,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const valuePlaceholders = `(${columns.map(() => "?").join(", ")})`;
  const insertedIds = [];
  const chunks = sliceIntoChunks(rows, chunkSize);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const chunkNumber = chunkIndex + 1;
    maybeInjectRunWriteChunkFailure(failureStage, chunkNumber);

    const result = await tx.query(
      `INSERT INTO ${tableName} (
         ${columns.join(",\n         ")}
       ) VALUES ${chunk.map(() => valuePlaceholders).join(", ")}`,
      chunk.flat()
    );

    if (expectInsertedIds) {
      insertedIds.push(
        ...collectInsertedAutoIncrementIds(result, chunk.length, label)
      );
      continue;
    }

    const affectedRows = Number(result.rows?.affectedRows || 0);
    if (affectedRows !== chunk.length) {
      throw badRequest(
        `Failed to persist ${label} chunk (expected ${chunk.length} rows, affected ${affectedRows})`
      );
    }
  }

  return insertedIds;
}

function parseDateOnly(dateText, label) {
  const text = String(dateText || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw badRequest(`${label} must be a valid date`);
  }
  return parsed;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function formatPeriodKey(date) {
  return formatDateOnly(date).slice(0, 7);
}

function derivePeriodKeyFromDate(dateText) {
  const normalized = String(dateText || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : null;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function addDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function countDaysInclusive(startDate, endDate) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((endDate.getTime() - startDate.getTime()) / dayMs) + 1;
}

function maxDate(left, right) {
  return left.getTime() >= right.getTime() ? left : right;
}

function hasLegacyOnboardingValues(asset) {
  return asset.legacyAccumDeprTxn != null
    || asset.legacyAccumDeprBase != null
    || asset.legacyNbvTxn != null
    || asset.legacyNbvBase != null;
}

function isLowValueFullyExpensedAsset(asset) {
  return normalizeUpperText(asset?.status) === "FULLY_DEPRECIATED"
    && normalizeUpperText(asset?.depreciationMethod) === "NONE"
    && Number(asset?.remainingUsefulLifeMonths || 0) === 0;
}

function getRemainingDepreciableAmount(openingNbv, salvageValue) {
  return roundAmount(Math.max(0, Number(openingNbv || 0) - Number(salvageValue || 0)));
}

function getLegacyOpeningAmounts(asset) {
  if (asset.legacyNbvTxn == null || asset.legacyNbvBase == null) {
    throw badRequest(
      "Legacy-onboarding depreciation schedule generation requires legacyNbvTxn and legacyNbvBase"
    );
  }

  return {
    openingNbvTxn: roundAmount(asset.legacyNbvTxn || 0),
    openingNbvBase: roundAmount(asset.legacyNbvBase || 0),
  };
}

function getScheduleOpeningAmounts(asset) {
  if (
    asset?.scheduleOpeningNbvTxn != null
    || asset?.scheduleOpeningNbvBase != null
  ) {
    return {
      openingNbvTxn: roundAmount(asset.scheduleOpeningNbvTxn || 0),
      openingNbvBase: roundAmount(asset.scheduleOpeningNbvBase || 0),
    };
  }

  if (hasLegacyOnboardingValues(asset)) {
    return getLegacyOpeningAmounts(asset);
  }

  return {
    openingNbvTxn: roundAmount(asset.originalCostTxn || 0),
    openingNbvBase: roundAmount(asset.originalCostBase || 0),
  };
}

function normalizeNonNegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw badRequest(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function resolveAssetRemainingUsefulLifeMonths(asset, depreciationMethod) {
  if (depreciationMethod === "NONE") {
    return asset.remainingUsefulLifeMonths != null
      ? Number(asset.remainingUsefulLifeMonths)
      : null;
  }
  if (hasLegacyOnboardingValues(asset)) {
    return normalizeNonNegativeInteger(asset.remainingUsefulLifeMonths, "remainingUsefulLifeMonths");
  }
  if (asset.usefulLifeMonths != null) {
    return normalizeNonNegativeInteger(asset.usefulLifeMonths, "usefulLifeMonths");
  }
  return normalizeNonNegativeInteger(asset.remainingUsefulLifeMonths, "remainingUsefulLifeMonths");
}

function resolveCurrentRemainingUsefulLifeMonths(asset, currentPostedScheduleCount = 0) {
  const depreciationMethod = normalizeUpperText(asset?.depreciationMethod);
  const storedRemainingUsefulLifeMonths = asset?.remainingUsefulLifeMonths != null
    ? Number(asset.remainingUsefulLifeMonths)
    : null;

  if (depreciationMethod === "NONE" || hasLegacyOnboardingValues(asset)) {
    return storedRemainingUsefulLifeMonths;
  }

  const usefulLifeMonths = asset?.usefulLifeMonths != null
    ? Number(asset.usefulLifeMonths)
    : null;
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 0) {
    return storedRemainingUsefulLifeMonths;
  }

  return Math.max(
    usefulLifeMonths - Math.max(0, Number(currentPostedScheduleCount || 0)),
    0
  );
}

function resolveDisplayScheduleSeedRemainingUsefulLifeMonths(asset) {
  const depreciationMethod = normalizeUpperText(asset?.depreciationMethod);
  if (
    depreciationMethod === "NONE"
    || normalizeUpperText(asset?.status) === "FULLY_DEPRECIATED"
    || hasLegacyOnboardingValues(asset)
  ) {
    return asset?.remainingUsefulLifeMonths ?? null;
  }

  return asset?.usefulLifeMonths != null
    ? Number(asset.usefulLifeMonths)
    : (asset?.remainingUsefulLifeMonths ?? null);
}

function mapScheduleRowForDisplay(asset, row, displayGrossAmounts = null) {
  const closingNbvTxn = roundAmount(row?.closingNbvTxn || 0);
  const closingNbvBase = roundAmount(row?.closingNbvBase || 0);
  const originalCostTxn = roundAmount(
    displayGrossAmounts?.grossAmountTxn ?? asset?.originalCostTxn ?? 0
  );
  const originalCostBase = roundAmount(
    displayGrossAmounts?.grossAmountBase ?? asset?.originalCostBase ?? 0
  );

  return {
    ...row,
    depreciationAmountTxn: roundAmount(row?.plannedAmountTxn || 0),
    depreciationAmountBase: roundAmount(row?.plannedAmountBase || 0),
    accumDepreciationTxn: roundAmount(originalCostTxn - closingNbvTxn),
    accumDepreciationBase: roundAmount(originalCostBase - closingNbvBase),
    nbvTxn: closingNbvTxn,
    nbvBase: closingNbvBase,
  };
}

function mapSkippedScheduleRowForDisplay(
  asset,
  skippedRunLine,
  row = {},
  previousRow = null,
  displayGrossAmounts = null,
) {
  const openingNbvTxn = row?.openingNbvTxn != null
    ? roundAmount(row.openingNbvTxn)
    : previousRow?.closingNbvTxn != null
      ? roundAmount(previousRow.closingNbvTxn)
      : null;
  const openingNbvBase = row?.openingNbvBase != null
    ? roundAmount(row.openingNbvBase)
    : previousRow?.closingNbvBase != null
      ? roundAmount(previousRow.closingNbvBase)
      : null;
  const closingNbvTxn = row?.closingNbvTxn != null
    ? roundAmount(row.closingNbvTxn)
    : openingNbvTxn;
  const closingNbvBase = row?.closingNbvBase != null
    ? roundAmount(row.closingNbvBase)
    : openingNbvBase;
  const originalCostTxn = roundAmount(
    displayGrossAmounts?.grossAmountTxn ?? asset?.originalCostTxn ?? 0
  );
  const originalCostBase = roundAmount(
    displayGrossAmounts?.grossAmountBase ?? asset?.originalCostBase ?? 0
  );

  return {
    ...row,
    fiscalPeriodId: row?.fiscalPeriodId ?? skippedRunLine?.fiscalPeriodId ?? null,
    periodKey: skippedRunLine?.periodKey || row?.periodKey || null,
    daysInPeriod: Number(skippedRunLine?.daysInPeriod ?? row?.daysInPeriod ?? 0),
    eligibleDays: Number(skippedRunLine?.eligibleDays ?? row?.eligibleDays ?? 0),
    plannedAmountTxn: 0,
    plannedAmountBase: 0,
    openingNbvTxn,
    openingNbvBase,
    closingNbvTxn,
    closingNbvBase,
    status: "SKIPPED",
    skipReasonCode: skippedRunLine?.skipReasonCode || row?.skipReasonCode || null,
    skipReasonText: skippedRunLine?.skipReasonText || row?.skipReasonText || null,
    depreciationAmountTxn: 0,
    depreciationAmountBase: 0,
    accumDepreciationTxn: closingNbvTxn != null
      ? roundAmount(originalCostTxn - closingNbvTxn)
      : null,
    accumDepreciationBase: closingNbvBase != null
      ? roundAmount(originalCostBase - closingNbvBase)
      : null,
    nbvTxn: closingNbvTxn,
    nbvBase: closingNbvBase,
  };
}

function calculateStraightLineFullMonthAmount(remainingDepreciable, remainingPeriods) {
  if (remainingPeriods <= 0 || remainingDepreciable <= 0) {
    return 0;
  }
  return roundAmount(remainingDepreciable / remainingPeriods);
}

function calculateDecliningBalanceFullMonthAmount(remainingDepreciable, monthlyRate) {
  if (remainingDepreciable <= 0 || monthlyRate <= 0) {
    return 0;
  }
  return roundAmount(remainingDepreciable * monthlyRate);
}

function shouldSwitchDecliningBalanceToStraightLine({
  switchToStraightLine,
  remainingPeriods,
  monthlyRate,
}) {
  if (!switchToStraightLine || remainingPeriods <= 0 || monthlyRate < 0) {
    return false;
  }

  // Comparing the full-month DB and SL amounts is equivalent to comparing
  // their per-period factors because both use the same remaining depreciable base.
  return (1 / remainingPeriods) >= monthlyRate;
}

function clampPlannedAmount({
  openingNbv,
  salvageValue,
  plannedAmount,
  absorbRoundingResidual = false,
}) {
  const remainingDepreciable = getRemainingDepreciableAmount(openingNbv, salvageValue);

  let normalizedPlannedAmount = roundAmount(Math.max(0, Number(plannedAmount || 0)));
  normalizedPlannedAmount = Math.min(normalizedPlannedAmount, remainingDepreciable);

  let closingNbv = roundAmount(Number(openingNbv || 0) - normalizedPlannedAmount);
  if (closingNbv < salvageValue) {
    normalizedPlannedAmount = remainingDepreciable;
    closingNbv = roundAmount(salvageValue);
  }

  if (absorbRoundingResidual && closingNbv > salvageValue) {
    const residual = roundAmount(closingNbv - salvageValue);
    if (residual > 0 && residual <= ROUNDING_UNIT) {
      normalizedPlannedAmount = roundAmount(normalizedPlannedAmount + residual);
      closingNbv = roundAmount(salvageValue);
    }
  }

  return {
    plannedAmount: normalizedPlannedAmount,
    closingNbv,
  };
}

function compareLifecycleEvents(left, right) {
  if (left.effectiveDate < right.effectiveDate) return -1;
  if (left.effectiveDate > right.effectiveDate) return 1;
  return Number(left.transactionId || 0) - Number(right.transactionId || 0);
}

function mapAssetDepreciationImprovementRow(row) {
  return {
    transactionId: Number(row.id),
    assetId: row.asset_id != null ? Number(row.asset_id) : null,
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    postingDate: row.posting_date ? String(row.posting_date).slice(0, 10) : null,
    sourceRefType: row.source_ref_type || null,
    sourceRefId: row.source_ref_id != null ? Number(row.source_ref_id) : null,
    sourceRefLineId: row.source_ref_line_id != null ? Number(row.source_ref_line_id) : null,
    grossAmountTxn: row.gross_amount_txn != null ? Number(row.gross_amount_txn) : null,
    grossAmountBase: row.gross_amount_base != null ? Number(row.gross_amount_base) : null,
    preCostTxn: row.improvement_pre_cost_txn != null ? Number(row.improvement_pre_cost_txn) : null,
    preCostBase: row.improvement_pre_cost_base != null ? Number(row.improvement_pre_cost_base) : null,
    revisedUsefulLifeMonths: row.improvement_revised_useful_life_months != null
      ? Number(row.improvement_revised_useful_life_months)
      : null,
    lifeExtensionMonths: row.improvement_life_extension_months != null
      ? Number(row.improvement_life_extension_months)
      : null,
    preUsefulLifeMonths: row.improvement_pre_useful_life_months != null
      ? Number(row.improvement_pre_useful_life_months)
      : null,
    preRemainingUsefulLifeMonths: row.improvement_pre_remaining_life_months != null
      ? Number(row.improvement_pre_remaining_life_months)
      : null,
  };
}

async function loadAssetDepreciationImprovementHistory({
  tenantId,
  assetId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT fat.id,
            fat.asset_id,
            fat.effective_date,
            fat.posting_date,
            fat.source_ref_type,
            fat.source_ref_id,
            fat.source_ref_line_id,
            fat.gross_amount_txn,
            fat.gross_amount_base,
            fat.improvement_pre_cost_txn,
            fat.improvement_pre_cost_base,
            fat.improvement_revised_useful_life_months,
            fat.improvement_life_extension_months,
            fat.improvement_pre_useful_life_months,
            fat.improvement_pre_remaining_life_months
       FROM fixed_asset_transactions fat
      WHERE fat.tenant_id = ?
        AND fat.asset_id = ?
        AND fat.transaction_type = 'IMPROVEMENT'
        AND fat.status = 'POSTED'
        AND fat.reversal_transaction_id IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM fixed_asset_transactions rev
           WHERE rev.reversed_transaction_id = fat.id
             AND rev.status = 'POSTED'
        )
      ORDER BY fat.effective_date ASC, fat.id ASC`,
    [tenantId, assetId]
  );

  return (result.rows || []).map(mapAssetDepreciationImprovementRow);
}

async function loadAssetDepreciationImprovementHistoryByAssetIds({
  tenantId,
  assetIds,
  queryFn = query,
}) {
  const normalizedAssetIds = getDistinctIds(assetIds);
  if (!tenantId) throw badRequest("tenantId is required");

  const groupedHistory = new Map(
    normalizedAssetIds.map((assetId) => [Number(assetId), []])
  );
  if (!normalizedAssetIds.length) {
    return groupedHistory;
  }

  const placeholders = normalizedAssetIds.map(() => "?").join(", ");
  const result = await queryFn(
    `SELECT fat.id,
            fat.asset_id,
            fat.effective_date,
            fat.posting_date,
            fat.source_ref_type,
            fat.source_ref_id,
            fat.source_ref_line_id,
            fat.gross_amount_txn,
            fat.gross_amount_base,
            fat.improvement_pre_cost_txn,
            fat.improvement_pre_cost_base,
            fat.improvement_revised_useful_life_months,
            fat.improvement_life_extension_months,
            fat.improvement_pre_useful_life_months,
            fat.improvement_pre_remaining_life_months
       FROM fixed_asset_transactions fat
      WHERE fat.tenant_id = ?
        AND fat.asset_id IN (${placeholders})
        AND fat.transaction_type = 'IMPROVEMENT'
        AND fat.status = 'POSTED'
        AND fat.reversal_transaction_id IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM fixed_asset_transactions rev
           WHERE rev.reversed_transaction_id = fat.id
             AND rev.status = 'POSTED'
        )
      ORDER BY fat.asset_id ASC, fat.effective_date ASC, fat.id ASC`,
    [tenantId, ...normalizedAssetIds]
  );

  for (const historyRow of (result.rows || []).map(mapAssetDepreciationImprovementRow)) {
    const assetId = Number(historyRow.assetId);
    const assetHistory = groupedHistory.get(assetId) || [];
    assetHistory.push(historyRow);
    groupedHistory.set(assetId, assetHistory);
  }

  return groupedHistory;
}

function sameSourceReference(left, right) {
  const leftType = normalizeUpperText(left?.sourceRefType);
  const rightType = normalizeUpperText(right?.sourceRefType);
  const leftHasSourceIdentity = Boolean(
    leftType
    || left?.sourceRefId != null
    || left?.sourceRefLineId != null
  );
  const rightHasSourceIdentity = Boolean(
    rightType
    || right?.sourceRefId != null
    || right?.sourceRefLineId != null
  );
  if (!leftHasSourceIdentity || !rightHasSourceIdentity) {
    return false;
  }

  return leftType === rightType
    && Number(left?.sourceRefId || 0) === Number(right?.sourceRefId || 0)
    && Number(left?.sourceRefLineId || 0) === Number(right?.sourceRefLineId || 0);
}

function resolveCurrentRetroImprovementTransactionId({
  improvementHistory = [],
  improvementTransactionId = null,
  improvementEffectiveDate = null,
  postingDate = null,
  sourceRefType = null,
  sourceRefId = null,
  sourceRefLineId = null,
}) {
  const normalizedTransactionId = parsePositiveInt(improvementTransactionId);
  if (normalizedTransactionId) {
    return normalizedTransactionId;
  }

  const sourceIdentity = {
    sourceRefType,
    sourceRefId,
    sourceRefLineId,
  };
  const normalizedEffectiveDate = String(improvementEffectiveDate || "").slice(0, 10);
  const normalizedPostingDate = String(postingDate || "").slice(0, 10);
  const candidates = (Array.isArray(improvementHistory) ? improvementHistory : [])
    .filter((historyRow) => {
      if (!sameSourceReference(historyRow, sourceIdentity)) {
        return false;
      }
      if (normalizedEffectiveDate && String(historyRow?.effectiveDate || "").slice(0, 10) !== normalizedEffectiveDate) {
        return false;
      }
      if (normalizedPostingDate && String(historyRow?.postingDate || "").slice(0, 10) !== normalizedPostingDate) {
        return false;
      }
      return true;
    })
    .sort(compareLifecycleEvents);

  return parsePositiveInt(candidates.at(-1)?.transactionId);
}

function buildPeriodKeyRangeSet(startPeriodKey, endPeriodKey) {
  const periodKeys = new Set();
  const normalizedStartPeriodKey = String(startPeriodKey || "").trim();
  const normalizedEndPeriodKey = String(endPeriodKey || "").trim();
  if (
    !/^\d{4}-\d{2}$/.test(normalizedStartPeriodKey)
    || !/^\d{4}-\d{2}$/.test(normalizedEndPeriodKey)
    || comparePeriodKeys(normalizedStartPeriodKey, normalizedEndPeriodKey) > 0
  ) {
    return periodKeys;
  }

  let cursor = startOfMonth(parseDateOnly(`${normalizedStartPeriodKey}-01`, "startPeriodKey"));
  const endMonth = startOfMonth(parseDateOnly(`${normalizedEndPeriodKey}-01`, "endPeriodKey"));
  while (cursor.getTime() <= endMonth.getTime()) {
    periodKeys.add(formatPeriodKey(cursor));
    cursor = addMonths(cursor, 1);
  }

  return periodKeys;
}

async function loadPostedCatchUpDepreciationTransactionsForAsset({
  tenantId,
  assetId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT fat.id,
            fat.asset_id,
            fat.effective_date,
            fat.posting_date,
            fat.source_ref_type,
            fat.source_ref_id,
            fat.source_ref_line_id
       FROM fixed_asset_transactions fat
      WHERE fat.tenant_id = ?
        AND fat.asset_id = ?
        AND fat.transaction_type = 'DEPRECIATION'
        AND fat.depreciation_kind = 'CATCH_UP'
        AND fat.status = 'POSTED'
        AND fat.reversal_transaction_id IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM fixed_asset_transactions rev
           WHERE rev.reversed_transaction_id = fat.id
             AND rev.status = 'POSTED'
        )
      ORDER BY fat.effective_date ASC, fat.id ASC`,
    [tenantId, assetId]
  );

  return (result.rows || []).map((row) => ({
    transactionId: Number(row.id),
    assetId: row.asset_id != null ? Number(row.asset_id) : null,
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    postingDate: row.posting_date ? String(row.posting_date).slice(0, 10) : null,
    sourceRefType: row.source_ref_type || null,
    sourceRefId: row.source_ref_id != null ? Number(row.source_ref_id) : null,
    sourceRefLineId: row.source_ref_line_id != null ? Number(row.source_ref_line_id) : null,
  }));
}

function resolveRetroImprovementCorrectedPeriodKeys({
  improvementHistory = [],
  catchUpTransactions = [],
}) {
  const correctedPeriodKeys = new Set();

  for (const catchUpTransaction of catchUpTransactions || []) {
    const matchingImprovement = (improvementHistory || []).find((historyRow) => (
      sameSourceReference(historyRow, catchUpTransaction)
    ));
    if (!matchingImprovement) {
      continue;
    }

    const startPeriodKey = derivePeriodKeyFromDate(matchingImprovement.effectiveDate);
    const endPeriodKey = derivePeriodKeyFromDate(catchUpTransaction.effectiveDate);
    for (const periodKey of buildPeriodKeyRangeSet(startPeriodKey, endPeriodKey)) {
      correctedPeriodKeys.add(periodKey);
    }
  }

  return correctedPeriodKeys;
}

async function buildCorrectedHistoricalRowsByPeriodKey({
  tenantId,
  asset,
  book,
  depreciationMethod,
  lifecycleHistory = [],
  improvementHistory = [],
  throughPeriodKey,
  queryFn = query,
}) {
  const normalizedThroughPeriodKey = String(throughPeriodKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalizedThroughPeriodKey)) {
    return new Map();
  }

  const requestedMonthCountFloor = calculateInclusiveMonthCount(
    asset.inServiceDate,
    normalizedThroughPeriodKey
  );
  if (requestedMonthCountFloor <= 0) {
    return new Map();
  }

  const improvementAwareSeed = resolveImprovementAwareScheduleSeed({
    asset,
    currentPostedScheduleLines: [],
    currentPostedScheduleCount: 0,
    baseRemainingUsefulLifeMonths: resolveAssetRemainingUsefulLifeMonths(
      asset,
      depreciationMethod
    ),
    scheduleStartDate: asset.inServiceDate,
    improvementHistory,
  });
  const requestedMonthCount = Math.max(
    Number(improvementAwareSeed.requestedMonthCount || 0),
    requestedMonthCountFloor
  );
  if (requestedMonthCount <= 0) {
    return new Map();
  }

  const periodResolution = await loadSchedulePeriodsForRange({
    calendarId: book.calendar_id,
    startDate: asset.inServiceDate,
    monthCount: requestedMonthCount,
    queryFn,
  });
  const correctedRows = buildDepreciationScheduleRows(
    improvementAwareSeed.scheduleSeedAsset,
    periodResolution.periods,
    lifecycleHistory,
    {
      requestedMonthCount,
      postedScheduleCount: 0,
      initialRemainingUsefulLifeMonths:
        improvementAwareSeed.initialRemainingUsefulLifeMonths,
      improvementHistory: improvementAwareSeed.futureImprovements,
    }
  );

  return new Map(
    correctedRows.map((row) => [row.periodKey, row])
  );
}

function deriveImprovementCostDelta(historyRow, fieldLabel) {
  const nextValue = historyRow?.[fieldLabel];
  const preValue = fieldLabel === "grossAmountTxn"
    ? historyRow?.preCostTxn
    : historyRow?.preCostBase;
  if (nextValue == null || preValue == null) {
    throw badRequest(
      `Improvement transaction ${historyRow?.transactionId || "UNKNOWN"} is missing persisted ` +
      `pre/post cost state required for depreciation schedule reseeding`
    );
  }
  return roundAmount(Number(nextValue) - Number(preValue));
}

function applyImprovementLifeChangeToScheduleSnapshot({
  currentUsefulLifeMonths = null,
  currentRemainingUsefulLifeMonths = null,
  revisedUsefulLifeMonths = null,
  lifeExtensionMonths = null,
}) {
  let nextUsefulLifeMonths = currentUsefulLifeMonths;
  let nextRemainingUsefulLifeMonths = currentRemainingUsefulLifeMonths;
  const elapsedLifeMonths = (
    currentUsefulLifeMonths != null
    && currentRemainingUsefulLifeMonths != null
  )
    ? Math.max(
      Number(currentUsefulLifeMonths) - Number(currentRemainingUsefulLifeMonths),
      0
    )
    : 0;

  if (revisedUsefulLifeMonths != null) {
    nextUsefulLifeMonths = Number(revisedUsefulLifeMonths);
    nextRemainingUsefulLifeMonths = Math.max(
      Number(revisedUsefulLifeMonths) - elapsedLifeMonths,
      0
    );
  } else if (lifeExtensionMonths != null) {
    nextRemainingUsefulLifeMonths = Math.max(
      Number(currentRemainingUsefulLifeMonths || 0) + Number(lifeExtensionMonths),
      0
    );
    nextUsefulLifeMonths = Math.max(
      elapsedLifeMonths + nextRemainingUsefulLifeMonths,
      0
    );
  }

  return {
    usefulLifeMonths: nextUsefulLifeMonths,
    remainingUsefulLifeMonths: nextRemainingUsefulLifeMonths,
  };
}

function buildAssetSnapshotBeforeImprovement(
  asset,
  improvementHistoryRow,
  improvementHistory = []
) {
  if (!improvementHistoryRow) {
    return asset;
  }

  const costDeltaTxn = deriveImprovementCostDelta(
    improvementHistoryRow,
    "grossAmountTxn"
  );
  const costDeltaBase = deriveImprovementCostDelta(
    improvementHistoryRow,
    "grossAmountBase"
  );
  let usefulLifeMonths = asset.usefulLifeMonths;
  let remainingUsefulLifeMonths = asset.remainingUsefulLifeMonths;

  if (
    improvementHistoryRow.revisedUsefulLifeMonths != null
    || improvementHistoryRow.lifeExtensionMonths != null
  ) {
    usefulLifeMonths = improvementHistoryRow.preUsefulLifeMonths != null
      ? Number(improvementHistoryRow.preUsefulLifeMonths)
      : asset.usefulLifeMonths;
    remainingUsefulLifeMonths = improvementHistoryRow.preRemainingUsefulLifeMonths != null
      ? Number(improvementHistoryRow.preRemainingUsefulLifeMonths)
      : asset.remainingUsefulLifeMonths;

    const laterImprovements = (Array.isArray(improvementHistory) ? improvementHistory : [])
      .filter((historyRow) => (
        compareLifecycleEvents(historyRow, improvementHistoryRow) > 0
      ));

    for (const laterImprovement of laterImprovements) {
      const replayedLifeState = applyImprovementLifeChangeToScheduleSnapshot({
        currentUsefulLifeMonths: usefulLifeMonths,
        currentRemainingUsefulLifeMonths: remainingUsefulLifeMonths,
        revisedUsefulLifeMonths: laterImprovement.revisedUsefulLifeMonths,
        lifeExtensionMonths: laterImprovement.lifeExtensionMonths,
      });
      usefulLifeMonths = replayedLifeState.usefulLifeMonths;
      remainingUsefulLifeMonths = replayedLifeState.remainingUsefulLifeMonths;
    }
  }

  return {
    ...asset,
    originalCostTxn: roundAmount(Number(asset.originalCostTxn || 0) - costDeltaTxn),
    originalCostBase: roundAmount(Number(asset.originalCostBase || 0) - costDeltaBase),
    usefulLifeMonths,
    remainingUsefulLifeMonths,
  };
}

function resolveImprovementSchedulePeriodKey(effectiveDate) {
  return formatPeriodKey(parseDateOnly(effectiveDate, "improvement.effectiveDate"));
}

function resolveDepreciationGrossAmountsForPeriod({
  asset,
  improvementHistory = [],
  periodKey,
}) {
  const normalizedPeriodKey = String(periodKey || "").trim();
  let grossAmountTxn = roundAmount(asset?.originalCostTxn || 0);
  let grossAmountBase = roundAmount(asset?.originalCostBase || 0);

  for (const historyRow of improvementHistory || []) {
    const effectivePeriodKey = resolveImprovementSchedulePeriodKey(historyRow?.effectiveDate);
    if (normalizedPeriodKey && comparePeriodKeys(effectivePeriodKey, normalizedPeriodKey) > 0) {
      grossAmountTxn = roundAmount(
        grossAmountTxn - deriveImprovementCostDelta(historyRow, "grossAmountTxn")
      );
      grossAmountBase = roundAmount(
        grossAmountBase - deriveImprovementCostDelta(historyRow, "grossAmountBase")
      );
    }
  }

  return {
    grossAmountTxn,
    grossAmountBase,
  };
}

function buildImprovementTimeline(improvementHistory, periods) {
  const eventsByPeriodKey = new Map();
  if (!periods.length || !Array.isArray(improvementHistory) || !improvementHistory.length) {
    return { eventsByPeriodKey };
  }

  const firstPeriodKey = String(periods[0]?.periodKey || "").trim();
  for (const historyRow of improvementHistory) {
    const effectiveDate = String(historyRow?.effectiveDate || "").slice(0, 10);
    if (!effectiveDate) {
      throw badRequest("Improvement history row is missing effectiveDate");
    }

    const effectivePeriodKey = resolveImprovementSchedulePeriodKey(effectiveDate);
    if (!effectivePeriodKey || comparePeriodKeys(effectivePeriodKey, firstPeriodKey) < 0) {
      continue;
    }

    const event = {
      transactionId: historyRow.transactionId,
      effectiveDate,
      effectivePeriodKey,
      costDeltaTxn: deriveImprovementCostDelta(historyRow, "grossAmountTxn"),
      costDeltaBase: deriveImprovementCostDelta(historyRow, "grossAmountBase"),
      revisedUsefulLifeMonths: historyRow.revisedUsefulLifeMonths,
      lifeExtensionMonths: historyRow.lifeExtensionMonths,
    };

    const existing = eventsByPeriodKey.get(effectivePeriodKey) || [];
    existing.push(event);
    existing.sort(compareLifecycleEvents);
    eventsByPeriodKey.set(effectivePeriodKey, existing);
  }

  return {
    eventsByPeriodKey,
  };
}

function splitAllocationSegmentsByImprovementDates(allocationSegments, improvementEvents) {
  const normalizedSegments = Array.isArray(allocationSegments)
    ? allocationSegments.filter((segment) => Number(segment?.eligibleDays || 0) > 0)
    : [];
  if (!normalizedSegments.length) {
    return [];
  }

  const splitDates = [...new Set(
    (Array.isArray(improvementEvents) ? improvementEvents : [])
      .map((event) => String(event?.effectiveDate || "").slice(0, 10))
      .filter(Boolean)
  )].sort();
  if (!splitDates.length) {
    return normalizedSegments.map((segment) => ({
      allocationType: segment.allocationType || "OWNER_OU",
      operatingUnitId: segment.operatingUnitId != null ? Number(segment.operatingUnitId) : null,
      fromDate: segment.fromDate,
      toDate: segment.toDate,
      eligibleDays: Number(segment.eligibleDays || 0),
    }));
  }

  const splitSegments = [];
  for (const segment of normalizedSegments) {
    const segmentEnd = parseDateOnly(segment.toDate, "allocationSegment.toDate");
    let currentStart = parseDateOnly(segment.fromDate, "allocationSegment.fromDate");
    const boundaryDates = splitDates.filter((dateText) => (
      dateText > formatDateOnly(currentStart)
      && dateText <= formatDateOnly(segmentEnd)
    ));

    for (const boundaryDateText of [...boundaryDates, null]) {
      const currentEnd = boundaryDateText
        ? addDays(parseDateOnly(boundaryDateText, "improvement.effectiveDate"), -1)
        : segmentEnd;
      if (currentStart.getTime() > currentEnd.getTime()) {
        if (boundaryDateText) {
          currentStart = parseDateOnly(boundaryDateText, "improvement.effectiveDate");
        }
        continue;
      }

      splitSegments.push({
        allocationType: segment.allocationType || "OWNER_OU",
        operatingUnitId: segment.operatingUnitId != null ? Number(segment.operatingUnitId) : null,
        fromDate: formatDateOnly(currentStart),
        toDate: formatDateOnly(currentEnd),
        eligibleDays: countDaysInclusive(currentStart, currentEnd),
      });

      if (boundaryDateText) {
        currentStart = parseDateOnly(boundaryDateText, "improvement.effectiveDate");
      }
    }
  }

  return splitSegments;
}

function resolveImprovementAwareScheduleSeed({
  asset,
  currentPostedScheduleLines,
  currentPostedScheduleCount,
  baseRemainingUsefulLifeMonths,
  scheduleStartDate,
  improvementHistory,
  latestCatchUpDepreciation = null,
}) {
  const lastPostedScheduleLine = currentPostedScheduleLines.at(-1) || null;
  const catchUpSeedPeriodKey = latestCatchUpDepreciation?.effectiveDate
    ? derivePeriodKeyFromDate(latestCatchUpDepreciation.effectiveDate)
    : null;
  const canUseCatchUpSeed = (
    currentPostedScheduleCount > 0
    && lastPostedScheduleLine
    && catchUpSeedPeriodKey
    && comparePeriodKeys(catchUpSeedPeriodKey, lastPostedScheduleLine.periodKey) >= 0
    && latestCatchUpDepreciation.nbvAmountTxn != null
    && latestCatchUpDepreciation.nbvAmountBase != null
  );
  const seedOpeningAmounts = currentPostedScheduleCount > 0
    ? {
      openingNbvTxn: canUseCatchUpSeed
        ? roundAmount(latestCatchUpDepreciation.nbvAmountTxn || 0)
        : roundAmount(lastPostedScheduleLine?.closingNbvTxn || 0),
      openingNbvBase: canUseCatchUpSeed
        ? roundAmount(latestCatchUpDepreciation.nbvAmountBase || 0)
        : roundAmount(lastPostedScheduleLine?.closingNbvBase || 0),
    }
    : getScheduleOpeningAmounts(asset);
  const futureImprovements = [];

  for (const historyRow of improvementHistory || []) {
    const effectiveDate = String(historyRow?.effectiveDate || "").slice(0, 10);
    if (!effectiveDate) {
      throw badRequest("Improvement history row is missing effectiveDate");
    }
    if (effectiveDate >= scheduleStartDate) {
      futureImprovements.push(historyRow);
    }
  }

  let openingNbvTxn = seedOpeningAmounts.openingNbvTxn;
  let openingNbvBase = seedOpeningAmounts.openingNbvBase;

  if (currentPostedScheduleCount <= 0 && !hasLegacyOnboardingValues(asset)) {
    for (const historyRow of futureImprovements) {
      openingNbvTxn = roundAmount(
        openingNbvTxn - deriveImprovementCostDelta(historyRow, "grossAmountTxn")
      );
      openingNbvBase = roundAmount(
        openingNbvBase - deriveImprovementCostDelta(historyRow, "grossAmountBase")
      );
    }
  }

  const firstFutureImprovement = futureImprovements[0] || null;
  const initialRemainingUsefulLifeMonths = currentPostedScheduleCount <= 0
    ? (
      firstFutureImprovement?.preUsefulLifeMonths != null
        ? Number(firstFutureImprovement.preUsefulLifeMonths)
        : Number(baseRemainingUsefulLifeMonths || 0)
    )
    : (
      firstFutureImprovement?.preRemainingUsefulLifeMonths != null
        ? Number(firstFutureImprovement.preRemainingUsefulLifeMonths)
        : Number(baseRemainingUsefulLifeMonths || 0)
    );
  const requestedMonthCount = Math.max(
    Number(baseRemainingUsefulLifeMonths || 0),
    Number(initialRemainingUsefulLifeMonths || 0)
  );

  return {
    scheduleSeedAsset: {
      ...asset,
      scheduleOpeningNbvTxn: openingNbvTxn,
      scheduleOpeningNbvBase: openingNbvBase,
    },
    futureImprovements,
    initialRemainingUsefulLifeMonths,
    requestedMonthCount,
  };
}

function applyLifecycleEventToState(state, event) {
  if (!event) return;

  if (event.kind === "SUSPEND") {
    state.isActive = false;
    return;
  }
  if (event.kind === "REACTIVATE") {
    state.isActive = true;
    return;
  }
  if (event.kind === "OWNERSHIP_TRANSFER") {
    state.ownerOperatingUnitId = event.toOwnerOperatingUnitId;
    return;
  }
  if (event.kind === "TERMINAL_DISPOSAL") {
    state.isActive = false;
    state.isDisposed = true;
  }
}

function applyImprovementEventToScheduleState(state, event, elapsedLifeMonths) {
  if (!event) return;

  state.openingNbvTxn = roundAmount(state.openingNbvTxn + Number(event.costDeltaTxn || 0));
  state.openingNbvBase = roundAmount(state.openingNbvBase + Number(event.costDeltaBase || 0));

  if (event.revisedUsefulLifeMonths != null) {
    state.remainingPeriodsCounter = Math.max(
      Number(event.revisedUsefulLifeMonths) - Math.max(0, Number(elapsedLifeMonths || 0)),
      0
    );
    return;
  }

  if (event.lifeExtensionMonths != null) {
    state.remainingPeriodsCounter = Math.max(
      Number(state.remainingPeriodsCounter || 0) + Number(event.lifeExtensionMonths),
      0
    );
  }
}

function resolveInitialOwnerOperatingUnitId(currentOwnerOperatingUnitId, ownershipTransferEvents) {
  if (!ownershipTransferEvents.length) {
    return currentOwnerOperatingUnitId != null ? Number(currentOwnerOperatingUnitId) : null;
  }

  const reversedTransferEvents = [...ownershipTransferEvents].sort((left, right) => (
    compareLifecycleEvents(right, left)
  ));

  let inferredOwnerOperatingUnitId = currentOwnerOperatingUnitId != null
    ? Number(currentOwnerOperatingUnitId)
    : (
      ownershipTransferEvents.at(-1)?.toOwnerOperatingUnitId
      ?? ownershipTransferEvents.at(-1)?.fromOwnerOperatingUnitId
      ?? null
    );

  for (const transferEvent of reversedTransferEvents) {
    if (transferEvent.fromOwnerOperatingUnitId == null || transferEvent.toOwnerOperatingUnitId == null) {
      throw badRequest(
        `Ownership transfer transaction ${transferEvent.transactionId} is missing persisted owner-OU detail`
      );
    }

    inferredOwnerOperatingUnitId = Number(transferEvent.fromOwnerOperatingUnitId);
  }

  return inferredOwnerOperatingUnitId;
}

function buildLifecycleTimeline(asset, lifecycleHistory, periods) {
  const lifecycleEvents = [];

  for (const historyRow of lifecycleHistory || []) {
    const transactionType = normalizeUpperText(historyRow.transactionType);
    const effectiveDate = String(historyRow.effectiveDate || "").slice(0, 10);
    if (!effectiveDate) {
      throw badRequest("Lifecycle history row is missing effectiveDate");
    }

    if (transactionType === "SUSPEND") {
      lifecycleEvents.push({
        transactionId: historyRow.transactionId,
        effectiveDate,
        kind: "SUSPEND",
      });
      continue;
    }

    if (transactionType === "REACTIVATE") {
      lifecycleEvents.push({
        transactionId: historyRow.transactionId,
        effectiveDate,
        kind: "REACTIVATE",
      });
      continue;
    }

    if (transactionType === "OWNERSHIP_TRANSFER") {
      lifecycleEvents.push({
        transactionId: historyRow.transactionId,
        effectiveDate,
        kind: "OWNERSHIP_TRANSFER",
        fromOwnerOperatingUnitId: historyRow.fromOwnerOperatingUnitId,
        toOwnerOperatingUnitId: historyRow.toOwnerOperatingUnitId,
      });
      continue;
    }

    if (transactionType === "WRITEOFF" || transactionType === "SALE") {
      lifecycleEvents.push({
        transactionId: historyRow.transactionId,
        effectiveDate,
        kind: "TERMINAL_DISPOSAL",
      });
    }
  }

  if (
    asset.disposalDate
    && !lifecycleEvents.some((event) => event.kind === "TERMINAL_DISPOSAL")
  ) {
    lifecycleEvents.push({
      transactionId: 0,
      effectiveDate: String(asset.disposalDate).slice(0, 10),
      kind: "TERMINAL_DISPOSAL",
    });
  }

  lifecycleEvents.sort(compareLifecycleEvents);

  const ownershipTransferEvents = lifecycleEvents.filter((event) => event.kind === "OWNERSHIP_TRANSFER");
  const initialOwnerOperatingUnitId = resolveInitialOwnerOperatingUnitId(
    asset.ownerOperatingUnitId,
    ownershipTransferEvents
  );

  const eventsByDate = new Map();
  for (const event of lifecycleEvents) {
    const existing = eventsByDate.get(event.effectiveDate) || [];
    existing.push(event);
    existing.sort((left, right) => Number(left.transactionId || 0) - Number(right.transactionId || 0));
    eventsByDate.set(event.effectiveDate, existing);
  }

  const firstPeriodStart = parseDateOnly(periods[0]?.startDate, "period.startDate");
  const initialState = {
    isActive: true,
    isDisposed: false,
    ownerOperatingUnitId: initialOwnerOperatingUnitId,
  };

  for (const event of lifecycleEvents) {
    if (event.effectiveDate >= formatDateOnly(firstPeriodStart)) {
      break;
    }
    applyLifecycleEventToState(initialState, event);
  }

  const terminalDisposalEvent = lifecycleEvents.find((event) => event.kind === "TERMINAL_DISPOSAL");
  const terminalCutoffDate = terminalDisposalEvent?.effectiveDate
    || (asset.disposalDate ? String(asset.disposalDate).slice(0, 10) : null);

  if (normalizeUpperText(asset.status) === "SUSPENDED") {
    const hasSuspendHistory = lifecycleEvents.some((event) => event.kind === "SUSPEND");
    if (!hasSuspendHistory) {
      throw badRequest(
        "SUSPENDED asset schedule generation requires persisted SUSPEND lifecycle history"
      );
    }
  }

  if (normalizeUpperText(asset.status) === "DISPOSED" && !terminalCutoffDate) {
    throw badRequest(
      "DISPOSED asset schedule generation requires disposalDate or persisted disposal history"
    );
  }

  return {
    eventsByDate,
    initialState,
    terminalCutoffDate,
  };
}

function buildPeriodEligibility(periodStart, periodEnd, inServiceDate, lifecycleTimeline, lifecycleState) {
  const allocationSegments = [];
  let eligibleDays = 0;
  let lifecycleExcludedDays = 0;
  let cursor = new Date(periodStart.getTime());

  while (cursor.getTime() <= periodEnd.getTime()) {
    const cursorDateText = formatDateOnly(cursor);
    const effectiveDateEvents = lifecycleTimeline.eventsByDate.get(cursorDateText) || [];
    for (const event of effectiveDateEvents) {
      applyLifecycleEventToState(lifecycleState, event);
    }

    const isEligibleDay = cursor.getTime() >= inServiceDate.getTime()
      && lifecycleState.isActive
      && !lifecycleState.isDisposed;

    if (isEligibleDay) {
      eligibleDays += 1;
      const previousSegment = allocationSegments.at(-1);
      if (
        previousSegment
        && previousSegment.operatingUnitId === lifecycleState.ownerOperatingUnitId
        && previousSegment.toDate === formatDateOnly(addDays(cursor, -1))
      ) {
        previousSegment.toDate = cursorDateText;
        previousSegment.eligibleDays += 1;
      } else {
        allocationSegments.push({
          allocationType: "OWNER_OU",
          operatingUnitId: lifecycleState.ownerOperatingUnitId,
          fromDate: cursorDateText,
          toDate: cursorDateText,
          eligibleDays: 1,
        });
      }
    } else if (
      cursor.getTime() >= inServiceDate.getTime()
      && (!lifecycleState.isActive || lifecycleState.isDisposed)
    ) {
      lifecycleExcludedDays += 1;
    }

    cursor = addDays(cursor, 1);
  }

  return {
    eligibleDays,
    lifecycleExcludedDays,
    allocationSegments,
  };
}

function resolveDepreciationComputationForOpening({
  asset,
  depreciationMethod,
  openingNbvTxn,
  openingNbvBase,
  salvageValueTxn,
  salvageValueBase,
  remainingPeriods,
  monthlyDecliningBalanceRate,
  hasSwitchedToStraightLine,
}) {
  const remainingDepreciableTxn = getRemainingDepreciableAmount(openingNbvTxn, salvageValueTxn);
  const remainingDepreciableBase = getRemainingDepreciableAmount(openingNbvBase, salvageValueBase);

  let effectiveMethod = depreciationMethod;
  let nextHasSwitchedToStraightLine = hasSwitchedToStraightLine;
  if (
    depreciationMethod === "DECLINING_BALANCE"
    && (
      nextHasSwitchedToStraightLine
      || shouldSwitchDecliningBalanceToStraightLine({
        switchToStraightLine: asset.switchToStraightLine,
        remainingPeriods,
        monthlyRate: monthlyDecliningBalanceRate,
      })
    )
  ) {
    nextHasSwitchedToStraightLine = true;
    effectiveMethod = "STRAIGHT_LINE";
  }

  let fullMonthAmountTxn = 0;
  let fullMonthAmountBase = 0;
  if (effectiveMethod === "STRAIGHT_LINE") {
    fullMonthAmountTxn = calculateStraightLineFullMonthAmount(
      remainingDepreciableTxn,
      remainingPeriods
    );
    fullMonthAmountBase = calculateStraightLineFullMonthAmount(
      remainingDepreciableBase,
      remainingPeriods
    );
  } else if (effectiveMethod === "DECLINING_BALANCE") {
    fullMonthAmountTxn = calculateDecliningBalanceFullMonthAmount(
      remainingDepreciableTxn,
      monthlyDecliningBalanceRate
    );
    fullMonthAmountBase = calculateDecliningBalanceFullMonthAmount(
      remainingDepreciableBase,
      monthlyDecliningBalanceRate
    );
  }

  return {
    effectiveMethod,
    hasSwitchedToStraightLine: nextHasSwitchedToStraightLine,
    remainingDepreciableTxn,
    remainingDepreciableBase,
    fullMonthAmountTxn,
    fullMonthAmountBase,
  };
}

function calculatePeriodProratedSchedule({
  asset,
  period,
  daysInPeriod,
  periodEligibility,
  periodImprovementEvents,
  depreciationMethod,
  salvageValueTxn,
  salvageValueBase,
  monthlyDecliningBalanceRate,
  hasSwitchedToStraightLine,
  openingNbvTxn,
  openingNbvBase,
  remainingPeriodsCounter,
  elapsedLifeMonths,
}) {
  const improvementEvents = Array.isArray(periodImprovementEvents)
    ? [...periodImprovementEvents].sort(compareLifecycleEvents)
    : [];
  const allocationSegments = splitAllocationSegmentsByImprovementDates(
    periodEligibility.allocationSegments,
    improvementEvents
  );
  const scheduleState = {
    openingNbvTxn: roundAmount(openingNbvTxn || 0),
    openingNbvBase: roundAmount(openingNbvBase || 0),
    remainingPeriodsCounter: Math.max(Number(remainingPeriodsCounter || 0), 0),
  };
  const computedSegments = [];
  let currentHasSwitchedToStraightLine = hasSwitchedToStraightLine;
  let improvementIndex = 0;
  const periodEndText = String(period.endDate || "").slice(0, 10);

  const applyImprovementEventsThrough = (throughDateText) => {
    while (
      improvementIndex < improvementEvents.length
      && improvementEvents[improvementIndex].effectiveDate <= throughDateText
    ) {
      applyImprovementEventToScheduleState(
        scheduleState,
        improvementEvents[improvementIndex],
        elapsedLifeMonths
      );
      improvementIndex += 1;
    }
  };

  for (const allocationSegment of allocationSegments) {
    applyImprovementEventsThrough(allocationSegment.fromDate);

    const remainingPeriods = Math.max(Number(scheduleState.remainingPeriodsCounter || 0), 0);
    const computation = resolveDepreciationComputationForOpening({
      asset,
      depreciationMethod,
      openingNbvTxn: scheduleState.openingNbvTxn,
      openingNbvBase: scheduleState.openingNbvBase,
      salvageValueTxn,
      salvageValueBase,
      remainingPeriods,
      monthlyDecliningBalanceRate,
      hasSwitchedToStraightLine: currentHasSwitchedToStraightLine,
    });
    currentHasSwitchedToStraightLine = computation.hasSwitchedToStraightLine;

    let plannedAmountTxn = roundAmount(
      computation.fullMonthAmountTxn * (Number(allocationSegment.eligibleDays || 0) / daysInPeriod)
    );
    let plannedAmountBase = roundAmount(
      computation.fullMonthAmountBase * (Number(allocationSegment.eligibleDays || 0) / daysInPeriod)
    );
    plannedAmountTxn = Math.min(plannedAmountTxn, computation.remainingDepreciableTxn);
    plannedAmountBase = Math.min(plannedAmountBase, computation.remainingDepreciableBase);

    const txnAmounts = clampPlannedAmount({
      openingNbv: scheduleState.openingNbvTxn,
      salvageValue: salvageValueTxn,
      plannedAmount: plannedAmountTxn,
      absorbRoundingResidual: false,
    });
    const baseAmounts = clampPlannedAmount({
      openingNbv: scheduleState.openingNbvBase,
      salvageValue: salvageValueBase,
      plannedAmount: plannedAmountBase,
      absorbRoundingResidual: false,
    });

    scheduleState.openingNbvTxn = txnAmounts.closingNbv;
    scheduleState.openingNbvBase = baseAmounts.closingNbv;
    computedSegments.push({
      allocationType: allocationSegment.allocationType || "OWNER_OU",
      operatingUnitId: allocationSegment.operatingUnitId != null
        ? Number(allocationSegment.operatingUnitId)
        : null,
      fromDate: allocationSegment.fromDate,
      toDate: allocationSegment.toDate,
      eligibleDays: Number(allocationSegment.eligibleDays || 0),
      plannedAmountTxn: txnAmounts.plannedAmount,
      plannedAmountBase: baseAmounts.plannedAmount,
      effectiveMethod: computation.effectiveMethod,
    });
  }

  applyImprovementEventsThrough(periodEndText);

  const hasLifecycleEligibilityCutoff = Number(periodEligibility.lifecycleExcludedDays || 0) > 0;
  const hasPostEligibleImprovement = computedSegments.length > 0
    ? improvementEvents.some((event) => event.effectiveDate > computedSegments.at(-1).toDate)
    : false;
  const isFinalScheduleLine = Number(periodEligibility.eligibleDays || 0) > 0
    && Math.max(Number(scheduleState.remainingPeriodsCounter || 0), 0) === 1;
  if (
    computedSegments.length > 0
    && isFinalScheduleLine
    && !hasLifecycleEligibilityCutoff
    && !hasPostEligibleImprovement
    && computedSegments.at(-1).effectiveMethod === "STRAIGHT_LINE"
  ) {
    const residualTxn = getRemainingDepreciableAmount(scheduleState.openingNbvTxn, salvageValueTxn);
    const residualBase = getRemainingDepreciableAmount(scheduleState.openingNbvBase, salvageValueBase);
    if (residualTxn > 0 || residualBase > 0) {
      const lastSegment = computedSegments.at(-1);
      lastSegment.plannedAmountTxn = roundAmount(Number(lastSegment.plannedAmountTxn || 0) + residualTxn);
      lastSegment.plannedAmountBase = roundAmount(Number(lastSegment.plannedAmountBase || 0) + residualBase);
      scheduleState.openingNbvTxn = roundAmount(salvageValueTxn || 0);
      scheduleState.openingNbvBase = roundAmount(salvageValueBase || 0);
    }
  }

  const plannedAmountTxn = roundAmount(
    computedSegments.reduce((sum, segment) => sum + Number(segment.plannedAmountTxn || 0), 0)
  );
  const plannedAmountBase = roundAmount(
    computedSegments.reduce((sum, segment) => sum + Number(segment.plannedAmountBase || 0), 0)
  );

  return {
    allocationSegments: computedSegments.map((segment) => ({
      allocationType: segment.allocationType,
      operatingUnitId: segment.operatingUnitId,
      fromDate: segment.fromDate,
      toDate: segment.toDate,
      eligibleDays: segment.eligibleDays,
      plannedAmountTxn: roundAmount(segment.plannedAmountTxn || 0),
      plannedAmountBase: roundAmount(segment.plannedAmountBase || 0),
    })),
    plannedAmountTxn,
    plannedAmountBase,
    closingNbvTxn: roundAmount(scheduleState.openingNbvTxn || 0),
    closingNbvBase: roundAmount(scheduleState.openingNbvBase || 0),
    remainingPeriodsCounter: Math.max(Number(scheduleState.remainingPeriodsCounter || 0), 0),
    hasSwitchedToStraightLine: currentHasSwitchedToStraightLine,
  };
}

function assertScheduleFoundationEligibility(asset) {
  if (!asset) {
    throw badRequest("Asset is required for depreciation schedule generation");
  }

  if (asset.status === "DRAFT") {
    throw badRequest("Depreciation schedule is available only after asset activation");
  }

  const method = normalizeUpperText(asset.depreciationMethod);
  if (method !== "STRAIGHT_LINE" && method !== "DECLINING_BALANCE" && method !== "NONE") {
    throw badRequest(
      `Depreciation schedule generation supports STRAIGHT_LINE, DECLINING_BALANCE, and NONE only; got ${method || "null"}`
    );
  }

  if (!asset.inServiceDate) {
    throw badRequest("inServiceDate is required for depreciation schedule generation");
  }

  if (Number(asset.salvageValueTxn || 0) > Number(asset.originalCostTxn || 0)) {
    throw badRequest("salvageValueTxn cannot exceed originalCostTxn for depreciation schedule generation");
  }
  if (Number(asset.salvageValueBase || 0) > Number(asset.originalCostBase || 0)) {
    throw badRequest("salvageValueBase cannot exceed originalCostBase for depreciation schedule generation");
  }

  if (hasLegacyOnboardingValues(asset)) {
    const { openingNbvTxn, openingNbvBase } = getLegacyOpeningAmounts(asset);
    if (Number(asset.salvageValueTxn || 0) > openingNbvTxn) {
      throw badRequest(
        "salvageValueTxn cannot exceed legacyNbvTxn for legacy-onboarding schedule generation"
      );
    }
    if (Number(asset.salvageValueBase || 0) > openingNbvBase) {
      throw badRequest(
        "salvageValueBase cannot exceed legacyNbvBase for legacy-onboarding schedule generation"
      );
    }
  }

  if (method !== "NONE") {
    normalizeNonNegativeInteger(asset.remainingUsefulLifeMonths, "remainingUsefulLifeMonths");
  }

  if (method === "DECLINING_BALANCE") {
    const annualRatePercent = Number(asset.decliningBalanceRatePercent);
    if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0) {
      throw badRequest(
        "decliningBalanceRatePercent must be a non-negative number for DECLINING_BALANCE schedule generation"
      );
    }
  }
}

async function loadSchedulePeriodsForRange({
  calendarId,
  startDate,
  monthCount,
  queryFn = query,
}) {
  if (!monthCount || monthCount <= 0) {
    return {
      periods: [],
      horizon: {
        requestedMonthCount: 0,
        resolvedMonthCount: 0,
        isBounded: false,
        firstMissingPeriodKey: null,
        lastResolvedPeriodKey: null,
        expectedLastPeriodKey: null,
      },
    };
  }

  const rangeStart = startOfMonth(parseDateOnly(startDate, "inServiceDate"));
  const rangeEnd = endOfMonth(addMonths(rangeStart, monthCount - 1));
  const expectedLastPeriodKey = formatPeriodKey(addMonths(rangeStart, monthCount - 1));
  const periodRowsResult = await queryFn(
    `SELECT id,
            fiscal_year,
            period_no,
            period_name,
            start_date,
            end_date,
            is_adjustment
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND end_date >= ?
        AND start_date <= ?
      ORDER BY start_date ASC, is_adjustment ASC, id ASC`,
    [calendarId, formatDateOnly(rangeStart), formatDateOnly(rangeEnd)]
  );

  const periodRows = (periodRowsResult.rows || []).map((row) => ({
    id: Number(row.id),
    fiscalYear: row.fiscal_year != null ? Number(row.fiscal_year) : null,
    periodNo: row.period_no != null ? Number(row.period_no) : null,
    periodName: row.period_name || null,
    startDate: String(row.start_date || "").slice(0, 10),
    endDate: String(row.end_date || "").slice(0, 10),
    isAdjustment: row.is_adjustment === 1 || row.is_adjustment === true || row.is_adjustment === "1",
  }));

  const resolvedPeriods = [];
  let firstMissingPeriodKey = null;
  for (let index = 0; index < monthCount; index += 1) {
    const expectedMonthStart = addMonths(rangeStart, index);
    const expectedMonthEnd = endOfMonth(expectedMonthStart);
    const expectedStartText = formatDateOnly(expectedMonthStart);
    const expectedEndText = formatDateOnly(expectedMonthEnd);
    const expectedPeriodKey = formatPeriodKey(expectedMonthStart);

    const overlappingRows = periodRows.filter((row) => (
      row.startDate <= expectedEndText && row.endDate >= expectedStartText
    ));

    if (!overlappingRows.length) {
      firstMissingPeriodKey = expectedPeriodKey;
      break;
    }

    const alignedNonAdjustmentRow = overlappingRows.find((row) => (
      !row.isAdjustment
      && row.startDate === expectedStartText
      && row.endDate === expectedEndText
    ));

    if (!alignedNonAdjustmentRow) {
      const hasNonAdjustmentRow = overlappingRows.some((row) => !row.isAdjustment);
      if (!hasNonAdjustmentRow) {
        throw badRequest(
          `Fixed-assets schedule generation does not support adjustment fiscal periods; ` +
          `month ${expectedPeriodKey} resolves only to adjustment periods`
        );
      }
      throw badRequest(
        `Fixed-assets schedule generation requires month-aligned non-adjustment fiscal periods; ` +
        `month ${expectedPeriodKey} is not aligned to a single calendar YYYY-MM bucket`
      );
    }

    resolvedPeriods.push({
      ...alignedNonAdjustmentRow,
      periodKey: expectedPeriodKey,
    });
  }

  return {
    periods: resolvedPeriods,
    horizon: {
      requestedMonthCount: Number(monthCount),
      resolvedMonthCount: resolvedPeriods.length,
      isBounded: Boolean(firstMissingPeriodKey),
      firstMissingPeriodKey,
      lastResolvedPeriodKey: resolvedPeriods.at(-1)?.periodKey || null,
      expectedLastPeriodKey,
    },
  };
}

function buildDepreciationScheduleRows(
  asset,
  periods,
  lifecycleHistory,
  {
    requestedMonthCount = periods.length,
    postedScheduleCount = 0,
    initialRemainingUsefulLifeMonths = requestedMonthCount,
    improvementHistory = [],
  } = {}
) {
  if (!periods.length) {
    return [];
  }

  const depreciationMethod = normalizeUpperText(asset.depreciationMethod);
  const inServiceDate = parseDateOnly(asset.inServiceDate, "inServiceDate");
  const { openingNbvTxn: initialOpeningNbvTxn, openingNbvBase: initialOpeningNbvBase } =
    getScheduleOpeningAmounts(asset);
  let openingNbvTxn = initialOpeningNbvTxn;
  let openingNbvBase = initialOpeningNbvBase;
  const salvageValueTxn = roundAmount(asset.salvageValueTxn || 0);
  const salvageValueBase = roundAmount(asset.salvageValueBase || 0);
  const monthlyDecliningBalanceRate = depreciationMethod === "DECLINING_BALANCE"
    ? Number(asset.decliningBalanceRatePercent || 0) / 12 / 100
    : null;
  let hasSwitchedToStraightLine = depreciationMethod === "STRAIGHT_LINE";
  let hasLifecycleEligibilityCutoff = false;
  const totalScheduledMonths = Math.max(
    Number(requestedMonthCount || periods.length),
    periods.length
  );

  const lifecycleTimeline = buildLifecycleTimeline(asset, lifecycleHistory, periods);
  const improvementTimeline = buildImprovementTimeline(improvementHistory, periods);
  const lifecycleState = {
    ...lifecycleTimeline.initialState,
  };
  let remainingPeriodsCounter = Math.max(
    Number(initialRemainingUsefulLifeMonths ?? totalScheduledMonths),
    0
  );
  let elapsedLifeMonths = Math.max(0, Number(postedScheduleCount || 0));

  const rows = [];
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index];
    const periodStart = parseDateOnly(period.startDate, "period.startDate");
    const periodEnd = parseDateOnly(period.endDate, "period.endDate");
    const periodStartText = formatDateOnly(periodStart);

    if (
      lifecycleTimeline.terminalCutoffDate
      && periodStartText >= lifecycleTimeline.terminalCutoffDate
    ) {
      break;
    }

    const improvementEvents = improvementTimeline.eventsByPeriodKey.get(period.periodKey) || [];
    const daysInPeriod = countDaysInclusive(periodStart, periodEnd);
    const periodEligibility = buildPeriodEligibility(
      periodStart,
      periodEnd,
      inServiceDate,
      lifecycleTimeline,
      lifecycleState
    );
    const eligibleDays = periodEligibility.eligibleDays;
    const consumesUsefulLifePeriod = eligibleDays > 0;
    hasLifecycleEligibilityCutoff = hasLifecycleEligibilityCutoff
      || periodEligibility.lifecycleExcludedDays > 0;
    const periodCalculation = calculatePeriodProratedSchedule({
      asset,
      period,
      daysInPeriod,
      periodEligibility,
      periodImprovementEvents: improvementEvents,
      depreciationMethod,
      salvageValueTxn,
      salvageValueBase,
      monthlyDecliningBalanceRate,
      hasSwitchedToStraightLine,
      openingNbvTxn,
      openingNbvBase,
      remainingPeriodsCounter,
      elapsedLifeMonths,
    });
    hasSwitchedToStraightLine = periodCalculation.hasSwitchedToStraightLine;
    const plannedAmountTxn = periodCalculation.plannedAmountTxn;
    const plannedAmountBase = periodCalculation.plannedAmountBase;
    const closingNbvTxn = periodCalculation.closingNbvTxn;
    const closingNbvBase = periodCalculation.closingNbvBase;

    rows.push({
      lineNo: rows.length + 1,
      fiscalPeriodId: period.id,
      fiscalYear: period.fiscalYear,
      periodNo: period.periodNo,
      periodName: period.periodName,
      periodKey: period.periodKey,
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      daysInPeriod,
      eligibleDays,
      allocationSegments: periodCalculation.allocationSegments,
      openingNbvTxn,
      openingNbvBase,
      plannedAmountTxn,
      plannedAmountBase,
      closingNbvTxn,
      closingNbvBase,
      status: "PLANNED",
    });

    openingNbvTxn = closingNbvTxn;
    openingNbvBase = closingNbvBase;
    if (consumesUsefulLifePeriod) {
      remainingPeriodsCounter = Math.max(periodCalculation.remainingPeriodsCounter - 1, 0);
      elapsedLifeMonths += 1;
    } else {
      remainingPeriodsCounter = Math.max(periodCalculation.remainingPeriodsCounter, 0);
    }

    if (lifecycleState.isDisposed) {
      break;
    }
  }

  return rows;
}

function hasPositivePlannedAmount(row) {
  return Number(row?.plannedAmountTxn || 0) > 0 || Number(row?.plannedAmountBase || 0) > 0;
}

function comparePeriodKeys(left, right) {
  const normalizedLeft = String(left || "").trim();
  const normalizedRight = String(right || "").trim();
  if (!normalizedLeft && !normalizedRight) return 0;
  if (!normalizedLeft) return -1;
  if (!normalizedRight) return 1;
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function buildPeriodSnapshotFromScheduleRow(period, scheduleRow) {
  return {
    id: Number(scheduleRow?.fiscalPeriodId || period?.id || 0),
    fiscalYear: scheduleRow?.fiscalYear ?? period?.fiscalYear ?? null,
    periodNo: scheduleRow?.periodNo ?? period?.periodNo ?? null,
    periodName: scheduleRow?.periodName ?? period?.periodName ?? null,
    periodKey: scheduleRow?.periodKey || period?.periodKey || null,
    startDate: scheduleRow?.periodStartDate || period?.startDate || null,
    endDate: scheduleRow?.periodEndDate || period?.endDate || null,
  };
}

function buildAllocationSnapshotsForRunRow(runRow) {
  const segments = Array.isArray(runRow?.allocationSegments)
    ? runRow.allocationSegments.filter((segment) => Number(segment?.eligibleDays || 0) > 0)
    : [];

  if (!segments.length) {
    return [];
  }

  const totalEligibleDays = segments.reduce(
    (sum, segment) => sum + Number(segment.eligibleDays || 0),
    0
  );
  if (totalEligibleDays <= 0) {
    return [];
  }

  let allocatedTxn = 0;
  let allocatedBase = 0;
  const hasExplicitAmounts = segments.some((segment) => (
    segment?.plannedAmountTxn != null || segment?.plannedAmountBase != null
  ));

  return segments.map((segment, index) => {
    const isLastSegment = index === segments.length - 1;
    const segmentEligibleDays = Number(segment.eligibleDays || 0);

    let plannedAmountTxn = 0;
    let plannedAmountBase = 0;
    if (hasExplicitAmounts) {
      plannedAmountTxn = isLastSegment
        ? roundAmount(Number(runRow.plannedAmountTxn || 0) - allocatedTxn)
        : roundAmount(segment.plannedAmountTxn || 0);
      plannedAmountBase = isLastSegment
        ? roundAmount(Number(runRow.plannedAmountBase || 0) - allocatedBase)
        : roundAmount(segment.plannedAmountBase || 0);
    } else {
      plannedAmountTxn = isLastSegment
        ? roundAmount(Number(runRow.plannedAmountTxn || 0) - allocatedTxn)
        : roundAmount(Number(runRow.plannedAmountTxn || 0) * (segmentEligibleDays / totalEligibleDays));
      plannedAmountBase = isLastSegment
        ? roundAmount(Number(runRow.plannedAmountBase || 0) - allocatedBase)
        : roundAmount(Number(runRow.plannedAmountBase || 0) * (segmentEligibleDays / totalEligibleDays));
    }

    plannedAmountTxn = Math.max(0, plannedAmountTxn);
    plannedAmountBase = Math.max(0, plannedAmountBase);
    allocatedTxn = roundAmount(allocatedTxn + plannedAmountTxn);
    allocatedBase = roundAmount(allocatedBase + plannedAmountBase);

    return {
      allocationType: segment.allocationType || "OWNER_OU",
      operatingUnitId: segment.operatingUnitId != null ? Number(segment.operatingUnitId) : null,
      fromDate: segment.fromDate,
      toDate: segment.toDate,
      eligibleDays: segmentEligibleDays,
      plannedAmountTxn,
      plannedAmountBase,
    };
  });
}

function buildReadyRunRow({
  asset,
  period,
  scheduleRow,
  depreciationKind = "RUN",
}) {
  const resolvedPeriod = buildPeriodSnapshotFromScheduleRow(period, scheduleRow);
  return {
    assetId: Number(asset.id),
    assetNo: asset.assetNo || null,
    assetName: asset.name || null,
    assetStatus: asset.status || null,
    fiscalPeriodId: Number(resolvedPeriod.id),
    fiscalYear: resolvedPeriod.fiscalYear,
    periodNo: resolvedPeriod.periodNo,
    periodName: resolvedPeriod.periodName,
    periodKey: resolvedPeriod.periodKey,
    periodStartDate: resolvedPeriod.startDate,
    periodEndDate: resolvedPeriod.endDate,
    eligibleDays: Number(scheduleRow.eligibleDays || 0),
    daysInPeriod: Number(scheduleRow.daysInPeriod || 0),
    plannedAmountTxn: roundAmount(scheduleRow.plannedAmountTxn || 0),
    plannedAmountBase: roundAmount(scheduleRow.plannedAmountBase || 0),
    depreciationKind,
    status: "READY",
    skipReasonCode: null,
    skipReasonText: null,
    errorCode: null,
    errorMessage: null,
    allocationSegments: buildAllocationSnapshotsForRunRow(scheduleRow),
    scheduleSnapshot: {
      lineNo: Number(scheduleRow.lineNo || 0),
      openingNbvTxn: roundAmount(scheduleRow.openingNbvTxn || 0),
      openingNbvBase: roundAmount(scheduleRow.openingNbvBase || 0),
      closingNbvTxn: roundAmount(scheduleRow.closingNbvTxn || 0),
      closingNbvBase: roundAmount(scheduleRow.closingNbvBase || 0),
      plannedAmountTxn: roundAmount(scheduleRow.plannedAmountTxn || 0),
      plannedAmountBase: roundAmount(scheduleRow.plannedAmountBase || 0),
    },
  };
}

function buildSkippedRunRow({
  asset,
  period,
  daysInPeriod,
  eligibleDays,
  allocationSegments = [],
  reasonCode,
  reasonText,
}) {
  const frozenAllocationSegments = (allocationSegments || []).map((segment) => ({
    allocationType: segment.allocationType || "OWNER_OU",
    operatingUnitId: segment.operatingUnitId != null ? Number(segment.operatingUnitId) : null,
    fromDate: segment.fromDate,
    toDate: segment.toDate,
    eligibleDays: Number(segment.eligibleDays || 0),
    plannedAmountTxn: 0,
    plannedAmountBase: 0,
  }));

  return {
    assetId: Number(asset.id),
    assetNo: asset.assetNo || null,
    assetName: asset.name || null,
    assetStatus: asset.status || null,
    fiscalPeriodId: Number(period.id),
    fiscalYear: period.fiscalYear,
    periodNo: period.periodNo,
    periodName: period.periodName,
    periodKey: period.periodKey,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    eligibleDays: Number(eligibleDays || 0),
    daysInPeriod: Number(daysInPeriod || 0),
    plannedAmountTxn: 0,
    plannedAmountBase: 0,
    depreciationKind: "RUN",
    status: "SKIPPED",
    skipReasonCode: reasonCode,
    skipReasonText: reasonText,
    errorCode: null,
    errorMessage: null,
    allocationSegments: frozenAllocationSegments,
  };
}

function buildErrorRunRow({ asset, period, error, errorCode = "SCHEDULE_GENERATION_FAILED" }) {
  const periodStart = parseDateOnly(period.startDate, "period.startDate");
  const periodEnd = parseDateOnly(period.endDate, "period.endDate");
  return {
    assetId: Number(asset.id),
    assetNo: asset.assetNo || null,
    assetName: asset.name || null,
    assetStatus: asset.status || null,
    fiscalPeriodId: Number(period.id),
    fiscalYear: period.fiscalYear,
    periodNo: period.periodNo,
    periodName: period.periodName,
    periodKey: period.periodKey,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    eligibleDays: 0,
    daysInPeriod: countDaysInclusive(periodStart, periodEnd),
    plannedAmountTxn: 0,
    plannedAmountBase: 0,
    depreciationKind: "RUN",
    status: "ERROR",
    skipReasonCode: null,
    skipReasonText: null,
    errorCode,
    errorMessage: String(error?.message || "Failed to generate depreciation schedule snapshot"),
    allocationSegments: [],
  };
}

function summarizeRunRows(rows) {
  let totalPlannedAmountTxn = 0;
  let totalPlannedAmountBase = 0;
  let totalCatchUpAmountTxn = 0;
  let totalCatchUpAmountBase = 0;
  let readyLineCount = 0;
  let skippedLineCount = 0;
  let errorLineCount = 0;
  let catchUpLineCount = 0;
  const assetIds = new Set();
  const readyAssetIds = new Set();
  const skippedAssetIds = new Set();
  const errorAssetIds = new Set();
  const catchUpAssetIds = new Set();

  for (const row of rows || []) {
    const assetId = Number(row?.assetId || 0);
    if (assetId > 0) {
      assetIds.add(assetId);
    }
    const depreciationKind = normalizeUpperText(row?.depreciationKind) || "RUN";
    if (row.status === "READY") {
      readyLineCount += 1;
      if (assetId > 0) {
        readyAssetIds.add(assetId);
      }
      totalPlannedAmountTxn = roundAmount(totalPlannedAmountTxn + Number(row.plannedAmountTxn || 0));
      totalPlannedAmountBase = roundAmount(totalPlannedAmountBase + Number(row.plannedAmountBase || 0));
      if (depreciationKind === "CATCH_UP") {
        catchUpLineCount += 1;
        totalCatchUpAmountTxn = roundAmount(totalCatchUpAmountTxn + Number(row.plannedAmountTxn || 0));
        totalCatchUpAmountBase = roundAmount(totalCatchUpAmountBase + Number(row.plannedAmountBase || 0));
        if (assetId > 0) {
          catchUpAssetIds.add(assetId);
        }
      }
    } else if (row.status === "SKIPPED") {
      skippedLineCount += 1;
      if (assetId > 0) {
        skippedAssetIds.add(assetId);
      }
    } else if (row.status === "ERROR") {
      errorLineCount += 1;
      if (assetId > 0) {
        errorAssetIds.add(assetId);
      }
    }
  }

  return {
    assetCount: assetIds.size,
    readyAssetCount: readyAssetIds.size,
    skippedAssetCount: skippedAssetIds.size,
    errorCount: errorAssetIds.size,
    lineCount: rows.length,
    readyLineCount,
    skippedLineCount,
    errorLineCount,
    catchUpAssetCount: catchUpAssetIds.size,
    catchUpLineCount,
    totalCatchUpAmountTxn,
    totalCatchUpAmountBase,
    totalPlannedAmountTxn,
    totalPlannedAmountBase,
  };
}

function isCalendarHorizonBoundedForPeriod(periodKey, scheduleHorizon) {
  if (!scheduleHorizon?.isBounded || !scheduleHorizon?.firstMissingPeriodKey) {
    return false;
  }
  if (!periodKey || periodKey < scheduleHorizon.firstMissingPeriodKey) {
    return false;
  }
  if (
    scheduleHorizon.expectedLastPeriodKey
    && periodKey > scheduleHorizon.expectedLastPeriodKey
  ) {
    return false;
  }
  return true;
}

function buildCalendarHorizonBoundedReasonText(periodKey, scheduleHorizon) {
  const lastResolvedPeriodKey = scheduleHorizon?.lastResolvedPeriodKey || null;
  if (lastResolvedPeriodKey) {
    return (
      `Fiscal periods are not defined yet beyond ${lastResolvedPeriodKey}; ` +
      `schedule cannot reach period ${periodKey} yet`
    );
  }
  return `Fiscal periods are not defined yet for period ${periodKey}; schedule cannot start yet`;
}

function evaluateLifecycleForPeriod(asset, lifecycleHistory, period) {
  const periodStart = parseDateOnly(period.startDate, "period.startDate");
  const periodEnd = parseDateOnly(period.endDate, "period.endDate");
  const inServiceDate = parseDateOnly(asset.inServiceDate, "inServiceDate");
  const lifecycleTimeline = buildLifecycleTimeline(asset, lifecycleHistory, [period]);
  const lifecycleState = {
    ...lifecycleTimeline.initialState,
  };
  const periodEligibility = buildPeriodEligibility(
    periodStart,
    periodEnd,
    inServiceDate,
    lifecycleTimeline,
    lifecycleState
  );

  return {
    periodStart,
    periodEnd,
    inServiceDate,
    lifecycleTimeline,
    periodEligibility,
    daysInPeriod: countDaysInclusive(periodStart, periodEnd),
  };
}

function classifySkippedRunRow({
  asset,
  period,
  depreciationMethod,
  remainingUsefulLifeMonths,
  scheduleRow,
  scheduleRows,
  scheduleHorizon,
  lifecycleEvaluation,
}) {
  const eligibleDays = Number(scheduleRow?.eligibleDays || lifecycleEvaluation?.periodEligibility?.eligibleDays || 0);
  const daysInPeriod = Number(scheduleRow?.daysInPeriod || lifecycleEvaluation?.daysInPeriod || 0);
  const allocationSegments = Array.isArray(scheduleRow?.allocationSegments)
    ? scheduleRow.allocationSegments
    : (lifecycleEvaluation?.periodEligibility?.allocationSegments || []);
  const inServiceDate = lifecycleEvaluation?.inServiceDate || parseDateOnly(asset.inServiceDate, "inServiceDate");
  const periodEnd = lifecycleEvaluation?.periodEnd || parseDateOnly(period.endDate, "period.endDate");
  const terminalCutoffDate = lifecycleEvaluation?.lifecycleTimeline?.terminalCutoffDate || null;
  const lifecycleExcludedDays = Number(lifecycleEvaluation?.periodEligibility?.lifecycleExcludedDays || 0);
  const firstSchedulePeriodKey = scheduleRows?.[0]?.periodKey || null;
  const lastSchedulePeriodKey = scheduleRows?.at(-1)?.periodKey || null;

  if (depreciationMethod === "NONE") {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "NOT_DEPRECIABLE",
      reasonText: "Asset is not depreciable under the normal depreciation run engine",
    });
  }

  if (remainingUsefulLifeMonths == null || remainingUsefulLifeMonths <= 0) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "NO_REMAINING_USEFUL_LIFE",
      reasonText: "Asset has no remaining useful life for normal depreciation scheduling",
    });
  }

  if (inServiceDate.getTime() > periodEnd.getTime()) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "NOT_IN_SERVICE_FOR_PERIOD",
      reasonText: `Asset is not yet in service for period ${period.periodKey}`,
    });
  }

  if (terminalCutoffDate && period.startDate >= terminalCutoffDate) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "ASSET_DISPOSED_BEFORE_PERIOD",
      reasonText: `Asset is disposed or written off before period ${period.periodKey}`,
    });
  }

  if (eligibleDays === 0 && lifecycleExcludedDays > 0) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "ASSET_SUSPENDED_FOR_PERIOD",
      reasonText: `Asset has no eligible active days in period ${period.periodKey}`,
    });
  }

  if (
    scheduleRow
    && !hasPositivePlannedAmount(scheduleRow)
  ) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "NO_REMAINING_DEPRECIABLE_AMOUNT",
      reasonText: `Asset has no remaining depreciable amount for period ${period.periodKey}`,
    });
  }

  if (
    !scheduleRow
    && isCalendarHorizonBoundedForPeriod(period.periodKey, scheduleHorizon)
  ) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "CALENDAR_HORIZON_NOT_AVAILABLE",
      reasonText: buildCalendarHorizonBoundedReasonText(
        period.periodKey,
        scheduleHorizon
      ),
    });
  }

  if (
    lastSchedulePeriodKey
    && period.periodKey > lastSchedulePeriodKey
  ) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "NO_REMAINING_USEFUL_LIFE",
      reasonText: `Asset schedule horizon ends before period ${period.periodKey}`,
    });
  }

  if (
    firstSchedulePeriodKey
    && period.periodKey < firstSchedulePeriodKey
  ) {
    return buildSkippedRunRow({
      asset,
      period,
      daysInPeriod,
      eligibleDays,
      allocationSegments,
      reasonCode: "NOT_IN_SERVICE_FOR_PERIOD",
      reasonText: `Asset is not yet in service for period ${period.periodKey}`,
    });
  }

  return buildSkippedRunRow({
    asset,
    period,
    daysInPeriod,
    eligibleDays,
    allocationSegments,
    reasonCode: "NOT_ELIGIBLE_FOR_PERIOD",
    reasonText: `Asset is not eligible for normal depreciation in period ${period.periodKey}`,
  });
}

async function buildAssetDepreciationScheduleContext({
  tenantId,
  asset,
  book,
  queryFn = query,
}) {
  assertScheduleFoundationEligibility(asset);

  const depreciationMethod = normalizeUpperText(asset.depreciationMethod);
  const currentPostedScheduleLines = await loadCurrentPostedDepreciationScheduleLinesForAsset({
    tenantId,
    assetId: Number(asset.id),
    queryFn,
  });
  const currentPostedScheduleCount = currentPostedScheduleLines.length;
  const currentRemainingUsefulLifeMonths = resolveCurrentRemainingUsefulLifeMonths(
    asset,
    currentPostedScheduleCount
  );
  const remainingUsefulLifeMonths = currentPostedScheduleCount > 0
    ? currentRemainingUsefulLifeMonths
    : resolveAssetRemainingUsefulLifeMonths(asset, depreciationMethod);
  const lifecycleHistory = await loadAssetDepreciationLifecycleHistory({
    tenantId,
    assetId: asset.id,
    queryFn,
  });
  const improvementHistory = await loadAssetDepreciationImprovementHistory({
    tenantId,
    assetId: asset.id,
    queryFn,
  });
  const latestCatchUpDepreciation = await loadLatestPostedCatchUpDepreciationTransactionForAsset({
    tenantId,
    assetId: asset.id,
    queryFn,
  });

  if (isLowValueFullyExpensedAsset(asset)) {
    return {
      asset,
      depreciationMethod,
      remainingUsefulLifeMonths,
      lifecycleHistory,
      improvementHistory,
      periods: [],
      scheduleHorizon: null,
      rows: [],
      isExcludedLowValue: true,
      currentPostedScheduleLines,
      currentPostedScheduleCount,
    };
  }

  let periods = [];
  let rows = [];
  let scheduleHorizon = null;
  let scheduleStartDate = asset.inServiceDate;
  let scheduleSeedAsset = asset;
  if (currentPostedScheduleCount > 0) {
    const lastPostedScheduleLine = currentPostedScheduleLines.at(-1) || null;
    const lastPostedMonthStart = lastPostedScheduleLine?.periodKey
      ? parseDateOnly(`${lastPostedScheduleLine.periodKey}-01`, "lastPostedPeriodKey")
      : null;
    if (lastPostedMonthStart) {
      scheduleStartDate = formatDateOnly(startOfMonth(addMonths(lastPostedMonthStart, 1)));
    }
  }
  const improvementAwareSeed = resolveImprovementAwareScheduleSeed({
    asset,
    currentPostedScheduleLines,
    currentPostedScheduleCount,
    baseRemainingUsefulLifeMonths: remainingUsefulLifeMonths,
    scheduleStartDate,
    improvementHistory,
    latestCatchUpDepreciation,
  });
  scheduleSeedAsset = improvementAwareSeed.scheduleSeedAsset;
  if (
    (depreciationMethod === "STRAIGHT_LINE" || depreciationMethod === "DECLINING_BALANCE")
    && improvementAwareSeed.requestedMonthCount > 0
  ) {
    const periodResolution = await loadSchedulePeriodsForRange({
      calendarId: book.calendar_id,
      startDate: scheduleStartDate,
      monthCount: improvementAwareSeed.requestedMonthCount,
      queryFn,
    });
    periods = periodResolution.periods;
    scheduleHorizon = periodResolution.horizon;
    rows = buildDepreciationScheduleRows(
      scheduleSeedAsset,
      periods,
      lifecycleHistory,
      {
        requestedMonthCount: improvementAwareSeed.requestedMonthCount,
        postedScheduleCount: currentPostedScheduleCount,
        initialRemainingUsefulLifeMonths: improvementAwareSeed.initialRemainingUsefulLifeMonths,
        improvementHistory: improvementAwareSeed.futureImprovements,
      }
    );
  }

  return {
    asset: scheduleSeedAsset,
    depreciationMethod,
    remainingUsefulLifeMonths,
    lifecycleHistory,
    improvementHistory,
    periods,
    scheduleHorizon,
    rows,
    isExcludedLowValue: false,
    currentPostedScheduleLines,
    currentPostedScheduleCount,
  };
}

function resolveRunPostingDate(postingDate, period) {
  const normalizedPostingDate = postingDate || period.endDate;
  const postingDateText = formatDateOnly(parseDateOnly(normalizedPostingDate, "postingDate"));
  if (postingDateText < period.startDate || postingDateText > period.endDate) {
    throw badRequest(
      `postingDate (${postingDateText}) must fall within fiscal period ${period.periodKey}`
    );
  }
  return postingDateText;
}

async function resolveDepreciationRunScope({
  tenantId,
  legalEntityId,
  fiscalPeriodId,
  bookId,
  postingDate,
  actionLabel,
  queryFn = query,
}) {
  const operationalBook = await resolveBookForLegalEntity(tenantId, legalEntityId, queryFn);
  const resolvedOperationalBookId = Number(operationalBook.id);

  if (bookId != null && Number(bookId) !== resolvedOperationalBookId) {
    throw badRequest(
      `bookId (${Number(bookId)}) must match the operational fixed-assets book ` +
      `(${resolvedOperationalBookId}) for legalEntityId=${legalEntityId}`
    );
  }

  const period = await resolveSupportedFixedAssetFiscalPeriod(
    Number(operationalBook.calendar_id),
    fiscalPeriodId,
    queryFn
  );
  const resolvedPostingDate = resolveRunPostingDate(
    postingDate || null,
    period
  );
  await ensurePeriodOpenForFixedAssets(
    resolvedOperationalBookId,
    period.id,
    actionLabel,
    queryFn
  );

  return {
    book: operationalBook,
    period,
    postingDate: resolvedPostingDate,
  };
}

async function buildDepreciationRunRowForAsset({
  tenantId,
  asset,
  book,
  period,
  historicalPostedRunPeriodKeys = new Set(),
  queryFn = query,
}) {
  if (isLowValueFullyExpensedAsset(asset)) {
    return [];
  }

  try {
    const scheduleContext = await buildAssetDepreciationScheduleContext({
      tenantId,
      asset,
      book,
      queryFn,
    });
    const currentPostedScheduleLines = scheduleContext.currentPostedScheduleLines || [];
    const currentPostedPeriodKeys = new Set(
      currentPostedScheduleLines.map((row) => row.periodKey)
    );

    if (scheduleContext.isExcludedLowValue) {
      return [];
    }

    const lifecycleEvaluation = evaluateLifecycleForPeriod(
      asset,
      scheduleContext.lifecycleHistory,
      period
    );
    const scheduleRow = scheduleContext.rows.find((row) => row.periodKey === period.periodKey) || null;
    const historicalCatchUpRows = [];
    let blockingHistoricalGapRow = null;

    for (const row of scheduleContext.rows || []) {
      if (!hasPositivePlannedAmount(row) || currentPostedPeriodKeys.has(row.periodKey)) {
        continue;
      }
      if (comparePeriodKeys(row.periodKey, period.periodKey) >= 0) {
        continue;
      }
      if (historicalPostedRunPeriodKeys.has(row.periodKey)) {
        historicalCatchUpRows.push(row);
        continue;
      }
      blockingHistoricalGapRow = row;
      break;
    }

    if (currentPostedPeriodKeys.has(period.periodKey)) {
      if (normalizeUpperText(asset.status) === "DISPOSED") {
        const periodStart = parseDateOnly(period.startDate, "period.startDate");
        const periodEnd = parseDateOnly(period.endDate, "period.endDate");
        return [buildSkippedRunRow({
          asset,
          period,
          daysInPeriod: countDaysInclusive(periodStart, periodEnd),
          eligibleDays: 0,
          allocationSegments: [],
          reasonCode: "PERIOD_ALREADY_PROCESSED_BY_DISPOSAL",
          reasonText:
            `Asset disposal-period depreciation is already posted for period ${period.periodKey}`,
        })];
      }
      return [buildErrorRunRow({
        asset,
        period,
        errorCode: "PERIOD_ALREADY_POSTED",
        error: new Error(
          `Asset already has posted depreciation for period ${period.periodKey}`
        ),
      })];
    }

    if (blockingHistoricalGapRow) {
      return [buildErrorRunRow({
        asset,
        period,
        errorCode: "PERIOD_SEQUENCE_GAP",
        error: new Error(
          `Selected period ${period.periodKey} skips earlier unposted depreciation period ${blockingHistoricalGapRow.periodKey}`
        ),
      })];
    }

    const rows = historicalCatchUpRows.map((historicalRow) => (
      buildReadyRunRow({
        asset,
        period,
        scheduleRow: historicalRow,
        depreciationKind: "CATCH_UP",
      })
    ));

    if (scheduleRow && hasPositivePlannedAmount(scheduleRow)) {
      rows.push(buildReadyRunRow({
        asset,
        period,
        scheduleRow,
      }));
      return rows;
    }

    rows.push(classifySkippedRunRow({
      asset,
      period,
      depreciationMethod: scheduleContext.depreciationMethod,
      remainingUsefulLifeMonths: scheduleContext.remainingUsefulLifeMonths,
      scheduleRow,
      scheduleRows: scheduleContext.rows,
      scheduleHorizon: scheduleContext.scheduleHorizon,
      lifecycleEvaluation,
    }));
    return rows;
  } catch (error) {
    return [buildErrorRunRow({ asset, period, error })];
  }
}

async function buildDepreciationRunSnapshot({
  tenantId,
  legalEntityId,
  fiscalPeriodId,
  bookId,
  postingDate,
  actionLabel,
  queryFn = query,
}) {
  const scope = await resolveDepreciationRunScope({
    tenantId,
    legalEntityId,
    fiscalPeriodId,
    bookId,
    postingDate,
    actionLabel,
    queryFn,
  });

  const candidateAssets = await listDepreciationRunAssetSnapshots({
    tenantId,
    legalEntityId,
    queryFn,
  });
  const postedRunPeriods = await loadPostedDepreciationRunPeriodsForScope({
    tenantId,
    legalEntityId,
    bookId: Number(scope.book.id),
    throughDate: null,
    queryFn,
  });
  const historicalPostedRunPeriodKeys = new Set(
    postedRunPeriods
      .map((row) => String(row?.periodKey || "").trim())
      .filter((periodKey) => periodKey && comparePeriodKeys(periodKey, scope.period.periodKey) < 0)
  );

  const rows = [];
  let excludedLowValueAssetCount = 0;

  for (const asset of candidateAssets) {
    if (isLowValueFullyExpensedAsset(asset)) {
      excludedLowValueAssetCount += 1;
      continue;
    }

    const assetRows = await buildDepreciationRunRowForAsset({
      tenantId,
      asset,
      book: scope.book,
      period: scope.period,
      historicalPostedRunPeriodKeys,
      queryFn,
    });

    for (const row of assetRows || []) {
      rows.push({
        lineNo: rows.length + 1,
        ...row,
      });
    }
  }

  return {
    tenantId,
    legalEntityId,
    fiscalPeriodId: scope.period.id,
    periodKey: scope.period.periodKey,
    postingDate: scope.postingDate,
    periodConvention: "DAILY_PRORATA",
    bookId: Number(scope.book.id),
    calendarId: Number(scope.book.calendar_id),
    rows,
    total: rows.length,
    excludedLowValueAssetCount,
    summary: summarizeRunRows(rows),
  };
}

function deriveRunRowDepreciationKind(row, runPeriodKey) {
  const normalizedDepreciationKind = normalizeUpperText(row?.depreciationKind);
  if (normalizedDepreciationKind) {
    return normalizedDepreciationKind;
  }
  return comparePeriodKeys(row?.periodKey, runPeriodKey) < 0 ? "CATCH_UP" : "RUN";
}

function mapPublicRunRow(row, runPeriodKey) {
  const {
    scheduleSnapshot,
    ...publicRow
  } = row || {};
  return {
    ...publicRow,
    depreciationKind: deriveRunRowDepreciationKind(publicRow, runPeriodKey),
  };
}

function mapRunSnapshotToPreviewResponse(snapshot) {
  return {
    tenantId: snapshot.tenantId,
    legalEntityId: snapshot.legalEntityId,
    fiscalPeriodId: snapshot.fiscalPeriodId,
    periodKey: snapshot.periodKey,
    postingDate: snapshot.postingDate,
    bookId: snapshot.bookId,
    calendarId: snapshot.calendarId,
    periodConvention: snapshot.periodConvention,
    excludedLowValueAssetCount: snapshot.excludedLowValueAssetCount,
    summary: snapshot.summary,
    rows: (snapshot.rows || []).map((row) => mapPublicRunRow(row, snapshot.periodKey)),
    total: snapshot.total,
  };
}

function resolvePersistedRunStatusFromSnapshot(snapshot) {
  const readyAssetCount = Number(snapshot?.summary?.readyAssetCount || 0);
  if (readyAssetCount > 0) {
    return "DRAFT";
  }
  return "SKIPPED";
}

function buildExistingPersistedRunMessage({
  legalEntityId,
  bookId,
  fiscalPeriodId,
  status,
  runId = null,
}) {
  const normalizedStatus = normalizeUpperText(status) || "RUN";
  return (
    `A persisted ${normalizedStatus} depreciation run already exists for legalEntityId=${legalEntityId}, ` +
    `bookId=${bookId}, fiscalPeriodId=${fiscalPeriodId}` +
    (runId ? ` (runId=${runId})` : "")
  );
}

async function assertNoExistingOpenOrSkippedRunForScope({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  queryFn,
}) {
  const existingResult = await queryFn(
    `SELECT id, status
       FROM fixed_asset_depreciation_runs
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND book_id = ?
        AND fiscal_period_id = ?
        AND status IN ('DRAFT', 'SKIPPED')
      LIMIT 1`,
    [tenantId, legalEntityId, bookId, fiscalPeriodId]
  );
  const existingRow = existingResult.rows?.[0] || null;
  const existingRunId = Number(existingRow?.id || 0);
  if (existingRunId > 0) {
    throw badRequest(buildExistingPersistedRunMessage({
      legalEntityId,
      bookId,
      fiscalPeriodId,
      status: existingRow?.status,
      runId: existingRunId,
    }));
  }
}

function isDuplicateDraftRunError(error) {
  return String(error?.code || "").toUpperCase() === "ER_DUP_ENTRY";
}

function buildDuplicateDraftRunMessage({ legalEntityId, bookId, fiscalPeriodId }) {
  return (
    `A persisted DRAFT or SKIPPED depreciation run already exists for legalEntityId=${legalEntityId}, ` +
    `bookId=${bookId}, fiscalPeriodId=${fiscalPeriodId}`
  );
}

async function insertDepreciationRunHeaderTx({ tx, snapshot, userId }) {
  const persistedRunStatus = resolvePersistedRunStatusFromSnapshot(snapshot);
  const insertResult = await tx.query(
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
       created_by_user_id
     ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 0, ?
     )`,
    [
      snapshot.tenantId,
      snapshot.legalEntityId,
      snapshot.bookId,
      snapshot.fiscalPeriodId,
      snapshot.postingDate,
      snapshot.periodKey,
      persistedRunStatus,
      snapshot.summary.assetCount,
      snapshot.summary.skippedAssetCount,
      snapshot.summary.errorCount,
      snapshot.summary.totalPlannedAmountTxn,
      snapshot.summary.totalPlannedAmountBase,
      userId || null,
    ]
  );

  const runId = Number(insertResult.rows?.insertId || 0);
  if (!runId) {
    throw badRequest("Failed to persist depreciation run header");
  }

  return runId;
}

function buildDepreciationScheduleLineSnapshotInsertValues({
  snapshot,
  row,
}) {
  if (row.status !== "READY" || !row.scheduleSnapshot) {
    return null;
  }

  return [
    snapshot.tenantId,
    snapshot.legalEntityId,
    row.assetId,
    row.periodKey,
    Number(row.scheduleSnapshot.lineNo || row.lineNo || 0),
    row.scheduleSnapshot.plannedAmountTxn,
    row.scheduleSnapshot.plannedAmountBase,
    row.scheduleSnapshot.openingNbvTxn,
    row.scheduleSnapshot.openingNbvBase,
    row.scheduleSnapshot.closingNbvTxn,
    row.scheduleSnapshot.closingNbvBase,
    "PLANNED",
    null,
    null,
  ];
}

async function insertDepreciationRunRowsTx({ tx, snapshot, runId }) {
  const batchSizes = getRunPersistenceChunkSizes();
  const rowDescriptors = (snapshot.rows || []).map((row, rowIndex) => ({
    row,
    rowIndex,
  }));

  const scheduleDescriptors = rowDescriptors.filter(({ row }) => (
    row.status === "READY" && row.scheduleSnapshot
  ));
  const scheduleInsertRows = scheduleDescriptors
    .map(({ row }) => buildDepreciationScheduleLineSnapshotInsertValues({ snapshot, row }))
    .filter(Boolean);

  const scheduleLineIds = await insertChunkedRowsTx({
    tx,
    tableName: "fixed_asset_depreciation_schedule_lines",
    columns: [
      "tenant_id",
      "legal_entity_id",
      "asset_id",
      "period_key",
      "line_no",
      "planned_amount_txn",
      "planned_amount_base",
      "opening_nbv_txn",
      "opening_nbv_base",
      "closing_nbv_txn",
      "closing_nbv_base",
      "status",
      "posted_run_line_id",
      "posted_transaction_id",
    ],
    rows: scheduleInsertRows,
    chunkSize: batchSizes.scheduleSnapshots,
    label: "depreciation schedule snapshot",
    failureStage: "SCHEDULE",
  });
  if (scheduleLineIds.length !== scheduleDescriptors.length) {
    throw badRequest("Failed to persist all depreciation schedule snapshot rows");
  }

  const scheduleLineIdByRowIndex = new Map();
  scheduleDescriptors.forEach((descriptor, index) => {
    scheduleLineIdByRowIndex.set(descriptor.rowIndex, Number(scheduleLineIds[index]));
  });

  const runLineInsertRows = rowDescriptors.map(({ row, rowIndex }) => ([
    snapshot.tenantId,
    snapshot.legalEntityId,
    runId,
    row.assetId,
    row.fiscalPeriodId,
    row.periodKey,
    scheduleLineIdByRowIndex.get(rowIndex) || null,
    row.eligibleDays,
    row.daysInPeriod,
    row.plannedAmountTxn,
    row.plannedAmountBase,
    row.status,
    null,
    row.skipReasonCode,
    row.skipReasonText,
    row.errorCode,
    row.errorMessage,
  ]));

  const runLineIds = await insertChunkedRowsTx({
    tx,
    tableName: "fixed_asset_depreciation_run_lines",
    columns: [
      "tenant_id",
      "legal_entity_id",
      "run_id",
      "asset_id",
      "fiscal_period_id",
      "period_key",
      "schedule_line_id",
      "eligible_days",
      "days_in_period",
      "planned_amount_txn",
      "planned_amount_base",
      "status",
      "posted_transaction_id",
      "skip_reason_code",
      "skip_reason_text",
      "error_code",
      "error_message",
    ],
    rows: runLineInsertRows,
    chunkSize: batchSizes.runLines,
    label: "depreciation run line",
    failureStage: "RUN_LINE",
  });
  if (runLineIds.length !== rowDescriptors.length) {
    throw badRequest("Failed to persist all depreciation run lines");
  }

  const runLineIdByRowIndex = new Map();
  rowDescriptors.forEach((descriptor, index) => {
    runLineIdByRowIndex.set(descriptor.rowIndex, Number(runLineIds[index]));
  });

  const allocationInsertRows = [];
  for (const { row, rowIndex } of rowDescriptors) {
    const runLineId = runLineIdByRowIndex.get(rowIndex);
    for (const allocation of row.allocationSegments || []) {
      allocationInsertRows.push([
        snapshot.tenantId,
        snapshot.legalEntityId,
        runLineId,
        row.assetId,
        row.fiscalPeriodId,
        row.periodKey,
        allocation.allocationType,
        allocation.operatingUnitId,
        allocation.fromDate,
        allocation.toDate,
        allocation.eligibleDays,
        allocation.plannedAmountTxn,
        allocation.plannedAmountBase,
      ]);
    }
  }

  await insertChunkedRowsTx({
    tx,
    tableName: "fixed_asset_depreciation_run_line_allocations",
    columns: [
      "tenant_id",
      "legal_entity_id",
      "run_line_id",
      "asset_id",
      "fiscal_period_id",
      "period_key",
      "allocation_type",
      "operating_unit_id",
      "from_date",
      "to_date",
      "eligible_days",
      "planned_amount_txn",
      "planned_amount_base",
    ],
    rows: allocationInsertRows,
    chunkSize: batchSizes.allocations,
    label: "depreciation run allocation",
    failureStage: "ALLOCATION",
    expectInsertedIds: false,
  });

  return allocationInsertRows.length;
}

function mapPersistedDepreciationRunHeaderRow(row) {
  const resolvedPostingDate = row.posting_date || row.journal_entry_date || null;
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    bookId: Number(row.book_id),
    fiscalPeriodId: Number(row.fiscal_period_id),
    periodKey: row.period_key,
    periodConvention: "DAILY_PRORATA",
    status: normalizeUpperText(row.status),
    fiscalYear: row.fiscal_year != null ? Number(row.fiscal_year) : null,
    periodNo: row.period_no != null ? Number(row.period_no) : null,
    periodName: row.period_name || null,
    periodStartDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    periodEndDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    assetCount: Number(row.asset_count || 0),
    postedAssetCount: Number(row.posted_asset_count || 0),
    skippedAssetCount: Number(row.skipped_asset_count || 0),
    errorCount: Number(row.error_count || 0),
    totalPlannedAmountTxn: roundAmount(row.total_planned_amount_txn || 0),
    totalPlannedAmountBase: roundAmount(row.total_planned_amount_base || 0),
    totalPostedAmountTxn: roundAmount(row.total_posted_amount_txn || 0),
    totalPostedAmountBase: roundAmount(row.total_posted_amount_base || 0),
    postingDate: resolvedPostingDate
      ? String(resolvedPostingDate).slice(0, 10)
      : null,
    postedJournalEntryId: row.posted_journal_entry_id != null
      ? Number(row.posted_journal_entry_id)
      : null,
    reversalJournalEntryId: row.reversal_journal_entry_id != null
      ? Number(row.reversal_journal_entry_id)
      : null,
    createdByUserId: row.created_by_user_id != null ? Number(row.created_by_user_id) : null,
    postedByUserId: row.posted_by_user_id != null ? Number(row.posted_by_user_id) : null,
    reversedByUserId: row.reversed_by_user_id != null ? Number(row.reversed_by_user_id) : null,
    createdAt: row.created_at || null,
    postedAt: row.posted_at || null,
    reversedAt: row.reversed_at || null,
  };
}

function mapPersistedDepreciationRunLineRow(row, lineNo) {
  return {
    id: Number(row.id),
    lineNo,
    runId: Number(row.run_id),
    assetId: Number(row.asset_id),
    fiscalPeriodId: Number(row.fiscal_period_id),
    periodKey: row.period_key,
    scheduleLineId: row.schedule_line_id != null ? Number(row.schedule_line_id) : null,
    eligibleDays: Number(row.eligible_days || 0),
    daysInPeriod: Number(row.days_in_period || 0),
    plannedAmountTxn: roundAmount(row.planned_amount_txn || 0),
    plannedAmountBase: roundAmount(row.planned_amount_base || 0),
    status: normalizeUpperText(row.status),
    postedTransactionId: row.posted_transaction_id != null
      ? Number(row.posted_transaction_id)
      : null,
    skipReasonCode: row.skip_reason_code || null,
    skipReasonText: row.skip_reason_text || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    allocations: [],
  };
}

function mapPersistedDepreciationRunAllocationRow(row) {
  return {
    id: Number(row.id),
    runLineId: Number(row.run_line_id),
    assetId: Number(row.asset_id),
    fiscalPeriodId: Number(row.fiscal_period_id),
    periodKey: row.period_key,
    allocationType: row.allocation_type || null,
    operatingUnitId: row.operating_unit_id != null ? Number(row.operating_unit_id) : null,
    fromDate: row.from_date ? String(row.from_date).slice(0, 10) : null,
    toDate: row.to_date ? String(row.to_date).slice(0, 10) : null,
    eligibleDays: Number(row.eligible_days || 0),
    plannedAmountTxn: roundAmount(row.planned_amount_txn || 0),
    plannedAmountBase: roundAmount(row.planned_amount_base || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function loadPersistedDepreciationRunHeader({
  tenantId,
  runId,
  forUpdate = false,
  queryFn = query,
}) {
  const result = await queryFn(
    `SELECT run.*,
            period.fiscal_year,
            period.period_no,
            period.period_name,
            period.start_date,
            period.end_date,
            journal.entry_date AS journal_entry_date
       FROM fixed_asset_depreciation_runs run
       JOIN fiscal_periods period
         ON period.id = run.fiscal_period_id
       LEFT JOIN journal_entries journal
         ON journal.id = run.posted_journal_entry_id
      WHERE run.tenant_id = ?
        AND run.id = ?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, runId]
  );

  const row = result.rows?.[0];
  return row ? mapPersistedDepreciationRunHeaderRow(row) : null;
}

async function loadPersistedDepreciationRunLines({
  tenantId,
  runId,
  forUpdate = false,
  queryFn = query,
}) {
  const result = await queryFn(
    `SELECT id,
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
            error_message,
            created_at,
            updated_at
       FROM fixed_asset_depreciation_run_lines
      WHERE tenant_id = ?
        AND run_id = ?
      ORDER BY id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, runId]
  );

  return (result.rows || []).map((row, index) => (
    mapPersistedDepreciationRunLineRow(row, index + 1)
  ));
}

async function loadPersistedDepreciationRunAllocations({
  tenantId,
  runId,
  forUpdate = false,
  queryFn = query,
}) {
  const result = await queryFn(
    `SELECT alloc.id,
            alloc.run_line_id,
            alloc.asset_id,
            alloc.fiscal_period_id,
            alloc.period_key,
            alloc.allocation_type,
            alloc.operating_unit_id,
            alloc.from_date,
            alloc.to_date,
            alloc.eligible_days,
            alloc.planned_amount_txn,
            alloc.planned_amount_base,
            alloc.created_at,
            alloc.updated_at
       FROM fixed_asset_depreciation_run_line_allocations alloc
       JOIN fixed_asset_depreciation_run_lines line
         ON line.id = alloc.run_line_id
      WHERE alloc.tenant_id = ?
        AND line.run_id = ?
      ORDER BY alloc.run_line_id ASC, alloc.from_date ASC, alloc.id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, runId]
  );

  return (result.rows || []).map(mapPersistedDepreciationRunAllocationRow);
}

function attachAllocationSnapshotsToRunLines(lines, allocations) {
  const allocationsByRunLineId = new Map();

  for (const allocation of allocations || []) {
    const existing = allocationsByRunLineId.get(allocation.runLineId) || [];
    existing.push(allocation);
    allocationsByRunLineId.set(allocation.runLineId, existing);
  }

  return (lines || []).map((line) => ({
    ...line,
    allocations: allocationsByRunLineId.get(line.id) || [],
  }));
}

function annotatePersistedRunLines(lines, runPeriodKey) {
  return (lines || []).map((line) => ({
    ...line,
    depreciationKind: deriveRunRowDepreciationKind(line, runPeriodKey),
  }));
}

export async function listDepreciationRuns({
  tenantId,
  legalEntityId,
  bookId = null,
  fiscalPeriodId = null,
  status = null,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const conditions = [
    "run.tenant_id = ?",
    "run.legal_entity_id = ?",
  ];
  const params = [tenantId, legalEntityId];

  if (bookId != null) {
    conditions.push("run.book_id = ?");
    params.push(Number(bookId));
  }
  if (fiscalPeriodId != null) {
    conditions.push("run.fiscal_period_id = ?");
    params.push(Number(fiscalPeriodId));
  }
  if (status) {
    conditions.push("run.status = ?");
    params.push(status);
  }

  const result = await query(
    `SELECT run.*,
            period.fiscal_year,
            period.period_no,
            period.period_name,
            period.start_date,
            period.end_date,
            journal.entry_date AS journal_entry_date
       FROM fixed_asset_depreciation_runs run
       JOIN fiscal_periods period
         ON period.id = run.fiscal_period_id
       LEFT JOIN journal_entries journal
         ON journal.id = run.posted_journal_entry_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY run.created_at DESC, run.id DESC`,
    params
  );

  const rows = (result.rows || []).map(mapPersistedDepreciationRunHeaderRow);
  return {
    rows,
    total: rows.length,
  };
}

export async function getDepreciationRunDetail({ tenantId, runId, queryFn = query }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  const run = await loadPersistedDepreciationRunHeader({ tenantId, runId, queryFn });
  if (!run) {
    throw badRequest(`Depreciation run (id=${runId}) not found for tenant`);
  }

  const lines = await loadPersistedDepreciationRunLines({ tenantId, runId, queryFn });
  const allocations = await loadPersistedDepreciationRunAllocations({ tenantId, runId, queryFn });

  return {
    ...run,
    lineCount: lines.length,
    allocationRowCount: allocations.length,
    lines: annotatePersistedRunLines(
      attachAllocationSnapshotsToRunLines(lines, allocations),
      run.periodKey
    ),
    total: lines.length,
  };
}

async function deletePersistedDraftOrSkippedRunTx({
  tx,
  tenantId,
  run,
}) {
  const lines = await loadPersistedDepreciationRunLines({
    tenantId,
    runId: run.id,
    forUpdate: true,
    queryFn: tx.query,
  });
  const scheduleLineIds = lines
    .map((line) => line.scheduleLineId)
    .filter((value) => Number.isInteger(value) && value > 0);

  const lineCountResult = await tx.query(
    `SELECT COUNT(*) AS line_count
       FROM fixed_asset_depreciation_run_lines
      WHERE tenant_id = ?
        AND run_id = ?`,
    [tenantId, run.id]
  );
  const allocationCountResult = await tx.query(
    `SELECT COUNT(*) AS allocation_count
       FROM fixed_asset_depreciation_run_line_allocations alloc
       JOIN fixed_asset_depreciation_run_lines line
         ON line.id = alloc.run_line_id
      WHERE alloc.tenant_id = ?
        AND line.run_id = ?`,
    [tenantId, run.id]
  );
  const lineCount = Number(lineCountResult.rows?.[0]?.line_count || 0);
  const allocationRowCount = Number(
    allocationCountResult.rows?.[0]?.allocation_count || 0
  );

  await tx.query(
    `DELETE alloc
       FROM fixed_asset_depreciation_run_line_allocations alloc
       JOIN fixed_asset_depreciation_run_lines line
         ON line.id = alloc.run_line_id
      WHERE alloc.tenant_id = ?
        AND line.run_id = ?`,
    [tenantId, run.id]
  );
  await tx.query(
    `DELETE FROM fixed_asset_depreciation_run_lines
      WHERE tenant_id = ?
        AND run_id = ?`,
    [tenantId, run.id]
  );
  if (scheduleLineIds.length > 0) {
    const schedulePlaceholders = scheduleLineIds.map(() => "?").join(", ");
    await tx.query(
      `DELETE FROM fixed_asset_depreciation_schedule_lines
        WHERE tenant_id = ?
          AND id IN (${schedulePlaceholders})
          AND status = 'PLANNED'
          AND posted_run_line_id IS NULL
          AND posted_transaction_id IS NULL`,
      [tenantId, ...scheduleLineIds]
    );
  }

  const deleteResult = await tx.query(
    `DELETE FROM fixed_asset_depreciation_runs
      WHERE tenant_id = ?
        AND id = ?
        AND status IN ('DRAFT', 'SKIPPED')`,
    [tenantId, run.id]
  );
  const deletedCount = Number(deleteResult.rows?.affectedRows || 0);
  if (deletedCount !== 1) {
    throw badRequest(
      `Failed to delete ${run.status} depreciation run (runId=${run.id})`
    );
  }

  return {
    lineCount,
    allocationRowCount,
  };
}

export async function deleteDepreciationRunDraft({ tenantId, runId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  return withTransaction(async (tx) => {
    const run = await loadPersistedDepreciationRunHeader({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    if (!run) {
      throw badRequest(`Depreciation run (id=${runId}) not found for tenant`);
    }

    if (!["DRAFT", "SKIPPED"].includes(run.status)) {
      throw badRequest(
        `Only DRAFT or SKIPPED depreciation runs can be deleted (runId=${runId}, status=${run.status})`
      );
    }

    const deletedSnapshot = await deletePersistedDraftOrSkippedRunTx({
      tx,
      tenantId,
      run,
    });

    return {
      id: run.id,
      tenantId: run.tenantId,
      legalEntityId: run.legalEntityId,
      bookId: run.bookId,
      fiscalPeriodId: run.fiscalPeriodId,
      periodKey: run.periodKey,
      deleted: true,
      previousStatus: run.status,
      lineCount: deletedSnapshot.lineCount,
      allocationRowCount: deletedSnapshot.allocationRowCount,
    };
  });
}

async function assertNoLaterNonReversedRunsForReprocess({
  tenantId,
  run,
  queryFn,
}) {
  const fiscalYear = Number(run?.fiscalYear || 0);
  const periodNo = Number(run?.periodNo || 0);
  if (!fiscalYear || !periodNo) {
    throw badRequest(
      `Depreciation run (id=${run?.id || "?"}) is missing fiscal period sequence metadata`
    );
  }

  const result = await queryFn(
    `SELECT run.id,
            run.status,
            run.period_key
       FROM fixed_asset_depreciation_runs run
       JOIN fiscal_periods period
         ON period.id = run.fiscal_period_id
      WHERE run.tenant_id = ?
        AND run.legal_entity_id = ?
        AND run.book_id = ?
        AND run.id <> ?
        AND run.status <> 'REVERSED'
        AND (
          period.fiscal_year > ?
          OR (period.fiscal_year = ? AND period.period_no > ?)
        )
      ORDER BY period.fiscal_year ASC, period.period_no ASC, run.id ASC
      LIMIT 1
      FOR UPDATE`,
    [
      tenantId,
      run.legalEntityId,
      run.bookId,
      run.id,
      fiscalYear,
      fiscalYear,
      periodNo,
    ]
  );

  const blocker = result.rows?.[0];
  if (!blocker) {
    return;
  }

  throw badRequest(
    `Skipped depreciation run (id=${run.id}) cannot be reprocessed because later ` +
    `non-reversed run ${Number(blocker.id)} (${normalizeUpperText(blocker.status) || "UNKNOWN"}) ` +
    `exists for period ${blocker.period_key || "?"}`
  );
}

export async function reprocessSkippedDepreciationRun({
  tenantId,
  runId,
  userId = null,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  return withTransaction(async (tx) => {
    const run = await loadPersistedDepreciationRunHeader({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    if (!run) {
      throw badRequest(`Depreciation run (id=${runId}) not found for tenant`);
    }
    if (run.status !== "SKIPPED") {
      throw badRequest(
        `Only SKIPPED depreciation runs can be reprocessed (runId=${runId}, status=${run.status})`
      );
    }

    const operationalBook = await resolveBookForLegalEntity(
      tenantId,
      run.legalEntityId,
      tx.query
    );
    const operationalBookId = Number(operationalBook.id);
    if (Number(run.bookId) !== operationalBookId) {
      throw badRequest(
        `Run bookId (${Number(run.bookId)}) no longer matches the operational fixed-assets book ` +
        `(${operationalBookId}) for legalEntityId=${run.legalEntityId}`
      );
    }

    const period = await resolveSupportedFixedAssetFiscalPeriod(
      Number(operationalBook.calendar_id),
      run.fiscalPeriodId,
      tx.query
    );
    await ensurePeriodOpenForFixedAssets(
      operationalBookId,
      period.id,
      "reprocess skipped depreciation run",
      tx.query
    );
    await assertNoLaterNonReversedRunsForReprocess({
      tenantId,
      run,
      queryFn: tx.query,
    });

    await deletePersistedDraftOrSkippedRunTx({
      tx,
      tenantId,
      run,
    });

    const snapshot = await buildDepreciationRunSnapshot({
      tenantId,
      legalEntityId: run.legalEntityId,
      fiscalPeriodId: run.fiscalPeriodId,
      bookId: run.bookId,
      postingDate: run.postingDate || null,
      actionLabel: "reprocess skipped depreciation run",
      queryFn: tx.query,
    });

    if (!snapshot.rows.length) {
      throw badRequest(
        `No depreciation run rows are available for legalEntityId=${snapshot.legalEntityId}, ` +
        `fiscalPeriodId=${snapshot.fiscalPeriodId}`
      );
    }
    if (Number(snapshot.summary?.errorCount || 0) > 0) {
      const firstErrorRow = (snapshot.rows || []).find((row) => row.status === "ERROR");
      throw badRequest(
        firstErrorRow?.errorMessage
        || `Skipped depreciation run cannot be reprocessed because period ${snapshot.periodKey} contains blocking depreciation errors`
      );
    }

    const newRunId = await insertDepreciationRunHeaderTx({
      tx,
      snapshot,
      userId,
    });
    const allocationRowCount = await insertDepreciationRunRowsTx({
      tx,
      snapshot,
      runId: newRunId,
    });
    const persistedRunStatus = resolvePersistedRunStatusFromSnapshot(snapshot);

    return {
      id: newRunId,
      tenantId: snapshot.tenantId,
      legalEntityId: snapshot.legalEntityId,
      bookId: snapshot.bookId,
      fiscalPeriodId: snapshot.fiscalPeriodId,
      periodKey: snapshot.periodKey,
      postingDate: snapshot.postingDate,
      periodConvention: snapshot.periodConvention,
      status: persistedRunStatus,
      assetCount: snapshot.summary.assetCount,
      postedAssetCount: 0,
      skippedAssetCount: snapshot.summary.skippedAssetCount,
      errorCount: snapshot.summary.errorCount,
      totalPlannedAmountTxn: snapshot.summary.totalPlannedAmountTxn,
      totalPlannedAmountBase: snapshot.summary.totalPlannedAmountBase,
      excludedLowValueAssetCount: snapshot.excludedLowValueAssetCount,
      lineCount: snapshot.rows.length,
      allocationRowCount,
      reprocessedFromRunId: run.id,
    };
  });
}

function buildFixedAssetRunJournalNo(runId) {
  return `FA-RUN-${parsePositiveInt(runId)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}

function buildFixedAssetCatchUpJournalNo(assetId) {
  return `FA-CATCHUP-${parsePositiveInt(assetId)}-${Date.now().toString(36).toUpperCase()}`
    .slice(0, 40);
}

function buildFixedAssetRunReversalJournalNo(runId) {
  return `FA-RUN-REV-${parsePositiveInt(runId)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}

function getDistinctIds(values) {
  return Array.from(
    new Set((values || []).map((value) => parsePositiveInt(value)).filter(Boolean))
  );
}

function isLaterFixedAssetTransaction(candidate, target) {
  const candidateDate = String(candidate?.effectiveDate || "");
  const targetDate = String(target?.effectiveDate || "");
  if (candidateDate > targetDate) return true;
  if (candidateDate < targetDate) return false;
  return Number(candidate?.id || 0) > Number(target?.id || 0);
}

async function loadAssetDepreciationPostingSnapshots({
  tenantId,
  assetIds,
  queryFn = query,
}) {
  const normalizedAssetIds = getDistinctIds(assetIds);
  if (!tenantId) throw badRequest("tenantId is required");
  if (!normalizedAssetIds.length) {
    return [];
  }

  const placeholders = normalizedAssetIds.map(() => "?").join(", ");
  const result = await queryFn(
    `SELECT id,
            tenant_id,
            legal_entity_id,
            asset_no,
            status,
            currency_code,
            owner_operating_unit_id,
            original_cost_txn,
            original_cost_base,
            salvage_value_txn,
            salvage_value_base,
            depreciation_method,
            useful_life_months,
            remaining_useful_life_months,
            legacy_accum_depr_txn,
            legacy_accum_depr_base,
            legacy_nbv_txn,
            legacy_nbv_base,
            asset_account_id,
            accum_depr_account_id,
            depr_expense_account_id,
            last_depreciation_period
       FROM fixed_assets
      WHERE tenant_id = ?
        AND id IN (${placeholders})
      ORDER BY id ASC`,
    [tenantId, ...normalizedAssetIds]
  );

  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    assetNo: row.asset_no || null,
    status: normalizeUpperText(row.status),
    currencyCode: row.currency_code || null,
    ownerOperatingUnitId: row.owner_operating_unit_id != null
      ? Number(row.owner_operating_unit_id)
      : null,
    originalCostTxn: roundAmount(row.original_cost_txn || 0),
    originalCostBase: roundAmount(row.original_cost_base || 0),
    salvageValueTxn: roundAmount(row.salvage_value_txn || 0),
    salvageValueBase: roundAmount(row.salvage_value_base || 0),
    depreciationMethod: row.depreciation_method || null,
    usefulLifeMonths: row.useful_life_months != null ? Number(row.useful_life_months) : null,
    remainingUsefulLifeMonths: row.remaining_useful_life_months != null
      ? Number(row.remaining_useful_life_months)
      : null,
    legacyAccumDeprTxn: row.legacy_accum_depr_txn != null ? Number(row.legacy_accum_depr_txn) : null,
    legacyAccumDeprBase: row.legacy_accum_depr_base != null ? Number(row.legacy_accum_depr_base) : null,
    legacyNbvTxn: row.legacy_nbv_txn != null ? Number(row.legacy_nbv_txn) : null,
    legacyNbvBase: row.legacy_nbv_base != null ? Number(row.legacy_nbv_base) : null,
    assetAccountId: row.asset_account_id != null ? Number(row.asset_account_id) : null,
    accumDeprAccountId: row.accum_depr_account_id != null ? Number(row.accum_depr_account_id) : null,
    deprExpenseAccountId: row.depr_expense_account_id != null ? Number(row.depr_expense_account_id) : null,
    lastDepreciationPeriod: row.last_depreciation_period || null,
  }));
}

async function loadPersistedDepreciationScheduleLines({
  tenantId,
  scheduleLineIds,
  queryFn = query,
}) {
  const normalizedScheduleLineIds = getDistinctIds(scheduleLineIds);
  if (!tenantId) throw badRequest("tenantId is required");
  if (!normalizedScheduleLineIds.length) {
    return [];
  }

  const placeholders = normalizedScheduleLineIds.map(() => "?").join(", ");
  const result = await queryFn(
    `SELECT id,
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
       FROM fixed_asset_depreciation_schedule_lines
      WHERE tenant_id = ?
        AND id IN (${placeholders})
      ORDER BY id ASC
      FOR UPDATE`,
    [tenantId, ...normalizedScheduleLineIds]
  );

  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    assetId: Number(row.asset_id),
    periodKey: row.period_key,
    lineNo: Number(row.line_no || 0),
    plannedAmountTxn: roundAmount(row.planned_amount_txn || 0),
    plannedAmountBase: roundAmount(row.planned_amount_base || 0),
    openingNbvTxn: roundAmount(row.opening_nbv_txn || 0),
    openingNbvBase: roundAmount(row.opening_nbv_base || 0),
    closingNbvTxn: roundAmount(row.closing_nbv_txn || 0),
    closingNbvBase: roundAmount(row.closing_nbv_base || 0),
    status: normalizeUpperText(row.status),
    postedRunLineId: row.posted_run_line_id != null ? Number(row.posted_run_line_id) : null,
    postedTransactionId: row.posted_transaction_id != null ? Number(row.posted_transaction_id) : null,
  }));
}

async function loadPostedDepreciationRunPeriodsForScope({
  tenantId,
  legalEntityId,
  bookId,
  throughDate = null,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!legalEntityId) throw badRequest("legalEntityId is required");
  if (!bookId) throw badRequest("bookId is required");

  const result = await queryFn(
    `SELECT DISTINCT run.period_key,
            period.start_date,
            period.end_date
       FROM fixed_asset_depreciation_runs run
       JOIN fiscal_periods period
         ON period.id = run.fiscal_period_id
      WHERE run.tenant_id = ?
        AND run.legal_entity_id = ?
        AND run.book_id = ?
        AND run.status = 'POSTED'
        AND (? IS NULL OR period.end_date <= ?)
      ORDER BY run.period_key ASC`,
    [
      tenantId,
      legalEntityId,
      bookId,
      throughDate || null,
      throughDate || null,
    ]
  );

  return (result.rows || []).map((row) => ({
    periodKey: row.period_key || null,
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
  }));
}

export async function summarizeLateCatchUpPendingForLegalEntity({
  tenantId,
  legalEntityId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const zeroSummary = {
    legalEntityId: Number(legalEntityId),
    affectedAssetCount: 0,
    oldestPendingPeriodKey: null,
    latestPendingPeriodKey: null,
    estimatedCatchUpAmountBase: 0,
    oldestAcquisitionDate: null,
    latestAcquisitionDate: null,
  };

  const book = await resolveBookForLegalEntity(tenantId, legalEntityId, queryFn);
  const postedRunPeriods = await loadPostedDepreciationRunPeriodsForScope({
    tenantId,
    legalEntityId,
    bookId: Number(book.id),
    throughDate: null,
    queryFn,
  });
  if (!postedRunPeriods.length) {
    return zeroSummary;
  }

  const latestPostedRunPeriod = postedRunPeriods.at(-1) || null;
  const latestPostedRunPeriodKey = String(latestPostedRunPeriod?.periodKey || "").trim();
  const latestPostedRunEndDate = String(latestPostedRunPeriod?.endDate || "").trim();
  if (!latestPostedRunPeriodKey || !latestPostedRunEndDate) {
    return zeroSummary;
  }

  const postedRunPeriodKeys = new Set(
    postedRunPeriods.map((row) => String(row?.periodKey || "").trim()).filter(Boolean)
  );
  const candidateAssets = await listDepreciationRunAssetSnapshots({
    tenantId,
    legalEntityId,
    queryFn,
  });

  const summary = {
    ...zeroSummary,
  };

  for (const asset of candidateAssets) {
    if (
      isLowValueFullyExpensedAsset(asset)
      || normalizeUpperText(asset.depreciationMethod) === "NONE"
    ) {
      continue;
    }

    const lastDepreciationPeriod = String(asset?.lastDepreciationPeriod || "").trim();
    if (lastDepreciationPeriod && lastDepreciationPeriod >= latestPostedRunPeriodKey) {
      continue;
    }

    const inServiceDate = String(asset?.inServiceDate || "").trim();
    if (!inServiceDate || inServiceDate > latestPostedRunEndDate) {
      continue;
    }

    let scheduleContext;
    try {
      scheduleContext = await buildAssetDepreciationScheduleContext({
        tenantId,
        asset,
        book,
        queryFn,
      });
    } catch {
      continue;
    }

    const currentPostedPeriodKeys = new Set(
      (scheduleContext.currentPostedScheduleLines || [])
        .map((row) => String(row?.periodKey || "").trim())
        .filter(Boolean)
    );
    const pendingCatchUpRows = (scheduleContext.rows || []).filter((row) => (
      postedRunPeriodKeys.has(String(row?.periodKey || "").trim())
      && !currentPostedPeriodKeys.has(String(row?.periodKey || "").trim())
      && hasPositivePlannedAmount(row)
    ));
    if (!pendingCatchUpRows.length) {
      continue;
    }

    const earliestPendingRow = pendingCatchUpRows[0] || null;
    const latestPendingRow = pendingCatchUpRows.at(-1) || null;
    summary.affectedAssetCount += 1;
    summary.estimatedCatchUpAmountBase = roundAmount(
      summary.estimatedCatchUpAmountBase
      + pendingCatchUpRows.reduce(
        (sum, row) => sum + Number(row?.plannedAmountBase || 0),
        0
      )
    );

    const earliestPendingPeriodKey = String(earliestPendingRow?.periodKey || "").trim();
    const latestPendingPeriodValue = String(latestPendingRow?.periodKey || "").trim();
    const acquisitionDate = String(
      asset?.acquisitionDate || asset?.capitalizationDate || asset?.inServiceDate || ""
    ).trim();

    if (
      earliestPendingPeriodKey
      && (
        !summary.oldestPendingPeriodKey
        || earliestPendingPeriodKey < summary.oldestPendingPeriodKey
      )
    ) {
      summary.oldestPendingPeriodKey = earliestPendingPeriodKey;
    }
    if (
      latestPendingPeriodValue
      && (
        !summary.latestPendingPeriodKey
        || latestPendingPeriodValue > summary.latestPendingPeriodKey
      )
    ) {
      summary.latestPendingPeriodKey = latestPendingPeriodValue;
    }
    if (
      acquisitionDate
      && (
        !summary.oldestAcquisitionDate
        || acquisitionDate < summary.oldestAcquisitionDate
      )
    ) {
      summary.oldestAcquisitionDate = acquisitionDate;
    }
    if (
      acquisitionDate
      && (
        !summary.latestAcquisitionDate
        || acquisitionDate > summary.latestAcquisitionDate
      )
    ) {
      summary.latestAcquisitionDate = acquisitionDate;
    }
  }

  return summary;
}

async function loadCurrentPostedDepreciationScheduleStatsByAsset({
  tenantId,
  assetIds,
  queryFn = query,
  forUpdate = false,
}) {
  const normalizedAssetIds = getDistinctIds(assetIds);
  if (!tenantId) throw badRequest("tenantId is required");
  if (!normalizedAssetIds.length) {
    return new Map();
  }

  const placeholders = normalizedAssetIds.map(() => "?").join(", ");
  const result = await queryFn(
    `SELECT asset_id,
            COUNT(*) AS posted_count,
            MAX(period_key) AS last_period_key
       FROM fixed_asset_depreciation_schedule_lines
      WHERE tenant_id = ?
        AND asset_id IN (${placeholders})
        AND status = 'POSTED'
      GROUP BY asset_id${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, ...normalizedAssetIds]
  );

  return new Map(
    (result.rows || []).map((row) => [
      Number(row.asset_id),
      {
        postedCount: Number(row.posted_count || 0),
        lastPeriodKey: row.last_period_key || null,
      },
    ])
  );
}

async function loadCurrentPostedDepreciationScheduleLinesForAsset({
  tenantId,
  assetId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT id,
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
       FROM fixed_asset_depreciation_schedule_lines
      WHERE tenant_id = ?
        AND asset_id = ?
        AND status = 'POSTED'
      ORDER BY period_key ASC, line_no ASC, id ASC`,
    [tenantId, assetId]
  );

  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    assetId: Number(row.asset_id),
    periodKey: row.period_key,
    lineNo: Number(row.line_no || 0),
    plannedAmountTxn: roundAmount(row.planned_amount_txn || 0),
    plannedAmountBase: roundAmount(row.planned_amount_base || 0),
    openingNbvTxn: roundAmount(row.opening_nbv_txn || 0),
    openingNbvBase: roundAmount(row.opening_nbv_base || 0),
    closingNbvTxn: roundAmount(row.closing_nbv_txn || 0),
    closingNbvBase: roundAmount(row.closing_nbv_base || 0),
    status: normalizeUpperText(row.status),
    postedRunLineId: row.posted_run_line_id != null ? Number(row.posted_run_line_id) : null,
    postedTransactionId: row.posted_transaction_id != null ? Number(row.posted_transaction_id) : null,
  }));
}

async function loadLatestPostedCatchUpDepreciationTransactionForAsset({
  tenantId,
  assetId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT id,
            effective_date,
            nbv_amount_txn,
            nbv_amount_base
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id = ?
        AND status = 'POSTED'
        AND transaction_type = 'DEPRECIATION'
        AND depreciation_kind = 'CATCH_UP'
        AND reversal_transaction_id IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM fixed_asset_transactions rev
           WHERE rev.reversed_transaction_id = fixed_asset_transactions.id
             AND rev.status = 'POSTED'
        )
      ORDER BY effective_date DESC, id DESC
      LIMIT 1`,
    [tenantId, assetId]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    nbvAmountTxn: row.nbv_amount_txn != null ? Number(row.nbv_amount_txn) : null,
    nbvAmountBase: row.nbv_amount_base != null ? Number(row.nbv_amount_base) : null,
  };
}

async function loadCurrentSkippedDepreciationRunLinesForAsset({
  tenantId,
  assetId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT line.id,
            line.run_id,
            line.asset_id,
            line.fiscal_period_id,
            line.period_key,
            line.eligible_days,
            line.days_in_period,
            line.skip_reason_code,
            line.skip_reason_text
       FROM fixed_asset_depreciation_run_lines line
       JOIN fixed_asset_depreciation_runs run
         ON run.tenant_id = line.tenant_id
        AND run.id = line.run_id
      WHERE line.tenant_id = ?
        AND line.asset_id = ?
        AND line.status = 'SKIPPED'
        AND run.status = 'SKIPPED'
      ORDER BY line.period_key ASC, line.id ASC`,
    [tenantId, assetId]
  );

  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    runId: Number(row.run_id),
    assetId: Number(row.asset_id),
    fiscalPeriodId: Number(row.fiscal_period_id),
    periodKey: row.period_key,
    eligibleDays: Number(row.eligible_days || 0),
    daysInPeriod: Number(row.days_in_period || 0),
    skipReasonCode: row.skip_reason_code || null,
    skipReasonText: row.skip_reason_text || null,
  }));
}

async function loadFixedAssetTransactionsByIds({
  tenantId,
  transactionIds,
  forUpdate = false,
  queryFn = query,
}) {
  const normalizedTransactionIds = getDistinctIds(transactionIds);
  if (!tenantId) throw badRequest("tenantId is required");
  if (!normalizedTransactionIds.length) {
    return [];
  }

  const placeholders = normalizedTransactionIds.map(() => "?").join(", ");
  const result = await queryFn(
    `SELECT id,
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
            reversed_transaction_id,
            reversal_transaction_id,
            note
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND id IN (${placeholders})
      ORDER BY asset_id ASC, effective_date ASC, id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, ...normalizedTransactionIds]
  );

  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    assetId: Number(row.asset_id),
    transactionType: row.transaction_type || null,
    status: normalizeUpperText(row.status),
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    postingDate: row.posting_date ? String(row.posting_date).slice(0, 10) : null,
    bookId: row.book_id != null ? Number(row.book_id) : null,
    fiscalPeriodId: row.fiscal_period_id != null ? Number(row.fiscal_period_id) : null,
    currencyCode: row.currency_code || null,
    depreciationKind: row.depreciation_kind || null,
    journalEntryId: row.journal_entry_id != null ? Number(row.journal_entry_id) : null,
    reversedTransactionId: row.reversed_transaction_id != null
      ? Number(row.reversed_transaction_id)
      : null,
    reversalTransactionId: row.reversal_transaction_id != null
      ? Number(row.reversal_transaction_id)
      : null,
    note: row.note || null,
  }));
}

async function loadPostedFixedAssetTransactionsForAssets({
  tenantId,
  assetIds,
  queryFn = query,
}) {
  const normalizedAssetIds = getDistinctIds(assetIds);
  if (!tenantId) throw badRequest("tenantId is required");
  if (!normalizedAssetIds.length) {
    return [];
  }

  const placeholders = normalizedAssetIds.map(() => "?").join(", ");
  const result = await queryFn(
    `SELECT id,
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
            reversed_transaction_id,
            reversal_transaction_id,
            note
       FROM fixed_asset_transactions
      WHERE tenant_id = ?
        AND asset_id IN (${placeholders})
        AND status = 'POSTED'
      ORDER BY asset_id ASC, effective_date ASC, id ASC
      FOR UPDATE`,
    [tenantId, ...normalizedAssetIds]
  );

  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    assetId: Number(row.asset_id),
    transactionType: row.transaction_type || null,
    status: normalizeUpperText(row.status),
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    postingDate: row.posting_date ? String(row.posting_date).slice(0, 10) : null,
    bookId: row.book_id != null ? Number(row.book_id) : null,
    fiscalPeriodId: row.fiscal_period_id != null ? Number(row.fiscal_period_id) : null,
    currencyCode: row.currency_code || null,
    depreciationKind: row.depreciation_kind || null,
    journalEntryId: row.journal_entry_id != null ? Number(row.journal_entry_id) : null,
    reversedTransactionId: row.reversed_transaction_id != null
      ? Number(row.reversed_transaction_id)
      : null,
    reversalTransactionId: row.reversal_transaction_id != null
      ? Number(row.reversal_transaction_id)
      : null,
    note: row.note || null,
  }));
}

function findRunReversalBlockers({
  targetTransactions,
  candidateTransactions,
}) {
  const blockers = [];
  const targetTransactionIds = new Set((targetTransactions || []).map((item) => Number(item.id)));

  for (const target of targetTransactions || []) {
    const laterTransactions = (candidateTransactions || []).filter((candidate) => (
      Number(candidate.assetId) === Number(target.assetId)
      && !targetTransactionIds.has(Number(candidate.id))
      && isLaterFixedAssetTransaction(candidate, target)
    ));

    const laterLifecycle = laterTransactions.find((candidate) => (
      candidate.status === "POSTED"
      && candidate.transactionType !== "DEPRECIATION"
      && candidate.transactionType !== "REVERSAL"
    ));
    if (laterLifecycle) {
      blockers.push({
        blockerType: "LATER_LIFECYCLE_EVENT",
        assetId: Number(target.assetId),
        targetTransactionId: Number(target.id),
        targetEffectiveDate: target.effectiveDate,
        blockingTransactionId: Number(laterLifecycle.id),
        blockingTransactionType: laterLifecycle.transactionType,
        blockingEffectiveDate: laterLifecycle.effectiveDate,
      });
      continue;
    }

    const laterPostedDepreciation = laterTransactions.find((candidate) => (
      candidate.status === "POSTED"
      && candidate.transactionType === "DEPRECIATION"
      && (candidate.depreciationKind === "RUN" || candidate.depreciationKind === "CATCH_UP")
    ));
    if (laterPostedDepreciation) {
      blockers.push({
        blockerType: "LATER_POSTED_DEPRECIATION",
        assetId: Number(target.assetId),
        targetTransactionId: Number(target.id),
        targetEffectiveDate: target.effectiveDate,
        blockingTransactionId: Number(laterPostedDepreciation.id),
        blockingTransactionType: laterPostedDepreciation.transactionType,
        blockingEffectiveDate: laterPostedDepreciation.effectiveDate,
      });
    }
  }

  return blockers;
}

function sumRunLineAllocationAmounts(allocations, amountField) {
  return roundAmount(
    (allocations || []).reduce(
      (sum, allocation) => sum + Number(allocation?.[amountField] || 0),
      0
    )
  );
}

async function resolveDepreciationRunPostScope({
  tenantId,
  run,
  bookId,
  postingDate,
  queryFn = query,
}) {
  const operationalBook = await resolveBookForLegalEntity(
    tenantId,
    run.legalEntityId,
    queryFn
  );
  const operationalBookId = Number(operationalBook.id);

  if (bookId != null && Number(bookId) !== operationalBookId) {
    throw badRequest(
      `bookId (${Number(bookId)}) must match the operational fixed-assets book ` +
      `(${operationalBookId}) for legalEntityId=${run.legalEntityId}`
    );
  }
  if (Number(run.bookId) !== operationalBookId) {
    throw badRequest(
      `Run bookId (${Number(run.bookId)}) no longer matches the operational fixed-assets book ` +
      `(${operationalBookId}) for legalEntityId=${run.legalEntityId}`
    );
  }

  const period = await resolveSupportedFixedAssetFiscalPeriod(
    Number(operationalBook.calendar_id),
    run.fiscalPeriodId,
    queryFn
  );
  const resolvedPostingDate = resolveRunPostingDate(
    postingDate || run.postingDate || null,
    period
  );
  await ensurePeriodOpenForFixedAssets(
    operationalBookId,
    period.id,
    "post depreciation run",
    queryFn
  );

  return {
    book: operationalBook,
    period,
    postingDate: resolvedPostingDate,
  };
}

async function insertPostedDepreciationTransactionTx(tx, payload) {
  const depreciationKind = String(payload?.depreciationKind || "RUN").trim().toUpperCase();
  const result = await tx.query(
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
       note,
       created_by_user_id
     ) VALUES (
       ?, ?, ?, 'DEPRECIATION', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.assetId,
      payload.effectiveDate,
      payload.postingDate,
      payload.bookId,
      payload.fiscalPeriodId,
      payload.currencyCode,
      depreciationKind,
      payload.journalEntryId,
      payload.sourceRefType || null,
      payload.sourceRefId || null,
      payload.sourceRefLineId || null,
      payload.grossAmountTxn,
      payload.grossAmountBase,
      payload.accumDeprAmountTxn,
      payload.accumDeprAmountBase,
      payload.nbvAmountTxn,
      payload.nbvAmountBase,
      payload.note,
      payload.createdByUserId,
    ]
  );

  const transactionId = Number(result.rows?.insertId || 0);
  if (!transactionId) {
    throw badRequest(
      `Failed to persist posted depreciation transaction for assetId=${payload.assetId}`
    );
  }
  return transactionId;
}

function calculateInclusiveMonthCount(startDateText, endPeriodKey) {
  const normalizedEndPeriodKey = String(endPeriodKey || "").trim();
  if (!startDateText || !/^\d{4}-\d{2}$/.test(normalizedEndPeriodKey)) {
    return 0;
  }
  const startMonth = startOfMonth(parseDateOnly(startDateText, "startDate"));
  const endMonth = startOfMonth(parseDateOnly(`${normalizedEndPeriodKey}-01`, "endPeriodKey"));
  return Math.max(
    (endMonth.getUTCFullYear() - startMonth.getUTCFullYear()) * 12
      + (endMonth.getUTCMonth() - startMonth.getUTCMonth())
      + 1,
    0
  );
}

function buildRetroImprovementCatchUpAllocationSnapshots(scheduleRow, deltaTxn, deltaBase) {
  const correctedAllocations = buildAllocationSnapshotsForRunRow(scheduleRow);
  if (!correctedAllocations.length) {
    return [];
  }

  const correctedTotalTxn = Number(scheduleRow?.plannedAmountTxn || 0);
  const correctedTotalBase = Number(scheduleRow?.plannedAmountBase || 0);
  const totalEligibleDays = correctedAllocations.reduce(
    (sum, segment) => sum + Number(segment.eligibleDays || 0),
    0
  );
  let allocatedTxn = 0;
  let allocatedBase = 0;

  return correctedAllocations.map((segment, index) => {
    const isLastSegment = index === correctedAllocations.length - 1;
    const ratioTxn = Math.abs(correctedTotalTxn) > ROUNDING_UNIT
      ? Number(segment.plannedAmountTxn || 0) / correctedTotalTxn
      : (
        totalEligibleDays > 0
          ? Number(segment.eligibleDays || 0) / totalEligibleDays
          : 0
      );
    const ratioBase = Math.abs(correctedTotalBase) > ROUNDING_UNIT
      ? Number(segment.plannedAmountBase || 0) / correctedTotalBase
      : (
        totalEligibleDays > 0
          ? Number(segment.eligibleDays || 0) / totalEligibleDays
          : 0
      );
    const plannedAmountTxn = isLastSegment
      ? roundAmount(deltaTxn - allocatedTxn)
      : roundAmount(deltaTxn * ratioTxn);
    const plannedAmountBase = isLastSegment
      ? roundAmount(deltaBase - allocatedBase)
      : roundAmount(deltaBase * ratioBase);

    allocatedTxn = roundAmount(allocatedTxn + plannedAmountTxn);
    allocatedBase = roundAmount(allocatedBase + plannedAmountBase);

    return {
      allocationType: segment.allocationType || "OWNER_OU",
      operatingUnitId: segment.operatingUnitId != null ? Number(segment.operatingUnitId) : null,
      fromDate: segment.fromDate,
      toDate: segment.toDate,
      eligibleDays: Number(segment.eligibleDays || 0),
      plannedAmountTxn,
      plannedAmountBase,
    };
  });
}

function buildRetroImprovementCatchUpJournalLines({
  assetSnapshot,
  periodKey,
  allocationSnapshots,
  currencyCode,
}) {
  const journalLines = [];

  for (const allocation of Array.isArray(allocationSnapshots) ? allocationSnapshots : []) {
    const signedAmountTxn = roundAmount(allocation.plannedAmountTxn || 0);
    const signedAmountBase = roundAmount(allocation.plannedAmountBase || 0);
    if (
      Math.abs(signedAmountTxn) <= ROUNDING_UNIT
      && Math.abs(signedAmountBase) <= ROUNDING_UNIT
    ) {
      continue;
    }

    const isPositive = Math.abs(signedAmountBase) > ROUNDING_UNIT
      ? signedAmountBase > 0
      : signedAmountTxn > 0;
    const amountTxn = Math.abs(signedAmountTxn);
    const amountBase = Math.abs(signedAmountBase);
    const operatingUnitId = allocation.operatingUnitId ?? assetSnapshot.ownerOperatingUnitId ?? null;
    const assetLabel = String(assetSnapshot.assetNo || assetSnapshot.id || "").slice(0, 100);

    journalLines.push(
      buildCariDirectionalJournalLine({
        accountId: isPositive
          ? assetSnapshot.deprExpenseAccountId
          : assetSnapshot.accumDeprAccountId,
        side: "DEBIT",
        amountTxn,
        amountBase,
        lineDescription: `FA retro improvement catch-up ${assetLabel} ${periodKey}`.slice(0, 255),
        subledgerReferenceNo: assetLabel,
        currencyCode,
        operatingUnitId,
      })
    );
    journalLines.push(
      buildCariDirectionalJournalLine({
        accountId: isPositive
          ? assetSnapshot.accumDeprAccountId
          : assetSnapshot.deprExpenseAccountId,
        side: "CREDIT",
        amountTxn,
        amountBase,
        lineDescription: `FA retro improvement catch-up offset ${assetLabel} ${periodKey}`.slice(0, 255),
        subledgerReferenceNo: assetLabel,
        currencyCode,
        operatingUnitId,
      })
    );
  }

  return journalLines;
}

export async function postRetroImprovementCurrentPeriodCatchUpTx(tx, {
  tenantId,
  assetId,
  improvementEffectiveDate,
  postingDate,
  postImprovementNbvTxn,
  postImprovementNbvBase,
  improvementTransactionId = null,
  legalEntityId = null,
  bookId = null,
  fiscalPeriodId = null,
  userId = null,
  sourceRefType = null,
  sourceRefId = null,
  sourceRefLineId = null,
}) {
  if (!tx?.query) throw badRequest("tx is required");
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");
  if (!improvementEffectiveDate) throw badRequest("improvementEffectiveDate is required");
  if (!postingDate) throw badRequest("postingDate is required");

  const asset = await loadAssetDepreciationSnapshot({
    tenantId,
    assetId,
    queryFn: tx.query,
  });
  if (legalEntityId != null && Number(asset.legalEntityId) !== Number(legalEntityId)) {
    throw badRequest(
      `Asset ${assetId} does not belong to legalEntityId=${Number(legalEntityId)}`
    );
  }

  const scope = await resolveDepreciationRunScope({
    tenantId,
    legalEntityId: asset.legalEntityId,
    fiscalPeriodId,
    bookId,
    postingDate,
    actionLabel: "post retro improvement catch-up depreciation",
    queryFn: tx.query,
  });
  const effectivePeriodKey = derivePeriodKeyFromDate(improvementEffectiveDate);
  if (!effectivePeriodKey) {
    throw badRequest("improvementEffectiveDate must resolve to a fiscal period key");
  }
  if (comparePeriodKeys(effectivePeriodKey, scope.period.periodKey) >= 0) {
    return {
      posted: false,
      assetId,
      reasonCode: "EFFECTIVE_PERIOD_IS_CURRENT_OR_FUTURE",
    };
  }

  const currentPostedScheduleLines = await loadCurrentPostedDepreciationScheduleLinesForAsset({
    tenantId,
    assetId,
    queryFn: tx.query,
  });
  const affectedPostedScheduleLines = currentPostedScheduleLines.filter((row) => (
    comparePeriodKeys(row.periodKey, effectivePeriodKey) >= 0
    && comparePeriodKeys(row.periodKey, scope.period.periodKey) < 0
  ));
  if (!affectedPostedScheduleLines.length) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_POSTED_PERIODS_AFTER_EFFECTIVE_DATE",
    };
  }

  const depreciationMethod = normalizeUpperText(asset.depreciationMethod);
  const lifecycleHistory = await loadAssetDepreciationLifecycleHistory({
    tenantId,
    assetId,
    queryFn: tx.query,
  });
  const improvementHistory = await loadAssetDepreciationImprovementHistory({
    tenantId,
    assetId,
    queryFn: tx.query,
  });
  const currentImprovementTransactionId = resolveCurrentRetroImprovementTransactionId({
    improvementHistory,
    improvementTransactionId,
    improvementEffectiveDate,
    postingDate,
    sourceRefType,
    sourceRefId,
    sourceRefLineId,
  });
  if (!currentImprovementTransactionId) {
    throw badRequest(
      `Unable to resolve the posted improvement transaction for retro catch-up ` +
      `(assetId=${assetId}, effectiveDate=${String(improvementEffectiveDate).slice(0, 10)})`
    );
  }
  const currentImprovementHistoryRow = improvementHistory.find((historyRow) => (
    Number(historyRow.transactionId || 0) === Number(currentImprovementTransactionId)
  )) || null;
  if (!currentImprovementHistoryRow) {
    throw badRequest(
      `Posted improvement transaction ${currentImprovementTransactionId} was not found ` +
      `in depreciation history for assetId=${assetId}`
    );
  }
  const baselineImprovementHistory = improvementHistory.filter((historyRow) => (
    Number(historyRow.transactionId || 0) !== Number(currentImprovementTransactionId)
  ));
  const lastAffectedScheduleLine = affectedPostedScheduleLines.at(-1) || null;
  const throughPeriodKey = lastAffectedScheduleLine?.periodKey || null;
  const correctedRowsByPeriodKey = await buildCorrectedHistoricalRowsByPeriodKey({
    tenantId,
    asset,
    book: scope.book,
    depreciationMethod,
    lifecycleHistory,
    improvementHistory,
    throughPeriodKey,
    queryFn: tx.query,
  });
  const baselineAsset = buildAssetSnapshotBeforeImprovement(
    asset,
    currentImprovementHistoryRow,
    improvementHistory
  );
  const baselineRowsByPeriodKey = await buildCorrectedHistoricalRowsByPeriodKey({
    tenantId,
    asset: baselineAsset,
    book: scope.book,
    depreciationMethod,
    lifecycleHistory,
    improvementHistory: baselineImprovementHistory,
    throughPeriodKey,
    queryFn: tx.query,
  });

  const deltaRows = [];
  let totalDeltaTxn = 0;
  let totalDeltaBase = 0;

  for (const actualRow of affectedPostedScheduleLines) {
    const correctedRow = correctedRowsByPeriodKey.get(actualRow.periodKey) || null;
    const baselineRow = baselineRowsByPeriodKey.get(actualRow.periodKey) || null;
    if (!correctedRow) {
      throw badRequest(
        `Missing corrected depreciation schedule row for asset ${assetId} period ${actualRow.periodKey}`
      );
    }
    if (!baselineRow) {
      throw badRequest(
        `Missing baseline depreciation schedule row for asset ${assetId} period ${actualRow.periodKey}`
      );
    }

    const deltaTxn = roundAmount(
      Number(correctedRow.plannedAmountTxn || 0) - Number(baselineRow.plannedAmountTxn || 0)
    );
    const deltaBase = roundAmount(
      Number(correctedRow.plannedAmountBase || 0) - Number(baselineRow.plannedAmountBase || 0)
    );
    if (Math.abs(deltaTxn) <= ROUNDING_UNIT && Math.abs(deltaBase) <= ROUNDING_UNIT) {
      continue;
    }

    const allocationSnapshots = buildRetroImprovementCatchUpAllocationSnapshots(
      correctedRow,
      deltaTxn,
      deltaBase
    );
    if (!allocationSnapshots.length) {
      throw badRequest(
        `Retro improvement catch-up requires allocation segments for asset ${assetId} period ${actualRow.periodKey}`
      );
    }

    deltaRows.push({
      periodKey: actualRow.periodKey,
      periodEndDate: correctedRow.periodEndDate || null,
      deltaTxn,
      deltaBase,
      correctedRow,
      allocationSnapshots,
    });
    totalDeltaTxn = roundAmount(totalDeltaTxn + deltaTxn);
    totalDeltaBase = roundAmount(totalDeltaBase + deltaBase);
  }

  if (!deltaRows.length) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_CATCH_UP_DELTA",
    };
  }

  const assetPostingSnapshots = await loadAssetDepreciationPostingSnapshots({
    tenantId,
    assetIds: [assetId],
    queryFn: tx.query,
  });
  const assetSnapshot = assetPostingSnapshots[0] || null;
  if (!assetSnapshot) {
    throw badRequest(`Missing asset posting snapshot for assetId=${assetId}`);
  }
  if (!assetSnapshot.deprExpenseAccountId || !assetSnapshot.accumDeprAccountId) {
    throw badRequest(`Asset ${assetId} is missing depreciation posting accounts`);
  }

  const journalLines = [];
  for (const deltaRow of deltaRows) {
    journalLines.push(
      ...buildRetroImprovementCatchUpJournalLines({
        assetSnapshot,
        periodKey: deltaRow.periodKey,
        allocationSnapshots: deltaRow.allocationSnapshots,
        currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
      })
    );
  }
  if (!journalLines.length) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_JOURNAL_LINES",
    };
  }

  const correctedCurrentNbvTxn = roundAmount(
    Number(postImprovementNbvTxn || 0) - Number(totalDeltaTxn || 0)
  );
  const correctedCurrentNbvBase = roundAmount(
    Number(postImprovementNbvBase || 0) - Number(totalDeltaBase || 0)
  );
  const lastDeltaRow = deltaRows.at(-1) || null;
  const periodGrossAmounts = resolveDepreciationGrossAmountsForPeriod({
    asset: assetSnapshot,
    improvementHistory,
    periodKey: lastDeltaRow?.periodKey,
  });

  const journalResult = await insertPostedJournalWithLinesTx(tx, {
    tenantId,
    legalEntityId: assetSnapshot.legalEntityId,
    bookId: Number(scope.book.id),
    fiscalPeriodId: Number(scope.period.id),
    userId,
    journalNo: buildFixedAssetCatchUpJournalNo(assetId),
    entryDate: scope.postingDate,
    documentDate: scope.postingDate,
    currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
    description:
      `FA retro improvement catch-up ${assetSnapshot.assetNo || assetId} through ${lastDeltaRow?.periodKey || effectivePeriodKey}`.slice(0, 500),
    referenceNo: String(assetSnapshot.assetNo || assetId).slice(0, 100),
    lines: journalLines,
    operatingUnitId: assetSnapshot.ownerOperatingUnitId ?? null,
  });

  const transactionId = await insertPostedDepreciationTransactionTx(tx, {
    tenantId,
    legalEntityId: assetSnapshot.legalEntityId,
    assetId,
    effectiveDate: lastDeltaRow?.periodEndDate || scope.postingDate,
    postingDate: scope.postingDate,
    bookId: Number(scope.book.id),
    fiscalPeriodId: Number(scope.period.id),
    currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
    depreciationKind: "CATCH_UP",
    journalEntryId: journalResult.journalEntryId,
    sourceRefType,
    sourceRefId,
    sourceRefLineId,
    grossAmountTxn: periodGrossAmounts.grossAmountTxn,
    grossAmountBase: periodGrossAmounts.grossAmountBase,
    accumDeprAmountTxn: roundAmount(
      periodGrossAmounts.grossAmountTxn - correctedCurrentNbvTxn
    ),
    accumDeprAmountBase: roundAmount(
      periodGrossAmounts.grossAmountBase - correctedCurrentNbvBase
    ),
    nbvAmountTxn: correctedCurrentNbvTxn,
    nbvAmountBase: correctedCurrentNbvBase,
    note:
      `Retro improvement catch-up through ${lastDeltaRow?.periodKey || effectivePeriodKey}`.slice(0, 1000),
    createdByUserId: userId,
  });

  await upsertJournalSourceLinkTx(tx, {
    tenantId,
    legalEntityId: assetSnapshot.legalEntityId,
    journalEntryId: journalResult.journalEntryId,
    sourceRefType: FIXED_ASSET_TRANSACTION,
    sourceRefId: transactionId,
    linkRole: "PRIMARY",
  });

  const fullyDepreciated = (
    correctedCurrentNbvTxn <= roundAmount(assetSnapshot.salvageValueTxn || 0)
    && correctedCurrentNbvBase <= roundAmount(assetSnapshot.salvageValueBase || 0)
  );
  await tx.query(
    `UPDATE fixed_assets
        SET status = CASE
              WHEN ? = 1 AND status <> 'DISPOSED' THEN 'FULLY_DEPRECIATED'
              WHEN ? = 0 AND status = 'FULLY_DEPRECIATED' THEN 'ACTIVE'
              ELSE status
            END,
            updated_by_user_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [
      fullyDepreciated ? 1 : 0,
      fullyDepreciated ? 1 : 0,
      userId,
      tenantId,
      assetId,
    ]
  );

  return {
    posted: true,
    assetId,
    transactionId,
    journalEntryId: journalResult.journalEntryId,
    postingDate: scope.postingDate,
    effectiveDate: lastDeltaRow?.periodEndDate || scope.postingDate,
    catchUpPeriodKeys: deltaRows.map((row) => row.periodKey),
    totalAmountTxn: totalDeltaTxn,
    totalAmountBase: totalDeltaBase,
    nbvAmountTxn: correctedCurrentNbvTxn,
    nbvAmountBase: correctedCurrentNbvBase,
  };
}

export async function postLateAssetCatchUpDepreciationTx(tx, {
  tenantId,
  assetId,
  legalEntityId = null,
  bookId = null,
  fiscalPeriodId = null,
  postingDate,
  userId = null,
}) {
  if (!tx?.query) throw badRequest("tx is required");
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");
  if (!postingDate) throw badRequest("postingDate is required");

  const asset = await loadAssetDepreciationSnapshot({
    tenantId,
    assetId,
    queryFn: tx.query,
  });
  if (legalEntityId != null && Number(asset.legalEntityId) !== Number(legalEntityId)) {
    throw badRequest(
      `Asset ${assetId} does not belong to legalEntityId=${Number(legalEntityId)}`
    );
  }
  if (
    asset.status === "DRAFT"
    || asset.status === "CANCELLED"
    || asset.status === "DISPOSED"
  ) {
    return {
      posted: false,
      assetId,
      reasonCode: "ASSET_STATUS_INELIGIBLE",
    };
  }
  if (
    isLowValueFullyExpensedAsset(asset)
    || normalizeUpperText(asset.depreciationMethod) === "NONE"
  ) {
    return {
      posted: false,
      assetId,
      reasonCode: "NOT_DEPRECIABLE",
    };
  }

  const scope = await resolveDepreciationRunScope({
    tenantId,
    legalEntityId: asset.legalEntityId,
    fiscalPeriodId,
    bookId,
    postingDate,
    actionLabel: "post late asset catch-up depreciation",
    queryFn: tx.query,
  });

  const postedRunPeriods = await loadPostedDepreciationRunPeriodsForScope({
    tenantId,
    legalEntityId: asset.legalEntityId,
    bookId: Number(scope.book.id),
    throughDate: scope.postingDate,
    queryFn: tx.query,
  });
  if (!postedRunPeriods.length) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_PRIOR_POSTED_PERIODS",
    };
  }

  const scheduleContext = await buildAssetDepreciationScheduleContext({
    tenantId,
    asset,
    book: scope.book,
    queryFn: tx.query,
  });
  const currentPostedPeriodKeys = new Set(
    (scheduleContext.currentPostedScheduleLines || []).map((row) => row.periodKey)
  );
  const postedRunPeriodKeys = new Set(
    postedRunPeriods.map((row) => row.periodKey).filter(Boolean)
  );
  const catchUpRows = (scheduleContext.rows || []).filter((row) => (
    postedRunPeriodKeys.has(row.periodKey)
    && !currentPostedPeriodKeys.has(row.periodKey)
    && hasPositivePlannedAmount(row)
  ));
  if (!catchUpRows.length) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_MISSED_POSTED_PERIODS",
    };
  }

  const assetPostingSnapshots = await loadAssetDepreciationPostingSnapshots({
    tenantId,
    assetIds: [assetId],
    queryFn: tx.query,
  });
  const assetSnapshot = assetPostingSnapshots[0] || null;
  if (!assetSnapshot) {
    throw badRequest(`Missing asset posting snapshot for assetId=${assetId}`);
  }
  if (!assetSnapshot.deprExpenseAccountId || !assetSnapshot.accumDeprAccountId) {
    throw badRequest(`Asset ${assetId} is missing depreciation posting accounts`);
  }
  const improvementHistory = await loadAssetDepreciationImprovementHistory({
    tenantId,
    assetId,
    queryFn: tx.query,
  });

  const journalLines = [];
  let totalCatchUpAmountTxn = 0;
  let totalCatchUpAmountBase = 0;

  for (const row of catchUpRows) {
    const allocations = buildAllocationSnapshotsForRunRow(row);
    if (!allocations.length) {
      throw badRequest(
        `Late catch-up depreciation requires allocation segments for asset ${assetId} period ${row.periodKey}`
      );
    }

    const allocatedTxn = sumRunLineAllocationAmounts(allocations, "plannedAmountTxn");
    const allocatedBase = sumRunLineAllocationAmounts(allocations, "plannedAmountBase");
    if (
      Math.abs(allocatedTxn - Number(row.plannedAmountTxn || 0)) > ROUNDING_UNIT
      || Math.abs(allocatedBase - Number(row.plannedAmountBase || 0)) > ROUNDING_UNIT
    ) {
      throw badRequest(
        `Catch-up allocation totals do not match planned amounts for asset ${assetId} period ${row.periodKey}`
      );
    }

    for (const allocation of allocations) {
      const amountTxn = roundAmount(allocation.plannedAmountTxn || 0);
      const amountBase = roundAmount(allocation.plannedAmountBase || 0);
      if (amountTxn <= 0 && amountBase <= 0) {
        continue;
      }

      const operatingUnitId = allocation.operatingUnitId ?? assetSnapshot.ownerOperatingUnitId ?? null;
      journalLines.push(
        buildCariDirectionalJournalLine({
          accountId: assetSnapshot.deprExpenseAccountId,
          side: "DEBIT",
          amountTxn,
          amountBase,
          lineDescription: `FA catch-up depreciation ${assetSnapshot.assetNo || assetId} ${row.periodKey}`.slice(0, 255),
          subledgerReferenceNo: String(assetSnapshot.assetNo || assetId).slice(0, 100),
          currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
          operatingUnitId,
        })
      );
      journalLines.push(
        buildCariDirectionalJournalLine({
          accountId: assetSnapshot.accumDeprAccountId,
          side: "CREDIT",
          amountTxn,
          amountBase,
          lineDescription: `FA catch-up accum depreciation ${assetSnapshot.assetNo || assetId} ${row.periodKey}`.slice(0, 255),
          subledgerReferenceNo: String(assetSnapshot.assetNo || assetId).slice(0, 100),
          currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
          operatingUnitId,
        })
      );
    }

    totalCatchUpAmountTxn = roundAmount(totalCatchUpAmountTxn + Number(row.plannedAmountTxn || 0));
    totalCatchUpAmountBase = roundAmount(totalCatchUpAmountBase + Number(row.plannedAmountBase || 0));
  }

  if (!journalLines.length) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_JOURNAL_LINES",
    };
  }

  const lastCatchUpRow = catchUpRows.at(-1) || null;
  if (!lastCatchUpRow) {
    return {
      posted: false,
      assetId,
      reasonCode: "NO_CATCH_UP_ROWS",
    };
  }

  const journalResult = await insertPostedJournalWithLinesTx(tx, {
    tenantId,
    legalEntityId: assetSnapshot.legalEntityId,
    bookId: Number(scope.book.id),
    fiscalPeriodId: Number(scope.period.id),
    userId,
    journalNo: buildFixedAssetCatchUpJournalNo(assetId),
    entryDate: scope.postingDate,
    documentDate: scope.postingDate,
    currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
    description: `FA catch-up depreciation ${assetSnapshot.assetNo || assetId} through ${lastCatchUpRow.periodKey}`.slice(0, 500),
    referenceNo: String(assetSnapshot.assetNo || assetId).slice(0, 100),
    lines: journalLines,
    operatingUnitId: assetSnapshot.ownerOperatingUnitId ?? null,
  });

  const periodGrossAmounts = resolveDepreciationGrossAmountsForPeriod({
    asset: assetSnapshot,
    improvementHistory,
    periodKey: lastCatchUpRow.periodKey,
  });
  const transactionId = await insertPostedDepreciationTransactionTx(tx, {
    tenantId,
    legalEntityId: assetSnapshot.legalEntityId,
    assetId,
    effectiveDate: lastCatchUpRow.periodEndDate || scope.postingDate,
    postingDate: scope.postingDate,
    bookId: Number(scope.book.id),
    fiscalPeriodId: Number(scope.period.id),
    currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
    depreciationKind: "CATCH_UP",
    journalEntryId: journalResult.journalEntryId,
    grossAmountTxn: periodGrossAmounts.grossAmountTxn,
    grossAmountBase: periodGrossAmounts.grossAmountBase,
    accumDeprAmountTxn: roundAmount(
      periodGrossAmounts.grossAmountTxn - Number(lastCatchUpRow.closingNbvTxn || 0)
    ),
    accumDeprAmountBase: roundAmount(
      periodGrossAmounts.grossAmountBase - Number(lastCatchUpRow.closingNbvBase || 0)
    ),
    nbvAmountTxn: roundAmount(lastCatchUpRow.closingNbvTxn || 0),
    nbvAmountBase: roundAmount(lastCatchUpRow.closingNbvBase || 0),
    note: `Late catch-up depreciation through ${lastCatchUpRow.periodKey}`.slice(0, 1000),
    createdByUserId: userId,
  });

  await upsertJournalSourceLinkTx(tx, {
    tenantId,
    legalEntityId: assetSnapshot.legalEntityId,
    journalEntryId: journalResult.journalEntryId,
    sourceRefType: FIXED_ASSET_TRANSACTION,
    sourceRefId: transactionId,
    linkRole: "PRIMARY",
  });

  for (const row of catchUpRows) {
    await upsertDisposalCutoffPostedScheduleLineTx(tx, {
      tenantId,
      legalEntityId: assetSnapshot.legalEntityId,
      assetId,
      periodKey: row.periodKey,
      plannedAmountTxn: row.plannedAmountTxn,
      plannedAmountBase: row.plannedAmountBase,
      openingNbvTxn: row.openingNbvTxn,
      openingNbvBase: row.openingNbvBase,
      closingNbvTxn: row.closingNbvTxn,
      closingNbvBase: row.closingNbvBase,
      postedTransactionId: transactionId,
    });
  }

  const postedScheduleStatsByAsset = await loadCurrentPostedDepreciationScheduleStatsByAsset({
    tenantId,
    assetIds: [assetId],
    queryFn: tx.query,
    forUpdate: true,
  });
  const postedScheduleStats = postedScheduleStatsByAsset.get(assetId) || {
    postedCount: 0,
    lastPeriodKey: null,
  };
  const remainingUsefulLifeMonths = resolveCurrentRemainingUsefulLifeMonths(
    assetSnapshot,
    postedScheduleStats.postedCount
  );
  const fullyDepreciated = (
    roundAmount(lastCatchUpRow.closingNbvTxn || 0) <= roundAmount(assetSnapshot.salvageValueTxn || 0)
    && roundAmount(lastCatchUpRow.closingNbvBase || 0) <= roundAmount(assetSnapshot.salvageValueBase || 0)
  );

  await tx.query(
    `UPDATE fixed_assets
        SET last_depreciation_period = ?,
            remaining_useful_life_months = ?,
            status = CASE
              WHEN ? = 1 AND status <> 'DISPOSED' THEN 'FULLY_DEPRECIATED'
              ELSE status
            END,
            updated_by_user_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [
      postedScheduleStats.lastPeriodKey || null,
      remainingUsefulLifeMonths,
      fullyDepreciated ? 1 : 0,
      userId,
      tenantId,
      assetId,
    ]
  );

  return {
    posted: true,
    assetId,
    transactionId,
    journalEntryId: journalResult.journalEntryId,
    postingDate: scope.postingDate,
    catchUpPeriodKeys: catchUpRows.map((row) => row.periodKey),
    totalAmountTxn: totalCatchUpAmountTxn,
    totalAmountBase: totalCatchUpAmountBase,
    lastDepreciationPeriod: postedScheduleStats.lastPeriodKey || null,
  };
}

export async function postDepreciationRun({
  tenantId,
  runId,
  bookId = null,
  postingDate = null,
  userId = null,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  return withTransaction(async (tx) => {
    const run = await loadPersistedDepreciationRunHeader({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    if (!run) {
      throw badRequest(`Depreciation run (id=${runId}) not found for tenant`);
    }
    if (run.status !== "DRAFT") {
      throw badRequest(
        `Only DRAFT depreciation runs can be posted (runId=${runId}, status=${run.status})`
      );
    }

    const scope = await resolveDepreciationRunPostScope({
      tenantId,
      run,
      bookId,
      postingDate,
      queryFn: tx.query,
    });

    const lines = await loadPersistedDepreciationRunLines({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    const allocations = await loadPersistedDepreciationRunAllocations({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    const linesWithAllocations = attachAllocationSnapshotsToRunLines(lines, allocations);

    if (!linesWithAllocations.length) {
      throw badRequest(`Depreciation run (id=${runId}) has no persisted lines to post`);
    }

    const errorLines = linesWithAllocations.filter((line) => line.status === "ERROR");
    if (errorLines.length > 0) {
      throw badRequest(
        `Depreciation run (id=${runId}) contains ERROR lines and cannot be posted; delete the draft and recreate it`
      );
    }

    const readyLines = linesWithAllocations.filter((line) => line.status === "READY");
    if (readyLines.length === 0) {
      throw badRequest(
        `Depreciation run (id=${runId}) has no READY lines to post`
      );
    }

    const scheduleLineIds = getDistinctIds(readyLines.map((line) => line.scheduleLineId));
    if (scheduleLineIds.length !== readyLines.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) is missing persisted schedule snapshot links; delete the draft and recreate it`
      );
    }

    const scheduleLines = await loadPersistedDepreciationScheduleLines({
      tenantId,
      scheduleLineIds,
      queryFn: tx.query,
    });
    if (scheduleLines.length !== scheduleLineIds.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) has incomplete persisted schedule snapshot rows; delete the draft and recreate it`
      );
    }
    const scheduleLinesById = new Map(scheduleLines.map((line) => [line.id, line]));

    const readyAssetIds = getDistinctIds(readyLines.map((line) => line.assetId));
    const assetSnapshots = await loadAssetDepreciationPostingSnapshots({
      tenantId,
      assetIds: readyAssetIds,
      queryFn: tx.query,
    });
    if (assetSnapshots.length !== readyAssetIds.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) references missing asset posting snapshots`
      );
    }
    const assetSnapshotsById = new Map(assetSnapshots.map((asset) => [asset.id, asset]));
    const improvementHistoryByAssetId = await loadAssetDepreciationImprovementHistoryByAssetIds({
      tenantId,
      assetIds: readyAssetIds,
      queryFn: tx.query,
    });
    const readyLinePeriodIds = getDistinctIds(readyLines.map((line) => line.fiscalPeriodId));
    const readyLinePeriodById = new Map();
    if (readyLinePeriodIds.length > 0) {
      const periodResult = await tx.query(
        `SELECT id, end_date
           FROM fiscal_periods
          WHERE id IN (${readyLinePeriodIds.map(() => "?").join(", ")})`,
        readyLinePeriodIds
      );
      for (const row of periodResult.rows || []) {
        readyLinePeriodById.set(Number(row.id), String(row.end_date || "").slice(0, 10) || null);
      }
    }

    const conflictConditions = readyLines.map(() => "(asset_id = ? AND period_key = ?)");
    const conflictParams = [];
    for (const readyLine of readyLines) {
      conflictParams.push(readyLine.assetId, readyLine.periodKey);
    }
    const conflictResult = await tx.query(
      `SELECT id, asset_id, period_key
         FROM fixed_asset_depreciation_schedule_lines
        WHERE tenant_id = ?
          AND status = 'POSTED'
          AND (${conflictConditions.join(" OR ")})
          AND id NOT IN (${scheduleLineIds.map(() => "?").join(", ")})
        FOR UPDATE`,
      [tenantId, ...conflictParams, ...scheduleLineIds]
    );
    if ((conflictResult.rows || []).length > 0) {
      const conflict = conflictResult.rows[0];
      throw badRequest(
        `Asset ${Number(conflict.asset_id)} already has a current posted depreciation result for period ${conflict.period_key}`
      );
    }

    const journalLines = [];
    for (const readyLine of readyLines) {
      const assetSnapshot = assetSnapshotsById.get(readyLine.assetId);
      const scheduleLine = scheduleLinesById.get(readyLine.scheduleLineId);
      const depreciationKind = deriveRunRowDepreciationKind(readyLine, run.periodKey);
      if (!assetSnapshot) {
        throw badRequest(`Missing asset posting snapshot for assetId=${readyLine.assetId}`);
      }
      if (!scheduleLine) {
        throw badRequest(`Missing schedule snapshot row for runLineId=${readyLine.id}`);
      }
      if (scheduleLine.status !== "PLANNED") {
        throw badRequest(
          `Schedule line ${scheduleLine.id} must be PLANNED before posting (status=${scheduleLine.status})`
        );
      }
      if (scheduleLine.assetId !== readyLine.assetId || scheduleLine.periodKey !== readyLine.periodKey) {
        throw badRequest(
          `Schedule line ${scheduleLine.id} does not match the frozen run line snapshot`
        );
      }
      if (!assetSnapshot.deprExpenseAccountId || !assetSnapshot.accumDeprAccountId) {
        throw badRequest(
          `Asset ${readyLine.assetId} is missing depreciation posting accounts`
        );
      }
      if (!readyLine.allocations.length) {
        throw badRequest(
          `Run line ${readyLine.id} is missing frozen allocation rows; delete the draft and recreate it`
        );
      }

      const allocatedTxn = sumRunLineAllocationAmounts(readyLine.allocations, "plannedAmountTxn");
      const allocatedBase = sumRunLineAllocationAmounts(readyLine.allocations, "plannedAmountBase");
      if (
        Math.abs(allocatedTxn - Number(readyLine.plannedAmountTxn || 0)) > ROUNDING_UNIT
        || Math.abs(allocatedBase - Number(readyLine.plannedAmountBase || 0)) > ROUNDING_UNIT
      ) {
        throw badRequest(
          `Run line ${readyLine.id} allocation totals do not match the frozen planned amounts`
        );
      }

      for (const allocation of readyLine.allocations) {
        const operatingUnitId = allocation.operatingUnitId ?? assetSnapshot.ownerOperatingUnitId ?? null;
        const amountTxn = roundAmount(allocation.plannedAmountTxn || 0);
        const amountBase = roundAmount(allocation.plannedAmountBase || 0);
        if (amountTxn <= 0 && amountBase <= 0) {
          continue;
        }

        journalLines.push(
          buildCariDirectionalJournalLine({
            accountId: assetSnapshot.deprExpenseAccountId,
            side: "DEBIT",
            amountTxn,
            amountBase,
            lineDescription: (
              depreciationKind === "CATCH_UP"
                ? `FA catch-up depreciation ${assetSnapshot.assetNo || readyLine.assetId} ${readyLine.periodKey}`
                : `FA depreciation ${assetSnapshot.assetNo || readyLine.assetId} ${readyLine.periodKey}`
            ).slice(0, 255),
            subledgerReferenceNo: String(assetSnapshot.assetNo || readyLine.assetId).slice(0, 100),
            currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
            operatingUnitId,
          })
        );
        journalLines.push(
          buildCariDirectionalJournalLine({
            accountId: assetSnapshot.accumDeprAccountId,
            side: "CREDIT",
            amountTxn,
            amountBase,
            lineDescription: (
              depreciationKind === "CATCH_UP"
                ? `FA catch-up accum depreciation ${assetSnapshot.assetNo || readyLine.assetId} ${readyLine.periodKey}`
                : `FA accumulated depreciation ${assetSnapshot.assetNo || readyLine.assetId} ${readyLine.periodKey}`
            ).slice(0, 255),
            subledgerReferenceNo: String(assetSnapshot.assetNo || readyLine.assetId).slice(0, 100),
            currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
            operatingUnitId,
          })
        );
      }
    }

    if (!journalLines.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) did not produce any journal lines from the frozen snapshot`
      );
    }

    const journalResult = await insertPostedJournalWithLinesTx(tx, {
      tenantId,
      legalEntityId: run.legalEntityId,
      bookId: scope.book.id,
      fiscalPeriodId: run.fiscalPeriodId,
      journalNo: buildFixedAssetRunJournalNo(run.id),
      entryDate: scope.postingDate,
      documentDate: scope.postingDate,
      currencyCode: scope.book.base_currency_code || "BASE",
      description: `FA depreciation run ${run.id} ${run.periodKey}`.slice(0, 255),
      referenceNo: `FA-RUN:${run.id}:${run.periodKey}`.slice(0, 100),
      userId,
      lines: journalLines,
    });

    await upsertJournalSourceLinkTx(tx, {
      tenantId,
      legalEntityId: run.legalEntityId,
      journalEntryId: journalResult.journalEntryId,
      sourceRefType: FIXED_ASSET_DEPRECIATION_RUN,
      sourceRefId: run.id,
      linkRole: "PRIMARY",
    });

    let totalPostedAmountTxn = 0;
    let totalPostedAmountBase = 0;
    const fullyDepreciatedAssetIds = [];

    for (const readyLine of readyLines) {
      const assetSnapshot = assetSnapshotsById.get(readyLine.assetId);
      const scheduleLine = scheduleLinesById.get(readyLine.scheduleLineId);
      const depreciationKind = deriveRunRowDepreciationKind(readyLine, run.periodKey);
      const periodGrossAmounts = resolveDepreciationGrossAmountsForPeriod({
        asset: assetSnapshot,
        improvementHistory: improvementHistoryByAssetId.get(readyLine.assetId) || [],
        periodKey: readyLine.periodKey,
      });
      const accumDeprAmountTxn = roundAmount(
        periodGrossAmounts.grossAmountTxn - scheduleLine.closingNbvTxn
      );
      const accumDeprAmountBase = roundAmount(
        periodGrossAmounts.grossAmountBase - scheduleLine.closingNbvBase
      );
      const nbvAmountTxn = roundAmount(scheduleLine.closingNbvTxn);
      const nbvAmountBase = roundAmount(scheduleLine.closingNbvBase);
      const transactionEffectiveDate = (
        depreciationKind === "CATCH_UP"
          ? readyLinePeriodById.get(readyLine.fiscalPeriodId) || scope.postingDate
          : scope.postingDate
      );

      const transactionId = await insertPostedDepreciationTransactionTx(tx, {
        tenantId,
        legalEntityId: run.legalEntityId,
        assetId: readyLine.assetId,
        effectiveDate: transactionEffectiveDate,
        postingDate: scope.postingDate,
        bookId: scope.book.id,
        fiscalPeriodId: run.fiscalPeriodId,
        currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
        depreciationKind,
        journalEntryId: journalResult.journalEntryId,
        grossAmountTxn: periodGrossAmounts.grossAmountTxn,
        grossAmountBase: periodGrossAmounts.grossAmountBase,
        accumDeprAmountTxn,
        accumDeprAmountBase,
        nbvAmountTxn,
        nbvAmountBase,
        note: (
          depreciationKind === "CATCH_UP"
            ? `Catch-up depreciation posted in run ${run.id} for historical period ${readyLine.periodKey}`
            : `Depreciation run ${run.id} ${run.periodKey}`
        ).slice(0, 1000),
        createdByUserId: userId,
      });

      await tx.query(
        `UPDATE fixed_asset_depreciation_run_lines
            SET status = 'POSTED',
                posted_transaction_id = ?
          WHERE tenant_id = ?
            AND id = ?`,
        [transactionId, tenantId, readyLine.id]
      );

      await tx.query(
        `UPDATE fixed_asset_depreciation_schedule_lines
            SET status = 'POSTED',
                posted_run_line_id = ?,
                posted_transaction_id = ?
          WHERE tenant_id = ?
            AND id = ?`,
        [readyLine.id, transactionId, tenantId, scheduleLine.id]
      );

      totalPostedAmountTxn = roundAmount(totalPostedAmountTxn + Number(readyLine.plannedAmountTxn || 0));
      totalPostedAmountBase = roundAmount(totalPostedAmountBase + Number(readyLine.plannedAmountBase || 0));

      if (
        nbvAmountTxn <= roundAmount(assetSnapshot.salvageValueTxn || 0)
        && nbvAmountBase <= roundAmount(assetSnapshot.salvageValueBase || 0)
      ) {
        fullyDepreciatedAssetIds.push(readyLine.assetId);
      }
    }

    const postedScheduleStatsByAsset = await loadCurrentPostedDepreciationScheduleStatsByAsset({
      tenantId,
      assetIds: readyAssetIds,
      queryFn: tx.query,
      forUpdate: true,
    });
    for (const assetId of readyAssetIds) {
      const assetSnapshot = assetSnapshotsById.get(assetId);
      if (!assetSnapshot) {
        throw badRequest(`Missing asset posting snapshot for assetId=${assetId}`);
      }
      const postedScheduleStats = postedScheduleStatsByAsset.get(assetId) || {
        postedCount: 0,
        lastPeriodKey: run.periodKey,
      };
      const remainingUsefulLifeMonths = resolveCurrentRemainingUsefulLifeMonths(
        assetSnapshot,
        postedScheduleStats.postedCount
      );
      await tx.query(
        `UPDATE fixed_assets
            SET last_depreciation_period = ?,
                remaining_useful_life_months = ?,
                updated_by_user_id = ?
          WHERE tenant_id = ?
            AND id = ?`,
        [
          postedScheduleStats.lastPeriodKey || run.periodKey,
          remainingUsefulLifeMonths,
          userId,
          tenantId,
          assetId,
        ]
      );
    }

    const normalizedFullyDepreciatedAssetIds = getDistinctIds(fullyDepreciatedAssetIds);
    if (normalizedFullyDepreciatedAssetIds.length > 0) {
      const placeholders = normalizedFullyDepreciatedAssetIds.map(() => "?").join(", ");
      await tx.query(
        `UPDATE fixed_assets
            SET status = 'FULLY_DEPRECIATED',
                updated_by_user_id = ?
          WHERE tenant_id = ?
            AND id IN (${placeholders})
            AND status <> 'DISPOSED'`,
        [userId, tenantId, ...normalizedFullyDepreciatedAssetIds]
      );
    }

    await tx.query(
      `UPDATE fixed_asset_depreciation_runs
          SET status = 'POSTED',
              posting_date = ?,
              posted_asset_count = ?,
              total_posted_amount_txn = ?,
              total_posted_amount_base = ?,
              posted_journal_entry_id = ?,
              posted_by_user_id = ?,
              posted_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND id = ?`,
      [
        scope.postingDate,
        readyAssetIds.length,
        totalPostedAmountTxn,
        totalPostedAmountBase,
        journalResult.journalEntryId,
        userId,
        tenantId,
        run.id,
      ]
    );

    return getDepreciationRunDetail({
      tenantId,
      runId: run.id,
      queryFn: tx.query,
    });
  });
}

export async function reverseDepreciationRun({
  tenantId,
  runId,
  userId = null,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  return withTransaction(async (tx) => {
    const run = await loadPersistedDepreciationRunHeader({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    if (!run) {
      throw badRequest(`Depreciation run (id=${runId}) not found for tenant`);
    }
    if (run.status !== "POSTED") {
      throw badRequest(
        `Only POSTED depreciation runs can be reversed (runId=${runId}, status=${run.status})`
      );
    }
    if (!run.postedJournalEntryId) {
      throw badRequest(
        `Depreciation run (id=${runId}) is missing posted journal lineage and cannot be reversed`
      );
    }

    const lines = await loadPersistedDepreciationRunLines({
      tenantId,
      runId,
      forUpdate: true,
      queryFn: tx.query,
    });
    const postedLines = lines.filter((line) => (
      line.status === "POSTED"
      && Number.isInteger(line.postedTransactionId)
      && line.postedTransactionId > 0
    ));
    if (postedLines.length === 0) {
      throw badRequest(
        `Depreciation run (id=${runId}) has no posted run lines to reverse`
      );
    }

    const scheduleLineIds = getDistinctIds(postedLines.map((line) => line.scheduleLineId));
    if (scheduleLineIds.length !== postedLines.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) is missing linked posted schedule rows and cannot be reversed safely`
      );
    }
    const scheduleLines = await loadPersistedDepreciationScheduleLines({
      tenantId,
      scheduleLineIds,
      queryFn: tx.query,
    });
    if (scheduleLines.length !== scheduleLineIds.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) has incomplete posted schedule lineage and cannot be reversed safely`
      );
    }
    const scheduleLinesById = new Map(scheduleLines.map((line) => [line.id, line]));

    for (const postedLine of postedLines) {
      const scheduleLine = scheduleLinesById.get(postedLine.scheduleLineId);
      if (!scheduleLine) {
        throw badRequest(
          `Missing schedule lineage for posted run line ${postedLine.id}`
        );
      }
      if (scheduleLine.status !== "POSTED") {
        throw badRequest(
          `Schedule line ${scheduleLine.id} must be POSTED before reversal (status=${scheduleLine.status})`
        );
      }
      if (Number(scheduleLine.postedRunLineId || 0) !== Number(postedLine.id)) {
        throw badRequest(
          `Schedule line ${scheduleLine.id} is not currently linked to posted run line ${postedLine.id}`
        );
      }
      if (Number(scheduleLine.postedTransactionId || 0) !== Number(postedLine.postedTransactionId || 0)) {
        throw badRequest(
          `Schedule line ${scheduleLine.id} is not currently linked to the persisted posted depreciation transaction`
        );
      }
    }

    const postedTransactionIds = getDistinctIds(
      postedLines.map((line) => line.postedTransactionId)
    );
    const postedTransactions = await loadFixedAssetTransactionsByIds({
      tenantId,
      transactionIds: postedTransactionIds,
      forUpdate: true,
      queryFn: tx.query,
    });
    if (postedTransactions.length !== postedTransactionIds.length) {
      throw badRequest(
        `Depreciation run (id=${runId}) has incomplete posted transaction lineage and cannot be reversed safely`
      );
    }

    for (const transaction of postedTransactions) {
      if (transaction.status !== "POSTED") {
        throw badRequest(
          `Posted depreciation transaction ${transaction.id} must still be POSTED before reversal (status=${transaction.status})`
        );
      }
      if (
        transaction.transactionType !== "DEPRECIATION"
        || (transaction.depreciationKind !== "RUN" && transaction.depreciationKind !== "CATCH_UP")
      ) {
        throw badRequest(
          `Run reversal requires RUN or CATCH_UP depreciation transaction lineage; transaction ${transaction.id} is incompatible`
        );
      }
    }

    const affectedAssetIds = getDistinctIds(postedTransactions.map((item) => item.assetId));
    const candidateTransactions = await loadPostedFixedAssetTransactionsForAssets({
      tenantId,
      assetIds: affectedAssetIds,
      queryFn: tx.query,
    });
    const blockers = findRunReversalBlockers({
      targetTransactions: postedTransactions,
      candidateTransactions,
    });
    if (blockers.length > 0) {
      const blocker = blockers[0];
      if (blocker.blockerType === "LATER_LIFECYCLE_EVENT") {
        throw badRequest(
          `Depreciation run (id=${runId}) cannot be reversed because asset ${blocker.assetId} ` +
          `has a later ${blocker.blockingTransactionType} event on ${blocker.blockingEffectiveDate}`
        );
      }
      throw badRequest(
        `Depreciation run (id=${runId}) cannot be reversed because asset ${blocker.assetId} ` +
        `has a later posted depreciation result on ${blocker.blockingEffectiveDate}`
      );
    }

    const reversalJournalResult = await reverseJournalEntryTx(tx, {
      tenantId,
      journalId: run.postedJournalEntryId,
      userId,
      reason: `Fixed-asset depreciation run reversal ${run.id}`.slice(0, 255),
      journalNo: buildFixedAssetRunReversalJournalNo(run.id),
      autoPost: true,
    });

    await upsertJournalSourceLinkTx(tx, {
      tenantId,
      legalEntityId: run.legalEntityId,
      journalEntryId: reversalJournalResult.reversalJournalId,
      sourceRefType: FIXED_ASSET_DEPRECIATION_RUN,
      sourceRefId: run.id,
      linkRole: "PRIMARY",
    });

    if (postedTransactionIds.length > 0) {
      const txPlaceholders = postedTransactionIds.map(() => "?").join(", ");
      await tx.query(
        `UPDATE fixed_asset_transactions
            SET status = 'REVERSED'
          WHERE tenant_id = ?
            AND id IN (${txPlaceholders})
            AND status = 'POSTED'`,
        [tenantId, ...postedTransactionIds]
      );
    }

    const postedRunLineIds = getDistinctIds(postedLines.map((line) => line.id));
    if (postedRunLineIds.length > 0) {
      const linePlaceholders = postedRunLineIds.map(() => "?").join(", ");
      await tx.query(
        `UPDATE fixed_asset_depreciation_run_lines
            SET status = 'REVERSED'
          WHERE tenant_id = ?
            AND id IN (${linePlaceholders})
            AND status = 'POSTED'`,
        [tenantId, ...postedRunLineIds]
      );
    }

    if (scheduleLineIds.length > 0) {
      const schedulePlaceholders = scheduleLineIds.map(() => "?").join(", ");
      await tx.query(
        `UPDATE fixed_asset_depreciation_schedule_lines
            SET status = 'REVERSED',
                posted_run_line_id = NULL,
                posted_transaction_id = NULL
          WHERE tenant_id = ?
            AND id IN (${schedulePlaceholders})
            AND status = 'POSTED'`,
        [tenantId, ...scheduleLineIds]
      );
    }

    const affectedAssetSnapshots = await loadAssetDepreciationPostingSnapshots({
      tenantId,
      assetIds: affectedAssetIds,
      queryFn: tx.query,
    });
    const affectedAssetSnapshotsById = new Map(
      affectedAssetSnapshots.map((asset) => [asset.id, asset])
    );
    const remainingPostedScheduleStatsByAsset = await loadCurrentPostedDepreciationScheduleStatsByAsset({
      tenantId,
      assetIds: affectedAssetIds,
      queryFn: tx.query,
      forUpdate: true,
    });

    for (const assetId of affectedAssetIds) {
      const assetSnapshot = affectedAssetSnapshotsById.get(assetId);
      if (!assetSnapshot) {
        throw badRequest(`Missing asset posting snapshot for assetId=${assetId}`);
      }
      const postedScheduleStats = remainingPostedScheduleStatsByAsset.get(assetId) || {
        postedCount: 0,
        lastPeriodKey: null,
      };
      const remainingUsefulLifeMonths = resolveCurrentRemainingUsefulLifeMonths(
        assetSnapshot,
        postedScheduleStats.postedCount
      );
      // Keep the historical REVERSED rows and restore only the current linkage/state.
      // Reversal is successor-blocked, so a FULLY_DEPRECIATED asset here can safely
      // return to ACTIVE when its latest posted run is removed.
      await tx.query(
        `UPDATE fixed_assets
            SET last_depreciation_period = ?,
                remaining_useful_life_months = ?,
                status = CASE
                  WHEN status = 'FULLY_DEPRECIATED' THEN 'ACTIVE'
                  ELSE status
                END,
                updated_by_user_id = ?
          WHERE tenant_id = ?
            AND id = ?`,
        [
          postedScheduleStats.lastPeriodKey || null,
          remainingUsefulLifeMonths,
          userId,
          tenantId,
          assetId,
        ]
      );
    }

    await tx.query(
      `UPDATE fixed_asset_depreciation_runs
          SET status = 'REVERSED',
              reversal_journal_entry_id = ?,
              reversed_by_user_id = ?,
              reversed_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND id = ?
          AND status = 'POSTED'`,
      [
        reversalJournalResult.reversalJournalId,
        userId,
        tenantId,
        run.id,
      ]
    );

    return getDepreciationRunDetail({
      tenantId,
      runId: run.id,
      queryFn: tx.query,
    });
  });
}

export async function getAssetDepreciationSchedule({ tenantId, assetId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const asset = await loadAssetDepreciationSnapshot({ tenantId, assetId });
  const book = await resolveBookForLegalEntity(tenantId, asset.legalEntityId);
  const scheduleContext = await buildAssetDepreciationScheduleContext({
    tenantId,
    asset,
    book,
  });
  const currentPostedScheduleLines = scheduleContext.currentPostedScheduleLines || [];
  const currentPostedScheduleCount = scheduleContext.currentPostedScheduleCount
    ?? currentPostedScheduleLines.length;
  const improvementHistory = scheduleContext.improvementHistory || [];
  const postedCatchUpTransactions = await loadPostedCatchUpDepreciationTransactionsForAsset({
    tenantId,
    assetId: asset.id,
  });
  const correctedHistoricalPeriodKeys = resolveRetroImprovementCorrectedPeriodKeys({
    improvementHistory,
    catchUpTransactions: postedCatchUpTransactions,
  });
  let correctedHistoricalRowsByPeriodKey = new Map();
  const lastCorrectedHistoricalPeriodKey = Array.from(correctedHistoricalPeriodKeys)
    .sort(comparePeriodKeys)
    .at(-1) || null;
  if (lastCorrectedHistoricalPeriodKey) {
    correctedHistoricalRowsByPeriodKey = await buildCorrectedHistoricalRowsByPeriodKey({
      tenantId,
      asset,
      book,
      depreciationMethod: scheduleContext.depreciationMethod,
      lifecycleHistory: scheduleContext.lifecycleHistory,
      improvementHistory,
      throughPeriodKey: lastCorrectedHistoricalPeriodKey,
    });
  }
  const currentSkippedRunLines = await loadCurrentSkippedDepreciationRunLinesForAsset({
    tenantId,
    assetId: asset.id,
  });
  const currentRemainingUsefulLifeMonths = resolveCurrentRemainingUsefulLifeMonths(
    asset,
    currentPostedScheduleCount
  );
  const currentLastDepreciationPeriod = currentPostedScheduleLines.at(-1)?.periodKey
    || asset.lastDepreciationPeriod
    || null;
  const rowsByPeriodKey = new Map(
    (scheduleContext.rows || []).map((row) => [row.periodKey, row])
  );
  for (const postedLine of currentPostedScheduleLines) {
    rowsByPeriodKey.set(postedLine.periodKey, postedLine);
  }
  for (const skippedRunLine of currentSkippedRunLines) {
    if (!rowsByPeriodKey.has(skippedRunLine.periodKey)) {
      rowsByPeriodKey.set(skippedRunLine.periodKey, {
        periodKey: skippedRunLine.periodKey,
        fiscalPeriodId: skippedRunLine.fiscalPeriodId,
        lineNo: 0,
      });
    }
  }
  const skippedRunLinesByPeriodKey = new Map(
    currentSkippedRunLines.map((line) => [line.periodKey, line])
  );
  const sortedRows = Array.from(rowsByPeriodKey.values()).sort((left, right) => (
    String(left?.periodKey || "").localeCompare(String(right?.periodKey || ""))
    || Number(left?.lineNo || 0) - Number(right?.lineNo || 0)
  ));
  const rows = [];
  for (let index = 0; index < sortedRows.length; index += 1) {
    const row = sortedRows[index];
    const correctedHistoricalRow = correctedHistoricalRowsByPeriodKey.get(row.periodKey) || null;
    const rowForDisplay = correctedHistoricalPeriodKeys.has(row.periodKey) && correctedHistoricalRow
      ? {
          ...row,
          openingNbvTxn: correctedHistoricalRow.openingNbvTxn,
          openingNbvBase: correctedHistoricalRow.openingNbvBase,
          closingNbvTxn: correctedHistoricalRow.closingNbvTxn,
          closingNbvBase: correctedHistoricalRow.closingNbvBase,
          plannedAmountTxn: correctedHistoricalRow.plannedAmountTxn,
          plannedAmountBase: correctedHistoricalRow.plannedAmountBase,
          correctedByCatchUp: true,
        }
      : row;
    const skippedRunLine = skippedRunLinesByPeriodKey.get(row.periodKey);
    const displayGrossAmounts = resolveDepreciationGrossAmountsForPeriod({
      asset,
      improvementHistory,
      periodKey: row.periodKey,
    });
    if (!skippedRunLine) {
      rows.push(mapScheduleRowForDisplay(asset, rowForDisplay, displayGrossAmounts));
      continue;
    }
    const previousRow = rows.at(-1) || null;
    const skippedDisplayRow = mapSkippedScheduleRowForDisplay(
      asset,
      skippedRunLine,
      rowForDisplay,
      previousRow,
      displayGrossAmounts
    );
    rows.push({
      ...skippedDisplayRow,
      lineNo: Number(skippedDisplayRow.lineNo || index + 1),
    });
  }

  if (scheduleContext.isExcludedLowValue) {
    return {
      tenantId,
      assetId: asset.id,
      legalEntityId: asset.legalEntityId,
      bookId: Number(book.id),
      calendarId: Number(book.calendar_id),
      assetStatus: asset.status,
      depreciationMethod: scheduleContext.depreciationMethod,
      currencyCode: asset.currencyCode,
      periodConvention: "DAILY_PRORATA",
      inServiceDate: asset.inServiceDate,
      originalCostTxn: asset.originalCostTxn,
      originalCostBase: asset.originalCostBase,
      salvageValueTxn: asset.salvageValueTxn,
      salvageValueBase: asset.salvageValueBase,
      remainingUsefulLifeMonths: currentRemainingUsefulLifeMonths,
      lastDepreciationPeriod: currentLastDepreciationPeriod,
      scheduleHorizon: scheduleContext.scheduleHorizon,
      rows,
      total: rows.length,
    };
  }

  return {
    tenantId,
    assetId: asset.id,
    legalEntityId: asset.legalEntityId,
    bookId: Number(book.id),
    calendarId: Number(book.calendar_id),
    assetStatus: asset.status,
    depreciationMethod: scheduleContext.depreciationMethod,
    currencyCode: asset.currencyCode,
    periodConvention: "DAILY_PRORATA",
    inServiceDate: asset.inServiceDate,
    originalCostTxn: asset.originalCostTxn,
    originalCostBase: asset.originalCostBase,
    salvageValueTxn: asset.salvageValueTxn,
    salvageValueBase: asset.salvageValueBase,
    remainingUsefulLifeMonths: currentRemainingUsefulLifeMonths,
    lastDepreciationPeriod: currentLastDepreciationPeriod,
    scheduleHorizon: scheduleContext.scheduleHorizon,
    rows,
    total: rows.length,
  };
}

export async function previewDepreciationRun(input) {
  const snapshot = await buildDepreciationRunSnapshot({
    ...input,
    actionLabel: "preview depreciation run",
  });

  return mapRunSnapshotToPreviewResponse(snapshot);
}

export async function createDepreciationRunDraft(input) {
  return withTransaction(async (tx) => {
    const snapshot = await buildDepreciationRunSnapshot({
      ...input,
      actionLabel: "create depreciation draft run",
      queryFn: tx.query,
    });

    if (!snapshot.rows.length) {
      throw badRequest(
        `No depreciation run rows are available for legalEntityId=${snapshot.legalEntityId}, ` +
        `fiscalPeriodId=${snapshot.fiscalPeriodId}`
      );
    }
    if (Number(snapshot.summary?.errorCount || 0) > 0) {
      const firstErrorRow = (snapshot.rows || []).find((row) => row.status === "ERROR");
      throw badRequest(
        firstErrorRow?.errorMessage
        || `Depreciation draft cannot be created because period ${snapshot.periodKey} contains blocking depreciation errors`
      );
    }

    await assertNoExistingOpenOrSkippedRunForScope({
      tenantId: snapshot.tenantId,
      legalEntityId: snapshot.legalEntityId,
      bookId: snapshot.bookId,
      fiscalPeriodId: snapshot.fiscalPeriodId,
      queryFn: tx.query,
    });

    let runId;
    try {
      runId = await insertDepreciationRunHeaderTx({
        tx,
        snapshot,
        userId: input.userId,
      });
    } catch (error) {
      if (isDuplicateDraftRunError(error)) {
        throw badRequest(buildDuplicateDraftRunMessage(snapshot));
      }
      throw error;
    }

    const allocationRowCount = await insertDepreciationRunRowsTx({
      tx,
      snapshot,
      runId,
    });
    const persistedRunStatus = resolvePersistedRunStatusFromSnapshot(snapshot);

    return {
      id: runId,
      tenantId: snapshot.tenantId,
      legalEntityId: snapshot.legalEntityId,
      bookId: snapshot.bookId,
      fiscalPeriodId: snapshot.fiscalPeriodId,
      periodKey: snapshot.periodKey,
      postingDate: snapshot.postingDate,
      periodConvention: snapshot.periodConvention,
      status: persistedRunStatus,
      assetCount: snapshot.summary.assetCount,
      postedAssetCount: 0,
      skippedAssetCount: snapshot.summary.skippedAssetCount,
      errorCount: snapshot.summary.errorCount,
      totalPlannedAmountTxn: snapshot.summary.totalPlannedAmountTxn,
      totalPlannedAmountBase: snapshot.summary.totalPlannedAmountBase,
      excludedLowValueAssetCount: snapshot.excludedLowValueAssetCount,
      lineCount: snapshot.rows.length,
      allocationRowCount,
    };
  }).catch((error) => {
    if (isDuplicateDraftRunError(error)) {
      throw badRequest(buildDuplicateDraftRunMessage(input));
    }
    throw error;
  });
}
