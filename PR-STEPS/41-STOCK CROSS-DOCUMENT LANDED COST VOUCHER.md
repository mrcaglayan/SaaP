# 41 - STOCK CROSS-DOCUMENT LANDED COST VOUCHER

## Status
- Planned
- Follow-up track after Track 40 same-document line charges
- Inventory-only scope in V1; fixed-asset separate-bill capitalization continues to use Track 39 `IMPROVE_EXISTING`
- Design locks confirmed for V1:
  - transfer-aware landed-cost targeting
  - dedicated landed-cost voucher architecture
  - one voucher = one ownership context
  - no quantity-neutral `inventory_movements` / `inventory_cost_layers` carrier in V1
  - AP-line-backed reclass source model in V1
  - base-authoritative allocation and valuation math
  - future issue / transfer valuation consumes open landed-cost balances additively

## Purpose
Add a proper ERP-grade workflow for separate freight / customs / service / ancillary cost bills that arrive after stock has already been received on another document.

Track 40 handles same-document charge distribution before posting. This track handles the different workflow where:

- stock receipt is already posted
- ancillary costs arrive on a separate AP document or later date
- inventory valuation must be adjusted after receipt

## Why a Separate Track

1. This is not a small extension of Track 40's same-document charge math.
2. The target is already-posted stock receipt history, not sibling lines on the same draft document.
3. The feature affects inventory valuation layers, transfer lineage, on-hand vs consumed handling, and current-period journal adjustments.
4. Real ERP systems usually model this as a separate landed-cost voucher / landed-cost invoice workflow, not as a second flavor of same-document line charges.
5. This track is sequenced as 7 implementation steps across 4 phases so it can be implemented and reviewed in order like Track 39.

## Core Product Direction

Introduce a dedicated workflow:

- `Stock Landed Cost Voucher`

This is:

- not the Track 40 same-document charge line flow
- not a fixed-asset `IMPROVE_EXISTING` posting
- not a hidden mutation of historical stock receipt rows

This workflow must:

- reference one or more already-posted stock receipt targets
- reclassify cost from posted AP source lines
- distribute separate ancillary costs across those targets
- update inventory valuation in the current open period
- preserve a durable voucher / audit source for the landed-cost allocation
- keep stock-only scope in V1

## Implementation Locks

The following decisions are locked for this track:

1. `Transfer-aware targeting`
   - V1 must support receipts whose cost has moved through inventory transfer lineage.
   - The allocator must not assume that the original receipt layer's remaining quantity equals current on-hand quantity for the entity.
   - The voucher must follow eligible receipt economics through transfer-descendant receipt layers when determining on-hand vs consumed split.
2. `Dedicated landed-cost voucher`
   - This workflow is a finance valuation-adjustment document, not a fake physical inventory movement.
   - The primary source of truth must be dedicated voucher header, source, target, and layer-allocation tables plus journal linkage.
   - Existing `inventory_movements` and `inventory_cost_layers` are source/target inputs to the voucher logic, not a substitute for voucher persistence.
3. `One voucher = one ownership context`
   - All targets on one voucher must resolve to the same ownership context.
   - For `OPERATING_UNIT` context, all targets must resolve to the same `operatingUnitId`.
   - Multi-OU or mixed CENTRAL/OU allocations must be split into separate vouchers.
4. `No quantity-neutral inventory movement carrier in V1`
   - V1 does not introduce a cost-only `inventory_movements` / `inventory_cost_layers` carrier such as `VALUATION_ADJUSTMENT`.
   - Cost-only landed-cost adjustments must persist in dedicated landed-cost voucher tables and related allocation-detail tables instead.
5. `AP-line-backed source model in V1`
   - V1 landed-cost vouchers are backed by posted AP source lines, not freeform/manual offset-account vouchers.
   - The voucher must reclassify from persisted AP source-line economics into inventory capitalization and consumed adjustment.
   - Tax amounts are not a landed-cost source in V1; source application is based on posted AP line net amounts.
6. `Future FIFO participation is mandatory`
   - On-hand landed-cost capitalization must participate in later issue and transfer shipment valuation.
   - V1 cannot stop at reporting-only uplift; future COGS / shipment valuation must consume open landed-cost balances additively.
   - This requires persisted open-balance state and later landed-cost consumption lineage, not only one-time posting totals.
7. `Same legal entity boundary`
   - Source AP lines, voucher header, voucher targets, and resolved descendant receipt layers must all remain inside one `legal_entity_id`.
   - Ownership context may differ between source AP line and voucher target, but cross-legal-entity source usage is out of scope.

## Technical Decisions

The following repo-level implementation choices are also locked:

1. `Transfer lineage resolution strategy`
   - V1 will resolve transfer-aware target lineage at query time from existing inventory transfer, issue-consumption, and receipt-layer data.
   - No denormalized `originating_receipt_movement_id` or similar shortcut column is required in the first pass.
   - If preview/posting performance proves unacceptable later, a follow-up optimization track can add lineage shortcuts without changing accounting behavior.
