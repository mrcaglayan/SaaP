# 31 - OU SELF-BALANCING, OU-AWARE INVENTORY TRANSFERS, AND CROSS-CONTEXT SETTLEMENTS

## Execution tracking
- This file is the execution tracker that operationalizes the locked decisions in `30-OU-SELF-BALANCING-CROSS-CONTEXT-COLLECTIONS-DISCUSSION-NOTE.md`.
- If `30` changes later, update this tracker before implementation continues.

## Scope
- OU-aware warehouse ownership
- explicit inventory transfer workflow
- shipment-time internal balancing for cross-context inventory movement
- transfer receipt / reversal / evidence / bypass hardening
- cross-context CARI settlement self-balancing

## Locked decisions inherited from 30
- [x] OU self-balancing is required for cross-context, financially meaningful events.
- [x] Bank and cash use the same immediate balancing rule in cross-context collection cases.
- [x] Cross-context collection uses explicit separate GL accounts per OU pair.
- [x] Non-self-balanced cross-context collection is hard-blocked.
- [x] Cross-context collection reversal uses strict dependency order:
  - reverse downstream internal settlement first
  - then reverse cross-context collection
  - then reverse upstream source event if applicable
- [x] Cross-context stock movement must use explicit transfer workflow.
- [x] Cross-context transfer / collection balancing is internal relocation / internal claim-settlement accounting:
  - not revenue
  - not expense
  - not `COGS`
- [x] Evidence and reversals must remain additive and explicit.
- [x] Existing OU internal-current-account model is the base pattern to extend, not replace.

## V1 execution assumptions for this tracker
- [x] Same legal entity only for v1.
- [x] `NULL operating_unit_id` continues to mean central context.
- [x] Inventory transfer workflow includes approval in v1 because `30` examples assume request -> approval -> shipment -> receipt.
- [x] Full shipment only and full receipt only are acceptable v1 restrictions.
- [x] This transfer family is for cross-context movement only, not every same-context warehouse move.
- [x] Cross-context collection will be implemented in phase 1 through settlement owner / collector split and explicit posting logic.
- [x] A first-class cross-context collection business document remains a later follow-up and is not part of this tracker.

## Important repo guardrails
- [x] Do not attach one shared shipment or receipt journal to multiple `inventory_movements` rows because current movement journal link columns are unique.
- [x] Keep shared transfer journals on `inventory_transfers` header:
  - `shipment_journal_entry_id`
  - `receipt_journal_entry_id`
  - `reversal_journal_entry_id`
- [x] Keep transfer movement lineage through:
  - `source_type = 'INVENTORY_TRANSFER'`
  - `source_document_type = 'INVENTORY_TRANSFER'`
  - `source_document_id`
  - `source_document_line_id`
- [x] Current repo setup only has one central `<->` OU account direction on `operating_units`:
  - `central_due_from_account_id`
  - `ou_due_to_central_account_id`
- [x] This tracker must add the reverse direction as well so the locked pair-account model in `30` is actually implementable:
  - `central_due_to_account_id`
  - `ou_due_from_central_account_id`
- [x] Existing central `<->` OU flows that only require `central_due_from_account_id` and `ou_due_to_central_account_id` must remain backward-compatible during rollout.
- [x] Cross-context bypass must be blocked in all generic inventory movement entry paths:
  - not only stock-link materialization
  - not only one specific UI path

## Locked transfer lifecycle contract
- [x] Allowed transitions:
  - `INITIATED -> APPROVED`
  - `APPROVED -> IN_TRANSIT`
  - `IN_TRANSIT -> RECEIVED`
  - `INITIATED -> CANCELED`
  - `APPROVED -> CANCELED`
  - `IN_TRANSIT -> REVERSED` only through shipment reversal path
  - `RECEIVED -> REVERSED` only through receipt reversal first, then shipment reversal
- [x] Disallowed transitions:
  - no reopening from `CANCELED`
  - no direct `INITIATED -> IN_TRANSIT`
  - no direct `APPROVED -> RECEIVED`
  - no direct `INITIATED -> RECEIVED`
  - no direct `RECEIVED -> CANCELED`

## Out of scope for this tracker
- No intercompany / cross-legal-entity stock transfer.
- No partial shipment / partial receipt in v1.
- No same-context warehouse-to-warehouse movement redesign in this tracker.
- No dedicated first-class cross-context collection document yet.
- No weighted-average / standard-cost redesign.
- No lot / serial / bin redesign.

## Master tracker
- [x] `PR-OU01` - OU-aware warehouse ownership foundation
- [x] `PR-OU02` - Inventory transfer document foundation with approval
- [x] `PR-OU03` - Reverse-direction OU internal-current-account foundation and balancing helper
- [x] `PR-OU04` - Shipment-time transfer accounting and FIFO shipment valuation
- [x] `PR-OU05` - Transfer receipt and receipt journal
- [x] `PR-OU06` - Transfer reversal, cancel discipline, and bypass hardening
- [x] `PR-OU07` - Transfer evidence
- [x] `PR-OU08` - Cross-context settlement owner/collector persistence and resolution
- [x] `PR-OU09` - Cross-context settlement posting split
- [x] `PR-OU10` - Cross-context settlement reversal discipline
- [ ] `PR-OU11` - Cross-context settlement reports, drilldowns, and UI feedback
- [ ] `PR-OU12` - Frontend finishing for transfers, inventory, and settlement visibility
- [ ] `PR-OU13` - OpenAPI, release gates, and rollout docs

## PR-OU01 - OU-aware warehouse ownership foundation

### Goal
- Make `inventory_warehouses` explicitly central or OU-owned, matching the ownership model already used by cash registers.

