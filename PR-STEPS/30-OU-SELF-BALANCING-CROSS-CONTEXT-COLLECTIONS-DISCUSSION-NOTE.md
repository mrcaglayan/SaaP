# 30 - OU SELF-BALANCING AND CROSS-CONTEXT COLLECTIONS DISCUSSION NOTE

## Status
- Reminder / discussion note only.
- This is not an execution tracker yet.
- No implementation order or PR breakdown is locked in this file.

## Why this note exists
- The repo already has a clear operating-unit self-balancing pattern in some areas:
  - cross-OU cash transfers
  - central <-> OU cash movement
  - OU-targeted capital fulfillment
- But the same pattern is not yet consistently applied across all CARI and inventory-adjacent flows.
- The specific concern is cross-context business events such as:
  - center collects money for an `OU_A` customer/invoice
  - central bank/cash receives a payment that economically belongs to an operating unit
  - future OU-aware inventory transfers may need balancing entries, not only quantity movement

## Current implementation summary

### What already exists
- Cash has explicit internal-current-account balancing patterns:
  - `Central Due From OU`
  - `OU Due To Central`
  - `Due From Partner OU`
  - `Due To Partner OU`
- The repo already has supporting schema and setup for branch-pair current accounts.
- Capital fulfillment also uses OU internal balancing lines explicitly.

### What does not yet exist as a general rule
- CARI document posting is usually single-OU attributed, not a generic OU self-balancing engine.
- CARI settlement posting uses one `operatingUnitId` context for the settlement journal; it does not automatically add due-from/due-to balancing lines when commercial ownership and collection ownership diverge.
- Inventory is not yet OU-owned at warehouse level, so inventory transfer accounting has not yet been aligned to the repo's OU internal balancing pattern.

## Core issue to discuss later

### Example
1. `OU_A` sells to a customer.
2. The invoice / receivable economically belongs to `OU_A`.
3. Later, center collects the payment through a central bank account or central cash register.

### Why this matters
- Legal entity accounting can still balance.
- But OU-level reporting may stop balancing correctly if:
  - receivable relief is posted in central context
  - while the original sale/revenue belonged to `OU_A`
- In a strict OU-balanced model, this kind of cross-context collection should normally create explicit internal balancing between center and the OU.

## What is not yet decided
- Whether all cross-context CARI settlements must become OU self-balancing.
- Whether only selected high-risk flows should use internal balancing.
- Whether central bank collections and central cash collections should behave the same way.
- Whether the balancing should happen:
  - at settlement journal time
  - through a separate internal clearing layer
  - or through a later reconciliation/reclassification workflow
- Whether future OU-aware inventory transfers should use:
  - quantity-only subledger movement
  - transit-only operational flow
  - or explicit GL balancing with the same OU current-account model

## Criteria to lock before implementation
- What exactly counts as a cross-context event:
  - central collecting for OU
  - one OU collecting for another OU
  - central warehouse transferring to OU warehouse
  - OU warehouse transferring to central warehouse
  - OU warehouse transferring to another OU warehouse
- Which modules must follow one common balancing rule:
  - CARI settlement
  - bank-linked collections
  - cash-linked collections
  - inventory transfer
- Whether OU balancing is required only when OU is financially meaningful, or always when `operating_unit_id` is present.
- Which accounts must be reused from the existing repo model:
  - `Central Due From OU`
  - `OU Due To Central`
  - partner-specific `Due From Partner OU`
  - partner-specific `Due To Partner OU`
- Whether any new inventory-specific balancing accounts are allowed, or whether reuse of the existing OU current-account structure is mandatory.
- How reversals should behave if cross-context balancing is introduced.

## Preferred direction so far
- Reuse the repo's existing OU internal-current-account model instead of inventing a second balancing pattern for inventory or CARI settlement.
- Treat cross-context transfer/collection balancing as:
  - internal relocation / internal claim-settlement accounting
  - not revenue
  - not expense
  - not `COGS`
- Keep additive evidence and explicit workflow instead of hidden auto-netting.

## Important distinction
- `operatingUnitId` attribution on a journal line is not the same thing as OU self-balancing.
- Attribution means:
  - "this line belongs to OU_X"
- Self-balancing means:
  - the system adds the extra internal lines needed so each OU slice can stand on its own in reporting when the business event crosses contexts

## Not in scope for this note
- No real PR steps yet.
- No schema changes yet.
- No implementation commitments yet.
- No decision yet on whether this becomes one tracker or multiple trackers later.

## Expected next move later
- Revisit this note before or during the later OU-aware warehouse / transfer work.
- Lock business criteria first.
- Only then convert the note into a real execution tracker with concrete PR slices.
