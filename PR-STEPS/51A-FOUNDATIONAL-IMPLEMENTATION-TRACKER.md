# 51A - FOUNDATIONAL IMPLEMENTATION TRACKER

## Status
- Companion tracker for Track 51
- Scope-limited to high-risk foundational slices

## Purpose
Turn the Track 51 roadmap locks into a concrete implementation tracker for the slices where route drift, permission drift, workflow drift, or enforcement drift would be expensive later.

## Existing API Surfaces Not Yet In Product UI

This section is an inventory in the plain-English sense: a list/catalog of backend surfaces that already exist but are not yet productized in the reporting UI. It does not mean stock or warehouse inventory.

- `GET /api/v1/gl/trial-balance`
  - already used in setup/workbench flows, but not yet surfaced as a dedicated `Mizan` page
- `GET /api/v1/consolidation/runs/:runId/reports/trial-balance`
  - backend and permissions already exist, but no current frontend page/API wrapper surfaces it
- `GET /api/v1/consolidation/runs/:runId/reports/summary`
  - backend and permissions already exist, but no current frontend page/API wrapper surfaces it
- `POST /api/v1/consolidation/runs/:runId/eliminations`
  - create endpoint exists, but the current consolidation UI does not yet expose a real create flow
- `POST /api/v1/consolidation/runs/:runId/adjustments`
  - create endpoint exists, but the current consolidation UI does not yet expose a real create flow
- workflow instance detail / decision API wrappers
  - client helpers already exist for instance detail and approve/reject actions, but there is no current workflow instance UI using them
- journal-list source-link enrichment
  - the journal list API already supports `includeSourceLinks`, but the current list UX does not yet surface that enriched list view

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
- `frontend/src/reporting/localReportConfig.js`
- `backend/src/routes/gl.report.validators.js`

Optional, depending on how early route separation is desired:

- `backend/src/routes/gl.reporting.routes.js`

### Likely files to modify

- `frontend/src/App.jsx`
- `frontend/src/layouts/AppLayout.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/i18n/messages.js`
- `frontend/src/api/glAdmin.js`
- `backend/src/seedCore.js`
- `backend/src/routes/gl.read.journal.routes.js`

### Discovery notes / open seams

- Decide whether local reporting helpers stay in `glAdmin.js` or move into `glReports.js`.
- Decide whether shared report validators live inside existing GL read routes or under a dedicated reporting route file.
- Route activation needs to account for the repo's current ordinary-user vs preview-admin gating for unimplemented modules.
- Treat `/app/muavin` as a route-contract reservation in `RP01`, not as required visible navigation:
  - `RP01` may reserve naming/deep-link/query semantics for `/app/muavin`
  - visible sidebar/i18n/router surfacing for a real `Muavin` page belongs to `RP04`
- Permission namespace is a real seed-scope decision, not just wording:
  - the current `PERMISSIONS` array in `backend/src/seedCore.js` already contains 211 seeded permissions
  - `RP01` still needs to decide whether local reports get a dedicated permission family or reuse a tighter subset of existing GL read permissions in V1
  - that decision should be made with `RP06` in mind because Track 51 also introduces the close-pack permission family
- Lock the exact filter encoding for:
  - all scopes
  - one OU
  - explicit central / no-OU scope, with `CENTRAL/HQ` treated only as business/UI copy if desired
- Decide the permission namespace before seeding:
  - dedicated local-report permission family
  - or reuse a smaller number of existing GL read permissions in V1

### Ready-to-implement check

- one agreed local-report query vocabulary exists
- one agreed drillthrough query vocabulary exists
- route activation plan is explicit
- `/app/muavin` ownership is explicit: reserve contract in `RP01` if useful, but defer visible user-facing surfacing to `RP04`
- permission additions are listed before UI routes are activated

### Current implementation notes

- `RP01` chose a dedicated local-report permission family:
  - `gl.report.local.read`
  - `gl.report.ledger.read`
  - `gl.report.statement.read`
