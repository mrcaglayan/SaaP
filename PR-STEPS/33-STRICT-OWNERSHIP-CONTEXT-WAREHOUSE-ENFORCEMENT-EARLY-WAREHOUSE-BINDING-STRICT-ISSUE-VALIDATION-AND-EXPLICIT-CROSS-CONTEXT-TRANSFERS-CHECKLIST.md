# 33 - STRICT OWNERSHIP-CONTEXT WAREHOUSE ENFORCEMENT, EARLY WAREHOUSE BINDING, STRICT ISSUE VALIDATION, AND EXPLICIT CROSS-CONTEXT TRANSFERS

## Execution tracking
- This file is the execution tracker for replacing the current loose inventory flow with a strict ownership-context warehouse model.
- It aligns to the repo's current CARI and inventory reality:
  - warehouse ownership is already modeled as `CENTRAL` vs `OPERATING_UNIT`
  - CARI post currently creates pending stock links first
  - warehouse is currently chosen later during inventory materialization
- This tracker removes late warehouse choice from the normal path for new strict-mode stock-affecting flows.
- Legacy rows created before this change remain readable, but they are not operationally supported in this disposable rollout environment.
- Current implementation assumption for this rollout:
  - the working database is empty today
  - the database will be reset again after implementation is complete
  - no historical backfill is required for this rollout
- legacy/reset notes remain in this tracker only as repo guardrails for future non-empty environments
- If product or API direction changes later, update this tracker before implementation continues.

## Scope
- ownership-context terminology lock across backend, frontend, OpenAPI, tests, and operator docs
- required active warehouse readiness per inventory-enabled ownership context
- required warehouse binding on new stock-affecting CARI lines during create/update and before posting
- strict issue-side stock availability validation against the bound warehouse at posting time
- pending stock-link warehouse propagation at creation time
- successor / reversal pending-link inheritance hardening
- stock-link queue, queue summary, and card hardening
- explicit reuse of existing cross-context transfer workflow
- legacy unbound row reset / purge policy
- OpenAPI, runbooks, regression gates, and rollout notes

## Locked product decisions for this tracker
- [x] Ownership context is modeled as `CENTRAL` or `OPERATING_UNIT`; "branch" is UI/business wording for an operating unit, not a separate backend ownership type.
- [x] `CENTRAL` means no `operating_unit_id`; `OPERATING_UNIT` means a specific `operating_unit_id`.
- [x] Each inventory-enabled ownership context must have at least one active warehouse before any stock-affecting transaction can be posted for that context.
- [x] No warehouse is auto-created by the system.
- [x] New stock-affecting CARI draft lines require warehouse binding at create/update time; post-time validation rechecks binding, warehouse readiness, and stock sufficiency before side effects are written.
- [x] V1 strict mode uses required warehouse binding at line level, not "choose later from the pending queue."
- [x] A stock-affecting sales posting cannot succeed unless the bound warehouse has sufficient available stock for every stock line.
- [x] Cross-context fulfillment must use explicit transfer; one ownership context cannot consume stock directly from another ownership context's warehouse.
- [x] New pending stock links are warehouse-bound at creation time.
- [x] Late warehouse choice is not the normal path for new strict-mode links.
- [x] Successor pending links created during reversal / reopen flows must inherit warehouse binding where valid, or be treated as invalid rollout data that must be cleaned up/reset rather than normalized into operator work.
- [x] Legacy unbound rows are not supported in this rollout and must not reopen loose-mode behavior.
- [x] The default actionable stock-link card/view and related queue views must always show owning ownership context and bound warehouse for each strict-mode row shown to operators.
- [x] Public contract names distinguish warehouse intent from materialized warehouse reality:
  - CARI line create/update requests accept only `warehouseId`
  - CARI line read models / response fields may expose `warehouseId`, `warehouseCode`, and `warehouseName`
  - stock-link persistence stores the propagated bound warehouse id derived from the selected line `warehouseId`
  - stock-link queue/detail read models expose `boundWarehouseId`, `boundWarehouseCode`, and `boundWarehouseName`
  - movement-derived warehouse fields keep their existing movement-specific names such as `inventoryWarehouseId` or inventory movement `warehouseId`
