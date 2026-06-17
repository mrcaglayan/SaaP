import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool } from "../src/db.js";
import "../src/routes/close.tasks.routes.js";
import {
  assertCloseTaskCycleEditable,
  isCloseTaskSourceCheckMode,
  isCloseTaskTerminalStatus,
  normalizeCloseTaskStatus,
} from "../src/services/close.task-scope.service.js";
import { parseCloseTaskActionInput } from "../src/routes/close.tasks.validators.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function expectThrow(fn, status) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, "Expected function to throw");
  if (status) {
    assert.equal(thrown.status, status);
  }
  return thrown;
}

async function main() {
  assert.equal(normalizeCloseTaskStatus("submitted"), "SUBMITTED");
  assert.equal(isCloseTaskTerminalStatus("APPROVED"), true);
  assert.equal(isCloseTaskTerminalStatus("IN_PROGRESS"), false);
  assert.equal(isCloseTaskSourceCheckMode("SYSTEM_CHECK"), true);
  assert.equal(isCloseTaskSourceCheckMode("MANUAL"), false);

  assert.doesNotThrow(() => assertCloseTaskCycleEditable({ status: "OPEN" }, "Submit task"));
  const lockedError = expectThrow(
    () => assertCloseTaskCycleEditable({ status: "LOCKED" }, "Submit task"),
    409,
  );
  assert.equal(lockedError.code, "CLOSE_TASK_CYCLE_NOT_EDITABLE");

  const fakeReq = {
    params: { taskId: "42" },
    body: {},
    user: { tenantId: 10, userId: 20 },
  };
  expectThrow(() => parseCloseTaskActionInput(fakeReq, { requireReason: true }), 400);

  const routesSource = readSource("src/routes/close.tasks.routes.js");
  for (const pathFragment of [
    '"/task-templates"',
    '"/task-templates/:templateId"',
    '"/task-templates/:templateId/disable"',
    '"/tasks"',
    '"/cycles/:cycleId/tasks"',
    '"/tasks/:taskId"',
    '"/tasks/:taskId/start"',
    '"/tasks/:taskId/submit"',
    '"/tasks/:taskId/return"',
    '"/tasks/:taskId/approve"',
    '"/tasks/:taskId/waive"',
    '"/tasks/:taskId/cancel"',
    '"/tasks/:taskId/reopen"',
    '"/tasks/:taskId/refresh-source-check"',
    '"/tasks/:taskId/events"',
    '"/tasks/:taskId/evidence"',
    '"/tasks/:taskId/comments"',
  ]) {
    assert(routesSource.includes(pathFragment), `Missing route ${pathFragment}`);
  }

  for (const permissionCode of [
    "close.task.read",
    "close.task.template.read",
    "close.task.template.write",
    "close.task.create",
    "close.task.assign",
    "close.task.work",
    "close.task.review",
    "close.task.waive",
    "close.task.admin",
  ]) {
    assert(routesSource.includes(permissionCode), `Missing permission ${permissionCode}`);
  }

  const serviceSource = readSource("src/services/close.tasks.service.js");
  for (const eventType of [
    "SUBMITTED",
    "RETURNED",
    "APPROVED",
    "WAIVED",
    "CANCELLED",
    "REOPENED",
  ]) {
    assert(serviceSource.includes(`eventType: "${eventType}"`), `Missing ${eventType} event write`);
  }
  assert(serviceSource.includes("countActiveEvidenceForTask"));
  assert(serviceSource.includes("Reviewer cannot approve their own submitted task"));
  assert(serviceSource.includes("Cancelling this task requires close task admin authority"));

  const openApiSource = readSource("openapi.yaml");
  assert(openApiSource.includes('"name": "Close"'));
  assert(openApiSource.includes('"/api/v1/close/task-templates"'));
  assert(openApiSource.includes('"/api/v1/close/tasks/{taskId}/refresh-source-check"'));
  assert(openApiSource.includes('"/api/v1/close/tasks/{taskId}/comments"'));
  assert(openApiSource.includes('"/api/v1/close/tasks/{taskId}/evidence"'));

  console.log("test-close-task-prctm03-contract passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
