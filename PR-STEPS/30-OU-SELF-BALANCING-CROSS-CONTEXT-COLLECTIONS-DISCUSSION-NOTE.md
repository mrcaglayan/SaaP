# 30 - OU SELF-BALANCING AND CROSS-CONTEXT COLLECTIONS DISCUSSION NOTE

## Status
- Reminder / discussion note only.
- This is not an execution tracker yet.
- No implementation order or PR breakdown is locked in this file.
- The purpose of this note is to lock business criteria and accounting direction before a future real tracker exists.

## Why this note exists
- The repo already has a clear operating-unit self-balancing pattern in some areas:
  - cross-OU cash transfers
  - central `<->` OU cash movement
  - OU-targeted capital fulfillment
- But the same pattern is not yet consistently applied across all CARI and inventory-adjacent flows.
- The specific concern is cross-context business events such as:
  - center collects money for an `OU_A` customer/invoice
  - central bank/cash receives a payment that economically belongs to an operating unit
  - one OU collects for another OU
  - future OU-aware inventory transfers may need balancing entries, not only quantity movement

## Working design direction
- Reuse one OU internal-current-account model instead of inventing separate balancing patterns per module.
- Keep explicit evidence of movement and collection events.
- Self-balance only when the event crosses financially meaningful contexts.
- Preserve additive evidence instead of hidden auto-netting.

## Locked discussion decisions so far
- OU self-balancing is required for cross-context, financially meaningful events, not for every ordinary OU-tagged posting.
- Bank and cash use the same immediate self-balancing rule in cross-context collection cases:
  - only the collector asset changes: `Bank` or `Cash`
  - no special delayed cash-clearing stage is assumed by default in this note
- Cross-context collection uses explicit separate GL accounts per OU pair, not a shared dimensional internal-current account model.
- Non-self-balanced cross-context collection should be hard-blocked:
  - if collector context and owner context differ, the system must use explicit due-from / due-to balancing
  - no operator override is assumed in the preferred direction
- Reversal order should be strict:
  - reverse downstream internal settlement first
  - then reverse cross-context collection
  - then reverse upstream source event if applicable
- Cross-context collection should eventually become its own first-class business document family, not remain only a settlement/cash variant forever.

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

## Important distinction
- `operatingUnitId` attribution on a journal line is not the same thing as OU self-balancing.
- Attribution means:
  - "this line belongs to `OU_X`"
- Self-balancing means:
  - the system adds the extra internal lines needed so each OU slice can stand on its own in reporting when the business event crosses contexts
- Practical implication:
  - ordinary single-OU CARI posting can still be fine without extra due-from/due-to lines
  - cross-context collection or transfer is where explicit balancing becomes necessary

## Policy assumptions for the examples below

### Rule A - inventory moves use transfer workflow
- For inventory crossing center / branch / OU boundaries, use:
  - transfer request
  - approval
  - shipment
  - in-transit
  - receipt
  - variance / reversal if needed
- Do not treat this as a silent quantity update.

### Rule B - cross-context collections self-balance immediately
- If one context collects cash for another context's receivable:
  - collector gets the cash/bank
  - owner OU gets the AR relief
  - system inserts due-from / due-to lines between them

### Rule C - internal balances are not auto-netted invisibly
- Reports may show a net position later, but source events stay explicit:
  - stock transfer created one internal claim
  - cross-context collection created another
  - optional internal settlement clears them later
- Audit evidence should remain additive and traceable.

## Example account families

### Balance sheet / P&L
- `Inventory - Center`
- `Inventory - Branch A`
- `Inventory - Branch B`
- `Inventory In Transit - To Branch A`
- `Inventory In Transit - To Branch B`
- `A/R - Branch A Customer`
- `A/R - Branch B Customer`
- `A/P - Vendor`
- `Bank - Center`
- `Bank - Branch A`
- `Bank - Branch B`
- `Sales - Branch A`
- `Sales - Branch B`
- `COGS - Branch A`
- `COGS - Branch B`

### Internal current accounts
- `Central Due From Branch A`
- `Central Due To Branch A`
- `Branch A Due To Center`
- `Branch A Due From Center`
- `Central Due From Branch B`
- `Central Due To Branch B`
- `Branch B Due To Center`
- `Branch B Due From Center`
- `Branch A Due From Branch B`
- `Branch B Due To Branch A`
- `Branch B Due From Branch A`
- `Branch A Due To Branch B`

