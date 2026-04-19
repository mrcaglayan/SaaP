import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { deriveConsolidationScenarioCode } from "./consolidation.scenarios.shared.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function roundMetric(value, scale = 1) {
  return Number(Number(value || 0).toFixed(scale));
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "SERIALIZATION_FAILED" });
  }
}

function buildIdPlaceholders(ids = []) {
  return ids.map(() => "?").join(", ");
}

function buildItemTypeOrderValue(itemType) {
  const normalized = toUpperText(itemType);
  if (normalized === "PERIOD_CLOSE_RUN") {
    return 1;
  }
  if (normalized === "LOCAL_CLOSE_PACK") {
    return 2;
  }
  if (normalized === "CONSOLIDATION_RUN") {
    return 3;
  }
  return 99;
}

const CLOSE_REOPEN_AUDIT_TARGETS = Object.freeze({
  PERIOD_CLOSE_RUN: {
    resourceType: "period_close_run",
    actions: ["gl.period_close.reopen"],
  },
  LOCAL_CLOSE_PACK: {
    resourceType: "local_close_pack",
    actions: ["ouclose.reopen.execute"],
  },
  CONSOLIDATION_RUN: {
    resourceType: "consolidation_run",
    actions: ["consolidation.run.reopen"],
  },
});

function buildBottleneckStep(worklistRows = []) {
  const unresolvedRows = worklistRows.filter((row) => !row?.ready);
  if (!unresolvedRows.length) {
    return null;
  }

  const summaryByItemType = new Map();
  for (const row of unresolvedRows) {
    const itemType = toUpperText(row?.itemType);
    const existing = summaryByItemType.get(itemType) || {
      itemType,
      unresolvedCount: 0,
      blockedCount: 0,
      overdueCount: 0,
      staleCount: 0,
    };
    existing.unresolvedCount += 1;
    existing.blockedCount += Number(row?.blockerCount || 0) > 0 ? 1 : 0;
    existing.overdueCount += row?.dueState === "OVERDUE" ? 1 : 0;
    existing.staleCount += row?.staleStatus !== "FRESH" ? 1 : 0;
    summaryByItemType.set(itemType, existing);
  }

  const rankedRows = [...summaryByItemType.values()].sort((left, right) => {
    const blockedDelta = Number(right.blockedCount || 0) - Number(left.blockedCount || 0);
    if (blockedDelta !== 0) {
      return blockedDelta;
    }
    const overdueDelta = Number(right.overdueCount || 0) - Number(left.overdueCount || 0);
    if (overdueDelta !== 0) {
      return overdueDelta;
    }
    const unresolvedDelta =
      Number(right.unresolvedCount || 0) - Number(left.unresolvedCount || 0);
    if (unresolvedDelta !== 0) {
      return unresolvedDelta;
    }
    return buildItemTypeOrderValue(left.itemType) - buildItemTypeOrderValue(right.itemType);
  });

  return rankedRows[0]?.itemType || null;
}

function buildReopenAuditTargetKey(resourceType, resourceId) {
  const normalizedResourceType = String(resourceType || "").trim().toLowerCase();
  const normalizedResourceId = String(resourceId || "").trim();
  if (!normalizedResourceType || !normalizedResourceId) {
    return null;
  }
  return `${normalizedResourceType}:${normalizedResourceId}`;
}

function buildReopenWorkItemTargetKey(row = {}) {
  const itemType = toUpperText(row?.itemType);
  const sourceTargetId = parsePositiveInt(row?.currentSourceTargetId);
  const targetConfig = CLOSE_REOPEN_AUDIT_TARGETS[itemType];
  if (!targetConfig || !sourceTargetId) {
    return null;
  }
  return buildReopenAuditTargetKey(targetConfig.resourceType, sourceTargetId);
}

