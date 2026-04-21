import { withTransaction, query } from "../db.js";
import { getVisibilityScopeContext, hasScopeAccessForContext } from "./authz.scope.service.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertConsolidationGroupBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertLegalEntityBelongsToTenant,
  assertUserBelongsToTenant,
} from "../tenantGuards.js";
import { ensureLocalClosePack } from "./local.close-packs.service.js";
import {
  ensureCycleItem,
  findCurrentCycleItemBySourceInCycle,
  linkCycleItemToSource,
  listCycleItems,
  setItemBusinessStatus,
  syncCycleItemsBySource,
} from "./close.cycle-items.service.js";
import {
  buildCloseCycleItemKey,
  buildCloseCycleItemScopeId,
  buildCloseCycleScopeKey,
  CLOSE_CYCLE_SCOPE_KINDS,
  CLOSE_CYCLE_STATUS_VALUES,
  CLOSE_CYCLE_TYPES,
  OFFICIAL_CONSOLIDATION_RUN_NAME,
  resolveCloseCycleRowScope,
} from "./close.cycles.shared.js";
import {
  registerCycleDependencies as registerProvisionedCycleDependencies,
  syncCycleDependencies as syncProvisionedCycleDependencies,
} from "./close.dependencies.service.js";
import {
  listCycleActionDependencyBlockers,
  listCycleDependencyBlockers,
} from "./close.blockers.service.js";
import { composeCloseBlockers } from "./close.blocker-composer.service.js";
import { buildCloseCycleSlaSnapshot } from "./close.sla.service.js";
import { buildCloseCycleAlertSnapshot } from "./close.alerts.service.js";
import { listLatestCloseStaleEvents } from "./close.stale.service.js";
import { buildCloseCycleJournalGovernanceSnapshot } from "./close.journals.service.js";
import {
  buildCloseCycleSupportScheduleSnapshot,
  syncCloseSupportSchedulesForCycle,
} from "./close.support-schedules.service.js";
import {
  buildCloseCycleReconciliationSnapshot,
  syncCloseReconciliationControlsForCycle,
} from "./close.reconciliations.service.js";
import {
  buildCloseCycleKpiSnapshot,
  syncCloseCycleKpiSnapshots,
} from "./close.kpis.service.js";
import { getLocalClosePackReviewGate } from "./local.close-pack.workflow.service.js";
import { getConsolidationRunReviewGate } from "./consolidation.review-gate.service.js";
import { getPeriodCloseRunReviewGate } from "./gl.period-closing.review-gate.service.js";
import { deriveConsolidationScenarioCode } from "./consolidation.scenarios.shared.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message, details = null, code = "CLOSE_CYCLE_CONFLICT") {
  const err = new Error(message);
  err.status = 409;
  err.code = code;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  return err;
}

function isDuplicateKeyError(err) {
  return Number(err?.errno) === 1062 || toUpperText(err?.code) === "ER_DUP_ENTRY";
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorUserId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.userId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function normalizeOptionalDateTime(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid datetime`);
  }

  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

const CLOSE_PROVISION_RETRYABLE_ERRNOS = new Set([
  1205, // ER_LOCK_WAIT_TIMEOUT
  1213, // ER_LOCK_DEADLOCK
]);

const CLOSE_PROVISION_RETRYABLE_ERROR_CODES = new Set([
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_LOCK_DEADLOCK",
]);

const CLOSE_PROVISION_MAX_ATTEMPTS = 3;

function isRetriableCloseProvisionError(err) {
  return (
    CLOSE_PROVISION_RETRYABLE_ERRNOS.has(Number(err?.errno)) ||
    CLOSE_PROVISION_RETRYABLE_ERROR_CODES.has(toUpperText(err?.code))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCloseProvisionRetry(work) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await work();
    } catch (err) {
      if (
        !isRetriableCloseProvisionError(err) ||
        attempt >= CLOSE_PROVISION_MAX_ATTEMPTS
      ) {
        throw err;
      }

      // Provisioning is identity-based and idempotent, so transient lock
      // collisions should self-heal instead of surfacing a raw 500.
      const backoffMs = 40 * attempt + Math.floor(Math.random() * 35);
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoffMs);
    }
  }
}

function normalizeCycleType(cycleType) {
  const normalized = toUpperText(cycleType);
  if (!CLOSE_CYCLE_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close cycle type: ${cycleType}`);
  }
  return normalized;
}

function normalizeScopeKind(scopeKind) {
  const normalized = toUpperText(scopeKind);
  if (!CLOSE_CYCLE_SCOPE_KINDS.includes(normalized)) {
    throw badRequest(`Unsupported close cycle scope kind: ${scopeKind}`);
  }
  return normalized;
}

function normalizeCycleStatus(status) {
  const normalized = toUpperText(status);
  if (!CLOSE_CYCLE_STATUS_VALUES.includes(normalized)) {
    throw badRequest(`Unsupported close cycle status: ${status}`);
  }
  return normalized;
}

function mapCloseCycleRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    cycleType: toUpperText(row.cycle_type),
    scopeKind: toUpperText(row.scope_kind),
    fiscalCalendarId: parsePositiveInt(row.fiscal_calendar_id),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    groupCompanyId: parsePositiveInt(row.group_company_id),
    scopeKey: String(row.scope_key || ""),
    status: toUpperText(row.status),
    startsAt: row.starts_at || null,
    dueAt: row.due_at || null,
    ownerUserId: parsePositiveInt(row.owner_user_id),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function loadFiscalPeriodRow(fiscalPeriodId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       calendar_id,
       fiscal_year,
       period_no,
       start_date,
       end_date
     FROM fiscal_periods
     WHERE id = ?
     LIMIT 1`,
    [fiscalPeriodId]
  );
  return result.rows?.[0] || null;
}

async function loadCloseCycleRow({
  cycleId,
  tenantId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
     FROM close_cycles
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, cycleId]
  );
  return result.rows?.[0] || null;
}

function canReadCloseCycleRow(actorCtx = {}, row) {
  const req = actorCtx?.req;
  if (!req) {
    return true;
  }

  const visibilityScopeContext = getVisibilityScopeContext(req) || req?.rbac?.permissionScopeContext;
  const scope = resolveCloseCycleRowScope(row);
  if (!scope) {
    return false;
  }
  return hasScopeAccessForContext(visibilityScopeContext, scope.scopeKind, scope.scopeId);
}

function assertReadableCloseCycleRow(actorCtx = {}, row) {
  if (!row) {
    throw notFound("Close cycle not found");
  }
  if (!canReadCloseCycleRow(actorCtx, row)) {
    const err = new Error("Close cycle is outside your data scope");
    err.status = 403;
    throw err;
  }
}

function buildIdPlaceholders(ids = []) {
  return ids.map(() => "?").join(", ");
}

function buildCodeNameLabel(code, name, fallback = "-") {
  const normalizedCode = String(code || "").trim();
  const normalizedName = String(name || "").trim();
  if (normalizedCode && normalizedName) {
    return `${normalizedCode} - ${normalizedName}`;
  }
  return normalizedCode || normalizedName || fallback;
}

function buildPeriodLabel(periodRow) {
  if (!periodRow) {
    return "-";
  }
  return `FY${periodRow.fiscal_year} P${String(periodRow.period_no || "").padStart(2, "0")} - ${periodRow.period_name || ""}`.trim();
}

function buildLocalCloseWorkspacePath({
  legalEntityId,
  bookId = null,
  fiscalPeriodId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bookId)) {
    searchParams.set("bookId", String(parsePositiveInt(bookId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri${
    queryString ? `?${queryString}` : ""
  }`;
}

function buildLocalClosePackPath(packId) {
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/${packId}`;
}

function buildPeriodClosePath({
  legalEntityId,
  bookId = null,
  fiscalPeriodId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bookId)) {
    searchParams.set("bookId", String(parsePositiveInt(bookId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/kapanis-islemleri${
    queryString ? `?${queryString}` : ""
  }`;
}