- [x] Backend post-time validation remains authoritative even if frontend preview / helper reads are added later.
- [x] Warehouse lookup for stock-affecting CARI lines and any optional pre-post availability preview use narrow CARI-owned read endpoints backed by shared inventory logic; stock-affecting CARI posting must not require broad `inventory.read` permission only to choose warehouse or preview stock.
- [x] CARI-owned warehouse lookup and optional availability-preview routes are guarded by CARI document read scope and must not require broad inventory-page permissions; save/post actions remain gated by the existing CARI mutation permissions.
- [x] Strict-mode materialization uses a dedicated materialize-by-stock-link endpoint under the `cari-stock-links` route family; `POST /api/v1/inventory/movements` remains a legacy-only non-strict surface in this wave. New strict-mode execution must not accept caller-selected `warehouseId`; warehouse is derived from the bound stock link.
- [x] No separate repair routes/actions/workspace are built in this rollout; unexpected legacy unbound rows are handled by reset/cleanup outside the normal strict queue.
- [x] Do not add repair-only RBAC or navigation wiring in this rollout.
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
- [x] `TRANSFER_REQUIRED` is expressed as `queueState`, not duplicated inside `blockedReasonCode`; invalid successor inheritance and unexpected legacy/unbound cases may still surface through `repairReasonCode`, not `blockedReasonCode`.
- [x] `TRANSFER_REQUIRED` is a derived advisory `queueState`, not a persisted transfer linkage; it is used only when the bound warehouse cannot satisfy the required quantity and a cross-context availability probe indicates stock exists in another ownership context.
- [x] Default queue/dashboard scope remains execution-focused on actionable work; `COMPLETED` and `VOID` are exposed through explicit lifecycle/history filters or views rather than as the default queue scope.

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
- [x] Split the public materialization contract at the route level: strict-mode queue execution belongs on a dedicated `cari-stock-links/{stockLinkId}/materialize` route, while the current `/api/v1/inventory/movements` shape remains a legacy-only non-strict surface in this wave.
- [x] Do not reintroduce warehouse-bind repair controls into the normal queue form on `frontend/src/pages/inventory/InventoryMovementsPage.jsx`; unexpected legacy/unbound data must be cleaned up/reset rather than handled through the normal strict UI in this rollout.
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
  - `docs/runbooks/inventory-item-card-rollout.md`
  - `docs/runbooks/cari-v1-support-finance-ui-guide.md`
  - `docs/specs/cari-line-model-regression-matrix.md`
- [x] CARI and inventory permissions are split today:
  - CARI routes use `cari.doc.*`
  - inventory routes/pages used `inventory.read` / `inventory.upsert` at that tracker stage; later superseded by PR-64 granular inventory permissions
- [x] Do not add repair-only permission, page, or navigation work in this rollout; keep the normal queue under its existing inventory permissions only.
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
- [x] `PR-INV01` - Ownership-context terminology and shared policy foundation
- [x] `PR-INV02` - Warehouse binding schema and CARI line contract foundation
- [x] `PR-INV03` - Post-time readiness and strict issue availability enforcement
- [x] `PR-INV04` - Pending-link propagation and strict materialization hardening
- [x] `PR-INV05` - Successor inheritance and reversal leak closure
- [x] `PR-INV06` - Frontend CARI warehouse UX and submit blocking
- [x] `PR-INV07` - Stock-link queue, card, and work-queue API hardening
- [x] `PR-INV08` - Explicit reuse of existing cross-context transfer workflow
- [x] `PR-INV09` - Legacy unbound row reset / purge policy
- [x] `PR-INV10` - OpenAPI, regression gates, and rollout docs

## PR-INV01 - Ownership-context terminology and shared policy foundation

### Goal
- Lock repo-aligned terminology and extract the shared validation helpers before schema and UI changes start.

### Files
- `backend/src/services/cari.document.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/routes/cari.document.validators.js`
- `backend/src/routes/inventory.validators.js`
- new shared ownership / warehouse policy helper module under `backend/src/services/`
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
- [x] Define one canonical backend term set:
  - `CENTRAL`
  - `OPERATING_UNIT`
  - "branch" as UI/business alias only
- [x] Define "inventory-enabled ownership context" as any context attempting to post stock-affecting lines.
- [x] Define "stock-affecting line" centrally for:
  - purchase receipt-side lines
  - sales issue-side lines
  - transfer ship / receive flows where relevant
- [x] Define canonical validation language used across backend and UI:
  - no active warehouse for ownership context
  - warehouse does not belong to ownership context
  - insufficient available stock in bound warehouse
  - stock exists in another ownership context and transfer is required