async function listCloseCycleReopenAuditEvents(worklistRows = [], actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const targets = new Map();
  for (const row of worklistRows) {
    const itemType = toUpperText(row?.itemType);
    const targetConfig = CLOSE_REOPEN_AUDIT_TARGETS[itemType];
    const sourceTargetId = parsePositiveInt(row?.currentSourceTargetId);
    if (!targetConfig || !sourceTargetId) {
      continue;
    }
    const existing = targets.get(itemType) || {
      resourceType: targetConfig.resourceType,
      actions: targetConfig.actions,
      resourceIds: new Set(),
    };
    existing.resourceIds.add(String(sourceTargetId));
    targets.set(itemType, existing);
  }

  if (targets.size === 0) {
    return [];
  }

  const whereClauses = [];
  const params = [tenantId];
  for (const target of targets.values()) {
    const resourceIds = [...target.resourceIds];
    if (!resourceIds.length) {
      continue;
    }
    whereClauses.push(
      `(al.resource_type = ? AND al.action IN (${buildIdPlaceholders(
        target.actions
      )}) AND al.resource_id IN (${buildIdPlaceholders(resourceIds)}))`
    );
    params.push(target.resourceType, ...target.actions, ...resourceIds);
  }

  if (!whereClauses.length) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       al.id,
       al.action,
       al.resource_type,
       al.resource_id,
       al.created_at
     FROM audit_logs al
     WHERE al.tenant_id = ?
       AND (${whereClauses.join(" OR ")})
     ORDER BY al.created_at ASC, al.id ASC`,
    params
  );

  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row.id),
    action: String(row.action || "").trim().toLowerCase() || null,
    resourceType: String(row.resource_type || "").trim().toLowerCase() || null,
    resourceId: String(row.resource_id || "").trim() || null,
    createdAt: row.created_at || null,
  }));
}

function buildReopenMetrics(worklistRows = [], auditRows = []) {
  const metricsByItemId = new Map();
  const itemIdByTargetKey = new Map();

  for (const row of worklistRows) {
    const itemId = parsePositiveInt(row?.id);
    if (!itemId) {
      continue;
    }
    const currentlyReopened = toUpperText(row?.businessStatus) === "REOPENED";
    metricsByItemId.set(itemId, {
      reopenEventsTotal: 0,
      reopenedAtLeastOnce: currentlyReopened,
      currentlyReopened,
    });
    const targetKey = buildReopenWorkItemTargetKey(row);
    if (targetKey) {
      itemIdByTargetKey.set(targetKey, itemId);
    }
  }

  for (const auditRow of auditRows) {
    const targetKey = buildReopenAuditTargetKey(auditRow.resourceType, auditRow.resourceId);
    const itemId = itemIdByTargetKey.get(targetKey);
    if (!itemId) {
      continue;
    }
    const existing = metricsByItemId.get(itemId) || {
      reopenEventsTotal: 0,
      reopenedAtLeastOnce: false,
      currentlyReopened: false,
    };
    existing.reopenEventsTotal += 1;
    existing.reopenedAtLeastOnce = true;
    metricsByItemId.set(itemId, existing);
  }

  let reopenEventsTotal = 0;
  let itemsReopenedAtLeastOnce = 0;
  let currentlyReopenedItems = 0;
  for (const metrics of metricsByItemId.values()) {
    reopenEventsTotal += Number(metrics.reopenEventsTotal || 0);
    itemsReopenedAtLeastOnce += metrics.reopenedAtLeastOnce ? 1 : 0;
    currentlyReopenedItems += metrics.currentlyReopened ? 1 : 0;
  }

  return {
    summary: {
      reopenEventsTotal,
      itemsReopenedAtLeastOnce,
      currentlyReopenedItems,
      reopenCount: reopenEventsTotal,
    },
    byItemId: metricsByItemId,
  };
}

function buildEntityHeatmapRows(worklistRows = [], reopenMetricsByItemId = new Map()) {
  const rowsByEntityId = new Map();

  for (const row of worklistRows) {
    const legalEntityId = parsePositiveInt(row?.legalEntityId);
    const itemId = parsePositiveInt(row?.id);
    if (!legalEntityId) {
      continue;
    }

    const reopenMetrics = reopenMetricsByItemId.get(itemId) || {
      reopenEventsTotal: 0,
      reopenedAtLeastOnce: false,
      currentlyReopened: false,
    };
    const existing = rowsByEntityId.get(legalEntityId) || {
      snapshotKey: `LEGAL_ENTITY:${legalEntityId}`,
      legalEntityId,
      legalEntityLabel: row?.legalEntityLabel || `Legal Entity #${legalEntityId}`,
      totalItems: 0,
      readyItems: 0,
      blockedItems: 0,
      overdueItems: 0,
      staleItems: 0,
      reopenEventsTotal: 0,
      itemsReopenedAtLeastOnce: 0,
      currentlyReopenedItems: 0,
      reopenCount: 0,
      attentionItems: 0,
    };

    existing.totalItems += 1;
    existing.readyItems += row?.ready ? 1 : 0;
    existing.blockedItems += Number(row?.blockerCount || 0) > 0 ? 1 : 0;
    existing.overdueItems += row?.dueState === "OVERDUE" ? 1 : 0;
    existing.staleItems += row?.staleStatus !== "FRESH" ? 1 : 0;
    existing.reopenEventsTotal += Number(reopenMetrics.reopenEventsTotal || 0);
    existing.itemsReopenedAtLeastOnce += reopenMetrics.reopenedAtLeastOnce ? 1 : 0;
    existing.currentlyReopenedItems += reopenMetrics.currentlyReopened ? 1 : 0;
    existing.reopenCount += Number(reopenMetrics.reopenEventsTotal || 0);
    existing.attentionItems += row?.attentionRequired ? 1 : 0;
    rowsByEntityId.set(legalEntityId, existing);
  }

  return [...rowsByEntityId.values()]
    .map((row) => ({
      ...row,
      completionPercent:
        row.totalItems > 0 ? roundMetric((row.readyItems / row.totalItems) * 100, 1) : 0,
    }))
    .sort((left, right) => {
      const completionDelta =
        Number(left.completionPercent || 0) - Number(right.completionPercent || 0);
      if (completionDelta !== 0) {
        return completionDelta;
      }
      const overdueDelta = Number(right.overdueItems || 0) - Number(left.overdueItems || 0);
      if (overdueDelta !== 0) {
        return overdueDelta;
      }
      return String(left.legalEntityLabel || "").localeCompare(
        String(right.legalEntityLabel || "")
      );
    });
}

