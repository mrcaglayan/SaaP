# Consolidation Readiness UX Polish

## Status

Proposed follow-up UI polish PR.

## Classification

**UX / navigation improvement:** The Ready To Consolidate backend signal is now implemented and tested. The current UI exposes the signal and CTAs, but the cockpit can be improved so finance and group users understand the consolidation state faster, know why the state exists, and can navigate directly to the next relevant action.

This PR must reuse the existing `consolidationReadiness` payload from the close cockpit response. It must not change readiness semantics or introduce a new backend readiness engine.

---

## Product Decision

Improve the **Group Close Cockpit** so the consolidation readiness signal becomes a guided operational experience.

The UI should answer:

```txt
Where are we in the consolidation process?
Why is this the current status?
Who should act?
What should the user do next?
Where can the user navigate from here?
```

The UI must remain permission-aware:

```txt
close.cockpit.read allows viewing readiness status.
consolidation.run.create allows starting the official run.
consolidation.run.read allows opening the run or finalization review.
consolidation.run.finalize controls finalization action only.
```

---

## Non-goals

* Do not change backend readiness status semantics.
* Do not add a new readiness API route.
* Do not add a new workflow step.
* Do not replace the existing consolidation review gate.
* Do not finalize or lock a consolidation run from the summary card.
* Do not expose run-open CTAs to users without `consolidation.run.read`.
* Do not create new persisted activity/audit tables in this PR.
* Do not make dashboard visuals depend on hardcoded frontend row labels.

---

## PR-R2C-08-01 - Readiness Summary Card

Patch:

```txt
frontend/src/pages/CloseCockpitPage.jsx
frontend/src/pages/GroupCloseMonitorPage.jsx
```

Add a prominent **Consolidation Readiness Summary** card above or at the top of the group monitor section.

The card should show:

```txt
Status
Short explanation
Next action
Owner / responsible role
Key facts
Primary CTA
Permission-aware helper text
```

Example for `READY_TO_START`:

```txt
Consolidation Readiness

Ready to start

All mandatory entity close packs are locked and fresh.
The official consolidation run can now be started.

Next action:
Start official consolidation run

Owner:
Group reporting controller / consolidation preparer
```

Key facts:

```txt
Local close packs: 6 / 6 locked
Stale packs: 0
Official run: Not started
Operational blockers: 0
Workflow approval: Not required / Pending / Approved
Owner: Group reporting controller
```

Acceptance:

* Summary card appears only when `consolidationReadiness` is applicable.
* Entity-scoped cycles do not show a misleading group-readiness card.
* Card uses backend `consolidationReadiness.status`, not frontend row labels.
* Primary CTA respects `canStart` and `canOpenRun`.
* Users without action permission see explanatory text instead of a dead button.

---

## PR-R2C-08-02 - Professional Status Labels And Helper Copy

Add frontend mapping helpers, either inside `CloseCockpitPage.jsx` or a small local utility:

```txt
getConsolidationReadinessLabel(status)
getConsolidationReadinessDescription(readiness)
getConsolidationReadinessTone(status)
getConsolidationReadinessNextActionCopy(readiness)
```

Recommended labels:

```txt
WAITING_FOR_ENTITY_CLOSE  -> Waiting for entity close
READY_TO_START            -> Ready to start
IN_PROGRESS               -> Consolidation in progress
READY_TO_FINALIZE         -> Ready for final review
LOCKED                    -> Locked
```

Use **Ready for final review** instead of **Ready to finalize** in the UI because workflow approval may still be pending.

Recommended descriptions:

### `WAITING_FOR_ENTITY_CLOSE`

```txt
Consolidation cannot start yet because one or more required entity close packs are not ready.
```

### `READY_TO_START`

```txt
All mandatory entity close packs are locked and fresh. The official consolidation run can now be started.
```

### `IN_PROGRESS`

```txt
The official consolidation run has started, but operational checks are not complete yet.
```

### `READY_TO_FINALIZE`

```txt
Operational checks are clear. Final workflow approval or finalizer action may still be required before locking.
```

### `LOCKED`

```txt
The official consolidation run has been finalized and locked.
```

Acceptance:

* Users never see raw enum labels as the primary display.
* `READY_TO_FINALIZE` UI copy does not imply finalization permission is automatically available.
* Copy is short, professional, and finance-user friendly.

---

## PR-R2C-08-03 - Consolidation Journey Stepper

Add a visual stepper component to show progress:

```txt
Entity close packs
Ready to start
Consolidation in progress
Ready for final review
Locked
```

Suggested component:

```txt
ConsolidationReadinessStepper
```

Possible location:

```txt
frontend/src/components/close/ConsolidationReadinessStepper.jsx
```

or keep local inside:

```txt
frontend/src/pages/GroupCloseMonitorPage.jsx
```

State mapping:

```txt
WAITING_FOR_ENTITY_CLOSE:
  current step = Entity close packs

READY_TO_START:
  current step = Ready to start

IN_PROGRESS:
  current step = Consolidation in progress

READY_TO_FINALIZE:
  current step = Ready for final review

LOCKED:
  current step = Locked
```

