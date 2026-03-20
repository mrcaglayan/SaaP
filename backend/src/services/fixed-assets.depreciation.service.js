/**
 * Fixed-assets depreciation service.
 *
 * Owns schedule generation, run preview, run create/post/reverse,
 * and depreciation calculation logic.
 */
import { query, withTransaction } from "../db.js";
import { badRequest } from "../routes/_utils.js";
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

function normalizeUpperText(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim().toUpperCase();
}

function roundAmount(value) {
  return Math.round(Number(value || 0) * AMOUNT_SCALE) / AMOUNT_SCALE;
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
    return [];
  }

  const rangeStart = startOfMonth(parseDateOnly(startDate, "inServiceDate"));
  const rangeEnd = endOfMonth(addMonths(rangeStart, monthCount - 1));
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
      throw badRequest(
        `No fiscal period found for supported fixed-assets month ${expectedPeriodKey}`
      );
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

  return resolvedPeriods;
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
      rows: [],
      isExcludedLowValue: true,
    };
  }

  let periods = [];
  let rows = [];
  if (
    (depreciationMethod === "STRAIGHT_LINE" || depreciationMethod === "DECLINING_BALANCE")
    && remainingUsefulLifeMonths > 0
  ) {
    periods = await loadSchedulePeriodsForRange({
      calendarId: book.calendar_id,
      startDate: asset.inServiceDate,
      monthCount: remainingUsefulLifeMonths,
      queryFn,
    });
    rows = buildDepreciationScheduleRows(asset, periods, lifecycleHistory);
  }

  return {
    asset,
    depreciationMethod,
    remainingUsefulLifeMonths,
    lifecycleHistory,
    periods,
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
  const resolvedPostingDate = resolveRunPostingDate(postingDate, period);
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
    rows: snapshot.rows,
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
       ?, ?, ?, ?, ?, 'DRAFT', ?, 0, ?, ?, ?, ?, 0, 0, ?
     )`,
    [
      snapshot.tenantId,
      snapshot.legalEntityId,
      snapshot.bookId,
      snapshot.fiscalPeriodId,
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

async function insertDepreciationRunRowsTx({ tx, snapshot, runId }) {
  let allocationRowCount = 0;

  for (const row of snapshot.rows) {
    const lineInsertResult = await tx.query(
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
         ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?
       )`,
      [
        snapshot.tenantId,
        snapshot.legalEntityId,
        runId,
        row.assetId,
        row.fiscalPeriodId,
        row.periodKey,
        row.eligibleDays,
        row.daysInPeriod,
        row.plannedAmountTxn,
        row.plannedAmountBase,
        row.status,
        row.skipReasonCode,
        row.skipReasonText,
        row.errorCode,
        row.errorMessage,
      ]
    );
    const runLineId = Number(lineInsertResult.rows?.insertId || 0);
    if (!runLineId) {
      throw badRequest(`Failed to persist depreciation run line for assetId=${row.assetId}`);
    }

    for (const allocation of row.allocationSegments || []) {
      await tx.query(
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
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`,
        [
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
        ]
      );
      allocationRowCount += 1;
    }
  }

  return allocationRowCount;
}

function mapPersistedDepreciationRunHeaderRow(row) {
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
  queryFn = query,
}) {
  const result = await queryFn(
    `SELECT run.*,
            period.fiscal_year,
            period.period_no,
            period.period_name,
            period.start_date,
            period.end_date
       FROM fixed_asset_depreciation_runs run
       JOIN fiscal_periods period
         ON period.id = run.fiscal_period_id
      WHERE run.tenant_id = ?
        AND run.id = ?
      LIMIT 1`,
    [tenantId, runId]
  );

  const row = result.rows?.[0];
  return row ? mapPersistedDepreciationRunHeaderRow(row) : null;
}

async function loadPersistedDepreciationRunLines({
  tenantId,
  runId,
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
      ORDER BY id ASC`,
    [tenantId, runId]
  );

  return (result.rows || []).map((row, index) => (
    mapPersistedDepreciationRunLineRow(row, index + 1)
  ));
}

async function loadPersistedDepreciationRunAllocations({
  tenantId,
  runId,
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
      ORDER BY alloc.run_line_id ASC, alloc.from_date ASC, alloc.id ASC`,
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
            period.end_date
       FROM fixed_asset_depreciation_runs run
       JOIN fiscal_periods period
         ON period.id = run.fiscal_period_id
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

export async function getDepreciationRunDetail({ tenantId, runId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!runId) throw badRequest("runId is required");

  const run = await loadPersistedDepreciationRunHeader({ tenantId, runId });
  if (!run) {
    throw badRequest(`Depreciation run (id=${runId}) not found for tenant`);
  }

  const lines = await loadPersistedDepreciationRunLines({ tenantId, runId });
  const allocations = await loadPersistedDepreciationRunAllocations({ tenantId, runId });

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
