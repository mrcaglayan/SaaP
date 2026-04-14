# 42 - CENTRAL WAREHOUSE OWNERSHIP AND WAREHOUSE OPERATIONS MODEL NOTE

## Status
- Design note
- Repo guidance only; not an implementation tracker yet
- Intended to shape future warehouse-operations work after current inventory valuation and landed-cost foundations

## Purpose
Define how this repo should treat a main distribution warehouse, branch warehouses, warehouse workers, and warehouse-facing UI so future inventory work does not drift into conflicting ownership models.

## Repo Baseline

The current repo already has the important accounting and stock-control foundations:

- warehouses are explicitly `CENTRAL` or `OPERATING_UNIT` owned
- cross-context stock movement must use explicit inventory transfer workflow
- branch stock cannot consume directly from another context's warehouse
- central-vs-OU ownership is already visible in inventory UI and transfer logic

This note does **not** replace those rules. It clarifies how to use them when a business has one main warehouse that physically serves many branches.

## Core Decision

### 1. Main warehouse stays `CENTRAL` owned

This repo locks the default main-hub model to `CENTRAL` / HQ ownership while inventory is physically stored in the hub warehouse.

Use case:

- HQ buys in bulk
- stock is received into the central warehouse
- branches receive stock later through explicit transfers

This matches the repo's current transfer-first ownership discipline and keeps branch self-balancing explicit.
For this repo, treat this as a chosen design direction, not just a loose recommendation.

### 2. A warehouse is not its own standalone accounting owner

A warehouse may have its own manager, receivers, pickers, and shippers, but that does **not** mean it should become a separate accounting ownership context.

In this repo, ownership should continue to be:

- `CENTRAL`, or
- `OPERATING_UNIT`

Do **not** invent a third ownership type such as `WAREHOUSE`.

### 3. If a warehouse must own stock independently, create an OU for it

If the business truly wants that warehouse to own inventory on the books, carry internal balances, and operate like a distinct branch/cost owner, then the correct model is:

- create a dedicated `OPERATING_UNIT` for that warehouse operation
- make the warehouse `OPERATING_UNIT` owned

Do not model this as a free-floating standalone warehouse with no OU/accounting context.

## Recommended Operating Model

### Central hub model

Use this when the main warehouse is a logistics hub for the whole entity.

- Main warehouse ownership: `CENTRAL`
- Branch warehouses: `OPERATING_UNIT`
- Bulk purchasing: receive into central warehouse
- Branch fulfillment: explicit inventory transfer from central to branch
- Branch sales/issues: consume from branch-owned warehouse only

This is the locked main-hub approach for this repo.

### Direct-to-branch procurement model

Use this when a branch buys and owns stock from day one.

- Purchase document created in that branch ownership context
- Receipt posted directly into that branch warehouse
- No HQ staging required

### Warehouse-as-its-own-owner model

Use this only when the warehouse is effectively a separate operating unit in finance and internal balancing.

- Create a dedicated OU
- Make the warehouse OU-owned
- Treat transfers to and from that warehouse as cross-context movement when applicable

## Worker Model

Warehouse workers should be modeled as **operational users**, not finance users.

Their primary concern is:

- receiving stock
- shipping stock
- confirming transfer shipment
- confirming transfer receipt
- stock inquiry
- cycle counts / physical counts
- exception handling
- evidence attachments

They should not need to work from finance-heavy inventory audit screens just to do daily warehouse work.

## UI Recommendation

Split warehouse-facing UX into two separate surfaces.

### A. Warehouse Admin

Audience:

- finance
- inventory controller
- master-data admin
- warehouse supervisor

Responsibilities:

- warehouse master data
- ownership scope
- operating-unit assignment
- transfer routes / structural setup
- stock audit
- movement history
- cost layers
- landed-cost / valuation drillback
- cleanup and exception administration

This can continue evolving from the current inventory management pages.

### B. Warehouse Operations

Audience:

- warehouse receiver
- warehouse shipper
- warehouse clerk
- floor supervisor

Responsibilities:

- inbound receiving queue
- transfer shipment queue
- transfer receipt queue
- stock inquiry by item / barcode / warehouse
- count tasks / count entry
- operational exceptions
- document/evidence attachments
- warehouse-specific daily workload

This page should default to one selected warehouse and hide most finance/accounting detail.

## Proposed Warehouse Operations Page Shape

Suggested route:

