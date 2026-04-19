import crypto from "node:crypto";
import { closePool, query } from "../src/db.js";
import { getCycleById } from "../src/services/close.cycles.service.js";
import { syncCycleItemsBySource } from "../src/services/close.cycle-items.service.js";
import { buildCloseCycleKpiSnapshot } from "../src/services/close.kpis.service.js";
import {
  TEST_FISCAL_YEAR,
  apiRequest,
  assert,
  bootstrapOrgBookCoa,
  createBootstrapAdmin,
  findRegularPeriodByNo,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.CLOSE_FIXUP_TEST_PORT || 3136);
const BASE_URL =
  process.env.CLOSE_FIXUP_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = "CloseFixup#12345";
const LOCAL_CLOSE_API_PREFIX = "/api/v1/gl/local-close-packs";
const LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS = Object.freeze([
  "trialBalance",
  "generalLedger",
  "subsidiaryLedger",
  "balanceSheet",
  "incomeStatement",
]);

function toErrorText(payload) {
  if (payload === null || payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload?.message === "string") {
    return payload.message;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

async function loadPackRows({ tenantId, legalEntityId, bookId, fiscalPeriodId }) {
  const result = await query(
    `SELECT
       id,
       status,
       close_scope_type,
       operating_unit_id
     FROM local_close_packs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
     ORDER BY close_scope_type ASC, operating_unit_id ASC, id ASC`,
    [tenantId, legalEntityId, bookId, fiscalPeriodId]
  );
  return result.rows || [];
}

async function markPackApproved({ tenantId, userId, packId }) {
  await query(
    `UPDATE local_close_packs
     SET status = 'APPROVED',
         reviewer_user_id = ?,
         approved_at = CURRENT_TIMESTAMP,
         locked_at = NULL,
         updated_by_user_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND id = ?`,
    [userId, userId, tenantId, packId]
  );
}

async function ensurePackReportReviews({ tenantId, userId, packId }) {
  for (const reportKey of LOCAL_CLOSE_PACK_REPORT_REVIEW_KEYS) {
    const routePath = `/regression/close-fixup/${reportKey}`;
    const queryPayload = {
      packId,
      reportKey,
      source: "close-cycle-fixup-regression",
    };
    const responseSnapshot = {
      ok: true,
      reportKey,
      packId,
    };
    const fingerprintSha256 = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          reportKey,
          routePath,
          launchMode: "PACK_SCOPE",
          queryPayload,
          responseSnapshot,
        })
      )
      .digest("hex");

    await query(
      `INSERT INTO local_close_pack_report_reviews (
         tenant_id,
         local_close_pack_id,
         report_key,
         route_path,
         launch_mode,
         query_json,
         response_snapshot_json,
         fingerprint_sha256,
         review_note,
         reviewed_by_user_id,
         reviewed_at
       )
       VALUES (?, ?, ?, ?, 'PACK_SCOPE', CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         route_path = VALUES(route_path),
         launch_mode = VALUES(launch_mode),
         query_json = VALUES(query_json),
         response_snapshot_json = VALUES(response_snapshot_json),
         fingerprint_sha256 = VALUES(fingerprint_sha256),
         review_note = VALUES(review_note),
         reviewed_by_user_id = VALUES(reviewed_by_user_id),
         reviewed_at = CURRENT_TIMESTAMP`,
      [
        tenantId,
        packId,
        reportKey,
        routePath,
        JSON.stringify(queryPayload),
        JSON.stringify(responseSnapshot),
        fingerprintSha256,
        "Regression lock prerequisite coverage",
        userId,
      ]
    );
  }
}

async function ensurePackEvidence({
  tenantId,
  legalEntityId,
  userId,
  packId,
}) {
  const existing = await query(
    `SELECT id
     FROM evidence_objects
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND source_ref_type = 'LOCAL_CLOSE_PACK'
       AND source_ref_id = ?
       AND status <> 'DELETED'
     LIMIT 1`,
    [tenantId, legalEntityId, packId]
  );
  if ((existing.rows || []).length > 0) {
    return;
  }

  await query(
    `INSERT INTO evidence_objects (
       tenant_id,
       legal_entity_id,
       source_ref_type,
       source_ref_id,
       status,
       display_name,
       note,
       file_name,
       file_extension,
       content_type,
       file_size_bytes,
       storage_driver,
       uploaded_at,
       created_by_user_id
     )
     VALUES (?, ?, 'LOCAL_CLOSE_PACK', ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, 'LOCAL_FS', CURRENT_TIMESTAMP, ?)`,
    [
      tenantId,
      legalEntityId,
      packId,
      `Regression evidence ${packId}`,
      "Regression evidence placeholder for local-close lock prerequisites.",
      `close-fixup-${packId}.txt`,
      "txt",
      "text/plain",
      1,
      userId,
    ]
  );
}

