# 32 - OU CURRENT-ACCOUNT SETUP WIZARD AND INCREMENTAL AUTO-PROVISIONING

## Execution tracking
- This file is the execution tracker for wizard-driven OU current-account setup automation.
- It covers setup-time provisioning and later branch-add delta provisioning.
- If product direction changes later, update this tracker before implementation continues.

## Scope
- saved legal-entity current-account control-parent config
- setup wizard step for current-account setup after account tree and branches
- full central <-> OU and OU <-> OU child-account auto-provision from saved config
- incremental delta provisioning when new branches are added later
- Organization Management maintenance and repair UX
- tenant readiness, module readiness, OpenAPI, regression gates, and rollout notes

## Locked product decisions for this tracker
- [x] Users choose parent control accounts in the happy path, not every branch-specific leaf account one by one.
- [x] V1 saved config is per legal entity, not one global tenant-wide setting.
- [x] V1 uses one ASSET/DEBIT parent and one LIABILITY/CREDIT parent for current-account child generation.
- [x] The same two saved parents drive all six role families:
  - central due from OU
  - central due to OU
  - OU due from central
  - OU due to central
  - due from partner OU
  - due to partner OU
- [x] The setup-wizard step appears after account tree and branches, because both CoA and OU list must exist first.
- [x] The setup-wizard current-account step is skippable in v1, but skipping leaves readiness incomplete for tenant readiness and cross-context modules in multi-OU legal entities.
- [x] Existing branch-specific account model remains the base pattern; no dimension-first redesign in this tracker.
- [x] Setup-time provisioning must create or reuse leaf accounts and mappings idempotently.
- [x] Later branch creation must run delta-only provisioning; existing branches and mappings are not recreated from zero.
- [x] Organization Management remains the maintenance surface for review, repair, and rerun.
- [x] Existing manual mapping endpoints for direct save/repair remain supported during rollout; this does not include legacy one-off auto-provision endpoints.
- [x] Legacy explicit parent-based one-off auto-provision endpoints do not need backward compatibility in this tracker once in-repo callers are migrated.
- [x] Reason: the planned app reset removes data-compat pressure, and keeping both legacy one-off auto-provision endpoints and the new saved-config apply flow would preserve two competing provisioning models unnecessarily.
- [x] Same legal entity only in v1.
- [x] Existing OU current-account auto-provision logic in `backend/src/services/org.write.service.js` is the base to extend, not replace.
- [x] Current central auto-provision only covers `central_due_from_account_id` and `ou_due_to_central_account_id`; this tracker must extend it to reverse-direction fields too.
- [x] Wizard and Organization Management should initiate or surface provisioning automatically when saved config exists, while backend remains the canonical executor.
- [x] Later branch add must not force users to set up all branches from zero again.
- [x] V1 should not silently overwrite valid manual mappings during auto-provision; repair/overwrite must be explicit.
- [x] Auto-provision on branch create is backend-owned domain behavior, not a UI-only convenience; all OU create paths must follow the same rule.
- [x] Saved-config apply during bootstrap may run only after the target legal entity CoA and default accounts are materialized in the same transaction.
- [x] Company-bootstrap current-account config must identify selected parents by stable legal-entity account `code`, not DB `account_id`, because bootstrap creates those rows inside the same transaction.
- [x] Shared OU current-account provisioning logic must be exposed through internal transaction-aware helpers so onboarding bootstrap can reuse it inside its existing transaction without nesting `withTransaction(...)`.
- [x] Saved current-account config must affect tenant readiness as well as module readiness for multi-OU legal entities.
- [x] Readiness and wizard recommendations in this tracker must use effective active OU count, not raw historical OU row count.
- [x] Current-account control parents in v1 must be child-capable control/header accounts, not arbitrary posting leaf accounts.
- [x] Changing saved control parents later must not silently remap existing valid mappings; explicit rebaseline is required if finance wants a full remap.
- [x] V1 keeps one shared Due From parent and one shared Due To parent for both central <-> OU and OU <-> OU families.

## Important repo guardrails
- [x] Reuse the existing OU auto-provision building blocks in `backend/src/services/org.write.service.js`:
  - `autoProvisionOperatingUnitCentralCurrentAccounts(...)`
  - `autoProvisionOperatingUnitPartnerCurrentAccounts(...)`
