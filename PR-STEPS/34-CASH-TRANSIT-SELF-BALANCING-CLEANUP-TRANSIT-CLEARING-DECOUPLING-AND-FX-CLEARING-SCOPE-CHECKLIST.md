# 34 - CASH TRANSIT SELF-BALANCING CLEANUP, TRANSIT-CLEARING DECOUPLING, AND FX CLEARING SCOPE

## Execution tracking
- This file is the execution tracker for aligning cash transit runtime, API contract, readiness, OpenAPI, tests, and operator docs with the repo's current OU self-balancing reality.
- Current repo and live-DB evidence already confirm the accounting direction we want to formalize:
  - cross-OU cash transit journals are already posted through OU self-balancing current accounts such as `136.xx` / `336.xx`
  - the stored transit workflow rows can still carry `transit_account_id = 108`, but that account is not what the posted transit journal uses
  - FX exchange still uses `CASH_EXCHANGE_CLEARING` when `postingMode = CLEARING`
  - newer transit/self-balancing regressions already assert that posted cross-OU transit journals must not use transit clearing
- That mismatch has now been removed across runtime, schema, UX, readiness, OpenAPI, seeds, tests, and docs:
  - transit initiate no longer fallback-resolves or requires `CASH_TRANSIT_CLEARING`
  - `cash_transit_transfers.transit_account_id` is nullable and legacy-compatible
  - frontend transit UX no longer asks for a transit/counter account on the normal cross-OU happy path
  - readiness, policy-pack targets, OpenAPI text, and docs now scope active clearing meaning to FX `CLEARING` only
- This tracker was executed step by step instead of changing runtime, schema, readiness, docs, and tests in one patch.
- Legacy rows with populated `transit_account_id` remain readable if imported or backfilled. Fresh DB resets start without requiring or seeding one for normal transit flows.
- If product direction changes later, update this tracker before implementation continues.

## Scope
- relax cross-OU cash transit create flow so `transitAccountId` is not required
- decouple transit-mode posting and reversal from `counter_account_id` presence
- relax schema/read models so transit account metadata becomes nullable and legacy-compatible
- remove `CASH_TRANSIT_CLEARING` as a blocking readiness/setup dependency for cross-OU cash transit
- align frontend transit UX, OpenAPI, seed data, tests, and docs to the self-balancing model
- keep `CASH_IN_TRANSIT` available as workflow/operator language only where it describes the process, not a posted transit-clearing GL line
- preserve FX exchange clearing behavior for `postingMode = CLEARING`

## Locked product decisions for this tracker
- [x] Cross-OU cash transit accounting is OU self-balancing current-account accounting, not transit-clearing-account accounting.
- [x] Posted `TRANSFER_OUT`, `TRANSFER_IN`, and linked reversal journals for cross-OU cash transit must not post `CASH_TRANSIT_CLEARING`.
- [x] Cross-OU transit-mode detection must be based on:
  - different operating-unit contexts
  - explicit transit workflow linkage
  - same legal-entity and same-currency rules
  - not on presence of `counter_account_id`
- [x] New cross-OU transit initiation must not require `transitAccountId`.
- [x] New transit-linked `cash_transactions.counter_account_id` values may be `NULL` for cross-OU transit rows.
- [x] New `cash_transit_transfers.transit_account_id` values may be `NULL`; historical populated values remain readable.
- [x] `CASH_IN_TRANSIT` may remain as workflow/operator language in this rollout, but it must not imply posted use of `CASH_TRANSIT_CLEARING`.
- [x] `CASH_TRANSIT_CLEARING` is removed from normal cross-OU cash transit runtime meaning in this tracker, but remains in the CASH purpose-code catalog as legacy-compatible optional metadata during rollout.
- [x] `CASH_EXCHANGE_CLEARING` remains the only surviving cash-clearing purpose code with live runtime meaning in this tracker, and only for FX exchange `postingMode = CLEARING`.
- [x] `cashClearing` remains a blocking readiness row in this tracker, but it is driven by staged FX capability only: `CASH_EXCHANGE_CLEARING` stays required for readiness, while `CASH_TRANSIT_CLEARING` becomes non-blocking legacy metadata.
- [x] Any readiness/copy/setup semantics kept for `CASH_EXCHANGE_CLEARING` must stay limited to FX exchange `CLEARING` capability, not transit.
- [x] Preferred rollout path keeps the combined `cashClearing` module shape during this tracker, but any transit-clearing target inside that shape must be legacy-compatible, optional, and non-blocking rather than an active happy-path requirement.
- [x] FX exchange `DIRECT` mode continues to require no clearing account.
- [x] Same-context direct register transfer remains unchanged.
- [x] The cash transit workflow lifecycle, idempotency, evidence, and reversal linkage remain unchanged.
- [x] Global readiness must not block on transit-clearing setup for cross-OU cash transit once this tracker is complete.

