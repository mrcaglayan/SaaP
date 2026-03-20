# 38 - FIXED ASSETS, ACCOUNTING-FIRST SUBLEDGER FOUNDATION, AND CARI/AP-DEPRECIATION MVP

## Status
- Planned
- Rebased on repo reality and locked MVP decisions

## Purpose
- Introduce fixed assets (`demirbas`) as an accounting-first subledger, not as an inventory extension.
- Fit fixed assets into the repo's existing tenant, legal-entity, operating-unit, journal-link, evidence, and CARI foundations.
- Deliver a practical MVP that covers:
  - asset register
  - manual acquisition and activation
  - CARI AP-linked capitalization
  - depreciation schedule and runs
  - physical move
  - ownership transfer
  - disposal / write-off / sale
  - reports
  - evidence and audit traceability

## Execution Tracking
- This file now has two layers:
  - feature-scope sections `FA01` to `FA14`, which define business and technical requirements
  - serialized execution sections `STEP-FA01` to `STEP-FA48`, which define review-sized implementation steps
- When using Codex for implementation, prompt against one `STEP-FA##` step at a time.
- A Codex prompt should name:
  - the single `STEP-FA##` patch target
  - the files or surfaces that are in scope
  - the step-level definition of done
  - any explicit non-goals for that patch
- Do not ask Codex to span multiple `STEP-FA##` steps in one patch unless the later step is directly blocked by the earlier one and the combined change is still review-sized.
- Update the master tracker checkbox only when the step-level definition of done is actually satisfied.
- Treat the feature-scope sections below as the source of truth for requirements; treat the serialized `STEP-FA##` sections as the source of truth for implementation order.

## Repo Reality Check

### Hard repo gaps right now
These are current implementation gaps in the repo, not abstract planning notes.

#### Backend fixed-assets module does not exist yet
There is currently no fixed-assets backend module in the repo.

