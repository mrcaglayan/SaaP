# 06 - CANONICAL IMPLEMENTATION PLAN (VERBATIM MERGE)

## Section A - Subaccounts Implementation Plan

# 06 - SUBACCOUNTS Implementation Plan (my-app)

## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Audit Summary (Current State)

### What already aligns
- `accounts` model already supports hierarchy via `parent_account_id`, with posting control via `allow_posting`.
- Journal posting already enforces `active + postable + leaf` account usage.
- `bank_accounts` already maps 1:1 to GL account with unique `(tenant_id, legal_entity_id, gl_account_id)`.
- Bank account API/UI already enforce legal entity + active + postable + leaf + ASSET account selection.

### Gaps found against target model
- No `bank_accounts.operating_unit_id` exists yet in schema/service/API/UI.
- No explicit enforcement that bank-linked GL account must be under `102` subtree (TDHP control account policy).
- `iban`/`account_no` uniqueness is not enforced at DB level.
- Update flow allows changing key identity fields (e.g. `gl_account_id`, `iban`, `currency`) without "has-postings" guardrails.
- No guided "create bank + auto-create 102 child account" flow.
- OpenAPI for bank accounts remains generic (`AnyObject`) and does not document strong request/response contract.

## Implementation Principles
- Keep `102` as non-postable control account.
- Each real bank account (IBAN/account no) maps 1:1 to one postable leaf subaccount under `102`.
- Operating Unit is optional ownership/reporting dimension only (not identity).
- Do not break existing bank/payments/reconciliation flows; rollout with backward compatibility.

## PR Roadmap

## PR-1: Schema Hardening + OU Ownership (m081)
Goal: Add missing data model fields/constraints safely.

Changes:
- New migration `m081_bank_accounts_subaccount_hardening.js`.
- Add nullable `bank_accounts.operating_unit_id`.
- Add index `(tenant_id, legal_entity_id, operating_unit_id, is_active)`.
- Add FK `(operating_unit_id) -> operating_units(id)`.
- Add uniqueness for IBAN/account identity (choose one policy and apply consistently):
  - Preferred: `UNIQUE (tenant_id, legal_entity_id, iban)` where `iban IS NOT NULL`.
  - Fallback: `UNIQUE (tenant_id, legal_entity_id, account_no)` where IBAN absent.
- Keep existing unique `(tenant_id, legal_entity_id, gl_account_id)`.

Acceptance:
- Migration is idempotent.
- Existing tenants migrate without data loss.
- New OU column is nullable and non-breaking.

## PR-2: Bank Accounts API + Service Support for OU
Goal: End-to-end support for optional OU owner dimension.

Changes:
- Validators:
  - Accept `operatingUnitId` in POST/PUT bodies (optional).
  - Accept `operatingUnitId` in list filter query (optional).
- Service:
  - Persist/read `operating_unit_id`.
  - Join `operating_units` to return `operating_unit_code`, `operating_unit_name`.
  - Validate OU if present:
    - belongs to tenant,
    - ACTIVE,
    - same `legal_entity_id` as bank account.
- Routes/OpenAPI generation contract updated.

Acceptance:
- Create/update/list/get endpoints support OU owner cleanly.
- Cross-entity OU assignment fails with clear 400 error.

## PR-3: Enforce 102 Subtree Policy for Bank GL Link
Goal: Ensure bank accounts only link to valid bank subaccounts.

Changes:
- In bank account GL validation, enforce selected `glAccountId` is descendant/leaf under configured `102` control account in same legal entity CoA.
- Add policy fallback strategy:
  - If strict mode enabled and `102` parent missing -> fail with actionable message.
  - If strict mode disabled -> keep current ASSET+leaf checks.
- Optional: attach/reuse `journal purpose mapping` for BANK control parent to avoid hardcoded code assumptions in non-TR packs.

Acceptance:
- Cannot link a bank account to non-102 leaf account when strict mode is on.
- Existing tenants can opt-in safely.

## PR-4: Bank Identity Immutability After First Posting
Goal: Protect accounting integrity.

Changes:
- Before updating bank account identity fields (`gl_account_id`, `currency_code`, `iban`, `account_no`, optionally `legal_entity_id`), check if account has dependent records:
  - statement lines,
  - payment batches/payment lines,
  - reconciliation references,
  - posted journals through payment/reconciliation flows.
- If used, block direct mutation and require controlled migration path.

Acceptance:
- Mutable before usage, guarded after usage.
- Error messages state why update is blocked and recommended next action.

## PR-5: Auto-Create 102 Child + Bank Account (UX/API)
Goal: Remove manual two-step setup friction.

