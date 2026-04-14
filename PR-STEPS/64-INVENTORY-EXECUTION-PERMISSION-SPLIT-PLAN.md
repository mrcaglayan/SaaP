# Inventory Execution Permission Split Plan

## Status

- Implemented in repo
- Repo state revalidated on April 14, 2026
- `PR-INVEXEC-01` completed
- `PR-INVEXEC-02` completed
- `PR-INVEXEC-03` completed
- Scope is inventory execution authority for branch accountants and related inventory roles
- Locked decision: `BranchOperator` must not inherit item-card master write, warehouse configuration, or landed-cost authoring just to run day-to-day stock operations
- Locked decision: scope remains OU-vs-legal-entity through role assignment scope; we will not create separate permission codes such as `branch.inventory.transfer.ship` vs `entity.inventory.transfer.ship`
- Locked decision: the current broad inventory operator roles stay available, but their authority is rebuilt on top of granular execution/setup permissions instead of the catch-all `inventory.upsert`
- Locked decision: once the split is complete, the default inventory companion for `BranchOperator` should be execution-capable, not viewer-only

---

## Goal

Allow branch accountants to do the inventory work they actually need:

- materialize pending receipt / issue stock links
- reverse their inventory movements when business rules allow it
- create, ship, receive, and cancel inventory transfers within the correct ownership context
- attach transfer evidence when the transfer workflow requires it

Without also allowing them to:

- create or edit item cards
- create or edit warehouses
- change warehouse receipt policy
- create or reverse landed-cost vouchers
- inherit transfer approval or transfer reversal governance by accident

---

## Out Of Scope

- redesigning item-card master-data roles
- removing `BranchInventoryOperator` or `EntityInventoryOperator`
- fixed-asset, cash, or CARI role redesign
- transfer workflow approval-policy redesign
- broad brownfield production migration complexity; fresh-reset or idempotent local rollout is acceptable in this track

---

## Current Repo Seams Confirmed

### Permission and role seeding

- `backend/src/seedCore.js`
- `backend/src/routes/security.js`
- `backend/src/services/localOperationalRoles.service.js`
- `frontend/src/pages/security/roleCatalog.js`

### Inventory runtime routes

- `backend/src/routes/inventory.routes.js`
- `backend/src/routes/inventory.transfer.routes.js`
- `backend/src/routes/inventory.transfer.evidence.routes.js`
- `backend/src/routes/inventory.landed-cost.routes.js`

### Inventory UI

- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `frontend/src/pages/inventory/InventorySettingsPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVouchersPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVoucherNewPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVoucherDetailPage.jsx`
- `frontend/src/pages/inventory/ItemCardsPage.jsx`

### Existing role/permission tests

- `backend/scripts/test-security-pr4a-duty-boundary-roles.js`
- `backend/scripts/test-security-branch-operator-management-smoke.js`
- `backend/scripts/test-inventory-invexec-branch-execution-smoke.js`
- `backend/scripts/test-inventory-pr26-release-gate.js`
- `backend/scripts/test-inventory-ou07-transfer-evidence.js`

---

## Current-State Findings

### Conflict / plan gap

- None at the implementation layer after aligning the stale regression scripts to the granular permission model.

### Deferred item already covered

- `PR-INVEXEC-01` is covered: granular inventory permissions are seeded, `BranchInventoryExecutor` exists, `BranchInventoryViewer` stays read-only, and the broad inventory operator roles are rebuilt from the granular permission family.
- `PR-INVEXEC-02` is covered: inventory routes and pages now use action-specific permissions, and transfer write scope resolves through source/target ownership context instead of a blanket legal-entity write fallback.
- `PR-INVEXEC-03` is covered: `BranchOperator` now auto-assigns `BranchInventoryExecutor`, redundant viewer companions are cleaned up, and visible existing branch-operator assignments reconcile to the new companion bundle.
- The dedicated branch-execution workflow smoke is now covered in `backend/scripts/test-inventory-invexec-branch-execution-smoke.js`, including OU-scoped materialize, transfer create/ship/receive, and the expected setup/governance denials for warehouse create, landed-cost write, item-card edit, and transfer approve/reverse.

### Optional hardening

- Transfer approval and transfer reversal can be split further later if the product wants maker/checker or elevated-governance separation beyond this first pass.
- If the product later wants a narrower legal-entity execution role, an `EntityInventoryExecutor` can be added on top of the same granular permission set without changing the permission taxonomy again.

