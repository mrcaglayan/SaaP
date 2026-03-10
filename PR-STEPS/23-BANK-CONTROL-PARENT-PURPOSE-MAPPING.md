# 23 - BANK CONTROL PARENT PURPOSE MAPPING (OPTION B DIRECT)

## Execution tracking
- This is a source/spec file.
- Execution status should be tracked in the project tracker, not in this document.

## Implementation outcome
- All `PR-BPM01` to `PR-BPM05` slices are implemented.
- Current runtime resolves bank control parent from `BANK_CONTROL_PARENT` and uses `POST /api/v1/bank/accounts/provision-control-parent-child`.
- The temporary deprecated `/provision-102-child` alias was removed on March 11, 2026.

## Locked decisions
- Implement Option B directly. Do not add an intermediate `bankControlParentAccountId` field.
- Literal account code `102` stops being a product invariant for bank setup.
- Bank control parent resolution must use `journal_purpose_accounts` directly.
- Add manual purpose-mapping module key `BANK`.
- Add required v1 purpose code `BANK_CONTROL_PARENT`.
- Missing `BANK_CONTROL_PARENT` mapping must block strict bank validation and one-click provisioning with a setup-required message.
- Do not silently fall back to literal `102` when the BANK mapping is missing.
- `BANK_CONTROL_PARENT` is a different validation profile from current manual mappings:
  - account must be in the selected tenant and legal entity chart
  - account must be `ACTIVE`
  - account must be `ASSET`
  - non-postable parent/header accounts must be allowed
  - the mapped account itself is not a valid bank posting leaf
- Strict bank validation must require the selected bank GL account to be a postable leaf descendant below the mapped parent, not the mapped parent itself.
- One-click provisioning must create the child under the mapped parent with neutral naming and endpoint semantics.
- User-facing copy, route names, and idempotency scope names must stop referring to `102`.
- A deprecated `/provision-102-child` compatibility alias was acceptable for one release only during cutover, but it had to delegate to the generic mapped-parent flow and was removed on March 11, 2026.
- V1 supports one BANK purpose code only:
  - `BANK_CONTROL_PARENT`
- Future variants are explicitly out of scope for this PR set:
  - `BANK_CONTROL_PARENT_LOCAL`
  - `BANK_CONTROL_PARENT_FOREIGN`
  - `BANK_CONTROL_PARENT_BY_OU`

## Historical pre-implementation deltas that mattered
- `backend/src/services/gl.purpose-mappings.service.js` only supports `CARI`, `CASH`, and `REVREC`.
- The shared purpose-mapping service currently requires mapped accounts to be postable, which is wrong for a control parent.
- `backend/src/services/bank.accounts.service.js` hard-codes `102` in:
  - strict subtree validation
  - parent lookup and lock helpers
  - child allocator naming and error messages
- `backend/src/routes/bank.accounts.routes.js` exposes `/provision-102-child`.
- `frontend/src/api/bankAccounts.js` and `frontend/src/pages/bank/BankAccountsPage.jsx` hard-code `102` in function names, idempotency keys, helper text, and success messages.
- `backend/src/services/module-readiness.service.js` has no bank-control-parent readiness row.
- `frontend/src/pages/settings/GlSetupPage.jsx` does not load or save BANK purpose mappings.
- `backend/src/services/policy-packs.service.js` and related pack apply/resolve flows do not seed a BANK control-parent mapping.
- `backend/src/services/cari.purpose-mapping-autofix.service.js` still contains `102/100` heuristics; this matters because bank provisioning currently triggers a CARI auto-remap side effect after creating a child account.

## Scope
- Replace hard-coded bank control account resolution with direct BANK purpose mapping resolution.
- Keep current strict-mode feature gate behavior shape:
  - when strict mode is off, baseline bank GL validation stays `ACTIVE + LEGAL_ENTITY + ASSET + postable + leaf`
  - when strict mode is on, the selected bank GL must also be under the mapped bank control parent
- Preserve one-click bank provisioning, but generalize it to any mapped parent code.
- Add readiness, setup UX, policy-pack coverage, and migration/backfill support for the BANK mapping.

## Non-goals
- No `bankControlParentAccountId` legal-entity field.
- No full redesign of all purpose-mapping semantics for every module.
- No direct expansion to separate local/foreign/OU bank parents in v1.
- No broad rewrite of every `102` or `100` heuristic in unrelated modules unless it blocks the bank-control-parent cutover.
- No destructive migration of existing bank accounts.

