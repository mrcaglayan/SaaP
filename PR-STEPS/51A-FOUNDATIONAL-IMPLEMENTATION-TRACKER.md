# 51A - FOUNDATIONAL IMPLEMENTATION TRACKER

## Status
- Companion tracker for Track 51
- Scope-limited to high-risk foundational slices

## Purpose
Turn the Track 51 roadmap locks into a concrete implementation tracker for the slices where route drift, permission drift, workflow drift, or enforcement drift would be expensive later.

## Planning Rule

Use file/seam-level planning in this tracker for:

- `RP01` shared reporting contract / permissions / routes
- `RP03` shared `Defter-i Kebir` ledger engine
- `RP06` local close-pack domain model
- `RP08` post-lock enforcement
- `RP09` reopen and readiness invalidation

Use only a thin file-level plan here for:

- `RP02` real `Mizan`

Keep the later slices at module/service/page level in Track 51 until the foundational contracts above are implemented:

- `RP04`
- `RP05`
- `RP07`
- `RP10`
- `RP11`
- `RP12`
- `RP13`

## Execution Order

1. `RP01`
2. `RP02`
3. `RP03`
4. `RP06`
5. `RP08`
6. `RP09`

That order matches the current repo: the accounting truth already exists, but the local reporting product layer, local close-pack domain, and cross-entry-point enforcement do not.

---

## `RP01` - Shared reporting contract, permissions, and navigation foundation

### Why this is in the tracker

- route activation is split across frontend routing and sidebar config
- permission drift would be expensive later
- query/filter naming drift here would cascade into every later report and close-pack launch

### Likely files to create

- `frontend/src/api/glReports.js`
- `backend/src/routes/gl.report.validators.js`

Optional, depending on how early route separation is desired:

- `backend/src/routes/gl.reporting.routes.js`

### Likely files to modify

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/i18n/messages.js`
- `frontend/src/api/glAdmin.js`
- `backend/src/seedCore.js`
- `backend/src/routes/gl.read.journal.routes.js`

### Discovery notes / open seams

- Decide whether local reporting helpers stay in `glAdmin.js` or move into `glReports.js`.
- Decide whether shared report validators live inside existing GL read routes or under a dedicated reporting route file.
- Lock the exact filter encoding for:
  - all scopes
  - one OU
  - `CENTRAL/HQ`
- Decide the permission namespace before seeding:
  - dedicated local-report permission family
  - or reuse a smaller number of existing GL read permissions in V1

### Ready-to-implement check

- one agreed local-report query vocabulary exists
- one agreed drillthrough query vocabulary exists
- route activation plan is explicit
- permission additions are listed before UI routes are activated

---

## `RP02` - Real `Mizan Raporu` local summary page

### Why this is only a thin file-level slice

- the backend already has a usable trial-balance foundation
- the main risk is not file spread; it is keeping `Mizan` aligned with the later ledger-detail contract

### Likely files to create

- `frontend/src/pages/TrialBalancePage.jsx`

Optional only if needed during implementation:

- `frontend/src/components/reports/TrialBalanceTable.jsx`
- `frontend/src/components/reports/ReportHeaderContext.jsx`

### Likely files to modify

- `frontend/src/App.jsx`
- `frontend/src/api/glReports.js`
- `frontend/src/api/glAdmin.js`
- `backend/src/routes/gl.read.journal.routes.js`

### Discovery notes / open seams

- Keep V1 period-first even if OU/CENTRAL expansion lands later.
- Make the row-click payload match the future ledger-detail contract from `RP03`, even if the ledger page lands one step later.
- If OU / `CENTRAL/HQ` filtering is not cheap in `RP02`, do not fake it in UI; keep it explicitly deferred.

### Ready-to-implement check

- real page component replaces placeholder routing
- page consumes posted trial-balance data from the existing endpoint
- drillthrough payload contract is aligned with `RP03`

---

## `RP03` - Shared `Defter-i Kebir` ledger engine

### Why this is in the tracker

- this is the first real shared engine in the reporting family
- if route/query/service structure drifts here, `Muavin` and statement drillthrough will inherit the wrong shape

### Likely files to create

- `frontend/src/pages/GeneralLedgerPage.jsx`
- `frontend/src/api/glReports.js`
- `backend/src/services/gl.ledger-report.service.js`
- `backend/src/routes/gl.ledger.validators.js`

Choose one route home early:

- `backend/src/routes/gl.ledger.routes.js`
- or `backend/src/routes/gl.reporting.routes.js`

### Likely files to modify

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- `backend/src/seedCore.js`
- `backend/src/routes/gl.read.journal.routes.js`

### Discovery notes / open seams

- Decide whether ledger detail is its own route file or stays under a broader reporting route file.
- Decide whether opening balance is computed live in V1 or abstracted behind a service that can later absorb snapshots.
- Lock the exact query contract for:
  - fiscal-period range
  - date range
  - account / account range
  - pagination
  - sorting
- Prefer a dedicated ledger-report service rather than bloating journal list/detail routes.

### Ready-to-implement check

- one route exists for report-grade ledger detail
- one page exists as the canonical drillthrough target
- opening balance and running balance are returned from one stable contract

---

## `RP06` - Local close-pack domain model, statuses, role model, and permission contract

### Why this is in the tracker

- workflow-type expansion is a schema/runtime concern
- status model drift here would break `RP07`, `RP08`, and `RP09`
- this is the point where `CENTRAL/HQ` becomes a first-class close-pack scope

### Likely files to create

- `backend/src/migrations/m0xx_local_close_packs.js`
- `backend/src/routes/local.close-packs.routes.js`
- `backend/src/routes/local.close-packs.validators.js`
- `backend/src/services/local.close-packs.service.js`

Potentially now or in `RP09`:

- `backend/src/services/entity.close-readiness.service.js`

### Likely files to modify

- `backend/src/routes/workflows.routes.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
- `backend/src/seedCore.js`