## Important repo guardrails
- [x] `backend/src/services/cash.service.js` is the source of truth for cash journal-line construction. Transit decoupling must start from `resolveTransferPostingMode(...)` and `buildCashPostingLinesTx(...)`.
- [x] `backend/src/services/cash.transaction.service.js` is the source of truth for transit initiate / receive / reverse orchestration and for current `transit_account_id` storage.
- [x] `backend/src/services/cash.purpose-mappings.service.js` is still the generic cash-purpose resolver used by exchange flows. Transit cleanup should stop fallback at the transit call site, not by weakening exchange fallback globally.
- [x] `backend/src/services/gl.purpose-mappings.service.js` is the CASH purpose-code catalog source of truth. Keep catalog compatibility deliberate instead of removing `CASH_TRANSIT_CLEARING` accidentally.
- [x] `backend/src/routes/cash.transaction.validators.js` and `backend/scripts/generate-openapi.js` currently present `transitAccountId` as part of the public initiate contract.
- Resolved: `frontend/src/pages/cash/CashTransactionsPage.jsx` no longer auto-suggests a transit/counter account for the normal cross-OU transfer happy path.
- [x] `frontend/src/pages/cash/CashTransitTransfersPage.jsx` currently displays stored transit-account metadata; null/legacy handling must be explicit instead of breaking the page.
- Resolved: `backend/src/services/module-readiness.service.js`, `backend/src/services/policy-packs.service.js`, and `frontend/src/pages/settings/GlSetupPage.jsx` now treat `CASH_TRANSIT_CLEARING` as legacy optional metadata instead of an active readiness/setup dependency.
- [x] The repo already contains aligned regression intent that transit clearing must not post in cross-OU journals:
  - `backend/scripts/test-cash-pr26-transit-workflow.js`
  - `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`
- [x] Repo smoke/regression gates that also need to stay aligned with this rollout:
  - `backend/scripts/test-cash-counter-account-validation-and-ui-mapping.js`
  - `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
  - `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- [x] `backend/scripts/test-cash-pr08-gl-posting.js` is a collateral smoke: do not break its expectation that rejected direct cross-context transfer attempts still point operators to the `CASH_IN_TRANSIT` workflow.
- [x] Exchange collateral smokes should stay green after CTD04/CTD05:
  - `backend/scripts/test-cash-ex03-exchange-workflow.js`
  - `backend/scripts/test-cash-exf06-direct-mode-exchange.js`
  - `backend/scripts/test-cash-exf07-direct-mode-reversal.js`
- Resolved: `backend/src/seedStarter.js` no longer wires `transitAccountId` in the normal seeded transit happy path; only explicit legacy-compatibility scenarios still pass it on purpose.
- [x] OpenAPI source of truth remains `backend/scripts/generate-openapi.js`; regenerate `backend/openapi.yaml` only after route/schema changes land together.
- Guardrail: do not reintroduce transit-clearing posting into cross-OU cash transit just to preserve stale docs or setup semantics.

## Risk framing
- Conceptual/accounting risk is low:
  - the posted journals already follow the target model
  - the stronger transit/self-balancing regressions already assert that target model
- Implementation risk is medium:
  - API contract
  - OpenAPI text
  - frontend create UX
  - readiness/dashboard semantics
  - seed/test fixtures
  - nullable schema shift on `cash_transit_transfers.transit_account_id`
