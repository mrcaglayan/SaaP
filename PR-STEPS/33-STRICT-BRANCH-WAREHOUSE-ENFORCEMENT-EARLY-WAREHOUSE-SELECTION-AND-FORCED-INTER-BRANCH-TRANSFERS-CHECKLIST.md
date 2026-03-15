# 33 - STRICT OWNERSHIP-CONTEXT WAREHOUSE ENFORCEMENT, EARLY WAREHOUSE BINDING, STRICT ISSUE VALIDATION, AND EXPLICIT CROSS-CONTEXT TRANSFERS

## Execution tracking
- This file is the execution tracker for replacing the current loose inventory flow with a strict ownership-context warehouse model.
- It aligns to the repo's current CARI and inventory reality:
  - warehouse ownership is already modeled as `CENTRAL` vs `OPERATING_UNIT`
  - CARI post currently creates pending stock links first
  - warehouse is currently chosen later during inventory materialization
- This tracker removes late warehouse choice from the normal path for new strict-mode stock-affecting flows.
- Legacy rows created before this change remain readable, but only controlled repair handling stays in scope for them.
- Current implementation assumption for this rollout:
  - the working database is empty today
  - the database will be reset again after implementation is complete
  - no historical backfill is required for this rollout
  - legacy/repair notes remain in this tracker only as repo guardrails for future non-empty environments
- If product or API direction changes later, update this tracker before implementation continues.

## Scope
- ownership-context terminology lock across backend, frontend, OpenAPI, tests, and operator docs
- required active warehouse readiness per inventory-enabled ownership context
- required warehouse binding on new stock-affecting CARI lines before posting
- strict issue-side stock availability validation against the bound warehouse at posting time
- pending stock-link warehouse propagation at creation time
- successor / reversal pending-link inheritance hardening
- pending queue, queue summary, and card hardening
- explicit reuse of existing cross-context transfer workflow
- legacy unbound line / pending-link repair handling
- OpenAPI, runbooks, regression gates, and rollout notes

## Locked product decisions for this tracker
- [x] Ownership context is modeled as `CENTRAL` or `OPERATING_UNIT`; "branch" is UI/business wording for an operating unit, not a separate backend ownership type.
- [x] `CENTRAL` means no `operating_unit_id`; `OPERATING_UNIT` means a specific `operating_unit_id`.
- [x] Each inventory-enabled ownership context must have at least one active warehouse before any stock-affecting transaction can be posted for that context.
- [x] No warehouse is auto-created by the system.
- [x] New stock-affecting CARI lines require warehouse binding before posting.
- [x] V1 strict mode uses required warehouse binding at line level, not "choose later from the pending queue."
- [x] A stock-affecting sales posting cannot succeed unless the bound warehouse has sufficient available stock for every stock line.
- [x] Cross-context fulfillment must use explicit transfer; one ownership context cannot consume stock directly from another ownership context's warehouse.
- [x] New pending stock links are warehouse-bound at creation time.
- [x] Late warehouse choice is not the normal path for new strict-mode links.
- [x] Successor pending links created during reversal / reopen flows must inherit warehouse binding where valid, or fall into controlled repair-only handling.
- [x] Legacy unbound rows are repair-only and must not reopen loose-mode behavior.
- [x] The `Pending CARI Stock Links` card and related queue views must always show owning ownership context and bound warehouse for each pending row.
- [x] Backend post-time validation remains authoritative even if frontend preview / helper reads are added later.
- [x] Warehouse lookup for stock-affecting CARI lines and any optional pre-post availability preview use narrow CARI-owned read endpoints backed by shared inventory logic; stock-affecting CARI posting must not require broad `inventory.read` permission only to choose warehouse or preview stock.
- [x] Strict-mode materialization uses a dedicated materialize-by-stock-link endpoint under the `cari-stock-links` route family; `POST /api/v1/inventory/movements` remains a legacy repair-only surface in this wave. New strict-mode execution must not accept caller-selected `warehouseId`; warehouse is derived from the bound stock link.
- [x] Legacy repair uses separate admin/ops-only repair routes/actions and a separate repair workspace; the normal `/app/stok-yansitma-islemleri` queue remains focused on strict-mode execution and visibility, not historical repair.
- [x] The separate repair workspace requires explicit repair-only RBAC and navigation wiring; do not expose it automatically to users who only have `inventory.read` or `inventory.upsert`.
- [x] Base stock-link lifecycle remains `PENDING | LINKED | VOID`; do not replace it with a giant queue-status enum.
- [x] Queue/API/OpenAPI add a separate derived `queueState` contract for operator-facing execution state, plus non-overlapping reason-code fields and a few convenience flags.
- [x] V1 queue/work-state contract uses:
  - `queueState`: `READY | BLOCKED | REPAIR_REQUIRED | TRANSFER_REQUIRED | COMPLETED | VOID`
  - nullable `blockedReasonCode`
  - nullable `repairReasonCode`
  - `canMaterialize`
  - `isStrictMode`
  - `isRepairOnly`
  - `isLegacyRow`
