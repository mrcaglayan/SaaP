# Cash FX Exchange And Revaluation Runbook

## Purpose

This runbook defines setup, reporting, month-end/year-end controls, and deterministic reversal procedures for cash FX posting, exchange, settlement usage, and revaluation.

## Setup Requirements

- Run migrations through `m097_exception_workbench_cash_module` (or latest available migration).
- Ensure cash registers are configured per currency (one register currency per register).
- Ensure `fx_rates` contains SPOT rates for required currency pairs and period-end dates.
- Configure journal purpose accounts:
  - `CASH_FX_REVALUATION_GAIN`
  - `CASH_FX_REVALUATION_LOSS`
- Confirm permissions:
  - `cash.txn.*` for exchange and reversal operations
  - `cash.report.read` for finance/support report queries
  - `cash.fx.revaluation.override` only for approved close-gate override users
- Enable scheduler/worker for automatic revaluation jobs when using job mode:
  - `npm run job:cash-fx:revaluation:schedule-due`
  - `npm run jobs:cash-fx:revaluation:scheduler`

## Reporting Endpoints

- Cash exchange history:
  - `GET /api/v1/cash/reports/exchange-history`
- Foreign cash balances by currency/register:
  - `GET /api/v1/cash/reports/foreign-balances`
- Revaluation runs and deltas:
  - `GET /api/v1/cash/reports/revaluation-runs`
- Settlement realized FX by period/counterparty/currency:
  - `GET /api/v1/cari/reports/settlement-realized-fx`

These endpoints use persisted columns/tables (`cash_exchange_batches`, `cash_fx_revaluation_runs`, `cash_fx_revaluation_lines`, `cari_settlement_batches.realized_fx_net_base`) and do not require parsing audit payload JSON.

## Frontend Navigation And Feature Gates

### Rollout Feature Codes

- `FEATURE_CASH_FX_EXF05_PILOT_V1`
- `FEATURE_CASH_FX_EXF05_GA_V1`

FX pages are visible/accessible only when tenant has at least one rollout code above enabled (`PILOT` or `GA`) and the required page permissions.

### Page Paths

- Cash exchange workbench: `/app/kasa-kur-degisimleri`
- Cash FX reports: `/app/kasa-kur-raporlari`
- Cash FX ops dashboard: `/app/kasa-kur-ops-dashboard`

### UI Permission Matrix

- `/app/kasa-kur-degisimleri`
  - page read/list: `cash.txn.read`
  - create exchange: `cash.txn.create`
  - reverse exchange: `cash.txn.reverse`
- `/app/kasa-kur-raporlari`
  - report access: `cash.report.read`
- `/app/kasa-kur-ops-dashboard`
  - dashboard access: `cash.report.read`
  - rerun action: `ops.jobs.manage`
  - override action: `ops.exceptions.manage`
- Period close FX override in Journal Workbench (`/app/mahsup-islemleri`)
  - period close run: `gl.period.close`
  - FX close-gate override controls: `cash.fx.revaluation.override`

### UI Smoke-Click Checklist

1. Sign in with a tenant that has required permissions and at least one rollout feature enabled (`FEATURE_CASH_FX_EXF05_PILOT_V1` or `FEATURE_CASH_FX_EXF05_GA_V1`):
   - confirm FX menu entries appear in sidebar under `Kasa`.
   - open `/app/kasa-kur-degisimleri`, `/app/kasa-kur-raporlari`, `/app/kasa-kur-ops-dashboard` and verify no redirect occurs.
2. Feature gate checks:
   - disable both FX rollout feature codes and confirm all three FX pages are hidden/blocked.
3. Permission checks:
   - remove `cash.report.read` and confirm reports/ops pages are blocked by permission guard.
   - keep `cash.report.read`, remove `ops.jobs.manage`, and confirm rerun button is disabled on ops dashboard.
   - keep `cash.report.read`, remove `ops.exceptions.manage`, and confirm override button is disabled.
4. Close-gate UX validation:
   - in `/app/mahsup-islemleri`, trigger FX close-gate error and verify guided panel and links to FX pages.
   - verify override checkbox/reason fields only render for users with `cash.fx.revaluation.override`.

## Month-End Checklist

1. Validate required FX rates exist for all active foreign-currency cash registers on period end date.
2. Run or verify scheduled run for month-end revaluation (`runType=MONTH_END`).
3. Confirm run status is `COMPLETED` and journal entry is posted.
4. Review deltas by currency/register via revaluation reports.
5. Review cash exchange history and unresolved operational exceptions.
6. Confirm settlement realized FX report totals for the month are reviewed by finance.

