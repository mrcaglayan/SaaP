# 34 - CASH TRANSIT SELF-BALANCING CLEANUP, TRANSIT-CLEARING DECOUPLING, AND FX CLEARING SCOPE

## Execution tracking
- This file is the execution tracker for aligning cash transit runtime, API contract, readiness, OpenAPI, tests, and operator docs with the repo's current OU self-balancing reality.
- Current repo and live-DB evidence already confirm the accounting direction we want to formalize:
  - cross-OU cash transit journals are already posted through OU self-balancing current accounts such as `136.xx` / `336.xx`
  - the stored transit workflow rows can still carry `transit_account_id = 108`, but that account is not what the posted transit journal uses
  - FX exchange still uses `CASH_EXCHANGE_CLEARING` when `postingMode = CLEARING`
  - newer transit/self-balancing regressions already assert that posted cross-OU transit journals must not use transit clearing
- The mismatch is currently in contract/setup layers, not in the posted transit accounting outcome:
  - transit create still resolves and stores `CASH_TRANSIT_CLEARING`
  - `cash_transit_transfers.transit_account_id` is still `NOT NULL`
  - frontend transit UX still asks for a transit/counter account
  - readiness, policy-pack targets, OpenAPI text, and docs still treat transit clearing as an active setup dependency
- This tracker removes that mismatch step by step instead of trying to change runtime, schema, readiness, docs, and tests in one patch.
- Legacy rows with populated `transit_account_id` remain readable during rollout. New transit rows should not require one.
- If product direction changes later, update this tracker before implementation continues.

## Scope
- relax cross-OU cash transit create flow so `transitAccountId` is not required
- decouple transit-mode posting and reversal from `counter_account_id` presence
- relax schema/read models so transit account metadata becomes nullable and legacy-compatible
- remove `CASH_TRANSIT_CLEARING` as a blocking readiness/setup dependency for cross-OU cash transit
- align frontend transit UX, OpenAPI, seed data, tests, and docs to the self-balancing model
- preserve FX exchange clearing behavior for `postingMode = CLEARING`

## Locked product decisions for this tracker
- [ ] Cross-OU cash transit accounting is OU self-balancing current-account accounting, not transit-clearing-account accounting.
- [ ] Posted `TRANSFER_OUT`, `TRANSFER_IN`, and linked reversal journals for cross-OU cash transit must not post `CASH_TRANSIT_CLEARING`.
- [ ] Cross-OU transit-mode detection must be based on:
  - different operating-unit contexts
  - explicit transit workflow linkage
  - same legal-entity and same-currency rules
  - not on presence of `counter_account_id`
- [ ] New cross-OU transit initiation must not require `transitAccountId`.
- [ ] New transit-linked `cash_transactions.counter_account_id` values may be `NULL` for cross-OU transit rows.
- [ ] New `cash_transit_transfers.transit_account_id` values may be `NULL`; historical populated values remain readable.
- [ ] `CASH_TRANSIT_CLEARING` is removed from normal cross-OU cash transit runtime meaning in this tracker.
- [ ] `CASH_EXCHANGE_CLEARING` remains the only surviving cash-clearing purpose code with live runtime meaning in this tracker, and only for FX exchange `postingMode = CLEARING`.
- [ ] FX exchange `DIRECT` mode continues to require no clearing account.
- [ ] Same-context direct register transfer remains unchanged.
- [ ] The cash transit workflow lifecycle, idempotency, evidence, and reversal linkage remain unchanged.
- [ ] Global readiness must not block on transit-clearing setup for cross-OU cash transit once this tracker is complete.

