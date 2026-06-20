# Ready to Consolidate Signal

## Status

Proposed implementation plan.

## Classification

**Conflict / plan gap:** SAAP already has the close-cycle item, group monitor, consolidation review gate, and finalization workflow gate. What is still missing is an explicit operational signal that tells the group team: "entity inputs are complete; start consolidation now."

**Deferred item already covered:** Close cycle provisioning, cockpit blockers, group monitor rows, local-close readiness, and consolidation finalization gates already exist. This plan must reuse those layers instead of building a second close or workflow engine.

**Optional hardening:** A durable alert and/or close checklist task should be created for the group owner when the derived state becomes `READY_TO_START`. V1 can start with live computed signal plus UI CTA, then add persistence once duplicate suppression is stable.

---

## Product Decision

Add a **Ready To Consolidate** signal for consolidation-group close cycles.

The signal answers:

```txt
Is it time for the group consolidation team to start the consolidation run?
```

It must not answer:

```txt
Is the consolidation run approved for finalization?
```

Finalization remains governed by:

- `consolidation.review-gate.service.js`
- `CONSOLIDATION_RUN` workflow approval
- `consolidation.run.finalize`

---

## Non-goals

- Do not add prepare/execute/post/finalize workflow steps.
- Do not replace `CONSOLIDATION_RUN` workflow finalization approval.
- Do not finalize or lock a consolidation run from the cockpit CTA.
- Do not infer readiness only from frontend row labels.
- Do not create a second dependency engine.
- Do not add a `START` dependency action in V1.
- Do not create alerts/tasks for every refresh without idempotency.

---

## PR-R2C-00 - Locked Semantics And Current Constraints

Lock these decisions before coding:

```txt
READY_TO_START ignores workflow approval.
READY_TO_START does not use close dependency START blockers.
READY_TO_FINALIZE means operationally ready, not necessarily workflow approved.
canFinalize means operationally ready + workflow approved + user has consolidation.run.finalize.
Open-run actions require consolidation.run.read; close.cockpit.read alone only allows viewing the cockpit readiness status.
```

Additional locked V1 semantics:

```txt
Every provisioned LOCAL_CLOSE_PACK item in a CONSOLIDATION_GROUP cycle is mandatory unless a future explicit optional flag exists.
READY_TO_START requires each mandatory LOCAL_CLOSE_PACK item to have business_status = LOCKED and stale_status = FRESH.
A group cycle with zero LOCAL_CLOSE_PACK items is not READY_TO_START.
V1 extends GET /api/v1/close/cycles/:cycleId/cockpit only; no separate readiness route yet.
If an OFFICIAL run already exists but is not linked to the close-cycle item, the readiness service treats the run as existing and does not return READY_TO_START.
ACTION_REQUIRED alert subject points to the close-cycle item before the run exists.
Consolidation-run action permissions are checked at RBAC GROUP scope resolved from consolidation_groups.group_company_id, not against consolidation_group_id directly.
```

Current constraints this plan must respect:

- The close dependency engine supports action semantics such as `APPROVE`,
  `LOCK`, and `FINALIZE`; it does not currently support `START`.
- `getConsolidationRunReviewGate()` requires a real `runId`, so it cannot be
  used for the pre-run `READY_TO_START` state.
- `getConsolidationRunReviewGate()` includes workflow approval as a blocker, so
  the new service must split operational readiness from workflow approval.
- `close_alerts.alert_type` currently supports only `DUE_SOON`, `OVERDUE`,
  `BLOCKED`, and `STALE`; using `ACTION_REQUIRED` requires a migration.
- The cockpit currently describes itself as read-only for create/provision/lock
  actions. This plan intentionally allows a narrowly permissioned start CTA in
  the cockpit, guarded by `consolidation.run.create`.
- `close_cycle_items` has no explicit mandatory/optional flag in the current
  model, so provisioned local-close participation rows are treated as mandatory
  for V1.

V1 `READY_TO_START` definition:

