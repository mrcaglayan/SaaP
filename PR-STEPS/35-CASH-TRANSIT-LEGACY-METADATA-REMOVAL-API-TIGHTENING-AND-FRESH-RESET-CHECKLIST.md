# 35 - CASH TRANSIT LEGACY METADATA REMOVAL, API TIGHTENING, AND FRESH RESET

## Execution tracking
- This file is the execution tracker for removing the remaining transit-clearing legacy compatibility seams after tracker 34.
- Tracker 34 already aligned the runtime accounting model:
  - cross-OU cash transit posts through OU self-balancing current accounts
  - normal transit create no longer requires `transitAccountId`
  - `CASH_TRANSIT_CLEARING` no longer blocks readiness
  - FX exchange still uses `CASH_EXCHANGE_CLEARING` for `postingMode = CLEARING`
- This tracker exists because the repo still carries reset-optional legacy compatibility:
  - transit initiate still accepts `counterAccountId` as an alias for `transitAccountId`
  - transit service still accepts and stores legacy transit-account metadata when explicitly provided
  - transit receive still copies stored `transit_account_id` into the generated `TRANSFER_IN.counterAccountId`
  - `cash_transit_transfers.transit_account_id` still exists in schema and read models
  - `CASH_TRANSIT_CLEARING` still exists in the CASH purpose-code catalog and policy-pack / GL-setup copy as legacy optional metadata
- Current implementation assumption for this rollout:
  - the working database will be reset from zero
  - no historical transit rows need to remain readable
  - no caller needs backward compatibility for `transitAccountId` or `counterAccountId` aliasing on transit initiate
- This tracker turns the reset assumption into a cleaner steady-state contract instead of keeping compatibility layers that only exist for old rows.
- If product or integration direction changes later, update this tracker before implementation continues.

## Scope
- remove legacy `transitAccountId` input support from normal transit API contract
- remove `counterAccountId -> transitAccountId` alias compatibility from transit initiate validators
- stop storing and replaying transit-account metadata in transit runtime
- drop `cash_transit_transfers.transit_account_id` from schema and read models
- remove `CASH_TRANSIT_CLEARING` from active purpose-code / policy-pack / GL-setup exposure
- keep `CASH_IN_TRANSIT` workflow language where it describes the process
- preserve `CASH_EXCHANGE_CLEARING` as the only surviving cash-clearing concept
- align OpenAPI, tests, seeds, and docs to the post-reset contract

## Locked product decisions for this tracker
- [ ] Fresh reset means no historical cash-transit rows need compatibility behavior in this rollout.
- [ ] `POST /cash/transactions/transit/initiate` must reject `transitAccountId` with `400`.
- [ ] `POST /cash/transactions/transit/initiate` must reject `counterAccountId` as a transit alias with `400`.
- [ ] Cross-OU transit posting and receive must not store, require, or replay any transit-account metadata.
- [ ] `cash_transit_transfers.transit_account_id` must be dropped from the runtime schema after service usage is removed.
- [ ] Transit list/detail responses must no longer expose transit-account metadata fields.
- [ ] Generic cash transaction responses must no longer expose `cash_transit_account_id`.
- [ ] `CASH_TRANSIT_CLEARING` must be removed from CASH purpose-code happy-path exposure after reset.
- [ ] `CASH_IN_TRANSIT` remains valid workflow/operator language for cross-OU transfer routing.
- [ ] `CASH_EXCHANGE_CLEARING` remains the only live cash-clearing purpose code, and only for FX exchange `CLEARING`.
- [ ] `cashClearing` readiness/setup semantics should become FX-only in this tracker.
- [ ] Same-context direct transfer behavior remains unchanged.

