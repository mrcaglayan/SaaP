# 51A - FOUNDATIONAL IMPLEMENTATION TRACKER

## Status

- Companion tracker for Track 51
- Scope-limited to high-risk foundational slices

## Purpose

Turn the Track 51 roadmap locks into a concrete implementation tracker for the slices where route drift, permission drift, workflow drift, or enforcement drift would be expensive later.

## Existing API Surfaces And UI Productization Status

This section is an inventory in the plain-English sense: a list/catalog of backend surfaces that already exist and their current productization status in the reporting UI. It does not mean stock or warehouse inventory.

- `GET /api/v1/gl/trial-balance`
  - now surfaced through the dedicated local `Mizan` page; later work is about close-pack launch integration and broader report-family hardening rather than initial page activation
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

That order matched the repo when this tracker was created. The live repo now has the foundational local reporting, local close-pack domain, and first-pass enforcement/reopen seams in place; the remaining Track 51 gaps have shifted to `RP07` workspace/evidence/report-launch flow and later hardening slices.

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
- Later live-repo seams now supersede the original RP02 route-deferral wording:
  - `frontend/src/pages/GeneralLedgerPage.jsx` is live for `/app/defter-i-kebir`
  - `/app/muavin` is also live via the same shared ledger page in `MUAVIN` mode
  - the original RP02 bullets above remain historical notes about that step's implementation moment, not the final current repo state

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

### Current implementation notes

- `RP08` implemented the explicit pack actions in:
  - `backend/src/services/local.close-pack.workflow.service.js`
  - `backend/src/routes/local.close-packs.routes.js`
  - `backend/src/routes/local.close-packs.validators.js`
- `RP08` implemented the reusable post-lock enforcement seam in:
  - `backend/src/services/local.close-enforcement.service.js`
- The local close-pack action contract is now:
  - `POST /api/v1/gl/local-close-packs/:packId/submit`
  - `POST /api/v1/gl/local-close-packs/:packId/return`
  - `POST /api/v1/gl/local-close-packs/:packId/approve`
  - `POST /api/v1/gl/local-close-packs/:packId/lock`
- The first-pass action gates are intentionally limited to repo-truth that exists now:
  - exact-scope `DRAFT` journals block `submit` and `approve`
  - workflow approval blocks `approve` when the workflow feature is enabled and a local-close-pack assignment exists but is not yet approved
  - pending reopen requests block `lock`
  - checklist / evidence / exception gates remain deferred until `RP07` and later slices create those domains
- Because the shared workflow runtime is target-unique, `RP08` uses an in-place workflow-instance rearm wrapper for repeated `submit -> return -> submit` cycles:
  - the same `workflow_instances` target row is reset to `PENDING`
  - prior instance decisions are cleared on resubmit
  - this avoids dead-ending the pack on the unique `(tenant_id, process_type, target_type, target_id)` constraint
- Implementing `RP09` before `RP08` did not require a roadmap reorder:
  - `RP09` had already added partial blocked-path routing and readiness invalidation
  - `RP08` absorbed that into the shared enforcement/action layer instead of leaving block logic embedded inside reopen-only code
  - no `51` roadmap lock change was required for the order shift
- First-pass enforcement coverage is now implemented at these seams:
  - `backend/src/routes/gl.write.journal.routes.js`
  - `backend/src/services/gl.journal-reversal.service.js`
  - `backend/src/services/cari.document.service.js`
  - `backend/src/services/cash.service.js`
  - `backend/src/services/inventory.service.js`
  - `backend/src/services/payroll.accruals.service.js`
  - `backend/src/services/revenue-recognition.service.js`
- This coverage also reaches some higher-level posting flows indirectly because they already route through guarded helpers:
  - `backend/src/services/cash.transaction.service.js`
  - `backend/src/services/cash.exchange.service.js`
  - `backend/src/services/cash.session.service.js`
  - `backend/src/services/payments.service.js`