- The highest-risk mistake would be changing readiness/docs only, while leaving runtime still dependent on stored transit account metadata.
- The second highest-risk mistake would be relaxing create/schema first, while `resolveTransferPostingMode(...)` and reversal logic still require `counter_account_id`.
- CTD01 regression coverage may use fixture-crafted or migrated null-counter transit rows before CTD02 enables that shape through the normal initiate path.
- For that reason, the recommended order is:
  - runtime posting decoupling first
  - initiate/schema contract relaxation second
  - frontend create UX third
  - readiness/policy-pack cleanup fourth
  - OpenAPI/tests/docs/seed alignment last

## Out of scope for this tracker
- No redesign of OU self-balancing account provisioning itself.
- No intercompany / cross-legal-entity cash transit.
- No redesign of same-context direct transfer.
- No redesign of inventory item-card transit account behavior.
- No FX exchange fee/spread/revaluation redesign.
- No hard physical column drop for `cash_transit_transfers.transit_account_id` in the first rollout slice if read compatibility still needs it.
- No first-slice removal of `CASH_TRANSIT_CLEARING` from the CASH purpose-code catalog; that stays legacy-compatible unless a later tracker removes it deliberately.

## Master tracker
- [x] `PR-CTD01` - Transit posting-mode decoupling and reversal safety
- [x] `PR-CTD02` - Transit initiate contract relaxation and nullable schema foundation
- [x] `PR-CTD03` - Frontend transit UX and operator wording alignment
- [x] `PR-CTD04` - Readiness, policy-pack, and GL setup semantics cleanup
- [x] `PR-CTD05` - OpenAPI, seeds, regressions, and rollout docs alignment

## PR-CTD01 - Transit posting-mode decoupling and reversal safety

### Goal
- Make cross-OU cash transit posting and reversal depend on transit workflow linkage plus self-balancing setup, not on a transit-clearing account being present on the cash transaction row.

### Files
- `backend/src/services/cash.service.js`
- `backend/src/services/cash.transaction.service.js`
- `backend/scripts/test-cash-pr26-transit-workflow.js`
- `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`

### Routes / endpoints
- `POST /api/v1/cash/transactions/{transactionId}/post`
- `POST /api/v1/cash/transactions/{transactionId}/reverse`
- `POST /api/v1/cash/transactions/transit/{transitTransferId}/receive`

### Checklist

#### Posting-mode rules
- [x] Update `resolveTransferPostingMode(...)` so transit-linked cross-OU transfers no longer require `counter_account_id` to enter transit mode.
- [x] Keep the existing hard block for cross-OU transfer attempts that are not transit-linked.
- [x] Keep same-OU direct transfer behavior unchanged.
- [x] Remove or repurpose dead transit-clearing guard code such as `resolveTransitClearingOperatingUnitId(...)` once transit-clearing posting assumptions are no longer part of runtime flow.

#### Journal-line builder
- [x] Allow `buildCashPostingLinesTx(...)` to execute cross-OU transit-linked `TRANSFER_OUT` when `counter_account_id` is null.
- [x] Allow `buildCashPostingLinesTx(...)` to execute cross-OU transit-linked `TRANSFER_IN` when `counter_account_id` is null.
- [x] Keep transit posting based only on OU self-balancing accounts for:
  - `CENTRAL -> OU`
  - `OU -> CENTRAL`
  - `OU -> OU`
- [x] Confirm no posted transit journal line uses transit clearing after the change.

#### Reversal safety
- [x] Ensure reversal of transit-linked `TRANSFER_OUT` works when original `counter_account_id` is null.
- [x] Ensure reversal of transit-linked `TRANSFER_IN` works when original `counter_account_id` is null.
- [x] Keep lifecycle transitions and additive audit trail unchanged.

#### Regression
- [x] Extend PR26/CRO05 regressions to cover transit-linked rows with null `counter_account_id`.
- [x] If CTD02 is not landed yet, allow CTD01 regression setup to create null-counter transit rows through fixtures/migration-crafted data instead of normal initiate API flow.
- [x] Assert transfer-out, receive, and reversal still post correctly with self-balancing accounts only.