2. `Journal source-link discriminator`
   - Voucher journals will use a dedicated source link type: `STOCK_LANDED_COST_VOUCHER`.
   - This discriminator will be treated as the canonical drillback source for landed-cost voucher journals.
3. `Inventory-side valuation persistence`
   - V1 keeps original physical `inventory_movements` and receipt `inventory_cost_layers` as physical-history inputs, not as the carrier for cost-only landed-cost adjustments.
   - Capitalization detail must persist through dedicated landed-cost target and layer-allocation tables.
   - Issue valuation, inventory read models, and drillback must read landed-cost allocation detail in addition to the original layer values.
4. `Future FIFO / transfer overlay model`
   - On-hand landed-cost capitalization remains open as additive landed-cost balances per resolved layer-allocation row.
   - Later issues and transfer shipments must consume those balances additively alongside the underlying FIFO cost layers.
   - Issue / transfer reversal must restore those landed-cost open balances deterministically through persisted landed-cost consumption lineage.
5. `Transfer receive carry-forward rule`
   - When a transfer shipment consumes open landed-cost balances, transfer receipt must recreate those balances as new open landed-cost balance rows tied to the destination receipt movement / destination receipt cost layer.
   - Transfer shipment is therefore not final landed-cost consumption; it is a carry-forward from one open inventory location to another descendant receipt layer.
   - The destination physical cost layer remains physical-history input; additive landed-cost carry-forward remains explicit in dedicated landed-cost persistence.
6. `Target/detail granularity`
   - A business-level voucher target row is not enough for transfer-aware audit, posting, and reversal.
   - V1 must persist per-resolved-layer allocation detail for each effective on-hand / consumed split used at posting time.
   - Reversal and drillback must read those persisted layer-allocation rows rather than trying to reconstruct everything from target totals only.
7. `Source-accounting model`
   - V1 uses an AP-line-backed reclass model.
   - Header-only source linkage is not sufficient; source application must be tracked at AP line level with duplicate-application control.
   - Voucher credit lines reclassify from persisted AP source-line posting-account economics.
   - Consumed-side debit uses the repo's current inventory issue account-resolution model for the item card (`defaultCogsAccountId` fallback `defaultPurchaseAccountId`), while on-hand debit uses the inventory asset account path.
   - Transfer transit / due-to / due-from posting is not reopened by this voucher; the voucher posts inside one ownership context from the descendant on-hand / consumed state it resolves at posting time.
   - Standalone manual offset-account vouchers are deferred.
8. `Source eligibility rule`
   - Eligible source rows must be posted AP lines with positive remaining unapplied net base amount.
   - V1 source eligibility is restricted to `lineKind = STANDARD`, `chargeAllocationMethod = NONE`, `subledgerType = NONE`, `stockImpactMode = NONE`, and no active source-document reversal.
   - Track 40 charge lines, stock-affecting lines, fixed-asset lines, comment/rounding/adjustment rows, and reversed source lines are not eligible landed-cost sources.
9. `Source / voucher ownership policy`
   - Source AP line ownership context is allowed to differ from the voucher target ownership context.
   - Voucher posting ownership is driven by the resolved target context, not by the AP source document header context.
   - One AP document may therefore feed multiple landed-cost vouchers, but each posted voucher still remains single-context.
10. `FX rule`
   - Allocation preview, posting, and reversal are authoritative in base currency.
   - Source AP lines may still carry transaction-currency amounts for audit, but target-layer capitalization math is driven by base amounts.
   - V1 does not attempt to restate descendant receipt-layer transaction-currency carrying values when voucher/source currency differs from layer currency.
11. `Reversal rule`
   - V1 reversal is allowed only while every capitalized landed-cost layer-allocation slice is still free of later downstream dependency.
   - If any capitalized slice has later issue, transfer, or other downstream inventory dependency after voucher posting, reversal must block with a clear error.
   - Reversal support therefore depends on persisted layer-allocation lineage, not only business-level target totals.
   - Consumed-side reversal must also remain tied to persisted voucher/source/target/detail lineage so journal unwind is deterministic.
12. `Source-document reversal blocker`
   - Reversing a posted AP document that has active landed-cost voucher source applications must block until those vouchers are reversed first.
   - The blocker should identify the relevant voucher ids and source lines in the same style as existing inventory / fixed-asset reverse blockers in CARI.
13. `Concurrency / locking rule`
   - Voucher posting must lock AP source-line application rows and recompute remaining unapplied amount in-transaction before insert/update.
   - Later issue / transfer consumption must lock open landed-cost balance rows in the same transaction and recompute remaining additive availability before consuming them.
   - This follows the repo's existing `FOR UPDATE` discipline used in FIFO layer consumption and must be applied to landed-cost balance consumption as well.
14. `Journal / drillback wiring`
   - `STOCK_LANDED_COST_VOUCHER` must be added to backend and frontend source-ref registries, journal drillback resolution, and reverse-block destination handling.
   - Voucher drillback must land on the dedicated landed-cost voucher page route rather than a generic inventory page.
