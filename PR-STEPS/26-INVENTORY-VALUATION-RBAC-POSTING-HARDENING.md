# 26 - INVENTORY VALUATION, RBAC, AND POSTING HARDENING

## Execution tracking
- This file is both the source/spec file and the execution tracker.
- Keep execution status in the `Master tracker` section below.

## Why this follow-up exists
- `25-CARI-LINES-ITEM-CARDS-INVENTORY-HANDSHAKE.md` completed the commercial line model, line tax model, item cards, and inventory foundation.
- That work intentionally stopped before full sell-side stock valuation and `COGS` posting.
- A few cross-system gaps remain:
  - CARI post UI still exposes manual `postingLines`, while backend rejects them for line-taxed documents.
  - Inventory and item-card modules still depend on `cari.card.read` / `cari.card.upsert`, so they cannot be governed separately from CARI card access.
  - Outbound stock movements still stop at `ISSUE + PENDING`, without cost-layer consumption or `Dr COGS / Cr Inventory`.
  - Inventory/item APIs are live, but OpenAPI still exposes them as generic auto-generated `System` endpoints.

## Current implementation facts that matter
- `frontend/src/pages/cari/CariDocumentsPage.jsx` still offers `usePostingLines` on draft post.
- `backend/src/services/cari.document.service.js` rejects `postingLines` when stored line taxes exist.
- `backend/src/routes/inventory.routes.js` and `backend/src/routes/item.card.routes.js` still use `cari.card.*` permissions.
- `backend/src/services/inventory.service.js` creates `RECEIPT` movements as `VALUED`, but `ISSUE` movements remain `PENDING`.
- `frontend/src/pages/inventory/ItemCardsPage.jsx` already captures `defaultCogsAccountId`, but outbound issue valuation does not consume it yet.
- `backend/openapi.yaml` currently exposes inventory/item endpoints as auto-generated generic contracts.

## Locked decisions
- Do not keep a visible UI path that the backend will reject. In this follow-up, line-taxed document posting and posting-line UX must be aligned.
- Inventory and item-card access must become first-class permissions, not a side effect of CARI card permissions.
- Sell-side stock accounting must become stock-driven:
  - issue quantity validation
  - cost-layer consumption
  - issue valuation finalization
  - `Dr COGS / Cr Inventory`
- The first outbound valuation rollout should remain compatible with the current warehouse foundation. No lot, serial, bin, or reservation model is required in this PR set.
- API contract quality must catch up with runtime reality. Inventory and item endpoints should have explicit domain tags, summaries, request bodies, and response schemas.

## Scope
- Align CARI post UX and backend rules for line-taxed documents.
- Introduce dedicated RBAC for inventory and item-card modules.
- Add outbound inventory valuation, cost-layer consumption, stock availability checks, and `COGS` posting.
- Harden docs and tests so this can be released without hidden dead paths.

## Non-goals
- No procurement order or sales order lifecycle.
- No lot, serial, bin, batch, or reservation engine.
- No destructive rewrite of existing posted inventory or CARI history.
- No full costing-method matrix beyond the currently chosen first method.
- No line-level AR/AP settlement redesign.

## Unified execution order
1. `PR-IV01` - Line-tax posting UX alignment
2. `PR-IV02` - Inventory and item-card RBAC split
3. `PR-IV03` - Outbound stock valuation and issue finalization
4. `PR-IV04` - Inventory-to-GL `COGS` posting
5. `PR-IV05` - OpenAPI, docs, and regression hardening

## Master tracker
- [x] `PR-IV01` acceptance: line-taxed documents no longer expose a user-facing posting path that backend rejects.
- [x] `PR-IV02` acceptance: inventory and item-card routes/pages/sidebar use dedicated permissions and can be assigned independently from CARI card access.
- [x] `PR-IV03` acceptance: outbound stock issues validate quantity, consume cost layers, and move from `PENDING` to a traceable valued state.
- [x] `PR-IV04` acceptance: valued stock issue can produce `Dr COGS / Cr Inventory` using item-card and inventory context without duplicating CARI revenue posting.
- [x] `PR-IV05` acceptance: inventory/item APIs have explicit OpenAPI contracts and regression coverage protects UX, RBAC, valuation, and posting.

## PR-IV01
Goal:
- Remove the current line-tax posting mismatch between frontend and backend.

Deliverables:
- Detect whether the selected CARI draft uses stored line taxes.
- If yes:
  - hide or disable `usePostingLines`, or
  - render an explicit explanation that split posting is unavailable for line-taxed documents.
- Keep non-line-taxed documents compatible with existing posting-line behavior if it is still needed.
- Normalize API/client-side errors so the operator sees a clear business message instead of a dead-end failure.

Files:
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `backend/src/services/cari.document.service.js`
- related smoke scripts if post flow assertions already exist