### Acceptance
- [x] Cross-OU transit-linked transfer rows can post and reverse without a transit-clearing account on the cash transaction row.
- [x] Posted transit journals still use only OU self-balancing accounts.
- [x] Non-transit cross-OU direct transfer attempts remain blocked.

## PR-CTD02 - Transit initiate contract relaxation and nullable schema foundation

### Goal
- Make `transitAccountId` optional on the normal transit path and stop transit-specific fallback to `CASH_TRANSIT_CLEARING` during initiation, without weakening generic FX exchange clearing resolution.

### Files
- `backend/src/migrations/index.js`
- `backend/src/migrations/m133_cash_transit_account_nullable.js`
- `backend/src/routes/cash.transaction.validators.js`
- `backend/src/services/cash.transaction.service.js`
- `backend/src/services/cash.queries.js`
- `backend/scripts/test-cash-pr26-transit-workflow.js`

### Routes / endpoints
- `POST /api/v1/cash/transactions/transit/initiate`
- `GET /api/v1/cash/transactions/transit`
- `GET /api/v1/cash/transactions/transit/{transitTransferId}`
- `POST /api/v1/cash/transactions/transit/{transitTransferId}/receive`

### Checklist

#### Migration
- [x] Create `backend/src/migrations/m133_cash_transit_account_nullable.js`.
- [x] Alter `cash_transit_transfers.transit_account_id` from `NOT NULL` to nullable.
- [x] Preserve FK/index coverage while allowing null values.
- [x] Register the migration in `backend/src/migrations/index.js`.

#### Validator and service contract
- [x] Keep `transitAccountId` parseable for backward compatibility, but stop treating it as required on initiate.
- [x] Stop resolving `CASH_TRANSIT_CLEARING` as a fallback during transit initiation when `transitAccountId` is omitted.
- [x] Do not weaken generic `resolveCashPurposeAccountId(...)` exchange fallback semantics unless a separate exchange-focused change explicitly justifies and regression-covers it.
- [x] If `transitAccountId` is provided during rollout, validate tenant/account ownership and store it only as optional legacy metadata.
- [x] Allow `transfer_out` creation with null `counterAccountId` for transit-linked rows.
- [x] Allow transit receive to create `TRANSFER_IN` with null `counterAccountId` instead of treating copied-forward `transit_account_id` as a required dependency.
- [x] Preserve idempotent replay behavior for both legacy non-null rows and new null rows.

#### Read-model compatibility
- [x] Keep transfer detail/list response fields nullable:
  - `transitAccountId`
  - `transitAccountCode`
  - `transitAccountName`
- [x] Keep old populated rows readable without pretending the field is still operationally required.
- [x] Treat transit-account response fields as legacy metadata, not as an active posting requirement.

#### Regression
- [x] Add regression coverage for new transit transfers created without `transitAccountId`.
- [x] Add compatibility regression for reading and receiving/reversing historical rows that still carry `transit_account_id`.

### Acceptance
- [x] Transit initiation succeeds without `transitAccountId`.
- [x] New transit rows can persist `NULL transit_account_id`.
- [x] Legacy transit rows remain readable and operational.

## PR-CTD03 - Frontend transit UX and operator wording alignment

### Goal
- Remove transit-clearing account selection from the normal cross-OU transit happy path and make the UI explain the self-balancing basis of the posting.