15. `Route surface`
   - V1 will expose a dedicated landed-cost voucher API surface under inventory routes.
   - Expected endpoints:
     - `POST /api/v1/inventory/landed-cost-vouchers/preview`
     - `POST /api/v1/inventory/landed-cost-vouchers`
     - `GET /api/v1/inventory/landed-cost-vouchers`
     - `GET /api/v1/inventory/landed-cost-vouchers/:id`
     - `POST /api/v1/inventory/landed-cost-vouchers/:id/reverse`
16. `Repo module shape`
   - Backend work should land in dedicated landed-cost modules rather than inflating the already-large generic inventory service further.
   - Preferred shape:
     - `backend/src/services/inventory.landed-cost.service.js`
     - `backend/src/routes/inventory.landed-cost.routes.js`
     - `frontend/src/pages/inventory/InventoryLandedCostVouchersPage.jsx`
     - `frontend/src/pages/inventory/InventoryLandedCostVoucherNewPage.jsx`
     - `frontend/src/pages/inventory/InventoryLandedCostVoucherDetailPage.jsx`
17. `Permission model`
   - This draft originally proposed reusing the then-current inventory module permission model: `inventory.read` and `inventory.upsert`.
   - Later runtime implementation superseded that split via PR-64:
     - list / detail / preview read still use `inventory.read`
     - landed-cost create / post / reverse actions now use `inventory.landed_cost.upsert`
   - Missing action permission should be surfaced inline rather than hidden implicitly.
   - A finance-only permission split is a possible follow-up, not a V1 requirement.
18. `Frontend route and page model`
   - V1 frontend shape is three pages only:
     - list page
     - new voucher wizard page
     - voucher detail page
   - V1 routes should be:
     - `/app/stok-maliyet-voucherleri`
     - `/app/stok-maliyet-voucherleri/yeni`
     - `/app/stok-maliyet-voucherleri/:voucherId`
   - Sidebar placement should be under `Inventory` with the repo-consistent Turkish canonical label `Stok Maliyet Voucherleri`.
   - English wording such as `Landed Cost Vouchers` or `Stock Landed Cost Vouchers` should be treated as localized UI copy, not as the canonical route style.
19. `Frontend interaction model`
   - New-voucher flow must be a full-page guided workflow, not a modal.
   - Reverse flow should use a side drawer or dedicated confirmation surface, not a tiny confirm modal.
   - Context must be shown early and sticky totals must remain visible during the allocation workflow.
   - Transfer-aware lineage should stay collapsed by default and expand only when the user drills into allocation detail.
20. `Frontend i18n pattern`
   - New landed-cost pages should follow the repo's existing `useI18n()` pattern used by the current inventory pages.
   - Visible labels, banners, disabled reasons, and action messages should be localized rather than hard-coded.

## Scope Lock

V1 is for `STOCK` only.

Explicitly out of scope:

- fixed assets on separate later bills
  - use Track 39 `IMPROVE_EXISTING` instead
- same-document charges
  - use Track 40
- AR landed-cost scenarios
- retroactive mutation of already-posted source receipt journals
- mixed-ownership-context vouchers
  - use separate vouchers per ownership context
- standalone manual landed-cost vouchers with freeform offset account
  - V1 is AP-line-backed instead
- target-layer transaction-currency restatement when source voucher currency differs from descendant layer currency
  - V1 is base-authoritative

## Business Cases

### Case 1: Separate freight invoice after receipt

- Goods received on `March 10`
- Vendor freight invoice arrives on `March 18`
- User allocates freight across the posted receipt lines

Expected outcome:

- inventory cost increases in the current open period
- source receipt audit remains intact
- landed-cost voucher holds the allocation trail

### Case 2: Separate customs / import service bill after partial consumption

- Goods received on `March 10`
- Some quantity already issued or sold
- Customs invoice arrives on `March 25`

Expected outcome:

- on-hand portion capitalizes into remaining inventory value
- already-consumed portion is recognized through a current-period landed-cost expense / COGS adjustment path
- the entity total cost is corrected without rewriting historical stock movement rows

### Case 3: HQ receipt transferred to branch before later customs bill

- HQ receives books centrally on `March 10`
- HQ transfers part of that stock to branch warehouses on `March 12`
- Customs invoice arrives on `March 20`

Expected outcome:

- landed-cost targeting can follow the receipt economics through transfer lineage
- on-hand branch stock can still receive capitalization
- already-consumed quantity is still split to current-period expense / adjustment
- the voucher remains restricted to one ownership context, so cross-context allocations are split into separate vouchers

## Valuation Lock

The landed-cost engine must allocate over the original receipt economics, then split the result by current inventory state:

- `remaining quantity on hand` -> capitalize to inventory
- `already consumed quantity` -> current-period expense / adjustment

This split must be deterministic and visible in preview and posting output.
For transfer-aware targets, `on hand` means current surviving quantity across eligible descendant receipt layers in the same ownership context, not only the original receipt layer's `quantity_remaining`.

## Cross-Document Lock

Targets are not sibling draft lines. They are posted stock receipt origins such as:

- `cari_document_line_stock_links`
- resulting `inventory_movements`
- resulting open/consumed cost-layer state

