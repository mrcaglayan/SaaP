# Monogrophy: Real-Life Test Cases for OU Self-Balancing Transfers and Cross-Context Settlements

This file is a practical manual test playbook for everything implemented in `PR-STEPS/31-OU-SELF-BALANCING-INVENTORY-TRANSFERS-AND-CROSS-CONTEXT-SETTLEMENTS-CHECKLIST.md`.

Use it when you want to test the feature set end to end in a realistic business story instead of only running smoke scripts.

## 1. Goal

The feature set covers:

- OU-aware warehouse ownership
- explicit inventory transfer workflow for cross-context stock movement
- shipment-time and receipt-time self-balancing accounting
- reversal and evidence discipline
- cross-context CARI settlement owner-vs-collector behavior
- reports, drilldowns, UI visibility, OpenAPI, and release gates

This playbook uses one consistent company story so the same data can be reused across all cases.

## 2. Shared Demo Story

Use the following demo company and dates.

- Tenant: `Demo Tenant`
- Legal entity: `Atlas Distribution LLC`
- Functional currency: `AFN`
- Main test date: `March 20, 2026`
- Central context: Head office treasury and head office warehouse
- Operating units:
  - `KBL` = Kabul Branch
  - `HRT` = Herat Branch
- Warehouses:
  - `CENTRAL-MAIN` = central warehouse
  - `KBL-STORE` = OU-owned Kabul warehouse
  - `HRT-STORE` = OU-owned Herat warehouse
- Item cards:
  - `RICE-25KG`
  - `SUGAR-10KG`
- Counterparty for settlement tests:
  - `RAHIMI RETAIL`
- Collection channels:
  - central bank account: `HO-BANK-AFN`
  - Kabul cash register: `KBL-CASH-01`

Use any account codes that fit your chart of accounts. The exact codes are not important. The mapping completeness is important.

## 3. Environment Preparation

Run these before manual testing on a fresh or uncertain database:

```bash
cd backend
npm run db:migrate
npm run audit:inventory:transfer-schema
```

If the database is empty, seed a baseline tenant and permissions:

```powershell
cd backend
$env:SEED_CORE_CREATE_DEFAULT_TENANT='true'
npm run db:seed:core
```

Bash equivalent:

```bash
cd backend
SEED_CORE_CREATE_DEFAULT_TENANT=true npm run db:seed:core
```

Before testing the flows, confirm:

1. There is at least one active legal entity with an open fiscal period.
2. The test user can access:
   - `/app/ayarlar/organizasyon-yonetimi`
   - `/app/stok-karti-listesi`
   - `/app/stok-yansitma-islemleri`
   - `/app/stok-transferleri`
   - `/app/cari-settlements`
3. Item cards that will be transferred have `inventoryTransitAccountId`.
4. The OU current-account mappings are complete.

## 4. Setup Data You Should Create First

Create these records before running the feature cases:

1. In `/app/ayarlar/organizasyon-yonetimi`, create or confirm:
   - legal entity `Atlas Distribution LLC`
   - OU `KBL`
   - OU `HRT`
2. Configure central `<->` OU current-account pairs for both branches:
   - `central_due_from_account_id`
   - `ou_due_to_central_account_id`
   - `central_due_to_account_id`
   - `ou_due_from_central_account_id`
3. Configure partner OU current-account pairs for `KBL <-> HRT`.
4. In item cards, create `RICE-25KG` and `SUGAR-10KG`.
5. Give both items:
   - inventory asset account
   - inventory transit account
6. Create these warehouses:
   - `CENTRAL-MAIN` with ownership scope `CENTRAL`
   - `KBL-STORE` with ownership scope `OPERATING_UNIT` and OU `KBL`
   - `HRT-STORE` with ownership scope `OPERATING_UNIT` and OU `HRT`
7. Create opening stock or inbound receipts so `CENTRAL-MAIN` has valued stock:
   - `March 18, 2026`: receive `50` units of `RICE-25KG` at `AFN 40`
   - `March 19, 2026`: receive `30` units of `RICE-25KG` at `AFN 42`