- [x] Define `TRANSFER_REQUIRED` derivation explicitly as an advisory queue-state result backed by a cross-context availability probe, not as a persisted transfer-link relation on stock links.

#### Shared helper foundation
- [x] Extract or add shared ownership-context helper(s) used by CARI post flow, inventory materialization flow, and inventory transfer flow.
- [x] Put shared ownership / warehouse policy logic in one helper module instead of re-implementing parallel rules inside multiple services.
- [x] Extract or add shared warehouse ownership / readiness helper(s) instead of duplicating context checks ad hoc.
- [x] Normalize error text and error-code use so repo layers stop mixing "branch" and "ownership context" for backend rules.
- [x] Keep UI labels free to say "branch" where needed, but keep backend/OpenAPI/test contracts on the canonical ownership-context terminology.

### Acceptance
- [x] There is one canonical ownership-context vocabulary across repo layers.
- [x] Shared validation helpers exist before later slices build on them.
- [x] No new backend logic introduced by this tracker uses vague "branch ownership" terminology.

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
- [x] Add nullable additive persisted line-level warehouse binding column(s) on `cari_document_lines`; create/update requests persist only the selected `warehouseId`, while read models may expose derived `warehouseId`, `warehouseCode`, and `warehouseName`; legacy rows remain readable.
- [x] Register the migration in `backend/src/migrations/index.js`.
- [x] Preserve read compatibility for historical rows created before this tracker.

#### Validation and write-model contract
- [x] Extend `parseDocumentCreateInput(...)` and `parseDocumentUpdateInput(...)` so new stock-affecting lines must carry line-level warehouse binding through `warehouseId` only; `warehouseCode` and `warehouseName` are derived response fields and must not be accepted as mutation inputs.
- [x] Keep non-stock lines free from warehouse requirements.
- [x] Update `mapDocumentLineRow(...)`, `loadDocumentLinesForDocument(...)`, `replaceDocumentLinesTx(...)`, and `syncStoredDocumentLinesForPostingTx(...)` so line-level warehouse binding survives storage, normalization, and detail reads.
- [x] Update `createDocumentLineDraft(...)`, `mapDocumentRowToForm(...)`, `buildDocumentMutationPayload(...)`, `validateDocumentMutationForm(...)`, and related line normalization helpers so draft rows carry warehouse binding during create/edit.
- [x] Update payload builders in `frontend/src/pages/cari/CariDocumentsPage.jsx` so create/update requests send the warehouse binding cleanly.

#### Contract / read model
- [x] Extend `CariDocumentLineInput` and related response shapes in `backend/scripts/generate-openapi.js` so create/update input accepts only line-level `warehouseId`, while response shapes may expose `warehouseId`, `warehouseCode`, and `warehouseName`.
- [x] Ensure `GET /api/v1/cari/documents/{documentId}` returns line-level warehouse binding on new strict-mode rows, distinct from any movement-derived warehouse fields.
- [x] Make legacy rows readable without pretending they satisfy the strict contract.

### Acceptance
- [x] New stock-affecting lines cannot be created or updated without warehouse binding in the contract.
- [x] Document detail reads surface the selected warehouse on strict-mode lines.
- [x] Backend, frontend, and OpenAPI all agree on the line-level warehouse field(s).

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
- [x] Extend `postCariDocumentById(...)` to resolve the document ownership context from `cari_documents.operating_unit_id`.
- [x] Run strict warehouse/availability validation against the final normalized stored line set after `syncStoredDocumentLinesForPostingTx(...)` settles line defaults and before any posting side effects are written.
- [x] Reject post when the ownership context has no active warehouse.
- [x] Reject post when a bound warehouse is missing on any new strict-mode stock-affecting line.
- [x] Reject post when the bound warehouse is inactive.
- [x] Reject post when the bound warehouse belongs to a different ownership context than the document/line.
- [x] Perform the strict warehouse-readiness checks before journal creation, open-item insertion, or any other post side effects so failed validation leaves no partial posting artifacts behind.

#### Strict issue-side validation
- [x] Add shared issue-side availability validation using:
  - item
  - ownership context
  - bound warehouse
  - requested quantity
- [x] Reuse current inventory valuation/open-layer logic or extract a shared helper from it so post-time and materialization-time logic do not drift.
- [x] Return precise line-level shortage feedback instead of letting the operator discover the failure later in the pending queue.
- [x] Keep materialization-time recheck as the second guard against later stock changes and races.