Missing today:
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js`
- `backend/src/services/fixed-assets.reporting.service.js`
- `backend/src/migrations/m138_*`
- `backend/src/migrations/m139_*`
- `backend/src/migrations/m140_*`

Also:
- `backend/src/index.js` does not currently mount `/api/v1/fixed-assets`

This is the primary implementation gap for the track.

#### Frontend fixed-assets is scaffolded but unimplemented
The frontend fixed-assets surface is not greenfield, but it is still largely shell-level today.

Current reality:
- `frontend/src/App.jsx` already contains fixed-assets routes
- `frontend/src/layouts/sidebarConfig.js` already contains fixed-assets sidebar entries
- `frontend/src/layouts/AppLayout.jsx` already contains shared demirbas/asset/amortisman app-chrome icon heuristics
- `frontend/src/i18n/messages.js` already contains fixed-assets labels
- `frontend/src/pages/fixedAssets/*` already contains dedicated fixed-assets page files
- `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx` is part of the current scaffold dependency layer used by multiple fixed-assets page scaffolds
- `frontend/src/api/fixedAssets.js` already exists as a partial API helper
- those frontend pages are still scaffolds/placeholders for much of the real behavior; they are not yet complete feature pages

Planning implication:
- describe backend fixed-assets as greenfield
- describe frontend fixed-assets as scaffolded but unimplemented
- do not describe frontend fixed-assets pages, routes, labels, or API wiring as missing from zero
- do not omit `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx` from frontend repo-surface planning just because it is a shared wrapper rather than a primary route page
- treat `frontend/src/layouts/AppLayout.jsx` as a verify/update surface only if shared demirbas navigation chrome or icon heuristics need cleanup; do not treat it as a primary fixed-assets page

### Backend architecture in this repo
This repo does not use a separate entity/model layer for domain implementation.

Fixed-assets backend work must follow the repo-native shape:
- migrations in `backend/src/migrations/*.js`
- validators in `backend/src/routes/*.validators.js`
- SQL-heavy services in `backend/src/services/*.service.js`
- express routers in `backend/src/routes/*.routes.js`

Do not describe the implementation as "model/entity definitions".

### Backend mount style
The backend is repo-native ESM.

When fixed-assets routes are added, they must be mounted in `backend/src/index.js` using ESM import style:

```js
import fixedAssetsRoutes from "./routes/fixed-assets.routes.js";

app.use("/api/v1/fixed-assets", requireAuth, fixedAssetsRoutes);
```

### Current fiscal-period adjustment-filtering shape
There is no existing shared backend helper that means "resolve eligible non-adjustment fiscal period for posting."

Current reality:
- `backend/src/tenantGuards.js` provides `assertFiscalPeriodBelongsToCalendar(...)`, but that helper validates calendar membership only and does not reject `fiscal_periods.is_adjustment = TRUE`
- current posting services such as:
  - `backend/src/services/cari.document.service.js`
  - `backend/src/services/payroll.accruals.service.js`
  - `backend/src/services/cash.service.js`
  - `backend/src/services/inventory.service.js`
  resolve posting periods with module-local SQL of the form:

```sql
SELECT ...
FROM fiscal_periods
WHERE calendar_id = ?
  AND ? BETWEEN start_date AND end_date
ORDER BY is_adjustment ASC, id ASC
LIMIT 1
```

Planning implication:
- do not describe fixed-assets as reusing an existing shared "eligible non-adjustment fiscal period" helper; that helper does not exist today
- fixed-assets posting/schedule/run services must explicitly implement the non-adjustment-period rule using the repo-native module-local period-resolution pattern, or extract a new small helper inside the fixed-assets implementation and reuse it there
- `assertFiscalPeriodBelongsToCalendar(...)` alone is not sufficient for fixed-assets posting/schedule/run flows because it does not enforce adjustment-period rejection

### Current numbering-helper shape
There is no existing shared generic backend helper that fixed-assets can directly reuse as-is for asset number generation or journal number generation.

Current reality:
- repo numbering patterns are implemented module-locally in the owning service/workflow rather than through one shared generic numbering helper
- the repo does not currently expose one generic helper that already covers both fixed-assets asset numbering and fixed-assets journal numbering without new implementation work
- existing modules do establish repo-native numbering patterns, but those patterns are local conventions, not one reusable helper contract

Planning implication:
- do not describe fixed-assets as reusing an existing shared generic numbering helper unless this track adds that helper first
- fixed-assets should follow the existing repo-native module-local numbering pattern for both asset numbers and journal numbers
- if fixed-assets needs reuse across multiple fixed-assets services, extract a small helper inside fixed-assets and reuse it there

### Current transaction-helper and pool shape
The repo-native `withTransaction(...)` helper is connection-pool backed and keeps the whole transaction on one pooled MySQL connection until commit or rollback.

Current reality:
- `backend/src/db.js` uses `mysql2/promise` pool configuration with:
  - `waitForConnections: true`
  - `connectionLimit: 10`
  - `queueLimit: 0`
- `backend/src/db.js` does not set a client-side query timeout, acquire timeout, or packet-size override on the pool
- current local/dev MySQL variables verified against the configured repo database are:
  - `max_allowed_packet = 67108864` (64 MB)
  - `net_read_timeout = 30`
  - `net_write_timeout = 60`
  - `wait_timeout = 28800`
  - `interactive_timeout = 28800`
  - `innodb_lock_wait_timeout = 50`

Planning implication:
- keep the locked one-`withTransaction(...)` boundary for fixed-assets multi-row workflows
- for FA08 depreciation run creation, do not assume one unbounded multi-row `INSERT ... VALUES (...)` payload for every run line and allocation row will remain safe across environments
- large fixed-assets run persistence should use chunked insert statements or equivalent batched writes inside the same transaction/connection so packet size stays comfortably below deployment `max_allowed_packet`
- do not assume the locally verified MySQL packet/timeout values are universal across environments; deployment validation is required before treating large depreciation-run payloads as safe

### Migration numbering
Current repo migrations end at `m137_*`.

Locked decision:
- fixed-assets migration family starts at `m138_*`

Planned files:
- `m138_fixed_assets_foundation.js`
- `m139_fixed_asset_custodian_employees.js`
- `m140_fixed_asset_cari_capitalization_and_traceability.js`

Important:
- `backend/src/migrations/index.js` must be updated when those real migration files are created
- do not register fake or placeholder migrations just to reserve numbers

Custodian-FK sequencing note:
- `m138_fixed_assets_foundation.js` creates `fixed_assets.custodian_employee_id` plus `fixed_asset_physical_move_details.from_custodian_employee_id` and `fixed_asset_physical_move_details.to_custodian_employee_id` as nullable columns only
- `m139_fixed_asset_custodian_employees.js` creates `fixed_asset_custodian_employees` and then adds the related custodian foreign-key constraints via `ALTER TABLE`
- do not attempt to create those custodian foreign keys in `m138_*` before the referenced table exists

Intra-`m138` dependency-order note:
- the FA01 required-table list is scope, not DDL creation order
- `m138_fixed_assets_foundation.js` must use staged DDL: create the base tables first, then add intra-`m138` foreign keys via `ALTER TABLE` in dependency-safe order
- minimum dependency-safe base-table creation order inside `m138_*` is:
  - `fixed_asset_depreciation_profiles`
  - `fixed_asset_categories`
  - `fixed_assets`
  - `fixed_asset_depreciation_runs`
  - `fixed_asset_transactions`
  - `fixed_asset_depreciation_schedule_lines`
  - `fixed_asset_depreciation_run_lines`
  - `fixed_asset_depreciation_run_line_allocations`
  - `fixed_asset_physical_move_details`
  - `fixed_asset_ownership_transfer_details`
- forward or circular intra-`m138` references must be added only after both tables exist, including at minimum:
  - `fixed_asset_categories.default_depreciation_profile_id`
  - `fixed_asset_depreciation_schedule_lines.posted_run_line_id`
  - `fixed_asset_depreciation_run_lines.schedule_line_id`
- do not implement `m138_*` as naive inline-FK table creation in the flat document order

### OpenAPI is an explicit deliverable
Fixed-assets is not complete without OpenAPI work.

Required updates:
- add fixed-assets route/schema definitions to `backend/scripts/generate-openapi.js`
- add a `FixedAssets` tag description to the generator tag map
- add `/api/v1/fixed-assets` path inference to the generator so discovered routes do not fall through to `System`
- regenerate `backend/openapi.yaml`
- keep `backend/package.json` scripts usable:
  - `openapi:generate`
  - `check:openapi`

Important generator gap today:
- `backend/scripts/generate-openapi.js` has no fixed-assets tag support
- `backend/scripts/generate-openapi.js` has no `/api/v1/fixed-assets` inference branch
- without these changes, auto-discovered fixed-assets routes would be tagged as `System`

### Current evidence service gap
`backend/src/services/evidence.service.js` currently supports only:
- `CARI_DOCUMENT`
- `INVENTORY_TRANSFER`

Fixed-assets MVP requires explicit evidence-service support for:
- `FIXED_ASSET`
- `FIXED_ASSET_TRANSACTION`
- `FIXED_ASSET_DEPRECIATION_RUN`

Required backend work here includes:
- add the fixed-assets source type constants
- add scope/load/list/create/upload/download/delete helpers for fixed-assets evidence surfaces
- add a dedicated `backend/src/routes/fixed-assets.evidence.routes.js` file for the fixed-assets evidence surface
- expose routes for asset-level, transaction-level, and depreciation-run-level evidence
- follow the richer CARI evidence route pattern as the canonical fixed-assets route shape, not the leaner inventory-transfer pattern
- mount fixed-assets evidence as nested sub-routes inside `backend/src/routes/fixed-assets.routes.js`, not as a separate top-level `app.use(...)` mount in `backend/src/index.js`
- lock the nested mount paths to:
  - `router.use("/:assetId/evidence", fixedAssetsEvidenceRoutes);`
  - `router.use("/transactions/:transactionId/evidence", fixedAssetsEvidenceRoutes);`
  - `router.use("/runs/:runId/evidence", fixedAssetsEvidenceRoutes);`
- implement `backend/src/routes/fixed-assets.evidence.routes.js` with `express.Router({ mergeParams: true })` so one repo-native router can serve asset, transaction, and run evidence surfaces from route params

This is required backend scope, not an optional follow-up.

### Current GL reverse-block helper shape
`backend/src/routes/gl.write.journal.routes.js` currently uses:
- `JOURNAL_REVERSE_SOURCE_DESTINATIONS`
- `JOURNAL_REVERSE_BLOCK_SOURCE_TYPES`
- `buildSubledgerReverseBlockedMessage(...)`

Today that helper builds a plain string reverse-block message from a static source-type route map.

Dynamic fixed-assets reverse-blocking requires:
- moving from static source-type route hints to a resolver-based destination helper
- returning structured destination metadata in the error `details`
- allowing fixed-assets source rows to determine the best destination workflow

Repo note:
- the existing error envelope already supports structured `details`
- this is a deliberate repo-contract upgrade, not just one more source type added to the current static map
- this change spans backend reverse-route behavior, backend journal-detail payloads, and frontend Journal Workbench consumption, so it must be treated as a shared contract migration rather than a fixed-assets-only route tweak

Implementation note:
- the current app-level error envelope can already serialize structured `details`
- lock the repo-safe upgrade path now: extend the shared `backend/src/routes/_utils.js` helper to `badRequest(message, details = null)`
- that helper upgrade must be backward-compatible: existing call sites remain valid, and the helper sets `err.details = details` only when `details` is provided
- preserve the existing reverse-block message style during rollout and add structured metadata additively in `details.reverseBlock` rather than replacing the message contract in one step
- fixed-assets reverse-blocking should use that shared `badRequest(message, details)` path rather than introducing a one-off custom error object only for the fixed-assets reverse-block flow
- do not leave structured reverse-block metadata blocked behind a message-only helper assumption

### Current GL read route gap
`backend/src/routes/gl.read.journal.routes.js` currently:
- `GET /journals/:journalId` loads journal header, lines, `source_links`, and settlement drilldown data
- does not currently compute or return `source_links[].destination` or `reverseBlock` metadata
- `GET /journals` can already bulk-load `source_links` for many journals when `includeSourceLinks=true`

Planning implication:
- adding backend-owned destination metadata to journal reads is a real detail-read contract upgrade, not a trivial field append
- the safe rollout is additive: keep `source_links` and other existing detail fields intact, and add `source_links[].destination` plus `reverseBlock` on the single-journal detail route
- `gl.read.journal.routes.js` will need a dedicated reverse-block preflight resolution call during single-journal detail reads
- do not introduce per-row reverse-block preflight resolution into the bulk journal list endpoint by default
- do not replace raw `source_links` with destination-only data during this migration; existing consumers must remain compatible while upgraded consumers prefer backend-owned metadata
- if a future journal list view truly needs destination or reverse-block metadata, it must use an explicit opt-in batched strategy rather than detail-style N+1 resolution

### Current frontend reverse-block UI shape
`frontend/src/pages/JournalWorkbenchPage.jsx` currently:
- defines `JOURNAL_REVERSE_SOURCE_DESTINATIONS`
- builds reverse-block route hints from static source-link types
- can reconstruct reverse-block destinations locally before using any dynamic backend destination metadata
- pre-blocks reversal locally in the submit flow before calling the backend reverse route

Dynamic fixed-assets reverse-blocking therefore also requires frontend work:
- Journal Workbench must move to a prefer-backend, fallback-local compatibility mode during rollout rather than cutting over to backend-only metadata in one shot
- when the selected journal read payload includes `reverseBlock`, the UI must use that backend-owned metadata first for local pre-block checks, messaging, and navigation hints
- when the reverse API returns `details.reverseBlock`, the UI must consume that metadata first while preserving legacy message fallback for non-upgraded source types or older payloads
- journal detail/read payloads that feed Journal Workbench must therefore be enriched with backend-owned reverse-block destination metadata before fixed-assets-specific route hints are removed from the UI

### Current frontend source-link drillback UI shape
`frontend/src/pages/JournalWorkbenchPage.jsx` also has a separate normal "Open Source" drillback path for journal source links.

Current reality:
- normal source-link drillback path resolution is still computed locally from `source_links`
- the local resolver currently knows only a small static source-type set such as `CARI_DOCUMENT`, `CARI_SETTLEMENT_BATCH`, and `PAYMENT_BATCH`
- it does not currently include `FIXED_ASSET_TRANSACTION` or `FIXED_ASSET_DEPRECIATION_RUN`

Planning implication:
- normal journal source-link drillback for fixed-assets must be upgraded explicitly, not left implicit behind reverse-blocking only
- Journal Workbench should prefer backend-owned `source_links[].destination` metadata when present and fall back to the current local resolver only when that metadata is absent
- where possible, normal drillback and reverse-blocking should use the same backend-owned destination shape and route/query contract so Journal Workbench does not maintain two separate fixed-assets destination models
- if destination consumption logic is extracted from `JournalWorkbenchPage.jsx`, it should live in one shared frontend helper rather than splitting reverse-block and normal drillback rules across separate local code paths

### Current source-type registry gap
There is no central backend or frontend source-type registry in the repo today.

Current reality:
- `backend/src/services/evidence.service.js` hardcodes supported evidence source types locally
- `backend/src/routes/gl.write.journal.routes.js` hardcodes reverse-block source types and route hints locally
- `backend/src/routes/gl.read.journal.routes.js` reads `source_links` but has no shared source-type registry for destination enrichment
- `frontend/src/pages/JournalWorkbenchPage.jsx` hardcodes both reverse-block and normal source-link drillback source-type behavior locally
- `backend/src/services/journal.source-link.service.js` stores arbitrary `source_ref_type` strings and does not define a canonical registry

Planning implication:
- do not introduce `FIXED_ASSET_TRANSACTION` and `FIXED_ASSET_DEPRECIATION_RUN` as fresh ad hoc literals in each consumer
- lock a small shared backend source-type constants module and a corresponding shared frontend source-link helper/constants module for this track
- backend fixed-assets work must add and reuse `backend/src/utils/source-ref-types.js` for canonical source-ref constants plus any small grouped sets needed by evidence, reverse-blocking, and journal-read destination enrichment
- frontend fixed-assets/journal drillback work must add and reuse `frontend/src/utils/sourceRefTypes.js` or an equivalent shared helper instead of leaving fixed-assets source-type knowledge embedded only inside `JournalWorkbenchPage.jsx`
- `backend/src/services/journal.source-link.service.js` remains storage-generic; canonical source-type ownership belongs in the shared constants/helper modules plus their consuming routes/services
- the shared backend destination resolver should own both current backend-managed static route mappings and future dynamic fixed-assets resolution so frontend code does not need to know which source types are static versus dynamic
- minimum consumers that must learn these two new fixed-assets source types in MVP are:
  - `backend/src/services/evidence.service.js`
  - `backend/src/routes/gl.write.journal.routes.js`
  - `backend/src/routes/gl.read.journal.routes.js`
  - `backend/src/services/gl.reverse-block-destination.service.js`
  - fixed-assets posting services that write `journal_source_links`, at minimum `backend/src/services/fixed-assets.service.js` and any split depreciation/posting service such as `backend/src/services/fixed-assets.depreciation.service.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- any extracted frontend shared drillback/reverse-block helper used by Journal Workbench

### Current `PRIMARY` journal-source-link enforcement gap
`journal_source_links.link_role = PRIMARY` is not currently a DB-backed one-per-journal invariant.

Current reality:
- current `journal_source_links` uniqueness only prevents exact duplicate journal/source/link-role tuples
- current schema does not prevent multiple different `PRIMARY` links from being attached to the same journal
- repo already has multiple non-fixed-assets modules writing `journal_source_links`, including CARI, cash, payments, inventory, and payroll flows
- some existing workflows attach more than one source link to the same journal, so one-`PRIMARY` hardening is a shared-platform ownership-contract change, not only a fixed-assets write-path change
- `primaryDestination` selection therefore cannot treat `PRIMARY` as an already-enforced repo invariant today

Planning implication:
- do not rely on fixed-assets posting code alone to keep one-`PRIMARY`-per-journal discipline
- fixed-assets track must add DB-backed at-most-one-`PRIMARY`-per-journal hardening on `journal_source_links`, but that hardening must be treated as a shared-platform migration prerequisite even if its DDL lands inside the fixed-assets migration family
- before enabling the DB guard, preflight real environment data, normalize any legacy duplicate-`PRIMARY` rows, audit/update existing writer workflows, and explicitly demote non-owning links on shared-journal flows to non-primary roles
- because the repo is MySQL-backed, do not assume a partial unique index is available; use a MySQL-realistic generated-column discriminator or equivalent unique-indexable workaround
- regression-test existing CARI, cash, payments, inventory, and payroll posting/reversal flows before treating the new one-`PRIMARY` guard as safe

### Current fixed-assets permission-family shape
`backend/src/seedCore.js` already seeds the existing fixed-assets permission family.

Currently seeded fixed-assets permissions already include:
- `fixed_assets.read`
- `fixed_assets.upsert`
- `fixed_assets.post`
- `fixed_assets.depreciation.run`
- `fixed_assets.depreciation.reverse`
- `fixed_assets.transfer`
- `fixed_assets.dispose`
- `fixed_assets.settings.read`
- `fixed_assets.settings.upsert`
- `fixed_assets.custodian.read`
- `fixed_assets.custodian.write`
- `fixed_assets.report.read`

Current gap:
- `fixed_assets.account_override` is not yet part of the seeded fixed-assets permission family

Planning implication:
- FA14 extends the existing fixed-assets permission family; it does not introduce fixed-assets permissions from zero
- `backend/src/seedCore.js` still needs an update so `fixed_assets.account_override` is seeded and assigned to the locked role bundles

### Frontend placeholder policy
Current demirbas placeholders are not authoritative.

Locked direction:
- stop treating generic placeholder routing as the fixed-assets plan
- keep the existing `frontend/src/pages/fixedAssets` folder and replace scaffold shells with fixed-assets-specific pages
- replace old placeholder behavior with real fixed-assets pages inside that existing folder
- normalize the route family around the updated plan

### Current frontend route, label, page, API, and app-chrome scaffolds already exist
`frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`, `frontend/src/layouts/AppLayout.jsx`, `frontend/src/i18n/messages.js`, `frontend/src/pages/fixedAssets/*`, and `frontend/src/api/fixedAssets.js` already contain the fixed-assets scaffold surface.

Planning implication:
- treat those files as verify/update/replace surfaces, not foundational missing gaps
- the page files are scaffold shells that need implementation work, not missing frontend modules that need to be created from zero
- normalize legacy aliases, redirects, and labels only where needed to match the locked canonical routes and behavior
- the repo also still carries legacy alias handling around `/app/demirbaslar`; keep-or-retire that alias explicitly rather than leaving it implicit behind the newer canonical route set
- treat `frontend/src/layouts/AppLayout.jsx` demirbas icon heuristics as shared chrome that may need verification when route naming or alias cleanup changes, not as a greenfield feature surface

### Frontend API helper is only partially scaffolded
`frontend/src/api/fixedAssets.js` already exists, but it currently covers only part of the planned API surface.

Current helper coverage is partial and still missing at least:
- `GET /api/v1/fixed-assets/:assetId/transactions`
- `GET /api/v1/fixed-assets/:assetId/depreciation-schedule`
- `POST /api/v1/fixed-assets/:assetId/suspend`
- `POST /api/v1/fixed-assets/:assetId/reactivate`
- physical move helper
- ownership transfer helper
- sale draft-create helper
- sale link helper
- sale draft-update helper
- sale finalize helper
- write-off helper
- `GET /api/v1/fixed-assets/runs/:runId`
- `DELETE /api/v1/fixed-assets/runs/:runId`
- `POST /api/v1/fixed-assets/transactions/:transactionId/reverse`
- category create/update helpers
- depreciation profile create/update helpers
- custodian create/update helpers
- evidence create/upload/download/delete helpers
- report endpoint helpers
- report `/export` endpoint helpers paired with the fixed-assets reports
- deep-link-supporting read helpers needed by the locked reverse-block contract, including run-detail loading and transaction-list loading with transaction-focus support on asset detail

Implementation note:
- `frontend/src/api/fixedAssets.js` must now support the locked reverse-block/deep-link contract, not only basic fixed-assets CRUD and workflow actions

Frontend planning should therefore be framed as:
- expand the existing API helper
- expand the existing fixed-assets page scaffolds

Do not describe frontend fixed-assets API work as greenfield anymore.

## Locked MVP Decisions

### Accounting and data-model decisions
- Fixed assets are not inventory.
- Fixed-assets lifecycle is transaction-backed and journal-traceable.
- Enums use repo-native uppercase values in both DB and API.
- Store transaction currency and base currency amounts side by side.
- CARI capitalization uses option A:
  - AP line posts directly to the fixed-asset account
  - fixed-assets adds subledger traceability, schedules, and lifecycle control
- Do not put `posted_journal_entry_id` on the fixed-asset master.
- Journal linkage belongs on transactional rows plus `journal_source_links`.
- Evidence must support asset-level, transaction-level, and depreciation-run-level granularity.
- One AP-direction CARI line may create multiple fixed-asset cards in MVP when the line represents multiple identifiable asset units; exact source-line provenance plus per-line unit-slot uniqueness must be enforced.
- One asset and one period to one posted depreciation result must be DB-enforced.
- Depreciation run auditability requires a dedicated run-line table plus a dedicated run-line allocation child table for persisted prorata split context.
- Every posting action must explicitly validate:
  - book
  - legal entity scope
  - fiscal period open
  - posting date legality

### Status and enum casing
Use uppercase repo-style values such as:
- `DRAFT`
- `ACTIVE`
- `SUSPENDED`
- `FULLY_DEPRECIATED`
- `DISPOSED`
- `POSTED`
- `REVERSED`

Do not use lowercase enum values in schema or API contracts.

### Book selection strategy
Lock the repo-native book strategy now.

Locked decision:
- do not store `book_id` on the fixed-asset master
- store `book_id` only on posting-bearing rows such as:
  - `fixed_asset_transactions`
  - `fixed_asset_depreciation_runs`
- MVP fixed-assets is single-book operationally per `(tenant_id, legal_entity_id)`; do not treat depreciation schedules or asset-period posting uniqueness as multi-book in MVP
- `fixed_asset_depreciation_schedule_lines` are intentionally not book-scoped in MVP
- asset-period depreciation posting uniqueness is intentionally not book-scoped in MVP
- the resolved legal-entity operational posting book becomes the one fixed-assets posting book for that legal entity in MVP
- request payloads may pass `bookId` for posting actions
- if `bookId` is omitted, resolve it through the repo's existing legal-entity book selection pattern
- if `bookId` is supplied, it must match the resolved operational fixed-assets book for that legal entity; do not support alternate-book fixed-assets posting in MVP

This matches existing repo behavior better than putting `book_id` on the asset master.

### Period-key strategy
Lock stored fixed-assets period labeling now so FA01/FA07/FA08 do not drift into incompatible `period_key` formats.

Locked decision:
- `period_key` is a stored denormalized monthly bucket for fixed-assets schedule/run data; it is not a replacement for `fiscal_period_id`
- locked `period_key` format is calendar `YYYY-MM`, for example `2026-03`
- do not use `P01`, `YYYYMMM`, raw `fiscal_period_id`, integer month keys, or any other alternative stored format in MVP
- where a fixed-assets row also stores `fiscal_period_id`, that `fiscal_period_id` remains authoritative and the stored `period_key` must match the referenced fiscal period's locked fixed-assets month bucket
- `fixed_asset_depreciation_schedule_lines.period_key` is the stored month bucket for schedule rows because schedule lines are intentionally not linked directly to `fiscal_period_id` in MVP
- fixed-assets MVP schedule/run data may be created only for non-adjustment fiscal periods
- fixed-assets MVP schedule/run data may be created only for fiscal periods that align to one calendar month; if a fiscal-period setup does not map cleanly to one calendar `YYYY-MM` bucket, that setup is out of scope for fixed-assets MVP
- for supported fixed-assets periods, derive `period_key` from the aligned calendar month bucket of the referenced fiscal period
- do not invent adjustment-period suffixes or alternate `period_key` encodings in MVP
- if adjustment-period support or non-calendar-month period support is needed later, that requires a documented plan change

Implementation note:
- when fixed-assets resolves a fiscal period from a posting/schedule date, follow the repo-native module-local resolution pattern that prefers non-adjustment rows for the matched calendar date instead of assuming an existing shared helper
- when fixed-assets accepts `fiscalPeriodId` directly, it must explicitly load and reject `fiscal_periods.is_adjustment = TRUE`; do not rely only on `assertFiscalPeriodBelongsToCalendar(...)`

### Asset numbering strategy
Lock asset numbering now.

Locked decision:
- `asset_no` is system-generated
- users do not type or edit `asset_no`
- `asset_tag` remains the optional user-facing/manual identifier if a business tag is needed
- `asset_no` display format is locked to `FA-######` in MVP, where the numeric segment is a zero-padded backend sequence
- asset numbering is continuous within `(tenant_id, legal_entity_id)` in MVP; do not reset the asset sequence by year
- `asset_no` must be unique within the fixed-assets numbering scope for MVP
- for MVP, enforce uniqueness within `(tenant_id, legal_entity_id)`

Implementation note:
- follow existing repo-native module-local numbering patterns rather than ad hoc frontend-generated values
- do not describe asset numbering as reusing an existing shared generic helper; that helper does not exist today
- if multiple fixed-assets services need the same asset-number reservation/formatting logic, extract a small helper inside fixed-assets and reuse it there
- `asset_no` should be assigned by the backend when the asset row is created, not deferred to manual entry
- store the reserved numeric source in `fixed_assets.sequence_no` so the display string is not the only numbering contract
- reserve the next asset sequence in backend SQL using the repo-native MySQL max-under-lock pattern, for example `SELECT COALESCE(MAX(sequence_no), 0) ... FOR UPDATE`
- do not introduce frontend-generated numbering, user-entered numbering, or a separate placeholder reservation table in MVP

Repo rationale:
- the repo already uses explicit backend-reserved numbering for operational records such as CARI documents, settlements, and cash transactions
- unlike those dated operational documents, `asset_no` is a long-lived asset-register identifier, so MVP uses one continuous legal-entity sequence instead of a year-reset document-number convention

### Fixed-assets transaction boundary strategy
Lock fixed-assets transaction boundaries now so sequence reservation, lifecycle writes, and journal posting do not drift into partially committed workflows.

Locked decision:
- every multi-row mutating fixed-assets workflow in MVP must execute inside one repo-native `withTransaction(...)` boundary
- this includes at minimum:
  - asset create flows that reserve `sequence_no` / assign `asset_no`
  - activation
  - CARI AP-line capitalization
  - depreciation run creation when it persists run header/line/allocation rows
  - depreciation run posting
  - depreciation run reversal
  - physical move
  - ownership transfer
  - sale
  - write-off
  - non-run fixed-assets transaction reversal
- any fixed-assets sequence reservation that uses `SELECT COALESCE(MAX(sequence_no), 0) ... FOR UPDATE` must occur inside the same `withTransaction(...)` scope as the consuming asset-row insert or update that persists the reserved number
- do not describe or implement sequence reservation and asset-row creation as separate commit boundaries in MVP
- when a workflow writes an owning transaction row, detail child row, evidence-policy side effect, journal entry, or `journal_source_links` row for the same business event, those writes must stay inside the same transaction boundary as the parent workflow mutation
- preview/list/report/read-only flows do not require `withTransaction(...)` unless they explicitly rely on lock-based consistency

Connection-pool awareness note:
- repo-native `withTransaction(...)` holds one pooled MySQL connection for the full workflow; it does not spread one transaction across multiple pool connections
- fixed-assets must therefore keep the one-transaction rule and solve large FA08 persistence volume by chunking SQL writes inside that one transaction rather than by splitting one business workflow across multiple commits
- run-line and allocation persistence must be sized to stay below deployment packet/timeout limits; do not rely on one giant statement payload as the default implementation shape

### Fixed-assets journal header strategy
Lock fixed-assets journal-header conventions now so FA posting flows do not improvise journal numbering or journal-header source typing at implementation time.

Locked decision:
- every fixed-assets posting flow that creates a GL journal must construct `journal_entries.journal_no` explicitly using the repo-native module-local numbering pattern; do not leave FA journal numbering as ad hoc inline strings or user-entered journal numbers
- fixed-assets journal numbers must follow a repo-native uppercase prefix-plus-source-row pattern with a uniqueness suffix and must fit the existing `journal_entries.journal_no` length limit
- locked MVP journal prefixes are:
  - non-run fixed-assets posting journal: `FA-TXN`
  - depreciation-run posting journal: `FA-RUN`
  - non-run fixed-assets reversal journal: `FA-TXN-REV`
  - depreciation-run reversal journal: `FA-RUN-REV`
- the minimum locked journal-number shapes are:
  - non-run fixed-assets posting journal: `FA-TXN-<transactionId>-<stamp>`
  - depreciation-run posting journal: `FA-RUN-<runId>-<stamp>`
  - non-run fixed-assets reversal journal: `FA-TXN-REV-<transactionId>-<stamp>`
  - depreciation-run reversal journal: `FA-RUN-REV-<runId>-<stamp>`
- `<stamp>` may use the repo's existing timestamp/base36 style or an equivalent repo-native uniqueness suffix, but fixed-assets must not use workflow-specific free-form numbering conventions
- all fixed-assets generated journals must use `journal_entries.source_type = SYSTEM` in MVP
- do not introduce a new `journal_entries.source_type` enum such as `FIXED_ASSET` in MVP
- fixed-assets-specific ownership, drillback, and reverse-block routing continue to live in `journal_source_links`, not in `journal_entries.source_type`

Implementation note:
- do not describe fixed-assets journal numbering as reusing an existing shared generic helper; that helper does not exist today
- if multiple fixed-assets posting/reversal flows need the same journal-number builder, extract a small helper inside fixed-assets and reuse it there

### Fixed-assets account mapping type rules
Lock expected GL account types now so fixed-assets account mapping does not drift from the repo's existing account-type validation pattern.

Locked decision:
- fixed-assets account mappings and category default account mappings must validate against the repo's `accounts.account_type` enum during setup, activation, and any override workflow
- fixed-assets account mappings and category default account mappings must also validate legal-entity ownership through `charts_of_accounts`; do not treat `accounts.id` alone as sufficient scope validation
- the locked ownership invariant is:
  - the mapped account must belong to a chart of accounts with `scope = LEGAL_ENTITY`
  - that chart of accounts must belong to the same `legal_entity_id` as the fixed-assets row or category being configured
- locked expected account types in MVP are:
  - `asset_account_id` / `default_asset_account_id` -> `ASSET`
  - `accum_depr_account_id` / `default_accum_depr_account_id` -> `ASSET`
  - `depr_expense_account_id` / `default_depr_expense_account_id` -> `EXPENSE`
  - `disposal_gain_account_id` / `default_disposal_gain_account_id` -> `REVENUE`
  - `disposal_loss_account_id` / `default_disposal_loss_account_id` -> `EXPENSE`
- accumulated depreciation remains a contra-asset by business meaning, but under the repo's current chart-of-accounts model it must still validate as `account_type = ASSET`; do not invent a special contra-asset account type for MVP
- enforce these account-type and legal-entity chart-ownership rules in validators/service SQL using the repo's existing account-resolution pattern that joins `accounts` to `charts_of_accounts`; do not leave account compatibility or legal-entity ownership implicit

### Dual-amount requirement
Because CARI AP capitalization is in scope and the repo already uses transaction/base dual amounts elsewhere, fixed-assets must store both transaction and base amounts where relevant.

At minimum:
- `original_cost_txn`
- `original_cost_base`
- `salvage_value_txn`
- `salvage_value_base`
- `legacy_accum_depr_txn`
- `legacy_accum_depr_base`
- `legacy_nbv_txn`
- `legacy_nbv_base`

Terminology note:
- in this plan, `legacy onboarding values` means one-time imported carrying values used to bring pre-existing assets into the fixed-assets module at go-live
- they are not the ordinary year-end closing/opening carry-forward process for assets already managed inside the module

### Capitalization threshold behavior
Lock category-threshold behavior now so `capitalization_threshold_base` is not left as passive metadata.

Locked decision:
- below-threshold assets may still have a fixed-assets record for control and tracking in MVP
- for new manual activations without legacy onboarding values and for CARI capitalization events, if an asset's `original_cost_base` is below the category threshold, it is not eligible for normal depreciation scheduling or depreciation runs and must use the dedicated low-value path with same-period full-expense treatment
- lock Option B for manual legacy onboarding:
  - below-threshold manual legacy onboarding imports are allowed in MVP
  - the current category threshold is not reapplied retroactively to those legacy onboarding imports during onboarding
  - onboarding a below-threshold manual legacy onboarding asset must not auto-create a same-period full-expense `DEPRECIATION` transaction solely because the asset is below the current threshold
  - accounting for those imported assets follows the supplied legacy onboarding values and remaining-life inputs instead of the new-asset low-value rule
- same-period full-expense is represented in MVP as a one-time `DEPRECIATION` transaction created during activation or capitalization for the new-asset low-value path only
- low-value same-period full-expense does not create a retirement event and does not set the asset to `DISPOSED`
- after the one-time full-expense treatment, the asset status moves directly to `FULLY_DEPRECIATED`, not `ACTIVE`
- after the one-time full-expense treatment, the asset remains tracked with zero NBV and is treated as `FULLY_DEPRECIATED` for depreciation eligibility
- if a below-threshold manual legacy onboarding import already has zero remaining depreciable amount at activation, it may land in `FULLY_DEPRECIATED` with no new journal, but because of the imported legacy onboarding state rather than the low-value same-period full-expense rule
- below-threshold assets that were fully expensed remain visible for physical control, reporting, and later `SALE` / `WRITEOFF` workflows if still physically held
- do not hard-block activation/capitalization solely because the amount is below threshold
- do not treat the threshold as warn-only metadata or reporting-only metadata in MVP
- do not introduce a separate threshold-override permission or approval workflow in MVP
- threshold breaches and low-value treatment must remain reportable so finance can review them explicitly

### Draft versus posted source-document rule
Locked for MVP:
- allow draft fixed-asset linkage to a draft CARI document line
- while a source-linked asset remains `DRAFT`, source-derived draft values copied from the linked CARI line are provisional rather than final
- activation/posting must reload and revalidate the current source CARI document/line status, quantity, currency, txn/base amounts, and remaining unit-slot eligibility before finalizing a source-linked asset
- when that activation-time revalidation detects source-line drift on a still-`DRAFT` linked asset, fixed-assets must auto-refresh source-derived draft values from the current linked CARI line before final validation
- that auto-refresh applies only to source-derived CARI fields such as per-unit cost/defaulted amount context; it must not silently overwrite user-owned fields such as category, owner OU, location OU, capitalization date, or in-service date
- if the current source state no longer supports the reserved unit slot, equal per-unit split assumptions, or resulting threshold/activation path after revalidation, activation/posting must block until the asset draft is refreshed, relinked, or the source document is corrected
- allow activation/posting only when the source CARI document is `POSTED`
- temporary upstream-reversal guard: if a posted CARI source document or source line is already linked to an activated asset or to any posted fixed-assets transaction that still depends on that source, CARI-side reversal is blocked until the fixed-assets dependency is resolved through the owning fixed-assets workflow
- MVP does not auto-reverse, auto-dispose, or otherwise auto-unwind fixed-assets state from an upstream CARI reversal

### Cross-module permission behavior with CARI
Lock CARI authorization behavior now so FA06 and FA11 do not drift into inconsistent access control.

Locked decision:
- fixed-assets routes do not encapsulate CARI access under `fixed_assets.*` permissions alone
- when a fixed-assets workflow reads, creates, updates, or posts CARI documents, the user must also hold the corresponding CARI permission
- relevant CARI permissions are action-scoped:
  - `cari.doc.read` for reading or linking an existing CARI document
  - `cari.doc.create` for creating a draft CARI document
  - `cari.doc.update` for editing a linked draft CARI document
  - `cari.doc.post` for posting a CARI document

MVP implications:
- selecting AP lines during capitalization requires fixed-assets permissions plus `cari.doc.read`
- sale link flows require fixed-assets disposal/sale authority plus `cari.doc.read`
- sale create-draft flows require fixed-assets disposal/sale authority plus `cari.doc.create`
- sale draft-edit flows require fixed-assets disposal/sale authority plus `cari.doc.update`
- sale finalize flows require fixed-assets disposal/sale authority plus `cari.doc.post`
- do not proxy around missing CARI permissions through fixed-assets-only endpoints

Implementation note:
- do not satisfy FA06/FA11 multi-permission requirements by stacking multiple `requirePermission(...)` middlewares on the same route in MVP
- the existing repo middleware stores one active `req.rbac` context per request, so stacking `requirePermission(...)` calls would overwrite route-owned RBAC context and can cause scope drift depending on which permission runs last
- locked repo-native approach for MVP:
  - use `requirePermission(...)` as the primary route guard for the owning fixed-assets action
  - add and use a secondary RBAC helper that asserts an additional permission code without replacing `req.rbac`
  - use that secondary helper for cross-module `cari.doc.read/create/update/post` checks required by FA06 and FA11
- do not move these cross-module permission checks into ad hoc service-local permission lookups that bypass the shared RBAC helper pattern unless a later repo-wide RBAC refactor changes the standard approach

### Fixed-assets RBAC scope resolver strategy
Lock the fixed-assets `resolveScope` contract now so route-level RBAC coverage follows the repo's scoped-module pattern instead of ad hoc per-route lambdas.

Locked decision:
- fixed-assets routes that use `requirePermission(...)` with scoped records or legal-entity-scoped list/create flows must use shared resolver helpers, not one-off route-local scope logic duplicated per endpoint
- fixed-assets backend work must add `backend/src/services/fixed-assets.scope.service.js` as the owning module for shared fixed-assets RBAC scope resolution
- fixed-assets scope resolution should be split into explicit stages inside that module:
  - request-scoped resolvers for list/create/report/settings entry points:
    - `resolveLegalEntityScopeFromQuery(req)`
    - `resolveLegalEntityScopeFromBody(req)`
  - record-scoped resolvers for existing-row entry points:
    - `resolveFixedAssetScope(assetId, tenantId)`
    - `resolveFixedAssetTransactionScope(transactionId, tenantId)`
    - `resolveFixedAssetRunScope(runId, tenantId)`
- `resolveLegalEntityScopeFromQuery(req)` and `resolveLegalEntityScopeFromBody(req)` are the shared repo-native helpers for fixed-assets list/create/report/settings routes that scope directly from request filters or payloads
- for fixed-assets request-scoped helpers, when one authoritative owner-OU input is present for the workflow, the resolver may return `OPERATING_UNIT`; otherwise it should return `LEGAL_ENTITY` from `legalEntityId`
- `resolveFixedAssetScope(assetId, tenantId)` must resolve scope from the fixed-asset row and prefer the asset owner-OU scope when `owner_operating_unit_id` is present; otherwise fall back to the asset `legal_entity_id`
- `resolveFixedAssetTransactionScope(transactionId, tenantId)` must resolve scope from the fixed-asset transaction's owning fixed-assets context using shared resolver logic rather than route-local SQL
- `resolveFixedAssetRunScope(runId, tenantId)` must resolve scope from the depreciation run row and return the run's legal-entity scope in MVP
- route handlers operating on existing records should use the record-based scope resolver first and may fall back to body/query scope only where the repo's existing update-route pattern requires it
- fixed-assets nested evidence routes for asset, transaction, and run surfaces must reuse the same shared scope resolvers rather than defining separate ad hoc RBAC resolver logic
- `backend/src/routes/fixed-assets.routes.js` and `backend/src/routes/fixed-assets.evidence.routes.js` should import those resolvers from `backend/src/services/fixed-assets.scope.service.js` rather than defining route-local copies

### Legacy onboarding / import behavior
Lock legacy onboarding behavior now so go-live setup does not create accounting ambiguity.

Locked decision:
- legacy onboarding values are allowed only for manually created assets
- legacy onboarding values are not allowed for CARI-linked assets
- legacy onboarding fields may be entered only while the asset is `DRAFT`
- after activation, legacy onboarding fields are immutable
- manual legacy onboarding activation represents legacy / go-live onboarding of an already-existing asset state into this module, not a new current-period acquisition
- activation of a manual legacy onboarding asset still creates one `ACQUISITION` transaction row for fixed-assets auditability
- for manual legacy onboarding / go-live assets, that `ACQUISITION` row must not post a new acquisition journal in MVP
- `fixed_asset_transactions.journal_entry_id` remains null for that onboarding `ACQUISITION` row unless a later documented migration-posting flow is introduced
- legacy onboarding values seed forward depreciation scheduling from the activation state
- legacy onboarding values do not generate historical or backfilled schedule lines in MVP
- lock Option B for below-threshold manual legacy onboarding imports:
  - allow them in MVP
  - never auto-expense them on onboarding solely because `original_cost_base` is below the current category threshold
  - if imported legacy onboarding state still has remaining depreciable amount, continue forward depreciation from the imported legacy NBV / remaining-life state
  - if imported legacy onboarding state already has zero remaining depreciable amount, the asset may activate directly into `FULLY_DEPRECIATED` with no new journal
- any later correction must use an explicit transaction-backed accounting workflow, not a silent master edit

Implementation note:
- treat legacy onboarding values as go-live setup for pre-existing manually registered assets already in use before this module
- treat the onboarding `ACQUISITION` row as subledger history for module entry, not proof that a fresh GL acquisition was booked on the activation date
- schedule generation should start from the seeded carrying amount and remaining life at activation time
- treat the category capitalization threshold as prospective for new activation/capitalization events, not as a retroactive migration-policy override for legacy onboarding imports

### Remaining-life capture for legacy onboarding assets
Lock the forward depreciation horizon now so FA07 is implementable.

Locked decision:
- add `remaining_useful_life_months` to the fixed-asset master
- `useful_life_months` remains the nominal/original useful life field
- `remaining_useful_life_months` is required for manual legacy onboarding depreciable assets before activation
- `remaining_useful_life_months` is not used for CARI-linked assets in MVP
- standard non-import assets may keep `remaining_useful_life_months` null and let the schedule engine derive remaining life from normal lifecycle inputs
- legacy onboarding schedule generation must use stored `remaining_useful_life_months`, not guess remaining life from dates alone

### Sale workflow scope
Lock sale scope now so it is not treated as a vague proceeds field.

Locked decision:
- MVP sale must integrate with CARI AR
- sale is not a standalone free-form disposal with manually typed proceeds only
- sale workflow must create or link to an AR-direction CARI document for the customer-facing receivable / billing side
- sale workflow uses an explicit staged action contract in MVP rather than one overloaded endpoint
- `POST /api/v1/fixed-assets/:assetId/sale/create-draft-ar-document` creates the draft AR-side document/line context only
- `POST /api/v1/fixed-assets/:assetId/sale/link-ar-document` links an existing AR-direction document/line only
- `PATCH /api/v1/fixed-assets/:assetId/sale/draft-ar-document` edits the currently linked draft AR-side context only
- `POST /api/v1/fixed-assets/:assetId/sale/finalize` is the only fixed-assets sale action that may create the `SALE` row, disposal journal, and disposed asset state
- fixed-assets disposal logic remains responsible for asset retirement, NBV relief, and gain/loss accounting
- CARI AR remains responsible for the receivable / customer-document side

Minimum traceability requirement:
- sale transactions must keep source linkage to the related CARI AR document
- posted `SALE` transactions must also keep source linkage to the exact related CARI AR line through `source_ref_line_id`; do not leave posted sale provenance at the document-header level only
- GL drillback must stay consistent with the locked `FIXED_ASSET_TRANSACTION` source-link strategy
- one AR-direction CARI document may contain multiple fixed-asset sale lines in MVP, but each AR line may represent only one asset sale
- do not aggregate multiple fixed assets into one shared AR sale line when fixed-assets provenance is expected to stay line-exact

### Fixed-asset transaction semantics
Lock transaction meanings now so additions, retirements, and journal drillback do not depend on implementation taste.

Locked decision:
- manual asset activation creates one `ACQUISITION` transaction row
- for manual legacy onboarding / go-live assets, the `ACQUISITION` row records onboarding into the fixed-assets subledger rather than a new purchase event
- for manual legacy onboarding / go-live assets, do not post a fresh acquisition journal from that `ACQUISITION` row in MVP
- do not create both `ACQUISITION` and `CAPITALIZATION` for the same manual activation event in MVP
- CARI AP-linked capitalization creates one `CAPITALIZATION` transaction row
- do not create both `ACQUISITION` and `CAPITALIZATION` for the same CARI-linked event in MVP
- low-value same-period full-expense reuses one `DEPRECIATION` transaction row in MVP; do not introduce a separate `LOW_VALUE_EXPENSE` transaction type
- below-threshold manual legacy onboarding does not create that inline low-value `DEPRECIATION` row solely because the imported asset is below the current threshold
- keep one shared `DEPRECIATION` transaction type, but add an explicit `depreciation_kind` classifier so low-value inline full-expense remains distinguishable from normal run-posted depreciation
- locked `depreciation_kind` values for MVP are:
  - `RUN`
  - `LOW_VALUE_FULL_EXPENSE`
- `depreciation_kind` is required on `DEPRECIATION` rows and null for non-`DEPRECIATION` transaction types
- FA08 run-posted depreciation must use `depreciation_kind = RUN`
- FA05 / FA06 inline low-value same-period full-expense must use `depreciation_kind = LOW_VALUE_FULL_EXPENSE`
- suspend actions must create one `SUSPEND` transaction row for lifecycle history
- reactivate actions must create one `REACTIVATE` transaction row for lifecycle history
- `SUSPEND` and `REACTIVATE` are explicit audit/history transaction types even when they do not post journals in MVP
- remove generic `DISPOSAL` as a distinct fixed-asset transaction type in MVP
- `WRITEOFF` = retirement/disposal with no customer proceeds, such as scrap, abandonment, or loss-only retirement
- `SALE` is a disposal/retirement subtype represented by one `SALE` transaction row
- the fixed-assets `SALE` row is created only at final sale post, not when a draft AR-direction CARI document is created or linked
- a sale event sets asset status to `DISPOSED` but does not create an extra retirement row alongside `SALE`
- when `SALE` is backed by CARI AR, the posted `SALE` row must keep exact AR-line provenance through `source_ref_type = CARI_DOCUMENT`, `source_ref_id = cari_documents.id`, and `source_ref_line_id = cari_document_lines.id`

Reporting implication:
- additions reporting groups `ACQUISITION` and `CAPITALIZATION` as addition classes without duplicating one business event into two rows
- disposal/retirement reporting groups `WRITEOFF` and `SALE`, with `SALE` staying distinguishable as the customer-proceeds subtype

### Post-activation edit policy
Lock mutability after `ACTIVE` now.

Locked decision:
- after an asset becomes `ACTIVE`, physical placement and responsibility fields may change only through explicit transaction-backed workflows
- `owner_operating_unit_id` may change only through the ownership-transfer workflow
- `location_operating_unit_id` and `custodian_employee_id` may change only through the physical-move / reassignment workflow
- do not allow silent direct edits to accounting or depreciation drivers after activation

Immutable after activation in MVP:
- source CARI linkage
- category
- depreciation profile
- snapped depreciation-driving profile fields on the asset
- useful life
- salvage snapshot fields and resolved salvage values
- legacy onboarding accumulated depreciation / legacy onboarding NBV fields
- mapped accounts

Implementation note:
- active assets must use snapped depreciation-driving fields, snapped salvage-rule inputs, and resolved salvage values stored on the asset master; later edits to the referenced depreciation-profile row or category/default salvage setup are prospective defaults only
- if a later phase needs post-activation accounting-estimate revisions, they must be introduced as explicit controlled workflows, not ordinary edit-form updates

### Depreciation convention
FA07 and FA08 need explicit depreciation behavior, not an implied one.

Locked MVP convention:
- month convention: `DAILY_PRORATA`
- monthly depreciation is apportioned by eligible in-service days in the fiscal month
- an asset state that becomes effective on a date starts on that date
- the prior state applies through the day before the effective date
- use one consistent day-count basis: `monthly_amount * eligible_days / days_in_month`
- depreciation run posting date defaults to the fiscal period end date
- allow a user-entered posting date only if it falls inside the same open fiscal period
- rounding policy: round monetary values to the legal entity / currency precision already used by the repo, with the final schedule line absorbing any residual rounding delta
- disposal, write-off, suspension, reactivation, and ownership transfer use effective-date daily apportionment within the month
- `SUSPENDED` assets do not generate depreciation for suspended days, and existing planned future schedule lines may remain stored so long as run eligibility/posting respects daily active-day cutoffs
- ownership-transfer month depreciation must split by OU; the source owner applies through the day before the effective transfer date and the target owner starts on the effective transfer date
- disposal/write-off month depreciation stops on the effective disposal date; no depreciation is recognized on or after that date
- if an asset is already `FULLY_DEPRECIATED` or otherwise has zero remaining depreciable amount for that month, the disposal/write-off cutoff remains an eligibility rule only and must not create a zero-amount `DEPRECIATION` transaction or other zero-amount depreciation posting as a formality
- reactivation resumes depreciation from the reactivation effective date; do not back-post missed depreciation automatically in MVP
- FA07/FA08 depreciation logic must read snapped asset-level depreciation-driving fields, not the current mutable depreciation-profile row, once the asset is activated

Important:
- if later a different month convention such as full-month or half-month is needed, that must be a documented plan change, not an implicit implementation choice

### Declining-balance method rules
Keep `DECLINING_BALANCE` in MVP only with fully locked math.

Locked decision:
- `declining_balance_rate_percent` is an annual nominal percentage rate in MVP, not a monthly input
- monthly declining-balance rate = `declining_balance_rate_percent / 12 / 100`
- for each fiscal month, first compute the full-month declining-balance amount on the opening depreciable base above salvage using `max(0, opening_nbv - salvage_value) * monthly_rate`
- when `switch_to_straight_line = true`, compare that full-month declining-balance amount with the full-month straight-line amount for the same period, calculated as `max(0, opening_nbv - salvage_value) / remaining_life_months`
- if the straight-line amount is greater than or equal to the declining-balance amount, switch permanently to `STRAIGHT_LINE` from that month onward
- when `switch_to_straight_line = false`, do not switch automatically
- under `DAILY_PRORATA`, first determine the full-month method amount for the period, then apportion it by `eligible_days / days_in_month`
- no declining-balance or switched straight-line calculation may depreciate below the salvage floor
- the final remaining depreciation line may absorb rounding residual, but it must still respect the salvage floor

### Depreciation preview persistence
Lock preview persistence now so FA08 does not drift into mixed transient/persisted behavior.

Locked decision:
- `POST /api/v1/fixed-assets/runs/preview` is transient calculation only
- preview does not persist `fixed_asset_depreciation_runs`, `fixed_asset_depreciation_run_lines`, or `fixed_asset_depreciation_run_line_allocations` rows
- multiple preview calls per period are allowed because preview is not part of the operational run ledger
- `POST /api/v1/fixed-assets/runs` creates the real persisted operational run
- persisted depreciation runs represent operational runs only, not ad hoc previews
- use persisted run statuses:
  - `DRAFT`
  - `POSTED`
  - `REVERSED`
- do not persist a separate `FAILED` run-header status in MVP
- allow at most one persisted `DRAFT` run for the same `(tenant_id, legal_entity_id, book_id, fiscal_period_id)`
- a persisted `DRAFT` run is a frozen snapshot of the calculated run lines, run-line allocation rows, and totals at creation time
- if persisted run creation fails, the transaction must roll back fully and no run header/line/allocation rows should remain
- posting must use the saved `DRAFT` run lines, run-line allocation rows, and totals; do not silently recompute the run at post time
- if run posting fails, the run remains `DRAFT`; do not transition it into a separate persisted failure status
- if users want refreshed calculations after asset/setup changes, they must explicitly discard the old persisted `DRAFT` run and then create a newly calculated one instead of recalculating it in place
- MVP stale-draft replacement contract is `DELETE /api/v1/fixed-assets/runs/:runId`
- that delete surface is allowed only when the run status is `DRAFT`
- `DELETE /api/v1/fixed-assets/runs/:runId` deletes the persisted draft snapshot rows for that run so a fresh operational `DRAFT` can be created for the same scope
- if run reversal fails, the run remains `POSTED`; do not transition it into a separate persisted failure status

### Source-owned reversal surface
Lock non-run fixed-assets reversal ownership now so GL reverse-blocking points users to a real source workflow, not only back to a detail page.

Locked decision:
- `POST /api/v1/fixed-assets/runs/:runId/reverse` remains the source-owned reversal surface for depreciation batch journals
- add `POST /api/v1/fixed-assets/transactions/:transactionId/reverse` as the source-owned reversal surface for posted non-run fixed-assets transactions
- in MVP, the non-run transaction reversal surface covers posted `FIXED_ASSET_TRANSACTION` rows such as `ACQUISITION`, `CAPITALIZATION`, inline low-value `DEPRECIATION`, `OWNERSHIP_TRANSFER`, `WRITEOFF`, and `SALE`
- locked non-run reversal admissibility rule: the target transaction must still be the latest finalized fixed-assets lifecycle event for the asset in MVP
- if any successor lifecycle event exists for the same asset, reversal is blocked instead of unwinding through later events
- for this admissibility rule, successor lifecycle event means any later `fixed_asset_transactions` row for the same asset that is not `DRAFT` or `CANCELLED`
- chronology for successor blocking must use `effective_date` first and transaction `id` second as the stable same-date tie-breaker
- do not implement cascading or compensating chain-unwind logic that automatically reverses later dependent fixed-assets events in MVP
- when the target transaction also owns linked downstream CARI-side state, reversal must also be blocked if that linked document lifecycle has progressed beyond a reversal-compatible state; do not auto-unwind CARI progression from fixed-assets
- for `SALE`, the linked AR-direction CARI document/line must already be reversed or otherwise returned to a reversal-compatible non-posted state in CARI before the fixed-assets sale reversal is allowed
- reversing the AR-side CARI document alone does not reopen the asset or remove the posted fixed-assets `SALE`; a separate fixed-assets sale reversal is still required after the CARI-side reversal
- reversing one of those source-owned posting events creates one `REVERSAL` transaction row with authoritative reversal lineage on `reversed_transaction_id`
- `reversed_transaction_id` points from the `REVERSAL` row to the original posted fixed-assets transaction and must be DB-enforced so one original transaction cannot be reversed twice
- if `reversal_transaction_id` is retained on the original transaction row, it is an optional nullable convenience back-pointer updated after the reversal row is created; do not treat it as the primary lineage contract or as a second required self-referencing foreign key
- do not require users to reverse those fixed-assets-owned journals directly from GL once the source-owned reversal workflow exists
- non-posting lifecycle events such as `PHYSICAL_MOVE`, `SUSPEND`, and `REACTIVATE` remain transaction-backed history workflows; do not imply a generic journal-reversal path for them when no posted journal exists

### Journal source-link strategy
Lock journal drillback strategy now.

Locked decision:
- acquisition, capitalization, write-off, sale, and ownership-transfer journals use primary source-link type `FIXED_ASSET_TRANSACTION`
- one-time low-value same-period full-expense journals use primary source-link type `FIXED_ASSET_TRANSACTION`
- depreciation batch journals use primary source-link type `FIXED_ASSET_DEPRECIATION_RUN`
- if per-asset depreciation posting transactions are created, they may also receive optional secondary links through `FIXED_ASSET_TRANSACTION`
- fixed-assets must write exactly one owning journal source link with `journal_source_links.link_role = PRIMARY` for each fixed-assets generated journal
- `journal_source_links` must enforce at most one `PRIMARY` link per journal as a DB-backed invariant, not just a posting-service convention
- implement that one-`PRIMARY`-per-journal rule through a MySQL-realistic generated-column discriminator or equivalent unique-indexable workaround inside the fixed-assets migration track; do not leave it as application-only discipline
- any supporting or secondary source links attached to the same journal must use non-primary `link_role` values
- normal journal source-link drillback must explicitly support `FIXED_ASSET_TRANSACTION` and `FIXED_ASSET_DEPRECIATION_RUN`, not only reverse-blocking
- when journal detail/read payloads expose `source_links`, upgraded fixed-assets source-link rows must carry backend-owned `destination` metadata using the same minimum destination metadata shape and the same route/query contract used by reverse-blocking where applicable
- Journal Workbench normal "Open Source" actions must use that backend-owned `source_links[].destination` metadata when present instead of reconstructing fixed-assets paths locally from a static source-type map
- `journal_entries.source_type` remains only the coarse journal-header classification and must stay `SYSTEM` for fixed-assets generated journals in MVP; it is not the fixed-assets ownership/drillback contract

This keeps GL drillback, reverse blocking, and source traceability aligned to the actual posting event instead of the asset master.

### Source reference contract
Lock upstream source-document provenance now so fixed-assets transaction rows do not drift into conflicting source-ref conventions.

Locked decision:
- `fixed_asset_transactions.source_ref_*` captures upstream business-source provenance of the fixed-assets transaction, not the journal drillback owner
- for CARI-backed fixed-assets transactions in MVP, use:
  - `source_ref_type = CARI_DOCUMENT`
  - `source_ref_id = cari_documents.id`
  - `source_ref_line_id = cari_document_lines.id` when the transaction originates from a specific CARI line
- for `SALE` transactions backed by CARI AR in MVP, the posted/finalized `SALE` row must carry the exact related AR line id in `source_ref_line_id`; do not leave a posted `SALE` transaction linked only to the AR document header
- if fixed-assets creates the related AR document, it must create one dedicated asset-sale line and persist that line id on the `SALE` transaction
- if fixed-assets links an existing AR document, the sale workflow must identify the exact AR line id to use for that asset sale
- one AR-direction CARI document may contain multiple fixed-assets sale lines, but each linked `source_ref_line_id` must correspond to one asset sale only
- if a draft/pre-post sale workflow is implemented, `source_ref_line_id` may be temporarily unresolved only until the final `SALE` transaction reaches `POSTED`; do not persist a posted `SALE` row with `source_ref_line_id = null`
- do not introduce `CARI_DOCUMENT_LINE` as a separate `source_ref_type` in MVP
- manual/internal workflows with no upstream business document may keep `source_ref_type`, `source_ref_id`, and `source_ref_line_id` null
- `journal_source_links` remains the journal drillback contract and continues to use:
  - `FIXED_ASSET_TRANSACTION` for non-depreciation fixed-assets journals
  - `FIXED_ASSET_DEPRECIATION_RUN` for depreciation batch journals

Repo rationale:
- the repo already uses `CARI_DOCUMENT` as the document-scoped source namespace across journal links, evidence, internal comments, ops status, and workbench drillback
- fixed-assets should reuse that repo-native document source type and use `source_ref_line_id` for exact line provenance where needed instead of inventing a new cross-cutting `CARI_DOCUMENT_LINE` contract in MVP

### GL reverse-blocking integration
Lock the repo-native GL reverse-blocking upgrade now so journal reversals stay consistent with fixed-assets state and can route users dynamically to the owning workflow.

Locked decision:
- update `backend/src/routes/gl.write.journal.routes.js`
- treat this work as a shared journal-workbench contract migration, not as a fixed-assets-only route tweak
- replace the current static source-type route-hint model with a resolver-based reverse-block helper
- use `backend/src/services/gl.reverse-block-destination.service.js` as the shared owner for both normal `source_links[].destination` enrichment and reverse-block destination resolution
- land the contract additively: keep the legacy message text and raw `source_links`, add backend-owned metadata, move the frontend to prefer that metadata, and only then rely on fixed-assets dynamic routing without local hardcoded maps
- keep reverse blocking for:
  - `FIXED_ASSET_TRANSACTION`
  - `FIXED_ASSET_DEPRECIATION_RUN`

Resolver rule:
- reverse-block destination resolution must use:
  - `source_ref_type`
  - `source_ref_id`
  - source-record lookup where needed
- do not rely only on one static `source_ref_type -> route` map for fixed-assets source types
- reverse-block admissibility for fixed-assets source types must apply the locked successor-lifecycle blocking rule and any linked-document progression rule before allowing reversal

Required response shape:
- reverse-block responses must continue to return a normal error envelope
- preserve the existing human-readable reverse-block message style during rollout
- the error must include structured `details.reverseBlock` metadata for frontend routing
- `details.reverseBlock` must include at minimum:
  - `isBlocked`
  - `blockingSourceLinks`
  - `primaryDestination`
  - `resolvedDestinations`

Required read-payload preflight shape:
- single-journal detail reads used by Journal Workbench must keep existing `source_links` and other current detail fields; do not replace those fields with a new destination-only shape
- when source-link destinations are resolvable, the journal detail payload should add `source_links[].destination` using the shared backend-owned destination object
- journal detail/read payloads used by Journal Workbench must include a `reverseBlock` metadata object when reversal is source-blocked
- that `reverseBlock` object must include the same routing semantics used by the reverse-block error contract, at minimum:
  - `isBlocked`
  - `blockingSourceLinks`
  - `primaryDestination`
  - `resolvedDestinations`
- this allows Journal Workbench to pre-block reversal using backend-owned destination metadata before submit instead of reconstructing fixed-assets routes locally from `source_links`
- for normal journal source-link drillback, upgraded `source_links` rows should likewise carry a `destination` object that uses the same minimum destination metadata shape where applicable

Read-path performance rule:
- `backend/src/routes/gl.read.journal.routes.js` must resolve `reverseBlock` on the single-journal detail route used by Journal Workbench, not by default on the bulk `/journals` list route
- the bulk journal list endpoint may continue to return raw `source_links` only when `includeSourceLinks=true`
- do not add unconditional per-row reverse-block destination resolution to the journal list path in MVP
- if bulk journal destination or reverse-block enrichment is ever needed later, it must be implemented with an explicit opt-in batched resolver contract rather than reusing detail-route logic row by row

Minimum destination metadata shape:
- `sourceRefType`
- `sourceRefId`
- `route`
- `routeParams` nullable
- `query` nullable
- `label`
- `isFallback`

Resolver migration rule:
- the shared backend destination resolver may continue to serve existing non-fixed-assets source types through backend-owned static mappings where the current route contract is already stable
- fixed-assets source types must resolve dynamically from source rows
- do not require a repo-wide rewrite of every historical source type into dynamic lookup before this contract migration can land
- if destination resolution fails, return the best backend-owned fallback destination that can still be justified by resolved source context and mark it with `isFallback = true`

Primary-destination rule:
- when multiple blocking source links exist, the reverse-block response must return:
  - all resolved destinations in `resolvedDestinations`
  - one `primaryDestination` for direct UI navigation
- `primaryDestination` must be derived by `journal_source_links.link_role = PRIMARY` first
- if no `PRIMARY` source link is present, fall back to stable source-link ordering as a defensive compatibility fallback for legacy or non-upgraded data only
- fixed-assets generated journals must not rely on the no-`PRIMARY` fallback path, because the owning `PRIMARY` source-link rule is DB-backed in this track
- when reversal is blocked because a later fixed-assets successor event exists, `primaryDestination` should prefer the latest blocking successor workflow when it can be resolved, rather than pointing only to the original source row

Fixed-assets dynamic resolver rules:
- `FIXED_ASSET_DEPRECIATION_RUN`
  - resolve to the depreciation-runs workflow
- `FIXED_ASSET_TRANSACTION`
  - inspect the fixed-assets transaction row
  - resolve route by `transaction_type`

Locked destination rules:
- `FIXED_ASSET_DEPRECIATION_RUN`
  - dynamic destination resolves to `/app/demirbas-amortisman-islemleri`
  - include `runId` in query metadata for direct run focus
- `FIXED_ASSET_TRANSACTION`
  - destination is resolved dynamically from `fixed_asset_transactions.transaction_type`
  - `SALE` and `WRITEOFF` target `/app/demirbas-satis-islemleri`
  - `ACQUISITION`, `CAPITALIZATION`, `DEPRECIATION`, `SUSPEND`, `REACTIVATE`, `PHYSICAL_MOVE`, `OWNERSHIP_TRANSFER`, and `REVERSAL` target `/app/demirbas-karti-detayi/:assetId`
  - include transaction-focus query metadata where applicable

Locked deep-link query contract:
- for `FIXED_ASSET_DEPRECIATION_RUN`, use:
  - route: `/app/demirbas-amortisman-islemleri`
  - query: `runId=<runId>`
- for `FIXED_ASSET_TRANSACTION` targeting asset detail, use:
  - route: `/app/demirbas-karti-detayi/:assetId`
  - query: `tab=transactions&transactionId=<transactionId>`
- for `FIXED_ASSET_TRANSACTION` targeting disposals workflow (`SALE` / `WRITEOFF`), use:
  - route: `/app/demirbas-satis-islemleri`
  - query: `transactionId=<transactionId>&assetId=<assetId>`
- do not invent alternative query keys such as `id`, `focusId`, `txId`, or module-local aliases for these reverse-block drillbacks
- backend `primaryDestination.query` / `resolvedDestinations[].query` must use those exact query names when the relevant identifiers exist

Fallback rule:
- if dynamic resolution fails for `FIXED_ASSET_TRANSACTION`, fall back to `/app/demirbas-karti-detayi/:assetId` when `asset_id` can still be resolved
- if no asset-specific destination can be resolved, fall back to `/app/demirbas-karti-listesi`
- if dynamic resolution fails for `FIXED_ASSET_DEPRECIATION_RUN`, fall back to `/app/demirbas-amortisman-islemleri`

Important:
- do not claim subtype-specific routing unless the resolver returns structured destination metadata
- fixed-assets reverse-block behavior is dynamic by source record, not static by source type only

Frontend UI rule:
- `frontend/src/pages/JournalWorkbenchPage.jsx` must move to prefer-backend/fallback-local destination consumption during rollout rather than switching to backend-only metadata in one shot
- normal "Open Source" actions for journal `source_links` must use backend-owned `source_links[].destination` metadata first when present and fall back to the existing local resolver only when that metadata is absent
- when the selected journal read payload includes `reverseBlock`, Journal Workbench must use that backend-owned metadata first for local pre-block checks, reverse-block messaging, and navigation hints before the reverse submit call
- when a reverse-block response includes `details.reverseBlock`, the UI must use that structured metadata first instead of reconstructing destination paths from a static source-type map
- if multiple resolved destinations are returned, the UI should use `primaryDestination` for direct navigation and may expose `resolvedDestinations` for secondary drillback choices
- static local route maps may remain only as compatibility fallback behavior for source types that have not yet been upgraded to structured destination metadata
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx` must consume `tab` and `transactionId`; when `tab=transactions`, the transactions tab becomes active and the matching transaction is loaded/focused/highlighted if present
- `frontend/src/pages/fixedAssets/FixedAssetDepreciationRunsPage.jsx` must consume `runId` and load/focus the matching persisted run when present
- `frontend/src/pages/fixedAssets/FixedAssetDisposalsPage.jsx` must consume `transactionId` and optional `assetId`; it should load/focus the matching disposal transaction and use `assetId` as additional context/filter when present
- fixed-assets reverse-block drillback pages must honor those exact query names so backend and frontend do not diverge into separate deep-link contracts

### Cross-OU transfer accounting strategy
Lock the repo-native cross-OU accounting backbone now.

Locked decision:
- ownership transfer uses the repo's existing OU self-balancing / current-account infrastructure as the primary accounting backbone
- fixed-assets should resolve cross-OU posting support through the same existing foundations already used elsewhere in the repo
- do not introduce a second independent cross-OU accounting model for fixed-assets
- remove `inter_ou_clearing_account_id` from the fixed-asset master in MVP
- cross-OU posting must be resolved from the repo's legal-entity / operating-unit current-account and self-balancing setup, not from an asset-card field
- for CARI-created assets, `owner_operating_unit_id` may differ from `cari_documents.operating_unit_id`
- for FA06, `cari_documents.operating_unit_id` is the source/payer OU on the AP side and `owner_operating_unit_id` is the economic asset owner OU
- when source/payer OU and owner OU are the same, FA06 uses normal same-OU capitalization with no inter-OU self-balancing lines
- when that owner/source-OU mismatch exists, MVP must not silently allow it without accounting treatment
- for that FA06 cross-OU mismatch case, MVP uses one locked direct capitalization template through the repo's existing OU self-balancing / due-to-due-from infrastructure; do not implement same-date FA10-compatible ownership transfer as an alternate FA06 mismatch path in MVP
- the locked FA06 direct cross-OU capitalization journal template is:
  - debit fixed-asset account in the owner OU for the capitalized gross cost
  - credit directional self-balancing `targetDueToAccount` in the owner OU for the same amount
  - debit directional self-balancing `sourceDueFromAccount` in the source/payer OU for the same amount
  - credit AP/vendor or AP-clearing in the source/payer OU for the same amount, following the repo's CARI/AP posting shape
- resolve that directional self-balancing pair by calling `resolveOuSelfBalancingAccountsTx` with the CARI document OU as `sourceOperatingUnitId` and the asset owner OU as `targetOperatingUnitId`
- do not allow cross-OU ownership mismatch with no balancing entry
- if the needed OU self-balancing / current-account setup is unavailable, FA06 must block the capitalization/activation request rather than persisting an unbalanced mismatch
- if a later phase truly needs an explicit override model, it must be introduced as a separate documented plan change

This avoids duplicating two different cross-OU accounting models inside the same repo.

### Department and cost-center strategy
Lock org-classification fields now so the plan does not assume nonexistent shared master-data IDs.

Locked decision:
- do not use `department_id` or `cost_center_id` foreign keys in MVP
- use nullable classification/code fields instead:
  - `department_code`
  - `cost_center_code`
- treat them as reporting and attribution dimensions, not fixed-assets-owned master data
- allow them to flow through register filters, reports, and physical-move history
- do not make them mandatory for `DRAFT` save or activation in MVP

Repo rationale:
- the repo already shows code-style cost-center usage
- the repo does not currently provide shared department/cost-center master tables suitable for fixed-asset foreign keys

### Master-data boundary
Do not introduce broad new cross-repo master-data programs as part of this MVP.

Allowed inside this MVP:
- fixed-asset categories
- fixed-asset depreciation profiles
- lightweight interim custodian setup

Leave larger future master-data expansion unlocked for a separate decision.

## Open Decisions That Stay Explicitly Open

These are not resolved by this MVP plan and must stay visible:

### Source-document reversal behavior
Open question:
- what should the longer-term automation or compensating behavior be if a source CARI document is reversed after it created or activated an asset?

Temporary MVP guard:
- if a posted CARI source document or source line is already linked to an activated asset or to any posted fixed-assets transaction that still depends on that source, CARI-side reversal is blocked until the fixed-assets dependency is resolved through the owning fixed-assets workflow
- MVP does not auto-reverse, auto-dispose, or otherwise auto-unwind fixed-assets state from an upstream CARI reversal

Do not hide the longer-term behavior behind implicit automation.

### Broader master-data rollout
Open question:
- whether broader master-data modules should be designed and implemented separately before any post-MVP fixed-assets expansion

This stays unlocked.

## Repo-Native Implementation Surface

### Backend files to add
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.evidence.routes.js`
- `backend/src/services/fixed-assets.scope.service.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js` if depreciation logic needs separation
- `backend/src/services/fixed-assets.reporting.service.js` if reporting SQL grows large
- `backend/src/services/gl.reverse-block-destination.service.js`
- `backend/src/utils/source-ref-types.js`

Mounting note:
- `backend/src/routes/fixed-assets.routes.js` must mount `fixed-assets.evidence.routes.js` as nested sub-routes for asset, transaction, and depreciation-run evidence surfaces; do not add a separate top-level evidence mount in `backend/src/index.js`
- `backend/src/routes/fixed-assets.routes.js` and `backend/src/routes/fixed-assets.evidence.routes.js` must reuse shared fixed-assets `resolveScope` helpers for asset, transaction, run, and request-scoped legal-entity/owner-OU resolution rather than duplicating ad hoc RBAC resolver SQL per route

Router ordering note:
- `backend/src/routes/fixed-assets.routes.js` must register static and nested-prefixed routes before generic `/:assetId` routes so Express does not swallow them through the asset-id param matcher
- register static route families such as `/categories`, `/depreciation-profiles`, `/custodians`, and `/runs` before `/:assetId`
- register nested-prefixed families such as `/transactions/:transactionId/...` and `/runs/:runId/...` before `/:assetId`
- register evidence mounts in safe grouped order so `/transactions/:transactionId/evidence` and `/runs/:runId/evidence` are declared before `/:assetId/evidence`, and all of those are declared before a plain `/:assetId` detail/update/action route block
- do not rely on validator failures or ID parsing to protect swallowed routes; route declaration order must make the intended match unambiguous

### Backend files to update
- `backend/src/index.js`
- `backend/src/middleware/rbac.js` to add a secondary permission-assertion helper that does not replace `req.rbac`
- `backend/src/migrations/index.js`
- `backend/src/services/evidence.service.js`
- `backend/src/routes/_utils.js` to extend `badRequest(message, details = null)` in a backward-compatible way
- `backend/src/routes/gl.read.journal.routes.js`
- `backend/src/routes/gl.write.journal.routes.js`
- fixed-assets posting services that call `backend/src/services/journal.source-link.service.js` must pass shared source-type constants from `backend/src/utils/source-ref-types.js` instead of raw literals
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/src/seedCore.js` to extend the existing fixed-assets permission family with `fixed_assets.account_override` and update seeded role bundles so `TenantAdmin` inherits it through full-catalog seeding, `CountryController` and `EntityAccountant` receive it explicitly, and `GroupController`, `BranchOperator`, and `AuditorReadOnly` do not

### Frontend files to add/update
Most fixed-assets frontend files in this list already exist as scaffolds. Treat them as verify/update surfaces unless a real missing page is discovered.

- `frontend/src/utils/sourceRefTypes.js`
- `frontend/src/utils/journalSourceLinkDestinations.js` if Journal Workbench drillback/reverse-block destination logic is extracted for reuse outside the page
- `frontend/src/pages/fixedAssets/FixedAssetsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetFormPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetAcquisitionsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetDisposalsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetDepreciationRunsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetReportsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetSettingsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetCustodiansPage.jsx`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- expand `frontend/src/api/fixedAssets.js` for reversal actions, report `/export` calls, and deep-link-supporting reads such as run detail and transaction-focus loading
- verify/update `frontend/src/App.jsx` if route cleanup, redirects, or canonical demirbas path normalization is needed
- verify/update `frontend/src/layouts/AppLayout.jsx` if shared demirbas navigation chrome or icon heuristics need cleanup
- verify/update `frontend/src/layouts/sidebarConfig.js` if sidebar visibility or route normalization changes are needed
- verify/update `frontend/src/i18n/messages.js` if fixed-assets labels, aliases, or route text need cleanup

Frontend helper ownership note:
- `frontend/src/utils/sourceRefTypes.js` owns shared source-type constants only
- if reusable Journal Workbench destination selection or deep-link normalization logic is extracted from `frontend/src/pages/JournalWorkbenchPage.jsx`, it should live in `frontend/src/utils/journalSourceLinkDestinations.js`
- keep that extracted frontend helper focused on consuming backend-owned destination metadata and fallback selection; do not re-embed fixed-assets route ownership rules only inside the page component
- `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx` is a shared fixed-assets wrapper dependency; frontend steps that replace scaffold shells or shared page framing must either include it in `Allowed files` or explicitly state that it must remain untouched
- `frontend/src/layouts/AppLayout.jsx` is shared app chrome rather than a fixed-assets feature page, but it already contains demirbas icon heuristics; if fixed-assets navigation naming changes, update it intentionally rather than leaving it as an implicit side effect

## Canonical UI Route Set

Use the repo's existing Turkish route style.

Canonical routes:
- `/app/demirbas-karti-listesi`
- `/app/demirbas-karti-olustur`
- `/app/demirbas-karti-detayi/:assetId`
- `/app/demirbas-alim-islemleri`
- `/app/demirbas-satis-islemleri`
- `/app/demirbas-amortisman-islemleri`
- `/app/demirbas-raporu`
- `/app/ayarlar/demirbas-ayarlari`
- `/app/ayarlar/demirbas-zimmetlileri`

Implementation notes:
- delete the old generic placeholder usage for demirbas routes
- the old `/app/demirbas-amortisman-ayarlar` placeholder should not remain the canonical route
- the repo also still carries legacy alias `/app/demirbaslar`; keep it only as an explicit compatibility alias or retire it explicitly with redirects/cleanup
- `frontend/src/layouts/AppLayout.jsx` already recognizes demirbas/asset/amortisman in shared icon heuristics; keep that app chrome aligned when route names or aliases are normalized
- route aliases or redirects are acceptable for backward compatibility
- `/app/demirbas-karti-detayi/:assetId` is a canonical workflow/detail route even if it is not a primary sidebar destination
- dynamic reverse-block routing may target canonical list/workflow/detail routes, not only sidebar landing pages

## Master Tracker
- [x] `STEP-FA01` - Shared source-ref constants, error-details helper, and secondary RBAC assertion
- [x] `STEP-FA02` - Journal-source-link duplicate-`PRIMARY` preflight and normalization plan
- [x] `STEP-FA03` - Shared-platform journal-link writer compliance for CARI, cash, and payments
- [x] `STEP-FA04` - Shared-platform journal-link writer compliance for inventory and payroll
- [x] `STEP-FA05` - Repo-wide journal-link `PRIMARY` regression coverage and release gate
- [x] `STEP-FA06` - Backend reverse-block destination contract and additive journal-detail enrichment
- [x] `STEP-FA07` - Frontend Journal Workbench prefer-backend / fallback-local contract migration
- [x] `STEP-FA08` - OpenAPI fixed-assets tag and path inference support
- [x] `STEP-FA09` - `m138` fixed-assets foundation base tables
- [x] `STEP-FA10` - `m138` fixed-assets foundation constraints and indexes
- [x] `STEP-FA11` - `m139` custodian employees and deferred foreign keys
- [x] `STEP-FA12` - `m140` CARI traceability and `journal_source_links` schema tail
- [x] `STEP-FA13` - Fixed-assets module skeleton, scope service, route mount, and route ordering
- [x] `STEP-FA14` - Categories CRUD and default-rule backend surface
- [x] `STEP-FA15` - Depreciation profiles CRUD and snapshot-default backend surface
- [x] `STEP-FA16` - Custodian maintenance and fixed-assets settings UI/API integration
- [x] `STEP-FA17` - Asset register backend read surface and filter contract
- [x] `STEP-FA18` - Asset detail backend read surface with tabs/foundations
- [x] `STEP-FA19` - Fixed-assets list/detail frontend pages and API integration
- [x] `STEP-FA20` - Manual asset draft create/read/update foundation
- [x] `STEP-FA21` - Manual activation standard path
- [x] `STEP-FA22` - Manual legacy-onboarding activation path
- [x] `STEP-FA23` - Manual low-value same-period full-expense activation path
- [x] `STEP-FA24` - FA06 eligible AP-line read surface and remaining-unit calculation
- [x] `STEP-FA25` - FA06 same-OU capitalization create/activate flow
- [x] `STEP-FA26` - FA06 cross-OU capitalization accounting template and blocking rules
- [x] `STEP-FA27` - FA06 draft-link revalidation, source drift refresh, and activation-time safeguards
- [x] `STEP-FA28` - Schedule engine period resolution, read surface, and standard straight-line/none math
- [x] `STEP-FA29` - Declining-balance math, salvage-floor enforcement, and legacy-onboarding forward schedule path
- [x] `STEP-FA30` - Lifecycle cutoff eligibility for suspension, reactivation, transfer, and disposal in schedule generation
- [x] `STEP-FA31` - Depreciation run preview and persisted draft creation
- [x] `STEP-FA32` - Depreciation run detail read and draft delete lifecycle
- [x] `STEP-FA33` - Depreciation run post workflow
- [x] `STEP-FA34` - Depreciation run reverse workflow
- [x] `STEP-FA35` - Depreciation run chunked persistence and volume safety hardening
- [x] `STEP-FA36` - Physical move workflow
- [x] `STEP-FA37` - Ownership transfer workflow and accounting
- [ ] `STEP-FA38` - Write-off workflow
- [ ] `STEP-FA39` - Sale staged draft/link/update workflow
- [ ] `STEP-FA40` - Sale finalize workflow
- [ ] `STEP-FA41` - Source-owned non-run reversal workflow
- [ ] `STEP-FA42` - Fixed-assets evidence service extension and nested evidence routes
- [ ] `STEP-FA43` - Fixed-assets journal source-link writing and backend destination resolution support
- [ ] `STEP-FA44` - Fixed-assets deep-link pages, Journal Workbench drillback, and query-contract completion
- [ ] `STEP-FA45` - Fixed-assets permission seeding and backend authorization hardening
- [ ] `STEP-FA46` - Frontend sidebar, route, and action gating
- [ ] `STEP-FA47` - Fixed-assets reports and paired export endpoints
- [ ] `STEP-FA48` - Release gates, smoke suite, and rollout readiness checks

---

## `STEP-FA01` - Shared source-ref constants, error-details helper, and secondary RBAC assertion

### Patch target
Land only the shared backend/frontend primitives that later fixed-assets, evidence, and reverse-block work depend on.

### Definition of done
- `backend/src/utils/source-ref-types.js` exists and owns the canonical fixed-assets source-ref constants
- `frontend/src/utils/sourceRefTypes.js` exists for shared frontend source-type consumption
- `backend/src/routes/_utils.js` supports `badRequest(message, details = null)` in a backward-compatible way
- `backend/src/middleware/rbac.js` exposes a secondary permission-assertion helper that does not replace `req.rbac`
- no fixed-assets workflow route/page behavior is required in this step

---

## `STEP-FA02` - Journal-source-link duplicate-`PRIMARY` preflight and normalization plan

### Patch target
Prepare the repo for DB-backed one-`PRIMARY`-per-journal enforcement by discovering real duplicate states and defining deterministic normalization behavior before any writer code or DDL is changed.

### In scope
- inspect current `journal_source_links` data shape
- add a repo-native preflight script or migration-preflight utility that reports duplicate `PRIMARY` rows by `journal_entry_id`
- define deterministic normalization rules for legacy rows that currently violate one-`PRIMARY`-per-journal
- identify journals with multiple `PRIMARY` links, no `PRIMARY` link, and mixed shared-journal flows that currently appear to rely on multiple owning links
- record which existing modules write those rows

### Explicit non-goals
- do not add the DB uniqueness guard yet
- do not change writer workflows yet
- do not silently mutate production data in this step unless the repo already has an accepted migration-preflight write pattern
- do not assume fixed-assets is the only module affected

### Definition of done
- a repeatable preflight surface exists that identifies all current duplicate-`PRIMARY` journals
- the output is grouped by producer/workflow where possible
- the repo now has a deterministic normalization rule for legacy duplicate cases, including how to choose the surviving `PRIMARY`, how to demote non-owning links, and how to handle journals with no `PRIMARY`
- the step documents which existing modules must be updated before the DB guard is safe
- this step leaves runtime behavior unchanged

### Smoke tests
- run the preflight against a seeded/local database with one journal with exactly one `PRIMARY`, one journal with two `PRIMARY` rows, and one journal with zero `PRIMARY` rows
- verify the preflight reports the valid case as clean, the duplicate case as blocking, and the zero-`PRIMARY` case as a compatibility warning or remediation case
- verify repeated runs produce stable output ordering
- verify the script/report can run without fixed-assets tables existing yet

### Acceptance
- there is now a real inventory of duplicate-`PRIMARY` risk in the current repo
- normalization is defined before enforcement
- this step reduces hidden migration risk without changing app behavior
- later steps no longer need to guess how to remediate legacy shared-journal data

---

## `STEP-FA03` - Shared-platform journal-link writer compliance for CARI, cash, and payments

### Patch target
Bring the highest-risk existing writer flows into compliance with the future one-`PRIMARY`-per-journal invariant.

### In scope
- audit and update current journal-link writers for CARI, cash, and payments
- identify shared-journal flows in those modules that currently attach multiple links
- make those flows write exactly one owning `PRIMARY` and all additional links with non-primary roles
- preserve current drillback semantics where possible
- update any helper code in those modules that currently assumes multiple `PRIMARY` links are acceptable

### Explicit non-goals
- do not add the DB uniqueness guard yet
- do not update inventory or payroll in this step
- do not add fixed-assets source links yet
- do not change Journal Workbench routing contracts here

### Definition of done
- all in-scope CARI, cash, and payments flows that write `journal_source_links` are reviewed
- any shared-journal flow in those modules now emits at most one `PRIMARY`
- non-owning links are intentionally demoted to non-primary roles
- the chosen owning `PRIMARY` matches the business event that should drive reverse-block primary routing later
- existing journal posting/reversal flows continue to succeed

### Smoke tests
- for each updated flow, create a journal through the real service path and assert `journal_source_links` rows are created, exactly one row has `link_role = PRIMARY`, and additional rows, if any, are not `PRIMARY`
- re-run the flow twice where the module supports idempotent/retry-safe behavior and verify no accidental duplicate ownership appears
- open the created journal in the current GL detail read and verify source links still load
- reverse or attempt reverse on affected journals where current repo behavior allows it and verify no regression in baseline error handling

### Acceptance
- CARI, cash, and payments no longer rely on multiple `PRIMARY` rows
- shared-journal ownership is now intentional, not accidental
- this step materially lowers the blast radius of the future DB guard
- in-scope posting/reversal behavior remains functional

---

## `STEP-FA04` - Shared-platform journal-link writer compliance for inventory and payroll

### Patch target
Finish repo-wide writer compliance for the remaining known journal-link producers before DB-backed enforcement lands.

### In scope
- audit and update current journal-link writers for inventory and payroll
- identify shared-journal flows that may currently produce multiple owning links
- apply the same ownership/demotion discipline as `STEP-FA03`
- verify that downstream read/reversal flows still behave correctly after writer cleanup

### Explicit non-goals
- do not add the DB uniqueness guard yet
- do not modify fixed-assets writers yet
- do not redesign source-link roles repo-wide beyond what is required for one-owning-link discipline

### Definition of done
- inventory and payroll writer flows are brought into compliance
- those flows emit exactly one owning `PRIMARY` when they attach multiple source links to one journal
- compatibility with existing read and reverse flows remains intact
- the repo no longer has known active writer paths that would violate the planned DB guard under normal operation

### Smoke tests
- create representative inventory journals and payroll journals through the real service flows
- assert source links exist, exactly one `PRIMARY` exists per journal, and secondary links remain attached where needed
- confirm journal detail read still exposes source links
- attempt baseline reverse behavior on in-scope journals and verify there is no immediate regression
- run the duplicate-`PRIMARY` preflight again and confirm new in-scope writes no longer create violations

### Acceptance
- inventory and payroll are aligned with the future ownership rule
- all currently known non-fixed-assets writer modules are compliant before DB enforcement
- future one-`PRIMARY` DDL can be treated as enforcement, not discovery

---

## `STEP-FA05` - Repo-wide journal-link `PRIMARY` regression coverage and release gate

### Patch target
Lock the repo into one-owning-link discipline with regression coverage before the DB guard is enabled later in the migration track.

### In scope
- add regression coverage for the in-scope existing writers cleaned up in `STEP-FA03` and `STEP-FA04`
- add a release-gate check that fails if a known shared-journal flow starts emitting more than one `PRIMARY`
- document the writer contract clearly: one owning `PRIMARY`, secondary links must use non-primary roles
- make this part of the fixed-assets prerequisite chain

### Explicit non-goals
- do not add the DB uniqueness DDL yet
- do not add fixed-assets writers yet
- do not widen the gate into unrelated data-quality areas

### Definition of done
- automated regression coverage exists for current known source-link producers
- a repeatable check exists that would catch reintroduction of duplicate `PRIMARY` behavior
- the fixed-assets plan can now safely sequence the schema-side one-`PRIMARY` enforcement in `STEP-FA12`

### Smoke tests
- run the in-scope posting flows under test and verify the assertions fail if a second `PRIMARY` is intentionally injected in a local test fixture
- run the preflight after the test suite and confirm no unexpected duplicate-`PRIMARY` rows remain
- verify the release-gate or smoke command exits non-zero when the contract is violated

### Acceptance
- one-owning-link behavior is now protected, not just discussed
- the later DB guard has meaningful regression backing
- repo-wide writer cleanup is complete enough to justify schema enforcement later

---

## `STEP-FA06` - Backend reverse-block destination contract and additive journal-detail enrichment

### Patch target
Land the backend-owned destination contract for normal drillback and reverse blocking without breaking existing clients.

### Definition of done
- `backend/src/services/gl.reverse-block-destination.service.js` owns destination resolution
- reverse errors keep the legacy human-readable message while adding `details.reverseBlock`
- single-journal detail reads add `source_links[].destination` and `reverseBlock` additively
- raw `source_links` remain intact for compatibility
- the bulk `/journals` list path does not gain unconditional per-row reverse-block enrichment

---

## `STEP-FA07` - Frontend Journal Workbench prefer-backend / fallback-local contract migration

### Patch target
Move Journal Workbench to consume backend-owned destination metadata first while preserving compatibility with non-upgraded source types.

### Definition of done
- `frontend/src/pages/JournalWorkbenchPage.jsx` prefers backend-owned `source_links[].destination` for normal drillback
- the page prefers backend-owned `reverseBlock` / `details.reverseBlock` metadata for pre-block and submit-error handling
- local static route maps remain only as fallback behavior where metadata is absent
- any extracted destination-consumption helper lives in `frontend/src/utils/journalSourceLinkDestinations.js`
- no fixed-assets-specific hardcoded route map remains required for the upgraded paths

---

## `STEP-FA08` - OpenAPI fixed-assets tag and path inference support

### Patch target
Make fixed-assets a first-class OpenAPI surface before backend routes are treated as complete.

### Definition of done
- `backend/scripts/generate-openapi.js` knows the `FixedAssets` tag
- `/api/v1/fixed-assets` paths do not fall through to `System`
- fixed-assets route/schema definitions are added to the generator
- `backend/openapi.yaml` is regenerated cleanly
- `openapi:generate` and `check:openapi` remain usable

---

## `STEP-FA09` - `m138` fixed-assets foundation base tables

### Patch target
Create only the dependency-safe base tables and base columns for the fixed-assets foundation.

### Definition of done
- `m138_fixed_assets_foundation.js` creates the FA01 core tables in dependency-safe base-table order
- custodian references remain nullable columns only in this step
- forward/circular intra-`m138` foreign keys are not added inline in this step
- the base schema includes the locked asset, transaction, schedule, run, allocation, move-detail, and transfer-detail columns
- this step does not yet finish the constraint/index pass

---

## `STEP-FA10` - `m138` fixed-assets foundation constraints and indexes

### Patch target
Finish the `m138` constraint/index pass without reopening the base-table scope.

### Definition of done
- dependency-safe intra-`m138` foreign keys are added via `ALTER TABLE`
- core uniqueness rules and reporting indexes from `FA01` are in place
- MySQL-realistic strategies are used for persisted-`DRAFT` run uniqueness and current-effective asset-period depreciation uniqueness
- reversal-lineage and one-detail-row-per-transaction guards are in place where locked by `FA01`
- this step does not introduce the deferred custodian-table foreign keys or the `m140` traceability tail

---

## `STEP-FA11` - `m139` custodian employees and deferred foreign keys

### Patch target
Deliver the interim custodian table and then attach the deferred custodian foreign keys.

### Definition of done
- `m139_fixed_asset_custodian_employees.js` creates `fixed_asset_custodian_employees`
- deferred foreign keys for `fixed_assets.custodian_employee_id` and physical-move custodian refs are added only after the table exists
- custodian status and minimum maintenance fields follow the locked MVP shape
- this step covers the schema side of `FA02`, not the full UI/workflow surface

---

## `STEP-FA12` - `m140` CARI traceability and `journal_source_links` schema tail

### Patch target
Finish the remaining schema hardening that fixed-assets needs for CARI-linked traceability and safe source ownership.

### Definition of done
- `m140_fixed_asset_cari_capitalization_and_traceability.js` lands the exact source-traceability fields and unit-slot enforcement needed for FA06
- the schema side of one-`PRIMARY`-per-journal hardening lands only after `STEP-FA02` to `STEP-FA05` are complete
- `m140` does not pretend to own the repo-wide writer cleanup; it only lands the DB tail of that shared-platform rollout
- fixed-assets source-line provenance and multi-asset-per-line uniqueness are DB-backed after this step

---

## `STEP-FA13` - Fixed-assets module skeleton, scope service, route mount, and route ordering

### Patch target
Create the repo-native backend fixed-assets module shell so later feature slices land into stable owning files.

### Definition of done
- `backend/src/routes/fixed-assets.routes.js`, validators, and service shells exist
- `backend/src/services/fixed-assets.scope.service.js` owns the shared fixed-assets scope resolvers
- `backend/src/index.js` mounts `/api/v1/fixed-assets` with repo-native ESM style
- route declaration order protects static and nested-prefixed routes from `/:assetId` swallowing
- this step provides the module skeleton and routing contract, not the full business behavior

---

## `STEP-FA14` - Categories CRUD and default-rule backend surface

### Patch target
Implement fixed-assets category CRUD with the locked threshold, salvage-default, and account-default semantics before frontend settings pages or asset workflows depend on it.

### In scope
- category schema consumption through backend routes, validators, and services
- `GET /api/v1/fixed-assets/categories`
- `POST /api/v1/fixed-assets/categories`
- `PATCH /api/v1/fixed-assets/categories/:categoryId`
- category default fields:
  - `capitalization_threshold_base`
  - `default_useful_life_months`
  - `default_salvage_rule_type`
  - `default_salvage_percent`
  - `default_salvage_amount_base`
  - `default_depreciation_profile_id`
  - `default_asset_account_id`
  - `default_accum_depr_account_id`
  - `default_depr_expense_account_id`
  - `default_disposal_gain_account_id`
  - `default_disposal_loss_account_id`
- code uniqueness within `(tenant_id, legal_entity_id)`
- status handling with uppercase repo-native values
- validator/service enforcement of:
  - legal-entity ownership through `charts_of_accounts`
  - expected account types
  - locked salvage rule types

### Explicit non-goals
- do not implement depreciation profile CRUD in this step
- do not implement frontend settings pages in this step
- do not implement asset create/edit behavior here
- do not apply category defaults automatically to assets yet beyond what later steps consume
- do not treat `name` as DB-unique

### Definition of done
- categories can be listed, created, and updated
- category codes are unique per `(tenant_id, legal_entity_id)`
- account-default fields validate:
  - `asset_account_id` as `ASSET`
  - `accum_depr_account_id` as `ASSET`
  - `depr_expense_account_id` as `EXPENSE`
  - `disposal_gain_account_id` as `REVENUE`
  - `disposal_loss_account_id` as `EXPENSE`
- those account ids must belong to a chart of accounts with `scope = LEGAL_ENTITY` and matching `legal_entity_id`
- salvage defaults accept only:
  - `NONE`
  - `FIXED_BASE_AMOUNT`
  - `PERCENT_OF_COST`
- threshold/default values persist without needing any asset workflow yet

### Smoke tests
- create a category with valid code, legal entity, threshold, salvage defaults, and valid account defaults; verify it persists
- create a second category with the same `code` in the same legal entity and verify rejection
- create a category with the same `code` in a different legal entity and verify it is allowed if the repo’s tenancy/legal-entity scope permits it
- attempt to assign an `EXPENSE` account as `default_asset_account_id` and verify rejection
- attempt to assign an account from a different legal entity’s chart and verify rejection
- attempt to persist an invalid salvage rule type and verify rejection
- list categories and verify returned rows include the locked default fields

### Acceptance
- category defaults are concrete and enforce the locked accounting/salvage rules
- category uniqueness is code-first, not name-first
- backend category behavior is real and stable before assets depend on it

---

## `STEP-FA15` - Depreciation profiles CRUD and snapshot-default backend surface

### Patch target
Implement depreciation profile CRUD with the locked method/rate/switch semantics before activation and schedule generation consume profile snapshots.

### In scope
- `GET /api/v1/fixed-assets/depreciation-profiles`
- `POST /api/v1/fixed-assets/depreciation-profiles`
- `PATCH /api/v1/fixed-assets/depreciation-profiles/:profileId`
- profile fields:
  - `code`
  - `name`
  - `status`
  - `method`
  - `declining_balance_rate_percent`
  - `switch_to_straight_line`
  - `description`
- code uniqueness within `(tenant_id, legal_entity_id)`
- profile method validation:
  - `STRAIGHT_LINE`
  - `DECLINING_BALANCE`
  - `NONE`
- method/rate compatibility validation

### Explicit non-goals
- do not implement category CRUD here
- do not implement asset activation here
- do not implement schedule generation here
- do not implement draft asset snapshot refresh behavior here beyond exposing the backend data needed later

### Definition of done
- profiles can be listed, created, and updated
- profile codes are unique within `(tenant_id, legal_entity_id)`
- when `method = DECLINING_BALANCE`, `declining_balance_rate_percent` is required
- when `method <> DECLINING_BALANCE`, `declining_balance_rate_percent` must be null
- `switch_to_straight_line` persists as the locked permanent-switch flag
- profiles are clearly setup templates, not live behavior records for activated assets

### Smoke tests
- create a valid `STRAIGHT_LINE` profile and verify persistence
- create a valid `DECLINING_BALANCE` profile with an annual rate and verify persistence
- attempt to create a `DECLINING_BALANCE` profile without a rate and verify rejection
- attempt to create a `STRAIGHT_LINE` or `NONE` profile with a non-null declining-balance rate and verify rejection
- create two profiles with the same code in one legal entity and verify rejection
- list profiles and verify returned rows include method/rate/switch fields

### Acceptance
- profile setup is concrete and enforceable
- later activation/schedule work can safely snapshot from these profiles
- profile rules are backend-owned, not just frontend conventions

---

## `STEP-FA16` - Custodian maintenance and fixed-assets settings UI/API integration

### Patch target
Connect categories, depreciation profiles, and custodians into real settings maintenance surfaces so fixed-assets no longer depends on placeholder settings UI.

### In scope
- `GET /api/v1/fixed-assets/custodians`
- `POST /api/v1/fixed-assets/custodians`
- `PATCH /api/v1/fixed-assets/custodians/:custodianId`
- frontend settings pages/API helper integration for:
  - categories
  - depreciation profiles
  - custodians
- fixed-assets settings page(s) and custodian page(s)
- status handling and minimum maintenance fields for custodians
- page-level permission gating for:
  - `fixed_assets.settings.read`
  - `fixed_assets.settings.upsert`
  - `fixed_assets.custodian.read`
  - `fixed_assets.custodian.write`

### Explicit non-goals
- do not implement asset workflows here
- do not implement schedule/run logic here
- do not implement report pages here
- do not change the backend rules already locked in `STEP-FA14` and `STEP-FA15`

### Definition of done
- custodians can be listed, created, and updated
- custodian maintenance supports:
  - `employee_code`
  - `display_name`
  - `operating_unit_id`
  - `status`
  - `notes`
- frontend settings surfaces are no longer placeholder-only
- frontend API helpers cover categories, profiles, and custodians
- settings pages respect backend permission design

### Smoke tests
- create a custodian and verify it appears in list/read surfaces
- update a custodian’s status and verify persistence
- open the settings page and verify categories/profiles/custodians are backed by real API calls, not shell content
- verify users missing settings permissions cannot access edit actions
- verify a user with read but not write permission can view but not save settings/custodian changes

### Acceptance
- settings/master-data surfaces are now real and usable
- custodians are maintainable at the interim MVP level
- frontend settings scaffolds are replaced with functioning pages

---

## `STEP-FA17` - Asset register backend read surface and filter contract

### Patch target
Implement the backend read/list contract for the asset register with the full locked filter set before detail tabs or frontend register UI are finalized.

### In scope
- `GET /api/v1/fixed-assets`
- locked register filters:
  - legal entity
  - owner operating unit
  - location operating unit
  - category
  - status
  - acquisition date range
  - in-service date range
  - department code
  - cost center code
  - custodian
  - disposed yes/no
- register row shape sufficient for list pages
- distinct exposure of:
  - owner OU
  - location OU
  - custodian
  - status
  - category
  - acquisition/in-service dates
  - cost/nbv summary fields where appropriate

### Explicit non-goals
- do not implement the detail page yet
- do not implement mutation flows here
- do not implement reports here
- do not assume department/cost-center lookup master tables exist

### Definition of done
- backend list endpoint exists with the locked filter semantics
- nullable `department_code` and `cost_center_code` are treated as simple classification values
- disposed filtering works off the asset’s lifecycle state/disposal state rather than a vague heuristic
- owner OU and location OU remain separate read fields, not a collapsed “operating unit”

### Smoke tests
- seed assets across multiple legal entities, owner OUs, location OUs, categories, statuses, and custodians; verify filters return correct subsets
- verify `disposed=true/false` changes the result set correctly
- verify `department_code` and `cost_center_code` filters work on stored nullable code fields
- verify owner-OU and location-OU filters behave independently
- verify date range filters work for acquisition and in-service dates separately

### Acceptance
- the asset register has a stable backend contract
- the locked list-filter set is implemented and testable
- the repo no longer needs to guess at register filter semantics later

---

## `STEP-FA18` - Asset detail backend read surface with tabs/foundations

### Patch target
Implement the backend detail read contract for the asset detail hub before the frontend detail page and later workflows depend on it.

### In scope
- `GET /api/v1/fixed-assets/:assetId`
- backend detail payload foundations for:
  - overview
  - accounting
  - depreciation schedule foundation
  - transactions foundation
  - evidence foundation
  - audit trail foundation
- detail exposure of:
  - source CARI linkage fields
  - profile linkage and snapped profile fields
  - salvage snapshot inputs and resolved salvage values
  - account mappings
  - lifecycle status
  - owner OU / location OU / custodian separation
  - transaction history summary
  - evidence summary
  - audit-trail summary

### Explicit non-goals
- do not implement schedule endpoint here if it is a separate endpoint
- do not implement transaction-list endpoint here if it is a separate endpoint
- do not implement deep-link focus behavior in the frontend here
- do not implement mutation actions

### Definition of done
- asset detail read exists and exposes the traceability hub data required by later steps
- detail payload can support the intended tabs without needing ad hoc follow-up queries for basic identity/configuration context
- detail shows both lineage and frozen runtime behavior:
  - `depreciation_profile_id`
  - snapped method/rate/switch
  - salvage snapshot inputs
  - resolved salvage values

### Smoke tests
- fetch an asset detail and verify owner OU, location OU, and custodian are distinct
- fetch an asset detail and verify source CARI linkage fields are present when applicable, profile linkage and snapped profile fields are both present, salvage snapshot inputs and resolved salvage values are both present, and account mappings are present
- fetch a legacy-onboarding asset and verify legacy fields are exposed appropriately
- fetch a low-value fully expensed asset and verify status/traceability remain readable

### Acceptance
- asset detail is now a real backend hub, not a placeholder
- lineage versus frozen runtime fields are explicit and inspectable
- later UI and workflow steps have a stable detail contract

---

## `STEP-FA19` - Fixed-assets list/detail frontend pages and API integration

### Patch target
Replace placeholder list/detail UI with real fixed-assets register/detail pages that consume the backend read contracts from `STEP-FA17` and `STEP-FA18`.

### In scope
- `frontend/src/pages/fixedAssets/FixedAssetsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`
- `frontend/src/api/fixedAssets.js` list/detail helper expansion
- register filters in the frontend
- detail tab structure for:
  - overview
  - accounting
  - depreciation schedule foundation
  - transactions foundation
  - evidence foundation
  - audit trail foundation
- canonical route usage for:
  - `/app/demirbas-karti-listesi`
  - `/app/demirbas-karti-detayi/:assetId`

### Explicit non-goals
- do not implement activation/move/transfer/disposal actions here
- do not implement deep-link query focus behavior yet if that is handled later in drillback completion
- do not leave generic placeholder shells in place for list/detail

### Definition of done
- register page is a functioning list page using the real backend filters
- detail page is a functioning detail hub using the real backend payload
- list/detail pages are no longer generic placeholder content
- UI clearly distinguishes owner OU, location OU, and custodian
- detail UI exposes both profile lineage and frozen runtime depreciation/salvage behavior

### Smoke tests
- open the register page and verify list rows load from API
- apply each major filter and verify the UI result set changes correctly
- open detail for an asset and verify each planned tab foundation renders real data
- verify profile linkage plus snapped fields are visible together
- verify salvage snapshot inputs and resolved values are visible together
- verify placeholder copy/shell components are no longer the primary list/detail experience

### Acceptance
- fixed-assets read-side UI is now real
- list/detail pages are suitable foundations for later workflows
- the module no longer depends on placeholder list/detail behavior

---

## `STEP-FA20` - Manual asset draft create/read/update foundation

### Patch target
Deliver the manual asset draft lifecycle before activation logic is introduced.

### In scope
- `POST /api/v1/fixed-assets`
- `GET /api/v1/fixed-assets/:assetId`
- `PATCH /api/v1/fixed-assets/:assetId` for allowed `DRAFT`-state edits
- asset-number reservation and creation-time numbering inside one transaction
- asset detail/read support for manual drafts
- draft-side prefill/default logic from category/profile where applicable
- `DRAFT`-state mutability rules only

### Explicit non-goals
- do not implement activation yet
- do not implement legacy-onboarding activation yet
- do not implement low-value posting yet
- do not implement CARI capitalization yet
- do not allow post-activation edits

### Definition of done
- manual draft assets can be created
- backend assigns `sequence_no` and `asset_no` with locked `FA-######` format
- draft rows persist the required `DRAFT`-allowed fields
- `PATCH` allows only fields that are editable while status is `DRAFT`
- category/profile/default data may populate draft-side values, including salvage defaults and profile snapshots, but no activation happens in this step
- detail reads clearly expose asset status, profile linkage and snapped profile fields, salvage snapshot inputs and resolved salvage values, and owner OU vs location OU distinction

### Smoke tests
- create a draft manual asset with the minimum required `DRAFT` fields and verify status is `DRAFT`, `asset_no` is assigned, and `sequence_no` is assigned
- create two draft assets in the same legal entity and verify numbering increments
- create one draft in a different legal entity and verify uniqueness still holds within the locked scope
- patch a draft asset and verify allowed draft fields update
- attempt to patch a non-draft-only field after simulating non-`DRAFT` status and verify the request is rejected or the mutation path is blocked
- verify `GET /:assetId` returns the snapped profile/salvage fields and distinct OU fields

### Acceptance
- manual draft assets exist as real records, not placeholder UI state
- numbering is backend-owned and transaction-safe
- draft mutability is explicit and constrained
- read-side detail already exposes the frozen-field concepts needed later

---

## `STEP-FA21` - Manual activation standard path

### Patch target
Implement activation for normal manual assets that are not legacy-onboarding imports and are not below-threshold low-value exceptions.

### In scope
- `POST /api/v1/fixed-assets/:assetId/activate` for standard manual assets
- activation-time validation matrix for normal depreciable/manual assets
- activation-time book, fiscal period, and posting-date validation
- creation of the `ACQUISITION` transaction row
- transition from `DRAFT` to the correct active lifecycle state for normal assets
- freeze of profile snapshot fields, salvage snapshot inputs, resolved salvage values, mapped accounts, and source linkage mutability

### Explicit non-goals
- do not implement legacy-onboarding special logic in this step
- do not implement low-value same-period full-expense in this step
- do not implement CARI-linked activation in this step
- do not implement schedule generation beyond what is strictly required to support activation if that is split to `STEP-FA28` to `STEP-FA30`

### Definition of done
- standard manual activation validates all required activation-time fields
- the workflow rejects invalid combinations such as missing capitalization or in-service date, in-service before acquisition, missing profile/life for normal depreciable assets, and invalid salvage or account mappings
- activation creates one `ACQUISITION` transaction row
- activation does not create `CAPITALIZATION`
- activated assets can no longer be freely edited in draft-style ways
- the whole workflow runs inside one `withTransaction(...)` boundary

### Smoke tests
- activate a valid manual draft asset and verify status changes from `DRAFT`, one `ACQUISITION` transaction exists, no `CAPITALIZATION` transaction exists, and frozen profile and salvage fields remain persisted
- attempt activation with missing required activation fields and verify rejection
- attempt activation with invalid account types and verify rejection
- attempt to patch frozen accounting/depreciation fields after activation and verify rejection
- verify no partial mutation remains if activation fails midway

### Acceptance
- normal manual activation works end to end
- it produces one auditable acquisition lifecycle event
- activation-time validation is real, not UI-only
- freeze semantics are enforced at the backend

---

## `STEP-FA22` - Manual legacy-onboarding activation path

### Patch target
Implement the go-live/manual legacy-onboarding activation path without double-booking current-period acquisition accounting.

### In scope
- activation of manually created assets with legacy onboarding fields
- validation of legacy accumulated depreciation, legacy NBV, remaining useful life, and salvage floor compatibility
- creation of one onboarding `ACQUISITION` transaction row with no new acquisition journal
- correct post-activation status for remaining depreciable amount exists and already fully depreciated at onboarding

### Explicit non-goals
- do not implement low-value same-period full-expense for non-legacy assets here
- do not implement CARI-linked legacy onboarding because that is out of scope
- do not backfill historical schedules

### Definition of done
- manual legacy-onboarding assets can be activated only while they are manual and `DRAFT`
- validation enforces `legacy_accum_depr <= original_cost`, `legacy_nbv = original_cost - legacy_accum_depr`, legacy NBV not below salvage, and `remaining_useful_life_months` when remaining depreciation exists
- activation creates one `ACQUISITION` transaction row
- that onboarding `ACQUISITION` row does not create a fresh acquisition journal
- assets with zero remaining depreciable amount can land in `FULLY_DEPRECIATED` without low-value auto-expense logic being applied just because they are below threshold

### Smoke tests
- activate a valid legacy-onboarding asset with remaining depreciation and verify one `ACQUISITION` row exists, `journal_entry_id` is null, and the asset is not treated as a new current-period purchase
- activate a valid legacy-onboarding asset with zero remaining depreciable amount and verify status may become `FULLY_DEPRECIATED` and no same-period low-value `DEPRECIATION` is auto-created solely from threshold
- attempt activation with inconsistent legacy NBV math and verify rejection
- attempt legacy onboarding on a source-linked/CARI-linked draft and verify rejection

### Acceptance
- legacy onboarding is supported without double-booking
- imported carrying values are validated and frozen properly
- below-threshold legacy imports follow Option B exactly
- go-live onboarding semantics are distinct from fresh acquisition semantics

---

## `STEP-FA23` - Manual low-value same-period full-expense activation path

### Patch target
Implement the below-threshold new-manual-asset activation path that posts immediate same-period full expense while keeping the asset tracked.

### In scope
- activation-time threshold evaluation for new manual assets without legacy onboarding values
- one-time `DEPRECIATION` transaction creation with `depreciation_kind = LOW_VALUE_FULL_EXPENSE`
- correct status transition to `FULLY_DEPRECIATED`
- correct salvage rule/value handling for this path
- coexistence with the standard manual activation path

### Explicit non-goals
- do not apply this path to manual legacy-onboarding assets
- do not apply this path to CARI capitalization here
- do not route this through run-based depreciation

### Definition of done
- if `original_cost_base` is below category threshold and no legacy onboarding values exist, activation routes through the low-value path
- activation still creates one `ACQUISITION` transaction row
- the same business event also creates one inline `DEPRECIATION` transaction row with `depreciation_kind = LOW_VALUE_FULL_EXPENSE`
- the asset remains tracked and ends at zero NBV
- the asset becomes `FULLY_DEPRECIATED`, not `DISPOSED`
- no future normal schedule/run eligibility is created for that asset

### Smoke tests
- activate a below-threshold manual draft asset and verify one `ACQUISITION` row exists, one `DEPRECIATION` row exists, `depreciation_kind = LOW_VALUE_FULL_EXPENSE`, final asset status is `FULLY_DEPRECIATED`, and no disposal/write-off status is used
- verify salvage snapshot/value rules are forced to the locked zero/none shape for this path
- attempt the same path with legacy onboarding values present and verify this low-value route is not auto-applied
- verify the asset is excluded from later normal depreciation-run eligibility queries

### Acceptance
- low-value same-period full-expense works as a controlled path
- it is distinct from legacy onboarding and distinct from disposal
- the asset remains traceable and reportable after immediate full expense

---

## `STEP-FA24` - FA06 eligible AP-line read surface and remaining-unit calculation

### Patch target
Deliver the read-side FA06 selection surface before posting/create logic is introduced.

### In scope
- eligible AP-line discovery using existing CARI document detail infrastructure
- remaining unconsumed unit quantity calculation
- per-line eligibility filtering for FA06
- shared request-shape groundwork for `unitCount`
- source-line quantity/provenance assumptions: positive whole-unit quantity and equal per-unit split assumption for multi-asset creation

### Explicit non-goals
- do not create or activate assets yet
- do not reserve unit slots yet
- do not post capitalization journals yet
- do not handle cross-OU accounting yet

### Definition of done
- the repo can expose eligible AP lines for fixed-assets capitalization without building a second ad hoc CARI detail backend
- eligibility is based on current remaining unconsumed unit quantity, not line-level exclusion after first use
- the read surface can show enough information for FA06: document status, direction, line id, quantity, txn/base amounts, current remaining units, and whether equal per-unit split is valid for MVP
- users who lack `cari.doc.read` cannot access this surface

### Smoke tests
- read an AP document with one untouched eligible line and verify it appears with full remaining units
- create a draft asset linked to one unit of that line and verify the remaining count decreases logically
- clear/delete that draft linkage and verify the remaining count becomes available again
- test a line with invalid quantity semantics and verify it is surfaced as ineligible for multi-asset FA06
- verify a user lacking `cari.doc.read` is blocked

### Acceptance
- FA06 line selection is now driven by real remaining-unit math
- draft reservations are visible in eligibility results
- no posting logic has been coupled into the read surface

---

## `STEP-FA25` - FA06 same-OU capitalization create/activate flow

### Patch target
Implement same-OU AP-line-driven asset creation/capitalization before cross-OU accounting is added.

### In scope
- `POST /api/v1/fixed-assets/from-cari-document-line`
- request-level shared-setup batch creation for same-OU cases
- deterministic assignment of the lowest available `source_cari_document_line_unit_no` values
- atomic `unitCount` creation
- creation of assets in draft or activated shape according to the locked FA06 behavior
- one `CAPITALIZATION` transaction row per created asset card
- below-threshold same-period low-value handling for CARI-linked assets in same-OU cases

### Explicit non-goals
- do not implement cross-OU due-to/due-from capitalization in this step
- do not implement source-drift revalidation edge handling beyond the basic same-OU create path if that is split to `STEP-FA27`
- do not redesign CARI document APIs

### Definition of done
- same-OU FA06 can create multiple assets from one AP line using request-level `unitCount`
- all units in the request share one category, one owner OU, one location OU, one capitalization/in-service date set, and one accounting treatment path
- each created asset gets exact line provenance and deterministic unit-slot allocation
- per-asset threshold evaluation is applied to the split per-unit amount
- created assets receive `CAPITALIZATION`, not `ACQUISITION`
- below-threshold same-OU CARI assets follow the locked immediate full-expense path

### Smoke tests
- create one same-OU asset from a single-unit AP line and verify one asset exists, one `CAPITALIZATION` transaction exists, and exact source line provenance is stored
- create multiple same-OU assets from a multi-unit line and verify `unitCount` assets are created, unit slot numbers are assigned from the lowest available slots, and all assets share the request-level setup fields
- verify the request is atomic by forcing one unit in the batch to fail validation and confirming no units are created
- verify below-threshold split per-unit amounts create one `CAPITALIZATION` row, one inline `DEPRECIATION` row with `LOW_VALUE_FULL_EXPENSE`, and final `FULLY_DEPRECIATED` status

### Acceptance
- same-OU FA06 works end to end
- the multi-unit path is atomic and deterministic
- exact line/unit provenance is persisted
- `CAPITALIZATION` semantics are distinct from manual acquisition semantics

---

## `STEP-FA26` - FA06 cross-OU capitalization accounting template and blocking rules

### Patch target
Add the locked direct cross-OU capitalization accounting path for owner-OU mismatch against the CARI/AP source OU.

### In scope
- cross-OU validation for FA06
- `resolveOuSelfBalancingAccountsTx` integration using `sourceOperatingUnitId = CARI document OU` and `targetOperatingUnitId = asset owner OU`
- locked direct capitalization journal template
- hard blocking when required self-balancing/current-account setup is unavailable
- same request-level shared-setup batch behavior as the same-OU path

### Explicit non-goals
- do not route cross-OU FA06 through same-date FA10 ownership transfer
- do not add asset-master inter-OU clearing override fields
- do not change FA10 transfer accounting in this step

### Definition of done
- FA06 supports owner OU different from source/payer OU only through the locked direct due-to/due-from capitalization template
- the template posts debit fixed-asset account in owner OU, credit `targetDueToAccount` in owner OU, debit `sourceDueFromAccount` in source/payer OU, and credit AP/vendor or AP-clearing in source/payer OU
- if the directional self-balancing accounts cannot be resolved, the request is blocked
- no unbalanced cross-OU capitalization is allowed to persist

### Smoke tests
- capitalize a valid cross-OU AP line with configured self-balancing accounts and verify journal lines match the locked template
- verify the owner OU receives the asset debit and the source/payer OU carries the AP-side credit
- verify the correct directional pair is used, not the opposite-direction due-to/due-from pair
- remove or invalidate self-balancing setup and verify the request fails before persistence
- verify same-OU requests still bypass this path and remain unaffected

### Acceptance
- cross-OU capitalization now has one locked accounting backbone
- unbalanced owner/source mismatch is impossible in supported flows
- FA06 no longer needs an ambiguous alternate mismatch path in MVP

---

## `STEP-FA27` - FA06 draft-link revalidation, source drift refresh, and activation-time safeguards

### Patch target
Harden FA06 draft-linked assets so activation/finalization never proceeds against stale or invalid source-line assumptions.

### In scope
- activation-time reload of current linked CARI document/line
- revalidation of source document status, quantity, currency, txn/base amounts, remaining unit-slot eligibility, equal per-unit split assumptions, and threshold-path implications from current per-unit amounts
- safe auto-refresh of source-derived draft values only
- blocking when the current source state no longer supports the reserved slot or assumptions

### Explicit non-goals
- do not overwrite user-owned fields like category, owner OU, location OU, capitalization date, and in-service date
- do not auto-heal impossible source changes by silently reassigning to another unit slot
- do not implement upstream CARI auto-unwind behavior

### Definition of done
- source-linked draft assets are treated as provisional until activation
- activation/finalization always re-checks the current source line/document
- source-derived values may auto-refresh when safe
- the workflow blocks when document is not `POSTED`, the reserved unit slot is no longer valid, per-unit amount assumptions no longer support the draft, or threshold-path implications changed in a way that requires user intervention
- stale source-derived data can no longer slip through activation unnoticed

### Smoke tests
- link a draft asset to a draft CARI line, then change line amounts and verify activation reloads the current values
- change quantity so the reserved unit slot is no longer available and verify activation is blocked
- change document status away from `POSTED` and verify activation is blocked
- verify auto-refresh updates source-derived values but leaves category/OU/date selections unchanged
- verify threshold-path drift causes the correct blocking or reclassification logic rather than silent stale activation

### Acceptance
- source-linked draft activation is now safe against upstream drift
- user-owned draft decisions are preserved while source-derived values remain current
- FA06 no longer relies on stale copied source data

---

## `STEP-FA28` - Schedule engine period resolution, read surface, and standard straight-line/none math

### Patch target
Implement the schedule engine foundation for supported periods and the standard schedule path before the more complex declining-balance and lifecycle-cutoff rules are layered on.

### In scope
- schedule-service period resolution for:
  - non-adjustment periods only
  - month-aligned fiscal periods only
  - locked `period_key = YYYY-MM`
- `GET /api/v1/fixed-assets/:assetId/depreciation-schedule`
- standard schedule generation path for:
  - `STRAIGHT_LINE`
  - `NONE`
- use of snapped asset-level fields rather than mutable profile/category rows
- basic NBV floor at salvage for standard path
- forward-only schedule generation for normal assets without run posting

### Explicit non-goals
- do not implement `DECLINING_BALANCE` yet
- do not implement legacy-onboarding schedule path yet
- do not implement lifecycle cutoffs for suspend/reactivate/transfer/disposal yet
- do not implement run posting here

### Definition of done
- supported fiscal periods are resolved with explicit non-adjustment enforcement
- schedule endpoint exists
- standard schedule rows generate deterministically for `STRAIGHT_LINE` and `NONE`
- period keys use locked `YYYY-MM`
- schedule generation reads frozen asset-level method/salvage fields

### Smoke tests
- generate schedule for a standard straight-line asset and verify period keys, opening NBV, planned amounts, and closing NBV progress correctly
- generate schedule for a `NONE`-method asset and verify no depreciation amounts are scheduled
- attempt schedule generation for an adjustment period or non-month-aligned period and verify rejection/blocking
- verify changing the underlying profile row after activation does not change the schedule result for the already activated asset

### Acceptance
- schedule generation exists as a real read-side engine
- standard straight-line/none paths are deterministic
- supported-period rules are enforced before more complex logic is added

---

## `STEP-FA29` - Declining-balance math, salvage-floor enforcement, and legacy-onboarding forward schedule path

### Patch target
Add the remaining locked depreciation math and the manual legacy-onboarding schedule path without reopening the standard schedule contract.

### In scope
- `DECLINING_BALANCE` math using:
  - annual nominal rate
  - monthly rate
  - full-month calculation before daily proration
- `switch_to_straight_line` permanent-switch comparison logic
- explicit salvage-floor enforcement across methods
- final-line residual rounding absorption without breaching salvage
- legacy-onboarding forward schedule path using:
  - legacy NBV at activation
  - stored `remaining_useful_life_months`
  - frozen asset-level depreciation/salvage fields

### Explicit non-goals
- do not implement lifecycle cutoffs yet
- do not implement run persistence/posting here
- do not create historical backfilled schedule rows for legacy onboarding

### Definition of done
- declining-balance assets can generate deterministic schedules with the locked switch logic
- schedules never depreciate below salvage
- legacy-onboarding assets generate forward-only schedules from the imported carrying state
- stored `remaining_useful_life_months` is used for legacy onboarding rather than inferred date math

### Smoke tests
- generate a declining-balance schedule and verify monthly amounts follow the locked rate formula
- generate a declining-balance asset with `switch_to_straight_line = true` and verify the switch occurs only when the locked comparison says so
- verify salvage floor is never breached
- generate a legacy-onboarding schedule and verify it starts from the imported NBV and remaining life rather than original acquisition history
- verify no historical pre-activation schedule rows are created for legacy-onboarding assets

### Acceptance
- all locked depreciation methods are now supported
- salvage-floor behavior is deterministic and enforced
- legacy-onboarding forward schedule logic is explicit and correct

---

## `STEP-FA30` - Lifecycle cutoff eligibility for suspension, reactivation, transfer, and disposal in schedule generation

### Patch target
Complete schedule eligibility logic for lifecycle events so the run engine later inherits correct partial-period behavior.

### In scope
- daily-prorata eligible-day handling for:
  - suspension
  - reactivation
  - ownership transfer
  - disposal/write-off
- use of effective dates:
  - prior state through day before
  - new state from effective date
- schedule eligibility changes for suspended days excluded, reactivation days included from effective date, transfer-month owner change split basis, and disposal cutoff on effective date
- exclusion of below-threshold low-value fully expensed assets from normal future schedule generation

### Explicit non-goals
- do not implement persisted run creation/posting here
- do not create disposal-month zero-amount postings as schedule artifacts
- do not create multiple normal depreciation transaction rows for one asset-period

### Definition of done
- schedule generation respects lifecycle history rows
- suspended assets do not accrue for suspended days
- reactivated assets resume prospectively from the reactivation date
- transfer months can be represented in schedule eligibility in a way compatible with later run-line allocation splits
- disposal months stop on the effective disposal date
- low-value fully expensed assets do not leak back into normal future schedule generation

### Smoke tests
- suspend an asset mid-month and verify schedule eligibility excludes suspended days
- reactivate mid-month and verify eligibility resumes from the reactivation date
- transfer ownership mid-month and verify the month is represented in a way compatible with later OU allocation splitting
- dispose/write off mid-month and verify no days on or after the disposal date are eligible
- verify a low-value fully expensed asset has no future normal schedule lines

### Acceptance
- lifecycle cutoffs are now explicit in schedule generation
- later run logic can rely on correct period eligibility inputs
- low-value path remains distinct from normal schedule consumption

---

## `STEP-FA31` - Depreciation run preview and persisted draft creation

### Patch target
Deliver preview and frozen `DRAFT` run creation before posting or reversal are added.

### In scope
- `POST /api/v1/fixed-assets/runs/preview`
- `POST /api/v1/fixed-assets/runs`
- non-adjustment fiscal-period validation
- supported month-aligned `period_key` validation
- frozen run header, run lines, and allocation rows
- run totals and skipped/error capture at creation time

### Explicit non-goals
- do not implement post yet
- do not implement reverse yet
- do not implement draft delete yet
- do not optimize large-payload chunking beyond correctness unless split later

### Definition of done
- preview is transient only
- persisted run creation writes a frozen `DRAFT` snapshot
- only one persisted `DRAFT` run can exist for the same scope
- run lines retain `eligible_days` and `days_in_period`
- ownership-transfer month allocation segments persist in allocation rows where applicable
- if run creation fails, nothing persists

### Smoke tests
- preview a valid run and verify no run rows are persisted
- create a persisted `DRAFT` run and verify header exists, lines exist, allocation rows exist where required, and period key and period id align
- attempt to create a second `DRAFT` for the same scope and verify rejection
- attempt preview/create against an adjustment period and verify rejection
- force a failure mid-create and verify the transaction rolls back fully

### Acceptance
- preview and persisted draft creation are distinct
- run snapshots are frozen and auditable
- uniqueness and rollback rules are enforced

---

## `STEP-FA32` - Depreciation run detail read and draft delete lifecycle

### Patch target
Deliver the read and stale-draft disposal surfaces needed before run posting is layered on.

### In scope
- `GET /api/v1/fixed-assets/runs`
- `GET /api/v1/fixed-assets/runs/:runId`
- `DELETE /api/v1/fixed-assets/runs/:runId` for `DRAFT` runs only
- read-side support for totals, line statuses, allocation detail, and skipped/error details

### Explicit non-goals
- do not implement post yet
- do not implement reverse yet
- do not allow delete for `POSTED` or `REVERSED` runs

### Definition of done
- run list and run detail are readable
- run detail exposes the frozen snapshot needed for audit/review
- only `DRAFT` runs may be deleted
- deleting a `DRAFT` run removes the draft snapshot rows so a new run for the same scope can later be created

### Smoke tests
- create a `DRAFT` run, fetch it by id, and verify lines and allocations are returned
- delete a `DRAFT` run and verify header/children are removed
- verify a new `DRAFT` run can be created for the same scope after delete
- attempt delete on a non-`DRAFT` run fixture and verify rejection

### Acceptance
- stale draft replacement is now explicit and safe
- read-side auditability of draft runs exists before posting
- the repo does not accumulate unusable stale draft snapshots

---

## `STEP-FA33` - Depreciation run post workflow

### Patch target
Implement posting of frozen `DRAFT` runs without recomputation.

### In scope
- `POST /api/v1/fixed-assets/runs/:runId/post`
- posting-date validation
- book resolution/validation
- creation of posted depreciation transactions with `depreciation_kind = RUN`
- journal creation and source-link writing
- schedule-line status/link updates
- run status/totals updates

### Explicit non-goals
- do not implement reversal here
- do not re-run calculation logic at post time
- do not allow partial line posting semantics outside the locked design

### Definition of done
- posting uses saved run lines and allocations only
- no silent recomputation occurs at post time
- one normal posted depreciation result exists per asset-period in the effective/current sense
- schedule lines move from `PLANNED` to `POSTED` with current posted links set
- run status becomes `POSTED`
- if post fails, the run remains `DRAFT`

### Smoke tests
- create a valid `DRAFT` run and post it; verify run becomes `POSTED`, depreciation transactions exist with `depreciation_kind = RUN`, journal source link uses `FIXED_ASSET_DEPRECIATION_RUN` as primary, and schedule lines update to `POSTED`
- modify asset state after draft creation but before post and verify post still uses frozen run lines, not recomputed data
- attempt post with invalid posting date/book/period state and verify rejection
- force a failure mid-post and verify the run remains `DRAFT`

### Acceptance
- posting is frozen-snapshot based
- run-posted depreciation is distinguishable from low-value inline expense
- schedule and journal traceability update correctly

---

## `STEP-FA34` - Depreciation run reverse workflow

### Patch target
Implement source-owned run reversal with successor-history blocking and reversal-safe repostability.

### In scope
- `POST /api/v1/fixed-assets/runs/:runId/reverse`
- admissibility checks for later lifecycle events and later posted depreciation results
- reversal journal support if used by design
- run-line and schedule-line `REVERSED` behavior
- clearing current posted links on schedule lines
- run status transition to `REVERSED`

### Explicit non-goals
- do not implement partial per-asset run reversal
- do not auto-unwind successor chains
- do not reopen unrelated later transactions automatically

### Definition of done
- reversal is all-or-nothing for the run
- if any affected asset violates reversal admissibility, the whole run reversal is blocked
- run lines become `REVERSED`
- linked schedule lines become `REVERSED`
- schedule-line current posted links are cleared
- repost for the same asset/period remains possible later
- if reversal fails, the run remains `POSTED`

### Smoke tests
- reverse a valid posted run and verify run status is `REVERSED`, run lines are `REVERSED`, schedule lines are `REVERSED`, and current schedule posted links are cleared
- create a later lifecycle event on one affected asset and verify the whole run reversal is blocked
- create a later posted depreciation result and verify reversal is blocked
- verify a fresh repost for the same asset/period becomes possible after successful reversal
- force a failure during reversal and verify the run remains `POSTED`

### Acceptance
- run reversal is controlled, auditable, and safe
- reversal does not strand the asset-period forever
- successor-chain auto-unwind is not required for MVP

---

## `STEP-FA35` - Depreciation run chunked persistence and volume safety hardening

### Patch target
Harden large run persistence to fit the repo’s one-transaction rule without relying on oversized insert payloads.

### In scope
- chunked insert/write strategy for run lines, allocation rows, and any large post-time persistence where relevant
- keep one `withTransaction(...)` boundary
- packet-size aware implementation
- stress-oriented validation of volume behavior

### Explicit non-goals
- do not change business semantics of runs
- do not split one business workflow across multiple commits
- do not introduce a second transaction boundary to solve volume

### Definition of done
- large run creation and related persistence write in chunks inside one transaction
- implementation is explicit about batch sizing
- no change in correctness or audit shape versus unchunked semantics
- the repo has a repeatable way to test larger run sizes

### Smoke tests
- create a run with enough lines/allocations to exercise chunking
- verify the transaction still commits atomically, all expected rows are persisted, and totals match the pre-chunk logical result
- force a failure on a later chunk and verify the whole transaction rolls back
- verify smaller runs still behave identically

### Acceptance
- run persistence is now volume-safe within the repo’s transaction model
- correctness is preserved while reducing environment sensitivity
- chunking is implementation hardening, not a semantic change

---

## `STEP-FA36` - Physical move workflow

### Patch target
Implement the non-accounting physical move/reassignment workflow without mixing it with ownership transfer semantics.

### In scope
- `POST /api/v1/fixed-assets/:assetId/physical-move`
- updates to:
  - `location_operating_unit_id`
  - `custodian_employee_id`
  - `department_code`
  - `cost_center_code`
- creation of one `PHYSICAL_MOVE` transaction row
- creation of one `fixed_asset_physical_move_details` row
- from/to snapshot persistence for:
  - location OU
  - custodian
  - department code
  - cost center code

### Explicit non-goals
- do not change `owner_operating_unit_id`
- do not create accounting journals by default
- do not implement ownership transfer here

### Definition of done
- physical move changes only physical/responsibility dimensions
- workflow creates one transaction and one child detail row
- from/to state is DB-backed and auditable
- no ownership or accounting movement is implied by this workflow

### Smoke tests
- move an active asset to a new location and custodian and verify one `PHYSICAL_MOVE` transaction exists, one detail row exists, asset master updates location/custodian, and owner OU remains unchanged
- move an asset with only department/cost-center change and verify the move still records from/to snapshots and no accounting owner change occurs
- verify repeated move history can be read in chronological order

### Acceptance
- physical move is now a distinct workflow
- physical placement and responsibility changes are auditable
- accounting ownership remains untouched by this flow

---

## `STEP-FA37` - Ownership transfer workflow and accounting

### Patch target
Implement ownership transfer as a separate accounting workflow with the locked gross-cost-plus-accumulated-depreciation template and directional self-balancing on NBV.

### In scope
- `POST /api/v1/fixed-assets/:assetId/ownership-transfer`
- change to `owner_operating_unit_id`
- optional location update as part of transfer
- creation of one `OWNERSHIP_TRANSFER` transaction row
- creation of one `fixed_asset_ownership_transfer_details` row
- locked journal template:
  - debit fixed-asset account in target owner OU for gross cost
  - credit fixed-asset account in source owner OU for gross cost
  - debit accumulated-depreciation account in source owner OU
  - credit accumulated-depreciation account in target owner OU
  - debit `sourceDueFromAccount` in source owner OU for transferred NBV
  - credit `targetDueToAccount` in target owner OU for transferred NBV
- directional self-balancing account resolution using sourceOperatingUnitId = source owner OU and targetOperatingUnitId = target owner OU

### Explicit non-goals
- do not treat this as a physical move
- do not use a net-only template
- do not use opposite-direction due-to/due-from accounts
- do not add asset-master inter-OU override fields

### Definition of done
- ownership transfer updates owner OU only after successful posting
- transfer persists one transaction and one detail row
- accounting uses the locked gross/accum/NBV template
- zero-NBV transfers omit zero self-balancing lines rather than posting zero amounts
- the workflow remains distinct from physical move even if location is also updated

### Smoke tests
- transfer an asset between owner OUs with non-zero NBV and verify journal lines match the locked template
- verify the source owner OU and target owner OU directional due-to/due-from pair is resolved correctly
- verify owner OU changes only after successful posting
- transfer an asset with zero NBV and verify zero self-balancing lines are not created
- verify a transfer can optionally update location but still remains an ownership-transfer workflow, not a physical move

### Acceptance
- ownership transfer is now a controlled accounting workflow
- transfer accounting is deterministic and repo-native
- owner OU change no longer relies on ad hoc direct edits

---

## `STEP-FA38` - Write-off workflow

### Patch target
Implement the no-proceeds disposal path before sale complexity is introduced.

### In scope
- `POST /api/v1/fixed-assets/:assetId/writeoff`
- NBV calculation
- disposal cutoff handling
- `WRITEOFF` transaction creation
- disposal journal creation
- asset status transition to `DISPOSED`
- gain/loss account usage as applicable for write-off behavior

### Explicit non-goals
- do not implement sale in this step
- do not implement non-run reversal in this step
- do not create a generic `DISPOSAL` transaction type

### Definition of done
- write-off creates one `WRITEOFF` transaction row
- the asset becomes `DISPOSED`
- future depreciation is cut off correctly
- already fully depreciated assets do not receive zero-amount depreciation formality postings just to mark disposal month cutoff

### Smoke tests
- write off a partially depreciated asset and verify one `WRITEOFF` row exists, asset status is `DISPOSED`, disposal journal exists, and future depreciation eligibility is gone
- write off an already fully depreciated asset and verify no zero-amount depreciation transaction is created and the asset still disposes correctly
- attempt write-off on an already disposed asset and verify rejection

### Acceptance
- write-off is now a complete disposal path
- it is distinct from sale
- disposal cutoffs and zero-amount edge handling follow the locked rules

---

## `STEP-FA39` - Sale staged draft/link/update workflow

### Patch target
Implement the staged AR-side sale preparation flow without final disposal accounting yet.

### In scope
- `POST /api/v1/fixed-assets/:assetId/sale/create-draft-ar-document`
- `POST /api/v1/fixed-assets/:assetId/sale/link-ar-document`
- `PATCH /api/v1/fixed-assets/:assetId/sale/draft-ar-document`
- exact AR line linkage requirements
- action-specific `cari.doc.*` permission checks
- draft/pre-finalize fixed-assets state management

### Explicit non-goals
- do not create the fixed-assets `SALE` row yet
- do not post disposal accounting yet
- do not transition the asset to `DISPOSED` yet
- do not finalize the sale here

### Definition of done
- sale can create a draft AR-side context
- sale can link an existing AR-direction document and exact dedicated line
- sale can update the linked draft AR-side context
- none of these staged actions create a fixed-assets `SALE` row, a disposal journal, or a disposed asset state
- the workflow stores enough linkage context for later finalization

### Smoke tests
- create a draft AR-side sale document and verify a dedicated line is created for the asset, no `SALE` row exists yet, and the asset remains in pre-sale state
- link an existing AR document/line and verify exact line linkage is stored and shared-line linkage is rejected
- update the linked draft AR-side context and verify allowed draft fields change and no disposal accounting is created
- verify permission failures for missing `cari.doc.create`, `read`, or `update`

### Acceptance
- staged sale preparation is real and explicit
- draft preparation is separated from disposal finalization
- line-exact provenance is enforced before final posting

---

## `STEP-FA40` - Sale finalize workflow

### Patch target
Implement the only sale step that may create the fixed-assets `SALE` row, disposal journal, and disposed asset state.

### In scope
- `POST /api/v1/fixed-assets/:assetId/sale/finalize`
- final AR-side validation
- exact `source_ref_line_id` enforcement
- NBV relief, gain/loss logic, and disposal posting
- asset status transition to `DISPOSED`
- final `SALE` transaction creation

### Explicit non-goals
- do not implement sale reversal in this step
- do not allow finalize to succeed without exact AR line provenance
- do not overload earlier staged endpoints with finalize behavior

### Definition of done
- finalize fails unless an exact dedicated AR sale line is resolved
- finalize creates one `SALE` transaction row
- the posted `SALE` row stores `source_ref_type = CARI_DOCUMENT`, `source_ref_id`, and `source_ref_line_id`
- disposal journal is created
- asset becomes `DISPOSED`
- earlier draft/link/update actions remain non-finalizing

### Smoke tests
- finalize a prepared sale and verify one `SALE` row exists, exact AR line provenance is stored, disposal journal exists, and asset status becomes `DISPOSED`
- attempt finalize without a dedicated AR line and verify rejection
- verify one AR line cannot be reused for multiple asset finalizations
- verify missing `cari.doc.post` blocks finalize

### Acceptance
- sale finalization is now explicit and auditable
- only finalize creates the sale event
- exact AR-line provenance is guaranteed on posted sale rows

---

## `STEP-FA41` - Source-owned non-run reversal workflow

### Patch target
Implement reversal for posted non-run fixed-assets transactions through fixed-assets-owned endpoints rather than direct GL reversal.

### In scope
- `POST /api/v1/fixed-assets/transactions/:transactionId/reverse`
- reversal support for posted non-run transaction types in MVP: `ACQUISITION`, `CAPITALIZATION`, inline low-value `DEPRECIATION`, `OWNERSHIP_TRANSFER`, `WRITEOFF`, and `SALE`
- successor-event blocking
- linked-CARI progression blocking
- authoritative reversal lineage using `reversed_transaction_id`
- optional convenience backlink update

### Explicit non-goals
- do not reverse run-posted depreciation here
- do not auto-unwind later dependent events
- do not permit reversal of non-posting lifecycle events merely because they exist as transactions

### Definition of done
- non-run posted transactions can be reversed only when they are still the latest finalized lifecycle event for the asset
- `SALE` reversal is blocked until the linked AR-side document/line is already reversed or back in a reversal-compatible non-posted state
- reversal creates one `REVERSAL` transaction row
- one original posted source-owned transaction cannot be reversed twice
- permission mapping follows original transaction type, not a blanket reversal permission

### Smoke tests
- reverse a posted `CAPITALIZATION` with no successor event and verify one `REVERSAL` row exists, `reversed_transaction_id` is set, and original state is not double-reversible
- create a successor transaction and verify reversal is blocked
- attempt to reverse the same original transaction twice and verify the second attempt fails
- attempt to reverse a `SALE` while AR-side state is still progressed and verify blocking
- verify permission enforcement differs for `post`, `transfer`, and `dispose` reversal cases

### Acceptance
- non-run source-owned reversal is real and protected
- reversal lineage is authoritative and DB-backed
- successor-state and linked-CARI blocking rules are enforced

---

## `STEP-FA42` - Fixed-assets evidence service extension and nested evidence routes

### Patch target
Extend evidence support to fixed-assets surfaces and expose nested evidence routes for asset, transaction, and run levels.

### In scope
- extend `backend/src/services/evidence.service.js` for:
  - `FIXED_ASSET`
  - `FIXED_ASSET_TRANSACTION`
  - `FIXED_ASSET_DEPRECIATION_RUN`
- add `backend/src/routes/fixed-assets.evidence.routes.js`
- nested mounts inside `fixed-assets.routes.js`:
  - `/:assetId/evidence`
  - `/transactions/:transactionId/evidence`
  - `/runs/:runId/evidence`
- asset/transaction/run evidence operations:
  - list
  - create metadata
  - read single evidence record
  - upload content
  - download content
  - delete

### Explicit non-goals
- do not finalize journal drillback here
- do not add a separate top-level app mount for fixed-assets evidence
- do not use the leaner inventory-transfer evidence route shape as the template

### Definition of done
- evidence service supports all locked fixed-assets source types
- one merged-params router serves asset, transaction, and run evidence surfaces
- routes follow the richer CARI evidence pattern
- fixed-assets evidence is nested under fixed-assets routes, not mounted at app root separately

### Smoke tests
- create metadata for asset evidence and verify `uploadPath` is returned
- upload, download, and delete asset evidence content successfully
- repeat the same flow for transaction evidence and run evidence
- verify RBAC scope resolution works correctly for asset, transaction, and run evidence routes
- verify the routes do not get swallowed by `/:assetId` route ordering mistakes

### Acceptance
- evidence support for fixed-assets is complete at all required levels
- route mounting and evidence service behavior match the locked design
- evidence is no longer an uncovered dependency for the module

---

## `STEP-FA43` - Fixed-assets journal source-link writing and backend destination resolution support

### Patch target
Connect fixed-assets posting workflows to journal source links and extend the shared backend destination resolver for fixed-assets source types.

### In scope
- fixed-assets posting workflows write:
  - `FIXED_ASSET_TRANSACTION` as primary for non-run journals
  - `FIXED_ASSET_DEPRECIATION_RUN` as primary for run journals
- ensure exactly one owning `PRIMARY` link is written for fixed-assets generated journals
- extend `backend/src/services/gl.reverse-block-destination.service.js` for:
  - `FIXED_ASSET_TRANSACTION`
  - `FIXED_ASSET_DEPRECIATION_RUN`
- implement locked route/query resolution rules and fallbacks for those source types
- ensure fixed-assets source-link rows can carry backend-owned `destination` metadata in journal detail reads

### Explicit non-goals
- do not finish frontend deep-link page consumption here
- do not leave source-type literals hardcoded ad hoc in multiple files
- do not alter non-fixed-assets destination contracts beyond what shared infrastructure already supports

### Definition of done
- fixed-assets journals write the correct source-link types and one owning `PRIMARY`
- backend destination resolver can resolve fixed-assets source rows dynamically
- journal detail reads now expose fixed-assets `source_links[].destination` via the shared contract
- reverse-blocking can produce destination metadata for fixed-assets source types without relying on static UI route maps

### Smoke tests
- post a fixed-assets non-run journal and verify one primary source link exists and source type is `FIXED_ASSET_TRANSACTION`
- post a depreciation run journal and verify one primary source link exists and source type is `FIXED_ASSET_DEPRECIATION_RUN`
- fetch the journal detail and verify `source_links[].destination` resolves to asset detail with `tab=transactions&transactionId=...` for normal fixed-assets transaction cases, disposals workflow for `SALE` and `WRITEOFF`, and depreciation-runs workflow with `runId=...` for run journals
- intentionally break a source record lookup and verify fallback destination shape is still returned with `isFallback = true`

### Acceptance
- fixed-assets journals are now fully wired into the shared source-link ownership/drillback contract
- backend-owned route resolution for fixed-assets exists
- Journal Workbench no longer needs fixed-assets-specific hardcoded route ownership to be correct

---

## `STEP-FA44` - Fixed-assets deep-link pages, Journal Workbench drillback, and query-contract completion

### Patch target
Finish the fixed-assets side of the drillback contract by making fixed-assets pages honor the locked query parameters and verifying Journal Workbench can navigate correctly for fixed-assets source types.

### In scope
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`
  - consume `tab`
  - consume `transactionId`
  - focus/highlight the matching transaction when `tab=transactions`
- `frontend/src/pages/fixedAssets/FixedAssetDepreciationRunsPage.jsx`
  - consume `runId`
  - load/focus matching run
- `frontend/src/pages/fixedAssets/FixedAssetDisposalsPage.jsx`
  - consume `transactionId`
  - consume optional `assetId`
  - focus/filter matching disposal transaction
- `frontend/src/pages/JournalWorkbenchPage.jsx`
  - verify fixed-assets drillback and reverse-block navigation work through backend-owned destination metadata
- frontend API helper support for:
  - run detail loading
  - transaction-list loading with transaction focus support
  - disposal focus/loading where needed

### Explicit non-goals
- do not reintroduce local fixed-assets route maps as the primary logic
- do not change the shared backend destination shape here
- do not widen this step into unrelated fixed-assets page redesign work

### Definition of done
- fixed-assets target pages honor the locked deep-link query contract exactly:
  - `runId`
  - `transactionId`
  - `assetId`
  - `tab`
- Journal Workbench can navigate to fixed-assets pages using backend-owned destination metadata on both normal “Open Source” and reverse-block navigation
- fixed-assets deep-link pages are no longer passive endpoints; they actively focus the linked context

### Smoke tests
- open a journal with `FIXED_ASSET_TRANSACTION` source link and trigger “Open Source”; verify navigation lands on asset detail with `tab=transactions` and focuses the matching transaction
- open a journal with `FIXED_ASSET_DEPRECIATION_RUN` source link and verify navigation lands on depreciation runs page with the correct run focused
- open a disposal-related fixed-assets journal and verify navigation lands on disposals page with the correct transaction and optional asset context focused
- attempt reverse on a blocked fixed-assets journal and verify the reverse-block navigation hint lands on the correct owning workflow
- verify the UI no longer depends on fixed-assets-specific local static maps for upgraded paths

### Acceptance
- the fixed-assets side of the drillback contract is complete
- backend-owned navigation metadata now works end to end
- Journal Workbench and fixed-assets pages agree on one exact query contract

---

## `STEP-FA45` - Fixed-assets permission seeding and backend authorization hardening

### Patch target
Finish the backend permission model and route-level enforcement before UI gating is finalized.

### In scope
- add `fixed_assets.account_override` to `backend/src/seedCore.js`
- assign roles exactly as locked
- backend route guards for fixed-assets surfaces
- cross-module permission enforcement using the secondary RBAC assertion helper
- non-run reversal permission mapping by original transaction type

### Explicit non-goals
- do not finalize sidebar visibility here
- do not implement reports here
- do not treat frontend hiding as security

### Definition of done
- `fixed_assets.account_override` is seeded
- role bundle assignment matches the locked rule exactly
- fixed-assets routes use owning `fixed_assets.*` permission plus required `cari.doc.*` checks where applicable
- stacked `requirePermission(...)` overwrites are avoided
- reversal authorization is action-specific and transaction-type aware

### Smoke tests
- seed a fresh environment and verify `fixed_assets.account_override` exists
- verify `TenantAdmin`, `CountryController`, and `EntityAccountant` have it while `GroupController`, `BranchOperator`, and `AuditorReadOnly` do not
- call FA06/FA11 endpoints with missing CARI permission and verify rejection
- call a route requiring account override without that permission and verify rejection
- call non-run reversal endpoints with wrong permission family and verify rejection

### Acceptance
- backend authorization matches the locked model
- role assignment is explicit and testable
- CARI cross-module permissions are enforced correctly

---

## `STEP-FA46` - Frontend sidebar, route, and action gating

### Patch target
Wire the permission model into the frontend without changing backend security assumptions.

### In scope
- sidebar visibility
- shared app-chrome demirbas navigation/icon heuristic cleanup where needed for canonical routes and aliases
- page-level action visibility
- route-level UX gating for canonical fixed-assets routes
- action gating for settings, custodians, disposal, transfer, depreciation actions, and account overrides
- cleanup of remaining placeholder-era demirbas navigation assumptions

### Explicit non-goals
- do not rely on frontend gating as the security boundary
- do not build reports here
- do not change backend permission semantics

### Definition of done
- fixed-assets sidebar entries reflect the user’s permission set
- fixed-assets actions only appear when the relevant permissions exist
- account-override actions are separately gated from broad upsert/post actions
- canonical routes are now backed by real pages, not generic placeholders

### Smoke tests
- log in as users with different permission bundles and verify sidebar/page/action visibility changes correctly
- verify a read-only user can view but not see mutation actions
- verify a user with broad fixed-assets access but no account-override permission cannot see override actions
- verify a user with missing disposal/transfer permissions cannot see those actions even if they can open detail pages

### Acceptance
- frontend gating now mirrors backend authorization
- sensitive actions are visibly explicit
- placeholder-driven demirbas navigation is gone

---

## `STEP-FA47` - Fixed-assets reports and paired export endpoints

### Patch target
Implement the locked report set and its paired export contract.

### In scope
- report endpoints for register, depreciation schedule, additions, disposals, transfers, by owner OU, by location OU, by custodian, depreciation by owner OU, and rollforward
- paired `/export` endpoints for each report
- frontend report page/API integration
- report filters aligned with the locked report purposes
- report distinctions such as `by-owner-ou` vs `depreciation-by-owner-ou`, `ACQUISITION` vs `CAPITALIZATION`, `WRITEOFF` vs `SALE`, and `RUN` vs `LOW_VALUE_FULL_EXPENSE`

### Explicit non-goals
- do not collapse reports into one generic endpoint
- do not use `?export=1` as the contract
- do not postpone export semantics as “later”

### Definition of done
- the locked report set exists
- each report has a dedicated `/export` pair
- report SQL respects the locked lifecycle/report semantics
- frontend report surface is no longer placeholder-only

### Smoke tests
- run each report with a minimal seeded dataset and verify rows return
- run each paired `/export` endpoint and verify a downloadable result is produced
- verify `by-owner-ou` and `depreciation-by-owner-ou` differ in grouping logic and basis
- verify additions separate `ACQUISITION` from `CAPITALIZATION`
- verify disposals separate `WRITEOFF` from `SALE`
- verify low-value same-period full-expense appears without being misclassified as retirement
- verify transfer-month allocation-aware reports reflect persisted allocation rows

### Acceptance
- reporting is practical and complete for MVP scope
- export is first-class, not bolted on
- financial/reporting distinctions match the locked semantics

---

## `STEP-FA48` - Release gates, smoke suite, and rollout readiness checks

### Patch target
Close the track with explicit release-readiness checks so the module is not considered done only because routes compile.

### In scope
- cross-cutting smoke suite for the fixed-assets track
- release-readiness checks covering OpenAPI generation, source-link ownership contract, reverse-block contract, permissions, reports/export, and key workflows
- rollout/readiness documentation for one-`PRIMARY` source-link enforcement dependency, fixed-assets route availability, fixed-assets page readiness, and required OU self-balancing setup for cross-OU flows

### Explicit non-goals
- do not add new business scope here
- do not hide missing prerequisites behind a green build
- do not treat ad hoc manual clicking as sufficient rollout readiness

### Definition of done
- there is a named smoke suite or equivalent release gate covering the fixed-assets MVP
- the release gate verifies the critical contracts introduced earlier in the plan
- rollout blockers are explicit if prerequisites are missing
- the module can now be judged on behavior, not just code presence

### Smoke tests
- the smoke suite verifies one journal has at most one `PRIMARY`, journal detail still returns raw `source_links`, journal detail additively returns `source_links[].destination` where supported, reverse-block errors preserve message text and include `details.reverseBlock`, and Journal Workbench can use backend-owned metadata on upgraded paths
- the smoke suite verifies manual draft creation, standard manual activation, legacy-onboarding activation, and below-threshold manual activation
- the smoke suite verifies same-OU AP-line capitalization, cross-OU AP-line capitalization with configured self-balancing, missing-setup blocking, and stale source-linked activation blocking
- the smoke suite verifies preview run, create draft run, post run, reverse run, delete stale draft run, and low-value exclusion from run eligibility
- the smoke suite verifies physical move, ownership transfer, write-off, staged sale create/link/update without final disposal, sale finalize, and source-owned non-run reversal
- the smoke suite verifies asset/transaction/run evidence CRUD plus one report read and one paired export per report family
- the smoke suite verifies missing `cari.doc.*` permission blocks FA06/FA11 correctly, missing `fixed_assets.account_override` blocks account override correctly, and non-run reversal permission mapping follows transaction type

### Acceptance
- the track has an explicit release bar
- smoke coverage proves the critical contracts actually work together
- rollout prerequisites are visible and testable
- "done" now means operationally ready, not only implemented

---

## Notes On How To Use These With Codex

For each serialized step prompt, include all of these:
- the exact `STEP-FA##` step name
- the step `Patch target`
- the step `In scope`
- the step `Explicit non-goals`
- the step `Definition of done`
- the step `Smoke tests`
- the matching execution-matrix block below, especially `Allowed files`, `Dependencies`, and `Blocked by`

Prompt shape to prefer:
- `Implement STEP-FA33 only.`
- `In scope: ...`
- `Explicit non-goals: ...`
- `Files allowed: ...`
- `The patch is not complete unless the smoke tests described in the step pass.`

## Codex Execution Matrix

Use this matrix together with each serialized step body. `Allowed files` means the primary write scope for that prompt; if the step needs files outside the list, split the work instead of widening the patch casually.

### `STEP-FA01`
- `AI size`: Small
- `Allowed files`: `backend/src/utils/source-ref-types.js`, `frontend/src/utils/sourceRefTypes.js`, `backend/src/routes/_utils.js`, `backend/src/middleware/rbac.js`
- `Dependencies`: none beyond repo baseline
- `Blocked by`: none
- `Rollback risk`: Low
- `Smoke command ideas`: `npm run test:permission-matrix`; local reverse-error serialization smoke through the journal reverse path

### `STEP-FA02`
- `AI size`: Small
- `Allowed files`: `backend/scripts/*`, `backend/package.json`, `backend/src/migrate.js`, `backend/src/migrationRunner.js`
- `Dependencies`: none beyond repo baseline
- `Blocked by`: access to representative `journal_source_links` data in local or seeded environments
- `Rollback risk`: Low
- `Smoke command ideas`: `npm run db:migrate:status`; run the duplicate-`PRIMARY` preflight against local data and inspect stable output ordering

### `STEP-FA03`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/cash.service.js`, `backend/src/services/cash.transaction.service.js`, `backend/src/services/payments.service.js`, `backend/src/services/journal.source-link.service.js`, directly owning route files only if the write entrypoint lives there
- `Dependencies`: `STEP-FA02`
- `Blocked by`: unresolved survivor/demotion rule from the duplicate-`PRIMARY` preflight
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run test:cari-pr06`; `npm run test:cash-posting-reversal`; `npm run test:payments:prb04`

### `STEP-FA04`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/inventory.service.js`, `backend/src/services/inventory.transfer.service.js`, `backend/src/services/payroll.accruals.service.js`, `backend/src/services/payroll.runs.service.js`, `backend/src/services/payroll.paymentSync.service.js`, `backend/src/services/payroll.liabilities.service.js`, `backend/src/services/journal.source-link.service.js`, directly owning route files only if the write entrypoint lives there
- `Dependencies`: `STEP-FA02`, `STEP-FA03`
- `Blocked by`: the one-owning-link writer contract not yet being settled in earlier shared-platform flows
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run test:inventory:release-gate`; `npm run test:payroll:release-gate`

### `STEP-FA05`
- `AI size`: Small
- `Allowed files`: `backend/scripts/*`, `backend/package.json`, the directly related shared-platform files changed in `STEP-FA03` and `STEP-FA04` only where assertions must be wired in
- `Dependencies`: `STEP-FA02`, `STEP-FA03`, `STEP-FA04`
- `Blocked by`: writer-compliance gaps still open in shared-journal producers
- `Rollback risk`: Low
- `Smoke command ideas`: existing CARI/cash/inventory/payroll gate scripts plus a new duplicate-`PRIMARY` release-gate check

### `STEP-FA06`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/gl.reverse-block-destination.service.js`, `backend/src/routes/gl.write.journal.routes.js`, `backend/src/routes/gl.read.journal.routes.js`, `backend/src/routes/_utils.js`, `backend/src/utils/source-ref-types.js`, `backend/src/services/journal.source-link.service.js`
- `Dependencies`: `STEP-FA01`
- `Blocked by`: shared source-ref constants and structured-error helper not being available
- `Rollback risk`: Medium
- `Smoke command ideas`: local `GET /gl/journals/:journalId`; local reverse attempt that should return legacy text plus `details.reverseBlock`

### `STEP-FA07`
- `AI size`: Medium
- `Allowed files`: `frontend/src/pages/JournalWorkbenchPage.jsx`, `frontend/src/utils/sourceRefTypes.js`, `frontend/src/utils/journalSourceLinkDestinations.js`
- `Dependencies`: `STEP-FA06`
- `Blocked by`: backend detail/read and reverse-error metadata not yet landing additively
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run build`; manual Journal Workbench open-source and reverse-block smoke against upgraded journal detail payloads

### `STEP-FA08`
- `AI size`: Small
- `Allowed files`: `backend/scripts/generate-openapi.js`, `backend/openapi.yaml`, `backend/package.json`
- `Dependencies`: none beyond the locked route base `/api/v1/fixed-assets`
- `Blocked by`: none
- `Rollback risk`: Low
- `Smoke command ideas`: `npm run openapi:generate`; `npm run check:openapi`

### `STEP-FA09`
- `AI size`: Medium
- `Allowed files`: `backend/src/migrations/m138_fixed_assets_foundation.js`, `backend/src/migrations/index.js`
- `Dependencies`: none beyond the locked schema decisions in `FA01`
- `Blocked by`: migration numbering or base-table-order drift
- `Rollback risk`: High
- `Smoke command ideas`: `npm run db:migrate:status`; `npm run db:migrate` against a fresh local database

### `STEP-FA10`
- `AI size`: Medium
- `Allowed files`: `backend/src/migrations/m138_fixed_assets_foundation.js`, `backend/src/migrations/index.js`
- `Dependencies`: `STEP-FA09`
- `Blocked by`: base tables from `m138` not being in place yet
- `Rollback risk`: High
- `Smoke command ideas`: `npm run db:migrate`; schema inspection for the locked foreign keys, unique guards, and indexes

### `STEP-FA11`
- `AI size`: Small
- `Allowed files`: `backend/src/migrations/m139_fixed_asset_custodian_employees.js`, `backend/src/migrations/index.js`
- `Dependencies`: `STEP-FA09`
- `Blocked by`: custodian columns not existing from the `m138` base pass
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run db:migrate`; verify deferred custodian foreign keys attach only after the interim table exists

### `STEP-FA12`
- `AI size`: Medium
- `Allowed files`: `backend/src/migrations/m140_fixed_asset_cari_capitalization_and_traceability.js`, `backend/src/migrations/index.js`
- `Dependencies`: `STEP-FA02` to `STEP-FA05`, `STEP-FA09` to `STEP-FA11`
- `Blocked by`: one-`PRIMARY` writer hardening or legacy data normalization still being incomplete
- `Rollback risk`: High
- `Smoke command ideas`: `npm run db:migrate`; targeted SQL assertions for source-line provenance, unit-slot uniqueness, and the journal-link tail

### `STEP-FA13`
- `AI size`: Medium
- `Allowed files`: `backend/src/index.js`, `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.reporting.service.js`, `backend/src/services/fixed-assets.scope.service.js`
- `Dependencies`: `STEP-FA01`, `STEP-FA09` to `STEP-FA12`
- `Blocked by`: fixed-assets schema slices not being present or route ordering still being ambiguous
- `Rollback risk`: Medium
- `Smoke command ideas`: start the backend locally; hit `/api/v1/fixed-assets` and verify static and nested-prefixed routes are not swallowed by `/:assetId`

### `STEP-FA14`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: `STEP-FA13`, `STEP-FA09`
- `Blocked by`: category tables or shared fixed-assets module skeleton not being in place
- `Rollback risk`: Medium
- `Smoke command ideas`: local category create/list/update smoke with account-type and legal-entity ownership validation cases

### `STEP-FA15`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: `STEP-FA13`, `STEP-FA09`
- `Blocked by`: depreciation-profile tables or fixed-assets route skeleton missing
- `Rollback risk`: Medium
- `Smoke command ideas`: local depreciation-profile create/list/update smoke covering method/rate compatibility

### `STEP-FA16`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `frontend/src/pages/fixedAssets/FixedAssetSettingsPage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetCustodiansPage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx`, `frontend/src/api/fixedAssets.js`, `frontend/src/i18n/messages.js`
- `Dependencies`: `STEP-FA11`, `STEP-FA14`, `STEP-FA15`
- `Blocked by`: category/profile/custodian backend surfaces not yet being stable enough to wire into the frontend
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run build`; local settings/custodians page smoke plus backend CRUD checks

### `STEP-FA17`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.scope.service.js`
- `Dependencies`: `STEP-FA13`, `STEP-FA14`, `STEP-FA15`, `STEP-FA16`
- `Blocked by`: missing read-side filters or scope-resolution helpers in the fixed-assets module shell
- `Rollback risk`: Low
- `Smoke command ideas`: local `GET /api/v1/fixed-assets` smoke with legal-entity, owner-OU, location-OU, category, status, and disposed filters

### `STEP-FA18`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.scope.service.js`
- `Dependencies`: `STEP-FA17`
- `Blocked by`: asset register read contract or detail payload foundations not yet being stable
- `Rollback risk`: Low
- `Smoke command ideas`: local `GET /api/v1/fixed-assets/:assetId` smoke for normal, legacy-onboarding, and low-value fully expensed assets

### `STEP-FA19`
- `AI size`: Medium
- `Allowed files`: `frontend/src/pages/fixedAssets/FixedAssetsPage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`, `frontend/src/api/fixedAssets.js`, `frontend/src/i18n/messages.js`, `frontend/src/App.jsx`
- `Dependencies`: `STEP-FA17`, `STEP-FA18`
- `Blocked by`: list/detail backend contracts not yet being stable enough for page wiring
- `Rollback risk`: Low
- `Smoke command ideas`: `npm run build`; register filter smoke and asset-detail tab-foundation smoke in the browser

### `STEP-FA20`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.scope.service.js`, optionally `frontend/src/api/fixedAssets.js` and `frontend/src/pages/fixedAssets/FixedAssetFormPage.jsx` only if the branch must expose the draft flow immediately
- `Dependencies`: `STEP-FA13`, `STEP-FA14`, `STEP-FA15`, `STEP-FA16`
- `Blocked by`: category/profile defaults and draft mutability rules not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local draft create/read/update smoke including numbering and status-gated patch behavior

### `STEP-FA21`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`
- `Dependencies`: `STEP-FA20`, `STEP-FA14`, `STEP-FA15`
- `Blocked by`: manual draft create not yet being stable or activation-time account/profile validation still missing
- `Rollback risk`: High
- `Smoke command ideas`: local manual activation smoke for valid and invalid assets, including post-activation mutability rejection

### `STEP-FA22`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`
- `Dependencies`: `STEP-FA20`, `STEP-FA15`
- `Blocked by`: legacy-onboarding value validation or remaining-life capture not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local legacy-onboarding activation smoke for remaining-life and zero-remaining-life cases

### `STEP-FA23`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`
- `Dependencies`: `STEP-FA20`, `STEP-FA14`, `STEP-FA15`
- `Blocked by`: category-threshold logic and inline low-value depreciation handling not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local below-threshold manual activation smoke verifying `ACQUISITION` plus inline `LOW_VALUE_FULL_EXPENSE`

### `STEP-FA24`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/cari.document.service.js`, `backend/src/routes/cari.document.routes.js` only if a shared helper must be extracted from the existing detail path
- `Dependencies`: `STEP-FA13`, `STEP-FA20`
- `Blocked by`: CARI document detail reuse or remaining-unit calculation rules not yet being settled
- `Rollback risk`: Medium
- `Smoke command ideas`: local eligible-AP-line read smoke with draft reservation, release, and permission checks

### `STEP-FA25`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/cari.document.service.js`, `backend/src/services/journal.source-link.service.js`
- `Dependencies`: `STEP-FA23`, `STEP-FA24`
- `Blocked by`: eligible-line read surface or low-value inline capitalization handling not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local same-OU capitalization smoke for one-unit, multi-unit, and below-threshold split cases

### `STEP-FA26`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/cari.document.service.js`, `backend/src/services/ou.self-balancing.service.js`, `backend/src/services/ou.current-account-eligibility.service.js`
- `Dependencies`: `STEP-FA25`
- `Blocked by`: OU self-balancing/current-account setup not being available in the target legal entity
- `Rollback risk`: High
- `Smoke command ideas`: local cross-OU capitalization smoke with configured and missing self-balancing setups

### `STEP-FA27`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/cari.document.service.js`
- `Dependencies`: `STEP-FA24`, `STEP-FA25`, `STEP-FA26`
- `Blocked by`: draft-link source-drift rules and activation-time refresh semantics not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local draft-link refresh/revalidation smoke for quantity drift, amount drift, and non-`POSTED` source-state blocking

### `STEP-FA28`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`
- `Dependencies`: `STEP-FA21`, `STEP-FA22`, `STEP-FA23`
- `Blocked by`: snapped asset-level depreciation fields or period-resolution rules not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local `GET /api/v1/fixed-assets/:assetId/depreciation-schedule` smoke for `STRAIGHT_LINE` and `NONE`

### `STEP-FA29`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`
- `Dependencies`: `STEP-FA28`
- `Blocked by`: standard schedule math not yet being stable enough to layer in declining-balance switching and legacy-forward logic
- `Rollback risk`: Medium
- `Smoke command ideas`: local schedule smoke for `DECLINING_BALANCE`, switch-to-straight-line, and legacy-onboarding forward schedules

### `STEP-FA30`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`
- `Dependencies`: `STEP-FA28`, `STEP-FA29`
- `Blocked by`: lifecycle history rows not yet being stable enough to drive daily-prorata eligibility
- `Rollback risk`: Medium
- `Smoke command ideas`: local schedule smoke for suspension, reactivation, transfer, disposal, and low-value exclusion cases

### `STEP-FA31`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: `STEP-FA28`, `STEP-FA29`, `STEP-FA30`
- `Blocked by`: schedule engine not yet producing stable eligible-day and allocation-row inputs
- `Rollback risk`: High
- `Smoke command ideas`: local run preview and persisted-draft creation smoke with draft-uniqueness blocking

### `STEP-FA32`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: `STEP-FA31`
- `Blocked by`: persisted draft-run snapshot shape not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local run list/detail/read smoke plus draft-delete and recreate-for-same-scope smoke

### `STEP-FA33`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/journal.source-link.service.js`
- `Dependencies`: `STEP-FA01`, `STEP-FA31`, `STEP-FA32`
- `Blocked by`: frozen draft-run snapshot or journal-number/source-link primitives not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local run-post smoke covering posting-date validation, `depreciation_kind = RUN`, and schedule-line link updates

### `STEP-FA34`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/journal.source-link.service.js`, `backend/src/services/gl.journal-reversal.service.js` only if the implementation reuses reversal primitives
- `Dependencies`: `STEP-FA33`
- `Blocked by`: run-post lineage not yet being stable enough to enforce successor-history blocking safely
- `Rollback risk`: High
- `Smoke command ideas`: local run-reverse smoke covering blocked-successor cases and clean repostability after successful reversal

### `STEP-FA35`
- `AI size`: Small
- `Allowed files`: `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`
- `Dependencies`: `STEP-FA31`
- `Blocked by`: draft-run persistence not yet being stable enough to harden with chunking
- `Rollback risk`: Medium
- `Smoke command ideas`: large local run-create smoke that forces multiple write chunks and then validates rollback on injected late-chunk failure

### `STEP-FA36`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: `STEP-FA21`
- `Blocked by`: active-asset lifecycle history or move-detail rows not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local physical-move smoke covering location, custodian, department, and cost-center updates without owner-OU changes

### `STEP-FA37`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/ou.self-balancing.service.js`, `backend/src/services/ou.current-account-eligibility.service.js`
- `Dependencies`: `STEP-FA21`, `STEP-FA30`, `STEP-FA36`
- `Blocked by`: OU self-balancing/current-account setup not being available or transfer-history rows not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local ownership-transfer smoke for non-zero-NBV and zero-NBV transfers plus optional location update

### `STEP-FA38`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`
- `Dependencies`: `STEP-FA21`, `STEP-FA28`, `STEP-FA29`, `STEP-FA30`
- `Blocked by`: disposal cutoff logic or NBV/gain-loss computation not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local write-off smoke for partially depreciated and already fully depreciated assets

### `STEP-FA39`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/cari.document.service.js`, `backend/src/routes/cari.document.routes.js` only if a shared helper extraction is required
- `Dependencies`: `STEP-FA13`, `STEP-FA21`
- `Blocked by`: AR-side exact-line linking rules or cross-module `cari.doc.*` permission checks not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local staged sale create/link/update smoke without creating a `SALE` row or disposal journal

### `STEP-FA40`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/cari.document.service.js`, `backend/src/services/journal.source-link.service.js`
- `Dependencies`: `STEP-FA39`
- `Blocked by`: exact AR-line provenance or sale-preparation linkage not yet being stable enough to finalize
- `Rollback risk`: High
- `Smoke command ideas`: local sale-finalize smoke covering exact `source_ref_line_id`, disposed-state transition, and missing-`cari.doc.post` rejection

### `STEP-FA41`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/journal.source-link.service.js`, `backend/src/services/gl.journal-reversal.service.js` only if the implementation reuses generic reversal primitives
- `Dependencies`: `STEP-FA21` to `STEP-FA40`
- `Blocked by`: authoritative reversal-lineage fields or successor-history blocking not yet being stable
- `Rollback risk`: High
- `Smoke command ideas`: local non-run reversal smoke for `CAPITALIZATION`, `OWNERSHIP_TRANSFER`, and `SALE` with successor and linked-AR blocking cases

### `STEP-FA42`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.evidence.routes.js`, `backend/src/services/evidence.service.js`, `backend/src/services/evidence.policy.service.js`, `backend/src/services/fixed-assets.scope.service.js`, `backend/src/utils/source-ref-types.js`
- `Dependencies`: `STEP-FA01`, `STEP-FA13`
- `Blocked by`: fixed-assets scope resolvers or nested route ordering not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: local asset, transaction, and run evidence create/upload/download/delete smoke

### `STEP-FA43`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `backend/src/services/journal.source-link.service.js`, `backend/src/services/gl.reverse-block-destination.service.js`, `backend/src/routes/gl.read.journal.routes.js`, `backend/src/utils/source-ref-types.js`
- `Dependencies`: `STEP-FA01`, `STEP-FA06`, `STEP-FA33`, `STEP-FA38`, `STEP-FA40`
- `Blocked by`: fixed-assets posting flows not yet emitting stable source ownership or destination-resolution rules not yet being locked
- `Rollback risk`: Medium
- `Smoke command ideas`: local journal-detail smoke for non-run and run journals with backend-owned destination metadata and fallback resolution

### `STEP-FA44`
- `AI size`: Medium
- `Allowed files`: `frontend/src/pages/fixedAssets/FixedAssetModulePage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetDepreciationRunsPage.jsx`, `frontend/src/pages/fixedAssets/FixedAssetDisposalsPage.jsx`, `frontend/src/pages/JournalWorkbenchPage.jsx`, `frontend/src/api/fixedAssets.js`, `frontend/src/utils/journalSourceLinkDestinations.js`, `frontend/src/App.jsx` only if route cleanup is required
- `Dependencies`: `STEP-FA07`, `STEP-FA19`, `STEP-FA32`, `STEP-FA39`, `STEP-FA40`, `STEP-FA43`
- `Blocked by`: backend destination metadata or fixed-assets target-page read contracts not yet being stable
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run build`; manual drillback smoke for asset-detail, run-detail, and disposal-focused navigation from Journal Workbench

### `STEP-FA45`
- `AI size`: Small
- `Allowed files`: `backend/src/seedCore.js`, `backend/src/middleware/rbac.js`, `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.evidence.routes.js`, `backend/src/routes/fixed-assets.validators.js`
- `Dependencies`: `STEP-FA01`, `STEP-FA13`, `STEP-FA42`
- `Blocked by`: secondary RBAC assertion helper or fixed-assets route skeleton not yet being in place
- `Rollback risk`: Medium
- `Smoke command ideas`: `npm run db:seed:core`; `npm run test:permission-matrix`; targeted FA06/FA11 authorization smoke by role

### `STEP-FA46`
- `AI size`: Small
- `Allowed files`: `frontend/src/layouts/sidebarConfig.js`, `frontend/src/layouts/AppLayout.jsx`, `frontend/src/App.jsx`, `frontend/src/i18n/messages.js`, `frontend/src/pages/fixedAssets/*.jsx`, `frontend/src/api/fixedAssets.js`
- `Dependencies`: `STEP-FA16`, `STEP-FA19`, `STEP-FA45`
- `Blocked by`: backend permission surfaces not yet being stable enough to mirror in the UI
- `Rollback risk`: Low
- `Smoke command ideas`: `npm run build`; role-based sidebar and action-visibility smoke in the browser

### `STEP-FA47`
- `AI size`: Medium
- `Allowed files`: `backend/src/routes/fixed-assets.routes.js`, `backend/src/routes/fixed-assets.validators.js`, `backend/src/services/fixed-assets.reporting.service.js`, `backend/src/services/fixed-assets.service.js`, `backend/src/services/fixed-assets.depreciation.service.js`, `frontend/src/pages/fixedAssets/FixedAssetReportsPage.jsx`, `frontend/src/api/fixedAssets.js`, `frontend/src/i18n/messages.js`
- `Dependencies`: `STEP-FA17` to `STEP-FA19`, `STEP-FA28` to `STEP-FA40`
- `Blocked by`: register/detail/read-side contracts or lifecycle posting data not yet being stable enough for reporting reconciliation
- `Rollback risk`: Medium
- `Smoke command ideas`: local report and `/export` endpoint smoke plus `npm run build` for the reports page

### `STEP-FA48`
- `AI size`: Small
- `Allowed files`: `backend/scripts/*`, `backend/package.json`, `frontend/package.json`, `backend/openapi.yaml`, this step-tracker document only if the release gate needs step-level wiring notes
- `Dependencies`: `STEP-FA01` to `STEP-FA47`
- `Blocked by`: any incomplete prerequisite slice in the fixed-assets track
- `Rollback risk`: Low
- `Smoke command ideas`: `npm run openapi:generate`; `npm run check:openapi`; `npm run build`; `npm run db:migrate:status`; the new fixed-assets smoke/release-gate runner when it exists

---

## Cross-Cutting Prerequisites

These are shared infrastructure prerequisites, not late feature-specific polish. They should land early because `FA06`, `FA08`, `FA12`, and `FA14` depend on them.

### Required prerequisite slices
- shared backend source-ref constants in `backend/src/utils/source-ref-types.js`
- shared frontend source-type constants in `frontend/src/utils/sourceRefTypes.js`
- extracted frontend drillback / reverse-block destination helper in `frontend/src/utils/journalSourceLinkDestinations.js` if Journal Workbench destination logic is reused outside the page
- shared backend `badRequest(message, details = null)` support in `backend/src/routes/_utils.js`
- shared secondary RBAC permission-assertion helper in `backend/src/middleware/rbac.js`
- shared-platform `journal_source_links` primary-ownership hardening slice covering real-environment data preflight, legacy duplicate-`PRIMARY` normalization, existing writer-role cleanup for shared-journal flows, and regression coverage across current non-fixed-assets journal-link producers
- shared reverse-block destination resolver in `backend/src/services/gl.reverse-block-destination.service.js`
- shared additive journal-workbench contract migration covering single-journal `source_links[].destination` enrichment, single-journal `reverseBlock` enrichment, reverse-error `details.reverseBlock`, and frontend prefer-backend/fallback-local consumption
- OpenAPI `FixedAssets` tag support and `/api/v1/fixed-assets` path inference in `backend/scripts/generate-openapi.js`

### Suggested landing order
1. `STEP-FA01`
2. `STEP-FA02` to `STEP-FA05`
3. `STEP-FA06` and `STEP-FA07`
4. `STEP-FA08`
5. `STEP-FA09` to `STEP-FA12`
6. `STEP-FA13` onward in order

### Implementation note
- treat these as explicit cross-cutting stages, not as scattered follow-up chores hidden inside whichever feature lands first
- do not hide the one-`PRIMARY` journal-link hardening work inside `STEP-FA12` as if fixed-assets alone owned that contract; fixed-assets depends on it, but existing repo writers must be brought into compliance first
- land the reverse-block / drillback contract additively: backend metadata first, frontend prefer-backend second, fixed-assets source-type routing after that, cleanup of old local assumptions last
- later feature tracks may consume these prerequisites, but should not each redefine them ad hoc in local route/page code

## `FA01` - Fixed-assets schema foundation and lifecycle invariants

### Goal
Create the minimum trustworthy schema for an OU-aware fixed-assets subledger that matches repo conventions.

### Serialized PR mapping
This feature-scope item is implemented through these linear execution steps:

1. `STEP-FA09` - `m138` base-table pass
2. `STEP-FA10` - `m138` constraint/index pass
3. `STEP-FA11` - `m139` custodian employees and deferred foreign keys
4. `STEP-FA12` - `m140` CARI traceability and `journal_source_links` schema tail

Implementation sequencing note:
- `STEP-FA09` and `STEP-FA10` are the minimum schema-foundation slices required before backend fixed-assets services can start landing safely
- `STEP-FA11` overlaps with the business surface of `FA02`, but it is also a migration-sequencing dependency because custodian foreign keys are deliberately deferred out of `m138`
- `STEP-FA12` overlaps with the business surface of `FA06` and `FA12`, but it completes the schema invariants that make CARI-linked capitalization and primary source-link ownership DB-safe rather than validator-only
- the `journal_source_links` one-`PRIMARY` guard sequenced inside `STEP-FA12` is a shared-platform migration even if its DDL lands inside the fixed-assets migration family; do not land that DDL before repo-wide writer compliance and real-environment data preflight are complete

### Required tables
- `fixed_asset_categories`
- `fixed_asset_depreciation_profiles`
- `fixed_assets`
- `fixed_asset_transactions`
- `fixed_asset_depreciation_schedule_lines`
- `fixed_asset_depreciation_runs`
- `fixed_asset_depreciation_run_lines`
- `fixed_asset_depreciation_run_line_allocations`
- `fixed_asset_physical_move_details`
- `fixed_asset_ownership_transfer_details`

Table-order note:
- this list defines FA01 scope only; it is not the migration DDL order for `m138_fixed_assets_foundation.js`
- `m138_*` must follow the dependency-safe staged-DDL rule locked in the migration-numbering section

### Required master shape
The fixed-asset master must distinguish:
- `owner_operating_unit_id`
- `location_operating_unit_id`
- `custodian_employee_id`

### Required status flow
- `DRAFT`
- `ACTIVE`
- `SUSPENDED`
- `FULLY_DEPRECIATED`
- `DISPOSED`

Status interpretation note:
- `FULLY_DEPRECIATED` also covers below-threshold low-value assets after their one-time same-period full-expense treatment
- below-threshold low-value assets move directly to `FULLY_DEPRECIATED` after same-period full-expense treatment rather than remaining `ACTIVE`
- low-value full-expense does not move the asset to `DISPOSED`
- `FULLY_DEPRECIATED` assets, including low-value tracked assets, may still later enter `SALE` or `WRITEOFF` workflows while physically held

### Required master columns
At minimum:
- `id`
- `tenant_id`
- `legal_entity_id`
- `asset_no` system-generated
- `sequence_no` system-generated
- `asset_tag` nullable
- `name`
- `description`
- `category_id`
- `status`
- `owner_operating_unit_id`
- `location_operating_unit_id`
- `department_code` nullable
- `cost_center_code` nullable
- `custodian_employee_id` nullable
- `counterparty_id` nullable
- `source_cari_document_id` nullable
- `source_cari_document_line_id` nullable
- `source_cari_document_line_unit_no` nullable
- `serial_no` nullable
- `acquisition_date`
- `capitalization_date`
- `in_service_date`
- `disposal_date` nullable
- `currency_code`
- `original_cost_txn`
- `original_cost_base`
- `salvage_rule_type`
- `salvage_percent` nullable
- `salvage_amount_base_rule` nullable
- `salvage_value_txn`
- `salvage_value_base`
- `useful_life_months`
- `remaining_useful_life_months` nullable
- `depreciation_profile_id`
- `depreciation_method`
- `declining_balance_rate_percent` nullable
- `switch_to_straight_line`
- `asset_account_id`
- `accum_depr_account_id`
- `depr_expense_account_id`
- `disposal_gain_account_id`
- `disposal_loss_account_id`
- `legacy_accum_depr_txn`
- `legacy_accum_depr_base`
- `legacy_nbv_txn`
- `legacy_nbv_base`
- `last_depreciation_period` nullable
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`

Schema interpretation note:
- this list defines the columns the fixed-asset master must own
- it does not mean every column is non-null at initial `DRAFT` creation
- row-level mandatory fields must follow the lifecycle-state rules below

Org-classification field rule:
- `department_code` and `cost_center_code` are nullable code-style classification fields
- they are not foreign keys to shared repo master tables
- do not add fixed-assets-local department/cost-center master tables in MVP
- use them for attribution, filtering, reporting, and history only

Source-line unit rule:
- `source_cari_document_line_id` keeps exact AP-line provenance for CARI-linked asset capitalization
- `source_cari_document_line_unit_no` stores the per-line asset-unit slot when one AP line creates more than one fixed-asset card
- each asset created from the same CARI AP line must use a distinct `source_cari_document_line_unit_no` starting at `1`
- while an asset is still `DRAFT`, `source_cari_document_id`, `source_cari_document_line_id`, and `source_cari_document_line_unit_no` may be set, changed, or cleared together
- a draft asset must not keep a half-linked state; for CARI linkage, `source_cari_document_line_id` and `source_cari_document_line_unit_no` are populated together or cleared together
- FA06 service logic must ensure `source_cari_document_line_unit_no` does not exceed the remaining whole-unit quantity available on the linked source line
- changing or clearing CARI linkage on a `DRAFT` asset must release the previously linked source line/unit slot immediately
- while a source-linked asset remains `DRAFT`, source-derived values copied from the linked CARI line may become stale if that draft CARI line's quantity or amounts later change
- before activation of a source-linked asset, fixed-assets must reload the current linked source line, recompute remaining unit-slot eligibility plus the per-unit split from current quantity and amounts, auto-refresh source-derived draft values, and block activation if the current source state no longer supports that linked unit slot or valid source-derived capitalization assumptions
- if a source line does not represent a positive whole-number count of identifiable asset units, or if per-unit capitalization amounts are not meant to be equal, users must split the AP line in CARI before using the multi-asset capitalization path

Legacy-onboarding field rule:
- `legacy_accum_depr_*` and `legacy_nbv_*` are manual-asset setup fields only
- they are allowed only while the asset is `DRAFT`
- they are not allowed for CARI-linked assets
- they become read-only after activation
- CARI-linked/source-linked assets must keep these fields null or zero in MVP
- these fields do not imply persisted pre-activation schedule rows; forward schedule generation starts at activation
- manual legacy onboarding assets must also carry `remaining_useful_life_months` before activation so forward scheduling has a locked horizon

Depreciation-profile snapshot rule:
- `depreciation_profile_id` keeps the originating profile reference for traceability and setup defaults
- while an asset is still `DRAFT`, changing `depreciation_profile_id` must refresh the snapped profile fields on the asset from the newly selected profile
- before activation for assets that enter the normal depreciation schedule/run path, the selected profile's depreciation-driving fields must be copied onto the asset master as `depreciation_method`, `declining_balance_rate_percent`, and `switch_to_straight_line`
- activation is the freeze point for those snapped depreciation-driving fields in MVP
- FA07/FA08 schedule generation and run posting must use the snapped asset fields together with asset-level `useful_life_months`, `remaining_useful_life_months`, salvage snapshot inputs, and resolved salvage values; do not reread mutable profile rows to determine depreciation behavior for active assets
- after activation, `depreciation_profile_id` remains a traceability/default reference only; it is not the live runtime source for depreciation behavior
- later edits to `fixed_asset_depreciation_profiles` are prospective defaults only and must not retroactively change already-activated assets

Salvage snapshot rule:
- category/default salvage setup is a pre-activation default only
- asset-level salvage provenance must be stored on the asset master through `salvage_rule_type`, `salvage_percent`, and `salvage_amount_base_rule`, using the same locked salvage rule types as category defaults
- asset-level resolved salvage amounts must also be stored on the asset master through `salvage_value_txn` and `salvage_value_base`
- while an asset is still `DRAFT`, changing category/default salvage setup or asset-level salvage inputs may refresh those asset-level salvage snapshot fields before activation
- activation is the freeze point for both the salvage snapshot inputs and the resolved salvage values in MVP
- FA07/FA08 schedule generation and run posting must use the frozen asset-level salvage fields and values, not the current category default salvage setup, once the asset is activated
- if a user overrides the default salvage setup before activation, the asset-level salvage snapshot fields must still describe the final rule inputs used at activation; do not leave salvage provenance implicit behind resolved amounts only

Custodian migration-sequencing rule:
- because `fixed_asset_custodian_employees` is introduced in `m139`, `m138` must create `fixed_assets.custodian_employee_id` as a nullable column without a foreign-key constraint
- the custodian foreign key for `fixed_assets.custodian_employee_id` is added only in `m139` after the referenced table exists

### Draft nullability matrix
Always required even in `DRAFT`:
- `legal_entity_id`
- `asset_no` once the row is inserted
- `sequence_no` once the row is inserted
- `status`
- `name`
- `category_id`
- `owner_operating_unit_id`
- `location_operating_unit_id`
- `acquisition_date`
- `currency_code`
- `original_cost_txn`
- `original_cost_base`

May be null in `DRAFT` but must resolve before `ACTIVATE`:
- `capitalization_date`
- `in_service_date`
- `depreciation_profile_id` for depreciable assets except below-threshold low-value assets that use same-period full-expense treatment
- snapped profile fields `depreciation_method` and `switch_to_straight_line`, plus `declining_balance_rate_percent` when applicable, for depreciable assets that enter the normal schedule/run path
- `useful_life_months` for depreciable assets except below-threshold low-value assets that use same-period full-expense treatment
- `remaining_useful_life_months` for manual legacy onboarding depreciable assets
- asset-level salvage snapshot fields `salvage_rule_type`, `salvage_percent` when applicable, and `salvage_amount_base_rule` when applicable; by activation they must resolve to explicit frozen rule inputs
- `salvage_value_txn` and `salvage_value_base` if not defaulted yet; by activation they must resolve to explicit numeric values consistent with the frozen salvage snapshot, including zero when applicable
- `asset_account_id` for all assets
- `disposal_gain_account_id` and `disposal_loss_account_id` for all assets
- `accum_depr_account_id` and `depr_expense_account_id` for depreciable assets

May remain nullable after activation when not applicable:
- `department_code`
- `cost_center_code`
- `custodian_employee_id`
- `counterparty_id`
- `source_cari_document_id`
- `source_cari_document_line_id`
- `source_cari_document_line_unit_no`
- `serial_no`
- `disposal_date`
- `last_depreciation_period`

Implementation rule:
- activation-only fields should be implemented as nullable schema columns plus activation-time validator/service enforcement
- do not turn activation-only requirements into row-creation `NOT NULL` constraints
- source-linked/manual workflow differences should be enforced in validators and service SQL, not left to guesswork

### Required transaction table shape
`fixed_asset_transactions` must be locked with a concrete minimum row shape, not only a table name.

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `asset_id`
- `transaction_type`
- `status`
- `effective_date`
- `posting_date` nullable
- `book_id` nullable for non-posting transaction types
- `fiscal_period_id` nullable for non-posting transaction types
- `currency_code`
- `depreciation_kind` nullable
- `gross_amount_txn` nullable
- `gross_amount_base` nullable
- `accum_depr_amount_txn` nullable
- `accum_depr_amount_base` nullable
- `nbv_amount_txn` nullable
- `nbv_amount_base` nullable
- `proceeds_amount_txn` nullable
- `proceeds_amount_base` nullable
- `journal_entry_id` nullable
- `source_ref_type` nullable
- `source_ref_id` nullable
- `source_ref_line_id` nullable
- `reversed_transaction_id` nullable
- `reversal_transaction_id` nullable convenience back-pointer only
- `note` nullable
- `created_by_user_id`
- `created_at`
- `updated_at`

Reversal-lineage note:
- `reversed_transaction_id` is the authoritative reversal lineage field in MVP
- `reversed_transaction_id` is populated on `REVERSAL` rows and null for non-`REVERSAL` transaction rows
- if `reversal_transaction_id` is retained, it is a nullable convenience backlink on the original transaction row and must not be the required source of truth for reversal lineage
- if `reversal_transaction_id` is retained, do not require it to be enforced as a second self-referencing foreign key in MVP

Required transaction types at minimum:
- `ACQUISITION`
- `CAPITALIZATION`
- `DEPRECIATION`
- `SUSPEND`
- `REACTIVATE`
- `PHYSICAL_MOVE`
- `OWNERSHIP_TRANSFER`
- `WRITEOFF`
- `SALE`
- `REVERSAL`

Locked transaction-type semantics:
- `ACQUISITION` = manual asset activation event, including legacy onboarding of pre-existing / go-live assets
- for manual legacy onboarding / go-live assets, `ACQUISITION` is an onboarding/audit event and `journal_entry_id` stays null in MVP because no new acquisition is being booked
- `CAPITALIZATION` = CARI-linked capitalization into the fixed-assets subledger
- for CARI-backed transactions, `source_ref_type` must use `CARI_DOCUMENT`; line-level provenance belongs in `source_ref_line_id`, not a separate `CARI_DOCUMENT_LINE` source type
- `DEPRECIATION` = posted depreciation event, including the one-time low-value same-period full-expense posting used for below-threshold new-asset activation/capitalization paths in MVP
- `depreciation_kind = RUN` identifies depreciation created by the FA08 run posting flow
- `depreciation_kind = LOW_VALUE_FULL_EXPENSE` identifies inline same-period full-expense created during low-value activation/capitalization
- `depreciation_kind` must not be left implicit or inferred only from surrounding workflow context
- the conditional `transaction_type <-> depreciation_kind` rule is validator/service-SQL enforced in MVP: `depreciation_kind` is required on `DEPRECIATION` rows and must be null on non-`DEPRECIATION` rows
- do not introduce a DB-level `CHECK` constraint for the `transaction_type <-> depreciation_kind` rule in MVP unless the repo's broader database-constraint strategy changes
- `SUSPEND` = explicit lifecycle-history event that moves an asset into `SUSPENDED`
- `REACTIVATE` = explicit lifecycle-history event that returns a suspended asset to active depreciation eligibility from the reactivation-effective period
- `SUSPEND` and `REACTIVATE` are transaction-backed audit events even when they do not create journals in MVP
- `PHYSICAL_MOVE` = explicit non-accounting placement/responsibility change event and must have one `fixed_asset_physical_move_details` row capturing from/to location, custodian, department-code, and cost-center-code snapshots
- `OWNERSHIP_TRANSFER` = explicit owner-OU change event and must have one `fixed_asset_ownership_transfer_details` row capturing from/to owner-OU snapshots plus any optional location-update snapshot
- `WRITEOFF` = retirement/disposal with no customer proceeds
- `SALE` = retirement/disposal subtype with customer proceeds, represented by one `SALE` row only
- `REVERSAL` = source-owned reversal event for a previously posted non-run fixed-assets transaction reversed through fixed-assets
- `REVERSAL` lineage is carried authoritatively by `reversed_transaction_id`; if `reversal_transaction_id` is retained, it may be updated later on the original row as convenience state only
- do not create duplicate `ACQUISITION` + `CAPITALIZATION` rows for one event
- do not introduce a separate `LOW_VALUE_EXPENSE` transaction type in MVP
- do not introduce a separate generic `DISPOSAL` transaction type in MVP

Required transaction statuses at minimum:
- `DRAFT`
- `POSTED`
- `REVERSED`
- `CANCELLED`

Transaction-status interpretation note:
- `POSTED` means the transaction is finalized in the fixed-assets subledger, not necessarily that it posted a GL journal
- `journal_entry_id` remains the independent indicator of whether that transaction also produced a journal entry
- non-journal transactions such as legacy onboarding `ACQUISITION`, `SUSPEND`, `REACTIVATE`, and `PHYSICAL_MOVE` may therefore reach `POSTED` with `journal_entry_id = null`

Journal linkage belongs here, not on the asset master.

### Required depreciation schedule line shape
`fixed_asset_depreciation_schedule_lines` must be locked with a minimum row shape.

Book-scope note:
- schedule lines are intentionally not book-scoped in MVP because fixed-assets depreciation is single-book operationally per `(tenant_id, legal_entity_id)`

Period-key note:
- `period_key` uses the locked calendar `YYYY-MM` format
- schedule lines represent only non-adjustment fixed-assets periods in MVP
- schedule lines must not be generated for adjustment periods or non-month-aligned fiscal periods in MVP

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `asset_id`
- `period_key`
- `line_no`
- `planned_amount_txn`
- `planned_amount_base`
- `opening_nbv_txn`
- `opening_nbv_base`
- `closing_nbv_txn`
- `closing_nbv_base`
- `status`
- `posted_run_line_id` nullable
- `posted_transaction_id` nullable
- `created_at`
- `updated_at`

Required schedule line statuses at minimum:
- `PLANNED`
- `POSTED`
- `SKIPPED`
- `REVERSED`

Schedule-line reversal note:
- `REVERSED` is the explicit status for a schedule line whose previously posted depreciation result was rolled back through a run reversal
- do not collapse a reversed posted line back into an untouched `PLANNED` state because that would discard line-level reversal auditability
- a later repost for the same asset and period may attach a new posted result to that schedule line after reversal handling clears the current posted-link fields

### Required depreciation run header shape
`fixed_asset_depreciation_runs` must be locked with a minimum row shape.

Period-key note:
- `period_key` uses the same locked calendar `YYYY-MM` format
- `fiscal_period_id` remains authoritative and the stored `period_key` must match the referenced non-adjustment fiscal period used by the run

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `book_id`
- `fiscal_period_id`
- `period_key`
- `status`
- `asset_count`
- `posted_asset_count`
- `skipped_asset_count`
- `error_count`
- `total_planned_amount_txn`
- `total_planned_amount_base`
- `total_posted_amount_txn`
- `total_posted_amount_base`
- `posted_journal_entry_id` nullable if run-level journal aggregation is used
- `reversal_journal_entry_id` nullable if run-level reversal journal aggregation is used
- `created_by_user_id`
- `posted_by_user_id` nullable
- `reversed_by_user_id` nullable
- `created_at`
- `posted_at` nullable
- `reversed_at` nullable

Required run statuses at minimum:
- `DRAFT`
- `POSTED`
- `REVERSED`

### Required depreciation run-line shape
`fixed_asset_depreciation_run_lines` must be locked with a minimum row shape.

Period-key note:
- `period_key` uses the same locked calendar `YYYY-MM` format
- when `fiscal_period_id` is present, `period_key` must match the referenced non-adjustment fiscal period used by the run line

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `run_id`
- `asset_id`
- `fiscal_period_id`
- `period_key`
- `schedule_line_id` nullable
- `eligible_days`
- `days_in_period`
- `planned_amount_txn`
- `planned_amount_base`
- `status`
- `posted_transaction_id` nullable
- `skip_reason_code` nullable
- `skip_reason_text` nullable
- `error_code` nullable
- `error_message` nullable
- `created_at`
- `updated_at`

Required run-line statuses at minimum:
- `READY`
- `POSTED`
- `SKIPPED`
- `ERROR`
- `REVERSED`

### Required depreciation run-line allocation shape
`fixed_asset_depreciation_run_line_allocations` must be locked with a minimum row shape.

Period-key note:
- `period_key` uses the same locked calendar `YYYY-MM` format
- when `fiscal_period_id` is present, `period_key` must match the referenced non-adjustment fiscal period used by the parent run line allocation context

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `run_line_id`
- `asset_id`
- `fiscal_period_id`
- `period_key`
- `allocation_type`
- `operating_unit_id` nullable
- `from_date`
- `to_date`
- `eligible_days`
- `planned_amount_txn`
- `planned_amount_base`
- `created_at`
- `updated_at`

Locked allocation rules:
- MVP uses `fixed_asset_depreciation_run_line_allocations` as the stronger audit model for partial-period depreciation allocation context
- `allocation_type` uses uppercase repo-style values
- locked MVP allocation types are:
  - `OWNER_OU`
- each allocation row represents one contiguous eligible-day segment inside the run-line period
- `from_date` and `to_date` are inclusive segment boundaries
- `eligible_days` must equal the inclusive day count for that segment
- `planned_amount_txn` and `planned_amount_base` store the prorated depreciation amount allocated to that segment
- when no mid-period ownership transfer occurs, MVP may still persist one `OWNER_OU` allocation row covering the full eligible segment for stronger audit consistency
- when a mid-period ownership transfer occurs, MVP must persist separate `OWNER_OU` allocation rows for the source OU segment and target OU segment
- allocation rows are audit context for the frozen run snapshot and journal support; they do not authorize multiple normal `DEPRECIATION` transaction rows for the same asset and fiscal period

Required allocation types at minimum:
- `OWNER_OU`

Allocation interpretation note:
- this table persists the segmented allocation context behind one run line when prorata depreciation must be allocated across more than one owner OU inside the same fiscal month
- for MVP, the primary required use case is mid-period ownership transfer under `DAILY_PRORATA`
- do not represent transfer-month OU split only as a derived reporting inference from one aggregate run-line total

### Required physical-move detail shape
`fixed_asset_physical_move_details` must be locked with a minimum row shape.

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `transaction_id`
- `asset_id`
- `from_location_operating_unit_id`
- `to_location_operating_unit_id`
- `from_custodian_employee_id` nullable
- `to_custodian_employee_id` nullable
- `from_department_code` nullable
- `to_department_code` nullable
- `from_cost_center_code` nullable
- `to_cost_center_code` nullable
- `created_at`
- `updated_at`

Locked physical-move detail rules:
- each row is the required child-detail record for one `PHYSICAL_MOVE` transaction
- from/to snapshot fields are DB-backed history, not free-text note substitutes
- if a specific dimension is unchanged during the workflow, the from/to values for that dimension may still be stored as equal values for auditable event preservation
- parent-row existence and one-detail-row-per-transaction must be DB-backed through foreign-key and uniqueness constraints
- parent `transaction_type = PHYSICAL_MOVE` compatibility is not cleanly enforceable by plain MySQL foreign key alone and must therefore be enforced in validators/service SQL unless triggers are introduced later

### Required ownership-transfer detail shape
`fixed_asset_ownership_transfer_details` must be locked with a minimum row shape.

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `transaction_id`
- `asset_id`
- `from_owner_operating_unit_id`
- `to_owner_operating_unit_id`
- `from_location_operating_unit_id`
- `to_location_operating_unit_id`
- `created_at`
- `updated_at`

Locked ownership-transfer detail rules:
- each row is the required child-detail record for one `OWNERSHIP_TRANSFER` transaction
- from/to owner-OU values are DB-backed history, not inferred only from asset master before/after state
- optional FA10 location updates must be preserved here as explicit from/to snapshot values
- parent-row existence and one-detail-row-per-transaction must be DB-backed through foreign-key and uniqueness constraints
- parent `transaction_type = OWNERSHIP_TRANSFER` compatibility is not cleanly enforceable by plain MySQL foreign key alone and must therefore be enforced in validators/service SQL unless triggers are introduced later

### Required constraints
- unique `(tenant_id, legal_entity_id, asset_no)` constraint for system-generated asset numbering
- unique `(tenant_id, legal_entity_id, sequence_no)` constraint for the reserved backend asset sequence
- unique `(tenant_id, source_cari_document_line_id, source_cari_document_line_unit_no)` constraint for CARI-linked asset provenance so one AP line may create multiple assets but each consumed unit-slot is used at most once
- that CARI source-line/unit uniqueness applies only to currently non-null linked values; cleared or deleted `DRAFT` assets must not keep reserving a source line/unit slot
- unique persisted-`DRAFT` run constraint for at most one `(tenant_id, legal_entity_id, book_id, fiscal_period_id)` run in `DRAFT`
- unique asset-period depreciation posting constraint
- the unique asset-period depreciation posting constraint is intentionally not book-qualified in MVP because fixed-assets is single-book operationally per `(tenant_id, legal_entity_id)`
- the unique asset-period depreciation posting constraint must apply only to the current effective posted depreciation result for that asset-period, not to historical reversed rows
- reversal-safe reposting is a locked requirement: historical `REVERSED` depreciation rows must remain queryable while a later repost for the same asset-period is still DB-permissible
- unique non-null `fixed_asset_transactions.reversed_transaction_id` constraint so one posted source-owned transaction cannot be reversed more than once
- `fixed_asset_transactions.reversed_transaction_id` must carry the authoritative self-reference for reversal lineage in MVP
- if `fixed_asset_transactions.reversal_transaction_id` is retained, it must not be relied on as the only DB-backed reversal-lineage guard
- `journal_source_links` must enforce at most one `PRIMARY` link per journal through a DB-backed MySQL-realistic workaround; fixed-assets generated journals must always write exactly one owning `PRIMARY` link
- custodian foreign-key constraints are introduced in `m139` after `fixed_asset_custodian_employees` exists; `m138` carries only the nullable custodian reference columns on `fixed_assets` and `fixed_asset_physical_move_details`
- each `fixed_asset_physical_move_details.transaction_id` must reference one `PHYSICAL_MOVE` transaction
- each `fixed_asset_ownership_transfer_details.transaction_id` must reference one `OWNERSHIP_TRANSFER` transaction
- for move/transfer child tables, DB-backed enforcement in MVP means foreign-key parent existence plus uniqueness of one detail row per transaction
- for move/transfer child tables, transaction-type compatibility with the parent fixed-asset transaction must be enforced in validators/service SQL unless a later phase adds triggers
- the `transaction_type <-> depreciation_kind` rule is likewise enforced in validators/service SQL in MVP rather than through a DB-level `CHECK` constraint
- for normal FA08 depreciation posting, MVP creates at most one `DEPRECIATION` transaction row per asset and fiscal period
- each `fixed_asset_depreciation_run_line_allocations.run_line_id` must reference one run line
- when a mid-period ownership transfer causes OU split, represent that split in `fixed_asset_depreciation_run_line_allocations` plus journal lines, not by creating multiple normal `DEPRECIATION` transaction rows for the same asset and fiscal period
- useful indexes for:
  - asset number lookup
  - legal entity + owner OU + status register filtering
  - source CARI lookup
  - depreciation-run reporting
- useful indexes are also required for:
  - run-line allocation lookup
  - asset + fiscal period allocation reporting
  - operating-unit allocation reporting
- useful indexes are also required for move/transfer detail lookup and asset-history reporting on `fixed_asset_physical_move_details` and `fixed_asset_ownership_transfer_details`

Migration design note:
- the repo uses MySQL-backed migrations, so do not assume a partial unique index is directly available or portable for the persisted-`DRAFT` run rule
- do not add a DB-level `CHECK` constraint for the conditional `depreciation_kind` rule in MVP; enforce it in validators/service SQL to stay aligned with repo-native enforcement patterns
- if the target DB engine cannot enforce the condition through a direct conditional unique index, implement the rule with an engine-realistic DB-backed strategy such as a generated discriminator column or equivalent composite uniqueness workaround
- apply that same MySQL-realistic generated-discriminator / current-posted-marker or equivalent DB-backed strategy to the asset-period depreciation posting uniqueness rule so uniqueness covers only the current effective posted result and does not strand repost after reversal
- apply the same MySQL-realistic generated-discriminator or equivalent workaround strategy to the repo-wide `journal_source_links` at-most-one-`PRIMARY`-per-journal rule, and normalize any legacy duplicate-`PRIMARY` data before turning that uniqueness guard on
- do not leave the persisted-`DRAFT` run uniqueness rule as service-only logic
- `m138_fixed_assets_foundation.js` must also use dependency-safe staged DDL for intra-`m138` references instead of assuming every foreign key can be declared inline during first-pass table creation
- when intra-`m138` forward or circular references exist, create the columns first and add the foreign-key constraints later via `ALTER TABLE` after both referenced tables exist

### Acceptance
- schema supports owner OU, location OU, and custodian as separate concepts
- schema supports dual-amount acquisition data
- schema supports lifecycle history and journal traceability
- schema supports persisted owner-OU allocation segments for prorata transfer-month depreciation auditability
- schema supports DB-backed physical-move and ownership-transfer detail history instead of relying on generic notes
- schema distinguishes DB-backed child-row existence/uniqueness from validator-enforced move/transfer transaction-type compatibility
- schema supports DB-backed backend-reserved asset numbering with locked `FA-######` display format
- schema keeps `book_id` off the asset master and on posting-bearing rows only
- key schema guards are DB-backed, and any MySQL-enforcement limits are called out explicitly instead of being left implicit

---

## `FA02` - Interim custodian setup

### Goal
Provide a lightweight interim custodian surface without blocking on a future HR-grade employee module.

### Required table
- `fixed_asset_custodian_employees`

Implementation note:
- `m139_fixed_asset_custodian_employees.js` owns creation of `fixed_asset_custodian_employees`
- `m139_fixed_asset_custodian_employees.js` also adds the foreign-key constraints for:
  - `fixed_assets.custodian_employee_id`
  - `fixed_asset_physical_move_details.from_custodian_employee_id`
  - `fixed_asset_physical_move_details.to_custodian_employee_id`

### Minimum fields
- `id`
- `tenant_id`
- `legal_entity_id`
- `employee_code`
- `display_name`
- `operating_unit_id` nullable
- `status` using uppercase repo style such as `ACTIVE` / `INACTIVE`
- `notes` nullable
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`

### Acceptance
- asset forms can assign a custodian
- register/detail/reporting can display custodian responsibility
- future HR integration remains possible

---

## `FA03` - Categories and depreciation profiles

### Goal
Provide repo-native defaults for account mapping and depreciation behavior.

### Scope
- CRUD for categories
- CRUD for depreciation profiles
- category defaults for:
  - threshold
  - useful life
  - depreciation profile
  - salvage defaults
  - asset account
  - accumulated depreciation account
- depreciation expense account
- disposal gain account
- disposal loss account

### Required category table shape
`fixed_asset_categories` must be defined with real field rules before implementation starts.

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `code`
- `name`
- `status`
- `description` nullable
- `capitalization_threshold_base`
- `default_useful_life_months`
- `default_salvage_rule_type`
- `default_salvage_percent` nullable
- `default_salvage_amount_base` nullable
- `default_depreciation_profile_id` nullable
- `default_asset_account_id` nullable
- `default_accum_depr_account_id` nullable
- `default_depr_expense_account_id` nullable
- `default_disposal_gain_account_id` nullable
- `default_disposal_loss_account_id` nullable
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`

Locked category rules:
- categories are scoped by `tenant_id` + `legal_entity_id`
- `code` is unique within `(tenant_id, legal_entity_id)`
- `name` is not DB-unique within `(tenant_id, legal_entity_id)` in MVP; duplicate display names are allowed and `code` remains the unique business key
- `status` uses uppercase repo-native values such as `ACTIVE` / `INACTIVE`
- `capitalization_threshold_base` is a base-currency amount only
- do not add a transaction-currency threshold field on category defaults in MVP
- threshold defines low-value same-period full-expense treatment in MVP for new manual activations and CARI capitalization events; those below-threshold new assets may still be tracked in fixed-assets, but they are not eligible for normal depreciation schedule/run treatment
- that threshold rule is prospective for new manual activations and CARI capitalization events; it is not retroactively applied to manual legacy onboarding in MVP
- salvage defaults must use an explicit rule, not a vague nullable number
- category salvage defaults are setup defaults only; before activation, assets must snapshot `salvage_rule_type`, `salvage_percent`, `salvage_amount_base_rule`, and resolved salvage values onto the asset master
- category default GL accounts must satisfy the locked fixed-assets expected account types and the locked legal-entity chart-of-accounts ownership rule; do not allow a category default account override to bypass account-type or legal-entity validation

Locked salvage rule types:
- `NONE`
- `FIXED_BASE_AMOUNT`
- `PERCENT_OF_COST`

### Required depreciation profile table shape
`fixed_asset_depreciation_profiles` also needs a locked minimum shape.

Minimum columns:
- `id`
- `tenant_id`
- `legal_entity_id`
- `code`
- `name`
- `status`
- `method`
- `declining_balance_rate_percent` nullable
- `switch_to_straight_line` boolean
- `description` nullable
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`

Locked profile rules:
- profiles are scoped by `tenant_id` + `legal_entity_id`
- `code` is unique within `(tenant_id, legal_entity_id)`
- `name` is not DB-unique within `(tenant_id, legal_entity_id)` in MVP; duplicate display names are allowed and `code` remains the unique business key
- `status` uses uppercase repo-native values such as `ACTIVE` / `INACTIVE`
- `method` uses uppercase repo-native values
- profiles are setup/default templates, not live behavior rows for already-activated assets
- `DECLINING_BALANCE` is not implementable unless a rate is locked
- lock MVP declining-balance configuration to `declining_balance_rate_percent`
- `declining_balance_rate_percent` is an annual nominal percentage rate in MVP, not a monthly input
- `switch_to_straight_line` means a permanent switch using the locked schedule-engine comparison rule; it is not an advisory flag
- when `method = DECLINING_BALANCE`, `declining_balance_rate_percent` is required
- when `method <> DECLINING_BALANCE`, `declining_balance_rate_percent` must be null
- while an asset remains `DRAFT`, changing the selected profile may update the asset's snapped profile fields to match the current selected template
- assets that enter the normal depreciation path must snapshot `method`, `declining_balance_rate_percent`, and `switch_to_straight_line` from the selected profile at activation
- once activated, the asset's snapped fields become authoritative and `depreciation_profile_id` remains for traceability/default lineage only
- later profile edits are prospective only; they may affect future assets or still-`DRAFT` assets before activation, but must not retroactively alter already-activated assets

### Profile methods
- `STRAIGHT_LINE`
- `DECLINING_BALANCE`
- `NONE`

### Acceptance
- category defaults prefill manual and CARI-linked asset creation
- later category salvage-default edits are prospective only because activated assets keep frozen asset-level salvage-rule inputs and resolved salvage values
- depreciation-profile edits do not retroactively change depreciation behavior for already-activated assets because activation snapshots the depreciation-driving profile fields onto the asset
- `DRAFT` assets may still refresh their snapped profile fields by selecting a different profile before activation
- profile/category enums remain uppercase
- category/profile uniqueness follows the repo-native code-first pattern rather than DB-enforced name uniqueness
- category/profile schema is concrete enough to implement without guessing missing fields
- implementation uses validators plus service SQL, not entity classes

---

## `FA04` - Asset register and detail foundation

### Goal
Build the core register and detail experience.

### Scope
- register page
- detail page with tabs for:
  - overview
  - accounting
  - depreciation schedule
  - transactions
  - evidence
  - audit trail

### Required list filters
- legal entity
- owner operating unit
- location operating unit
- category
- status
- acquisition date range
- in-service date range
- department code
- cost center code
- custodian
- disposed yes/no

### Filter semantics
- `department_code` and `cost_center_code` filters must operate on nullable code-style asset fields
- do not assume shared lookup/master tables exist behind these filters in MVP
- the register/detail experience should present them as classification dimensions, not as fixed-assets-owned master data

### Acceptance
- owner OU and location OU remain visibly distinct
- dual-amount reporting is supported where needed
- detail page is the traceability hub for lifecycle events
- detail/reporting surfaces that expose depreciation setup should show both the linked `depreciation_profile_id` and the snapped asset-level depreciation-driving values so profile lineage and frozen runtime behavior remain explainable
- department/cost-center presentation does not imply nonexistent foreign-key master data

---

## `FA05` - Manual create/edit/activate workflow

### Goal
Allow finance/admin users to create, edit, and activate assets manually.

### Validation requirements
- legal entity required
- owner OU required
- location OU required
- category required
- `original_cost_txn > 0`
- `original_cost_base > 0`
- `DRAFT` save may leave activation-only fields unresolved
- `capitalization_date` is required before activation
- `in_service_date` is required before activation
- in-service date cannot precede acquisition date
- `depreciation_profile_id` is required before activation for depreciable assets except below-threshold low-value assets without legacy onboarding values that use same-period full-expense treatment
- while status = `DRAFT`, changing `depreciation_profile_id` must refresh the snapped profile fields on the asset before any activation-time schedule/run eligibility logic is evaluated
- activation must snapshot the selected profile's `method`, `declining_balance_rate_percent`, and `switch_to_straight_line` fields onto the asset master before schedule generation or run eligibility is derived for normal depreciable assets
- activation freezes those snapped fields as the authoritative depreciation inputs for the active asset in MVP
- `useful_life_months` is required before activation for depreciable assets except below-threshold low-value assets without legacy onboarding values that use same-period full-expense treatment
- `remaining_useful_life_months` is required before activation for manual legacy onboarding depreciable assets
- salvage snapshot inputs must resolve before activation: `salvage_rule_type`, `salvage_percent` when applicable, `salvage_amount_base_rule` when applicable, and resolved `salvage_value_txn` / `salvage_value_base`, including zero when applicable
- account mappings required before activation
- account mappings and any category-default or override account values used at activation must satisfy the locked expected account types and the locked legal-entity chart-of-accounts ownership rule:
  - `asset_account_id` -> `ASSET`
  - `accum_depr_account_id` -> `ASSET`
  - `depr_expense_account_id` -> `EXPENSE`
  - `disposal_gain_account_id` -> `REVENUE`
  - `disposal_loss_account_id` -> `EXPENSE`
- if legacy onboarding values are supplied, the asset must be manual and still `DRAFT`
- if legacy onboarding values are supplied, `legacy_accum_depr_txn <= original_cost_txn`
- if legacy onboarding values are supplied, `legacy_accum_depr_base <= original_cost_base`
- if legacy onboarding values are supplied, `legacy_nbv_txn = original_cost_txn - legacy_accum_depr_txn`
- if legacy onboarding values are supplied, `legacy_nbv_base = original_cost_base - legacy_accum_depr_base`
- if legacy onboarding values are supplied, legacy NBV must not be below salvage value in either txn or base amount
- if `original_cost_base` is below the category `capitalization_threshold_base` and legacy onboarding values are not supplied, activation must route the asset through the dedicated low-value same-period full-expense path
- if legacy onboarding values are supplied and `original_cost_base` is below the category `capitalization_threshold_base`, activation must not auto-route the asset through same-period full-expense solely because of the current threshold
- below-threshold low-value assets without legacy onboarding values may still be activated for tracking, but they are not eligible for normal depreciation scheduling or depreciation runs in MVP
- below-threshold low-value assets without legacy onboarding values use one-time same-period full-expense treatment through a `DEPRECIATION` transaction created during activation
- that inline low-value `DEPRECIATION` row must carry `depreciation_kind = LOW_VALUE_FULL_EXPENSE`
- below-threshold low-value assets without legacy onboarding values must resolve `salvage_rule_type = NONE`, `salvage_percent = null`, `salvage_amount_base_rule = null`, `salvage_value_txn = 0`, and `salvage_value_base = 0` before activation
- below-threshold low-value assets without legacy onboarding values do not require normal depreciation profile/life inputs for activation because they do not enter the normal schedule/run path
- below-threshold manual legacy onboarding imports follow the legacy onboarding carry-forward path instead; if imported legacy onboarding state retains remaining depreciable amount, they still require the forward-depreciation inputs needed for onboarding continuity
- while status = `DRAFT`, source CARI linkage may be changed or cleared; switching from one source line/unit to another must release the old link before activation
- before activation of a source-linked `DRAFT` asset, fixed-assets must reload the current linked CARI document/line and revalidate current document status, quantity, currency, txn/base amounts, linked unit-slot availability, and any per-unit threshold-path implications from the current source line
- when that activation-time revalidation detects drift on source-derived CARI fields for a still-`DRAFT` linked asset, activation preflight must auto-refresh those source-derived values before final validation
- if the current source line no longer supports the reserved unit slot or the source-derived drift cannot be reconciled safely, activation must block until the asset draft is refreshed, relinked, or the source document is corrected

### Posting requirement
Every activation or posting action must explicitly validate:
- book
- open fiscal period
- legal posting date

Book resolution rule for these actions:
- accept `bookId` in the request payload when supplied
- otherwise resolve the book via the repo's existing legal-entity book selection pattern
- do not persist a resolved `book_id` onto the asset master

### Locked edit policy after `ACTIVE`
Once activated:
- `owner_operating_unit_id` changes only through ownership transfer
- `location_operating_unit_id` changes only through physical move
- `custodian_employee_id` changes only through physical move / reassignment workflow
- legacy onboarding accumulated depreciation / legacy onboarding NBV fields are locked
- category, depreciation profile, snapped depreciation-driving profile fields, useful life, remaining useful life, salvage values/rules, mapped accounts, and source CARI linkage are not silently editable in MVP
- FA07/FA08 must continue using the snapped asset-level depreciation fields after activation rather than reloading the current profile row

Draft-link mutability note:
- before activation, a `DRAFT` asset may change or clear its source CARI linkage
- while it remains `DRAFT`, source-derived values from the linked CARI line may be auto-refreshed from current source state without replacing user-owned setup choices such as category, owner OU, or location OU
- if a `DRAFT` asset is deleted later, the deleted row must release any linked source line/unit slot rather than leaving the CARI line effectively reserved

### Legacy onboarding rule
- legacy onboarding values are supported only for manually created assets and only while the asset is `DRAFT`
- after activation, legacy onboarding fields are immutable
- CARI-linked assets do not support legacy onboarding values in MVP
- manual legacy onboarding assets must capture `remaining_useful_life_months` before activation
- activation of a manual legacy onboarding / go-live asset still creates one `ACQUISITION` transaction row for asset history
- that onboarding `ACQUISITION` row does not post a new acquisition journal in MVP and `journal_entry_id` remains null
- legacy onboarding values seed forward depreciation scheduling from the activation state rather than generating historical schedule lines
- below-threshold manual legacy onboarding imports use the same carry-forward onboarding rule; they do not auto-create same-period full-expense `DEPRECIATION` solely because of the current threshold
- if a below-threshold manual legacy onboarding import already has zero remaining depreciable amount at activation, it may enter `FULLY_DEPRECIATED` without any new onboarding journal beyond the non-posting onboarding `ACQUISITION` row

### Acceptance
- draft save exists before activation
- activation creates auditable lifecycle transactions
- manual activation creates one `ACQUISITION` transaction row, not both `ACQUISITION` and `CAPITALIZATION`
- manual legacy onboarding / go-live assets create one `ACQUISITION` row for onboarding history without duplicating a fresh GL acquisition journal
- below-threshold manual assets without legacy onboarding values create one `ACQUISITION` row plus one same-period `DEPRECIATION` row, remain tracked, end with zero NBV, and do not become `DISPOSED`
- below-threshold manual assets without legacy onboarding values are treated as `FULLY_DEPRECIATED` after the one-time same-period full-expense posting
- below-threshold manual legacy onboarding / go-live assets do not auto-create same-period full-expense `DEPRECIATION` solely because of the current threshold
- below-threshold manual legacy onboarding / go-live assets follow imported legacy onboarding values and may continue forward depreciation from legacy NBV when remaining depreciable amount exists
- schedule generation is explicit and repeatable
- manual go-live assets with legacy onboarding values generate forward-only schedules without historical backfill

---

## `FA06` - CARI AP-line capitalization

### Goal
Create or activate assets from CARI AP document lines with source traceability.

### Locked model
- MVP targets AP-direction CARI documents
- one AP-direction source line may create multiple fixed-asset cards
- each created asset card represents one identifiable fixed-asset unit from that source line
- FA06 must assign a distinct `source_cari_document_line_unit_no` to each asset created from the same source line
- FA06 eligible-line selection must be based on remaining capitalizable unit count from the source line, not on excluding the line after the first linked asset
- total consumed unit slots for a source line must not exceed the source line `quantity`
- if `quantity > 1`, FA06 may create multiple asset cards from the same AP line; if `quantity = 1`, the normal single-asset path applies
- if a source line is meant to produce multiple asset cards, MVP assumes equal per-unit capitalization amount from the line totals divided by quantity
- if per-unit capitalization amounts are not equal, or the line quantity does not represent a positive whole-number identifiable asset count, users must split the AP line in CARI before capitalization
- in MVP, one FA06 capitalization request may create multiple asset cards from one AP source line, but all units created within that request must share one `categoryId`, one `ownerOperatingUnitId`, one `locationOperatingUnitId`, one capitalization/in-service date set, and one accounting treatment path
- if different subsets of the same source line must belong to different owner OUs, locations, categories, or capitalization/in-service setups, users must perform multiple FA06 capitalization requests against that source line's remaining unconsumed unit quantity
- FA06 must accept an explicit request-level `unitCount`
- `unitCount` must be a positive whole number and must not exceed the remaining unconsumed unit quantity on the selected source line
- when a multi-create request is accepted, FA06 must allocate `source_cari_document_line_unit_no` values deterministically from the lowest currently available unit slots on that source line
- one multi-create FA06 request is atomic inside one repo-native transaction boundary; if any requested unit fails validation or posting, none of the requested units are created/activated
- for CARI-created assets, `owner_operating_unit_id` may differ from `cari_documents.operating_unit_id`
- when owner OU differs from the source CARI/AP document OU, FA06 must not silently allow the mismatch without accounting treatment
- for FA06, `cari_documents.operating_unit_id` is the source/payer OU on the AP side and `owner_operating_unit_id` is the economic asset owner OU
- when source/payer OU and owner OU are the same, FA06 uses normal same-OU capitalization with no inter-OU self-balancing lines
- when source/payer OU and owner OU differ, FA06 must use the locked direct cross-OU due-to/due-from capitalization template in MVP; do not route that mismatch through a same-date FA10-compatible ownership-transfer posting
- the locked FA06 direct cross-OU capitalization journal template is:
  - debit fixed-asset account in the owner OU for the capitalized gross cost
  - credit directional self-balancing `targetDueToAccount` in the owner OU for the same amount
  - debit directional self-balancing `sourceDueFromAccount` in the source/payer OU for the same amount
  - credit AP/vendor or AP-clearing in the source/payer OU for the same amount, following the repo's CARI/AP posting shape
- resolve that directional self-balancing pair by calling `resolveOuSelfBalancingAccountsTx` with the CARI document OU as `sourceOperatingUnitId` and the asset owner OU as `targetOperatingUnitId`
- if the needed OU self-balancing / current-account setup is unavailable, FA06 must block the request rather than persisting a cross-OU ownership mismatch with no balancing entry
- capitalization follows option A:
  - AP line posts directly to the fixed-asset account
  - the fixed-assets subledger records one `CAPITALIZATION` transaction row per created asset card
  - do not also create an `ACQUISITION` transaction row for the same CARI-linked event
- FA06 capitalization provenance on `fixed_asset_transactions` must use:
  - `source_ref_type = CARI_DOCUMENT`
  - `source_ref_id = source_cari_document_id`
  - `source_ref_line_id = source_cari_document_line_id`
- for multi-asset capitalization from one source line, each asset's `original_cost_*` defaults to the per-unit split derived from the source line amounts and quantity
- threshold comparison for FA06 must be applied per created asset card's `original_cost_base`, not only against the unsplit full source-line amount
- if the resulting per-asset amount maps to `original_cost_base` below the category `capitalization_threshold_base`, that asset may still be created for control/tracking but must use the dedicated low-value same-period full-expense path instead of normal depreciation treatment
- low-value same-period full-expense in FA06 is represented by one `DEPRECIATION` transaction row created during capitalization
- that inline low-value `DEPRECIATION` row must carry `depreciation_kind = LOW_VALUE_FULL_EXPENSE`

### Required workflow
- select eligible CARI AP line
- validate source line rules
- determine request-level `unitCount` from the remaining asset units still capitalizable on the selected line
- choose one shared category for all units created in the request
- choose one shared owner OU for all units created in the request
- choose one shared location OU for all units created in the request
- choose one shared in-service date and capitalization date set for all units created in the request
- create draft asset(s) or activate asset(s)

### Locked request shape rule
- MVP FA06 does not accept a per-unit `assets[]` payload for mixed owner/category/location/accounting treatment inside one request
- the request shape is a shared-setup batch model, not a per-unit asset-card editor
- the minimum request shape includes:
  - `sourceCariDocumentLineId`
  - `unitCount`
  - `categoryId`
  - `ownerOperatingUnitId`
  - `locationOperatingUnitId`
  - `capitalizationDate`
  - `inServiceDate`
- later enhancement may add optional per-unit descriptive metadata such as asset tag, serial number, or display-name suffix, but MVP does not allow per-unit owner OU, location OU, category, or accounting-path divergence within one FA06 request

### Required permission behavior
- FA06 requires fixed-assets permissions and `cari.doc.read`
- do not expose eligible AP lines to users who lack `cari.doc.read`
- if the FA06 flow later triggers CARI-side create/update/post behavior, require the matching `cari.doc.*` permission instead of bypassing CARI authorization

### Locked source-state rule
- draft linkage may point at a draft CARI document line
- while the asset remains `DRAFT`, source CARI linkage may be changed or cleared
- while the linked source CARI document/line also remains `DRAFT`, source-derived asset values copied from that line are provisional and may be auto-refreshed from the current source line state before activation
- if the linked draft CARI line later changes quantity, currency, or txn/base amounts, FA06 must recompute remaining unit-slot eligibility and per-unit split from the current source line before activation
- activation/posting must not silently finalize a source-linked asset against stale source-derived draft values
- activation preflight must auto-refresh source-derived CARI values for still-`DRAFT` linked assets, but it must not silently replace user-owned setup choices such as category, owner OU, location OU, capitalization date, or in-service date
- if a draft asset switches from line/unit A to line/unit B, the old line/unit becomes eligible again immediately
- if a linked draft asset is deleted or otherwise abandoned before activation, its source line/unit slot must be released rather than remaining stuck as a soft reservation
- FA06 uniqueness discipline applies to non-null linked source line/unit values only; cleared draft linkage must not continue blocking reuse
- if activation-time revalidation finds that the current source line no longer supports the reserved unit slot, equal per-unit split assumptions, or valid source-derived amounts for the asset draft, FA06 must block activation until the draft is refreshed, relinked, or the source document is corrected
- activation/posting requires the source CARI document to be `POSTED`

### Locked legacy onboarding interaction
- CARI-linked assets cannot accept manual legacy onboarding values in MVP
- AP-line capitalization starts from the source document line amounts, not imported carrying values

### Repo-backed shortcut
- do not build a brand-new CARI line-detail backend first for MVP
- reuse the existing CARI document detail read path anchored by `GET /:documentId` in `backend/src/routes/cari.document.routes.js`
- the exact existing service entry point is `getCariDocumentByIdForTenant({ req, tenantId, documentId, assertScopeAccess })` in `backend/src/services/cari.document.service.js`
- inside that service, the current detail loader already composes `fetchDocumentRow(...)` plus `loadDocumentLinesForDocument(...)`; do not introduce a second ad hoc CARI document-detail query for FA06
- the current mapped document-detail payload already exposes the header fields FA06 needs for source-state validation, including at minimum `status`, `direction`, `documentType`, `currencyCode`, `grossAmountTxn`, and `grossAmountBase`
- the current mapped `lines[]` payload already exposes the line fields FA06 needs for source-line selection and capitalization defaults, including at minimum `id`, `lineNo`, `lineKind`, `description`, `quantity`, `unitPriceTxn`, `lineNetAmountTxn`, `lineGrossAmountTxn`, `lineNetAmountBase`, `lineGrossAmountBase`, and `postingAccountId`
- therefore FA06 can reuse the existing CARI document detail payload for line quantity, line amounts, posting account, and document status without requiring a CARI-side response-shape expansion in MVP
- if fixed-assets needs cleaner service-to-service reuse without the route-oriented `req` / `assertScopeAccess` signature, extract a small shared helper from the existing `getCariDocumentByIdForTenant(...)` -> `fetchDocumentRow(...)` + `loadDocumentLinesForDocument(...)` path instead of inventing a new detail contract
- after reusing the CARI document detail load, FA06 must apply fixed-assets-side eligibility filtering based on remaining unconsumed unit quantity for each source line instead of treating the line as fully consumed after the first linked asset
- start from:
  - `backend/src/routes/cari.document.routes.js`
  - `backend/src/services/cari.document.service.js`

### Acceptance
- source document and source line stay visible on asset detail
- no manual duplicate data entry for standard AP capitalization
- one AP line can create multiple fixed-asset cards up to its remaining whole-unit quantity
- one FA06 request may create multiple asset cards, but all units in that request share one category, one owner OU, one location OU, one capitalization/in-service setup, and one accounting treatment path
- splitting one AP line across different owner OUs, locations, categories, or setup contexts is supported in MVP only by submitting multiple FA06 requests against the same line's remaining unconsumed unit quantity
- per-line unit-slot uniqueness is DB-enforced through `source_cari_document_line_unit_no`
- eligible AP-line selection is driven by remaining unconsumed unit quantity instead of treating the source line as unavailable after the first linked asset
- `unitCount` is request-level, bounded by remaining unconsumed units, and assigned to the lowest available source-line unit slots deterministically
- one accepted multi-create FA06 request succeeds or fails atomically rather than partially capitalizing only some of the requested units
- draft assets can change or clear source CARI linkage, and abandoned/deleted draft assets do not leave stuck reserved source lines
- if a linked draft CARI line changes before activation, FA06 revalidates current source quantity/amount/status, auto-refreshes source-derived draft values when safe, and blocks stale or invalid activations when the reserved slot or per-unit assumptions no longer hold
- owner-OU mismatch against the source CARI/AP document OU is handled in MVP only through the locked direct FA06 due-to/due-from capitalization template, with the asset debit in the owner OU, AP/vendor credit in the source/payer OU, and `targetDueToAccount` / `sourceDueFromAccount` bridging lines; if the required self-balancing setup is unavailable, capitalization is blocked
- authorization remains consistent with CARI document access rules
- CARI-linked activation/capitalization creates one `CAPITALIZATION` transaction row per created asset card, not both `ACQUISITION` and `CAPITALIZATION` for the same asset
- below-threshold CARI-linked assets create one `CAPITALIZATION` row plus one same-period `DEPRECIATION` row, remain tracked, end with zero NBV, and do not become `DISPOSED`
- below-threshold CARI-linked assets are treated as `FULLY_DEPRECIATED` after the one-time same-period full-expense posting

---

## `FA07` - Depreciation schedule engine

### Goal
Generate deterministic period-based schedules for active depreciable assets.

### Scope
- standard schedule path from:
  - original cost
  - salvage value
  - useful life
  - in-service date
  - profile rules
- legacy onboarding manual-asset path from:
  - legacy NBV at activation
  - salvage value
  - `remaining_useful_life_months`
  - profile rules
- legacy onboarding assets generate forward schedule lines only; they do not backfill historical periods
- below-threshold new assets without legacy onboarding values are excluded from the normal depreciation schedule path and instead follow the dedicated low-value same-period full-expense treatment
- low-value same-period full-expense is executed as a one-time `DEPRECIATION` posting during activation/capitalization for that new-asset low-value path, not as part of the normal future schedule path
- below-threshold manual legacy onboarding imports follow the legacy onboarding carry-forward path and are not auto-expensed solely because they fall below the current threshold
- prevent NBV from falling below salvage value
- respect disposal and fully-depreciated states

### Locked schedule convention
- use `DAILY_PRORATA` month convention in MVP
- generate fixed-assets schedule lines only for non-adjustment fiscal periods that align to one calendar `YYYY-MM` month bucket under the locked `period_key` strategy
- calculate monthly depreciation using `monthly_amount * eligible_days / days_in_month`
- apply `STRAIGHT_LINE`, `DECLINING_BALANCE`, and `NONE` using the globally locked method rules; do not improvise alternative declining-balance formulas at implementation time
- use repo-native currency/legal-entity precision rounding
- push any residual rounding delta into the final depreciation schedule line
- legacy onboarding assets start schedule generation from the activation state / first eligible forward period, not from persisted pre-activation lines
- legacy onboarding assets must use stored `remaining_useful_life_months` as the forward depreciation horizon
- below-threshold low-value assets do not generate normal future depreciation schedule lines
- below-threshold manual legacy onboarding imports may still generate normal forward schedule lines when their imported legacy onboarding state has remaining depreciable amount
- suspending an asset must create one `SUSPEND` transaction row with the effective-date history needed for later audit and schedule eligibility review
- `SUSPENDED` assets keep historical schedule data but are not eligible for depreciation on suspended days
- reactivating an asset must create one `REACTIVATE` transaction row with the effective-date history used to resume depreciation prospectively
- reactivation resumes schedule consumption from the reactivation effective date using daily apportionment inside the month
- disposal/write-off effective dates cut off depreciation on that date; only days before the effective date are eligible in the disposal month
- if the asset is already `FULLY_DEPRECIATED` or otherwise has zero remaining depreciable amount for that month, the disposal/write-off workflow does not create a zero-amount depreciation posting merely to mark the cutoff
- ownership-transfer effective dates move current-month depreciation eligibility to the target owner from the effective date, while the source owner applies through the day before
- MVP does not auto-catch up missed suspended periods through hidden back-posting

### Acceptance
- schedule generation is deterministic for the same inputs
- suspension and reactivation behavior is deterministic and explicit
- suspend/reactivate actions leave explicit transaction-backed history through `SUSPEND` and `REACTIVATE` rows
- active depreciable assets can show a deterministic schedule before posting
- schedule math supports dual-amount context where required by reporting
- schedule math for `STRAIGHT_LINE`, `DECLINING_BALANCE`, and `NONE` is deterministic under the locked formulas
- manual imported assets produce deterministic forward-only schedules from legacy onboarding values
- below-threshold low-value same-period full-expense assets are excluded from normal depreciation schedule generation
- below-threshold manual legacy onboarding imports can continue deterministic forward schedules from imported legacy onboarding values when their onboarding state still has remaining depreciable amount
- below-threshold low-value assets become `FULLY_DEPRECIATED` after the one-time same-period full-expense posting rather than through future schedule consumption
- partial-month eligibility under `DAILY_PRORATA` is deterministic for in-service, suspension, reactivation, transfer, and disposal events

---

## `FA08` - Depreciation runs, run lines, and journal integration

### Goal
Support preview, post, and reverse monthly depreciation with full auditability.

### Required scope
- run header table
- run-line table
- run-line allocation child table
- preview
- post
- reverse
- skipped assets
- per-run errors
- per-run totals
- journal traceability through `journal_source_links`

### Locked run convention
- `POST /api/v1/fixed-assets/runs/preview` is calculation-only and does not persist run header/line rows
- `POST /api/v1/fixed-assets/runs` creates the persisted operational run in `DRAFT` status
- allow at most one persisted `DRAFT` run for the same `(tenant_id, legal_entity_id, book_id, fiscal_period_id)`
- depreciation preview/create/post flows must reject `fiscal_period_id` rows where `fiscal_periods.is_adjustment = TRUE`
- persisted run/header/line/allocation `period_key` values must use the locked calendar `YYYY-MM` format and must match the referenced supported fiscal period
- persisted `DRAFT` run lines and run-line allocation rows are a frozen snapshot captured at run creation time
- persisted run creation must keep one `withTransaction(...)` boundary but should persist large run-line / allocation sets with chunked statements inside that same transaction/connection rather than one unbounded insert payload
- persisted `DRAFT` run lines must retain the daily-prorata basis used for calculation, at minimum `eligible_days` and `days_in_period`, so partial-month results remain auditable without recomputation
- when `DAILY_PRORATA` requires ownership-transfer month splitting, the frozen snapshot must also persist `fixed_asset_depreciation_run_line_allocations` rows that capture OU-segment allocation detail
- posting must use the saved `DRAFT` run lines, run-line allocation rows, and totals rather than recalculating against changed asset state
- if users need a fresh calculation after asset/setup changes, they must delete the old persisted `DRAFT` run and then create a newly calculated one
- MVP must provide `DELETE /api/v1/fixed-assets/runs/:runId` as the explicit stale-draft disposal path
- that delete surface is allowed only for runs currently in `DRAFT` status
- creating a new persisted `DRAFT` for the same scope must fail while the old persisted `DRAFT` still exists
- run posting date defaults to the fiscal period end date
- a user-entered posting date is allowed only if it is inside the same open fiscal period as the run
- run creation/posting must resolve `book_id` from explicit `bookId` input or repo-native legal-entity book resolution
- run creation/posting must reject a requested `bookId` that does not match the single operational fixed-assets book for that legal entity in MVP
- run creation/posting must apply the locked `DAILY_PRORATA` eligible-day logic for partial-month depreciation
- suspended assets must be reported as skipped, not silently ignored
- below-threshold low-value assets are not eligible for normal depreciation previews or posted depreciation runs
- below-threshold low-value same-period full-expense is created inline during activation/capitalization, not by the depreciation run engine
- depreciation transactions created by FA08 posting must carry `depreciation_kind = RUN`
- FA08 run reversal applies to run-created depreciation context and must not treat inline `LOW_VALUE_FULL_EXPENSE` rows as if they were run-posted depreciation
- posted depreciation run reversal is blocked if any affected asset already has a later fixed-assets lifecycle event or later posted depreciation result after the run-created depreciation posting
- do not implement partial asset-by-asset run reversal in MVP; if any affected asset fails the reversal admissibility rule, the whole run reversal is blocked
- reversing a posted depreciation run must mark the affected `fixed_asset_depreciation_run_lines` as `REVERSED`
- reversing a posted depreciation run must mark the linked `fixed_asset_depreciation_schedule_lines` as `REVERSED`, not `PLANNED`, so schedule-line reversal history remains explicit
- reversing a posted depreciation run must clear `fixed_asset_depreciation_schedule_lines.posted_run_line_id` and `posted_transaction_id` because the reversed posting is no longer the current effective posted result for that schedule line
- rerun eligibility for the same asset and fiscal period must treat `REVERSED` schedule lines as eligible for a new posted result; do not leave the period stranded in a previously-posted state after reversal
- mid-period ownership transfers must split that month's depreciation between source OU days and target OU days, with the effective date belonging to the new owner
- when a transfer-month OU split exists, persisted `OWNER_OU` allocation rows must capture the source/target OU segments, date ranges, eligible days, and planned amounts behind the run line
- for normal FA08 depreciation posting, MVP creates at most one `DEPRECIATION` transaction row per asset and fiscal period
- represent transfer-month OU split through `fixed_asset_depreciation_run_line_allocations` and supporting journal lines rather than by creating multiple normal `DEPRECIATION` rows for the same asset-period
- mid-period suspension/reactivation must allocate depreciation only to eligible active days inside the period
- disposal/write-off month depreciation must stop on the effective disposal date rather than taking a full month
- skipped and error states must be recorded on run lines, not only in aggregated text
- depreciation batch journals use primary `journal_source_links.source_ref_type = FIXED_ASSET_DEPRECIATION_RUN`
- per-asset depreciation posting transactions, if created, may use optional secondary `FIXED_ASSET_TRANSACTION` links
- uniqueness enforcement for depreciation posting applies to posted results, not transient previews

### Schema lock for FA08
FA08 implementation must use the minimum column sets already locked above for:
- `fixed_asset_transactions`
- `fixed_asset_depreciation_schedule_lines`
- `fixed_asset_depreciation_runs`
- `fixed_asset_depreciation_run_lines`
- `fixed_asset_depreciation_run_line_allocations`

Do not reopen those shapes during FA08 unless a documented plan update is made first.

### Required rule
One asset and one period must not post twice.

Posting-grain rule:
- this uniqueness applies to normal FA08 `DEPRECIATION` transaction rows
- this uniqueness is intentionally not book-qualified in MVP because fixed-assets depreciation is single-book operationally per `(tenant_id, legal_entity_id)`
- this DB uniqueness must apply only to the current effective posted depreciation result for the asset-period, not to historical rows that were later reversed
- a naive unique index across all depreciation rows for `(tenant_id, legal_entity_id, asset_id, fiscal_period_id)` is not acceptable because it would block repost forever after reversal
- FA08 must use a MySQL-realistic generated discriminator / current-posted marker or equivalent DB-backed strategy so reversed history can remain while a later repost becomes the new current effective posted result
- OU split inside a transfer month must be represented through `fixed_asset_depreciation_run_line_allocations` and journal-line allocation, not by posting two normal depreciation transaction rows for one asset and fiscal period

This must be enforced in schema and service logic.

### Acceptance
- run detail shows totals, skipped assets, errors, and journals
- posting validates period-open rules explicitly
- posting date, book selection, suspended/reactivated handling, transfer-month splits, and disposal cutoffs are deterministic
- run audit is not weakened by missing line-level detail
- frozen `DRAFT` runs preserve the eligible-day basis behind prorata amounts and the persisted OU allocation segments behind transfer-month splits without requiring recalculation against changed asset state
- persisted `DRAFT` runs behave as frozen, auditable snapshots instead of re-runnable shells
- users cannot accumulate multiple stale persisted `DRAFT` runs for the same book and period
- users can explicitly discard a stale persisted `DRAFT` run through `DELETE /api/v1/fixed-assets/runs/:runId` before creating a fresh persisted snapshot
- run reversal is blocked when any affected asset already has later lifecycle/posting history; MVP does not auto-unwind successor chains or perform partial run reversal
- run reversal leaves affected schedule lines explicitly `REVERSED`, clears current schedule-line posted links, and still allows a clean repost for the same asset and period
- DB uniqueness for asset-period depreciation does not trap the period after reversal; historical reversed rows remain, and a later repost can become the new current effective posted result
- below-threshold low-value assets do not leak into normal depreciation-run eligibility
- low-value same-period full-expense remains distinct from retirement/write-off behavior and from run-based depreciation behavior

---

## `FA09` - Physical move and custodian reassignment

### Goal
Support non-accounting changes in physical placement and responsibility.

### Scope
- update location OU
- update `department_code` / `cost_center_code` if needed
- update custodian
- record lifecycle transaction
- persist one `fixed_asset_physical_move_details` child row that captures from/to movement snapshots
- do not change accounting owner
- do not create accounting movement by default

### Classification rule
- `department_code` and `cost_center_code` move as nullable classification values, not foreign-key remaps
- do not introduce department/cost-center master tables just for FA09
- changing these code fields alone must not create accounting movement in MVP

### Acceptance
- physical move does not silently mutate accounting ownership
- location, custodian, department-code, and cost-center-code history are preserved through DB-backed physical-move detail rows, not note-only reconstruction

---

## `FA10` - Ownership transfer between operating units

### Goal
Support OU ownership transfer as a separate accounting workflow.

### Scope
- explicit transfer date
- target owner OU
- optional location update
- preserve gross cost, accumulated depreciation, and NBV continuity
- self-balancing inter-OU journals
- when a transfer happens mid-month, current-month depreciation must be split between source OU and target OU using the locked `DAILY_PRORATA` effective-date rule
- persist one `fixed_asset_ownership_transfer_details` child row that captures from/to owner-OU and location snapshots

### Locked accounting backbone
- FA10 must use the repo's existing OU self-balancing / current-account foundations as the accounting backbone
- implementation should resolve cross-OU posting support through the existing OU self-balancing services and current-account configuration patterns
- remove `inter_ou_clearing_account_id` from the fixed-asset master in MVP
- do not add asset-card inter-OU clearing account overrides to FA10
- source OU, target OU, and legal-entity current-account setup must fully drive the transfer posting model in MVP
- FA10 ownership transfer must preserve gross cost and accumulated depreciation as separate account movements; do not implement the ownership-transfer journal as a single net-NBV reclass line pair
- the locked FA10 journal template for a source-OU to target-OU transfer is:
  - debit fixed-asset account in target owner OU for transferred gross cost
  - credit fixed-asset account in source owner OU for transferred gross cost
  - debit accumulated-depreciation account in source owner OU for transferred accumulated depreciation
  - credit accumulated-depreciation account in target owner OU for transferred accumulated depreciation
  - debit the directional self-balancing `sourceDueFromAccount` in the source owner OU for transferred NBV
  - credit the directional self-balancing `targetDueToAccount` in the target owner OU for transferred NBV
- resolve the directional self-balancing pair by calling `resolveOuSelfBalancingAccountsTx` with the source owner OU as `sourceOperatingUnitId` and the target owner OU as `targetOperatingUnitId`
- in FA10, do not use the opposite-direction pair (`sourceDueToAccount` / `targetDueFromAccount`) for the primary ownership-transfer journal template
- transferred NBV for the self-balancing lines equals transferred gross cost minus transferred accumulated depreciation as of the transfer event
- if transferred NBV is zero, do not create zero-amount self-balancing lines merely to preserve the template
- the transfer effective date belongs to the new owner; the source owner applies through the day before
- transfer-month depreciation allocation must persist source-OU and target-OU segment detail through `fixed_asset_depreciation_run_line_allocations`

### Acceptance
- transfer is clearly distinct from physical move
- owner OU is updated only after successful posting
- self-balancing accounting remains repo-native
- ownership-transfer posting uses one locked gross-cost-plus-accumulated-depreciation journal template with directional NBV self-balancing lines instead of an implementer-chosen net-only template
- mid-period transfer depreciation is split between source and target OU by effective-date daily apportionment and persisted in run-line allocation rows for audit/reporting
- ownership-transfer history is preserved through DB-backed transfer-detail rows, not inferred only from before/after asset state

---

## `FA11` - Disposal / write-off / sale

### Goal
Support retirement/disposal with correct cutoff and gain/loss logic.

### Scope
- write-off / scrap
- sale integrated with CARI AR
- stop future depreciation
- compute NBV
- create one retirement transaction row of the appropriate type
- create disposal journal
- set status to `DISPOSED`

### Locked retirement semantics
- `WRITEOFF` is the no-proceeds retirement path in MVP
- `SALE` is the customer-proceeds retirement path in MVP
- do not implement a separate generic `DISPOSAL` transaction/action in MVP
- low-value assets already in `FULLY_DEPRECIATED` status may still later enter `SALE` or `WRITEOFF` workflows when the physical item is actually retired or sold
- when sale/write-off happens mid-month, depreciation is recognized only through the day before the effective disposal date under `DAILY_PRORATA`
- the effective disposal date starts the disposed state, so no depreciation is recognized on or after that date
- when an asset is already `FULLY_DEPRECIATED` or otherwise has zero remaining depreciable amount at disposal time, the disposal workflow creates only the appropriate `SALE` or `WRITEOFF` event and must not create a zero-amount `DEPRECIATION` transaction merely to mark the cutoff

### Locked sale behavior
- MVP sale must create or link an AR-direction CARI document
- do not implement sale as a fixed-assets-only free-form proceeds entry
- do not use one overloaded `POST /api/v1/fixed-assets/:assetId/sale` endpoint for create, link, draft-edit, and finalize behavior
- lock the sale workflow to these explicit staged action endpoints:
  - `POST /api/v1/fixed-assets/:assetId/sale/create-draft-ar-document`
  - `POST /api/v1/fixed-assets/:assetId/sale/link-ar-document`
  - `PATCH /api/v1/fixed-assets/:assetId/sale/draft-ar-document`
  - `POST /api/v1/fixed-assets/:assetId/sale/finalize`
- `create-draft-ar-document` creates the draft AR-side document/line context only and must not create a fixed-assets `SALE` row, disposal journal, or disposed asset state
- `link-ar-document` links an existing AR-direction document/line to the asset sale workflow only and must not create a fixed-assets `SALE` row, disposal journal, or disposed asset state
- `draft-ar-document` updates the currently linked draft AR-side context only and must not create a fixed-assets `SALE` row, disposal journal, or disposed asset state
- `finalize` is the only sale action that may create the fixed-assets `SALE` row, post disposal accounting, and transition the asset to `DISPOSED`
- treat sale as a retirement/disposal subtype represented by one `SALE` transaction row
- do not create any extra generic retirement/disposal row alongside `SALE`
- fixed-assets handles disposal accounting and traceability
- CARI AR handles customer receivable / billing lifecycle
- if draft sale preparation is created, linked, or edited and never finalized, the asset remains in its pre-sale fixed-assets state and no disposal accounting is recognized
- when the sale flow creates or links a CARI AR document, the `SALE` transaction provenance on `fixed_asset_transactions` must use:
  - `source_ref_type = CARI_DOCUMENT`
  - `source_ref_id = related AR cari_documents.id`
  - `source_ref_line_id = related cari_document_lines.id` on the posted/finalized `SALE` row
- if fixed-assets creates the AR document, it must create one dedicated asset-sale line and use that line as the `source_ref_line_id` on the posted `SALE`
- one AR-direction CARI document may include multiple asset-sale lines, but each asset sale must use its own dedicated line
- do not allow `sale/finalize` to post a `SALE` transaction with `source_ref_line_id = null`

### Required sale request shape
At minimum, the staged sale workflow must carry enough information to create, link, edit, and finalize the customer-facing CARI AR side explicitly.

MVP rule:
- `create-draft-ar-document` accepts the minimum inputs required by the CARI AR draft-create path and must create one dedicated asset-sale line for that asset
- `link-ar-document` accepts an existing AR-direction `cariDocumentId` plus the exact `cariDocumentLineId` to use for that asset sale, and that line must be dedicated to that one asset sale
- `draft-ar-document` accepts only the allowed draft-edit fields for the currently linked draft AR-side document/line; it is not a finalize shortcut
- `finalize` accepts the minimum disposal-finalization inputs and must fail if no exact dedicated AR sale line is resolved for the asset
- one AR-direction CARI document may contain multiple asset-sale lines, but MVP does not allow one shared AR line to represent multiple fixed assets
- do not treat any sale action as a plain disposal request with an optional proceeds number only

### Required permission behavior
- FA11 sale flows require fixed-assets disposal/sale authority and the relevant CARI permissions
- `POST /api/v1/fixed-assets/:assetId/sale/link-ar-document` requires `cari.doc.read`
- `POST /api/v1/fixed-assets/:assetId/sale/create-draft-ar-document` requires `cari.doc.create`
- `PATCH /api/v1/fixed-assets/:assetId/sale/draft-ar-document` requires `cari.doc.update`
- `POST /api/v1/fixed-assets/:assetId/sale/finalize` requires `cari.doc.post`
- do not collapse create, link, draft-edit, and finalize behavior back into one sale endpoint without the matching action-specific permission checks
- do not allow sale flows to read, create, update, or post AR-direction CARI documents through fixed-assets routes when the matching CARI permission is missing

### Acceptance
- disposed assets cannot continue depreciating
- gain/loss posting uses configured accounts
- sale workflow is traceable to a related CARI AR document and exact AR line
- sale uses separate create-draft, link, draft-update, and finalize endpoints rather than one overloaded sale route
- draft AR-direction sale preparation and linking do not create a fixed-assets `SALE` row, disposal journal, or asset status change before final post
- disposal remains traceable in detail, reports, and journals
- only `sale/finalize` produces one `SALE` transaction row and results in asset status `DISPOSED`
- sale authorization remains consistent with action-specific CARI document security
- one AR-direction CARI document may bill multiple fixed-asset sales only through separate dedicated lines; one line cannot represent multiple assets
- AR-side reversal alone does not reopen the asset, and fixed-assets sale reversal is blocked until the linked AR-side document/line has first been reversed or otherwise returned to a reversal-compatible non-posted state
- fully expensed low-value assets remain eligible for later physical retirement/sale workflows until they are actually disposed
- disposal month depreciation cuts off on the effective disposal date rather than taking a full month
- already-fully-depreciated assets do not create zero-amount disposal-month depreciation postings

---

## `FA12` - Evidence, audit links, and source traceability

### Goal
Make lifecycle events reviewable using repo-native evidence and journal-link patterns.

### Required evidence source types
- `FIXED_ASSET`
- `FIXED_ASSET_TRANSACTION`
- `FIXED_ASSET_DEPRECIATION_RUN`

### Required route shape
Do not limit evidence to asset-level only.

Required surfaces include:
- asset-level evidence
- transaction-level evidence
- depreciation-run-level evidence

Repo-native evidence pattern to follow:
- follow the richer CARI evidence route pattern as canonical for fixed-assets
- do not mirror the leaner inventory-transfer evidence surface if that would omit single-item evidence lookup
- `POST /.../evidence` creates the evidence draft/metadata row
- `GET /.../evidence/:evidenceId` loads a single evidence record
- the create response should return an `uploadPath`
- binary upload uses `PUT /.../evidence/:evidenceId/content`
- binary download uses `GET /.../evidence/:evidenceId/download`
- delete uses `DELETE /.../evidence/:evidenceId`

Locked mounting contract:
- fixed-assets evidence is mounted inside `backend/src/routes/fixed-assets.routes.js`, not as a separate app-level route mount in `backend/src/index.js`
- locked nested evidence mounts are:
  - `/:assetId/evidence`
  - `/transactions/:transactionId/evidence`
  - `/runs/:runId/evidence`
- `backend/src/routes/fixed-assets.evidence.routes.js` should use `express.Router({ mergeParams: true })` and resolve the active evidence surface from route params

### Acceptance
- evidence service is extended beyond `CARI_DOCUMENT` and `INVENTORY_TRANSFER`
- acquisition, depreciation, transfer, and disposal journals can be traced back to fixed-assets source rows
- non-depreciation lifecycle journals drill back primarily through `FIXED_ASSET_TRANSACTION`
- depreciation batch journals drill back primarily through `FIXED_ASSET_DEPRECIATION_RUN`
- GL reverse-blocking recognizes `FIXED_ASSET_TRANSACTION` and `FIXED_ASSET_DEPRECIATION_RUN`
- reverse-block responses return structured destination metadata in `details.reverseBlock` while preserving the existing human-readable message contract
- fixed-assets reverse-block routing is resolved dynamically from source records, not only from static source-type route hints
- when multiple blocking source links exist, the response includes both `primaryDestination` and `resolvedDestinations`

### Explicit implementation note
`backend/src/services/evidence.service.js` must be extended directly because current repo support is limited to:
- `CARI_DOCUMENT`
- `INVENTORY_TRANSFER`

Route-shape reference:
- use `backend/src/routes/cari.document.evidence.routes.js` as the canonical evidence-route pattern for fixed-assets
- do not treat the inventory-transfer evidence surface as the fixed-assets route template

---

## `FA13` - Reports, filters, and exports

### Goal
Provide practical finance/admin reporting for fixed assets.

### Minimum reports
- register
- depreciation schedule
- additions
- disposals
- transfers
- by owner OU
- by location OU
- by custodian
- depreciation by owner OU
- rollforward

### Owner-OU report distinction
- `by-owner-ou` is a current-position / register-style report grouped by current owner OU
- `depreciation-by-owner-ou` is a period depreciation expense/allocation report grouped by owner OU for the selected fiscal period
- do not collapse these into one ambiguous owner-OU endpoint in MVP
- `depreciation-by-owner-ou` is the report that depends most directly on persisted `fixed_asset_depreciation_run_line_allocations` for transfer-month owner-OU split explainability under `DAILY_PRORATA`

### Export contract
- exports must use dedicated report `/export` endpoints, not implicit `?export=1` behavior on the plain report GET routes
- each export endpoint must accept the same filtering surface as its paired on-screen report route
- export delivery should follow repo-native file export patterns, but the fixed-assets route contract is explicitly a dedicated `/export` endpoint per report

### Acceptance
- owner OU, location OU, and custodian reporting remain distinct
- `by-owner-ou` and `depreciation-by-owner-ou` remain distinct reports with different business purpose and SQL basis
- totals reconcile to movement logic
- export surface follows repo-native reporting patterns
- exports are exposed through dedicated fixed-assets report `/export` endpoints, not only through plain report GET routes
- additions reporting distinguishes `ACQUISITION` vs `CAPITALIZATION` without double-counting one event
- disposal/retirement reporting distinguishes `WRITEOFF` vs `SALE` without a duplicate generic `DISPOSAL` class
- reporting can identify below-threshold tracked assets and their same-period full-expense treatment
- low-value same-period full-expense is reportable without misclassifying the asset as retired/disposed
- reporting can distinguish `depreciation_kind = RUN` from `depreciation_kind = LOW_VALUE_FULL_EXPENSE` without inferring from surrounding workflow context
- owner-OU, transfer, disposal, and rollforward reporting must respect `DAILY_PRORATA` effective-date depreciation splits and cutoffs
- owner-OU and transfer reporting may rely on persisted `fixed_asset_depreciation_run_line_allocations` rather than reconstructing OU split from journal lines alone

---

## `FA14` - Permissions, sidebar gating, and approval-sensitive actions

### Goal
Protect sensitive operations and wire the module into repo-native gating patterns.

### Required permissions
- `fixed_assets.read`
- `fixed_assets.upsert`
- `fixed_assets.post`
- `fixed_assets.depreciation.run`
- `fixed_assets.depreciation.reverse`
- `fixed_assets.transfer`
- `fixed_assets.dispose`
- `fixed_assets.settings.read`
- `fixed_assets.settings.upsert`
- `fixed_assets.account_override`
- `fixed_assets.custodian.read`
- `fixed_assets.custodian.write`
- `fixed_assets.report.read`

Implementation note:
- `backend/src/seedCore.js` already seeds the existing fixed-assets permission family; FA14 extends that family by adding `fixed_assets.account_override`
- seeded role bundles must be updated deliberately so account-override authority is not implied accidentally by broad fixed-assets access

Locked seeded role-bundle rule:
- `TenantAdmin` receives `fixed_assets.account_override` through the existing full-permission catalog seeding pattern
- explicitly grant `fixed_assets.account_override` to `CountryController`
- explicitly grant `fixed_assets.account_override` to `EntityAccountant`
- do not grant `fixed_assets.account_override` to `GroupController`
- do not grant `fixed_assets.account_override` to `BranchOperator`
- do not grant `fixed_assets.account_override` to `AuditorReadOnly`
- do not treat broad fixed-assets read/upsert/post access as sufficient to imply account-override authority

Cross-module permission rule:
- fixed-assets permissions do not replace CARI document permissions
- FA06 requires `cari.doc.read` for AP-line selection and the matching `cari.doc.*` permission for any later CARI-side create/update/post action
- FA11 requires action-specific CARI permissions when the sale workflow touches CARI documents:
  - `cari.doc.read` to link/read an existing AR document
  - `cari.doc.create` to create a draft AR document
  - `cari.doc.update` to edit a linked draft AR document
  - `cari.doc.post` to post an AR document
- overriding fixed-assets account values away from category defaults requires `fixed_assets.account_override` in addition to the underlying upsert/post permission for the workflow
- `POST /api/v1/fixed-assets/transactions/:transactionId/reverse` must authorize by the original transaction type rather than through `fixed_assets.depreciation.reverse`
- non-run reversal permission mapping in MVP is:
  - `ACQUISITION`, `CAPITALIZATION`, and inline low-value `DEPRECIATION` reversal require `fixed_assets.post`
  - `OWNERSHIP_TRANSFER` reversal requires `fixed_assets.transfer`
  - `WRITEOFF` and `SALE` reversal require `fixed_assets.dispose`

Implementation rule:
- the primary route guard for a fixed-assets workflow must stay on the owning `fixed_assets.*` permission via `requirePermission(...)`
- required cross-module `cari.doc.*` permissions for the same workflow must be enforced through a secondary shared RBAC helper that does not overwrite `req.rbac`
- do not implement FA06/FA11 cross-module permission enforcement by stacking multiple `requirePermission(...)` middlewares and relying on the last one to win

### Required gating
- backend route guards
- frontend sidebar items
- page-level action gating
- cross-module action gating when FA flows invoke CARI-backed reads or writes

### Sensitive actions
Require dedicated permission and, if later needed, approval-sensitive handling for:
- ownership transfer
- disposal
- reversing posted non-run fixed-assets transactions
- reversing posted depreciation
- account overrides from category defaults

### Acceptance
- fixed-assets pages are not generic placeholders anymore
- sidebar/action visibility matches permission design
- sensitive actions remain explicit
- FA06 and FA11 do not bypass missing action-specific `cari.doc.*` permissions
- account overrides from category defaults do not ride on broad upsert/post permissions alone
- seeded account-override assignment is explicit: `TenantAdmin` inherits it through full-catalog seeding, `CountryController` and `EntityAccountant` receive it explicitly, and `GroupController`, `BranchOperator`, and `AuditorReadOnly` do not

## Suggested API Surface

### Core assets
- `GET /api/v1/fixed-assets`
- `POST /api/v1/fixed-assets`
- `GET /api/v1/fixed-assets/:assetId`
- `PATCH /api/v1/fixed-assets/:assetId`
- `POST /api/v1/fixed-assets/:assetId/activate`
- `POST /api/v1/fixed-assets/:assetId/suspend`
- `POST /api/v1/fixed-assets/:assetId/reactivate`

### Categories and profiles
- `GET /api/v1/fixed-assets/categories`
- `POST /api/v1/fixed-assets/categories`
- `PATCH /api/v1/fixed-assets/categories/:categoryId`
- `GET /api/v1/fixed-assets/depreciation-profiles`
- `POST /api/v1/fixed-assets/depreciation-profiles`
- `PATCH /api/v1/fixed-assets/depreciation-profiles/:profileId`

### CARI capitalization
- `POST /api/v1/fixed-assets/from-cari-document-line`
  - shared-setup batch request in MVP, not per-unit mixed asset cards
  - minimum request fields include `sourceCariDocumentLineId`, `unitCount`, `categoryId`, `ownerOperatingUnitId`, `locationOperatingUnitId`, `capitalizationDate`, and `inServiceDate`
  - if the same source line must be split across different owner OUs, locations, categories, or capitalization/in-service setups, use multiple requests against the same remaining unconsumed unit quantity

### Lifecycle actions
- `POST /api/v1/fixed-assets/:assetId/physical-move`
- `POST /api/v1/fixed-assets/:assetId/ownership-transfer`
- `POST /api/v1/fixed-assets/:assetId/sale/create-draft-ar-document`
- `POST /api/v1/fixed-assets/:assetId/sale/link-ar-document`
- `PATCH /api/v1/fixed-assets/:assetId/sale/draft-ar-document`
- `POST /api/v1/fixed-assets/:assetId/sale/finalize`
- `POST /api/v1/fixed-assets/:assetId/writeoff`
- `POST /api/v1/fixed-assets/transactions/:transactionId/reverse`
- `GET /api/v1/fixed-assets/:assetId/transactions`
- `GET /api/v1/fixed-assets/:assetId/depreciation-schedule`

### Depreciation runs
- `GET /api/v1/fixed-assets/runs`
- `POST /api/v1/fixed-assets/runs/preview`
  - transient calculation only; does not persist run rows
- `POST /api/v1/fixed-assets/runs`
  - creates the persisted operational run in `DRAFT`
  - fails when another persisted `DRAFT` already exists for the same tenant, legal entity, book, and period
- `GET /api/v1/fixed-assets/runs/:runId`
- `DELETE /api/v1/fixed-assets/runs/:runId`
  - allowed only when status = `DRAFT`
  - deletes the stale persisted draft snapshot so a fresh `DRAFT` can be created for the same tenant, legal entity, book, and period
- `POST /api/v1/fixed-assets/runs/:runId/post`
- `POST /api/v1/fixed-assets/runs/:runId/reverse`

### Custodians
- `GET /api/v1/fixed-assets/custodians`
- `POST /api/v1/fixed-assets/custodians`
- `PATCH /api/v1/fixed-assets/custodians/:custodianId`

### Evidence
- `GET /api/v1/fixed-assets/:assetId/evidence`
- `POST /api/v1/fixed-assets/:assetId/evidence`
- `GET /api/v1/fixed-assets/:assetId/evidence/:evidenceId`
- `PUT /api/v1/fixed-assets/:assetId/evidence/:evidenceId/content`
- `GET /api/v1/fixed-assets/:assetId/evidence/:evidenceId/download`
- `DELETE /api/v1/fixed-assets/:assetId/evidence/:evidenceId`
- `GET /api/v1/fixed-assets/transactions/:transactionId/evidence`
- `POST /api/v1/fixed-assets/transactions/:transactionId/evidence`
- `GET /api/v1/fixed-assets/transactions/:transactionId/evidence/:evidenceId`
- `PUT /api/v1/fixed-assets/transactions/:transactionId/evidence/:evidenceId/content`
- `GET /api/v1/fixed-assets/transactions/:transactionId/evidence/:evidenceId/download`
- `DELETE /api/v1/fixed-assets/transactions/:transactionId/evidence/:evidenceId`
- `GET /api/v1/fixed-assets/runs/:runId/evidence`
- `POST /api/v1/fixed-assets/runs/:runId/evidence`
- `GET /api/v1/fixed-assets/runs/:runId/evidence/:evidenceId`
- `PUT /api/v1/fixed-assets/runs/:runId/evidence/:evidenceId/content`
- `GET /api/v1/fixed-assets/runs/:runId/evidence/:evidenceId/download`
- `DELETE /api/v1/fixed-assets/runs/:runId/evidence/:evidenceId`

### Reports
- `GET /api/v1/fixed-assets/reports/register`
- `GET /api/v1/fixed-assets/reports/register/export`
- `GET /api/v1/fixed-assets/reports/depreciation-schedule`
- `GET /api/v1/fixed-assets/reports/depreciation-schedule/export`
- `GET /api/v1/fixed-assets/reports/additions`
- `GET /api/v1/fixed-assets/reports/additions/export`
- `GET /api/v1/fixed-assets/reports/disposals`
- `GET /api/v1/fixed-assets/reports/disposals/export`
- `GET /api/v1/fixed-assets/reports/transfers`
- `GET /api/v1/fixed-assets/reports/transfers/export`
- `GET /api/v1/fixed-assets/reports/by-owner-ou`
- `GET /api/v1/fixed-assets/reports/by-owner-ou/export`
- `GET /api/v1/fixed-assets/reports/depreciation-by-owner-ou`
- `GET /api/v1/fixed-assets/reports/depreciation-by-owner-ou/export`
- `GET /api/v1/fixed-assets/reports/by-location-ou`
- `GET /api/v1/fixed-assets/reports/by-location-ou/export`
- `GET /api/v1/fixed-assets/reports/by-custodian`
- `GET /api/v1/fixed-assets/reports/by-custodian/export`
- `GET /api/v1/fixed-assets/reports/rollforward`
- `GET /api/v1/fixed-assets/reports/rollforward/export`

## Definition Of Done
- fixed assets exist as a dedicated accounting subledger
- migrations start at `m138_*`
- implementation language matches repo reality: migrations + validators + SQL services + routes
- backend fixed-assets module files and `/api/v1/fixed-assets` mount exist for real
- frontend demirbas routes use dedicated fixed-assets pages, not the generic placeholder flow
- OpenAPI work is delivered, not skipped
- OpenAPI generator includes `FixedAssets` tag support and `/api/v1/fixed-assets` inference
- evidence service supports fixed-asset source types at asset, transaction, and run level
- fixed-assets source-link/evidence/reverse-block consumers reuse shared source-type constants/helpers so `FIXED_ASSET_TRANSACTION` and `FIXED_ASSET_DEPRECIATION_RUN` are not redefined ad hoc across modules
- fixed-assets evidence routes are mounted as nested sub-routes inside `fixed-assets.routes.js` for asset, transaction, and run evidence surfaces, not as a separate top-level app mount
- GL reverse-blocking recognizes fixed-assets source types and resolves dynamic destination metadata from fixed-assets source records
- reverse-block responses preserve the existing human-readable message style while including structured destination metadata in `details.reverseBlock`
- the shared backend `badRequest(message, details = null)` helper supports structured `details`, and fixed-assets reverse-blocking uses that repo-native path instead of a one-off custom error shape
- journal detail/read payloads used by Journal Workbench keep raw `source_links` while additively exposing backend-owned `source_links[].destination` and single-journal `reverseBlock` metadata so client-side drillback and preflight do not rely on static fixed-assets route maps
- journal detail reverse-block preflight does not regress the bulk journal list endpoint into unconditional per-row destination resolution
- fixed-assets journals route users back to the most relevant owning workflow with defined fallback behavior
- normal Journal Workbench source-link drillback recognizes `FIXED_ASSET_TRANSACTION` and `FIXED_ASSET_DEPRECIATION_RUN` using the same backend-owned route/query contract as reverse-blocking where applicable
- Journal Workbench prefers backend-owned destination metadata and `details.reverseBlock` during rollout, while retaining compatibility fallback for non-upgraded source types until the shared contract migration is complete
- CARI-linked fixed-assets workflows respect both `fixed_assets.*` and action-specific required `cari.doc.*` permissions
- upstream posted CARI source-document reversal is temporarily blocked when that source is already linked to an activated asset or to any posted fixed-assets dependency; MVP does not auto-unwind fixed-assets state from the CARI side
- FA06 and FA11 multi-permission enforcement use a shared secondary RBAC permission-assertion helper without stacking `requirePermission(...)` middlewares that overwrite `req.rbac`
- fixed-assets routes use shared RBAC `resolveScope` helpers for list/create, asset, transaction, run, and evidence surfaces instead of route-by-route ad hoc resolver logic
- fixed-assets multi-row mutating workflows use one locked `withTransaction(...)` boundary, including sequence reservation and the consuming asset-row/journal/source-link writes for the same business event
- large FA08 depreciation-run persistence is connection-pool aware: it keeps one `withTransaction(...)` boundary while using statement chunking sized for deployment MySQL packet/timeout limits rather than one unbounded insert payload
- depreciation preview remains unlimited/transient, while stale persisted `DRAFT` runs have an explicit draft-only disposal path through `DELETE /api/v1/fixed-assets/runs/:runId` before a fresh persisted snapshot is created
- seeded role-bundle assignment for `fixed_assets.account_override` is locked: `TenantAdmin` inherits it through full-catalog seeding, `CountryController` and `EntityAccountant` receive it explicitly, and `GroupController`, `BranchOperator`, and `AuditorReadOnly` do not
- category capitalization thresholds drive defined low-value same-period full-expense behavior in MVP
- low-value same-period full-expense is implemented as a one-time `DEPRECIATION` posting that leaves the asset tracked and `FULLY_DEPRECIATED`, not `DISPOSED`
- `DEPRECIATION` rows are explicitly classified so normal run-posted depreciation and low-value inline full-expense remain distinguishable
- fixed-assets account mappings and category defaults enforce locked expected GL account types and legal-entity chart-of-accounts ownership rules, including accumulated depreciation validating as `ASSET` under the repo's account model
- manual legacy onboarding / go-live assets are onboarded into fixed-assets without double-booking a fresh acquisition journal
- below-threshold manual legacy onboarding imports use locked Option B behavior: allow onboarding, never auto-expense solely because of the current threshold, and continue from imported legacy onboarding state when remaining depreciable amount exists
- suspend/reactivate flows create explicit `SUSPEND` / `REACTIVATE` transaction history rows instead of changing status without lifecycle traceability
- non-run fixed-assets posting events have a source-owned transaction reversal surface instead of relying on direct GL reverse
- non-run transaction reversal and depreciation-run reversal are blocked when later fixed-assets lifecycle/posting history already exists; MVP does not auto-unwind successor chains
- fixed-assets reversal lineage uses authoritative `reversed_transaction_id` semantics with DB-backed single-reversal enforcement
- posted `SALE` transactions keep exact CARI AR line provenance through `source_ref_line_id` rather than header-only document linkage
- sale uses separate create-draft, link, draft-update, and finalize endpoints; only `sale/finalize` creates the fixed-assets `SALE` row, disposal journal, and disposed asset state
- one AR-direction CARI document may include multiple fixed-assets sale lines, but each AR line represents one asset sale only
- `journal_source_links` enforces at most one `PRIMARY` link per journal through a DB-backed workaround, and that hardening lands as a shared-platform rollout with real-environment data preflight, duplicate-`PRIMARY` normalization, existing non-fixed-assets writer cleanup/regression coverage, and fixed-assets generated journals writing exactly one owning `PRIMARY` link
- fixed-assets sale reversal is blocked until the linked AR-side document/line is reversed first or otherwise returned to a reversal-compatible non-posted state, and AR-side reversal alone does not reopen the asset
- disposal of already-fully-depreciated assets does not create zero-amount depreciation postings merely to mark the disposal-month cutoff
- fixed-assets uses one operational posting book per legal entity in MVP; schedule lines and asset-period depreciation posting uniqueness are not multi-book aware
- month convention is `DAILY_PRORATA` with effective-date cutoffs for suspension, reactivation, ownership transfer, sale, and write-off
- depreciation-run reversal marks affected schedule lines as `REVERSED`, clears their current posted-link fields, and still allows reposting for the same asset and period
- active assets use snapped depreciation-driving profile fields plus snapped salvage-rule inputs and resolved salvage values on the asset master, so later profile/category default edits are prospective only and do not retroactively change existing asset behavior
- prorata transfer-month owner-OU allocation context is persisted in dedicated run-line allocation rows, not left as an implied report-time reconstruction
- physical-move and ownership-transfer history is DB-backed through dedicated detail tables, not generic note-only history
- CARI-created assets may use an owner OU different from the source CARI/AP document OU only when FA06 uses the locked direct due-to/due-from capitalization template, with the fixed-asset debit in the owner OU, the AP/vendor credit in the source/payer OU, and `targetDueToAccount` / `sourceDueFromAccount` bridging lines; if the required self-balancing setup is unavailable, the mismatch is blocked
- ownership-transfer accounting uses a locked gross-cost-plus-accumulated-depreciation journal template with directional OU self-balancing on transferred NBV, not an implementation-defined net-only template
- asset numbering uses a locked backend-reserved `FA-######` format with continuous legal-entity sequencing and follows repo-native module-local numbering patterns rather than a nonexistent shared generic helper
- fixed-assets journal headers use locked repo-native `FA-*` journal-number prefixes and `journal_entries.source_type = SYSTEM`, with journal-number construction following repo-native module-local patterns unless this track first adds a real shared helper
- stored fixed-assets `period_key` values use locked calendar `YYYY-MM` format and fixed-assets schedule/run data excludes adjustment periods in MVP
- fixed-assets adjustment-period rejection does not assume a nonexistent shared helper; it explicitly enforces non-adjustment fiscal-period resolution and direct `is_adjustment` validation where `fiscalPeriodId` is supplied
- enums are uppercase repo-style values
- dual transaction/base amounts are stored where required
- CARI AP capitalization follows direct capitalization option A
- CARI AP-line capitalization supports one source line creating multiple fixed-asset cards up to remaining whole-unit quantity, with per-line unit-slot uniqueness and per-asset threshold evaluation
- FA06 multi-asset capitalization uses a shared-setup-per-request contract in MVP: one request may create multiple asset cards, but mixed owner/location/category/setup splits from the same AP line require multiple requests against remaining units
- draft-linked CARI asset activation revalidates current source document/line status, quantity, currency, and txn/base amounts, auto-refreshes source-derived draft values when safe, and blocks stale or invalid activations when reserved unit slots or per-unit assumptions no longer hold
- journal linkage is transaction-based, not master-based
- reports and exports are both contracted, with dedicated `/export` endpoints for fixed-assets reports
- key uniqueness rules are DB-enforced
- open decisions remain visible instead of being buried in implicit behavior


