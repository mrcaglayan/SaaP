Checked `project5.zip`. Overall: **PR-CTM-01 through PR-CTM-05 are mostly okay**, and the implementation is still aligned with the final plan’s architecture: task layer on top of close cycles, not a second close engine.

## Verdict

```txt
PR-CTM-01: OK
PR-CTM-02: OK
PR-CTM-03: OK
PR-CTM-04: OK, previous issues fixed
PR-CTM-05: Mostly OK, but fix 2 items before PR-CTM-06
```

## Good confirmations

The previous PR-CTM-03 cycle-status bug is fixed. `assertCloseTaskCycleEditable()` now checks `cycle_status` / `cycleStatus` before falling back to `status`, so task status is no longer confused with close-cycle status.

The previous PR-CTM-04 issues are also fixed:

```txt
AP_UNPOSTED_CLEARED      SYSTEM_CHECK
AR_AGING_REVIEWED        MANUAL
PAYROLL_POSTED           SOURCE_STATUS
FX_RATES_ENTERED         SYSTEM_CHECK
DEPRECIATION_POSTED      SOURCE_STATUS
TRIAL_BALANCE_REVIEWED   MANUAL
```

`LOCAL_CLOSE_PACK_REVIEWER` is now backed by a real local close pack reviewer lookup instead of always falling back to cycle owner.

PR-CTM-05 files are present:

```txt
backend/src/services/close.alerts-persistence.service.js
backend/src/services/close.blocker-composer.service.js
backend/src/services/close.tasks.service.js
backend/src/services/close.cycles.service.js
backend/scripts/test-close-task-prctm05-cockpit-alerts.js
```

And the main PR-CTM-05 behavior is implemented:

```txt
task cockpit summary
task counts
cancelled count
sourceCheckFailed count
myOpenTasks
byFamily
lockBlocking count
standard CLOSE_TASK_INSTANCE blockers
task blockers merged into close blockers
durable task alerts
alert upsert
alert stale-resolution
task-alert resolution on terminal statuses
cockpit integration
lockCycle integration
manager list lock-readiness integration
```

## Fix 1 — PR-CTM-05 test has a wrong expectation

In `test-close-task-prctm05-cockpit-alerts.js`, task `id = 5` is:

```txt
status = APPROVED
required_for_cycle_lock = 1
evidence_required = 1
evidence_count = 0
```

According to the plan and implementation, this **should block lock** because approved evidence-required tasks still need active evidence.

The implementation correctly creates a lock blocker for it.

But the test currently says:

```js
assert(!alertPayloads.some((row) => row.alertKey.startsWith("TASK:5:")));
```

That expectation is wrong. It should expect:

```js
assert(alertPayloads.some((row) => row.alertKey === "TASK:5:BLOCKED"));
```

Otherwise, once dependencies are installed and the test can run, this test will fail.

## Fix 2 — source-check failures are counted but not alert/blocker-aware yet

`buildCloseTaskCockpitSummaryFromRows()` correctly counts:

```txt
sourceCheckFailed
```

for statuses like:

```txt
FAILED
ERROR
BLOCKED
```

But `buildCloseTaskLockBlockersFromRows()` and `buildCloseTaskAlertPayloadsFromRows()` do not yet create a specific blocker/alert for failed source checks.

The plan says failed source checks should make task blockers and durable alerts explain the failed check instead of making users guess from JSON.

Add this behavior:

```txt
If task is not terminal
and source_check_status is FAILED / ERROR / BLOCKED
then cockpit should expose a clear source-check failed state.
```

For durable alert:

```txt
alertKey: TASK:<taskId>:SOURCE_CHECK_FAILED
alertCode: CLOSE_TASK_SOURCE_CHECK_FAILED
alertType: BLOCKED
severity: HIGH
blockingAction: REFRESH_SOURCE_CHECK or RESOLVE_SOURCE_CHECK
```

For lock blockers:

```txt
If required_for_cycle_lock = true
and source_check_status is FAILED / ERROR / BLOCKED
then block cycle lock even if the task status is APPROVED.
```

This matters especially for future `SYSTEM_CHECK`, `SOURCE_STATUS`, and `HYBRID_REVIEW` tasks.

## Test status

Syntax checks passed for the new PR-CTM-05 files.

I could not run the full backend test command because the uploaded zip does not include installed dependencies. The failure was:

```txt
Cannot find package 'mysql2'
```

After installing dependencies, run:

```bash
cd backend
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
npm run test:close-tasks:scope
npm run test:close-tasks:sod
npm run test:close-tasks:prctm03
npm run test:close-tasks:materialization
npm run test:close-tasks:prctm05
```

## Final assessment

You are in good shape.

Before moving to PR-CTM-06, I would patch only these:

```txt
1. Fix the PR-CTM-05 test expectation for APPROVED + missing required evidence.
2. Add explicit source-check failed blocker / durable alert handling.
```

After those two fixes, PR-CTM-05 is acceptable.