8. Create one customer open item later used for settlement:
   - customer `RAHIMI RETAIL`
   - sales document owned by OU `KBL`
   - amount example: `AFN 1,600`

## 5. Execution Order

Run the cases in this order because later cases depend on earlier results:

1. OU01 warehouse ownership
2. OU02 transfer creation and approval
3. OU03 current-account completeness
4. OU04 shipment and FIFO valuation
5. OU05 receipt
6. OU06 cancel, reverse, and bypass hardening
7. OU07 evidence
8. OU08 settlement owner-vs-collector resolution
9. OU09 settlement posting split
10. OU10 settlement reversal discipline
11. OU11 reports and drilldowns
12. OU12 UI finishing checks
13. OU13 contract and release-gate checks

## 6. Manual Cases

### Case OU01: Warehouse Ownership Foundation

Business story: head office holds central stock, while Kabul and Herat hold branch-owned stock.

Steps:

1. Create `CENTRAL-MAIN` as `CENTRAL`.
2. Create `KBL-STORE` as `OPERATING_UNIT` with OU `KBL`.
3. Create `HRT-STORE` as `OPERATING_UNIT` with OU `HRT`.
4. Try creating a central warehouse with an OU selected.
5. Try creating an OU-owned warehouse without selecting an OU.
6. Open the warehouse list and verify the ownership badges or columns.

Expected result:

- Central warehouse stores with `operatingUnitId = null`.
- OU warehouses store with the correct OU.
- Invalid combinations are rejected by the backend.
- The UI clearly shows central vs OU ownership.

Automation:

```bash
cd backend && npm run test:inventory:ou01
```

### Case OU02: Transfer Document Foundation with Approval

Business story: head office plans a stock replenishment from `CENTRAL-MAIN` to `KBL-STORE`.

Steps:

1. Go to `/app/stok-transferleri`.
2. Create a transfer dated `March 20, 2026`.
3. Source warehouse: `CENTRAL-MAIN`.
4. Target warehouse: `KBL-STORE`.
5. Item: `RICE-25KG`.
6. Quantity requested: `70`.
7. Save the transfer.
8. Confirm initial status is `INITIATED`.
9. Try shipment before approval and confirm it is blocked.
10. Approve the transfer.

Expected result:

- The transfer is created as a first-class document.
- Status flow is `INITIATED -> APPROVED`.
- Shipment is not allowed before approval.
- Header and line audit fields are visible.

Automation:

```bash
cd backend && npm run test:inventory:ou02
```

### Case OU03: Reverse-Direction and Partner Current-Account Readiness

Business story: the company wants both central-to-branch and branch-to-branch balancing to work safely.

Steps:

1. In organization setup, temporarily remove one reverse-direction field for `KBL`.
2. Attempt a cross-context transfer or preview shipment.
3. Restore the missing field.
4. Configure `KBL <-> HRT` partner current accounts.
5. Prepare a second future scenario: branch-to-branch transfer from `KBL-STORE` to `HRT-STORE`.

Expected result:

- Missing reverse-direction mapping blocks the financially meaningful operation.
- Once restored, the flow can continue.
- Partner OU mapping is required for `KBL <-> HRT`.

Automation:

```bash
cd backend && npm run test:inventory:ou03
```

### Case OU04: Shipment-Time Accounting and FIFO Valuation

Business story: head office ships `70` bags of rice to Kabul using two existing cost layers.

Input inventory layers:

- `50` units at `AFN 40`
- `30` units at `AFN 42`

Steps:

1. Open the approved transfer from `CENTRAL-MAIN` to `KBL-STORE`.
2. Ship the transfer in full.
3. Open the transfer line, movement history, and shipment journal.
4. Review the issue movement metadata.

Expected result:

- Transfer status becomes `IN_TRANSIT`.
- FIFO consumes:
  - first `50` units from the `AFN 40` layer
  - then `20` units from the `AFN 42` layer
- Expected shipment total cost:
  - `(50 x 40) + (20 x 42) = AFN 2,840`
- Expected shipped unit cost:
  - `AFN 40.571429`