### Files
- `backend/src/migrations/m123_inventory_warehouse_ownership_scope.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/inventory.validators.js`
- `backend/src/routes/inventory.routes.js`
- `backend/src/services/inventory.service.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `backend/scripts/test-inventory-ou01-warehouse-ownership.js`

### Checklist

#### Migration
- [x] Create `backend/src/migrations/m123_inventory_warehouse_ownership_scope.js`
- [x] Add `ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL DEFAULT 'CENTRAL'` to `inventory_warehouses`
- [x] Add `operating_unit_id BIGINT UNSIGNED NULL` to `inventory_warehouses`
- [x] Add index `(tenant_id, legal_entity_id, ownership_scope, operating_unit_id, status)`
- [x] Add index `(tenant_id, operating_unit_id)`
- [x] Add FK `inventory_warehouses.operating_unit_id -> operating_units.id`
- [x] Backfill existing rows to `ownership_scope = 'CENTRAL'`
- [x] Do not auto-derive OU for existing rows

#### Migration registration
- [x] Register `m123_inventory_warehouse_ownership_scope` in `backend/src/migrations/index.js`

#### Validators and service/query
- [x] Add `ownershipScope` list filter
- [x] Add `operatingUnitId` list filter
- [x] Accept `ownershipScope` and `operatingUnitId` in create payloads
- [x] Enforce `CENTRAL => operatingUnitId must be null`
- [x] Enforce `OPERATING_UNIT => operatingUnitId required`
- [x] Return `ownershipScope`
- [x] Return `operatingUnitId`
- [x] Return `operatingUnitCode`
- [x] Return `operatingUnitName`
- [x] Validate OU belongs to same tenant
- [x] Validate OU belongs to same `legal_entity_id`

#### Frontend
- [x] Add ownership scope select
- [x] Add OU selector when ownership scope = `OPERATING_UNIT`
- [x] Show ownership badge/column in warehouse list

#### Regression
- [x] Create `backend/scripts/test-inventory-ou01-warehouse-ownership.js`
- [x] Test central warehouse create
- [x] Test OU-owned warehouse create
- [x] Test central + OU id is rejected
- [x] Test OU-owned without OU id is rejected
- [x] Test legal-entity mismatch is rejected

### Acceptance
- [x] Warehouses clearly indicate central vs OU ownership
- [x] Existing central-default inventory flow still works
- [x] UI shows ownership context correctly
- [x] Warehouse creation rules are enforced in backend

## PR-OU02 - Inventory transfer document foundation with approval

### Goal
- Add a first-class inventory transfer document and lifecycle for cross-context stock movement only.

### Files
- `backend/src/migrations/m124_inventory_transfer_foundation.js`
- `backend/src/migrations/index.js`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/routes/inventory.transfer.validators.js`
- `backend/src/routes/inventory.transfer.routes.js`
- `backend/src/index.js`
- `backend/src/services/inventory.service.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/i18n/messages.js`
- `backend/scripts/test-inventory-ou02-transfer-foundation.js`

### Checklist

#### Migration
- [x] Create `backend/src/migrations/m124_inventory_transfer_foundation.js`
- [x] Create `inventory_transfers`
- [x] Add `tenant_id`
- [x] Add `legal_entity_id`
- [x] Add `transfer_no`
- [x] Add `transfer_date`
- [x] Add `status ENUM('INITIATED','APPROVED','IN_TRANSIT','RECEIVED','CANCELED','REVERSED')`
- [x] Add `source_warehouse_id`
- [x] Add `target_warehouse_id`
- [x] Add `source_ownership_scope`
- [x] Add `source_operating_unit_id`
- [x] Add `target_ownership_scope`
- [x] Add `target_operating_unit_id`
- [x] Add `shipment_journal_entry_id`
- [x] Add `receipt_journal_entry_id`
- [x] Add `reversal_journal_entry_id`
- [x] Add `initiated_by_user_id`
- [x] Add `approved_by_user_id`
- [x] Add `shipped_by_user_id`
- [x] Add `received_by_user_id`
- [x] Add `canceled_by_user_id`
- [x] Add `reversed_by_user_id`
- [x] Add `initiated_at`
- [x] Add `approved_at`
- [x] Add `in_transit_at`
- [x] Add `received_at`
- [x] Add `canceled_at`
- [x] Add `reversed_at`
- [x] Add `cancel_reason`
- [x] Add `reverse_reason`
- [x] Add `idempotency_key`
- [x] Add `integration_event_uid`
- [x] Add `source_module`
- [x] Add `source_entity_type`
- [x] Add `source_entity_id`
- [x] Add `note`
- [x] Add timestamps
- [x] Add unique `(tenant_id, legal_entity_id, transfer_no)`
- [x] Add unique `(tenant_id, idempotency_key)` if idempotency is enforced for create
- [x] Add FK coverage for `source_warehouse_id`
- [x] Add FK coverage for `target_warehouse_id`
- [x] Alter `inventory_movements.source_type` to include `'INVENTORY_TRANSFER'`
- [x] Confirm `inventory_movements.source_document_type` does not need enum/constraint extension for `'INVENTORY_TRANSFER'`
- [x] Create `inventory_transfer_lines`
- [x] Add `tenant_id`
- [x] Add `legal_entity_id`
- [x] Add `inventory_transfer_id`
- [x] Add `line_no`
- [x] Add `item_card_id`
- [x] Add `quantity_requested`
- [x] Add `quantity_shipped`
- [x] Add `quantity_received`
- [x] Add `shipped_currency_code`
- [x] Add `shipped_unit_cost_txn`
- [x] Add `shipped_unit_cost_base`
- [x] Add `shipped_total_cost_txn`
- [x] Add `shipped_total_cost_base`
- [x] Add `source_issue_movement_id`
- [x] Add `target_receipt_movement_id`
- [x] Add `note`
- [x] Add timestamps
- [x] Add unique `(inventory_transfer_id, line_no)`
- [x] Add FK coverage for `inventory_transfer_lines.inventory_transfer_id`
- [x] Add FK coverage for `inventory_transfer_lines.item_card_id`
- [x] Add FK coverage for `inventory_transfer_lines.source_issue_movement_id` if strict lineage is enforced
- [x] Add FK coverage for `inventory_transfer_lines.target_receipt_movement_id` if strict lineage is enforced