Changes:
- Add endpoint (or transactional service method) to:
  1) create GL leaf under `102` with deterministic code policy,
  2) create `bank_accounts` row linked to that new account,
  3) rollback all on failure.
- Add duplicate-safe code allocator under `102` (e.g. `102.001`, `102.002`, ...).
- Add idempotency key support for safe retries.

Acceptance:
- One-click bank setup works.
- No orphan GL account or bank account on partial failures.

## PR-6: Frontend Bank Accounts UX Upgrade
Goal: Expose new model clearly to end users.

Changes:
- `BankAccountsPage`:
  - Add optional Operating Unit dropdown.
  - Show OU column/label in list.
  - Add optional "Auto-create 102 child" action in create flow.
  - Improve GL dropdown hints to indicate `102` subtree constraints.
- Add list filtering by OU.

Acceptance:
- User can create/edit/list/filter by OU owner.
- UX clearly distinguishes identity (`GL/IBAN`) from ownership (`OU`).

## PR-7: Test Coverage for Subaccounts + OU
Goal: lock behavior and prevent regressions.

Changes:
- Add/extend backend scripts for:
  - OU ownership validations,
  - 102 subtree enforcement,
  - immutability after first posting,
  - auto-create transactional rollback.
- Add frontend smoke tests for Bank Accounts form/list updates.

Acceptance:
- Existing release gate scripts remain green.
- New scenarios fail before implementation and pass after.

## PR-8: Documentation + Rollout Runbook
Goal: operationalize safely.

Changes:
- Update user guide sections for bank account setup.
- Add migration/backfill runbook:
  - identify accounts not under `102`,
  - remediation strategy,
  - feature-flag rollout order (tenant pilot -> general availability).
- Update architecture docs with "control account + subledger" pattern.

Acceptance:
- Finance/ops teams can execute rollout without engineering intervention.

## Suggested Delivery Order
1. PR-1
2. PR-2
3. PR-3
4. PR-4
5. PR-6
6. PR-5
7. PR-7
8. PR-8

(Reason: establish schema/validation guardrails first, then UX convenience and rollout artifacts.)

## Notes for This Repo
- Keep migration key sequence continuous after `m080`.
- Preserve backward compatibility for current `bank_accounts` consumers (payments/reconciliation/payroll).
- Avoid changing existing unique constraints unless data audit confirms no collisions.



## Section B - Setup Logic (Audit + Implementation Plan)

# 07 - SETUPLOGIC (Audit + Implementation Plan)

## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Scope
This document audits `my-app` against the requested setup logic and defines how to implement the missing parts.

Requested logic summary:
- First setup should start from country selection.
- Show country-relevant chart template.
- Let user choose parent vs subaccount behavior (parent non-postable).
- Allow adding subaccounts in wizard and later in settings.
- Allow custom account definitions (code, name, type, debit/credit nature).
- Support multinational structure (country HQ + branches).
- Branch-level control -> regional control -> top/global approval -> consolidation.
- Consolidate countries with different local account codes into one unified view.
- Country-specific tax/VAT (KDV/vergi) differences.

## Current Coverage Audit

## 1) First login: choose country
Status: PARTIAL

What exists:
- Company onboarding requires `countryIso2` (or `countryId`) per legal entity.
- Legal entities are country-linked and functional-currency-linked.

Gap:
- There is no strict "country-first wizard step" that drives all later setup choices automatically.

## 2) Country-specific account list appears automatically
Status: PARTIAL

What exists:
- Policy pack infrastructure exists (`TR_UNIFORM_V1`, `AF_STARTER_V1`, `US_GAAP_STARTER_V1`).
- GL Setup template wizard filters packs by selected legal entity country and supports preview/apply.

Gap:
- This runs in GL Setup page, not in first onboarding flow.
- Company bootstrap still uses a flat `DEFAULT_ACCOUNTS` fallback unless custom `defaultAccounts` is passed.

## 3) Parent/subaccount selection + parent non-postable behavior
Status: MOSTLY COVERED

What exists:
- `accounts.parent_account_id` supports hierarchy.
- `allow_posting` supported.
- Upsert account logic auto-forces parent accounts to non-postable when children exist.
- Journal posting validates active + postable + leaf account.

Gap:
- Wizard UX for account tree modeling is missing in first onboarding.

## 4) Add subaccounts in setup wizard and later in settings
Status: PARTIAL

What exists:
- Later settings: fully possible in GL Setup (`coaId`, `code`, `name`, `accountType`, `normalSide`, `allowPosting`, `parentAccountId`).

Gap:
- First setup wizard does not model hierarchical account tree (`parentAccountId` not part of onboarding account payload).