## Important repo guardrails
- [ ] `backend/src/routes/cash.transaction.validators.js` currently still aliases `req.body?.counterAccountId` into `transitAccountId`; remove that alias deliberately instead of changing unrelated cash validators.
- [ ] `backend/src/services/cash.transaction.service.js` still carries `legacyTransitAccountId` handling and receive-side copy-forward from `transit_account_id`; remove both paths together.
- [ ] `backend/src/services/cash.queries.js` and `backend/scripts/generate-openapi.js` still expose transit-account metadata in both transit-transfer and generic cash-transaction shapes; contract cleanup and schema cleanup must land together.
- [ ] `backend/src/services/gl.purpose-mappings.service.js` and `backend/src/services/cash.purpose-mappings.service.js` still list `CASH_TRANSIT_CLEARING`; remove it without weakening `CASH_EXCHANGE_CLEARING`.
- [ ] `backend/src/services/policy-packs.service.js` and `frontend/src/pages/settings/GlSetupPage.jsx` still surface legacy transit-clearing rows/copy; remove or reshape those together.
- [ ] `frontend/src/pages/cash/CashTransitTransfersPage.jsx` still renders `transit_account_id` metadata; remove that UI only after list/detail payloads stop exposing it.
- [ ] `frontend/src/pages/cash/CashTransactionsPage.jsx` and `frontend/src/i18n/messages.js` still contain legacy transit-metadata picker wording on the create surface; remove that copy in the same cleanup wave as setup-surface legacy exposure.
- [ ] `backend/scripts/test-cash-pr26-transit-workflow.js` still contains explicit legacy-compatibility scenarios; replace them with reset-only expectations instead of preserving legacy branches.
- [ ] Exchange collateral smokes must stay green:
  - `backend/scripts/test-cash-ex03-exchange-workflow.js`
  - `backend/scripts/test-cash-exf06-direct-mode-exchange.js`
  - `backend/scripts/test-cash-exf07-direct-mode-reversal.js`
- [ ] Do not remove or weaken the `CASH_IN_TRANSIT` workflow guardrail that blocks direct cross-context transfer attempts.
- [ ] Do not touch inventory `inventory_transit_account_id`; that is a separate domain.

## Risk framing
- Conceptual risk is low:
  - tracker 34 already aligned the accounting truth
  - this tracker mainly removes obsolete compatibility seams
- Implementation risk is medium:
  - public transit API contract becomes stricter
  - schema drop is destructive by design
  - OpenAPI and tests must be updated together
  - policy-pack / GL-setup semantics lose a visible legacy row
- OpenAPI cleanup must not be front-loaded before runtime contract changes, and it must not be deferred to a later cleanup PR after runtime/schema changes merge.
- The highest-risk mistake would be dropping the schema column before removing service/query usage.
- The second highest-risk mistake would be removing `CASH_TRANSIT_CLEARING` too broadly and accidentally weakening FX exchange clearing behavior.
- Recommended order:
  - validator/service contract tightening plus request-side OpenAPI cleanup first
  - schema/read/response-side OpenAPI cleanup second
  - purpose-code / setup / UI cleanup third
  - tests, seeds, docs, and final sweep last

## Out of scope for this tracker
- No change to `CASH_IN_TRANSIT` workflow routing itself.
- No change to OU self-balancing posting logic.
- No change to same-context direct transfer.
- No change to FX exchange posting or reversal logic beyond preserving existing behavior.
- No change to inventory transit account behavior.

## Master tracker
- [x] `PR-CTL01` - Transit API contract tightening and runtime legacy-path removal
- [x] `PR-CTL02` - Transit schema, read-model, and OpenAPI cleanup
- [x] `PR-CTL03` - Purpose-code, policy-pack, and setup-surface removal of transit-clearing legacy exposure
- [x] `PR-CTL04` - Reset-only seeds, tests, docs, and regression rebaseline

## PR-CTL01 - Transit API contract tightening and runtime legacy-path removal

### Goal
- Remove transit-account compatibility behavior from the normal transit initiate / receive runtime.