#### Migration registration
- [x] Register `m124_inventory_transfer_foundation` in `backend/src/migrations/index.js`

#### Validators and routes
- [x] Add create, list, detail, approve, ship, receive, cancel, reverse validators
- [x] Reuse existing `inventory.read` for transfer list/detail access
- [x] Reuse existing `inventory.upsert` for transfer create/approve/ship/receive/cancel/reverse access
- [x] Do not introduce new transfer-specific permission codes in v1
- [x] Enforce source warehouse required
- [x] Enforce target warehouse required
- [x] Enforce source != target
- [x] Enforce same legal entity only
- [x] Enforce source and target ownership context must differ for this transfer family
- [x] Enforce lines array required
- [x] Enforce positive quantities
- [x] Enforce full shipment only in v1
- [x] Enforce full receipt only in v1
- [x] Approve action must fail or no-op clearly if transfer is already `APPROVED` or beyond
- [x] Ship action must fail or no-op clearly if transfer is not exactly `APPROVED`
- [x] Receive action must fail or no-op clearly if transfer is not exactly `IN_TRANSIT`
- [x] Cancel action must fail or no-op clearly if transfer is not in an allowed pre-shipment state
- [x] Reverse action must fail or no-op clearly if transfer is not in an allowed reversible state
- [x] Add routes:
  - `GET /api/v1/inventory/transfers`
  - `POST /api/v1/inventory/transfers`
  - `GET /api/v1/inventory/transfers/:transferId`
  - `POST /api/v1/inventory/transfers/:transferId/approve`
  - `POST /api/v1/inventory/transfers/:transferId/ship`
  - `POST /api/v1/inventory/transfers/:transferId/receive`
  - `POST /api/v1/inventory/transfers/:transferId/cancel`
  - `POST /api/v1/inventory/transfers/:transferId/reverse`
- [x] Mount `inventory.transfer.routes.js` under existing `/api/v1/inventory`
- [x] Add legal-entity scope resolution for transfer create/list
- [x] Add param-based scope resolution for transfer detail/actions
- [x] Follow repo route-guard style for detail/actions: resolve scoped entity first, then enforce loaded-row access with `assertScopeAccess` where needed

#### Service skeleton
- [x] Add `listInventoryTransfers`
- [x] Add `getInventoryTransferById`
- [x] Add `createInventoryTransfer`
- [x] Add `approveInventoryTransferById`
- [x] Add `shipInventoryTransferById`
- [x] Add `receiveInventoryTransferById`
- [x] Add `cancelInventoryTransferById`
- [x] Add `reverseInventoryTransferById`
- [x] Snapshot source ownership scope / OU on header
- [x] Snapshot target ownership scope / OU on header
- [x] Treat same-context warehouse move as out of scope for this transfer family and fail clearly

#### Frontend
- [x] Add transfer API helpers
- [x] Add transfer list page shell
- [x] Add transfer create form
- [x] Add transfer detail fetch
- [x] Lock the canonical transfer route path in `frontend/src/App.jsx`:
  - `appPath = "/app/stok-transferleri"`
  - `childPath = "stok-transferleri"`
- [x] Add canonical implemented transfer route entry in `frontend/src/App.jsx`
- [x] Add route/sidebar entry for transfers using existing `inventory.read` gating
- [x] Reuse the same canonical transfer route string in:
  - `frontend/src/layouts/sidebarConfig.js` `to = "/app/stok-transferleri"`
  - `frontend/src/i18n/messages.js` `messages.sidebar.byPath["/app/stok-transferleri"]`
- [x] Mark the new transfer sidebar entry as `implemented: true` in `frontend/src/layouts/sidebarConfig.js`
- [x] Add `messages.sidebar.byPath` TR/EN labels for the transfer route

#### Regression
- [x] Create `backend/scripts/test-inventory-ou02-transfer-foundation.js`
- [x] Test create transfer
- [x] Test same warehouse blocked
- [x] Test cross-legal-entity blocked
- [x] Test same-context transfer create is rejected for this tracker family
- [x] Test approve twice fails or no-ops clearly
- [x] Test ship before approve fails
- [x] Test ship twice fails or no-ops clearly
- [x] Test receive before ship fails
- [x] Test receive twice fails or no-ops clearly
- [x] Test cancel after shipment fails
- [x] Test reverse after cancel fails
- [x] Test approval required before shipment
- [x] Test source/target context snapshot persists

### Acceptance
- [x] Transfer header and lines persist correctly
- [x] Transfer has explicit source/target context snapshot
- [x] Approval is part of the lifecycle
- [x] Transfer routes are scope-safe
- [x] Transfer route/sidebar/messages wiring follows the repo route contract
- [x] Same-context movement is not silently pulled into the cross-context transfer family
- [x] Cross-context movement now has a real document foundation

## PR-OU03 - Reverse-direction OU internal-current-account foundation and balancing helper

### Goal
- Extend the current repo OU-account setup so the locked explicit pair-account model is actually possible for both directions of central `<->` OU flow.