### Acceptance
- [x] New stock-affecting posting cannot succeed without active warehouse readiness.
- [x] New issue-side posting fails immediately on insufficient stock in the bound warehouse.
- [x] "Post now, fail later in pending queue" is removed for new strict-mode issue flows.

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
- [x] Add nullable additive persisted stock-link warehouse binding column(s) on `cari_document_line_stock_links`; persistence stores the propagated bound warehouse id derived from the selected line `warehouseId`, while queue/detail read models expose `boundWarehouseId`, `boundWarehouseCode`, and `boundWarehouseName`.
- [x] Update `replaceDocumentLineStockLinksTx(...)` so newly generated pending links copy the selected line-level warehouse binding exactly.
- [x] Update document-detail stock-link mapping in `backend/src/services/cari.document.service.js` so pending strict-mode stock links expose the bound warehouse even before materialization.

#### Pending-link list/read hardening
- [x] Update `listPendingInventoryStockLinks(...)` so rows include:
  - ownership context / operating unit display
  - `boundWarehouseId` / `boundWarehouseCode` / `boundWarehouseName`
  - document id / line id
  - requested quantity
  - materialized / remaining quantity or equivalent execution-state values
- [x] Fix the current mapper/query mismatch so document operating-unit fields are actually selected before the mapper consumes them.

#### Strict materialization behavior
- [x] Add a dedicated strict materialize route under the `cari-stock-links` route family for normal strict-mode queue execution.
- [x] Update `createInventoryMovementFromStockLink(...)` or the shared posting logic it delegates to so strict-mode rows derive warehouse from the bound stock link.
- [x] Keep authoritative rechecks for:
  - warehouse still active
  - warehouse still in the same ownership context
  - issue-side stock still sufficient at execution time
- [x] Keep `POST /api/v1/inventory/movements` as the legacy-only non-strict stock-link surface in this wave; new strict-mode queue actions must not call it.
- [x] Replace the current queue-side `createInventoryMovement(...)` normal-flow usage with a strict stock-link materialize action that does not ask the operator for `warehouseId` on strict rows.
- [x] Preserve legacy unbound rows as reset/cleanup-only cases rather than normal strict-mode work.
- [x] Finalize the strict materialize request/response schema separately from the legacy-only request semantics on `/api/v1/inventory/movements`.
- [x] Land route contract, validator contract, frontend API client, queue form behavior, and release-gate rewrites in the same wave as the dedicated strict materialize endpoint so the old normal-flow path is not left partially active.

### Acceptance
- [x] All newly generated strict-mode pending links are warehouse-bound.
- [x] New strict-mode materialization uses the dedicated stock-link materialize endpoint and no longer depends on caller-selected warehouse semantics.
- [x] Pending-link list/read responses expose enough context for safe queue execution.

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
- [x] Extend `ensureIssueReopenedStockLinkTx(...)` so valid successor rows inherit the original warehouse binding.
- [x] Revalidate inherited warehouse binding before the successor row is treated as normal strict-mode work:
  - warehouse still exists
  - warehouse still active
  - warehouse still belongs to the same ownership context
- [x] If inheritance is invalid, keep the successor row out of normal strict-mode work instead of creating a loose normal-mode row.

#### Reverse flow visibility
- [x] Keep original/successor lineage fields intact and visible in queue/detail reads.
- [x] Update queue/detail UI so reopened successor rows clearly show inherited-vs-repair-only status through `queueState`, `repairReasonCode`, and existing lineage fields.
- [x] Keep CARI reverse docs aligned with the inventory unwind order.

### Acceptance
- [x] Reversal / reopen flows no longer create fresh loose-mode pending links for new strict-mode data.
- [x] Valid successor rows inherit warehouse binding.
- [x] Invalid successor cases remain non-actionable strict-path defects that require cleanup/reset handling in this rollout.

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
- [ ] Load warehouse choices from a narrow CARI-owned lookup endpoint backed by shared inventory logic and guarded by `cari.doc.read` scope rather than broad inventory-page permissions.
- [ ] Filter selectable warehouses by legal entity plus resolved ownership context.
- [ ] Preserve selected warehouse during edit/read round-trips.
- [ ] Show the selected warehouse in line summary / detail areas so operators can verify it before posting.

