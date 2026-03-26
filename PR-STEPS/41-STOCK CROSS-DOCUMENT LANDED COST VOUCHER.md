# 41 - STOCK CROSS-DOCUMENT LANDED COST VOUCHER

## Status
- Planned
- Follow-up track after Track 40 same-document line charges
- Inventory-only scope in V1; fixed-asset separate-bill capitalization continues to use Track 39 `IMPROVE_EXISTING`

## Purpose
Add a proper ERP-grade workflow for **separate freight / customs / service / ancillary cost bills** that arrive after stock has already been received on another document.

Track 40 handles **same-document** charge distribution before posting. This track handles the different workflow where:

- stock receipt is already posted
- ancillary costs arrive on a separate AP document or later date
- inventory valuation must be adjusted **after receipt**

## Why a Separate Track

1. This is not a small extension of Track 40's same-document charge math.
2. The target is already-posted stock receipt history, not sibling lines on the same draft document.
3. The feature affects inventory valuation layers, on-hand vs consumed quantity handling, and current-period journal adjustments.
4. Real ERP systems usually model this as a separate landed-cost voucher / landed-cost invoice workflow, not as a second flavor of same-document line charges.

## Core Product Direction

Introduce a dedicated workflow:

- `Stock Landed Cost Voucher`

This is:

- not the Track 40 same-document charge line flow
- not a fixed-asset `IMPROVE_EXISTING` posting
- not a hidden mutation of historical stock receipt rows

This workflow must:

- reference one or more already-posted stock receipt targets
- distribute separate ancillary costs across those targets
- update inventory valuation in the current open period
- preserve a durable voucher/audit source for the landed-cost allocation
- keep stock-only scope in V1

## Scope Lock

V1 is for `STOCK` only.

Explicitly out of scope:

- fixed assets on separate later bills
  - use Track 39 `IMPROVE_EXISTING` instead
- same-document charges
  - use Track 40
- AR landed-cost scenarios
- retroactive mutation of already-posted source receipt journals

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

## Valuation Lock

The landed-cost engine must allocate over the original receipt economics, then split the result by current inventory state:

- `remaining quantity on hand` → capitalize to inventory
- `already consumed quantity` → current-period expense / adjustment

This split must be deterministic and visible in preview and posting output.

## Cross-Document Lock

Targets are not sibling draft lines. They are posted stock receipt origins such as:

- `cari_document_line_stock_links`
- resulting `inventory_movements`
- resulting open/consumed cost-layer state

The voucher must not rely on Track 40's `targetLineNo` same-document pattern.

## Execution Tracking

| Step | Scope | Status |
|---|---|---|
| LCV01 | Schema: landed-cost voucher header/targets tables | Not started |
| LCV02 | Preview/allocator engine for posted stock receipts | Not started |
| LCV03 | Posting engine: valuation adjustment + journal logic | Not started |
| LCV04 | Reversal path for landed-cost vouchers | Not started |
| LCV05 | Frontend voucher workflow / target picker / preview | Not started |
| LCV06 | Read model, drillback, and inventory audit exposure | Not started |
| LCV07 | Smoke coverage and release gates | Not started |

---

## `STEP-LCV01` — Schema: landed-cost voucher foundation

### Patch target
- `backend/src/migrations/` — new migration file after the current highest slot
- `backend/src/migrations/index.js`

### In scope
1. Add a dedicated header table, for example `stock_landed_cost_vouchers`, carrying:
   - `id`, `tenant_id`, `legal_entity_id`
   - `voucher_no`
   - `status`
   - `posting_date`
   - `currency_code`
   - `source_cari_document_id` nullable
   - `note`
   - posted journal linkage fields as needed
2. Add a dedicated target table, for example `stock_landed_cost_voucher_targets`, carrying:
   - `voucher_id`
   - `source_stock_link_id`
   - `source_inventory_movement_id`
   - `allocation_method_snapshot`
   - `allocated_amount_txn/base`
   - `quantity_basis_snapshot`
   - `on_hand_allocated_amount_base`
   - `consumed_allocated_amount_base`
3. Add any supporting source-link / journal-link lineage needed for drillback.

### Definition of done
- Voucher header + target rows are durable and migration-safe
- Migration is registered in `backend/src/migrations/index.js`

---

## `STEP-LCV02` — Preview/allocator engine for posted stock receipts

