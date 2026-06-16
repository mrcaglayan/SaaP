# Close Checklist Task Module

## Status

Proposed implementation plan.

## Classification

**Conflict / plan gap:** SAAP already has close cycles, cycle items, blockers,
support schedules, reconciliations, local close packs, evidence, and workflow
approvals. What is still missing is a unified human-owned close checklist task
layer where finance users can assign, submit, return, approve, waive, and attach
evidence to individual close tasks across operating-unit, legal-entity,
country, and group scopes.

**Deferred item already covered:** Do not replace `close_cycles`,
`close_cycle_items`, `local_close_packs`, `close_support_schedules`, or
`close_reconciliation_*`. This module sits on top of those layers.

**Optional hardening:** Lock-gating by checklist task should be opt-in per task
template. A close cycle must not become impossible to lock just because a
non-required informational task is still open.

**Conflict / plan gap:** The task model must separate RBAC permission scope
from close-work identity. SAAP already uses close work scopes such as `BOOK`,
`CENTRAL`, `OPERATING_UNIT`, and `CONSOLIDATION_GROUP`, while RBAC uses
permission scopes such as `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY`, and
`GROUP`.

---

## Product decision

Build a **Close Checklist Task Management** layer.

Do not build a second close engine.

The module must:

- materialize close task instances from reusable templates when a close cycle is provisioned
- allow manual task creation inside an open close cycle
- support owner and reviewer assignment
- support task statuses:
  - `NOT_STARTED`
  - `IN_PROGRESS`
  - `SUBMITTED`
  - `RETURNED`
  - `APPROVED`
  - `WAIVED`
  - `CANCELLED`
- support evidence-required tasks and task-level attachments
- support waivers with mandatory reason, actor, and timestamp
- expose task blockers and due-state visibility in Close Cockpit
- optionally block close-cycle lock for required tasks that are not resolved
  (`APPROVED`, `WAIVED`, or `CANCELLED`)
- keep a full task event audit trail
- store RBAC scope separately from close-work scope

---

## Non-goals

- Do not replace local close pack workflow.
- Do not replace period close execution workflow.
- Do not replace consolidation workflow.
- Do not make every task a hard blocker by default.
- Do not use a single `attachment_id`; one task can need multiple evidence files.
- Do not store task status only in frontend state.
- Do not infer task completion from labels alone; required completion rules must be explicit.

---

## Architecture fit

### Existing layers stay authoritative

- `close_cycles`: close control-plane header.
- `close_cycle_items`: participating business objects, not task checkpoints.
- `close_dependencies`: hard dependency graph.
- `close_alerts` and `close_sla_rules`: due, overdue, blocked, stale visibility.
- `local_close_packs`: OU/central local close runtime.
- `local_close_pack_certification_sections`: local close pack certification checklist.
- `close_support_schedules`: structured support schedule and disclosure rows.
- `close_reconciliation_*`: bank, subledger, suspense, and intercompany control rows.

### New layer

Add task templates and task instances:

- templates define the expected close checklist shape
- instances are the actual period/cycle tasks users work on
- task events provide audit and lifecycle traceability
- task evidence links files to tasks

---

## Data model

Next migration number should start after the current latest migration. At the
time of this plan, `m202_drop_workflow_definition_steps_required_package_code`
is the latest migration, so the first migration here should be `m203`.

## PR-CTM-00 - Scope and compatibility decisions

### Goal

Lock the design decisions that would otherwise create schema churn during
implementation.

### Decisions

1. Store two scopes on every task instance:
   - `rbac_scope_type`, `rbac_scope_id`, `rbac_scope_key`
   - `work_scope_type`, `work_scope_id`, `work_scope_key`
2. RBAC scope values:
   - `OPERATING_UNIT`
   - `LEGAL_ENTITY`
   - `COUNTRY`
   - `GROUP`
3. Work scope values:
   - `CYCLE`
   - `BOOK`
   - `CENTRAL`
   - `OPERATING_UNIT`
   - `LOCAL_CLOSE_PACK`
   - `PERIOD_CLOSE_RUN`
   - `CONSOLIDATION_GROUP`
4. Do not add `COUNTRY` to `close_cycles.scope_kind` in v1.
   - Country is allowed as a permission and visibility scope.
   - Task instances remain attached to legal-entity or consolidation-group close cycles.
   - Country users can see and act on in-country tasks through RBAC.
5. All shipped default templates start with `required_for_cycle_lock = false`.
6. Template `completion_mode` is mandatory.
7. Template override loading must merge global and tenant rows by `task_code`,
   prefer tenant rows, then filter to `ACTIVE`.
8. Task evidence uses `CLOSE_TASK_INSTANCE` source references.
9. Task comments are in scope for v1 and reuse the existing `internal_comments`
   pattern after generic scope compatibility is added.
10. Task lifecycle mutations write both `close_task_events` and central
    `audit_logs`.
11. Task templates include `cycle_scope_kind` so materialization can filter by
    `close_cycles.scope_kind`.
12. Task instances include `book_id` for book-aware close work.
13. Task instances store source-check result fields for `SYSTEM_CHECK`,
    `SOURCE_STATUS`, and `HYBRID_REVIEW` tasks.
14. `provisionCycle` may materialize tasks while the cycle is `PLANNED`; user
    task actions require `OPEN` unless an explicit reopen flow allows
    `REOPENED`.
15. Use durable task alerts in v1 by adding generic alert subject columns to
    `close_alerts`.
16. Generic evidence/comment scope migrations must backfill existing rows to
    legal-entity scope.
17. Reattaching removed task evidence reactivates the existing link instead of
    inserting a duplicate row.