### Files
- `backend/src/migrations/m125_operating_unit_reverse_internal_current_accounts.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/routes/org.js`
- `backend/src/services/org.write.service.js`
- `backend/src/services/org.read.queries.js`
- `backend/src/services/org.write.queries.js`
- `backend/src/services/ou.self-balancing.service.js`
- `frontend/src/api/orgAdmin.js`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `backend/scripts/test-inventory-ou03-ou-account-foundation.js`

### Checklist

#### Migration
- [x] Create `backend/src/migrations/m125_operating_unit_reverse_internal_current_accounts.js`
- [x] Add `central_due_to_account_id BIGINT UNSIGNED NULL` to `operating_units`
- [x] Add `ou_due_from_central_account_id BIGINT UNSIGNED NULL` to `operating_units`
- [x] Add FKs to `accounts(id)`
- [x] Add index coverage as needed for org setup reads

#### Migration registration
- [x] Register `m125_operating_unit_reverse_internal_current_accounts` in `backend/src/migrations/index.js`

#### Validation and org setup
- [x] Validate `central_due_from_account_id` is asset / debit-normal / postable / leaf
- [x] Validate `central_due_to_account_id` is liability / credit-normal / postable / leaf
- [x] Validate `ou_due_from_central_account_id` is asset / debit-normal / postable / leaf
- [x] Validate `ou_due_to_central_account_id` is liability / credit-normal / postable / leaf
- [x] Extend org write/read flows to persist and expose the new fields
- [x] Keep existing flows that only need current two-field central `<->` OU setup backward-compatible until reverse-direction fields are actually required by the posting path

#### Shared helper
- [x] Create `backend/src/services/ou.self-balancing.service.js`
- [x] Add helper `resolveOuSelfBalancingAccountsTx(...)`
- [x] Support:
  - `CENTRAL -> OU`
  - `OU -> CENTRAL`
  - `OU -> OU`
- [x] Reuse partner-pair mappings for `OU -> OU`
- [x] Use the new reverse-direction operating-unit fields for central `<->` OU paths
- [x] Fail clearly when required mapping is missing

#### Regression
- [x] Create `backend/scripts/test-inventory-ou03-ou-account-foundation.js`
- [x] Test central `<->` OU mapping resolution both directions
- [x] Test OU `<->` OU mapping resolution
- [x] Test invalid account type / normal-side rejection
- [x] Test missing mapping failure

### Acceptance
- [x] Central `<->` OU has explicit accounts for both directions
- [x] OU `<->` OU continues to use partner-specific pair mappings
- [x] A reusable helper exists for transfer and settlement posting

## PR-OU04 - Shipment-time transfer accounting and FIFO shipment valuation

### Goal
- Implement shipment-time inventory balancing with FIFO cost consumption and explicit transit accounting.