async function loadLocalCloseApprovalMetrics(packIds = [], actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId || !packIds.length) {
    return new Map();
  }

  const result = await runQuery(
    `SELECT
       id,
       submitted_at,
       approved_at
     FROM local_close_packs
     WHERE tenant_id = ?
       AND id IN (${buildIdPlaceholders(packIds)})`,
    [tenantId, ...packIds],
  );

  const metricsByPackId = new Map();
  for (const row of result.rows || []) {
    const packId = parsePositiveInt(row?.id);
    if (!packId) {
      continue;
    }
    const submittedAt = row?.submitted_at ? new Date(row.submitted_at) : null;
    const approvedAt = row?.approved_at ? new Date(row.approved_at) : null;
    const approvalSlaHours =
      submittedAt &&
      approvedAt &&
      !Number.isNaN(submittedAt.getTime()) &&
      !Number.isNaN(approvedAt.getTime()) &&
      approvedAt.getTime() >= submittedAt.getTime()
        ? roundMetric((approvedAt.getTime() - submittedAt.getTime()) / 3600000, 2)
        : null;

    metricsByPackId.set(packId, {
      submittedAt: row?.submitted_at || null,
      approvedAt: row?.approved_at || null,
      approvalSlaHours,
    });
  }

  return metricsByPackId;
}

