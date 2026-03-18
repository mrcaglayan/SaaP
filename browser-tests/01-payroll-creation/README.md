## 01 Payroll Creation

Browser creation flow assets for the payroll scenario.

Files:
- `seed-two-ou.mjs`: idempotent two-OU plus central scenario seed for ownership, beneficiary, OU bank, and self-balancing prerequisites.
- `payroll-starter-template.csv`: sample payroll import used by downstream browser walks.
- `seed-summary.json`: base payroll setup summary for the seeded tenant.
- `two-ou-seed-summary.json`: latest two-OU scenario seed summary.
- `walk-two-ou-creation.mjs`: browser walk through ownership, mappings, beneficiaries, payroll import, run detail, finalize, and liabilities build.
- `two-ou-creation-browser-walk-report.json`: latest creation browser-walk report.
- `artifacts/`: numbered screenshots and per-run creation reports.

Run:

```powershell
node .\browser-tests\01-payroll-creation\seed-two-ou.mjs
node .\browser-tests\01-payroll-creation\walk-two-ou-creation.mjs
```

This folder produces the reusable payroll run/liability state that `02-payroll-settlement` consumes.
