# 36 - PAYROLL EFFECTIVE-DATED EMPLOYEE OWNERSHIP, OU-ATTRIBUTED ACCRUALS, AND SELF-BALANCED PAYROLL SETTLEMENTS

## Execution tracking

- This file is the execution tracker for filling the payroll ownership and settlement gap with an effective-dated employee ownership model.
- It aligns payroll to the repo’s already-implemented cross-context accounting direction:
  - bank accounts can already be central or OU-owned
  - the generic OU self-balancing helper already exists
  - payment batches already settle liabilities through a shared payment engine
- The missing part is payroll’s own attribution layer, not the base self-balancing engine.
- The goal of this tracker is to make payroll ownership explicit at employee level, preserve that ownership through payroll accounting artifacts, and invoke the same due-to / due-from settlement pattern the repo already uses for other cross-context flows.
- If product direction changes later, update this tracker before implementation continues.

## Scope

- effective-dated `employee_code -> owner context` master data
- ownership snapshot on payroll run lines
- import / review visibility for ownership resolution issues
- finalize-time hard block on unresolved ownership
- payroll accrual preview and posting by owner context
- payroll liability build by owner context
- payroll payment preparation that compares liability owner context vs selected paying bank context
- reuse of existing OU self-balancing accounts for cross-context payroll settlement
- payroll close-control checks for ownership completeness and settlement integrity
- OpenAPI, reporting, export, sync, and regression coverage for the new ownership contract

## Locked decisions for this tracker

- [x] V1 authority is effective-dated `employee_code -> owner context`, not `cost_center_code`.
- [x] `cost_center_code` remains informational and optional validation-only in V1.
- [x] One payroll run may legitimately contain employees from multiple owner contexts / OUs.
- [x] `payroll_runs.operating_unit_id` must **not** become the authoritative ownership field.
- [x] V1 does **not** implement percentage cost distribution.
- [x] Employee beneficiary banking remains employee / legal-entity scoped in V1.
- [x] Payroll liability ownership and payroll expense attribution both follow the resolved owner context in V1.
- [x] Statutory liabilities are split by owner context in V1, not kept only as one legal-entity aggregate row.
- [x] `NULL operating_unit_id` continues to mean central posting context, but payroll ownership master/snapshot/liability rows must also persist explicit `ownership_scope` so `NULL` never means unresolved by itself.
- [x] Cross-context payroll settlement must reuse `resolveOuSelfBalancingAccountsTx(...)`.
- [x] Employee-code normalization for payroll ownership is `trim().toUpperCase()` and must match beneficiary / liability flows.
- [x] V1 uses one locked run-level `ownership_as_of_date`; derive it from payroll period end and fall back to `pay_date` only when payroll period is absent or invalid.
- [x] Reversal runs copy original ownership snapshots exactly; OFF_CYCLE / RETRO imports resolve fresh against the target run's locked `ownership_as_of_date`.
- [x] `MISMATCH` is finalize-blocking in V1; it is not warning-only in this tracker.
- [x] Historical finalized payroll data created before these migrations is grandfathered for close-control purposes unless a one-time backfill is explicitly implemented.
- [x] Pre-POU non-finalized payroll runs, derived liabilities, and draft/approved payroll payment batches are not grandfathered; in V1 they must be cancelled and re-created under the new owner-context contract unless an explicit one-time backfill / re-resolution utility is delivered.
- [x] Statutory liability keys must include explicit owner-context identity, including central-vs-OU distinction.
- [x] `ownership_scope` values must stay identical across ownership master, payroll run lines, payroll liabilities, validators, and response contracts in V1: `CENTRAL | OPERATING_UNIT`.
- [x] Payroll payment preview remains available as a baseline liability summary, but when `bankAccountId` is supplied it must return backend-derived payer-vs-owner context evaluation for the selected bank; do not rely on client-only inference.
- [x] V1 treats payer context as current bank-account state at preview / prepare / post time; batch flows must re-read and revalidate the selected bank account rather than assume draft-time immutability.
- [x] Historical imported payroll rows keep original employee-code casing unless explicitly backfilled; read-side comparisons that span legacy and new rows must normalize before comparing where consistency matters.
- [x] V1 allows:
  - same-context payroll payment
  - central bank pays OU liability
  - OU bank pays central liability
- [x] OU bank paying another OU liability stays out of scope for V1 unless explicitly enabled later.

## Important repo guardrails