## 5) Custom account create (code/name/type/normal side)
Status: COVERED (post-setup), PARTIAL (wizard)

What exists:
- GL Setup supports custom account creation with type and normal side.
- Onboarding `defaultAccounts` accepts account code/name/type/normalSide/allowPosting.

Gap:
- Onboarding account payload cannot define parent-child relations cleanly.

## 6) Multinational model (countries, entities, branches)
Status: COVERED (foundation)

What exists:
- Group company -> legal entities -> operating units (branches/plants/stores/departments).
- Scope-aware RBAC supports TENANT/GROUP/COUNTRY/LEGAL_ENTITY/OPERATING_UNIT.
- Consolidation group + members + runs exist.

Gap:
- Operating unit hierarchy (region -> branch tree) is not explicit; units are flat under legal entity.

## 7) Branch -> regional -> top approval chain before consolidation
Status: PARTIAL / MISSING

What exists:
- Generic approval policy/request engine (mainly bank/payroll-centric usage).
- Multi-scope RBAC can enforce who can see/do actions by OU/entity/country/group.

Gap:
- No explicit workflow engine binding branch/regional/global approval stages to close/consolidation lifecycle.
- Consolidation execution/finalization is permission-based, not staged approval-request-based.

## 8) Consolidate different country CoAs into one unified structure
Status: PARTIAL

What exists:
- Consolidation groups and group CoA mappings exist.
- Consolidation run pipeline, reporting, adjustments, eliminations are implemented.

Gap:
- Current run logic maps local accounts to group accounts by same account `code` in mapped CoAs.
- True cross-country different-code normalization (local code A -> canonical purpose -> group code B) is not fully modeled.

## 9) Country-specific tax/VAT/KDV rules
Status: MISSING (rule engine)

What exists:
- `tax_id` on legal entities and `tax_code` on journal lines.

Gap:
- No country tax rule engine, no VAT/KDV calculation packs, no tax posting policy framework per country.

## Implementation Plan (How to Make It)

## PR-1: Setup Wizard V2 (country-first flow)
Goal:
- Add onboarding steps: Country -> Entity -> CoA template -> Account tree -> Branches.

Changes:
- Frontend wizard stepper in `CompanyOnboardingPage`.
- Once country selected, fetch recommended policy pack and default account tree template.
- Keep manual override path.

## PR-2: Onboarding Account Tree Payload
Goal:
- Enable hierarchical account modeling during first setup.

Changes:
- Extend onboarding payload from flat `defaultAccounts` to tree-compatible rows:
  - `code`, `name`, `accountType`, `normalSide`, `allowPosting`, `parentCode`.
- Backend resolves parent links after insert in deterministic order.
- Enforce parent `allowPosting=false`.

## PR-3: Country Pack Expansion (CoA + rules)
Goal:
- Make country packs first-class onboarding artifacts.

Changes:
- Extend policy pack definitions to include:
  - starter account trees,
  - required parent accounts,
  - required purpose mappings.
- Add API endpoint to apply selected pack during company bootstrap transaction.

## PR-4: Canonical Mapping Layer for Consolidation
Goal:
- Remove same-code dependency across countries.

Changes:
- Add canonical account/purpose mapping table:
  - local account -> canonical key -> group account.
- Update consolidation extraction to use mapping table instead of `group_acc.code = local_acc.code` coupling.
- Provide migration/backfill helpers.

## PR-5: OU Hierarchy + Ownership Model
Goal:
- Support regional oversight explicitly.

Changes:
- Add optional `parent_operating_unit_id` and/or `region_id` model.
- Add manager assignment table for OU/regional/global responsibility.
- Add UI for maintaining hierarchy and managers.

## PR-6: Approval Workflow for Close/Consolidation
Goal:
- Enforce branch -> regional -> global approvals before consolidation finalization.

Changes:
- Introduce approval stages for:
  - period close run,
  - consolidation run execute/finalize.
- Bind stages to scope (OU, legal entity, group) and threshold rules.
- Gate consolidation actions until approval chain is completed.

## PR-7: Country Tax Rule Pack Engine
Goal:
- Handle KDV/VAT/tax differences per country.

Changes:
- Add tax rule definitions by country (rates, account mapping rules, posting behaviors).
- Add tax validation + computation service for supported modules.
- Attach tax rules to policy pack / legal entity config.

## PR-8: UX + Test + Rollout Hardening
Goal:
- Make implementation operable and safe.

Changes:
- Update setup/readiness UI and docs to show missing country/tax/mapping prerequisites.
- Add regression scripts for new wizard flow, consolidation mapping, and approval chain gates.
- Add rollout runbook for existing tenants (backfill mappings and account trees).

