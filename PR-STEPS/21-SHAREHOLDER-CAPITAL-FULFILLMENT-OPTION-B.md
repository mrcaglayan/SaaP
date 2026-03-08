# 21 - SHAREHOLDER CAPITAL FULFILLMENT (OPTION B)

## Locked decisions
- Keep `500/501` and shareholder capital/commitment lines central. Do not allow OU on those lines.
- For OU-targeted fulfillment, use Option B 4-line posting:
  - `Dr destination asset or bank` `(OU = selected branch)`
  - `Cr ou_due_to_central_account_id` `(OU = selected branch)`
  - `Dr central_due_from_account_id` `(no OU)`
  - `Cr shareholder.commitment_debit_sub_account_id` `(no OU)`
- Paid capital must continue to come from posted credits to each shareholder's exact mapped `commitment_debit_sub_account_id`.
- Do not weaken existing central-equity validation in GL.
- OU internal current account mappings must be per operating unit, not per legal entity purpose mapping.
- The design must support both operational models:
  - `HQ-first funding`, where capital is fulfilled centrally first and allocated to the OU later
  - `direct OU-targeted fulfillment`, where the branch-targeted 4-line journal is posted immediately
- For v1 destination modes use only `BANK_ACCOUNT` and `ASSET_GL`.
- `ASSET_GL` means asset accounts only in v1.
- Do not support cash register destination in v1.
- Reuse shared GL reverse behavior if possible. Do not build a parallel reverse engine unless there is a proven gap.
- New migration numbering must start at `m108`.

## Revised target design
- Company capital and shareholder commitment remain central.
- OU self-balance is achieved through OU-specific internal current accounts.
- Bank fulfillment must go through `bank_accounts` master, not a raw GL picker.
- Branch cash/register destinations are out of scope for v1.
- Journal source type stays `SYSTEM` in v1, with linkage held in the fulfillment table.

## Setup and rollout sequence
- Initial setup wizard should cover legal entity, operating units, shareholders, shareholder account mapping, and capital commitment setup/posting.
- Initial setup wizard should not require a bank account, safe, or in-kind destination to already exist.
- Capital fulfillment should be a post-setup action after the user creates the required destination master data:
  - bank account for `BANK_ACCOUNT`
  - asset GL destination for `ASSET_GL`
- In v1, safe/cash register destinations remain out of scope even after setup.
- This keeps the installation flow lighter and avoids forcing bank-account setup before commitment can be recorded.

## Supported operational models
- `HQ-first funding`
  - Step 1: post a central-only fulfillment with no OU
  - Step 2: allocate from HQ to the operating unit using the configured internal current accounts
- `Direct OU-targeted fulfillment`
  - Post the Option B 4-line fulfillment journal in one step when an OU is selected
- V1 productizes central-only fulfillment and direct OU-targeted fulfillment in the shareholder workflow.
- In v1, the later `HQ -> OU` allocation step can use the existing journal tooling with the configured internal current accounts.
- If users need a dedicated `HQ -> OU` allocation workflow later, that can be added as a separate finance UX/API slice without changing the capital-fulfillment accounting model.

## Unified execution order
1. `PR-CF01` - OU internal current account mapping foundation
2. `PR-CF02` - Capital fulfillment schema and posting workflow
3. `PR-CF03` - Organization Management UI
4. `PR-CF04` - Reversal, reporting, and rollout hardening
5. `PR-CF05` - Cash/register integration later

## Master tracker
- [x] `PR-CF01` acceptance: `operating_units` supports internal HQ/branch current account mappings with backend and UI validation, including readiness surfacing on OU rows.
  smoke: `backend/scripts/test-shareholder-capital-cf01-ou-current-mappings.js`
- [x] `PR-CF02` acceptance: fulfillment preview/create/list/reverse APIs generate correct central-only or Option B 4-line journals, use `BANK_ACCOUNT` or asset-only `ASSET_GL`, preserve current paid-capital logic, and support both HQ-first and direct OU-targeted operating patterns.
  smoke: `backend/scripts/test-shareholder-capital-cf02-fulfillment-posting.js`
- [x] `PR-CF03` acceptance: finance users can record and preview capital fulfillment from Organization Management without manual journal construction.
  smoke: `backend/scripts/test-shareholder-capital-cf03-frontend-smoke.js`
- [x] `PR-CF04` acceptance: reversal and reporting are consistent, and shareholder paid/unpaid balances remain correct after post and reverse flows.
  smoke: `backend/scripts/test-shareholder-capital-cf04-reversal-reporting.js`

## PR-CF01
Goal:
- Make each OU branch self-balancing-capable for capital fulfillment.

Deliverables:
- Migration `m108_operating_unit_internal_current_accounts.js`
- Add nullable `operating_units.central_due_from_account_id`
- Add nullable `operating_units.ou_due_to_central_account_id`
- Add FK constraints to `accounts(id)`
- Extend OU read/write validators, service, queries, and routes
- Extend Organization Management OU form and OU list