function buildConsolidationRunPath({
  consolidationGroupId,
  runId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(consolidationGroupId)) {
    searchParams.set("consolidationGroupId", String(parsePositiveInt(consolidationGroupId)));
  }
  if (parsePositiveInt(runId)) {
    searchParams.set("runId", String(parsePositiveInt(runId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari${
    queryString ? `?${queryString}` : ""
  }`;
}

function buildWorklistDrillPath(item) {
  if (item?.itemType === "LOCAL_CLOSE_PACK") {
    if (parsePositiveInt(item?.currentSourceTargetId)) {
      return buildLocalClosePackPath(item.currentSourceTargetId);
    }
    return buildLocalCloseWorkspacePath({
      legalEntityId: item?.legalEntityId,
      bookId: item?.bookId,
      fiscalPeriodId: item?.closeCycleFiscalPeriodId,
    });
  }
  if (item?.itemType === "PERIOD_CLOSE_RUN") {
    return buildPeriodClosePath({
      legalEntityId: item?.legalEntityId,
      bookId: item?.bookId,
      fiscalPeriodId: item?.closeCycleFiscalPeriodId,
    });
  }
  if (item?.itemType === "CONSOLIDATION_RUN") {
    return buildConsolidationRunPath({
      consolidationGroupId: item?.consolidationGroupId,
      runId: item?.currentSourceTargetId,
    });
  }
  return null;
}

function isReadyBusinessStatus(itemType, businessStatus) {
  const normalizedItemType = toUpperText(itemType);
  const normalizedStatus = toUpperText(businessStatus);
  if (normalizedItemType === "PERIOD_CLOSE_RUN") {
    return normalizedStatus === "COMPLETED";
  }
  if (normalizedItemType === "LOCAL_CLOSE_PACK") {
    return normalizedStatus === "LOCKED";
  }
  if (normalizedItemType === "CONSOLIDATION_RUN") {
    return normalizedStatus === "LOCKED";
  }
  return false;
}

function isAttentionBusinessStatus(businessStatus) {
  return ["FAILED", "RETURNED", "REOPENED"].includes(toUpperText(businessStatus));
}

function toSeverityWeight(severity) {
  const normalized = toUpperText(severity);
  if (normalized === "HIGH") {
    return 3;
  }
  if (normalized === "MEDIUM") {
    return 2;
  }
  if (normalized === "LOW") {
    return 1;
  }
  return 0;
}

function sortBlockerRows(rows = []) {
  return [...rows].sort((left, right) => {
    const severityDelta = toSeverityWeight(right?.severity) - toSeverityWeight(left?.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return String(left?.code || "").localeCompare(String(right?.code || ""));
  });
}

function staleStatusWeight(status) {
  const normalized = toUpperText(status);
  if (normalized === "FINALIZED_BUT_OUTDATED") {
    return 3;
  }
  if (normalized === "STALE_REVIEW_REQUIRED") {
    return 2;
  }
  if (normalized === "STALE") {
    return 1;
  }
  return 0;
}

function buildDefaultSlaState(dueAt = null) {
  return {
    dueState: dueAt ? "ON_TRACK" : "NO_DUE_DATE",
    severity: "LOW",
    dueAt: dueAt || null,
    remainingHours: null,
    overdueHours: null,
    dueSoonLeadHours: 0,
    overdueGraceHours: 0,
    escalateAfterHours: 0,
  };
}

function buildAlertRowsByItemId(rows = []) {
  const rowsByItemId = new Map();
  for (const row of rows) {
    const closeCycleItemId = parsePositiveInt(row?.closeCycleItemId);
    if (!closeCycleItemId) {
      continue;
    }
    const existing = rowsByItemId.get(closeCycleItemId) || [];
    existing.push(row);
    rowsByItemId.set(closeCycleItemId, existing);
  }
  return rowsByItemId;
}

function buildStaleVisibilityMessage(row) {
  const staleStatus = toUpperText(row?.staleStatus);
  const latestStaleEvent = row?.latestStaleEvent || null;
  if (staleStatus === "FINALIZED_BUT_OUTDATED") {
    return "Finalized output is outdated because an upstream official step changed.";
  }
  if (staleStatus === "STALE_REVIEW_REQUIRED") {
    return "Renewed review is required because an upstream official step changed.";
  }
  if (latestStaleEvent?.sourceTargetType) {
    return `Stale after ${latestStaleEvent.sourceTargetType} changed.`;
  }
  return "Stale after an upstream official change.";
}

function buildStaleSummary(worklistRows = []) {
  const staleRows = worklistRows
    .filter((row) => toUpperText(row?.staleStatus) !== "FRESH")
    .map((row) => ({
      closeCycleItemId: parsePositiveInt(row?.id),
      itemType: row?.itemType || null,
      itemKey: row?.itemKey || null,
      scopeLabel: row?.scopeLabel || null,
      legalEntityLabel: row?.legalEntityLabel || null,
      operatingUnitLabel: row?.operatingUnitLabel || null,
      bookLabel: row?.bookLabel || null,
      staleStatus: row?.staleStatus || "FRESH",
      latestEvent: row?.latestStaleEvent || null,
      message: buildStaleVisibilityMessage(row),
      drillPath: row?.drillPath || null,
    }))
    .sort((left, right) => {
      const staleDelta = staleStatusWeight(right?.staleStatus) - staleStatusWeight(left?.staleStatus);
      if (staleDelta !== 0) {
        return staleDelta;
      }
      const latestLeft = left?.latestEvent?.createdAt
        ? new Date(left.latestEvent.createdAt).getTime()
        : 0;
      const latestRight = right?.latestEvent?.createdAt
        ? new Date(right.latestEvent.createdAt).getTime()
        : 0;
      return latestRight - latestLeft;
    });

  return {
    total: staleRows.length,
    counts: {
      stale: staleRows.filter((row) => row.staleStatus === "STALE").length,
      reviewRequired: staleRows.filter((row) => row.staleStatus === "STALE_REVIEW_REQUIRED").length,
      finalizedButOutdated: staleRows.filter((row) => row.staleStatus === "FINALIZED_BUT_OUTDATED").length,
    },
    rows: staleRows,
  };
}

async function loadReferenceRowsByIds({
  ids = [],
  tenantId,
  selectSql,
  runQuery = query,
}) {
  if (!ids.length) {
    return [];
  }
  const result = await runQuery(
    `${selectSql}
     WHERE tenant_id = ?
       AND id IN (${buildIdPlaceholders(ids)})`,
    [tenantId, ...ids]
  );
  return result.rows || [];
}

async function loadCycleCockpitReferenceMaps({
  tenantId,
  cycle,
  items = [],
  runQuery = query,
}) {
  const legalEntityIds = Array.from(
    new Set(
      [cycle?.legalEntityId, ...items.map((item) => item?.legalEntityId)]
        .map((value) => parsePositiveInt(value))
        .filter(Boolean)
    )
  );
  const operatingUnitIds = Array.from(
    new Set(
      items
        .map((item) => parsePositiveInt(item?.operatingUnitId))
        .filter(Boolean)
    )
  );
  const bookIds = Array.from(
    new Set(items.map((item) => parsePositiveInt(item?.bookId)).filter(Boolean))
  );
  const consolidationGroupIds = Array.from(
    new Set(
      [cycle?.consolidationGroupId, ...items.map((item) => item?.consolidationGroupId)]
        .map((value) => parsePositiveInt(value))
        .filter(Boolean)
    )
  );

  const [legalEntityRows, operatingUnitRows, bookRows, consolidationGroupRows, periodResult] =
    await Promise.all([
      loadReferenceRowsByIds({
        ids: legalEntityIds,
        tenantId,
        selectSql: `SELECT id, code, name FROM legal_entities`,
        runQuery,
      }),
      loadReferenceRowsByIds({
        ids: operatingUnitIds,
        tenantId,
        selectSql: `SELECT id, code, name, legal_entity_id FROM operating_units`,
        runQuery,
      }),
      loadReferenceRowsByIds({
        ids: bookIds,
        tenantId,
        selectSql: `SELECT id, code, name, legal_entity_id FROM books`,
        runQuery,
      }),
      loadReferenceRowsByIds({
        ids: consolidationGroupIds,
        tenantId,
        selectSql: `SELECT id, code, name, group_company_id, presentation_currency_code
                    FROM consolidation_groups`,
        runQuery,
      }),
      runQuery(
        `SELECT id, calendar_id, fiscal_year, period_no, period_name, start_date, end_date
         FROM fiscal_periods
         WHERE id = ?
         LIMIT 1`,
        [parsePositiveInt(cycle?.fiscalPeriodId) || 0]
      ),
    ]);

  return {
    legalEntities: new Map(
      legalEntityRows.map((row) => [parsePositiveInt(row.id), row])
    ),
    operatingUnits: new Map(
      operatingUnitRows.map((row) => [parsePositiveInt(row.id), row])
    ),
    books: new Map(bookRows.map((row) => [parsePositiveInt(row.id), row])),
    consolidationGroups: new Map(
      consolidationGroupRows.map((row) => [parsePositiveInt(row.id), row])
    ),
    period: periodResult.rows?.[0] || null,
  };
}

function buildCycleScopeSummary(cycle, referenceMaps) {
  if (cycle?.scopeKind === "CONSOLIDATION_GROUP") {
    const row = referenceMaps.consolidationGroups.get(parsePositiveInt(cycle?.consolidationGroupId));
    return {
      kind: cycle.scopeKind,
      id: parsePositiveInt(cycle?.consolidationGroupId),
      label: buildCodeNameLabel(row?.code, row?.name, `Group #${cycle?.consolidationGroupId || "-"}`),
      presentationCurrencyCode: String(row?.presentation_currency_code || "").trim().toUpperCase() || null,
    };
  }

  const row = referenceMaps.legalEntities.get(parsePositiveInt(cycle?.legalEntityId));
  return {
    kind: cycle?.scopeKind || "LEGAL_ENTITY",
    id: parsePositiveInt(cycle?.legalEntityId),
    label: buildCodeNameLabel(row?.code, row?.name, `Legal Entity #${cycle?.legalEntityId || "-"}`),
    presentationCurrencyCode: null,
  };
}

function buildCyclePeriodSummary(cycle, referenceMaps) {
  const row = referenceMaps.period;
  return {
    id: parsePositiveInt(cycle?.fiscalPeriodId),
    label: row ? buildPeriodLabel(row) : `Fiscal Period #${cycle?.fiscalPeriodId || "-"}`,
    startDate: row?.start_date || null,
    endDate: row?.end_date || null,
  };
}

function buildEnrichedCycleItem(
  item,
  referenceMaps,
  blockers = [],
  linkedConsolidationRun = null,
) {
  const legalEntityRow = referenceMaps.legalEntities.get(parsePositiveInt(item?.legalEntityId));
  const operatingUnitRow = referenceMaps.operatingUnits.get(parsePositiveInt(item?.operatingUnitId));
  const bookRow = referenceMaps.books.get(parsePositiveInt(item?.bookId));
  const consolidationGroupRow = referenceMaps.consolidationGroups.get(
    parsePositiveInt(item?.consolidationGroupId)
  );

  let scopeLabel = item?.scopeType || "-";
  if (item?.scopeType === "CENTRAL") {
    scopeLabel = "Central";
  } else if (item?.scopeType === "OPERATING_UNIT") {
    scopeLabel = buildCodeNameLabel(
      operatingUnitRow?.code,
      operatingUnitRow?.name,
      `Operating Unit #${item?.operatingUnitId || "-"}`
    );
  } else if (item?.scopeType === "BOOK") {
    scopeLabel = buildCodeNameLabel(bookRow?.code, bookRow?.name, `Book #${item?.bookId || "-"}`);
  } else if (item?.scopeType === "CONSOLIDATION_GROUP") {
    scopeLabel = buildCodeNameLabel(
      consolidationGroupRow?.code,
      consolidationGroupRow?.name,
      `Group #${item?.consolidationGroupId || "-"}`
    );
  }

  return {
    ...item,
    legalEntityLabel: buildCodeNameLabel(
      legalEntityRow?.code,
      legalEntityRow?.name,
      item?.legalEntityId ? `Legal Entity #${item.legalEntityId}` : "-"
    ),
    operatingUnitLabel: buildCodeNameLabel(
      operatingUnitRow?.code,
      operatingUnitRow?.name,
      item?.operatingUnitId ? `Operating Unit #${item.operatingUnitId}` : "-"
    ),
    bookLabel: buildCodeNameLabel(
      bookRow?.code,
      bookRow?.name,
      item?.bookId ? `Book #${item.bookId}` : "-"
    ),
    consolidationGroupLabel: buildCodeNameLabel(
      consolidationGroupRow?.code,
      consolidationGroupRow?.name,
      item?.consolidationGroupId ? `Group #${item.consolidationGroupId}` : "-"
    ),
    scopeLabel,
    drillPath: buildWorklistDrillPath(item),
    linkState: parsePositiveInt(item?.currentSourceTargetId) ? "LINKED" : "EXPECTED_ONLY",
    scenarioCode:
      item?.itemType === "CONSOLIDATION_RUN"
        ? linkedConsolidationRun?.scenarioCode ||
          deriveConsolidationScenarioCode(item?.runName)
        : null,
    versionNo:
      item?.itemType === "CONSOLIDATION_RUN"
        ? parsePositiveInt(linkedConsolidationRun?.versionNo) || null
        : null,
    blockerCount: blockers.length,
    blockers: blockers,
    ready: isReadyBusinessStatus(item?.itemType, item?.businessStatus),
    attentionRequired:
      blockers.length > 0 ||
      item?.staleStatus !== "FRESH" ||
      isAttentionBusinessStatus(item?.businessStatus),
  };
}

function groupBlockersByDependentItem(rows = []) {
  const rowsByItemId = new Map();
  const cycleLevelRows = [];

  for (const row of rows) {
    const dependentItemId = parsePositiveInt(row?.dependency?.dependentItemId);
    if (!dependentItemId) {
      cycleLevelRows.push(row);
      continue;
    }
    const existing = rowsByItemId.get(dependentItemId) || [];
    existing.push(row);
    rowsByItemId.set(dependentItemId, existing);
  }

  return {
    rowsByItemId,
    cycleLevelRows,
  };
}

function buildSourceGateUnavailableBlocker(item, message) {
  return {
    code: "CLOSE_SOURCE_GATE_UNAVAILABLE",
    message: String(message || "Close source gate could not be evaluated"),
    severity: "HIGH",
    blockingItemType: item?.itemType || null,
    blockingItemId: parsePositiveInt(item?.id),
    blockingAction: null,
    owner: parsePositiveInt(item?.ownerUserId) ? { userId: parsePositiveInt(item.ownerUserId) } : null,
    dueDate: item?.dueAt || null,
    firstBlockedAt: null,
    drillPath: buildWorklistDrillPath(item),
  };
}

async function loadSourceBlockersByItem(items = [], actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx) || parsePositiveInt(actorCtx?.req?.user?.userId);
  const runQuery = resolveActorRunQuery(actorCtx);
  const req = actorCtx?.req;

  const rowsByItemId = new Map();
  const allRows = [];

  await Promise.all(
    items.map(async (item) => {
      let normalizedRows = [];
      try {
        if (
          item?.itemType === "PERIOD_CLOSE_RUN" &&
          parsePositiveInt(item?.bookId) &&
          parsePositiveInt(item?.closeCycleFiscalPeriodId)
        ) {
          const reviewGate = await getPeriodCloseRunReviewGate({
            tenantId,
            requestedByUserId: userId || parsePositiveInt(item?.ownerUserId),
            runId: item?.currentSourceTargetId,
            bookId: item?.bookId,
            fiscalPeriodId: item?.closeCycleFiscalPeriodId,
            legalEntityId: item?.legalEntityId,
            runQuery,
          });
          normalizedRows = composeCloseBlockers({
            sourceBlockers: Array.isArray(reviewGate?.blockers) ? reviewGate.blockers : [],
          });
        } else if (
          item?.itemType === "LOCAL_CLOSE_PACK" &&
          parsePositiveInt(item?.currentSourceTargetId)
        ) {
          const reviewGate = await getLocalClosePackReviewGate({
            req,
            tenantId,
            packId: item.currentSourceTargetId,
            assertScopeAccess: () => {},
            runQuery,
          });
          normalizedRows = composeCloseBlockers({
            sourceBlockers: Array.isArray(reviewGate?.blockers) ? reviewGate.blockers : [],
          });
        } else if (
          item?.itemType === "CONSOLIDATION_RUN" &&
          parsePositiveInt(item?.currentSourceTargetId) &&
          userId
        ) {
          const reviewGate = await getConsolidationRunReviewGate({
            tenantId,
            runId: item.currentSourceTargetId,
            requestedByUserId: userId,
            runQuery,
          });
          normalizedRows = composeCloseBlockers({
            sourceBlockers: Array.isArray(reviewGate?.blockers) ? reviewGate.blockers : [],
          });
        }
      } catch (err) {
        // PR-03 is a visibility layer. If one live review gate cannot be read,
        // surface that truth as a blocker row instead of failing the cockpit.
        normalizedRows = [buildSourceGateUnavailableBlocker(item, err?.message)];
      }

      rowsByItemId.set(item.id, normalizedRows);
      allRows.push(...normalizedRows);
    })
  );

  return {
    rowsByItemId,
    allRows: sortBlockerRows(allRows),
  };
}

async function loadCurrentConsolidationRunContextMap(
  items = [],
  actorCtx = {},
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const runIds = Array.from(
    new Set(
      items
        .filter((item) => item?.itemType === "CONSOLIDATION_RUN")
        .map((item) => parsePositiveInt(item?.currentSourceTargetId))
        .filter(Boolean),
    ),
  );

  if (!runIds.length) {
    return new Map();
  }

  const result = await runQuery(
    `SELECT
       cr.id,
       cr.run_name,
       cr.scenario_code,
       cr.version_no,
       cr.status,
       cr.presentation_currency_code
     FROM consolidation_runs cr
     JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
     WHERE cg.tenant_id = ?
       AND cr.id IN (${buildIdPlaceholders(runIds)})`,
    [tenantId, ...runIds],
  );

  return new Map(
    (result.rows || []).map((row) => [
      parsePositiveInt(row.id),
      {
        runId: parsePositiveInt(row.id),
        runName: String(row.run_name || "").trim().toUpperCase() || null,
        scenarioCode:
          String(row.scenario_code || "").trim().toUpperCase() ||
          deriveConsolidationScenarioCode(row.run_name),
        versionNo: parsePositiveInt(row.version_no) || 1,
        status: String(row.status || "").trim().toUpperCase() || null,
        presentationCurrencyCode:
          String(row.presentation_currency_code || "").trim().toUpperCase() ||
          null,
      },
    ]),
  );
}

function buildReadinessSummary(worklistRows = [], allBlockers = [], alertSnapshot = null) {
  const totalItems = worklistRows.length;
  const readyItems = worklistRows.filter((row) => row.ready).length;
  const blockedItems = worklistRows.filter((row) => row.blockerCount > 0).length;
  const staleItems = worklistRows.filter((row) => row.staleStatus !== "FRESH").length;
  const expectedOnlyItems = worklistRows.filter((row) => row.linkState === "EXPECTED_ONLY").length;
  const dueSoonItems = worklistRows.filter((row) => row?.dueState === "DUE_SOON").length;
  const overdueItems = worklistRows.filter((row) => row?.dueState === "OVERDUE").length;
  const attentionItems = worklistRows.filter((row) => row?.attentionRequired).length;

  const byItemTypeMap = new Map();
  const byBusinessStatusMap = new Map();

  for (const row of worklistRows) {
    const itemTypeKey = row.itemType;
    const itemTypeSummary = byItemTypeMap.get(itemTypeKey) || {
      itemType: itemTypeKey,
      total: 0,
      readyCount: 0,
      blockedCount: 0,
      staleCount: 0,
      expectedOnlyCount: 0,
      linkedCount: 0,
    };
    itemTypeSummary.total += 1;
    itemTypeSummary.readyCount += row.ready ? 1 : 0;
    itemTypeSummary.blockedCount += row.blockerCount > 0 ? 1 : 0;
    itemTypeSummary.staleCount += row.staleStatus !== "FRESH" ? 1 : 0;
    itemTypeSummary.expectedOnlyCount += row.linkState === "EXPECTED_ONLY" ? 1 : 0;
    itemTypeSummary.linkedCount += row.linkState === "LINKED" ? 1 : 0;
    byItemTypeMap.set(itemTypeKey, itemTypeSummary);

    const businessStatusKey = row.businessStatus;
    byBusinessStatusMap.set(businessStatusKey, (byBusinessStatusMap.get(businessStatusKey) || 0) + 1);
  }

  return {
    totalItems,
    readyItems,
    blockedItems,
    staleItems,
    dueSoonItems,
    overdueItems,
    expectedOnlyItems,
    linkedItems: totalItems - expectedOnlyItems,
    attentionItems,
    activeAlertCount: Number(alertSnapshot?.counts?.total || 0),
    blockerCount: allBlockers.length,
    completionPercent:
      totalItems > 0 ? Number(((readyItems / totalItems) * 100).toFixed(1)) : 0,
    byItemType: [...byItemTypeMap.values()].sort((left, right) =>
      String(left.itemType || "").localeCompare(String(right.itemType || ""))
    ),
    byBusinessStatus: [...byBusinessStatusMap.entries()]
      .map(([businessStatus, count]) => ({ businessStatus, count }))
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0)),
  };
}