- [x] `TRANSFER_REQUIRED` is expressed as `queueState`, not duplicated inside `blockedReasonCode`; invalid successor inheritance and legacy repair cases are expressed through `repairReasonCode`, not `blockedReasonCode`.

## Important repo guardrails
- [x] Reuse the current warehouse ownership model from `backend/src/migrations/m123_inventory_warehouse_ownership_scope.js`; do not invent a new backend "branch ownership" type.
- [x] `backend/src/services/cari.document.service.js` is the current source of truth for:
  - draft line normalization
  - line/item-card defaults
  - CARI post orchestration
  - pending stock-link creation via `replaceDocumentLineStockLinksTx(...)`
- [x] `backend/src/services/inventory.service.js` is the current source of truth for:
  - pending stock-link list/query mapping
  - materialization via `createInventoryMovementFromStockLink(...)`
  - FIFO valuation via `buildIssueValuationPlan(...)`
  - successor-link creation via `ensureIssueReopenedStockLinkTx(...)`
- [x] Harden `ensureIssueReopenedStockLinkTx(...)` instead of inventing a second successor-link mechanism.
- [x] Reuse the current cross-context transfer slice in `backend/src/services/inventory.transfer.service.js`; do not broaden it into generic same-context warehouse transfer redesign.
- [x] `frontend/src/pages/cari/CariDocumentsPage.jsx` and `frontend/src/pages/cari/cariDocumentsUtils.js` are the current upstream CARI line UX surface; warehouse binding must move there instead of staying queue-first.
- [x] `frontend/src/pages/inventory/InventoryMovementsPage.jsx` is the current warehouse materialization / pending-link queue page; strict-mode hardening must remove silent auto-selection behavior there, not add more reliance on it.
- [x] Split the public materialization contract at the route level: strict-mode queue execution belongs on a dedicated `cari-stock-links/{stockLinkId}/materialize` route, while the current `/api/v1/inventory/movements` shape remains legacy repair-only in this wave.
- [x] Do not reintroduce warehouse-bind repair controls into the normal queue form on `frontend/src/pages/inventory/InventoryMovementsPage.jsx`; expose historical repair in a separate admin/ops surface with separate route and permission handling.
- [x] Keep `link_status` as the small persisted lifecycle in backend/service/OpenAPI layers and derive `queueState` / reason-code fields in the queue read model instead of expanding the stored status enum.
- [x] Current queue and summary surfaces are still pending-only by default; because the locked `queueState` contract includes `COMPLETED` and `VOID`, implementation must explicitly expand list filters, queue views, and dashboard summary coverage instead of assuming the existing pending-only path already satisfies the contract.
- [x] `postCariDocumentById(...)` currently reaches journal/open-item side effects before `replaceDocumentLineStockLinksTx(...)`; strict warehouse-readiness and issue-availability checks must be added before any post side effects are written.
- [x] The current normal queue page still couples `warehouseId + sourceStockLinkId` through `/api/v1/inventory/movements`; once the dedicated strict materialize endpoint lands, remove that coupling from normal execution instead of leaving both paths active.
- [x] `backend/src/services/inventory.service.js` already has a mapper/query mismatch for pending stock links:
  - `mapPendingStockLinkRow(...)` expects document operating-unit fields
  - `listPendingInventoryStockLinks(...)` does not currently select them