- Shipment creates a valued issue movement with:
  - `source_type = INVENTORY_TRANSFER`
  - `source_document_type = INVENTORY_TRANSFER`
- Shipment creates one transfer-level shipment journal.
- The journal includes inventory, transit, and internal-current self-balancing lines.

Automation:

```bash
cd backend && npm run audit:inventory:transfer-schema
cd backend && npm run test:inventory:ou04
```

### Case OU05: Receipt and Receipt Journal

Business story: Kabul branch receives the truck and books the stock into its own warehouse.

Steps:

1. Open the `IN_TRANSIT` transfer.
2. Receive the full quantity into `KBL-STORE`.
3. Open the receipt journal and transfer line details.

Expected result:

- Transfer status becomes `RECEIVED`.
- Receipt journal is created.
- Destination inventory is increased in the target ownership context.
- Transit is cleared on receipt.
- Transfer line stores the target receipt movement linkage.

Automation:

```bash
cd backend && npm run test:inventory:ou05
```

### Case OU06: Cancel Discipline, Reversal Discipline, and Bypass Hardening

Business story: the business wants strict lifecycle control and no silent cross-context bypass.

Subcase A: cancel before shipment

1. Create a second transfer.
2. Approve it.
3. Cancel it before shipment.

Expected result:

- Status becomes `CANCELED`.
- No shipment movement or shipment journal exists.

Subcase B: reverse after shipment or receipt

1. Reverse the original shipped or received transfer.
2. Open original and reversal journal references.

Expected result:

- Reversal is additive.
- Original shipment and receipt lineage stays visible.
- Status becomes `REVERSED`.

Subcase C: bypass attempt

1. Try posting the same cross-context stock movement through a generic inventory movement path.

Expected result:

- The system blocks the bypass and forces the `/app/stok-transferleri` workflow.

Automation:

```bash
cd backend && npm run test:inventory:ou06
```

### Case OU07: Transfer Evidence

Business story: operations wants proof of dispatch and proof of receipt attached to the transfer.

Steps:

1. Open the transfer.
2. Upload a delivery note PDF.
3. Upload a truck handover image.
4. Upload a branch receipt confirmation image.
5. Replace one file content.
6. Delete one evidence item.
7. Download one remaining evidence file.

Expected result:

- Evidence rows stay attached to the transfer.
- Content replacement does not break evidence lineage.
- Delete only removes the selected evidence item.

Automation:

```bash
cd backend && npm run test:inventory:ou07
```

### Case OU08: Settlement Owner vs Collector Resolution

Business story: `RAHIMI RETAIL` owes Kabul branch, but the money is collected by head office treasury.

Steps:

1. Create or confirm an open AR item owned by OU `KBL`.
2. Go to `/app/cari-settlements`.
3. Settle the open item using the central bank account `HO-BANK-AFN`.
4. Review the settlement row or preview details.

Expected result:

- `ownerOperatingUnitId = KBL`
- `collectorOperatingUnitId = null` for central-bank collection
- The settlement is marked as cross-context when owner and collector differ.

Automation:

```bash
cd backend && npm run test:cari:ou08
```

### Case OU09: Cross-Context Settlement Posting Split

Business story: the receivable belongs to Kabul, but cash lands in central treasury.

Steps:

1. Post the settlement from Case OU08.
2. Open the resulting journal entry.
3. Review cash or bank line context.
4. Review owner-side receivable settlement line.
5. Review internal current-account lines between collector and owner contexts.

Expected result:

- Cash or bank stays in collector context.
- AR or AP clearing stays in owner context.
- Internal current-account lines self-balance immediately.
- Explicit central bank or cash context remains `NULL operating_unit_id`.

Automation:

```bash
cd backend && npm run test:cari:ou09
```

### Case OU10: Settlement Reversal Discipline

Business story: treasury must not reverse the root collection before reversing downstream dependent settlements.

Steps:

1. Create a cross-context settlement that has downstream lineage.
2. Try to reverse the root settlement first.
3. Reverse the dependent downstream settlement first.
4. Retry reversal of the original root settlement.

Expected result:

- Root reversal is blocked while descendants exist.
- The system points to descendant linkage.
- After dependent reversal, root reversal is allowed.

