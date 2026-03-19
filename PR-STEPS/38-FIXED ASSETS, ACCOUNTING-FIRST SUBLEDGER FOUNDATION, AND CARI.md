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
- `backend/src/migrations/m139_*`
- `backend/src/migrations/m140_*`
- `backend/src/migrations/m141_*`

Also:
- `backend/src/index.js` does not currently mount `/api/v1/fixed-assets`

This is the primary implementation gap for the track.

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

### Migration numbering
Current repo migrations end at `m137_*`.

Locked decision:
- fixed-assets migration family starts at `m139_*`

Planned files:
- `m139_fixed_assets_foundation.js`
- `m140_fixed_asset_custodian_employees.js`
- `m141_fixed_asset_cari_capitalization_and_traceability.js`

Important:
- `backend/src/migrations/index.js` must be updated when those real migration files are created
- do not register fake or placeholder migrations just to reserve numbers

Custodian-FK sequencing note:
- `m139_fixed_assets_foundation.js` creates `fixed_assets.custodian_employee_id` plus `fixed_asset_physical_move_details.from_custodian_employee_id` and `fixed_asset_physical_move_details.to_custodian_employee_id` as nullable columns only
- `m140_fixed_asset_custodian_employees.js` creates `fixed_asset_custodian_employees` and then adds the related custodian foreign-key constraints via `ALTER TABLE`
- do not attempt to create those custodian foreign keys in `m139_*` before the referenced table exists

Intra-`m139` dependency-order note:
- the FA01 required-table list is scope, not DDL creation order
- `m139_fixed_assets_foundation.js` must use staged DDL: create the base tables first, then add intra-`m139` foreign keys via `ALTER TABLE` in dependency-safe order
- minimum dependency-safe base-table creation order inside `m139_*` is:
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
- forward or circular intra-`m139` references must be added only after both tables exist, including at minimum:
  - `fixed_asset_categories.default_depreciation_profile_id`
  - `fixed_asset_depreciation_schedule_lines.posted_run_line_id`
  - `fixed_asset_depreciation_run_lines.schedule_line_id`
- do not implement `m139_*` as naive inline-FK table creation in the flat document order

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

Implementation note:
- the current app-level error envelope can already serialize structured `details`
- lock the repo-safe upgrade path now: extend the shared `backend/src/routes/_utils.js` helper to `badRequest(message, details = null)`
- that helper upgrade must be backward-compatible: existing call sites remain valid, and the helper sets `err.details = details` only when `details` is provided
- fixed-assets reverse-blocking should use that shared `badRequest(message, details)` path rather than introducing a one-off custom error object only for the fixed-assets reverse-block flow
- do not leave structured reverse-block metadata blocked behind a message-only helper assumption

### Current frontend reverse-block UI shape
`frontend/src/pages/JournalWorkbenchPage.jsx` currently:
- defines `JOURNAL_REVERSE_SOURCE_DESTINATIONS`
- builds reverse-block route hints from static source-link types
- can reconstruct reverse-block destinations locally before using any dynamic backend destination metadata
- pre-blocks reversal locally in the submit flow before calling the backend reverse route

Dynamic fixed-assets reverse-blocking therefore also requires frontend work:
- Journal Workbench must stop hardcoding fixed reverse-block route hints for fixed-assets source types
- when the backend returns structured reverse-block destination metadata, the UI must consume it instead of rebuilding fixed-assets routes from a static source-type map
- journal detail/read payloads that feed Journal Workbench must also be enriched with backend-owned reverse-block destination metadata so the UI can continue to pre-block before submit without reverting to static fixed-assets route reconstruction

### Current frontend source-link drillback UI shape
`frontend/src/pages/JournalWorkbenchPage.jsx` also has a separate normal "Open Source" drillback path for journal source links.

Current reality:
- normal source-link drillback path resolution is still computed locally from `source_links`
- the local resolver currently knows only a small static source-type set such as `CARI_DOCUMENT`, `CARI_SETTLEMENT_BATCH`, and `PAYMENT_BATCH`
- it does not currently include `FIXED_ASSET_TRANSACTION` or `FIXED_ASSET_DEPRECIATION_RUN`

Planning implication:
- normal journal source-link drillback for fixed-assets must be upgraded explicitly, not left implicit behind reverse-blocking only
- where possible, normal drillback and reverse-blocking should use the same backend-owned route/query contract so Journal Workbench does not maintain two separate fixed-assets destination models

### Frontend placeholder policy
Current demirbas placeholders are not authoritative.

Locked direction:
- stop treating generic placeholder routing as the fixed-assets plan
- keep the existing `frontend/src/pages/fixedAssets` folder and replace scaffold shells with fixed-assets-specific pages
- replace old placeholder behavior with real fixed-assets pages inside that existing folder
- normalize the route family around the updated plan

### Current frontend route and label scaffolds already exist
`frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`, and `frontend/src/i18n/messages.js` already contain the fixed-assets route family and user-facing labels.

Planning implication:
- treat those files as verify/update surfaces, not foundational missing gaps
- normalize legacy aliases, redirects, and labels only where needed to match the locked canonical routes and behavior

### Frontend API helper is only partially scaffolded
`frontend/src/api/fixedAssets.js` already exists, but it currently covers only part of the planned API surface.

