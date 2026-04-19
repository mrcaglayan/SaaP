import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

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

function mapCloseSlaRuleRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    ruleCode: String(row.rule_code || "").trim().toUpperCase() || null,
    targetType: toUpperText(row.target_type),
    itemType: toUpperText(row.item_type || "ANY") || "ANY",
    dueSoonLeadHours: Number(row.due_soon_lead_hours || 0),
    overdueGraceHours: Number(row.overdue_grace_hours || 0),
    // Reserved for later stale-state policy; current Step 65 SLA evaluation
    // does not transition stale status from this threshold yet.
    staleGraceHours: Number(row.stale_grace_hours || 0),
    escalateAfterHours: Number(row.escalate_after_hours || 0),
    isActive: Boolean(Number(row.is_active || 0)),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function buildRuleCatalog(rows = []) {
  const catalog = new Map();
  for (const row of rows) {
    const catalogKey = `${row.targetType}:${row.itemType}`;
    if (!catalog.has(catalogKey)) {
      catalog.set(catalogKey, row);
    }
  }
  return catalog;
}

function resolveCatalogRule(catalog, targetType, itemType = "ANY") {
  const exactKey = `${toUpperText(targetType)}:${toUpperText(itemType || "ANY")}`;
  if (catalog.has(exactKey)) {
    return catalog.get(exactKey);
  }
  const fallbackKey = `${toUpperText(targetType)}:ANY`;
  return catalog.get(fallbackKey) || null;
}

function parseDueDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundHours(value) {
  return Number(Number(value || 0).toFixed(1));
}

function evaluateDueState({
  dueAt,
  ready = false,
  rule = null,
  nowDate = new Date(),
}) {
  const dueDate = parseDueDate(dueAt);
  if (ready) {
    return {
      dueState: "READY",
      severity: "LOW",
      dueAt: dueAt || null,
      remainingHours: null,
      overdueHours: null,
      dueSoonLeadHours: Number(rule?.dueSoonLeadHours || 0),
      overdueGraceHours: Number(rule?.overdueGraceHours || 0),
      escalateAfterHours: Number(rule?.escalateAfterHours || 0),
    };
  }

  if (!dueDate) {
    return {
      dueState: "NO_DUE_DATE",
      severity: "LOW",
      dueAt: dueAt || null,
      remainingHours: null,
      overdueHours: null,
      dueSoonLeadHours: Number(rule?.dueSoonLeadHours || 0),
      overdueGraceHours: Number(rule?.overdueGraceHours || 0),
      escalateAfterHours: Number(rule?.escalateAfterHours || 0),
    };
  }

  const diffHours = roundHours((dueDate.getTime() - nowDate.getTime()) / 3600000);
  const overdueHours = diffHours < 0 ? Math.abs(diffHours) : 0;
  const dueSoonLeadHours = Number(rule?.dueSoonLeadHours || 0);
  const overdueGraceHours = Number(rule?.overdueGraceHours || 0);
  const escalateAfterHours = Number(rule?.escalateAfterHours || 0);

  if (diffHours < 0 && overdueHours > overdueGraceHours) {
    return {
      dueState: "OVERDUE",
      severity: overdueHours >= escalateAfterHours && escalateAfterHours > 0 ? "CRITICAL" : "HIGH",
      dueAt: dueAt || null,
      remainingHours: 0,
      overdueHours,
      dueSoonLeadHours,
      overdueGraceHours,
      escalateAfterHours,
    };
  }

  if (diffHours <= dueSoonLeadHours) {
    return {
      dueState: "DUE_SOON",
      severity: diffHours <= Math.min(12, dueSoonLeadHours || 12) ? "HIGH" : "MEDIUM",
      dueAt: dueAt || null,
      remainingHours: Math.max(diffHours, 0),
      overdueHours: 0,
      dueSoonLeadHours,
      overdueGraceHours,
      escalateAfterHours,
    };
  }

  return {
    dueState: "ON_TRACK",
    severity: "LOW",
    dueAt: dueAt || null,
    remainingHours: Math.max(diffHours, 0),
    overdueHours: 0,
    dueSoonLeadHours,
    overdueGraceHours,
    escalateAfterHours,
  };
}

