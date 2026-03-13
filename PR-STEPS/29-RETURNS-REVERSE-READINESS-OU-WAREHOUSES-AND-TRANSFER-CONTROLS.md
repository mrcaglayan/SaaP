# 29 - RETURNS, REVERSE READINESS, OU-AWARE WAREHOUSES, AND TRANSFER CONTROLS

## Execution tracking
- This file is both the source/spec file and the execution tracker.
- Keep execution status in the `Master tracker` section below.

## Why this follow-up exists
- `25-CARI-LINES-ITEM-CARDS-INVENTORY-HANDSHAKE.md` delivered the commercial line model, item cards, and stock-link handshake.
- `26-INVENTORY-VALUATION-RBAC-POSTING-HARDENING.md` delivered FIFO valuation, `COGS` posting, dedicated RBAC, and release hardening.
- `27-INVENTORY-REVERSAL-SUPPORT-GUIDE-BASE-CURRENCY-VALUATION.md` delivered valued issue reversal and mixed-currency base valuation.
- `28-CARI-INVENTORY-REVERSAL-ORCHESTRATION-AND-RETURN-FLOWS.md` delivered safe reversal guardrails, successor rematerialization, receipt undo, and guided operator flow.
- The next practical gaps are now broader lifecycle and control-model gaps:
  - no first-class partial sales return / purchase return workflow
  - no non-destructive reverse-readiness / impact-preview endpoint before operators click reverse
  - manual split posting for line-taxed documents is intentionally blocked, but the long-term product decision is still open
  - warehouses are still legal-entity scoped only; they are not yet operating-unit aware
  - cross-operating-unit stock movement still has no explicit transfer workflow
  - advanced inventory governance such as lot/serial/bin and broader costing methods still needs a deliberate expansion plan

## Current implementation facts that matter
- `backend/src/migrations/m118_inventory_foundation.js` defines `inventory_warehouses` with:
  - `tenant_id`
  - `legal_entity_id`
  - `code`
  - `name`
  - `status`
  - `notes`
  but no `operating_unit_id` and no `ownership_scope`.
- `backend/src/routes/inventory.routes.js` currently exposes:
  - warehouse list/create
  - pending stock-link list
  - movement list/create
  - movement reverse
  - cost-layer list
  but no reverse-preview/readiness endpoint and no transfer endpoint.
- `backend/src/services/inventory.service.js` validates only `legalEntityId + warehouseId` for movement creation. It does not yet validate warehouse access against a source operating unit.
- `backend/src/services/cari.document.service.js` still rejects `postingLines` for stored-tax documents. UI now hides the dead path, but the product decision is intentionally unresolved.
- The repo already has a good local design precedent for ownership scope:
  - `m111_cash_register_ownership_scope.js` added `ownership_scope = CENTRAL | OPERATING_UNIT` on cash registers.
- The repo also already uses operating-unit attribution in nearby modules:
  - CARI documents
  - bank accounts
  - cash registers
  so OU-aware warehouses fit the current architecture rather than fighting it.

## Locked decisions
- Returns and corrections remain additive, not destructive.
- Partial returns must become first-class business flows. Do not force users to fake them through full reversal plus re-entry.
- Reverse readiness must be non-destructive:
  - preview blockers
  - preview dependent unwind steps
  - preview likely impacted inventory movements/journals/stock links
  without mutating history.
- The line-tax split-posting decision must be closed explicitly:
  - either support it for approved cases
  - or remove the dormant backend branch and document that it is not part of the product
- Warehouses should become OU-aware using the same core pattern the repo already uses for cash registers:
  - optional `operating_unit_id`
  - explicit `ownership_scope = CENTRAL | OPERATING_UNIT`
- Defaulting should follow the user/working operating unit where available.
- Warehouse access must be validated against allowed operating-unit scope, not left to operator convention.
- Cross-operating-unit stock should move only through an explicit transfer workflow. Users should not move stock to another branch just by selecting a foreign warehouse on a generic issue/receipt flow.
- When cross-OU stock transfer needs GL balancing inside the same legal entity, inventory should follow the repo's existing OU internal-current-account balancing model already used by cash and OU-targeted capital flows:
  - `Central Due From OU` + `OU Due To Central` for `Central <-> OU`
  - partner-specific `Due From Partner OU` + `Due To Partner OU` for `OU <-> OU`
- Cross-OU stock transfer must not recognize revenue, expense, or `COGS` at transfer time. If GL entries are needed, they are relocation/balancing entries, not sale accounting.
- Lot/serial/bin/reservation and broader costing methods should be planned deliberately after OU-aware warehouse ownership and transfer controls exist.