Current helper coverage is partial and still missing at least:
- `GET /api/v1/fixed-assets/:assetId/transactions`
- `GET /api/v1/fixed-assets/:assetId/depreciation-schedule`
- `POST /api/v1/fixed-assets/:assetId/suspend`
- `POST /api/v1/fixed-assets/:assetId/reactivate`
- physical move helper
- ownership transfer helper
- sale helper
- write-off helper
- `GET /api/v1/fixed-assets/runs/:runId`
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
- One source CARI line to one asset must be DB-enforced for MVP.
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
- use repo-native sequence/number generation patterns rather than ad hoc frontend-generated values
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

### Fixed-assets journal header strategy
Lock fixed-assets journal-header conventions now so FA posting flows do not improvise journal numbering or journal-header source typing at implementation time.

Locked decision:
- every fixed-assets posting flow that creates a GL journal must construct `journal_entries.journal_no` explicitly through a repo-native backend helper; do not leave FA journal numbering as ad hoc inline strings or user-entered journal numbers
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
- `opening_accum_depr_txn`
- `opening_accum_depr_base`
- `opening_nbv_txn`
- `opening_nbv_base`

### Capitalization threshold behavior
Lock category-threshold behavior now so `capitalization_threshold_base` is not left as passive metadata.

Locked decision:
- below-threshold assets may still have a fixed-assets record for control and tracking in MVP
- if an asset's `original_cost_base` is below the category threshold, it is not eligible for normal depreciation scheduling or depreciation runs
- below-threshold assets must use a dedicated low-value path with same-period full-expense treatment
- same-period full-expense is represented in MVP as a one-time `DEPRECIATION` transaction created during activation or capitalization
- low-value same-period full-expense does not create a retirement event and does not set the asset to `DISPOSED`
- after the one-time full-expense treatment, the asset status moves directly to `FULLY_DEPRECIATED`, not `ACTIVE`
- after the one-time full-expense treatment, the asset remains tracked with zero NBV and is treated as `FULLY_DEPRECIATED` for depreciation eligibility
- below-threshold assets that were fully expensed remain visible for physical control, reporting, and later `SALE` / `WRITEOFF` workflows if still physically held
- do not hard-block activation/capitalization solely because the amount is below threshold
- do not treat the threshold as warn-only metadata or reporting-only metadata in MVP
- do not introduce a separate threshold-override permission or approval workflow in MVP
- threshold breaches and low-value treatment must remain reportable so finance can review them explicitly

### Draft versus posted source-document rule
Locked for MVP:
- allow draft fixed-asset linkage to a draft CARI document line
- allow activation/posting only when the source CARI document is `POSTED`

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
- sale post flows require fixed-assets disposal/sale authority plus `cari.doc.post`
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
- fixed-assets backend work must add and reuse the following scope resolvers:
  - `resolveLegalEntityScopeFromQuery(req)`
  - `resolveLegalEntityScopeFromBody(req)`
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

### Opening balance / import behavior
Lock opening-balance behavior now so go-live setup does not create accounting ambiguity.

Locked decision:
- opening balances are allowed only for manually created assets
- opening balances are not allowed for CARI-linked assets
- opening balance fields may be entered only while the asset is `DRAFT`
- after activation, opening balance fields are immutable
- manual opening-balance activation represents legacy / go-live onboarding of an already-existing asset state into this module, not a new current-period acquisition
- activation of a manual opening-balance asset still creates one `ACQUISITION` transaction row for fixed-assets auditability
- for manual opening-balance / go-live assets, that `ACQUISITION` row must not post a new acquisition journal in MVP
- `fixed_asset_transactions.journal_entry_id` remains null for that onboarding `ACQUISITION` row unless a later documented migration-posting flow is introduced
- opening balances seed forward depreciation scheduling from the activation state
- opening balances do not generate historical or backfilled schedule lines in MVP
- any later correction must use an explicit transaction-backed accounting workflow, not a silent master edit

Implementation note:
- treat opening balances as go-live setup for pre-existing manually registered assets already in use before this module
- treat the onboarding `ACQUISITION` row as subledger history for module entry, not proof that a fresh GL acquisition was booked on the activation date
- schedule generation should start from the seeded carrying amount and remaining life at activation time

### Remaining-life capture for opening-balance assets
Lock the forward depreciation horizon now so FA07 is implementable.

Locked decision:
- add `remaining_useful_life_months` to the fixed-asset master
- `useful_life_months` remains the nominal/original useful life field
- `remaining_useful_life_months` is required for manual opening-balance depreciable assets before activation
- `remaining_useful_life_months` is not used for CARI-linked assets in MVP
- standard non-import assets may keep `remaining_useful_life_months` null and let the schedule engine derive remaining life from normal lifecycle inputs
- opening-balance schedule generation must use stored `remaining_useful_life_months`, not guess remaining life from dates alone

### Sale workflow scope
Lock sale scope now so it is not treated as a vague proceeds field.

Locked decision:
- MVP sale must integrate with CARI AR
- sale is not a standalone free-form disposal with manually typed proceeds only
- sale workflow must create or link to an AR-direction CARI document for the customer-facing receivable / billing side
- fixed-assets disposal logic remains responsible for asset retirement, NBV relief, and gain/loss accounting
- CARI AR remains responsible for the receivable / customer-document side