## Important repo guardrails
- [ ] `backend/src/services/cash.service.js` is the source of truth for cash journal-line construction. Transit decoupling must start from `resolveTransferPostingMode(...)` and `buildCashPostingLinesTx(...)`.
- [ ] `backend/src/services/cash.transaction.service.js` is the source of truth for transit initiate / receive / reverse orchestration and for current `transit_account_id` storage.
- [ ] `backend/src/routes/cash.transaction.validators.js` and `backend/scripts/generate-openapi.js` currently present `transitAccountId` as part of the public initiate contract.
- [ ] `frontend/src/pages/cash/CashTransactionsPage.jsx` is the current upstream create surface still auto-suggesting a transit/counter account for cross-OU transfer.
- [ ] `frontend/src/pages/cash/CashTransitTransfersPage.jsx` currently displays stored transit-account metadata; null/legacy handling must be explicit instead of breaking the page.
- [ ] `backend/src/services/module-readiness.service.js`, `backend/src/services/policy-packs.service.js`, and `frontend/src/pages/settings/GlSetupPage.jsx` currently encode `CASH_TRANSIT_CLEARING` as a readiness/setup concept.
- [ ] The repo already contains aligned regression intent that transit clearing must not post in cross-OU journals:
  - `backend/scripts/test-cash-pr26-transit-workflow.js`
  - `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`
- [ ] `backend/src/seedStarter.js` and nearby rollout fixtures still wire `transitAccountId`; update them only after runtime and contract slices are ready.
- [ ] OpenAPI source of truth remains `backend/scripts/generate-openapi.js`; regenerate `backend/openapi.yaml` only after route/schema changes land together.
- [ ] Do not reintroduce transit-clearing posting into cross-OU cash transit just to preserve stale docs or setup semantics.

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

## Master tracker
- [ ] `PR-CTD01` - Transit posting-mode decoupling and reversal safety
- [ ] `PR-CTD02` - Transit initiate contract relaxation and nullable schema foundation
- [ ] `PR-CTD03` - Frontend transit UX and operator wording alignment
- [ ] `PR-CTD04` - Readiness, policy-pack, and GL setup semantics cleanup
- [ ] `PR-CTD05` - OpenAPI, seeds, regressions, and rollout docs alignment

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
- [ ] Update `resolveTransferPostingMode(...)` so transit-linked cross-OU transfers no longer require `counter_account_id` to enter transit mode.
- [ ] Keep the existing hard block for cross-OU transfer attempts that are not transit-linked.
- [ ] Keep same-OU direct transfer behavior unchanged.

#### Journal-line builder
- [ ] Allow `buildCashPostingLinesTx(...)` to execute cross-OU transit-linked `TRANSFER_OUT` when `counter_account_id` is null.
- [ ] Allow `buildCashPostingLinesTx(...)` to execute cross-OU transit-linked `TRANSFER_IN` when `counter_account_id` is null.
- [ ] Keep transit posting based only on OU self-balancing accounts for:
  - `CENTRAL -> OU`
  - `OU -> CENTRAL`
  - `OU -> OU`
- [ ] Confirm no posted transit journal line uses transit clearing after the change.

#### Reversal safety
- [ ] Ensure reversal of transit-linked `TRANSFER_OUT` works when original `counter_account_id` is null.
- [ ] Ensure reversal of transit-linked `TRANSFER_IN` works when original `counter_account_id` is null.
- [ ] Keep lifecycle transitions and additive audit trail unchanged.

#### Regression
- [ ] Extend PR26/CRO05 regressions to cover transit-linked rows with null `counter_account_id`.
- [ ] Assert transfer-out, receive, and reversal still post correctly with self-balancing accounts only.

### Acceptance
- [ ] Cross-OU transit-linked transfer rows can post and reverse without a transit-clearing account on the cash transaction row.
- [ ] Posted transit journals still use only OU self-balancing accounts.
- [ ] Non-transit cross-OU direct transfer attempts remain blocked.

## PR-CTD02 - Transit initiate contract relaxation and nullable schema foundation

### Goal
- Make `transitAccountId` truly optional end-to-end and stop runtime fallback to `CASH_TRANSIT_CLEARING` during transit initiation.