- [x] Do **not** add one owner OU to `payment_batches` header because payroll batches may be mixed-OU.
- [x] Persist owner context on payroll liabilities and expose it to payment posting at line level.
- [x] Do **not** keep settlement journal header totals equal to batch total once cross-context balancing lines are added; recompute totals from actual generated journal lines.
- [x] Keep `payment_batch_lines.settlement_journal_line_ref` backward-compatible; if multiple journal lines are created for one payment line, store the main payable-settlement line ref rather than redesigning this field in V1.
- [x] Do **not** make beneficiary bank setup OU-scoped in this tracker.
- [x] Keep payroll correction / reversal lineage additive and compatible with current `PAYROLL_RUN` source-link behavior.
- [x] Do **not** rely on live ownership lookup after payroll is finalized; snapshot ownership onto run lines and derived liabilities.
- [x] Refactor generic payment settlement posting to build the full journal line set first and derive header totals from generated lines; do not bolt payroll cross-context logic onto the current batch-total-first flow.
- [x] Do **not** keep payroll payment preview bank-blind if the UI must show settlement context; extend the backend preview contract with selected bank input and backend-evaluated payer-vs-owner results.
- [x] Extend generic payment batch list/detail queries, frontend API bindings, and UI to expose paying-bank OU and payroll-liability owner OU; payroll-only pre-prepare UI changes are insufficient.
- [x] Do **not** silently retrofit pre-POU in-flight payroll runs, liabilities, or payment batches into the new contract; cancel/re-create them unless a dedicated backfill utility is explicitly built.
- [x] Reuse existing `payroll_run_audit` action values in V1 unless dedicated ownership-audit actions are explicitly introduced with enum migration coverage.

## Out of scope for this tracker

- no percentage-based departmental or cost-center allocation
- no `cost_center_code -> operating_unit_id` authority model
- no OU-scoped beneficiary bank accounts
- no payroll-specific treasury module
- no OU-to-OU payroll settlement in V1
- no employee HR master redesign beyond payroll ownership records

## Master tracker

- [x] `PR-POU01` - Payroll employee ownership foundation
- [x] `PR-POU02` - Ownership snapshot on payroll run lines
- [x] `PR-POU03` - Import / review / finalize ownership validation
- [x] `PR-POU04` - OU-attributed payroll accrual preview and posting
- [x] `PR-POU05` - OU-attributed payroll liabilities
- [x] `PR-POU06` - Payroll payment preparation and UI ownership visibility
- [x] `PR-POU07` - Payroll settlement self-balancing posting
- [x] `PR-POU08` - Close controls, sync, overrides, reporting, and release gates

---

## `PR-POU01` - Payroll employee ownership foundation

### Goal

Create an effective-dated payroll owner-context master that can answer:

> Which owner context owns employee X for payroll date Y?

### Files

- `backend/src/migrations/m135_payroll_employee_owner_context_assignments.js`
- `backend/src/migrations/index.js`
- `backend/src/services/payroll.ownership.service.js`
- `backend/src/routes/payroll.ownership.routes.js`
- `backend/src/routes/payroll.ownership.validators.js`
- `backend/src/index.js`
- `frontend/src/api/payrollOwnership.js`
- `frontend/src/pages/payroll/PayrollEmployeeOwnershipPage.jsx`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `backend/scripts/test-payroll-pou01-employee-ownership-foundation.js`

### Checklist

#### Migration

- [x] Create `payroll_employee_owner_context_assignments`
- [x] Add `tenant_id`
- [x] Add `legal_entity_id`
- [x] Add `employee_code`
- [x] Add `employee_name_snapshot`
- [x] Add `ownership_scope ENUM('CENTRAL','OPERATING_UNIT')`
- [x] Add `operating_unit_id`
- [x] Add `effective_from`
- [x] Add `effective_to`
- [x] Add `status ENUM('ACTIVE','INACTIVE')`
- [x] Add `expected_cost_center_code` nullable
- [x] Add `source_type`
- [x] Add `notes`
- [x] Add audit timestamps / user columns
- [x] Add index `(tenant_id, legal_entity_id, employee_code, effective_from)`
- [x] Add index `(tenant_id, legal_entity_id, operating_unit_id, status)`
- [x] Add FK to `operating_units(id)`
- [x] Add FK coverage to `legal_entities`
- [x] Do not attempt overlap prevention by DB-only constraint; enforce no-overlap in service logic

