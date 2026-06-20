Yes — this version is **now implementation-ready**. It fixed the remaining blockers from the previous review:

* `READY_TO_START` now requires at least one `LOCAL_CLOSE_PACK`.
* Local close items must be both `LOCKED` and `FRESH`.
* Zero-item group cycles correctly stay `WAITING_FOR_ENTITY_CLOSE`.
* V1 now extends only `/api/v1/close/cycles/:cycleId/cockpit`.
* Existing unlinked `OFFICIAL` runs are handled.
* `ACTION_REQUIRED` uses `CLOSE_CYCLE_ITEM` as subject before the real run exists.
* `userCanStart` / `userCanFinalize` are backend-owned. 

## Verdict

I would approve this plan for implementation.

No major conflict remains. The plan is consistent with the current SAAP close-cycle/consolidation architecture. 

## Only small things I would still add before giving it to Codex

### 1. Add `userCanOpen` / `canOpenRun`

You already have:

```txt
userCanStart
userCanFinalize
canStart
canFinalize
```

But the UI also has:

```txt
Open consolidation run
Open finalization review
```

Those should require:

```txt
consolidation.run.read
```

Add this to the service payload:

```js
userCanOpen: true,
canOpenRun: runId && userCanOpen
```

Otherwise a user with `close.cockpit.read` may see an “Open run” CTA and then fail on the run detail route.

---

### 2. Clarify RBAC scope wording

The plan says:

```txt
user has consolidation.run.create at the consolidation group scope
```

In the current project, consolidation group cycles resolve to RBAC scope:

```txt
scopeType = GROUP
scopeId = consolidation_groups.group_company_id
```

So change the wording to:

```txt
Permission booleans are checked at the RBAC GROUP scope resolved from the consolidation group’s group_company_id, not against consolidation_group_id directly.
```

This is important so implementation does not accidentally check the wrong ID.

---

### 3. Add one test for `consolidation.run.read`

Add test scenario 21:

```txt
21. User with close.cockpit.read but without consolidation.run.read can see readiness status but cannot see/open the run CTA.
```

This protects the separation between cockpit visibility and consolidation-run detail visibility.

---

### 4. Mark workflow blockers by source, not only by code

When splitting blockers from `getConsolidationRunReviewGate()`, do not rely only on blocker code like `APPROVAL_REQUIRED`, because workflow error codes may vary.

Use a stable marker such as:

```js
blocker.drill?.surface === "workflow"
```

Then:

```txt
workflowBlockers = blockers where drill.surface === "workflow"
nonWorkflowBlockers = all other blockers
```

This supports your `READY_TO_FINALIZE but canFinalize false` behavior safely.

---

### 5. Patch persisted alert mapper source kind

Because `close.alerts-persistence.service.js` currently maps durable alerts with a task-oriented source kind, add this to PR-R2C-05:

```txt
ACTION_REQUIRED readiness alerts must map to sourceKind = READINESS or CLOSE_CYCLE_ITEM, not TASK.
```

Not a blocker, but it prevents misleading UI/debug output.