- The following posting hotspots remain explicitly deferred after the fresh repo-wide search and should not be claimed as covered yet:
  - `backend/src/services/cari.settlement.service.js`
  - `backend/src/services/cash.fx.revaluation.service.js`
  - `backend/src/services/inventory.landed-cost.service.js`
  - `backend/src/services/inventory.transfer.service.js`
  - `backend/src/services/payroll.corrections.service.js`
  - `backend/src/services/bank.reconciliationAutoPosting.service.js`
  - `backend/src/services/bank.reconciliationDifferences.service.js`
  - `backend/src/services/fixed-assets.service.js`
  - `backend/src/services/fixed-assets.depreciation.service.js`
  - `backend/src/services/org.write.service.js`
  - `backend/src/services/org.shareholder.helpers.js`
  - `backend/src/services/org.capital-fulfillment.service.js`
  - `backend/src/routes/gl.reclass.routes.js`

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

## `RP07` - Discovery notes before implementation

- The current year-end route `/app/donem-sonu-islemler/yillik/kapanis-islemleri` is already occupied by `frontend/src/pages/YearEndRevrecChecklistPage.jsx`.
  - `RP07` should therefore add a dedicated local-close workspace/detail route family instead of overwriting that existing page.
- Reusable evidence/comment/audit storage seams already exist, but not yet as local-close-pack surfaces:
  - evidence storage lives in `evidence_objects`
  - internal commentary lives in `internal_comments`
  - audit history lives in `audit_logs`
  - `RP07` should add thin local-close wrappers over those shared stores instead of inventing a second attachment/comment/audit subsystem
- The current RP05 statement contract stays legal-entity/book/period anchored in the live repo.
  - `RP07` report launch from OU or `CENTRAL` packs should therefore treat `Bilanco` / `Gelir Tablosu` as statutory close-context views with preserved pack context, not as proof that the repo already has exact-scope OU or central statement semantics.

---

## `RP07` - Current implementation notes

- `RP07` now exposes a dedicated local close workspace and pack-detail shell instead of reusing the already-occupied year-end checklist route:
  - `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri`
  - `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/:packId`
  - implementation lives in:
    - `frontend/src/pages/LocalCloseWorkspacePage.jsx`
    - `frontend/src/pages/LocalClosePackDetailPage.jsx`
    - `frontend/src/App.jsx`
    - `frontend/src/layouts/sidebarConfig.js`
    - `frontend/src/i18n/messages.js`
- The local close backend now has first-pass RP07 wrappers over the shared evidence, comment, audit, and reviewed-report stores:
  - `backend/src/services/local.close-pack.workspace.service.js`
  - `backend/src/services/local.close-pack.evidence.service.js`
  - `backend/src/services/local.close-pack.comments.service.js`
  - `backend/src/routes/local.close-packs.routes.js`
  - `backend/src/routes/local.close-packs.validators.js`
  - `backend/src/migrations/m158_local_close_pack_report_reviews.js`
- Workspace list/detail rows now surface first-pass derived progress metrics instead of a second state engine:
  - reviewed report count
  - completion percentage
  - blocker count
  - warning count
  - evidence/comment counts
  - last activity timestamps
- Pack detail currently ships these tabs:
  - overview
  - checklist
  - reports
  - exceptions
  - evidence
  - comments
  - audit
- Report-launch integration is now live:
  - `Mizan`, `Defter-i Kebir`, and `Muavin` launch with exact pack scope where the repo supports it
  - `Bilanco` and `Gelir Tablosu` launch as statutory entity-level fallback while preserving close-pack context explicitly
  - report pages now preserve `closePackId` and `closeLaunchMode` while rewriting their filter query strings
  - launched report headers now show close context and let `ouclose.prepare` users persist reviewed-report fingerprints
- Release-clean hardening now also covers the current live RP05/RP07 route family:
  - `backend/openapi.yaml` now exports the RP07 workspace/detail read-write surfaces used by the local close shell
  - `backend/scripts/test-ux-rsrep01-local-report-family-smoke.js` now covers the local report family route/OpenAPI/close-context seam
  - `backend/scripts/test-ux-rsclose01-local-close-workspace-contract.js` now covers first-pass pack metrics, report-review reads, audit reads, and RP07 route/OpenAPI wiring
  - `backend/scripts/fixtures/rswire03-release-gate-manifest.json` now includes the current local report pages and local close workspace route so `RS-WIRE-03` no longer lags the live repo