- [x] Extend current central provisioning to cover all four central <-> OU directional fields:
  - `central_due_from_account_id`
  - `central_due_to_account_id`
  - `ou_due_from_central_account_id`
  - `ou_due_to_central_account_id`
- [x] Keep OU-pair mappings directional. `A -> B` and `B -> A` remain separate rows.
- [x] Provisioning must stay idempotent and delta-only.
- [x] Do not silently pick arbitrary leaf accounts from the full legal-entity account list when saved config exists.
- [x] Do not destroy or remap valid existing rows during ordinary reruns.
- [x] Keep manual repair paths available in Organization Management.
- [x] Do not hard-require a background job system in v1.
- [x] If current-account setup is skipped, branch creation still remains possible; tenant readiness and cross-context module readiness should carry the blocker instead.
- [x] Extend or replace `updateOperatingUnitInternalCurrentAccountsRow(...)` so saved-config apply persists all four central <-> OU fields explicitly.
- [x] Backend write orchestration, not page-level UI code, is the canonical owner of automatic delta provisioning behavior.
- [x] Public route/service entrypoints may stay request-friendly, but they must delegate to tx-aware internal helpers instead of being the only implementation.
- [x] Because legacy one-off auto-provision behavior currently appears in cash flows, rollout tests, and OpenAPI, endpoint-removal work must update code, docs, and regression coverage together.
- [x] Legacy endpoint removal, caller migration, cash-page updates, CRO rollout test updates, and OpenAPI regeneration should land in a synchronized slice to avoid temporary CI breakage.
- [x] Effective active OU eligibility for cross-context flow should come from one shared backend rule/helper reused by wizard recommendations, tenant readiness, module readiness, and Organization Management hints.
- [x] `frontend/src/pages/settings/OrganizationManagementPage.jsx` is already a hot file; OU18 work should prefer extraction/staged edits over one large monolithic rewrite.

## Out of scope for this tracker
- No cross-legal-entity or intercompany current-account generation.
- No dimension-driven interunit redesign.
- No automatic rename or recode of already-created branch-specific accounts.
- No generic account-code formula builder UI in v1.
- No posting-engine redesign beyond consuming the now-automated mappings.
- No hard dependency on async workers or queues.

## Deferred finance design discussion for possible v2 split-parent model
- V1 does not introduce separate control-parent families for `central <-> OU` versus `OU <-> OU`.
- Finance may still ask for that split later because the economic meaning of the balances can differ even if both are internal current accounts.
- Typical reasons finance may want separate parents:
  - `central <-> OU` balances often represent HQ funding, treasury clearing, reimbursement, or head-office settlement positions.
  - `OU <-> OU` balances often represent operational branch-to-branch settlements such as stock transfers, shared-service recharge, or peer clearing.
  - HQ balances are often reconciled by central finance or treasury, while OU-pair balances are often reconciled by branch/accounting operations.
  - HQ balances and OU-pair balances may have different aging, netting, escalation, and close procedures.
  - Finance may want different balance-sheet presentation, elimination buckets, or management-reporting slices for head-office balances versus peer-branch balances.
  - Audit or statutory reporting may prefer a clear distinction between balances with head office and balances with other branches.
- If finance later requires the split, the likely v2 shape becomes four saved parents per legal entity:
  - `central_ou_due_from_parent_account_id`
  - `central_ou_due_to_parent_account_id`
  - `ou_ou_due_from_parent_account_id`
  - `ou_ou_due_to_parent_account_id`
- That v2 discussion should start only if finance rejects the shared-two-parent model or reporting proves it insufficient after rollout.

## Master tracker
- [x] `PR-OU14` - Legal-entity current-account control-parent config foundation
- [x] `PR-OU15` - Saved-config apply engine for full central <-> OU and OU <-> OU provisioning
- [x] `PR-OU16` - Setup Wizard step and company-bootstrap integration
- [x] `PR-OU17` - Incremental provisioning for later branch additions
- [x] `PR-OU18` - Organization Management maintenance, drift visibility, and manual repair UX
- [x] `PR-OU19` - Readiness, operator feedback, and setup guardrails
- [x] `PR-OU20` - OpenAPI, regression gates, and rollout docs