- `RP01` introduced shared local-report scaffolding seams:
  - `frontend/src/reporting/localReportConfig.js`
  - `frontend/src/api/glReports.js`
  - `backend/src/routes/gl.report.validators.js`
- `/api/v1/gl/trial-balance` now accepts the shared local-report contract wrapper for the V1-supported subset and returns additive `filters` metadata.
- Unsupported later-phase dimensions on `/api/v1/gl/trial-balance` are rejected explicitly instead of being silently ignored:
  - OU scope
  - date range
  - account filters
  - subledger/source/status extensions
- `/app/muavin` is reserved at the contract/path level only; no normal-user sidebar/i18n/router surfacing was added in `RP01`.
- `frontend/src/App.jsx` and `frontend/src/layouts/AppLayout.jsx` remained unchanged in `RP01` because the current placeholder-route and sidebar gating behavior could be reused from existing sidebar config patterns.
- Existing backend reads still enforce their current legacy permissions such as `gl.trial_balance.read` and `gl.journal.read` until later dedicated local-report read routes land.

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
- If OU / central / no-OU filtering is not cheap in `RP02`, do not fake it in UI; keep it explicitly deferred.

### Ready-to-implement check

- real page component replaces placeholder routing
- page consumes posted trial-balance data from the existing endpoint
- drillthrough payload contract is aligned with `RP03`

### Current implementation notes

- `RP02` activated a real `frontend/src/pages/TrialBalancePage.jsx` route for `/app/mizan-raporu`.
- `RP02` marks only `Mizan Raporu` as implemented in `frontend/src/reporting/localReportConfig.js`; `Defter-i Kebir`, `Bilanco`, `Gelir Tablosu`, and `/app/muavin` remain deferred.
- The live page keeps the `RP02` contract period-first and only uses the currently supported subset:
  - `legalEntityId`
  - `bookId`
  - `fiscalPeriodId`
  - `includeRollup`
- `RP02` does not fake OU / `CENTRAL` / no-OU filtering, date-range basis, or include-zero behavior.
- The page header now shows additive report context from the trial-balance response and tries to show latest period-close context when `gl.period.close` is available.
- Because backend reads still rely on legacy route permissions, the live `Mizan` page still needs the current legacy read set to be usable:
  - `org.tree.read`
  - `gl.book.read`
  - `org.fiscal_period.read`
  - `gl.trial_balance.read`
- Row drillthrough now prepares the future `Defter-i Kebir` path/query payload using the shared local-report contract, but live navigation remains deferred until `RP03` activates the ledger page.

---

## `RP03` - Shared `Defter-i Kebir` ledger engine

### Why this is in the tracker

- this is the first real shared engine in the reporting family
- if route/query/service structure drifts here, `Muavin` and statement drillthrough will inherit the wrong shape

### Likely files to create

- `frontend/src/pages/GeneralLedgerPage.jsx`

Already landed in the repo before the RP03 page/productization work:

- `backend/src/services/gl.ledger-report.service.js`
- `backend/src/routes/gl.ledger.validators.js`
- `backend/src/routes/gl.ledger.routes.js`

### Likely files to modify

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/reporting/localReportConfig.js`
- `frontend/src/api/glReports.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- `frontend/src/pages/TrialBalancePage.jsx`

### Discovery notes / open seams

- The dedicated route home is already chosen in the live repo:
  - `backend/src/routes/gl.ledger.routes.js`
- The backend already exposes `GET /api/v1/gl/ledger-report` behind `gl.report.ledger.read`.
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

### Current implementation notes

- The backend dedicated ledger-report seam is now live and remains the chosen RP03 route home:
  - `backend/src/routes/gl.ledger.routes.js`
  - `backend/src/routes/gl.ledger.validators.js`
  - `backend/src/services/gl.ledger-report.service.js`