### Files
- `backend/src/routes/cash.transaction.validators.js`
- `backend/src/services/cash.transaction.service.js`
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `backend/scripts/test-cash-pr26-transit-workflow.js`
- `backend/scripts/test-cash-counter-account-validation-and-ui-mapping.js`

### Routes / endpoints
- `POST /api/v1/cash/transactions/transit/initiate`
- `POST /api/v1/cash/transactions/transit/{transitTransferId}/receive`

### Checklist

#### Contract tightening
- [x] Remove `counterAccountId` alias fallback from transit initiate validator.
- [x] Remove `transitAccountId` from accepted transit initiate input.
- [x] Reject removed legacy request fields with explicit `400` errors instead of silently ignoring them.
- [x] Keep unrelated cash create validators unchanged.
- [x] Remove `transitAccountId` from the transit initiate request schema in `backend/scripts/generate-openapi.js`.
- [x] Regenerate `backend/openapi.yaml` in the same slice so the published request contract does not drift behind runtime behavior.

#### Runtime cleanup
- [x] Remove `legacyTransitAccountId` parsing/validation from transit initiate service flow.
- [x] Stop passing transit-account metadata into created `TRANSFER_OUT` rows.
- [x] Stop persisting transit-account metadata into newly created transfer rows.
- [x] Stop copying stored transit-account metadata into `TRANSFER_IN.counterAccountId` on receive.
- [x] Keep cross-OU transit posting/reversal behavior unchanged otherwise.

#### Regression
- [x] Replace legacy transit-account compatibility assertions in PR26 with reset-only expectations.
- [x] Assert transit initiate rejects removed legacy inputs with explicit `400` responses.
- [x] Keep UI mapping smoke aligned with the stricter request payload.
- [x] Keep request-contract docs/tests aligned in the same slice; do not leave removed request fields documented for a later PR.

### Acceptance
- [x] Normal transit runtime no longer accepts or uses transit-account metadata.
- [x] Receive no longer depends on a stored transit account.
- [x] Cross-OU transit still posts and reverses correctly.
- [x] Transit initiate OpenAPI request contract matches the stricter runtime before merge.
- [x] Removed legacy transit request fields fail fast with `400` instead of being silently ignored.

## PR-CTL02 - Transit schema, read-model, and OpenAPI cleanup

### Goal
- Remove `transit_account_id` from persistent transit schema and public read contracts.

### Files
- `backend/src/migrations/index.js`
- `backend/src/migrations/m134_drop_cash_transit_account.js`
- `backend/src/services/cash.queries.js`
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- `frontend/src/pages/cash/CashTransitTransfersPage.jsx`

### Routes / endpoints
- `GET /api/v1/cash/transactions/transit`
- `GET /api/v1/cash/transactions/transit/{transitTransferId}`

### Checklist

#### Schema
- [x] Add `backend/src/migrations/m134_drop_cash_transit_account.js`.
- [x] Drop `cash_transit_transfers.transit_account_id`.
- [x] Remove obsolete FK/index references safely.
- [x] Register the migration in `backend/src/migrations/index.js`.

#### Read-model cleanup
- [x] Remove transit-account columns from cash transit queries and row mapping.
- [x] Remove `cash_transit_account_id` from generic cash transaction query/select mapping.
- [x] Remove transit-account rendering from `CashTransitTransfersPage.jsx`.
- [x] Keep list/detail pages stable without the removed field.

#### OpenAPI cleanup
- [x] Remove `cash_transit_account_id` from generic cash transaction OpenAPI schemas.
- [x] Remove `transit_account_id` from transit transfer response schemas.
- [x] Regenerate `backend/openapi.yaml`.

### Acceptance
- [x] The schema no longer contains `cash_transit_transfers.transit_account_id`.
- [x] Transit APIs and UI no longer expose transit-account metadata.
- [x] Generic cash transaction APIs no longer expose `cash_transit_account_id`.
- [x] Transit response/read-model OpenAPI matches the stricter post-reset contract.