## Recommended Delivery Order
1. PR-1
2. PR-2
3. PR-3
4. PR-4
5. PR-5
6. PR-6
7. PR-7
8. PR-8

## Practical Notes for my-app
- Reuse existing strengths instead of replacing them:
  - policy pack preview/apply,
  - GL account hierarchy enforcement,
  - RBAC scoped permissions,
  - consolidation run pipeline.
- Main architectural gap is orchestration:
  - onboarding should drive country template + hierarchy from day 1,
  - consolidation should rely on explicit canonical mappings and staged approvals.



## Section C - Approval and Tax Engine Blueprint

# 08 - APPROVAL AND TAX ENGINE Blueprint (my-app)

## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Objective
Close the two critical gaps identified in setup logic:
1. Explicit branch -> regional -> global approval chain for period close and consolidation.
2. Country tax/VAT (KDV/vergi) rule engine with posting-safe account mappings.

This blueprint is aligned with current `my-app` patterns:
- migration-driven schema evolution (`backend/src/migrations/m0xx_*.js`)
- route validators + services split
- RBAC scope enforcement (`TENANT`, `GROUP`, `COUNTRY`, `LEGAL_ENTITY`, `OPERATING_UNIT`)
- journal posting integrity and idempotent APIs.

## Scope Boundaries
In scope:
- new approval workflow model for close/consolidation gates
- new country tax regime and rule model
- API contracts for setup + execution + readiness checks
- rollout, feature flags, and regression requirements

Out of scope (first phase):
- full e-invoice/e-defter integration
- external tax authority filing
- arbitrary low-code workflow designer UI

## A) Approval Chain Architecture

## A1. Data Model (new tables)
Proposed migration: `m082_close_consolidation_workflow_approvals.js`

### `workflow_definitions`
Purpose: reusable workflow template per tenant/process.

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `code` VARCHAR(60) NOT NULL
- `name` VARCHAR(255) NOT NULL
- `process_type` ENUM('PERIOD_CLOSE','CONSOLIDATION_RUN') NOT NULL
- `is_active` BOOLEAN NOT NULL DEFAULT TRUE
- `version_no` INT NOT NULL DEFAULT 1
- `created_by_user_id` INT NOT NULL
- `created_at`, `updated_at`

Indexes/constraints:
- `UNIQUE (tenant_id, code, version_no)`
- `KEY (tenant_id, process_type, is_active)`

### `workflow_definition_steps`
Purpose: ordered approval chain stages.

Columns:
- `id` BIGINT PK
- `workflow_definition_id` BIGINT NOT NULL
- `step_no` INT NOT NULL
- `stage_scope_type` ENUM('OPERATING_UNIT','LEGAL_ENTITY','GROUP') NOT NULL
- `required_permission_code` VARCHAR(120) NOT NULL
- `min_approver_count` INT NOT NULL DEFAULT 1
- `allow_self_approve` BOOLEAN NOT NULL DEFAULT FALSE
- `escalation_after_hours` INT NULL
- `created_at`

Indexes/constraints:
- `UNIQUE (workflow_definition_id, step_no)`

