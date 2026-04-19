import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { listCycleItems } from "./close.cycle-items.service.js";

const SUPPORT_SCHEDULE_KINDS = Object.freeze(["SUPPORT_SCHEDULE", "DISCLOSURE_PACK"]);
const SUPPORT_SCHEDULE_STATUSES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
]);
const TEMPLATE_CYCLE_SCOPE_KINDS = Object.freeze(["ANY", "LEGAL_ENTITY", "CONSOLIDATION_GROUP"]);
const TEMPLATE_ANCHOR_ITEM_TYPES = Object.freeze([
  "ANY",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_RUN",
]);
const TEMPLATE_MATERIALIZATION_SCOPES = Object.freeze(["CYCLE", "ITEM"]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function parseJsonValue(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function normalizeSupportScheduleKind(value) {
  const normalized = toUpperText(value);
  if (!SUPPORT_SCHEDULE_KINDS.includes(normalized)) {
    throw badRequest(`Unsupported close support schedule kind: ${value}`);
  }
  return normalized;
}

function normalizeSupportScheduleStatus(value) {
  const normalized = toUpperText(value);
  if (!SUPPORT_SCHEDULE_STATUSES.includes(normalized)) {
    throw badRequest(`Unsupported close support schedule status: ${value}`);
  }
  return normalized;
}

function normalizeTemplateCycleScopeKind(value) {
  const normalized = toUpperText(value || "ANY");
  if (!TEMPLATE_CYCLE_SCOPE_KINDS.includes(normalized)) {
    throw badRequest(`Unsupported close support schedule cycle scope kind: ${value}`);
  }
  return normalized;
}

function normalizeTemplateAnchorItemType(value) {
  const normalized = toUpperText(value || "ANY");
  if (!TEMPLATE_ANCHOR_ITEM_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close support schedule anchor item type: ${value}`);
  }
  return normalized;
}

function normalizeTemplateMaterializationScope(value) {
  const normalized = toUpperText(value || "ITEM");
  if (!TEMPLATE_MATERIALIZATION_SCOPES.includes(normalized)) {
    throw badRequest(`Unsupported close support schedule materialization scope: ${value}`);
  }
  return normalized;
}

function mapCycleRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    scopeKind: toUpperText(row.scope_kind),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    ownerUserId: parsePositiveInt(row.owner_user_id),
    dueAt: row.due_at || null,
    status: toUpperText(row.status),
  };
}

function mapSupportScheduleTemplateRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    templateCode: String(row.template_code || "").trim().toUpperCase() || null,
    templateName: String(row.template_name || "").trim() || null,
    scheduleKind: normalizeSupportScheduleKind(row.schedule_kind),
    cycleScopeKind: normalizeTemplateCycleScopeKind(row.cycle_scope_kind),
    anchorItemType: normalizeTemplateAnchorItemType(row.anchor_item_type),
    materializationScope: normalizeTemplateMaterializationScope(row.materialization_scope),
    status: toUpperText(row.status) || "ACTIVE",
    defaultDueOffsetDays: Number(row.default_due_offset_days || 0),
    requiredForCloseVisibility: parseDbBoolean(row.required_for_close_visibility),
    description: String(row.description || "").trim() || null,
    config: parseJsonValue(row.config_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapSupportScheduleRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id),
    closeSupportScheduleTemplateId: parsePositiveInt(row.close_support_schedule_template_id),
    scheduleKey: String(row.schedule_key || "").trim() || null,
    scheduleTitle: String(row.schedule_title || "").trim() || null,
    scheduleKind: normalizeSupportScheduleKind(row.schedule_kind),
    scheduleStatus: normalizeSupportScheduleStatus(row.schedule_status),
    ownerUserId: parsePositiveInt(row.owner_user_id),
    dueAt: row.due_at || null,
    progressPercentage: Number(row.progress_percentage || 0),
    completedResponseCount: Number(row.completed_response_count || 0),
    totalResponseCount: Number(row.total_response_count || 0),
    payload: parseJsonValue(row.payload_json, null),
    template: row.template_code
      ? {
          id: parsePositiveInt(row.template_id ?? row.close_support_schedule_template_id),
          templateCode: String(row.template_code || "").trim().toUpperCase() || null,
          templateName: String(row.template_name || "").trim() || null,
          materializationScope: normalizeTemplateMaterializationScope(row.materialization_scope),
          anchorItemType: normalizeTemplateAnchorItemType(row.anchor_item_type),
          cycleScopeKind: normalizeTemplateCycleScopeKind(row.cycle_scope_kind),
          status: toUpperText(row.template_status || row.status) || "ACTIVE",
        }
      : null,
    linkedItem: row.item_id
      ? {
          id: parsePositiveInt(row.item_id),
          itemType: toUpperText(row.item_type),
          itemKey: String(row.item_key || "").trim() || null,
          scopeType: toUpperText(row.scope_type) || null,
          legalEntityId: parsePositiveInt(row.item_legal_entity_id),
          operatingUnitId: parsePositiveInt(row.item_operating_unit_id),
          bookId: parsePositiveInt(row.item_book_id),
          consolidationGroupId: parsePositiveInt(row.item_consolidation_group_id),
          currentSourceTargetType: row.current_source_target_type
            ? toUpperText(row.current_source_target_type)
            : null,
          currentSourceTargetId: parsePositiveInt(row.current_source_target_id),
        }
      : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function loadCloseCycleRow({ cycleId, tenantId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       scope_kind,
       fiscal_period_id,
       legal_entity_id,
       consolidation_group_id,
       owner_user_id,
       due_at,
       status
     FROM close_cycles
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, cycleId]
  );
  return result.rows?.[0] || null;
}

function dedupeRowsByCode(rows = [], codeField) {
  const mergedRows = [];
  const seenCodes = new Set();
  for (const row of rows) {
    const code = String(row?.[codeField] || "").trim().toUpperCase();
    if (!code || seenCodes.has(code)) {
      continue;
    }
    seenCodes.add(code);
    mergedRows.push(row);
  }
  return mergedRows;
}

function isTemplateApplicableToCycle(template, cycle) {
  if (!template || !cycle) {
    return false;
  }
  return (
    template.cycleScopeKind === "ANY" ||
    template.cycleScopeKind === toUpperText(cycle.scopeKind)
  );
}

function listTargetItemsForTemplate(template, cycleItems = []) {
  if (template?.materializationScope !== "ITEM") {
    return [];
  }
  if (template?.anchorItemType === "ANY") {
    return cycleItems;
  }
  return cycleItems.filter((item) => item?.itemType === template.anchorItemType);
}

function resolveLinkedItemForCycleTemplate(template, cycleItems = []) {
  if (!template || template.materializationScope !== "CYCLE") {
    return null;
  }
  if (template.anchorItemType === "ANY") {
    return null;
  }
  const matches = cycleItems.filter((item) => item?.itemType === template.anchorItemType);
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function buildSupportScheduleKey(template, item = null) {
  if (template?.materializationScope === "CYCLE") {
    return `${template.templateCode}:CYCLE`;
  }
  return `${template.templateCode}:ITEM:${String(item?.itemKey || "").trim().toUpperCase()}`;
}

function buildSupportScheduleTitle(template, item = null) {
  const title = String(template?.templateName || template?.templateCode || "").trim();
  if (!item || template?.materializationScope === "CYCLE") {
    return title;
  }
  const itemSuffix = String(item?.itemKey || item?.itemType || "").trim();
  return itemSuffix ? `${title} / ${itemSuffix}` : title;
}

function offsetTimestampByDays(value, offsetDays = 0) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  parsed.setUTCDate(parsed.getUTCDate() + Number(offsetDays || 0));
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

async function listExistingSupportSchedulesByCycle(cycleId, tenantId, runQuery = query) {
  const result = await runQuery(
    `SELECT *
     FROM close_support_schedules
     WHERE tenant_id = ?
       AND close_cycle_id = ?`,
    [tenantId, cycleId]
  );

  const rowsByKey = new Map();
  for (const row of result.rows || []) {
    const mappedRow = mapSupportScheduleRow(row);
    if (mappedRow?.scheduleKey) {
      rowsByKey.set(mappedRow.scheduleKey, mappedRow);
    }
  }
  return rowsByKey;
}

function areSupportScheduleMetadataEqual(existingRow, nextRow) {
  return (
    parsePositiveInt(existingRow?.closeSupportScheduleTemplateId) ===
      parsePositiveInt(nextRow?.closeSupportScheduleTemplateId) &&
    parsePositiveInt(existingRow?.closeCycleItemId) === parsePositiveInt(nextRow?.closeCycleItemId) &&
    String(existingRow?.scheduleTitle || "") === String(nextRow?.scheduleTitle || "") &&
    String(existingRow?.scheduleKind || "") === String(nextRow?.scheduleKind || "") &&
    parsePositiveInt(existingRow?.ownerUserId) === parsePositiveInt(nextRow?.ownerUserId) &&
    String(existingRow?.dueAt || "") === String(nextRow?.dueAt || "")
  );
}

function buildWorkJournalPath({ legalEntityId = null, fiscalPeriodId = null }) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/mahsup-islemleri${queryString ? `?${queryString}` : ""}`;
}

function buildLocalClosePackPath(packId) {
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/${packId}`;
}

function buildLocalCloseWorkspacePath({ legalEntityId = null, bookId = null, fiscalPeriodId = null }) {
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
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri${queryString ? `?${queryString}` : ""}`;
}

function buildPeriodClosePath({ legalEntityId = null, bookId = null, fiscalPeriodId = null }) {
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
  return `/app/donem-sonu-islemler/yillik/kapanis-islemleri${queryString ? `?${queryString}` : ""}`;
}

function buildConsolidationReportsPath({ consolidationGroupId = null, runId = null }) {
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

function buildScheduleDrillPath(row, cycle) {
  const linkedItem = row?.linkedItem || null;
  if (!linkedItem) {
    return null;
  }
  if (linkedItem.itemType === "LOCAL_CLOSE_PACK") {
    if (parsePositiveInt(linkedItem.currentSourceTargetId)) {
      return buildLocalClosePackPath(linkedItem.currentSourceTargetId);
    }
    return buildLocalCloseWorkspacePath({
      legalEntityId: linkedItem.legalEntityId,
      bookId: linkedItem.bookId,
      fiscalPeriodId: cycle?.fiscalPeriodId || null,
    });
  }
  if (linkedItem.itemType === "PERIOD_CLOSE_RUN") {
    return buildPeriodClosePath({
      legalEntityId: linkedItem.legalEntityId,
      bookId: linkedItem.bookId,
      fiscalPeriodId: cycle?.fiscalPeriodId || null,
    });
  }
  if (linkedItem.itemType === "CONSOLIDATION_RUN") {
    return buildConsolidationReportsPath({
      consolidationGroupId: linkedItem.consolidationGroupId || cycle?.consolidationGroupId || null,
      runId: linkedItem.currentSourceTargetId,
    });
  }
  return buildWorkJournalPath({
    legalEntityId: cycle?.legalEntityId || linkedItem.legalEntityId || null,
    fiscalPeriodId: cycle?.fiscalPeriodId || null,
  });
}

function resolveScheduleDueState(row) {
  if (row?.scheduleStatus === "APPROVED") {
    return "READY";
  }
  if (!row?.dueAt) {
    return "NO_DUE_DATE";
  }
  const dueDate = new Date(row.dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return "NO_DUE_DATE";
  }
  return dueDate.getTime() < Date.now() ? "OVERDUE" : "ON_TRACK";
}

/**
 * Read the merged PR-07 support-schedule template catalog for one tenant while
 * preferring tenant-specific overrides over shipped global defaults.
 */
export async function listCloseSupportScheduleTemplates(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const result = await runQuery(
    `SELECT *
     FROM close_support_schedule_templates
     WHERE tenant_id IS NULL OR tenant_id = ?
     ORDER BY
       CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
       template_code`,
    [tenantId, tenantId]
  );

  let rows = dedupeRowsByCode(
    (result.rows || []).map(mapSupportScheduleTemplateRow),
    "templateCode"
  );

  if (filters?.status) {
    rows = rows.filter((row) => row.status === toUpperText(filters.status));
  }
  if (filters?.scheduleKind) {
    rows = rows.filter(
      (row) => row.scheduleKind === normalizeSupportScheduleKind(filters.scheduleKind)
    );
  }
  if (filters?.cycleScopeKind) {
    rows = rows.filter(
      (row) =>
        row.cycleScopeKind === normalizeTemplateCycleScopeKind(filters.cycleScopeKind)
    );
  }

  return {
    rows,
  };
}

/**
 * Materialize the PR-07 support-schedule rows for one cycle from the active
 * template catalog. This remains visibility/data-collection only and does not
 * add any new hard close gating in this step.
 */
export async function syncCloseSupportSchedulesForCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const cycleRow = await loadCloseCycleRow({
    cycleId: normalizedCycleId,
    tenantId,
    runQuery,
  });
  const cycle = mapCycleRow(cycleRow);
  if (!cycle) {
    throw badRequest("Close cycle not found");
  }

  const [templateResult, itemResult, existingRowsByKey] = await Promise.all([
    listCloseSupportScheduleTemplates({ status: "ACTIVE" }, { tenantId, runQuery }),
    listCycleItems(normalizedCycleId, {}, { tenantId, userId, runQuery }),
    listExistingSupportSchedulesByCycle(normalizedCycleId, tenantId, runQuery),
  ]);
  const cycleItems = Array.isArray(itemResult?.rows) ? itemResult.rows : [];
  const applicableTemplates = (templateResult.rows || []).filter((row) =>
    isTemplateApplicableToCycle(row, cycle)
  );

  const summary = {
    createdCount: 0,
    updatedCount: 0,
    totalCount: 0,
  };

  for (const template of applicableTemplates) {
    const plannedRows =
      template.materializationScope === "CYCLE"
        ? [
            {
              template,
              linkedItem: resolveLinkedItemForCycleTemplate(template, cycleItems),
            },
          ]
        : listTargetItemsForTemplate(template, cycleItems).map((item) => ({
            template,
            linkedItem: item,
          }));

    for (const plannedRow of plannedRows) {
      const scheduleKey = buildSupportScheduleKey(plannedRow.template, plannedRow.linkedItem);
      const nextRow = {
        closeSupportScheduleTemplateId: plannedRow.template.id,
        closeCycleItemId: parsePositiveInt(plannedRow.linkedItem?.id) || null,
        scheduleKey,
        scheduleTitle: buildSupportScheduleTitle(plannedRow.template, plannedRow.linkedItem),
        scheduleKind: plannedRow.template.scheduleKind,
        ownerUserId: cycle.ownerUserId || null,
        dueAt: offsetTimestampByDays(cycle.dueAt, plannedRow.template.defaultDueOffsetDays),
      };
      summary.totalCount += 1;

      const existingRow = existingRowsByKey.get(scheduleKey) || null;
      if (!existingRow) {
        // PR-07 provisions structured support rows from the cycle's resolved
        // participant set instead of hiding first materialization behind read
        // traffic in the cockpit.
        await runQuery(
          `INSERT INTO close_support_schedules (
              tenant_id,
              close_cycle_id,
              close_cycle_item_id,
              close_support_schedule_template_id,
              schedule_key,
              schedule_title,
              schedule_kind,
              schedule_status,
              owner_user_id,
              due_at,
              progress_percentage,
              completed_response_count,
              total_response_count,
              created_by_user_id,
              updated_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?, ?, 0, 0, 0, ?, ?)`,
          [
            tenantId,
            normalizedCycleId,
            nextRow.closeCycleItemId,
            nextRow.closeSupportScheduleTemplateId,
            nextRow.scheduleKey,
            nextRow.scheduleTitle,
            nextRow.scheduleKind,
            nextRow.ownerUserId,
            nextRow.dueAt,
            userId,
            userId,
          ]
        );
        summary.createdCount += 1;
        continue;
      }

      if (!areSupportScheduleMetadataEqual(existingRow, nextRow)) {
        await runQuery(
          `UPDATE close_support_schedules
           SET close_cycle_item_id = ?,
               close_support_schedule_template_id = ?,
               schedule_title = ?,
               schedule_kind = ?,
               owner_user_id = ?,
               due_at = ?,
               updated_by_user_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ?
             AND close_cycle_id = ?
             AND schedule_key = ?`,
          [
            nextRow.closeCycleItemId,
            nextRow.closeSupportScheduleTemplateId,
            nextRow.scheduleTitle,
            nextRow.scheduleKind,
            nextRow.ownerUserId,
            nextRow.dueAt,
            userId,
            tenantId,
            normalizedCycleId,
            nextRow.scheduleKey,
          ]
        );
        summary.updatedCount += 1;
      }
    }
  }

  return summary;
}

/**
 * Build the PR-07 support-schedule snapshot for one cycle so the cockpit can
 * show materialized support schedules and disclosure packs without enabling
 * any new completion gate in this step.
 */
export async function buildCloseCycleSupportScheduleSnapshot(
  {
    cycle,
  } = {},
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!cycle?.id) {
    throw badRequest("cycle is required");
  }

  const result = await runQuery(
    `SELECT
       css.*,
       cst.id AS template_id,
       cst.template_code,
       cst.template_name,
       cst.anchor_item_type,
       cst.cycle_scope_kind,
       cst.materialization_scope,
       cst.status AS template_status,
       cci.id AS item_id,
       cci.item_type,
       cci.item_key,
       cci.scope_type,
       cci.legal_entity_id AS item_legal_entity_id,
       cci.operating_unit_id AS item_operating_unit_id,
       cci.book_id AS item_book_id,
       cci.consolidation_group_id AS item_consolidation_group_id,
       ccil.source_target_type AS current_source_target_type,
       ccil.source_target_id AS current_source_target_id
     FROM close_support_schedules css
     JOIN close_support_schedule_templates cst
       ON cst.id = css.close_support_schedule_template_id
     LEFT JOIN close_cycle_items cci
       ON cci.id = css.close_cycle_item_id
     LEFT JOIN close_cycle_item_links ccil
       ON ccil.close_cycle_item_id = cci.id
      AND ccil.is_current = TRUE
     WHERE css.tenant_id = ?
       AND css.close_cycle_id = ?
     ORDER BY
       CASE WHEN css.schedule_kind = 'DISCLOSURE_PACK' THEN 0 ELSE 1 END,
       css.schedule_title,
       css.id`,
    [tenantId, cycle.id]
  );

  const rows = (result.rows || []).map((row) => {
    const mappedRow = mapSupportScheduleRow(row);
    return {
      ...mappedRow,
      dueState: resolveScheduleDueState(mappedRow),
      drillPath: buildScheduleDrillPath(mappedRow, cycle),
    };
  });

  const byStatusMap = new Map();
  const byKindMap = new Map();
  for (const row of rows) {
    byStatusMap.set(row.scheduleStatus, (byStatusMap.get(row.scheduleStatus) || 0) + 1);
    byKindMap.set(row.scheduleKind, (byKindMap.get(row.scheduleKind) || 0) + 1);
  }

  return {
    total: rows.length,
    counts: {
      supportSchedules: rows.filter((row) => row.scheduleKind === "SUPPORT_SCHEDULE").length,
      disclosurePacks: rows.filter((row) => row.scheduleKind === "DISCLOSURE_PACK").length,
      cycleScoped: rows.filter((row) => !row.closeCycleItemId).length,
      itemScoped: rows.filter((row) => Boolean(row.closeCycleItemId)).length,
      overdue: rows.filter((row) => row.dueState === "OVERDUE").length,
    },
    byStatus: [...byStatusMap.entries()]
      .map(([scheduleStatus, count]) => ({ scheduleStatus, count }))
      .sort((left, right) => Number(right.count || 0) - Number(left.count || 0)),
    byKind: [...byKindMap.entries()]
      .map(([scheduleKind, count]) => ({ scheduleKind, count }))
      .sort((left, right) => String(left.scheduleKind).localeCompare(String(right.scheduleKind))),
    rows,
  };
}

export default {
  listCloseSupportScheduleTemplates,
  syncCloseSupportSchedulesForCycle,
  buildCloseCycleSupportScheduleSnapshot,
};