## PR-OU14 - Legal-entity current-account control-parent config foundation

### Goal
- Persist the saved current-account parent controls once per legal entity so setup-time and later delta provisioning can reuse the same intent.

### Files
- `backend/src/migrations/m130_operating_unit_current_account_configs.js`
- `backend/src/migrations/index.js`
- `backend/src/routes/org.write.validators.js`
- `backend/src/routes/org.js`
- `backend/src/services/org.write.service.js`
- `backend/src/services/org.read.queries.js`
- `backend/src/services/org.write.queries.js`
- `frontend/src/api/orgAdmin.js`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/i18n/messages.js`
- `backend/scripts/test-org-ou14-current-account-config-foundation.js`

### Checklist

#### Migration
- [x] Create `backend/src/migrations/m130_operating_unit_current_account_configs.js`
- [x] Create table `operating_unit_current_account_configs`
- [x] Add `tenant_id`
- [x] Add `legal_entity_id`
- [x] Add `due_from_parent_account_id`
- [x] Add `due_to_parent_account_id`
- [x] Add `auto_provision_on_operating_unit_create BOOLEAN NOT NULL DEFAULT TRUE`
- [x] Add `last_applied_at TIMESTAMP NULL`
- [x] Add timestamps
- [x] Add unique `(tenant_id, legal_entity_id)`
- [x] Add FK coverage for `legal_entity_id -> legal_entities.id`
- [x] Add FK coverage for `due_from_parent_account_id -> accounts.id`
- [x] Add FK coverage for `due_to_parent_account_id -> accounts.id`
- [x] Add useful index coverage for `(tenant_id, legal_entity_id)`

#### Migration registration
- [x] Register `m130_operating_unit_current_account_configs` in `backend/src/migrations/index.js`

#### Validation and write rules
- [x] Add read/upsert validators for current-account config
- [x] Enforce saved parent accounts belong to a `LEGAL_ENTITY` CoA
- [x] Enforce `due_from_parent_account_id` belongs to selected legal entity
- [x] Enforce `due_to_parent_account_id` belongs to selected legal entity
- [x] Enforce `due_from_parent_account_id` is active
- [x] Enforce `due_to_parent_account_id` is active
- [x] Enforce `due_from_parent_account_id` is `ASSET` and `DEBIT`
- [x] Enforce `due_to_parent_account_id` is `LIABILITY` and `CREDIT`
- [x] Enforce saved parent accounts are child-capable control/header accounts
- [x] Reject posting leaf accounts as saved control parents
- [x] Enforce `due_from_parent_account_id != due_to_parent_account_id`
- [x] Keep scope resolution on `LEGAL_ENTITY`

#### Routes and API
- [x] Add `GET /api/v1/org/operating-unit-current-account-config`
- [x] Add `POST /api/v1/org/operating-unit-current-account-config`
- [x] Add frontend API helpers in `frontend/src/api/orgAdmin.js`

#### Frontend foundation
- [x] Add legal-entity current-account config card/section in Organization Management
- [x] Show configured parent accounts per legal entity
- [x] Show `auto_provision_on_operating_unit_create`
- [x] Show `last_applied_at` when present

#### Regression
- [x] Create `backend/scripts/test-org-ou14-current-account-config-foundation.js`
- [x] Test create config
- [x] Test update config
- [x] Test invalid account-type rejection
- [x] Test posting leaf account is rejected as a saved control parent
- [x] Test legal-entity mismatch rejection

### Acceptance
- [x] Each legal entity can persist one saved OU current-account parent config
- [x] Parent accounts are validated correctly
- [x] Config is visible in Organization Management

## PR-OU15 - Saved-config apply engine for full central <-> OU and OU <-> OU provisioning

### Goal
- Add one config-driven apply path that can provision all missing current-account children and mappings for a legal entity, or only the missing delta for one OU.

### Files
- `backend/src/routes/org.write.validators.js`
- `backend/src/routes/org.js`
- `backend/src/services/org.write.service.js`
- `backend/src/services/org.write.queries.js`
- `backend/src/services/org.read.queries.js`
- `frontend/src/api/orgAdmin.js`
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/pages/cash/CashTransitTransfersPage.jsx`
- `frontend/src/i18n/messages.js`
- `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
- `backend/scripts/test-cash-register-ownership-cro06-auto-provision.js`
- `backend/scripts/test-cash-register-ownership-cro07-central-auto-provision.js`
- `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- `backend/scripts/test-org-ou15-current-account-config-apply.js`