```txt
At least one provisioned LOCAL_CLOSE_PACK item exists in the group cycle
AND all provisioned LOCAL_CLOSE_PACK items in the group cycle have business_status = LOCKED
AND all provisioned LOCAL_CLOSE_PACK items in the group cycle have stale_status = FRESH
AND the expected CONSOLIDATION_RUN cycle item exists
AND no official consolidation run exists yet
```

Do not use all `listCycleDependencyBlockers()` for `READY_TO_START`, because
cycle-lock blockers such as "consolidation locked before cycle lock" would
falsely block a run that has not started yet.

---

## Derived Status Model

Add derived status enum:

```txt
WAITING_FOR_ENTITY_CLOSE
READY_TO_START
IN_PROGRESS
READY_TO_FINALIZE
LOCKED
```

Meaning:

### `WAITING_FOR_ENTITY_CLOSE`

The consolidation cycle exists, but one or more required member inputs are not ready.

Typical reasons:

- mandatory local close pack missing
- mandatory local close pack not `LOCKED`
- mandatory local close pack is stale
- entity close readiness blockers remain
- expected group consolidation cycle item is missing

### `READY_TO_START`

All required entity/member close inputs are ready, and the official consolidation run has not started yet.

Typical conditions:

- consolidation cycle item exists
- at least one mandatory member local close pack exists
- all mandatory member local close packs are `LOCKED`
- all mandatory member local close packs have stale status `FRESH`
- official consolidation run is absent
- no workflow approval is evaluated yet

### `IN_PROGRESS`

The official consolidation run exists, but it is not yet ready for finalization.

Typical reasons:

- run exists and is being prepared/executed
- entries are missing
- draft consolidation adjustments exist
- draft eliminations exist
- report math/review checks are not clean

### `READY_TO_FINALIZE`

The consolidation run has been executed and operational blockers are clear, but final workflow/finalizer action may still be required.

Typical conditions:

- consolidation entries exist
- no draft adjustments
- no draft eliminations
- member readiness blockers clear
- non-workflow finalization blockers are clear
- workflow approval may still be pending

### `LOCKED`

The official consolidation run is finalized/locked.

---

## PR-R2C-01 - Backend Derived Status Service

Add service:

```txt
backend/src/services/consolidation.ready-to-start.service.js
```

Responsibilities:

- resolve the provisioned `CONSOLIDATION_RUN` cycle item
- resolve or detect the official consolidation run
- for the no-run state, read close-cycle items / local close pack statuses directly
- for the run-exists state, reuse `getConsolidationRunReviewGate()`
- split operational finalization readiness from workflow approval
- detect existing official runs by `(consolidationGroupId, fiscalPeriodId, runName = OFFICIAL)` even if they are not linked to the close-cycle item yet
- compute permission booleans on the backend using secondary scoped permission checks
- compute open-run permission separately from cockpit visibility
- produce one normalized status payload

Do not force `consolidation.review-gate.service.js` to accept a missing run. If
shared member-readiness logic is needed, extract a helper; keep the existing
review gate focused on real consolidation runs.

Permission booleans are backend-owned in V1:

```txt
userCanStart = user has consolidation.run.create at the RBAC GROUP scope resolved from consolidation_groups.group_company_id
userCanOpen = user has consolidation.run.read at the RBAC GROUP scope resolved from consolidation_groups.group_company_id
userCanFinalize = user has consolidation.run.finalize at the RBAC GROUP scope resolved from consolidation_groups.group_company_id
```

Do not check these permissions against `consolidation_group_id` directly. The
consolidation domain id and the RBAC `GROUP` scope id are different concepts;
the RBAC `GROUP` scope id is `consolidation_groups.group_company_id`.

The frontend may still use local `hasPermission()` as a defensive UI guard, but
the API payload is the authoritative source for `canStart`, `canOpenRun`, and
`canFinalize`.

Suggested API shape:

