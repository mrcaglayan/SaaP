import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCloseCycleAlertSnapshot,
  buildReadyToStartConsolidationAlertPayload,
} from "../src/services/close.alerts.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readSource(relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const cycle = {
    id: 71,
    fiscalPeriodId: 202606,
    createdAt: "2026-06-20T08:00:00Z",
    updatedAt: "2026-06-20T09:00:00Z",
  };
  const consolidationReadiness = {
    closeCycleId: 71,
    closeCycleItemId: 910,
    consolidationGroupId: 44,
    fiscalPeriodId: 202606,
    runName: "OFFICIAL",
    status: "READY_TO_START",
    ownerUserId: null,
    ownerRoleHint: "GroupReportingController",
  };

  const payload = buildReadyToStartConsolidationAlertPayload({
    cycle,
    consolidationReadiness,
  });
  assert.equal(payload.alertType, "ACTION_REQUIRED");
  assert.equal(payload.alertCode, "READY_TO_START_CONSOLIDATION");
  assert.equal(payload.subjectType, "CLOSE_CYCLE_ITEM");
  assert.equal(payload.subjectId, 910);
  assert.equal(payload.sourceKind, "READINESS");
  assert.equal(payload.payload.sourceKind, "READINESS");
  assert.equal(payload.payload.itemType, "CONSOLIDATION_RUN");
  assert.equal(payload.payload.runName, "OFFICIAL");
  assert(payload.alertKey.includes("READINESS:71:910:CONSOLIDATION_RUN:44:202606:OFFICIAL"));

  const inactivePayload = buildReadyToStartConsolidationAlertPayload({
    cycle,
    consolidationReadiness: {
      ...consolidationReadiness,
      status: "IN_PROGRESS",
    },
  });
  assert.equal(inactivePayload, null);

  const snapshot = await buildCloseCycleAlertSnapshot({
    cycle,
    consolidationReadiness,
  });
  assert.equal(snapshot.counts.actionRequired, 1);
  assert.equal(snapshot.panels.actionRequired.total, 1);
  assert.equal(snapshot.panels.actionRequired.rows[0].alertType, "ACTION_REQUIRED");
  assert.equal(snapshot.panels.actionRequired.rows[0].sourceKind, "READINESS");

  const alertsServiceSource = await readSource("backend/src/services/close.alerts.service.js");
  assert(alertsServiceSource.includes("ACTION_REQUIRED"));
  assert(alertsServiceSource.includes("actionRequired"));

  const alertPersistenceSource = await readSource(
    "backend/src/services/close.alerts-persistence.service.js",
  );
  for (const contract of [
    "syncCloseReadinessAlertsForCycle",
    "resolveStaleReadinessAlertsForCycle",
    "READY_TO_START_CONSOLIDATION",
    "READINESS",
    "CLOSE_CYCLE_ITEM",
  ]) {
    assert(alertPersistenceSource.includes(contract), `Missing readiness alert contract: ${contract}`);
  }
  assert(
    alertPersistenceSource.includes("toUpperText(row.alert_code) === CLOSE_READINESS_ALERT_CODE"),
    "Persisted readiness alerts must map sourceKind from alert code instead of falling through to TASK",
  );

  const closeCyclesServiceSource = await readSource("backend/src/services/close.cycles.service.js");
  assert(closeCyclesServiceSource.includes("syncCloseReadinessAlertsForCycle"));
  assert(closeCyclesServiceSource.includes("consolidationReadiness"));
  assert(closeCyclesServiceSource.includes("rowsByKey"));

  const migrationIndexSource = await readSource("backend/src/migrations/index.js");
  assert(migrationIndexSource.includes("migration207CloseAlertsActionRequiredType"));
  const migrationSource = await readSource(
    "backend/src/migrations/m207_close_alerts_action_required_type.js",
  );
  assert(migrationSource.includes("'ACTION_REQUIRED'"));
  assert(migrationSource.includes("MODIFY COLUMN alert_type ENUM"));

  const cockpitSource = await readSource("frontend/src/pages/CloseCockpitPage.jsx");
  assert(cockpitSource.includes("getAlertTypeLabel"));
  assert(cockpitSource.includes("getAlertTypeTone"));
  assert(cockpitSource.includes("Action required"));
  assert(cockpitSource.includes("panels?.actionRequired?.total"));

  console.log(
    "Consolidation ready-to-start alert checks passed (ACTION_REQUIRED live/durable cockpit contract).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