- [x] `backend/src/services/cari.document.service.js` current detail read model only exposes inventory warehouse info through materialized movement joins; pending bound-warehouse intent is not yet part of the line/stock-link response.
- [x] OpenAPI source of truth remains `backend/scripts/generate-openapi.js`; regenerate `backend/openapi.yaml` only after route/schema changes land together.
- [x] The current loose flow is encoded in code, docs, and regression coverage:
  - `backend/scripts/test-cari-line-model-rollout-regression.js`
  - `backend/scripts/test-inventory-pr26-release-gate.js`
  - `docs/runbooks/cari-v1-operations.md`
  - `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- [x] CARI and inventory permissions are split today:
  - CARI routes use `cari.doc.*`
  - inventory routes/pages use `inventory.read` / `inventory.upsert`
- [x] Add an explicit repair-only permission code in `backend/src/seedCore.js` and wire the separate repair page through `frontend/src/App.jsx` and `frontend/src/layouts/sidebarConfig.js`; do not let the repair workspace inherit the normal queue's `inventory.read` visibility by default.
- [x] Keep warehouse lookup / preview route ownership in `backend/src/routes/cari.document.routes.js` and reuse shared inventory-domain logic underneath; do not couple `/app/cari-belgeler` to broad inventory-page permissions just to support warehouse binding.

## Out of scope for this tracker
- No generic same-context warehouse-to-warehouse redesign.
- No automatic warehouse creation.
- No negative inventory.
- No generic manual inventory movement API redesign in this wave.
- No drop-ship / MTO / reservation-engine redesign.
- No soft backorder-first sales architecture in this wave.
- No broad transfer model expansion beyond the existing cross-context slice.
- No destructive historical backfill that pretends old lines / links were created under the strict model.

## Master tracker
- [ ] `PR-INV01` - Ownership-context terminology and shared policy foundation
- [ ] `PR-INV02` - Warehouse binding schema and CARI line contract foundation
- [ ] `PR-INV03` - Post-time readiness and strict issue availability enforcement
- [ ] `PR-INV04` - Pending-link propagation and strict materialization hardening
- [ ] `PR-INV05` - Successor inheritance and reversal leak closure
- [ ] `PR-INV06` - Frontend CARI warehouse UX and submit blocking
- [ ] `PR-INV07` - Pending queue, card, and work-queue API hardening
- [ ] `PR-INV08` - Explicit reuse of existing cross-context transfer workflow
- [ ] `PR-INV09` - Legacy unbound line / link repair handling
- [ ] `PR-INV10` - OpenAPI, regression gates, and rollout docs

## PR-INV01 - Ownership-context terminology and shared policy foundation

### Goal
- Lock repo-aligned terminology and extract the shared validation helpers before schema and UI changes start.

### Files
- `backend/src/services/cari.document.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/routes/cari.document.validators.js`
- `backend/src/routes/inventory.validators.js`
- `backend/scripts/generate-openapi.js`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`

### Routes / endpoints
- `POST /api/v1/cari/documents`
- `PUT /api/v1/cari/documents/{documentId}`
- `POST /api/v1/cari/documents/{documentId}/post`
- `GET /api/v1/inventory/cari-stock-links`

### Checklist

#### Terminology lock
- [ ] Define one canonical backend term set:
  - `CENTRAL`
  - `OPERATING_UNIT`
  - "branch" as UI/business alias only
- [ ] Define "inventory-enabled ownership context" as any context attempting to post stock-affecting lines.
- [ ] Define "stock-affecting line" centrally for:
  - purchase receipt-side lines
  - sales issue-side lines
  - transfer ship / receive flows where relevant
- [ ] Define canonical validation language used across backend and UI:
  - no active warehouse for ownership context
  - warehouse does not belong to ownership context
  - insufficient available stock in bound warehouse
  - stock exists in another ownership context and transfer is required

#### Shared helper foundation
- [ ] Extract or add shared ownership-context helper(s) used by both CARI post flow and inventory materialization flow.
- [ ] Extract or add shared warehouse ownership / readiness helper(s) instead of duplicating context checks ad hoc.
- [ ] Normalize error text and error-code use so repo layers stop mixing "branch" and "ownership context" for backend rules.
- [ ] Keep UI labels free to say "branch" where needed, but keep backend/OpenAPI/test contracts on the canonical ownership-context terminology.

### Acceptance
- [ ] There is one canonical ownership-context vocabulary across repo layers.
- [ ] Shared validation helpers exist before later slices build on them.
- [ ] No new backend logic introduced by this tracker uses vague "branch ownership" terminology.

## PR-INV02 - Warehouse binding schema and CARI line contract foundation

### Goal
- Make warehouse binding a first-class part of new stock-affecting CARI line input, storage, and detail read models.

### Files
- `backend/src/migrations/index.js`
- new migration after `m130_operating_unit_current_account_configs.js` for `cari_document_lines` warehouse binding
- `backend/src/routes/cari.document.validators.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/services/cari.document.service.js`
- `frontend/src/api/cariDocuments.js`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `backend/scripts/generate-openapi.js`

### Routes / endpoints
- `POST /api/v1/cari/documents`
- `PUT /api/v1/cari/documents/{documentId}`
- `GET /api/v1/cari/documents/{documentId}`

### Checklist

#### Schema
- [ ] Add line-level warehouse binding field(s) on `cari_document_lines`.
- [ ] Register the migration in `backend/src/migrations/index.js`.
- [ ] Preserve read compatibility for historical rows created before this tracker.

#### Validation and write-model contract
- [ ] Extend `parseDocumentCreateInput(...)` and `parseDocumentUpdateInput(...)` so new stock-affecting lines must carry warehouse binding.
- [ ] Keep non-stock lines free from warehouse requirements.
- [ ] Update line normalization / mapping in `backend/src/services/cari.document.service.js` so the line warehouse binding is loaded and returned from document detail reads.
- [ ] Update `createDocumentLineDraft(...)` and related line normalization helpers so draft rows carry warehouse binding during create/edit.
- [ ] Update payload builders in `frontend/src/pages/cari/CariDocumentsPage.jsx` so create/update requests send the warehouse binding cleanly.