## Unified execution order
1. `PR-BPM01` - BANK purpose-mapping foundation
2. `PR-BPM02` - Bank service cutover to mapped-parent resolution
3. `PR-BPM03` - Neutral bank provisioning API, frontend UX, and readiness
4. `PR-BPM04` - Policy packs, legacy backfill, and integration hardening
5. `PR-BPM05` - Test suite, rollout runbook, and cleanup

## Master tracker
- [x] `PR-BPM01` acceptance: manual BANK mapping can be read and saved, and `BANK_CONTROL_PARENT` accepts a valid active asset control parent even when it is non-postable.
  smoke: `backend/scripts/test-bank-control-bpm01-purpose-mapping.js`
- [x] `PR-BPM02` acceptance: strict bank GL validation and one-click child creation resolve the parent from `BANK_CONTROL_PARENT`, not literal `102`.
  smoke: `backend/scripts/test-bank-control-bpm02-service-cutover.js`
- [x] `PR-BPM03` acceptance: bank setup UI, API naming, and module readiness all surface the mapped-parent setup model with no user-facing `102` dependency.
  smoke: `backend/scripts/test-bank-control-bpm03-readiness-api.js`
  smoke: `backend/scripts/test-bank-control-bpm03-frontend-smoke.js`
- [x] `PR-BPM04` acceptance: policy-pack flows can apply BANK mappings and legacy tenants can be backfilled where the parent is unambiguous.
  smoke: `backend/scripts/test-bank-control-bpm04-policy-pack-backfill.js`
- [x] `PR-BPM05` acceptance: deprecated compatibility surfaces are cleaned up or explicitly sunset, rollout docs exist, and regression coverage is in place.
  smoke: `backend/scripts/test-bank-control-bpm05-regression.js`

## PR-BPM01
Goal:
- Extend the existing manual purpose-mapping infrastructure so BANK becomes a first-class module without forcing bank control parents into the current postable-leaf validation model.

Deliverables:
- Extend `backend/src/services/gl.purpose-mappings.service.js` with:
  - `PURPOSE_MODULE_KEYS.BANK`
  - `BANK_PURPOSE_CODES = ["BANK_CONTROL_PARENT"]`
  - purpose-to-module registration for BANK
  - a validation-profile layer instead of one global `allow_posting` requirement
- Introduce a bank-control validation profile for `BANK_CONTROL_PARENT`:
  - same tenant
  - `LEGAL_ENTITY` chart only
  - same `legalEntityId`
  - `ACTIVE`
  - `ASSET`
  - allow parent/header usage
  - postable not required
- Preserve existing validation behavior for `CARI`, `CASH`, and `REVREC`.
- Extend mapping row serialization so the consumer can distinguish:
  - valid for current BANK purpose usage
  - valid for postable-leaf posting
  - invalid reason when present
- Extend `backend/src/routes/gl.purpose-mappings.routes.js` only as needed for the new module and response shape.
- Extend `frontend/src/pages/settings/GlSetupPage.jsx` to:
  - load BANK mappings
  - render a BANK setup card/table
  - save `BANK_CONTROL_PARENT`
  - show BANK-specific helper copy and validity status
- Extend `frontend/src/i18n/messages.js` with BANK module labels and setup help text.

Files:
- `backend/src/services/gl.purpose-mappings.service.js`
- `backend/src/routes/gl.purpose-mappings.routes.js`
- `frontend/src/pages/settings/GlSetupPage.jsx`
- `frontend/src/i18n/messages.js`

Acceptance:
- A non-postable `ASSET` parent in the selected legal-entity chart can be saved as `BANK_CONTROL_PARENT`.
- A wrong-type, inactive, cross-entity, or group-chart account is rejected.
- Existing manual mappings for `CARI`, `CASH`, and `REVREC` behave exactly as before.
- BANK rows load and save in GL Setup without custom SQL outside the shared purpose-mapping service.

Notes:
- No DB migration is expected for this PR because `journal_purpose_accounts` already exists.
- This PR is the prerequisite for all later BANK setup, readiness, and bank-service work.

## PR-BPM02
Goal:
- Remove hard-coded `102` logic from bank-account backend validation and provisioning by resolving the parent through `BANK_CONTROL_PARENT`.

Deliverables:
- Refactor `backend/src/services/bank.accounts.service.js`:
  - replace `findControl102Account` with `resolveBankControlParentMapping`
  - replace `lockControl102AccountForProvision` with `lockBankControlParentForProvision`
  - replace `createProvisionedChildAccountUnder102` with `createProvisionedChildAccountUnderParent`
  - replace `provisionBankAccountWith102Child` with neutral mapped-parent provisioning service
