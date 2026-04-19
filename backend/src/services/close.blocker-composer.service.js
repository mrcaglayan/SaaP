function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeSeverityFromLegacyLevel(level) {
  const normalizedLevel = toUpperText(level);
  if (normalizedLevel === "WARNING") {
    return "MEDIUM";
  }
  return "HIGH";
}

function normalizeLegacyBlocker(blocker = {}) {
  const code = String(blocker?.code || "").trim().toUpperCase() || null;
  const message = String(blocker?.message || "").trim() || null;
  if (!code && !message) {
    return null;
  }

  return {
    code: code || "CLOSE_BLOCKER",
    message: message || "Close blocker is present",
    severity: normalizeSeverityFromLegacyLevel(blocker?.level),
    blockingItemType: null,
    blockingItemId: null,
    blockingAction: null,
    owner: null,
    dueDate: null,
    firstBlockedAt: null,
    drillPath:
      String(blocker?.drillPath || blocker?.drill?.path || "").trim() || null,
  };
}

function buildBlockerDedupeKey(blocker = {}) {
  return [
    String(blocker?.code || "").trim().toUpperCase(),
    String(blocker?.blockingItemType || "").trim().toUpperCase(),
    Number(blocker?.blockingItemId || 0) || 0,
    String(blocker?.blockingAction || "").trim().toUpperCase(),
    String(blocker?.drillPath || "").trim(),
  ].join("|");
}

function normalizeIncomingBlocker(blocker = {}) {
  if (
    blocker &&
    typeof blocker === "object" &&
    Object.prototype.hasOwnProperty.call(blocker, "severity") &&
    Object.prototype.hasOwnProperty.call(blocker, "blockingAction")
  ) {
    return {
      code: String(blocker.code || "").trim().toUpperCase() || "CLOSE_BLOCKER",
      message: String(blocker.message || "").trim() || "Close blocker is present",
      severity: toUpperText(blocker.severity) || "HIGH",
      blockingItemType: blocker.blockingItemType || null,
      blockingItemId: Number(blocker.blockingItemId || 0) || null,
      blockingAction: blocker.blockingAction || null,
      owner: blocker.owner ?? null,
      dueDate: blocker.dueDate || null,
      firstBlockedAt: blocker.firstBlockedAt || null,
      drillPath: String(blocker.drillPath || "").trim() || null,
      ...(blocker.dependency ? { dependency: blocker.dependency } : {}),
    };
  }
  return normalizeLegacyBlocker(blocker);
}

/**
 * Merge legacy review-gate blockers, dependency blockers, and later stale
 * blockers into one standard payload list without duplicate rows.
 */
export function composeCloseBlockers({
  sourceBlockers = [],
  dependencyBlockers = [],
  staleBlockers = [],
} = {}) {
  const mergedRows = [];
  const seenKeys = new Set();

  for (const blocker of [
    ...sourceBlockers,
    ...dependencyBlockers,
    ...staleBlockers,
  ]) {
    const normalizedBlocker = normalizeIncomingBlocker(blocker);
    if (!normalizedBlocker) {
      continue;
    }
    const dedupeKey = buildBlockerDedupeKey(normalizedBlocker);
    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    seenKeys.add(dedupeKey);
    mergedRows.push(normalizedBlocker);
  }

  return mergedRows;
}

export default {
  composeCloseBlockers,
};