#### Submit / post blocking
- [ ] Block save/post when a stock-affecting line has no warehouse binding.
- [ ] Block save/post when a selected warehouse belongs to another ownership context.
- [ ] Keep non-stock lines free from warehouse requirements.
- [ ] If availability preview ships in this wave, expose it through a narrow CARI-owned endpoint backed by shared inventory logic, guard it with `cari.doc.read` scope, and keep backend post-time validation authoritative.
- [ ] Update CARI blocked/reverse guidance so document-level inventory links point operators to the strict queue or explicit reset/cleanup guidance intentionally, not to the old queue-first mental model by default.

### Acceptance
- [ ] Users must choose warehouse before saving or posting a stock-affecting CARI line.
- [ ] Users cannot choose a cross-context warehouse.
- [ ] The normal strict-mode path no longer depends on the inventory queue to make the first warehouse decision.

## PR-INV07 - Stock-link queue, card, and work-queue API hardening

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

#### Stock-link queue data
- [ ] Fix `listPendingInventoryStockLinks(...)` so output matches `mapPendingStockLinkRow(...)`.
- [ ] Return ownership context / operating unit display for every pending row.
- [ ] Return bound warehouse for every strict-mode row.
- [ ] Make `GET /api/v1/inventory/cari-stock-links` lifecycle-capable while keeping the default screen scope focused on actionable work.
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
- [ ] Remove the current normal-flow queue form behavior that pairs manual warehouse selection with `sourceStockLinkId`; do not provide a replacement legacy repair control in the normal queue.
- [ ] Show unexpected legacy rows as non-actionable cleanup/reset-required data in the normal queue instead of exposing inline repair controls here.
- [ ] Make `queueState` the primary operator-facing badge and show reason-code detail only when applicable instead of overloading raw `linkStatus`.
- [ ] Keep the default queue tab/scope execution-focused on actionable work; expose `COMPLETED` and `VOID` only through explicit lifecycle/history filters or views.
- [ ] Add queue tabs / filters / views that make the broader `queueState` contract usable in practice, including visibility for `COMPLETED` and `VOID` rows where those states are meant to be operator-visible.
- [ ] Update the default actionable stock-link card / primary queue view to always show:
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
- [ ] Keep the default dashboard execution-focused on actionable work while exposing `COMPLETED` / `VOID` through separate counters, filters, or history views when needed.
- [ ] Do not let dashboard or queue summaries hide ownership context once the detailed list becomes stricter.

### Acceptance
- [ ] Stock-link queue/card always show ownership context and warehouse.
- [ ] Stock-link queue/card use stable base `linkStatus` plus derived `queueState` / reason codes instead of a giant enum.
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
- [x] Keep the current `createInventoryTransfer(...)` rule that source and target warehouses must belong to different ownership contexts.
- [x] Continue to reject direct issue posting when warehouse context and document context do not match.
- [x] Add a read-only cross-context availability probe so `TRANSFER_REQUIRED` guidance can be derived deterministically instead of inferred loosely from queue failure.
- [x] Add clearer transfer-required guidance when stock exists only in another ownership context.
- [x] Reuse the existing transfer lifecycle instead of widening this tracker into same-context transfer redesign.
- [x] Preserve transfer source/destination ownership-context evidence and auditability.

### Acceptance
- [x] One ownership context cannot directly consume another ownership context's warehouse stock.
- [x] Cross-context transfer remains the only valid fulfillment path.
- [x] This tracker does not accidentally redesign same-context generic warehouse movement behavior.

## PR-INV09 - Legacy unbound row reset / purge policy

### Goal
- Keep the strict warehouse-binding rollout focused on new valid data only.
- For the current implementation environment, the database is disposable and will be reset after implementation, so historical loose-mode rows are not repaired in this wave.
- If legacy unbound CARI lines or pending stock links are encountered during development or testing, they must be removed through reset/cleanup rather than supported through a repair workflow.