#### Backend service and routes

- [x] Add list / detail / create / update / deactivate flows
- [x] Validate OU belongs to same tenant and legal entity
- [x] Require `operating_unit_id` when `ownership_scope = 'OPERATING_UNIT'`
- [x] Require `operating_unit_id IS NULL` when `ownership_scope = 'CENTRAL'`
- [x] Reject overlapping active effective-dated rows for same employee within same legal entity
- [x] Create/update ownership assignments inside a transaction and lock overlapping candidate rows with `FOR UPDATE`
- [x] Treat `effective_from` and `effective_to` as inclusive dates; `NULL effective_to` means open-ended
- [x] Normalize `employee_code` with the same shared `trim().toUpperCase()` rule used by ownership resolution, beneficiaries, and liabilities
- [x] Return OU code / name with assignment rows
- [x] Return explicit owner-context fields even when the row is central-owned
- [x] Keep `expected_cost_center_code` optional for future mismatch validation

#### Frontend

- [x] Add a payroll ownership maintenance page
- [x] Show employee code, employee name, OU, effective dates, and status
- [x] Add create / edit modal or inline form
- [x] Add list filters by legal entity, employee code, OU, and active status

### Acceptance

- [x] Payroll admins can maintain effective-dated employee owner-context assignments
- [x] The system can resolve a single authoritative owner context for an employee as of a payroll date
- [x] Overlapping ownership assignments are blocked

---

## `PR-POU02` - Ownership snapshot on payroll run lines

### Goal

Resolve owner context at payroll line level and persist it on `payroll_run_lines`.

### Files

- `backend/src/migrations/m136_payroll_run_line_ownership_snapshot.js`
- `backend/src/migrations/index.js`
- `backend/src/services/payroll.parsers.csv.js`
- `backend/src/services/payroll.ownership.service.js`
- `backend/src/services/payroll.corrections.service.js`
- `backend/src/services/payroll.runs.service.js`
- `backend/src/routes/payroll.runs.routes.js`
- `backend/src/routes/payroll.runs.validators.js`
- `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`
- `backend/scripts/test-payroll-pou02-run-line-ownership-snapshot.js`

### Checklist

#### Migration

- [x] Add `ownership_as_of_date DATE NULL` to `payroll_runs`
- [x] Add `ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NULL` to `payroll_run_lines`
- [x] Add `operating_unit_id BIGINT UNSIGNED NULL` to `payroll_run_lines`
- [x] Add `ownership_assignment_id BIGINT UNSIGNED NULL`
- [x] Add `ownership_resolution_status ENUM('RESOLVED','UNRESOLVED','AMBIGUOUS','MISMATCH') NOT NULL DEFAULT 'UNRESOLVED'`
- [x] Add `ownership_resolution_note VARCHAR(255) NULL`
- [x] Add index `(tenant_id, legal_entity_id, run_id, ownership_scope, operating_unit_id)`
- [x] Add index `(tenant_id, legal_entity_id, run_id, ownership_resolution_status)`
- [x] Add FK `payroll_run_lines.operating_unit_id -> operating_units.id`
- [x] Add FK to `payroll_employee_owner_context_assignments(id)` if practical; otherwise keep soft ref in V1

#### Service

- [x] Add resolver helper in `payroll.ownership.service.js`
- [x] Lock one run-level `ownership_as_of_date` at import time using payroll period end, falling back to `pay_date` only when payroll period is absent or invalid
- [x] Resolve owner context for each imported payroll line using normalized `employee_code` plus `ownership_as_of_date`
- [x] Persist normalized `employee_code` on new imports and treat the normalized employee-code contract as part of payroll line hash / duplicate behavior for new imports
- [x] Set `ownership_scope = 'CENTRAL'` with `operating_unit_id = NULL` for explicitly central-owned rows
- [x] Set `ownership_scope = 'OPERATING_UNIT'` with non-null `operating_unit_id` for OU-owned rows
- [x] Snapshot the result on the line row at import time
- [x] Mark mismatch if `expected_cost_center_code` is set and differs from imported `cost_center_code`
- [x] Do not backfill historical imported row casing in V1; normalize employee-code comparisons on read/filter paths where legacy mixed-case rows and new normalized rows may coexist
- [x] Reversal run headers must copy original `ownership_as_of_date`
- [x] Correction shell creation must initialize or preserve `ownership_as_of_date` correctly before import/finalize logic uses it
- [x] Reversal runs must copy original ownership snapshot fields exactly rather than re-resolving from current assignment master data
- [x] Add a run-level ownership summary helper:
  - resolved line count
  - unresolved line count
  - ambiguous line count
  - mixed OU count
  - OU breakdown