## Scope
- Add proper return/correction workflows for stock-affecting AP/AR cases.
- Add a reverse-readiness / impact-preview contract before full orchestration.
- Close the line-tax split-posting product decision.
- Make warehouses operating-unit aware.
- Add explicit cross-OU warehouse transfer controls.
- Prepare the next inventory-control expansion boundary so later lot/serial/bin/costing work has a clean base.

## Non-goals
- No destructive rewrite of existing warehouse, movement, stock-link, or journal history.
- No immediate full WMS redesign.
- No immediate lot/serial/bin implementation in the first slices of this tracker.
- No automatic “smart” cross-module reverse that silently executes everything without preview or operator confirmation.
- No forced expansion into weighted-average or standard cost before governance and transfer controls are stable.

## Unified execution order
1. `PR-IV13` - Partial sales return and purchase return foundations
2. `PR-IV14` - Reverse readiness / impact preview and guided orchestration contract
3. `PR-IV15` - Line-tax split-posting product closure
4. `PR-IV16` - OU-aware warehouse ownership model
5. `PR-IV17` - Cross-operating-unit stock transfer workflow
6. `PR-IV18` - Advanced inventory control envelope and costing-method roadmap

## Master tracker
- [ ] `PR-IV13` acceptance: partial return/correction flows exist without forcing destructive full reversals.
- [ ] `PR-IV14` acceptance: operators can preview reverse blockers and unwind order before attempting the live action.
- [ ] `PR-IV15` acceptance: line-tax split posting is either supported intentionally or removed as a dormant unsupported branch.
- [ ] `PR-IV16` acceptance: warehouses carry explicit OU ownership semantics and movement creation enforces allowed OU context.
- [ ] `PR-IV17` acceptance: cross-OU stock movement is explicit, traceable, and cannot be faked through generic warehouse selection.
- [ ] `PR-IV18` acceptance: the next-stage inventory control/costing expansion has a documented boundary, contracts, and rollout direction.

## PR-IV13
Goal:
- Add first-class partial return and correction flows for stock-affecting commercial documents.

Deliverables:
- Define supported return/correction cases, at minimum:
  - partial purchase return against materialized receipt history
  - partial sales return against issued stock history
  - credit/debit note alignment where the commercial correction should remain traceable to the source document line
- Keep additive evidence:
  - original document stays visible
  - original inventory movement stays visible
  - return/adjustment movement and corrective commercial document stay linked
- Support quantity-based unwind rather than only full movement reverse.
- Define accounting ownership cleanly:
  - return commercial correction in CARI
  - quantity/value unwind in inventory
  - no duplicate posting between modules
- Extend regression coverage for:
  - partial purchase return
  - partial sales return
  - corrected open quantity/value balances after return

Files:
- `backend/src/services/cari.document.service.js`
- `backend/src/services/inventory.service.js`
- inventory/CARI routes and validators
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- docs/specs and regression scripts

Acceptance:
- Users can process a partial return without full original-document reversal.
- Inventory quantity/value unwind remains additive and traceable.
- Return flows preserve clean source linkage to the original commercial line and inventory history.
- Open commercial and stock positions remain reconcilable after the correction.

Notes:
- Do not overload full reverse with partial-return meaning.
- Treat this as a real business workflow, not a workaround path.

## PR-IV14
Goal:
- Let operators preview reverse and unwind consequences before they trigger live additive actions.

Deliverables:
- Add a non-destructive reverse-readiness / impact-preview endpoint for:
  - posted CARI document reverse
  - inventory movement reverse/undo when useful
- Preview should expose at least:
  - blocking movements or links
  - required unwind order
  - dependent issue chronology
  - whether successor rematerialization or receipt undo is needed
  - related journal/link evidence when relevant
- Update frontend to show:
  - readiness summary panel
  - actionable next steps
  - safe navigation to affected inventory/CARI rows
- Keep actual reverse endpoints unchanged in semantic meaning:
  - preview only informs
  - live action still performs additive mutation

Files:
- `backend/src/routes/cari.document.routes.js`
- `backend/src/routes/inventory.routes.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/services/inventory.service.js`
- CARI/inventory frontend panels
- release-gate and docs updates

Acceptance:
- Operators can see blockers and unwind steps before clicking live reverse.
- Preview is non-destructive and idempotent.
- Runtime reverse behavior and preview guidance stay aligned under release-gate coverage.

Notes:
- This is the safe precursor if a future one-click orchestrator is ever considered.

## PR-IV15
Goal:
- Close the unresolved product boundary around manual split posting on stored-tax line documents.