### Checklist

#### Provisioning engine
- [x] Add service helper `applyOperatingUnitCurrentAccountConfig(...)`
- [x] Add internal tx-aware helper `applyOperatingUnitCurrentAccountConfigTx(tx, ...)` as the canonical provisioning implementation
- [x] Add or extract tx-aware central helper so current central auto-provision logic can run inside caller-owned transactions
- [x] Add or extract tx-aware partner helper so OU-pair auto-provision logic can run inside caller-owned transactions
- [x] Support `legalEntityId` full-apply mode
- [x] Support optional `operatingUnitId` delta-apply mode
- [x] Load saved config from `operating_unit_current_account_configs`
- [x] Reuse existing child-account lookup/discovery helpers where they still fit
- [x] Reuse existing child-account insert helper
- [x] Reuse existing unique-account assignment guards
- [x] Reuse existing parent-account validation helpers
- [x] Add new orchestration for full four-role central account allocation where current two-role central allocation logic is insufficient
- [x] Extend or replace `updateOperatingUnitInternalCurrentAccountsRow(...)` so central apply persists all four central <-> OU fields, not only the current two-field shape
- [x] Extend central provisioning so saved-config apply covers:
  - `central_due_from_account_id`
  - `central_due_to_account_id`
  - `ou_due_from_central_account_id`
  - `ou_due_to_central_account_id`
- [x] Keep OU-pair provisioning directional and idempotent
- [x] Create or reuse both directions:
  - `A -> B`
  - `B -> A`
- [x] Reuse valid existing mappings instead of recreating them
- [x] Do not overwrite valid manual mappings in default apply mode
- [x] Default apply mode is repair-missing-only
- [x] Return skipped/conflicting-manual rows in apply summary when default repair mode leaves existing mappings untouched
- [x] Update `last_applied_at` on successful apply
- [x] Tx-aware helpers must accept caller-owned `tx` plus resolved IDs/context, not `req`
- [x] Tx-aware helpers must not perform request-scope authorization checks directly
- [x] Public route-facing wrappers must keep permission and scope checks, then delegate into the tx-aware helpers
- [x] Avoid nested `withTransaction(...)` when config apply is called from onboarding bootstrap or other transaction-owned flows
- [x] Tx-aware helper return shape must be stable enough for both route responses and bootstrap result summaries

#### Route and payload
- [x] Add `POST /api/v1/org/operating-unit-current-account-config/apply`
- [x] Accept:
  - `legalEntityId`
  - optional `operatingUnitId`
  - optional `repairMissingOnly = true`
- [x] Return structured summary:
  - created accounts
  - reused accounts
  - updated OU mappings
  - updated OU-pair mappings
  - warnings

#### Legacy endpoint removal
- [x] Remove legacy explicit parent-based one-off auto-provision endpoints after in-repo callers are migrated
- [x] Reason in implementation/docs: app reset allows cleanup, and one canonical saved-config apply path is preferred over parallel provisioning APIs
- [x] Migrate existing in-repo callers of legacy auto-provision endpoints to saved-config apply or manual repair flows
- [x] Remove deprecated frontend API helpers for legacy auto-provision endpoints from `frontend/src/api/orgAdmin.js`
- [x] Remove or replace current cash-page shortcuts that call legacy one-off auto-provision endpoints
- [x] Remove or replace transit-page guidance that still tells operators to complete setup inline from Kasa Islemleri if that inline legacy flow is removed
- [x] Update inline/setup guidance copy in `frontend/src/i18n/messages.js` to point to the surviving saved-config/manual-repair path
- [x] Update cash ownership rollout tests that currently assert legacy one-off auto-provision behavior:
  - `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
  - `backend/scripts/test-cash-register-ownership-cro06-auto-provision.js`
  - `backend/scripts/test-cash-register-ownership-cro07-central-auto-provision.js`
  - `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- [x] Do not break existing manual Organization Management flows
