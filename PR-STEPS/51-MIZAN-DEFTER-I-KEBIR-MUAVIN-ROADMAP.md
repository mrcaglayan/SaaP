# 51 - MIZAN / DEFTER-I KEBIR / MUAVIN ROADMAP

## Status
- Roadmap note
- Planned follow-up track

## Purpose
Define a chronological rollout plan for GL summary-to-detail reporting so finance users can move from posted local balances to ledger detail, entity statements, period-close evidence, and then consolidated review without leaving the reporting flow.

## Companion Tracker

For the high-risk foundational implementation slices, use:

- `PR-STEPS/51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md`

Use this roadmap for target architecture, step order, and locked report semantics. Use `51A` as the live-repo progress tracker when implementation moves ahead of the original planning baseline.

## Current Repo Fit

The repo now has the core accounting and first-pass local reporting surfaces needed to advance this track:

- posted journal list/detail read APIs already exist
- trial balance by `book + fiscal period` already exists
- shared local ledger detail read now exists for `Defter-i Kebir` / `Muavin`
- local statement reads now exist for `Bilanco`, `Gelir Tablosu`, and statement-row account summary drillthrough
- source-link drillback and reverse-block destination enrichment already exist
- period-close run and workflow-gate foundations already exist
- consolidation trial-balance / summary / balance-sheet / income-statement read surfaces already exist
- the app router already implements the consolidated reports page
- foundational local report pages now exist for:
  - `Mizan`
  - `Defter-i Kebir`
  - `Muavin`
  - local `Bilanco`
  - local `Gelir Tablosu`
- the local close-pack domain foundation now exists, but the full close workspace/report-launch/evidence experience is still incomplete

This means Track 51 should not wait for every future business module. It should productize the reporting layer on top of posted accounting truth that already exists.

## Current Delivery Gap

The biggest remaining gap is not posted accounting truth or the first-pass report pages. It is turning those foundations into a coherent close-pack and report-family workflow with stronger hardening around evidence, reconciliation, export, and later consolidated drill-across.

### Frontend gap

- local close-pack UI is still missing for:
  - workspace shell
  - pack detail tabs
  - evidence/comments/audit views
  - approval / reopen actions
- report-family UX is still incomplete around:
  - close-context report launch and prefilled scope handoff
  - deeper reconciliation / exception views
  - export / fingerprint / performance hardening

### Backend / domain gap

- local report reads now exist, but the report family still needs:
  - closer integration with close-pack launch/evidence flow
  - broader reconciliation / exception slices
  - later export / fingerprint / scale hardening
- local close-pack domain and workflow foundations now exist, but later slices still need:
  - workspace/evidence/comment/audit surfaces
  - richer checklist / evidence / comment child domains
  - fuller report-driven operator flow across submit / return / approve / lock / reopen
- enforcement hooks are still missing across:
  - journal post
  - repost
  - reversal
  - imports / batches
  - recurring / background flows

This means the roadmap is not speculative. It is describing a real missing product layer in the current repo.

## Existing API Surfaces Not Yet In Product UI

Several backend/reporting surfaces already exist but are still not fully productized into the main Track 51 reporting and close workflow:

- consolidated trial-balance and consolidated summary report endpoints already exist, but the current consolidated reports page does not surface them
- consolidated elimination and adjustment draft-create endpoints already exist, but the current consolidated reports page mainly lists and posts existing drafts
- workflow instance detail / approve / reject endpoints already exist, but the current UI mostly uses workflow list/read surfaces and setup screens instead of a report-driven approval flow
- journal list read already supports optional source-link enrichment, but the current journal workbench mainly uses source links from journal detail

This matters for Track 51 because some gaps are genuinely missing backend/domain work, while other gaps are mainly missing UI-UX productization on top of APIs that already exist.

## Reusable Repo Seams

The repo already has reusable implementation seams that Track 51 should build on rather than bypass:

### Frontend seams

- `frontend/src/App.jsx`
  - implemented-route activation
  - placeholder-route fallback
- `frontend/src/layouts/AppLayout.jsx`
  - ordinary-user menu surfacing
  - preview-admin gating for unimplemented routes
- `frontend/src/layouts/sidebarConfig.js`
  - existing menu paths and permission wiring
- `frontend/src/api/glAdmin.js`
  - existing GL read helpers
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
  - current workflow setup UI limited to `PERIOD_CLOSE` and `CONSOLIDATION_RUN`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
  - journal browse/detail and journal-oriented workflow patterns
- `frontend/src/pages/ConsolidationReportsPage.jsx`
  - report-page shape for the consolidated layer
- `frontend/src/pages/payroll/PayrollCloseControlsPage.jsx`
  - close-control / reopen UX patterns
- `frontend/src/pages/ExceptionsWorkbenchPage.jsx`
  - exception-workbench UX patterns
- `frontend/src/pages/IntercompanyReconciliationPage.jsx`
  - reconciliation-oriented UX patterns
- `frontend/src/pages/ModulePlaceholderPage.jsx`
  - placeholder surfacing for not-yet-built routes

### Backend seams

- `backend/src/routes/gl.read.journal.routes.js`
  - posted journal list/detail and trial-balance reads
- `backend/src/routes/gl.period-closing.routes.js`
  - period-close workflow and reopen patterns
- `backend/src/routes/consolidation.js`
  - consolidated report and drill-across-adjacent read patterns