- `RP03` added the real frontend ledger page:
  - `frontend/src/pages/GeneralLedgerPage.jsx`
- `RP03` activated `/app/defter-i-kebir` in:
  - `frontend/src/App.jsx`
  - `frontend/src/reporting/localReportConfig.js`
- `RP03` added a dedicated frontend API helper in `frontend/src/api/glReports.js` for `GET /api/v1/gl/ledger-report`.
- The live `Mizan` -> `Defter-i Kebir` drillthrough payload from `RP02` is now the real navigation target; `frontend/src/pages/TrialBalancePage.jsx` no longer describes it as future-only behavior.
- The backend ledger payload now returns:
  - book display/base-currency metadata
  - opening balance
  - in-range movement rows
  - running balance
  - enriched journal source links per row
- Parent / roll-up account drillthrough is handled in the ledger service by expanding the selected account into its active descendant subtree, so Mizan roll-up clicks do not collapse to an empty exact-account read.
- `RP03` did not claim to resolve the older `Mizan` legacy lookup/read dependency from `RP02`; that gap remains open unless a later shared reporting-read refactor removes it explicitly.
- Deferred items still intentionally remain outside RP03:
  - `Muavin` mode
  - OU / `CENTRAL` / no-OU filters
  - subledger/source/status filters
  - include-zero behavior
  - broader statement/report-family expansion

---

## `RP06` - Local close-pack domain model, statuses, role model, and permission contract

### Why this is in the tracker

- workflow-type expansion is a schema/runtime concern
- status model drift here would break `RP07`, `RP08`, and `RP09`
- this is the point where the central / no-OU pack becomes a first-class close-pack scope

### Likely files to create

