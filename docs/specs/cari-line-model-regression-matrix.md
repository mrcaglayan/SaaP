# Cari Line-Model Rollout Regression Matrix

## Purpose

This matrix is the rollout reference for the commercial line model, line-tax posting, item-card defaults, and inventory handshake added after the original Cari v1 freeze.

It exists to prove two things together:

- legacy one-line/compatibility flows still work
- newer mixed-line and stock-aware flows are covered intentionally

## Required regression scenarios

### 1. Synthetic one-line compatibility

- Input shape: header-only draft create without explicit `lines[]`
- Expected:
  - backend synthesizes one commercial line
  - draft/read payload still exposes deterministic line data
  - post still succeeds
  - journal remains balanced

### 2. Mixed-tax invoice

- Input shape: explicit multi-line invoice
- Minimum case:
  - one line with `8%`
  - one line with `18%`
- Expected:
  - line tax amounts persist on `cari_document_line_taxes`
  - header subtotal/tax/gross = aggregate of lines
  - posted journal has one gross control line plus separate tax detail

### 3. Item-card defaults

- Input shape: explicit line with `itemCardId`, but without manual posting-account override
- Expected:
  - posting account defaults from item card
  - tax category defaults when configured
  - stock impact defaults when item type is `STOCK_ITEM`

### 4. Stock-item AP/AR handshake

- Input shape:
  - AP invoice with `STOCK_ITEM`
  - AR invoice with `STOCK_ITEM`
- Expected:
  - stock-affecting lines require warehouse binding before post
  - AP line can post to inventory asset account
  - AR line can post revenue normally
  - source lines persist pending stock intent (`RECEIPT_PENDING` / `ISSUE_PENDING`)

### 5. Inventory materialization

- Input shape: pending stock links from posted CARI documents
- Expected:
  - warehouse movement can be created from pending link
  - strict materialization uses the already-bound warehouse instead of a caller-selected queue warehouse
  - receipt movement becomes `VALUED`
  - issue movement becomes `VALUED`
  - inbound receipt creates a cost layer
  - outbound issue consumes receipt cost layer rows deterministically
  - outbound issue posts one `Dr COGS / Cr Inventory` journal
  - replay of the same issue materialization reuses the existing movement and journal
  - source stock link flips to `LINKED`

### 6. Line-tax UX and RBAC split

- Input shape:
  - draft that already stores line-level taxes
  - user/session with item-card or inventory permissions only
- Expected:
  - CARI post panel disables split posting for the stored-tax draft before submit
  - item-card routes/pages use `item.card.read` / `item.card.upsert`
  - inventory routes/pages use `inventory.read` plus the granular inventory execution/setup permissions
  - inventory and item-card access no longer depends on `cari.card.*`

### 7. Valued issue reversal

- Input shape: one already-valued outbound issue with FIFO layer-consumption rows and posted `COGS` journal
- Expected:
  - reverse action succeeds exactly once
  - consumed receipt-layer quantities are restored
  - original issue stays visible as additive history
  - one reverse journal is linked back to the issue
  - replay of the same reverse action reuses the existing reverse linkage instead of double-restoring stock

### 8. Mixed-currency FIFO issue valuation

- Input shape:
  - same item/warehouse has at least two open receipt layers from different currencies
  - one outbound issue consumes across those layers
- Expected:
  - issue valuation does not fail just because source layer currencies differ
  - FIFO consumption remains deterministic
  - issue accounting total is posted in legal-entity base currency
  - consumed-layer detail still shows the original source currencies

### 9. CARI reverse blocked by active linked issue

- Input shape:
  - one posted CARI document whose linked stock line has already materialized into one live valued `ISSUE`
- Expected:
  - document reverse fails predictably before any partial reverse rows are created
  - reverse response includes the blocking inventory movement id and issue context
  - UI explains that the valued issue must be reversed first in inventory

### 10. Successor rematerialization after issue reverse

- Input shape:
  - one valued outbound issue is reversed, then the same commercial line is materialized again
- Expected:
  - issue reverse creates exactly one reopened successor pending stock link
  - successor rematerialization uses the reopened link instead of mutating the original historical link
  - replay of successor materialization reuses the new movement and journal

### 11. CARI reverse blocked by active linked receipt

- Input shape:
  - one posted AP stock document whose linked stock line has already materialized into one live valued `RECEIPT`
- Expected:
  - document reverse fails predictably until the receipt-side inventory effect is unwound
  - reverse response includes the blocking inventory movement id and receipt context
  - UI explains that receipt undo must be completed first

### 12. Receipt undo chronology and blocker clear

- Input shape:
  - one materialized receipt that was partially consumed by a later issue
  - later, issue chronology is cleaned up and receipt undo is retried
- Expected:
  - receipt undo fails while later issue consumption is still active
  - receipt undo succeeds once dependent issue chronology is no longer active
  - CARI reverse blocker clears only after the linked receipt effect is no longer active

## Rollout notes for legacy documents

- Do not backfill old posted history destructively just to force multi-line shape.
- One-line compatibility is valid rollout behavior.
- Reports and open-item behavior remain anchored on document/open-item history, not on a mandatory commercial-line backfill campaign.

## Commands

- Dedicated regression:
  - `cd backend && npm run test:cari:line-model-rollout`
- Inventory release gate:
  - `cd backend && npm run test:inventory:release-gate`
- Docs/openapi quality gate:
  - `cd backend && npm run test:cari-pr10`
- Broader Cari gate:
  - `cd backend && npm run test:cari-quality-gate`
