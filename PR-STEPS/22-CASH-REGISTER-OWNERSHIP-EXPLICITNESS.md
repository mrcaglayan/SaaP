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
- Rollout completion state:
  - cash-register writes now require explicit `ownershipScope`
  - legacy blank-OU ownership derivation has been removed from write validation
- All register tables, selectors, and downstream workflows must show explicit ownership labels or badges.
- Transfer routing must use ownership-context differences, including:
  - `CENTRAL -> OPERATING_UNIT`
  - `OPERATING_UNIT -> CENTRAL`
  - `OPERATING_UNIT A -> OPERATING_UNIT B`
- Do not weaken existing cash-transit controls.
- Cross-context transfer accounting must use configured OU internal current-account mappings when different ownership contexts are involved.
- Bank-linked cash transactions also follow the same ownership-context rule when the selected bank account belongs to a different context than the cash register.
- Do not hardcode `136` / `339`; those are chart-specific examples only.
- This PR is about generic cross-context cash movement only; it must stay separate from shareholder-capital fulfillment logic and must not introduce shareholder commitment / paid-capital lines.

## Why this PR exists
- Today, leaving the OU selector empty effectively creates a central/HQ cash register.
- That behavior is technically valid but not explicit to the user.
- Users experience blank OU as "missing data", while the backend interprets it as "central ownership".
- This creates avoidable confusion in:
  - cash-register setup
  - transfer behavior
  - HQ vs branch mental model
  - shareholder-capital central-first cash transit follow-up flow

## Revised target design
- `cash_registers` explicitly declare ownership through `ownership_scope`.
- Central remains a business label, not a real OU dimension on central ledger lines.
- `operating_unit_id` remains nullable and continues to drive OU-aware posting rules.
- The UI must render central ownership explicitly as `Central` instead of `-` or blank.
- Register selection UX must make transfer behavior understandable before create:
  - same ownership context -> direct transfer
  - different ownership context -> transit workflow
- Physical transfer routing and balance-sheet self-balancing are separate concerns:
  - transit workflow controls the operational movement
  - internal current accounts determine the cross-context accounting result
- Reuse the same OU internal current-account setup that capital-fulfillment uses, but keep the business meaning separate:
  - `PR-CF02`: direct branch-targeted capital fulfillment can post to a branch directly while keeping shareholder commitment central
  - `PR-CRO05`: branch-to-branch or central-to-branch cash transfer has no shareholder-capital logic
- Missing current-account setup can now be completed from `Kasa Islemleri` during `Transfer Out` using saved-config repair:
  - `Center / Branch Current Accounts` for `CENTRAL <-> OPERATING_UNIT`
  - `Branch Pair Current Accounts` for `OPERATING_UNIT <-> OPERATING_UNIT`
- `Organization Management` remains the source-of-truth maintenance screen for OU internal-current mappings.

## Unified execution order
1. `PR-CRO01` - ownership schema and API foundation
2. `PR-CRO02` - cash-register UI explicit ownership
3. `PR-CRO03` - downstream workflow clarity and transfer routing UX
4. `PR-CRO04` - rollout hardening, docs, and compatibility cleanup
5. `PR-CRO05` - cross-context transfer accounting and OU self-balancing
6. `PR-CRO06` - inline branch-pair saved-config repair from `Kasa Islemleri`
7. `PR-CRO07` - inline central current-account saved-config repair from `Kasa Islemleri`

## Master tracker
- [x] `PR-CRO01` acceptance: cash registers persist explicit ownership without changing central/no-OU accounting semantics.
  smoke: `backend/scripts/test-cash-register-ownership-cro01.js`
- [x] `PR-CRO02` acceptance: cash register create/edit/list UI uses explicit `Central` vs `Operating Unit` ownership instead of blank OU semantics.
  smoke: `backend/scripts/test-cash-register-ownership-cro02-frontend-smoke.js`
- [x] `PR-CRO03` acceptance: cash transaction, session, transit, and shareholder-capital flows show ownership clearly and route cross-context movements through transit.
  smoke: `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
- [x] `PR-CRO04` acceptance: rollout is documented, contracts are updated, and legacy blank-OU assumptions are removed from user-facing flows.
  smoke: `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- [x] `PR-CRO05` acceptance: completed cross-context transfer accounting resolves through configured OU internal current accounts, keeps `Central` as `no OU`, and leaves OU balance-sheet slices self-balanced without hardcoded chart codes.
  smoke: `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`
- [x] `PR-CRO06` acceptance: `OU -> OU` transfer-out can create missing branch-pair child accounts and both directional partner mappings inline from `Kasa Islemleri`.
  smoke: `backend/scripts/test-cash-register-ownership-cro06-auto-provision.js`
