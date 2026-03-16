# Inventory and Item-Card Rollout Runbook

This runbook covers rollout, verification, and remediation for the inventory/item-card hardening delivered after the commercial line-model cutover.

For OU-owned warehouse transfers and cross-context settlement follow-up, also use `docs/runbooks/ou-self-balancing-transfers-and-settlements.md`.

## Scope

- Dedicated RBAC for item cards and inventory:
  - `item.card.read`
  - `item.card.upsert`
  - `inventory.read`
  - `inventory.upsert`
- Explicit OpenAPI contracts for `/api/v1/items/*` and `/api/v1/inventory/*`
- FIFO outbound issue valuation with persisted layer-consumption audit rows
- Inventory-side `Dr COGS / Cr Inventory` posting on valued outbound issues

## Preflight

1. Apply schema changes:

```bash
cd backend
npm run db:migrate
```

2. Backfill seeded permissions for existing tenants and roles:

```bash
cd backend
npm run db:seed:core
```

3. Confirm operators can be assigned the new permissions independently from `cari.card.*`.
4. Confirm `STOCK_ITEM` item cards used in valuation have:
   - `inventoryAssetAccountId`
   - `defaultCogsAccountId` or approved fallback account
5. Confirm at least one `ACTIVE` warehouse exists for the target legal entity.
6. Confirm the movement posting date falls in an `OPEN` fiscal period.

## Permission Rollout

- Item-card readers/maintainers do not need `cari.card.read` or `cari.card.upsert`.
- Warehouse/inventory users do not need broad CARI-card maintenance rights.
- Recommended assignment split:
  - finance master-data user: `item.card.read`, `item.card.upsert`
  - warehouse operator: `inventory.read`, `inventory.upsert`
  - finance reviewer: `inventory.read`

## Operational Lifecycle

1. Choose warehouse on each stock-affecting CARI line in CARI, then post the document.
2. Verify pending stock link status:
   - `RECEIPT_PENDING` for AP receipt intent
   - `ISSUE_PENDING` for AR issue intent
3. Open `/app/stok-yansitma-islemleri` and keep `Queue Scope` on `ACTIONABLE` for normal execution work.
4. Materialize the stock link into a warehouse movement.
5. Expected outcomes:
   - `RECEIPT` -> `VALUED`, cost layer created
   - `ISSUE` -> `VALUED`, FIFO layer-consumption rows created
6. Use `COMPLETED` or `VOID` only as explicit history filters when operators need finished or canceled rows.
7. For valued `ISSUE`, verify one inventory journal:
   - `Dr COGS`
   - `Cr Inventory`
8. Replay safety:
   - re-materializing the same already linked issue must reuse the existing movement and existing journal
9. Reverse one valued outbound issue:
   - reverse only the latest relevant valued issue for that warehouse/item
   - reversal restores consumed layer quantities and creates the inventory-side reverse journal when a `COGS` journal existed
10. Successor rematerialization:
   - reversing one valued issue must create one reopened successor pending stock link for the same commercial line
   - rematerialize from the successor stock link, not the original historical linked row
11. Receipt undo:
   - a materialized receipt can be undone only when no later issue chronology still depends on its remaining layer history
   - receipt undo stays additive and does not invent duplicate inventory GL posting
12. CARI reverse readiness:
   - CARI reverse stays blocked until the linked issue/receipt effect is no longer active
   - operators should follow the unwind order from `/app/cari-belgeler` into `/app/stok-yansitma-islemleri`

## Audit And Troubleshooting

- If inventory page access fails:
  - verify `inventory.read` / `inventory.upsert`
- If item-card page access fails:
  - verify `item.card.read` / `item.card.upsert`
- If issue materialization fails:
  - verify enough remaining quantity exists in open cost layers
  - verify the warehouse belongs to the same legal entity
  - verify the item card is still `ACTIVE` and `STOCK_ITEM`
  - verify `inventoryAssetAccountId` and `defaultCogsAccountId`
- If the expected queue row is not visible:
  - verify `/app/stok-yansitma-islemleri` is still on `Queue Scope = ACTIONABLE` for live work
  - switch to `COMPLETED` or `VOID` only when intentionally reviewing history
- If issue journal is missing:
  - verify issue movement is `VALUED`
  - verify movement detail has `postedJournalEntryId`
  - replay the same stock link once to confirm idempotent reuse instead of duplicate posting
- If issue reverse is blocked:
  - verify there is no later valued issue for the same warehouse/item
  - verify the movement is really `ISSUE` and not already reversed
- If CARI reverse is blocked by inventory:
  - open the linked inventory movement id from the CARI reverse dialog
  - reverse the valued issue first or undo the materialized receipt first, depending on the blocker
  - retry CARI reverse only after the blocking inventory movement is no longer active
- If receipt undo is blocked:
  - verify no later valued issue still consumes the receipt layer history
  - clear the dependent issue chronology first, then retry the receipt undo
- If mixed-currency receipt layers exist for one item:
  - issue valuation still consumes FIFO layers
  - accounting total is posted in base currency
  - source-layer currencies should be reviewed from layer-consumption detail instead of expecting one fake combined transaction currency

## Verification Checklist

- `cd backend && npm run openapi:generate`
- `cd backend && npm run check:openapi:parse`
- `cd backend && npm run check:openapi`
- `git diff --exit-code -- backend/openapi.yaml`
- `cd backend && npm run test:permission-matrix`
- `cd backend && npm run test:cari:line-model-rollout`
- `cd backend && npm run test:inventory:release-gate`
- `cd backend && npm run test:ou:self-balancing:release-gate`