#### API and UI

- [x] Return line-level ownership fields from run detail and run line list endpoints
- [x] Add filters by `operatingUnitId` and `ownershipResolutionStatus`
- [x] Show owner context, OU, and ownership status badges on the Payroll Run Detail page
- [x] Show run ownership summary instead of assuming one `runOperatingUnitId`

### Acceptance

- [x] Imported payroll lines carry durable owner-context snapshots
- [x] Mixed owner-context payroll runs are visible and understandable
- [x] Ownership problems are visible before posting
- [x] Reversal-derived run lines preserve original ownership snapshots without live re-resolution

---

## `PR-POU03` - Import / review / finalize ownership validation

### Goal

Allow import, but block finalize until payroll ownership is fully resolved.

### Files

- `backend/src/services/payroll.runs.service.js`
- `backend/src/services/payroll.accruals.service.js`
- `backend/src/services/payroll.ownership.service.js`
- `backend/scripts/test-payroll-pou03-finalize-ownership-validation.js`

### Checklist

- [x] Keep import allowed even when ownership is unresolved, so users can inspect and fix assignments
- [x] Record ownership validation details in `payroll_run_audit`
- [x] Allow review only as an informational lifecycle step
- [x] Block finalize when any line is:
  - `UNRESOLVED`
  - `AMBIGUOUS`
  - `MISMATCH`
- [x] Add a clear finalize error payload listing sample unresolved employees
- [x] Add idempotent re-resolution helper so ownership can be recomputed before finalize if assignments changed after import
- [x] Re-resolution must use the run's locked `ownership_as_of_date`, not the current date
- [x] Re-resolution applies only to imported / editable non-finalized lines; reversal-derived lines preserve copied source snapshots
- [x] Do not silently fall back to `NULL` OU on finalized payroll runs

### Acceptance

- [x] Payroll finalize cannot produce a posted accrual journal with unresolved ownership
- [x] Operators get actionable validation feedback before finalize

---

## `PR-POU04` - OU-attributed payroll accrual preview and posting

### Goal

Refactor payroll accruals so posting is built from owner-context-grouped run lines, not only run header totals.

### Files

- `backend/src/services/payroll.mappings.service.js`
- `backend/src/services/payroll.accruals.service.js`
- `frontend/src/pages/payroll/PayrollRunDetailPage.jsx`
- `backend/scripts/test-payroll-prp02-accrual-posting.js`
- `backend/scripts/test-payroll-prp05-corrections.js`

### Checklist

- [x] Replace run-header-driven accrual component building with a line-based owner-context-grouped builder
- [x] Drive preview and posting from the same grouped line builder so preview and posted journals cannot diverge by source logic
- [x] Group component totals by:
  - `component_code`
  - `ownership_scope`
  - `operating_unit_id`
- [x] Keep existing payroll GL mappings logic
- [x] Reuse the same mapping per component / date; do not create an OU-specific mapping model in V1
- [x] Expose `ownership_scope` on grouped preview rows and include explicit owner-context identity in preview descriptions / subledger refs where the same component can appear across multiple contexts
- [x] Include `operating_unit_id` on each preview posting line
- [x] Insert `journal_lines.operating_unit_id = line.operating_unit_id` instead of `NULL`
- [x] Preserve `PAYROLL_RUN` source-link behavior
- [x] Ensure journal header totals are computed from actual generated posting lines
- [x] Show OU in accrual preview UI

### Acceptance

- [x] Payroll accrual journals post expense and payable lines with explicit owner-context / OU attribution
- [x] Mixed owner-context payroll runs produce balanced journals grouped by full owner context
- [x] Payroll reversals continue to preserve original OU attribution

---

## `PR-POU05` - OU-attributed payroll liabilities

### Goal

Persist payroll owner context onto liabilities so settlement can compare liability owner context vs bank owner context.

### Files