Minimum traceability requirement:
- sale transactions must keep source linkage to the related CARI AR document
- posted `SALE` transactions must also keep source linkage to the exact related CARI AR line through `source_ref_line_id`; do not leave posted sale provenance at the document-header level only
- GL drillback must stay consistent with the locked `FIXED_ASSET_TRANSACTION` source-link strategy

### Fixed-asset transaction semantics
Lock transaction meanings now so additions, retirements, and journal drillback do not depend on implementation taste.

Locked decision:
- manual asset activation creates one `ACQUISITION` transaction row
- for manual opening-balance / go-live assets, the `ACQUISITION` row records onboarding into the fixed-assets subledger rather than a new purchase event
- for manual opening-balance / go-live assets, do not post a fresh acquisition journal from that `ACQUISITION` row in MVP
- do not create both `ACQUISITION` and `CAPITALIZATION` for the same manual activation event in MVP
- CARI AP-linked capitalization creates one `CAPITALIZATION` transaction row
- do not create both `ACQUISITION` and `CAPITALIZATION` for the same CARI-linked event in MVP
- low-value same-period full-expense reuses one `DEPRECIATION` transaction row in MVP; do not introduce a separate `LOW_VALUE_EXPENSE` transaction type
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
- useful life
- salvage values / salvage rule
- opening accumulated depreciation / opening NBV fields
- mapped accounts

Implementation note:
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
  - `FAILED`
- allow at most one persisted `DRAFT` run for the same `(tenant_id, legal_entity_id, book_id, fiscal_period_id)`
- a persisted `DRAFT` run is a frozen snapshot of the calculated run lines, run-line allocation rows, and totals at creation time
- posting must use the saved `DRAFT` run lines, run-line allocation rows, and totals; do not silently recompute the run at post time
- if users want refreshed calculations after asset/setup changes, they must replace the old `DRAFT` run with a newly created one instead of recalculating it in place

### Source-owned reversal surface
Lock non-run fixed-assets reversal ownership now so GL reverse-blocking points users to a real source workflow, not only back to a detail page.

Locked decision:
- `POST /api/v1/fixed-assets/runs/:runId/reverse` remains the source-owned reversal surface for depreciation batch journals
- add `POST /api/v1/fixed-assets/transactions/:transactionId/reverse` as the source-owned reversal surface for posted non-run fixed-assets transactions
- in MVP, the non-run transaction reversal surface covers posted `FIXED_ASSET_TRANSACTION` rows such as `ACQUISITION`, `CAPITALIZATION`, inline low-value `DEPRECIATION`, `OWNERSHIP_TRANSFER`, `WRITEOFF`, and `SALE`
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
- fixed-assets must write the owning journal source link with `journal_source_links.link_role = PRIMARY`
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
- replace the current static source-type route-hint model with a resolver-based reverse-block helper
- keep reverse blocking for:
  - `FIXED_ASSET_TRANSACTION`
  - `FIXED_ASSET_DEPRECIATION_RUN`

Resolver rule:
- reverse-block destination resolution must use:
  - `source_ref_type`
  - `source_ref_id`
  - source-record lookup where needed
- do not rely only on one static `source_ref_type -> route` map for fixed-assets source types

Required response shape:
- reverse-block responses must continue to return a normal error envelope
- the error must include structured `details` metadata for frontend routing
- at minimum include:
  - `blockingSourceLinks`
  - `primaryDestination`
  - `resolvedDestinations`

Required read-payload preflight shape:
- journal detail/read payloads used by Journal Workbench must include a `reverseBlock` metadata object when reversal is source-blocked
- that `reverseBlock` object must include the same routing semantics used by the reverse-block error contract, at minimum:
  - `blockingSourceLinks`
  - `primaryDestination`
  - `resolvedDestinations`
- this allows Journal Workbench to pre-block reversal using backend-owned destination metadata before submit instead of reconstructing fixed-assets routes locally from `source_links`
- for normal journal source-link drillback, upgraded fixed-assets `source_links` rows should likewise carry a `destination` object that uses the same minimum destination metadata shape where applicable

Minimum destination metadata shape:
- `sourceRefType`
- `sourceRefId`
- `route`
- `routeParams` nullable
- `query` nullable
- `label`
- `isFallback`

Primary-destination rule:
- when multiple blocking source links exist, the reverse-block response must return:
  - all resolved destinations in `resolvedDestinations`
  - one `primaryDestination` for direct UI navigation
- `primaryDestination` must be derived by `journal_source_links.link_role = PRIMARY` first
- if no `PRIMARY` source link is present, fall back to stable source-link ordering as a defensive compatibility fallback
- fixed-assets posting code must mark the owning source link as `PRIMARY` rather than relying only on insertion order

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
- `frontend/src/pages/JournalWorkbenchPage.jsx` must stop hardcoding fixed reverse-block route hints for fixed-assets source types
- normal "Open Source" actions for journal `source_links` must also stop hardcoding fixed-assets destinations and must use backend-owned `source_links[].destination` metadata when present
- when the selected journal read payload includes `reverseBlock`, Journal Workbench must use that backend-owned metadata for local pre-block checks, reverse-block messaging, and navigation hints before the reverse submit call
- when a reverse-block response includes `details.primaryDestination` or `details.resolvedDestinations`, the UI must use that structured metadata instead of reconstructing destination paths from a static source-type map
- if multiple resolved destinations are returned, the UI should use `primaryDestination` for direct navigation and may expose `resolvedDestinations` for secondary drillback choices
- static local route maps may remain only as fallback behavior for source types that have not been upgraded to structured destination metadata
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

