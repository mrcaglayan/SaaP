# 14 - EXCHANGE FEATURE (Cash FX + Period-End Revaluation)

## Purpose
Define an implementation-ready PR roadmap for:

1. Foreign-currency cash posting (USD, EUR, etc.) without forcing book-base currency.
2. Explicit exchange workflow between cash registers.
3. CARI settlement usage of foreign cash (same-currency settlement only).
4. Monthly and yearly FX revaluation for open foreign cash balances.

This plan keeps current architecture patterns (route -> validator -> service, idempotency, additive migrations, script-based smoke tests).

---

## 0) Baseline Snapshot (Confirmed in Repo)

### What already exists and must be preserved
- CARI documents/open-items/settlements are dual-amount (`txn + base`) and FX-aware.
- CARI settlement apply resolves FX from `fx_rates` and calculates realized FX (`realizedFxNetBase`).
- GL schema already supports multi-currency lines (`journal_entries.currency_code`, `journal_lines.amount_txn` + base debit/credit).
- Cash registers are intentionally single-currency (good model for control and reconciliation).

### Current blockers for foreign-currency cash
- `cash.transaction.service.js` enforces transaction currency = register currency (keep this behavior).
- `cash.service.js` currently blocks posting unless transaction currency = book base currency (remove in PR-EX02).
- Cash posting currently treats `cash_transactions.amount` as base in posting math (must move to txn+base semantics).

### Important existing settlement scope boundary (keep)
- Settlement apply is same-currency against open items.
- Cross-currency settlement will be handled through explicit cash exchange first, then same-currency settlement.

---

## 1) Locked Data Semantics (Non-Negotiable)

1. `cash_transactions.amount` means **transaction amount in `currency_code`**.
2. Add `amount_base` to store base-currency equivalent for posting and reporting.
3. Add FX metadata fields on cash transaction (`fx_rate`, `fx_rate_source`, `fx_rate_date`, optional fallback metadata).
4. Keep register single-currency; do not allow mixed-currency transactions inside one register.
5. Keep settlement same-currency; do not add implicit cross-currency settlement conversion in this wave.

---

## 2) Global Guardrails

- Additive migrations only (no destructive data rewrite).
- Idempotency on every write API that can be retried.
- Existing manual cash + manual CARI flows remain working.
- Posting remains explicit and auditable.
- Every cross-module link stores source references.
- New FX behavior must be test-covered through script-based integration smoke tests in `backend/scripts`.

---

## 3) PR Sequence

1. `PR-EX01` - Cash dual-amount FX schema foundation + backfill.
2. `PR-EX02` - Cash posting engine becomes FX-capable (remove base-currency hard stop).
3. `PR-EX03` - Explicit cash exchange workflow (register A currency -> register B currency).
4. `PR-EX04` - CARI settlement + foreign cash integration + settlement FX persistence.
5. `PR-EX05` - Monthly/yearly foreign-cash revaluation engine (periodical transactions).
6. `PR-EX06` - Reporting, runbooks, release gate expansion.
7. `PR-EXF01` - Foreign-currency cash position lots + realized FX on disposal.
8. `PR-EXF02` - Revaluation reversal automation + period-close hardening.
9. `PR-EXF03` - Exchange fees/spread accounting and reporting split.
10. `PR-EXF04` - Ops dashboards/exceptions for FX jobs and missing rates.
11. `PR-EXF05` - Historical backfill + pilot/GA rollout hardening.

---

## PR-EX01: Cash Multi-Currency Schema Foundation

### Goal
Introduce non-breaking schema and semantics so cash transactions can carry both transaction and base amounts.

### Backend Changes
- Migration `m090_cash_fx_dual_amount_foundation.js`:
  - Add columns to `cash_transactions`:
    - `amount_base DECIMAL(20,6) NULL`
    - `fx_rate DECIMAL(20,10) NULL`
    - `fx_rate_source VARCHAR(40) NULL`
    - `fx_rate_date DATE NULL`
    - `fx_fallback_mode VARCHAR(20) NULL`
    - `fx_fallback_max_days INT NULL`
  - Add checks:
    - `amount_base > 0` (after backfill, enforce not null)
    - `fx_rate IS NULL OR fx_rate > 0`
  - Backfill existing rows:
    - `amount_base = amount`
    - `fx_rate = 1`
    - `fx_rate_source = 'PARITY'`
    - `fx_rate_date = book_date`
- Wire migration in `backend/src/migrations/index.js`.
- Update cash read mappers to return new fields.

### Test Artifacts
- `backend/scripts/test-cash-ex01-schema-backfill.js`
- `backend/package.json`:
  - `test:cash:ex01`

### Acceptance
- Existing rows migrate with `amount_base` populated and no data loss.
- New cash transactions can persist FX metadata.
- Base-currency flows still behave exactly as before (`amount_base == amount`, `fx_rate == 1`).

