Checked the final plan and the new `project (2)` zip. Verdict: **the first implemented steps are mostly okay and aligned with the plan.** The schema foundation and permissions/role/SoD work are in place. The remaining points are not major architecture conflicts, but I would fix one small registry gap before continuing to PR-CTM-03. The final plan itself now contains the extra guardrails we locked earlier, including `CANCELLED`, `book_id`, durable task alerts, `cycle_scope_kind`, source-check fields, and explicit alert persistence requirements.

## What looks good

### 1. PR-CTM-01 schema foundation is mostly implemented correctly

These files exist and are registered in `backend/src/migrations/index.js`:

```txt
m203_close_task_management_foundation.js
m204_evidence_comments_generic_scope_for_close_tasks.js
m205_close_alerts_generic_subject.js
```

`m203` correctly creates:

```txt
close_task_templates
close_task_instances
close_task_evidence
close_task_events
```

The important plan decisions are present:

```txt
cycle_scope_kind
rbac_scope_type / rbac_scope_id / rbac_scope_key
work_scope_type / work_scope_id / work_scope_key
book_id
completion_mode
source_check_code
source_ref_type
source_ref_id
source_check_status
source_checked_at
source_check_payload_json
CANCELLED status
required_for_cycle_lock
close_task_evidence soft removal
close_task_events lifecycle trail
```

So the core schema is aligned.

### 2. `m204` generic evidence/comment scope is partially correct

It adds:

```txt
scope_type
scope_id
scope_key
```

to both:

```txt
evidence_objects
internal_comments
```

It also backfills existing rows to:

```txt
LEGAL_ENTITY:<legal_entity_id>
```

That matches the plan.

One note: `legal_entity_id` is still `NOT NULL`. That is okay **only as a compatibility phase**. It means true country/group task evidence or comments still cannot be inserted without a legal entity until a later migration makes `legal_entity_id` nullable or you use the fallback strategy.

So: **not a blocker for PR-CTM-01/02**, but it must be finished before country/group task evidence/comment routes are enabled.

### 3. `m205` durable alert subject columns are correctly added

It adds:

```txt
subject_type
subject_id
```

and indexes for:

```txt
tenant_id, subject_type, subject_id, alert_state
tenant_id, close_cycle_id, subject_type, alert_state, severity
```

This matches the durable alert plan.

### 4. PR-CTM-02 permissions and roles are implemented

I found the new permissions in `seedCore.js`:

```txt
close.task.read
close.task.template.read
close.task.template.write
close.task.create
close.task.assign
close.task.work
close.task.review
close.task.waive
close.task.admin
```

Permission groups are present:

```txt
close.task.viewer
close.task.preparer
close.task.reviewer
close.task.waiver
close.task.admin
```

Role presets are also present:

```txt
CloseTaskViewer
CloseTaskPreparer
CloseTaskReviewer
CloseTaskWaiverAuthority
CloseTaskAdmin
```

Frontend role catalog entries are also added.

### 5. SoD rules are present

The maker-checker warnings are implemented for:

```txt
close.task.work + close.task.review
close.task.work + close.task.waive
```

They are warnings, not hard errors, which matches the agreed plan.

### 6. Close-task RBAC scope helpers are added

`authz.scope.service.js` now has close-task scope functions for:

```txt
normalizeCloseTaskRbacScope
resolveCloseTaskRbacScope
isCloseTaskScopeAllowed
checkUserCanReadCloseTaskAtScope
checkUserCanCreateCloseTaskAtScope
checkUserCanAssignCloseTaskAtScope
checkUserCanAdministerCloseTaskAtScope
checkUserCanWorkCloseTask
checkUserCanReviewCloseTask
checkUserCanWaiveCloseTask
checkUserCanWriteCloseTaskTemplates
```

The important part is correct: task RBAC scope allows:

```txt
OPERATING_UNIT
LEGAL_ENTITY
COUNTRY
GROUP
```

and rejects `TENANT` for task-instance RBAC scope.

## Issues / follow-up fixes

### 1. Fix source-ref registry before PR-CTM-03

This is the main thing I would fix now.

Current backend source-ref registry has:

```txt
LOCAL_CLOSE_PACK
```

but does **not** have:

```txt
CLOSE_TASK_INSTANCE
```

Current frontend source-ref registry has neither:

```txt
LOCAL_CLOSE_PACK
CLOSE_TASK_INSTANCE
```

The final plan says this is part of PR-CTM-07, but because `m204` and `m205` already introduce generic task evidence/comment/alert concepts, I would add these constants now before routes/services start.

Add to:

```txt
backend/src/utils/source-ref-types.js
frontend/src/utils/sourceRefTypes.js
```

```js
export const CLOSE_TASK_INSTANCE = "CLOSE_TASK_INSTANCE";
```

And in frontend also add:

```js
export const LOCAL_CLOSE_PACK = "LOCAL_CLOSE_PACK";
```

Then include both inside `SOURCE_REF_TYPES`.

### 2. `m204` is not enough yet for true country/group evidence/comments

As mentioned, `m204` adds generic scope columns and backfills, but does not make `legal_entity_id` nullable.

That means this is not yet possible cleanly:

```txt
scope_type = GROUP
scope_id = 3
legal_entity_id = NULL
source_ref_type = CLOSE_TASK_INSTANCE
```

So before enabling country/group task evidence or comments, choose one:

```txt
Option A: add a later migration making legal_entity_id nullable safely
Option B: require a selected member legal entity for country/group task evidence
```

Your plan prefers Option A. That is fine, but implementation should not forget it.

### 3. Tests could not be fully run from the zip

I tried running:

```bash
npm run test:close-tasks:scope
npm run test:close-tasks:sod
```

but the zip does not include `node_modules`, so Node failed on the missing `redis` package import. `package.json` does declare `redis`, so this is likely just because dependencies are not installed in the extracted zip.

I did run syntax checks on the new migration and test files; they passed:

```txt
m203_close_task_management_foundation.js
m204_evidence_comments_generic_scope_for_close_tasks.js
m205_close_alerts_generic_subject.js
test-close-task-scope-access.js
test-close-task-sod-rules.js
```

After `npm install`, rerun:

```bash
cd backend
npm run test:close-tasks:scope
npm run test:close-tasks:sod
```

## Not a problem yet

These are not missing for the first two PRs:

```txt
close.tasks.routes.js
close.tasks.service.js
close.task-templates.service.js
close.task-evidence.service.js
close.task-comments.service.js
close.task-source-checks.service.js
close.alerts-persistence.service.js
frontend CloseTaskBoardPage
frontend CloseTaskTemplateAdminPage
OpenAPI task routes
```

Those belong to later PRs in the plan.

## Final verdict

**PR-CTM-01 and PR-CTM-02 are acceptable to continue from.**

Before PR-CTM-03, I would make this small patch:

```txt
1. Add CLOSE_TASK_INSTANCE to backend source-ref registry.
2. Add LOCAL_CLOSE_PACK and CLOSE_TASK_INSTANCE to frontend source-ref registry.
3. Keep m204 legal_entity_id limitation documented as “generic-scope phase 1”.
4. Run the two close-task tests after installing dependencies.
```

No major design conflict found. The implementation so far still respects the main rule: **this is a checklist task layer on top of SAAP’s close architecture, not a second close engine.**