#### Contract / read model
- [ ] Extend `CariDocumentLineInput` and related response shapes in `backend/scripts/generate-openapi.js`.
- [ ] Ensure `GET /api/v1/cari/documents/{documentId}` returns the line-level warehouse binding on new strict-mode rows.
- [ ] Make legacy rows readable without pretending they satisfy the strict contract.

### Acceptance
- [ ] New stock-affecting lines cannot be created or updated without warehouse binding in the contract.
- [ ] Document detail reads surface the selected warehouse on strict-mode lines.
- [ ] Backend, frontend, and OpenAPI all agree on the line-level warehouse field(s).

## PR-INV03 - Post-time readiness and strict issue availability enforcement

### Goal
- Fail stock-affecting posting early when ownership-context warehouse readiness or bound-warehouse stock sufficiency is not satisfied.

### Files
- `backend/src/services/cari.document.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/routes/cari.document.validators.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/scripts/test-cari-line-model-rollout-regression.js`

### Routes / endpoints
- `POST /api/v1/cari/documents/{documentId}/post`

### Checklist

#### Post-time warehouse readiness
- [ ] Extend `postCariDocumentById(...)` to resolve the document ownership context from `cari_documents.operating_unit_id`.
- [ ] Reject post when the ownership context has no active warehouse.
- [ ] Reject post when a bound warehouse is missing on any new strict-mode stock-affecting line.
- [ ] Reject post when the bound warehouse is inactive.
- [ ] Reject post when the bound warehouse belongs to a different ownership context than the document/line.
- [ ] Perform the strict warehouse-readiness checks before journal creation, open-item insertion, or any other post side effects so failed validation leaves no partial posting artifacts behind.

#### Strict issue-side validation
- [ ] Add shared issue-side availability validation using:
  - item
  - ownership context
  - bound warehouse
  - requested quantity
- [ ] Reuse current inventory valuation/open-layer logic or extract a shared helper from it so post-time and materialization-time logic do not drift.
- [ ] Return precise line-level shortage feedback instead of letting the operator discover the failure later in the pending queue.
- [ ] Keep materialization-time recheck as the second guard against later stock changes and races.

### Acceptance
- [ ] New stock-affecting posting cannot succeed without active warehouse readiness.
- [ ] New issue-side posting fails immediately on insufficient stock in the bound warehouse.
- [ ] "Post now, fail later in pending queue" is removed for new strict-mode issue flows.

## PR-INV04 - Pending-link propagation and strict materialization hardening

### Goal
- Carry bound warehouse intent into pending links at creation time and remove late warehouse choice from the normal strict-mode materialization path.