### Patch target
- `backend/src/services/inventory.service.js`
- `backend/src/services/cari.document.service.js` if source CARI drillback helpers are reused
- `backend/src/routes/inventory.validators.js` or dedicated landed-cost validator surface

### In scope
1. Preview a posted receipt selection and allocate landed cost by:
   - `EQUAL`
   - `BY_AMOUNT`
   - `BY_QTY`
   - `MANUAL`
2. Resolve current stock state for each target:
   - original receipt quantity
   - quantity remaining on hand
   - quantity already consumed
3. Split the allocated cost into:
   - inventory capitalization portion
   - consumed/expense-adjustment portion
4. Return a deterministic preview response with:
   - per-target allocation
   - on-hand vs consumed split
   - total capitalization
   - total expense adjustment

### Definition of done
- Preview is deterministic and matches posting math
- Partial-consumption targets are handled explicitly, not hidden

---

## `STEP-LCV03` — Posting engine: valuation adjustment and journal logic

### Patch target
- `backend/src/services/inventory.service.js`
- `backend/src/services/gl.write.journal` surfaces if needed through existing helpers

### In scope
1. Post a landed-cost voucher from a preview-backed payload.
2. Increase inventory value for the on-hand portion.
3. Post current-period expense/COGS adjustment for the consumed portion.
4. Keep historical receipt rows immutable; this is a current-period adjustment workflow.
5. Persist voucher header/target rows and journal lineage.

### Definition of done
- Posted voucher adjusts valuation without rewriting source receipts
- Journals and audit rows tie back cleanly to the voucher

---

## `STEP-LCV04` — Reversal path

### Patch target
- `backend/src/services/inventory.service.js`
- reversal/journal linkage helpers as needed

### In scope
1. Reverse a posted landed-cost voucher in the current architecture.
2. Undo both:
   - inventory capitalization portion
   - consumed/expense-adjustment portion
3. Preserve voucher history and reversal lineage.

### Definition of done
- Reversal is symmetrical and auditable

---

## `STEP-LCV05` — Frontend voucher workflow

### Patch target
- `frontend/src/pages/inventory/` or dedicated stock-cost workflow surface
- shared API client files as needed

### In scope
1. Add a guided voucher workflow that lets the user:
   - pick source posted receipts
   - enter landed-cost amount(s)
   - choose allocation method
   - preview on-hand vs consumed split
2. Keep this separate from the Track 40 same-document line editor.
3. Allow source document drillback where possible.

### Definition of done
- User can preview and post a stock landed-cost voucher without editing the original receipt document

---

## `STEP-LCV06` — Read model and audit exposure

### Patch target
- `backend/src/services/inventory.service.js`
- inventory / drillback UI surfaces as needed

### In scope
1. Expose voucher history, linked targets, and journal lineage.
2. Show that inventory value includes landed-cost voucher adjustments.
3. Keep reporting semantics explicit for:
   - original receipt cost
   - same-document charge cost (Track 40)
   - cross-document landed-cost voucher adjustments

### Definition of done
- Inventory audit/drillback can distinguish source receipt cost from later landed-cost vouchers

---

## `STEP-LCV07` — Smoke coverage and release gates

### Patch target
- `backend/scripts/`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Add smoke coverage for:
   - separate freight bill allocated to one posted receipt
   - one voucher targeting multiple receipts
   - partial-consumption target split between on-hand capitalization and expense adjustment
   - reversal of posted landed-cost voucher
   - same-document Track 40 path still unchanged
2. Regenerate OpenAPI and keep release-gate conventions aligned with the repo.

### Definition of done
- Dedicated smoke scripts exist in `backend/scripts/`
- OpenAPI is regenerated and committed
- Track 40 same-document flow and this cross-document stock flow remain clearly separate

## Dependencies

- Track 26–29 inventory valuation/reversal foundations must already exist
- Track 39 stock-aware CARI line foundations must already exist
- Track 40 should land first, because it covers the simpler same-document case that this track deliberately does not absorb

## Future Extensions

| Feature | Description | Why deferred |
|---|---|---|
| Estimated vs actual landed cost accruals | Expected freight estimate before final vendor invoice | Separate policy/workflow layer |
| Non-stock service apportionment | Allocate later service cost to expense-only targets | Different accounting outcome |
| Cross-border import packs | Duties, insurance, brokerage bundled by trade operation | Broader logistics workflow |
| Fixed-asset post-capitalization voucher | Separate-bill ancillary cost capitalization for assets | Use Track 39 `IMPROVE_EXISTING` first |
