import {
  isWorkflowPackageAssignmentRoleCode,
} from "./roleCatalog.js";

function normalizeArray(value) {
  return Array.isArray(value) ? value : null;
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function formatDateTime(value, language) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(language === "tr" ? "tr-TR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function countActiveUsers(users) {
  if (!users) {
    return null;
  }
  return users.filter((row) => normalizeStatus(row?.status) === "ACTIVE").length;
}

function countDirectRuntimeAssignments(assignments) {
  if (!assignments) {
    return null;
  }

  return assignments.filter((row) => {
    const roleCode = row?.role_code || row?.roleCode;
    return roleCode && !isWorkflowPackageAssignmentRoleCode(roleCode);
  }).length;
}

function countWorkflowPackageAssignments(assignments) {
  if (!assignments) {
    return null;
  }

  return assignments.filter((row) =>
    isWorkflowPackageAssignmentRoleCode(row?.role_code || row?.roleCode)
  ).length;
}

function countMixedAssignmentUsers(assignments) {
  if (!assignments) {
    return null;
  }

  const userFlags = new Map();
  for (const row of assignments) {
    const userId = parsePositiveInt(row?.user_id ?? row?.userId);
    if (!userId) {
      continue;
    }

    const roleCode = row?.role_code || row?.roleCode;
    if (!roleCode) {
      continue;
    }

    const current = userFlags.get(userId) || { direct: false, workflowPackage: false };
    if (isWorkflowPackageAssignmentRoleCode(roleCode)) {
      current.workflowPackage = true;
    } else {
      current.direct = true;
    }
    userFlags.set(userId, current);
  }

  return Array.from(userFlags.values()).filter(
    (entry) => entry.direct && entry.workflowPackage
  ).length;
}

function countActiveDelegations(delegations) {
  if (!delegations) {
    return null;
  }

  return delegations.filter((row) => {
    const state = normalizeStatus(row?.state);
    return state === "ACTIVE" || state === "UPCOMING";
  }).length;
}

function countOpenCoverageRows(coverageRows) {
  if (!coverageRows) {
    return null;
  }

  return coverageRows.filter((row) => {
    if (row?.isRejected) {
      return false;
    }
    const state = normalizeStatus(row?.state);
    return state !== "REVOKED" && state !== "EXPIRED";
  }).length;
}

function countRows(rows) {
  return rows ? rows.length : null;
}

function buildRecentAuditSignal(auditRows, l, language) {
  const latestRow = Array.isArray(auditRows) && auditRows.length > 0 ? auditRows[0] : null;
  if (!latestRow) {
    return null;
  }

  const actorLabel =
    latestRow?.actor_user_name ||
    latestRow?.target_user_name ||
    latestRow?.resource_id ||
    latestRow?.resource_type ||
    l("Unknown actor", "Bilinmeyen aktor");
  const actionLabel = String(latestRow?.action || latestRow?.resource_type || "")
    .trim()
    .replaceAll(".", " ");
  const timestampLabel = formatDateTime(latestRow?.created_at, language);

  return {
    key: "recent-audit-signal",
    tone: "sky",
    title: l("Recent audit signal", "Guncel denetim sinyali"),
    description: l(
      "{{action}} touched {{actor}} on {{timestamp}}.",
      "{{action}}, {{actor}} kaydina {{timestamp}} zamaninda dokundu.",
      {
        action: actionLabel || l("A recent event", "Guncel bir olay"),
        actor: actorLabel,
        timestamp: timestampLabel || l("an unknown time", "bilinmeyen bir zaman"),
      }
    ),
  };
}

/**
 * Builds the landing-page security overview snapshot from currently reachable
 * frontend datasets so the new security-admin home can stay API-reuse-first.
 */
export function buildSecurityAdminOverviewSummary({
  assignments,
  auditRows,
  coverageRows,
  delegations,
  l,
  language,
  workflowAssignments,
  workflowDefinitions,
  users,
}) {
  const normalizedUsers = normalizeArray(users);
  const normalizedAssignments = normalizeArray(assignments);
  const normalizedDelegations = normalizeArray(delegations);
  const normalizedCoverageRows = normalizeArray(coverageRows);
  const normalizedWorkflowDefinitions = normalizeArray(workflowDefinitions);
  const normalizedWorkflowAssignments = normalizeArray(workflowAssignments);
  const normalizedAuditRows = normalizeArray(auditRows);

  const metrics = {
    activeUsers: countActiveUsers(normalizedUsers),
    directAssignments: countDirectRuntimeAssignments(normalizedAssignments),
    workflowPackageAssignments: countWorkflowPackageAssignments(normalizedAssignments),
    activeDelegations: countActiveDelegations(normalizedDelegations),
    openCoverageRows: countOpenCoverageRows(normalizedCoverageRows),
    workflowDefinitions: countRows(normalizedWorkflowDefinitions),
    workflowAssignments: countRows(normalizedWorkflowAssignments),
    mixedAssignmentUsers: countMixedAssignmentUsers(normalizedAssignments),
  };

  const signals = [];

  if (
    metrics.workflowDefinitions !== null &&
    metrics.workflowAssignments !== null &&
    metrics.workflowDefinitions > 0 &&
    metrics.workflowAssignments === 0
  ) {
    signals.push({
      key: "workflow-coverage-gap",
      tone: "amber",
      title: l(
        "Workflow definitions are not assigned",
        "Workflow tanimlari henuz atanmamis"
      ),
      description: l(
        "{{count}} workflow definitions are visible, but no workflow assignments are active yet.",
        "{{count}} workflow tanimi gorunuyor, ancak henuz etkin workflow atamasi yok.",
        { count: metrics.workflowDefinitions }
      ),
    });
  }

  if (
    metrics.workflowDefinitions !== null &&
    metrics.workflowAssignments !== null &&
    metrics.workflowDefinitions === 0 &&
    metrics.workflowAssignments > 0
  ) {
    signals.push({
      key: "workflow-definition-gap",
      tone: "rose",
      title: l(
        "Workflow assignments need review",
        "Workflow atamalari gozden gecirilmeli"
      ),
      description: l(
        "{{count}} workflow assignments exist without visible workflow definitions in this snapshot.",
        "Bu gorunumde gorunur workflow tanimi olmadan {{count}} workflow atamasi bulunuyor.",
        { count: metrics.workflowAssignments }
      ),
    });
  }

  if (metrics.mixedAssignmentUsers !== null && metrics.mixedAssignmentUsers > 0) {
    signals.push({
      key: "mixed-assignment-posture",
      tone: "amber",
      title: l(
        "Mixed access posture detected",
        "Karisik erisim durusu tespit edildi"
      ),
      description: l(
        "{{count}} users currently hold both direct runtime roles and workflow package assignments.",
        "{{count}} kullanicida hem dogrudan runtime rol hem de workflow paket atamasi bulunuyor.",
        { count: metrics.mixedAssignmentUsers }
      ),
    });
  }

  const recentAuditSignal = buildRecentAuditSignal(normalizedAuditRows, l, language);
  if (recentAuditSignal) {
    signals.push(recentAuditSignal);
  }

  if (signals.length === 0) {
    signals.push({
      key: "stable-snapshot",
      tone: "emerald",
      title: l(
        "No urgent signals in the current snapshot",
        "Mevcut gorunumde acil sinyal yok"
      ),
      description: l(
        "Use the workbenches for deeper scope-level reviews, edits, and evidence trails.",
        "Daha derin kapsam incelemeleri, duzenlemeler ve kanit izleri icin workbenchleri kullanin."
      ),
    });
  }

  return {
    metrics,
    signals,
  };
}