### Owner OU mismatch for CARI-created assets
Open question:
- must `owner_operating_unit_id` equal `cari_documents.operating_unit_id` for CARI-created assets?

This needs real-life usage examples before locking.

Safe MVP posture until decided:
- do not silently invent inter-OU capitalization logic inside FA06

### Source-document reversal behavior
Open question:
- what happens if a source CARI document is reversed after it created or activated an asset?

Do not hide this behind implicit automation.

### Broader master-data rollout
Open question:
- whether broader master-data modules should be designed and implemented separately before any post-MVP fixed-assets expansion

This stays unlocked.

## Repo-Native Implementation Surface

### Backend files to add
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.evidence.routes.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js` if depreciation logic needs separation
- `backend/src/services/fixed-assets.reporting.service.js` if reporting SQL grows large
- `backend/src/services/gl.reverse-block-destination.service.js`

Mounting note:
- `backend/src/routes/fixed-assets.routes.js` must mount `fixed-assets.evidence.routes.js` as nested sub-routes for asset, transaction, and depreciation-run evidence surfaces; do not add a separate top-level evidence mount in `backend/src/index.js`
- `backend/src/routes/fixed-assets.routes.js` and `backend/src/routes/fixed-assets.evidence.routes.js` must reuse shared fixed-assets `resolveScope` helpers for asset, transaction, run, and request-scoped legal-entity/owner-OU resolution rather than duplicating ad hoc RBAC resolver SQL per route

### Backend files to update
- `backend/src/index.js`
- `backend/src/middleware/rbac.js` to add a secondary permission-assertion helper that does not replace `req.rbac`
- `backend/src/migrations/index.js`
- `backend/src/services/evidence.service.js`
- `backend/src/routes/_utils.js` to extend `badRequest(message, details = null)` in a backward-compatible way
- `backend/src/routes/gl.read.journal.routes.js`
- `backend/src/routes/gl.write.journal.routes.js`
- `backend/src/services/journal.source-link.service.js` or fixed-assets posting services that call it
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/src/seedCore.js` to add `fixed_assets.account_override` and update seeded role bundles so `TenantAdmin` inherits it through full-catalog seeding, `CountryController` and `EntityAccountant` receive it explicitly, and `GroupController`, `BranchOperator`, and `AuditorReadOnly` do not

### Frontend files to add/update
Most fixed-assets frontend files in this list already exist as scaffolds. Treat them as verify/update surfaces unless a real missing page is discovered.

- `frontend/src/pages/fixedAssets/FixedAssetsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetFormPage.jsx`
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
- verify/update `frontend/src/layouts/sidebarConfig.js` if sidebar visibility or route normalization changes are needed
- verify/update `frontend/src/i18n/messages.js` if fixed-assets labels, aliases, or route text need cleanup

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
- route aliases or redirects are acceptable for backward compatibility
- `/app/demirbas-karti-detayi/:assetId` is a canonical workflow/detail route even if it is not a primary sidebar destination
- dynamic reverse-block routing may target canonical list/workflow/detail routes, not only sidebar landing pages

## Master Tracker
- [ ] `FA01` - Fixed-assets schema foundation and lifecycle invariants
- [ ] `FA02` - Interim custodian setup
- [ ] `FA03` - Categories and depreciation profiles
- [ ] `FA04` - Asset register and detail foundation
- [ ] `FA05` - Manual create/edit/activate workflow
- [ ] `FA06` - CARI AP-line capitalization
- [ ] `FA07` - Depreciation schedule engine
- [ ] `FA08` - Depreciation runs, run lines, and journal integration
- [ ] `FA09` - Physical move and custodian reassignment
- [ ] `FA10` - Ownership transfer between operating units
- [ ] `FA11` - Disposal / write-off / sale
- [ ] `FA12` - Evidence, audit links, and source traceability
- [ ] `FA13` - Reports, filters, and exports
- [ ] `FA14` - Permissions, sidebar gating, and approval-sensitive actions

---

## `FA01` - Fixed-assets schema foundation and lifecycle invariants

### Goal
Create the minimum trustworthy schema for an OU-aware fixed-assets subledger that matches repo conventions.

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
- this list defines FA01 scope only; it is not the migration DDL order for `m139_fixed_assets_foundation.js`
- `m139_*` must follow the dependency-safe staged-DDL rule locked in the migration-numbering section

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
- `serial_no` nullable
- `acquisition_date`
- `capitalization_date`
- `in_service_date`
- `disposal_date` nullable
- `currency_code`
- `original_cost_txn`
- `original_cost_base`
- `salvage_value_txn`
- `salvage_value_base`
- `useful_life_months`
- `remaining_useful_life_months` nullable
- `depreciation_profile_id`
- `asset_account_id`
- `accum_depr_account_id`
- `depr_expense_account_id`
- `disposal_gain_account_id`
- `disposal_loss_account_id`
- `opening_accum_depr_txn`
- `opening_accum_depr_base`
- `opening_nbv_txn`
- `opening_nbv_base`
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

Opening-balance field rule:
- `opening_accum_depr_*` and `opening_nbv_*` are manual-asset setup fields only
- they are allowed only while the asset is `DRAFT`
- they are not allowed for CARI-linked assets
- they become read-only after activation
- CARI-linked/source-linked assets must keep these fields null or zero in MVP
- these fields do not imply persisted pre-activation schedule rows; forward schedule generation starts at activation
- manual opening-balance assets must also carry `remaining_useful_life_months` before activation so forward scheduling has a locked horizon

