import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function severityWeight(severity) {
  const normalized = toUpperText(severity);
  if (normalized === "CRITICAL") {
    return 4;
  }
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

function sortCloseAlertRows(rows = []) {
  return [...rows].sort((left, right) => {
    const severityDelta = severityWeight(right?.severity) - severityWeight(left?.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const dueDateLeft = left?.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const dueDateRight = right?.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (dueDateLeft !== dueDateRight) {
      return dueDateLeft - dueDateRight;
    }

    return String(left?.alertKey || "").localeCompare(String(right?.alertKey || ""));
  });
}

function formatHours(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(Number(value).toFixed(1));
}

function buildAlertRow(input = {}) {
  return {
    alertKey: String(input.alertKey || "").trim(),
    alertCode: String(input.alertCode || "").trim().toUpperCase() || "CLOSE_ALERT",
    alertType: toUpperText(input.alertType),
    severity: toUpperText(input.severity) || "MEDIUM",
    title: String(input.title || "").trim() || "Close alert",
    message: String(input.message || "").trim() || "Close alert is active",
    closeCycleId: parsePositiveInt(input.closeCycleId),
    closeCycleItemId: parsePositiveInt(input.closeCycleItemId),
    itemType: input.itemType || null,
    itemKey: input.itemKey || null,
    owner: input.owner || null,
    dueDate: input.dueDate || null,
    firstTriggeredAt: input.firstTriggeredAt || null,
    drillPath: input.drillPath || null,
    sourceKind: input.sourceKind || "ITEM",
    payload: input.payload ?? null,
  };
}

function buildDueAlertMessage(item, slaState) {
  if (slaState?.dueState === "OVERDUE") {
    return `${item.scopeLabel || item.itemKey || "Close item"} is overdue by ${
      formatHours(slaState?.overdueHours) ?? 0
    } hours.`;
  }
  return `${item.scopeLabel || item.itemKey || "Close item"} is due in ${
    formatHours(slaState?.remainingHours) ?? 0
  } hours.`;
}

function buildStaleAlertMessage(item, staleEvent) {
  const staleStatus = toUpperText(item?.staleStatus);
  if (staleStatus === "FINALIZED_BUT_OUTDATED") {
    return "Finalized output is outdated because an upstream official step changed.";
  }
  if (staleStatus === "STALE_REVIEW_REQUIRED") {
    return "Downstream work requires renewed review because an upstream official step changed.";
  }
  const sourceTargetType = staleEvent?.sourceTargetType ? ` ${staleEvent.sourceTargetType}` : "";
  return `This close item is stale after a${sourceTargetType} change.`;
}

function buildBlockedAlertMessage(item, primaryBlocker) {
  if (!primaryBlocker) {
    return `${item.scopeLabel || item.itemKey || "Close item"} is blocked.`;
  }
  return primaryBlocker.message || `${item.scopeLabel || item.itemKey || "Close item"} is blocked.`;
}

function buildPanel(rows = []) {
  return {
    total: rows.length,
    rows,
  };
}

/**
 * Build the live PR-05 close alert snapshot from due-state, blocker, and
 * stale visibility inputs. Step 65 keeps this as read-time visibility only;
 * durable scheduler-backed escalation remains future work.
 */
export async function buildCloseCycleAlertSnapshot(
  {
    cycle,
    worklistRows = [],
    slaSnapshot = null,
    latestStaleEventsByItemId = new Map(),
  } = {},
  _actorCtx = {}
) {
  if (!cycle?.id) {
    throw badRequest("cycle is required");
  }

  const slaByItemId = new Map(
    (slaSnapshot?.items || []).map((row) => [parsePositiveInt(row.closeCycleItemId), row])
  );
  const rows = [];

  const cycleSla = slaSnapshot?.cycle || null;
  if (cycleSla?.dueState === "DUE_SOON" || cycleSla?.dueState === "OVERDUE") {
    rows.push(
      buildAlertRow({
        alertKey: `CYCLE:${cycle.id}:${cycleSla.dueState}`,
        alertCode:
          cycleSla.dueState === "OVERDUE" ? "CLOSE_CYCLE_OVERDUE" : "CLOSE_CYCLE_DUE_SOON",
        alertType: cycleSla.dueState === "OVERDUE" ? "OVERDUE" : "DUE_SOON",
        severity: cycleSla.severity,
        title:
          cycleSla.dueState === "OVERDUE" ? "Close cycle overdue" : "Close cycle due soon",
        message:
          cycleSla.dueState === "OVERDUE"
            ? `The close cycle due date passed ${formatHours(cycleSla.overdueHours) ?? 0} hours ago.`
            : `The close cycle due date is within ${formatHours(cycleSla.remainingHours) ?? 0} hours.`,
        closeCycleId: cycle.id,
        dueDate: cycleSla.dueAt || cycle?.dueAt || null,
        firstTriggeredAt: cycle?.updatedAt || cycle?.createdAt || null,
        sourceKind: "CYCLE",
      })
    );
  }

  for (const item of worklistRows) {
    const itemId = parsePositiveInt(item?.id);
    const slaState = slaByItemId.get(itemId) || null;
    const latestStaleEvent = latestStaleEventsByItemId.get(itemId) || null;
    const primaryBlocker = Array.isArray(item?.blockers) && item.blockers.length > 0 ? item.blockers[0] : null;

    if (slaState?.dueState === "DUE_SOON" || slaState?.dueState === "OVERDUE") {
      rows.push(
        buildAlertRow({
          alertKey: `ITEM:${itemId}:${slaState.dueState}`,
          alertCode:
            slaState.dueState === "OVERDUE" ? "CLOSE_ITEM_OVERDUE" : "CLOSE_ITEM_DUE_SOON",
          alertType: slaState.dueState === "OVERDUE" ? "OVERDUE" : "DUE_SOON",
          severity: slaState.severity,
          title:
            slaState.dueState === "OVERDUE"
              ? "Close work item overdue"
              : "Close work item due soon",
          message: buildDueAlertMessage(item, slaState),
          closeCycleId: cycle.id,
          closeCycleItemId: itemId,
          itemType: item?.itemType || null,
          itemKey: item?.itemKey || null,
          owner: parsePositiveInt(item?.ownerUserId) ? { userId: parsePositiveInt(item.ownerUserId) } : null,
          dueDate: item?.dueAt || cycle?.dueAt || null,
          firstTriggeredAt:
            slaState?.dueState === "OVERDUE" ? item?.dueAt || cycle?.dueAt || null : cycle?.updatedAt || null,
          drillPath: item?.drillPath || null,
          payload: {
            dueState: slaState.dueState,
            remainingHours: slaState.remainingHours,
            overdueHours: slaState.overdueHours,
          },
        })
      );
    }

    if (primaryBlocker) {
      rows.push(
        buildAlertRow({
          alertKey: `ITEM:${itemId}:BLOCKED`,
          alertCode: "CLOSE_ITEM_BLOCKED",
          alertType: "BLOCKED",
          severity: primaryBlocker?.severity || "HIGH",
          title: "Close work item blocked",
          message: buildBlockedAlertMessage(item, primaryBlocker),
          closeCycleId: cycle.id,
          closeCycleItemId: itemId,
          itemType: item?.itemType || null,
          itemKey: item?.itemKey || null,
          owner:
            primaryBlocker?.owner ||
            (parsePositiveInt(item?.ownerUserId) ? { userId: parsePositiveInt(item.ownerUserId) } : null),
          dueDate: primaryBlocker?.dueDate || item?.dueAt || cycle?.dueAt || null,
          firstTriggeredAt: primaryBlocker?.firstBlockedAt || null,
          drillPath: primaryBlocker?.drillPath || item?.drillPath || null,
          payload: {
            blockerCode: primaryBlocker?.code || null,
            blockingAction: primaryBlocker?.blockingAction || null,
            blockerCount: item?.blockerCount || 0,
          },
        })
      );
    }

    if (toUpperText(item?.staleStatus) !== "FRESH") {
      rows.push(
        buildAlertRow({
          alertKey: `ITEM:${itemId}:STALE`,
          alertCode: "CLOSE_ITEM_STALE",
          alertType: "STALE",
          severity:
            toUpperText(item?.staleStatus) === "FINALIZED_BUT_OUTDATED" ? "HIGH" : "MEDIUM",
          title: "Close work item stale",
          message: buildStaleAlertMessage(item, latestStaleEvent),
          closeCycleId: cycle.id,
          closeCycleItemId: itemId,
          itemType: item?.itemType || null,
          itemKey: item?.itemKey || null,
          owner: parsePositiveInt(item?.ownerUserId) ? { userId: parsePositiveInt(item.ownerUserId) } : null,
          dueDate: item?.dueAt || cycle?.dueAt || null,
          firstTriggeredAt: latestStaleEvent?.createdAt || null,
          drillPath: item?.drillPath || null,
          payload: {
            staleStatus: item?.staleStatus || null,
            latestEventCode: latestStaleEvent?.eventCode || null,
            sourceTargetType: latestStaleEvent?.sourceTargetType || null,
          },
        })
      );
    }
  }

  const sortedRows = sortCloseAlertRows(rows);
  const counts = {
    total: sortedRows.length,
    critical: sortedRows.filter((row) => row.severity === "CRITICAL").length,
    high: sortedRows.filter((row) => row.severity === "HIGH").length,
    medium: sortedRows.filter((row) => row.severity === "MEDIUM").length,
    low: sortedRows.filter((row) => row.severity === "LOW").length,
    dueSoon: sortedRows.filter((row) => row.alertType === "DUE_SOON").length,
    overdue: sortedRows.filter((row) => row.alertType === "OVERDUE").length,
    blocked: sortedRows.filter((row) => row.alertType === "BLOCKED").length,
    stale: sortedRows.filter((row) => row.alertType === "STALE").length,
  };

  return {
    rows: sortedRows,
    counts,
    panels: {
      overdue: buildPanel(sortedRows.filter((row) => row.alertType === "OVERDUE")),
      dueSoon: buildPanel(sortedRows.filter((row) => row.alertType === "DUE_SOON")),
      blocked: buildPanel(sortedRows.filter((row) => row.alertType === "BLOCKED")),
      stale: buildPanel(sortedRows.filter((row) => row.alertType === "STALE")),
    },
  };
}

export default {
  buildCloseCycleAlertSnapshot,
};
