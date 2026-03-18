## 00 Preparation

Readiness/setup assets for making the tenant green before payroll browser flows run.

Files:
- `seed-readiness.mjs`: idempotent readiness seed for shareholders, workflow assignments, and setup blockers that redirect payroll routes.
- `readiness-before.json`, `readiness-after.json`, `readiness-seed-summary.json`: latest readiness state captures.
- `artifacts/`: readiness-only screenshots and reports.

Run:

```powershell
node .\browser-tests\00-preparation\seed-readiness.mjs
```