---

## Target Permission Model

### Read permissions stay as-is

- `inventory.read`
- `item.card.read`
- `org.tree.read`
- `gl.account.read`

### New execution permissions

- `inventory.materialize`
- `inventory.movement.reverse`
- `inventory.transfer.create`
- `inventory.transfer.ship`
- `inventory.transfer.receive`
- `inventory.transfer.cancel`
- `inventory.transfer.evidence.upsert`

### New setup / governance permissions

- `inventory.warehouse.upsert`
- `inventory.landed_cost.upsert`
- `inventory.transfer.approve`
- `inventory.transfer.reverse`

### Existing separate master-data permission remains separate

- `item.card.upsert`

---

## Target Role Model

- `BranchInventoryViewer`
  - unchanged
  - read-only inventory visibility

- `BranchInventoryExecutor`
  - new
  - viewer set plus:
    - `inventory.materialize`
    - `inventory.movement.reverse`
    - `inventory.transfer.create`
    - `inventory.transfer.ship`
    - `inventory.transfer.receive`
    - `inventory.transfer.cancel`
    - `inventory.transfer.evidence.upsert`

- `BranchInventoryOperator`
  - kept for compatibility
  - rebuilt as:
    - `BranchInventoryExecutor`
    - `item.card.upsert`
    - `inventory.warehouse.upsert`
    - `inventory.landed_cost.upsert`
    - `inventory.transfer.approve`
    - `inventory.transfer.reverse`

- `EntityInventoryOperator`
  - kept broad at legal-entity scope
  - rebuilt on the same granular permission family as the broad branch operator

- `BranchOperator`
  - should not directly absorb the granular inventory permissions into its own permission list
  - should receive `BranchInventoryExecutor` as a bounded OU-scoped companion role after the new role is introduced

---

## Target Authorization Rules

- Stock-link materialization
  - authorize at the bound warehouse ownership context
  - OU-owned warehouse -> OU scope
  - central warehouse -> legal-entity scope

- Inventory movement reverse
  - authorize at the movement warehouse ownership context

- Inventory transfer create
  - authorize at the source ownership context
  - branch user can initiate a transfer out of their own OU-owned source warehouse without gaining legal-entity-wide transfer authority

- Inventory transfer ship
  - authorize at the source ownership context

- Inventory transfer receive
  - authorize at the target ownership context

- Inventory transfer cancel
  - authorize at the current actionable source context before shipment posts

- Inventory transfer evidence upsert
  - authorize for transfer participants using the transfer's resolved source/target ownership context rather than a blanket legal-entity fallback

- Warehouse setup and receipt-policy changes
  - remain explicit setup permissions and do not ride along with branch execution

- Landed-cost voucher create/reverse
  - remain explicit inventory-finance setup/posting permissions and do not ride along with branch execution

---

## Implementation Plan

# PR-INVEXEC-01 - Permission Taxonomy and Role Catalog Split

## Goal

Introduce granular inventory execution/setup permissions and a new execution-only branch role without breaking the existing broad operator roles.

## Files

- `backend/src/seedCore.js`
- `backend/src/routes/security.js`
- `backend/src/services/localOperationalRoles.service.js`
- `frontend/src/pages/security/roleCatalog.js`
- role/permission smoke tests

## Tasks

1. Add the new permission codes to the seed catalog.
2. Add `BranchInventoryExecutor` to the seeded role catalog.
3. Rebuild `BranchInventoryOperator` and `EntityInventoryOperator` from granular permissions so they preserve current broad behavior after route rewiring.
4. Keep `BranchInventoryViewer` unchanged.
5. Update role metadata, role labels, and companion-role helper seams so the new role is a first-class catalog concept.
6. Expand security smoke tests so the new role boundaries are explicit and regression-proof.

## Acceptance

- `BranchInventoryExecutor` can read inventory and perform execution actions, but lacks:
  - `item.card.upsert`
  - `inventory.warehouse.upsert`
  - `inventory.landed_cost.upsert`
  - `inventory.transfer.approve`
  - `inventory.transfer.reverse`
- `BranchInventoryOperator` still preserves broad inventory power-user authority after the split.
- No inventory route/UI still depends on the existence of a single broad `inventory.upsert` permission by the end of later PRs.

---

# PR-INVEXEC-02 - Route and UI Rewiring to Granular Permissions

## Goal

Replace broad `inventory.upsert` checks with action-specific permission gates and fix the transfer write-scope model so OU branch execution works end-to-end.