Automation:

```bash
cd backend && npm run test:cari:ou10
```

### Case OU11: Reports, Drilldowns, and UI Feedback

Business story: finance wants to audit who owned the document and who actually collected the money.

Steps:

1. Open the open-items report.
2. Open the counterparty statement report.
3. Open the realized FX settlement report if FX exists in the sample data.
4. Open the settlement row from the list page.
5. Open the related journal drilldown.

Expected result:

- Owner context and collector context are visible in reports and detail views.
- Cross-context indicators are visible.
- Origin batch linkage is visible when applicable.
- Drilldown shows what documents and allocations produced the journaled result.

Automation:

```bash
cd backend && npm run test:cari:ou11
```

### Case OU12: Frontend Finishing and Visibility

Business story: an operator should understand transfer and settlement context without reading raw database fields.

Steps:

1. In `/app/stok-karti-listesi`, confirm the transit account is visible on item cards.
2. In `/app/stok-yansitma-islemleri`, confirm movement rows show transfer linkage and source details.
3. In `/app/stok-transferleri`, confirm:
   - source and target ownership are visible
   - lifecycle status is visible
   - action buttons respect transfer state
   - shipment, receipt, and reversal journal references are visible
   - evidence is visible
4. In `/app/cari-settlements`, confirm owner-vs-collector messaging is understandable.

Expected result:

- Operators can understand the transfer and settlement flow directly from the UI.
- No hidden context is required to know where inventory or cash was owned vs collected.

Automation:

```bash
cd backend && npm run test:inventory:ou12
```

### Case OU13: OpenAPI, Release Gates, and Rollout Docs

Business story: engineering wants contract coverage and a repeatable rollout gate.

Steps:

1. Generate OpenAPI.
2. Parse and validate OpenAPI.
3. Run the OU self-balancing release gate.
4. Read the rollout runbook and compare it with this monogrophy.

Expected result:

- OpenAPI includes transfer and settlement shape changes.
- The release gate covers the OU feature family.
- Documentation is sufficient for rollout and support.

Automation:

```bash
cd backend && npm run openapi:generate
cd backend && npm run check:openapi:parse
cd backend && npm run check:openapi
cd backend && npm run test:ou:self-balancing:release-gate
```

## 7. Suggested End-to-End Business Story

If you want one realistic full journey instead of isolated cases, use this sequence:

1. Head office receives rice into `CENTRAL-MAIN` on two different days with two different costs.
2. Head office approves and ships `70` units to `KBL-STORE`.
3. Kabul receives the transfer.
4. Kabul sells part of the stock to `RAHIMI RETAIL`.
5. The customer pays to head office bank instead of Kabul directly.
6. Finance settles the Kabul-owned receivable using the central collector context.
7. Finance reviews the journal, reports, and drilldowns.
8. Operations uploads truck note and signed receipt to the transfer.
9. Finance tries a wrong-order reversal and confirms the system blocks it.

That single story covers inventory, settlement, self-balancing, reports, evidence, and reversal discipline together.

## 8. Troubleshooting Shortlist

If you hit these errors, use these checks first:

- `inventory_movements.source_type does not include INVENTORY_TRANSFER`
  - Run `cd backend && npm run audit:inventory:transfer-schema`
  - Then run `cd backend && npm run db:migrate`
- `Expected one active legal entity with an open fiscal period`
  - Open a fiscal period or create a proper seeded baseline
- shipment blocked because transit account is missing
  - set `inventoryTransitAccountId` on the item card
- cross-context shipment or settlement blocked due to missing mapping
  - complete the OU current-account setup in organization management
- generic cross-context stock movement blocked
  - move the scenario into `/app/stok-transferleri`

## 9. Related References

- `PR-STEPS/31-OU-SELF-BALANCING-INVENTORY-TRANSFERS-AND-CROSS-CONTEXT-SETTLEMENTS-CHECKLIST.md`
- `docs/runbooks/ou-self-balancing-transfers-and-settlements.md`
- `backend/scripts/audit-inventory-transfer-schema.js`