### Implementation note
- These can be modeled as:
  - distinct GL accounts
  - or one internal-current account plus partner-OU dimension/subaccount
- Economically, both patterns should produce the same result.

## Worked cases

## Case 1 - Center buys stock, ships to Branch A, Branch A sells, Center collects
- This is the best baseline example because it shows both:
  - inventory crossing contexts
  - receivable collection crossing contexts

### Step 1 - Center buys stock from vendor
Business story:
- Center purchases `100` units at `10` each.
- Total cost = `1,000`.

Operational records:
- Purchase Order `PO-001`
- Goods Receipt `GRN-001`
- Vendor Invoice `PINV-001`

Journal:
```text
Dr Inventory - Center                        1,000
Cr A/P - Vendor                              1,000
```

State after step:
- Center physically holds stock.
- Center economically owns stock.

### Step 2 - Center ships 60 units to Branch A
- `60 x 10 = 600`
- Ownership is intended to move to Branch A, but with shipment and receipt evidence rather than silent instant movement.

Operational records:
- Transfer Request `TR-001`
- Transfer Order `TO-001`
- Pick List `PICK-001`
- Dispatch / Shipment Note `SHIP-001`
- Courier / vehicle / bag reference
- Status = `IN_TRANSIT`

Proposed accounting at shipment:

Center slice:
```text
Dr Central Due From Branch A                  600
Cr Inventory - Center                         600
```

Branch A slice:
```text
Dr Inventory In Transit - To Branch A         600
Cr Branch A Due To Center                     600
```

Why this works:
- Center gives up stock custody/value.
- Branch A gets a claim to receive the stock.
- The internal pair proves that Branch A received economic value from Center.

### Step 3 - Branch A receives the goods
Operational records:
- Transfer Receipt `RCV-001`
- Count confirmation
- Variance check
- Status = `RECEIVED`

Journal:
```text
Dr Inventory - Branch A                       600
Cr Inventory In Transit - To Branch A         600
```

State after step:
- Stock is physically at Branch A.
- Branch A still owes Center internally for `600`.
- Standing internal pair:
  - Center: `Central Due From Branch A = 600`
  - Branch A: `Branch A Due To Center = 600`

### Step 4 - Branch A sells 40 units on credit
- Sale price: `40 x 20 = 800`
- Cost: `40 x 10 = 400`

Operational records:
- Sales Order `SO-001`
- Delivery Note `DN-001`
- Sales Invoice `SI-001`

Revenue journal:
```text
Dr A/R - Branch A Customer                    800
Cr Sales - Branch A                           800
```

Cost journal:
```text
Dr COGS - Branch A                            400
Cr Inventory - Branch A                       400
```

State after step:
- Branch A has revenue `800`.
- Branch A has `COGS 400`.
- Branch A gross margin = `400`.

### Step 5 - Customer pays, but Center receives the money
- Amount collected = `800`.
- This is the cross-context collection problem the future design must solve cleanly.

Operational records:
- Collection Receipt `COL-001`
- Bank Deposit / Receipt `DEP-001`
- Optional statement match later
- Important fields:
  - `owner_ou_id = Branch A`
  - `collector_context = Center`
  - `settled_document = SI-001`

Journal at collection:

Center slice:
```text
Dr Bank - Center                              800
Cr Central Due To Branch A                    800
```

Branch A slice:
```text
Dr Branch A Due From Center                   800
Cr A/R - Branch A Customer                    800
```

Why this is the clean answer:
- Bank belongs to the collector: Center.
- AR belongs to the seller: Branch A.
- The internal pair links the collector and the receivable owner explicitly.

### Step 6 - Internal position after transfer + sale + collection
From stock transfer:
- Center has `Due From Branch A = 600`
- Branch A has `Due To Center = 600`

From collection:
- Center has `Central Due To Branch A = 800`
- Branch A has `Branch A Due From Center = 800`

Net by pair:
- Center net owes Branch A `200`
- Branch A net is due from Center `200`

Economic meaning:
- Center originally funded `600` of stock cost.
- Branch A created customer value and profit.
- Center collected `800` cash that economically belongs to Branch A.
- Net, Center is holding `200` that belongs to Branch A.
- That `200` effectively reflects Branch A gross margin cash position from the events completed so far.