- [x] Do not expose destructive remap/rebaseline in default apply flow unless product explicitly approves that follow-up

#### Regression
- [x] Create `backend/scripts/test-org-ou15-current-account-config-apply.js`
- [x] Test first apply for two OUs provisions all four OU-direction fields
- [x] Test first apply provisions both OU-pair directions
- [x] Test rerun is idempotent
- [x] Test valid existing mappings are reused
- [x] Test reverse-direction OU fields are now filled from saved config
- [x] Test single-OU delta apply creates only missing delta vs existing OUs
- [x] Test default repair mode does not overwrite existing valid manual mappings after parent config changes
- [x] Test apply summary includes skipped/conflicting rows
- [x] Test `last_applied_at` updates only after successful apply

### Acceptance
- [x] One saved-config apply can provision a full legal entity
- [x] One saved-config apply can provision only the delta for a new OU
- [x] Existing valid mappings are preserved

## PR-OU16 - Setup Wizard step and company-bootstrap integration

### Goal
- Add a dedicated setup-wizard step after account tree and branches so current-account parent config can be captured and applied during company setup.

### Files
- `frontend/src/pages/settings/CompanyOnboardingPage.jsx`
- `frontend/src/api/onboarding.js`
- `backend/src/routes/onboarding.js`
- `frontend/src/i18n/messages.js`
- `backend/scripts/test-org-ou16-company-bootstrap-current-account-setup.js`

### Checklist

#### Wizard UX
- [x] Add setup-wizard step after `branches`
- [x] Step title clearly explains:
  - choose Due From parent account
  - choose Due To parent account
  - SaaP will create or reuse branch-specific child accounts automatically
- [x] Collect config per legal entity, not one global value for the tenant
- [x] Only enable this step after account tree and branches are available
- [x] If a legal entity has zero or one active OU eligible for cross-context flow, allow skip with informational note
- [x] If a legal entity has multiple active OUs eligible for cross-context flow, show this step as recommended for cross-context readiness

#### Eligibility recommendation source
- [x] Add backend-backed eligibility preview/source for wizard recommendations instead of duplicating active-OU eligibility logic only in the page
- [x] The wizard should send current draft branch/legal-entity inputs to backend and receive effective active OU eligibility/recommendation result
- [x] Reuse the same backend eligibility rule/helper that OU19 uses for readiness and Organization Management hints
- [x] Keep frontend-only logic limited to shaping draft payload and rendering the returned recommendation state

#### Bootstrap payload identity
- [x] Define bootstrap current-account config payload to use legal-entity-local parent account codes
- [x] Do not use DB `account_id` values in wizard bootstrap payload for parent selection
- [x] Do not use temporary wizard row IDs as the public bootstrap contract
- [x] Selected parent identity must resolve from the same legal entity's account-tree rows by final `code`
- [x] If selected parent code is renamed or removed before submit, wizard state must update or block submit
- [x] Backend must resolve submitted parent codes to real `accounts.id` values only after CoA/default-account materialization in the same transaction
- [x] Backend must fail bootstrap with a clear validation error if submitted parent code cannot be resolved in the target legal entity CoA
- [x] After successful bootstrap resolution, persist saved OU current-account config by resolved DB account IDs

#### Company bootstrap payload and backend
- [x] Extend `/api/v1/onboarding/company-bootstrap` payload to accept current-account config per legal entity
- [x] Payload shape must use `dueFromParentAccountCode` and `dueToParentAccountCode` or equivalent explicit code-based fields
- [x] Persist saved config during bootstrap
- [x] Run config-driven apply only after branches and the target legal-entity CoA/default accounts are materialized in the same bootstrap transaction
- [x] If needed, reorder entity bootstrap orchestration so apply happens after `upsertOnboardingDefaultAccountsForCoa(...)`
- [x] Onboarding bootstrap must call tx-aware provisioning helpers directly using its existing transaction handle
- [x] Bootstrap must not call route-oriented provisioning functions that open their own `withTransaction(...)`
- [x] Include provisioning summary in bootstrap response
- [x] If step is skipped, do not fail bootstrap; return structured readiness warning instead

