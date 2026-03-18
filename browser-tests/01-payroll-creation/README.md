## 01 Payroll Creation

Shared creation/setup assets for payroll browser checks.

Files:
- `seed-readiness.mjs`: idempotent tenant-readiness seed for setup blockers such as close config, workflows, and shareholder prerequisites.
- `payroll-starter-template.csv`: sample payroll import used by downstream browser walks.
- `seed-summary.json`: base payroll setup summary for the seeded tenant.
- `readiness-before.json`, `readiness-after.json`, `readiness-seed-summary.json`: captured readiness state from the latest run.

Run:

```powershell
node .\browser-tests\01-payroll-creation\seed-readiness.mjs
```

This folder is the shared dependency for `02-payroll-settlement`.
