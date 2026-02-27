# Bank + Payroll Regression Matrix (PR-H08)

## Purpose

This matrix defines the staged release gate for bank/payroll and maps each stage to executable scripts.
The gate is run by `npm run test:e2e:bank-payroll`.

## Stage Map

| Stage ID | Scope | Scripts |
| --- | --- | --- |
| `bank-flow` | Payment batch lifecycle, export/ack, reconciliation, exception queue, approvals | `test:payments:prb04`, `test:bank:prb06`, `test:bank:prb03`, `test:bank:prb07`, `test:bank:prb08a`, `test:bank:prb08b`, `test:bank:prb09` |
| `payroll-flow` | Provider import -> accrual -> liabilities -> settlement -> corrections -> close | `test:payroll:prp01` .. `test:payroll:prp09` |
| `cross-flow` | Jobs/retry, approval engine, ops KPIs, unified exceptions, retention/snapshots | `test:hardening:prh02`, `test:hardening:prh04`, `test:hardening:prh05`, `test:hardening:prh06`, `test:hardening:prh07` |

## Failure Contract

- Runner stops on first failing stage.
- Failure output includes stage id and failing npm script.
- This makes failure attribution explicit (import, settlement, close, etc.).

## Local Run

```bash
npm run test:e2e:bank-payroll
```

Optional scoped runs:

```bash
BANK_PAYROLL_E2E_ONLY_STAGES=bank-flow npm run test:e2e:bank-payroll
BANK_PAYROLL_E2E_SKIP_STAGES=cross-flow npm run test:e2e:bank-payroll
BANK_PAYROLL_E2E_DRY_RUN=1 npm run test:e2e:bank-payroll
```

## CI

Workflow: `.github/workflows/bank-payroll-release-gate.yml`

- Brings up MySQL 8
- Runs backend migrations
- Seeds core permissions/roles/users
- Executes `test:e2e:bank-payroll`

## Current Status

- H08 release-gate framework is wired and runnable.
- `test:bank:prb09` and `test:payroll:prp08` now run real service-level assertions (SoD/maker-checker, idempotency, lock enforcement).
- Several remaining stage scripts are still placeholders and should be upgraded to full assertions before marking H08 complete.