async function listConsolidationScenarioRuns({ cycle }, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const consolidationGroupId = parsePositiveInt(cycle?.consolidationGroupId);
  const fiscalPeriodId = parsePositiveInt(cycle?.fiscalPeriodId);

  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!consolidationGroupId || !fiscalPeriodId) {
    return {
      totalRuns: 0,
      byScenario: [],
      rows: [],
    };
  }

  const result = await runQuery(
    `SELECT
       cr.id,
       cr.run_name,
       cr.scenario_code,
       cr.version_no,
       cr.status,
       cr.presentation_currency_code,
       cr.started_at,
       cr.finished_at
     FROM consolidation_runs cr
     JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
     WHERE cg.tenant_id = ?
       AND cr.consolidation_group_id = ?
       AND cr.fiscal_period_id = ?
     ORDER BY
       CASE cr.scenario_code
         WHEN 'OFFICIAL' THEN 0
         WHEN 'RESTATED' THEN 1
         WHEN 'TRIAL' THEN 2
         WHEN 'SIMULATION' THEN 3
         ELSE 9
       END,
       cr.version_no DESC,
       cr.started_at DESC,
       cr.id DESC`,
    [tenantId, consolidationGroupId, fiscalPeriodId],
  );

  const rows = (result.rows || []).map((row) => ({
    runId: parsePositiveInt(row.id),
    runName: String(row.run_name || "").trim().toUpperCase() || null,
    scenarioCode:
      String(row.scenario_code || "").trim().toUpperCase() ||
      deriveConsolidationScenarioCode(row.run_name),
    versionNo: parsePositiveInt(row.version_no) || 1,
    status: String(row.status || "").trim().toUpperCase() || null,
    presentationCurrencyCode:
      String(row.presentation_currency_code || "").trim().toUpperCase() || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    isCycleGovernedOfficial:
      toUpperText(row.run_name) === "OFFICIAL" &&
      toUpperText(row.scenario_code) === "OFFICIAL",
  }));

  const countsByScenario = new Map();
  for (const row of rows) {
    countsByScenario.set(row.scenarioCode, (countsByScenario.get(row.scenarioCode) || 0) + 1);
  }

  return {
    totalRuns: rows.length,
    byScenario: [...countsByScenario.entries()]
      .map(([scenarioCode, count]) => ({ scenarioCode, count }))
      .sort((left, right) => String(left.scenarioCode).localeCompare(String(right.scenarioCode))),
    rows,
  };
}

/**
 * Build the live PR-09 KPI dashboard model from the current close-cycle
 * worklist, linked local-close approval timings, and scenario-distinguished
 * consolidation runs for the cycle period. Reopen KPIs are event-backed so the
 * dashboard preserves reopen history even after the affected item is fixed.
 */
export async function buildCloseCycleKpiSnapshot(
  {
    cycle,
    worklistRows = [],
    readiness = null,
  },
  actorCtx = {},
) {
  if (!cycle?.id) {
    throw badRequest("cycle is required");
  }

  const linkedPackIds = Array.from(
    new Set(
      worklistRows
        .filter((row) => toUpperText(row?.itemType) === "LOCAL_CLOSE_PACK")
        .map((row) => parsePositiveInt(row?.currentSourceTargetId))
        .filter(Boolean),
    ),
  );

  const [approvalMetricsByPackId, consolidationScenarios, reopenAuditRows] = await Promise.all([
    loadLocalCloseApprovalMetrics(linkedPackIds, actorCtx),
    listConsolidationScenarioRuns({ cycle }, actorCtx),
    listCloseCycleReopenAuditEvents(worklistRows, actorCtx),
  ]);

  const approvalSlaHours = linkedPackIds
    .map((packId) => approvalMetricsByPackId.get(packId)?.approvalSlaHours)
    .filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)));
  const reopenMetrics = buildReopenMetrics(worklistRows, reopenAuditRows);
  const entityHeatmapRows = buildEntityHeatmapRows(worklistRows, reopenMetrics.byItemId);
  const readyItems =
    readiness?.readyItems ?? worklistRows.filter((row) => Boolean(row?.ready)).length;
  const totalItems = readiness?.totalItems ?? worklistRows.length;
  const blockedItems =
    readiness?.blockedItems ??
    worklistRows.filter((row) => Number(row?.blockerCount || 0) > 0).length;
  const dueSoonCount =
    readiness?.dueSoonItems ??
    worklistRows.filter((row) => row?.dueState === "DUE_SOON").length;
  const overdueCount =
    readiness?.overdueItems ??
    worklistRows.filter((row) => row?.dueState === "OVERDUE").length;
  const staleCount =
    readiness?.staleItems ??
    worklistRows.filter((row) => toUpperText(row?.staleStatus) !== "FRESH").length;
  const reopenEventsTotal = Number(reopenMetrics.summary.reopenEventsTotal || 0);
  const itemsReopenedAtLeastOnce = Number(
    reopenMetrics.summary.itemsReopenedAtLeastOnce || 0
  );
  const currentlyReopenedItems = Number(
    reopenMetrics.summary.currentlyReopenedItems || 0
  );

  return {
    capturedAt: new Date().toISOString(),
    summary: {
      totalItems,
      readyItems,
      blockedItems,
      dueSoonCount,
      overdueCount,
      staleCount,
      reopenCount: reopenEventsTotal,
      reopenEventsTotal,
      itemsReopenedAtLeastOnce,
      currentlyReopenedItems,
      completionPercent:
        readiness?.completionPercent ??
        (totalItems > 0 ? roundMetric((readyItems / totalItems) * 100, 1) : 0),
      avgApprovalSlaHours:
        approvalSlaHours.length > 0
          ? roundMetric(
              approvalSlaHours.reduce((total, value) => total + Number(value || 0), 0) /
                approvalSlaHours.length,
              2,
            )
          : null,
      bottleneckStep: buildBottleneckStep(worklistRows),
    },
    entityHeatmap: {
      total: entityHeatmapRows.length,
      rows: entityHeatmapRows,
    },
    consolidationScenarios,
  };
}