Validation rules:
- Both accounts must belong to the same tenant
- Both accounts must belong to the same legal entity as the OU
- Both accounts must be active, postable, leaf accounts
- `central_due_from_account_id` must be asset-side and debit-normal appropriate
- `ou_due_to_central_account_id` must be liability-side and credit-normal appropriate
- The two accounts cannot be the same
- Neither account can be a central-equity posting account
- Automatic fulfillment posting must satisfy the same operating-unit reference rules the journal engine already enforces for the selected OU context

Read API additions:
- `central_due_from_account_id`
- `central_due_from_account_code`
- `central_due_from_account_name`
- `ou_due_to_central_account_id`
- `ou_due_to_central_account_code`
- `ou_due_to_central_account_name`
- `capital_self_balancing_ready`

Files:
- `backend/src/migrations/m108_operating_unit_internal_current_accounts.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/services/org.write.service.js`
- `backend/src/services/org.write.queries.js`
- `backend/src/services/org.read.queries.js`
- `backend/src/routes/org.js`
- `frontend/src/api/orgAdmin.js`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/i18n/messages.js`

Test coverage:
- Valid OU internal-current mappings save successfully
- Mismatched legal entity, invalid account type, inactive account, and non-leaf accounts are rejected
- Readiness flag is computed correctly on OU reads

## PR-CF02
Goal:
- Add a dedicated shareholder capital fulfillment workflow that supports both central-first and direct OU-targeted operating models.

Deliverables:
- Migration `m109_shareholder_capital_fulfillments.js`
- New table `shareholder_capital_fulfillments`
- New service `backend/src/services/org.capital-fulfillment.service.js`
- Endpoints:
  - `POST /api/v1/org/shareholders/capital-fulfillments/preview`
  - `POST /api/v1/org/shareholders/capital-fulfillments`
  - `GET /api/v1/org/shareholders/capital-fulfillments`
  - `POST /api/v1/org/shareholders/capital-fulfillments/:id/reverse`
- Use `journal_entries.source_type = SYSTEM`

Core table fields:
- `id`
- `tenant_id`
- `legal_entity_id`
- `shareholder_id`
- `operating_unit_id` nullable
- `destination_mode`
- `bank_account_id`
- `destination_account_id`
- `amount_base`
- `currency_code`
- `contribution_kind`
- `status`
- `journal_entry_id`
- `reversal_journal_entry_id`
- `contribution_date`
- `note`
- `created_by_user_id`
- `posted_by_user_id`
- `reversed_by_user_id`
- timestamps

Status enum for v1:
- `POSTED`
- `REVERSED`

Destination modes for v1:
- `BANK_ACCOUNT`
- `ASSET_GL`

Common validation rules:
- `shareholderId` is required
- `legalEntityId` is required
- Shareholder must belong to the selected legal entity
- Shareholder must have both:
  - `capital_sub_account_id`
  - `commitment_debit_sub_account_id`
- Amount must be positive
- Contribution date is required
- Fulfillment must credit the shareholder's exact `commitment_debit_sub_account_id`
- Exactly one destination input must be present:
  - `bankAccountId` for `BANK_ACCOUNT`
  - `destinationAccountId` for `ASSET_GL`

`BANK_ACCOUNT` rules:
- Input is `bankAccountId`
- Derive destination GL from `bank_accounts.gl_account_id`
- Bank account must belong to the same tenant and legal entity
- Bank account must be active
- Bank account must resolve to a valid GL account
- If `operatingUnitId` is provided:
  - bank account must belong to that exact OU
  - selected OU must have both internal current accounts configured
- If `operatingUnitId` is empty:
  - bank account must be valid for central use under current repo rules
  - treat this as a central bank account pattern, typically a bank account with no OU ownership unless existing bank-account logic already defines another allowed central-use pattern

`ASSET_GL` rules:
- Input is `destinationAccountId`
- Destination account must be:
  - asset account only
  - same tenant and legal entity
  - active
  - postable
  - leaf
  - not central equity
  - not one of the shareholder capital/commitment accounts
- If `operatingUnitId` is provided:
  - selected OU must have both internal current accounts configured

Journal logic:
- Central-only fulfillment when OU is empty:
  - `Dr destination account`
  - `Cr shareholder.commitment_debit_sub_account_id`
- OU-targeted fulfillment when OU is selected:
  - `Dr destination account` `(with OU)`
  - `Cr ou_due_to_central_account_id` `(with OU)`
  - `Dr central_due_from_account_id` `(no OU)`
  - `Cr shareholder.commitment_debit_sub_account_id` `(no OU)`

Operational model support:
- `Direct OU-targeted fulfillment`
  - use the OU-targeted 4-line journal above
- `HQ-first funding`
  - first post the central-only fulfillment above with no OU
  - later allocate from HQ to the target OU using the configured internal current accounts
  - the later allocation entry is:
    - `Dr central_due_from_account_id` `(no OU)`
    - `Cr HQ bank or central asset account` `(no OU)`
    - `Dr OU destination account` `(with OU)`
    - `Cr ou_due_to_central_account_id` `(with OU)`
  - in v1, this later allocation can use the existing journal tooling rather than a dedicated new workflow

Example:
- Shareholder fulfills `1,000,000` directly for Kabul branch bank:
  - `Dr Kabul Bank GL` `(OU Kabul)` `1,000,000`
  - `Cr 339.xx HO Current - Kabul` `(OU Kabul)` `1,000,000`
  - `Dr 136.xx Kabul Branch Current` `1,000,000`
  - `Cr shareholder.commitment_debit_sub_account_id` `1,000,000`

Files:
- `backend/src/migrations/m109_shareholder_capital_fulfillments.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/routes/org.js`
- `backend/src/services/org.capital-fulfillment.service.js`

Test coverage:
- Preview returns exact journal lines for central and OU-targeted fulfillment
- Central fulfillment posts the expected 2-line journal
- OU-targeted fulfillment posts the expected 4-line journal
- `BANK_ACCOUNT` respects bank master ownership and OU rules
- `ASSET_GL` rejects non-asset destinations
- Paid capital increases correctly because the mapped `commitment_debit_sub_account_id` is credited

## PR-CF03
Goal:
- Make fulfillment usable in the existing shareholder setup area.

Deliverables:
- Add a new Organization Management card or modal:
  - `Record Capital Fulfillment`
- Fields:
  - legal entity
  - shareholder
  - contribution date
  - amount
  - destination mode
  - bank account selector when `BANK_ACCOUNT`
  - destination account selector when `ASSET_GL`
  - optional operating unit
  - note
- Preview before post
- If OU selected:
  - require both OU internal current accounts
  - for `BANK_ACCOUNT`, filter bank accounts to selected legal entity and selected OU
- For central mode:
  - show only company-level bank accounts under repo rules
- Show generated journal lines in preview
- Show explanation that paid capital updates because the shareholder commitment account is credited
- Frontend must load bank accounts from the existing bank account API and apply legal-entity and OU filtering according to the selected mode
- Setup sequencing note:
  - this workflow is intentionally post-setup, not part of the initial installation wizard
  - users should create the required bank account or asset destination first, then return here to record fulfillment

Files:
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/api/orgAdmin.js`
- `frontend/src/api/bankAccounts.js`
- `frontend/src/i18n/messages.js`