### `workflow_assignments`
Purpose: bind a workflow definition to context.

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `process_type` ENUM('PERIOD_CLOSE','CONSOLIDATION_RUN') NOT NULL
- `workflow_definition_id` BIGINT NOT NULL
- `group_company_id` BIGINT NULL
- `legal_entity_id` BIGINT NULL
- `operating_unit_id` BIGINT NULL
- `effective_from` DATE NOT NULL
- `effective_to` DATE NULL
- `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
- `created_by_user_id` INT NOT NULL
- `created_at`, `updated_at`

Rule:
- assignment precedence: OU > Legal Entity > Group > tenant fallback.

### `workflow_instances`
Purpose: runtime approval state for a specific target action.

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `process_type` ENUM('PERIOD_CLOSE','CONSOLIDATION_RUN') NOT NULL
- `target_type` ENUM('PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NOT NULL
- `target_id` BIGINT NOT NULL
- `workflow_definition_id` BIGINT NOT NULL
- `status` ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING'
- `current_step_no` INT NOT NULL DEFAULT 1
- `requested_by_user_id` INT NOT NULL
- `requested_at` TIMESTAMP NOT NULL
- `resolved_at` TIMESTAMP NULL
- `resolution_note` VARCHAR(500) NULL
- `idempotency_key` VARCHAR(120) NULL
- `created_at`, `updated_at`

Indexes:
- `UNIQUE (tenant_id, process_type, target_type, target_id)`
- `UNIQUE (tenant_id, idempotency_key)` when not null

### `workflow_instance_decisions`
Purpose: individual step decisions for audit trail.

Columns:
- `id` BIGINT PK
- `workflow_instance_id` BIGINT NOT NULL
- `step_no` INT NOT NULL
- `decision` ENUM('APPROVE','REJECT') NOT NULL
- `decision_by_user_id` INT NOT NULL
- `decision_note` VARCHAR(500) NULL
- `created_at` TIMESTAMP NOT NULL

Indexes:
- `KEY (workflow_instance_id, step_no)`
- `UNIQUE (workflow_instance_id, step_no, decision_by_user_id)`

## A2. Runtime Rules
- Maker-checker: requester cannot approve own step unless `allow_self_approve=true`.
- Step completes when unique approvers at step >= `min_approver_count`.
- Instance advances to next step; final step completion sets `status=APPROVED`.
- Any reject sets `status=REJECTED` and blocks finalize.
- For close/consolidation, execution/finalization endpoint must assert approved instance exists.

## A3. Integration Points in Existing Code
### Period close
- File: `backend/src/routes/gl.period-closing.routes.js`
- Hook points:
  - after draft close run creation: create `workflow_instance` (if policy enabled)
  - before marking run complete/hard close: require workflow approved

### Consolidation
- File: `backend/src/routes/consolidation.js`
- Hook points:
  - run execute/finalize endpoints must check workflow gate
  - if gate active and not approved, return 409 `APPROVAL_REQUIRED`

### RBAC
- Reuse existing `assertScopeAccess` for per-step scope validations.
- Decision actor must hold `required_permission_code` from active step definition.

## A4. API Contracts
Base path suggestion: `/api/v1/workflows`

### Definitions
- `GET /definitions?processType=&isActive=`
- `POST /definitions`
- `PATCH /definitions/:id`
- `GET /definitions/:id/steps`
- `POST /definitions/:id/steps` (replace ordered steps atomically)

### Assignments
- `GET /assignments?processType=&legalEntityId=&operatingUnitId=&groupCompanyId=`
- `POST /assignments`
- `PATCH /assignments/:id`

### Instances / Decisions
- `GET /instances?processType=&status=&targetType=&targetId=`
- `GET /instances/:id`
- `POST /instances/:id/approve`
- `POST /instances/:id/reject`

Error contract examples:
- `APPROVAL_REQUIRED`
- `WORKFLOW_NOT_ASSIGNED`
- `APPROVAL_STEP_PERMISSION_DENIED`
- `APPROVAL_STEP_ALREADY_DECIDED`
- `APPROVAL_INSTANCE_REJECTED`

## B) Country Tax/VAT Engine Architecture

## B1. Data Model (new tables)
Proposed migration: `m083_country_tax_engine_foundation.js`

### `tax_regimes`
Purpose: regime scope and lifecycle.

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `country_id` BIGINT NOT NULL
- `legal_entity_id` BIGINT NULL
- `code` VARCHAR(60) NOT NULL
- `name` VARCHAR(255) NOT NULL
- `currency_code` CHAR(3) NOT NULL
- `effective_from` DATE NOT NULL
- `effective_to` DATE NULL
- `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
- `created_by_user_id` INT NOT NULL
- `created_at`, `updated_at`

Constraints:
- `UNIQUE (tenant_id, code, effective_from)`
- precedence for resolver: legal_entity-specific > country-generic

### `tax_codes`
Purpose: maintain tax code catalog (KDV1/KDV18/VAT20/etc.).

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `tax_regime_id` BIGINT NOT NULL
- `code` VARCHAR(40) NOT NULL
- `name` VARCHAR(255) NOT NULL
- `tax_kind` ENUM('VAT','WITHHOLDING','STAMP','OTHER') NOT NULL
- `rate_pct` DECIMAL(9,4) NOT NULL
- `calculation_mode` ENUM('EXCLUSIVE','INCLUSIVE') NOT NULL
- `recoverability` ENUM('FULL','PARTIAL','NONE') NOT NULL DEFAULT 'FULL'
- `is_reverse_charge` BOOLEAN NOT NULL DEFAULT FALSE
- `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
- `created_at`, `updated_at`

Constraints:
- `UNIQUE (tenant_id, tax_regime_id, code)`

### `tax_rule_sets`
Purpose: conditional rules beyond base rate.

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `tax_regime_id` BIGINT NOT NULL
- `tax_code_id` BIGINT NOT NULL
- `module_code` ENUM('CARI','BANK','PAYROLL','CONTRACTS','GL_MANUAL') NOT NULL
- `document_type` VARCHAR(60) NULL
- `counterparty_type` ENUM('CUSTOMER','VENDOR','EMPLOYEE','GOVERNMENT','OTHER') NULL
- `apply_priority` INT NOT NULL DEFAULT 100
- `formula_json` JSON NOT NULL
- `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
- `effective_from` DATE NOT NULL
- `effective_to` DATE NULL
- `created_at`, `updated_at`

