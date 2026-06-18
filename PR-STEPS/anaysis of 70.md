Checked `project7.zip`. Verdict: **PR-CTM-07 is mostly implemented correctly, but I found one important data-integrity/security issue before moving to PR-CTM-08.** The upload/download implementation is no longer a placeholder, comments now write audit/event coverage, and the frontend exposes upload/download properly. This matches the final plan’s PR-CTM-07 scope: real evidence upload/download, storage adapter integration, evidence/comment access through close-task scope, and audit hardening.

## Status

```txt
PR-CTM-01: OK
PR-CTM-02: OK
PR-CTM-03: OK
PR-CTM-04: OK
PR-CTM-05: OK
PR-CTM-06: OK
PR-CTM-07: Mostly OK, but fix 1 blocker before PR-CTM-08
```

## What looks good

The PR-CTM-07 files are implemented:

```txt
backend/src/services/close.task-evidence.service.js
backend/src/services/close.task-comments.service.js
backend/src/services/close.task-events.service.js
backend/src/routes/close.tasks.routes.js
frontend/src/pages/CloseTaskBoardPage.jsx
frontend/src/api/closeTasks.js
```

Evidence upload/download is now real, not `501`:

```txt
PUT /api/v1/close/tasks/:taskId/evidence/:evidenceId/content
GET /api/v1/close/tasks/:taskId/evidence/:evidenceId/download
```

The service now handles:

```txt
binary upload
storage path creation
gzip/none compression
sha256 hash
stored size verification
read-back integrity check
download integrity check
previous file cleanup after replacement
soft removal of task-evidence link
reattach behavior
```

The frontend now exposes:

```txt
choose file
upload
download
remove evidence
comments
```

The comment side is also improved:

```txt
COMMENT_ADDED writes close_task_events
COMMENT_ADDED writes central audit_logs
comment delete writes central audit_logs
comments use CLOSE_TASK_INSTANCE source ref
```

The PR-CTM-07 static tests pass:

```bash
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
npm run test:close-tasks:prctm07
```

I also syntax-checked the main PR-CTM-07 backend files successfully.

---

# Blocker — attaching evidence can hijack evidence from another module/task

In `attachCloseTaskEvidence()`, the service loads any `evidence_objects` row by:

```sql
tenant_id = ?
AND id = ?
```

Then it updates that same evidence object:

```sql
SET source_ref_type = 'CLOSE_TASK_INSTANCE',
    source_ref_id = taskId,
    scope_type = task.rbac_scope_type,
    scope_id = task.rbac_scope_id,
    scope_key = task.rbac_scope_key
```

That means a user who has `close.task.work` on one task could enter an evidence object ID belonging to another source, for example:

```txt
CARI_DOCUMENT evidence
LOCAL_CLOSE_PACK evidence
FIXED_ASSET evidence
another close task evidence
```

and the system would reassign that evidence object to the current task.

That is dangerous because it can:

```txt
steal evidence from another module
break the original document’s evidence link
change source_ref_type/source_ref_id unexpectedly
cause cross-scope evidence leakage
corrupt evidence ownership/history
```

## Required fix

Before attaching an existing evidence object, enforce one of these rules.

### Recommended rule

Allow attach only when the evidence object is already one of these:

```txt
source_ref_type = 'CLOSE_TASK_INSTANCE' AND source_ref_id = current task id
```

or:

```txt
source_ref_type is NULL / explicitly unassigned draft
```

But because the original `evidence_objects.source_ref_type` is `NOT NULL`, you likely do not have true unassigned drafts yet.

So practically, for now:

```txt
Reject evidence objects whose source_ref_type/source_ref_id belong to another source.
```

Example service guard:

```js
const existingSourceType = String(
  evidenceObject.source_ref_type || "",
).toUpperCase();
const existingSourceId = parsePositiveInt(evidenceObject.source_ref_id);

if (
  existingSourceType &&
  (existingSourceType !== CLOSE_TASK_INSTANCE || existingSourceId !== taskId)
) {
  throw badRequest("Evidence object is already attached to another source");
}
```

Then add one of these next:

```txt
Option A: add a close-task evidence draft creation endpoint
Option B: create evidence object automatically when uploading from task UI
```

For clean UX, I would add this route:

```txt
POST /api/v1/close/tasks/:taskId/evidence/drafts
```

Payload:

```json
{
  "fileName": "bank-reconciliation.pdf",
  "displayName": "Bank reconciliation evidence",
  "contentType": "application/pdf",
  "note": "May close evidence"
}
```

It should create `evidence_objects` already scoped to:

```txt
source_ref_type = CLOSE_TASK_INSTANCE
source_ref_id = taskId
scope_type = task.rbac_scope_type
scope_id = task.rbac_scope_id
scope_key = task.rbac_scope_key
```

Then upload content to that evidence row.

This avoids the current “type evidence object id manually” workflow and prevents accidental/harmful reassignment.

---

## Smaller follow-ups, not blockers

### 1. Comment delete has audit but no task event

Current implementation intentionally avoids adding `COMMENT_DELETED` to `close_task_events`, and writes only central audit. That is acceptable for now because you left a code comment explaining it.

For full lifecycle consistency, later I would add:

```txt
COMMENT_DELETED
```

to `close_task_events`.

### 2. Comment delete does not check affected row count

If a nonexistent comment ID is deleted, the service still returns the refreshed comment list. Better behavior would be:

```txt
if affectedRows = 0, return 404
```

Not a blocker.

### 3. Evidence object draft UX is still rough

The frontend currently asks the user for:

```txt
Evidence object id
```

That is acceptable technically, but not good for normal users. PR-CTM-08 or a small PR-CTM-07 patch should add a proper “Create evidence draft + upload file” flow.

---

## Test status

These passed from the uploaded zip:

```bash
cd backend
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
npm run test:close-tasks:prctm07
```

DB-dependent tests still cannot run here because dependencies are not installed in the extracted zip. The expected error remains:

```txt
Cannot find package 'mysql2'
```

Run locally after `npm install`:

```bash
cd backend
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
npm run test:close-tasks:scope
npm run test:close-tasks:sod
npm run test:close-tasks:prctm03
npm run test:close-tasks:materialization
npm run test:close-tasks:prctm05
npm run test:close-tasks:prctm07
```

## Final verdict

Do **not** move to PR-CTM-08 yet until this is patched:

```txt
Prevent close-task evidence attach from reassigning evidence objects that already belong to another source.
```

After that patch, PR-CTM-07 will be acceptable. Everything else is either good or a small follow-up.