## PR-CF04
Goal:
- Add safe reversal and clearer finance reporting.

Deliverables:
- Reverse endpoint:
  - `POST /api/v1/org/shareholders/capital-fulfillments/:id/reverse`
- Reversal rule:
  - Reuse shared GL reverse behavior if possible
  - Do not implement a separate reversal engine in org/shareholder fulfillment logic unless required by a missing capability
- Reverse flow expectations:
  - call shared GL reverse behavior
  - original journal must end up `REVERSED`
  - reversal journal linkage must follow existing GL conventions
  - fulfillment row stores resulting linkage and state only
- Fulfillment row update on reverse:
  - status -> `REVERSED`
  - persist `reversal_journal_entry_id`
  - persist `reversed_by_user_id` and reversal timestamp

Reporting:
- Add fulfillment list with:
  - shareholder
  - date
  - amount
  - OU
  - destination type
  - destination name
  - status
  - original journal
  - reversal journal
- In shareholder section continue showing:
  - committed capital
  - paid capital
  - unpaid capital
- In OU list show readiness:
  - `Central Due From: configured/missing`
  - `OU Due To HQ: configured/missing`

Files:
- `backend/src/routes/org.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/services/org.capital-fulfillment.service.js`
- `backend/src/services/org.read.queries.js`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/i18n/messages.js`

Test coverage:
- Reverse uses shared GL reverse semantics
- Original journal becomes `REVERSED`
- Reversal journal is linked correctly
- Fulfillment row updates correctly after reverse
- Paid capital falls back correctly after reverse

## PR-CF05
Goal:
- Later integration only.

Scope:
- Cash register destination support
- Cash-session aware posting
- Cash-control and approval integration

Rule:
- Do not include this in the first rollout.

## Recommended first implementation slice
1. `m108_operating_unit_internal_current_accounts`
2. `m109_shareholder_capital_fulfillments`
3. V1 destination modes only:
   - `BANK_ACCOUNT`
   - `ASSET_GL`
4. Reversal via shared GL reverse behavior
5. Fulfillment table statuses only:
   - `POSTED`
   - `REVERSED`