The voucher must not rely on Track 40's `targetLineNo` same-document pattern.
The voucher must resolve target lineage through inventory transfers where needed, but each posted voucher still remains limited to one ownership context.

## Execution Tracking

### Master Tracker

**Phase 1: Voucher Foundation + Allocation Preview**
- [x] `STEP-LCV01` - Schema: landed-cost voucher header/source/target/layer-allocation tables
- [x] `STEP-LCV02` - Backend preview/allocator engine for posted stock receipts with transfer-aware lineage and ownership-context enforcement

**Phase 2: Posting + Reversal**
- [x] `STEP-LCV03` - Backend posting engine: AP-line-backed reclass + future FIFO / transfer valuation participation
- [x] `STEP-LCV04` - Backend reversal path with downstream-dependency blocking

**Phase 3: Frontend + Audit Exposure**
- [x] `STEP-LCV05` - Frontend voucher workflow / target picker / preview
- [x] `STEP-LCV06` - Voucher read model, drillback, and inventory audit exposure

**Phase 4: Testing + Release**
- [x] `STEP-LCV07` - Smoke coverage, OpenAPI, and release gates for source/lineage/reversal cases

### Sequence Notes

1. `LCV01` must land first because every later step depends on durable voucher persistence and journal/source linkage.
2. `LCV02` is the math lock for the track; `LCV03` must post from preview-backed allocation logic rather than inventing separate posting math.
3. `LCV03` and `LCV04` should be implemented and reviewed as one accounting pair before the frontend workflow is considered complete.
4. `LCV05` depends on stable preview/create/read APIs from `LCV01`-`LCV04`.
5. `LCV06` depends on final posting, future issue/transfer overlay behavior, and reversal lineage so audit/drillback semantics do not drift mid-implementation.
6. `LCV07` closes the track only after Track 40 same-document behavior is re-verified as unchanged.

---

## Phase 3 UI Shape

### Placement

- Sidebar:
  - `Inventory`
  - `Inventory Movements`
  - `Inventory Transfers`
  - `Stok Maliyet Voucherleri`
- Primary route: `/app/stok-maliyet-voucherleri`
- Page title should be localized via `useI18n()`; English copy such as `Stock Landed Cost Vouchers` is not the canonical route/label form
- Primary CTA: `New Landed Cost Voucher`

### V1 Pages

1. List page
2. New voucher wizard page
3. Voucher detail page

Do not build in V1:

- inline create modal
- separate edit page
- dashboard-style landing page

### Visual Tone

- calm enterprise style
- white background
- bordered cards
- medium-density tables
- muted sublabels
- colored status chips
- sticky right summary

Avoid:

- dashboard charts as the main experience
- too many popups
- one giant form
- hidden calculations
- generic manual-journal look and feel

---

## `STEP-LCV01` - Schema: landed-cost voucher foundation

### Patch target
- Migration slot note: use `m154` if Track 40 `m153` remains the latest migration slot when implementation starts
- `backend/src/migrations/` - new migration file after the current highest slot
- `backend/src/migrations/index.js`

### In scope
1. Add a dedicated header table, for example `stock_landed_cost_vouchers`, carrying:
   - `id`, `tenant_id`, `legal_entity_id`
   - `voucher_no`
   - `status`
   - `posting_date`
   - `ownership_scope`
   - `operating_unit_id` nullable
   - `currency_code`
   - `note`
   - posted journal linkage fields as needed
2. Add a dedicated source table, for example `stock_landed_cost_voucher_sources`, carrying:
   - `voucher_id`
   - `source_cari_document_id`
   - `source_cari_document_line_id`
   - `source_currency_code_snapshot`
   - `source_posting_account_id_snapshot`
   - `applied_amount_txn`
   - `applied_amount_base`
   - duplicate-application / unapplied-balance control fields as needed
3. Add a dedicated business-level target table, for example `stock_landed_cost_voucher_targets`, carrying:
   - `voucher_id`
   - `source_stock_link_id`
   - `source_anchor_inventory_movement_id`
   - `allocation_method_snapshot`
   - `allocated_amount_txn/base`
   - `quantity_basis_snapshot`
   - `on_hand_allocated_amount_base`
   - `consumed_allocated_amount_base`
   - ownership-context / transfer-lineage snapshot fields as needed for audit
4. Add a dedicated layer-allocation detail table, for example `stock_landed_cost_voucher_layer_allocations`, carrying:
   - `voucher_target_id`
   - `source_anchor_inventory_movement_id`
   - `resolved_inventory_movement_id`
   - `resolved_cost_layer_id`
   - `origin_layer_allocation_id` nullable for carry-forward descendants created by later transfer receipt
   - `allocation_role` such as `ON_HAND` / `CONSUMED`
   - `quantity_snapshot`
   - `allocated_amount_base`
   - `remaining_adjusted_quantity`
   - `remaining_adjusted_amount_base`
   - `open_status`
   - optional `allocated_amount_txn` only when safe to persist
   - downstream-state / reversal-lineage support fields as needed