18. Mistaken manual tasks use `CANCELLED`, not `WAIVED`.
19. Lock-required task cancellation requires `close.task.admin`.
    - The creator-only cancellation shortcut is allowed only for non-lock-required
      manual tasks before submission.
20. Durable task alerts require persistence functions, not only the `m205`
    subject columns.
21. Treat `CANCELLED` as a terminal/resolved status in queues, filters, overdue
    calculations, cockpit counts, OpenAPI enums, status badges, and i18n labels.

### Acceptance

- schema plan uses separate RBAC and work scopes
- country is not introduced as a close-cycle `scope_kind`
- default lock-required settings are non-blocking
- completion-mode semantics are explicit before templates are seeded
- evidence/comment source-reference strategy is fixed before route work starts
- durable close-alert subject strategy is fixed before alert work starts
- manual task cancellation is distinct from waiver
- lock-required task cancellation cannot bypass required close controls
- durable alert persistence functions are part of the implementation contract
- `CANCELLED` is handled consistently wherever open/resolved status is computed

---

## PR-CTM-01 - Schema foundation

### Migration

- `backend/src/migrations/m203_close_task_management_foundation.js`
- `backend/src/migrations/m204_evidence_comments_generic_scope_for_close_tasks.js`
- `backend/src/migrations/m205_close_alerts_generic_subject.js`
  for durable task alerts

### Tables

#### `close_task_templates`

Reusable task catalog.

Columns:

- `id`
- `tenant_id` nullable
- `tenant_scope_key` generated or stored identity for global vs tenant override
- `task_code`
- `task_name`
- `task_description`
- `task_family`
  - suggested values as `VARCHAR(64)`, not enum:
    - `RECONCILIATION`
    - `SUBLEDGER`
    - `PAYROLL`
    - `INVENTORY`
    - `FIXED_ASSET`
    - `TAX`
    - `FX`
    - `INTERCOMPANY`
    - `REPORTING`
    - `CERTIFICATION`
    - `MANUAL`
- `cycle_scope_kind`
  - `ANY`
  - `LEGAL_ENTITY`
  - `CONSOLIDATION_GROUP`
- `default_rbac_scope_type`
  - `OPERATING_UNIT`
  - `LEGAL_ENTITY`
  - `COUNTRY`
  - `GROUP`
- `default_work_scope_type`
  - `CYCLE`
  - `BOOK`
  - `CENTRAL`
  - `OPERATING_UNIT`
  - `LOCAL_CLOSE_PACK`
  - `PERIOD_CLOSE_RUN`
  - `CONSOLIDATION_GROUP`
- `anchor_item_type`
  - `ANY`
  - `LOCAL_CLOSE_PACK`
  - `PERIOD_CLOSE_RUN`
  - `CONSOLIDATION_RUN`
- `materialization_mode`
  - `CYCLE`
  - `ITEM`
  - `MANUAL_ONLY`
- `completion_mode`
  - `MANUAL`
  - `MANUAL_WITH_EVIDENCE`
  - `SYSTEM_CHECK`
  - `SOURCE_STATUS`
  - `HYBRID_REVIEW`
- `source_check_code` nullable
- `source_ref_type` nullable
- `source_ref_id_strategy` nullable
- `auto_complete_allowed`
- `default_due_offset_days`
- `evidence_required`
- `required_for_cycle_lock`
- `default_owner_strategy`
  - `CYCLE_OWNER`
  - `ITEM_OWNER`
  - `LOCAL_CLOSE_PACK_OWNER`
  - `MANUAL`
- `default_reviewer_strategy`
  - `CYCLE_OWNER`
  - `LOCAL_CLOSE_PACK_REVIEWER`
  - `MANUAL`
- `blocker_class`
- `sort_order`
- `status`
  - `ACTIVE`
  - `PAUSED`
  - `DISABLED`
- `config_json`
- `created_by_user_id`
- `updated_by_user_id`
- timestamps

Indexes:

- unique `(tenant_scope_key, task_code)`
- lookup `(tenant_id, status, cycle_scope_kind, anchor_item_type)`
- lookup `(tenant_id, status, default_rbac_scope_type, anchor_item_type)`
- lookup `(tenant_id, task_family, status)`

#### `close_task_instances`

Actual checklist rows for one close cycle.

Columns:

- `id`
- `tenant_id`
- `close_cycle_id`
- `close_cycle_item_id` nullable
- `close_task_template_id` nullable
- `fiscal_period_id`
- `task_key`
- `task_code`
- `task_name`
- `task_description`
- `task_family`
- `completion_mode`
- `rbac_scope_type`
  - `OPERATING_UNIT`
  - `LEGAL_ENTITY`
  - `COUNTRY`
  - `GROUP`
- `rbac_scope_id`
- `rbac_scope_key`
- `work_scope_type`
  - `CYCLE`
  - `BOOK`
  - `CENTRAL`
  - `OPERATING_UNIT`
  - `LOCAL_CLOSE_PACK`
  - `PERIOD_CLOSE_RUN`
  - `CONSOLIDATION_GROUP`
- `work_scope_id`
- `work_scope_key`
- `legal_entity_id` nullable
- `book_id` nullable
- `operating_unit_id` nullable
- `country_id` nullable
- `group_company_id` nullable
- `consolidation_group_id` nullable
- `owner_user_id`
- `reviewer_user_id`
- `due_at`
- `status`
  - `NOT_STARTED`
  - `IN_PROGRESS`
  - `SUBMITTED`
  - `RETURNED`
  - `APPROVED`
  - `WAIVED`
  - `CANCELLED`