- Duplicate pack creation is still blocked by the unique scope constraint, but the workspace now treats that as recoverable UX:
  - when the same entity/book/period/scope pack already exists, the create flow redirects to the existing pack instead of leaving the user on a raw conflict
- The live repo needed one compatibility correction during RP07:
  - audit-log pack-id matching now uses numeric comparison instead of string collation-sensitive comparison, so mixed `utf8mb4_unicode_ci` / `utf8mb4_0900_ai_ci` databases do not break pack list or audit reads
- `Deferred item already covered`:
  - deeper reopen policy, post-lock enforcement, and broader blocker/publish governance still belong to `RP08`, `RP09`, `RP12`
  - broader reconciliation views and drill-across remain `RP10` and `RP11`
- `Optional hardening`:
  - frontend chunk splitting remains a build warning, not a functional blocker
  - deeper end-to-end browser automation still does not exist for the RP07 workspace/report-launch journey

---

## Out Of Scope For This Tracker

These remain in the main Track 51 roadmap beyond the live repo progress documented below:

- `RP10` reconciliation/exception views
- `RP11` consolidated drill-across
- `RP12` higher-order blockers and publish gates
- `RP13` export/fingerprint/performance hardening

## `RP12` - Discovery notes before implementation

- The live repo already has one realistic first-pass `RP12` seam for report-backed close controls:
  - `frontend/src/pages/YearEndRevrecChecklistPage.jsx` now provides selected-period REVREC setup and balance checks
  - the page reuses posted trial balance plus existing REVREC split/rollforward reports instead of introducing a second hidden accounting engine
- `Deferred item already covered`
  - full close-block wiring and publish-state gating still belong to `RP12`
  - closing-period vs next-period opening continuity checks, including REVREC deferred/accrual carry-forward, should extend this existing year-end REVREC seam rather than create a parallel control page
- `Optional hardening`
  - if the first `RP12` implementation pass stays narrow, start continuity mismatches as warning-mode controls before promoting them to hard close blockers

### Current implementation notes

- `RP12` now surfaces first-pass local close-pack review gates on the existing pack detail seam instead of creating a second close-control page:
  - backend:
    - `backend/src/services/local.close-pack.workflow.service.js`
    - `backend/src/routes/local.close-packs.routes.js`
  - frontend:
    - `frontend/src/api/localClosePacks.js`
    - `frontend/src/pages/LocalClosePackDetailPage.jsx`
- The local close-pack detail response now returns additive `reviewGate` data beside the existing pack row and `entityReadiness`.
- The first-pass local close-pack review gate is intentionally limited to repo-truth that already exists:
  - missing required report reviews block `approve`
  - exact-scope `DRAFT` journals block `submit` and `approve`
  - workflow approval still blocks `approve` when required and not yet approved
  - pending reopen requests block `lock`
  - missing evidence and readiness invalidation are surfaced as warnings, not hard blockers
- Local close-pack approval is now actually enforced against missing report reviews with machine-readable code:
  - `LOCAL_REPORT_REVIEW_MISSING`
- `RP12` now adds a first-pass consolidation publish gate on the existing run/report flow instead of adding a separate publish workspace:
  - backend:
    - `backend/src/services/consolidation.review-gate.service.js`
    - `backend/src/routes/consolidation.js`
  - frontend:
    - `frontend/src/api/consolidationAdmin.js`
    - `frontend/src/pages/ConsolidationReportsPage.jsx`
- The live consolidation review gate route is:
  - `GET /api/v1/consolidation/runs/:runId/review-gate`
- The consolidation finalize gate now extends beyond execution/worklist/workflow-only truth and still stays explainable from the live report engine:
  - no posted consolidation entries yet
  - draft adjustments remain
  - draft eliminations remain
  - workflow approval gate not yet approved
  - consolidated trial-balance delta must stay within the shared report epsilon
  - consolidated balance-sheet equation delta must stay within the shared report epsilon