### `tax_account_mappings`
Purpose: posting account resolution by tax purpose.

Columns:
- `id` BIGINT PK
- `tenant_id` BIGINT NOT NULL
- `tax_regime_id` BIGINT NOT NULL
- `legal_entity_id` BIGINT NOT NULL
- `tax_code_id` BIGINT NOT NULL
- `tax_purpose_code` ENUM('VAT_INPUT','VAT_OUTPUT','VAT_PAYABLE','VAT_RECEIVABLE','WITHHOLDING_PAYABLE','WITHHOLDING_RECEIVABLE','ROUNDING') NOT NULL
- `account_id` BIGINT NOT NULL
- `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
- `created_at`, `updated_at`

Constraints:
- `UNIQUE (tenant_id, legal_entity_id, tax_code_id, tax_purpose_code)`
- `account_id` must be active, posting, legal-entity scoped

## B2. Runtime Services
New service suggestion: `backend/src/services/tax.engine.service.js`

Core functions:
- `resolveTaxRegime(tenantId, legalEntityId, postingDate)`
- `resolveTaxCodeAndRule(context)`
- `computeTaxBreakdown({baseAmount, mode, ratePct, recoverability})`
- `resolveTaxAccounts(tenantId, legalEntityId, taxCodeId)`
- `buildTaxJournalLines(context)`

Expected output:
- deterministic tax breakdown lines
- ready-to-post journal line payloads with `tax_code`
- validation errors when mapping/rules missing

## B3. Integration Points
### CARI documents/settlements (phase 1)
- Files:
  - `backend/src/services/cari.document.service.js`
  - `backend/src/services/cari.settlement.service.js`
- Apply tax engine before final journal line insert.

### Extend later to:
- `payments.service.js`
- `bank.reconciliationAutoPosting.service.js`
- `payroll.*` if statutory taxes are modeled there.

## B4. API Contracts
Base path suggestion: `/api/v1/tax`

### Regime
- `GET /regimes?countryId=&legalEntityId=&status=`
- `POST /regimes`
- `PATCH /regimes/:id`

### Tax codes
- `GET /codes?regimeId=&status=`
- `POST /codes`
- `PATCH /codes/:id`

### Rules
- `GET /rules?regimeId=&moduleCode=&taxCodeId=`
- `POST /rules`
- `PATCH /rules/:id`

### Account mappings
- `GET /account-mappings?regimeId=&legalEntityId=&taxCodeId=`
- `POST /account-mappings`
- `PATCH /account-mappings/:id`

### Runtime helper
- `POST /preview` (simulate tax resolution + lines for UI preview, no posting)

Error contract examples:
- `TAX_REGIME_NOT_FOUND`
- `TAX_CODE_NOT_ACTIVE`
- `TAX_RULE_NOT_FOUND`
- `TAX_ACCOUNT_MAPPING_MISSING`
- `TAX_INVALID_FORMULA`

## C) Readiness and Setup Integration

## C1. Module readiness additions
Extend `module-readiness.service.js` with:
- `closeConsolidationWorkflow` readiness:
  - workflow assigned
  - mandatory steps complete
  - no invalid step permissions
- `countryTaxEngine` readiness:
  - active regime exists
  - minimum required tax codes exist
  - all required tax purpose mappings exist and reference active posting accounts

## C2. Setup UI additions
- `GlSetupPage` / new `TaxSetupPage`:
  - regime/codes/rules/mapping management
- `ConsolidationReportsPage`:
  - show approval gate status and current step
- `TenantReadinessChecklist`:
  - add links to workflow/tax setup when missing

## D) Feature Flags and Rollout
Add tenant feature flags:
- `feature_workflow_close_consolidation_v1`
- `feature_tax_engine_v1`

Default strategy:
- OFF for existing tenants
- ON for pilot tenants
- hard-enforce only after migration + backfill complete

## E) Migration and Backfill Strategy

## E1. Migration order
1. `m082_close_consolidation_workflow_approvals.js`
2. `m083_country_tax_engine_foundation.js`

## E2. Backfill scripts
- `scripts/backfill-workflow-defaults.js`
  - create standard 3-step chain for selected tenants.
- `scripts/backfill-tax-regimes-from-country.js`
  - create baseline VAT/KDV regime and default tax codes by country.
- `scripts/backfill-tax-account-mappings.js`
  - propose mappings from existing `journal_purpose_accounts` where possible.

## F) Regression Test Matrix (must pass before release)

Approval workflow tests:
- close run blocked without approved instance
- consolidation finalize blocked without approved instance
- correct step advancement with `min_approver_count`
- maker-checker violation blocked
- scope mismatch approver blocked

Tax engine tests:
- regime resolution priority (LE-specific over country)
- EXCLUSIVE vs INCLUSIVE amount math
- recoverability behavior
- missing account mapping fails fast
- deterministic tax journal lines for same input

Cross tests:
- approval + tax both enabled and posting flow remains idempotent
- backward compatibility when both feature flags disabled

## G) Suggested PR Breakdown
1. PR-A1: `m082` + workflow read APIs + validators
2. PR-A2: workflow decisions + close/consolidation gating
3. PR-A3: UI indicators + readiness wiring for workflow
4. PR-T1: `m083` + tax setup APIs + validators
5. PR-T2: tax engine service + CARI integration
6. PR-T3: tax setup UI + readiness wiring
7. PR-X1: backfill scripts + docs + runbook + release gate tests

## H) Design Decisions to Keep
- Never mutate posted accounting history.
- Tax/approval decisions must be traceable and auditable.
- All write endpoints should support idempotency keys where financial side effects can happen.
- Keep legal-entity scope strict for account mappings.
- Fail fast with actionable setup errors; no silent fallback for missing mandatory mappings.



## Section D - Follow-ups PR List (Combined)

# 09 - FOLLOW-UPS PR LIST (00..08 Combined, repo-aware)

## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Combined Audit Result

## What is already mostly implemented (from 00..05)
- Cari core + frontend + quality gate chain (`PR-11..15`) and contracts/revenue blocks (`PR-16..28`) are present in code/test scripts.
- Cash-Cari integration (`PR-17..26`) exists, including transit workflow (`test-cash-pr26-transit-workflow.js`).
- Bank + Payroll roadmap (`04-*`) is largely implemented (`m031..m080`, PR-B/PR-P/PR-H script coverage present).
- UX/Hardening roadmap (`05-IMPROVEMENTS.md`) is largely implemented (PR-UX/PR-CORE scripts exist).

## Open work concentrated in 06..08
Not implemented yet in repo:
- `m081` Subaccounts hardening + bank OU ownership and strict 102 subtree controls.
- Setup Wizard V2 / country-first + onboarding account tree payload.
- Canonical consolidation mapping layer for different local chart codes.
- Explicit close/consolidation staged workflow approvals (`m082` track).
- Country tax/VAT engine (`m083` track).

---

## Follow-up PR List (with wiring/dependencies)

## PR-F01: Platform prerequisites and feature flags
Goal:
- Create cross-track toggles and guardrails before major behavior changes.

Deliverables:
- Tenant feature flags:
  - `feature_subaccounts_v1`
  - `feature_setup_wizard_v2`
  - `feature_consolidation_canonical_mapping_v1`
  - `feature_workflow_close_consolidation_v1`
  - `feature_tax_engine_v1`
- Readiness placeholders for new modules (initially warning-only).
- Detailed implementation checklist: `10-PR-F01-IMPLEMENTATION-CHECKLIST.md`

Depends on: none
Unblocks: all following PRs

## PR-F02: Subaccounts schema hardening (`m081`) and bank OU ownership
Goal:
- Implement `06-SUBACCOUNTS` PR-1/2 foundation.

Deliverables:
- Migration `m081_*`:
  - `bank_accounts.operating_unit_id` + indexes/FKs
  - bank account identity constraints (IBAN/account uniqueness policy)
- API/service/UI support for optional OU owner.

Depends on: PR-F01
Unblocks: PR-F03, PR-F04, PR-F12

## PR-F03: 102 subtree enforcement + immutability after posting
Goal:
- Complete `06-SUBACCOUNTS` integrity controls.

Deliverables:
- Enforce bank GL account under configured `102` subtree (flagged rollout).
- Block critical bank identity mutations once posted/consumed.
- Add compatibility checks for payments/reconciliation/payroll consumers.

Depends on: PR-F02
Unblocks: PR-F04, PR-F12

## PR-F04: Bank one-click provisioning (auto-create 102 child + bank account)
Goal:
- Complete subaccounts usability path.

Deliverables:
- Transactional service/API to create `102` child + bank account atomically.
- Frontend action in Bank Accounts page.
- Idempotency-safe retry semantics.

Depends on: PR-F03
Unblocks: PR-F12

## PR-F05: Setup Wizard V2 (country-first) + onboarding account tree payload
Goal:
- Implement `07-SETUPLOGIC` PR-1/2.

Deliverables:
- Wizard flow: Country -> entity -> template -> account tree -> branches.
- Onboarding payload supports hierarchical account creation (`parentCode`/resolution flow).
- Keep existing Company bootstrap backward-compatible.

Depends on: PR-F01
Can run parallel with: PR-F02/F03/F04
Unblocks: PR-F06, PR-F11

## PR-F06: Country pack expansion and onboarding binding
Goal:
- Implement `07-SETUPLOGIC` PR-3.

Deliverables:
- Pack metadata includes starter account tree + required mappings.
- Onboarding can preview/apply selected country pack in same transaction.

Depends on: PR-F05
Unblocks: PR-F11, PR-F12

## PR-F07: Approval workflow engine schema + read APIs (`m082`, PR-A1)
Goal:
- Build workflow definition/assignment/runtime data model.

Deliverables:
- Migration `m082_*` (`workflow_definitions`, `workflow_definition_steps`, `workflow_assignments`, `workflow_instances`, `workflow_instance_decisions`).
- Read/setup APIs and validators.

Depends on: PR-F01
Unblocks: PR-F08, PR-F09, PR-F12

## PR-F08: Close/consolidation gating by staged approvals (PR-A2)
Goal:
- Enforce branch->regional->global approval chain.

Deliverables:
- Integrate workflow checks into:
  - `gl.period-closing.routes.js`
  - `consolidation.js`
- Decision endpoints (`approve/reject`) with maker-checker and scope checks.

Depends on: PR-F07
Unblocks: PR-F09, PR-F12

## PR-F09: Workflow UI + readiness integration (PR-A3)
Goal:
- Operational visibility and setup usability for approval chains.

Deliverables:
- UI indicators for pending/current approval step in period close + consolidation pages.
- Setup pages for workflow definitions/assignments.
- Readiness checklist integration.

Depends on: PR-F08
Unblocks: PR-F12

## PR-F10: Country tax engine foundation schema + setup APIs (`m083`, PR-T1)
Goal:
- Create tax regime/code/rule/mapping foundation.

Deliverables:
- Migration `m083_*`:
  - `tax_regimes`, `tax_codes`, `tax_rule_sets`, `tax_account_mappings`
- Tax setup APIs + validators.

Depends on: PR-F01
Can run parallel with: PR-F07/F08
Unblocks: PR-F11, PR-F12

## PR-F11: Tax runtime engine + CARI posting integration (PR-T2)
Goal:
- Put tax rules into posting behavior safely.

Deliverables:
- `tax.engine.service.js` core resolvers/calculators.
- Integrate first with CARI document/settlement posting.
- Explicit setup errors when tax mapping/rules missing.

Depends on: PR-F10, PR-F06
Unblocks: PR-F12

## PR-F12: Canonical consolidation mapping layer + cross-track wiring
Goal:
- Implement `07-SETUPLOGIC` PR-4 and finalize cross-country consolidation consistency.

Deliverables:
- Canonical mapping table(s) (local account -> canonical key -> group account).
- Consolidation run logic updated to use canonical mapping (not same-code coupling).
- Wiring checks:
  - subaccounts (`F03/F04`) remain compatible,
  - approval gate (`F08`) required before finalize,
  - tax-posted lines (`F11`) reconcile in consolidated reports.

Depends on: PR-F06, PR-F08, PR-F11
Critical wiring milestone: yes

## PR-F13: Rollout/backfill/release gate expansion (PR-X1 + hardening)
Goal:
- Make all above safely deployable for existing tenants.

Deliverables:
- Backfill scripts:
  - workflow defaults
  - tax regime/code/account mapping seeds
  - canonical consolidation mapping bootstrap
- Expanded regression/release gate across Cari/Cash/Contracts/Bank/Payroll/Consolidation/Setup.
- Runbook updates for finance/ops rollout sequence.

Depends on: PR-F12

---

## Execution Order (recommended)
1. PR-F01
2. PR-F02
3. PR-F03
4. PR-F05
5. PR-F06
6. PR-F07
7. PR-F08
8. PR-F10
9. PR-F11
10. PR-F04
11. PR-F09
12. PR-F12
13. PR-F13

Notes:
- `F02/F03` and `F05/F06` can progress in parallel teams.
- `F12` is the main convergence PR where most wiring risks appear.
- Keep gating flags ON only for pilot tenants until `F13` completes.



