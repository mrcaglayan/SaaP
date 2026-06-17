Checked `project3.zip`. **PR-CTM-01 and PR-CTM-02 look good. PR-CTM-03 is mostly implemented, but there is one blocker bug before moving to PR-CTM-04.** The implemented scope matches the final plan’s expected schema/permission/route/service direction.

## Verdict

```txt
PR-CTM-01: OK
PR-CTM-02: OK
PR-CTM-03: Mostly OK, but fix 1 blocker
```

Do **not** continue to provisioning/materialization yet until the cycle-status guard bug below is fixed.

---

## Good things I confirmed

### 1. Schema is implemented and registered

These migrations exist and are registered:

```txt
m203_close_task_management_foundation.js
m204_evidence_comments_generic_scope_for_close_tasks.js
m205_close_alerts_generic_subject.js
m206_evidence_comments_nullable_legal_entity_scope.js
```

`m206` is extra compared with the plan, but it is good because it completes the generic-scope path by making legacy `legal_entity_id` nullable for evidence/comments.

### 2. Source-ref registry gap is fixed

Backend now has:

```js
LOCAL_CLOSE_PACK;
CLOSE_TASK_INSTANCE;
```

Frontend also has:

```js
LOCAL_CLOSE_PACK;
CLOSE_TASK_INSTANCE;
```

That previous gap is fixed.

### 3. PR-CTM-03 files exist

These are implemented:

```txt
backend/src/routes/close.tasks.routes.js
backend/src/routes/close.tasks.validators.js
backend/src/services/close.tasks.service.js
backend/src/services/close.task-templates.service.js
backend/src/services/close.task-evidence.service.js
backend/src/services/close.task-comments.service.js
backend/src/services/close.task-scope.service.js
backend/src/services/close.task-source-checks.service.js
backend/src/services/close.task-events.service.js
```

Route registration is also present in:

```txt
backend/src/index.js
```

OpenAPI has close-task paths and `CANCELLED` enum entries.

### 4. The route surface matches the plan

Implemented routes include:

```txt
/task-templates
/tasks
/cycles/:cycleId/tasks
/tasks/:taskId/start
/tasks/:taskId/submit
/tasks/:taskId/return
/tasks/:taskId/approve
/tasks/:taskId/waive
/tasks/:taskId/cancel
/tasks/:taskId/reopen
/tasks/:taskId/refresh-source-check
/tasks/:taskId/events
/tasks/:taskId/evidence
/tasks/:taskId/comments
```

### 5. PR-CTM-03 contract shape is good

The service layer has:

```txt
submit
return
approve
waive
cancel
reopen
refresh-source-check
evidence attach/remove
comment create/delete
event writes
audit log writes for sensitive lifecycle actions
```

The cancellation logic is also aligned with the final guardrail:

```txt
lock-required task cancellation requires close.task.admin
creator shortcut only applies to non-lock-required manual tasks before submission
```

Good.

---

# Blocker bug to fix before PR-CTM-04

## Cycle-status guard reads the task status instead of the cycle status

In `loadCloseTaskWithCycle()`, the query selects:

```sql
cti.*,
cc.status AS cycle_status
```

So the task row has both:

```txt
status         = task lifecycle status
cycle_status  = close cycle status
```

But `assertCloseTaskCycleEditable()` currently checks:

```js
const status = toUpperText(cycleRow?.status);
```

That works when you pass an actual `close_cycles` row.

But PR-CTM-03 often passes a **task row** into this function:

```js
assertCloseTaskCycleEditable(current, "Update close task");
assertCloseTaskCycleEditable(current, eventType);
assertCloseTaskCycleEditable(task, "Attach task evidence");
assertCloseTaskCycleEditable(task, "Remove task evidence");
assertCloseTaskCycleEditable(current, "Refresh source check");
```

For those calls, `current.status` is not `OPEN`. It is usually:

```txt
NOT_STARTED
IN_PROGRESS
SUBMITTED
RETURNED
APPROVED
WAIVED
CANCELLED
```

So routine actions will incorrectly fail with:

```txt
requires an OPEN close cycle
```

even when the actual close cycle is open.

## Fix

Change `assertCloseTaskCycleEditable()` to prefer `cycle_status` when available:

```js
export function assertCloseTaskCycleEditable(
  cycleRow,
  actionLabel = "task mutation",
) {
  const status = toUpperText(cycleRow?.cycle_status ?? cycleRow?.status);

  if (!CLOSE_TASK_EDITABLE_CYCLE_STATUSES.includes(status)) {
    const err = new Error(`${actionLabel} requires an OPEN close cycle`);
    err.status = 409;
    err.code = "CLOSE_TASK_CYCLE_NOT_EDITABLE";
    err.details = { cycleStatus: status || null };
    throw err;
  }
}
```

Then add a regression test:

```js
assert.doesNotThrow(() =>
  assertCloseTaskCycleEditable(
    { status: "NOT_STARTED", cycle_status: "OPEN" },
    "Submit task",
  ),
);

assert.throws(() =>
  assertCloseTaskCycleEditable(
    { status: "NOT_STARTED", cycle_status: "LOCKED" },
    "Submit task",
  ),
);
```

This is the only real blocker I found.

---

## Smaller follow-up items

### 1. Comment audit is not complete yet

`COMMENT_ADDED` writes to `close_task_events`, but it is not included in `CLOSE_TASK_AUDITED_EVENT_TYPES`.

That may be acceptable if you intend to harden comments in PR-CTM-07, but since comment routes already exist, I would add `COMMENT_ADDED` to central audit now or clearly mark it as PR-CTM-07.

### 2. Comment delete does not write a task event

`createCloseTaskComment()` writes `COMMENT_ADDED`.

`deleteCloseTaskComment()` currently soft-deletes the comment but does not write a task event.

Not a blocker for PR-CTM-03, but PR-CTM-07 should add either:

```txt
COMMENT_DELETED
```

or at least an audit log entry.

### 3. Evidence upload/download are placeholders

These currently return `501 NOT_IMPLEMENTED`.

That is okay because storage adapter work belongs to PR-CTM-07, but the frontend should not expose upload/download as working yet.

### 4. I could not run all tests from the zip

These passed:

```bash
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
```

This failed only because dependencies are not installed in the extracted zip:

```bash
npm run test:close-tasks:prctm03
```

Error:

```txt
Cannot find package 'mysql2'
```

And scope/SoD tests similarly need installed dependencies such as `redis`.

After `npm install`, run:

```bash
cd backend
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
npm run test:close-tasks:scope
npm run test:close-tasks:sod
npm run test:close-tasks:prctm03
```

---

## Final assessment

The implementation is **good overall**.

But fix this before continuing:

```txt
assertCloseTaskCycleEditable must check cycle_status when a joined task row is passed.
```

After that fix, I would consider PR-CTM-01/02/03 acceptable and safe to continue into:

```txt
PR-CTM-04 - Template materialization during close-cycle provisioning
```