- `/app/depo-operasyonlari`
- optional English alias: `/app/warehouse-operations`

Suggested top sections:

1. `My Warehouse`
   - selected warehouse
   - ownership context
   - operating unit if any
   - quick counts: pending receipts, pending shipments, transfer receipts waiting, count tasks

2. `Inbound`
   - posted-but-not-processed inbound work if introduced later
   - transfer receipts waiting confirmation
   - receiving evidence

3. `Outbound`
   - approved transfers waiting shipment
   - shipment confirmation
   - shipment evidence

4. `Inquiry`
   - item search
   - available quantity by warehouse / location
   - recent movements

5. `Counts and Exceptions`
   - count tasks
   - discrepancy queue
   - blocked transfers / blocked materialization / data issues escalated to admin

## Permission Direction

Keep warehouse-operations permissions narrower than inventory-admin permissions.

Suggested split:

- `inventory.read`
  - admin/read-model style visibility
- historical draft placeholder: `inventory.upsert`
  - this note predated PR-64 and used `inventory.upsert` as a broad warehouse/admin placeholder
- current warehouse/admin mutation
  - `inventory.warehouse.upsert`
- current execution permissions
  - `inventory.materialize`
  - `inventory.movement.reverse`
  - `inventory.transfer.create`
  - `inventory.transfer.ship`
  - `inventory.transfer.receive`
  - `inventory.transfer.cancel`
  - `inventory.transfer.evidence.upsert`
- future worker-scoped refinements can still go narrower later
  - `inventory.ops.receive`
  - `inventory.ops.ship`
  - `inventory.ops.transfer.receive`
  - `inventory.ops.transfer.ship`
  - `inventory.ops.count`

The key point is that warehouse staff should not need broad configuration permissions to process operational tasks.

## Interaction With Current Inventory Rules

This note keeps the current repo rules intact:

- one document ownership context per stock-affecting CARI document
- no direct cross-context stock use
- explicit transfer required for cross-context movement
- central warehouse can supply branches only through transfer workflow

So for the common business scenario:

- HQ buys books into central warehouse
- central warehouse stores and dispatches them
- branches receive and own stock only after transfer receipt

This is valid and should remain the preferred pattern.

## Real-World Alignment

This design matches the mainstream ERP pattern more than the "one bill, many branch destinations" pattern.

Typical alignment:

- SAP EWM: warehouse workers use a dedicated warehouse-worker role focused on operational tasks, not finance setup
- Dynamics 365: warehouse workers use mobile warehouse flows; inventory ownership is still tied to legal-entity-oriented processing
- Oracle: internal material transfers are first-class orchestration documents between inventory organizations
- Business Central: transfers between locations are explicit and location-driven
- NetSuite is the main contrast case because it supports centralized purchasing with line-level target destination logic

For this repo, the SAP / Oracle / Dynamics / Business Central style is the better fit than the NetSuite style.

## Recommended Timing

### Apply this design after Track 41

Recommended sequencing:

1. Track 31 and Track 33 are already the ownership/transfer foundation and are effectively prerequisites.
2. Track 41 should complete first, because it finalizes how later landed costs interact with transferred stock.
3. After Track 41, this note should drive the next warehouse-user / warehouse-operations design track.

So the practical answer is:

- **Do not wait for unrelated CARI/dashboard tracks**
- **Do apply this after Track 41 is stable**
- **If Track 43 is already in flight, finish 43 first only because it is adjacent active work, not because this note depends on it**

## Recommendation For Next Track

If turned into an implementation plan, the next track should be something like:

- `Warehouse Operations Workbench / Worker Role / Task Queues`

That future track should:

- keep current ownership rules unchanged
- introduce warehouse-worker-facing UI
- add worker-scoped permissions
- keep admin/audit and worker/task pages separate
- avoid redesigning accounting ownership again

## Final Recommendation

For this repo:

- keep the main warehouse `CENTRAL` as the shared HQ distribution hub model
- do not make a warehouse a standalone accounting owner
- if a warehouse must own stock independently, model it as an `OPERATING_UNIT`
- separate warehouse worker operations UI from inventory admin/audit UI
- schedule this design after Track 41, then build a dedicated warehouse-operations track from it




Add an Inventory Valuation report that calculates total stock value using moving-average or FIFO logic, and add a dashboard view showing high-value inventory items at risk of stockout based on reorder points.

also we might need categories for inventories, like food , supplier , cleaning stuff, equipments etc. right ? stockout risk. 
