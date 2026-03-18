## Browser Tests

Numbered folders under `browser-tests` are organized by scenario:

- `01-payroll-creation`: shared setup, readiness seeding, and payroll import inputs.
- `02-payroll-settlement`: two-OU plus central payroll settlement browser walk, reports, and screenshots.

Recommended order:

```powershell
node .\browser-tests\01-payroll-creation\seed-readiness.mjs
node .\browser-tests\02-payroll-settlement\seed-two-ou.mjs
node .\browser-tests\02-payroll-settlement\walk-two-ou.mjs
```