---

## PR-EX02: FX-Capable Cash Posting Engine

### Goal
Post foreign-currency cash transactions correctly into GL (`amount_txn` + base debit/credit), without forcing book-base currency.

### Backend Changes
- Update `backend/src/services/cash.service.js`:
  - Remove hard block `cashTransaction.currency_code must match book base currency`.
  - `buildCashPostingLines` to use:
    - `amount` as transaction amount.
    - `amount_base` as base posting amount.
  - Ensure `journal_lines.amount_txn` is transaction amount (signed by debit/credit side).
  - Keep `journal_entries.currency_code = cash transaction currency`.
- Update `backend/src/services/cash.transaction.service.js`:
  - Resolve FX when `currency_code != base_currency_code`:
    - request fx first
    - exact-date SPOT
    - optional prior-date fallback
  - Persist `amount_base` and FX metadata before posting.
  - Reversal should preserve original base impact (exact reversal).

### Test Artifacts
- `backend/scripts/test-cash-ex02-foreign-currency-posting.js`
- `backend/package.json`:
  - `test:cash:ex02`

### Acceptance
- Legal entity base `TRY`, register currency `USD`, transaction posts successfully.
- Journal lines contain `amount_txn` in USD and base debit/credit in TRY.
- Reversal fully offsets both txn and base effects.
- Existing base-currency transactions remain unchanged.

---

## PR-EX03: Explicit Cash Exchange Workflow

### Goal
Enable controlled exchange between two registers of different currencies with full audit/idempotency.

### Backend Changes
- Migration `m091_cash_exchange_batches.js`:
  - New table `cash_exchange_batches` with:
    - scope fields (`tenant_id`, `legal_entity_id`)
    - source/target register and currency
    - source/target txn amounts
    - base totals
    - executed FX rate + source/date
    - status (`DRAFT/POSTED/REVERSED/CANCELLED`)
    - linked cash transaction ids (out/in)
    - idempotency and integration event uid
- New service `backend/src/services/cash.exchange.service.js`:
  - Create exchange batch.
  - Create linked transfer-out / transfer-in cash transactions.
  - Post with clearing + FX difference handling (if base delta exists after rounding).
  - Reverse exchange batch safely.
- New routes:
  - `POST /api/v1/cash/exchanges`
  - `POST /api/v1/cash/exchanges/:exchangeBatchId/reverse`
  - `GET /api/v1/cash/exchanges`
  - `GET /api/v1/cash/exchanges/:exchangeBatchId`

### Validation Rules
- Source/target registers must be same legal entity, different register, different currency.
- Same-currency movement must use existing transit transfer flow.
- Idempotent retries must not duplicate exchange postings.

### Test Artifacts
- `backend/scripts/test-cash-ex03-exchange-workflow.js`
- `backend/package.json`:
  - `test:cash:ex03`

### Acceptance
- USD -> TRY exchange creates one exchange batch + two linked posted cash transactions.
- Replay with same idempotency key returns same batch (no duplicate).
- Reverse endpoint creates balanced reversal and marks batch `REVERSED`.

---

## PR-EX04: CARI Settlement Integration for Foreign Cash

### Goal
Use foreign cash directly in settlement when currencies match; keep explicit exchange for mismatches.

### Backend Changes
- Settlement apply behavior:
  - If `paymentChannel=CASH` and linked register currency matches settlement currency, allow direct use.
  - If mismatch, reject with actionable error: "Exchange first, then settle."
- Persist settlement FX metadata on `cari_settlement_batches` (reporting-grade, not only audit JSON):
  - Migration `m092_cari_settlement_fx_reporting_columns.js`:
    - `settlement_fx_rate`
    - `settlement_fx_source`
    - `settlement_fx_rate_date`
    - `settlement_fx_fallback_mode`
    - `settlement_fx_fallback_max_days`
    - `realized_fx_net_base`
- Fill these columns during apply/reverse.

### Frontend Changes
- `CariSettlementsPage`:
  - Keep auto-derivation of currency from selected legal entity by default.
  - When linked cash register is selected, clearly display register currency and mismatch warnings.
  - Show user-friendly references (`settlementNo`, register code/name, account code-name) instead of raw IDs where possible.

### Migration Hygiene
- Ensure environments have run `m087/m088/m089` to avoid legacy `cari_settlement_batches_chk_6` status-check conflicts.

### Test Artifacts
- `backend/scripts/test-cari-ex04-settlement-foreign-cash-usage.js`
- `backend/scripts/test-cari-ex04-settlement-fx-persistence.js`
- `backend/scripts/test-cari-ex04-frontend-settlement-currency-flow.js`
- `backend/package.json`:
  - `test:cari:ex04`
  - `test:cari:ex04-frontend`

