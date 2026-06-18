import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCloseTaskDashboardQueuesFromRows } from "../src/services/close.tasks.service.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsDir, "..");
const repoRoot = path.resolve(backendRoot, "..");

function readSource(relativePath, root = backendRoot) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

async function main() {
  const now = new Date("2026-06-18T12:00:00Z");
  const rows = [
    {
      id: 1,
      task_code: "OWNER_DUE",
      task_name: "Owner due",
      task_family: "MANUAL",
      status: "IN_PROGRESS",
      owner_user_id: 20,
      reviewer_user_id: 30,
      due_at: "2026-06-19 12:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
    },
    {
      id: 2,
      task_code: "REVIEW_ME",
      task_name: "Review me",
      task_family: "REPORTING",
      status: "SUBMITTED",
      owner_user_id: 30,
      reviewer_user_id: 20,
      due_at: "2026-06-18 13:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
    },
    {
      id: 3,
      task_code: "RETURNED_ME",
      task_name: "Returned me",
      task_family: "CERTIFICATION",
      status: "RETURNED",
      owner_user_id: 20,
      reviewer_user_id: 30,
      due_at: "2026-06-18 10:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
    },
    {
      id: 4,
      task_code: "OVERDUE_LOCK_REQUIRED",
      task_name: "Overdue lock required",
      task_family: "FX",
      status: "NOT_STARTED",
      owner_user_id: 40,
      reviewer_user_id: 20,
      due_at: "2026-06-17 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 0,
    },
    {
      id: 5,
      task_code: "CANCELLED_TASK",
      task_name: "Cancelled task",
      task_family: "FX",
      status: "CANCELLED",
      owner_user_id: 20,
      reviewer_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
    },
    {
      id: 6,
      task_code: "UNREVIEWABLE_SUBMITTED",
      task_name: "Unreviewable submitted",
      task_family: "REPORTING",
      status: "SUBMITTED",
      owner_user_id: 41,
      reviewer_user_id: 42,
      due_at: "2026-06-18 11:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
    },
  ];

  const queues = buildCloseTaskDashboardQueuesFromRows(rows, {
    userId: 20,
    reviewableTaskIds: [2],
    now,
  });
  assert.equal(queues.counts.myDueTasks, 2);
  assert.equal(queues.counts.reviewTasks, 1);
  assert.equal(queues.counts.returnedTasks, 1);
  assert.equal(queues.counts.overdueLockRequiredTasks, 1);
  assert.deepEqual(queues.reviewTasks.map((row) => row.id), [2]);
  assert(!queues.myDueTasks.some((row) => row.id === 5));
  assert(!queues.reviewTasks.some((row) => row.id === 6));
  assert(!queues.overdueLockRequiredTasks.some((row) => row.id === 5));

  const routesSource = readSource("src/routes/close.tasks.routes.js");
  const myTasksRouteIndex = routesSource.indexOf('"/tasks/my"');
  const summaryRouteIndex = routesSource.indexOf('"/tasks/summary"');
  const taskIdRouteIndex = routesSource.indexOf('"/tasks/:taskId"');
  assert(myTasksRouteIndex >= 0 && taskIdRouteIndex >= 0 && myTasksRouteIndex < taskIdRouteIndex);
  assert(summaryRouteIndex >= 0 && summaryRouteIndex < taskIdRouteIndex);
  for (const routeContract of [
    '"/tasks/my"',
    '"/tasks/summary"',
    '"/cycles/:cycleId/tasks/summary"',
    "listMyCloseTaskQueues(input",
    "buildCloseTaskSummary(input",
  ]) {
    assert(routesSource.includes(routeContract), `Missing route contract: ${routeContract}`);
  }

  const validatorsSource = readSource("src/routes/close.tasks.validators.js");
  for (const validatorContract of [
    "parseCloseTaskMyQueuesInput",
    "parseCloseTaskSummaryInput",
    "parseCloseCycleTaskSummaryInput",
  ]) {
    assert(
      validatorsSource.includes(validatorContract),
      `Missing validator contract: ${validatorContract}`,
    );
  }

  const serviceSource = readSource("src/services/close.tasks.service.js");
  for (const serviceContract of [
    "export async function buildCloseTaskSummary",
    "export async function listMyCloseTaskQueues",
    "checkUserCanReviewCloseTask(userId",
    "status === \"SUBMITTED\"",
    "requiredForCycleLock && row.overdue",
  ]) {
    assert(serviceSource.includes(serviceContract), `Missing service contract: ${serviceContract}`);
  }

  const apiSource = readSource("frontend/src/api/closeTasks.js", repoRoot);
  for (const apiContract of [
    "getMyCloseTaskQueues",
    "/api/v1/close/tasks/my",
    "getCloseTaskSummary",
    "getCloseCycleTaskSummary",
  ]) {
    assert(apiSource.includes(apiContract), `Missing frontend API contract: ${apiContract}`);
  }

  const dashboardSource = readSource("frontend/src/pages/Dashboard.jsx", repoRoot);
  for (const dashboardContract of [
    "getMyCloseTaskQueues",
    "canReadCloseTasks",
    "closeTaskQueues",
    "Awaiting My Review",
    "Overdue Lock-Required",
    "CLOSE_TASKS_PATH",
  ]) {
    assert(
      dashboardSource.includes(dashboardContract),
      `Missing dashboard contract: ${dashboardContract}`,
    );
  }

  const openApiSource = readSource("openapi.yaml");
  for (const pathContract of [
    '"/api/v1/close/tasks/my"',
    '"/api/v1/close/tasks/summary"',
    '"/api/v1/close/cycles/{cycleId}/tasks/summary"',
  ]) {
    assert(openApiSource.includes(pathContract), `Missing OpenAPI path: ${pathContract}`);
  }

  console.log("test-close-task-prctm08-reporting-dashboard passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