Visual behavior:

```txt
Completed steps show check icon.
Current step is highlighted.
Future steps are muted.
Mobile layout stacks vertically.
Desktop layout may be horizontal or two-column.
```

Acceptance:

* Stepper clearly shows the current state.
* Stepper does not imply skipped steps.
* Stepper remains readable on mobile.
* Stepper uses accessible text labels, not color alone.

---

## PR-R2C-08-04 - “Why This Status?” Explanation Panel

Add a small explanation panel under the summary card.

For `READY_TO_START`:

```txt
Why this status?

All mandatory entity close packs are locked and up to date.
There is no official consolidation run yet, so you can start it now.
```

For `WAITING_FOR_ENTITY_CLOSE`, use top blocker:

```txt
Why this status?

Consolidation is waiting because 2 entity close packs are not locked or are stale.
Open the blocking items below to resolve them.
```

For `READY_TO_FINALIZE`:

```txt
Why this status?

Operational checks are clear. Final workflow approval may still be required before locking the run.
```

Acceptance:

* Explanation uses `blockingReasons` and `source` where available.
* Explanation does not duplicate long technical blocker codes.
* Explanation is visible without opening a modal.

---

## PR-R2C-08-05 - Blocking Reasons Drill-Down List

Improve the current blocking reason display into a clear drill-down list.

For each blocker, show:

```txt
Title
Short reason
Status / count
Recommended action
Link if available
```

Example:

```txt
Kabul Entity close pack is not locked
Status: In review
Action: Open local close pack
```

Example for stale item:

```txt
Herat Entity close pack is stale
Status: Locked but outdated
Action: Review stale changes
```

Empty state:

```txt
No blocking reasons. All good.
If something blocks consolidation, it will appear here with direct links.
```

Acceptance:

* Empty state is positive and clear.
* Blockers are grouped by meaningful type where possible:

  * missing local close pack
  * not locked
  * stale
  * operational blocker
  * workflow approval
* If a direct link is not available, show a non-clickable explanation instead of a broken link.
* Do not show raw JSON payloads to the user.

---

## PR-R2C-08-06 - Role-Aware CTA Helper Text

Improve CTA messages so users understand why they can or cannot act.

### User can start

Button:

```txt
Start official consolidation run
```

Helper:

```txt
This will create the official consolidation run for this group and period.
```

### User cannot start

Text:

```txt
Ready to start — waiting for Group reporting controller / consolidation preparer.
```

Helper:

```txt
You can view readiness status, but you do not have permission to start the official consolidation run.
```

### User can open run

Button:

```txt
Open consolidation run
```

Helper:

```txt
Review consolidation entries, adjustments, eliminations, and report checks.
```

### User cannot open run

Text:

```txt
The official run is in progress.
```

Helper:

```txt
You can view cockpit readiness status, but opening the run requires consolidation.run.read.
```

### Ready for final review

Button when `canOpenRun = true`:

```txt
Open finalization review
```

Helper:

```txt
Operational checks are clear. Final approval may still be required before locking.
```

Acceptance:

* No hidden/dead action with no explanation.
* Users without permissions still understand who should act.
* Start and open permissions remain separate.
* After starting a run, auto-navigation still requires `canOpenRun`.

---

## PR-R2C-08-07 - Facts Section

Add compact facts to the summary card or a side panel.

Suggested facts from existing payload:

```txt
Local close packs locked
Stale packs
Official run
Operational blockers
Workflow approval
Owner
```

Map from existing fields:

```txt
source.memberReadinessBlockCount
source.nonWorkflowBlockerCount
source.workflowGateRequired
source.workflowGateApproved
source.workflowBlockerCount
entryCount
draftAdjustmentCount
draftEliminationCount
runId
ownerRoleHint
ownerUserId
```

Suggested display:

```txt
Local close packs: Ready / Waiting
Stale packs: 0 / Has stale items
Official run: Not started / Started / Locked
Operational blockers: 0
Workflow approval: Not required / Pending / Approved
Owner: Group reporting controller
```

Acceptance:

* Facts are derived from existing readiness payload.
* Facts do not require new backend fields for V1.
* Missing counts degrade gracefully to `—`.
* Facts help managers understand readiness without reading technical details.

---

## PR-R2C-08-08 - Breadcrumb And Deep-Link Improvements

Improve navigation labels around close cockpit and consolidation run pages.

Breadcrumb example:

```txt
Period Close > Group Close Cockpit > Kabul Group / Jun 2025
```

When opening a run from cockpit, include navigation context if the target page supports query params:

```txt
/consolidation/runs/:groupId/:runId?from=close-cockpit&cycleId=:cycleId
```

On the target consolidation run page, optionally show:

```txt
Back to Group Close Cockpit
```

If changing the target page is too much for this PR, only ensure cockpit links are clear and stable.

Acceptance:

* Cockpit header clearly shows selected group and period.
* Run/open links preserve enough context to return to cockpit.
* If query param support is not available yet, do not block this PR; add TODO.