### Step 7 - Optional internal settlement
- If Center later remits the net `200` to Branch A bank, do it as explicit internal settlement rather than invisible auto-netting.

Operational records:
- Internal Settlement `IS-001`
- Approval
- Bank transfer evidence

Journal:

Center:
```text
Dr Central Due To Branch A                    200
Cr Bank - Center                              200
```

Branch A:
```text
Dr Bank - Branch A                            200
Cr Branch A Due From Center                   200
```

Note:
- A formal internal netting document can also clear gross balances while keeping source-event evidence intact.

## Case 2 - Branch A buys stock, ships to Branch B, Branch B sells, Branch B collects
- This is the normal branch-to-branch model without collection crossing to another context.

### Step 1 - Branch A buys stock
- `50 x 12 = 600`

Operational records:
- `PO-A-001`
- `GRN-A-001`
- `PINV-A-001`

Journal:
```text
Dr Inventory - Branch A                       600
Cr A/P - Vendor                               600
```

### Step 2 - Branch A ships 30 units to Branch B
- `30 x 12 = 360`

Operational records:
- Transfer Request `TR-AB-001`
- Transfer Order `TO-AB-001`
- Shipment `SHIP-AB-001`
- Status = `IN_TRANSIT`

Journal at shipment:

Branch A:
```text
Dr Branch A Due From Branch B                 360
Cr Inventory - Branch A                       360
```

Branch B:
```text
Dr Inventory In Transit - To Branch B         360
Cr Branch B Due To Branch A                   360
```

### Step 3 - Branch B receives
Operational record:
- Transfer Receipt `RCV-AB-001`

Journal:
```text
Dr Inventory - Branch B                       360
Cr Inventory In Transit - To Branch B         360
```

### Step 4 - Branch B sells 20 units on credit
- Revenue: `20 x 25 = 500`
- Cost: `20 x 12 = 240`

Revenue:
```text
Dr A/R - Branch B Customer                    500
Cr Sales - Branch B                           500
```

Cost:
```text
Dr COGS - Branch B                            240
Cr Inventory - Branch B                       240
```

### Step 5 - Branch B collects the money itself
Operational records:
- Receipt `COL-B-001`
- Bank receipt / cash receipt

Journal:
```text
Dr Bank - Branch B                            500
Cr A/R - Branch B Customer                    500
```

Internal position now:
- Only the stock-transfer internal remains open:
  - Branch A: `Due From Branch B = 360`
  - Branch B: `Due To Branch A = 360`
- That means Branch B still owes Branch A the internal stock value.

## Case 3 - Branch A buys, ships to Branch B, Branch B sells, but Branch A collects
- This is the harder branch-to-branch stress test.

State before collection:
- From stock transfer:
  - Branch A due from Branch B = `360`
  - Branch B due to Branch A = `360`
- Open customer receivable:
  - Branch B AR = `500`

Customer payment is collected by Branch A:

Operational records:
- Receipt `COL-BY-A-001`
- `owner_ou_id = Branch B`
- `collector_ou_id = Branch A`
- linked invoice = Branch B invoice

Journal:

Branch A:
```text
Dr Bank - Branch A                            500
Cr Branch A Due To Branch B                   500
```

Branch B:
```text
Dr Branch B Due From Branch A                 500
Cr A/R - Branch B Customer                    500
```

Internal pair result after both events:

From stock transfer:
- Branch A: `Due From Branch B = 360`
- Branch B: `Due To Branch A = 360`

From collection:
- Branch A: `Branch A Due To Branch B = 500`
- Branch B: `Branch B Due From Branch A = 500`

Net:
- Branch A owes Branch B `140`
- Branch B is due from Branch A `140`

Economic meaning:
- Branch A originally funded `360` of stock to Branch B.
- Branch A later collected `500` of Branch B's customer money.
- Net, Branch A is holding `140` belonging to Branch B.
- That `140` reflects Branch B realized margin from the completed events.

## Case 4 - Center buys stock, sends to Branch A, but no OU balancing on collection
- This is the bad version and shows why the strict model is useful.

Facts:
- Center funded `600` stock to Branch A.
- Branch A sold for `800`.
- Center collected `800`.

If the system simply posts:
```text
Dr Bank - Center                              800
Cr A/R - Branch A Customer                    800
```