- The consolidation balance-sheet / income-statement routes and the RP12 review gate now reuse the same shared report-math service:
  - `backend/src/services/consolidation.report-math.service.js`
  - this avoids a second hidden publish-math formula path
- Finalize now uses that review gate server-side and returns the first blocker code plus full gate details instead of relying only on the earlier workflow-only check.
- `RP12` now extends the existing year-end REVREC seam rather than creating a parallel continuity surface:
  - `frontend/src/pages/YearEndRevrecChecklistPage.jsx`
- The year-end REVREC page now covers:
  - selected-period posted GL vs REVREC split validation
  - closing-period vs next-period opening carry-forward continuity per REVREC family using the existing rollforward report
- The continuity slice is still intentionally first-pass:
  - it validates current closing vs next opening totals per family
  - residual long/short reclass closure still relies on the existing selected-period split-vs-GL controls on the same page
  - full close-block wiring into the broader pack/entity/consolidation publish chain remains later hardening
- The deeper `RP12` follow-up is now live on the existing seams:
  - `backend/src/services/revrec.year-end-review.service.js` reuses the live REVREC rollforward report to evaluate strict carry-forward continuity without inventing a second close-control formula path
  - `backend/src/services/local.close-pack.workflow.service.js` now surfaces central-pack `REVREC_CONTINUITY_*` blockers in the review gate and enforces them on `approve` / `lock`
  - `backend/src/services/consolidation.review-gate.service.js` now hard-blocks finalize when mandatory member local close scopes are not fully `LOCKED`
  - operator drill paths now route into the existing year-end REVREC page, local close workspace, or exact local close-pack page instead of adding parallel blocker UIs
- The binding `RP12` policy decisions are now implemented:
  - REVREC continuity mismatches are blocker-grade, not warning-only
  - consolidation finalize requires mandatory member scopes to be fully `LOCKED`; `APPROVED` is not sufficient
  - publish-math tolerances stay on strict epsilon
  - drill depth uses the deepest existing route chain the repo already exposes cleanly, with graceful fallback where lower-level lineage routes still do not exist
- The still-deferred items that remain owned by `RP12`, not `RP13`, are:
  - broader end-to-end close/publish blocking across the current pack/entity/consolidation chain
  - broader operator drill-through from consolidation math blockers into lower-level journal/source evidence where the repo still lacks a tighter published-support chain

## `RP10` - Discovery notes before implementation

- The live repo already has one realistic first-pass RP10 slice for control-account reconciliation without inventing a second accounting engine:
  - `backend/src/services/gl.purpose-mappings.service.js` can resolve the configured `CARI_*_CONTROL*` account mappings per legal entity
  - `backend/src/services/cari.report.service.js` already exposes as-of open-item rows with counterparty and document operating-unit context
  - `backend/src/services/journal.source-link.service.js` and the existing ledger-report shape already preserve journal-to-source lineage for drillthrough
- The most realistic first pass is therefore:
  - GL control-account balances vs CARI open-item residuals
  - grouped by direction plus OU/counterparty where the source lineage allows it
  - with explicit exception surfacing for control-account lines missing expected CARI linkage or subledger reference
- Reusable frontend seams already exist for RP10:
  - `frontend/src/hooks/usePersistedFilters.js` for saved/reusable filter state
  - `frontend/src/utils/journalSourceLinkDestinations.js` for source drillback routing
  - `frontend/src/pages/GeneralLedgerPage.jsx` for report-family filter/query and journal/source drill patterns

## `RP10` - Current implementation notes

- `RP10` now implements one first-pass reconciliation slice inside the Track 51 report family:
  - `/app/cari-kontrol-mutabakati`
  - backend route family:
    - `GET /api/v1/gl/cari-control-reconciliation`
    - `GET /api/v1/gl/cari-control-reconciliation/detail`