async function certifyPackForLock({ baseUrl, token, packId }) {
  const result = await apiRequest({
    baseUrl,
    token,
    method: "PUT",
    requestPath: `${LOCAL_CLOSE_API_PREFIX}/${packId}/certification-sections/FINAL_CERTIFICATION`,
    body: {
      status: "COMPLETE",
      note: "Regression certification attestation for close-cycle fixup coverage.",
    },
    expectedStatus: 200,
  });
  assert(
    result.json?.ok === true,
    `Pack ${packId} final certification should complete before lock`
  );
}

async function preparePackForLock({
  baseUrl,
  token,
  tenantId,
  legalEntityId,
  userId,
  packId,
}) {
  await ensurePackReportReviews({
    tenantId,
    userId,
    packId,
  });
  await ensurePackEvidence({
    tenantId,
    legalEntityId,
    userId,
    packId,
  });
  await certifyPackForLock({
    baseUrl,
    token,
    packId,
  });
}

async function forceLockPackAndSync({ tenantId, userId, packId }) {
  await query(
    `UPDATE local_close_packs
     SET status = 'LOCKED',
         reviewer_user_id = ?,
         locked_at = CURRENT_TIMESTAMP,
         updated_by_user_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND id = ?`,
    [userId, userId, tenantId, packId]
  );
  await syncCycleItemsBySource("LOCAL_CLOSE_PACK", packId, {
    tenantId,
    userId,
  });
}

async function loadCycleKpiSummary({ tenantId, cycleId }) {
  const cycle = await getCycleById(cycleId, { tenantId });
  const snapshot = await buildCloseCycleKpiSnapshot(
    {
      cycle: cycle.row,
      worklistRows: cycle.items || [],
    },
    { tenantId }
  );
  return snapshot.summary || {};
}

async function loadCycleItemByCurrentSource({
  cycleId,
  sourceTargetType,
  sourceTargetId,
}) {
  const result = await query(
    `SELECT
       cci.id,
       cci.item_type,
       cci.business_status,
       cci.stale_status
     FROM close_cycle_items cci
     JOIN close_cycle_item_links ccil
       ON ccil.close_cycle_item_id = cci.id
      AND ccil.is_current = TRUE
     WHERE cci.close_cycle_id = ?
       AND ccil.source_target_type = ?
       AND ccil.source_target_id = ?
     LIMIT 1`,
    [cycleId, sourceTargetType, sourceTargetId]
  );
  return result.rows?.[0] || null;
}

