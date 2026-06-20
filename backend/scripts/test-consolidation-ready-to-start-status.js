import { getConsolidationReadyToStartStatus } from "../src/services/consolidation.ready-to-start.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const TENANT_ID = 91001;
const USER_ID = 91002;
const CYCLE_ID = 91003;
const CONSOLIDATION_GROUP_ID = 91004;
const GROUP_COMPANY_ID = 91005;
const FISCAL_PERIOD_ID = 91006;

function buildCycleRow(overrides = {}) {
  return {
    id: CYCLE_ID,
    tenant_id: TENANT_ID,
    scope_kind: "CONSOLIDATION_GROUP",
    fiscal_period_id: FISCAL_PERIOD_ID,
    consolidation_group_id: CONSOLIDATION_GROUP_ID,
    cycle_group_company_id: GROUP_COMPANY_ID,
    consolidation_group_company_id: GROUP_COMPANY_ID,
    owner_user_id: null,
    cycle_status: "OPEN",
    presentation_currency_code: "TRY",
    ...overrides,
  };
}

function buildCycleItem(overrides = {}) {
  const itemType = String(overrides.item_type || "LOCAL_CLOSE_PACK").toUpperCase();
  return {
    id: overrides.id || 1,
    close_cycle_id: CYCLE_ID,
    item_type: itemType,
    item_key: `${itemType}:${overrides.id || 1}`,
    scope_type:
      itemType === "CONSOLIDATION_RUN" ? "CONSOLIDATION_GROUP" : "CENTRAL",
    scope_id:
      itemType === "CONSOLIDATION_RUN"
        ? CONSOLIDATION_GROUP_ID
        : overrides.legal_entity_id || 101,
    legal_entity_id: itemType === "CONSOLIDATION_RUN" ? null : 101,
    operating_unit_id: null,
    book_id: itemType === "CONSOLIDATION_RUN" ? null : 201,
    consolidation_group_id:
      itemType === "CONSOLIDATION_RUN" ? CONSOLIDATION_GROUP_ID : null,
    run_name: itemType === "CONSOLIDATION_RUN" ? "OFFICIAL" : null,
    presentation_currency_code: itemType === "CONSOLIDATION_RUN" ? "TRY" : null,
    business_status: "LOCKED",
    stale_status: "FRESH",
    stale_resolved_at: null,
    stale_resolved_by_user_id: null,
    owner_user_id: null,
    due_at: null,
    created_at: null,
    updated_at: null,
    current_source_target_type: null,
    current_source_target_id: null,
    current_link_created_at: null,
    close_cycle_tenant_id: TENANT_ID,
    close_cycle_fiscal_period_id: FISCAL_PERIOD_ID,
    close_cycle_status: "OPEN",
    ...overrides,
  };
}

function buildOfficialRun(overrides = {}) {
  return {
    id: 777,
    consolidation_group_id: CONSOLIDATION_GROUP_ID,
    fiscal_period_id: FISCAL_PERIOD_ID,
    run_name: "OFFICIAL",
    status: "COMPLETED",
    presentation_currency_code: "TRY",
    group_company_id: GROUP_COMPANY_ID,
    ...overrides,
  };
}