#### Regression
- [x] Create `backend/scripts/test-org-ou16-company-bootstrap-current-account-setup.js`
- [x] Test bootstrap with one legal entity and configured parents
- [x] Test bootstrap with multiple OUs creates current-account mappings
- [x] Test bootstrap skip path succeeds but returns pending-readiness result
- [x] Test rerunning bootstrap is idempotent for current-account provisioning
- [x] Test bootstrap resolves submitted parent account codes to real DB account IDs after account-tree materialization
- [x] Test bootstrap rejects unknown or stale parent account codes with clear validation error
- [x] Test bootstrap provisioning participates in one transaction and rolls back with bootstrap failure
- [x] Test wizard recommendation/skip state comes from backend eligibility preview for draft OU inputs

### Acceptance
- [x] Wizard can capture current-account parents after branches are known
- [x] Wizard recommendation/skip state is backed by the shared eligibility rule, not a separate page-local interpretation
- [x] Bootstrap identity contract for saved parents is explicit and code-based
- [x] Bootstrap can provision OU current accounts automatically
- [x] Skip path is explicit and non-destructive

## PR-OU17 - Incremental provisioning for later branch additions

### Goal
- When a new branch is added later, auto-provision only the missing current-account delta instead of forcing full manual re-setup.

### Files
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/api/orgAdmin.js`
- `backend/src/routes/org.js`
- `backend/src/services/org.write.service.js`
- `backend/scripts/test-org-ou17-incremental-branch-delta-provision.js`

### Checklist

#### Incremental behavior
- [x] Define delta apply contract for one newly added OU
- [x] When saved config exists and `auto_provision_on_operating_unit_create = true`, backend OU-create orchestration must run delta apply automatically
- [x] Apply this rule to all OU-create paths that use the canonical write service, not only Organization Management form submit
- [x] Organization Management should only surface the provisioning result returned by backend create orchestration
- [x] Delta apply must create or reuse:
  - the missing four-field central <-> OU setup for the new OU
  - the missing directional OU-pair mappings between new OU and every existing active OU in the same legal entity
- [x] Delta apply must not recreate or disturb existing valid mappings for other OUs
- [x] If saved config does not exist, branch save still succeeds and returns/setup UI warning
- [x] If delta apply fails, branch save still remains visible and operator gets actionable warning plus rerun path

#### Frontend UX
- [x] After branch save, show provisioning summary:
  - child accounts created
  - mappings created
  - reused rows
  - warnings
- [x] Add explicit action on OU row:
  - `Auto-provision current accounts for this branch`
- [x] Add legal-entity action:
  - `Apply saved current-account config to all branches`

#### Regression
- [x] Create `backend/scripts/test-org-ou17-incremental-branch-delta-provision.js`
- [x] Test add third OU after initial two-OU setup
- [x] Test only missing delta is created
- [x] Test old mappings remain untouched
- [x] Test save without config still works and returns clear warning

### Acceptance
- [x] Later branch additions no longer require setup from zero
- [x] Delta-only provisioning works for new OUs
- [x] Operators see what was created vs reused

## PR-OU18 - Organization Management maintenance, drift visibility, and manual repair UX

### Goal
- Keep Organization Management as the explicit maintenance surface, while making saved-config automation the default happy path.

### Files
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/api/orgAdmin.js`
- `backend/src/services/org.read.queries.js`
- `backend/src/routes/org.js`
- `frontend/src/i18n/messages.js`
- `backend/scripts/test-org-ou18-organization-management-current-account-ux.js`

### Checklist

#### Maintenance UX
- [x] Add saved current-account config section per legal entity
- [x] Show config status:
  - configured
  - missing
  - last applied
  - auto-provision on branch create
- [x] Show when config changed after the last successful apply
- [x] Show drift indicators:
  - OU row missing one or more of four central <-> OU mappings
  - OU-pair direction missing
  - saved config exists but legal entity still not fully ready