### Files
- `backend/src/migrations/index.js`
- `backend/src/migrations/m133_cash_transit_account_nullable.js`
- `backend/src/routes/cash.transaction.validators.js`
- `backend/src/services/cash.transaction.service.js`
- `backend/src/services/cash.queries.js`
- `backend/src/services/cash.purpose-mappings.service.js`
- `backend/scripts/test-cash-pr26-transit-workflow.js`

### Routes / endpoints
- `POST /api/v1/cash/transactions/transit/initiate`
- `GET /api/v1/cash/transactions/transit`
- `GET /api/v1/cash/transactions/transit/{transitTransferId}`
- `POST /api/v1/cash/transactions/transit/{transitTransferId}/receive`

### Checklist

#### Migration
- [ ] Create `backend/src/migrations/m133_cash_transit_account_nullable.js`.
- [ ] Alter `cash_transit_transfers.transit_account_id` from `NOT NULL` to nullable.
- [ ] Preserve FK/index coverage while allowing null values.
- [ ] Register the migration in `backend/src/migrations/index.js`.

#### Validator and service contract
- [ ] Keep `transitAccountId` parseable for backward compatibility, but stop treating it as required on initiate.
- [ ] Stop resolving `CASH_TRANSIT_CLEARING` as a fallback when `transitAccountId` is omitted.
- [ ] If `transitAccountId` is provided during rollout, validate tenant/account ownership and store it only as optional legacy metadata.
- [ ] Allow `transfer_out` creation with null `counterAccountId` for transit-linked rows.
- [ ] Allow transit receive to create `TRANSFER_IN` with null `counterAccountId` when the transfer row has null `transit_account_id`.
- [ ] Preserve idempotent replay behavior for both legacy non-null rows and new null rows.

#### Read-model compatibility
- [ ] Keep transfer detail/list response fields nullable:
  - `transitAccountId`
  - `transitAccountCode`
  - `transitAccountName`
- [ ] Keep old populated rows readable without pretending the field is still operationally required.

#### Regression
- [ ] Add regression coverage for new transit transfers created without `transitAccountId`.
- [ ] Add compatibility regression for reading and receiving/reversing historical rows that still carry `transit_account_id`.

### Acceptance
- [ ] Transit initiation succeeds without `transitAccountId`.
- [ ] New transit rows can persist `NULL transit_account_id`.
- [ ] Legacy transit rows remain readable and operational.

## PR-CTD03 - Frontend transit UX and operator wording alignment

### Goal
- Remove transit-clearing account selection from the normal cross-OU transit happy path and make the UI explain the self-balancing basis of the posting.

### Files
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/pages/cash/CashTransitTransfersPage.jsx`
- `frontend/src/api/cashAdmin.js`
- `frontend/src/i18n/messages.js`

### Routes / endpoints
- `POST /api/v1/cash/transactions/transit/initiate`
- `GET /api/v1/cash/transactions/transit`

### Checklist

#### Create-flow UX
- [ ] Remove auto-suggestion of `CASH_TRANSIT_CLEARING` from the cross-OU transfer create path.
- [ ] Remove transit account as a required picker/input for normal cross-OU transit initiation.
- [ ] Keep same-OU direct transfer UX unchanged.
- [ ] Make cross-OU transfer guidance point operators to the transit workflow and self-balancing setup, not to a transit-clearing account.

#### Operator wording
- [ ] Replace stale `CASH_IN_TRANSIT` / "transit counter account required" wording where it implies posted-account behavior.
- [ ] Keep error/help text focused on:
  - transit workflow requirement
  - same legal-entity and same-currency rules
  - missing self-balancing setup / repair path

#### Legacy visibility
- [ ] Keep read-only display of stored transit-account metadata on old rows when present.
- [ ] Label the stored transit account as legacy/optional metadata instead of a required posting driver.

### Acceptance
- [ ] Operators can initiate cross-OU transit without choosing a transit-clearing account.
- [ ] UI wording matches the actual self-balancing accounting behavior.
- [ ] Legacy rows with stored transit-account metadata remain understandable.

## PR-CTD04 - Readiness, policy-pack, and GL setup semantics cleanup

### Goal
- Stop treating transit clearing as a blocking setup dependency once cross-OU cash transit no longer uses it.

### Files
- `backend/src/services/module-readiness.service.js`
- `backend/src/services/tenant-readiness.service.js`
- `backend/src/services/policy-packs.service.js`
- `frontend/src/pages/settings/GlSetupPage.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `backend/scripts/test-module-readiness.js`
- `backend/scripts/test-policy-pack-resolve.js`