- Strict-mode validation flow:
  - if `FEATURE_SUBACCOUNTS_V1` is disabled, keep baseline validation
  - if enabled, require `BANK_CONTROL_PARENT` mapping
  - reject missing mapping with setup-required message
  - reject mapped account if it is no longer valid for bank-control usage
  - reject selected bank GL if it is not a postable leaf descendant below the mapped parent
  - reject selected bank GL if it is the mapped parent itself
- Provisioning flow:
  - lock the mapped parent
  - validate parent is still `ACTIVE`, `ASSET`, same legal entity, and suitable for child creation
  - allocate deterministic child codes under the mapped parent code, e.g. `<parent>.001`, `<parent>.002`
  - enforce parent remains non-postable after first child creation
  - create the bank account and linked child atomically
- Update backend error messages from `102` language to BANK mapping language.
- Audit the current `autoRemapCariPurposeMappingsForLegalEntity` side effect and lock one behavior:
  - either keep it if it remains correct under generic parent provisioning
  - or remove/replace it in the bank provisioning path if it remains `102/100`-biased

Files:
- `backend/src/services/bank.accounts.service.js`
- `backend/src/services/gl.purpose-mappings.service.js`
- `backend/src/services/cari.purpose-mapping-autofix.service.js` if the current side effect must be generalized or removed

Acceptance:
- A tenant with `BANK_CONTROL_PARENT -> 102` behaves like today without using literal-code lookup.
- A tenant with `BANK_CONTROL_PARENT -> 1000` can create and validate bank accounts without any synthetic `102`.
- Strict mode blocks bank setup when the BANK mapping is missing.
- The mapped parent itself cannot be linked as the final bank GL account.
- One-click provisioning works under any valid mapped parent code.

## PR-BPM03
Goal:
- Replace `102`-named API and UX surfaces with neutral control-parent terminology and add readiness support.

Deliverables:
- Add a neutral route in `backend/src/routes/bank.accounts.routes.js`:
  - preferred: `/provision-control-parent-child`
- Rename the primary service import and call sites to neutral naming.
- Keep `/provision-102-child` as a deprecated compatibility alias for one release only if deploy sequencing needs it; BPM05 removes it after the transition window.
- Update idempotency scope naming from `BANK_PROVISION_102_...` to neutral control-parent naming.
- Update `frontend/src/api/bankAccounts.js`:
  - replace `provisionBankAccount102Child` with neutral naming
  - keep a temporary wrapper only if the deprecated backend alias is still active
- Update `frontend/src/pages/bank/BankAccountsPage.jsx`:
  - rename `autoProvision102` state and related handlers
  - update checkbox copy, helper text, placeholders, and success messages
  - remove all user-facing references to `102`
  - state clearly that GL child creation happens under the configured bank control parent
- Add bank readiness support in `backend/src/services/module-readiness.service.js`:
  - new module key: `bankControlParent`
  - required purpose code: `BANK_CONTROL_PARENT`
  - bank-specific readiness evaluator
- Surface readiness in frontend:
  - `frontend/src/pages/settings/GlSetupPage.jsx`
  - `frontend/src/pages/bank/BankAccountsPage.jsx`
  - `frontend/src/pages/Dashboard.jsx` and `frontend/src/i18n/messages.js` if module labels or detail text are needed

Files:
- `backend/src/routes/bank.accounts.routes.js`
- `backend/src/services/bank.accounts.service.js`
- `backend/src/services/module-readiness.service.js`
- `frontend/src/api/bankAccounts.js`
- `frontend/src/pages/bank/BankAccountsPage.jsx`
- `frontend/src/pages/settings/GlSetupPage.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/i18n/messages.js`

Acceptance:
- No bank setup UI copy says `102`.
- New bank provisioning endpoint and idempotency scope are neutral.
- Missing BANK mapping appears as a readiness blocker per legal entity.
- GL Setup shows BANK readiness/validity in the same area as other mapping-driven modules.
- If the deprecated alias remains temporarily, it calls the same generic flow and returns the same neutral semantics.

## PR-BPM04
Goal:
- Seed and migrate the BANK mapping safely for existing and new tenants, and harden adjacent integration points that would otherwise keep reintroducing `102` assumptions.

Deliverables:
- Extend policy-pack definition/resolve/apply flows so packs can propose and write `BANK_CONTROL_PARENT`.
- Add a BANK module or target group in policy-pack output:
  - TR packs should resolve to `102` when that is the pack's bank parent
  - US/custom packs should resolve to their own bank parent candidates