- `evidence_required`
- `required_for_cycle_lock`
- `blocker_class`
- `source_check_code` nullable
- `source_ref_type` nullable
- `source_ref_id` nullable
- `source_check_status` nullable
- `source_checked_at` nullable
- `source_check_payload_json` nullable
- `submitted_by_user_id`
- `submitted_at`
- `reviewed_by_user_id`
- `reviewed_at`
- `return_reason`
- `waiver_reason`
- `waived_by_user_id`
- `waived_at`
- `cancel_reason`
- `cancelled_by_user_id`
- `cancelled_at`
- `created_by_user_id`
- `updated_by_user_id`
- timestamps

Indexes:

- unique `(tenant_id, close_cycle_id, task_key)`
- lookup `(tenant_id, close_cycle_id, status, due_at)`
- lookup `(tenant_id, owner_user_id, status, due_at)`
- lookup `(tenant_id, reviewer_user_id, status, due_at)`
- lookup `(tenant_id, rbac_scope_type, rbac_scope_id, fiscal_period_id)`
- lookup `(tenant_id, work_scope_type, work_scope_id, fiscal_period_id)`
- lookup `(tenant_id, legal_entity_id, book_id, fiscal_period_id)`
- lookup `(tenant_id, source_ref_type, source_ref_id)`
- lookup `(tenant_id, close_cycle_item_id, status)`
- lookup `(tenant_id, required_for_cycle_lock, status)`

Notes:

- `rbac_scope_key` should be stable, for example `LEGAL_ENTITY:12`.
- `work_scope_key` should be stable, for example `BOOK:8` or `CENTRAL:LEGAL_ENTITY:12:BOOK:8`.
- `GROUP` should map to RBAC group scope, usually `group_company_id`.
- `consolidation_group_id` is still stored when the task belongs to a consolidation close cycle.
- `COUNTRY` is a valid RBAC scope in v1, not a close-cycle scope.
- `book_id` is required whenever `work_scope_type = 'BOOK'` or the task is
  anchored to a book-aware close-cycle item.
- `source_check_*` fields store the latest evaluated system/source result for
  `SYSTEM_CHECK`, `SOURCE_STATUS`, and `HYBRID_REVIEW` tasks.
- `CANCELLED` means the task was created by mistake or is no longer applicable.
  It is not a waiver and does not satisfy evidence or review requirements.

#### `close_task_evidence`

Join table between task instances and file evidence.

Columns:

- `id`
- `tenant_id`
- `close_task_instance_id`
- `evidence_object_id`
- `status`
  - `ACTIVE`
  - `REMOVED`
- `attached_by_user_id`
- `attached_at`
- `removed_by_user_id`
- `removed_at`
- `remove_reason`

Indexes:

- unique `(tenant_id, close_task_instance_id, evidence_object_id)`
- lookup `(tenant_id, close_task_instance_id, status)`
- lookup `(tenant_id, evidence_object_id)`

Completion checks count only rows where:

- `close_task_evidence.status = 'ACTIVE'`
- `evidence_objects.status = 'ACTIVE'`

Reattach behavior:

- if the same `evidence_object_id` is attached again after the link was
  `REMOVED`, update the existing `close_task_evidence` row back to `ACTIVE`
  instead of inserting a new row
- write an `EVIDENCE_ATTACHED` event for both first attach and reattach

#### `close_task_events`

Append-only audit trail.

Columns:

- `id`
- `tenant_id`
- `close_task_instance_id`
- `event_type`
  - `CREATED`
  - `ASSIGNED`
  - `STARTED`
  - `SUBMITTED`
  - `RETURNED`
  - `APPROVED`
  - `WAIVED`
  - `CANCELLED`
  - `REOPENED`
  - `EVIDENCE_ATTACHED`
  - `EVIDENCE_REMOVED`
  - `COMMENT_ADDED`
- `from_status`
- `to_status`
- `actor_user_id`
- `note`
- `payload_json`
- `created_at`

Indexes:

- lookup `(tenant_id, close_task_instance_id, created_at)`
- lookup `(tenant_id, actor_user_id, created_at)`
- lookup `(tenant_id, event_type, created_at)`

Central audit log rule:

- sensitive task lifecycle events must also write `audit_logs`
- use `resource_type = 'close_task_instance'`
- use `resource_id = close_task_instance_id`
- use `scope_type = rbac_scope_type`
- use `scope_id = rbac_scope_id`

### Evidence scope compatibility

Existing `evidence_objects` requires `legal_entity_id`. That is fine for
legal-entity and operating-unit tasks, but not enough for true country/group
tasks.

Migration `m204` must extend `evidence_objects` with generic scope columns:

- `scope_type`
- `scope_id`
- `scope_key`
- make `legal_entity_id` nullable only after compatibility tests protect
  existing legal-entity evidence routes
- add a new scoped evidence lookup index
- keep existing legal-entity evidence routes working unchanged
- backfill existing rows:
  - `scope_type = 'LEGAL_ENTITY'`
  - `scope_id = legal_entity_id`
  - `scope_key = CONCAT('LEGAL_ENTITY:', legal_entity_id)`

### Comment scope compatibility

Existing `internal_comments` also follows a legal-entity scoped pattern. Task
comments need the same generic-scope compatibility decision as evidence.

Migration `m204` must also extend `internal_comments` with:

- `scope_type`
- `scope_id`
- `scope_key`
- backfill existing rows:
  - `scope_type = 'LEGAL_ENTITY'`
  - `scope_id = legal_entity_id`
  - `scope_key = CONCAT('LEGAL_ENTITY:', legal_entity_id)`
- make `legal_entity_id` nullable only after existing legal-entity comment
  routes are protected by compatibility tests
- use `source_ref_type = 'CLOSE_TASK_INSTANCE'`