async function buildCycleCockpitModel(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const cycleResult = await getCycleById(cycleId, actorCtx, {
    includeItems: true,
  });
  const cycle = cycleResult.row;
  const items = Array.isArray(cycleResult.items) ? cycleResult.items : [];

  const referenceMaps = await loadCycleCockpitReferenceMaps({
    tenantId,
    cycle,
    items,
    runQuery,
  });
  const scope = buildCycleScopeSummary(cycle, referenceMaps);
  const period = buildCyclePeriodSummary(cycle, referenceMaps);

  const [
    dependencyResult,
    sourceBlockerResult,
    latestStaleEventResult,
    journalGovernance,
    supportSchedules,
    reconciliations,
    currentConsolidationRunContexts,
  ] =
    await Promise.all([
      listCycleDependencyBlockers(cycleId, {
        tenantId,
        runQuery,
      }),
      loadSourceBlockersByItem(items, actorCtx),
      listLatestCloseStaleEvents(
        {
          closeCycleId: cycle.id,
          closeCycleItemIds: items.map((item) => item.id),
        },
        {
          tenantId,
          runQuery,
        }
      ),
      buildCloseCycleJournalGovernanceSnapshot(
        {
          cycle,
          period,
        },
        {
          tenantId,
          runQuery,
        }
      ),
      buildCloseCycleSupportScheduleSnapshot(
        {
          cycle,
        },
        {
          tenantId,
          runQuery,
        }
      ),
      buildCloseCycleReconciliationSnapshot(
        {
          cycle,
        },
        {
          tenantId,
          runQuery,
        }
      ),
      loadCurrentConsolidationRunContextMap(items, {
        tenantId,
        runQuery,
      }),
    ]);
  const dependencyRows = Array.isArray(dependencyResult?.rows) ? dependencyResult.rows : [];
  const latestStaleEventsByItemId = new Map(
    (latestStaleEventResult?.rows || []).map((row) => [parsePositiveInt(row.closeCycleItemId), row])
  );
  const { rowsByItemId: dependencyRowsByItemId, cycleLevelRows } =
    groupBlockersByDependentItem(dependencyRows);

  const baseWorklistRows = items.map((item) => {
    const combinedBlockers = sortBlockerRows(
      composeCloseBlockers({
        sourceBlockers: sourceBlockerResult.rowsByItemId.get(item.id) || [],
        dependencyBlockers: dependencyRowsByItemId.get(item.id) || [],
      })
    );
    return buildEnrichedCycleItem(
      item,
      referenceMaps,
      combinedBlockers,
      currentConsolidationRunContexts.get(
        parsePositiveInt(item?.currentSourceTargetId),
      ) || null,
    );
  });
  const allBlockers = sortBlockerRows(
    composeCloseBlockers({
      sourceBlockers: sourceBlockerResult.allRows,
      dependencyBlockers: dependencyRows,
    })
  );
  const slaSnapshot = await buildCloseCycleSlaSnapshot(
    {
      cycle,
      worklistRows: baseWorklistRows,
    },
    {
      tenantId,
      runQuery,
    }
  );
  const alertSnapshot = await buildCloseCycleAlertSnapshot({
    cycle,
    worklistRows: baseWorklistRows,
    slaSnapshot,
    latestStaleEventsByItemId,
  });
  const slaByItemId = new Map(
    (slaSnapshot?.items || []).map((row) => [parsePositiveInt(row.closeCycleItemId), row])
  );
  const alertRowsByItemId = buildAlertRowsByItemId(alertSnapshot?.rows || []);

  // PR-05 keeps alerts time-accurate by deriving them from live due dates and
  // stale/blocker state at read time instead of depending on a scheduler.
  const worklistRows = baseWorklistRows.map((row) => {
    const itemId = parsePositiveInt(row?.id);
    const itemSla = slaByItemId.get(itemId) || buildDefaultSlaState(row?.dueAt || cycle?.dueAt);
    const itemAlerts = alertRowsByItemId.get(itemId) || [];
    const latestStaleEvent = latestStaleEventsByItemId.get(itemId) || null;
    return {
      ...row,
      dueState: itemSla.dueState,
      dueSeverity: itemSla.severity,
      remainingHours: itemSla.remainingHours,
      overdueHours: itemSla.overdueHours,
      sla: itemSla,
      alerts: itemAlerts,
      alertCount: itemAlerts.length,
      latestStaleEvent,
      attentionRequired:
        row.attentionRequired ||
        ["DUE_SOON", "OVERDUE"].includes(itemSla.dueState) ||
        itemAlerts.length > 0,
    };
  });
  const staleSummary = buildStaleSummary(worklistRows);
  const readiness = buildReadinessSummary(worklistRows, allBlockers, alertSnapshot);
  const kpis = await buildCloseCycleKpiSnapshot(
    {
      cycle,
      worklistRows,
      readiness,
    },
    {
      tenantId,
      runQuery,
    },
  );

  // PR-09 keeps the KPI snapshot table fresh from the same live cockpit read
  // model until the product grows a dedicated background snapshot job.
  await syncCloseCycleKpiSnapshots(
    {
      cycle,
      kpiSnapshot: kpis,
    },
    {
      tenantId,
      runQuery,
    },
  );

  return {
    row: cycle,
    scope,
    period,
    journals: journalGovernance,
    supportSchedules,
    reconciliations,
    readiness,
    kpis,
    sla: slaSnapshot,
    alerts: alertSnapshot,
    stale: staleSummary,
    blockers: {
      rows: allBlockers,
      cycleLevelRows: sortBlockerRows(cycleLevelRows),
      counts: {
        total: allBlockers.length,
        high: allBlockers.filter((row) => row?.severity === "HIGH").length,
        medium: allBlockers.filter((row) => row?.severity === "MEDIUM").length,
      },
    },
    worklist: {
      total: worklistRows.length,
      rows: worklistRows,
    },
  };
}

