# 22 - CASH REGISTER OWNERSHIP EXPLICITNESS (CENTRAL VS OU)

## Locked decisions
- Do not model `HQ` / `Central` as a normal `operating_units` row for cash-register ownership.
- Keep central cash posting context as `no OU`; central journals and subledger lines must continue using `operating_unit_id = null`.
- Make register ownership explicit with a dedicated `cash_registers.ownership_scope` field, not by relying on a blank OU selector in the UI.
- `ownership_scope` enum for v1:
  - `CENTRAL`
  - `OPERATING_UNIT`
- `ownership_scope = CENTRAL` requires `operating_unit_id = null`.
- `ownership_scope = OPERATING_UNIT` requires a valid `operating_unit_id`.
- Backfill existing cash registers:
  - `operating_unit_id IS NULL` -> `ownership_scope = CENTRAL`
  - `operating_unit_id IS NOT NULL` -> `ownership_scope = OPERATING_UNIT`
- Preserve backward compatibility during rollout:
  - old clients that omit `ownershipScope` may still be accepted temporarily
  - backend derives a default from `operatingUnitId` only during the transition period
- All register tables, selectors, and downstream workflows must show explicit ownership labels or badges.
- Transfer routing must use ownership-context differences, including:
  - `CENTRAL -> OPERATING_UNIT`
  - `OPERATING_UNIT -> CENTRAL`
  - `OPERATING_UNIT A -> OPERATING_UNIT B`
- Do not weaken existing cash-transit controls.

## Why this PR exists
- Today, leaving the OU selector empty effectively creates a central/HQ cash register.
- That behavior is technically valid but not explicit to the user.
- Users experience blank OU as "missing data", while the backend interprets it as "central ownership".
- This creates avoidable confusion in:
  - cash-register setup
  - transfer behavior
  - HQ vs branch mental model
  - shareholder-capital HQ-first cash transit follow-up flow

## Revised target design
- `cash_registers` explicitly declare ownership through `ownership_scope`.
- Central/HQ remains a business label, not a real OU dimension on central ledger lines.
- `operating_unit_id` remains nullable and continues to drive OU-aware posting rules.
- The UI must render central ownership explicitly as `Central / HQ` instead of `-` or blank.
- Register selection UX must make transfer behavior understandable before create:
  - same ownership context -> direct transfer
  - different ownership context -> transit workflow

## Unified execution order
1. `PR-CRO01` - ownership schema and API foundation
2. `PR-CRO02` - cash-register UI explicit ownership
3. `PR-CRO03` - downstream workflow clarity and transfer routing UX
4. `PR-CRO04` - rollout hardening, docs, and compatibility cleanup

## Master tracker
- [x] `PR-CRO01` acceptance: cash registers persist explicit ownership without changing central/no-OU accounting semantics.
  smoke: `backend/scripts/test-cash-register-ownership-cro01.js`
- [x] `PR-CRO02` acceptance: cash register create/edit/list UI uses explicit `Central / HQ` vs `Operating Unit` ownership instead of blank OU semantics.
  smoke: `backend/scripts/test-cash-register-ownership-cro02-frontend-smoke.js`