If implementation discovers that generic comment scope creates unacceptable
cross-module risk, update this plan before coding a fallback `close_task_comments`
table.

### Durable alert subject compatibility

Existing `close_alerts` is cycle/item oriented. Durable task alerts need a
generic subject pointer.

Migration `m205_close_alerts_generic_subject.js` must add:

- `subject_type VARCHAR(80) NULL`
- `subject_id BIGINT UNSIGNED NULL`

Task alerts use:

- `subject_type = 'CLOSE_TASK_INSTANCE'`
- `subject_id = close_task_instances.id`

Indexes:

- lookup `(tenant_id, subject_type, subject_id, alert_state)`
- lookup `(tenant_id, close_cycle_id, subject_type, alert_state, severity)`

Compatibility rule:

- existing cycle/item alerts continue to use `close_cycle_id` and
  `close_cycle_item_id`
- task alerts set `close_cycle_id`, nullable `close_cycle_item_id` when known,
  and the generic subject pointer
- the alert composer must dedupe by `alert_key`, not only by subject columns

### Acceptance

- migrations are additive and idempotent
- migration index registers `m203`, `m204`, and `m205`
- task tables enforce tenant scoping and stable task identity
- one task can have multiple evidence objects
- country/group task evidence has an explicit compatibility decision
- country/group task comments have an explicit compatibility decision
- existing evidence/comment rows are backfilled to legal-entity generic scope
- durable task alerts can point to `CLOSE_TASK_INSTANCE`

---

## PR-CTM-02 - Permissions, roles, and scope guards

### Backend files

- `backend/src/seedCore.js`
- `backend/src/constants/permission-rules.js`
- `backend/src/constants/permission-groups.js`
- `backend/src/constants/sod-rules.js`
- `backend/src/services/authz.scope.service.js`
- `backend/src/routes/security.js`

### New permissions

- `close.task.read`
- `close.task.template.read`
- `close.task.template.write`
- `close.task.create`
- `close.task.assign`
- `close.task.work`
- `close.task.review`
- `close.task.waive`
- `close.task.admin`

### Dependency rules

- `close.task.template.write` depends on `close.task.template.read`
- `close.task.create` depends on `close.task.read`
- `close.task.assign` depends on `close.task.read`
- `close.task.work` depends on `close.task.read`
- `close.task.review` depends on `close.task.read`
- `close.task.waive` depends on `close.task.review`
- `close.task.admin` depends on `close.task.read`

### Permission groups

Add grouped metadata for:

- `close.task.viewer`
- `close.task.preparer`
- `close.task.reviewer`
- `close.task.waiver`
- `close.task.admin`

### SoD rules

Add maker-checker warnings for:

- `close.task.work` + `close.task.review`
- `close.task.work` + `close.task.waive`

These should warn by default. If admin override is intentionally allowed, the
diagnostic text must say that the overlap is an override risk, not a hard
assignment error.

### Allowed scopes

All task permissions should support:

- `OPERATING_UNIT`
- `LEGAL_ENTITY`
- `COUNTRY`
- `GROUP`

Backend scope resolver requirements:

- Task read access: actor can see tasks in scopes visible to their role assignment.
- Owner actions: actor must be owner or have `close.task.admin`.
- Reviewer actions: actor must be reviewer or have `close.task.admin`.
- Waive action: actor must have `close.task.waive` at the task RBAC scope.
- Template write: tenant or finance-admin level only unless a scoped template override model is intentionally added.

### Role catalog additions

Add role presets:

- `CloseTaskViewer`
- `CloseTaskPreparer`
- `CloseTaskReviewer`
- `CloseTaskWaiverAuthority`
- `CloseTaskAdmin`

Keep these independent from period-close execution authority.

### Acceptance

- task permissions are seeded
- role catalog shows task roles
- task permissions do not imply period close execute, reopen, or admin
- group task review/waive does not grant group period-close execution
- scope-denial tests cover OU, legal entity, country, and group
- SoD diagnostics identify preparer/reviewer and preparer/waiver overlap

---

## PR-CTM-03 - Backend validators, services, and routes

### Files