### Acceptance
- AP USD bill can be paid from USD register directly in settlement apply.
- TRY register cannot be used for USD settlement without exchange first (clear error).
- Settlement row carries persisted FX fields for SQL reporting.
- UI no longer depends on raw numeric ids for main references.

---

## PR-EX05: Monthly/Yearly FX Revaluation (Periodical Transactions)

### Goal
Track unrealized FX on foreign-currency cash balances at month-end and year-end.

### Backend Changes
- Migration `m093_cash_fx_revaluation_runs.js`:
  - `cash_fx_revaluation_runs`
  - `cash_fx_revaluation_lines`
- New service `backend/src/services/cash.fx.revaluation.service.js`:
  - Resolve foreign cash balances by register/account at period end.
  - Compute:
    - carrying base
    - closing-rate base
    - delta base (unrealized FX)
  - Post revaluation journals (gain/loss accounts from purpose mappings).
  - Support reversal/reopen behavior.
- Period close wiring:
  - Block close completion when required FX revaluation run is missing for foreign cash.
  - Add explicit override pathway only with dedicated permission.
- Jobs integration:
  - New job type `CASH_FX_REVALUATION_RUN`.
  - Scheduler enqueue script for due month-end/year-end runs.

### Operational Scripts
- `backend/scripts/cash-fx-revaluation-schedule-due.js`
- `backend/scripts/run-cash-fx-revaluation-scheduler.js`

### Test Artifacts
- `backend/scripts/test-cash-ex05-month-end-revaluation.js`
- `backend/scripts/test-cash-ex05-year-end-revaluation-and-close-gate.js`
- `backend/scripts/test-cash-ex05-revaluation-job-idempotency.js`
- `backend/package.json`:
  - `test:cash:ex05`
  - `job:cash-fx:revaluation:schedule-due`
  - `jobs:cash-fx:revaluation:scheduler`

### Acceptance
- Month-end run creates deterministic revaluation journal entries for foreign cash balances.
- Year-end close is blocked until required revaluation run exists (or authorized override is used).
- Re-running same period with same idempotency key does not duplicate postings.

---

## PR-EX06: Reporting, Runbooks, Release Gate

### Goal
Operationalize the feature for support, audit, and finance reporting.

### Deliverables
- Reports:
  - cash exchange history
  - foreign cash balances by currency/register
  - revaluation runs and deltas
  - settlement realized FX by period/counterparty/currency
- Runbook:
  - setup requirements
  - month-end/year-end checklist
  - rollback/reversal procedures
- Release gate chain:
  - add EX01..EX05 tests to one command.

### Test Artifacts
- `backend/scripts/test-cash-ex06-release-gate.js`
- `backend/package.json`:
  - `test:cash-fx-release-gate`

### Acceptance
- Finance can query realized/unrealized FX without parsing audit JSON.
- Support team has deterministic reversal steps for settlement and exchange mistakes.
- One command validates end-to-end exchange + settlement + revaluation flow.

---

## 4) End-to-End Acceptance Scenarios

1. USD settlement from USD cash:
   - Create USD register.
   - Apply AP USD settlement with linked USD cash.
   - Cash balance decreases in USD, GL posts base correctly.

2. TRY to USD before settlement:
   - Exchange TRY register -> USD register.
   - Apply USD settlement from USD register.
   - Traceability exists from settlement to cash txns to exchange batch.

3. Month-end revaluation:
   - Keep open USD cash balance through month end.
   - Run revaluation with closing rate.
   - Revaluation journal posted and visible in reports.

4. Year-end close:
   - Attempt close with pending foreign-cash revaluation -> blocked.
   - Run revaluation -> close succeeds.

---

## 5) Recommended Execution Order

1. Implement and merge `PR-EX01`.
2. Implement and merge `PR-EX02`.
3. Implement and merge `PR-EX03`.
4. Implement and merge `PR-EX04`.
5. Implement and merge `PR-EX05`.
6. Finish with `PR-EX06` release-gate and runbook hardening.
7. Start follow-up track with `PR-EXF01` after EX06 is stable in pilot.
8. Continue `PR-EXF02` -> `PR-EXF05` in order.

This order keeps behavior non-breaking and enables gradual rollout from schema -> posting -> exchange -> settlement -> periodical revaluation.

---

## 6) Follow-Up PR Track (Post-Initial Rollout)

These are recommended follow-up PRs after EX01..EX06 production stabilization.

## PR-EXF01: Foreign-Currency Position Lots + Realized FX Lifecycle

### Why
Initial rollout handles posting/exchange/revaluation, but precise realized FX on later disposal of held foreign cash needs lot-level carrying-base tracking.