- `backend/src/routes/workflows.routes.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
  - reusable workflow-assignment / decision / approval-gate mechanics
- `backend/src/migrations/m082_close_consolidation_workflow_approvals.js`
  - current workflow schema foundation
- `backend/src/services/journal.source-link.service.js`
  - source-lineage drillback foundation
- existing evidence routes/services for other domains
  - reusable evidence/comment/audit patterns, not a ready-made local close-pack domain

Track 51 should reuse these seams where they fit, but should not pretend that the local report family or the local close-pack domain already exists.

## Product Direction

- `Mizan Raporu` is the first summary surface for local books and periods.
- Clicking an account row opens ledger detail directly.
- `Defter-i Kebir` and `Muavin` share one ledger-detail engine.
- `Muavin` is a reporting mode / preset, not a separate accounting engine.
- `Bilanco` and `Gelir Tablosu` come after the local ledger engine is trustworthy.
- Period-close should consume these reports as review/evidence surfaces.
- Consolidation should come after local reporting and entity-close evidence are stable.
- Hard report-driven blocks should be added only after the underlying reports are trusted and operationally usable.

## Core Reporting Policy

### 1. Posted GL is the source of truth

- Track 51 reads from posted accounting truth first:
  - `journal_entries`
  - `journal_lines`
  - existing source-link drillback metadata
- Do not wait for future modules like staff advances or extra deferred-income UX tracks before building the reporting engine.
- If a future workflow posts correctly to GL, it should automatically appear in these reports.

### 2. Build local before consolidated

- Start with local book / legal-entity reporting.
- Then add period-close evidence usage.
- Then extend into consolidation drill-across and consolidated review.

### 3. Treat OU as a filter axis first, not a separate report engine

- Operating unit should first appear as:
  - a filter
  - a grouping axis
  - an exception/reconciliation lens
- Do not start by building separate OU-only financial statement engines before the local legal-entity ledger and statement layer is stable.

### 4. Checks and blocks come after report trust

- First build readable, drillable reports.
- Then use them in close and consolidation review.
- Only then add report-based checks, warnings, and blockers.

### 5. Close and approval flow is hierarchical

- the reporting workflow should mirror finance chronology, not bypass it
- review should move:
  - OU review / OU close support
  - entity close approval
  - entity submitted / locked
  - group review / consolidation
  - group approved / published
- this should align with the repo's existing legal-entity close and consolidation workflow-gate direction rather than introducing a parallel ad-hoc reporting status model
- OU close in this track is a review/signoff layer and evidence pack, not a separate standalone accounting close engine with its own independent statement truth

## Ledger-Detail Core Principle

- One source of truth for account movement detail.
- Many entry points:
  - direct menu entry
  - drillthrough from `Mizan`
  - drillthrough from journals or account-oriented workflows

## Shared Design Locks

These locks should be treated as part of the roadmap, not deferred implementation trivia.

### 1. Local vs consolidated filter contracts must both exist

- local reporting contract must standardize:
  - `legalEntityId`
  - `bookId`
  - `fiscalPeriodId` and/or approved date-range fields
  - `accountId` / account code range
  - `operatingUnitId`
  - explicit central / no-OU filter semantics
  - `subledgerReferenceNo`
  - source type / source module
  - status / include reversed behavior
- consolidated reporting contract must standardize:
  - either reuse current repo names or define one explicit compatibility mapping for:
    - `consolidationGroupId` vs `groupId`
    - `fiscalPeriodId` vs `consolidationPeriodId`
    - `presentationCurrencyCode` vs `reportingCurrencyId`
  - `subgroupId` where applicable
  - `consolidationRunId` or version/scenario identifier
  - member `legalEntityId` where drill-across narrows into one entity
- local and consolidated routes must not drift into different naming conventions.
- omitted `operatingUnitId` must not silently mean central/no-OU when report semantics intend "all scopes".
- local reporting must distinguish clearly between:
  - all scopes
  - one explicit OU
  - explicit central/no-OU scope where `operating_unit_id IS NULL`

### 2. Period/date behavior must be locked early

- V1 local reports are period-first by default.
- `Mizan` is period-based first.
- ledger detail may support either fiscal-period range or explicit date range, but the opening-balance rule must stay deterministic.
- close and evidence links should always preserve the exact period/date basis that the user reviewed.

### 3. Currency behavior must be explicit

- local reports should use local book/base currency as the primary balance basis in V1.
- running balance is computed on one canonical report currency basis, not mixed per row.
- transaction/reference currency can be added later as supplemental display detail, not as an alternate running-balance engine.
- consolidated reports must explicitly use reporting/group currency and preserve lineage back to local currency books where needed.

### 4. Statement semantics must be locked before build

- `Bilanco` and `Gelir Tablosu` rows must resolve from a defined statement mapping source.
- sign conventions must be explicit and stable.
- retained earnings / current-year result presentation must be locked before implementation.
- statement drillthrough must follow: statement row -> account summary -> ledger detail.
- non-posting / header accounts should be presentation rows only unless the underlying model explicitly supports otherwise.

### 5. Evidence and audit durability starts before final hardening

- close-support reports must preserve at least a minimal evidence fingerprint before full enterprise hardening lands.
- minimum evidence identity should include:
  - report type
  - filter parameters
  - report basis
  - period/date basis
  - currency basis
  - close run / review context when launched from close
- full bundle/export hardening can remain later, but sign-off support must not rely on unstable ad-hoc state.

### 6. Navigation ladder must be explicit

- local summary row -> local ledger detail
- ledger row -> journal detail
- journal/source row -> source transaction/workflow where link exists
- consolidated summary row -> member entity summary or mapped breakdown first
- member entity summary -> local `Mizan` / local statement / ledger detail as appropriate
- do not imply one-step consolidated-row -> one local account when mapping is many-to-many.

### 7. Permissions must be part of the contract

- define who can:
  - view local reports
  - open journal detail from reports
  - follow source links into operational modules
  - view consolidated reports
  - export reports / evidence bundles
- report drillthrough must respect downstream module permissions instead of bypassing them.

### 8. Baseline performance rules apply from day one

- server-side filtering, pagination, and sorting are part of V1/V2 report contracts.
- do not wait for the final hardening phase to add basic large-volume safety.
- later snapshotting / async export work should harden the same semantics, not replace them.

### 9. Close-state ladder must be explicit in report design

For this repo, the target approval/status ladder should be:

1. `OU Close`
2. `Entity Close Approval`
3. `Entity Submitted / Locked`
4. `Group Review / Consolidation`
5. `Group Approved / Published`

Interpretation in repo terms:

- `OU Close`
  - not a separate legal close engine
  - OU-level review pack / variance review / subledger reconciliation / exception cleanup
  - feeds the entity close decision
- `Entity Close Approval`
  - legal-entity / book-level close workflow and supporting report evidence
  - should align with existing period-close workflow-gate direction
- `Entity Submitted / Locked`
  - local books are considered review-complete and no longer drifting for the period being consolidated
  - consolidated review should consume this state instead of loose local draft conditions
- `Group Review / Consolidation`
  - member entities are reviewed together
  - mapping, eliminations, adjustments, and consolidated statement review happen here
- `Group Approved / Published`
  - the group reporting package is approved for publication / externalized review / close evidence

This is intentionally aligned with how Oracle / SAP / Dynamics-style finance workflows are usually structured:

- local operational review first
- local entity close second
- group review after local lock
- publication last

### 10. Role and authority handoffs must be explicit

- the workflow should clearly separate:
  - OU accountant / OU finance lead preparation
  - entity or country controller review and approval
  - group controller / consolidation lead late-change authority after entity submission
  - close admin / system admin configuration and emergency governance
- report UX should not blur "preparer", "reviewer", "approver", and "reopen authority" into one generic actor role
- every workflow step should make the current owner, next owner, and authority boundary obvious

### 11. Approval and lock must change behavior

- OU close approval should not be cosmetic status only
- semantic choice for this roadmap:
  - `APPROVED` already blocks ordinary posting and reversal into the OU/period scope
  - `LOCKED` is the final freeze state after approval, evidence completion, and downstream handoff readiness
- once a period/OU scope is approved or locked:
  - ordinary users should no longer be able to post into the closed OU/period silently
  - ordinary users should no longer be able to reverse OU-scoped posted journals in the closed period silently
  - ordinary users should no longer be able to alter close evidence without auditability
- report-driven close support must therefore integrate with posting/reversal controls, not stay as a detached reporting-only surface
- enforcement coverage must be consistent across:
  - manual journal posting
  - source-document post / repost
  - reversal endpoints
  - import / batch jobs
  - recurring / background postings

### 12. Reopen and downstream invalidation rules must be explicit

- late changes must go through one reason-coded reopen or override path
- reopen payloads should capture at least:
  - reason code
  - requested action type
  - explanation
  - scope
  - materiality / expected impact
  - whether entity or group review has already started
- when a financially relevant scope is reopened:
  - prior approval/lock should be invalidated for active reliance
  - entity readiness should be recalculated
  - group review or publication readiness should be flagged where affected
- prefer next-period correction or top-side adjustment for immaterial or late downstream issues instead of casual reopen
- when the period is already group-published:
  - reopening should be exceptional
  - highest-governance approval should be required
  - default treatment should be next-period correction or group top-side adjustment where policy allows

### 13. Entity-close consumption rules must be explicit

- entity close should not be a black box between OU close and consolidation
- entity-close workflow should explicitly consume:
  - required OU packs
  - one required central / no-OU pack for entity scope where `operating_unit_id IS NULL`
  - entity-level top-side adjustments
  - tax / statutory adjustments
  - entity-level evidence and signoff
  - final entity submit / lock action
- consolidation handoff should depend on this full entity-close package, not only on OU status rollups

### 14. OU, CENTRAL/HQ, and entity-only attribution boundaries must be explicit

- the repo already treats missing `operating_unit_id` as central/no-OU scope, not as unknown scope
- existing ownership and close-control seams use implementation values such as `CENTRAL` and `OPERATING_UNIT`
- the close-pack model may still display the business label `CENTRAL/HQ` in UI copy, but implementation enums and validators should align with the repo's existing `CENTRAL` convention unless there is an intentional migration
- close-pack attribution should therefore follow these rules:
  - journals attributable to exactly one OU participate in that OU pack
  - journals whose relevant lines are all `operating_unit_id = null` participate in the central/no-OU pack
  - journals spanning multiple OUs, or mixing central/no-OU and OU lines, belong to entity close only
- mixed-scope journals must not be blocked, certified, or reopened by one OU pack alone

### 15. Entity reopen transitions must be explicit

- if a mandatory OU pack or the mandatory central / no-OU pack reopens after entity approval or entity lock:
  - entity state should transition to `ENTITY_REOPENED`
  - re-review and re-approval should be required before entity lock can be restored
- if entity review has started but entity is not yet approved/locked:
  - readiness should fall back according to remaining mandatory-pack status
  - at minimum the entity must no longer qualify as fully ready / locked

### 16. Top-side adjustment and evidence-only boundaries must be explicit

- top-side adjustment is an exception path, not a convenience shortcut
- top-side adjustment must not silently replace required local correction when local books are still open and materially wrong
- `EVIDENCE_CORRECTION_ONLY` cannot change:
  - balances
  - postings
  - mappings
  - report basis
- if any of those would change, the issue must route to financial reopen / adjustment logic instead

### 17. Prior-period integrity must be a control, not a footnote

- reopening an earlier mandatory period for the same book/entity should block later entity submit / lock and group publish progression until the earlier period is re-approved
- later periods may remain viewable, but they should not continue through formal close / publish gates while a prerequisite period is reopened

### 18. Implementation family naming should be explicit

- for implementation planning, use `local close packs` as the family term covering:
  - OU packs
  - the central/no-OU pack
- keep `OU Close` in the higher-level close ladder as business shorthand for the local review stage
- this avoids implying that the workflow family contains only OU-scoped packs when the final model includes a central/no-OU pack as a first-class pack

### 19. Workflow-engine reuse must be treated as extension, not drop-in reuse

- the repo already has reusable workflow-engine foundations for:
  - `PERIOD_CLOSE`
  - `CONSOLIDATION_RUN`
- local close packs should reuse the approval / assignment / decision / audit mechanics where practical
- but the current workflow schema and validators do not yet model an OU / central local close-pack process type
- implementation should therefore extend the workflow engine cleanly, or wrap it cleanly, instead of assuming that local close packs already fit the current process-type model unchanged

## Ledger Engine Maturity Model

### V1
Goal: make the feature genuinely usable.

- build one standalone ledger-detail page
- route candidate:
  - `/app/defter-i-kebir`
- add drillthrough from `Mizan` summary rows into that page with filters prefilled
- support multiple entry points:
  - direct menu entry
  - drillthrough from `Mizan`
  - drillthrough from journals or account-oriented workflows where available
- minimum filters:
  - legal entity
  - book
  - date range or fiscal period range
  - account
- minimum columns:
  - date
  - journal no
  - document/reference no
  - description
  - debit
  - credit
  - running balance
- minimum actions:
  - open journal
  - open source document when link exists
- opening balance behavior:
  - show opening balance before the selected start date
  - then show in-range movements with running balance

### V2
Goal: make it feel like a proper ERP reporting workspace.

- add `Muavin` mode on the same ledger engine
- route candidates:
  - `/app/defter-i-kebir`
  - `/app/muavin`
- add stronger filters:
  - operating unit
  - subledger reference
  - source module
  - status / include reversed handling
- add account-range support, not only single-account view
- add export support:
  - CSV
  - print-friendly layout
- add better drillthrough:
  - account row from `Mizan` opens detail
  - journal row opens journal detail
  - source link opens invoice/payment/fixed asset where available
- add report presets:
  - GL detail
  - subledger-oriented detail
  - posted-only default

### V3
Goal: add finance control and reconciliation value.

- add reconciliation-oriented views:
  - GL vs CARI control account drilldown
  - GL vs cash register / session drilldown
  - GL vs fixed asset subledger drilldown
- add exception views:
  - missing subledger ref
  - postings to unexpected OU
  - postings to parent/non-posting accounts
  - unusual reversals
- add subtotal/grouping options:
  - by month
  - by source module
  - by OU
  - by subledger ref
- add saved filter variants per report mode
- add role-friendly close support:
  - accountant review
  - audit support
  - period-close supporting evidence

### V4
Goal: make the reporting layer scalable and enterprise-grade.

- add performance hardening for large history volumes:
  - opening balance snapshots
  - incremental balance tables
  - async export jobs for large date ranges
- add multi-book comparison support:
  - management vs statutory
  - local vs tax if applicable later
- add consolidated drill-across concepts where relevant:
  - summary balance
  - local ledger detail
  - source transaction lineage
- add stronger audit trail support:
  - report parameter fingerprint
  - source lineage chain
  - report evidence bundles for close/review packs

## Chronological Delivery Model

The correct rollout order for this repo is:

1. shared reporting contract and permissions
2. local summary reporting
3. shared ledger-detail engine
4. dimensional / subledger detail mode
5. local legal-entity statements
6. local close pack domain model, roles, statuses, and permissions
7. local close pack workspace, evidence pack, and report launch pad
8. local close pack submit / return / approve / lock workflow and post-lock controls
9. local close pack reopen workflow, late-change governance, and entity-readiness invalidation
10. OU/subledger reconciliation and exception views
11. entity submitted/locked -> group review / consolidation drill-across
12. report-backed close / consolidation checks, approvals, and publish gates
13. export, fingerprint, and performance hardening

That order keeps the system accounting-first:

- transaction posting
- local balances
- local statements
- OU close model and evidence pack
- OU approval / lock / reopen governance
- entity lock
- group consolidation
- enforcement / audit / scale

## Execution Tracker

- [ ] `RP01` - Shared reporting contract, permissions, and navigation foundation
- [ ] `RP02` - Real `Mizan Raporu` local summary page
- [ ] `RP03` - Shared ledger-detail engine for `Defter-i Kebir`
- [ ] `RP04` - `Muavin` mode with dimensional and subledger filters
- [ ] `RP05` - Local legal-entity `Bilanco` and `Gelir Tablosu`
- [ ] `RP06` - Local close pack domain model, statuses, role model, and permission contract
- [ ] `RP07` - Local close pack workspace, evidence pack, and report-launch integration
- [ ] `RP08` - Local close pack submit / return / approve / lock workflow and post-lock controls
- [ ] `RP09` - Local close pack reopen workflow, late-change governance, and entity-readiness invalidation
- [ ] `RP10` - OU / subledger reconciliation and exception reporting
- [ ] `RP11` - Entity submitted/locked to consolidated drill-across reporting
- [ ] `RP12` - Close / consolidation checks, approvals, publish states, and report-based blockers
- [ ] `RP13` - Export, report fingerprinting, and performance hardening

---

## `RP01` - Shared reporting contract, permissions, and navigation foundation

### Goal

Create one consistent reporting contract before building pages so summary, detail, close, and consolidation views do not drift into separate filter languages.

### Current repo baseline

- sidebar config already contains labels and route targets for:
  - `/app/mizan-raporu`
  - `/app/defter-i-kebir`
  - `/app/bilanco`
  - `/app/gelir-tablosu`
- existing GL permissions already cover important foundations such as:
  - `gl.trial_balance.read`
  - `gl.journal.read`
  - `gl.period.close`
- consolidation report permissions are already seeded
- `App.jsx` already has a placeholder-route mechanism for routes that are visible in the sidebar but not yet implemented, but that placeholder surfacing is effectively limited to preview-admin flows today

### Current repo gap

- local report route targets exist in sidebar config, but ordinary users do not yet get a real local-report page flow for them
- the current placeholder route experience is not a normal-user reporting surface; it is primarily a preview-admin seam
- `/app/muavin` does not yet exist as a real route, sidebar item, or i18n label in the repo
- no shared local-report contract yet exists for:
  - all scopes
  - one OU
  - central / no-OU scope
- no dedicated local statement permission family exists yet
- no dedicated local ledger-detail permission family exists yet

### Scope

- define one shared report filter vocabulary for local reporting:
  - `legalEntityId`
  - `bookId`
  - `fiscalPeriodId`
  - approved date-range fields where needed
  - `accountId` / account code range
  - `operatingUnitId`
  - explicit central / no-OU scope selector or equivalent null-scope contract
  - `subledgerReferenceNo`
  - source type / source module
  - status / include reversed behavior
- define one shared report filter vocabulary for consolidated reporting, either by reusing the current repo names or by defining one explicit compatibility mapping layer:
  - `consolidationGroupId` and/or canonical `groupId`
  - `subgroupId`
  - `fiscalPeriodId` and/or canonical `consolidationPeriodId`
  - `consolidationRunId` or scenario/version key
  - `presentationCurrencyCode` and/or canonical `reportingCurrencyId`
  - member `legalEntityId` for drill-across narrowing
- define drillthrough contract:
  - summary row -> ledger detail
  - ledger row -> journal detail
  - journal source link -> source document / workflow
  - consolidated summary -> mapped member breakdown -> local support detail
- define route strategy:
  - `/app/mizan-raporu`
  - `/app/defter-i-kebir`
  - `/app/muavin`
  - `/app/bilanco`
  - `/app/gelir-tablosu`
- lock route-ownership timing explicitly:
  - `RP01` may reserve the `/app/muavin` path and parameter contract at the naming/deep-link level
  - `RP01` should not surface `/app/muavin` as a normal-user sidebar item or ordinary-user placeholder page before `RP04`
  - `RP04` owns the actual `Muavin` page behavior and, if it remains a separate route, the visible sidebar/i18n/router surfacing
- decide one report-basis contract for V1:
  - local posted basis only
  - no mixed "draft + posted unless maybe-preview" ambiguity on default local reports
- lock local scope-filter behavior:
  - no OU filter = all local scopes
  - one OU filter = that OU only
  - central / no-OU filter = only lines with `operating_unit_id IS NULL`
- lock V1 basis rules:
  - period-first local reporting
  - canonical running-balance currency basis
  - deterministic opening-balance rules
- define permission/visibility expectations for:
  - local reports
  - consolidated reports
  - export actions
  - journal drillthrough
  - source-document drillthrough
- include baseline performance contract:
  - server-side filtering
  - pagination
  - sorting

### Why first

- every later page depends on stable filter names and drillthrough semantics
- period-close and consolidation integrations should consume existing report links, not invent their own ad-hoc report filters
- permissions and route behavior should not be retrofitted after pages already exist

### Acceptance

- one shared local-report filter contract exists
- one shared consolidated-report filter contract exists
- placeholder routes can be replaced incrementally without route churn
- report pages and close pages can deep-link each other using the same parameter names
- report drillthrough and export visibility rules are explicit before page build starts
- `RP01` does not require a visible `/app/muavin` menu item before `RP04` exists

---

## `RP02` - Real `Mizan Raporu` local summary page

### Goal

Build the first real local report page from posted book/period balances.

### Current repo baseline

- backend already exposes trial balance read at `/api/v1/gl/trial-balance`
- frontend already has `getTrialBalance()` in `frontend/src/api/glAdmin.js`
- the current trial balance contract is already useful for book + fiscal-period posted balances

### Current repo gap

- no actual `Mizan` page component exists yet
- the local `Mizan` route does not yet provide a normal-user page; current placeholder routing is only a preview-admin seam
- the current trial balance endpoint is still book + period oriented and does not yet express:
  - explicit OU filtering
  - explicit central / no-OU filtering
  - close-pack launch context
- no report header close-context integration exists yet
- no direct summary-row -> ledger-detail drillthrough UI exists yet

### Scope

- create the real `/app/mizan-raporu` page
- start with book-period local posted balances
- minimum filters:
  - legal entity
  - book
  - fiscal period
  - include zero
  - include rollup
  - optional OU filter if cheaply supported by existing balance semantics
- minimum columns:
  - account
  - debit total
  - credit total
  - balance
- show period status / close context in the page header
- row click opens or prepares the transition into ledger detail with filters prefilled
- keep V1 period-first to avoid ambiguity between date and period semantics on the first summary layer

### Why second

- `Mizan` is the natural entry point for finance users
- it validates that posted local balances are readable before building deeper ledger movement views

### Acceptance

- `/app/mizan-raporu` is no longer a placeholder
- accountants can read a real local period summary by book
- account rows expose a direct path into ledger detail
- report semantics are clearly period-based and reconcile back to posted balances

---

## `RP03` - Shared ledger-detail engine for `Defter-i Kebir`

### Goal

Build one reusable ledger-detail engine that all detail-first report surfaces can share.

### Current repo baseline

- backend already exposes posted journal list/detail read APIs
- frontend already has journal read helpers and a journal-detail workflow surface
- source-link enrichment and reverse-block destination logic already exist for journal drillback

### Current repo gap

- no dedicated ledger-detail read endpoint exists yet for report-grade account movement review
- the current journal read APIs are not optimized for:
  - opening balance + running balance
  - account/date-range or fiscal-period-range movement detail
  - report-grade pagination, sorting, and filtering around one ledger-detail contract
- no actual `Defter-i Kebir` page exists yet
- no clean `Mizan` -> `Defter-i Kebir` drillthrough target exists yet

### Scope

- create one standalone ledger-detail page at `/app/defter-i-kebir`
- support multiple entry points:
  - direct menu entry
  - row drillthrough from `Mizan`
  - drillthrough from journals or account-oriented workflows where practical
- minimum filters:
  - legal entity
  - book
  - fiscal period range or date range
  - account
- minimum columns:
  - posting date
  - journal no
  - reference no
  - description
  - debit
  - credit
  - running balance
- opening-balance contract:
  - show opening balance before the selected range
  - then in-range movement rows with running balance
- actions:
  - open journal
  - open source document when source link exists
- baseline large-volume behavior:
  - server-side pagination
  - server-side sorting
  - server-side filters

### Why before `Muavin`

- `Muavin` should reuse this engine
- the repo should not build two separate movement-detail pages
- this is the first place where the one-engine / many-entry-points principle becomes real

### Acceptance

- one shared local ledger page exists
- row drillthrough from `Mizan` opens this page with prefilled filters
- direct navigation from menu and other accounting surfaces is possible
- opening balance and running balance are deterministic and reviewable

---

## `RP04` - `Muavin` mode with dimensional and subledger filters

### Goal

Extend the same ledger engine into a more detailed accountant / audit workspace.

### Scope

- add `/app/muavin` as:
  - a separate route using the same engine, or
  - a preset mode over the same page
- if `RP01` previously reserved `/app/muavin` at the contract/path level, `RP04` is still the step that makes it a real user-facing report surface
- if `/app/muavin` remains a separate route, add its router, sidebar, and i18n surfacing explicitly because the repo does not already have that seam
- add stronger filters:
  - operating unit
  - subledger reference
  - source module / source type
  - journal status
  - include reversed behavior
  - account range
- add subtotal/grouping options where practical:
  - by month
  - by source type
  - by OU
  - by subledger ref
- add report presets:
  - GL detail
  - subledger-oriented detail
  - posted-only default
- add better drillthrough consistency:
  - account row from `Mizan` opens detail
  - journal row opens journal detail
  - source link opens invoice/payment/fixed asset where available
- add first-pass exports:
  - CSV
  - print-friendly layout

### Why here

- units and subledgers should first appear as report filters and detail lenses
- this is the correct place to expose OU-specific views before building larger control packs
- export and print start to matter once the detail engine becomes day-to-day usable

### Acceptance

- `Muavin` is a real working detail mode, not just a label
- OU and subledger-driven analysis is possible without inventing a new engine
- accountants can move from summary to subledger-aware movement review in one flow
- basic CSV / print output reflects on-screen detail semantics correctly

---

## `RP05` - Local legal-entity `Bilanco` and `Gelir Tablosu`

### Goal

Add proper local legal-entity statement surfaces after summary and detail layers are stable.

### Scope

- implement real local `/app/bilanco`
- implement real local `/app/gelir-tablosu`
- reporting basis:
  - legal entity
  - book
  - the first shipped RP05 stays `fiscalPeriodId`-based / period-first
  - broader approved date-range behavior is only a later extension if explicitly added
  - posted local truth
- keep the first version accounting-first:
  - no BI layer
  - no management-pack redesign
- explicitly lock statement semantics before build:
  - row mapping source
  - sign conventions
  - retained earnings / current-year result presentation
  - header/non-posting presentation behavior
- first-pass statutory/local statement semantics are locked as:
  - `Bilanco` is point-in-time at the selected period end
  - `Gelir Tablosu` is fiscal-year-to-date through the selected period end by default
  - retained earnings stay on posted equity balances
  - current-year result is shown as a separate computed row before posted year-end close and is then absorbed by posted close behavior later
  - local statement truth stays anchored to legal entity + book + period + local currency
  - statement mappings must be explicit and local to the statutory statement layer rather than borrowed blindly from consolidated reporting
  - the first pass may use one explicit local mapping source such as code-band/account-type rules, with later evolution to a versioned statement-definition layer if multiple statutory layouts or effective-dated mapping changes become necessary
- statement rows should drill toward:
  - account summary
  - then ledger detail

### Why after `Mizan` and ledger

- statement presentation is only trustworthy once underlying account summary and movement detail are already reviewable
- this keeps financial statements explainable row-by-row

### Acceptance

- local legal-entity statement pages are real, not placeholders
- statement totals reconcile back to local account summaries and ledger movement
- users can drill from statement row to supporting detail
- statement sign and retained-earnings behavior are explicit and stable

---

## `RP06` - Local close pack domain model, statuses, role model, and permission contract

### Goal

Define the local close-pack workflow contract before building the close workspace so preparation, review, approval, lock, and reopen behavior are explicit and consistent.

### Scope

- define close-pack run scope:
  - `legalEntityId`
  - `bookId`
  - `fiscalPeriodId`
  - `closeScopeType = OPERATING_UNIT | CENTRAL`
  - `operatingUnitId` when `closeScopeType = OPERATING_UNIT`
- define the pack family:
  - one pack per operating unit
  - one central / no-OU pack for entity scope where `operating_unit_id IS NULL`
  - the UI/business label may still be `CENTRAL/HQ`, but implementation enums should align with the repo's current `CENTRAL` convention unless there is an intentional migration
- define explicit close-pack statuses:
  - `NOT_OPENED`
  - `OPEN`
  - `IN_PROGRESS`
  - `READY_FOR_REVIEW`
  - `RETURNED`
  - `APPROVED`
  - `LOCKED`
  - `REOPENED`
  - optional later `SUPERSEDED`
- lock the core status semantics:
  - `APPROVED` already blocks ordinary posting and reversal into the OU/period scope
  - `LOCKED` is the final freeze state used after approval when the pack is considered fully frozen for downstream reliance
- lock the role model:
  - OU accountant / OU finance lead prepares
  - entity / country controller reviews and approves
  - group controller / consolidation lead governs escalated late changes
  - close admin / system admin defines templates, reasons, and emergency controls
- define minimum permission families:
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
- define what OU close does and does not mean:
  - it is an internal certification layer
  - it supports entity-close readiness
  - it does not create a separate statutory ledger close engine
- define attribution policy for journal participation:
  - exactly one OU-owned journal scope -> that OU pack
  - all-central / no-OU journal scope -> the central pack
  - multi-OU or mixed central + OU journal scope -> entity close only
- define entity-readiness rollup target states for later integration:
  - `NOT_READY`
  - `PARTIALLY_READY`
  - `READY_FOR_ENTITY_REVIEW`
  - `ENTITY_IN_REVIEW`
  - `ENTITY_APPROVED`
  - `ENTITY_LOCKED`
  - `ENTITY_REOPENED`

### Why before workspace build

- workflow screens should not invent statuses and roles ad hoc
- posting/reversal restrictions later depend on a stable status model and authority matrix
- entity-close and group-close dependencies should be driven by one explicit close contract

### Acceptance

- one explicit OU-close state model exists for the roadmap
- one explicit local close-pack state model exists for the roadmap
- the roadmap names both OU packs and the central / no-OU pack explicitly
- mixed-scope journals are routed to entity close instead of being forced into one OU pack
- authority boundaries between OU, entity, and group roles are named up front
- permission families and downstream readiness states are defined before UI/action work begins
- OU close is documented as certification support, not as a second ledger-close engine

---

## `RP07` - Local close pack workspace, evidence pack, and report-launch integration

### Goal

Turn the local reporting layer into a usable local close pack so finance teams can review, evidence, and submit one OU or central / no-OU scope without reconstructing filters manually.

### Scope

- add a Local Close Workspace shell showing:
  - OU status
  - owner / reviewer
  - completion percentage
  - blocker count
  - warning count
  - last activity
  - submitted / approved / locked timestamps
  - reopen-request indicator
- add a Local Close Pack detail shell with tabs such as:
  - Overview
  - Checklist
  - Reports
  - Exceptions
  - Evidence
  - Comments
  - Audit Trail
- wire report-launch links from the close pack into:
  - local `Mizan`
  - local `Defter-i Kebir`
  - local `Muavin`
  - local `Bilanco`
  - local `Gelir Tablosu`
  - later watched-account / reconciliation views
- lock OU-statement compatibility behavior:
  - OU close may launch OU-filtered `Bilanco` and `Gelir Tablosu` only if statement semantics remain derivable from the local legal-entity statement engine
  - otherwise the close pack should launch entity-level statements plus OU-filtered summary/detail reports instead of implying a separate OU statement engine
- ensure close launches prefill:
  - `legalEntityId`
  - `bookId`
  - `fiscalPeriodId`
  - `operatingUnitId` for OU packs
  - explicit central / no-OU scope for the central pack, with `CENTRAL/HQ` only as UI/business copy if desired
- define evidence-pack behavior:
  - report review support
  - evidence / commentary attachment support
  - audit-trail support
  - stable minimum evidence fingerprint even before final export hardening
- show close context in report headers:
  - period
  - book
  - current close status
  - workflow gate context where relevant

### Why here

- close teams must be able to consume the reports inside one workflow before workflow actions are hardened
- submission and approval logic are only practical once the pack surface, evidence model, and report launch flow exist
- this is where reporting becomes a real close-support tool instead of a menu of disconnected pages

### Acceptance

- the close workspace can launch supporting reports directly with OU scope prefilled
- one local close pack can collect evidence, comments, and audit events around the same report family
- finance users do not have to rebuild filters by hand to prepare a review pack
- reviewed report instances carry a stable minimum evidence fingerprint

---

## `RP08` - Local close pack submit / return / approve / lock workflow and post-lock controls

### Goal

Make the local close-pack layer behaviorally real by adding explicit submission, review, approval, and lock transitions with clear gates and post-lock restrictions.

### Scope

- add first-class workflow actions:
  - submit for review
  - return for correction
  - approve
  - lock
- define submission gates:
  - all required checklist items complete
  - no required evidence missing
  - no blocking issue unresolved
  - no OU-scoped draft or unposted adjustments in scope
  - no missing mandatory commentary fields
  - no failed mandatory validation rules
- define approval gates:
  - reviewer has authority for the OU/entity
  - hard gates still pass at approval time
  - no newer blocked exceptions were raised after submission
  - required review comments exist
- define lock gates:
  - status already `APPROVED`
  - no pending reopen request exists
  - no downstream state conflict exists
  - no unresolved earlier-period reopen conflict for the same mandatory close chain
- lock semantic behavior explicitly:
  - `APPROVED` is the state where ordinary posting/reversal block begins
  - `LOCKED` is the final freeze layer, not the first point of control
- define post-approval / post-lock ordinary-user restrictions:
  - no new OU-scoped postings into the closed period
  - no edits to source documents that would repost into the closed period
  - no ordinary reversals of OU-scoped posted journals in the closed period
  - no silent evidence alteration
- define enforcement coverage for those restrictions:
  - manual journal posting
  - source-document post / repost
  - reversal endpoints
  - import / batch jobs
  - recurring / background postings
- define what remains allowed after `APPROVED` / `LOCKED`:
  - read reports
  - view evidence and audit history
  - request reopen with explanation
  - attach supplemental non-financial commentary if policy later allows it
- define controlled exception paths:
  - reopen the OU scope
  - privileged adjustment / post-lock override path
  - next-period correction
  - entity or group top-side adjustment where reopening is no longer appropriate
- define top-side boundary:
  - top-side adjustment is an exception path
  - it must not replace required local correction while local books remain open and materially wrong

### Why before reconciliation and consolidation

- approval should change behavior before more advanced exception and consolidation layers are added
- close status must be meaningful to operators before group reviewers depend on entity-submitted / locked states
- this keeps the roadmap aligned with real finance process order:
  - prepare
  - submit
  - review
  - approve
  - lock

### Acceptance

- local close-pack workflow supports submit, return, approve, and lock actions explicitly
- workflow gates are explainable from checklist/evidence/issues state
- post-lock behavior is governed, not cosmetic
- ordinary posting and reversal into an approved/locked OU period now has a documented blocked path

---

## `RP09` - Local close pack reopen workflow, late-change governance, and entity-readiness invalidation

### Goal

Govern late changes after local close-pack approval or lock so corrections, reversals, and late postings cannot bypass the close workflow silently.

### Scope

- define reopen entry points:
  - blocked reversal attempt
  - blocked late posting attempt
  - controller review page
  - entity-readiness dashboard
  - consolidation issue screen where a local pack must be corrected
- define reopen request payload:
  - `reasonCode`
  - requested action type
  - explanation
  - requested scope
  - impacted period / book / OU / entity
  - materiality indicator or estimated impact
  - whether downstream entity/group steps have already started
- define typical requested action types:
  - `REVERSAL_REQUIRED`
  - `LATE_POSTING_REQUIRED`
  - `RECLASS_REQUIRED`
  - `EVIDENCE_CORRECTION_ONLY`
  - `AUDIT_ADJUSTMENT`
  - `CONSOLIDATION_FEEDBACK`
- define reopen authority matrix:
  - entity controller may reopen while entity is not yet submitted
  - entity controller plus close admin, or group controller per policy, after entity submission but before group start
  - group controller / consolidation lead once consolidation has started
  - highest-governance path only after group package is finalized or published
- define reopen effects:
  - OU status becomes `REOPENED`
  - prior approval/lock is invalidated for active reliance while preserved in audit history
  - entity readiness is recalculated if the OU is mandatory
  - downstream entity/group dashboards are flagged immediately
  - re-review and re-approval are required after financially relevant change
- define entity state transition explicitly:
  - if entity is `ENTITY_APPROVED` or `ENTITY_LOCKED` and a mandatory OU pack or the mandatory central / no-OU pack reopens, entity becomes `ENTITY_REOPENED`
  - if entity is earlier in the workflow, it falls back to the applicable review/readiness state instead of remaining silently locked
- define late-change policy:
  - prefer next-period correction for immaterial issues
  - prefer top-side adjustment where reopening would create disproportionate downstream churn
  - allow commentary-only handling only when balances are unaffected
- define default decision policy explicitly:

| Situation | Default treatment |
| --- | --- |
| immaterial issue and downstream entity/group work already started | next-period correction |
| entity-only local financial issue before entity submission | reopen local OU/entity scope |
| group-stage issue with no appetite to reopen local packs | group top-side adjustment where policy allows |
| balance-neutral evidence or commentary problem | evidence correction only |
- define evidence-only boundary explicitly:
  - `EVIDENCE_CORRECTION_ONLY` cannot change balances, postings, mappings, or report basis
  - otherwise the issue must route to financial reopen / adjustment logic
- define entity-readiness rollup rule:
  - entity cannot move to `READY_FOR_ENTITY_REVIEW` unless required OU packs and the required central / no-OU pack are `APPROVED` or `LOCKED`
  - mandatory OU packs or the mandatory central / no-OU pack in `REOPENED` or `RETURNED` invalidate readiness
- define already-published policy explicitly:
  - once a period is already group-published, reopening should be exceptional
  - highest-governance approval is required
  - default treatment should be next-period correction or group top-side adjustment where policy allows

### Important rule

- reopen is the exception path, not a normal operator shortcut
- every late change should be reason-coded, reviewable, and auditable
- readiness invalidation must happen immediately when reliance on a pack changes

### Acceptance

- late changes have one explicit governed path
- entity readiness reflects OU reopen / return status instead of drifting manually
- reopen authority is differentiated across OU, entity, and group stages
- reversal and late-posting decisions are explainable with clear reason codes and audit trail

---

## `RP10` - OU / subledger reconciliation and exception reporting

### Goal

Add control and diagnostic views once the base close workflow and late-change governance are defined.

### Scope

- add reconciliation-oriented views:
  - GL vs CARI control account drilldown
  - GL vs cash register / session drilldown
  - GL vs fixed asset subledger drilldown
- add exception lenses such as:
  - missing subledger reference
  - postings to unexpected OU
  - postings to parent / non-posting accounts
  - unusual reversals
  - large balance swings in watched accounts
- add subtotal/grouping options where practical:
  - by month
  - by source module
  - by OU
  - by subledger ref
- add saved filter variants per report mode
- keep OU reporting in this track as:
  - filter axis
  - grouping axis
  - reconciliation axis
  - not a separate accounting owner engine

### Why after workflow basics

- exception views are most useful once accountants already trust the base reports and the close-state model around them
- this phase converts reports from "workflow support" into "control surfaces"

### Acceptance

- accountants can isolate OU and subledger problems from the same report family
- exception rows can drill to journal and source detail
- saved variants make recurring review work practical
- close review gains real reconciliation value

---

## `RP11` - Entity submitted/locked to consolidated drill-across reporting

### Goal

Extend the reporting model from entity-submitted/locked local books into group-level review and consolidation.

### Scope

- keep existing consolidated balance sheet / income statement surfaces as the group summary layer
- use explicit consolidated filter semantics:
  - `consolidationGroupId` and/or canonical `groupId`
  - `subgroupId` where relevant
  - `fiscalPeriodId` and/or canonical `consolidationPeriodId`
  - `consolidationRunId` or scenario/version key
  - `presentationCurrencyCode` and/or canonical `reportingCurrencyId`
- define the state handoff into group review explicitly:
  - OU review complete
  - entity close approved
  - entity submitted / locked
  - then consolidated review starts
- add drill-across from consolidated summary into:
  - mapped member-entity breakdown first where needed
  - local member entity summary
  - local member `Mizan`
  - local ledger detail where meaningful
  - source transaction lineage where meaningful and permitted
- keep canonical-mapping awareness explicit in consolidated drill-across
- do not pretend consolidated rows can always drill to one simple local account without mapping context

### Why after local close maturity

- consolidation is downstream of local books and local close
- group summary should drill into trustworthy member-level detail, not placeholder pages
- this follows the intended finance flow:
  - local review
  - local lock
  - group review
  - not all at once

### Acceptance

- consolidated summary can open meaningful member-detail support
- group reviewers can move from group total to local evidence without leaving the reporting workflow
- navigation follows a clear ladder instead of hidden many-to-many jumps
- local and consolidated report semantics remain aligned
- consolidated review assumes member entities have reached a submitted/locked review state for the target period

---

## `RP12` - Close / consolidation checks, approvals, publish states, and report-based blockers

### Goal

Only after reports and workflow states are operationally trusted, use them in higher-level control gates from entity review through group publication.

### Scope

- period-close warnings / blockers based on report-backed conditions where appropriate
- define explicit higher-level approval/status progression:
  - `Entity Close Approval`
  - `Entity Submitted / Locked`
  - `Group Review / Consolidation`
  - `Group Approved / Published`
- define entity-close package content explicitly:
  - required OU packs
  - required central / no-OU pack
  - entity-level top-side adjustments
  - tax / statutory adjustments
  - entity-level evidence and signoff
  - final entity submit / lock action
- make each transition explainable from supporting reports, evidence packs, and workflow state
- consolidation review warnings / blockers based on:
  - unresolved mapping issues
  - draft eliminations / adjustments
  - workflow gate state
  - report equation or material-balance mismatches
  - reopened mandatory local packs
- publication/publish-state blockers based on:
  - missing local submitted/locked member state
  - unresolved group review exceptions
  - unapproved group review / workflow gate state
- define which checks are:
  - warning-only
  - blocking
- expose machine-readable reason codes and clear operator drill paths into the supporting report

### Important rule

- reports should explain blockers
- reports should not become a second hidden accounting engine
- the blocking logic must always reconcile back to posted accounting truth and existing workflow-gate semantics

### Acceptance

- close and consolidation blockers are explainable with direct report drillthrough
- approval/status progression from entity review to group publication is explicit and coherent
- warnings and blocks do not rely on opaque background math
- finance users can move from blocker -> report -> journal -> source in one chain

---

## `RP13` - Export, report fingerprinting, and performance hardening

### Goal

Make the reporting layer durable for larger volumes and close/audit evidence.

### Scope

- harden export support:
  - CSV
  - print-friendly output where useful
  - async export for large ranges where justified
- harden audit support:
  - report parameter fingerprint
  - source lineage chain
  - evidence bundle support for close / review packs
- harden performance for large history:
  - opening-balance snapshots when needed
  - incremental balance tables when justified
- add multi-book comparison only after the single-book path is stable:
  - management vs statutory
  - local vs tax if applicable later
- do not change report semantics during hardening; improve scale and durability on the same trusted contract

### Why last

- do not optimize or operationalize before the report model is correct
- performance and export should harden a trusted product shape, not a moving target

### Acceptance

- exports reflect on-screen report logic accurately
- close and audit users can preserve report evidence with stable fingerprints and lineage support
- large-range reporting has a clear hardening path without changing semantics
- multi-book comparison remains an additive layer, not a rewrite of the local reporting engine

## Recommended Delivery Order

Use this order:

1. `RP01` shared contract / permissions / navigation
2. `RP02` local `Mizan`
3. `RP03` shared `Defter-i Kebir` engine
4. `RP04` `Muavin` mode
5. `RP05` local `Bilanco` and `Gelir Tablosu`
6. `RP06` local close pack domain / statuses / role and permission model
7. `RP07` local close pack workspace / evidence pack / report launch pad
8. `RP08` local close pack submit / return / approve / lock actions and post-lock controls
9. `RP09` local close pack reopen workflow / late-change governance / readiness invalidation
10. `RP10` OU / subledger reconciliation and exception reporting
11. `RP11` entity submitted/locked -> consolidated drill-across
12. `RP12` checks / warnings / blockers / publish states
13. `RP13` export / fingerprints / performance

## Why This Order

- It starts from posted local truth, not from presentation-only report names.
- It keeps `Mizan`, `Defter-i Kebir`, and `Muavin` on one family of data contracts.
- It turns the ledger-detail page into a real shared engine with many entry points.
- It lets units / OUs appear first as filters and reconciliation axes, which fits the repo's ownership model.
- It splits OU close into domain, workspace, workflow, and reopen phases so approval and lock logic are not buried inside one vague milestone.
- It places OU review and entity close before full consolidation review, which matches accounting chronology.
- It adds a minimum evidence identity before hard blockers and before final hardening.
- It places enforcement after usability, which reduces false blockers.

## Non-Goals For Early Phases

- no BI/data-warehouse layer in `RP01-RP05`
- no heavy management reporting redesign in the first pass
- no separate engine per report name
- no consolidation-first reporting before local detail is stable
- no OU-only standalone statement engine before local legal-entity reports are working
- no mixed-currency running-balance engine in the first pass

## Open Questions For Later

- Should `Muavin` remain a separate route or become a preset over the same detail page?
- Should local ledger detail support both fiscal-period and date-range filters in V1, or treat one as primary and the other as a controlled extension?
- When transaction/reference currency is surfaced later, which extra columns are most useful without weakening the canonical running-balance basis?
- How much reversed / cancelled history should be visible by default in accountant-facing detail mode?
- Which report-backed conditions should be warnings first versus hard blockers later?
- Which consolidated drill-across cases should stop at member summary versus allowing direct lineage down to local ledger detail?