function buildHarness({
  cycle = buildCycleRow(),
  items = [],
  officialRun = null,
  grantedPermissions = [],
  reviewGate = null,
  ownerState = null,
} = {}) {
  const calls = {
    reviewGate: 0,
    ownerResolver: 0,
    permissionScopes: [],
  };

  const runQuery = async (sql, params = []) => {
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
        rows: cycle ? [cycle] : [],
      };
    }
    throw new Error(`Unexpected SQL in readiness test: ${sql}`);
  };

  const permissionChecker = async ({
    permissionCode,
    scopeType,
    scopeId,
  }) => {
    calls.permissionScopes.push({ permissionCode, scopeType, scopeId });
    assert(scopeType === "GROUP", "Permission checks must use RBAC GROUP scope");
    assert(
      Number(scopeId) === GROUP_COMPANY_ID,
      "Permission checks must use consolidation_groups.group_company_id",
    );
    return grantedPermissions.includes(permissionCode);
  };

  const reviewGateReader = async () => {
    calls.reviewGate += 1;
    return (
      reviewGate || {
        counts: {},
        workflowGate: { required: false, approved: true },
        blockers: [],
      }
    );
  };

  const ownerResolver = async ({ groupCompanyId }) => {
    calls.ownerResolver += 1;
    assert(
      Number(groupCompanyId) === GROUP_COMPANY_ID,
      "Owner resolver must receive consolidation_groups.group_company_id",
    );
    return (
      ownerState || {
        ownerUserId: null,
        ownerRoleHint: "GroupReportingController",
        ownerResolutionSource: "NONE",
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
  return getConsolidationReadyToStartStatus(
    CYCLE_ID,
    harness.actorCtx,
    harness.options,
  );
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
      items: [consolidationItem],
      grantedPermissions: ["consolidation.run.create"],
    });
    const status = await evaluate(harness);
    assert(
      status.status === "WAITING_FOR_ENTITY_CLOSE",
      "Zero mandatory local close packs must not become READY_TO_START",
    );
    assert(
      status.blockingReasons.some(
        (reason) => reason.code === "MANDATORY_LOCAL_CLOSE_PACK_MISSING",
      ),
      "Zero-pack state must include missing local-close blocking reason",
    );
    assert(harness.calls.reviewGate === 0, "No-run state must not call review gate");
  }

  {
    const stalePack = buildCycleItem({
      id: 21,
      item_type: "LOCAL_CLOSE_PACK",
      business_status: "LOCKED",
      stale_status: "FINALIZED_BUT_OUTDATED",
    });
    const harness = buildHarness({
      items: [consolidationItem, stalePack],
      grantedPermissions: ["consolidation.run.create"],
    });
    const status = await evaluate(harness);
    assert(
      status.status === "WAITING_FOR_ENTITY_CLOSE",
      "Locked but stale local close pack must wait for entity close",
    );
    assert(
      status.blockingReasons.some(
        (reason) => reason.code === "MANDATORY_LOCAL_CLOSE_PACK_STALE",
      ),
      "Stale local-close item must produce stale blocking reason",
    );
  }

  {
    const openPack = buildCycleItem({
      id: 22,
      item_type: "LOCAL_CLOSE_PACK",
      business_status: "IN_PROGRESS",
      stale_status: "FRESH",
    });
    const harness = buildHarness({
      items: [consolidationItem, openPack],
      grantedPermissions: ["consolidation.run.create"],
    });
    const status = await evaluate(harness);
    assert(
      status.status === "WAITING_FOR_ENTITY_CLOSE",
      "Local close pack that is not locked must wait for entity close",
    );
    assert(
      status.blockingReasons.some(
        (reason) => reason.code === "MANDATORY_LOCAL_CLOSE_PACK_NOT_LOCKED",
      ),
      "Open local-close item must produce not-locked blocking reason",
    );
  }

  {
    const harness = buildHarness({
      items: [lockedFreshPack],
      grantedPermissions: ["consolidation.run.create"],
    });
    const status = await evaluate(harness);
    assert(
      status.status === "WAITING_FOR_ENTITY_CLOSE",
      "Missing expected consolidation cycle item must not be READY_TO_START",
    );
    assert(
      status.blockingReasons.some(
        (reason) => reason.code === "EXPECTED_CONSOLIDATION_CYCLE_ITEM_MISSING",
      ),
      "Missing consolidation item must produce a clear diagnostic",
    );
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      grantedPermissions: ["consolidation.run.create"],
      ownerState: {
        ownerUserId: 4242,
        ownerRoleHint: "ConsolidationRunPreparer",
        ownerResolutionSource: "ROLE",
      },
    });
    const status = await evaluate(harness);
    assert(
      status.status === "READY_TO_START",
      "Locked/fresh local close items with no official run must be READY_TO_START",
    );
    assert(status.canStart === true, "Create-permissioned user must be able to start");
    assert(
      status.nextAction?.code === "START_CONSOLIDATION_RUN",
      "Ready user should get start next action",
    );
    assert(status.ownerUserId === 4242, "Resolved owner id must be exposed in readiness payload");
    assert(
      status.ownerRoleHint === "ConsolidationRunPreparer",
      "Resolved owner role hint must be exposed in readiness payload",
    );
    assert(status.ownerResolutionSource === "ROLE", "Owner source should identify role resolution");
    assert(harness.calls.ownerResolver === 1, "Readiness status should resolve suggested owner once");
    assert(harness.calls.reviewGate === 0, "READY_TO_START must not call review gate");
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      grantedPermissions: [],
    });
    const status = await evaluate(harness);
    assert(
      status.status === "READY_TO_START",
      "Readiness state should still be READY_TO_START when viewer cannot create the run",
    );
    assert(status.canStart === false, "Start CTA must require consolidation.run.create");
    assert(
      status.nextAction?.code === "WAITING_FOR_CONSOLIDATION_PREPARER",
      "Unpermissioned ready state should point to the consolidation preparer",
    );
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      officialRun: buildOfficialRun(),
      grantedPermissions: ["consolidation.run.finalize"],
      reviewGate: {
        counts: {
          entryCount: 2,
          memberReadinessBlockCount: 0,
        },
        workflowGate: {
          required: true,
          approved: false,
        },
        blockers: [
          {
            code: "DYNAMIC_WORKFLOW_CODE",
            message: "Workflow approval pending",
            drill: { surface: "workflow" },
          },
        ],
      },
    });
    const status = await evaluate(harness);
    assert(
      status.status === "READY_TO_FINALIZE",
      "Only workflow blockers should still produce READY_TO_FINALIZE",
    );
    assert(status.canFinalize === false, "Pending workflow approval must block canFinalize");
    assert(
      status.source.workflowBlockerCount === 1 &&
        status.source.nonWorkflowBlockerCount === 0,
      "Workflow blocker split must use drill.surface metadata",
    );
    assert(status.canOpenRun === false, "Open CTA must require consolidation.run.read");
    assert(harness.calls.reviewGate === 1, "Existing run must use review gate");
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      officialRun: buildOfficialRun(),
      grantedPermissions: ["consolidation.run.read"],
      reviewGate: {
        counts: {
          entryCount: 0,
        },
        workflowGate: {
          required: false,
          approved: true,
        },
        blockers: [
          {
            code: "CONSOLIDATION_RUN_NOT_EXECUTED",
            message: "No entries",
            drill: { surface: "summary" },
          },
        ],
      },
    });
    const status = await evaluate(harness);
    assert(status.status === "IN_PROGRESS", "Operational blockers must stay IN_PROGRESS");
    assert(status.canOpenRun === true, "Read permission should allow open-run CTA");
    assert(
      status.source.nonWorkflowBlockerCount === 1,
      "Non-workflow blocker count should include summary blocker",
    );
  }

  {
    const harness = buildHarness({
      items: [lockedFreshPack],
      officialRun: buildOfficialRun(),
      grantedPermissions: ["consolidation.run.read"],
      reviewGate: {
        counts: {
          entryCount: 0,
        },
        workflowGate: {
          required: false,
          approved: true,
        },
        blockers: [
          {
            code: "CONSOLIDATION_RUN_NOT_EXECUTED",
            message: "Unlinked official run exists but has no entries",
            drill: { surface: "summary" },
          },
        ],
      },
    });
    const status = await evaluate(harness);
    assert(
      status.status === "IN_PROGRESS",
      "Existing unlinked official run must prevent READY_TO_START",
    );
    assert(
      status.runId === 777,
      "Existing unlinked official run id must be returned for open-run actions",
    );
  }

  {
    const harness = buildHarness({
      items: [consolidationItem, lockedFreshPack],
      officialRun: buildOfficialRun({ status: "LOCKED" }),
      grantedPermissions: ["consolidation.run.read"],
    });
    const status = await evaluate(harness);
    assert(status.status === "LOCKED", "Locked official run must return LOCKED");
    assert(harness.calls.reviewGate === 0, "Locked run should not need review gate");
    assert(status.canOpenRun === true, "Read permission should allow opening locked run");
  }

  console.log(
    "Consolidation ready-to-start status checks passed (missing/open/stale local packs, READY_TO_START, unlinked run, workflow split, run-open RBAC).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