```js
{
  closeCycleId,
  closeCycleItemId,
  consolidationGroupId,
  fiscalPeriodId,
  runId,
  runName: "OFFICIAL",
  status: "READY_TO_START",
  canStart: true,
  canOpenRun: false,
  canFinalize: false,
  userCanStart: true,
  userCanOpen: true,
  userCanFinalize: false,
  operationalReadyToFinalize: false,
  workflowApproved: false,
  ownerUserId: null,
  ownerRoleHint: "GroupReportingController",
  blockingReasons: [],
  nextAction: {
    code: "START_CONSOLIDATION_RUN",
    label: "Start consolidation run",
    requiredPermissionCode: "consolidation.run.create"
  },
  source: {
    memberReadinessBlockCount: 0,
    dependencyBlockerCount: 0,
    draftAdjustmentCount: 0,
    draftEliminationCount: 0,
    entryCount: 0,
    workflowGateRequired: false,
    workflowGateApproved: false,
    workflowBlockerCount: 0,
    nonWorkflowBlockerCount: 0
  }
}
```

Status resolution order:

1. If official consolidation run is `LOCKED`, return `LOCKED`.
2. If official run exists, call `getConsolidationRunReviewGate()` and separate
   workflow blockers from operational blockers.
3. If official run exists and operational blockers are clear, return
   `READY_TO_FINALIZE` even when workflow approval is still pending.
4. If official run exists and operational blockers remain, return `IN_PROGRESS`.
5. If official run does not exist, at least one mandatory local close item
   exists, and all provisioned mandatory local close items are `LOCKED` and
   `FRESH`, return `READY_TO_START`.
6. Otherwise return `WAITING_FOR_ENTITY_CLOSE`.

When splitting review-gate blockers, classify workflow blockers by stable source
metadata, not only by code:

```txt
workflowBlockers = blockers where blocker.drill.surface = workflow
nonWorkflowBlockers = all other blockers
```

Do not rely only on codes such as `APPROVAL_REQUIRED`, because workflow error
codes can vary while `drill.surface = workflow` is the intended source marker.

Derived booleans:

```txt
operationalReadyToFinalize = run exists and non-workflow blockers are clear
workflowApproved = workflow gate is absent or approved
canFinalize = operationalReadyToFinalize && workflowApproved && userCanFinalize
canStart = status is READY_TO_START && userCanStart
canOpenRun = runId exists && userCanOpen
```

Acceptance:

- Service does not create workflow instances.
- Service does not mutate consolidation run state.
- Service does not call `getConsolidationRunReviewGate()` until a run exists.
- Service reuses existing review truth after a run exists.
- `READY_TO_FINALIZE` can be returned while workflow approval is pending.
- `READY_TO_START` requires at least one local close item.
- `READY_TO_START` requires locked and fresh local close items.
- Existing unlinked official run prevents `READY_TO_START`.
- Missing cycle item returns a clear non-ready diagnostic.
- Run-open CTA is not available when the user lacks `consolidation.run.read`,
  even if the user can read the cockpit readiness status.

---

## PR-R2C-02 - API Contract

V1 extends:

```txt
GET /api/v1/close/cycles/:cycleId/cockpit
```

with:

```json
{
  "consolidationReadiness": {
    "status": "READY_TO_START",
    "canStart": true,
    "nextAction": {
      "code": "START_CONSOLIDATION_RUN",
      "requiredPermissionCode": "consolidation.run.create"
    }
  }
}
```

Do not add a separate `consolidation-readiness` route in V1. A standalone route
can be added later if another surface needs the same payload without loading the
full cockpit.

Permission:

```txt
close.cockpit.read
```

`close.cockpit.read` controls cockpit payload visibility only. It must not imply
`consolidation.run.read`; the readiness payload should still expose status while
withholding open-run actions when `userCanOpen` is false.

Scope:

- consolidation-group scoped cycle only
- response filtered through existing close-cycle/cockpit scope checks

Acceptance:

- Entity-scoped cycle returns no group readiness signal or returns `applicable: false`.
- Group-scoped cycle returns a deterministic status.
- Users without cycle visibility cannot read the signal.
- `backend/openapi.yaml` documents the response shape.
- `npm run check:openapi` passes.

---

## PR-R2C-03 - Idempotent Official Run Creation And CTA Contract