function buildCycleSelect(whereSql = "1 = 1") {
  return `SELECT
      cc.*
    FROM close_cycles cc
    WHERE ${whereSql}`;
}

async function listEligibleLocalBooksForEntity({
  tenantId,
  legalEntityId,
  fiscalCalendarId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       b.id,
       b.legal_entity_id,
       b.calendar_id,
       b.code,
       b.name,
       b.book_type
     FROM books b
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND b.calendar_id = ?
       AND b.book_type = 'LOCAL'
     ORDER BY b.id ASC`,
    [tenantId, legalEntityId, fiscalCalendarId]
  );
  return result.rows || [];
}

async function listActiveOperatingUnitsForEntity({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, legal_entity_id, code, name
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND status = 'ACTIVE'
     ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  return result.rows || [];
}

async function listActiveConsolidationGroupMembers({
  consolidationGroupId,
  periodStartDate,
  periodEndDate,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       cgm.legal_entity_id
     FROM consolidation_group_members cgm
     WHERE cgm.consolidation_group_id = ?
       AND cgm.effective_from <= ?
       AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
     ORDER BY cgm.legal_entity_id ASC, cgm.id ASC`,
    [consolidationGroupId, periodEndDate, periodStartDate]
  );
  const dedupedIds = [];
  const seenIds = new Set();
  for (const row of result.rows || []) {
    const legalEntityId = parsePositiveInt(row?.legal_entity_id);
    if (!legalEntityId || seenIds.has(legalEntityId)) {
      continue;
    }
    seenIds.add(legalEntityId);
    dedupedIds.push(legalEntityId);
  }
  return dedupedIds;
}

function buildPeriodCloseItemInput({
  cycleId,
  bookId,
  legalEntityId,
  ownerUserId = null,
  dueAt = null,
}) {
  return {
    closeCycleId: cycleId,
    itemType: "PERIOD_CLOSE_RUN",
    itemKey: buildCloseCycleItemKey({
      itemType: "PERIOD_CLOSE_RUN",
      bookId,
    }),
    scopeType: "BOOK",
    scopeId: buildCloseCycleItemScopeId({
      scopeType: "BOOK",
      bookId,
    }),
    bookId,
    legalEntityId,
    businessStatus: "NOT_STARTED",
    staleStatus: "FRESH",
    ownerUserId,
    dueAt,
  };
}

