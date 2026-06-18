import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool } from "../../src/db.js";
import {
  buildCloseTaskCockpitSummaryFromRows,
  buildCloseTaskDashboardQueuesFromRows,
  buildCloseTaskLockBlockersFromRows,
} from "../../src/services/close.tasks.service.js";
import { buildCloseTaskAlertPayloadsFromRows } from "../../src/services/close.alerts-persistence.service.js";
import {
  assertCloseTaskCycleEditable,
  isCloseTaskTerminalStatus,
  normalizeCloseTaskStatus,
} from "../../src/services/close.task-scope.service.js";
import {
  CLOSE_TASK_AUDITED_EVENT_TYPES,
  CLOSE_TASK_EVENT_TYPES,
} from "../../src/services/close.task-events.service.js";
import {
  CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS,
  mergeCloseTaskTemplatesByCode,
} from "../../src/services/close.task-templates.service.js";

const scriptsLibDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptsLibDir, "../..");
const repoRoot = path.resolve(backendRoot, "..");
const NOW = new Date("2026-06-18T12:00:00Z");

function readBackend(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function readRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertIncludes(source, contracts, label) {
  for (const contract of contracts) {
    assert(source.includes(contract), `${label} missing contract: ${contract}`);
  }
}

function assertMatches(source, pattern, label) {
  assert(pattern.test(source), `${label} missing pattern: ${pattern}`);
}

function expectStatusThrow(fn, status) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, "Expected function to throw");
  assert.equal(thrown.status, status);
  return thrown;
}

function sampleTaskRows() {
  return [
    {
      id: 1,
      close_cycle_id: 10,
      task_code: "LOCK_REQUIRED_OPEN",
      task_name: "Required open task",
      task_family: "MANUAL",
      status: "IN_PROGRESS",
      owner_user_id: 20,
      reviewer_user_id: 30,
      due_at: "2026-06-17 08:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 0,
      evidence_count: 0,
      work_scope_type: "BOOK",
      work_scope_id: 8,
      book_id: 8,
    },
    {
      id: 2,
      close_cycle_id: 10,
      task_code: "SUBMITTED_TO_ME",
      task_name: "Submitted to me",
      task_family: "REPORTING",
      status: "SUBMITTED",
      owner_user_id: 30,
      reviewer_user_id: 20,
      due_at: "2026-06-18 18:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
      evidence_count: 0,
    },
    {
      id: 3,
      close_cycle_id: 10,
      task_code: "RETURNED_TO_ME",
      task_name: "Returned to me",
      task_family: "CERTIFICATION",
      status: "RETURNED",
      owner_user_id: 20,
      reviewer_user_id: 30,
      due_at: "2026-06-18 10:00:00",
      required_for_cycle_lock: 0,
      evidence_required: 0,
      evidence_count: 0,
    },
    {
      id: 4,
      close_cycle_id: 10,
      task_code: "WAIVED_REQUIRED",
      task_name: "Waived required task",
      task_family: "CERTIFICATION",
      status: "WAIVED",
      owner_user_id: 20,
      reviewer_user_id: 30,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 0,
    },
    {
      id: 5,
      close_cycle_id: 10,
      task_code: "CANCELLED_REQUIRED",
      task_name: "Cancelled required task",
      task_family: "CERTIFICATION",
      status: "CANCELLED",
      owner_user_id: 20,
      reviewer_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 0,
    },
    {
      id: 6,
      close_cycle_id: 10,
      task_code: "APPROVED_MISSING_EVIDENCE",
      task_name: "Approved missing evidence",
      task_family: "CERTIFICATION",
      status: "APPROVED",
      owner_user_id: 30,
      reviewer_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 0,
    },
    {
      id: 7,
      close_cycle_id: 10,
      task_code: "APPROVED_FAILED_SOURCE_CHECK",
      task_name: "Approved failed source check",
      task_family: "FX",
      status: "APPROVED",
      owner_user_id: 30,
      reviewer_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 0,
      evidence_count: 0,
      source_check_status: "FAILED",
    },
    {
      id: 8,
      close_cycle_id: 10,
      task_code: "APPROVED_WITH_EVIDENCE",
      task_name: "Approved with evidence",
      task_family: "CERTIFICATION",
      status: "APPROVED",
      owner_user_id: 30,
      reviewer_user_id: 20,
      due_at: "2026-06-16 10:00:00",
      required_for_cycle_lock: 1,
      evidence_required: 1,
      evidence_count: 1,
    },
  ];
}