- `backend/src/routes/close.tasks.routes.js`
- `backend/src/routes/close.tasks.validators.js`
- `backend/src/services/close.tasks.service.js`
- `backend/src/services/close.task-templates.service.js`
- `backend/src/services/close.task-evidence.service.js`
- `backend/src/services/close.task-comments.service.js`
- `backend/src/services/close.task-scope.service.js`
- `backend/src/services/close.task-source-checks.service.js`
- `backend/src/services/close.task-events.service.js`
- `backend/src/index.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

Route registration:

```js
import closeTasksRoutes from "./routes/close.tasks.routes.js";
app.use("/api/v1/close", requireAuth, closeTasksRoutes);
```

### API routes

Template routes:

- `GET /api/v1/close/task-templates`
- `POST /api/v1/close/task-templates`
- `PATCH /api/v1/close/task-templates/:templateId`
- `POST /api/v1/close/task-templates/:templateId/disable`

Instance routes:

- `GET /api/v1/close/tasks`
- `GET /api/v1/close/cycles/:cycleId/tasks`
- `GET /api/v1/close/tasks/:taskId`
- `POST /api/v1/close/cycles/:cycleId/tasks`
- `PATCH /api/v1/close/tasks/:taskId`
- `POST /api/v1/close/tasks/:taskId/start`
- `POST /api/v1/close/tasks/:taskId/submit`
- `POST /api/v1/close/tasks/:taskId/return`
- `POST /api/v1/close/tasks/:taskId/approve`
- `POST /api/v1/close/tasks/:taskId/waive`
- `POST /api/v1/close/tasks/:taskId/cancel`
- `POST /api/v1/close/tasks/:taskId/reopen`
- `POST /api/v1/close/tasks/:taskId/refresh-source-check`
- `GET /api/v1/close/tasks/:taskId/events`

Evidence routes:

- `GET /api/v1/close/tasks/:taskId/evidence`
- `POST /api/v1/close/tasks/:taskId/evidence`
- `PUT /api/v1/close/tasks/:taskId/evidence/:evidenceId/content`
- `GET /api/v1/close/tasks/:taskId/evidence/:evidenceId/download`
- `DELETE /api/v1/close/tasks/:taskId/evidence/:evidenceId`

Comment routes:

- `GET /api/v1/close/tasks/:taskId/comments`
- `POST /api/v1/close/tasks/:taskId/comments`
- `DELETE /api/v1/close/tasks/:taskId/comments/:commentId`

### Service rules

Status transitions:

- `NOT_STARTED -> IN_PROGRESS`
- `NOT_STARTED -> SUBMITTED`
- `IN_PROGRESS -> SUBMITTED`
- `RETURNED -> IN_PROGRESS`
- `RETURNED -> SUBMITTED`
- `SUBMITTED -> RETURNED`
- `SUBMITTED -> APPROVED`
- `NOT_STARTED|IN_PROGRESS|SUBMITTED|RETURNED -> WAIVED`
- `NOT_STARTED|IN_PROGRESS|SUBMITTED|RETURNED -> CANCELLED`
- `APPROVED|WAIVED|CANCELLED -> IN_PROGRESS` only through admin reopen while cycle is not locked

Submit rules:

- owner or task admin can submit
- if `evidence_required = true`, at least one active evidence object must be linked
- if task is already `APPROVED`, `WAIVED`, or `CANCELLED`, submit is rejected

Review rules:

- reviewer or task admin can return or approve
- reviewer cannot approve their own submitted task unless a tenant setting explicitly allows it
- return requires a reason
- approve stamps `reviewed_by_user_id` and `reviewed_at`

Waive rules:

- waive requires `close.task.waive`
- waive requires reason
- waive stamps `waived_by_user_id` and `waived_at`
- waive counts as resolved for lock-gating, but remains visible as waived in cockpit

Cancel rules:

- cancel requires reason
- cancel requires `close.task.admin` when `required_for_cycle_lock = true`
- the creator can cancel only non-lock-required manual tasks before submission
- all other cancellation paths require `close.task.admin`
- cancel stamps `cancelled_by_user_id` and `cancelled_at`
- cancelled tasks do not block lock and remain visible in audit/history
- do not use `WAIVED` for mistaken manual tasks

Source-check rules:

- `refresh-source-check` is available only for `SYSTEM_CHECK`, `SOURCE_STATUS`,
  and `HYBRID_REVIEW` tasks
- the refresh path updates `source_check_status`, `source_checked_at`, and
  `source_check_payload_json`
- source-check refresh does not approve a task unless `auto_complete_allowed`
  is true and the template explicitly supports auto-completion
- failed source checks should make task blockers and durable alerts explain the
  failed check instead of asking users to guess from raw payload JSON

Assignment rules:

- assignment changes write an event
- changing owner/reviewer on a submitted task should not silently approve or return it
- reassignment after approval requires admin reopen first

Cycle-status mutation guards:

- create, assign, start, submit, return, approve, waive, attach evidence, remove
  evidence, and manual materialization are allowed only when the close cycle is
  `OPEN`
- system task materialization inside `provisionCycle` is allowed while the
  cycle is still `PLANNED`
- allow `REOPENED` only if the implementation keeps reopened cycles editable
- reject routine task mutations when cycle status is `LOCKED`, `CLOSED`, or
  `IN_REVIEW`
- admin reopen is the only path that can move an approved or waived task back
  into work state

Audit rule:

- `SUBMITTED`, `RETURNED`, `APPROVED`, `WAIVED`, `CANCELLED`, `REOPENED`,
  `EVIDENCE_ATTACHED`, `EVIDENCE_REMOVED`, and `ASSIGNED` write both
  `close_task_events` and `audit_logs`

### Acceptance

- service functions are transaction-safe
- each exported non-trivial service method has JSDoc
- route validators reject invalid statuses, scopes, and missing reasons
- every lifecycle mutation writes `close_task_events`
- sensitive lifecycle mutations also write `audit_logs`
- locked/closed/in-review cycles reject routine task mutations
- OpenAPI exposes the final route contracts

---

## PR-CTM-04 - Template materialization during close-cycle provisioning

### Files

- `backend/src/services/close.tasks.service.js`
- `backend/src/services/close.task-templates.service.js`
- `backend/src/services/close.cycles.service.js`
- `backend/src/services/close.cycles.shared.js`
- `backend/scripts/backfill-close-task-defaults.js`

### Required behavior

When `provisionCycle` opens a close cycle:

1. Load global and tenant-specific task templates with all statuses:
   - `ACTIVE`
   - `PAUSED`
   - `DISABLED`
2. Merge by `task_code`, preferring tenant rows over global rows.
3. Filter the merged set to `ACTIVE`.
4. Resolve applicable templates by:
   - cycle scope kind
   - cycle participants
   - template `materialization_mode`
   - template `anchor_item_type`
   - template `completion_mode`
   - template `cycle_scope_kind`
5. Materialize deterministic task instances.
6. Assign owner and reviewer from template strategy.
7. Set due date from cycle `due_at + default_due_offset_days`.
8. Reuse existing task instance on reprovision by `task_key`.
9. Never duplicate tasks during retry or reprovision.

Task key examples:

- `BANK_RECON_COMPLETED:LEGAL_ENTITY:12`
- `AP_UNPOSTED_CLEARED:BOOK:8`
- `IC_133_333_MATCHED:GROUP:3`
- `ENTITY_CLOSE_CERTIFIED:LEGAL_ENTITY:12`

Each key is a work identity. The same row must also store its RBAC scope, for
example:

- work scope: `BOOK:8`
- RBAC scope: `LEGAL_ENTITY:12`

### Default shipped templates

Seed global templates for:

- `BANK_RECON_COMPLETED` - Bank reconciliation reviewed, `HYBRID_REVIEW`
- `CASH_RECON_COMPLETED` - Cash mutabakat reviewed, `HYBRID_REVIEW`
- `INVENTORY_NEGATIVE_STOCK_CHECK` - Inventory negative stock check reviewed, `SYSTEM_CHECK`
- `AP_UNPOSTED_CLEARED` - AP unposted documents reviewed, `SYSTEM_CHECK`
- `AR_AGING_REVIEWED` - AR aging reviewed, `MANUAL`
- `PAYROLL_POSTED` - Payroll posting reviewed, `SOURCE_STATUS`
- `IC_133_333_MATCHED` - Intercompany 133/333 reviewed, `HYBRID_REVIEW`
- `FX_RATES_ENTERED` - FX rates reviewed, `SYSTEM_CHECK`
- `DEPRECIATION_POSTED` - Depreciation posting reviewed, `SOURCE_STATUS`
- `TRIAL_BALANCE_REVIEWED` - Trial balance reviewed, `MANUAL`
- `ENTITY_CLOSE_CERTIFIED` - Entity close certified, `MANUAL_WITH_EVIDENCE`

Initial default:

- `required_for_cycle_lock = false` for all shipped templates
- make lock-required defaults tenant-configured after users validate their real
  close process

Important:

- default tasks are human attestations, evidence collection tasks, review tasks,
  or exception follow-ups
- they must not recreate `close_support_schedules` or
  `close_reconciliation_*` engines
- system-check tasks should point to source checks through `source_check_code`
  and should not ask users to manually confirm data SAAP already knows

### Acceptance

- provisioning creates task instances once
- provisioning can materialize tasks while the cycle is `PLANNED`
- reprovision does not duplicate task rows
- tenant overrides can disable global templates
- materialization handles entity and group cycles
- tenant `DISABLED` templates suppress matching global defaults
- country templates can use country RBAC scope, but do not create country close cycles

---

## PR-CTM-05 - Cockpit, blockers, alerts, and lock gates

### Files

- `backend/src/services/close.cycles.service.js`
- `backend/src/services/close.blockers.service.js`
- `backend/src/services/close.blocker-composer.service.js`
- `backend/src/services/close.alerts.service.js`
- `backend/src/services/close.alerts-persistence.service.js`
- `backend/src/services/close.sla.service.js`
- `backend/src/routes/close.cycles.routes.js`

### Cockpit model additions

Add a `tasks` section to cycle cockpit:

```json
{
  "tasks": {
    "total": 0,
    "counts": {
      "notStarted": 0,
      "inProgress": 0,
      "submitted": 0,
      "returned": 0,
      "approved": 0,
      "waived": 0,
      "cancelled": 0,
      "overdue": 0,
      "evidenceMissing": 0,
      "sourceCheckFailed": 0,
      "lockBlocking": 0
    },
    "byFamily": [],
    "myOpenTasks": [],
    "rows": []
  }
}
```

### Blocker behavior

Only tasks with `required_for_cycle_lock = true` can block cycle lock.

A required task blocks lock when:

- status is not one of `APPROVED`, `WAIVED`, or `CANCELLED`
- or evidence is required and no active task evidence is linked

Blocker payload should include:

- `code`
- `message`
- `severity`
- `blockingItemType: CLOSE_TASK_INSTANCE`
- `blockingItemId`
- `blockingAction`
- `owner`
- `dueDate`
- `drillPath`

### Alert behavior

Close task alerts should reuse close alert conventions:

- `DUE_SOON`
- `OVERDUE`
- `BLOCKED`

Task alerts are durable alerts, not cockpit-only calculations.

Rules:

- persist task alerts in `close_alerts`
- add explicit alert persistence functions instead of relying only on read-time
  cockpit snapshot calculations:
  - `syncCloseTaskAlertsForCycle(cycleId, actorCtx)`
  - `upsertCloseAlert(alertPayload, actorCtx)`
  - `resolveCloseTaskAlerts(taskId, actorCtx)`
  - `resolveStaleTaskAlertsForCycle(cycleId, activeAlertKeys, actorCtx)`
- set `subject_type = 'CLOSE_TASK_INSTANCE'`
- set `subject_id = close_task_instances.id`
- set `close_cycle_id` on every task alert
- set `close_cycle_item_id` when the task is item-anchored
- resolve alerts when the task reaches `APPROVED`, `WAIVED`, or `CANCELLED`
- keep alert generation idempotent by stable `alert_key`
- stale task alerts are resolved when they are no longer produced by the latest
  sync for the same cycle

### Acceptance

- cockpit includes task summary and rows
- lock cycle returns task blockers with standard blocker shape
- due/overdue task alerts appear with close alerts
- task alerts persist in `close_alerts` with generic subject columns
- task alerts are upserted/resolved through explicit persistence functions
- resolved or cancelled tasks resolve their active task alerts
- waived lock-required tasks do not block lock
- cancelled lock-required tasks do not block lock
- non-required open tasks do not block lock

---

## PR-CTM-06 - Frontend task workbench and cockpit integration

### Files

- `frontend/src/api/closeTasks.js`
- `frontend/src/api/closeCycles.js`
- `frontend/src/App.jsx`
- `frontend/src/auth/permissionAccess.js`
- `frontend/src/pages/CloseCockpitPage.jsx`
- `frontend/src/pages/CloseCycleManagerPage.jsx`
- `frontend/src/pages/CloseTaskBoardPage.jsx`
- `frontend/src/pages/CloseTaskTemplateAdminPage.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/i18n/messages.js`

### Screens

### Routes

Add lazy page routes:

- `/app/donem-sonu-islemler/yillik/kapanis-gorevleri`
- `/app/donem-sonu-islemler/yillik/kapanis-gorev-sablonlari`

#### Close cockpit integration

Add task panels:

- task status summary
- lock-blocking tasks
- overdue tasks
- my open tasks
- task family breakdown
- drill links into task detail

#### Close task board

Primary operations surface:

- filters:
  - cycle
  - RBAC scope
  - work scope
  - owner
  - reviewer
  - status
  - due state
  - task family
  - evidence missing
- table columns:
  - task
  - RBAC scope
  - work scope
  - owner
  - reviewer
  - due date
  - status
  - evidence
  - blocker class
  - actions
- actions:
  - start
  - submit
  - return
  - approve
  - waive
  - cancel
  - reopen
  - refresh source check
  - attach evidence
  - edit assignment

#### Template admin

Template catalog:

- list templates
- create/edit template
- enable/disable template
- set default owner/reviewer strategy
- set evidence requirement
- set lock-required flag
- set due offset
- set cycle scope kind
- set completion mode and source-check metadata

### UI rules

- Hide actions the user cannot run.
- Show a clear disabled reason when the user can see the task but cannot act.
- Evidence-required tasks must show missing evidence before submit.
- Returned tasks must show return reason.
- Waived tasks must show waiver reason and actor.
- Cancelled tasks must show cancellation reason and actor.
- Cancelled tasks are terminal/resolved for task board filters, my-task queues,
  reviewer queues, overdue labels, lock-blocking counts, cockpit summary counts,
  OpenAPI status enum handling, frontend status badges, and i18n messages.

### Acceptance

- task board works for owner, reviewer, waiver authority, and admin roles
- cockpit task summary updates after status mutations
- evidence upload/download/delete works from task detail
- template admin can use country as RBAC scope but must not offer country close-cycle creation
- cancelled tasks do not appear in open, overdue, or reviewer-action queues
- no visible text overflows inside task status/action controls

---

## PR-CTM-07 - Evidence, comments, and audit hardening

### Files

- `backend/src/services/evidence.service.js`
- `backend/src/services/evidence.storage.adapter.js`
- `backend/src/services/internal-comments.service.js` if present, or the local comment service pattern
- `backend/src/services/close.task-evidence.service.js`
- `backend/src/services/close.task-events.service.js`
- `backend/src/utils/source-ref-types.js`
- `frontend/src/utils/sourceRefTypes.js`
- `frontend/src/api/closeTasks.js`

### Requirements

- Add `CLOSE_TASK_INSTANCE` as a source ref type in backend and frontend.
- Add `LOCAL_CLOSE_PACK` to `frontend/src/utils/sourceRefTypes.js`.
- Include both constants in frontend `SOURCE_REF_TYPES`.
- Every evidence mutation writes a task event.
- Removing evidence from a task soft-deletes the `close_task_evidence` link.
- Deleting the underlying `evidence_objects` row remains a separate evidence-owner action.
- Download checks task scope access.
- Evidence upload checks file size, hash, and storage integrity using existing adapter patterns.
- Update existing evidence routes so legal-entity evidence remains backward-compatible after `m204`.
- Add task comments through generic `internal_comments` scope compatibility.
- Every comment create writes `COMMENT_ADDED` to `close_task_events`.
- Sensitive task evidence/comment actions write central `audit_logs`.

### Acceptance

- task evidence is visible only to users with task read access
- task comments are visible only to users with task read access
- backend and frontend source-ref registries include `LOCAL_CLOSE_PACK` and `CLOSE_TASK_INSTANCE`
- evidence-required submit fails without active evidence
- deleting evidence from a submitted task should either:
  - return the task to `IN_PROGRESS`, or
  - block approval until evidence is restored
- audit events show evidence add/remove history
- audit events show comment history

---

## PR-CTM-08 - Reporting, dashboard, and "my tasks"

### Files

- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/pages/CloseCockpitPage.jsx`
- `backend/src/services/close.tasks.service.js`
- `backend/src/routes/close.tasks.routes.js`