5. Add a landed-cost consumption detail table, for example `stock_landed_cost_layer_consumptions`, carrying:
   - `voucher_layer_allocation_id`
   - `consuming_inventory_movement_id`
   - `consuming_inventory_transfer_id` nullable when transfer shipment uses the consuming movement
   - `quantity_consumed`
   - `allocated_amount_base_consumed`
   - `carry_forward_receipt_movement_id` nullable when transfer receipt recreates the open landed-cost balance
   - `carry_forward_cost_layer_id` nullable when transfer receipt recreates the open landed-cost balance
   - reversal / restoration lineage fields as needed
6. Add any supporting source-link / journal-link lineage needed for drillback.
7. Add repo-style constraints and indexes:
   - tenant / legal-entity lookup indexes on header, source, target, layer-allocation, and consumption tables
   - uniqueness and duplicate-application guards where source-line and effective layer rows must remain unique
   - foreign keys for voucher, source line, target, resolved movement, resolved cost layer, and consuming movement lineage
   - for scoped business-table references, prefer the repo's normal composite foreign-key style where possible, such as `(tenant_id, legal_entity_id, id)` or `(tenant_id, id)` depending on the parent table
   - hot-path indexes for `voucher_id`, `source_cari_document_line_id`, `resolved_cost_layer_id`, `consuming_inventory_movement_id`, and open-balance status fields

### Definition of done
- Voucher header + source + target + layer-allocation rows are durable and migration-safe
- AP source application can be tracked at line level rather than only at source document header level
- Future issue / transfer overlay state can be persisted deterministically rather than reconstructed ad hoc
- Repo-style indexes and uniqueness / foreign-key protections are committed with the schema, not deferred
- Migration is registered in `backend/src/migrations/index.js`

### Implementation caution
- Keep scoped foreign keys, uniqueness guards, and hot-path indexes strict from the first migration, especially around `source_cari_document_line_id`, `resolved_cost_layer_id`, `consuming_inventory_movement_id`, and open-balance remaining-state fields, because later issue / transfer overlay correctness and performance depend on them.

---

## `STEP-LCV02` - Preview/allocator engine for posted stock receipts

### Patch target
- `backend/src/services/inventory.landed-cost.service.js`
- `backend/src/services/cari.document.service.js` if source CARI drillback helpers are reused
- `backend/src/routes/inventory.landed-cost.routes.js`
- dedicated landed-cost validator surface

### In scope
1. Resolve eligible posted AP source lines and unapplied source amounts for the voucher:
   - posted AP document only
   - same `legal_entity_id` as the voucher / target context
   - line-net based only
   - tax amounts excluded in V1
   - `lineKind = STANDARD`
   - `chargeAllocationMethod = NONE`
   - `subledgerType = NONE`
   - `stockImpactMode = NONE`
   - no active source-document reversal
   - duplicate application guarded by source-line applied-balance logic
2. Preview a posted receipt selection and allocate landed cost by:
   - `EQUAL`
   - `BY_AMOUNT`
   - `BY_QTY`
   - `MANUAL`
3. Resolve current stock state for each target through an explicit lineage algorithm:
   - original receipt anchor
   - descendant transfer receipt discovery
   - same-ownership-context filter
   - current open-layer remaining quantity
   - already-consumed quantity from issue-layer consumptions
4. Split the allocated cost into:
   - inventory capitalization portion
   - consumed / expense-adjustment portion
   - out-of-scope / cross-context remainder blocked from the voucher when applicable
5. Return a deterministic preview response with:
   - applied source-line summary
   - source-line remaining / unapplied balance visibility
   - per-target allocation
   - resolved descendant layer-allocation preview
   - on-hand vs consumed split
   - total capitalization
   - total expense adjustment
   - base-authoritative totals
   - ownership-context confirmation for the voucher payload

### Definition of done
- Preview is deterministic and matches posting math
- Partial-consumption targets are handled explicitly, not hidden
- Mixed ownership-context selections are rejected before posting
- Cross-legal-entity source / target combinations are rejected before posting
- Source AP line over-application is rejected before posting
- Transfer-descendant layer splits are visible in preview detail, not compressed into opaque target totals
- FX behavior is explicit: preview math is authoritative in base

---

## `STEP-LCV03` - Posting engine: valuation adjustment and journal logic

### Patch target
- `backend/src/services/inventory.landed-cost.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/utils/source-ref-types.js`
- `backend/src/services/gl.reverse-block-destination.service.js`
- `backend/src/routes/gl.read.journal.routes.js`
- `backend/src/routes/inventory.landed-cost.routes.js`
- `backend/src/index.js`
- `backend/src/services/gl.write.journal` surfaces if needed through existing helpers

### In scope
1. Post a landed-cost voucher from a preview-backed payload.
2. Lock the credit-side accounting model for V1:
   - voucher is AP-line-backed, not manual standalone
   - credit reclass comes from persisted AP source-line posting-account economics
