## Browser Tests

Numbered folders under `browser-tests` are organized by stage:

- `00-preparation`: readiness/setup work needed to make the tenant green.
- `01-payroll-creation`: two-OU payroll creation flow through import, finalize, and liabilities build.
- `02-payroll-settlement`: settlement flow from payroll liabilities/payment prep through batch detail, sync, and close controls.

Artifacts:
- `artifacts/` folders contain the numbered screenshots from each browser run plus a `report.json` for that run.
- top-level `*.json` files in each stage folder are the latest summary/report snapshots.

Recommended order:

```powershell
node .\browser-tests\00-preparation\seed-readiness.mjs
node .\browser-tests\01-payroll-creation\seed-two-ou.mjs
node .\browser-tests\01-payroll-creation\walk-two-ou-creation.mjs
node .\browser-tests\02-payroll-settlement\walk-two-ou.mjs
```