function buildCentralLocalCloseItemInput({
  cycleId,
  bookId,
  legalEntityId,
  ownerUserId = null,
  dueAt = null,
  businessStatus = "NOT_OPENED",
}) {
  return {
    closeCycleId: cycleId,
    itemType: "LOCAL_CLOSE_PACK",
    itemKey: buildCloseCycleItemKey({
      itemType: "LOCAL_CLOSE_PACK",
      scopeType: "CENTRAL",
      bookId,
    }),
    scopeType: "CENTRAL",
    scopeId: buildCloseCycleItemScopeId({
      scopeType: "CENTRAL",
      legalEntityId,
    }),
    legalEntityId,
    bookId,
    businessStatus,
    staleStatus: "FRESH",
    ownerUserId,
    dueAt,
  };
}

function buildOperatingUnitLocalCloseItemInput({
  cycleId,
  bookId,
  legalEntityId,
  operatingUnitId,
  ownerUserId = null,
  dueAt = null,
  businessStatus = "NOT_OPENED",
}) {
  return {
    closeCycleId: cycleId,
    itemType: "LOCAL_CLOSE_PACK",
    itemKey: buildCloseCycleItemKey({
      itemType: "LOCAL_CLOSE_PACK",
      scopeType: "OPERATING_UNIT",
      bookId,
      operatingUnitId,
    }),
    scopeType: "OPERATING_UNIT",
    scopeId: buildCloseCycleItemScopeId({
      scopeType: "OPERATING_UNIT",
      operatingUnitId,
    }),
    legalEntityId,
    operatingUnitId,
    bookId,
    businessStatus,
    staleStatus: "FRESH",
    ownerUserId,
    dueAt,
  };
}

function buildConsolidationItemInput({
  cycleId,
  consolidationGroupId,
  presentationCurrencyCode,
  ownerUserId = null,
  dueAt = null,
}) {
  return {
    closeCycleId: cycleId,
    itemType: "CONSOLIDATION_RUN",
    itemKey: buildCloseCycleItemKey({
      itemType: "CONSOLIDATION_RUN",
      consolidationGroupId,
      runName: OFFICIAL_CONSOLIDATION_RUN_NAME,
    }),
    scopeType: "CONSOLIDATION_GROUP",
    scopeId: buildCloseCycleItemScopeId({
      scopeType: "CONSOLIDATION_GROUP",
      consolidationGroupId,
    }),
    consolidationGroupId,
    runName: OFFICIAL_CONSOLIDATION_RUN_NAME,
    presentationCurrencyCode,
    businessStatus: "NOT_STARTED",
    staleStatus: "FRESH",
    ownerUserId,
    dueAt,
  };
}