### Routes / endpoints
- `GET /api/v1/onboarding/module-readiness`
- `GET /api/v1/onboarding/readiness`

### Checklist

#### Module readiness
- [ ] Remove `CASH_TRANSIT_CLEARING` from blocking cash readiness requirements.
- [ ] Remove the blocker logic that requires `CASH_EXCHANGE_CLEARING` and `CASH_TRANSIT_CLEARING` to map to different accounts.
- [ ] Keep readiness aligned to actual runtime-critical dependencies instead of stale default/setup preferences.

#### Policy packs
- [ ] Stop treating `108.02` / `Cash Transit Clearing` as a required cash-clearing target in starter-policy-pack readiness semantics.
- [ ] Decide whether deprecated transit-clearing suggestion remains visible as optional legacy metadata or is removed from happy-path policy-pack output.

#### GL setup and dashboard wording
- [ ] Update GL setup cash-copy so transit clearing is no longer described as a normal cross-OU transit default.
- [ ] Ensure dashboard blocker counts stop surfacing transit-clearing setup as a period-close blocker through module readiness.
- [ ] Make the remaining exchange-clearing scope explicit in operator wording.

#### Explicit exchange-clearing decision
- [ ] Decide and document whether `CASH_EXCHANGE_CLEARING` remains:
  - a blocking readiness item
  - or a non-blocking capability warning/default
- [ ] Do not leave exchange-clearing blocker severity in an accidental half-state after transit-clearing removal.

### Acceptance
- [ ] Transit clearing no longer creates a blocking readiness/module blocker.
- [ ] Dashboard blocker counts no longer reflect stale transit-clearing setup debt.
- [ ] GL setup and policy-pack semantics match runtime behavior.

## PR-CTD05 - OpenAPI, seeds, regressions, and rollout docs alignment

### Goal
- Make generated contracts, fixtures, runbooks, and rollout tests describe the final runtime model accurately.

### Files
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/seedStarter.js`
- `backend/scripts/test-cash-pr26-transit-workflow.js`
- `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`
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
- [ ] Update transit initiate request schema so `transitAccountId` is optional/nullable and no longer described as a required fallback to transit-clearing mapping.
- [ ] Update transfer detail/list schemas so transit-account fields are explicitly nullable legacy metadata.
- [ ] Regenerate `backend/openapi.yaml`.

#### Seeds and regressions
- [ ] Remove forced `transitAccountId` wiring from seed/fixture flows unless the test is explicitly about legacy compatibility.
- [ ] Update transit/create/reversal regressions to create normal cross-OU transit without transit-clearing setup.
- [ ] Keep one compatibility regression for old rows that still contain a stored transit account.

#### Docs
- [ ] Update Kasa module guide so cross-OU transit is documented as self-balancing posting, not `CASH_IN_TRANSIT` posting.
- [ ] Update CARI/cash runbooks so they distinguish:
  - cross-OU transit -> self-balancing current accounts
  - FX exchange `CLEARING` -> exchange clearing account
- [ ] Update shareholder-capital follow-up docs so central-to-branch transit no longer implies a required transit-clearing account in the happy path.

### Acceptance
- [ ] OpenAPI, seeds, tests, and docs all match the self-balancing transit model.
- [ ] Normal cross-OU transit test/seed paths no longer need `108` / transit-clearing setup.
- [ ] FX exchange docs remain explicit about the surviving role of `CASH_EXCHANGE_CLEARING`.
