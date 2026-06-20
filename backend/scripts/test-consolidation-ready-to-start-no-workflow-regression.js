import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConsolidationReadyToStartStatus } from "../src/services/consolidation.ready-to-start.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const TENANT_ID = 92001;
const USER_ID = 92002;
const CYCLE_ID = 92003;
const CONSOLIDATION_GROUP_ID = 92004;
const GROUP_COMPANY_ID = 92005;
const FISCAL_PERIOD_ID = 92006;

function buildCycleRow() {
  return {
    id: CYCLE_ID,
    tenant_id: TENANT_ID,
    scope_kind: "CONSOLIDATION_GROUP",
    fiscal_period_id: FISCAL_PERIOD_ID,
    consolidation_group_id: CONSOLIDATION_GROUP_ID,
    cycle_group_company_id: GROUP_COMPANY_ID,
    consolidation_group_company_id: GROUP_COMPANY_ID,
  };
}

function buildCycleItem(overrides = {}) {
  const itemType = String(overrides.item_type || "LOCAL_CLOSE_PACK").toUpperCase();
  return {
    id: overrides.id || 1,
    close_cycle_id: CYCLE_ID,
    item_type: itemType,
    scope_type: itemType === "CONSOLIDATION_RUN" ? "CONSOLIDATION_GROUP" : "CENTRAL",
    consolidation_group_id: itemType === "CONSOLIDATION_RUN" ? CONSOLIDATION_GROUP_ID : null,
    run_name: itemType === "CONSOLIDATION_RUN" ? "OFFICIAL" : null,
    business_status: "LOCKED",
    stale_status: "FRESH",
    ...overrides,
  };
}

function buildOfficialRun(overrides = {}) {
  return {
    id: 888,
    consolidation_group_id: CONSOLIDATION_GROUP_ID,
    fiscal_period_id: FISCAL_PERIOD_ID,
    run_name: "OFFICIAL",
    status: "COMPLETED",
    group_company_id: GROUP_COMPANY_ID,
    ...overrides,
  };
}

function buildHarness({
  items = [],
  officialRun = null,
  grantedPermissions = [],
  reviewGate = null,
  failIfReviewGateCalled = false,
} = {}) {
  const calls = {
    reviewGate: 0,
  };

  const runQuery = async (sql, params = []) => {
    const normalizedSql = String(sql).replace(/\s+/g, " ").toLowerCase();
    assert(
      !normalizedSql.includes("workflow_instances"),
      "Ready-to-start service must not query workflow instances directly",
    );
    if (String(sql).includes("FROM close_cycle_items cci")) {
      const itemType = String(params[2] || "").toUpperCase();
      return {
        rows: items.filter((item) => String(item.item_type || "").toUpperCase() === itemType),
      };
    }
    if (String(sql).includes("FROM consolidation_runs cr")) {
      return {
        rows: officialRun ? [officialRun] : [],
      };
    }
    if (String(sql).includes("FROM close_cycles cc")) {
      return {
        rows: [buildCycleRow()],
      };
    }
    throw new Error(`Unexpected SQL in workflow regression test: ${sql}`);
  };

  const permissionChecker = async ({ permissionCode, scopeType, scopeId }) => {
    assert.equal(scopeType, "GROUP");
    assert.equal(Number(scopeId), GROUP_COMPANY_ID);
    return grantedPermissions.includes(permissionCode);
  };

  const ownerResolver = async () => ({
    ownerUserId: null,
    ownerRoleHint: "GroupReportingController",
    ownerResolutionSource: "NONE",
  });

  const reviewGateReader = async () => {
    calls.reviewGate += 1;
    assert(!failIfReviewGateCalled, "READY_TO_START must not evaluate finalization workflow gate");
    return (
      reviewGate || {
        counts: {},
        workflowGate: { required: false, approved: true },
        blockers: [],
      }
    );
  };

  return {
    calls,
    actorCtx: {
      tenantId: TENANT_ID,
      userId: USER_ID,
      runQuery,
    },
    options: {
      permissionChecker,
      ownerResolver,
      reviewGateReader,
    },
  };
}