async function main() {
  const stamp = Date.now();
  const tenantCode = `CCFIX_${stamp}`;
  const tenantName = `Close Fixup Tenant ${stamp}`;
  const adminEmail = `close_fixup_admin_${stamp}@example.com`;
  const approverEmail = `close_fixup_approver_${stamp}@example.com`;

  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode,
    tenantName,
    adminEmail,
    adminPassword: ADMIN_PASSWORD,
  });
  await createBootstrapAdmin({
    tenantId: identity.tenantId,
    email: approverEmail,
    password: ADMIN_PASSWORD,
    name: "Close Fixup Approver",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const token = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: ADMIN_PASSWORD,
    });
    const approverToken = await login({
      baseUrl: BASE_URL,
      email: approverEmail,
      password: ADMIN_PASSWORD,
    });

    const base = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token,
      stamp,
      fiscalYear: TEST_FISCAL_YEAR,
      baseCurrencyCode: "TRY",
      yearsToGenerate: [TEST_FISCAL_YEAR, TEST_FISCAL_YEAR + 1],
    });
    const targetPeriod = findRegularPeriodByNo(base.periods, 1);
    const fiscalPeriodId = toNumber(targetPeriod?.id);
    assert(fiscalPeriodId > 0, "Target fiscal period is required");

    const createCycle = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/close/cycles",
      body: {
        cycleType: "MONTH_END",
        fiscalPeriodId,
        legalEntityId: base.legalEntityId,
      },
      expectedStatus: 201,
    });
    const cycleId = toNumber(createCycle.json?.row?.id);
    assert(cycleId > 0, "Close cycle id missing");

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/close/cycles/${cycleId}/provision`,
      expectedStatus: 200,
    });

    const packRows = await loadPackRows({
      tenantId: identity.tenantId,
      legalEntityId: base.legalEntityId,
      bookId: base.bookId,
      fiscalPeriodId,
    });
    assert(packRows.length > 0, "Provision should create local close packs");
    const gatedPackId = toNumber(packRows[0]?.id);
    assert(gatedPackId > 0, "Primary local close pack id missing");

    const initialCycleLock = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/close/cycles/${cycleId}/lock`,
      expectedStatus: 409,
    });
    assert(
      String(initialCycleLock.json?.code || "").toUpperCase() ===
        "PERIOD_CLOSE_COMPLETE_BEFORE_CYCLE_LOCK",
      `Expected entity-cycle lock to block on period close completion, got ${toErrorText(
        initialCycleLock.json
      )}`
    );

    await markPackApproved({
      tenantId: identity.tenantId,
      userId: identity.userId,
      packId: gatedPackId,
    });
    const preClosePackLock = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `${LOCAL_CLOSE_API_PREFIX}/${gatedPackId}/lock`,
      expectedStatus: 409,
    });
    assert(
      String(preClosePackLock.json?.code || "").toUpperCase() ===
        "PERIOD_CLOSE_COMPLETE_BEFORE_LOCAL_CLOSE_LOCK",
      `Expected local close lock to block on period close completion, got ${toErrorText(
        preClosePackLock.json
      )}`
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${fiscalPeriodId}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        note: "close cycle fixup initial completion",
      },
      expectedStatus: 201,
    });

    let recoveryPackId = null;
    let recoveryLockFailure = null;
    for (const packRow of packRows) {
      const packId = toNumber(packRow?.id);
      assert(packId > 0, "Every provisioned local close pack must have an id");
      await markPackApproved({
        tenantId: identity.tenantId,
        userId: identity.userId,
        packId,
      });
      if (!recoveryPackId) {
        await preparePackForLock({
          baseUrl: BASE_URL,
          token,
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          userId: identity.userId,
          packId,
        });
        const lockResult = await apiRequest({
          baseUrl: BASE_URL,
          token,
          method: "POST",
          requestPath: `${LOCAL_CLOSE_API_PREFIX}/${packId}/lock`,
        });
        if (lockResult.status === 200) {
          recoveryPackId = packId;
          continue;
        }
        const lockCode = String(lockResult.json?.code || "").toUpperCase();
        if (!lockCode.startsWith("REVREC_CONTINUITY_")) {
          throw new Error(
            `Local close pack ${packId} should lock or only fail on REVREC continuity, got ${toErrorText(
              lockResult.json
            )}`
          );
        }
        recoveryLockFailure = lockResult.json;
      }
      await forceLockPackAndSync({
        tenantId: identity.tenantId,
        userId: identity.userId,
        packId,
      });
    }
    assert(
      recoveryPackId > 0,
      `Expected at least one pack to pass the real lock route for stale recovery coverage, got ${toErrorText(
        recoveryLockFailure
      )}`
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${fiscalPeriodId}/reopen`,
      body: {
        reason: "close cycle fixup stale propagation",
      },
      expectedStatus: 201,
    });

    const staleSummary = await loadCycleKpiSummary({
      tenantId: identity.tenantId,
      cycleId,
    });
    assert(
      Number(staleSummary.staleCount || 0) > 0,
      "Period reopen should make at least one downstream item stale"
    );

    const stalePackItem = await loadCycleItemByCurrentSource({
      cycleId,
      sourceTargetType: "LOCAL_CLOSE_PACK",
      sourceTargetId: recoveryPackId,
    });
    assert(
      String(stalePackItem?.stale_status || "").toUpperCase() !== "FRESH",
      "Primary local close pack item should be stale after period reopen"
    );

    const reopenRequest = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `${LOCAL_CLOSE_API_PREFIX}/${recoveryPackId}/reopen-requests`,
      body: {
        reasonCode: "CLOSE_FIXUP",
        requestedActionType: "RECLASS_REQUIRED",
        explanation: "Regression path for stale recovery and reopen KPI.",
        downstreamStage: "ENTITY_NOT_SUBMITTED",
      },
      expectedStatus: 201,
    });
    const reopenRequestId = toNumber(reopenRequest.json?.row?.id);
    assert(reopenRequestId > 0, "Reopen request id missing");

    const reopenApproval = await apiRequest({
      baseUrl: BASE_URL,
      token: approverToken,
      method: "POST",
      requestPath: `${LOCAL_CLOSE_API_PREFIX}/${recoveryPackId}/reopen-requests/${reopenRequestId}/approve`,
      body: {
        decisionNote: "Execute reopen for regression coverage",
      },
      expectedStatus: 201,
    });
    assert(reopenApproval.json?.ok === true, "Reopen approval should succeed");

    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/gl/period-closing/${base.bookId}/${fiscalPeriodId}/close-run`,
      body: {
        closeStatus: "SOFT_CLOSED",
        note: "close cycle fixup recovery completion",
      },
      expectedStatus: 201,
    });

    for (const packRow of packRows) {
      const packId = toNumber(packRow?.id);
      await markPackApproved({
        tenantId: identity.tenantId,
        userId: identity.userId,
        packId,
      });
      if (packId === recoveryPackId) {
        await preparePackForLock({
          baseUrl: BASE_URL,
          token,
          tenantId: identity.tenantId,
          legalEntityId: base.legalEntityId,
          userId: identity.userId,
          packId,
        });
        const relockResult = await apiRequest({
          baseUrl: BASE_URL,
          token,
          method: "POST",
          requestPath: `${LOCAL_CLOSE_API_PREFIX}/${packId}/lock`,
          expectedStatus: 200,
        });
        assert(
          relockResult.json?.ok === true,
          `Local close pack ${packId} should relock after recovery`
        );
        continue;
      }
      await forceLockPackAndSync({
        tenantId: identity.tenantId,
        userId: identity.userId,
        packId,
      });
    }

    const recoveredPackItem = await loadCycleItemByCurrentSource({
      cycleId,
      sourceTargetType: "LOCAL_CLOSE_PACK",
      sourceTargetId: recoveryPackId,
    });
    assert(
      String(recoveredPackItem?.stale_status || "").toUpperCase() === "FRESH",
      "Primary local close pack item should clear stale after relock"
    );

    const staleEventCounts = await query(
      `SELECT
         SUM(CASE WHEN event_code = 'PERIOD_CLOSE_REOPENED' THEN 1 ELSE 0 END) AS stale_applied_count,
         SUM(CASE WHEN event_code = 'STALE_RESOLVED_AFTER_RERUN' THEN 1 ELSE 0 END) AS stale_resolved_count
       FROM close_stale_events
       WHERE close_cycle_id = ?
         AND close_cycle_item_id = ?`,
      [cycleId, toNumber(recoveredPackItem?.id)]
    );
    assert(
      toNumber(staleEventCounts.rows?.[0]?.stale_applied_count) > 0,
      "Stale history should retain the original reopen-driven stale event"
    );
    assert(
      toNumber(staleEventCounts.rows?.[0]?.stale_resolved_count) > 0,
      "Stale history should record a stale resolution event after recovery"
    );

    const summary = await loadCycleKpiSummary({
      tenantId: identity.tenantId,
      cycleId,
    });
    assert(Number(summary.staleCount || 0) === 0, "Recovered cockpit should not report active stale rows");
    assert(
      Number(summary.reopenEventsTotal || 0) >= 2,
      `Expected reopen event KPI to retain history, got ${JSON.stringify(summary)}`
    );
    assert(
      Number(summary.itemsReopenedAtLeastOnce || 0) >= 2,
      `Expected at least the period-close item and one local-close item to show reopen history, got ${JSON.stringify(
        summary
      )}`
    );
    assert(
      Number(summary.currentlyReopenedItems || 0) === 0,
      `Recovered cockpit should not show currently reopened items, got ${JSON.stringify(summary)}`
    );

    const finalCycleLock = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/close/cycles/${cycleId}/lock`,
      expectedStatus: 200,
    });
    assert(finalCycleLock.json?.ok === true, "Cycle should lock after terminal recovery completes");

    console.log("Close-cycle targeted fixup regression passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          cycleId,
          legalEntityId: base.legalEntityId,
          bookId: base.bookId,
          fiscalPeriodId,
          packIds: packRows.map((row) => toNumber(row?.id)).filter((value) => value > 0),
          reopenSummary: summary,
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill("SIGINT");
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((err) => {
  console.error("Close-cycle targeted fixup regression failed.");
  console.error(err);
  process.exitCode = 1;
});