### Files
- `backend/src/migrations/index.js`
- new migration after `m130_operating_unit_current_account_configs.js` for `cari_document_line_stock_links` warehouse binding
- `backend/src/services/cari.document.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/routes/inventory.validators.js`
- `backend/src/routes/inventory.routes.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `backend/scripts/generate-openapi.js`

### Routes / endpoints
- `GET /api/v1/inventory/cari-stock-links`
- `POST /api/v1/inventory/cari-stock-links/{stockLinkId}/materialize`
- `POST /api/v1/inventory/movements`

### Checklist

#### Pending-link warehouse propagation
- [ ] Add stock-link warehouse binding field(s) on `cari_document_line_stock_links`.
- [ ] Update `replaceDocumentLineStockLinksTx(...)` so newly generated pending links copy the selected line-level warehouse binding exactly.
- [ ] Update document-detail stock-link mapping in `backend/src/services/cari.document.service.js` so pending strict-mode stock links expose the bound warehouse even before materialization.

#### Pending-link list/read hardening
- [ ] Update `listPendingInventoryStockLinks(...)` so rows include:
  - ownership context / operating unit display
  - bound warehouse id / code / name
  - document id / line id
  - requested quantity
  - materialized / remaining quantity or equivalent execution-state values
- [ ] Fix the current mapper/query mismatch so document operating-unit fields are actually selected before the mapper consumes them.

#### Strict materialization behavior
- [ ] Add a dedicated strict materialize route under the `cari-stock-links` route family for normal strict-mode queue execution.
- [ ] Update `createInventoryMovementFromStockLink(...)` or the shared posting logic it delegates to so strict-mode rows derive warehouse from the bound stock link.
- [ ] Keep authoritative rechecks for:
  - warehouse still active
  - warehouse still in the same ownership context
  - issue-side stock still sufficient at execution time
- [ ] Keep `POST /api/v1/inventory/movements` as the legacy repair-only stock-link surface in this wave; new strict-mode queue actions must not call it.
- [ ] Replace the current queue-side `createInventoryMovement(...)` normal-flow usage with a strict stock-link materialize action that does not ask the operator for `warehouseId` on strict rows.
- [ ] Preserve legacy repair-only handling for old unbound rows.
- [ ] Finalize the strict materialize request/response schema separately from the admin/ops repair contract and legacy repair request semantics on `/api/v1/inventory/movements`.

### Acceptance
- [ ] All newly generated strict-mode pending links are warehouse-bound.
- [ ] New strict-mode materialization uses the dedicated stock-link materialize endpoint and no longer depends on caller-selected warehouse semantics.
- [ ] Pending-link list/read responses expose enough context for safe queue execution.

## PR-INV05 - Successor inheritance and reversal leak closure

### Goal
- Close the leak where issue reversals create fresh unbound successor pending links.

### Files
- `backend/src/services/inventory.service.js`
- `backend/src/routes/inventory.routes.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `backend/scripts/test-cari-line-model-rollout-regression.js`
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`

### Routes / endpoints
- `POST /api/v1/inventory/movements/{movementId}/reverse`
- `POST /api/v1/cari/documents/{documentId}/reverse`

### Checklist

#### Successor inheritance
- [ ] Extend `ensureIssueReopenedStockLinkTx(...)` so valid successor rows inherit the original warehouse binding.
- [ ] Revalidate inherited warehouse binding before the successor row is treated as normal strict-mode work:
  - warehouse still exists
  - warehouse still active
  - warehouse still belongs to the same ownership context
- [ ] If inheritance is invalid, move the successor row into repair-only handling instead of creating a loose normal-mode row.

#### Reverse flow visibility
- [ ] Keep original/successor lineage fields intact and visible in queue/detail reads.
- [ ] Update queue/detail UI so reopened successor rows clearly show inherited-vs-repair-only status through `queueState`, `repairReasonCode`, and existing lineage fields.
- [ ] Keep CARI reverse docs aligned with the inventory unwind order.

### Acceptance
- [ ] Reversal / reopen flows no longer create fresh loose-mode pending links for new strict-mode data.
- [ ] Valid successor rows inherit warehouse binding.
- [ ] Invalid successor cases fall into controlled repair handling only.

## PR-INV06 - Frontend CARI warehouse UX and submit blocking

### Goal
- Move warehouse choice upstream into CARI create/edit/post UX and make missing / invalid warehouse binding obvious before post.

### Files
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `frontend/src/api/cariDocuments.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/routes/cari.document.validators.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/seedCore.js`

### Routes / endpoints
- `/app/cari-belgeler`
- `POST /api/v1/cari/documents`
- `PUT /api/v1/cari/documents/{documentId}`
- `POST /api/v1/cari/documents/{documentId}/post`
- new CARI-owned warehouse lookup endpoint(s) under `/api/v1/cari/...`
- optional CARI-owned availability-preview endpoint(s) under `/api/v1/cari/...`

### Checklist

#### Warehouse selection UX
- [ ] Add a warehouse selector to every stock-affecting line flow.
- [ ] Load warehouse choices from a narrow CARI-owned lookup endpoint backed by shared inventory logic.
- [ ] Filter selectable warehouses by legal entity plus resolved ownership context.
- [ ] Preserve selected warehouse during edit/read round-trips.
- [ ] Show the selected warehouse in line summary / detail areas so operators can verify it before posting.

#### Submit / post blocking
- [ ] Block save/post when a stock-affecting line has no warehouse binding.
- [ ] Block save/post when a selected warehouse belongs to another ownership context.
- [ ] Keep non-stock lines free from warehouse requirements.
- [ ] If availability preview ships in this wave, expose it through a narrow CARI-owned endpoint backed by shared inventory logic and keep backend post-time validation authoritative.
- [ ] Update CARI blocked/reverse guidance so document-level inventory links point operators to the strict queue or the separate repair workspace intentionally, not to the old queue-first mental model by default.

### Acceptance
- [ ] Users must choose warehouse before posting a stock-affecting CARI line.
- [ ] Users cannot choose a cross-context warehouse.
- [ ] The normal strict-mode path no longer depends on the inventory queue to make the first warehouse decision.

## PR-INV07 - Pending queue, card, and work-queue API hardening

### Goal
- Turn `/app/stok-yansitma-islemleri` into an execution / visibility screen instead of a late warehouse-decision screen, while explicitly expanding queue/history/dashboard scope where the locked `queueState` contract includes non-pending outcomes such as `COMPLETED` and `VOID`.

### Files
- `backend/src/services/inventory.service.js`
- `backend/src/routes/inventory.validators.js`
- `backend/src/routes/inventory.routes.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `backend/scripts/generate-openapi.js`

### Routes / endpoints
- `GET /api/v1/inventory/cari-stock-links`
- `GET /api/v1/inventory/work-queue-summary`
- `/app/stok-yansitma-islemleri`

### Checklist

