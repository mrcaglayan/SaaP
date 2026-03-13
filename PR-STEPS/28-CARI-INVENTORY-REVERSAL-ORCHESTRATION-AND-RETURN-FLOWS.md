# 28 - CARI/INVENTORY REVERSAL ORCHESTRATION AND RETURN FLOWS

## Execution tracking
- This file is both the source/spec file and the execution tracker.
- Keep execution status in the `Master tracker` section below.

## Why this follow-up exists
- `25-CARI-LINES-ITEM-CARDS-INVENTORY-HANDSHAKE.md` delivered the commercial line model, item cards, and stock-link handshake.
- `26-INVENTORY-VALUATION-RBAC-POSTING-HARDENING.md` delivered FIFO issue valuation, `COGS` posting, dedicated RBAC, and release hardening.
- `27-INVENTORY-REVERSAL-SUPPORT-GUIDE-BASE-CURRENCY-VALUATION.md` delivered valued issue reversal, support-guide parity, and mixed-currency base valuation.
- Three lifecycle gaps still remain:
  - posted CARI reversal can still ignore already materialized inventory effects
  - reversing a valued issue does not yet create a clean rematerialization path for the same commercial line
  - receipt materialization still has no first-class additive undo / return flow

## Current implementation facts that matter
- `backend/src/services/cari.document.service.js` only voids `PENDING` stock links during document reversal.
- `backend/src/services/inventory.service.js` can reverse valued `ISSUE` movements, but not `RECEIPT` movements.
- `backend/src/services/inventory.service.js` treats `LINKED` stock links as idempotent reuse of the existing movement.
- `cari_document_line_stock_links` currently tracks one live linkage, but not a successor/reopened stock-intent chain.
- AP stock receipt accounting still originates in CARI posting; receipt materialization itself does not create a second inventory GL journal.

## Locked decisions
- Safe v1 rule: posted CARI reversal must not silently auto-unwind already materialized inventory. If linked inventory effects are still active, CARI reversal should block with a clear operator message.
- Inventory undo remains additive, not destructive:
  - keep original movement
  - keep original stock-link evidence
  - create explicit reversal/return evidence instead of deleting history
- Reversing an `ISSUE` must reopen business intent without mutating the original linked row into a new meaning. Use successor/reopened stock intent, not destructive reuse of the original link.
- Receipt undo must respect chronology. A receipt cannot be unwound while later valued issues still depend on its remaining layer history.
- Inventory subledger and CARI/GL subledger stay separated:
  - inventory issue reverse may create inventory-side journal evidence where already designed
  - receipt undo should not invent duplicate inventory GL posting if CARI already owns that accounting effect
- Full cross-module one-click reverse orchestration is not the first move. The first move is explicit guardrails plus complete subledger undo paths. A wrapper/orchestrator can come after that.

## Scope
- Make posted CARI reversal inventory-aware and safe.
- Add rematerializable successor stock-intent behavior after issue reversal.
- Add additive receipt undo / purchase-return inventory unwind.
- Harden UI, docs, and regression coverage around the required unwind order.

## Non-goals
- No sales return order or procurement return order workflow redesign.
- No lot, serial, bin, batch, reservation, or transfer engine.
- No destructive rewrite of existing stock-link or movement history.
- No automatic inventory GL remeasurement or costing-method redesign.
- No full warehouse task management model.

## Unified execution order
1. `PR-IV09` - Inventory-aware CARI reversal preflight and hard block
2. `PR-IV10` - Issue reversal rematerialization and stock-intent successor chain
3. `PR-IV11` - Receipt undo / purchase-return inventory unwind
4. `PR-IV12` - Lifecycle docs, release-gate coverage, and guided orchestration UX

## Master tracker
- [x] `PR-IV09` acceptance: posted CARI reversal no longer leaves linked live inventory effects behind silently.
- [x] `PR-IV10` acceptance: reversing a valued issue creates one rematerializable successor stock intent without destroying original linkage history.
- [x] `PR-IV11` acceptance: receipt materialization can be unwound additively with chronology checks and without inventing duplicate GL behavior.
- [x] `PR-IV12` acceptance: operators, docs, and release gates all understand and protect the required unwind order across CARI and inventory.

## PR-IV09
Goal:
- Make posted CARI reversal inventory-aware before any automatic orchestration is attempted.

Deliverables:
- Add reversal preflight on posted CARI documents:
  - detect linked stock rows for the document
  - detect whether any linked inventory movement is still active and not already unwound
- Block document reversal when linked inventory movement still exists in a live business state.
- Return actionable blocking detail, at minimum:
  - stock-link id
  - inventory movement id
  - movement type
  - warehouse / item context if available
- Keep current pending-link void behavior only for stock links that were never materialized.
- Surface inventory-impact status in CARI document detail/read model so UI can explain why reverse is blocked.
- Add clear frontend/operator messaging:
  - "reverse inventory issue first"
  - "undo receipt materialization first"
  - or equivalent business wording