### Files
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/pages/cash/CashTransitTransfersPage.jsx`
- `frontend/src/api/cashAdmin.js`
- `frontend/src/i18n/messages.js`
- `backend/scripts/test-cash-counter-account-validation-and-ui-mapping.js`

### Routes / endpoints
- `POST /api/v1/cash/transactions/transit/initiate`
- `GET /api/v1/cash/transactions/transit`

### Checklist

#### Create-flow UX
- [x] Remove auto-suggestion of `CASH_TRANSIT_CLEARING` from the cross-OU transfer create path.
- [x] Remove transit account as a required picker/input for normal cross-OU transit initiation.
- [x] Remove client-side cross-OU `counterAccountId` required validation, not only the picker/prefill behavior.
- [x] Keep same-OU direct transfer UX unchanged.
- [x] Make cross-OU transfer guidance point operators to the transit workflow and self-balancing setup, not to a transit-clearing account.

#### Operator wording
- [x] Replace stale `CASH_IN_TRANSIT` / "transit counter account required" wording where it implies posted-account behavior.
- [x] Keep `CASH_IN_TRANSIT` wording where it still correctly describes the workflow/process, not the posted GL account.
- [x] Keep error/help text focused on:
  - transit workflow requirement
  - same legal-entity and same-currency rules
  - missing self-balancing setup / repair path

#### Legacy visibility
- [x] Keep read-only display of stored transit-account metadata on old rows when present.
- [x] Label the stored transit account as legacy/optional metadata instead of a required posting driver.

### Acceptance
- [x] Operators can initiate cross-OU transit without choosing a transit-clearing account.
- [x] UI wording matches the actual self-balancing accounting behavior.
- [x] Legacy rows with stored transit-account metadata remain understandable.

### Post-CTD03 cleanup note
- [x] Residual transfer-form `counterAccountId` state/prefill/display was removed so stale legacy `108` values no longer appear as selected transfer accounts on the create form.

## PR-CTD04 - Readiness, policy-pack, and GL setup semantics cleanup

### Goal
- Stop treating transit clearing as a blocking setup dependency once cross-OU cash transit no longer uses it.

### Risk note
- The current module-readiness model has no first-class optional legacy target concept inside a blocking module row. Readiness behavior here must be intentionally redesigned, not only reworded.

### Files
- `backend/src/services/module-readiness.service.js`
- `backend/src/services/policy-packs.service.js`
- `backend/src/services/policy-packs.resolve.service.js`
- `backend/src/services/gl.purpose-mappings.service.js`
- `frontend/src/pages/cash/CashExchangesPage.jsx`
- `frontend/src/i18n/messages.js`
- `frontend/src/pages/settings/GlSetupPage.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `backend/scripts/test-module-readiness.js`
- `backend/scripts/test-policy-pack-resolve.js`

### Routes / endpoints
- `GET /api/v1/onboarding/module-readiness`
- `GET /api/v1/onboarding/readiness`

### Checklist

#### Module readiness
- [x] Remove `CASH_TRANSIT_CLEARING` from blocking cash readiness requirements.
- [x] Remove the blocker logic that requires `CASH_EXCHANGE_CLEARING` and `CASH_TRANSIT_CLEARING` to map to different accounts.
- [x] Keep `cashClearing` as a blocking readiness row, but make its ready/not-ready outcome depend on `CASH_EXCHANGE_CLEARING` only after this tracker.
- [x] Keep readiness aligned to actual runtime-critical dependencies instead of stale default/setup preferences.
- [x] Update `backend/scripts/test-module-readiness.js` helper fixtures/expectations so cash readiness goes green when exchange clearing is configured even if transit clearing is absent.

#### Policy packs
- [x] Stop treating `108.02` / `Cash Transit Clearing` as a required cash-clearing target in starter-policy-pack readiness semantics.
- [x] Keep `CASH_TRANSIT_CLEARING` catalog visibility deliberate:
  - legacy-compatible and optional during rollout
  - not part of normal cash-transit happy-path guidance
- [x] Keep the existing combined `cashClearing` module shape as the default rollout path for this tracker.
- [x] Within that combined shape, keep exchange clearing active/blocking and mark the transit-clearing target as legacy/optional/non-blocking instead of active default guidance.
- [x] Only consider splitting the module shape into active exchange vs optional legacy transit targets if a broader readiness/OpenAPI/client contract change is intentionally approved later.
- [x] Decide whether deprecated transit-clearing suggestion remains visible as optional legacy metadata or is removed from happy-path policy-pack output.

#### GL setup and dashboard wording
- [x] Update GL setup cash-copy so transit clearing is no longer described as a normal cross-OU transit default.
- [x] Update `CashExchangesPage.jsx` copy so `CLEARING` is described as staged FX clearing only, without transit-runtime wording drift.
- [x] Update `frontend/src/i18n/messages.js` exchange labels/help text so staged clearing is described as FX-only and direct mode is described without stale transit wording.
- [x] Ensure dashboard blocker counts stop surfacing transit-clearing setup as a period-close blocker through module readiness.
- [x] Make the remaining exchange-clearing scope explicit in operator wording.