- `backend/src/migrations/m156_local_close_packs.js`
  - or the next available migration number at implementation time if the repo head has moved beyond `m155`
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
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`

Important implementation note:

- do not rewrite `m082_close_consolidation_workflow_approvals.js`
- add a follow-on migration that extends the workflow/process model cleanly

### Discovery notes / open seams

- Decide whether local close packs reuse workflow instances directly or whether pack rows own the business state and link to workflow rows.
- The current generic workflow engine is not yet a drop-in local-close-pack host:
  - `backend/src/routes/workflows.validators.js` still hard-codes only `PERIOD_CLOSE` and `CONSOLIDATION_RUN`
  - `backend/src/migrations/m082_close_consolidation_workflow_approvals.js` still defines workflow table enums for only those two process/target families
  - `backend/src/services/workflows.service.js` still resolves workflow-instance target scope through period-close and consolidation joins only
  - `frontend/src/pages/settings/WorkflowSetupPage.jsx` still exposes only those two process types in the admin UI
- `RP06` therefore needs explicit workflow-engine extension work plus a follow-on workflow-enum migration; it should not be treated as configuration-only reuse.
- Keep implementation enums aligned with the repo's existing `CENTRAL` / `OPERATING_UNIT` values unless there is an intentional migration; `CENTRAL/HQ` can remain business/UI copy.
- Finalize the permission-code namespace before seeding:
  - keep `ouclose.*`
  - or rename to a broader namespace before rollout starts
- Treat permission expansion as a deliberate Track 51 design step:
  - the roadmap already defines at least 10 close-pack permissions in the `ouclose.*` family
  - combined with whatever `RP01` chooses for local-report permissions, Track 51 will materially expand `backend/src/seedCore.js`
  - freeze the local-report and close-pack permission families together before seed/migration work starts
- Decide whether entity-readiness rollups start here or land in `RP09`.
- `backend/src/services/module-readiness.service.js` still treats close/consolidation workflow readiness as a two-process concern:
  - `PERIOD_CLOSE`
  - `CONSOLIDATION_RUN`
  - local close packs can remain outside that readiness module in `RP06` unless a later step intentionally widens the readiness contract
- Decide which fields belong on the pack header versus checklist/evidence/comment child tables.

### Ready-to-implement check

- scope model is explicit for `OPERATING_UNIT` vs `CENTRAL`
- status lifecycle is explicit
- workflow reuse path is chosen
- permission namespace is frozen before seed/migration work

### Current implementation notes

- `RP06` created the baseline local close-pack header domain in:
  - `backend/src/migrations/m156_local_close_packs.js`
  - `backend/src/services/local.close-packs.shared.js`
  - `backend/src/services/local.close-packs.service.js`
  - `backend/src/routes/local.close-packs.validators.js`
  - `backend/src/routes/local.close-packs.routes.js`
- `RP06` chose the clean-extension workflow path, not drop-in reuse:
  - local close packs keep their own header table
  - workflow definitions / assignments / instances are extended to support the new process family
  - workflow runtime links back to the pack header through `workflow_instance_id`
- Workflow-engine process/target support was extended as:
  - `process_type = LOCAL_CLOSE_PACK`
  - `target_type = LOCAL_CLOSE_PACK`
- The local close-pack header domain currently includes:
  - `legalEntityId`
  - `bookId`
  - `fiscalPeriodId`
  - `closeScopeType = OPERATING_UNIT | CENTRAL`
  - `operatingUnitId` when `closeScopeType = OPERATING_UNIT`
  - stable `scope_key` for uniqueness
  - header status / owner-reviewer placeholders / workflow-instance link
- `RP06` froze the close-pack permission family in `backend/src/seedCore.js`:
  - `ouclose.read`
  - `ouclose.prepare`
  - `ouclose.submit`
  - `ouclose.review`
  - `ouclose.approve`
  - `ouclose.lock`
  - `ouclose.request_reopen`
  - `ouclose.reopen`
  - `ouclose.override_post_lock`
  - `ouclose.admin`
- `frontend/src/pages/settings/WorkflowSetupPage.jsx` now exposes `LOCAL_CLOSE_PACK` as a workflow process type.
- The default workflow-step seed for `LOCAL_CLOSE_PACK` stays `LEGAL_ENTITY` scoped by default:
  - this is intentional because `CENTRAL` packs do not have an operating-unit target id
  - OU-specific multi-step approval can still be configured later in the JSON step editor or with dedicated definitions/assignments
- `RP06` did not yet widen `backend/src/services/module-readiness.service.js`:
  - the existing `closeConsolidationWorkflow` readiness module still tracks only `PERIOD_CLOSE` and `CONSOLIDATION_RUN`
  - local close-pack readiness aggregation remains deferred to later close-pack steps
- `RP06` did not build the close workspace UI, workflow actions, or reopen governance yet:
  - those remain with `RP07`, `RP08`, and `RP09`

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
- `backend/src/services/cash.transaction.service.js`
- `backend/src/services/cash.exchange.service.js`
- `backend/src/services/cash.session.service.js`
- `backend/src/services/cash.service.js`
- `backend/src/services/cash.fx.revaluation.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/inventory.landed-cost.service.js`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/services/payments.service.js`
- `backend/src/services/payroll.accruals.service.js`
- `backend/src/services/payroll.corrections.service.js`
- `backend/src/services/revenue-recognition.service.js`
- `backend/src/services/bank.reconciliationAutoPosting.service.js`
- `backend/src/services/bank.reconciliationDifferences.service.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js`
- `backend/src/services/org.write.service.js`
- `backend/src/services/org.shareholder.helpers.js`
- `backend/src/services/org.capital-fulfillment.service.js`
- `backend/src/routes/gl.reclass.routes.js`

### Discovery notes / open seams