Deliverables:
- Make one explicit product choice:
  - support approved split-posting cases for line-taxed documents
  - or remove the dormant backend branch and document the feature as unsupported
- If support is chosen:
  - define valid use cases
  - define balancing rules
  - define how split lines interact with line-based tax evidence
  - update UI/backend/docs/tests together
- If support is rejected:
  - remove stale code path and error branch
  - keep UI simplified
  - update docs to treat line-based posting as the only supported model for those documents

Files:
- `backend/src/services/cari.document.service.js`
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- docs and regression scripts

Acceptance:
- There is no unresolved “hidden maybe-feature” left in code or UI.
- Runtime, docs, and tests all reflect the same supported behavior.

Notes:
- This PR is mostly product/contract closure, but it prevents long-term confusion.

## PR-IV16
Goal:
- Make warehouses explicitly central-vs-operating-unit owned and make movement creation respect that ownership.

Deliverables:
- Extend warehouse model with:
  - `operating_unit_id` nullable
  - `ownership_scope = CENTRAL | OPERATING_UNIT`
- Backfill/normalize rules:
  - `operating_unit_id IS NULL` -> `CENTRAL`
  - `operating_unit_id IS NOT NULL` -> `OPERATING_UNIT`
- Update warehouse create/read/list UI and API to expose ownership clearly.
- Default inventory forms from the current working/user operating unit where available.
- Validate that selected warehouse is allowed for the current operating unit context.
- Keep central warehouses available only when policy/business rule allows them.

Files:
- inventory warehouse migration(s)
- `backend/src/routes/inventory.validators.js`
- `backend/src/services/inventory.service.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- docs/runbooks/release gates

Acceptance:
- Warehouses can be modeled as central or branch-owned explicitly.
- Movement creation rejects warehouses outside the allowed OU context.
- Inventory UI defaults warehouse and filters from the working operating unit when possible.
- Warehouse ownership semantics are visible to operators and support users.

Notes:
- This should mirror the repo’s existing `ownership_scope` pattern from cash registers where practical.

## PR-IV17
Goal:
- Introduce an explicit, auditable cross-operating-unit stock transfer workflow.

Deliverables:
- Add dedicated stock-transfer model and lifecycle, for example:
  - transfer out from source OU warehouse
  - in-transit / pending receive
  - receive into target OU warehouse
  - reverse/cancel controls
- Require transfer flow for cross-OU stock moves:
  - generic issue/receipt must not be used to fake inter-branch stock transfer
- Define accounting/quantity ownership clearly:
  - whether transfer is quantity-only inside one legal entity
  - whether any inter-OU clearing or operational reference is needed
  - how OU balancing entries reuse the existing internal-current-account model instead of inventing a new inventory-only pattern
- Add UI for:
  - create transfer
  - receive transfer
  - view status/history
- Add regression coverage for:
  - same-OU materialization still works
  - cross-OU direct warehouse selection is blocked
  - transfer out/in sequence completes correctly

Files:
- inventory migrations/routes/services
- transfer UI page(s) or extension to existing inventory page
- docs/runbooks/specs/release gates

Acceptance:
- Cross-OU stock movement requires explicit transfer workflow.
- Operators cannot bypass branch control by selecting a foreign warehouse on a generic movement form.
- Transfer lifecycle is additive, traceable, and replay-safe.

Notes:
- This is the warehouse-side equivalent of the repo’s explicit cross-OU cash transit discipline.
- The preferred accounting model is:
  - no `COGS` on transfer
  - cost layer follows the stock
  - if GL balancing is required for cross-OU control, use the same OU due-from/due-to structure already established elsewhere in the repo

## PR-IV18
Goal:
- Define the next inventory-control expansion boundary after OU-aware warehouses and transfer discipline are in place.

Deliverables:
- Document and, where needed, scaffold the next-stage control areas:
  - lot / serial / bin / reservation direction
  - transfer-related warehouse governance extensions
  - costing-method roadmap beyond first-method FIFO
  - whether landed cost, weighted average, or standard cost should exist in future phases
- Decide what is:
  - near-term foundation work
  - deferred design only
  - explicitly rejected for this product stage
- Add release-gate or architecture doc checks so the chosen boundary stays visible to future work.

Files:
- `docs/`
- `PR-STEPS/`
- gate scripts or ADR/spec checks if needed

Acceptance:
- Future inventory expansion no longer starts from ambiguity.
- OU-aware warehouse/transfer design is recognized as the prerequisite control layer.
- Later lot/serial/bin/costing work has a documented starting point instead of ad hoc feature drift.

Notes:
- This PR can be mostly design/docs/gates if that is the right level for the current roadmap.