### Files
- `backend/src/migrations/m126_item_cards_inventory_transit_account.js`
- `backend/src/migrations/m127_inventory_transfer_source_type_backfill.js`
- `backend/src/migrations/index.js`
- `backend/src/services/item.card.service.js`
- `backend/src/routes/item.card.validators.js`
- `backend/src/routes/item.card.routes.js`
- `frontend/src/api/itemCards.js`
- `frontend/src/pages/inventory/ItemCardsPage.jsx`
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/journal.source-link.service.js`
- `backend/scripts/test-inventory-ou04-shipment-self-balancing.js`

### Checklist

#### Migration registration
- [x] Register `m126_item_cards_inventory_transit_account` in `backend/src/migrations/index.js`

#### Transit account foundation
- [x] Create `backend/src/migrations/m126_item_cards_inventory_transit_account.js`
- [x] Add `inventory_transit_account_id BIGINT UNSIGNED NULL` to `item_cards`
- [x] Add FK to `accounts`
- [x] Add index for transit account
- [x] Expose the field in item-card validators, service, API, and UI
- [x] Treat item-card transit account as the v1 default transit account source for shipment-time posting

#### Shipment FIFO costing
- [x] Add `consumeTransferShipmentCostLayersTx(...)`
- [x] Lock transfer header `FOR UPDATE`
- [x] Lock transfer lines
- [x] Lock source cost layers
- [x] Validate enough stock exists
- [x] Consume FIFO oldest-first
- [x] Compute and persist `shipped_currency_code` on transfer lines
- [x] If consumed source layers are mixed-currency, use legal-entity base currency as `shipped_currency_code`
- [x] Implement legal-entity base currency against the real repo field `legal_entities.functional_currency_code`
- [x] Compute and persist shipment cost snapshot to transfer lines

#### Shipment movement creation
- [x] Require transfer status = `APPROVED`
- [x] Create source `inventory_movements` rows with:
  - `movement_type = 'ISSUE'`
  - `source_type = 'INVENTORY_TRANSFER'`
  - `source_document_type = 'INVENTORY_TRANSFER'`
  - `source_document_id`
  - `source_document_line_id`
  - `valuation_status = 'VALUED'`
- [x] Create issue layer consumption rows
- [x] Set `source_issue_movement_id` on each transfer line

#### Shipment posting logic
- [x] Build one shipment journal on transfer header
- [x] Debit destination transit account
- [x] Debit source-side `due_from` account
- [x] Credit source inventory asset account
- [x] Credit destination-side `due_to` account
- [x] Support route matrix:
  - `CENTRAL -> OU`
  - `OU -> CENTRAL`
  - `OU -> OU`
- [x] Group journal lines by account when helpful
- [x] Reject posting clearly if required current-account mapping is missing
- [x] Reject posting clearly if required transit account is missing
- [x] Ensure no revenue / expense / `COGS` lines are posted

#### Shipment finalization
- [x] Insert shipment journal
- [x] Set `inventory_transfers.shipment_journal_entry_id`
- [x] Set `inventory_transfers.status = 'IN_TRANSIT'`
- [x] Set `shipped_by_user_id`
- [x] Set `in_transit_at`
- [x] Do not populate `inventory_movements.posted_journal_entry_id` with the shared header journal

#### Read model and source links
- [x] Add primary source link from shipment journal to transfer header
- [x] Extend transfer detail with shipment journal id
- [x] Extend transfer detail with shipment cost snapshot
- [x] Extend transfer detail with source issue movement ids

#### Frontend
- [x] Add approve action UI
- [x] Add ship action UI

#### Regression
- [x] Create `backend/scripts/test-inventory-ou04-shipment-self-balancing.js`
- [x] Test `CENTRAL -> OU` shipment
- [x] Test `OU -> CENTRAL` shipment
- [x] Test `OU -> OU` shipment
- [x] Test missing current-account mapping fails
- [x] Test missing transit account fails
- [x] Test insufficient stock fails

### Acceptance
- [x] Shipment reduces source quantity immediately
- [x] FIFO shipment cost snapshot persists
- [x] Shipment journal is created on transfer header
- [x] Due-from / due-to lines use explicit OU pair-account logic correctly
- [x] No transfer shipment posts revenue / expense / `COGS`

## PR-OU05 - Transfer receipt and receipt journal

### Goal
- Complete the inbound transfer leg by materializing the destination receipt and clearing transit cleanly.

### Files
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/routes/inventory.transfer.routes.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `backend/scripts/test-inventory-ou05-transfer-receipt.js`

### Checklist

#### Receipt implementation
- [x] Require transfer status = `IN_TRANSIT`
- [x] Load shipped cost snapshot from transfer lines
- [x] Reuse `shipped_currency_code` when creating destination receipt movement and cost layer currency
- [x] Create destination `inventory_movements` rows with:
  - `movement_type = 'RECEIPT'`
  - `source_type = 'INVENTORY_TRANSFER'`
  - `source_document_type = 'INVENTORY_TRANSFER'`
  - `source_document_id`
  - `source_document_line_id`
  - `valuation_status = 'VALUED'`
- [x] Create destination `inventory_cost_layers`
- [x] Set `target_receipt_movement_id`
- [x] Set `quantity_received`

#### Receipt journal
- [x] Create one receipt journal on transfer header
- [x] Debit destination inventory asset
- [x] Credit destination inventory transit
- [x] Set `inventory_transfers.receipt_journal_entry_id`
- [x] Set `status = 'RECEIVED'`
- [x] Set `received_by_user_id`
- [x] Set `received_at`

#### Frontend
- [x] Add receive action UI

#### Regression
- [x] Create `backend/scripts/test-inventory-ou05-transfer-receipt.js`
- [x] Test receive flow
- [x] Test receipt journal

### Acceptance
- [x] Receipt clears transit correctly
- [x] Transfer can move cleanly from `IN_TRANSIT` to `RECEIVED`
- [x] Receipt visibility works in UI

## PR-OU06 - Transfer reversal, cancel discipline, and bypass hardening

### Goal
- Finish additive reversal and cancellation rules, and enforce the transfer workflow as the only valid cross-context stock-movement path.

### Files
- `backend/src/services/inventory.transfer.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/routes/inventory.transfer.routes.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `backend/scripts/test-inventory-ou06-transfer-reversal-bypass.js`

### Checklist

#### Cancel and reversal discipline
- [x] Allow cancel only in `INITIATED` or `APPROVED`
- [x] Ensure no movements and no journals exist before cancel
- [x] Store cancel metadata
- [x] If transfer is `IN_TRANSIT` and no receipt exists, reverse shipment side directly through shipment reversal path
- [x] If receipt exists, reverse receipt side first
- [x] Reverse shipment side second
- [x] Reuse additive movement lineage discipline
- [x] Shipment reversal creates an additive source-side return movement (`ADJUSTMENT_IN`)
- [x] Receipt reversal creates an additive target-side undo movement (`ADJUSTMENT_OUT`)
- [x] Do not destroy original movement history
- [x] Reverse receipt journal
- [x] Reverse shipment journal
- [x] Store reversal metadata
- [x] Set status `REVERSED`

#### Backend bypass hardening
- [x] In all generic stock movement creation paths, load warehouse ownership context
- [x] In all generic stock movement creation paths, load commercial/source OU context when relevant
- [x] Reject generic movement when contexts differ
- [x] Return clear error: cross-context stock movement must use transfer workflow
- [x] Do not limit this protection only to stock-link materialization

#### Frontend
- [x] Add cancel action UI
- [x] Add reverse action UI

#### Regression
- [x] Create `backend/scripts/test-inventory-ou06-transfer-reversal-bypass.js`
- [x] Test cancel flow
- [x] Test reversal flow
- [x] Test generic cross-context bypass is blocked in backend

### Acceptance
- [x] Reversals are additive and auditable
- [x] Source and target warehouse movement history both show explicit reversal evidence
- [x] Cancel rules are enforced safely
- [x] Generic inventory movement cannot fake cross-context transfer

## PR-OU07 - Transfer evidence

### Goal
- Extend the evidence subsystem so transfer documents have first-class evidence lifecycle support.

### Files
- `backend/src/services/evidence.service.js`
- `backend/src/routes/inventory.transfer.evidence.routes.js`
- `backend/src/index.js`
- `frontend/src/api/inventory.js`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `backend/scripts/test-inventory-ou07-transfer-evidence.js`

### Checklist

#### Evidence
- [x] Reuse existing `inventory.read` for transfer evidence list/download
- [x] Reuse existing `inventory.upsert` for transfer evidence create/upload/delete
- [x] Extend evidence service to support `INVENTORY_TRANSFER`
- [x] Add transfer row lookup helper
- [x] Add transfer scope assertion helper
- [x] Add transfer evidence routes:
  - `GET /transfers/:transferId/evidence`
  - `POST /transfers/:transferId/evidence`
  - `PUT /transfers/:transferId/evidence/:evidenceId/content`
  - `GET /transfers/:transferId/evidence/:evidenceId/download`
  - `DELETE /transfers/:transferId/evidence/:evidenceId`