3. Increase inventory value for the on-hand portion using dedicated landed-cost layer-allocation persistence, not quantity-neutral `inventory_movements` / `inventory_cost_layers`.
4. Post current-period consumed adjustment for the consumed portion using the repo's current inventory issue account-resolution model for the item card.
5. Keep historical receipt rows immutable; this is a current-period adjustment workflow.
6. Persist voucher header/source/target/layer-allocation rows and journal lineage.
7. Reject posting if any selected target falls outside the voucher ownership context.
8. Reject posting if any source AP line application exceeds its remaining unapplied amount.
9. Extend future issue and transfer shipment valuation so open landed-cost balances on descendant layers are consumed additively with FIFO layer cost.
10. Persist landed-cost consumption rows when later issues / transfer shipments consume those open landed-cost balances.
11. On transfer receipt, recreate carried-forward open landed-cost balance rows tied to the destination receipt movement / destination cost layer.
12. Lock AP source-line application rows and landed-cost open-balance rows in-transaction before recalculating remaining availability.
13. Register backend route mounting in `backend/src/index.js`.
14. Register `STOCK_LANDED_COST_VOUCHER` across source-ref registry, journal drillback, and reverse-block destination wiring.
15. Register AP source-line dependency so reversing the source CARI document is blocked until active landed-cost vouchers are reversed.

### Definition of done
- Posted voucher adjusts valuation without rewriting source receipts
- Journals and audit rows tie back cleanly to the voucher
- No quantity-neutral inventory movement or cost-layer carrier is required in V1
- AP-line-backed reclass behavior is explicit and auditable at line level
- Per-layer capitalization detail is durable enough for later drillback and reversal blocking
- Future issues and transfer shipments consume adjusted on-hand value, not just original layer cost
- Transfer receipt carries landed-cost open balances forward into destination receipt-side open state
- Source CARI reversal blocker and journal drillback wiring are active end-to-end

---

## `STEP-LCV04` - Reversal path

### Patch target
- `backend/src/services/inventory.landed-cost.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/services/cari.document.service.js`
- reversal / journal linkage helpers as needed

### In scope
1. Reverse a posted landed-cost voucher in the current architecture.
2. Undo both:
   - inventory capitalization portion
   - consumed / expense-adjustment portion
3. Preserve voucher history and reversal lineage.
4. Block reversal when any capitalized layer-allocation slice has later downstream issue, transfer, or other dependency after voucher posting.
5. Use persisted layer-allocation detail rather than re-deriving reversal scope from coarse target totals.
6. Restore open landed-cost balances when later issue / transfer reversals unwind previously recorded landed-cost consumption rows.
7. Release source-document reversal blockers only when no active landed-cost voucher source applications remain.
8. Unwind transfer-receipt carry-forward rows when transfer reversal or landed-cost reversal reopens the originating landed-cost balance.

### Definition of done
- Reversal is symmetrical and auditable
- Downstream-dependent vouchers fail fast with a clear blocker instead of silently unwinding stale valuation state

---

## `STEP-LCV05` - Frontend voucher workflow

### Patch target
- `frontend/src/pages/inventory/InventoryLandedCostVouchersPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVoucherNewPage.jsx`
- `frontend/src/api/inventory.js`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- shared API client files as needed

### In scope
1. Add the list page at `/app/stok-maliyet-voucherleri`.
2. List page header must include:
   - title: `Stock Landed Cost Vouchers`
   - subtitle: `Allocate posted AP extra costs onto posted stock receipts`
   - primary action: `New Landed Cost Voucher`
3. List page filter bar should include:
   - legal entity
   - ownership context
   - operating unit
   - status
   - posting date from / to
   - vendor
   - search box
4. List page search should match:
   - voucher no
   - AP bill no
   - vendor name
   - source line description
   - receipt reference
5. List page grid should include:
   - voucher no
   - posting date
   - legal entity
   - context
   - operating unit
   - source amount
   - capitalized
   - consumed
   - status
   - source bill count
   - target count
   - created by
6. List page row actions should include:
   - `View`
   - `Reverse`
   - disabled reverse tooltip text: `Blocked by downstream dependency`
7. List page status chips should support:
   - `Draft`
   - `Posted`
   - `Reversed`
   - `Reversal Blocked`
   - `Reversal Blocked` should be treated as a derived UI badge/state when reversal is blocked by dependency, not as a required persisted backend voucher status value
8. List page row click should open the voucher detail page.
9. Add the new-voucher wizard page at `/app/stok-maliyet-voucherleri/yeni`.
10. New-voucher page must use:
   - breadcrumb: `Inventory / Landed Cost Vouchers / New`
   - top step bar:
     - `1 Source AP Lines`
     - `2 Target Receipts`
     - `3 Allocation Preview`
     - `4 Review & Post`
   - main work area on the left
   - sticky summary panel on the right
11. Step 1 `Source AP Lines` must:
    - show legal entity, posting date, ownership context, operating unit when context = `OPERATING_UNIT`, and note
    - make legal entity and context visible early
    - provide an `Eligible Posted AP Source Lines` picker with vendor, bill date, currency, and search filters
    - support `Show only lines with remaining unapplied amount`
    - show disabled rows with strong reason badges instead of silently hiding them
12. Step 1 disabled reason badges should support at least:
    - `Charge line from Track 40`
    - `Tax line not eligible`
    - `Stock-affecting line not eligible`
    - `Fixed asset line not eligible`
    - `No remaining unapplied amount`
    - `Wrong legal entity`
    - `Source document under reversal`