#### Explicit exchange-clearing decision
- [x] Keep any remaining `CASH_EXCHANGE_CLEARING` readiness/copy semantics scoped to FX exchange `postingMode = CLEARING`, not general cash transit.
- [x] Keep exchange clearing as a blocking readiness requirement for staged FX capability in this tracker.
- [x] Do not downgrade exchange clearing to a non-blocking advisory/default in this rollout.
- [x] Do not leave exchange-clearing severity in an accidental half-state after transit-clearing removal.
- [x] Touch `backend/src/services/tenant-readiness.service.js` only if readiness snapshot labels/counts still need secondary aggregation changes after `module-readiness.service.js` is updated.

### Acceptance
- [x] Transit clearing no longer creates a blocking readiness/module blocker.
- [x] Cash readiness still blocks until `CASH_EXCHANGE_CLEARING` is configured for staged FX capability.
- [x] Dashboard blocker counts no longer reflect stale transit-clearing setup debt.
- [x] GL setup and policy-pack semantics match runtime behavior.

## PR-CTD05 - OpenAPI, seeds, regressions, and rollout docs alignment

### Goal
- Make generated contracts, fixtures, runbooks, and rollout tests describe the final runtime model accurately.

### Files
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/src/seedStarter.js`
- `backend/scripts/test-cash-pr26-transit-workflow.js`
- `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`
- `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
- `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- `backend/scripts/test-cash-ex03-exchange-workflow.js`
- `backend/scripts/test-cash-exf06-direct-mode-exchange.js`
- `backend/scripts/test-cash-exf07-direct-mode-reversal.js`
- `backend/scripts/test-shareholder-capital-integration.js`
- `backend/scripts/test-shareholder-capital-cf05-cash-register-fulfillment.js`
- `docs/kullanim-kilavuzlari/KULLANIM_KILAVUZU_KASA_MODULU.md`
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cash-fx-exchange-operations.md`
- `docs/runbooks/shareholder-capital-fulfillment-operations.md`

### Routes / endpoints
- `POST /api/v1/cash/transactions/transit/initiate`
- `POST /api/v1/cash/transactions/transit/{transitTransferId}/receive`
- `GET /api/v1/cash/transactions/transit/{transitTransferId}`

### Checklist

#### OpenAPI
- [x] Keep transit initiate request schema optional/nullable for `transitAccountId`, but remove the stale description that says backend resolves a transit-clearing purpose mapping when it is omitted.
- [x] Update transfer detail/list schemas so transit-account fields are explicitly nullable legacy metadata, not active runtime requirements.
- [x] Regenerate `backend/openapi.yaml`.

#### Seeds and regressions
- [x] Remove forced `transitAccountId` wiring from seed/fixture flows unless the test is explicitly about legacy compatibility.
- [x] Update transit/create/reversal regressions to create normal cross-OU transit without transit-clearing setup.
- [x] Keep one compatibility regression for old rows that still contain a stored transit account.
- [x] Keep CRO03/CRO04 rollout smoke coverage aligned with the chosen workflow-vs-posting wording.
- [x] Run exchange collateral smokes to confirm staged-clearing and direct-mode behavior stayed intact.

#### Docs
- [x] Update Kasa module guide so cross-OU transit is documented as self-balancing posting, while allowing `CASH_IN_TRANSIT` to remain as workflow/process terminology where accurate.
- [x] Update CARI/cash runbooks so they distinguish:
  - cross-OU transit -> self-balancing current accounts
  - FX exchange `CLEARING` -> exchange clearing account
- [x] Update shareholder-capital follow-up docs so central-to-branch transit no longer implies a required transit-clearing account in the happy path.

### Acceptance
- [x] OpenAPI, seeds, tests, and docs all match the self-balancing transit model.
- [x] Normal cross-OU transit test/seed paths no longer need `108` / transit-clearing setup.
- [x] FX exchange docs remain explicit about the surviving role of `CASH_EXCHANGE_CLEARING`.