## PR-CTL03 - Purpose-code, policy-pack, and setup-surface removal of transit-clearing legacy exposure

### Goal
- Remove `CASH_TRANSIT_CLEARING` from post-reset setup surfaces so operators only see the surviving FX-clearing concept.

### Files
- `backend/src/services/gl.purpose-mappings.service.js`
- `backend/src/services/cash.purpose-mappings.service.js`
- `backend/src/services/policy-packs.service.js`
- `backend/src/services/policy-packs.resolve.service.js`
- `backend/src/services/module-readiness.service.js`
- `frontend/src/pages/cash/CashTransactionsPage.jsx`
- `frontend/src/pages/settings/GlSetupPage.jsx`
- `frontend/src/pages/cash/CashExchangesPage.jsx`
- `frontend/src/i18n/messages.js`

### Checklist

#### Purpose-code / setup cleanup
- [x] Remove `CASH_TRANSIT_CLEARING` from the CASH purpose-code catalog.
- [x] Remove transit-clearing rows from policy-pack output.
- [x] Make `cashClearing` setup/readiness fully FX-only.
- [x] Remove legacy transit-metadata picker labels/placeholders from the transfer create surface.
- [x] Remove legacy transit-clearing copy from GL setup and related i18n.

#### Safety
- [x] Keep `CASH_EXCHANGE_CLEARING` behavior and wording intact for FX `CLEARING`.
- [x] Keep exchange collateral smokes green.
- [x] Keep `CASH_IN_TRANSIT` workflow wording where it describes the process, not an account code.

### Acceptance
- [x] Operators no longer see `CASH_TRANSIT_CLEARING` in normal CASH setup surfaces.
- [x] `cashClearing` semantics are FX-only.
- [x] Exchange flows remain unaffected.

## PR-CTL04 - Reset-only seeds, tests, docs, and regression rebaseline

### Goal
- Remove obsolete legacy-compatibility expectations from tests, fixtures, and docs now that the reset-only contract is final.

### Files
- `backend/src/seedStarter.js`
- `backend/scripts/test-cash-pr26-transit-workflow.js`
- `backend/scripts/test-cash-register-ownership-cro05-self-balancing.js`
- `backend/scripts/test-cash-register-ownership-cro03-workflow-routing.js`
- `backend/scripts/test-cash-register-ownership-cro04-rollout.js`
- `backend/scripts/test-module-readiness.js`
- `backend/scripts/test-policy-pack-resolve.js`
- `backend/scripts/test-shareholder-capital-integration.js`
- `backend/scripts/test-shareholder-capital-cf05-cash-register-fulfillment.js`
- `docs/kullanim-kilavuzlari/KULLANIM_KILAVUZU_KASA_MODULU.md`
- `docs/runbooks/cari-v1-operations.md`
- `docs/runbooks/cash-fx-exchange-operations.md`
- `docs/runbooks/shareholder-capital-fulfillment-operations.md`

### Checklist

#### Tests and fixtures
- [x] Remove reset-irrelevant legacy transit-account compatibility branches from tests.
- [x] Rebaseline transit happy-path tests to the no-transit-account contract only.
- [x] Update readiness/policy-pack tests to the FX-only `cashClearing` shape.
- [x] Keep shareholder-capital and rollout transit tests aligned with the new contract.

#### Seeds and docs
- [x] Keep seed data free of transit-account metadata.
- [x] Update docs so cross-OU transit no longer mentions legacy transit-account metadata at all.
- [x] Keep FX clearing docs explicit about the surviving role of `CASH_EXCHANGE_CLEARING`.

### Acceptance
- [x] Reset-only tests and seeds no longer carry transit-account compatibility baggage.
- [x] Docs and operator guidance reflect the final clean-slate contract.
- [x] No legacy transit-clearing concepts remain outside explicit historical tracker notes.