- [x] `PR-CRO03` acceptance: cash transaction, session, transit, and shareholder-capital flows show ownership clearly and route cross-context movements through transit.
  smoke: `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
- [x] `PR-CRO04` acceptance: rollout is documented, contracts are updated, and legacy blank-OU assumptions are removed from user-facing flows.
  smoke: `backend/scripts/test-cash-register-ownership-cro04-rollout.js`

## PR-CRO01
Goal:
- Add an explicit ownership model for cash registers while preserving existing accounting behavior.

Deliverables:
- Migration `m111_cash_register_ownership_scope.js`
- Add `cash_registers.ownership_scope`
- Backfill existing rows from current `operating_unit_id`
- Extend cash register validators, service, routes, and read queries
- Keep `operating_unit_id` nullable

Validation rules:
- `ownershipScope` is required for new clients
- Allowed values:
  - `CENTRAL`
  - `OPERATING_UNIT`
- If `ownershipScope = CENTRAL`:
  - `operatingUnitId` must be empty
- If `ownershipScope = OPERATING_UNIT`:
  - `operatingUnitId` is required
  - OU must belong to the same tenant
  - OU must belong to the same legal entity as the register
- `accountId`, cash-control checks, session rules, and existing register validations remain unchanged
- Central ownership must not result in a synthetic or fake HQ OU id

Read API additions:
- `ownership_scope`
- `ownership_context_label`

Compatibility rule:
- During rollout only:
  - if `ownershipScope` is omitted and `operatingUnitId` is empty, treat as `CENTRAL`
  - if `ownershipScope` is omitted and `operatingUnitId` is present, treat as `OPERATING_UNIT`
- After frontend rollout is stable, write validation may be tightened to require explicit `ownershipScope`

Files:
- `backend/src/migrations/m111_cash_register_ownership_scope.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/cash.register.validators.js`
- `backend/src/routes/cash.register.routes.js`
- `backend/src/services/cash.register.service.js`
- `backend/src/services/cash.queries.js`
- `backend/openapi.yaml`

Test coverage:
- Backfill sets `CENTRAL` for null-OU registers
- Backfill sets `OPERATING_UNIT` for OU-owned registers
- `CENTRAL + operatingUnitId` is rejected
- `OPERATING_UNIT` without `operatingUnitId` is rejected
- Existing read APIs expose `ownership_scope` correctly

## PR-CRO02
Goal:
- Make cash-register ownership explicit in create/edit/list UX.

Deliverables:
- Add an ownership selector on cash register forms:
  - `Central / HQ`
  - `Operating Unit`
- Show OU picker only when `Operating Unit` is selected
- Clear OU automatically when switching to `Central / HQ`
- Render `Central / HQ` in tables instead of `-`
- Add ownership badges or labels in register cards and selectors

UX rules:
- An empty OU field must no longer be the primary user-facing way to choose central ownership
- The form must explain that `Central / HQ` still posts with no OU dimension
- When editing existing rows, ownership selector must reflect persisted state
- Existing account and legal-entity filtering behavior remains intact

Files:
- `frontend/src/pages/cash/CashRegistersPage.jsx`
- `frontend/src/api/cashAdmin.js`
- `frontend/src/i18n/messages.js`

Test coverage:
- Create form can save a `Central / HQ` register without OU
- Create form requires OU for `Operating Unit`
- Edit form preserves ownership correctly
- Table/list renders `Central / HQ` instead of blank OU

## PR-CRO03
Goal:
- Make downstream cash workflows understandable and ownership-aware before users post anything.

Deliverables:
- Update register selectors in:
  - cash transactions
  - cash sessions
  - cash transit transfers
  - shareholder-capital fulfillment cash shortcut flows
- Show explicit ownership context on source and target registers:
  - `Central / HQ`
  - `OU: <code>`
- Show transfer-mode guidance before create:
  - `Direct transfer`
  - `Transit workflow required`
- Keep automatic transit initiation for cross-context transfer create from `Kasa Islemleri`
- Reject invalid direct cross-context transfer create at API layer
- Align error text and mapping with `different operating-unit contexts`

Behavior rules:
- `CENTRAL -> CENTRAL` may remain direct
- `CENTRAL -> OPERATING_UNIT` must use transit
- `OPERATING_UNIT -> CENTRAL` must use transit
- `OPERATING_UNIT A -> OPERATING_UNIT B` must use transit
- Same-OU branch register pairs may remain direct under current repo rules

Read/API additions where helpful:
- register ownership fields on transaction and transit rows if needed for table display
- clearer error mapping for transit-required cases

Files:
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/pages/cash/CashSessionsPage.jsx`
- `frontend/src/pages/cash/CashTransitTransfersPage.jsx`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/i18n/messages.js`
- `backend/src/routes/cash.transaction.validators.js`
- `backend/src/services/cash.transaction.service.js`
- `backend/src/services/cash.service.js`

Test coverage:
- `Central / HQ -> branch` create routes to transit workflow
- `branch -> Central / HQ` create routes to transit workflow
- same-context direct transfer stays direct
- UI copy warns users before they create a transit-required move
- shareholder-capital HQ-first follow-up shortcut shows branch-only destination choices explicitly

## PR-CRO04
Goal:
- Finish rollout safely and remove legacy ambiguity from docs and contracts.

Deliverables:
- Update runbooks and setup guidance
- Update OpenAPI / contract snapshots
- Add release-gate coverage for ownership-scope behavior
- Review bootstrap and cash setup copy for any remaining "blank means HQ" assumptions
- Add migration/backfill rollback notes

Docs and rollout notes:
- Cash-register setup docs must say `Central / HQ` explicitly
- Transit workflow docs must refer to `different operating-unit contexts`, not only `cross-OU`
- Shareholder-capital HQ-first runbook should reference the same ownership language

Files:
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/shareholder-capital-fulfillment-operations.md`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/scripts/test-release-gate.js`

Test coverage:
- Release gate includes ownership-scope smoke coverage
- OpenAPI reflects new cash-register payload and response fields
- Docs mention `Central / HQ` ownership explicitly

## Recommended first implementation slice
1. Add `ownership_scope` with backfill
2. Expose it on cash register reads and writes
3. Update `CashRegistersPage` to make ownership explicit
4. Update transfer UI to show direct vs transit behavior clearly
5. Tighten create-time validation so invalid cross-context drafts are never created