function assertOpenApiContracts() {
  const openApiSource = readBackend("openapi.yaml");
  assertIncludes(
    openApiSource,
    [
      '"/api/v1/close/task-templates"',
      '"/api/v1/close/tasks"',
      '"/api/v1/close/tasks/my"',
      '"/api/v1/close/tasks/summary"',
      '"/api/v1/close/cycles/{cycleId}/tasks"',
      '"/api/v1/close/cycles/{cycleId}/tasks/summary"',
      '"/api/v1/close/tasks/{taskId}/refresh-source-check"',
      '"/api/v1/close/tasks/{taskId}/evidence"',
      '"/api/v1/close/tasks/{taskId}/comments"',
      '"CANCELLED"',
    ],
    "OpenAPI close task contract",
  );
}

function assertSchemaContracts() {
  const migrationIndexSource = readBackend("src/migrations/index.js");
  assertIncludes(
    migrationIndexSource,
    [
      "migration203CloseTaskManagementFoundation",
      "migration204EvidenceCommentsGenericScopeForCloseTasks",
      "migration205CloseAlertsGenericSubject",
      "migration206EvidenceCommentsNullableLegalEntityScope",
    ],
    "migration index",
  );

  const m203Source = readBackend("src/migrations/m203_close_task_management_foundation.js");
  assertIncludes(
    m203Source,
    [
      "close_task_templates",
      "close_task_instances",
      "close_task_evidence",
      "close_task_events",
      "cycle_scope_kind",
      "rbac_scope_type",
      "work_scope_type",
      "book_id",
      "source_check_status",
      "source_checked_at",
      "source_check_payload_json",
      "required_for_cycle_lock",
      "CANCELLED",
      "uk_close_task_instances_cycle_key",
    ],
    "m203 close task schema",
  );

  const m204Source = readBackend("src/migrations/m204_evidence_comments_generic_scope_for_close_tasks.js");
  assertIncludes(
    m204Source,
    [
      "evidence_objects",
      "internal_comments",
      "scope_type",
      "scope_id",
      "scope_key",
      "CONCAT('LEGAL_ENTITY:', legal_entity_id)",
      "ix_evidence_objects_generic_scope_source",
      "ix_internal_comments_generic_scope",
    ],
    "m204 generic scope backfill",
  );

  const m205Source = readBackend("src/migrations/m205_close_alerts_generic_subject.js");
  assertIncludes(
    m205Source,
    ["subject_type", "subject_id", "ix_close_alerts_subject_state"],
    "m205 durable alert subject",
  );

  const m206Source = readBackend(
    "src/migrations/m206_evidence_comments_nullable_legal_entity_scope.js",
  );
  assertIncludes(
    m206Source,
    [
      "evidence_objects",
      "internal_comments",
      "MODIFY COLUMN legal_entity_id BIGINT UNSIGNED NULL",
      "fk_evidence_objects_legal_entity",
    ],
    "m206 nullable generic scope",
  );

  assertOpenApiContracts();
}

