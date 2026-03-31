# 51 - PROMPT A

## Status
- Ready-to-paste prompt file
- Ordered by current foundational implementation sequence

## Purpose
Provide a clean set of Codex prompts for Track 51 implementation work.

## Source Of Truth

Use these prompts with:

- `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md`
  - roadmap lock
- `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md`
  - implementation tracker

## Current Implementation Order

1. `RP01`
2. `RP02`
3. `RP03`
4. `RP06`
5. `RP08`
6. `RP09`

---

## Prompt 1 - `RP01` Shared reporting contract / permissions / navigation

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP01` shared reporting contract / permissions / navigation foundation.

Before changing code:
- verify current repo seams in `frontend/src/App.jsx`, `frontend/src/layouts/AppLayout.jsx`, `frontend/src/layouts/sidebarConfig.js`, `frontend/src/api/glAdmin.js`, `backend/src/seedCore.js`, and the GL read routes
- verify the current seeded permission footprint in `backend/src/seedCore.js` and make the RP01 local-report permission plan explicit before adding new permission codes
- compare actual repo behavior against `51` and `51A`
- update `51A` first if the real seams differ materially

Implement:
- shared local-report query contract scaffolding
- route activation scaffolding for the local report family
- permission additions needed for local reports / local ledger detail / local statements
- minimal frontend API organization for report reads

Constraints:
- do not build full report pages yet
- for `/app/muavin`, reserve contract/path/query semantics only if helpful; do not add a normal-user sidebar entry or visible placeholder page before `RP04`
- do not introduce naming that conflicts with Track 51
- update `51` only if a roadmap-level lock or repo-fit statement is wrong

At the end:
- run relevant checks
- summarize files changed, contract decisions, permission changes, and remaining gaps
```

---

## Prompt 2 - `RP02` Real `Mizan Raporu`

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP02` real `Mizan Raporu` local summary page.

Before changing code:
- verify the current trial-balance backend/API seams
- verify current routing/sidebar state for `/app/mizan-raporu`
- update `51A` if the actual file seams differ

Implement:
- a real `Mizan` page replacing placeholder routing
- integration with the existing trial-balance read API
- a page header that can carry period / close-context metadata
- a drillthrough payload contract aligned with future `RP03` ledger detail

Constraints:
- keep V1 period-first
- do not fake OU / central / no-OU filtering if backend support is not actually implemented
- keep the page aligned with Track 51 contract naming
- update `51` only if a roadmap-level assumption is wrong

At the end:
- run relevant checks
- summarize files changed, page behavior, drillthrough status, and remaining backend gaps
```

---

## Prompt 3 - `RP03` Shared `Defter-i Kebir` ledger engine

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP03` shared `Defter-i Kebir` ledger engine.

Before changing code:
- verify the current journal list/detail seams and source-link drillback seams
- compare them against the `RP03` tracker notes
- carry forward the `RP02` implementation notes explicitly:
  - convert the existing prepared `Mizan` -> `Defter-i Kebir` payload into live `RP03` navigation
  - do not assume `RP03` automatically resolves the current legacy `Mizan` read-permission dependency unless you actually refactor the shared report-read ownership
  - keep OU / `CENTRAL` / no-OU, date-range basis for `Mizan`, and include-zero behavior deferred unless backend support is actually implemented
- update `51A` if the real route/service/page seams differ materially

Implement:
- a dedicated report-grade ledger-detail backend read surface
- a real `/app/defter-i-kebir` page
- opening balance + in-range movement rows + running balance
- pagination / sorting / filtering needed for V1
- live drillthrough target behavior for the existing `Mizan` row payload contract

Constraints:
- prefer a dedicated ledger-report service/route seam over bloating generic journal routes
- keep contract naming aligned with Track 51
- if you also clean up the current `Mizan` permission dependency as part of a shared reporting-route refactor, update `TrialBalancePage.jsx` and record the change in `51A`; otherwise leave that gap explicitly open
- do not broaden into `Muavin` yet unless required for a clean shared seam
- update `51` only if a roadmap-level lock or repo-fit statement is wrong

At the end:
- run relevant checks
- summarize files changed, route/API added, opening/running balance behavior, whether `Mizan` drillthrough is now live, and which RP02 gaps remain deferred
```