### Files
- `backend/src/services/inventory.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/scripts/test-cari-line-model-rollout-regression.js`
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`

### Routes / endpoints
- `GET /api/v1/inventory/cari-stock-links`

### Checklist

#### Legacy data policy
- [x] Define current-wave policy clearly: legacy unbound rows are not repaired or operationally supported in this disposable environment.
- [x] If legacy unbound CARI lines or stock links are discovered during implementation/testing, remove them through database reset or explicit cleanup before continuing strict-mode validation.
- [x] Do not build a separate repair page, repair API family, repair-only permission model, or repair navigation in this wave.

#### Strict-path safety
- [x] Ensure new strict-mode execution paths do not rely on or normalize unbound legacy rows as valid work.
- [x] Ensure no new loose-mode row can be created after cutover.
- [x] Keep invalid successor inheritance or unexpected unbound rows treated as implementation defects to be cleaned up/reset in this rollout, not as normal operator work.

#### Documentation and regression notes
- [x] Update rollout/runbook notes to state that legacy unbound-row repair is out of scope for this empty/reset implementation environment.
- [x] Keep regression coverage focused on preventing creation of new loose-mode rows, not on supporting historical repair workflows.

### Acceptance
- [x] The rollout does not include legacy repair UI/API/RBAC.
- [x] Any discovered unbound legacy rows in the current environment are removed through reset/cleanup, not processed through the strict path.
- [x] New code paths cannot create fresh loose-mode rows after cutover.

## PR-INV10 - OpenAPI, regression gates, and rollout docs

### Goal
- Finish public contract, regression coverage, and operator documentation for the strict warehouse model.

### Files
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/scripts/test-cari-line-model-rollout-regression.js`
- `backend/scripts/test-inventory-pr26-release-gate.js`
- `backend/scripts/test-release-gate.js`
- new strict warehouse-binding / queue regression scripts
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/inventory-item-card-rollout.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- `docs/specs/cari-line-model-regression-matrix.md`
- `PR-STEPS/33-STRICT-OWNERSHIP-CONTEXT-WAREHOUSE-ENFORCEMENT-EARLY-WAREHOUSE-BINDING-STRICT-ISSUE-VALIDATION-AND-EXPLICIT-CROSS-CONTEXT-TRANSFERS-CHECKLIST.md`

### Routes / endpoints
- new CARI-owned warehouse lookup endpoint(s) under `/api/v1/cari/...`
- `GET /api/v1/inventory/cari-stock-links`
- `POST /api/v1/inventory/cari-stock-links/{stockLinkId}/materialize`
- `POST /api/v1/inventory/movements`
- `POST /api/v1/cari/documents/{documentId}/post`
- optional CARI-owned availability-preview endpoint(s)

### Checklist

#### OpenAPI and contract docs
- [x] Update schemas for:
  - line-level warehouse binding so create/update input accepts only `warehouseId`, while response/read models expose `warehouseId`, `warehouseCode`, and `warehouseName`
  - pending-link bound warehouse and ownership-context fields so persistence is derived from propagated line `warehouseId`, while queue/detail reads expose `boundWarehouseId`, `boundWarehouseCode`, and `boundWarehouseName`
  - base `linkStatus` plus derived `queueState` semantics
  - `blockedReasonCode`, `repairReasonCode`, `canMaterialize`, `isStrictMode`, `isRepairOnly`, `isLegacyRow`
  - dedicated strict materialize-by-stock-link request/response shape
  - legacy-only request semantics on `/api/v1/inventory/movements` where that surface remains documented
  - CARI-owned warehouse lookup and optional availability-preview routes
- [x] Regenerate `backend/openapi.yaml`.
- [x] Remove or rewrite route summaries that still describe the queue as the place where warehouse is first chosen.
- [x] Document queue/dashboard filter behavior so the broader `queueState` contract, including `COMPLETED` / `VOID`, matches actual endpoint and screen scope.

#### Regression and release gates
- [x] Rewrite `backend/scripts/test-cari-line-model-rollout-regression.js` away from the old:
  - post document
  - create/select warehouse
  - materialize later
  flow for new strict-mode rows.
- [x] Update `backend/scripts/test-inventory-pr26-release-gate.js` in the same route-split wave so it stops protecting the late-warehouse model or `POST /api/v1/inventory/movements` as the normal strict-mode path.
- [x] Add regression coverage for:
  - missing warehouse binding blocks new stock-affecting lines
  - no active warehouse blocks posting
  - insufficient stock blocks issue-side posting at post time
  - new pending links are warehouse-bound
  - strict-mode materialization uses the dedicated stock-link endpoint and does not depend on caller-selected warehouse
  - successor rows inherit warehouse or are surfaced as invalid/unbound cleanup cases instead of reopening loose-mode work
  - queue rows expose stable base lifecycle plus derived `queueState` / reason codes without enum explosion
  - queue/dashboard scope supports the locked `queueState` contract instead of staying pending-only while advertising `COMPLETED` / `VOID`
  - queue UI no longer auto-selects the first pending row