function assertLifecycleContracts() {
  assert.equal(normalizeCloseTaskStatus("submitted"), "SUBMITTED");
  assert.equal(isCloseTaskTerminalStatus("APPROVED"), true);
  assert.equal(isCloseTaskTerminalStatus("WAIVED"), true);
  assert.equal(isCloseTaskTerminalStatus("CANCELLED"), true);
  assert.equal(isCloseTaskTerminalStatus("RETURNED"), false);
  assert.doesNotThrow(() => assertCloseTaskCycleEditable({ status: "OPEN" }, "Submit task"));
  for (const status of ["LOCKED", "CLOSED", "IN_REVIEW"]) {
    const err = expectStatusThrow(
      () => assertCloseTaskCycleEditable({ status }, "Submit task"),
      409,
    );
    assert.equal(err.code, "CLOSE_TASK_CYCLE_NOT_EDITABLE");
  }

  const serviceSource = readBackend("src/services/close.tasks.service.js");
  assertIncludes(
    serviceSource,
    [
      'eventType: "STARTED"',
      'eventType: "SUBMITTED"',
      'eventType: "RETURNED"',
      'eventType: "APPROVED"',
      'eventType: "WAIVED"',
      'eventType: "CANCELLED"',
      'eventType: "REOPENED"',
      "Reviewer cannot approve their own submitted task",
      "Cancelling this task requires close task admin authority",
      "Only terminal tasks can be reopened",
    ],
    "close task lifecycle service",
  );
  assert(CLOSE_TASK_EVENT_TYPES.includes("CANCELLED"));
  assert(CLOSE_TASK_AUDITED_EVENT_TYPES.includes("CANCELLED"));

  const routesSource = readBackend("src/routes/close.tasks.routes.js");
  assertIncludes(
    routesSource,
    [
      '"/tasks/:taskId/start"',
      '"/tasks/:taskId/submit"',
      '"/tasks/:taskId/return"',
      '"/tasks/:taskId/approve"',
      '"/tasks/:taskId/waive"',
      '"/tasks/:taskId/cancel"',
      '"/tasks/:taskId/reopen"',
    ],
    "close task lifecycle routes",
  );
}

function assertCancelledContracts() {
  const rows = sampleTaskRows();
  const summary = buildCloseTaskCockpitSummaryFromRows(rows, { userId: 20, now: NOW });
  assert.equal(summary.counts.cancelled, 1);
  assert(!summary.rows.find((row) => row.id === 5)?.overdue);
  assert(!summary.rows.find((row) => row.id === 5)?.evidenceMissing);
  assert(!summary.rows.find((row) => row.id === 5)?.lockBlocking);

  const queues = buildCloseTaskDashboardQueuesFromRows(rows, {
    userId: 20,
    reviewableTaskIds: [2, 5],
    now: NOW,
  });
  assert(!queues.myDueTasks.some((row) => row.id === 5));
  assert(!queues.reviewTasks.some((row) => row.id === 5));
  assert(!queues.overdueLockRequiredTasks.some((row) => row.id === 5));

  const alerts = buildCloseTaskAlertPayloadsFromRows(rows, { now: NOW, dueSoonLeadHours: 48 });
  assert(!alerts.some((row) => row.alertKey.startsWith("TASK:5:")));

  const boardSource = readRepo("frontend/src/pages/CloseTaskBoardPage.jsx");
  assertIncludes(
    boardSource,
    [
      'TERMINAL_TASK_STATUSES = new Set(["APPROVED", "WAIVED", "CANCELLED"])',
      'return l("Cancelled", "Iptal edildi")',
    ],
    "frontend cancelled task handling",
  );
  const cockpitSource = readRepo("frontend/src/pages/CloseCockpitPage.jsx");
  assertIncludes(cockpitSource, ['return l("Cancelled", "Iptal edildi")'], "cockpit label");
  assertOpenApiContracts();
}

function assertSourceCheckContracts() {
  const serviceSource = readBackend("src/services/close.tasks.service.js");
  assertIncludes(
    serviceSource,
    [
      "refreshCloseTaskSourceCheck",
      "evaluateCloseTaskSourceCheck(current)",
      "source_check_status = ?",
      "source_checked_at = CURRENT_TIMESTAMP",
      "source_check_payload_json = ?",
      "serializeJson(result.payload)",
    ],
    "source-check persistence",
  );
  const evaluatorSource = readBackend("src/services/close.task-source-checks.service.js");
  assertIncludes(
    evaluatorSource,
    ["NOT_WIRED", "NOT_CONFIGURED", "isCloseTaskSourceCheckMode"],
    "source-check evaluator",
  );
  const frontendApiSource = readRepo("frontend/src/api/closeTasks.js");
  assertIncludes(
    frontendApiSource,
    ["refreshCloseTaskSourceCheck", '"refresh-source-check"'],
    "frontend source-check API",
  );
  const boardSource = readRepo("frontend/src/pages/CloseTaskBoardPage.jsx");
  assertIncludes(
    boardSource,
    ["SOURCE_CHECK_REFRESH_MODES", 'handleLifecycle("refreshSourceCheck"'],
    "frontend source-check action",
  );
}

