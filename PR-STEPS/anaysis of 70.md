Checked `project4.zip`. Overall verdict: **PR-CTM-04 is mostly implemented correctly and the earlier PR-CTM-03 cycle-status blocker is fixed.** The materialization architecture is in place. But I found **two plan-alignment issues** you should fix or explicitly accept before moving to PR-CTM-05. The final plan requires deterministic template materialization, tenant override suppression, default shipped templates, PLANNED-cycle provisioning, and idempotent reprovisioning.

## Verdict

```txt
PR-CTM-01: OK
PR-CTM-02: OK
PR-CTM-03: OK after previous cycle_status fix
PR-CTM-04: Mostly OK, but fix/decide 2 items before PR-CTM-05
```

## What looks good

The following PR-CTM-04 pieces are implemented:

```txt
backend/src/services/close.task-templates.service.js
backend/src/services/close.tasks.service.js
backend/scripts/backfill-close-task-defaults.js
backend/scripts/test-close-task-materialization.js
```

The default template catalog exists, including:

```txt
BANK_RECON_COMPLETED
CASH_RECON_COMPLETED
INVENTORY_NEGATIVE_STOCK_CHECK
AP_UNPOSTED_CLEARED
AR_AGING_REVIEWED
PAYROLL_POSTED
IC_133_333_MATCHED
FX_RATES_ENTERED
DEPRECIATION_POSTED
TRIAL_BALANCE_REVIEWED
ENTITY_CLOSE_CERTIFIED
```

Materialization is connected into:

```txt
backend/src/services/close.cycles.service.js
```

for both:

```txt
initial provisioning
open-cycle reprovisioning
```

The earlier PR-CTM-03 bug is fixed. `assertCloseTaskCycleEditable()` now correctly checks:

```js
cycle_status ?? cycleStatus ?? status;
```

so task lifecycle actions no longer confuse task status with close-cycle status.

Also good: `m206_evidence_comments_nullable_legal_entity_scope.js` is present. That completes the generic evidence/comment scope path better than the original plan, because country/group task evidence/comments can now work without forcing `legal_entity_id`.

## Issue 1 — Default template `completion_mode` does not match the final plan

The plan says several templates should be `SYSTEM_CHECK`, `SOURCE_STATUS`, or `MANUAL`.

But the implementation currently makes most of them `HYBRID_REVIEW`.

### Mismatches

| Template                 |            Plan |    Current code |
| ------------------------ | --------------: | --------------: |
| `AP_UNPOSTED_CLEARED`    |  `SYSTEM_CHECK` | `HYBRID_REVIEW` |
| `AR_AGING_REVIEWED`      |        `MANUAL` | `HYBRID_REVIEW` |
| `PAYROLL_POSTED`         | `SOURCE_STATUS` | `HYBRID_REVIEW` |
| `FX_RATES_ENTERED`       |  `SYSTEM_CHECK` | `HYBRID_REVIEW` |
| `DEPRECIATION_POSTED`    | `SOURCE_STATUS` | `HYBRID_REVIEW` |
| `TRIAL_BALANCE_REVIEWED` |        `MANUAL` | `HYBRID_REVIEW` |

This is not a database-breaking issue, but it is a **plan mismatch**.

### My recommendation

Fix the code to match the plan:

```txt
AP_UNPOSTED_CLEARED              SYSTEM_CHECK
AR_AGING_REVIEWED                MANUAL
PAYROLL_POSTED                   SOURCE_STATUS
FX_RATES_ENTERED                 SYSTEM_CHECK
DEPRECIATION_POSTED              SOURCE_STATUS
TRIAL_BALANCE_REVIEWED           MANUAL
```

Then add assertions to:

```txt
backend/scripts/test-close-task-materialization.js
```

so this does not drift again.

If you intentionally changed them all to `HYBRID_REVIEW`, then update the plan and test accordingly. Do not leave code and plan inconsistent.

## Issue 2 — `LOCAL_CLOSE_PACK_REVIEWER` strategy is not really implemented yet

The plan supports:

```txt
default_reviewer_strategy = LOCAL_CLOSE_PACK_REVIEWER
```

But the implementation currently resolves that to the cycle owner:

```js
if (normalized === "LOCAL_CLOSE_PACK_REVIEWER") {
  return readPositiveInt(cycle, "owner_user_id", "ownerUserId");
}
```

That means if a template later uses `LOCAL_CLOSE_PACK_REVIEWER`, it will not actually assign the local close pack reviewer.

This is not breaking current defaults, because the default shipped templates mostly use `CYCLE_OWNER` as reviewer. But it will become a problem when template admin is exposed.

### Fix

Either:

1. Load `reviewer_user_id` from `local_close_packs` when the cycle item is linked to a local close pack, or
2. Do not expose `LOCAL_CLOSE_PACK_REVIEWER` in template admin until it is really wired.

Better fix:

```txt
When item.currentSourceTargetType = LOCAL_CLOSE_PACK
and item.currentSourceTargetId is present,
load local_close_packs.reviewer_user_id
and use it for LOCAL_CLOSE_PACK_REVIEWER.
```

## Operational note — default templates require backfill

The default templates are not inserted by the migration itself. They are inserted through:

```bash
npm run backfill:close-task-defaults
```

That is okay, but make sure this is included in your rollout order.

Otherwise, provisioning will work technically, but it will create:

```txt
activeTemplateCount = 0
plannedTaskCount = 0
createdTaskCount = 0
```

because no template rows exist yet.

## Tests

I could not fully run the Node tests from the zip because dependencies are not installed in the extracted project. The failure was:

```txt
Cannot find package 'mysql2'
```

That is expected for a raw uploaded zip without `node_modules`.

Static syntax checks passed for the relevant PR-CTM-04 files.

After installing dependencies, run:

```bash
cd backend
npm run test:close-tasks:source-refs
npm run test:close-tasks:generic-scope-backfill
npm run test:close-tasks:scope
npm run test:close-tasks:sod
npm run test:close-tasks:prctm03
npm run test:close-tasks:materialization
```

Also run the backfill before testing real provisioning:

```bash
npm run backfill:close-task-defaults
```

## Final assessment

You can continue after handling these two items:

```txt
1. Align default template completion_mode values with the final plan, or update the plan intentionally.
2. Wire LOCAL_CLOSE_PACK_REVIEWER correctly, or hide it until wired.
```

Other than those, PR-CTM-04 is structurally good. The implementation still respects the main architecture rule: **close tasks are being materialized on top of close cycles and close-cycle items, not replacing the existing close engine.**