Before adding the CTA, make official run creation idempotent.

Patch:

```txt
backend/src/routes/consolidation.js
```

Required behavior:

```txt
First create:
  201 Created
  idempotent: false

Duplicate OFFICIAL create for same consolidation_group_id + fiscal_period_id + run_name:
  200 OK
  idempotent: true
  return existing run id
```

The route should catch duplicate-key failure for the existing unique key:

```txt
consolidation_group_id + fiscal_period_id + run_name
```

It must then reload the existing run, verify tenant/scope, link/sync the close
cycle item if needed, and return the existing run.

Use the existing consolidation run creation route for the cockpit CTA once this
idempotency is in place.

If the current frontend only exposes creation inside consolidation setup/reports pages, add a thin API helper:

```txt
frontend/src/api/consolidationRuns.js
```

CTA behavior:

- If status is `READY_TO_START` and user has `consolidation.run.create`, show:

```txt
Start consolidation run
```

- If status is `READY_TO_START` and user lacks permission, show:

```txt
Ready for consolidation - waiting for consolidation preparer
```

- If status is `IN_PROGRESS`, show:

```txt
Open consolidation run
```

- If status is `READY_TO_FINALIZE`, show:

```txt
Open finalization review
```

Only show `Open consolidation run` or `Open finalization review` when
`canOpenRun` is true. A user with `close.cockpit.read` but without
`consolidation.run.read` can see the derived readiness status, but must not see
or trigger the run-detail CTA.

- If status is `LOCKED`, show:

```txt
Consolidation locked
```

Required permissions:

```txt
consolidation.run.create      -> Start consolidation run
consolidation.run.read        -> Open run / view run details
consolidation.run.finalize    -> Finalize after review/workflow gate
```

Acceptance:

- CTA never appears for users without read visibility.
- Start button is disabled or replaced with waiting text if user lacks create permission.
- Clicking start creates/opens the official consolidation run only once.
- Duplicate clicks reuse/open existing run.
- Double-click / retry does not surface duplicate-key errors.
- Open-run and finalization-review CTAs require `canOpenRun`.

---

## PR-R2C-04 - Group Close Monitor UX

Patch:

```txt
frontend/src/pages/GroupCloseMonitorPage.jsx
frontend/src/pages/CloseCockpitPage.jsx
frontend/src/api/closeCycles.js
frontend/src/api/consolidationRuns.js
```

`CloseCockpitPage.jsx` must pass action state into `GroupCloseMonitorPage.jsx`:

```txt
canCreateConsolidationRun
canReadConsolidationRun
onStartConsolidationRun
onOpenConsolidationRun
consolidationReadiness
```

This is an intentional product decision: the cockpit remains primarily a
monitoring page, but it may expose a narrowly guarded operational action when
the user has `consolidation.run.create`.

Add visible derived state:

```txt
Waiting for entity close
Ready to start
In progress
Ready to finalize
Locked
```

Group monitor row should show:

- derived status badge
- top blocking reason if not ready
- "Start consolidation run" CTA when allowed
- owner hint:

```txt
Owner: Group reporting controller / consolidation preparer
```

UX rules:

- Do not bury the signal under generic blockers.
- For mobile, CTA and status must wrap in one column without overlap.
- Keep drill-through to local close pack or consolidation run detail.

Acceptance:

- When all local close packs are locked/fresh and no run exists, monitor shows `READY_TO_START`.
- When run exists but not ready to finalize, monitor shows `IN_PROGRESS`.
- When operational finalization blockers are clear, monitor shows `READY_TO_FINALIZE`
  even if workflow approval is still pending.
- When run is locked, monitor shows `LOCKED`.
- Start CTA requires `consolidation.run.create`.
- Open-run and finalization-review CTAs require `consolidation.run.read`.
- Cockpit read-only explanatory copy is updated so the new permitted action is not contradictory.

---

## PR-R2C-05 - Close Cockpit Alert / Task

Add migration before persisting `ACTION_REQUIRED`:

```txt
backend/src/migrations/m2xx_close_alerts_action_required_type.js
```