### Goal
Track foreign cash positions by lot (FIFO or weighted-average policy) and recognize realized FX when foreign cash is spent/converted later.

### Backend Changes
- Migration `m094_cash_fx_position_lots.js`:
  - `cash_fx_position_lots`
  - `cash_fx_lot_movements`
- New service `backend/src/services/cash.fx.position.service.js`:
  - lot creation on inbound foreign cash
  - lot consumption on settlement/exchange outflow
  - realized FX computation and posting links
- Wire into:
  - `cash.transaction.service.js`
  - `cash.exchange.service.js`
  - `cari.settlement.service.js` (when cash-linked settlement consumes foreign cash)

### Test Artifacts
- `backend/scripts/test-cash-exf01-position-lots-realized-fx.js`
- `backend/package.json`:
  - `test:cash:exf01`

### Acceptance
- Holding foreign cash across dates then spending it produces correct realized FX (not just spot delta).
- Lot balances cannot go negative.
- Reversal restores lot quantities and base carrying amounts deterministically.

---

## PR-EXF02: Revaluation Reversal Automation + Close Hardening

### Why
Month/year-end revaluation needs strict reversal and close-cycle integrity to avoid double-counting across periods.

### Goal
Automate day-1 reversal of prior revaluation and enforce reopen/close consistency.

### Backend Changes
- Add fields/tables for reversal linkage if needed:
  - `reversed_by_run_id`, `reversal_journal_entry_id`, `reversal_status`
- Scheduler job:
  - auto-create next-period reversal entries for prior period revaluation
- Period-close checks:
  - block close when previous-period reversal state is inconsistent
  - enforce hard-close immutability

### Test Artifacts
- `backend/scripts/test-cash-exf02-revaluation-reversal-automation.js`
- `backend/scripts/test-cash-exf02-close-reopen-integrity.js`
- `backend/package.json`:
  - `test:cash:exf02`

### Acceptance
- Revaluation reversal is posted exactly once in next period.
- Reopen/close cycles do not duplicate revaluation or reversal journals.
- Hard-closed periods reject revaluation mutation.

---

## PR-EXF03: Exchange Fees and Spread Accounting

### Why
Practical exchange operations include bank/broker fees and spread; these should not be mixed with realized FX principal effects.

### Goal
Capture and post fees/spread separately while keeping realized FX traceability clean.

### Backend Changes
- Extend exchange payload/model:
  - `fee_amount_txn`, `fee_amount_base`, `fee_account_id`, `provider_ref`
  - optional spread metadata
- Posting split:
  - principal conversion lines
  - fee expense lines
  - realized FX line (if any)

### Test Artifacts
- `backend/scripts/test-cash-exf03-exchange-fee-and-spread.js`
- `backend/package.json`:
  - `test:cash:exf03`

### Acceptance
- Exchange with fee posts fee separately from realized FX.
- Reports can show principal converted, fee cost, and realized FX independently.

---

## PR-EXF04: FX Ops Dashboard + Exception Workbench Wiring

### Why
After go-live, support/finance needs visibility for missing rates, failed jobs, and out-of-policy FX events.

### Goal
Add operational observability and exception workflows for FX lifecycle.

### Backend Changes
- Ops endpoints/widgets for:
  - missing FX rates by date/currency pair
  - failed/pending FX revaluation jobs
  - foreign cash negative/abnormal balances
  - pending settlements blocked by currency mismatch
- Exception actions:
  - rerun job
  - mark override with reason + audit

### Test Artifacts
- `backend/scripts/test-cash-exf04-fx-ops-dashboard.js`
- `backend/scripts/test-cash-exf04-fx-exception-actions.js`
- `backend/package.json`:
  - `test:cash:exf04`

### Acceptance
- Ops can identify and resolve FX pipeline issues without direct DB inspection.
- Every manual override is auditable with user/time/reason.

---

## PR-EXF05: Historical Backfill + Pilot/GA Hardening

### Why
When enabling lot/revaluation enhancements on existing tenants, backfill and controlled rollout are required.

### Goal
Provide safe backfill scripts and rollout runbook updates for production enablement.

### Deliverables
- Backfill scripts:
  - populate initial lot positions from historical posted cash transactions
  - validate lot totals vs GL balances
  - seed missing FX metadata where possible
- Rollout docs:
  - pilot checklist
  - go/no-go criteria
  - rollback actions
- Extended release gate for EX and EXF tracks.

### Test Artifacts
- `backend/scripts/test-cash-exf05-backfill-and-rollout.js`
- `backend/package.json`:
  - `test:cash:exf05`
  - `test:cash-fx-full-release-gate`

### Acceptance
- Backfill is idempotent and reconcilable.
- Pilot tenants can be enabled progressively with clear guardrails.
- GA switch has documented, test-backed rollback plan.