- The implemented slice is deliberately narrow and accounting-first:
  - configured CARI control-account balances vs CARI open-item residuals
  - grouped by:
    - direction
    - OU / `CENTRAL`
    - counterparty where source lineage exists
  - explicit exception surfacing for:
    - control-account lines missing expected CARI linkage
    - control-account lines missing subledger reference
    - balance differences between GL and open-item residuals
- `RP10` keeps OU as a reconciliation axis, not a separate accounting engine:
  - the live repo still reads one local legal-entity/book truth
  - OU only filters and groups the same accounting truth
- The backend RP10 read/drillthrough surface is implemented in:
  - `backend/src/services/gl.cari-control-reconciliation.service.js`
  - `backend/src/routes/gl.reconciliation.routes.js`
  - `backend/src/routes/gl.reconciliation.validators.js`
  - `backend/src/routes/gl.js`
- The frontend RP10 route/report-family surfacing is implemented in:
  - `frontend/src/pages/CariControlReconciliationPage.jsx`
  - `frontend/src/App.jsx`
  - `frontend/src/api/glReports.js`
  - `frontend/src/reporting/localReportConfig.js`
  - `frontend/src/layouts/sidebarConfig.js`
  - `frontend/src/i18n/messages.js`
- Drillthrough now follows:
  - reconciliation row
  - GL journal lines
  - source open-item rows
  - source/journal destinations where the repo already has destination routing
- Reusable filter behavior landed as URL-backed deep-link filters inside the current report-family seam:
  - legal entity
  - book
  - fiscal period
  - OU scope / OU
  - direction
  - counterparty
  - row mode
  - the shared local-report query helper now preserves the RP10 filter subset for deep links
- The first RP10 characterization/smoke contract now exists in:
  - `backend/scripts/test-ux-rsrecon01-cari-control-reconciliation-contract.js`
  - `backend/package.json`
  - `backend/scripts/fixtures/rswire03-release-gate-manifest.json`
  - `backend/openapi.yaml`
- `Deferred item already covered`
  - additional reconciliation families and broader exception work remain later roadmap work under `RP11` / `RP12`
- `Optional hardening`
  - move from URL-backed reusable filters to stronger saved-view/persisted-filter UX only if this report family grows materially
  - broaden beyond `RS-RECON-01` if more reconciliation slices are added later

## `RP11` - Current implementation notes

- `RP11` now surfaces the previously unsurfaced consolidated report reads inside the existing consolidated reporting page instead of creating a parallel drill-across surface:
  - `GET /api/v1/consolidation/runs/:runId/reports/trial-balance`
  - `GET /api/v1/consolidation/runs/:runId/reports/summary`
  - implementation currently lives in:
    - `frontend/src/pages/ConsolidationReportsPage.jsx`
    - `frontend/src/api/glAdmin.js`
- The first shipped drill-across chain is explicitly mapping-aware:
  - consolidated trial balance or consolidated summary row
  - mapped member-entity breakdown from the consolidated summary endpoint
  - member-local report entry points
  - not one-step direct local ledger lineage
- `RP11` reuses the current repo seams for member support detail instead of inventing a second reporting family:
  - `frontend/src/pages/ConsolidationReportsPage.jsx`
  - `frontend/src/pages/TrialBalancePage.jsx`
  - `frontend/src/pages/LocalStatementPage.jsx`
  - `frontend/src/api/consolidationAdmin.js`
  - `frontend/src/api/glReports.js`
- Member breakdown now enriches consolidated rows with existing group-member metadata where permissions allow:
  - consolidation method
  - ownership percentage
  - legal-entity member context
- Local drill entry now resolves one actual member book via the existing `listBooks({ legalEntityId })` seam instead of assuming that one legal entity always has exactly one local book.
- The live repo still keeps local and consolidated naming compatibility explicit:
  - current repo run fields remain:
    - `consolidationGroupId`
    - `fiscalPeriodId`
    - `presentationCurrencyCode`
  - Track 51 canonical naming still maps them conceptually to:
    - `groupId`
    - `consolidationPeriodId`
    - `reportingCurrencyId`