Use the next available migration number at implementation time. Do not reuse an
existing number.

Migration behavior:

```txt
ALTER TABLE close_alerts
MODIFY COLUMN alert_type ENUM('DUE_SOON','OVERDUE','BLOCKED','STALE','ACTION_REQUIRED') NOT NULL
```

Then update close alert aggregation and UI handling:

```txt
backend/src/services/close.alerts.service.js
backend/src/services/close.alerts-persistence.service.js
backend/src/services/close.cycles.service.js
frontend/src/pages/CloseCockpitPage.jsx
```

`ACTION_REQUIRED` must have its own count, panel, label, and tone. It must not
fall through to stale/blocked display behavior.

Then add live/persisted cockpit alert:

```txt
alertType: ACTION_REQUIRED
subjectType: CLOSE_CYCLE_ITEM
subjectId: close_cycle_item_id
title: Ready to start consolidation
message: All required member close inputs are locked. Start the official consolidation run.
ownerUserId: group owner / preparer if known
payload: {
  itemType: "CONSOLIDATION_RUN",
  runName: "OFFICIAL"
}
```

Persisted readiness alerts must map to `sourceKind = READINESS` or
`sourceKind = CLOSE_CYCLE_ITEM`, not `TASK`, so cockpit/debug output does not
misrepresent a readiness prompt as a close-task alert.

If close task module is available, optionally materialize a task:

```txt
task_code: START_CONSOLIDATION_RUN
task_name: Start official consolidation run
scope_type: GROUP
anchor_item_type: CONSOLIDATION_RUN
owner_user_id: group reporting owner
required_for_cycle_lock: false
```

Important:

- This task/alert is a prompt, not a hard dependency.
- Before the run exists, alert subject is the `close_cycle_item_id`.
- After the run exists, the alert should resolve; it should not switch subject to `run_id`.
- It should resolve when the official run is created or status moves away from `READY_TO_START`.
- It must be idempotent per cycle/group/period/run name.

Acceptance:

- Cockpit shows one action-required alert, not duplicates.
- Alert disappears or resolves once run starts.
- Optional close task does not block close-cycle lock unless explicitly configured.
- Migration allows `ACTION_REQUIRED` in `close_alerts.alert_type`.
- `ACTION_REQUIRED` appears as "Action required", not as stale or blocked.
- Alert subject uses `CLOSE_CYCLE_ITEM` before the actual run exists.

---

## PR-R2C-06 - Permission-Aware Owner Logic

Map suggested owners:

```txt
Primary: users with GroupReportingController at GROUP scope
Alternative: users with ConsolidationRunPreparer at GROUP scope
Fallback: users with consolidation.run.create at GROUP scope
Fallback admin: Tenant/System admin
```

V1 may show only:

```txt
ownerRoleHint
```

Do not overbuild exact `ownerUserId` resolution unless a real scoped user
resolver is implemented in the same PR. If exact owner resolution is deferred,
`ownerUserId` must be `null` and the UI should show the role hint.

Rules:

- CTA permission check is based on `consolidation.run.create`.
- Cockpit readiness visibility is based on `close.cockpit.read`.
- Run-detail/open visibility is based on `consolidation.run.read`.
- Finalize action remains based on `consolidation.run.finalize`.
- The signal can name an owner even when the current viewer is not the owner.

Acceptance:

- Group controller sees start action if permissioned.
- Entity accountant sees readiness status but no start action if not permissioned.
- Tenant admin can see which role family is expected to act.

---

## PR-R2C-07 - Tests

Add backend tests:

```txt
backend/scripts/test-consolidation-ready-to-start-status.js
backend/scripts/test-consolidation-ready-to-start-rbac.js
backend/scripts/test-consolidation-ready-to-start-cockpit.js
backend/scripts/test-consolidation-ready-to-start-no-workflow-regression.js
```

Add frontend/static test:

```txt
backend/scripts/test-consolidation-ready-to-start-frontend-contract.js
```

Package scripts:

```txt
test:consolidation:ready-start:status
test:consolidation:ready-start:rbac
test:consolidation:ready-start:cockpit
test:consolidation:ready-start:workflow-regression
test:consolidation:ready-start:frontend
```

Test scenarios:

1. Missing local close pack -> `WAITING_FOR_ENTITY_CLOSE`.
2. Local close pack exists but not locked -> `WAITING_FOR_ENTITY_CLOSE`.
3. All mandatory local close packs locked/fresh and no official run -> `READY_TO_START`.
4. Official run exists with no entries -> `IN_PROGRESS`.
5. Official run exists with draft adjustment/elimination -> `IN_PROGRESS`.
6. Official run has entries and no operational blockers -> `READY_TO_FINALIZE`.
7. Official run locked -> `LOCKED`.
8. User without `consolidation.run.create` sees no start permission.
9. User with `consolidation.run.create` can start/open the official run.
10. Derived status service does not create workflow instances.
11. Existing `CONSOLIDATION_RUN` workflow finalization approval still blocks finalization.
12. Pending workflow approval with no operational blockers returns `READY_TO_FINALIZE` and `canFinalize: false`.
13. Duplicate official run create returns existing run with `idempotent: true`.
14. No `START` dependency action is required or referenced.
15. `ACTION_REQUIRED` alert type is accepted after migration.
16. Zero mandatory local close packs -> `WAITING_FOR_ENTITY_CLOSE`.
17. Locked but stale local close pack -> `WAITING_FOR_ENTITY_CLOSE`.
18. Existing unlinked OFFICIAL run -> `IN_PROGRESS` / `READY_TO_FINALIZE` / `LOCKED` based on run state, not `READY_TO_START`.
19. `ACTION_REQUIRED` alert is rendered as "Action required" in cockpit panels and lists.
20. `userCanStart` / `userCanFinalize` are backend-computed with secondary scoped permission checks.
21. User with `close.cockpit.read` but without `consolidation.run.read` can see readiness status but cannot see or open the run CTA.

Acceptance:

- Tests prove no workflow logic is replaced.
- Tests prove the signal is derived from existing readiness/review truth.
- Tests prove CTA is permission-aware.
- Tests prove OpenAPI is updated.

---

## Suggested Implementation Order

0. PR-R2C-00 - lock `READY_TO_START` / `READY_TO_FINALIZE` semantics.
1. PR-R2C-01 - backend derived service using close-cycle items for no-run state.
2. PR-R2C-01 - require locked/fresh local close items and handle zero-item cycles.
3. PR-R2C-01 - split operational readiness from workflow approval for run-exists state.
4. PR-R2C-02 - extend cockpit payload with `consolidationReadiness` and OpenAPI.
5. PR-R2C-03 - make OFFICIAL run creation idempotent and handle unlinked existing runs.
6. PR-R2C-04 - add frontend CTA/open behavior and cockpit copy update.
7. PR-R2C-05 - add `ACTION_REQUIRED` enum migration, alert UI support, and live/persisted alert.
8. PR-R2C-06 - add owner hint/candidate logic.
9. PR-R2C-07 - regression tests and OpenAPI check.

---

## Rollout Notes

- Start with live computed status in cockpit.
- Add durable alert once idempotency is verified.
- Add optional close task only after task-module behavior is stable.
- Do not show `READY_TO_START` unless mandatory local close packs are truly `LOCKED` and `FRESH`.
- Do not show `READY_TO_START` for group cycles with zero local close items.
- Do not add a `START` dependency action in V1.
- Keep finalization workflow as a separate approval gate.

---

## Final Acceptance

The feature is complete when:

- group close cockpit clearly shows when consolidation is waiting on entity close
- group close cockpit clearly shows when the official run is ready to start
- permissioned group users can start/open the official consolidation run from the monitor
- unpermissioned users see who should act instead of seeing a dead button
- a cockpit alert or task tells the group owner to start consolidation
- finalization still requires existing consolidation review gate and workflow approval
- official run creation is idempotent from the cockpit CTA
- OpenAPI documents the new readiness contract
- regression tests prove the signal does not replace workflow logic