Acceptance:
- A line-taxed draft cannot reach a predictable backend rejection through visible post controls.
- A non-line-taxed draft still posts successfully with its supported options.
- The post panel communicates the rule clearly.

Notes:
- This PR should align UX and runtime first.
- Full support for manual split posting on line-taxed documents is explicitly out of scope unless a separate design is approved later.

## PR-IV02
Goal:
- Decouple inventory and item-card authorization from CARI card authorization.

Deliverables:
- Introduce dedicated permission codes, at minimum:
  - `inventory.read`
  - `inventory.upsert`
  - `item.card.read`
  - `item.card.upsert`
- Update backend route guards for:
  - item cards
  - warehouses
  - stock links
  - inventory movements
  - cost layers
- Update frontend permission checks:
  - sidebar items
  - pages
  - empty/error states
- Update provider/bootstrap or security tooling if needed so new permissions can be assigned cleanly.

Files:
- `backend/src/routes/inventory.routes.js`
- `backend/src/routes/item.card.routes.js`
- `backend/src/routes/security.js`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/inventory/ItemCardsPage.jsx`
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- any seed/bootstrap scripts that assume all permissions are granted

Acceptance:
- A user can have inventory read access without `cari.card.read`.
- A user can maintain item cards without broad CARI card maintenance if product policy allows it.
- Sidebar and page gating use the new permissions consistently.

Notes:
- Keep migration/backfill of existing role-permission assignments explicit. Do not silently strand current operators.

## PR-IV03
Goal:
- Turn outbound stock issue from a placeholder `PENDING` movement into a real valued inventory step.

Deliverables:
- Define outbound valuation flow for current warehouse foundation.
- Add stock availability validation before finalizing an issue.
- Consume receipt cost layers for issued quantity using the chosen first valuation method.
- Persist issue valuation result:
  - consumed layer references
  - valued quantity
  - valued total cost
  - final valuation status
- Keep traceability back to:
  - warehouse
  - item card
  - source CARI stock link
  - source CARI document line

Files:
- `backend/src/services/inventory.service.js`
- new inventory valuation helper/service if needed
- inventory migrations if issue-consumption tables are needed
- `frontend/src/pages/inventory/InventoryMovementsPage.jsx`
- rollout/regression scripts

Acceptance:
- An outbound issue cannot finalize beyond available stock unless explicit negative-stock policy is introduced.
- Receipt layers are consumed deterministically.
- Issue movement no longer stays permanently `PENDING` once valuation succeeds.
- Audit trail shows which layers were consumed.

Notes:
- If the current model lacks a proper consumption table, add one instead of overloading free-text notes.

## PR-IV04
Goal:
- Post `COGS` and inventory relief from valued outbound issues without duplicating revenue recognition already done by CARI.

Deliverables:
- Derive `COGS` account from item-card defaults or a clear fallback hierarchy.
- Derive inventory relief account from the item/inventory side consistently.
- Create GL posting for valued issues:
  - `Dr COGS`
  - `Cr Inventory`
- Ensure idempotency so re-running issue valuation does not double-post.
- Link issue valuation posting back to inventory movement and source stock link.
- Define reversal/void strategy for already-valued issues.

Files:
- `backend/src/services/inventory.service.js`
- GL posting service integration points
- item-card service if fallback resolution needs enrichment
- inventory/CARI linkage tables if posting references need storage
- regression scripts

Acceptance:
- A valued outbound issue can create one traceable journal entry.
- Reprocessing the same issue is idempotent.
- Revenue posting remains in CARI; inventory relief remains in inventory valuation.
- Item-card `defaultCogsAccountId` is actually used or a documented fallback is enforced.

Notes:
- This PR is where stock accounting stops being foundation-only and becomes financially complete for the current scope.

## PR-IV05
Goal:
- Harden contracts, docs, and release gates around the completed inventory flow.

Deliverables:
- Replace generic auto-generated OpenAPI entries for inventory and item-card routes with explicit tags and schemas.
- Document:
  - item-card permissions
  - inventory permissions
  - issue valuation lifecycle
  - `COGS` posting lifecycle
- Extend regression scripts to cover:
  - line-tax post UX gating
  - new RBAC behavior
  - receipt-to-issue valuation chain
  - `COGS` journal creation
  - reversal/idempotency where applicable
- Update runbooks or rollout docs if tenant flags or permission backfills are introduced.

Files:
- `backend/openapi.yaml`
- inventory/item route files
- `backend/package.json`
- backend scripts
- docs under `docs/` and `PR-STEPS/` as needed

Acceptance:
- Inventory/item endpoints are documented as domain endpoints, not generic `System` placeholders.
- Release-gate coverage exists for the new valuation and `COGS` flow.
- Rollout instructions are explicit if existing tenants need permission or data backfill.

Notes:
- Do not leave inventory valuation as a runtime-only behavior without contract and rollout evidence.