- The richer consolidated support slice now keeps local-base support values explicit without changing consolidation math:
  - the consolidated summary endpoint now returns source-currency metadata on summary rows and totals
  - the consolidated drill-across UI now distinguishes:
    - one functional/source currency
    - mixed local-currency support
    - unavailable currency context
  - mixed-currency support rows stay plain local-base sums instead of being labeled as if they were one reporting-currency amount
- Member-book drill resolution is now stricter and safer:
  - if exactly one local book exists for the selected member entity, it is auto-selected
  - if multiple books exist, the UI now requires an explicit book choice
  - if no books exist, the blocked local-drill state is shown explicitly
- `Conflict / plan gap`
  - none discovered during this RP11 pass; the existing consolidated trial-balance/summary endpoints were sufficient for the first shipped drill-across slice.
- `Deferred item already covered`
  - direct consolidated-row -> local ledger deep links remain intentionally deferred because consolidated group accounts can map to multiple local accounts.
  - broader consolidated drill-across hardening, publication blockers, and export/fingerprint layers remain `RP12` / `RP13`.
- `Optional hardening`
  - keep richer consolidated support detail inside Track 51 as additive post-`RP11` hardening, not a separate follow-on plan.
  - richer member-breakdown filters and mapping explanation can be added later only if they preserve canonical-mapping awareness instead of implying one-to-one lineage.
  - safer account-level drill-eligibility rules should be made explicit before any deeper consolidated-row -> local ledger navigation is attempted.
  - deeper backend filters for account-specific summary slices could reduce frontend row filtering later, but were not required for the first RP11 flow.

## `RP13` - Current implementation notes

- `RP13` chose one additive audit-durability slice on the existing consolidated drill-across surface instead of broad generic performance work:
  - `frontend/src/pages/ConsolidationReportsPage.jsx`
  - `frontend/src/utils/reportFingerprint.js`
- The consolidated reporting page now preserves first-pass audit evidence for the currently loaded surfaces without changing report math or drill semantics:
  - stable frontend report fingerprints derived from:
    - selected run context
    - current report parameters
    - loaded response snapshot
  - CSV export for the currently loaded:
    - consolidated `Bilanco`
    - consolidated `Gelir Tablosu`
    - consolidated trial balance
    - consolidated summary
    - member breakdown
    - selected member local-drill context
- The RP13 hardening pass also now clears loaded consolidated report state when the selected run changes, so export/fingerprint evidence cannot silently mix one run's snapshot with another run id.
- Consolidated support exports keep local-base vs translated/reporting-currency context explicit instead of flattening them into one misleading amount:
  - local-base support rows export source-currency mode/code/count fields
  - translated balances remain the canonical reporting-currency amounts
  - selected member local-drill exports also preserve the current local report route chain where available
- `RP13` `Prompt 7B` now reuses the shared immutable export-snapshot retention seam for one narrow persisted evidence slice instead of inventing a second retention subsystem:
  - `backend/src/migrations/m159_track51_export_snapshots.js`
  - `backend/src/services/consolidation.report-snapshots.service.js`
  - `backend/src/routes/consolidation.js`
  - `frontend/src/api/consolidationAdmin.js`
  - `frontend/src/pages/ConsolidationReportsPage.jsx`
- The first persisted-snapshot pass is intentionally narrow and explainable:
  - snapshot type: `TRACK51_CONSOLIDATED_MEMBER_SUPPORT`
  - scope anchor: the selected member legal entity from the consolidated drill chain
  - stored item coverage:
    - member breakdown
    - selected member local-drill context
  - the shared `period_export_snapshots` and `period_export_snapshot_items` tables remain the only storage seam
- The server-side immutable evidence layer is now additive to the existing frontend fingerprints rather than replacing them:
  - backend-created `snapshot_hash`
  - backend-created per-item `item_hash`
  - stored export columns and exported row payloads
  - stored client fingerprint basis for the loaded report instance
  - run/group/member/support-account/book metadata needed to reproduce the reviewed/exported drill state
