I checked `project (6).zip` for **PR-R2C-08 step 7 — Facts Section**.

Verdict: **UI implementation is good, but one existing frontend contract test currently fails.** So I would mark this as **almost approved**, with one small required test fix.

The facts section itself matches the UX polish plan: it derives values from the existing `consolidationReadiness` payload and member rows, does not add backend semantics, and degrades missing values to `—`. That is aligned with the plan’s requirement that facts come from the existing readiness payload and not require new backend fields.

## What looks good

In:

```txt
frontend/src/pages/GroupCloseMonitorPage.jsx
```

The new facts helpers are present:

```txt
getConsolidationReadinessFacts()
getLocalCloseFact()
getStalePacksFact()
getOfficialRunFact()
getOperationalBlockersFact()
getRunWorkloadFact()
getWorkflowApprovalFact()
ConsolidationReadinessFacts
```

The summary card now shows:

```txt
Key facts
Local close packs
Stale packs
Official run
Operational blockers
Run workload
Workflow approval
Owner
```

Good behavior:

```txt
- Local close packs shows locked / total when member rows exist.
- Stale packs counts non-FRESH member rows.
- Official run shows Not started / Started / Locked.
- Operational blockers uses nonWorkflowBlockerCount when available.
- Workflow approval shows Not required / Pending / Approved.
- Missing facts show — instead of breaking.
- Facts are rendered inside the top summary card.
```

## Required fix: frontend contract test fails

I ran:

```bash
cd backend
node scripts/test-consolidation-ready-to-start-frontend-contract.js
```

It failed with:

```txt
Error: Group monitor must render readiness label/action: Ready to start - waiting for Group reporting controller / consolidation preparer.
```

The UI code is not necessarily wrong. The issue is that the old test expects this full sentence as one static source string:

```txt
Ready to start - waiting for Group reporting controller / consolidation preparer.
```

But the code now builds it dynamically:

```js
return `${l("Ready to start - waiting for", "...")}: ${getOwnerHint(readiness, l)}.`;
```

That is actually better because it supports dynamic owner hints. The **test should be updated** to check the pieces instead of the whole hardcoded sentence.

### Patch suggestion

In:

```txt
backend/scripts/test-consolidation-ready-to-start-frontend-contract.js
```

replace this expected label:

```js
"Ready to start - waiting for Group reporting controller / consolidation preparer.",
```

with these separate expectations:

```js
"Ready to start - waiting for",
"Group reporting controller / consolidation preparer",
```

or add a separate assertion:

```js
assert(
  monitorSource.includes("Ready to start - waiting for") &&
    monitorSource.includes("getOwnerHint(readiness, l)") &&
    monitorSource.includes(
      "Group reporting controller / consolidation preparer",
    ),
  "Group monitor must render dynamic owner-aware waiting text",
);
```

## Other tests passed

These passed:

```bash
cd backend
node scripts/test-consolidation-ready-to-start-cockpit.js
node scripts/test-consolidation-ready-to-start-idempotent-run.js
node scripts/test-consolidation-ready-to-start-alerts.js
```

Output:

```txt
Cockpit contract checks passed
Idempotent run checks passed
Alert checks passed
```

## Optional improvement

Not required now, but when you reach step 12, add facts-section checks to the UX test:

```txt
Key facts
Local close packs
Stale packs
Official run
Operational blockers
Run workload
Workflow approval
Owner
```

## Final verdict

```txt
PR-R2C-08 step 7: ALMOST APPROVED

Facts UI: good
Required fix:
  update frontend contract test for dynamic owner-aware waiting text
```

After that small test update, step 7 is approved.