### Add endpoints

- `GET /api/v1/close/tasks/my`
- `GET /api/v1/close/tasks/summary`
- `GET /api/v1/close/cycles/:cycleId/tasks/summary`

### Dashboard widgets

- My due tasks, excluding terminal tasks
- Submitted tasks awaiting my review, excluding terminal tasks
- Returned tasks assigned to me, excluding terminal tasks
- Overdue lock-required tasks, excluding terminal tasks

### Acceptance

- dashboard does not require cockpit admin access to show my task queue
- task counts match task board filters
- reviewer queue only shows tasks where actor can review
- cancelled tasks are excluded from my-task, reviewer, and overdue queues

---

## PR-CTM-09 - Tests, OpenAPI, and documentation

### Backend scripts

Add scripts:

- `backend/scripts/test-close-task-schema.js`
- `backend/scripts/test-close-task-generic-scope-backfill.js`
- `backend/scripts/test-close-task-template-materialization.js`
- `backend/scripts/test-close-task-lifecycle.js`
- `backend/scripts/test-close-task-cancelled-status.js`
- `backend/scripts/test-close-task-source-check-results.js`
- `backend/scripts/test-close-task-evidence.js`
- `backend/scripts/test-close-task-comments.js`
- `backend/scripts/test-close-task-scope-access.js`
- `backend/scripts/test-close-task-template-overrides.js`
- `backend/scripts/test-close-task-lock-blockers.js`
- `backend/scripts/test-close-task-cockpit-summary.js`
- `backend/scripts/test-close-task-durable-alerts.js`
- `backend/scripts/test-close-task-audit-logs.js`
- `backend/scripts/test-close-task-cycle-status-guards.js`
- `backend/scripts/test-close-task-provision-planned-exception.js`
- `backend/scripts/test-close-task-book-scope.js`
- `backend/scripts/test-close-task-sod-rules.js`