13. Step 2 `Target Receipts` must:
    - provide receipt date, item, warehouse, and receipt-ref filters
    - support `Show only receipts with same legal entity`
    - support `Show only receipts matching selected context`
    - show current on-hand / consumed snapshot columns
14. Step 2 must block mixed-context selections with a full-width error banner:
    - `Selected targets span multiple ownership contexts. Create separate vouchers per context.`
15. Step 3 `Allocation Preview` must be the primary working screen and include:
    - allocation method selector
    - `Recalculate Preview`
    - optional `Reset Manual Edits`
    - top business-level target allocation grid
    - lower resolved-layer detail pane for the selected target
16. Step 3 target allocation grid should include:
    - receipt ref
    - item
    - qty basis
    - original value basis
    - allocated amount
    - on-hand portion
    - consumed portion
    - context
    - operating unit
    - expand icon
17. Step 3 row expansion must expose transfer-aware lineage with child/detail fields such as:
    - resolved movement ref
    - resolved cost layer ref
    - descendant path
    - role
    - qty snapshot
    - allocated amount base
    - notes
18. Step 3 lower detail pane `Resolved Layer Allocation Detail` should include:
    - source anchor receipt
    - resolved receipt / movement
    - cost layer
    - role
    - qty snapshot
    - allocated amount
    - remaining adjusted qty
    - remaining adjusted amount
    - open status
19. Step 3 must support visible validation banners for:
    - transfer-descendant informational / warning state
    - source over-application blockers
    - mixed ownership-context blockers
    - cross-legal-entity blockers
20. Step 4 `Review & Post` must stay compact and include:
    - header summary card
    - source summary card
    - target summary card
    - journal impact preview card with collapsed summary first
    - warning / blocker card when needed
    - sticky bottom action bar with `Save Draft`, `Post Voucher`, and `Back to Preview`
21. Sticky summary panel across the wizard should keep visible:
    - legal entity
    - context
    - operating unit
    - selected source line count / amount
    - selected target count
    - total allocated
    - total capitalized
    - total consumed adjustment
    - warnings / blockers
22. Keep this workflow separate from the Track 40 same-document line editor and separate from the generic inventory movements workbench.
23. Frontend permission gating in this draft mirrored the then-current inventory page behavior:
    - list / detail / preview read use `inventory.read`
    - mutating landed-cost actions were originally described under `inventory.upsert`, but later implementation uses `inventory.landed_cost.upsert`
    - missing action permission should be shown inline rather than hidden implicitly
24. New landed-cost pages should follow the repo's existing `useI18n()` pattern; visible labels, banners, disabled reasons, and action messages should be localized rather than hard-coded.
   - Explicit copy shown in this tracker, such as `Stock Landed Cost Vouchers`, `New Landed Cost Voucher`, `Review & Post`, or `Blocked by downstream dependency`, should be treated as example/localizable UI wording rather than literal hard-coded strings.
25. UI source pickers may use lightweight lookup/read helpers for eligible AP source lines and eligible posted receipt anchors when existing CARI/inventory endpoints are too coarse, but preview remains the authoritative validator.

### Definition of done
- User can navigate from list page to new wizard page and complete a preview/post flow without editing the original receipt document
- Context, totals, and blockers remain visible enough that the workflow does not feel like manual journal entry construction

---

## `STEP-LCV06` - Read model and audit exposure

### Patch target
- `backend/src/services/inventory.landed-cost.service.js`
- `backend/src/routes/gl.read.journal.routes.js`
- `frontend/src/pages/inventory/InventoryLandedCostVoucherDetailPage.jsx`
- `frontend/src/utils/sourceRefTypes.js`
- `frontend/src/utils/journalSourceLinkDestinations.js`
- inventory / drillback UI surfaces as needed

### In scope
1. Add the voucher detail page at `/app/stok-maliyet-voucherleri/:voucherId`.
2. Voucher detail breadcrumb should be:
   - `Inventory / Landed Cost Vouchers / {voucherNo}`
3. Voucher detail header should include:
   - voucher no
   - status chip
   - posting date
   - `Reverse`
   - `Open Journal`
   - more-menu overflow if needed
4. Voucher detail summary chips should include:
   - legal entity
   - context
   - operating unit
   - source amount
   - capitalized
   - consumed
   - source line count
   - target count
5. Voucher detail must expose tabs for:
   - `Summary`
   - `Source AP Lines`
   - `Target Receipts`
   - `Layer Allocations`
   - `Landed-Cost Consumptions`
   - `Journal & Audit`
6. `Summary` tab should include:
   - source amount
   - capitalized amount
   - consumed amount
   - remaining source balance after posting
   - created by / at
   - reversed by / at when applicable
   - note
   - high-level journal summary
7. `Source AP Lines` tab should include:
   - bill no
   - vendor
   - AP line description
   - posting account snapshot
   - applied amount base
   - applied amount txn
   - currency
   - remaining unapplied after posting
   - drillback link