- Centralize post-lock checks in one reusable guard service instead of duplicating status checks across modules.
- Keep helper/resolver modules separate from direct posting hotspots:
  - `ou.self-balancing.service.js` currently resolves self-balancing accounts for posting services, but is not itself a journal-posting seam
  - `cari.tax.integration.service.js` currently computes tax augmentation/journal lines, but does not itself post journals
  - `inventory.landed-cost.runtime.service.js` currently mutates landed-cost runtime state against already-posted vouchers, but does not itself post journals
  - `payroll.settlementOverrides.service.js` currently drives override approval/application flow, but is not currently a direct journal-posting seam
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
- tracker hotspot coverage has been compared against a repo-wide search before claiming enforcement completeness

---

## `RP09` - Local close-pack reopen workflow, late-change governance, and entity-readiness invalidation

### Why this is in the tracker

- reopen policy is where late-change governance becomes real
- if readiness invalidation is left to discovery, entity state will drift from pack state

### Likely files to create

- `backend/src/migrations/m157_local_close_pack_reopen_requests.js`
- `backend/src/services/local.close-reopen.service.js`
- `backend/src/services/entity.close-readiness.service.js`
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

### Current implementation notes

- `RP09` chose first-class reopen request records, not pack-status-only payloads:
  - `backend/src/migrations/m157_local_close_pack_reopen_requests.js`
  - `backend/src/services/local.close-reopen.service.js`
  - `backend/src/routes/local.close-reopen.validators.js`
- The governed reopen domain now distinguishes:
  - financially relevant reopen requests
  - `EVIDENCE_CORRECTION_ONLY`
- Financial reopen approval executes pack-state change:
  - request stays `REQUESTED` until reviewer action
  - approval of financially relevant requests sets pack status to `REOPENED` and request status to `EXECUTED`
  - approval of `EVIDENCE_CORRECTION_ONLY` leaves the pack status unchanged and marks the request `APPROVED`
  - rejection marks the request `REJECTED`
- The repo still has no reusable entity-close readiness store, so `RP09` implemented derived readiness in:
  - `backend/src/services/entity.close-readiness.service.js`
- Derived entity readiness now uses the mandatory scope family for one entity/book/period:
  - all active operating units under the legal entity
  - one mandatory `CENTRAL` pack
- Derived readiness currently returns the pack-driven subset that is actually supportable before entity-close workflow lands:
  - `NOT_READY`
  - `PARTIALLY_READY`
  - `READY_FOR_ENTITY_REVIEW`
  - `ENTITY_REOPENED`
- `backend/src/services/module-readiness.service.js` remains untouched in `RP09`:
  - local close-pack readiness stays outside the older close/consolidation workflow readiness module
  - this was intentional, not missed work
- `backend/src/routes/local.close-packs.routes.js` now exposes:
  - `GET /api/v1/gl/local-close-packs/:packId` with additive `entityReadiness`
  - `GET /api/v1/gl/local-close-packs/:packId/reopen-requests`
  - `POST /api/v1/gl/local-close-packs/:packId/reopen-requests`
  - `POST /api/v1/gl/local-close-packs/:packId/reopen-requests/:requestId/approve`
  - `POST /api/v1/gl/local-close-packs/:packId/reopen-requests/:requestId/reject`
- `backend/src/services/local.close-packs.service.js` now adds `pendingReopenRequestCount` on pack rows for later workspace surfacing.
- Blocked-path routing is only partial in `RP09`, by design:
  - manual GL journal post now checks for approved/locked local close packs in `backend/src/routes/gl.write.journal.routes.js`
  - shared journal reversal now checks the same rule in `backend/src/services/gl.journal-reversal.service.js`
  - broader posting-hotspot enforcement still remains with `RP08`
- Journal scope attribution for blocked-path routing follows the Track 51 lock:
  - exactly one OU journal scope -> that OU pack can block and hint reopen
  - all-null OU journal scope -> the `CENTRAL` pack can block and hint reopen
  - mixed-scope / multi-OU journals are intentionally not blocked by one local close pack alone
- Already-group-published reopen requests now require stricter approval:
  - the request record stores `downstreamStage`
  - `GROUP_PUBLISHED` approval paths additionally require `ouclose.admin`

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
