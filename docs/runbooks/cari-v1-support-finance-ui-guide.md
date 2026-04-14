# Cari v1 Support/Finance UI Guide

## Scope

This guide is for support and finance users operating the Cari UI modules:

- `/app/cari-belgeler`
- `/app/cari-settlements`
- `/app/cari-audit`

## Document Lifecycle

- Draft stage (`DRAFT`):
  - Create, edit, cancel actions are available only in draft.
- Posting:
  - Post action is allowed only for draft documents.
  - After post, journal linkage fields become the main accounting reference.
- Reversal:
  - Reverse is allowed only under backend reversal guards for posted lifecycle states.
  - Reversal keeps additive history; original rows remain traceable.

## Line Workbench and Item Cards

- `/app/cari-belgeler` now supports explicit commercial lines.
- Finance operators can:
  - add/remove/reorder lines
  - enter quantity + unit price
  - review line net/tax/gross preview
  - optionally select an item card per line
- Item-card selection may prefill:
  - posting account
  - tax category
  - stock impact mode
- Important operator rule:
  - if invoice content differs by tax treatment or stock behavior, use explicit lines instead of collapsing everything into one document amount

## Legacy Documents Without Stored Lines

- Some older or compatibility-path documents behave like one-line documents.
- That is expected when the source caller used header-only input and backend synthesized the commercial line.
- Support handling:
  - validate totals and journal/open-item linkage first
  - do not treat absence of rich multi-line detail as an automatic defect
  - use newer mixed-line entry only for forward operations, not for destructive historical cleanup

## Stock Link Materialization (`/app/stok-yansitma-islemleri`)

- Choose the warehouse on each stock-affecting CARI line before posting the document.
- `STOCK_ITEM` lines create pending stock intent after CARI post:
  - AP purchase -> `RECEIPT_PENDING`
  - AR sale -> `ISSUE_PENDING`
- Inventory operators then use `/app/stok-yansitma-islemleri` to:
  - materialize the pending stock link against the already-bound warehouse
  - review resulting movement/cost-layer status
- Queue Scope:
  - keep `ACTIONABLE` as the default execution view
  - use `COMPLETED` or `VOID` only as explicit history views
- Expected outcomes:
  - receipt movement -> `VALUED`
  - issue movement -> `VALUED`
  - inbound receipt creates a receipt cost layer
  - valued issue may post one COGS journal on the inventory side
- If the pending link list is empty, first recheck:
  - item card type
  - posted document status
  - legal entity filter

## Inventory Permissions

- Access issues on stock reflection screens should be checked against:
  - `inventory.read`
  - the blocked action's granular inventory permission such as `inventory.materialize`, `inventory.movement.reverse`, `inventory.warehouse.upsert`, or the `inventory.transfer.*` family
- Item-card access is separate:
  - `item.card.read`
  - `item.card.upsert`

## Reverse valued issue

- A valued outbound issue can be reversed from inventory flow.
- Reversal restores the consumed FIFO layer quantities and posts the inventory-side reverse journal when the original issue had a posted COGS journal.
- Practical support rule:
  - reverse the latest relevant valued issue first
  - if later valued issues already exist for the same warehouse/item, reversal may be blocked until chronology is cleaned up
- If a user reports that a reversed issue still "exists", that is expected:
  - history remains additive
  - the original movement stays visible
  - reverse evidence is shown through reversal timestamps and reverse-journal linkage

## CARI Reverse Blocked By Inventory

- If `/app/cari-belgeler` shows `Reverse is blocked by linked inventory effects`, treat that as a hard preflight block, not a retryable generic error.
- The reverse dialog now exposes direct inventory movement links. Open the linked row in `/app/stok-yansitma-islemleri` and unwind there first.
- Required operator order:
  1. reverse linked valued `ISSUE` movement first
  2. if stock still needs to leave after correction, rematerialize the reopened successor pending stock link
  3. undo linked materialized `RECEIPT` only when it is fully available
  4. retry the CARI reverse after the blocking inventory movement is no longer active
- Do not ask users to bypass the blocker by editing DB rows or hiding stock-link evidence.

## Reopened Successor Stock Link

- Reversing a valued issue reopens business intent additively:
  - original stock link stays historical
  - one reopened successor pending stock link is created for the same commercial line
- If the original bound warehouse still exists, is `ACTIVE`, and still belongs to the same ownership context, the reopened successor inherits that warehouse binding automatically.
- Materialize the successor link, not the original linked row.
- If the reopened successor shows `REPAIR_REQUIRED` with `SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID`:
  - do not try to continue from the normal queue as if it were a fresh strict row
  - do not ask users to pick another warehouse in the normal queue
  - treat the row as cleanup/reset follow-up in this rollout; do not route it into a normal operator workflow
- Replay rule:
  - re-running the same issue reverse should reuse the same reopened successor link
  - re-running successor materialization should reuse the new movement/journal instead of creating duplicates