---

## Prompt 4 - `RP06` Local close pack domain model

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP06` local close pack domain model, statuses, role model, and permission contract.

Before changing code:
- verify the current workflow engine model, validators, process types, and seeded permissions
- verify the current migration head and use the next real migration number instead of a placeholder filename
- verify reusable close/reopen patterns from period close and payroll close
- verify whether `frontend/src/pages/settings/WorkflowSetupPage.jsx` also needs extension for any new workflow process type/admin surface
- update `51A` first if the real domain seams differ materially

Implement:
- the minimal backend domain for local close packs
- explicit scope model for `OPERATING_UNIT` and `CENTRAL`
- explicit status model and role/permission model
- workflow reuse path as a clean extension or clean wrapper
- baseline route/service/migration scaffolding for local close packs

Constraints:
- do not treat current workflow engine support as drop-in for local close packs
- do not build the full workspace UI yet
- keep implementation naming aligned with `local close packs` and the repo's current `CENTRAL` / `OPERATING_UNIT` conventions even if business/UI copy later says `CENTRAL/HQ`
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, migration/permission/workflow decisions, and what remains for `RP07-RP09`
```

---

## Prompt 5 - `RP08` Local close pack workflow and post-lock controls

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP08` local close pack submit / return / approve / lock workflow and post-lock controls.

Before changing code:
- verify current posting and reversal entry points across the repo
- verify current close/reopen gating seams in GL and related posting services
- compare actual posting/reversal hotspots against the tracker list and a fresh repo-wide search before claiming coverage
- update `51A` with actual enforcement coverage seams before implementation if needed

Implement:
- explicit submit / return / approve / lock actions for local close packs
- shared close-guard enforcement for post-approval / post-lock behavior
- blocking of ordinary posting/reversal into approved or locked scopes
- first-pass coverage across the main posting and reversal entry points

Constraints:
- do not claim enforcement coverage unless it is actually implemented or explicitly documented as deferred
- prefer one reusable enforcement seam over duplicated guards
- do not broaden into reopen policy except where required for blocked-path responses
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, enforcement coverage achieved, uncovered posting paths, and tracker updates
```

---

## Prompt 6 - `RP09` Local close pack reopen workflow and readiness invalidation

```text
Use `PR-STEPS/51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md` as the roadmap lock
and `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md` as the implementation tracker.
Treat any `Current implementation notes` already recorded in `51A` for earlier steps as binding unless the live repo now differs materially.

Work only on `RP09` local close pack reopen workflow, late-change governance, and entity-readiness invalidation.

Before changing code:
- verify current reopen patterns in period close, payroll close, and workflow decisions
- verify whether entity-readiness logic already exists anywhere reusable
- update `51A` first if the actual seams differ materially

Implement:
- governed reopen request flow for local close packs
- explicit differentiation between financially relevant reopen and `EVIDENCE_CORRECTION_ONLY`
- automatic entity-readiness invalidation when mandatory packs reopen or return
- blocked-path routing from late posting/reversal into the governed reopen path where appropriate

Constraints:
- do not mix evidence-only correction with financial reopen logic
- keep published-period exceptions on a clearly stricter path
- update `51` only if a roadmap-level lock is wrong

At the end:
- run relevant checks
- summarize files changed, reopen model, readiness invalidation behavior, and remaining governance gaps
```

---

## Usage Note

Run these in order.

If implementation reveals a better seam:

- update `51A` first
- update `51` only if a roadmap-level lock or repo-fit statement is actually wrong

Do not start later prompts until the earlier prompt's contract decisions are stable enough for reuse.