Custodian migration-sequencing rule:
- because `fixed_asset_custodian_employees` is introduced in `m140`, `m139` must create `fixed_assets.custodian_employee_id` as a nullable column without a foreign-key constraint
- the custodian foreign key for `fixed_assets.custodian_employee_id` is added only in `m140` after the referenced table exists

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
- `useful_life_months` for depreciable assets except below-threshold low-value assets that use same-period full-expense treatment
- `remaining_useful_life_months` for manual opening-balance depreciable assets
- `salvage_value_txn` and `salvage_value_base` if not defaulted yet; by activation they must resolve to explicit numeric values, including zero when applicable
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
- `ACQUISITION` = manual asset activation event, including manual onboarding of legacy / go-live opening-balance assets
- for manual opening-balance / go-live assets, `ACQUISITION` is an onboarding/audit event and `journal_entry_id` stays null in MVP because no new acquisition is being booked
- `CAPITALIZATION` = CARI-linked capitalization into the fixed-assets subledger
- for CARI-backed transactions, `source_ref_type` must use `CARI_DOCUMENT`; line-level provenance belongs in `source_ref_line_id`, not a separate `CARI_DOCUMENT_LINE` source type
- `DEPRECIATION` = posted depreciation event, including the one-time low-value same-period full-expense posting used for below-threshold assets in MVP
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
- non-journal transactions such as opening-balance onboarding `ACQUISITION`, `SUSPEND`, `REACTIVATE`, and `PHYSICAL_MOVE` may therefore reach `POSTED` with `journal_entry_id = null`

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
- `FAILED`

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
- unique source-link constraint for one CARI line to one asset in MVP
- unique persisted-`DRAFT` run constraint for at most one `(tenant_id, legal_entity_id, book_id, fiscal_period_id)` run in `DRAFT`
- unique asset-period depreciation posting constraint
- the unique asset-period depreciation posting constraint is intentionally not book-qualified in MVP because fixed-assets is single-book operationally per `(tenant_id, legal_entity_id)`
- unique non-null `fixed_asset_transactions.reversed_transaction_id` constraint so one posted source-owned transaction cannot be reversed more than once
- `fixed_asset_transactions.reversed_transaction_id` must carry the authoritative self-reference for reversal lineage in MVP
- if `fixed_asset_transactions.reversal_transaction_id` is retained, it must not be relied on as the only DB-backed reversal-lineage guard
- custodian foreign-key constraints are introduced in `m140` after `fixed_asset_custodian_employees` exists; `m139` carries only the nullable custodian reference columns on `fixed_assets` and `fixed_asset_physical_move_details`
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
- do not leave the persisted-`DRAFT` run uniqueness rule as service-only logic
- `m139_fixed_assets_foundation.js` must also use dependency-safe staged DDL for intra-`m139` references instead of assuming every foreign key can be declared inline during first-pass table creation
- when intra-`m139` forward or circular references exist, create the columns first and add the foreign-key constraints later via `ALTER TABLE` after both referenced tables exist

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
- `m140_fixed_asset_custodian_employees.js` owns creation of `fixed_asset_custodian_employees`
- `m140_fixed_asset_custodian_employees.js` also adds the foreign-key constraints for:
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
- threshold defines low-value same-period full-expense treatment in MVP; below-threshold assets may still be tracked in fixed-assets, but they are not eligible for normal depreciation schedule/run treatment
- salvage defaults must use an explicit rule, not a vague nullable number
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
- `DECLINING_BALANCE` is not implementable unless a rate is locked
- lock MVP declining-balance configuration to `declining_balance_rate_percent`
- `declining_balance_rate_percent` is an annual nominal percentage rate in MVP, not a monthly input
- `switch_to_straight_line` means a permanent switch using the locked schedule-engine comparison rule; it is not an advisory flag
- when `method = DECLINING_BALANCE`, `declining_balance_rate_percent` is required
- when `method <> DECLINING_BALANCE`, `declining_balance_rate_percent` must be null

### Profile methods
- `STRAIGHT_LINE`
- `DECLINING_BALANCE`
- `NONE`

### Acceptance
- category defaults prefill manual and CARI-linked asset creation
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
- `depreciation_profile_id` is required before activation for depreciable assets except below-threshold low-value assets using same-period full-expense treatment
- `useful_life_months` is required before activation for depreciable assets except below-threshold low-value assets using same-period full-expense treatment
- `remaining_useful_life_months` is required before activation for manual opening-balance depreciable assets
- salvage values must resolve to explicit numeric values before activation, even when zero
- account mappings required before activation
- account mappings and any category-default or override account values used at activation must satisfy the locked expected account types and the locked legal-entity chart-of-accounts ownership rule:
  - `asset_account_id` -> `ASSET`
  - `accum_depr_account_id` -> `ASSET`
  - `depr_expense_account_id` -> `EXPENSE`
  - `disposal_gain_account_id` -> `REVENUE`
  - `disposal_loss_account_id` -> `EXPENSE`