#### Pending-link queue data
- [ ] Fix `listPendingInventoryStockLinks(...)` so output matches `mapPendingStockLinkRow(...)`.
- [ ] Return ownership context / operating unit display for every pending row.
- [ ] Return bound warehouse for every strict-mode row.
- [ ] Expand `parseInventoryStockLinkListFilters(...)`, `listPendingInventoryStockLinks(...)`, and queue page query usage so the queue can intentionally show broader lifecycle views where `queueState` includes `COMPLETED` or `VOID`, instead of remaining hardcoded to pending-only reads.
- [ ] Replace the current pending-only defaults in `frontend/src/pages/inventory/InventoryMovementsPage.jsx` and `backend/src/routes/inventory.validators.js` with explicit operator-visible scope controls so broader lifecycle views are intentional rather than hidden behind implicit `PENDING` behavior.
- [ ] Return enough execution-state fields for queue safety:
  - direction
  - requested quantity
  - materialized quantity / remaining quantity or equivalent
  - reopened lineage info
  - base `linkStatus`
  - derived `queueState`
  - nullable `blockedReasonCode`
  - nullable `repairReasonCode`
  - `canMaterialize`
  - `isStrictMode`
  - `isRepairOnly`
  - `isLegacyRow`

#### Queue / card UX
- [ ] Remove auto-selection of the first pending stock link.
- [ ] Remove auto-selection patterns that silently influence strict-mode warehouse behavior.
- [ ] Make warehouse read-only in queue for strict-mode rows.
- [ ] Remove the current normal-flow queue form behavior that pairs manual warehouse selection with `sourceStockLinkId`; keep explicit warehouse choice only in the separate legacy repair surface.
- [ ] Show legacy rows as repair-required in the normal queue, but hand off all repair actions to the separate admin/ops repair surface instead of exposing inline repair controls here.
- [ ] Make `queueState` the primary operator-facing badge and show reason-code detail only when applicable instead of overloading raw `linkStatus`.
- [ ] Add queue tabs / filters / views that make the broader `queueState` contract usable in practice, including visibility for `COMPLETED` and `VOID` rows where those states are meant to be operator-visible.
- [ ] Update the `Pending CARI Stock Links` card to always show:
  - owning ownership context / branch label
  - bound warehouse
  - item
  - direction
  - quantity state
  - `queueState`
  - reason detail when blocked or repair-only

#### Queue summary / dashboard
- [ ] Keep `getInventoryWorkQueueSummary(...)` and `frontend/src/pages/Dashboard.jsx` aligned around derived `queueState` counts instead of raw lifecycle-only counts where queue execution status matters.
- [ ] Expand `getInventoryWorkQueueSummary(...)` beyond pending-only aggregates where needed so dashboard summary can represent the locked `queueState` contract instead of only receipt/issue pending counts.
- [ ] Decide and document whether the default dashboard remains execution-focused on pending work while separate counters or views expose `COMPLETED` / `VOID`, or whether the primary summary itself expands to cover those states directly.
- [ ] Do not let dashboard or queue summaries hide ownership context once the detailed list becomes stricter.

### Acceptance
- [ ] Pending queue/card always show ownership context and warehouse.
- [ ] Pending queue/card use stable base `linkStatus` plus derived `queueState` / reason codes instead of a giant enum.
- [ ] `queueState` values such as `COMPLETED` and `VOID` are either visible through explicit queue/dashboard scope expansion or deliberately documented as separate views, not left as dead contract values on a pending-only screen.
- [ ] Queue no longer behaves like the place where warehouse is first decided.
- [ ] Auto-selection risks for wrong pending row / wrong context are removed.

## PR-INV08 - Explicit reuse of existing cross-context transfer workflow

### Goal
- Keep inter-context stock movement aligned to the repo's current transfer design and prevent accidental scope expansion.