- [x] Mount `inventory.transfer.evidence.routes.js` under existing `/api/v1/inventory`

#### Frontend
- [x] Add evidence upload / download / delete UI

#### Regression
- [x] Create `backend/scripts/test-inventory-ou07-transfer-evidence.js`
- [x] Test evidence lifecycle

### Acceptance
- [x] Transfer evidence works
- [x] Evidence routes are reachable and scope-safe

## PR-OU08 - Cross-context settlement owner/collector persistence and resolution

### Goal
- Add owner/collector context persistence and deterministic resolution without changing the existing posting shape yet.

### Files
- `backend/src/migrations/m128_cari_settlement_owner_collector_contexts.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/cari.js`
- `backend/src/routes/cari.settlement.validators.js`
- `backend/src/services/cari.settlement.service.js`
- `backend/src/services/cash.queries.js`
- bank statement / bank account service files as needed
- `frontend/src/api/cariSettlements.js`
- `frontend/src/pages/cari/CariSettlementsPage.jsx`
- `backend/scripts/test-cari-ou08-settlement-owner-collector-resolution.js`

### Checklist

#### Migration
- [x] Create `backend/src/migrations/m128_cari_settlement_owner_collector_contexts.js`
- [x] Add `owner_operating_unit_id BIGINT UNSIGNED NULL` to `cari_settlement_batches`
- [x] Add `collector_operating_unit_id BIGINT UNSIGNED NULL` to `cari_settlement_batches`
- [x] Add `originating_cross_context_settlement_batch_id BIGINT UNSIGNED NULL` to `cari_settlement_batches`
- [x] Add indexes by tenant / legal entity / owner / collector / settlement date
- [x] Add index `(tenant_id, legal_entity_id, originating_cross_context_settlement_batch_id)`
- [x] Add FK to `operating_units.id` for owner OU
- [x] Add FK to `operating_units.id` for collector OU
- [x] Add scoped self-FK `(tenant_id, legal_entity_id, originating_cross_context_settlement_batch_id) -> cari_settlement_batches(tenant_id, legal_entity_id, id)` for originating cross-context settlement linkage

#### Migration registration
- [x] Register `m128_cari_settlement_owner_collector_contexts` in `backend/src/migrations/index.js`

#### Owner / collector resolution
- [x] Add `resolveSettlementOwnerOperatingUnitId(...)`
- [x] Add `resolveSettlementCollectorOperatingUnitId(...)`
- [x] Owner priority: allocated documents / open items first
- [x] Hard-fail in v1 when allocated items imply more than one owner OU in the same settlement batch
- [x] Explicit payload OU may not override a derived owner OU when allocations already imply one
- [x] Owner fallback: central / null only when no unique owner context can be derived
- [x] Collector priority: linked cash transaction OU
- [x] Collector priority: linked bank statement line OU
- [x] Collector priority: linked bank account OU if needed
- [x] Collector fallback: owner context when not cross-context

#### Batch persistence
- [x] Persist `owner_operating_unit_id`
- [x] Persist `collector_operating_unit_id`
- [x] Keep `originating_cross_context_settlement_batch_id` null for ordinary settlement batches in this slice
- [x] Preserve owner / collector context on reversal paths too

#### Read models and frontend
- [x] Expose `ownerOperatingUnitId`
- [x] Expose `collectorOperatingUnitId`
- [x] Return a clear validation error when settlement allocations imply multiple owner OUs in one batch

#### Regression
- [x] Create `backend/scripts/test-cari-ou08-settlement-owner-collector-resolution.js`
- [x] Test mixed-owner settlement batch fails hard in v1
- [x] Test owner / collector context persists

### Acceptance
- [x] Same-context settlements still behave correctly
- [x] Collector vs owner context is persisted and visible
- [x] Owner vs collector context is resolved deterministically

## PR-OU09 - Cross-context settlement posting split

### Goal
- Add the real owner/collector posting split while preserving the existing same-context path.

### Files
- `backend/src/routes/cari.js`
- `backend/src/routes/cari.settlement.validators.js`
- `backend/src/services/cari.settlement.service.js`
- `backend/src/services/cash.queries.js`
- bank statement / bank account service files as needed
- `backend/src/services/ou.self-balancing.service.js`
- `backend/scripts/test-cari-ou09-cross-context-posting-split.js`
- `backend/scripts/test-cari-ou09-cash-and-bank-collector-context.js`

### Checklist

#### Posting logic
- [x] Keep existing same-context path intact
- [x] Add split path when `owner != collector`
- [x] Hard-block any attempt to force a non-self-balanced path when contexts differ
- [x] Collector side posts actual cash / bank offset line
- [x] Collector side posts internal `Due To owner`
- [x] Owner side posts internal `Due From collector`
- [x] Owner side posts AR or AP control relief line
- [x] Keep realized FX on owner side
- [x] Keep tax augmentation on owner side
- [x] Reuse `ou.self-balancing.service.js` helper for account resolution

#### Regression
- [x] Create `backend/scripts/test-cari-ou09-cross-context-posting-split.js`
- [x] Create `backend/scripts/test-cari-ou09-cash-and-bank-collector-context.js`
- [x] Test central collects OU AR
- [x] Test OU collects central AR
- [x] Test OU collects other OU AR
- [x] Test bank and cash both follow the same immediate balancing rule
- [x] Test realized FX remains owner-side