/**
 * Read the active PR-05 close SLA rules for one tenant while preferring
 * tenant-specific overrides over the shipped global defaults.
 */
export async function listCloseSlaRules(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const result = await runQuery(
    `SELECT *
     FROM close_sla_rules
     WHERE is_active = 1
       AND (tenant_id IS NULL OR tenant_id = ?)
     ORDER BY
       CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
       target_type,
       item_type,
       rule_code`,
    [tenantId, tenantId]
  );

  const mergedRows = [];
  const seenRuleCodes = new Set();
  for (const row of result.rows || []) {
    const mappedRow = mapCloseSlaRuleRow(row);
    const ruleCode = mappedRow?.ruleCode || "";
    if (!ruleCode || seenRuleCodes.has(ruleCode)) {
      continue;
    }
    seenRuleCodes.add(ruleCode);
    mergedRows.push(mappedRow);
  }

  let filteredRows = mergedRows;
  if (filters?.targetType) {
    filteredRows = filteredRows.filter(
      (row) => row.targetType === toUpperText(filters.targetType)
    );
  }
  if (filters?.itemType) {
    filteredRows = filteredRows.filter(
      (row) => row.itemType === toUpperText(filters.itemType)
    );
  }

  return {
    rows: filteredRows,
  };
}

/**
 * Build the live PR-05 SLA snapshot for one close cycle so the cockpit can
 * show due-soon and overdue states without needing a background scheduler.
 * `escalate_after_hours` affects live overdue severity only, while
 * `stale_grace_hours` remains cataloged for later stale-policy work.
 */
export async function buildCloseCycleSlaSnapshot(
  {
    cycle,
    worklistRows = [],
    now = new Date(),
  },
  actorCtx = {}
) {
  if (!cycle?.id) {
    throw badRequest("cycle is required");
  }

  const ruleResult = await listCloseSlaRules({}, actorCtx);
  const catalog = buildRuleCatalog(ruleResult.rows || []);
  const cycleRule = resolveCatalogRule(catalog, "CYCLE", "ANY");
  const itemStates = worklistRows.map((row) => {
    const itemRule = resolveCatalogRule(catalog, "ITEM", row?.itemType || "ANY");
    return {
      closeCycleItemId: parsePositiveInt(row?.id),
      itemType: toUpperText(row?.itemType),
      ...evaluateDueState({
        dueAt: row?.dueAt || cycle?.dueAt || null,
        ready: Boolean(row?.ready),
        rule: itemRule,
        nowDate: now instanceof Date ? now : new Date(now),
      }),
    };
  });

  const cycleReady = worklistRows.length > 0 && worklistRows.every((row) => row.ready);
  const cycleState = evaluateDueState({
    dueAt: cycle?.dueAt || null,
    ready: cycleReady,
    rule: cycleRule,
    nowDate: now instanceof Date ? now : new Date(now),
  });

  return {
    ruleCount: (ruleResult.rows || []).length,
    cycle: {
      closeCycleId: parsePositiveInt(cycle?.id),
      ...cycleState,
    },
    items: itemStates,
    summary: {
      totalItems: worklistRows.length,
      readyItems: itemStates.filter((row) => row.dueState === "READY").length,
      onTrackItems: itemStates.filter((row) => row.dueState === "ON_TRACK").length,
      dueSoonItems: itemStates.filter((row) => row.dueState === "DUE_SOON").length,
      overdueItems: itemStates.filter((row) => row.dueState === "OVERDUE").length,
      noDueDateItems: itemStates.filter((row) => row.dueState === "NO_DUE_DATE").length,
      cycleDueState: cycleState.dueState,
      cycleSeverity: cycleState.severity,
    },
  };
}

export default {
  listCloseSlaRules,
  buildCloseCycleSlaSnapshot,
};
