# Close Task Management Runbook

This runbook explains how to operate the Close Checklist Task Management layer in SAAP.

## When To Use It

Use close tasks for human-owned close checkpoints:

- assign an owner and reviewer for a finance close step
- require evidence before submit or approval
- track returned, approved, waived, and cancelled work
- surface overdue or lock-required work in Close Cockpit
- keep an auditable task event trail

Do not use close tasks to replace structured close engines. Keep support schedules in `close_support_schedules`, reconciliations in the reconciliation tables, local close runtime in local close packs, and approval workflows in the workflow engine. A task can point users to those controls, but it should not duplicate their calculation or matching logic.

## Scopes

Every task has two identities:

- RBAC scope controls who can see or act on the task: `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY`, or `GROUP`.
- Work scope describes the close work being performed: `CYCLE`, `BOOK`, `CENTRAL`, `OPERATING_UNIT`, `LOCAL_CLOSE_PACK`, `PERIOD_CLOSE_RUN`, or `CONSOLIDATION_GROUP`.

Book-level work stores `book_id` and can be filtered through the task board/API with `bookId`. Do not rely only on `workScopeKey` for book reporting.

## Roles

The seeded close task role presets are:

- `CloseTaskViewer`: read task boards, cockpit task panels, evidence, comments, and events inside assigned scope.
- `CloseTaskPreparer`: own and work assigned tasks, including start, submit, and evidence handling.
- `CloseTaskReviewer`: review submitted tasks, return them, or approve them.
- `CloseTaskWaiverAuthority`: waive unresolved tasks with a mandatory reason.
- `CloseTaskAdmin`: create, assign, reopen, and administer close tasks and templates.

The maker-checker SoD checks warn when a user can both work and review or waive close tasks. Treat that warning as an override risk and document why it is acceptable.

## Lifecycle

Normal owner and reviewer flow:

1. Owner starts a `NOT_STARTED` task.
2. Owner submits `IN_PROGRESS` or `RETURNED` work.
3. Reviewer approves the submitted task or returns it with a reason.
4. Owner corrects returned work and resubmits.

Terminal statuses are:

- `APPROVED`
- `WAIVED`
- `CANCELLED`

Use `WAIVED` only for an explicit control waiver with a reason. Use `CANCELLED` for mistaken or no-longer-applicable manual tasks; it is not a waiver.

Routine task mutations require an `OPEN` close cycle. Provision-time materialization is allowed while the cycle is still `PLANNED`.

## Evidence And Comments

Evidence-required tasks cannot be submitted or approved without at least one active task evidence link. Reattaching a removed evidence object reactivates the existing link instead of inserting a duplicate row.

Task evidence and comments use `CLOSE_TASK_INSTANCE` source references and generic scope columns. Country/group task evidence and comments rely on `scope_type`, `scope_id`, and `scope_key`; the legacy `legal_entity_id` may be null after migration `m206`.

## Lock Gates And Alerts

Only tasks with `required_for_cycle_lock = true` can block close-cycle lock. A lock-required task blocks when it is unresolved, has missing required evidence, or has a failed source check.

Resolved statuses do not block:

- `APPROVED`
- `WAIVED`
- `CANCELLED`

Task alerts are durable `close_alerts` rows with:

- `subject_type = CLOSE_TASK_INSTANCE`
- `subject_id = close_task_instances.id`
- stable `alert_key`

Alerts are resolved when the task reaches a terminal status or when stale task alerts are no longer produced by the latest sync.

## Operations Checklist

Run migrations and seed/refresh templates:

```powershell
cd backend
npm run db:migrate
npm run db:seed:core
npm run backfill:close-task-defaults
```

Run the close task quality gate:

```powershell
cd backend
npm run test:close-tasks:prctm09
```

Useful focused checks:

```powershell
npm run test:close-tasks:book-scope
npm run test:close-tasks:alerts
npm run test:close-tasks:evidence
npm run check:openapi
```

Optional browser smoke after starting backend and frontend:

```powershell
node browser-tests/close-tasks/walk-close-task-smoke.mjs
```

Set `CLOSE_TASK_SMOKE_CYCLE_ID`, `CLOSE_TASK_SMOKE_BOOK_ID`, and the specific `CLOSE_TASK_SMOKE_*_TASK_ID` variables when you want the script to exercise start, submit, return, evidence upload, approve, waive, cancel, and source-check refresh against prepared fixture tasks.

## Troubleshooting

- Task is invisible: check the user's RBAC scope assignment and task `rbac_scope_type/rbac_scope_id`.
- Task cannot be changed: confirm the close cycle is `OPEN`.
- Submit or approve fails: check active evidence links for evidence-required tasks.
- Close lock is blocked: inspect Close Cockpit task blockers and confirm the task is lock-required.
- Country/group evidence insert fails: confirm migrations `m204` and `m206` have both run.
- Book task is missing from a report: filter by `bookId` and confirm the row has `book_id`.