## Year-End Checklist

1. Complete month-end checklist for period 12.
2. Confirm year-end revaluation run (`runType=YEAR_END`) is `COMPLETED`.
3. Attempt period close only after revaluation completion.
4. If override is required, capture approval and reason using `cashFxRevaluationOverrideReason`.
5. Archive report outputs (exchange history, foreign balances, revaluation deltas, settlement realized FX) for audit package.

## EXF05 Pilot Rollout Checklist

1. Run metadata seed in dry-run mode and review unresolved transactions:
   - `cd backend && npm run backfill:cash-fx:seed-metadata -- --tenantId <TENANT_ID>`
2. Apply metadata seed for tenant scope:
   - `cd backend && npm run backfill:cash-fx:seed-metadata -- --tenantId <TENANT_ID> --apply`
3. Run lot backfill dry-run and verify planned write volume:
   - `cd backend && npm run backfill:cash-fx:lots -- --tenantId <TENANT_ID>`
4. Apply lot backfill:
   - `cd backend && npm run backfill:cash-fx:lots -- --tenantId <TENANT_ID> --apply`
5. Reconcile lots vs GL and investigate mismatches before enabling pilot:
   - `cd backend && npm run reconcile:cash-fx:lots-vs-gl -- --tenantId <TENANT_ID> --failOnMismatch true`
6. Enable pilot feature flags only after reconciliation is clean:
   - `cd backend && npm run rollout:cash-fx:exf05 -- --tenantIds <TENANT_ID> --phase PILOT --apply`
7. Execute smoke validation:
   - `cd backend && npm run test:cash:exf05`

## EXF05 Go/No-Go Criteria

- `seedMissingCashFxMetadata` apply result has `unresolvedCount = 0` for pilot scope.
- `backfillCashFxPositionLots` apply result has `failedCount = 0`.
- `reconcileCashFxLotsAgainstGl` returns `mismatchCount = 0` for pilot scope.
- Pilot phase (`FEATURE_CASH_FX_EXF05_PILOT_V1`) is enabled for target tenant(s), GA remains disabled.
- `npm run test:cash:exf05` passes for current branch/database state.
- Finance and support sign-off confirms rollback owner and response SLA before GA.

## EXF05 Rollback Actions

1. Disable both rollout flags for impacted tenant(s):
   - `cd backend && npm run rollout:cash-fx:exf05 -- --tenantIds <TENANT_ID> --phase ROLLBACK --apply`
2. Re-run lot/GL reconciliation to confirm no additional drift was introduced:
   - `cd backend && npm run reconcile:cash-fx:lots-vs-gl -- --tenantId <TENANT_ID>`
3. If data repair is needed, re-run metadata seed + lot backfill in dry-run first, then apply.
4. Capture rollback reason, actor, and timestamp in incident/change log.
5. Keep previously posted journals immutable; apply corrective entries instead of direct row edits.

## Rollback and Reversal Procedures

### Wrong settlement

1. Reverse settlement from `POST /api/v1/cari/settlements/:settlementBatchId/reverse`.
2. Verify reversal row is created and linked (`reversal_of_settlement_batch_id`).
3. Re-run settlement realized FX report for affected period to confirm offset effect.

### Wrong cash exchange

1. Reverse exchange from `POST /api/v1/cash/exchanges/:exchangeBatchId/reverse`.
2. Verify batch status becomes `REVERSED` and reversal cash transactions are posted.
3. Verify exchange history report reflects original and reversal linkage.

### Wrong revaluation run

1. Do not edit run rows manually.
2. If a rerun is needed, use a new idempotency key and keep traceable run history.
3. If close-gate override was used, keep documented reason and approval in close-run records.

## Troubleshooting Notes

- Missing FX rate on period end:
  - Add exact-date rate or allowed prior-date fallback and rerun.
- Close blocked by revaluation gate:
  - Run required revaluation, then retry close.
  - Use override only with `cash.fx.revaluation.override` and explicit reason.
- Idempotency replay:
  - Reusing same idempotency key should return prior run/batch instead of creating duplicates.

## Release Gate Command

- End-to-end EX01..EX05 + EX06 checks:
  - `cd backend && npm run test:cash-fx-release-gate`
- End-to-end EX + EXF full chain (including EXF05):
  - `cd backend && npm run test:cash-fx-full-release-gate`