- [x] Wire new scripts into `backend/package.json` and release-gate runner(s).

#### Runbooks and rollout notes
- [x] Update `docs/runbooks/cari-v1-operations.md` so the normal path becomes:
  - choose warehouse in CARI
  - post
  - materialize against the already-bound warehouse
- [x] Update `docs/runbooks/cari-v1-support-finance-ui-guide.md` so support guidance no longer instructs operators to "create/select warehouse" as the normal first queue action for new strict-mode rows.
- [x] Update `docs/runbooks/inventory-item-card-rollout.md` so inventory/item-card operational guidance no longer treats late warehouse selection in `/app/stok-yansitma-islemleri` as the normal first decision point for new strict-mode rows.
- [x] Update CARI reverse / inventory-blocked helper text and deep-link guidance so it no longer treats `/app/stok-yansitma-islemleri` as the generic fix path for every blocked stock case once strict execution vs reset/cleanup guidance are separated.
- [x] Keep legacy reset/cleanup notes separate from strict-mode day-to-day operator guidance.

### Acceptance
- [x] OpenAPI, generated docs, runbooks, and actual service behavior match.
- [x] Release gates protect the strict model from rollback toward late warehouse choice.
- [x] Operators no longer see the old loose warehouse-selection-first-later model documented as the normal path.

## Recommended exact implementation order
- [x] 1. Extract shared ownership-context / warehouse policy helpers into one shared helper module and wire them through `backend/src/services/cari.document.service.js`, `backend/src/services/inventory.service.js`, and `backend/src/services/inventory.transfer.service.js`.
- [x] 2. Add line-level warehouse binding schema and CARI create/update/detail contract so mutations accept only line-level `warehouseId`, while detail reads expose derived `warehouseId` / `warehouseCode` / `warehouseName`.
- [x] 3. Add post-time readiness and issue availability validation in `postCariDocumentById(...)`.
- [x] 4. Add stock-link warehouse propagation schema from line `warehouseId` and pending-link read-model changes exposing `boundWarehouseId` / `boundWarehouseCode` / `boundWarehouseName`.
- [x] 5. Add the dedicated strict stock-link materialize route and finalize the split strict-vs-legacy public request/response shapes.
- [x] 5a. Replace the current normal queue `createInventoryMovement(...)` caller path with the dedicated strict materialize action so the old `warehouseId + sourceStockLinkId` form is no longer the default execution path.
- [x] 6. Harden `ensureIssueReopenedStockLinkTx(...)` so successor rows inherit warehouse or are surfaced as invalid/unbound cleanup cases instead of reopening loose-mode work.
- [x] 7. Add the CARI-owned warehouse lookup endpoint(s), then finish CARI warehouse lookup UX and any optional availability preview wiring.
- [x] 8. Fix pending-link query / mapper alignment and remove queue auto-selection behaviors.
- [x] 9. Keep cross-context transfer reuse, advisory cross-context availability probing, and operator guidance aligned with the stricter CARI / queue flow.
- [x] 10. Confirm the legacy unbound-row reset/purge policy in docs and regressions, then finalize the derived `queueState` / reason-code contract across queue, dashboard, and OpenAPI.
- [x] 11. Finish OpenAPI, package scripts, release gates, and rollout docs together.

## Done definition
- [x] Ownership context is consistently modeled as `CENTRAL` vs `OPERATING_UNIT` across service, route, frontend, and docs layers.
- [x] Every new stock-affecting CARI line has warehouse binding during create/update and before posting.
- [x] No inventory-enabled ownership context can post stock-affecting transactions without an active warehouse.
- [x] No new strict-mode issue-side posting can succeed without sufficient stock in the bound warehouse.
- [x] No ownership context can consume stock directly from another ownership context's warehouse.
- [x] Inter-context transfer remains the only valid cross-context stock path.
- [x] New pending stock links are warehouse-bound at creation.
- [x] Strict-mode materialization no longer depends on caller-selected `warehouseId`.
- [x] Reversal / successor flows do not leak new loose-mode pending links.
- [x] Stock-link queue/card always display owning ownership context and bound warehouse, while exposing stable base `linkStatus` plus derived `queueState` / reason codes.
- [x] Legacy unbound rows are removed through reset/cleanup and cannot reopen loose-mode operator work in this rollout.