---

## PR-R2C-08-09 - Recent Activity Panel

Add a lightweight recent activity panel only if existing data is already available from current cockpit/readiness/alerts payloads.

Do not add a new audit table in this PR.

Suggested panel:

```txt
Recent Activity

Jun 20, 10:25 — Consolidation became ready to start
Jun 20, 10:18 — Herat Entity close pack locked
Jun 20, 10:12 — Kabul Entity close pack locked
Jun 19, 17:45 — All entity close packs in review
```

V1 fallback if no audit/activity data exists:

```txt
Recent activity is not available yet.
```

Acceptance:

* Do not fake real audit events.
* Use existing timestamps only.
* If real activity data is unavailable, show a clean empty state.
* Do not block the rest of the UX polish on timeline availability.

---

## PR-R2C-08-10 - Component Structure

Preferred frontend structure:

```txt
frontend/src/pages/CloseCockpitPage.jsx
frontend/src/pages/GroupCloseMonitorPage.jsx
frontend/src/api/closeCycles.js
frontend/src/api/consolidationRuns.js
```

Optional new components:

```txt
frontend/src/components/close/ConsolidationReadinessSummary.jsx
frontend/src/components/close/ConsolidationReadinessStepper.jsx
frontend/src/components/close/ConsolidationReadinessFacts.jsx
frontend/src/components/close/ConsolidationReadinessBlockers.jsx
frontend/src/components/close/ConsolidationReadinessActions.jsx
```

If the project does not already use this component folder pattern, keep components local to `GroupCloseMonitorPage.jsx` to avoid unnecessary structure churn.

Acceptance:

* Prefer readable components over one very large JSX block.
* Do not introduce new UI libraries.
* Reuse existing button/card/badge styles where possible.
* Keep styling consistent with existing cockpit pages.

---

## PR-R2C-08-11 - Accessibility And Responsive Behavior

Accessibility rules:

```txt
Status must be readable as text, not only color.
Buttons must have clear labels.
Disabled/waiting actions must have helper text.
Stepper must expose current step text.
Icons must not be the only information carrier.
```

Responsive rules:

```txt
Desktop:
  Summary card and journey stepper may sit side by side.

Tablet:
  Cards may wrap into two columns.

Mobile:
  Cards stack vertically.
  CTAs are full width.
  Stepper becomes vertical.
  Long labels wrap without overflow.
```

Acceptance:

* No horizontal overflow on mobile.
* CTA remains visible and tappable.
* Tables/lists wrap or stack cleanly.
* Status badge text remains readable.

---

## PR-R2C-08-12 - Tests

Add frontend/static test:

```txt
backend/scripts/test-consolidation-ready-to-start-ux-polish.js
```

Package script:

```txt
test:consolidation:ready-start:ux
```

Test checks:

1. Summary card text exists.
2. Status labels include:

   * Waiting for entity close
   * Ready to start
   * Consolidation in progress
   * Ready for final review
   * Locked
3. UI does not expose raw enum labels as primary labels.
4. Stepper labels exist.
5. Why-this-status panel exists.
6. Blocking reasons section exists.
7. Empty blocker state exists.
8. Role-aware helper text exists for no-permission states.
9. Open-run CTA requires `canOpenRun`.
10. Start CTA still requires `canStart`.
11. `READY_TO_FINALIZE` is displayed as `Ready for final review`.
12. Mobile-friendly class names or layout wrappers exist.
13. No new backend readiness route is introduced.
14. No readiness semantics are changed in `consolidation.ready-to-start.service.js`.

Acceptance:

* Test script passes.
* Existing R2C tests still pass:

  * status
  * RBAC
  * cockpit
  * workflow regression
  * frontend contract
  * idempotent run
  * alerts
* OpenAPI check still passes if no API changes are made.

---

## Suggested Implementation Order

1. Add frontend label/copy mapping helpers.
2. Add summary card.
3. Add journey stepper.
4. Add why-this-status panel.
5. Improve blocking reasons display.
6. Improve role-aware CTA helper text.
7. Add facts section.
8. Add breadcrumb/deep-link polish where low-risk.
9. Add recent activity panel only if existing data is available.
10. Add frontend/static UX test.
11. Run all existing R2C regression tests.

---

## Rollout Notes

* This is a UX-only polish PR.
* Do not change readiness status logic.
* Do not change run creation idempotency.
* Do not change alert persistence rules.
* Do not block rollout on recent activity if no reliable audit source exists.
* Keep copy professional and understandable for finance users, not developers.

---

## Final Acceptance

This polish PR is complete when:

* the group close cockpit has a clear consolidation readiness summary card
* users can visually understand the consolidation journey
* users can see why the current status exists
* blockers are listed with clear next actions
* CTAs explain what happens next
* users without permissions understand who should act
* `READY_TO_FINALIZE` is presented as `Ready for final review`
* open-run actions remain hidden unless `canOpenRun` is true
* the UI works well on desktop and mobile
* all existing R2C regression tests still pass
* the new UX polish test passes