Add npm scripts:

- `test:close-tasks:schema`
- `test:close-tasks:generic-scope-backfill`
- `test:close-tasks:materialization`
- `test:close-tasks:lifecycle`
- `test:close-tasks:cancelled`
- `test:close-tasks:source-checks`
- `test:close-tasks:evidence`
- `test:close-tasks:comments`
- `test:close-tasks:scope`
- `test:close-tasks:template-overrides`
- `test:close-tasks:blockers`
- `test:close-tasks:cockpit`
- `test:close-tasks:alerts`
- `test:close-tasks:audit`
- `test:close-tasks:cycle-guards`
- `test:close-tasks:provision-planned`
- `test:close-tasks:book-scope`
- `test:close-tasks:sod`

### Frontend/browser checks

Add browser smoke tests for:

- task board loads
- owner submits task
- reviewer returns task
- owner resubmits task with evidence
- reviewer approves task
- waiver authority waives task
- mistaken manual task is cancelled
- source-check task refresh shows persisted check result
- cockpit shows updated task counts
- durable task alert appears and resolves after task resolution

### Docs

Add user docs:

- `docs/runbooks/close-task-management.md`
- update close cockpit user guide if present
- update workflow/RBAC guide with task roles

### OpenAPI

Regenerate and validate:

- task template routes
- task instance routes
- task status enums, including `CANCELLED`
- task evidence routes
- task comment routes
- summary routes