- `backend/src/migrations/m137_payroll_liability_operating_unit_attribution.js`
- `backend/src/migrations/index.js`
- `backend/src/services/payroll.liabilities.service.js`
- `backend/src/services/payroll.paymentSync.service.js`
- `backend/src/services/payroll.settlementOverrides.service.js`
- `backend/src/services/exportSnapshots.service.js`
- `backend/src/routes/payroll.liabilities.routes.js`
- `backend/src/routes/payroll.liabilities.validators.js`
- `backend/scripts/test-payroll-prp03-liabilities-payment-prep.js`

### Checklist

#### Migration

- [x] Add `ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL` to `payroll_run_liabilities`
- [x] Add `operating_unit_id BIGINT UNSIGNED NULL` to `payroll_run_liabilities`
- [x] Add index `(tenant_id, legal_entity_id, run_id, ownership_scope, operating_unit_id, status)`
- [x] Add FK `payroll_run_liabilities.operating_unit_id -> operating_units.id`

#### Liability build logic

- [x] Net pay liabilities inherit owner context from their source run line
- [x] Statutory liabilities are grouped by:
  - `liability_type`
  - `ownership_scope`
  - `operating_unit_id`
- [x] Update liability key generation so statutory keys include explicit owner-context token such as central vs specific OU
- [x] Keep rebuild / sync / manual-override idempotency stable under the new statutory key shape
- [x] Return OU code / name in liability list / detail responses
- [x] Return explicit owner-context fields in liability list / detail responses even when central-owned
- [x] Add list filters by `operatingUnitId`
- [x] Add list filters by `ownershipScope`
- [x] Carry OU through payment sync and override queries

### Acceptance

- [x] Every buildable payroll liability row has a durable owner context in V1
- [x] Statutory liabilities are no longer only one legal-entity aggregate when runs are mixed-context
- [x] Payment preparation can identify the owner context of each liability

---

## `PR-POU06` - Payroll payment preparation and UI ownership visibility

### Goal

Remove the current single-run-OU assumption from payroll payment preparation and make payer-vs-owner context visible.

### Files

- `frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx`
- `frontend/src/api/payrollLiabilities.js`
- `frontend/src/api/bankAccounts.js`
- `frontend/src/api/payments.js`
- `frontend/src/pages/payments/PaymentBatchDetailPage.jsx`
- `backend/src/services/payroll.liabilities.service.js`
- `backend/src/services/payments.service.js`
- `backend/src/routes/payroll.liabilities.routes.js`
- `backend/src/routes/payroll.liabilities.validators.js`
- `backend/src/routes/payments.routes.js`
- `backend/src/routes/payments.validators.js`
- `backend/scripts/test-payroll-pou06-payment-prep-ui-contract.js`

### Checklist

- [x] Stop treating `runOperatingUnitId` as the run authority for bank lookup
- [x] Use legal-entity bank list as the base lookup
- [x] Extend payroll payment preview input / validator so `bankAccountId` can be supplied with preview requests
- [x] Keep preview usable without a selected bank for baseline liability summary, but when `bankAccountId` is present return backend-derived payer-vs-owner context evaluation and settlement mode
- [x] Show bank ownership context:
  - central
  - specific OU
- [x] Show liability owner-context breakdown in payment preparation preview
- [x] Show whether selected bank causes:
  - same-context settlement
  - cross-context self-balancing
- [x] Allow central bank account for mixed-OU payroll runs
- [x] Allow OU bank payment for central-owned liabilities in V1
- [x] In V1, prevent OU bank payment when selected liabilities are mixed or owned by another OU
- [x] Re-read current bank-account ownership during preview / prepare validation because V1 payer context follows current bank-account state rather than a draft-time snapshot
- [x] Payment-batch create / prepare / validate helpers must fetch bank `operating_unit_id` before context validation is performed
- [x] Payment batch list / header / detail mappers must expose payer context consistently, not only the detail page
- [x] Update `frontend/src/api/payments.js` for any added generic payment batch list/detail payer-context and owner-context response fields
- [x] Return bank account `operating_unit_id`, code, and name from payment batch detail where needed
- [x] Return payroll liability owner context on payment batch lines for display, including explicit central vs OU scope
- [x] Show payer-vs-owner context after batch creation on generic payment batch detail, not only in payroll pre-prepare preview

### Acceptance

- [x] Payroll payment preparation no longer depends on a fake single run OU
- [x] Users can see from backend preview / prepare results when a selected bank account will generate self-balancing lines
- [x] Mixed-OU payroll payment preparation remains supported

---

## `PR-POU07` - Payroll settlement self-balancing posting

### Goal