async function evaluate(harness) {
  return getConsolidationReadyToStartStatus(CYCLE_ID, harness.actorCtx, harness.options);
}

async function readSource(relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const consolidationItem = buildCycleItem({
    id: 10,
    item_type: "CONSOLIDATION_RUN",
    business_status: "NOT_STARTED",
  });
  const lockedFreshPack = buildCycleItem({
    id: 20,
    item_type: "LOCAL_CLOSE_PACK",
    business_status: "LOCKED",
    stale_status: "FRESH",
  });

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      grantedPermissions: ["consolidation.run.create"],
      failIfReviewGateCalled: true,
    });
    const status = await evaluate(harness);
    assert.equal(status.status, "READY_TO_START");
    assert.equal(harness.calls.reviewGate, 0);
    assert.equal(status.source.workflowGateRequired, false);
    assert.equal(status.source.workflowBlockerCount, 0);
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      officialRun: buildOfficialRun(),
      grantedPermissions: ["consolidation.run.read", "consolidation.run.finalize"],
      reviewGate: {
        counts: {
          entryCount: 3,
        },
        workflowGate: {
          required: true,
          approved: false,
        },
        blockers: [
          {
            code: "WORKFLOW_PACKAGE_PENDING",
            message: "Workflow approval pending",
            drill: { surface: "workflow" },
          },
        ],
      },
    });
    const status = await evaluate(harness);
    assert.equal(status.status, "READY_TO_FINALIZE");
    assert.equal(status.operationalReadyToFinalize, true);
    assert.equal(status.workflowApproved, false);
    assert.equal(status.canFinalize, false);
    assert.equal(status.nextAction?.code, "OPEN_FINALIZATION_REVIEW");
    assert.equal(status.source.workflowBlockerCount, 1);
    assert.equal(status.source.nonWorkflowBlockerCount, 0);
    assert.equal(harness.calls.reviewGate, 1);
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      officialRun: buildOfficialRun(),
      grantedPermissions: ["consolidation.run.finalize"],
      reviewGate: {
        counts: {
          entryCount: 3,
        },
        workflowGate: {
          required: true,
          approved: true,
        },
        blockers: [],
      },
    });
    const status = await evaluate(harness);
    assert.equal(status.status, "READY_TO_FINALIZE");
    assert.equal(status.operationalReadyToFinalize, true);
    assert.equal(status.workflowApproved, true);
    assert.equal(status.canFinalize, true);
    assert.equal(status.nextAction?.code, "FINALIZE_CONSOLIDATION_RUN");
  }

  const readinessServiceSource = await readSource(
    "backend/src/services/consolidation.ready-to-start.service.js",
  );
  assert(readinessServiceSource.includes("getConsolidationRunReviewGate"));
  assert(readinessServiceSource.includes("reviewGateReader"));
  assert(readinessServiceSource.includes("blocker?.drill?.surface"));
  assert(
    !readinessServiceSource.includes("listCycleDependencyBlockers"),
    "Ready-to-start service must not reuse cycle-lock dependency blockers for pre-run readiness",
  );
  assert(
    !readinessServiceSource.includes("workflow_instances"),
    "Ready-to-start service must not manipulate workflow instances",
  );
  assert(
    !/blockingAction\s*:\s*["']START["']/.test(readinessServiceSource),
    "Ready-to-start service must not add a START dependency action",
  );

  const routeSource = await readSource("backend/src/routes/consolidation.js");
  assert(routeSource.includes('requirePermission("consolidation.run.finalize"'));
  assert(routeSource.includes("const reviewGate = await getConsolidationRunReviewGate"));
  assert(routeSource.includes("if (!reviewGate.canFinalize)"));

  console.log(
    "Consolidation ready-to-start workflow regression checks passed (pre-run no workflow, finalize gate preserved).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