- [x] `PR-CRO07` acceptance: `Central <-> OU` transfer-out can create missing central current child accounts and update the OU mapping inline from `Kasa Islemleri`.
  smoke: `backend/scripts/test-cash-register-ownership-cro07-central-auto-provision.js`

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
- Rollout compatibility is complete:
  - `ownershipScope` is now required on writes
  - old clients must send explicit `CENTRAL` or `OPERATING_UNIT`

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
  - `Central`
  - `Operating Unit`
- Show OU picker only when `Operating Unit` is selected
- Clear OU automatically when switching to `Central`
- Render `Central` in tables instead of `-`
- Add ownership badges or labels in register cards and selectors

UX rules:
- An empty OU field must no longer be the primary user-facing way to choose central ownership
- The form must explain that `Central` still posts with no OU dimension
- When editing existing rows, ownership selector must reflect persisted state
- Existing account and legal-entity filtering behavior remains intact

Files:
- `frontend/src/pages/cash/CashRegistersPage.jsx`
- `frontend/src/api/cashAdmin.js`
- `frontend/src/i18n/messages.js`

Test coverage:
- Create form can save a `Central` register without OU
- Create form requires OU for `Operating Unit`
- Edit form preserves ownership correctly
- Table/list renders `Central` instead of blank OU

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
  - `Central`
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
- `Central -> branch` create routes to transit workflow
- `branch -> Central` create routes to transit workflow
- same-context direct transfer stays direct
- UI copy warns users before they create a transit-required move
- shareholder-capital central-first follow-up shortcut shows branch-only destination choices explicitly

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
- Cash-register setup docs must say `Central` explicitly
- Transit workflow docs must refer to `different operating-unit contexts`, not only `cross-OU`
- Shareholder-capital central-first runbook should reference the same ownership language

Files:
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/shareholder-capital-fulfillment-operations.md`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/scripts/test-release-gate.js`

Test coverage:
- Release gate includes ownership-scope smoke coverage
- OpenAPI reflects new cash-register payload and response fields
- Docs mention `Central` ownership explicitly

## PR-CRO05
Goal:
- Define the missing accounting rule for completed cross-context transfers so branch / OU balance-sheet slices can self-balance without hardcoded chart codes.

Deliverables:
- Reuse the existing OU setup mappings from `Organization Management` for `CENTRAL <-> OPERATING_UNIT`:
  - `operating_units.central_due_from_account_id`
  - `operating_units.ou_due_to_central_account_id`
- Add direct OU-pair current-account mappings for `OPERATING_UNIT <-> OPERATING_UNIT`:
  - source OU + partner OU
  - `due_from_account_id`
  - `due_to_account_id`
- Extend cross-context cash transfer posting logic so operational transit and final accounting result are both explicit.
- Apply the same self-balancing accounting rule to `DEPOSIT_TO_BANK` / `WITHDRAWAL_FROM_BANK` when the bank account ownership context differs from the cash register context.
- Block completion of cross-context transfers when the required source/target OU internal current-account setup is missing.
- Enforce branch-specific uniqueness for both OU central mappings and OU-pair mappings within the same legal entity.
- Surface resolved internal-current-account usage in transfer details, previews, or diagnostics where helpful.
- Document this as the canonical accounting pattern for any later OU-owned bank-to-bank transfer workflow as well.
- Allow finance users to create missing current-account child accounts inline from `Kasa Islemleri` `Transfer Out` without leaving the page.

Accounting rules:
- Do not hardcode `136` / `339`.
- Use mapped `account_id` values; `136` / `339` are only common chart examples.
- Keep the accounting case distinct from shareholder capital fulfillment:
  - `PR-CF02` may post a direct branch-targeted fulfillment while the shareholder commitment credit stays central / `no OU`
  - `PR-CRO05` posts generic cross-context cash movement only; no shareholder capital / commitment accounts appear in these transfer journals
- Same-context transfers remain on current behavior:
  - `CENTRAL -> CENTRAL`
  - `same OU -> same OU`
- Different-context transfers still use transit operationally, but the completed economic result must be equivalent to these self-balancing patterns:
  - `CENTRAL -> OPERATING_UNIT`
    - `Cr source central cash/register`
    - `Dr target OU's central_due_from_account_id` `(no OU)`
    - `Dr target OU cash/register` `(with OU)`
    - `Cr target OU's ou_due_to_central_account_id` `(with OU)`
  - `OPERATING_UNIT -> CENTRAL`
    - `Cr source OU cash/register` `(with OU)`
    - `Dr source OU's ou_due_to_central_account_id` `(with OU)`
    - `Dr target central cash/register`
    - `Cr source OU's central_due_from_account_id` `(no OU)`
  - `OPERATING_UNIT A -> OPERATING_UNIT B`
    - `Cr source OU A cash/register` `(with OU A)`
    - `Dr OU A's due_from_account_id for OU B` `(with OU A)`
    - `Dr target OU B cash/register` `(with OU B)`
    - `Cr OU B's due_to_account_id for OU A` `(with OU B)`