Teach generic payment settlement posting to generate cross-context payroll balancing lines when payer context differs from liability owner context.

### Files

- `backend/src/services/payments.service.js`
- `backend/src/routes/payments.routes.js`
- `backend/src/routes/payments.validators.js`
- `backend/src/services/ou.self-balancing.service.js`
- `backend/src/services/payroll.liabilities.service.js`
- `backend/scripts/test-payroll-prp04-payment-settlement-sync.js`
- `backend/scripts/test-payroll-pou07-settlement-self-balancing.js`

### Checklist

#### Query enrichment

- [x] Extend payment batch detail and line queries so payroll payment lines expose:
  - liability owner `ownership_scope`
  - liability owner `operating_unit_id`
  - owner OU code and name
  - paying bank `operating_unit_id`
  - payer context derived consistently from the selected bank account
- [x] Do not redesign generic payment batch schema in V1 unless a missing immutable snapshot forces it
- [x] Revalidate payer context against the current selected bank-account row before posting; do not rely on draft-time UI assumptions

#### Posting logic

- [x] Refactor generic payment settlement posting to build the full journal line set first, then derive journal header totals from generated lines
- [x] Apply payroll cross-context expansion only when `payable_entity_type = 'PAYROLL_LIABILITY'` and payer-vs-owner context actually differs
- [x] For same-context settlements:
  - debit liability with liability OU
  - credit bank with bank OU or central context
- [x] For central bank paying OU liability:
  - debit payroll liability at OU
  - credit OU due-to-central
  - debit central due-from-OU
  - credit central bank
- [x] For OU bank paying central liability:
  - debit central payroll liability
  - credit central due-to-OU
  - debit OU due-from-central
  - credit OU bank
- [x] Call `resolveOuSelfBalancingAccountsTx(...)` for cross-context cases
- [x] Recompute journal header debit / credit totals from generated lines
- [x] Keep `settlement_journal_line_ref` pointing to the main liability-settlement line for compatibility
- [x] Add clear descriptions and subledger refs for balancing lines
- [x] Add regression coverage proving non-payroll payment batches still post with their existing simple structure

### Acceptance

- [x] Payroll settlement journals post with correct owner-context attribution
- [x] Cross-context payroll payments generate due-to / due-from entries
- [x] Same-context payroll payments remain simple and backward-compatible
- [x] Non-payroll payment batches remain behaviorally unchanged

---

## `PR-POU08` - Close controls, sync, overrides, reporting, and release gates

### Goal

Close the control loop so payroll cannot close with unresolved owner-context state or incomplete cross-context settlement behavior.

### Files