- Add a legacy backfill script for existing tenants:
  - when strict mode is enabled and a single unambiguous legal-entity `102` bank parent exists, backfill `BANK_CONTROL_PARENT`
  - when there is no unambiguous parent, emit a remediation report instead of guessing
- Audit onboarding/starter flows so BANK mapping is not skipped in new installs that rely on policy packs.
- Explicitly evaluate remaining bank-adjacent `102/100` heuristics:
  - `backend/src/services/policy-packs.service.js`
  - `backend/src/services/cari.purpose-mapping-autofix.service.js`
- For this PR set, fix only the heuristics that can break BANK direct cutover. Record the rest as follow-up if they are merely suggestion quality issues.

Files:
- `backend/src/services/policy-packs.service.js`
- `backend/src/services/policy-packs.resolve.service.js`
- `backend/src/services/policy-packs.apply.service.js`
- `backend/src/routes/onboarding.js`
- `backend/src/seedStarter.js`
- `backend/scripts/*bank-control*backfill*.js`
- `backend/src/services/cari.purpose-mapping-autofix.service.js` if required by the chosen side-effect strategy

Acceptance:
- Policy-pack preview can show a BANK mapping recommendation.
- Policy-pack apply can write `BANK_CONTROL_PARENT`.
- Legacy TR tenants can be backfilled without behavior drift.
- No bank strict-mode tenant is forced to create a fake `102` after rollout.

## PR-BPM05
Goal:
- Lock the new BANK mapping behavior with regression coverage and document rollout/sunset steps.

Deliverables:
- Backend coverage:
  - BANK mapping save/read
  - strict-mode manual bank GL validation under mapped parent
  - missing mapping failure path
  - invalid mapping failure path
  - one-click provisioning under non-`102` parent
  - idempotent replay for generic control-parent provisioning
  - legacy backfill script behavior
- Frontend smoke coverage:
  - BANK mapping card in GL Setup
  - bank page readiness warning
  - neutral provisioning copy and submit path
- Rollout runbook:
  - backfill sequence
  - tenant audit query
  - pilot cohort
  - deprecated alias removal date
  - rollback posture
- Cleanup list:
  - remove deprecated `/provision-102-child` alias after the sunset window (completed on March 11, 2026)
  - remove any remaining bank-page variable names or strings that mention `102`

Files:
- `backend/scripts/test-bank-control-bpm01-purpose-mapping.js`
- `backend/scripts/test-bank-control-bpm02-service-cutover.js`
- `backend/scripts/test-bank-control-bpm03-readiness-api.js`
- `backend/scripts/test-bank-control-bpm04-policy-pack-backfill.js`
- `backend/scripts/test-bank-control-bpm05-regression.js`
- rollout docs under `PR-STEPS` or `docs/`

Acceptance:
- Regression scripts cover both TR-style and non-TR-style charts.
- Rollout docs state exactly how missing BANK mappings are detected and corrected.
- There is a dated plan to remove the deprecated alias if it was kept for compatibility.

## Data migration and rollout posture
- This plan does not require a schema migration for `journal_purpose_accounts`.
- Existing bank-account rows remain linked to their current GL accounts.
- Existing strict-mode tenants need a backfill or manual setup for `BANK_CONTROL_PARENT` before the hard cutover is enabled in production.
- Recommended rollout order:
  1. ship BANK mapping foundation and neutral API/UI support
  2. backfill or manually configure BANK mappings for pilot tenants
  3. enable mapped-parent strict-mode behavior in pilot tenants
  4. monitor provisioning, readiness, and bank-account create/update flows
  5. expand to GA
  6. remove deprecated alias and leftover `102` naming

## Open implementation risks to manage
- Shared purpose-mapping code currently assumes "valid" means postable; BANK breaks that assumption and must not degrade existing modules.
- Provisioning currently mutates parent `allow_posting`; if a mapped parent is postable today, the first child creation changes account behavior and downstream mappings may need revalidation.
- The CARI auto-remap side effect must be reviewed carefully because it currently prefers `102/100` and could produce wrong remaps under non-TR charts.
- Policy-pack suggestions and starter data may still steer users toward `102` unless BANK mapping targets are added explicitly.
- Dashboard/readiness translations may show raw module keys if the new bank module is added without i18n entries.

## Recommended cut line for the first implementation branch
- Deliver `PR-BPM01`, `PR-BPM02`, and `PR-BPM03` together if possible.
- Do not ship service cutover without BANK mapping UI and readiness, otherwise strict-mode tenants will get setup blockers with no guided path.
- `PR-BPM04` may ship immediately after if legacy tenant backfill is needed for rollout.
