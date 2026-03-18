## 02 Payroll Settlement

Browser walk for the payroll ownership and settlement scenario with one central employee plus two OU-owned employees.

Files:
- `walk-two-ou.mjs`: settlement-only browser walk from payroll liabilities/payment prep through payment-batch detail, sync, and close controls.
- `two-ou-settlement-browser-walk-report.json`: latest settlement browser-walk report.
- `artifacts/`: numbered screenshots and per-run reports.

Dependencies:
- depends on readiness from `../00-preparation`
- consumes the created payroll run/liability state from `../01-payroll-creation/walk-two-ou-creation.mjs`

Run:

```powershell
node .\browser-tests\02-payroll-settlement\walk-two-ou.mjs
```

This walk no longer traverses the creation/import screens itself. It invokes the `01-payroll-creation` prerequisite flow first, then verifies only the settlement-side UI.