Files:
- `backend/src/services/cari.document.service.js`
- `backend/src/routes/cari.*`
- `backend/openapi.yaml` or generator inputs
- CARI document detail/read frontend
- regression/release scripts

Acceptance:
- Reversing a posted CARI document with one linked live `ISSUE` movement fails predictably and does not create partial reverse side effects.
- Reversing a posted CARI document with one linked live `RECEIPT` movement fails predictably and does not create partial reverse side effects.
- Reversing a posted CARI document with only `PENDING` stock links still voids those pending links.
- UI can identify which inventory step is blocking reverse.

Notes:
- This PR deliberately chooses "block first" over hidden auto-cascade.
- That is safer until receipt undo and successor stock-intent behavior are both first-class.

## PR-IV10
Goal:
- After valued issue reversal, restore the commercial line's stock intent in a way that can be materialized again without corrupting audit history.

Deliverables:
- Design and implement successor stock-intent lifecycle for reversed issues.
- Recommended model:
  - keep original stock link as historical `LINKED`
  - create one successor stock-link row in `PENDING`
  - successor references original document line and quantity
  - successor can carry lineage such as `reopened_from_stock_link_id` or equivalent
- Ensure one issue reverse creates at most one successor pending stock intent.
- Ensure replaying the same issue reverse does not create duplicate reopened stock intents.
- Make inventory materialization read the active successor intent rather than forcing reuse of the old linked movement.
- Update UI to show:
  - original link / movement
  - reversed movement evidence
  - successor pending intent ready for rematerialization

Files:
- `backend/src/services/inventory.service.js`
- inventory migrations for successor-link lineage if needed
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- CARI detail/read model if linkage chain is exposed there
- regression scripts

Acceptance:
- Reversing one valued issue creates one new pending stock intent for the same commercial line.
- Materializing again uses the successor stock link, not the old linked row.
- Original link and original issue movement stay queryable as historical evidence.
- Replay/idempotency remains deterministic.

Notes:
- Do not null out the original link's `inventory_movement_id`.
- Reopened intent is a new business step, not a rewrite of the old one.

## PR-IV11
Goal:
- Add a first-class additive undo path for stock receipt materialization and purchase-return-style unwind.

Deliverables:
- Extend inventory reverse/undo support for `RECEIPT` lifecycle.
- Define allowed cases clearly:
  - movement type is `RECEIPT`
  - movement is materialized/valued
  - movement is not already reversed
  - remaining layer balance is sufficient to unwind the receipt
  - no later dependent issue chronology is violated
- Add one supported undo shape, for example:
  - receipt reverse endpoint
  - or generic movement reverse expanded with receipt rules
- Persist additive undo evidence:
  - reversal/return movement record or equivalent explicit trace
  - restored/closed layer state
  - linkage back to original receipt movement
- Keep accounting semantics clean:
  - inventory receipt materialization undo should not create duplicate GL where CARI already owns the AP/inventory accounting
  - if a separate stock-only adjustment journal is ever needed, it must be explicitly designed, not implied
- Integrate with `PR-IV09` blocker so CARI reverse becomes possible only after receipt-side unwind is completed.

Files:
- `backend/src/services/inventory.service.js`
- inventory migrations if receipt-reversal lineage needs new metadata
- inventory routes/validators
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- regression scripts

Acceptance:
- A fully unconsumed materialized receipt can be unwound safely and additively.
- A partially consumed receipt cannot be unwound until dependent issue chronology is resolved.
- Receipt undo evidence is traceable and idempotent.
- CARI reverse blocker clears only when the linked receipt effect is no longer active.

Notes:
- This is the minimum inventory-side prerequisite for safe AP reversal / purchase-return behavior.

## PR-IV12
Goal:
- Make the full unwind order understandable, testable, and supportable across modules.

Deliverables:
- Update docs and runbooks so support/finance users can follow the correct order:
  - receipt/issue materialization
  - issue reversal
  - successor rematerialization
  - receipt undo
  - CARI reverse preflight and final reverse
- Extend release gates and regression matrix for:
  - CARI reverse blocked by active linked issue
  - CARI reverse blocked by active linked receipt
  - issue reverse creates successor pending stock intent
  - rematerialization after issue reverse
  - receipt undo chronology checks
- Add guided orchestration UX where useful:
  - reverse dialog warning
  - impact summary panel
  - links to blocking inventory movement ids
- Optional if stable enough:
  - add a non-destructive "reverse readiness" or "impact preview" endpoint before full auto-orchestration is considered

Files:
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- `docs/runbooks/inventory-item-card-rollout.md`
- `docs/specs/cari-line-model-regression-matrix.md`
- backend gate scripts
- frontend warning/summary components

Acceptance:
- Docs no longer leave ambiguity about which module must be unwound first.
- Release gate fails if lifecycle docs or regression scenarios drift away from runtime.
- Operators can see why reverse is blocked and what exact next action is required.

Notes:
- Keep this PR focused on operator clarity and contract safety.
- Full one-click cross-module reverse can be planned later if these primitives prove stable.