- [x] Add `Repair missing only` action
- [x] No explicit `Rebaseline from saved config` action was added because destructive remap is still not product-approved in this tracker
- [x] Keep manual OU field edit available for advanced exception handling
- [x] Keep manual OU-pair row edit available for advanced exception handling
- [x] Prefer extracting new OU current-account sections/helpers from `OrganizationManagementPage.jsx` instead of concentrating all OU18 changes in one hot file edit

#### Account-pick UX hardening
- [x] Saved-config automation should be the first-class UX, not a broad flat dropdown
- [x] When manual account pick is used, exact branch-matching candidates must rank before other same-entity accounts
- [x] If non-matching same-entity accounts remain visible, label or separate them clearly as fallback choices
- [x] Reduce accidental wrong-branch account choice in dropdowns with explicit filtering/ranking rules that can be regression-tested
- [x] Make manual override clearly appear as exception/advanced mode

#### Regression
- [x] Create `backend/scripts/test-org-ou18-organization-management-current-account-ux.js`
- [x] Test drift indicators when config exists but mappings are incomplete
- [x] Test repair action only fills missing rows
- [x] Test manual dropdown ranking prefers exact branch-matching candidates over unrelated same-entity accounts
- [x] Test manual edit paths still work

### Acceptance
- [x] Organization Management remains the repair and review surface
- [x] Operators can see drift and fix only what is missing
- [x] Automation becomes the default path, not manual leaf-account browsing

## PR-OU19 - Readiness, operator feedback, and setup guardrails

### Goal
- Surface current-account setup completeness clearly in tenant readiness, module readiness, and module-blocking feedback without making generic company bootstrap impossible.

### Files
- `backend/src/services/module-readiness.service.js`
- `backend/src/routes/onboarding.module-readiness.routes.js`
- `backend/src/services/tenant-readiness.service.js`
- `backend/src/routes/onboarding.js`
- `frontend/src/readiness/TenantReadinessProvider.jsx`
- `frontend/src/readiness/TenantReadinessChecklist.jsx`
- `frontend/src/layouts/AppLayout.jsx`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/i18n/messages.js`
- touched module pages where missing current-account setup already blocks posting:
  - `frontend/src/pages/cash/CashTransactionsPage.jsx`
  - `frontend/src/pages/cari/CariSettlementsPage.jsx`
  - inventory/cross-context pages as needed
- `backend/scripts/test-org-ou19-current-account-readiness-feedback.js`

### Checklist

#### Readiness
- [x] Add one shared backend rule/helper for effective active OU eligibility used across readiness and UI hint surfaces
- [x] Extract current tenant-readiness snapshot logic from `backend/src/routes/onboarding.js` into `backend/src/services/tenant-readiness.service.js`
- [x] Make `/api/v1/onboarding/readiness` and baseline-bootstrap flows delegate to the extracted tenant-readiness service instead of keeping split logic in-route
- [x] Add tenant-readiness check for OU current-account automation
- [x] Add legal-entity current-account readiness row to module readiness
- [x] Readiness must use effective active OU count, not raw historical OU row count
- [x] Mark as not applicable when legal entity has zero or one active OU eligible for cross-context flow
- [x] Tenant readiness is blocked when any legal entity with multiple active OUs that can produce cross-context flow lacks saved config or complete mappings
- [x] Mark as blocked when saved config missing and cross-context setup is expected
- [x] Mark as blocked when saved config exists but OU or OU-pair mappings are incomplete
- [x] Reuse the same backend eligibility rule/helper for wizard recommendation payloads and Organization Management hints to avoid drift
- [x] Link readiness blocker back to Organization Management

#### Operator feedback
- [x] Improve missing-setup errors so they mention saved-config apply path, not only manual mapping fields
- [x] Distinguish:
  - no saved config
  - saved config exists but not yet applied
  - saved config exists but drift remains
- [x] Keep posting blockers explicit for cross-context flows

#### Regression
- [x] Create `backend/scripts/test-org-ou19-current-account-readiness-feedback.js`
- [x] Test tenant readiness blocks when a multi-OU legal entity has no saved config
- [x] Test tenant readiness blocks when a multi-OU legal entity has partial current-account mappings
- [x] Test inactive/retired OUs do not create false readiness blockers when active OU count is zero or one
- [x] Test one-OU entity does not get false blocker
- [x] Test multi-OU entity without config is blocked
- [x] Test multi-OU entity with partial mappings is blocked
- [x] Test tenant-readiness labels/quick links render for the new OU current-account readiness key
- [x] Test messages point operator to Organization Management/current-account setup

### Acceptance
- [x] Tenant readiness and module readiness clearly reflect current-account automation state
- [x] Users know whether they need config, apply, or repair
- [x] Cross-context modules stay safely blocked when setup is incomplete

## PR-OU20 - OpenAPI, regression gates, and rollout docs

### Goal
- Finish public contract, regression coverage, and operator docs for saved-config current-account automation.

### Files
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/package.json`
- `backend/scripts/test-release-gate.js`
- `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
- `backend/scripts/test-cash-register-ownership-cro06-auto-provision.js`
- `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- `backend/scripts/test-cash-register-ownership-cro07-central-auto-provision.js`
- new regression scripts
- release-gate runner files as needed
- docs under `PR-STEPS/` and related rollout notes