### Files
- `backend/src/services/inventory.service.js`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/routes/inventory.transfer.routes.js`
- `backend/src/routes/inventory.transfer.validators.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`

### Routes / endpoints
- `POST /api/v1/inventory/transfers`
- `POST /api/v1/inventory/transfers/{transferId}/approve`
- `POST /api/v1/inventory/transfers/{transferId}/ship`
- `POST /api/v1/inventory/transfers/{transferId}/receive`
- `POST /api/v1/cari/documents/{documentId}/post`

### Checklist
- [ ] Keep the current `createInventoryTransfer(...)` rule that source and target warehouses must belong to different ownership contexts.
- [ ] Continue to reject direct issue posting when warehouse context and document context do not match.
- [ ] Add clearer transfer-required guidance when stock exists only in another ownership context.
- [ ] Reuse the existing transfer lifecycle instead of widening this tracker into same-context transfer redesign.
- [ ] Preserve transfer source/destination ownership-context evidence and auditability.

### Acceptance
- [ ] One ownership context cannot directly consume another ownership context's warehouse stock.
- [ ] Cross-context transfer remains the only valid fulfillment path.
- [ ] This tracker does not accidentally redesign same-context generic warehouse movement behavior.

## PR-INV09 - Legacy unbound line / link repair handling

### Goal
- Support historical data safely without weakening the new strict model.
- For the current implementation environment, the database is empty and will be reset after implementation, so this slice is retained as a repo guardrail rather than an expected rollout backlog item.

### Files
- `backend/src/services/inventory.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/routes/inventory.routes.js`
- `backend/src/routes/inventory.validators.js`
- new admin/ops repair route module under `backend/src/routes/`
- `frontend/src/api/inventory.js`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- new admin/ops repair page under `frontend/src/pages/inventory/`
- `backend/src/seedCore.js`
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- `backend/scripts/test-cari-line-model-rollout-regression.js`

### Routes / endpoints
- `GET /api/v1/inventory/cari-stock-links`
- new admin/ops-only repair endpoint(s) under `/api/v1/inventory/repair/...`
- new admin/ops-only repair page route under `/app/...`

### Checklist

#### Legacy detection and visibility
- [ ] Identify historical CARI lines and pending stock links that have no warehouse binding.
- [ ] Surface legacy repair-only markers in:
  - queue rows
  - document-detail stock-link reads where relevant
  - operator docs / runbooks
- [ ] Keep `/app/stok-yansitma-islemleri` focused on strict execution by linking or handing repair-required rows off to the separate admin/ops repair workspace instead of repairing inline.

#### Controlled repair rules
- [ ] Allow legacy receipt repair only with a valid same-context warehouse.
- [ ] Allow legacy issue repair only with a valid same-context warehouse and a passing strict availability check.
- [ ] Reject cross-context "repair" that tries to bind another ownership context's warehouse.
- [ ] Block creation of any new loose-mode row after cutover.
- [ ] Require explicit repair reason / audit note on admin/ops repair actions.

#### Repair backlog handling
- [ ] Add a separate admin/ops repair page and API contract for historical cleanup.
- [ ] Add filters / reporting for outstanding repair-only rows.
- [ ] Let the repair workspace filter safely using `queueState = REPAIR_REQUIRED` and `isRepairOnly = true` without mutating the base lifecycle model.
- [ ] Add an explicit repair-only permission code in `backend/src/seedCore.js` for the new repair workspace and routes.
- [ ] Guard the new admin/ops repair API routes with the repair-only permission instead of reusing bare `inventory.read` / `inventory.upsert`.
- [ ] Mount the new repair page in `frontend/src/App.jsx` with permission-aware routing and add a separate sidebar entry in `frontend/src/layouts/sidebarConfig.js`.
- [ ] Keep the normal `/app/stok-yansitma-islemleri` page visible under its current inventory permissions, but do not expose repair controls or repair-route navigation there unless the user also has the repair-only permission.
- [ ] Use separate repair-only RBAC / navigation so normal strict-mode operators do not need repair controls by default.

### Acceptance
- [ ] Legacy rows are isolated to controlled repair workflows only.
- [ ] New data cannot fall back into loose-mode creation.
- [ ] Cross-context legacy mistakes still require transfer or document correction, not foreign-context warehouse consumption.

## PR-INV10 - OpenAPI, regression gates, and rollout docs

### Goal
- Finish public contract, regression coverage, and operator documentation for the strict warehouse model.

### Files
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/src/seedCore.js`
- `backend/scripts/test-cari-line-model-rollout-regression.js`
- `backend/scripts/test-inventory-pr26-release-gate.js`
- `backend/scripts/test-release-gate.js`
- new strict warehouse-binding / queue / repair regression scripts
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- `docs/specs/cari-line-model-regression-matrix.md`
- `PR-STEPS/33-STRICT-BRANCH-WAREHOUSE-ENFORCEMENT-EARLY-WAREHOUSE-SELECTION-AND-FORCED-INTER-BRANCH-TRANSFERS-CHECKLIST.md`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`

### Routes / endpoints
- new CARI-owned warehouse lookup endpoint(s) under `/api/v1/cari/...`
- `GET /api/v1/inventory/cari-stock-links`
- `POST /api/v1/inventory/cari-stock-links/{stockLinkId}/materialize`
- `POST /api/v1/inventory/movements`
- `POST /api/v1/cari/documents/{documentId}/post`
- optional CARI-owned availability-preview endpoint(s)
- new admin/ops-only repair endpoint(s) under `/api/v1/inventory/repair/...`

### Checklist

#### OpenAPI and contract docs
- [ ] Update schemas for:
  - line-level warehouse binding
  - pending-link bound warehouse and ownership-context fields
  - base `linkStatus` plus derived `queueState` semantics
  - `blockedReasonCode`, `repairReasonCode`, `canMaterialize`, `isStrictMode`, `isRepairOnly`, `isLegacyRow`
  - dedicated strict materialize-by-stock-link request/response shape
  - admin/ops-only repair endpoint schemas plus legacy repair request semantics on `/api/v1/inventory/movements`
  - CARI-owned warehouse lookup and optional availability-preview routes
- [ ] Regenerate `backend/openapi.yaml`.
- [ ] Remove or rewrite route summaries that still describe the queue as the place where warehouse is first chosen.
- [ ] Document queue/dashboard filter behavior so the broader `queueState` contract, including `COMPLETED` / `VOID`, matches actual endpoint and screen scope.
- [ ] Update seeded permission catalog and UI navigation metadata so the separate repair workspace is permissioned independently from the normal queue page.

#### Regression and release gates
- [ ] Rewrite `backend/scripts/test-cari-line-model-rollout-regression.js` away from the old:
  - post document
  - create/select warehouse
  - materialize later
  flow for new strict-mode rows.
- [ ] Update `backend/scripts/test-inventory-pr26-release-gate.js` so it stops protecting the late-warehouse model.
- [ ] Add regression coverage for:
  - missing warehouse binding blocks new stock-affecting lines
  - no active warehouse blocks posting
  - insufficient stock blocks issue-side posting at post time
  - new pending links are warehouse-bound
  - strict-mode materialization uses the dedicated stock-link endpoint and does not depend on caller-selected warehouse
  - successor rows inherit warehouse or fall into repair-only handling
  - queue rows expose stable base lifecycle plus derived `queueState` / reason codes without enum explosion
  - queue/dashboard scope supports the locked `queueState` contract instead of staying pending-only while advertising `COMPLETED` / `VOID`
  - queue UI no longer auto-selects the first pending row
- [ ] Wire new scripts into `backend/package.json` and release-gate runner(s).

#### Runbooks and rollout notes
- [ ] Update `docs/runbooks/cari-v1-operations.md` so the normal path becomes:
  - choose warehouse in CARI
  - post
  - materialize against the already-bound warehouse
- [ ] Update `docs/runbooks/cari-v1-support-finance-ui-guide.md` so support guidance no longer instructs operators to "create/select warehouse" as the normal first queue action for new strict-mode rows.
- [ ] Update CARI reverse / inventory-blocked helper text and deep-link guidance so it no longer treats `/app/stok-yansitma-islemleri` as the generic fix path for every blocked stock case once strict queue vs repair surfaces are separated.
- [ ] Keep legacy repair notes separate from strict-mode day-to-day operator guidance.

### Acceptance
- [ ] OpenAPI, generated docs, runbooks, and actual service behavior match.
- [ ] Release gates protect the strict model from rollback toward late warehouse choice.
- [ ] Operators no longer see the old loose warehouse-selection-first-later model documented as the normal path.

## Recommended exact implementation order
- [ ] 1. Extract shared ownership-context / warehouse policy helpers in `backend/src/services/cari.document.service.js` and `backend/src/services/inventory.service.js`.
- [ ] 2. Add line-level warehouse binding schema and CARI create/update/detail contract.
- [ ] 3. Add post-time readiness and issue availability validation in `postCariDocumentById(...)`.
- [ ] 4. Add stock-link warehouse propagation schema and pending-link read-model changes.
- [ ] 5. Add the dedicated strict stock-link materialize route and finalize the split strict-vs-legacy public request/response shapes.
- [ ] 5a. Replace the current normal queue `createInventoryMovement(...)` caller path with the dedicated strict materialize action so the old `warehouseId + sourceStockLinkId` form is no longer the default execution path.
- [ ] 6. Harden `ensureIssueReopenedStockLinkTx(...)` so successor rows inherit warehouse or fall into repair-only handling.
- [ ] 7. Add the CARI-owned warehouse lookup endpoint(s), then finish CARI warehouse lookup UX and any optional availability preview wiring.
- [ ] 8. Fix pending-link query / mapper alignment and remove queue auto-selection behaviors.
- [ ] 9. Keep cross-context transfer reuse and operator guidance aligned with the stricter CARI / queue flow.
- [ ] 10. Add the separate admin/ops repair routes/actions and finalize the derived `queueState` / reason-code contract across queue, dashboard, and OpenAPI.
- [ ] 11. Finish OpenAPI, package scripts, release gates, and rollout docs together.

## Done definition
- [ ] Ownership context is consistently modeled as `CENTRAL` vs `OPERATING_UNIT` across service, route, frontend, and docs layers.
- [ ] Every new stock-affecting CARI line has warehouse binding before posting.
- [ ] No inventory-enabled ownership context can post stock-affecting transactions without an active warehouse.
- [ ] No new strict-mode issue-side posting can succeed without sufficient stock in the bound warehouse.
- [ ] No ownership context can consume stock directly from another ownership context's warehouse.
- [ ] Inter-context transfer remains the only valid cross-context stock path.
- [ ] New pending stock links are warehouse-bound at creation.
- [ ] Strict-mode materialization no longer depends on caller-selected `warehouseId`.
- [ ] Reversal / successor flows do not leak new loose-mode pending links.
- [ ] Pending queue/card always display owning ownership context and bound warehouse, while exposing stable base `linkStatus` plus derived `queueState` / reason codes.
- [ ] Legacy unbound rows are isolated to controlled repair workflows only.