function assertEvidenceContracts() {
  const evidenceSource = readBackend("src/services/close.task-evidence.service.js");
  assertIncludes(
    evidenceSource,
    [
      "createCloseTaskEvidenceDraft",
      "uploadCloseTaskEvidenceContent",
      "downloadCloseTaskEvidence",
      "CLOSE_TASK_INSTANCE",
      "scope_type",
      "scope_id",
      "scope_key",
      "writeEvidenceBinary",
      "readEvidenceBinary",
      "fileSha256",
      'eventType: "EVIDENCE_ATTACHED"',
      'eventType: "EVIDENCE_REMOVED"',
    ],
    "task evidence service",
  );
  const taskServiceSource = readBackend("src/services/close.tasks.service.js");
  assertIncludes(
    taskServiceSource,
    [
      "Evidence is required before this task can be submitted",
      "Evidence is required before this task can be approved",
    ],
    "evidence-required lifecycle guards",
  );
  const frontendApiSource = readRepo("frontend/src/api/closeTasks.js");
  assertIncludes(
    frontendApiSource,
    ["createCloseTaskEvidenceDraft", "uploadCloseTaskEvidenceContent", "downloadCloseTaskEvidence"],
    "frontend evidence API",
  );
}

function assertCommentContracts() {
  const commentsSource = readBackend("src/services/close.task-comments.service.js");
  assertIncludes(
    commentsSource,
    [
      "internal_comments",
      "CLOSE_TASK_INSTANCE",
      "scope_type",
      "scope_id",
      "scope_key",
      'eventType: "COMMENT_ADDED"',
      "close.task.comment_deleted",
      "affectedRows",
    ],
    "task comments service",
  );
  assert(CLOSE_TASK_AUDITED_EVENT_TYPES.includes("COMMENT_ADDED"));
  const frontendApiSource = readRepo("frontend/src/api/closeTasks.js");
  assertIncludes(
    frontendApiSource,
    ["listCloseTaskComments", "createCloseTaskComment", "deleteCloseTaskComment"],
    "frontend comments API",
  );
}

