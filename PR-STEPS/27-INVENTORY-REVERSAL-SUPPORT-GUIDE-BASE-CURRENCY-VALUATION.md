# 27 - INVENTORY REVERSAL, SUPPORT-GUIDE PARITY, AND BASE-CURRENCY VALUATION

## Execution tracking
- This file is both the source/spec file and the execution tracker.
- Keep execution status in the `Master tracker` section below.

## Why this follow-up exists
- `25-CARI-LINES-ITEM-CARDS-INVENTORY-HANDSHAKE.md` and `26-INVENTORY-VALUATION-RBAC-POSTING-HARDENING.md` completed the line model, inventory handshake, FIFO valuation, `COGS` posting, and contract hardening.
- Three practical gaps remain:
  - valued inventory issues still have no first-class reversal/void workflow
  - `docs/runbooks/cari-v1-support-finance-ui-guide.md` still says issue materialization ends in `PENDING`
  - outbound valuation still fails when open FIFO layers for the same item/warehouse carry mixed currencies

## Current implementation facts that matter
- `backend/src/routes/inventory.routes.js` only exposes list/create flows for warehouses, stock links, movements, and cost layers.
- `backend/src/services/inventory.service.js` reads `reversalJournalEntryId` / `reversedAt`, but current issue posting only writes `posted_journal_entry_id`.
- `docs/runbooks/cari-v1-support-finance-ui-guide.md` still documents `issue movement -> PENDING`.
- `backend/src/services/inventory.service.js` currently throws `Issue valuation across mixed cost-layer currencies is not supported yet`.
- Inventory issue journals are already additive and traceable through `journal_source_links`; reversal should preserve that model.

## Locked decisions
- Inventory reversal must be additive, not destructive:
  - keep original movement
  - keep original `COGS` journal
  - create explicit reversal evidence and restored layer quantities
- Support/finance documentation must match runtime behavior and be covered by release gates.
- Mixed-currency inventory issue valuation should use legal-entity base currency as the accounting source of truth.
- Do not force one fake transaction currency onto an issue that consumes multiple receipt-layer currencies.
- Base-currency valuation does not require a second costing method. FIFO remains the first method.

## Scope
- Add reversal/void lifecycle for valued outbound issues.
- Bring support/finance guide coverage in line with the already-updated operations runbook.
- Replace the current mixed-currency FIFO hard-fail with base-currency valuation.

## Non-goals
- No lot, serial, bin, reservation, or batch costing engine.
- No weighted-average or standard-cost matrix in this PR set.
- No destructive rewrite of existing valued issue history.
- No full inventory subledger redesign beyond what reversal and base-currency valuation require.

## Unified execution order
1. `PR-IV06` - Valued issue reversal and layer restoration
2. `PR-IV07` - Support-guide parity and release-gate coverage
3. `PR-IV08` - Base-currency valuation for mixed-currency FIFO pools

## Master tracker
- [x] `PR-IV06` acceptance: valued outbound issues can be reversed additively with restored cost layers and reversal journal evidence.
- [x] `PR-IV07` acceptance: support/finance guide matches live inventory behavior and the release gate checks it.
- [x] `PR-IV08` acceptance: outbound issue valuation no longer fails on mixed receipt-layer currencies and posts from base-currency totals.

## PR-IV06
Goal:
- Add an explicit reversal/void path for already-valued outbound issues.

Deliverables:
- Add one supported reversal entry point, for example:
  - `POST /api/v1/inventory/movements/{movementId}/reverse`
  - or equivalent stock-link-driven reverse route if that fits better
- Allow reversal only when:
  - movement type is `ISSUE`
  - valuation status is `VALUED`
  - movement is not already reversed
- Restore consumed cost-layer quantities from `inventory_issue_layer_consumptions`.
- Create reversal journal:
  - `Dr Inventory`
  - `Cr COGS`
- Persist reversal linkage on:
  - inventory movement
  - journal source links
  - source stock link if status semantics need update
- Surface reversal state in inventory detail/list UI.

Files:
- `backend/src/routes/inventory.routes.js`
- `backend/src/routes/inventory.validators.js`
- `backend/src/services/inventory.service.js`
- inventory migrations if extra reversal metadata is needed
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- rollout/regression scripts

Acceptance:
- A valued issue can be reversed once and only once.
- Layer quantities are restored exactly to pre-issue state.
- Reversal journal is traceable and additive.
- Replaying the same reverse action is idempotent.

Notes:
- Do not delete or mutate the original issue into a different business meaning.

## PR-IV07
Goal:
- Remove doc/gate mismatch between runtime inventory behavior and support guidance.

Deliverables:
- Update:
  - `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- Support guide must reflect:
  - issue movement now becomes `VALUED`
  - issue may post one `COGS` journal
  - replay/idempotent reuse behavior
  - inventory/item-card permissions where support users need to triage access issues
- Extend inventory release-gate script so stale support guidance is caught automatically.

Files:
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- `backend/scripts/test-inventory-pr26-release-gate.js` or successor gate script
- `backend/package.json` if the gate command name changes

Acceptance:
- Support guide no longer says issue materialization stops at `PENDING`.
- Release gate fails if support docs regress away from live behavior.

Notes:
- This PR is small, but it closes a real operator-risk gap.

## PR-IV08
Goal:
- Support FIFO issue valuation when one item/warehouse has open receipt layers from different transaction currencies.

Deliverables:
- Remove the current hard-fail on mixed layer currencies.
- Use legal-entity base currency as valuation source of truth:
  - consume each layer using its stored `unit_cost_base` / `total_cost_base`
  - aggregate issue total in base currency
  - post inventory relief and `COGS` journal from base amounts
- Define movement amount semantics clearly:
  - base totals are authoritative for accounting
  - transaction-currency display on mixed-currency issue must not pretend the issue had one true source currency
- If needed, add issue-cost snapshot detail so UI/reporting can still explain which source currencies fed the issue.
- Extend regression coverage with one mixed-currency receipt-pool scenario.

Files:
- `backend/src/services/inventory.service.js`
- inventory migrations if extra issue-cost snapshot table/JSON field is needed
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `docs/runbooks/inventory-item-card-rollout.md`
- regression scripts

Acceptance:
- One item can be received into the same warehouse from at least two currencies and still issue successfully.
- FIFO layer consumption remains deterministic.
- `COGS` journal posts from base totals without inventing a misleading single source currency.
- Operators can still understand which receipt layers were consumed.

Notes:
- This PR is about accounting correctness first.
- If later reporting needs per-currency analytics, add that as layer/source breakdown, not as a fake unified issue currency.
