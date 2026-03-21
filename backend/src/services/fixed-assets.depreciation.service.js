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
import { FIXED_ASSET_DEPRECIATION_RUN } from "../utils/source-ref-types.js";
import {
  loadAssetDepreciationSnapshot,
  loadAssetDepreciationLifecycleHistory,
  listDepreciationRunAssetSnapshots,
  resolveSupportedFixedAssetFiscalPeriod,
  resolveBookForLegalEntity,
  ensurePeriodOpenForFixedAssets,
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
  return depreciationMethod === "NONE"
    ? (asset.remainingUsefulLifeMonths != null ? Number(asset.remainingUsefulLifeMonths) : null)
    : normalizeNonNegativeInteger(asset.remainingUsefulLifeMonths, "remainingUsefulLifeMonths");
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

function buildDepreciationScheduleRows(asset, periods, lifecycleHistory) {
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

  const lifecycleTimeline = buildLifecycleTimeline(asset, lifecycleHistory, periods);
  const lifecycleState = {
    ...lifecycleTimeline.initialState,
  };

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

    const daysInPeriod = countDaysInclusive(periodStart, periodEnd);
    const periodEligibility = buildPeriodEligibility(
      periodStart,
      periodEnd,
      inServiceDate,
      lifecycleTimeline,
      lifecycleState
    );
    const eligibleDays = periodEligibility.eligibleDays;
    const remainingPeriods = periods.length - index;
    const isFinalScheduleLine = index === periods.length - 1;

    const remainingDepreciableTxn = getRemainingDepreciableAmount(openingNbvTxn, salvageValueTxn);
    const remainingDepreciableBase = getRemainingDepreciableAmount(openingNbvBase, salvageValueBase);

    let effectiveMethod = depreciationMethod;
    if (
      depreciationMethod === "DECLINING_BALANCE"
      && (
        hasSwitchedToStraightLine
        || shouldSwitchDecliningBalanceToStraightLine({
          switchToStraightLine: asset.switchToStraightLine,
          remainingPeriods,
          monthlyRate: monthlyDecliningBalanceRate,
        })
      )
    ) {
      hasSwitchedToStraightLine = true;
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

    let plannedAmountTxn = roundAmount(fullMonthAmountTxn * (eligibleDays / daysInPeriod));
    let plannedAmountBase = roundAmount(fullMonthAmountBase * (eligibleDays / daysInPeriod));

    plannedAmountTxn = Math.min(plannedAmountTxn, remainingDepreciableTxn);
    plannedAmountBase = Math.min(plannedAmountBase, remainingDepreciableBase);

    hasLifecycleEligibilityCutoff = hasLifecycleEligibilityCutoff
      || periodEligibility.lifecycleExcludedDays > 0;

    if (
      isFinalScheduleLine
      && effectiveMethod === "STRAIGHT_LINE"
      && !hasLifecycleEligibilityCutoff
    ) {
      plannedAmountTxn = remainingDepreciableTxn;
      plannedAmountBase = remainingDepreciableBase;
    }

    const txnScheduleAmounts = clampPlannedAmount({
      openingNbv: openingNbvTxn,
      salvageValue: salvageValueTxn,
      plannedAmount: plannedAmountTxn,
      absorbRoundingResidual: isFinalScheduleLine && effectiveMethod !== "STRAIGHT_LINE",
    });
    const baseScheduleAmounts = clampPlannedAmount({
      openingNbv: openingNbvBase,
      salvageValue: salvageValueBase,
      plannedAmount: plannedAmountBase,
      absorbRoundingResidual: isFinalScheduleLine && effectiveMethod !== "STRAIGHT_LINE",
    });

    plannedAmountTxn = txnScheduleAmounts.plannedAmount;
    plannedAmountBase = baseScheduleAmounts.plannedAmount;
    const closingNbvTxn = txnScheduleAmounts.closingNbv;
    const closingNbvBase = baseScheduleAmounts.closingNbv;

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
      allocationSegments: periodEligibility.allocationSegments,
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

    if (lifecycleState.isDisposed) {
      break;
    }
  }

  return rows;
}

function hasPositivePlannedAmount(row) {
  return Number(row?.plannedAmountTxn || 0) > 0 || Number(row?.plannedAmountBase || 0) > 0;
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

  return segments.map((segment, index) => {
    const isLastSegment = index === segments.length - 1;
    const segmentEligibleDays = Number(segment.eligibleDays || 0);

    let plannedAmountTxn = isLastSegment
      ? roundAmount(Number(runRow.plannedAmountTxn || 0) - allocatedTxn)
      : roundAmount(Number(runRow.plannedAmountTxn || 0) * (segmentEligibleDays / totalEligibleDays));
    let plannedAmountBase = isLastSegment
      ? roundAmount(Number(runRow.plannedAmountBase || 0) - allocatedBase)
      : roundAmount(Number(runRow.plannedAmountBase || 0) * (segmentEligibleDays / totalEligibleDays));

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

function buildReadyRunRow({ asset, period, scheduleRow }) {
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
    eligibleDays: Number(scheduleRow.eligibleDays || 0),
    daysInPeriod: Number(scheduleRow.daysInPeriod || 0),
    plannedAmountTxn: roundAmount(scheduleRow.plannedAmountTxn || 0),
    plannedAmountBase: roundAmount(scheduleRow.plannedAmountBase || 0),
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
    status: "SKIPPED",
    skipReasonCode: reasonCode,
    skipReasonText: reasonText,
    errorCode: null,
    errorMessage: null,
    allocationSegments: frozenAllocationSegments,
  };
}

function buildErrorRunRow({ asset, period, error }) {
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
    status: "ERROR",
    skipReasonCode: null,
    skipReasonText: null,
    errorCode: "SCHEDULE_GENERATION_FAILED",
    errorMessage: String(error?.message || "Failed to generate depreciation schedule snapshot"),
    allocationSegments: [],
  };
}

function summarizeRunRows(rows) {
  let totalPlannedAmountTxn = 0;
  let totalPlannedAmountBase = 0;
  let readyAssetCount = 0;
  let skippedAssetCount = 0;
  let errorCount = 0;

  for (const row of rows || []) {
    if (row.status === "READY") {
      readyAssetCount += 1;
      totalPlannedAmountTxn = roundAmount(totalPlannedAmountTxn + Number(row.plannedAmountTxn || 0));
      totalPlannedAmountBase = roundAmount(totalPlannedAmountBase + Number(row.plannedAmountBase || 0));
    } else if (row.status === "SKIPPED") {
      skippedAssetCount += 1;
    } else if (row.status === "ERROR") {
      errorCount += 1;
    }
  }

  return {
    assetCount: rows.length,
    readyAssetCount,
    skippedAssetCount,
    errorCount,
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
  const remainingUsefulLifeMonths = resolveAssetRemainingUsefulLifeMonths(asset, depreciationMethod);
  const lifecycleHistory = await loadAssetDepreciationLifecycleHistory({
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
      periods: [],
      scheduleHorizon: null,
      rows: [],
      isExcludedLowValue: true,
    };
  }

  let periods = [];
  let rows = [];
  let scheduleHorizon = null;
  if (
    (depreciationMethod === "STRAIGHT_LINE" || depreciationMethod === "DECLINING_BALANCE")
    && remainingUsefulLifeMonths > 0
  ) {
    const periodResolution = await loadSchedulePeriodsForRange({
      calendarId: book.calendar_id,
      startDate: asset.inServiceDate,
      monthCount: remainingUsefulLifeMonths,
      queryFn,
    });
    periods = periodResolution.periods;
    scheduleHorizon = periodResolution.horizon;
    rows = buildDepreciationScheduleRows(asset, periods, lifecycleHistory);
  }

  return {
    asset,
    depreciationMethod,
    remainingUsefulLifeMonths,
    lifecycleHistory,
    periods,
    scheduleHorizon,
    rows,
    isExcludedLowValue: false,
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
    postingDate || run.postingDate || null,
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
  queryFn = query,
}) {
  if (isLowValueFullyExpensedAsset(asset)) {
    return null;
  }

  try {
    const scheduleContext = await buildAssetDepreciationScheduleContext({
      tenantId,
      asset,
      book,
      queryFn,
    });

    if (scheduleContext.isExcludedLowValue) {
      return null;
    }

    const lifecycleEvaluation = evaluateLifecycleForPeriod(
      asset,
      scheduleContext.lifecycleHistory,
      period
    );
    const scheduleRow = scheduleContext.rows.find((row) => row.periodKey === period.periodKey) || null;

    if (scheduleRow && hasPositivePlannedAmount(scheduleRow)) {
      return buildReadyRunRow({
        asset,
        period,
        scheduleRow,
      });
    }

    return classifySkippedRunRow({
      asset,
      period,
      depreciationMethod: scheduleContext.depreciationMethod,
      remainingUsefulLifeMonths: scheduleContext.remainingUsefulLifeMonths,
      scheduleRow,
      scheduleRows: scheduleContext.rows,
      scheduleHorizon: scheduleContext.scheduleHorizon,
      lifecycleEvaluation,
    });
  } catch (error) {
    return buildErrorRunRow({ asset, period, error });
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

  const rows = [];
  let excludedLowValueAssetCount = 0;

  for (const asset of candidateAssets) {
    if (isLowValueFullyExpensedAsset(asset)) {
      excludedLowValueAssetCount += 1;
      continue;
    }

    const row = await buildDepreciationRunRowForAsset({
      tenantId,
      asset,
      book: scope.book,
      period: scope.period,
      queryFn,
    });

    if (row) {
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

function mapPublicRunRow(row) {
  const {
    scheduleSnapshot,
    ...publicRow
  } = row || {};
  return publicRow;
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
    rows: (snapshot.rows || []).map(mapPublicRunRow),
    total: snapshot.total,
  };
}

async function assertNoExistingDraftRunForScope({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  queryFn,
}) {
  const existingResult = await queryFn(
    `SELECT id
       FROM fixed_asset_depreciation_runs
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND book_id = ?
        AND fiscal_period_id = ?
        AND status = 'DRAFT'
      LIMIT 1`,
    [tenantId, legalEntityId, bookId, fiscalPeriodId]
  );
  const existingRunId = Number(existingResult.rows?.[0]?.id || 0);
  if (existingRunId > 0) {
    throw badRequest(
      `A persisted DRAFT depreciation run already exists for legalEntityId=${legalEntityId}, ` +
      `bookId=${bookId}, fiscalPeriodId=${fiscalPeriodId} (runId=${existingRunId})`
    );
  }
}

function isDuplicateDraftRunError(error) {
  return String(error?.code || "").toUpperCase() === "ER_DUP_ENTRY";
}

function buildDuplicateDraftRunMessage({ legalEntityId, bookId, fiscalPeriodId }) {
  return (
    `A persisted DRAFT depreciation run already exists for legalEntityId=${legalEntityId}, ` +
    `bookId=${bookId}, fiscalPeriodId=${fiscalPeriodId}`
  );
}

async function insertDepreciationRunHeaderTx({ tx, snapshot, userId }) {
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
        ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 0, ?, ?, ?, ?, 0, 0, ?
     )`,
    [
      snapshot.tenantId,
      snapshot.legalEntityId,
      snapshot.bookId,
      snapshot.fiscalPeriodId,
      snapshot.postingDate,
      snapshot.periodKey,
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
    lines: attachAllocationSnapshotsToRunLines(lines, allocations),
    total: lines.length,
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

    if (run.status !== "DRAFT") {
      throw badRequest(
        `Only DRAFT depreciation runs can be deleted (runId=${runId}, status=${run.status})`
      );
    }

    const lines = await loadPersistedDepreciationRunLines({
      tenantId,
      runId,
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
      [tenantId, runId]
    );
    const allocationCountResult = await tx.query(
      `SELECT COUNT(*) AS allocation_count
         FROM fixed_asset_depreciation_run_line_allocations alloc
         JOIN fixed_asset_depreciation_run_lines line
           ON line.id = alloc.run_line_id
        WHERE alloc.tenant_id = ?
          AND line.run_id = ?`,
      [tenantId, runId]
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
      [tenantId, runId]
    );
    await tx.query(
      `DELETE FROM fixed_asset_depreciation_run_lines
        WHERE tenant_id = ?
          AND run_id = ?`,
      [tenantId, runId]
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
          AND status = 'DRAFT'`,
      [tenantId, runId]
    );
    const deletedCount = Number(deleteResult.rows?.affectedRows || 0);
    if (deletedCount !== 1) {
      throw badRequest(`Failed to delete DRAFT depreciation run (runId=${runId})`);
    }

    return {
      id: run.id,
      tenantId: run.tenantId,
      legalEntityId: run.legalEntityId,
      bookId: run.bookId,
      fiscalPeriodId: run.fiscalPeriodId,
      periodKey: run.periodKey,
      deleted: true,
      previousStatus: run.status,
      lineCount,
      allocationRowCount,
    };
  });
}

function buildFixedAssetRunJournalNo(runId) {
  return `FA-RUN-${parsePositiveInt(runId)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
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
            currency_code,
            owner_operating_unit_id,
            original_cost_txn,
            original_cost_base,
            salvage_value_txn,
            salvage_value_base,
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
    currencyCode: row.currency_code || null,
    ownerOperatingUnitId: row.owner_operating_unit_id != null
      ? Number(row.owner_operating_unit_id)
      : null,
    originalCostTxn: roundAmount(row.original_cost_txn || 0),
    originalCostBase: roundAmount(row.original_cost_base || 0),
    salvageValueTxn: roundAmount(row.salvage_value_txn || 0),
    salvageValueBase: roundAmount(row.salvage_value_base || 0),
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

async function loadRemainingPostedDepreciationPeriodsByAsset({
  tenantId,
  assetIds,
  excludedScheduleLineIds,
  queryFn = query,
}) {
  const normalizedAssetIds = getDistinctIds(assetIds);
  const normalizedExcludedScheduleLineIds = getDistinctIds(excludedScheduleLineIds);
  if (!tenantId) throw badRequest("tenantId is required");
  if (!normalizedAssetIds.length) {
    return new Map();
  }

  const assetPlaceholders = normalizedAssetIds.map(() => "?").join(", ");
  const params = [tenantId, ...normalizedAssetIds];
  let excludedSql = "";
  if (normalizedExcludedScheduleLineIds.length > 0) {
    excludedSql = ` AND id NOT IN (${normalizedExcludedScheduleLineIds.map(() => "?").join(", ")})`;
    params.push(...normalizedExcludedScheduleLineIds);
  }

  const result = await queryFn(
    `SELECT asset_id,
            MAX(period_key) AS last_period_key
       FROM fixed_asset_depreciation_schedule_lines
      WHERE tenant_id = ?
        AND asset_id IN (${assetPlaceholders})
        AND status = 'POSTED'${excludedSql}
      GROUP BY asset_id
      FOR UPDATE`,
    params
  );

  return new Map(
    (result.rows || []).map((row) => [Number(row.asset_id), row.last_period_key || null])
  );
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
      && candidate.depreciationKind === "RUN"
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
       ?, ?, ?, 'DEPRECIATION', 'POSTED', ?, ?, ?, ?, ?, 'RUN', ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?
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
      payload.journalEntryId,
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
            lineDescription: `FA depreciation ${assetSnapshot.assetNo || readyLine.assetId} ${run.periodKey}`.slice(0, 255),
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
            lineDescription: `FA accumulated depreciation ${assetSnapshot.assetNo || readyLine.assetId} ${run.periodKey}`.slice(0, 255),
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
      const accumDeprAmountTxn = roundAmount(assetSnapshot.originalCostTxn - scheduleLine.closingNbvTxn);
      const accumDeprAmountBase = roundAmount(assetSnapshot.originalCostBase - scheduleLine.closingNbvBase);
      const nbvAmountTxn = roundAmount(scheduleLine.closingNbvTxn);
      const nbvAmountBase = roundAmount(scheduleLine.closingNbvBase);

      const transactionId = await insertPostedDepreciationTransactionTx(tx, {
        tenantId,
        legalEntityId: run.legalEntityId,
        assetId: readyLine.assetId,
        effectiveDate: scope.postingDate,
        postingDate: scope.postingDate,
        bookId: scope.book.id,
        fiscalPeriodId: run.fiscalPeriodId,
        currencyCode: assetSnapshot.currencyCode || scope.book.base_currency_code,
        journalEntryId: journalResult.journalEntryId,
        grossAmountTxn: assetSnapshot.originalCostTxn,
        grossAmountBase: assetSnapshot.originalCostBase,
        accumDeprAmountTxn,
        accumDeprAmountBase,
        nbvAmountTxn,
        nbvAmountBase,
        note: `Depreciation run ${run.id} ${run.periodKey}`.slice(0, 1000),
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

    if (readyAssetIds.length > 0) {
      const readyAssetPlaceholders = readyAssetIds.map(() => "?").join(", ");
      await tx.query(
        `UPDATE fixed_assets
            SET last_depreciation_period = ?,
                updated_by_user_id = ?
          WHERE tenant_id = ?
            AND id IN (${readyAssetPlaceholders})`,
        [run.periodKey, userId, tenantId, ...readyAssetIds]
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
        readyLines.length,
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
      if (transaction.transactionType !== "DEPRECIATION" || transaction.depreciationKind !== "RUN") {
        throw badRequest(
          `Run reversal requires RUN depreciation transaction lineage; transaction ${transaction.id} is incompatible`
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

    const remainingPostedPeriodsByAsset = await loadRemainingPostedDepreciationPeriodsByAsset({
      tenantId,
      assetIds: affectedAssetIds,
      excludedScheduleLineIds: scheduleLineIds,
      queryFn: tx.query,
    });

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

    for (const assetId of affectedAssetIds) {
      // Keep the historical REVERSED rows and restore only the current linkage/state.
      // Reversal is successor-blocked, so a FULLY_DEPRECIATED asset here can safely
      // return to ACTIVE when its latest posted run is removed.
      await tx.query(
        `UPDATE fixed_assets
            SET last_depreciation_period = ?,
                status = CASE
                  WHEN status = 'FULLY_DEPRECIATED' THEN 'ACTIVE'
                  ELSE status
                END,
                updated_by_user_id = ?
          WHERE tenant_id = ?
            AND id = ?`,
        [
          remainingPostedPeriodsByAsset.get(assetId) || null,
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
      remainingUsefulLifeMonths: scheduleContext.remainingUsefulLifeMonths,
      scheduleHorizon: scheduleContext.scheduleHorizon,
      rows: [],
      total: 0,
    };
  }

  const rows = scheduleContext.rows;

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
    remainingUsefulLifeMonths: scheduleContext.remainingUsefulLifeMonths,
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

    await assertNoExistingDraftRunForScope({
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

    return {
      id: runId,
      tenantId: snapshot.tenantId,
      legalEntityId: snapshot.legalEntityId,
      bookId: snapshot.bookId,
      fiscalPeriodId: snapshot.fiscalPeriodId,
      periodKey: snapshot.periodKey,
      postingDate: snapshot.postingDate,
      periodConvention: snapshot.periodConvention,
      status: "DRAFT",
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