### Acceptance
- [x] Cross-context settlements create explicit internal balancing
- [x] Bank and cash behave under the same balancing rule
- [x] Same-context settlements still behave correctly

## PR-OU10 - Cross-context settlement reversal discipline

### Goal
- Enforce strict cross-context settlement reversal discipline with explicit downstream linkage, while keeping reporting and UI surfacing for the next slice.

### Files
- `backend/src/services/cari.settlement.service.js`
- `backend/src/services/cash.transaction.service.js`
- `backend/scripts/test-cari-ou10-settlement-reversal-discipline.js`

### Checklist

#### Reversal discipline
- [x] Reverse original owner / collector split exactly
- [x] Reverse same internal account family
- [x] Do not collapse reversal into one context
- [x] If downstream internal settlement already exists, enforce strict dependency order before collection reverse proceeds
- [x] Persist `originating_cross_context_settlement_batch_id` on downstream internal settlement records that clear balances created by cross-context collection
- [x] Reversal blocking depends on `originating_cross_context_settlement_batch_id`, not inferred net balances
- [x] Internal settlement records that clear balances originating from cross-context collection must retain explicit linkage to the originating settlement batch or future first-class collection event

#### Regression
- [x] Create `backend/scripts/test-cari-ou10-settlement-reversal-discipline.js`
- [x] Test reversal preserves split
- [x] Test strict dependency order when internal settlement already exists
- [x] Test downstream internal settlement retains originating cross-context settlement linkage

### Acceptance
- [x] Reversal discipline is preserved
- [x] Downstream internal settlement linkage is explicit and auditable

## PR-OU11 - Cross-context settlement reports, drilldowns, and UI feedback

### Goal
- Surface owner/collector context consistently in settlement reports, drilldowns, and operator-facing feedback after the reversal discipline is in place.

### Files
- `frontend/src/api/cariSettlements.js`
- `backend/src/services/cari.report.service.js`
- `backend/src/services/cari.settlement.drilldown.service.js`
- `frontend/src/pages/cari/CariSettlementsPage.jsx`
- possible cash-side touch points when better cross-context settlement feedback is needed:
  - `frontend/src/api/cashAdmin.js`
  - `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `backend/scripts/test-cari-ou11-settlement-report-feedback.js`

### Checklist

#### Reports, drilldowns, and feedback
- [ ] Propagate owner / collector context into settlement reports and drilldowns
- [ ] Expose `originatingCrossContextSettlementBatchId` when needed for support/debug visibility
- [ ] Add owner / collector context visibility in settlement UI
- [ ] Add cross-context indicator in settlement UI
- [ ] Add warning when settlement will self-balance across contexts
- [ ] Add helpful message for missing current-account setup
- [ ] Surface better cross-context settlement feedback in cash-triggered flows when touched

#### Regression
- [ ] Create `backend/scripts/test-cari-ou11-settlement-report-feedback.js`
- [ ] Test collector vs owner context is visible consistently in reports and drilldowns
- [ ] Test operator feedback is clear for mixed-owner and missing-mapping problems

### Acceptance
- [ ] Collector vs owner context is visible consistently in settlement reports and drilldowns
- [ ] Operator feedback is clear for mixed-owner and missing-mapping problems

## PR-OU12 - Frontend finishing for transfers, inventory, and settlement visibility

### Goal
- Finish the operator-facing UI surfaces for transfer workflow, inventory visibility, and settlement context display.

### Files
- `frontend/src/api/inventory.js`
- `frontend/src/api/itemCards.js`
- `frontend/src/api/cariSettlements.js`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `frontend/src/pages/inventory/ItemCardsPage.jsx`
- `frontend/src/pages/cari/CariSettlementsPage.jsx`
- `frontend/src/i18n/messages.js`

### Checklist

#### Inventory transfer UI
- [ ] Finalize transfer list filters
- [ ] Finalize transfer detail view
- [ ] Finalize transfer route wiring in `App.jsx`
- [ ] Finalize transfer sidebar entry wiring in `sidebarConfig.js`
- [ ] Keep the transfer sidebar item marked `implemented: true` in `sidebarConfig.js`
- [ ] Show source ownership context
- [ ] Show target ownership context
- [ ] Show approval / shipment / receipt / reversal status clearly
- [ ] Show shipment journal reference
- [ ] Show receipt journal reference
- [ ] Show evidence panel
- [ ] Show action buttons with correct state gating

#### Existing inventory pages
- [ ] Show `INVENTORY_TRANSFER` source badge on movement pages
- [ ] Show transfer reference on transfer-generated movements
- [ ] Reduce confusion between manual / stock-link / transfer movement types

#### Item cards, settlement UI, and i18n
- [ ] Finalize item-card transit account UI
- [ ] Finalize settlement owner / collector context display
- [ ] Add texts for ownership scope
- [ ] Add texts for transfer lifecycle
- [ ] Add texts for transfer evidence
- [ ] Add texts for cross-context settlement warnings / errors
- [ ] Keep transfer route/sidebar gating on existing `inventory.read` / `inventory.upsert` permission family
- [ ] Finalize `messages.sidebar.byPath` TR/EN labels for the transfer route

### Acceptance
- [ ] UI fully supports warehouse ownership, transfers, evidence, and settlement context visibility
- [ ] Transfer route/sidebar/messages wiring is aligned with repo standards
- [ ] Operator-facing wording and visibility are aligned across inventory and settlement screens

## PR-OU13 - OpenAPI, release gates, and rollout docs

### Goal
- Finish the public contract, regression gates, and rollout documentation for the whole feature set.

### Files
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/scripts/fixtures/rswire03-release-gate-manifest.json`
- `backend/scripts/test-ux-rswire01-cross-file-wiring.js`
- `backend/scripts/test-ux-rswire02-implemented-routes-ci-guard.js`
- `backend/scripts/test-ux-rswire03-release-gate-smoke-coverage.js`
- new release-gate scripts
- docs under `PR-STEPS/` / `docs/`