- if opening balances are supplied, the asset must be manual and still `DRAFT`
- if opening balances are supplied, `opening_accum_depr_txn <= original_cost_txn`
- if opening balances are supplied, `opening_accum_depr_base <= original_cost_base`
- if opening balances are supplied, `opening_nbv_txn = original_cost_txn - opening_accum_depr_txn`
- if opening balances are supplied, `opening_nbv_base = original_cost_base - opening_accum_depr_base`
- if opening balances are supplied, opening NBV must not be below salvage value in either txn or base amount
- if `original_cost_base` is below the category `capitalization_threshold_base`, activation must route the asset through the dedicated low-value same-period full-expense path
- below-threshold assets may still be activated for tracking, but they are not eligible for normal depreciation scheduling or depreciation runs in MVP
- below-threshold low-value assets use one-time same-period full-expense treatment through a `DEPRECIATION` transaction created during activation
- that inline low-value `DEPRECIATION` row must carry `depreciation_kind = LOW_VALUE_FULL_EXPENSE`
- below-threshold low-value assets must resolve `salvage_value_txn` and `salvage_value_base` to zero before activation
- below-threshold low-value assets do not require normal depreciation profile/life inputs for activation because they do not enter the normal schedule/run path

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
- opening accumulated depreciation / opening NBV fields are locked
- category, depreciation profile, useful life, remaining useful life, salvage values/rules, mapped accounts, and source CARI linkage are not silently editable in MVP

### Opening-balance rule
- opening balances are supported only for manually created assets and only while the asset is `DRAFT`
- after activation, opening balance fields are immutable
- CARI-linked assets do not support opening balances in MVP
- manual opening-balance assets must capture `remaining_useful_life_months` before activation
- activation of a manual opening-balance / go-live asset still creates one `ACQUISITION` transaction row for asset history
- that onboarding `ACQUISITION` row does not post a new acquisition journal in MVP and `journal_entry_id` remains null
- opening balances seed forward depreciation scheduling from the activation state rather than generating historical schedule lines

### Acceptance
- draft save exists before activation
- activation creates auditable lifecycle transactions
- manual activation creates one `ACQUISITION` transaction row, not both `ACQUISITION` and `CAPITALIZATION`
- manual opening-balance / go-live assets create one `ACQUISITION` row for onboarding history without duplicating a fresh GL acquisition journal
- below-threshold manual assets create one `ACQUISITION` row plus one same-period `DEPRECIATION` row, remain tracked, end with zero NBV, and do not become `DISPOSED`
- below-threshold manual assets are treated as `FULLY_DEPRECIATED` after the one-time same-period full-expense posting
- schedule generation is explicit and repeatable
- manual go-live assets with opening balances generate forward-only schedules without historical backfill

---

## `FA06` - CARI AP-line capitalization

### Goal
Create or activate assets from CARI AP document lines with source traceability.

### Locked model
- MVP targets AP-direction CARI documents
- one source line creates one asset
- FA06 eligible-line selection must exclude any CARI document line already linked to a different fixed asset under the MVP one-source-line-to-one-asset rule
- capitalization follows option A:
  - AP line posts directly to the fixed-asset account
  - the fixed-assets subledger records one `CAPITALIZATION` transaction row for the event
  - do not also create an `ACQUISITION` transaction row for the same CARI-linked event
- FA06 capitalization provenance on `fixed_asset_transactions` must use:
  - `source_ref_type = CARI_DOCUMENT`
  - `source_ref_id = source_cari_document_id`
  - `source_ref_line_id = source_cari_document_line_id`
- if the source line amount maps to `original_cost_base` below the category `capitalization_threshold_base`, the asset may still be created for control/tracking but must use the dedicated low-value same-period full-expense path instead of normal depreciation treatment
- low-value same-period full-expense in FA06 is represented by one `DEPRECIATION` transaction row created during capitalization
- that inline low-value `DEPRECIATION` row must carry `depreciation_kind = LOW_VALUE_FULL_EXPENSE`

### Required workflow
- select eligible CARI AP line
- validate source line rules
- choose category
- choose owner OU
- choose location OU
- choose in-service and capitalization dates
- create draft asset or activate

### Required permission behavior
- FA06 requires fixed-assets permissions and `cari.doc.read`
- do not expose eligible AP lines to users who lack `cari.doc.read`
- if the FA06 flow later triggers CARI-side create/update/post behavior, require the matching `cari.doc.*` permission instead of bypassing CARI authorization

### Locked source-state rule
- draft linkage may point at a draft CARI document line
- activation/posting requires the source CARI document to be `POSTED`

### Locked opening-balance interaction
- CARI-linked assets cannot accept manual opening balances in MVP
- AP-line capitalization starts from the source document line amounts, not imported carrying values

### Repo-backed shortcut
- do not build a brand-new CARI line-detail backend first for MVP
- reuse the existing CARI document detail route/service to load source lines, amounts, and `posting_account_id`
- after reusing the CARI document detail load, FA06 must apply fixed-assets-side eligibility filtering so already-linked source lines are not offered as selectable AP lines except when the current draft asset is reloading its own existing source line
- start from:
  - `backend/src/routes/cari.document.routes.js`
  - `backend/src/services/cari.document.service.js`

### Acceptance
- source document and source line stay visible on asset detail
- no manual duplicate data entry for standard AP capitalization
- source-line uniqueness is DB-enforced
- eligible AP-line selection excludes source lines already linked to another fixed asset instead of failing only at final write time
- authorization remains consistent with CARI document access rules
- CARI-linked activation/capitalization creates one `CAPITALIZATION` transaction row, not both `ACQUISITION` and `CAPITALIZATION`
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
- opening-balance manual-asset path from:
  - opening NBV at activation
  - salvage value
  - `remaining_useful_life_months`
  - profile rules