Important implementation note:

- do not rewrite `m082_close_consolidation_workflow_approvals.js`
- add a follow-on migration that extends the workflow/process model cleanly

### Discovery notes / open seams

- Decide whether local close packs reuse workflow instances directly or whether pack rows own the business state and link to workflow rows.
- Finalize the permission-code namespace before seeding:
  - keep `ouclose.*`
  - or rename to a broader namespace before rollout starts
- Decide whether entity-readiness rollups start here or land in `RP09`.
- Decide which fields belong on the pack header versus checklist/evidence/comment child tables.

### Ready-to-implement check

- scope model is explicit for `OPERATING_UNIT` vs `CENTRAL_HQ`
- status lifecycle is explicit
- workflow reuse path is chosen
- permission namespace is frozen before seed/migration work

---

## `RP08` - Local close-pack submit / return / approve / lock workflow and post-lock controls

### Why this is in the tracker

- this slice changes system behavior, not just UI
- the repo has many posting paths, so missing one path would create silent policy holes

### Likely files to create

- `backend/src/services/local.close-enforcement.service.js`
- `backend/src/services/local.close-pack.workflow.service.js`

### Likely files to modify

Primary control points:

- `backend/src/routes/local.close-packs.routes.js`
- `backend/src/services/local.close-packs.service.js`
- `backend/src/routes/gl.write.journal.routes.js`
- `backend/src/services/gl.journal-reversal.service.js`

First-pass posting hotspot review list:

- `backend/src/routes/gl.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.settlement.service.js`
- `backend/src/services/cash.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/payroll.accruals.service.js`
- `backend/src/services/revenue-recognition.service.js`
- `backend/src/services/bank.reconciliationAutoPosting.service.js`
- `backend/src/services/org.write.service.js`
- `backend/src/services/org.shareholder.helpers.js`

### Discovery notes / open seams

- Centralize post-lock checks in one reusable guard service instead of duplicating status checks across modules.
- Before closing `RP08`, run a repo-wide search for:
  - `INSERT INTO journal_entries`
  - `status = 'POSTED'`
  - `reverseJournalEntryTx`
- Decide override-path payload shape early:
  - reason
  - actor
  - scope
  - audit action
- Decide whether blocked-path responses return only an error or also a structured reopen payload hint.

### Ready-to-implement check

- approval and lock actions exist
- ordinary post/reverse paths call a shared close guard
- first-pass indirect posting hotspots are reviewed and either guarded or explicitly deferred with a named follow-up

---

## `RP09` - Local close-pack reopen workflow, late-change governance, and entity-readiness invalidation

### Why this is in the tracker

- reopen policy is where late-change governance becomes real
- if readiness invalidation is left to discovery, entity state will drift from pack state

### Likely files to create

- `backend/src/services/local.close-reopen.service.js`
- `backend/src/services/entity.close-readiness.service.js`

If reopen validation becomes large enough:

- `backend/src/routes/local.close-reopen.validators.js`

### Likely files to modify

- `backend/src/routes/local.close-packs.routes.js`
- `backend/src/routes/local.close-packs.validators.js`
- `backend/src/services/local.close-packs.service.js`
- `backend/src/services/workflows.service.js`
- `backend/src/services/gl.journal-reversal.service.js`
- `backend/src/routes/gl.write.journal.routes.js`

Frontend files become relevant once `RP07` UI lands:

- `frontend/src/api/localClosePacks.js`
- `frontend/src/pages/LocalCloseWorkspacePage.jsx`
- `frontend/src/pages/LocalClosePackDetailPage.jsx`

### Discovery notes / open seams

- Decide whether reopen requests are first-class records or status transitions with structured reason payload.
- Decide where entity readiness is recalculated:
  - synchronously on each status change
  - or through a dedicated aggregation/update service
- Decide whether already-published-period exceptions reuse the same reopen domain object or require a stricter approval path.
- Keep `EVIDENCE_CORRECTION_ONLY` on a separate code path from financially relevant reopen logic.

### Ready-to-implement check

- reopen request model exists
- entity readiness invalidates automatically when mandatory packs reopen or return
- blocked late-posting/reversal paths can route operators into the governed reopen path

---

## Out Of Scope For This Tracker

These remain in the main Track 51 roadmap until the foundational slices above land:

- `RP04` `Muavin`
- `RP05` local statements
- `RP07` workspace UI buildout beyond the contract implications already listed above
- `RP10` reconciliation/exception views
- `RP11` consolidated drill-across
- `RP12` higher-order blockers and publish gates
- `RP13` export/fingerprint/performance hardening

## Working Rule

Use this tracker as a living checklist for:

- likely files to create
- likely files to modify
- discovery notes / open seams

Do not try to make it predict every file perfectly. If implementation reveals a better seam, update this tracker instead of forcing the code into a bad plan shape.