Or worse, posts both sides in Center context:
- Branch A receivable disappears.
- Branch A has no due-from-center claim.
- Center now holds cash that economically belongs to Branch A.
- Legal-entity totals may still balance, but OU slice reporting stops telling the truth.

## Record families that should exist besides journals

### A. Inventory transfer evidence
Header:
- transfer no
- source OU / warehouse
- destination OU / warehouse
- requested by
- approved by
- reason
- transport mode
- expected receipt date
- status

Lines:
- item
- quantity
- unit cost snapshot
- batch / serial / lot if relevant

Lifecycle records:
- request
- approval
- shipment
- in-transit acknowledgement
- receipt
- variance / shortage / excess
- cancellation / reversal

Why:
- Real-world ERP transfer-order flows preserve movement evidence and state, rather than collapsing everything into one inventory journal event.

### B. Cross-context collection evidence
- This should eventually become its own first-class concept, not only a generic cash receipt or settlement variant.

Header:
- receipt no
- collection method: cash / bank / POS / transfer
- collector context
- owner context
- source document type: invoice / open item / advance
- source document id
- amount
- currency
- receipt date
- evidence reference: deposit slip / bank ref / POS ref

Lifecycle:
- created
- approved
- deposited
- statement-matched
- reversed / bounced / adjusted

Why:
- The system must prove:
  - who collected
  - for whom
  - against which receivable
  - whether the cash is still being held or has already been settled internally

### C. Internal settlement evidence
- This clears current accounts created by transfers or collections.

Header:
- settlement no
- party A context
- party B context
- basis: stock transfer / collection / mixed / netting run
- approval
- settlement method: cash remittance / bank transfer / offset / journal-only reclass

Lines:
- source event ref
- amount
- debit internal account
- credit internal account

Why:
- If the product wants additive evidence instead of hidden auto-netting, this is the document family that carries that responsibility.

## Main design fork to discuss later

### Option 1 - strict shipment-time internal balancing
At shipment:
- source loses inventory
- destination gets in-transit
- internal due accounts open immediately

At receipt:
- in-transit becomes inventory

Strengths:
- very strong OU reporting
- transit is visible
- internal claims arise immediately
- cross-context economics stay explicit from the moment of shipment

Weaknesses:
- more lines
- more logic
- partial shipment / receipt handling matters more
- internal current-account open balances appear earlier and more often

### Discussion stance for now
- This note leans toward `Option 1` because it aligns best with:
  - the repo's existing cash and capital self-balancing pattern
  - explicit in-transit evidence
  - future OU-aware warehouse control
- But this is still a design discussion, not yet a locked implementation decision.

## What is not yet decided
- Whether future OU-aware inventory transfers should always use strict shipment-time internal balancing, or whether a lighter model remains acceptable in some cases.
- The exact lifecycle and state model of the future first-class cross-context collection document.
- Whether implementation should introduce that first-class document immediately, or first land the accounting rule and metadata shape before promotion.
- How far the same strict dependency-order reversal rule should propagate across other future cross-context flows beyond collection.

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
- Which accounts must be reused from the existing repo model:
  - `Central Due From OU`
  - `OU Due To Central`
  - partner-specific `Due From Partner OU`
  - partner-specific `Due To Partner OU`
- What document families must exist besides journals:
  - transfer evidence
  - cross-context collection evidence
  - internal settlement evidence
- How reversal and netting workflows should preserve additive evidence.

## Preferred direction so far
- Reuse the repo's existing OU internal-current-account model instead of inventing a second balancing pattern for inventory or CARI settlement.
- For cross-context collection:
  - bank and cash should follow the same immediate balancing rule
  - separate explicit pair accounts should be used
  - non-self-balanced posting should be hard-blocked
  - eventual promotion to a first-class business document is preferred
- Treat cross-context transfer/collection balancing as:
  - internal relocation / internal claim-settlement accounting
  - not revenue
  - not expense
  - not `COGS`
- Use explicit movement and collection evidence rather than silent hidden balancing.
- Allow net reporting later, but do not destroy the source-event trail.

## Not in scope for this note
- No real PR steps yet.
- No schema changes yet.
- No implementation commitments yet.
- No decision yet on whether this becomes one tracker or multiple trackers later.

## Expected next move later
- Revisit this note before the future OU-aware warehouse / transfer / cross-context collection work.
- Lock business criteria first.
- Then convert the note into a real execution tracker with concrete PR slices.