async function resolveExistingPeriodCloseRunId({
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM period_close_runs
     WHERE book_id = ?
       AND fiscal_period_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  return parsePositiveInt(result.rows?.[0]?.id) || null;
}

async function resolveExistingConsolidationRunId({
  consolidationGroupId,
  fiscalPeriodId,
  runName,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM consolidation_runs
     WHERE consolidation_group_id = ?
       AND fiscal_period_id = ?
       AND run_name = ?
     ORDER BY id DESC
     LIMIT 1`,
    [consolidationGroupId, fiscalPeriodId, toUpperText(runName)]
  );
  return parsePositiveInt(result.rows?.[0]?.id) || null;
}

async function provisionOrReuseLocalClosePack({
  tenantId,
  userId,
  cycleId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  closeScopeType,
  operatingUnitId = null,
  dueAt = null,
  runQuery = query,
}) {
  const packResult = await ensureLocalClosePack(
    {
      tenantId,
      userId,
      cycleId,
      legalEntityId,
      bookId,
      fiscalPeriodId,
      closeScopeType,
      operatingUnitId,
      status: "NOT_OPENED",
      note: null,
    },
    {
      runQuery,
    }
  );

  const itemInput =
    toUpperText(closeScopeType) === "CENTRAL"
      ? buildCentralLocalCloseItemInput({
          cycleId,
          bookId,
          legalEntityId,
          ownerUserId: userId,
          dueAt,
          businessStatus: packResult?.row?.status || "NOT_OPENED",
        })
      : buildOperatingUnitLocalCloseItemInput({
          cycleId,
          bookId,
          legalEntityId,
          operatingUnitId,
          ownerUserId: userId,
          dueAt,
          businessStatus: packResult?.row?.status || "NOT_OPENED",
        });

  const cycleItemResult = await ensureCycleItem(itemInput, {
    tenantId,
    userId,
    runQuery,
  });
  await linkCycleItemToSource(
    {
      closeCycleItemId: parsePositiveInt(cycleItemResult?.row?.id),
      sourceTargetType: "LOCAL_CLOSE_PACK",
      sourceTargetId: parsePositiveInt(packResult?.row?.id),
    },
    {
      tenantId,
      userId,
      runQuery,
    }
  );

  return {
    packResult,
    cycleItemResult,
  };
}

async function linkExistingPeriodCloseItem({
  tenantId,
  userId,
  cycleItemId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const sourceTargetId = await resolveExistingPeriodCloseRunId({
    bookId,
    fiscalPeriodId,
    runQuery,
  });
  if (!sourceTargetId) {
    return false;
  }

  await linkCycleItemToSource(
    {
      closeCycleItemId: cycleItemId,
      sourceTargetType: "PERIOD_CLOSE_RUN",
      sourceTargetId,
    },
    {
      tenantId,
      userId,
      runQuery,
    }
  );
  await syncCycleItemsBySource(
    "PERIOD_CLOSE_RUN",
    sourceTargetId,
    {
      tenantId,
      userId,
      runQuery,
    }
  );
  return true;
}

async function linkExistingConsolidationItem({
  tenantId,
  userId,
  cycleItemId,
  consolidationGroupId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const sourceTargetId = await resolveExistingConsolidationRunId({
    consolidationGroupId,
    fiscalPeriodId,
    runName: OFFICIAL_CONSOLIDATION_RUN_NAME,
    runQuery,
  });
  if (!sourceTargetId) {
    return false;
  }

  await linkCycleItemToSource(
    {
      closeCycleItemId: cycleItemId,
      sourceTargetType: "CONSOLIDATION_RUN",
      sourceTargetId,
    },
    {
      tenantId,
      userId,
      runQuery,
    }
  );
  await syncCycleItemsBySource(
    "CONSOLIDATION_RUN",
    sourceTargetId,
    {
      tenantId,
      userId,
      runQuery,
    }
  );
  return true;
}

async function ensurePeriodCloseItem({
  tenantId,
  userId,
  cycleId,
  fiscalPeriodId,
  bookId,
  legalEntityId,
  dueAt = null,
  runQuery = query,
}) {
  const cycleItemResult = await ensureCycleItem(
    buildPeriodCloseItemInput({
      cycleId,
      bookId,
      legalEntityId,
      ownerUserId: userId,
      dueAt,
    }),
    {
      tenantId,
      userId,
      runQuery,
    }
  );

  const linked = await linkExistingPeriodCloseItem({
    tenantId,
    userId,
    cycleItemId: parsePositiveInt(cycleItemResult?.row?.id),
    bookId,
    fiscalPeriodId,
    runQuery,
  });

  if (!linked) {
    await setItemBusinessStatus(parsePositiveInt(cycleItemResult?.row?.id), "NOT_STARTED", {
      tenantId,
      userId,
      runQuery,
    });
  }

  return cycleItemResult;
}

async function ensureConsolidationItem({
  tenantId,
  userId,
  cycleId,
  consolidationGroupId,
  fiscalPeriodId,
  presentationCurrencyCode,
  dueAt = null,
  runQuery = query,
}) {
  const cycleItemResult = await ensureCycleItem(
    buildConsolidationItemInput({
      cycleId,
      consolidationGroupId,
      presentationCurrencyCode,
      ownerUserId: userId,
      dueAt,
    }),
    {
      tenantId,
      userId,
      runQuery,
    }
  );

  const linked = await linkExistingConsolidationItem({
    tenantId,
    userId,
    cycleItemId: parsePositiveInt(cycleItemResult?.row?.id),
    consolidationGroupId,
    fiscalPeriodId,
    runQuery,
  });

  if (!linked) {
    await setItemBusinessStatus(parsePositiveInt(cycleItemResult?.row?.id), "NOT_STARTED", {
      tenantId,
      userId,
      runQuery,
    });
  }

  return cycleItemResult;
}

async function resolveCycleParticipants(cycleRow, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const cycle = mapCloseCycleRow(cycleRow);
  if (!cycle) {
    throw notFound("Close cycle not found");
  }

  const fiscalPeriod = await loadFiscalPeriodRow(cycle.fiscalPeriodId, runQuery);
  if (!fiscalPeriod) {
    throw badRequest("Close cycle fiscal period not found");
  }

  const participation = {
    localCloseParticipants: [],
    periodCloseParticipants: [],
    consolidationParticipant: null,
  };

  if (cycle.scopeKind === "LEGAL_ENTITY") {
    const books = await listEligibleLocalBooksForEntity({
      tenantId,
      legalEntityId: cycle.legalEntityId,
      fiscalCalendarId: cycle.fiscalCalendarId,
      runQuery,
    });
    if (books.length === 0) {
      throw badRequest("No eligible LOCAL books were found for the selected legal entity");
    }

    const operatingUnits = await listActiveOperatingUnitsForEntity({
      tenantId,
      legalEntityId: cycle.legalEntityId,
      runQuery,
    });

    for (const book of books) {
      participation.localCloseParticipants.push({
        legalEntityId: cycle.legalEntityId,
        bookId: parsePositiveInt(book.id),
        closeScopeType: "CENTRAL",
        operatingUnitId: null,
      });
      participation.periodCloseParticipants.push({
        legalEntityId: cycle.legalEntityId,
        bookId: parsePositiveInt(book.id),
      });

      for (const operatingUnit of operatingUnits) {
        participation.localCloseParticipants.push({
          legalEntityId: cycle.legalEntityId,
          bookId: parsePositiveInt(book.id),
          closeScopeType: "OPERATING_UNIT",
          operatingUnitId: parsePositiveInt(operatingUnit.id),
        });
      }
    }

    return participation;
  }

  const memberEntityIds = await listActiveConsolidationGroupMembers({
    consolidationGroupId: cycle.consolidationGroupId,
    periodStartDate: fiscalPeriod.start_date,
    periodEndDate: fiscalPeriod.end_date,
    runQuery,
  });
  if (memberEntityIds.length === 0) {
    throw badRequest("No active consolidation-group members were found for the cycle period window");
  }

  let eligibleBookCount = 0;
  for (const legalEntityId of memberEntityIds) {
    const books = await listEligibleLocalBooksForEntity({
      tenantId,
      legalEntityId,
      fiscalCalendarId: cycle.fiscalCalendarId,
      runQuery,
    });
    const operatingUnits = await listActiveOperatingUnitsForEntity({
      tenantId,
      legalEntityId,
      runQuery,
    });

    eligibleBookCount += books.length;
    for (const book of books) {
      participation.localCloseParticipants.push({
        legalEntityId,
        bookId: parsePositiveInt(book.id),
        closeScopeType: "CENTRAL",
        operatingUnitId: null,
      });
      participation.periodCloseParticipants.push({
        legalEntityId,
        bookId: parsePositiveInt(book.id),
      });

      for (const operatingUnit of operatingUnits) {
        participation.localCloseParticipants.push({
          legalEntityId,
          bookId: parsePositiveInt(book.id),
          closeScopeType: "OPERATING_UNIT",
          operatingUnitId: parsePositiveInt(operatingUnit.id),
        });
      }
    }
  }

  if (eligibleBookCount <= 0) {
    throw badRequest(
      "The selected consolidation group has active members, but none of them have eligible LOCAL books for the cycle calendar"
    );
  }

  participation.consolidationParticipant = {
    consolidationGroupId: cycle.consolidationGroupId,
  };
  return participation;
}

async function repairProvisionedOpenCycle(cycleRow, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const cycle = mapCloseCycleRow(cycleRow);
  const itemResult = await listCycleItems(cycle.id, {}, { tenantId, userId, runQuery });
  const items = itemResult.rows || [];
  const summary = {
    repairedLocalClosePacks: 0,
    relinkedItems: 0,
    syncedItems: 0,
  };

  for (const item of items) {
    if (item.itemType === "LOCAL_CLOSE_PACK") {
      const packResult = await ensureLocalClosePack(
        {
          tenantId,
          userId,
          cycleId: cycle.id,
          legalEntityId: item.legalEntityId,
          bookId: item.bookId,
          fiscalPeriodId: cycle.fiscalPeriodId,
          closeScopeType: item.scopeType === "CENTRAL" ? "CENTRAL" : "OPERATING_UNIT",
          operatingUnitId: item.operatingUnitId,
          status: item.businessStatus || "NOT_OPENED",
        },
        {
          runQuery,
        }
      );
      summary.repairedLocalClosePacks += 1;

      const currentCycleItem = await findCurrentCycleItemBySourceInCycle(
        "LOCAL_CLOSE_PACK",
        parsePositiveInt(packResult?.row?.id),
        cycle.id,
        {
          tenantId,
          userId,
          runQuery,
        }
      );
      if (!currentCycleItem) {
        await linkCycleItemToSource(
          {
            closeCycleItemId: item.id,
            sourceTargetType: "LOCAL_CLOSE_PACK",
            sourceTargetId: parsePositiveInt(packResult?.row?.id),
          },
          {
            tenantId,
            userId,
            runQuery,
          }
        );
        summary.relinkedItems += 1;
      }
      await syncCycleItemsBySource("LOCAL_CLOSE_PACK", parsePositiveInt(packResult?.row?.id), {
        tenantId,
        userId,
        runQuery,
      });
      summary.syncedItems += 1;
      continue;
    }

    if (item.itemType === "PERIOD_CLOSE_RUN") {
      const linked = await linkExistingPeriodCloseItem({
        tenantId,
        userId,
        cycleItemId: item.id,
        bookId: item.bookId,
        fiscalPeriodId: cycle.fiscalPeriodId,
        runQuery,
      });
      if (linked) {
        summary.relinkedItems += 1;
        summary.syncedItems += 1;
      }
      continue;
    }

    if (item.itemType === "CONSOLIDATION_RUN") {
      const linked = await linkExistingConsolidationItem({
        tenantId,
        userId,
        cycleItemId: item.id,
        consolidationGroupId: item.consolidationGroupId,
        fiscalPeriodId: cycle.fiscalPeriodId,
        runQuery,
      });
      if (linked) {
        summary.relinkedItems += 1;
        summary.syncedItems += 1;
      }
    }
  }

  return summary;
}

/**
 * Register the PR-02a dependency graph for one provisioned close cycle. This
 * companion seam stays service-level until blocker visibility routes arrive.
 */
export async function registerCycleDependencies(cycleId, actorCtx = {}) {
  return registerProvisionedCycleDependencies(cycleId, actorCtx);
}

/**
 * Re-run idempotent dependency registration for an already provisioned cycle.
 * PR-02a uses the same graph-wiring logic for initial register and sync.
 */
export async function syncCycleDependencies(cycleId, actorCtx = {}) {
  return syncProvisionedCycleDependencies(cycleId, actorCtx);
}

/**
 * Resolve the native mixed-scope RBAC scope for one close-cycle route
 * parameter so detail and action routes can reuse standard `requirePermission`.
 */
export async function resolveCloseCycleRouteScope(cycleId, tenantId, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!normalizedTenantId || !normalizedCycleId) {
    return { scopeType: "TENANT", scopeId: normalizedTenantId || null };
  }

  const row = await loadCloseCycleRow({
    cycleId: normalizedCycleId,
    tenantId: normalizedTenantId,
    runQuery,
  });
  const scope = resolveCloseCycleRowScope(row);
  return scope
    ? {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      }
    : { scopeType: "TENANT", scopeId: normalizedTenantId };
}

/**
 * Create one `PLANNED` close cycle with a canonical scope key and derived
 * calendar context.
 */
export async function createCycle(input, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  await assertUserBelongsToTenant(tenantId, userId, "userId");

  const cycleType = normalizeCycleType(input?.cycleType);
  const fiscalPeriodId = parsePositiveInt(input?.fiscalPeriodId);
  const legalEntityId = parsePositiveInt(input?.legalEntityId);
  const consolidationGroupId = parsePositiveInt(input?.consolidationGroupId);
  const ownerUserId = parsePositiveInt(input?.ownerUserId);
  const startsAt = normalizeOptionalDateTime(input?.startsAt, "startsAt");
  const dueAt = normalizeOptionalDateTime(input?.dueAt, "dueAt");
  const hasLegalEntityScope = Boolean(legalEntityId);
  const hasConsolidationGroupScope = Boolean(consolidationGroupId);
  if (!fiscalPeriodId) {
    throw badRequest("fiscalPeriodId is required");
  }
  if (hasLegalEntityScope === hasConsolidationGroupScope) {
    throw badRequest("Exactly one of legalEntityId or consolidationGroupId is required");
  }

  const fiscalPeriod = await loadFiscalPeriodRow(fiscalPeriodId, runQuery);
  if (!fiscalPeriod) {
    throw badRequest("fiscalPeriodId not found");
  }
  if (ownerUserId) {
    await assertUserBelongsToTenant(tenantId, ownerUserId, "ownerUserId");
  }

  let scopeKind = "LEGAL_ENTITY";
  let scopeKey = "";
  let fiscalCalendarId = parsePositiveInt(fiscalPeriod.calendar_id);
  let groupCompanyId = null;

  if (hasLegalEntityScope) {
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    scopeKind = normalizeScopeKind("LEGAL_ENTITY");
    scopeKey = buildCloseCycleScopeKey({
      scopeKind,
      legalEntityId,
    });
  } else {
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      consolidationGroupId,
      "consolidationGroupId"
    );
    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(group.calendar_id),
      fiscalPeriodId,
      "fiscalPeriodId"
    );
    scopeKind = normalizeScopeKind("CONSOLIDATION_GROUP");
    fiscalCalendarId = parsePositiveInt(group.calendar_id);
    groupCompanyId = parsePositiveInt(group.group_company_id) || null;
    scopeKey = buildCloseCycleScopeKey({
      scopeKind,
      consolidationGroupId,
    });
  }

  try {
    const insertResult = await runQuery(
      `INSERT INTO close_cycles (
          tenant_id,
          cycle_type,
          scope_kind,
          fiscal_calendar_id,
          fiscal_period_id,
          legal_entity_id,
          consolidation_group_id,
          group_company_id,
          scope_key,
          status,
          starts_at,
          due_at,
          owner_user_id,
          created_by_user_id,
          updated_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, ?, ?, ?, ?)`,
      [
        tenantId,
        cycleType,
        scopeKind,
        fiscalCalendarId,
        fiscalPeriodId,
        legalEntityId || null,
        consolidationGroupId || null,
        groupCompanyId,
        scopeKey,
        startsAt,
        dueAt,
        ownerUserId || null,
        userId,
        userId,
      ]
    );

    const row = await loadCloseCycleRow({
      cycleId: parsePositiveInt(insertResult.rows?.insertId),
      tenantId,
      runQuery,
    });
    return mapCloseCycleRow(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict(
        "A close cycle already exists for the selected cycle type, period, and scope",
        {
          cycleType,
          fiscalPeriodId,
          scopeKey,
        },
        "CLOSE_CYCLE_DUPLICATE"
      );
    }
    throw err;
  }
}

/**
 * List mixed-scope close cycles with row-derived visibility filtering.
 */
export async function listCycles(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const where = ["cc.tenant_id = ?"];
  const params = [tenantId];
  if (filters?.cycleType) {
    where.push("cc.cycle_type = ?");
    params.push(normalizeCycleType(filters.cycleType));
  }
  if (filters?.scopeKind) {
    where.push("cc.scope_kind = ?");
    params.push(normalizeScopeKind(filters.scopeKind));
  }
  if (filters?.fiscalPeriodId) {
    where.push("cc.fiscal_period_id = ?");
    params.push(parsePositiveInt(filters.fiscalPeriodId));
  }
  if (filters?.status) {
    where.push("cc.status = ?");
    params.push(normalizeCycleStatus(filters.status));
  }
  if (filters?.legalEntityId) {
    where.push("cc.legal_entity_id = ?");
    params.push(parsePositiveInt(filters.legalEntityId));
  }
  if (filters?.consolidationGroupId) {
    where.push("cc.consolidation_group_id = ?");
    params.push(parsePositiveInt(filters.consolidationGroupId));
  }

  const result = await runQuery(
    `${buildCycleSelect(where.join(" AND "))}
     ORDER BY cc.fiscal_period_id DESC, cc.id DESC`,
    params
  );
  const visibleRows = (result.rows || []).filter((row) => canReadCloseCycleRow(actorCtx, row));

  return {
    rows: visibleRows.map(mapCloseCycleRow),
    total: visibleRows.length,
  };
}

/**
 * List cycle headers for the cockpit selector using cockpit-read authority
 * instead of the close-cycle management permission family.
 */
export async function listCockpitCycles(filters = {}, actorCtx = {}) {
  return listCycles(filters, actorCtx);
}

/**
 * List manager-surface cycle headers using whichever lifecycle authority
 * granted access to the manager route. This keeps `GET /cycles` reserved for
 * explicit read access while still letting provision- or lock-only operators
 * target the cycles they are allowed to act on. The manager surface also gets
 * lock-readiness metadata so entity-cycle completion gates are visible before
 * the operator clicks the action.
 */
export async function listManagerCycles(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const result = await listCycles(filters, actorCtx);
  const baseRows = Array.isArray(result?.rows) ? result.rows : [];

  const rows = [];
  for (const row of baseRows) {
    let lockBlockers = [];
    if (toUpperText(row?.status) === "OPEN") {
      // Keep the manager list honest about whether OPEN really means lockable.
      // This lets lock-only operators see the completion gate without needing
      // separate cockpit permissions or a failing POST round trip first.
      // eslint-disable-next-line no-await-in-loop
      lockBlockers = sortBlockerRows(
        await listCycleActionDependencyBlockers(
          {
            closeCycleId: row.id,
            action: "LOCK",
          },
          {
            ...actorCtx,
            tenantId,
            runQuery,
          }
        )
      );
    }

    rows.push({
      ...row,
      lifecycleActions: {
        lock: {
          visible: toUpperText(row?.status) === "OPEN",
          canRun: toUpperText(row?.status) === "OPEN" && lockBlockers.length === 0,
          blockerCount: lockBlockers.length,
          blockers: lockBlockers.slice(0, 3),
        },
      },
    });
  }

  return {
    ...result,
    rows,
  };
}

/**
 * Read one close cycle and, by default, its provisioned participation rows.
 */
export async function getCycleById(cycleId, actorCtx = {}, options = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const row = await loadCloseCycleRow({
    cycleId: normalizedCycleId,
    tenantId,
    runQuery,
  });
  assertReadableCloseCycleRow(actorCtx, row);

  const mappedRow = mapCloseCycleRow(row);
  if (options?.includeItems === false) {
    return {
      row: mappedRow,
    };
  }

  const itemResult = await listCycleItems(normalizedCycleId, {}, { tenantId, runQuery });
  return {
    row: mappedRow,
    items: itemResult.rows,
  };
}

/**
 * Build the close cockpit response by combining the provisioned cycle,
 * item worklist, live source-gate blockers, dependency blockers, PR-05 due
 * state visibility, PR-06 journal-governance catalog, PR-07 support schedule
 * snapshot, stale context, PR-09 KPI dashboards, and summary readiness counts
 * on one read surface.
 */
export async function getCycleCockpit(cycleId, actorCtx = {}) {
  return buildCycleCockpitModel(cycleId, actorCtx);
}

/**
 * Read the PR-03 worklist view for one cycle. This stays visibility-only and
 * enriches each provisioned item with blocker counts, labels, and drill paths.
 */
export async function getCycleWorklist(cycleId, actorCtx = {}) {
  const cockpit = await buildCycleCockpitModel(cycleId, actorCtx);
  return {
    row: cockpit.row,
    scope: cockpit.scope,
    period: cockpit.period,
    sla: cockpit.sla,
    alerts: cockpit.alerts,
    stale: cockpit.stale,
    total: cockpit.worklist.total,
    rows: cockpit.worklist.rows,
  };
}

/**
 * Read the merged PR-03 blocker list for one cycle using the standard blocker
 * payload shared with dependency evaluation and legacy source review gates.
 */
export async function getCycleBlockers(cycleId, actorCtx = {}) {
  const cockpit = await buildCycleCockpitModel(cycleId, actorCtx);
  return {
    row: cockpit.row,
    scope: cockpit.scope,
    period: cockpit.period,
    rows: cockpit.blockers.rows,
    cycleLevelRows: cockpit.blockers.cycleLevelRows,
    counts: cockpit.blockers.counts,
  };
}

/**
 * Read the PR-03 readiness summary for one cycle without enabling any new
 * enforcement. The cockpit uses this to show completion and attention counts.
 */
export async function getCycleReadiness(cycleId, actorCtx = {}) {
  const cockpit = await buildCycleCockpitModel(cycleId, actorCtx);
  return {
    row: cockpit.row,
    scope: cockpit.scope,
    period: cockpit.period,
    sla: cockpit.sla,
    alerts: cockpit.alerts?.counts || {},
    stale: cockpit.stale?.counts || {},
    ...cockpit.readiness,
  };
}

/**
 * Activate the PR-02b cycle lock action once every required terminal
 * dependency is resolved. Existing source hard gates remain separate.
 */
export async function lockCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  return withTransaction(async (tx) => {
    const runQuery = tx.query;
    const cycleRow = await loadCloseCycleRow({
      cycleId,
      tenantId,
      runQuery,
      forUpdate: true,
    });
    if (!cycleRow) {
      throw notFound("Close cycle not found");
    }

    const cycle = mapCloseCycleRow(cycleRow);
    if (cycle.status === "LOCKED") {
      return {
        row: cycle,
        blockers: [],
        idempotent: true,
      };
    }
    if (cycle.status !== "OPEN") {
      throw conflict(
        `Close cycle status ${cycle.status} does not allow locking`,
        {
          cycleId: cycle.id,
          status: cycle.status,
        },
        "CLOSE_CYCLE_STATUS_CONFLICT"
      );
    }

    const blockers = await listCycleActionDependencyBlockers(
      {
        closeCycleId: cycle.id,
        action: "LOCK",
      },
      {
        ...actorCtx,
        tenantId,
        runQuery,
      }
    );
    if (blockers.length > 0) {
      const firstBlocker = blockers[0];
      throw conflict(
        firstBlocker?.message || "Close cycle lock is blocked by unresolved dependencies",
        {
          blockers,
        },
        firstBlocker?.code || "CLOSE_CYCLE_LOCK_BLOCKED"
      );
    }

    await runQuery(
      `UPDATE close_cycles
       SET status = 'LOCKED',
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [userId, tenantId, cycle.id]
    );

    const refreshedRow = await loadCloseCycleRow({
      cycleId: cycle.id,
      tenantId,
      runQuery,
    });
    return {
      row: mapCloseCycleRow(refreshedRow || cycleRow),
      blockers: [],
      idempotent: false,
    };
  });
}