/**
 * Persist the latest PR-09 KPI summary and entity heatmap rows so the cockpit
 * retains a management snapshot even though the dashboard is derived live.
 */
export async function syncCloseCycleKpiSnapshots(
  {
    cycle,
    kpiSnapshot,
  },
  actorCtx = {},
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const closeCycleId = parsePositiveInt(cycle?.id);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!closeCycleId) {
    throw badRequest("cycle is required");
  }
  if (!kpiSnapshot?.summary) {
    throw badRequest("kpiSnapshot is required");
  }

  const summaryPayload = {
    capturedAt: kpiSnapshot.capturedAt || null,
    totalItems: Number(kpiSnapshot.summary.totalItems || 0),
    readyItems: Number(kpiSnapshot.summary.readyItems || 0),
    blockedItems: Number(kpiSnapshot.summary.blockedItems || 0),
    dueSoonCount: Number(kpiSnapshot.summary.dueSoonCount || 0),
    reopenEventsTotal: Number(
      kpiSnapshot.summary.reopenEventsTotal ?? kpiSnapshot.summary.reopenCount ?? 0
    ),
    itemsReopenedAtLeastOnce: Number(kpiSnapshot.summary.itemsReopenedAtLeastOnce || 0),
    currentlyReopenedItems: Number(kpiSnapshot.summary.currentlyReopenedItems || 0),
    consolidationScenarios: kpiSnapshot.consolidationScenarios || {
      totalRuns: 0,
      byScenario: [],
    },
  };

  await runQuery(
    `INSERT INTO close_kpi_snapshots (
        tenant_id,
        close_cycle_id,
        snapshot_kind,
        snapshot_key,
        scope_legal_entity_id,
        completion_percent,
        overdue_count,
        stale_count,
        reopen_count,
        avg_approval_sla_hours,
        bottleneck_step,
        payload_json,
        captured_at
     )
     VALUES (?, ?, 'CYCLE_SUMMARY', 'SUMMARY', NULL, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       completion_percent = VALUES(completion_percent),
       overdue_count = VALUES(overdue_count),
       stale_count = VALUES(stale_count),
       reopen_count = VALUES(reopen_count),
       avg_approval_sla_hours = VALUES(avg_approval_sla_hours),
       bottleneck_step = VALUES(bottleneck_step),
       payload_json = VALUES(payload_json),
       captured_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      closeCycleId,
      Number(kpiSnapshot.summary.completionPercent || 0),
      Number(kpiSnapshot.summary.overdueCount || 0),
      Number(kpiSnapshot.summary.staleCount || 0),
      Number(kpiSnapshot.summary.reopenEventsTotal ?? kpiSnapshot.summary.reopenCount ?? 0),
      kpiSnapshot.summary.avgApprovalSlaHours === null
        ? null
        : Number(kpiSnapshot.summary.avgApprovalSlaHours || 0),
      kpiSnapshot.summary.bottleneckStep || null,
      safeJsonStringify(summaryPayload),
    ],
  );

  const heatmapRows = Array.isArray(kpiSnapshot.entityHeatmap?.rows)
    ? kpiSnapshot.entityHeatmap.rows
    : [];
  const activeSnapshotKeys = [];

  for (const row of heatmapRows) {
    const legalEntityId = parsePositiveInt(row?.legalEntityId);
    const snapshotKey = String(row?.snapshotKey || "").trim();
    if (!legalEntityId || !snapshotKey) {
      // Persist only rows with a stable entity identity.
      // eslint-disable-next-line no-continue
      continue;
    }
    activeSnapshotKeys.push(snapshotKey);
    await runQuery(
      `INSERT INTO close_kpi_snapshots (
          tenant_id,
          close_cycle_id,
          snapshot_kind,
          snapshot_key,
          scope_legal_entity_id,
          completion_percent,
          overdue_count,
          stale_count,
          reopen_count,
          avg_approval_sla_hours,
          bottleneck_step,
          payload_json,
          captured_at
       )
       VALUES (?, ?, 'ENTITY_READINESS_HEATMAP', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         completion_percent = VALUES(completion_percent),
         overdue_count = VALUES(overdue_count),
         stale_count = VALUES(stale_count),
         reopen_count = VALUES(reopen_count),
         payload_json = VALUES(payload_json),
         captured_at = CURRENT_TIMESTAMP`,
      [
        tenantId,
        closeCycleId,
        snapshotKey,
        legalEntityId,
        Number(row.completionPercent || 0),
        Number(row.overdueItems || 0),
        Number(row.staleItems || 0),
        Number(row.reopenEventsTotal ?? row.reopenCount ?? 0),
        safeJsonStringify({
          legalEntityLabel: row.legalEntityLabel || null,
          totalItems: Number(row.totalItems || 0),
          readyItems: Number(row.readyItems || 0),
          blockedItems: Number(row.blockedItems || 0),
          overdueItems: Number(row.overdueItems || 0),
          staleItems: Number(row.staleItems || 0),
          reopenEventsTotal: Number(row.reopenEventsTotal ?? row.reopenCount ?? 0),
          itemsReopenedAtLeastOnce: Number(row.itemsReopenedAtLeastOnce || 0),
          currentlyReopenedItems: Number(row.currentlyReopenedItems || 0),
          reopenCount: Number(row.reopenEventsTotal ?? row.reopenCount ?? 0),
          attentionItems: Number(row.attentionItems || 0),
        }),
      ],
    );
  }

  if (activeSnapshotKeys.length > 0) {
    await runQuery(
      `DELETE FROM close_kpi_snapshots
       WHERE tenant_id = ?
         AND close_cycle_id = ?
         AND snapshot_kind = 'ENTITY_READINESS_HEATMAP'
         AND snapshot_key NOT IN (${buildIdPlaceholders(activeSnapshotKeys)})`,
      [tenantId, closeCycleId, ...activeSnapshotKeys],
    );
  } else {
    await runQuery(
      `DELETE FROM close_kpi_snapshots
       WHERE tenant_id = ?
         AND close_cycle_id = ?
         AND snapshot_kind = 'ENTITY_READINESS_HEATMAP'`,
      [tenantId, closeCycleId],
    );
  }

  return {
    summaryRowsSynced: 1,
    heatmapRowsSynced: activeSnapshotKeys.length,
  };
}

export default {
  buildCloseCycleKpiSnapshot,
  syncCloseCycleKpiSnapshots,
};