### Checklist

#### OpenAPI
- [x] Add schemas for:
  - saved current-account config
  - config apply request
  - config apply response summary
  - company-bootstrap current-account config request using code-based parent references
  - Organization Management drift/readiness fields
- [x] Regenerate `backend/openapi.yaml`

#### Regression gates
- [x] Add config foundation regression to CI flow
- [x] Add saved-config apply regression to CI flow
- [x] Add bootstrap integration regression to CI flow
- [x] Add incremental branch delta regression to CI flow
- [x] Add readiness/operator-feedback regression to CI flow
- [x] Update or replace cash ownership rollout tests that reference legacy auto-provision endpoints so CI reflects the new saved-config flow
- [x] Land route removal/caller migration, transit/cash-page copy updates, CRO03/CRO04/CRO06/CRO07 changes, package script updates, release-gate wiring, and OpenAPI regeneration together so CI is not left in an intermediate broken state
- [x] Add package scripts for all new regressions
- [x] Optionally add aggregate gate:
  - `test:ou:current-account-automation:release-gate`

#### Rollout docs
- [x] Add operator note:
  - choose parent control accounts once
  - system creates or reuses branch-specific children automatically
- [x] Add operator note for later branch add:
  - only delta is created
  - old branches are not reset
- [x] Add troubleshooting for:
  - saved config missing
  - config exists but apply not run
  - config exists but mapping drift remains
- [x] Add note that manual Organization Management edit remains available for exceptions

### Acceptance
- [x] API contract documents the feature
- [x] Release gates cover setup-time and delta-time behavior
- [x] Operators have a clear runbook

## Recommended exact implementation order
- [x] 1. Create `m130_operating_unit_current_account_configs.js`
- [x] 2. Add read/write config routes, queries, and validators
- [x] 3. Add Organization Management config card foundation
- [x] 4. Add `applyOperatingUnitCurrentAccountConfig(...)` and four-field central persistence/query changes as one implementation slice
- [x] 5. Finish tx-aware central orchestration so apply is complete only once reverse-direction OU fields persist correctly
- [x] 6. Add saved-config apply route
- [x] 7. Add full-entity and single-OU delta apply regression tests
- [x] 8. Add setup-wizard step after branches
- [x] 9. Extend company bootstrap payload and backend orchestration
- [x] 10. Wire wizard submit to saved-config apply during bootstrap
- [x] 11. Add backend-owned post-create delta apply flow and surface it in Organization Management
- [x] 12. Add repair/drift visibility in Organization Management
- [x] 13. Add readiness and operator feedback
- [x] 14. Finish OpenAPI, package scripts, release gate, and rollout docs

## Done definition
- [x] Legal entity can save one current-account parent config
- [x] Wizard can collect and apply current-account config after account tree and branches
- [x] System can provision all required central <-> OU mappings from saved config
- [x] System can provision all required OU-pair mappings from saved config
- [x] Later branch add creates only missing delta
- [x] Existing mappings are not recreated from zero
- [x] Organization Management shows config, drift, repair, and summary feedback
- [x] Tenant readiness and cross-context module readiness reflect whether setup is actually complete
- [x] OpenAPI, regression gates, and rollout docs are aligned