/**
 * Provision a `PLANNED` close cycle into its first operational `OPEN` state by
 * discovering participants, creating safe local close packs, and registering
 * expected period close and consolidation items.
 *
 * PR-01 keeps reprovision as an internal repair seam for already-open cycles,
 * so the public provision flow must reject `OPEN` cycles instead of silently
 * switching behavior.
 */
export async function provisionCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  return withCloseProvisionRetry(() =>
    withTransaction(async (tx) => {
      const runQuery = tx.query;
      const cycleRow = await loadCloseCycleRow({
        cycleId,
        tenantId,
        runQuery,
        forUpdate: true,
      });
      if (!cycleRow) {
        throw notFound("Close cycle not found");
      }
      const cycle = mapCloseCycleRow(cycleRow);
      if (cycle.status === "OPEN") {
        throw conflict(
          "Close cycle is already OPEN; reprovision is an internal repair flow and is not exposed on the public provision route",
          {
            cycleId: cycle.id,
            status: cycle.status,
          },
          "CLOSE_CYCLE_STATUS_CONFLICT"
        );
      }
      if (cycle.status !== "PLANNED") {
        throw conflict(
          `Close cycle status ${cycle.status} does not allow provisioning`,
          {
            cycleId: cycle.id,
            status: cycle.status,
          },
          "CLOSE_CYCLE_STATUS_CONFLICT"
        );
      }

      const participants = await resolveCycleParticipants(cycleRow, {
        ...actorCtx,
        runQuery,
      });

      const summary = {
        mode: "INITIAL_PROVISION",
        localClosePacksCreated: 0,
        localClosePacksReused: 0,
        cycleItemsCreated: 0,
        periodCloseLinksFound: 0,
        consolidationLinksFound: 0,
      };

      for (const participant of participants.localCloseParticipants) {
        // eslint-disable-next-line no-await-in-loop
        const provisionResult = await provisionOrReuseLocalClosePack({
          tenantId,
          userId,
          cycleId: cycle.id,
          legalEntityId: participant.legalEntityId,
          bookId: participant.bookId,
          fiscalPeriodId: cycle.fiscalPeriodId,
          closeScopeType: participant.closeScopeType,
          operatingUnitId: participant.operatingUnitId,
          dueAt: cycle.dueAt,
          runQuery,
        });
        if (provisionResult?.packResult?.created) {
          summary.localClosePacksCreated += 1;
        } else {
          summary.localClosePacksReused += 1;
        }
        if (provisionResult?.cycleItemResult?.created) {
          summary.cycleItemsCreated += 1;
        }
      }

      for (const participant of participants.periodCloseParticipants) {
        // eslint-disable-next-line no-await-in-loop
        const periodResult = await ensurePeriodCloseItem({
          tenantId,
          userId,
          cycleId: cycle.id,
          fiscalPeriodId: cycle.fiscalPeriodId,
          bookId: participant.bookId,
          legalEntityId: participant.legalEntityId,
          dueAt: cycle.dueAt,
          runQuery,
        });
        if (periodResult?.created) {
          summary.cycleItemsCreated += 1;
        }

        // This first-step control plane must pick up already-existing technical
        // runs instead of pretending the source object does not exist yet.
        // eslint-disable-next-line no-await-in-loop
        const periodRunId = await resolveExistingPeriodCloseRunId({
          bookId: participant.bookId,
          fiscalPeriodId: cycle.fiscalPeriodId,
          runQuery,
        });
        if (periodRunId) {
          summary.periodCloseLinksFound += 1;
        }
      }

      if (participants.consolidationParticipant) {
        const group = await assertConsolidationGroupBelongsToTenant(
          tenantId,
          cycle.consolidationGroupId,
          "consolidationGroupId"
        );
        const consolidationResult = await ensureConsolidationItem({
          tenantId,
          userId,
          cycleId: cycle.id,
          consolidationGroupId: cycle.consolidationGroupId,
          fiscalPeriodId: cycle.fiscalPeriodId,
          presentationCurrencyCode: group.presentation_currency_code,
          dueAt: cycle.dueAt,
          runQuery,
        });
        if (consolidationResult?.created) {
          summary.cycleItemsCreated += 1;
        }
        const runId = await resolveExistingConsolidationRunId({
          consolidationGroupId: cycle.consolidationGroupId,
          fiscalPeriodId: cycle.fiscalPeriodId,
          runName: OFFICIAL_CONSOLIDATION_RUN_NAME,
          runQuery,
        });
        if (runId) {
          summary.consolidationLinksFound += 1;
        }
      }

      const itemResult = await listCycleItems(cycle.id, {}, { tenantId, userId, runQuery });
      if ((itemResult.rows || []).length === 0) {
        throw badRequest("Provisioning resolved no close-cycle participation rows");
      }

      const dependencySummary = await registerProvisionedCycleDependencies(cycle.id, {
        tenantId,
        userId,
        runQuery,
      });
      summary.dependencyRowsCreated = Number(dependencySummary?.createdCount || 0);
      summary.dependencyRowsPlanned = Number(dependencySummary?.totalCount || 0);
      const supportScheduleSummary = await syncCloseSupportSchedulesForCycle(cycle.id, {
        tenantId,
        userId,
        runQuery,
      });
      summary.supportSchedulesCreated = Number(supportScheduleSummary?.createdCount || 0);
      summary.supportSchedulesUpdated = Number(supportScheduleSummary?.updatedCount || 0);
      summary.supportSchedulesPlanned = Number(supportScheduleSummary?.totalCount || 0);
      const reconciliationSummary = await syncCloseReconciliationControlsForCycle(cycle.id, {
        tenantId,
        userId,
        runQuery,
      });
      summary.reconciliationSetsCreated = Number(
        reconciliationSummary?.setsCreatedCount || 0
      );
      summary.reconciliationSetsUpdated = Number(
        reconciliationSummary?.setsUpdatedCount || 0
      );
      summary.reconciliationItemsCreated = Number(
        reconciliationSummary?.itemsCreatedCount || 0
      );
      summary.reconciliationItemsUpdated = Number(
        reconciliationSummary?.itemsUpdatedCount || 0
      );
      summary.intercompanyMismatchQueueOpen = Number(
        reconciliationSummary?.mismatchQueueOpenCount || 0
      );

      await runQuery(
        `UPDATE close_cycles
         SET status = 'OPEN',
             updated_by_user_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId, cycle.id]
      );

      const refreshed = await getCycleById(cycle.id, {
        ...actorCtx,
        tenantId,
        userId,
        runQuery,
      });
      return {
        ...refreshed,
        summary,
      };
    })
  );
}

/**
 * Repair an already-open cycle without changing its frozen participant set.
 */
export async function reprovisionCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  return withCloseProvisionRetry(() =>
    withTransaction(async (tx) => {
      const runQuery = tx.query;
      const cycleRow = await loadCloseCycleRow({
        cycleId,
        tenantId,
        runQuery,
        forUpdate: true,
      });
      if (!cycleRow) {
        throw notFound("Close cycle not found");
      }
      const cycle = mapCloseCycleRow(cycleRow);
      if (cycle.status !== "OPEN") {
        throw conflict(
          "Only OPEN close cycles can be reprovisioned",
          {
            cycleId: cycle.id,
            status: cycle.status,
          },
          "CLOSE_CYCLE_STATUS_CONFLICT"
        );
      }

      const summary = await repairProvisionedOpenCycle(cycleRow, {
        ...actorCtx,
        runQuery,
      });
      const dependencySummary = await syncProvisionedCycleDependencies(cycle.id, {
        tenantId,
        userId,
        runQuery,
      });
      summary.dependencyRowsCreated = Number(dependencySummary?.createdCount || 0);
      summary.dependencyRowsPlanned = Number(dependencySummary?.totalCount || 0);
      const supportScheduleSummary = await syncCloseSupportSchedulesForCycle(cycle.id, {
        tenantId,
        userId,
        runQuery,
      });
      summary.supportSchedulesCreated = Number(supportScheduleSummary?.createdCount || 0);
      summary.supportSchedulesUpdated = Number(supportScheduleSummary?.updatedCount || 0);
      summary.supportSchedulesPlanned = Number(supportScheduleSummary?.totalCount || 0);
      const reconciliationSummary = await syncCloseReconciliationControlsForCycle(cycle.id, {
        tenantId,
        userId,
        runQuery,
      });
      summary.reconciliationSetsCreated = Number(
        reconciliationSummary?.setsCreatedCount || 0
      );
      summary.reconciliationSetsUpdated = Number(
        reconciliationSummary?.setsUpdatedCount || 0
      );
      summary.reconciliationItemsCreated = Number(
        reconciliationSummary?.itemsCreatedCount || 0
      );
      summary.reconciliationItemsUpdated = Number(
        reconciliationSummary?.itemsUpdatedCount || 0
      );
      summary.intercompanyMismatchQueueOpen = Number(
        reconciliationSummary?.mismatchQueueOpenCount || 0
      );
      const refreshed = await getCycleById(cycle.id, {
        ...actorCtx,
        tenantId,
        userId,
        runQuery,
      });
      return {
        ...refreshed,
        summary,
      };
    })
  );
}

export default {
  createCycle,
  listCycles,
  listCockpitCycles,
  listManagerCycles,
  getCycleById,
  getCycleCockpit,
  getCycleWorklist,
  getCycleBlockers,
  getCycleReadiness,
  lockCycle,
  provisionCycle,
  reprovisionCycle,
  registerCycleDependencies,
  syncCycleDependencies,
  resolveCloseCycleRouteScope,
};
