import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCloseTaskCockpitSummaryFromRows,
  buildCloseTaskLockBlockersFromRows,
} from "../src/services/close.tasks.service.js";
import { buildCloseTaskAlertPayloadsFromRows } from "../src/services/close.alerts-persistence.service.js";
import { composeCloseBlockers } from "../src/services/close.blocker-composer.service.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

async function main() {
  const now = new Date("2026-06-17T12:00:00Z");
  const rows = [
    {
      id: 1,
      close_cycle_id: 10,
      task_code: "LOCK_REQUIRED_OPEN",
      task_name: "Required open task",
      task_family: "MANUAL",
      status: "IN_PROGRESS",
      owner_user_id: 20,
      due_at: "2026-06-17 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 0,
      evidence_count: 0,
    },
    {
      id: 2,
      close_cycle_id: 10,
      task_code: "NON_REQUIRED_OPEN",
      task_name: "Non-required open task",
      task_family: "REPORTING",
      status: "NOT_STARTED",
      owner_user_id: 20,
      due_at: "2026-06-18 12:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
      evidence_count: 0,
    },
    {
      id: 3,
      close_cycle_id: 10,
      task_code: "WAIVED_REQUIRED",
      task_name: "Waived required task",
      task_family: "CERTIFICATION",
      status: "WAIVED",
      owner_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 0,
    },
    {
      id: 4,
      close_cycle_id: 10,
      task_code: "CANCELLED_REQUIRED",
      task_name: "Cancelled required task",
      task_family: "CERTIFICATION",
      status: "CANCELLED",
      owner_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 0,
    },
    {
      id: 5,
      close_cycle_id: 10,
      task_code: "APPROVED_MISSING_EVIDENCE",
      task_name: "Approved missing evidence",
      task_family: "CERTIFICATION",
      status: "APPROVED",
      owner_user_id: 30,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 0,
    },
    {
      id: 6,
      close_cycle_id: 10,
      task_code: "APPROVED_WITH_EVIDENCE",
      task_name: "Approved with evidence",
      task_family: "CERTIFICATION",
      status: "APPROVED",
      owner_user_id: 30,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 1,
    },
    {
      id: 7,
      close_cycle_id: 10,
      task_code: "APPROVED_FAILED_SOURCE_CHECK",
      task_name: "Approved failed source check",
      task_family: "FX",
      status: "APPROVED",
      owner_user_id: 30,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 0,
      evidence_count: 0,
      source_check_status: "FAILED",
    },
  ];

  const summary = buildCloseTaskCockpitSummaryFromRows(rows, {
    userId: 20,
    now,
  });
  assert.equal(summary.total, 7);
  assert.equal(summary.counts.inProgress, 1);
  assert.equal(summary.counts.notStarted, 1);
  assert.equal(summary.counts.approved, 3);
  assert.equal(summary.counts.waived, 1);
  assert.equal(summary.counts.cancelled, 1);
  assert.equal(summary.counts.overdue, 1);
  assert.equal(summary.counts.evidenceMissing, 1);
  assert.equal(summary.counts.sourceCheckFailed, 1);
  assert.equal(summary.counts.lockBlocking, 3);
  assert.equal(summary.myOpenTasks.length, 2);
  assert.equal(summary.byFamily.find((row) => row.taskFamily === "CERTIFICATION").cancelled, 1);

  const blockers = buildCloseTaskLockBlockersFromRows(rows, { now });
  assert.equal(blockers.length, 3);
  assert(blockers.every((blocker) => blocker.blockingItemType === "CLOSE_TASK_INSTANCE"));
  assert(blockers.some((blocker) => blocker.code === "CLOSE_TASK_UNRESOLVED"));
  assert(blockers.some((blocker) => blocker.code === "CLOSE_TASK_EVIDENCE_MISSING"));
  assert(blockers.some((blocker) => blocker.code === "CLOSE_TASK_SOURCE_CHECK_FAILED"));
  assert(!blockers.some((blocker) => blocker.blockingItemId === 3));
  assert(!blockers.some((blocker) => blocker.blockingItemId === 4));

  const composed = composeCloseBlockers({
    dependencyBlockers: [],
    taskBlockers: blockers,
  });
  assert.equal(composed.length, 3);

  const alertPayloads = buildCloseTaskAlertPayloadsFromRows(rows, {
    now,
    dueSoonLeadHours: 48,
  });
  assert(alertPayloads.some((row) => row.alertKey === "TASK:1:OVERDUE"));
  assert(alertPayloads.some((row) => row.alertKey === "TASK:1:BLOCKED"));
  assert(alertPayloads.some((row) => row.alertKey === "TASK:2:DUE_SOON"));
  assert(alertPayloads.some((row) => row.alertKey === "TASK:5:BLOCKED"));
  assert(alertPayloads.some((row) => row.alertKey === "TASK:7:SOURCE_CHECK_FAILED"));
  assert(
    alertPayloads.some(
      (row) =>
        row.alertKey === "TASK:7:SOURCE_CHECK_FAILED" &&
        row.alertCode === "CLOSE_TASK_SOURCE_CHECK_FAILED" &&
        row.payload?.blockingAction === "REFRESH_SOURCE_CHECK",
    ),
  );
  assert(!alertPayloads.some((row) => row.alertKey.startsWith("TASK:3:")));
  assert(!alertPayloads.some((row) => row.alertKey.startsWith("TASK:4:")));

  const cycleServiceSource = readSource("src/services/close.cycles.service.js");
  assert(cycleServiceSource.includes("buildCloseTaskCockpitSummary"));
  assert(cycleServiceSource.includes("listCloseTaskLockBlockers"));
  assert(cycleServiceSource.includes("syncCloseTaskAlertsForCycle"));
  assert(cycleServiceSource.includes("taskBlockers"));

  const alertPersistenceSource = readSource("src/services/close.alerts-persistence.service.js");
  for (const contract of [
    "syncCloseTaskAlertsForCycle",
    "upsertCloseAlert",
    "resolveCloseTaskAlerts",
    "resolveStaleTaskAlertsForCycle",
    "subject_type",
    "subject_id",
    "CLOSE_TASK_INSTANCE",
  ]) {
    assert(alertPersistenceSource.includes(contract), `Missing alert contract: ${contract}`);
  }

  console.log("test-close-task-prctm05-cockpit-alerts passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