- Central lines remain `operating_unit_id = null`.
- OU-targeted lines continue to carry the exact source or target OU context.
- For `OPERATING_UNIT A -> OPERATING_UNIT B`, no synthetic HQ / `no OU` bridge lines should appear; inter-branch receivable/payable stays directly on the source and target branches.

Validation rules:
- `CENTRAL -> OPERATING_UNIT` requires the target OU to be self-balancing ready.
- `OPERATING_UNIT -> CENTRAL` requires the source OU to be self-balancing ready.
- `OPERATING_UNIT A -> OPERATING_UNIT B` requires direct OU-pair mappings in both directions before transfer-out is posted.
- Source and target registers must still obey current ownership-context routing rules.
- Missing OU internal-current-account mapping must fail with an actionable error that points users to `Kasa Islemleri` `Transfer Out` or `Organization Management`.
- `central_due_from_account_id` must not be shared by multiple operating units in the same legal entity.
- `ou_due_to_central_account_id` should not be shared by multiple operating units in the same legal entity; block duplicates in setup and posting.
- OU-pair `due_from_account_id` / `due_to_account_id` must be partner-specific and must not be reused across multiple branch pairs in the same legal entity.
- Cross-context transfer accounting must not invent a synthetic HQ OU row for branch-to-branch transfers.

Files:
- `backend/src/services/cash.transaction.service.js`
- `backend/src/services/cash.service.js`
- `backend/src/services/cash.queries.js`
- `backend/src/services/org.write.service.js`
- `backend/src/routes/cash.transaction.validators.js`
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/pages/cash/CashTransitTransfersPage.jsx`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/api/orgAdmin.js`
- `frontend/src/i18n/messages.js`
- `docs/runbooks/cari-v1-operations.md`
- `backend/src/routes/org.js`
- `backend/src/routes/org.write.validators.js`

Test coverage:
- `CENTRAL -> CENTRAL` stays on direct/current behavior with no internal-current lines.
- `same OU -> same OU` stays on direct/current behavior with no internal-current lines.
- `CENTRAL -> OU` resolves through the selected OU's configured internal current accounts.
- `OU -> CENTRAL` resolves through the selected OU's configured internal current accounts.
- `OU A -> OU B` resolves through both OUs' configured internal current accounts.
- `Central bank -> OU cash` and `OU cash -> central bank` resolve through the same configured OU current accounts.
- Missing source/target OU setup blocks completion with actionable error text.
- Duplicate OU internal-current mappings are rejected at setup time and also block posting if legacy bad data already exists.
- Posted lines keep central rows `no OU` and branch rows on the correct OU.
- Posted `no OU` bridge lines keep `subledger_reference_no = null`.
- `Kasa Islemleri` inline setup can auto-create missing central current child accounts from selected parents.
- `Kasa Islemleri` inline setup can auto-create both directional branch-pair child-account mappings from selected parents.

## PR-CRO06
Goal:
- Let finance users create missing `OU <-> OU` partner current accounts inline from `Kasa Islemleri` while preparing `Transfer Out`.

Deliverables:
- Detect missing direct branch-pair mappings after source and target safes are selected.
- Show the `Branch Pair Current Accounts` helper card on `Kasa Islemleri`.
- Let the user choose parent asset/liability accounts, auto-create the next child accounts under those parents, and save both directional mappings in one operation.
- Reuse existing mappings without creating duplicates.

Files:
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/api/orgAdmin.js`
- `backend/src/routes/org.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/services/org.write.service.js`
- `backend/scripts/test-cash-register-ownership-cro06-auto-provision.js`

Test coverage:
- Fresh inline branch-pair auto-provision creates both directional mappings.
- Existing mappings are reused without duplicate child-account creation.
- Partial legacy setup is completed safely.
- Invalid parent-account types are rejected.

## PR-CRO07
Goal:
- Let finance users create missing `Central <-> OU` current accounts inline from `Kasa Islemleri` while preparing `Transfer Out`.

Deliverables:
- Detect missing OU-level central current mappings after source and target safes are selected.
- Show the `Center / Branch Current Accounts` helper card on `Kasa Islemleri`.
- Let the user choose parent asset/liability accounts, auto-create missing child accounts, and update the selected OU mapping in one operation.
- Reuse existing child accounts/mappings without duplicate creation.

Files:
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/api/orgAdmin.js`
- `backend/src/routes/org.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/services/org.write.service.js`
- `backend/scripts/test-cash-register-ownership-cro07-central-auto-provision.js`

Test coverage:
- Fresh inline central auto-provision creates both mapped child accounts.
- Existing central mappings are reused without duplicate child-account creation.
- Partial legacy setup is completed safely.
- Invalid parent-account types are rejected.

## Recommended first implementation slice
1. Add `ownership_scope` with backfill
2. Expose it on cash register reads and writes
3. Update `CashRegistersPage` to make ownership explicit
4. Update transfer UI to show direct vs transit behavior clearly
5. Tighten create-time validation so invalid cross-context drafts are never created
