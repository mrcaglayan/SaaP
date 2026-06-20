import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  checkUserHasPermissionAtScope,
  findUsersWithPermissionAtScope,
  getUserRoleScopeEffectiveDateGuard,
} from "./authz.scope.service.js";
import { getConsolidationRunReviewGate } from "./consolidation.review-gate.service.js";
import { listCycleItems } from "./close.cycle-items.service.js";
import { OFFICIAL_CONSOLIDATION_RUN_NAME } from "./close.cycles.shared.js";
import {
  SECURITY_ADMIN_ROLE_CODE,
  SYSTEM_ADMIN_ROLE_CODE,
} from "./systemRoles.service.js";

const STATUS_WAITING_FOR_ENTITY_CLOSE = "WAITING_FOR_ENTITY_CLOSE";
const STATUS_READY_TO_START = "READY_TO_START";
const STATUS_IN_PROGRESS = "IN_PROGRESS";
const STATUS_READY_TO_FINALIZE = "READY_TO_FINALIZE";
const STATUS_LOCKED = "LOCKED";

const PERMISSION_START = "consolidation.run.create";
const PERMISSION_OPEN = "consolidation.run.read";
const PERMISSION_FINALIZE = "consolidation.run.finalize";

const OWNER_ROLE_HINT_GROUP_CONTROLLER = "GroupReportingController";
const OWNER_ROLE_HINT_CONSOLIDATION_PREPARER = "ConsolidationRunPreparer";
const OWNER_ROLE_HINT_START_PERMISSION = "consolidation.run.create";
const OWNER_ROLE_HINT_ADMIN = "Tenant/System admin";
const OWNER_PRIMARY_ROLE_CODES = Object.freeze([
  OWNER_ROLE_HINT_GROUP_CONTROLLER,
  OWNER_ROLE_HINT_CONSOLIDATION_PREPARER,
]);
const OWNER_ADMIN_ROLE_CODES = Object.freeze([
  SECURITY_ADMIN_ROLE_CODE,
  SYSTEM_ADMIN_ROLE_CODE,
]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

async function defaultPermissionChecker({
  userId,
  tenantId,
  permissionCode,
  scopeType,
  scopeId,
  runQuery,
}) {
  return checkUserHasPermissionAtScope(
    userId,
    tenantId,
    permissionCode,
    scopeType,
    scopeId,
    { runQuery },
  );
}

async function listUsersWithRoleAtScope({
  tenantId,
  roleCode,
  scopeType,
  scopeId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedScopeId = parsePositiveInt(scopeId);
  const normalizedRoleCode = String(roleCode || "").trim();
  const normalizedScopeType = toUpperText(scopeType);
  if (!normalizedTenantId || !normalizedScopeId || !normalizedRoleCode || !normalizedScopeType) {
    return [];
  }

  const effectiveGuard = await getUserRoleScopeEffectiveDateGuard(runQuery);
  const result = await runQuery(
    `SELECT DISTINCT urs.user_id
       FROM user_role_scopes urs
       JOIN roles r
         ON r.id = urs.role_id
        AND r.tenant_id = urs.tenant_id
      WHERE urs.tenant_id = ?
        AND urs.scope_type = ?
        AND urs.scope_id = ?
        AND urs.effect = 'ALLOW'
        AND r.code = ?${effectiveGuard.sql}
      ORDER BY urs.user_id ASC`,
    [
      normalizedTenantId,
      normalizedScopeType,
      normalizedScopeId,
      normalizedRoleCode,
      ...effectiveGuard.params,
    ],
  );
  return (result.rows || [])
    .map((row) => parsePositiveInt(row?.user_id))
    .filter(Boolean);
}

async function listUsersWithPermissionAtScope({
  tenantId,
  permissionCode,
  scopeType,
  scopeId,
  runQuery = query,
}) {
  return findUsersWithPermissionAtScope(
    tenantId,
    permissionCode,
    scopeType,
    scopeId,
    { runQuery },
  );
}

/**
 * Resolve the suggested operational owner for the ready-to-start consolidation
 * signal using the PR-R2C-06 priority order: explicit group controller,
 * consolidation preparer, start-permission holder, then tenant/system admin.
 */
export async function resolveConsolidationReadinessOwner({
  tenantId,
  groupCompanyId,
  runQuery = query,
}) {
  const normalizedGroupCompanyId = parsePositiveInt(groupCompanyId);
  if (!parsePositiveInt(tenantId) || !normalizedGroupCompanyId) {
    return {
      ownerUserId: null,
      ownerRoleHint: OWNER_ROLE_HINT_GROUP_CONTROLLER,
      ownerResolutionSource: "NONE",
    };
  }

  for (const roleCode of OWNER_PRIMARY_ROLE_CODES) {
    // Prefer explicit group-role owners over broad admin or permission grants.
    // This preserves the business owner signal even when admins also hold access.
    // eslint-disable-next-line no-await-in-loop
    const userIds = await listUsersWithRoleAtScope({
      tenantId,
      roleCode,
      scopeType: "GROUP",
      scopeId: normalizedGroupCompanyId,
      runQuery,
    });
    if (userIds.length > 0) {
      return {
        ownerUserId: userIds[0],
        ownerRoleHint: roleCode,
        ownerResolutionSource: "ROLE",
      };
    }
  }

  const startPermissionUsers = await listUsersWithPermissionAtScope({
    tenantId,
    permissionCode: PERMISSION_START,
    scopeType: "GROUP",
    scopeId: normalizedGroupCompanyId,
    runQuery,
  });
  if (startPermissionUsers.length > 0) {
    return {
      ownerUserId: startPermissionUsers[0],
      ownerRoleHint: OWNER_ROLE_HINT_START_PERMISSION,
      ownerResolutionSource: "PERMISSION",
    };
  }

  for (const roleCode of OWNER_ADMIN_ROLE_CODES) {
    // Tenant/system admins are a last-resort operational owner family.
    // eslint-disable-next-line no-await-in-loop
    const userIds = await listUsersWithRoleAtScope({
      tenantId,
      roleCode,
      scopeType: "TENANT",
      scopeId: tenantId,
      runQuery,
    });
    if (userIds.length > 0) {
      return {
        ownerUserId: userIds[0],
        ownerRoleHint: OWNER_ROLE_HINT_ADMIN,
        ownerResolutionSource: "ADMIN",
      };
    }
  }

  return {
    ownerUserId: null,
    ownerRoleHint: OWNER_ROLE_HINT_GROUP_CONTROLLER,
    ownerResolutionSource: "NONE",
  };
}

async function loadGroupCycleContext({ tenantId, cycleId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
       cc.id,
       cc.tenant_id,
       cc.scope_kind,
       cc.fiscal_period_id,
       cc.consolidation_group_id,
       cc.group_company_id AS cycle_group_company_id,
       cc.owner_user_id,
       cc.status AS cycle_status,
       cg.group_company_id AS consolidation_group_company_id,
       cg.presentation_currency_code
     FROM close_cycles cc
     LEFT JOIN consolidation_groups cg
       ON cg.id = cc.consolidation_group_id
      AND cg.tenant_id = cc.tenant_id
     WHERE cc.tenant_id = ?
       AND cc.id = ?
     LIMIT 1`,
    [tenantId, cycleId],
  );
  return result.rows?.[0] || null;
}

async function loadOfficialConsolidationRun({
  tenantId,
  consolidationGroupId,
  fiscalPeriodId,
  runName = OFFICIAL_CONSOLIDATION_RUN_NAME,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       cr.id,
       cr.consolidation_group_id,
       cr.fiscal_period_id,
       cr.run_name,
       cr.status,
       cr.presentation_currency_code,
       cg.group_company_id
     FROM consolidation_runs cr
     JOIN consolidation_groups cg
       ON cg.id = cr.consolidation_group_id
     WHERE cg.tenant_id = ?
       AND cr.consolidation_group_id = ?
       AND cr.fiscal_period_id = ?
       AND cr.run_name = ?
     LIMIT 1`,
    [
      tenantId,
      consolidationGroupId,
      fiscalPeriodId,
      toUpperText(runName),
    ],
  );
  return result.rows?.[0] || null;
}

async function listCycleItemsByType({
  tenantId,
  cycleId,
  itemType,
  runQuery = query,
}) {
  const result = await listCycleItems(
    cycleId,
    { itemType },
    {
      tenantId,
      runQuery,
    },
  );
  return Array.isArray(result?.rows) ? result.rows : [];
}

function buildBlockingReason({ code, message, count = null, itemIds = [] }) {
  return {
    code,
    message,
    ...(count !== null ? { count: Number(count || 0) } : {}),
    ...(itemIds.length > 0 ? { itemIds } : {}),
  };
}

function splitWorkflowBlockers(blockers = []) {
  const workflowBlockers = [];
  const nonWorkflowBlockers = [];
  for (const blocker of blockers || []) {
    if (toUpperText(blocker?.drill?.surface) === "WORKFLOW") {
      workflowBlockers.push(blocker);
    } else {
      nonWorkflowBlockers.push(blocker);
    }
  }
  return { workflowBlockers, nonWorkflowBlockers };
}

function buildNextAction({ status, canStart, canOpenRun, canFinalize }) {
  if (status === STATUS_READY_TO_START) {
    return canStart
      ? {
          code: "START_CONSOLIDATION_RUN",
          label: "Start consolidation run",
          requiredPermissionCode: PERMISSION_START,
        }
      : {
          code: "WAITING_FOR_CONSOLIDATION_PREPARER",
          label: "Ready for consolidation - waiting for consolidation preparer",
          requiredPermissionCode: PERMISSION_START,
        };
  }
  if (status === STATUS_IN_PROGRESS && canOpenRun) {
    return {
      code: "OPEN_CONSOLIDATION_RUN",
      label: "Open consolidation run",
      requiredPermissionCode: PERMISSION_OPEN,
    };
  }
  if (status === STATUS_READY_TO_FINALIZE) {
    if (canFinalize) {
      return {
        code: "FINALIZE_CONSOLIDATION_RUN",
        label: "Finalize consolidation run",
        requiredPermissionCode: PERMISSION_FINALIZE,
      };
    }
    if (canOpenRun) {
      return {
        code: "OPEN_FINALIZATION_REVIEW",
        label: "Open finalization review",
        requiredPermissionCode: PERMISSION_OPEN,
      };
    }
  }
  if (status === STATUS_LOCKED && canOpenRun) {
    return {
      code: "OPEN_CONSOLIDATION_RUN",
      label: "Open consolidation run",
      requiredPermissionCode: PERMISSION_OPEN,
    };
  }
  return null;
}

function buildBasePayload({
  cycle,
  consolidationItem = null,
  officialRun = null,
  permissionState,
  ownerState,
}) {
  const runId = parsePositiveInt(officialRun?.id);
  return {
    applicable: true,
    closeCycleId: parsePositiveInt(cycle?.id),
    closeCycleItemId: parsePositiveInt(consolidationItem?.id),
    consolidationGroupId: parsePositiveInt(cycle?.consolidation_group_id),
    groupCompanyId:
      parsePositiveInt(cycle?.consolidation_group_company_id) ||
      parsePositiveInt(cycle?.cycle_group_company_id),
    fiscalPeriodId: parsePositiveInt(cycle?.fiscal_period_id),
    runId,
    runName: OFFICIAL_CONSOLIDATION_RUN_NAME,
    canStart: false,
    canOpenRun: Boolean(runId && permissionState.userCanOpen),
    canFinalize: false,
    userCanStart: permissionState.userCanStart,
    userCanOpen: permissionState.userCanOpen,
    userCanFinalize: permissionState.userCanFinalize,
    operationalReadyToFinalize: false,
    workflowApproved: false,
    ownerUserId: parsePositiveInt(ownerState?.ownerUserId),
    ownerRoleHint: ownerState?.ownerRoleHint || OWNER_ROLE_HINT_GROUP_CONTROLLER,
    ownerResolutionSource: ownerState?.ownerResolutionSource || "NONE",
    blockingReasons: [],
    nextAction: null,
    source: {
      memberReadinessBlockCount: 0,
      dependencyBlockerCount: 0,
      draftAdjustmentCount: 0,
      draftEliminationCount: 0,
      entryCount: 0,
      workflowGateRequired: false,
      workflowGateApproved: false,
      workflowBlockerCount: 0,
      nonWorkflowBlockerCount: 0,
    },
  };
}

async function resolvePermissionState({
  tenantId,
  userId,
  groupCompanyId,
  runQuery,
  permissionChecker,
}) {
  const normalizedGroupCompanyId = parsePositiveInt(groupCompanyId);
  if (!parsePositiveInt(userId) || !normalizedGroupCompanyId) {
    return {
      userCanStart: false,
      userCanOpen: false,
      userCanFinalize: false,
    };
  }

  const check = (permissionCode) =>
    permissionChecker({
      userId,
      tenantId,
      permissionCode,
      scopeType: "GROUP",
      scopeId: normalizedGroupCompanyId,
      runQuery,
    });

  const [userCanStart, userCanOpen, userCanFinalize] = await Promise.all([
    check(PERMISSION_START),
    check(PERMISSION_OPEN),
    check(PERMISSION_FINALIZE),
  ]);

  return {
    userCanStart: Boolean(userCanStart),
    userCanOpen: Boolean(userCanOpen),
    userCanFinalize: Boolean(userCanFinalize),
  };
}

function buildNoRunStatusPayload({
  basePayload,
  consolidationItem,
  localCloseItems,
}) {
  const blockingReasons = [];

  if (!parsePositiveInt(consolidationItem?.id)) {
    blockingReasons.push(
      buildBlockingReason({
        code: "EXPECTED_CONSOLIDATION_CYCLE_ITEM_MISSING",
        message: "Expected official consolidation run cycle item is missing.",
      }),
    );
  }

  if (localCloseItems.length === 0) {
    blockingReasons.push(
      buildBlockingReason({
        code: "MANDATORY_LOCAL_CLOSE_PACK_MISSING",
        message:
          "At least one mandatory local close pack is required before consolidation can start.",
      }),
    );
  }

  const notLockedItems = localCloseItems.filter(
    (item) => toUpperText(item?.businessStatus) !== "LOCKED",
  );
  if (notLockedItems.length > 0) {
    blockingReasons.push(
      buildBlockingReason({
        code: "MANDATORY_LOCAL_CLOSE_PACK_NOT_LOCKED",
        message:
          "All mandatory local close pack cycle items must be LOCKED before consolidation can start.",
        count: notLockedItems.length,
        itemIds: notLockedItems.map((item) => parsePositiveInt(item?.id)).filter(Boolean),
      }),
    );
  }

  const staleItems = localCloseItems.filter(
    (item) => toUpperText(item?.staleStatus || "FRESH") !== "FRESH",
  );
  if (staleItems.length > 0) {
    blockingReasons.push(
      buildBlockingReason({
        code: "MANDATORY_LOCAL_CLOSE_PACK_STALE",
        message:
          "All mandatory local close pack cycle items must be FRESH before consolidation can start.",
        count: staleItems.length,
        itemIds: staleItems.map((item) => parsePositiveInt(item?.id)).filter(Boolean),
      }),
    );
  }

  const status =
    blockingReasons.length === 0
      ? STATUS_READY_TO_START
      : STATUS_WAITING_FOR_ENTITY_CLOSE;
  const canStart = status === STATUS_READY_TO_START && basePayload.userCanStart;

  return {
    ...basePayload,
    status,
    canStart,
    blockingReasons,
    nextAction: buildNextAction({
      status,
      canStart,
      canOpenRun: false,
      canFinalize: false,
    }),
    source: {
      ...basePayload.source,
      memberReadinessBlockCount: blockingReasons.length,
    },
  };
}

function buildRunExistsPayload({
  basePayload,
  officialRun,
  reviewGate = null,
}) {
  const currentRunStatus = toUpperText(officialRun?.status);
  if (currentRunStatus === "LOCKED") {
    const status = STATUS_LOCKED;
    return {
      ...basePayload,
      status,
      workflowApproved: true,
      nextAction: buildNextAction({
        status,
        canStart: false,
        canOpenRun: basePayload.canOpenRun,
        canFinalize: false,
      }),
    };
  }

  const blockers = Array.isArray(reviewGate?.blockers) ? reviewGate.blockers : [];
  const { workflowBlockers, nonWorkflowBlockers } = splitWorkflowBlockers(blockers);
  const operationalReadyToFinalize = nonWorkflowBlockers.length === 0;
  const workflowApproved =
    !reviewGate?.workflowGate?.required || Boolean(reviewGate?.workflowGate?.approved);
  const status = operationalReadyToFinalize
    ? STATUS_READY_TO_FINALIZE
    : STATUS_IN_PROGRESS;
  const canFinalize =
    operationalReadyToFinalize && workflowApproved && basePayload.userCanFinalize;
  const source = {
    ...basePayload.source,
    memberReadinessBlockCount: Number(
      reviewGate?.counts?.memberReadinessBlockCount || 0,
    ),
    dependencyBlockerCount: nonWorkflowBlockers.filter((blocker) =>
      toUpperText(blocker?.code).includes("DEPENDENCY"),
    ).length,
    draftAdjustmentCount: Number(reviewGate?.counts?.draftAdjustmentCount || 0),
    draftEliminationCount: Number(reviewGate?.counts?.draftEliminationCount || 0),
    entryCount: Number(reviewGate?.counts?.entryCount || 0),
    workflowGateRequired: Boolean(reviewGate?.workflowGate?.required),
    workflowGateApproved: Boolean(reviewGate?.workflowGate?.approved),
    workflowBlockerCount: workflowBlockers.length,
    nonWorkflowBlockerCount: nonWorkflowBlockers.length,
  };

  return {
    ...basePayload,
    status,
    canFinalize,
    operationalReadyToFinalize,
    workflowApproved,
    blockingReasons: nonWorkflowBlockers.map((blocker) =>
      buildBlockingReason({
        code: toUpperText(blocker?.code) || "CONSOLIDATION_RUN_BLOCKED",
        message:
          String(blocker?.message || "").trim() ||
          "Consolidation run is not operationally ready to finalize.",
        count: blocker?.count ?? null,
      }),
    ),
    nextAction: buildNextAction({
      status,
      canStart: false,
      canOpenRun: basePayload.canOpenRun,
      canFinalize,
    }),
    source,
  };
}

/**
 * Derive the group-cycle Ready To Consolidate state without mutating close,
 * consolidation-run, dependency, or workflow state.
 */
export async function getConsolidationReadyToStartStatus(
  cycleId,
  actorCtx = {},
  options = {},
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  const permissionChecker = options.permissionChecker || defaultPermissionChecker;
  const reviewGateReader = options.reviewGateReader || getConsolidationRunReviewGate;
  const ownerResolver = options.ownerResolver || resolveConsolidationReadinessOwner;

  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const cycle = await loadGroupCycleContext({
    tenantId,
    cycleId: normalizedCycleId,
    runQuery,
  });
  if (!cycle) {
    const err = new Error("Close cycle not found");
    err.status = 404;
    throw err;
  }

  if (toUpperText(cycle.scope_kind) !== "CONSOLIDATION_GROUP") {
    return {
      applicable: false,
      closeCycleId: normalizedCycleId,
      status: null,
      reasonCode: "NOT_CONSOLIDATION_GROUP_CYCLE",
    };
  }

  const consolidationGroupId = parsePositiveInt(cycle.consolidation_group_id);
  const fiscalPeriodId = parsePositiveInt(cycle.fiscal_period_id);
  const groupCompanyId =
    parsePositiveInt(cycle.consolidation_group_company_id) ||
    parsePositiveInt(cycle.cycle_group_company_id);
  const [permissionState, ownerState] = await Promise.all([
    resolvePermissionState({
      tenantId,
      userId,
      groupCompanyId,
      runQuery,
      permissionChecker,
    }),
    ownerResolver({
      tenantId,
      groupCompanyId,
      consolidationGroupId,
      cycleId: normalizedCycleId,
      runQuery,
    }),
  ]);

  const [consolidationItems, localCloseItems, officialRun] = await Promise.all([
    listCycleItemsByType({
      tenantId,
      cycleId: normalizedCycleId,
      itemType: "CONSOLIDATION_RUN",
      runQuery,
    }),
    listCycleItemsByType({
      tenantId,
      cycleId: normalizedCycleId,
      itemType: "LOCAL_CLOSE_PACK",
      runQuery,
    }),
    loadOfficialConsolidationRun({
      tenantId,
      consolidationGroupId,
      fiscalPeriodId,
      runQuery,
    }),
  ]);

  const consolidationItem =
    consolidationItems.find(
      (item) =>
        parsePositiveInt(item?.consolidationGroupId) === consolidationGroupId &&
        toUpperText(item?.runName) === OFFICIAL_CONSOLIDATION_RUN_NAME,
    ) || null;
  const basePayload = buildBasePayload({
    cycle,
    consolidationItem,
    officialRun,
    permissionState,
    ownerState,
  });

  if (!officialRun) {
    // V1 treats every provisioned local-close pack in the group cycle as
    // mandatory, so readiness cannot pass by vacuous truth over zero rows.
    return buildNoRunStatusPayload({
      basePayload,
      consolidationItem,
      localCloseItems,
    });
  }

  if (toUpperText(officialRun?.status) === "LOCKED") {
    return buildRunExistsPayload({
      basePayload,
      officialRun,
      reviewGate: null,
    });
  }

  const reviewGate = await reviewGateReader({
    tenantId,
    runId: parsePositiveInt(officialRun.id),
    requestedByUserId: userId,
    runQuery,
  });

  return buildRunExistsPayload({
    basePayload,
    officialRun,
    reviewGate,
  });
}

export default {
  getConsolidationReadyToStartStatus,
  resolveConsolidationReadinessOwner,
};