- opening-balance assets generate forward schedule lines only; they do not backfill historical periods
- below-threshold assets are excluded from the normal depreciation schedule path and instead follow the dedicated low-value same-period full-expense treatment
- low-value same-period full-expense is executed as a one-time `DEPRECIATION` posting during activation/capitalization, not as part of the normal future schedule path
- prevent NBV from falling below salvage value
- respect disposal and fully-depreciated states

### Locked schedule convention
- use `DAILY_PRORATA` month convention in MVP
- generate fixed-assets schedule lines only for non-adjustment fiscal periods that align to one calendar `YYYY-MM` month bucket under the locked `period_key` strategy
- calculate monthly depreciation using `monthly_amount * eligible_days / days_in_month`
- apply `STRAIGHT_LINE`, `DECLINING_BALANCE`, and `NONE` using the globally locked method rules; do not improvise alternative declining-balance formulas at implementation time
- use repo-native currency/legal-entity precision rounding
- push any residual rounding delta into the final depreciation schedule line
- opening-balance assets start schedule generation from the activation state / first eligible forward period, not from persisted pre-activation lines
- opening-balance assets must use stored `remaining_useful_life_months` as the forward depreciation horizon
- below-threshold low-value assets do not generate normal future depreciation schedule lines
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
- manual imported assets produce deterministic forward-only schedules from opening balances
- below-threshold tracked assets are excluded from normal depreciation schedule generation
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
- persisted `DRAFT` run lines must retain the daily-prorata basis used for calculation, at minimum `eligible_days` and `days_in_period`, so partial-month results remain auditable without recomputation
- when `DAILY_PRORATA` requires ownership-transfer month splitting, the frozen snapshot must also persist `fixed_asset_depreciation_run_line_allocations` rows that capture OU-segment allocation detail
- posting must use the saved `DRAFT` run lines, run-line allocation rows, and totals rather than recalculating against changed asset state
- if users need a fresh calculation after asset/setup changes, they must replace the old `DRAFT` run with a newly created one
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
- run reversal leaves affected schedule lines explicitly `REVERSED`, clears current schedule-line posted links, and still allows a clean repost for the same asset and period
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
- sale must use a dedicated fixed-assets action endpoint: `POST /api/v1/fixed-assets/:assetId/sale`
- do not implement sale as a fixed-assets-only free-form proceeds entry
- treat sale as a retirement/disposal subtype represented by one `SALE` transaction row
- do not create any extra generic retirement/disposal row alongside `SALE`
- fixed-assets handles disposal accounting and traceability
- CARI AR handles customer receivable / billing lifecycle
- when the sale flow creates or links a CARI AR document, the `SALE` transaction provenance on `fixed_asset_transactions` must use:
  - `source_ref_type = CARI_DOCUMENT`
  - `source_ref_id = related AR cari_documents.id`
  - `source_ref_line_id = related cari_document_lines.id` on the posted/finalized `SALE` row
- if fixed-assets creates the AR document, it must create one dedicated asset-sale line and use that line as the `source_ref_line_id` on the posted `SALE`
- if the sale flow uses a draft/pre-post stage, do not leave `source_ref_line_id` null once the `SALE` transaction reaches `POSTED`

### Required sale request shape
At minimum, the sale workflow must carry enough information to create or link the customer-facing CARI AR side.

MVP rule:
- the sale request must either reference an existing related AR-direction CARI document or provide the required linkage/create inputs expected by the CARI AR integration path
- when linking an existing AR-direction CARI document, the request must identify the exact AR line id to use for the asset sale
- when creating an AR-direction CARI document through fixed-assets, the flow must create one dedicated asset-sale line and persist that line id as `source_ref_line_id` on the posted `SALE` transaction
- do not treat sale as a plain disposal request with an optional proceeds number only

### Required permission behavior
- FA11 sale flows require fixed-assets disposal/sale authority and the relevant CARI permissions
- linking an existing AR-direction CARI document requires `cari.doc.read`
- creating a draft AR-direction CARI document requires `cari.doc.create`
- editing a linked draft AR-direction CARI document requires `cari.doc.update`
- posting an AR-direction CARI document requires `cari.doc.post`
- if a single sale flow performs multiple CARI actions, it must require the full set of permissions for those actions
- do not allow sale flows to read, create, update, or post AR-direction CARI documents through fixed-assets routes when the matching CARI permission is missing

### Acceptance
- disposed assets cannot continue depreciating
- gain/loss posting uses configured accounts
- sale workflow is traceable to a related CARI AR document and exact AR line
- disposal remains traceable in detail, reports, and journals
- sale produces one `SALE` transaction row and still results in asset status `DISPOSED`
- sale authorization remains consistent with action-specific CARI document security
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
- reverse-block responses return structured destination metadata in the standard error envelope `details`
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
- `backend/src/seedCore.js` must be updated because the current seeded fixed-assets permission family does not yet include `fixed_assets.account_override`
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