- `RP13` `Prompt 7C` chose the wider report-family rollout slice instead of a first measured performance pass:
  - shared rollout component:
    - `frontend/src/components/ReportAuditPanel.jsx`
  - widened current frontend-only audit/export/fingerprint coverage to:
    - `frontend/src/pages/TrialBalancePage.jsx`
    - `frontend/src/pages/GeneralLedgerPage.jsx`
    - `frontend/src/pages/LocalStatementPage.jsx`
    - `frontend/src/pages/CariControlReconciliationPage.jsx`
- The widened frontend rollout preserves each page's existing evidence semantics instead of flattening them into one generic export:
  - `Mizan`
    - posted trial-balance rows
  - `Defter-i Kebir` / `Muavin`
    - ledger detail rows
    - grouping summary rows
  - local statements
    - statement rows
    - the explicit account-summary middle drill step when loaded
  - `RP10` reconciliation
    - reconciliation rows
    - expanded drill detail when opened
- `Deferred item already covered`
  - broader close/publish governance still remains owned by `RP12`, not this `RP13` slice
- `Optional hardening`
  - deeper performance work remains the higher-value remaining `RP13` residue after `7C`
  - persisted server-side snapshots still do not cover every widened non-consolidation report surface; those pages now have consistent frontend audit/export behavior first
  - frontend chunk splitting remains a build warning, not a Track 51 semantic blocker
- `RP13` `Prompt 7D` chose the first measured performance slice instead of redoing rollout:
  - `frontend/src/App.jsx` now lazy-loads the heaviest Track 51 route surfaces behind the existing permission guard seam:
    - `frontend/src/pages/TrialBalancePage.jsx`
    - `frontend/src/pages/GeneralLedgerPage.jsx`
    - `frontend/src/pages/LocalStatementPage.jsx`
    - `frontend/src/pages/CariControlReconciliationPage.jsx`
    - `frontend/src/pages/LocalCloseWorkspacePage.jsx`
    - `frontend/src/pages/LocalClosePackDetailPage.jsx`
    - `frontend/src/pages/YearEndRevrecChecklistPage.jsx`
    - `frontend/src/pages/ConsolidationReportsPage.jsx`
  - the performance change is additive only:
    - route-level code splitting
    - unchanged report semantics, export meaning, and audit evidence context
  - the main bundle no longer eagerly includes those heavy Track 51 pages for every authenticated session
  - measured build outcome on the current repo:
    - the main frontend chunk dropped from about `3.76 MB` to about `3.49 MB` minified after route-level splitting
    - the Vite chunk-size warning still remains, so deeper tuning stays optional hardening rather than claimed closure
- `Optional hardening`
  - manual chunk tuning or deeper per-page render/query optimization may still be useful if the frontend build warning persists after route-level splitting
  - persisted server-side snapshots are still narrow compared with the widened frontend audit/export rollout
- `RP13` now has both follow-up dimensions materially covered on the current repo:
  - wider frontend audit/export/fingerprint rollout from `Prompt 7C`
  - one measured performance slice from `Prompt 7D`
- `Optional hardening`
  - any remaining residue is now optional follow-on hardening inside the same roadmap step rather than a missing Track 51 deliverable:
    - deeper per-page render/query optimization
    - broader persisted snapshot coverage for non-consolidation pages
    - manual chunk tuning if build warnings still remain

## `RP04` - Current implementation notes

- `RP04` did not create a second ledger engine.
  - `frontend/src/pages/GeneralLedgerPage.jsx` now serves both:
    - `Defter-i Kebir`
    - `Muavin`
  - route mode is selected from:
    - `/app/defter-i-kebir`
    - `/app/muavin`
- `/app/muavin` is now fully surfaced in the current repo:
  - `frontend/src/App.jsx`
  - `frontend/src/reporting/localReportConfig.js`
  - `frontend/src/layouts/sidebarConfig.js`
- The backend shared ledger contract stayed on the dedicated RP03 seam:
  - `backend/src/routes/gl.ledger.routes.js`
  - `backend/src/routes/gl.ledger.validators.js`
  - `backend/src/services/gl.ledger-report.service.js`