### Checklist

#### OpenAPI
- [ ] Finalize payload shapes
- [ ] Add explicit schemas for warehouse ownership fields
- [ ] Add explicit schemas for inventory transfers
- [ ] Add explicit schemas for transfer evidence
- [ ] Add explicit schemas for `inventoryTransitAccountId`
- [ ] Add explicit schemas for settlement owner / collector context
- [ ] Add explicit schemas for `originatingCrossContextSettlementBatchId`
- [ ] Add explicit schemas for reverse-direction central `<->` OU org fields:
  - `central_due_to_account_id`
  - `ou_due_from_central_account_id`
- [ ] Regenerate `backend/openapi.yaml`

#### Release gates
- [ ] Add warehouse-ownership regression to CI flow
- [ ] Add transfer-foundation regression to CI flow
- [ ] Add OU-account-foundation regression to CI flow
- [ ] Add shipment self-balancing regression to CI flow
- [ ] Add receipt regression to CI flow
- [ ] Add reversal / bypass regression to CI flow
- [ ] Add transfer evidence regression to CI flow
- [ ] Add cross-context settlement regressions to CI flow
- [ ] Optionally add aggregate gate `backend/scripts/test-ou-self-balancing-release-gate.js`
- [ ] Add new regression scripts to `backend/package.json`
- [ ] Add new regression scripts to CI / release-gate runner
- [ ] Add transfer route manifest entry to `backend/scripts/fixtures/rswire03-release-gate-manifest.json`
- [ ] Lock the exact transfer-route manifest triple in `backend/scripts/fixtures/rswire03-release-gate-manifest.json`:
  - `routePath = "/app/stok-transferleri"`
  - `smokeScriptPath = "backend/scripts/test-ou-self-balancing-release-gate.js"`
  - `packageScriptName = "test:ou:self-balancing:release-gate"`
- [ ] Add the transfer route to `ROUTE_WIRING_RULES` in `backend/scripts/test-ux-rswire01-cross-file-wiring.js`
- [ ] Lock the exact `apiNeedles` entry for the transfer route in `ROUTE_WIRING_RULES`:
  - `apiNeedles = ["../../api/inventory.js"]`
- [ ] Ensure `backend/package.json` exposes `npm run test:ux:rswire01` in the release-gate path that covers this feature
- [ ] Add OpenAPI drift check to release gate
- [ ] Ensure OpenAPI drift check runs in the same release-gate path as the new regressions
- [ ] Ensure the implemented transfer route passes existing `RS-WIRE-01` cross-file route/API wiring checks
- [ ] Ensure the implemented transfer route passes existing RS-WIRE sidebar/i18n and manifest coverage guards

#### Rollout docs
- [ ] Add operator note for warehouse ownership setup
- [ ] Add operator note for transfer approval requirement
- [ ] Add operator note for item transit account requirement
- [ ] Add operator note for missing OU current-account mapping failures
- [ ] Add transfer lifecycle runbook
- [ ] Add accounting examples for shipment / receipt / reversal
- [ ] Add cross-context settlement examples
- [ ] Add troubleshooting for blocked generic cross-context stock movement
- [ ] Add note that first-class cross-context collection document is still future scope

### Acceptance
- [ ] OpenAPI fully documents the feature
- [ ] Release gates cover the new behavior
- [ ] Operators have clear runbooks and troubleshooting docs

## Recommended exact implementation order
- [x] 1. Create `m123_inventory_warehouse_ownership_scope.js`
- [x] 2. Update warehouse validators / queries / create logic
- [x] 3. Update warehouse frontend form/list
- [x] 4. Create `m124_inventory_transfer_foundation.js`
- [x] 5. Build transfer validators / routes / service skeleton
- [x] 6. Add transfer page shell
- [x] 7. Create `m125_operating_unit_reverse_internal_current_accounts.js`
- [x] 8. Extend org setup and create `ou.self-balancing.service.js`
- [x] 9. Create `m126_item_cards_inventory_transit_account.js`
- [x] 10. Expose transit account in item-card backend/frontend
- [x] 11. Implement transfer approval + shipment FIFO + accounting
- [x] 12. Implement transfer receipt
- [x] 13. Implement transfer cancel / reverse
- [x] 14. Block generic cross-context movement bypass
- [x] 15. Generalize evidence service and transfer evidence routes/UI
- [x] 16. Create `m128_cari_settlement_owner_collector_contexts.js`
- [x] 17. Implement settlement owner / collector resolvers and persistence
- [x] 18. Implement cross-context settlement posting split
- [x] 19. Implement strict reversal dependency and explicit downstream linkage
- [ ] 20. Propagate settlement reports/drilldowns and operator feedback
- [ ] 21. Finish transfer/inventory/settlement frontend polish
- [ ] 22. Finish OpenAPI / release gates / docs

## Done definition
- [x] Warehouses are explicitly central or OU-owned
- [x] Cross-context stock transfers use dedicated transfer workflow only
- [x] Transfer lifecycle includes approval, shipment, receipt, and additive reversal
- [x] Shipment-time internal balancing works and is auditable
- [x] Reverse-direction central `<->` OU accounts exist and are configured
- [x] Receipt / cancel / reversal / evidence work
- [x] Generic inventory movement bypass is blocked in backend
- [x] Cross-context CARI settlement owner vs collector split works
- [ ] Settlement reports and drilldowns surface owner vs collector context correctly
- [x] Non-self-balanced cross-context settlement is blocked
- [ ] UI, OpenAPI, release gates, and docs are aligned
