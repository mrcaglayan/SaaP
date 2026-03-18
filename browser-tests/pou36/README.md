## POU36 Browser Tests

Reusable browser-test assets for the PR-POU01..08 UI smoke pass.

Files:
- `payroll-starter-template.csv`: sample payroll import used by the UI flow.
- `seed-summary.json`: snapshot of the base payroll browser-smoke tenant data that was seeded into `DEFAULT`.
- `seed-readiness.mjs`: idempotent setup helper for the tenant-readiness blockers that otherwise redirect payroll routes back to setup.

Expected generated artifacts:
- `readiness-before.json`
- `readiness-after.json`
- `browser-walk-report.json`

Run:

```powershell
node .\browser-tests\pou36\seed-readiness.mjs
```