- `backend/src/services/payroll.close.service.js`
- `backend/src/services/payroll.paymentSync.service.js`
- `backend/src/services/payroll.settlementOverrides.service.js`
- `backend/src/services/exportSnapshots.service.js`
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/src/routes/payroll.runs.routes.js`
- `backend/src/routes/payroll.runs.validators.js`
- `backend/src/routes/payroll.liabilities.routes.js`
- `backend/src/routes/payroll.liabilities.validators.js`
- `backend/src/routes/payments.routes.js`
- `backend/src/routes/payments.validators.js`
- `backend/scripts/test-payroll-prp08-close-controls-checklist-locks.js`
- `backend/scripts/test-payroll-pou08-release-gate.js`
- `backend/scripts/test-e2e-bank-payroll-release-gate.js`

### Checklist

- [x] Add close check: no finalized payroll lines with unresolved ownership
- [x] Add close check: no payroll liabilities in period with invalid owner context
- [x] Treat `ownership_scope = 'CENTRAL'` plus `operating_unit_id IS NULL` as valid
- [x] Treat `ownership_scope = 'OPERATING_UNIT'` plus non-null `operating_unit_id` as required
- [x] Add close check: no posted payroll payment batch with cross-context owner / payer mismatch but missing self-balancing journal structure
- [x] Grandfather pre-POU finalized runs / liabilities in close checks unless a one-time historical backfill is implemented
- [x] Add rollout rule for pre-POU in-flight payroll state: non-finalized runs, derived liabilities, and draft/approved payroll payment batches must be cancelled and re-created unless an explicit backfill / re-resolution utility is implemented
- [x] Make the grandfathering boundary explicit in close-control queries so historical rows do not fail new checks accidentally
- [x] Normalize employee-code comparisons in read/search/report paths where legacy mixed-case rows and new normalized rows may coexist
- [x] Add owner-context fields to payroll export and reporting snapshots
- [x] Keep payment sync logic compatible with owner-context-attributed liabilities
- [x] Keep manual override logic compatible with owner-context-attributed liabilities
- [x] Regenerate OpenAPI via `backend/scripts/generate-openapi.js` and keep `backend/openapi.yaml` in sync with the implemented routes / schemas
- [x] Update OpenAPI for new ownership routes and new payroll response fields
- [x] Extend release gate scripts to cover:
  - ownership assignment resolution
  - accrual OU posting
  - liability owner-context grouping
  - cross-context payroll settlement
  - close-control blocking
- [x] Wire the new scripts into the existing payroll and bank/payroll gate runners, not only as standalone entry points

### Acceptance

- [x] Payroll close blocks unresolved ownership and missing owner-context state
- [x] Payroll reporting and sync flows surface owner context correctly
- [x] CI protects the new payroll ownership and settlement contract

---

## Recommended migration order

Use this order:

1. `m135_payroll_employee_owner_context_assignments.js`
2. `m136_payroll_run_line_ownership_snapshot.js`
3. `m137_payroll_liability_operating_unit_attribution.js`

Do not add a payment-batch schema migration unless implementation proves the query-only approach is insufficient.

## Recommended implementation order

Build this in the following sequence:

1. `PR-POU01`
2. `PR-POU02`
3. `PR-POU03`
4. `PR-POU04`
5. `PR-POU05`
6. `PR-POU06`
7. `PR-POU07`
8. `PR-POU08`

That order matters because settlement should not be touched before liabilities have durable owner-context state.

## Main repo risks to watch during implementation

- `PayrollLiabilitiesPage.jsx` currently filters bank accounts by `runOperatingUnitId`; that must be removed or replaced with an ownership breakdown model.
- Payroll payment preview is currently bank-blind; if preview is not made bank-aware with selected-bank input, UI settlement hints will diverge from backend create/post behavior.
- `payments.service.js` currently assumes one debit per liability line and one bank credit line per batch; cross-context payroll posting breaks that assumption and requires recalculated journal totals.
- If payroll ownership tables keep only nullable `operating_unit_id` without explicit `ownership_scope`, central-owned and unresolved states can be conflated.
- Ownership resolution must use one locked run-level `ownership_as_of_date`; otherwise import-time resolution, pre-finalize re-resolution, and correction shells can drift.
- Parser-level employee-code normalization changes line-hash and duplicate behavior for new imports, so that contract must be deliberate and documented.
- Legacy mixed-case `employee_code` rows will coexist with new normalized imports unless explicitly backfilled, so cross-era comparisons need normalized read/filter behavior.
- Reversal runs currently clone source payroll lines; forgetting to copy new ownership snapshot fields there will silently break reversal integrity.
- If accrual posting is changed but accrual preview is left run-header-driven, the UI and accounting contract will diverge.
- Statutory liabilities currently use run-level aggregate keys; if OU is added without updating the key format, duplicate-key and idempotency behavior will break.
- `payroll.paymentSync.service.js` and override flows do not currently expect OU fields, so they need contract expansion even if their core business logic mostly stays the same.
- Generic payment batch detail/header queries do not currently surface bank OU or payroll liability owner OU, so payroll-only UI changes will leave post-prepare visibility incomplete.
- Pre-POU non-finalized payroll runs, derived liabilities, and draft/approved payment batches do not fit the new contract automatically and need an explicit cancel/re-create or backfill path.
- If a bank account's `operating_unit_id` is edited between preview and posting, payer context will drift unless current-state revalidation is deliberate and documented.
- Historical close controls must either grandfather pre-POU payroll data or backfill it before enforcing new OU completeness checks.

## Definition of done

- [x] Effective-dated employee ownership exists and is maintainable in product UI and API
- [x] Payroll run lines persist resolved owner-context snapshots
- [x] Finalize blocks unresolved ownership
- [x] Payroll accrual journals carry explicit owner-context / OU attribution on posted lines
- [x] Payroll liabilities persist owner context
- [x] Payroll payment preparation shows payer-context vs owner-context behavior
- [x] Cross-context payroll settlements generate due-to / due-from lines through the shared OU self-balancing engine
- [x] Payroll close controls block incomplete ownership or settlement states
- [x] Regression scripts cover the end-to-end ownership, accrual, liability, settlement, and close-control contract