function assertTemplateMaterializationContracts() {
  const expectedCodes = [
    "BANK_RECON_COMPLETED",
    "CASH_RECON_COMPLETED",
    "INVENTORY_NEGATIVE_STOCK_CHECK",
    "AP_UNPOSTED_CLEARED",
    "AR_AGING_REVIEWED",
    "PAYROLL_POSTED",
    "IC_133_333_MATCHED",
    "FX_RATES_ENTERED",
    "DEPRECIATION_POSTED",
    "TRIAL_BALANCE_REVIEWED",
    "ENTITY_CLOSE_CERTIFIED",
  ];
  assert.deepEqual(
    CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.map((definition) => definition.taskCode),
    expectedCodes,
  );
  assert(
    CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.every(
      (definition) => definition.requiredForCycleLock === false,
    ),
    "shipped close task templates must not lock cycles by default",
  );
  const merged = mergeCloseTaskTemplatesByCode([
    { tenant_id: null, task_code: "BANK_RECON_COMPLETED", status: "ACTIVE" },
    { tenant_id: 10, task_code: "BANK_RECON_COMPLETED", status: "DISABLED" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tenant_id, 10);
  assert.equal(merged[0].status, "DISABLED");

  const taskServiceSource = readBackend("src/services/close.tasks.service.js");
  assertIncludes(
    taskServiceSource,
    [
      'MATERIALIZATION_CYCLE_STATUSES = new Set(["PLANNED", "OPEN"])',
      "loadMergedCloseTaskTemplates",
      "MATERIALIZATION_TEMPLATE_STATUSES",
      "activeTemplates",
      "loadExistingCloseTaskKeysForCycle",
      "ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
    ],
    "materialization idempotency",
  );
  assertMatches(
    taskServiceSource,
    /String\(template\.status \|\| ""\)\.toUpperCase\(\) === "ACTIVE"/,
    "active template filter",
  );
  const cycleServiceSource = readBackend("src/services/close.cycles.service.js");
  assertIncludes(
    cycleServiceSource,
    ["materializeCloseTasksForCycle(cycle.id"],
    "close cycle provisioning materialization",
  );
}

function assertBlockerContracts() {
  const blockers = buildCloseTaskLockBlockersFromRows(sampleTaskRows(), { now: NOW });
  assert.equal(blockers.length, 3);
  assert(blockers.some((row) => row.code === "CLOSE_TASK_UNRESOLVED"));
  assert(blockers.some((row) => row.code === "CLOSE_TASK_EVIDENCE_MISSING"));
  assert(blockers.some((row) => row.code === "CLOSE_TASK_SOURCE_CHECK_FAILED"));
  assert(!blockers.some((row) => row.blockingItemId === 4));
  assert(!blockers.some((row) => row.blockingItemId === 5));
  assert(blockers.every((row) => row.blockingItemType === "CLOSE_TASK_INSTANCE"));
}

function assertCockpitContracts() {
  const summary = buildCloseTaskCockpitSummaryFromRows(sampleTaskRows(), { userId: 20, now: NOW });
  assert.equal(summary.total, 8);
  assert.equal(summary.counts.inProgress, 1);
  assert.equal(summary.counts.submitted, 1);
  assert.equal(summary.counts.returned, 1);
  assert.equal(summary.counts.approved, 3);
  assert.equal(summary.counts.waived, 1);
  assert.equal(summary.counts.cancelled, 1);
  assert.equal(summary.counts.lockBlocking, 3);
  assert(summary.byFamily.some((row) => row.taskFamily === "CERTIFICATION"));
  assert(!summary.myOpenTasks.some((row) => row.status === "CANCELLED"));

  const cockpitSource = readRepo("frontend/src/pages/CloseCockpitPage.jsx");
  assertIncludes(
    cockpitSource,
    ["tasks", "lockBlocking", "sourceCheckFailed", 'return l("Cancelled", "Iptal edildi")'],
    "frontend cockpit task panel",
  );
}

function assertDurableAlertContracts() {
  const alerts = buildCloseTaskAlertPayloadsFromRows(sampleTaskRows(), {
    now: NOW,
    dueSoonLeadHours: 48,
  });
  assert(alerts.some((row) => row.alertKey === "TASK:1:OVERDUE"));
  assert(alerts.some((row) => row.alertKey === "TASK:1:BLOCKED"));
  assert(alerts.some((row) => row.alertKey === "TASK:2:DUE_SOON"));
  assert(alerts.some((row) => row.alertKey === "TASK:6:BLOCKED"));
  assert(alerts.some((row) => row.alertKey === "TASK:7:SOURCE_CHECK_FAILED"));
  assert(!alerts.some((row) => row.alertKey.startsWith("TASK:5:")));

  const alertSource = readBackend("src/services/close.alerts-persistence.service.js");
  assertIncludes(
    alertSource,
    [
      "syncCloseTaskAlertsForCycle",
      "upsertCloseAlert",
      "resolveCloseTaskAlerts",
      "resolveStaleTaskAlertsForCycle",
      "subject_type",
      "subject_id",
      "CLOSE_TASK_INSTANCE",
    ],
    "durable task alert persistence",
  );
}

function assertAuditContracts() {
  for (const auditedType of [
    "SUBMITTED",
    "RETURNED",
    "APPROVED",
    "WAIVED",
    "CANCELLED",
    "REOPENED",
    "EVIDENCE_ATTACHED",
    "EVIDENCE_REMOVED",
    "ASSIGNED",
    "COMMENT_ADDED",
  ]) {
    assert(CLOSE_TASK_AUDITED_EVENT_TYPES.includes(auditedType), `Missing audit ${auditedType}`);
  }
  const eventsSource = readBackend("src/services/close.task-events.service.js");
  assertIncludes(
    eventsSource,
    [
      "writeCloseTaskAuditLog",
      "resource_type",
      "close_task_instance",
      "scope_type",
      "scope_id",
      "writeCloseTaskLifecycleEvent",
    ],
    "central close task audit log",
  );
}

function assertCycleGuardContracts() {
  assert.doesNotThrow(() => assertCloseTaskCycleEditable({ status: "OPEN" }, "Assign task"));
  for (const status of ["LOCKED", "CLOSED", "IN_REVIEW", "PLANNED"]) {
    const err = expectStatusThrow(
      () => assertCloseTaskCycleEditable({ status }, "Assign task"),
      409,
    );
    assert.equal(err.details?.cycleStatus, status);
  }
  const routesSource = readBackend("src/routes/close.tasks.routes.js");
  assertIncludes(
    routesSource,
    [
      "createManualCloseTask(input",
      "updateCloseTask(input",
      "startCloseTask(input",
      "submitCloseTask(input",
      "returnCloseTask(input",
      "approveCloseTask(input",
      "waiveCloseTask(input",
      "cancelCloseTask(input",
      "refreshCloseTaskSourceCheck(input",
    ],
    "route mutation guard coverage",
  );
}

function assertProvisionPlannedContracts() {
  const serviceSource = readBackend("src/services/close.tasks.service.js");
  assertIncludes(
    serviceSource,
    [
      'MATERIALIZATION_CYCLE_STATUSES = new Set(["PLANNED", "OPEN"])',
      "Close task materialization requires a PLANNED or OPEN close cycle",
      "lockCycleForMaterialization",
    ],
    "PLANNED materialization exception",
  );
  const cycleServiceSource = readBackend("src/services/close.cycles.service.js");
  assertIncludes(
    cycleServiceSource,
    ["materializeCloseTasksForCycle(cycle.id"],
    "provision close task materialization call",
  );
}

function assertBookScopeContracts() {
  const m203Source = readBackend("src/migrations/m203_close_task_management_foundation.js");
  assertIncludes(
    m203Source,
    ["book_id BIGINT UNSIGNED NULL", "ix_close_task_instances_entity_book_period"],
    "book-aware task schema",
  );

  const validatorsSource = readBackend("src/routes/close.tasks.validators.js");
  assertIncludes(
    validatorsSource,
    ['req.query?.bookId ?? req.query?.book_id', '"bookId"'],
    "bookId list validator",
  );

  const serviceSource = readBackend("src/services/close.tasks.service.js");
  assertIncludes(
    serviceSource,
    ["if (filters.bookId)", "cti.book_id = ?", "bookId: parsePositiveInt(row.book_id"],
    "bookId task list filter and mapper",
  );

  const boardSource = readRepo("frontend/src/pages/CloseTaskBoardPage.jsx");
  assertIncludes(
    boardSource,
    [
      'searchParams.get("bookId")',
      "bookId: toPositiveInt(bookIdFilter)",
      'updateFilter("bookId"',
    ],
    "frontend bookId filter",
  );
}

function assertDocumentationContracts() {
  const runbookSource = readRepo("docs/runbooks/close-task-management.md");
  assertIncludes(
    runbookSource,
    [
      "support schedules",
      "close tasks",
      "CloseTaskPreparer",
      "CANCELLED",
      "bookId",
      "test:close-tasks:prctm09",
    ],
    "close task runbook",
  );
  const rbacSource = readRepo("docs/runbooks/rbac-governance-operations.md");
  assertIncludes(
    rbacSource,
    ["CloseTaskViewer", "CloseTaskPreparer", "CloseTaskReviewer", "CloseTaskAdmin"],
    "RBAC runbook close task roles",
  );
}

const CHECKS = {
  schema: assertSchemaContracts,
  lifecycle: assertLifecycleContracts,
  cancelled: assertCancelledContracts,
  "source-checks": assertSourceCheckContracts,
  evidence: assertEvidenceContracts,
  comments: assertCommentContracts,
  "template-materialization": assertTemplateMaterializationContracts,
  "template-overrides": assertTemplateMaterializationContracts,
  blockers: assertBlockerContracts,
  cockpit: assertCockpitContracts,
  alerts: assertDurableAlertContracts,
  audit: assertAuditContracts,
  "cycle-guards": assertCycleGuardContracts,
  "provision-planned": assertProvisionPlannedContracts,
  "book-scope": assertBookScopeContracts,
  docs: assertDocumentationContracts,
};

/**
 * Run one or all PR-CTM-09 contract checks for close checklist tasks.
 */
export async function runCloseTaskPrctm09Check(checkName = "all") {
  try {
    const normalizedCheckName = String(checkName || "all").trim();
    const names = normalizedCheckName === "all" ? Object.keys(CHECKS) : [normalizedCheckName];
    for (const name of names) {
      const check = CHECKS[name];
      assert(check, `Unknown close task PR-CTM-09 check: ${name}`);
      check();
      console.log(`test-close-task-${name} passed`);
    }
  } finally {
    await closePool();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCloseTaskPrctm09Check(process.argv[2] || "all").catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