## Files

- `backend/src/routes/inventory.routes.js`
- `backend/src/routes/inventory.transfer.routes.js`
- `backend/src/routes/inventory.transfer.evidence.routes.js`
- `backend/src/routes/inventory.landed-cost.routes.js`
- `backend/src/services/inventory.transfer.service.js`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- `frontend/src/pages/inventory/InventoryTransfersPage.jsx`
- `frontend/src/pages/inventory/InventorySettingsPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVouchersPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVoucherNewPage.jsx`
- `frontend/src/pages/inventory/InventoryLandedCostVoucherDetailPage.jsx`

## Tasks

1. Replace stock-link materialization route guards from `inventory.upsert` to `inventory.materialize`.
2. Replace movement reverse route guards from `inventory.upsert` to `inventory.movement.reverse`.
3. Replace transfer route guards with:
   - `inventory.transfer.create`
   - `inventory.transfer.ship`
   - `inventory.transfer.receive`
   - `inventory.transfer.cancel`
   - `inventory.transfer.approve`
   - `inventory.transfer.reverse`
4. Replace transfer-evidence write route guards with `inventory.transfer.evidence.upsert`.
5. Replace warehouse create/update guards with `inventory.warehouse.upsert`.
6. Replace landed-cost create/reverse guards with `inventory.landed_cost.upsert`.
7. Patch transfer write-scope resolution so create/ship/receive/cancel/evidence actions use participant ownership context instead of blanket legal-entity write scope.
8. Split frontend write gating so:
   - stock reflection/materialization uses execution permissions
   - warehouse settings use warehouse setup permission
   - landed-cost pages use landed-cost permission
   - transfer actions use transfer-specific permissions
9. Update user-facing permission error text so it names the new granular permission, not the retired broad catch-all.

## Acceptance

- A branch-execution role can materialize ready stock links without being able to create warehouses.
- A branch-execution role can operate transfers at its authorized source/target OU context without requiring legal-entity inventory write authority.
- Warehouse settings remain blocked for branch-execution users unless they also hold the explicit warehouse setup permission.
- Landed-cost authoring and reversal remain blocked for branch-execution users unless they also hold the explicit landed-cost permission.

---

# PR-INVEXEC-03 - BranchOperator Companion Rollout

## Goal

Make branch accountants receive the new execution-capable inventory companion automatically, instead of only inheriting read-only inventory visibility.

## Files

- `backend/src/routes/security.js`
- `backend/src/services/localOperationalRoles.service.js`
- `frontend/src/pages/security/roleCatalog.js`
- branch-operator companion smoke tests

## Tasks

1. Change the inventory companion for `BranchOperator` from `BranchInventoryViewer` to `BranchInventoryExecutor`.
2. Avoid redundant dual assignment of both viewer and executor roles when executor already includes the viewer set.
3. Keep `BranchOperator` itself narrow; do not inline the execution permissions into the primary role definition.
4. Backfill or reset existing local assignments so already-assigned branch operators gain the new execution companion cleanly.
5. Update authority-preview and role-catalog UX copy so admins understand that branch accountants now get bounded inventory execution by default.

## Acceptance

- Assigning `BranchOperator` at OU scope auto-assigns `BranchInventoryExecutor` at the same OU scope.
- Existing branch-accountant scenarios like `keo@gmail.com` can read stock queues and perform allowed execution actions after rollout.
- The same branch users still cannot:
  - create/edit item cards
  - create/edit warehouses
  - create/reverse landed-cost vouchers
  - approve or reverse transfers unless another explicit role grants that authority

---

## Suggested Verification Matrix

- Security seed/role smoke:
  - new role has only execution permissions
  - broad operator roles preserve broad behavior
  - `BranchOperator` companion assignment changes from viewer to executor

- Inventory execution smoke:
  - OU-scoped branch user can materialize a ready AP receipt queue row
  - OU-scoped branch user can ship a transfer from their source OU
  - OU-scoped branch user can receive a transfer into their target OU
  - OU-scoped branch user cannot create a warehouse
  - OU-scoped branch user cannot create or reverse a landed-cost voucher
  - OU-scoped branch user cannot edit an item card

---

## Release Notes Intent

After this track, the product message should be:

- branch accountants are allowed to execute stock work
- inventory master/setup authority remains separate
- the old `inventory.upsert` catch-all is removed in favor of action-specific inventory permissions