### Lifecycle actions
- `POST /api/v1/fixed-assets/:assetId/physical-move`
- `POST /api/v1/fixed-assets/:assetId/ownership-transfer`
- `POST /api/v1/fixed-assets/:assetId/sale`
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
- migrations start at `m139_*`
- implementation language matches repo reality: migrations + validators + SQL services + routes
- backend fixed-assets module files and `/api/v1/fixed-assets` mount exist for real
- frontend demirbas routes use dedicated fixed-assets pages, not the generic placeholder flow
- OpenAPI work is delivered, not skipped
- OpenAPI generator includes `FixedAssets` tag support and `/api/v1/fixed-assets` inference
- evidence service supports fixed-asset source types at asset, transaction, and run level
- fixed-assets evidence routes are mounted as nested sub-routes inside `fixed-assets.routes.js` for asset, transaction, and run evidence surfaces, not as a separate top-level app mount
- GL reverse-blocking recognizes fixed-assets source types and resolves dynamic destination metadata from fixed-assets source records
- reverse-block responses include structured destination metadata in error `details`
- the shared backend `badRequest(message, details = null)` helper supports structured `details`, and fixed-assets reverse-blocking uses that repo-native path instead of a one-off custom error shape
- journal detail/read payloads used by Journal Workbench include backend-owned reverse-block destination metadata so client-side preflight does not rely on static fixed-assets route maps
- fixed-assets journals route users back to the most relevant owning workflow with defined fallback behavior
- normal Journal Workbench source-link drillback recognizes `FIXED_ASSET_TRANSACTION` and `FIXED_ASSET_DEPRECIATION_RUN` using the same backend-owned route/query contract as reverse-blocking where applicable
- Journal Workbench uses reverse-block `details.primaryDestination` and `details.resolvedDestinations` instead of hardcoding fixed-assets route hints from a static source-type map
- CARI-linked fixed-assets workflows respect both `fixed_assets.*` and action-specific required `cari.doc.*` permissions
- FA06 and FA11 multi-permission enforcement use a shared secondary RBAC permission-assertion helper without stacking `requirePermission(...)` middlewares that overwrite `req.rbac`
- fixed-assets routes use shared RBAC `resolveScope` helpers for list/create, asset, transaction, run, and evidence surfaces instead of route-by-route ad hoc resolver logic
- fixed-assets multi-row mutating workflows use one locked `withTransaction(...)` boundary, including sequence reservation and the consuming asset-row/journal/source-link writes for the same business event
- seeded role-bundle assignment for `fixed_assets.account_override` is locked: `TenantAdmin` inherits it through full-catalog seeding, `CountryController` and `EntityAccountant` receive it explicitly, and `GroupController`, `BranchOperator`, and `AuditorReadOnly` do not
- category capitalization thresholds drive defined low-value same-period full-expense behavior in MVP
- low-value same-period full-expense is implemented as a one-time `DEPRECIATION` posting that leaves the asset tracked and `FULLY_DEPRECIATED`, not `DISPOSED`
- `DEPRECIATION` rows are explicitly classified so normal run-posted depreciation and low-value inline full-expense remain distinguishable
- fixed-assets account mappings and category defaults enforce locked expected GL account types and legal-entity chart-of-accounts ownership rules, including accumulated depreciation validating as `ASSET` under the repo's account model
- manual opening-balance / go-live assets are onboarded into fixed-assets without double-booking a fresh acquisition journal
- suspend/reactivate flows create explicit `SUSPEND` / `REACTIVATE` transaction history rows instead of changing status without lifecycle traceability
- non-run fixed-assets posting events have a source-owned transaction reversal surface instead of relying on direct GL reverse
- fixed-assets reversal lineage uses authoritative `reversed_transaction_id` semantics with DB-backed single-reversal enforcement
- posted `SALE` transactions keep exact CARI AR line provenance through `source_ref_line_id` rather than header-only document linkage
- disposal of already-fully-depreciated assets does not create zero-amount depreciation postings merely to mark the disposal-month cutoff
- fixed-assets uses one operational posting book per legal entity in MVP; schedule lines and asset-period depreciation posting uniqueness are not multi-book aware
- month convention is `DAILY_PRORATA` with effective-date cutoffs for suspension, reactivation, ownership transfer, sale, and write-off
- depreciation-run reversal marks affected schedule lines as `REVERSED`, clears their current posted-link fields, and still allows reposting for the same asset and period
- prorata transfer-month owner-OU allocation context is persisted in dedicated run-line allocation rows, not left as an implied report-time reconstruction
- physical-move and ownership-transfer history is DB-backed through dedicated detail tables, not generic note-only history
- ownership-transfer accounting uses a locked gross-cost-plus-accumulated-depreciation journal template with directional OU self-balancing on transferred NBV, not an implementation-defined net-only template
- asset numbering uses a locked backend-reserved `FA-######` format with continuous legal-entity sequencing
- fixed-assets journal headers use locked repo-native `FA-*` journal-number prefixes and `journal_entries.source_type = SYSTEM` rather than introducing a new fixed-assets-specific journal-header enum
- stored fixed-assets `period_key` values use locked calendar `YYYY-MM` format and fixed-assets schedule/run data excludes adjustment periods in MVP
- enums are uppercase repo-style values
- dual transaction/base amounts are stored where required
- CARI AP capitalization follows direct capitalization option A
- journal linkage is transaction-based, not master-based
- reports and exports are both contracted, with dedicated `/export` endpoints for fixed-assets reports
- key uniqueness rules are DB-enforced
- open decisions remain visible instead of being buried in implicit behavior