### Acceptance

- all new backend scripts pass
- OpenAPI contains task endpoints
- browser smoke proves the full lifecycle
- docs explain when to use support schedules vs close tasks
- tests prove tenant `DISABLED` templates suppress global defaults
- tests prove locked/closed/in-review cycles reject task mutations
- tests prove provision-time materialization is allowed while cycle is `PLANNED`
- tests prove durable task alerts persist and resolve correctly
- tests prove cancelled tasks are terminal in board filters, queues, alerts,
  overdue calculations, cockpit counts, OpenAPI enum handling, status badges,
  and i18n messages
- tests prove book-level tasks can be filtered and joined by `book_id`
- tests prove `m204` backfills existing evidence/comment rows to legal-entity generic scope

---

## End-to-end acceptance criteria

- Close cycle provisioning materializes task instances from active templates.
- Users can manually create close tasks inside open close cycles.
- Owners can start and submit their tasks.
- Evidence-required tasks cannot be submitted without evidence.
- Reviewers can return or approve submitted tasks.
- Waiver authorities can waive tasks with a mandatory reason.
- Mistaken manual tasks can be cancelled without misusing waiver.
- Lock-required task cancellation requires task admin authority.
- Task events show full lifecycle history.
- Task evidence supports multiple attachments.
- Reattaching removed evidence reactivates the existing task-evidence link.
- Close cockpit shows task counts, overdue tasks, and lock-blocking tasks.
- Task due/overdue/blocker alerts are durable `close_alerts` rows.
- Durable task alerts have explicit upsert, sync, stale-resolution, and
  task-resolution service functions.
- Only `required_for_cycle_lock` tasks can block cycle lock.
- Waived required tasks do not block cycle lock.
- Cancelled tasks do not block cycle lock.
- Non-required tasks never block cycle lock.
- RBAC scope access works across OU, legal entity, country, and group.
- Work-scope identity works for cycle, book, central, OU, local close pack, period close run, and consolidation group tasks.
- Book-level task filtering and joins use `book_id`, not only `work_scope_key`.
- Source/system task results are persisted on task instances.
- Country RBAC task visibility works without adding country close cycles.
- Group task permissions do not grant group period-close execution.
- Existing close cycle, local close pack, support schedule, reconciliation, and workflow behavior remains intact.

---

## Recommended implementation order

1. PR-CTM-00 - Scope and compatibility decisions
2. PR-CTM-01 - Schema foundation
3. PR-CTM-02 - Permissions, roles, and scope guards
4. PR-CTM-03 - Backend services, validators, and routes
5. PR-CTM-04 - Provisioning and template materialization
6. PR-CTM-05 - Cockpit, blockers, alerts, and lock gates
7. PR-CTM-06 - Frontend workbench and cockpit integration
8. PR-CTM-07 - Evidence, comments, and audit hardening
9. PR-CTM-08 - Reporting, dashboard, and my tasks
10. PR-CTM-09 - Tests, OpenAPI, and documentation

---

## Key implementation guardrails

- Keep `close_cycle_items` as business-object participation rows.
- Keep RBAC scope and close-work scope separate.
- Keep task instances separate from source runtime status.
- Do not invent a second workflow engine for tasks.
- Use task events plus central `audit_logs` for sensitive lifecycle actions.
- Use existing evidence storage patterns where possible.
- Use structured parsers/validators for JSON config, not ad hoc string parsing.
- Add JSDoc to exported service methods created for this module.
- Add inline comments for non-obvious lock-gating and waiver rules.
- Keep template materialization idempotent.
- Do not add country close cycles in v1.
- Do not duplicate support-schedule or reconciliation engines with fake manual tasks.
