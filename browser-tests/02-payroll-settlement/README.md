## 02 Payroll Settlement

Browser walk for the payroll ownership and settlement scenario with one central employee plus two OU-owned employees.

Files:
- `seed-two-ou.mjs`: idempotent multi-OU payroll settlement seed.
- `walk-two-ou.mjs`: end-to-end browser walk from payroll screens through payment-batch preparation, detail, sync, and close controls.
- `two-ou-seed-summary.json`: latest settlement seed summary.
- `two-ou-browser-walk-report.json`: latest browser-walk report.
- `artifacts/`: numbered screenshots and per-run reports.

Dependencies:
- reads readiness/setup inputs from `../01-payroll-creation`
- uses the shared payroll starter CSV from `../01-payroll-creation/payroll-starter-template.csv`

Run:

```powershell
node .\browser-tests\02-payroll-settlement\walk-two-ou.mjs
```

This walk still traverses the creation/import screens because settlement evidence depends on the created payroll run, liabilities, and prepared payment batch.