8. `Target Receipts` tab should include:
   - receipt ref
   - item
   - warehouse
   - context
   - operating unit
   - allocated amount
   - on-hand portion
   - consumed portion
   - drillback
9. `Layer Allocations` tab should be the expert view and include:
   - source anchor movement
   - resolved movement
   - resolved cost layer
   - origin layer allocation
   - role
   - qty snapshot
   - allocated amount
   - remaining adjusted qty
   - remaining adjusted amount
   - open status
   - row-detail drawer with descendant path, carry-forward info, and linked landed-cost consumptions
10. `Landed-Cost Consumptions` tab should include:
    - voucher layer allocation
    - consuming movement
    - transfer ref
    - qty consumed
    - amount consumed
    - carry-forward receipt movement
    - carry-forward cost layer
    - reversed / restored status
11. `Journal & Audit` tab should include:
    - journal entry link
    - source link type `STOCK_LANDED_COST_VOUCHER`
    - journal debit/credit grid with context / operating unit visibility
    - reversal blocker visibility
    - source-document blocker state
    - audit timestamps
12. Detail page access/action gating should stay explicit:
    - detail page open/read uses `inventory.read`
    - this draft originally grouped `Reverse` and other mutating detail actions under `inventory.upsert`, but later implementation uses `inventory.landed_cost.upsert`
    - missing mutating permission should be surfaced inline rather than hidden implicitly
13. Reverse flow must use a side drawer or dedicated confirmation surface and not a tiny modal.
14. Reverse drawer should:
    - show voucher no, status, capitalized amount, consumed amount, and journal ref
    - show an explicit success-eligibility message when reversible
    - show a red blocker section with precise dependency detail when reversal is blocked
15. Reversal blocker detail should be precise enough to list:
    - resolved cost layer
    - dependent movement
    - dependency type
    - date
16. Expose voucher list/detail history, linked sources, linked targets, layer-allocation detail, and journal lineage.
17. Show that inventory value includes landed-cost voucher adjustments.
18. Keep reporting semantics explicit for:
   - original receipt cost
   - same-document charge cost (Track 40)
   - cross-document landed-cost voucher adjustments
19. Expose transfer-aware drillback clearly enough to distinguish original receipt, transfer descendants, and voucher-applied cost.
20. Expose voucher-to-journal drillback and inventory-audit visibility without hiding the AP source-line basis.

### Definition of done
- Inventory audit / drillback can distinguish source receipt cost from later landed-cost vouchers
- Voucher detail can show exactly which descendant layers received capitalization vs consumed adjustment
- Reverse UX communicates both eligible and blocked states without collapsing into a generic confirm prompt

---

## `STEP-LCV07` - Smoke coverage and release gates

### Patch target
- `backend/scripts/`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Add smoke coverage for:
   - separate freight bill allocated to one posted receipt
   - one voucher targeting multiple receipts
   - partial-consumption target split between on-hand capitalization and expense adjustment
   - transfer-aware target resolution after inter-warehouse / inter-OU transfer lineage
   - future issue valuation consumes landed-cost uplift on still-open stock
   - future transfer shipment valuation consumes landed-cost uplift on still-open stock
   - transfer receipt recreates carried-forward open landed-cost balances on the destination receipt layer
   - issue / transfer reversal restores landed-cost open balances
   - AP-line-backed reclass journal behavior
   - duplicate source AP line application guard
   - Track 40 charge lines and stock / fixed-asset lines are rejected as landed-cost sources
   - cross-legal-entity source / target selection is rejected
   - source AP document reversal is blocked while active landed-cost voucher applications remain
   - `STOCK_LANDED_COST_VOUCHER` journal drillback resolves to the landed-cost voucher workflow
   - reversal of posted landed-cost voucher while still eligible
   - blocked reversal after later downstream dependency on a capitalized slice
   - cross-currency voucher with base-authoritative allocation behavior
   - same-document Track 40 path still unchanged
2. Regenerate OpenAPI and keep release-gate conventions aligned with the repo.

### Definition of done
- Dedicated smoke scripts exist in `backend/scripts/`
- OpenAPI is regenerated and committed
- Track 40 same-document flow and this cross-document stock flow remain clearly separate

## Dependencies

- Track 26-29 inventory valuation/reversal foundations must already exist
- Track 39 stock-aware CARI line foundations must already exist
- Track 40 should land first, because it covers the simpler same-document case that this track deliberately does not absorb

## Dependency Note

- Inventory transfer lineage from Track 31 / Track 33 / Track 124 foundations is part of the effective V1 dependency surface because transfer-aware targeting is locked in

## Future Extensions

| Feature | Description | Why deferred |
|---|---|---|
| Estimated vs actual landed cost accruals | Expected freight estimate before final vendor invoice | Separate policy/workflow layer |
| Non-stock service apportionment | Allocate later service cost to expense-only targets | Different accounting outcome |
| Cross-border import packs | Duties, insurance, brokerage bundled by trade operation | Broader logistics workflow |
| Fixed-asset post-capitalization voucher | Separate-bill ancillary cost capitalization for assets | Use Track 39 `IMPROVE_EXISTING` first |