- `RP04` widened the shared ledger filter contract for the same route/service family instead of adding a separate Muavin route family:
  - `accountCodeFrom`
  - `accountCodeTo`
  - `operatingUnitScope`
  - `operatingUnitId`
  - `subledgerReferenceNo`
  - `sourceType`
  - `status`
  - `includeReversed`
  - `groupBy`
- `sourceModule` is currently a compatibility alias, not a distinct GL storage field:
  - the live repo still does not have a dedicated GL journal `source_module` column on `journal_entries`
  - `RP04` therefore maps `sourceModule` and `sourceType` to the same current journal source category for ledger-report reads
  - later steps can harden this only if a true GL source-module seam is introduced
- Account scope now supports both:
  - one exact `accountId`
  - one account-code range via `accountCodeFrom/accountCodeTo`
- First-pass grouping landed as additive grouped totals, not as a second result shape:
  - `grouping.rows` now returns filtered grouped totals for:
    - month
    - source type
    - operating unit
    - subledger ref
  - row-level ledger detail remains the canonical drillthrough payload
- `RP04` still intentionally leaves these items deferred:
  - reconciliation views
  - export / print
  - a true GL-specific source-module taxonomy beyond the current alias
  - local statements / close workspace layers handled by later roadmap steps

## `RP05` - Current implementation notes

- `RP05` now exposes real local statement pages for:
  - `/app/bilanco`
  - `/app/gelir-tablosu`
- The frontend RP05 statement surface is implemented in:
  - `frontend/src/pages/LocalStatementPage.jsx`
  - `frontend/src/App.jsx`
  - `frontend/src/api/glReports.js`
  - `frontend/src/reporting/localReportConfig.js`
- The backend RP05 statement read/drillthrough surface is implemented in:
  - `backend/src/services/gl.statement-report.service.js`
  - `backend/src/routes/gl.statement.routes.js`
  - `backend/src/routes/gl.statement.validators.js`
  - `backend/src/routes/gl.js`
- The first RP05 characterization contract check now exists in:
  - `backend/scripts/test-ux-rsstat01-local-statements-contract.js`
  - it locks the point-in-time `Bilanco`, fiscal-year-to-date `Gelir Tablosu`, synthetic current-year-result handling, auto-close exclusion, and statement-row-to-account-summary reconciliation expectations
  - `backend/package.json` now also wires `test:ux:rsstat01` into `test:release-gate:core`
- The live API contract now surfaces the current report-family read endpoints in:
  - `backend/openapi.yaml`
  - exported paths now include:
    - `/api/v1/gl/ledger-report`
    - `/api/v1/gl/balance-sheet-report`
    - `/api/v1/gl/income-statement-report`
    - `/api/v1/gl/statement-account-summary`
- The RP05 statutory statement contract is now explicitly locked as:
  - `Bilanco` is point-in-time at the selected fiscal-period end
  - `Gelir Tablosu` is fiscal-year-to-date through the selected fiscal period
  - retained earnings stay on posted equity balances
  - current-year result is shown as a separate synthetic/computed balance-sheet row until posted year-end close absorbs it
  - statement signs are presentation-normalized instead of exposing raw debit/credit polarity
  - statement drillthrough follows:
    - statement row
    - account summary
    - ledger detail
- `RP05` does not reuse consolidated statement semantics blindly:
  - the live repo uses one explicit local mapping source for statement rows
  - the first pass stays accounting-first and statutory/local-book anchored
- `Deferred item already covered`
  - OU / `CENTRAL` / no-OU expansion and broader date-range/report-family behavior remain intentionally deferred to later Track 51 steps; `RP05` stays period-first and legal-entity/book anchored
- `Optional hardening`
  - evolve the explicit local mapping source into a versioned statement-definition layer if multiple statutory layouts or effective-dated mapping changes later become mandatory
  - expand beyond `RS-STAT-01` into broader RP05 characterization coverage only if the statement surface grows materially beyond the current first-pass statutory contract

## Working Rule

Use this tracker as a living checklist for:

- likely files to create
- likely files to modify
- discovery notes / open seams

Do not try to make it predict every file perfectly. If implementation reveals a better seam, update this tracker instead of forcing the code into a bad plan shape.
