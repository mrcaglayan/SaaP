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