## Transfer Required Queue State

- If `/app/stok-yansitma-islemleri` shows `TRANSFER_REQUIRED`, the bound warehouse is short and another ownership context still has stock.
- Do not ask users to pick a different warehouse from the normal queue.
- Open `/app/stok-transferleri` from the suggested transfer link, create the explicit cross-context transfer, then retry the original strict materialization.
- If `/app/cari-belgeler` blocks posting with transfer-required guidance, follow the same transfer-first path before retrying post.

## Undo Materialized Receipt

- Receipt undo is the inventory-side unwind for a materialized AP receipt effect.
- Use `/app/stok-yansitma-islemleri` and select `Undo Materialized Receipt`.
- Receipt undo is allowed only when no later valued issue chronology still depends on that receipt layer history.
- If the undo is blocked because the receipt was partially consumed:
  - reverse or otherwise resolve the dependent later issue chronology first
  - then retry the receipt undo
- Undo remains additive:
  - original receipt movement stays visible
  - explicit reversal/undo evidence is created
  - no duplicate inventory GL journal is invented just for the receipt undo

## Mixed-Currency FIFO Issue Valuation

- If one item/warehouse has receipt layers from different currencies, issue valuation is still FIFO.
- Accounting source of truth is base currency:
  - source receipt-layer currencies remain visible in layer-consumption detail
  - the issue total is posted in legal-entity base currency instead of pretending one fake common source currency

## Settlement Idempotency Behavior

- Apply action always requires `idempotencyKey`.
- Retry with the same key returns a deterministic result.
- Do not generate a new key for accidental double-click retries of the same intent.

## Payment Channel (`MANUAL` / `CASH`) and Linked Cash

- `paymentChannel=MANUAL`:
  - settlement runs without creating a cash transaction.
- `paymentChannel=CASH`:
  - either link an existing cash transaction (`cashTransactionId`)
  - or create one in-flow (`linkedCashTransaction` with register/account context)
- Direction coupling:
  - `AR` -> linked cash type `RECEIPT`
  - `AP` -> linked cash type `PAYOUT`
- Validation guardrails:
  - `linkedCashTransaction` is only valid with `paymentChannel=CASH`
  - `cashTransactionId` and `linkedCashTransaction` cannot be sent together
  - if creating linked cash, register/account requirements must be satisfied

## Replay Behavior (`idempotentReplay`)

- If response contains `idempotentReplay=true`, treat it as informational success.
- Operator message meaning:
  - request was already applied previously
  - current response mirrors existing result
- Do not re-open incident unless output is inconsistent with expected source data.

## Reverse Behavior (Document + Settlement)

- Document reverse:
  - reverses accounting effect with explicit linkage to reversal row/journal context.
  - now hard-blocks when a linked live inventory `ISSUE` or `RECEIPT` movement still exists.
- Settlement reverse:
  - called via `POST /api/v1/cari/settlements/{settlementBatchId}/reverse`.
  - re-opens affected balances according to effective-date/as-of rules.
  - if a linked cash transaction is still `POSTED`, reverse is blocked until that cash transaction is reversed.
- Always validate statement/open-items as-of dates before and after reverse date.

## Bank Attach/Apply Meaning

- Bank attach and bank apply are explicit workflows.
- They are not auto-triggered by settlement apply.
- Target rules:
  - `targetType=SETTLEMENT`: requires `settlementBatchId`, no `unappliedCashId`.
  - `targetType=UNAPPLIED_CASH`: requires `unappliedCashId`, no `settlementBatchId`.
- Both flows must send idempotency keys.

## FX Override Use-Case and Permissions

- FX override is a controlled exception path, not the default flow.
- Permission requirement: `cari.fx.override`.
- Override submissions must include explicit justification fields where required by UI/backend contract.
- Without permission, users must use standard rate behavior and should see clear inline guidance.
- Fallback modes:
  - `EXACT_ONLY`: only same-day SPOT rate is accepted
  - `PRIOR_DATE`: nearest prior SPOT can be used (optionally bounded by `fxFallbackMaxDays`)
- If no valid rate is found and no override `fxRate` is provided, apply fails with explicit error.

## Quick Triage Checklist

1. Confirm route-level access permission exists.
2. Confirm action-level permission for the specific button/panel exists.
3. Re-run with same idempotency key for replay-safe inspection.
4. Inspect `requestId` in audit records (`/app/cari-audit`).
5. Recheck report outputs with explicit `asOfDate` around reverse/apply dates.
6. For CASH channel incidents, verify linked cash transaction status and register/session context.
7. Check `followUpRisks` messages; treat them as operational follow-up items, not hard failures.
8. For FX incidents, verify effective fallback mode (`EXACT_ONLY` vs `PRIOR_DATE`) and prior-rate availability.
