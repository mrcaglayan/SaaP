# 11 - PR-F13 Rollout Runbook

## Purpose
Operational runbook for rolling out Subaccounts + Setup Wizard + Workflow approvals + Tax engine + Canonical consolidation mappings for existing tenants.

Source alignment:
- `06-SUBACCOUNTS.md` -> `PR-8: Documentation + Rollout Runbook`
- `08-APPROVAL AND TAX ENGINE.md` -> `D. Feature Flags and Rollout` + `E. Migration and Backfill Strategy`
- `09-FOLLOW UPS.md` -> `PR-F13`

## Scope
This runbook covers:
1. Migration order
2. Tenant pilot feature-flag strategy
3. Tenant backfill sequence
4. Go-live checklist
5. Rollback/mitigation actions

## Inputs Required Before Starting
- Approved change window and DB backup/restore point
- Pilot tenant list (tenant IDs)
- Owner list:
  - Engineering on-call
  - Finance operations approver (team mode) or solo owner
  - Product owner sign-off (team mode) or solo owner

---

## 1. Migration Order
Run all pending migrations in order. Required migration keys for this rollout:
1. `m081_bank_accounts_subaccount_hardening`
2. `m082_close_consolidation_workflow_approvals`
3. `m083_country_tax_engine_foundation`
4. `m084_consolidation_canonical_mapping_foundation`

Commands (PowerShell):
```powershell
cd backend
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
```

Quick registration verification:
```powershell
rg -n "m081|m082|m083|m084" backend/src/migrations/index.js -S
```

---

## 2. Pilot Feature-Flag Strategy
Feature codes (tenant-level):
- `feature_subaccounts_v1`
- `feature_setup_wizard_v2`
- `feature_consolidation_canonical_mapping_v1`
- `feature_workflow_close_consolidation_v1`
- `feature_tax_engine_v1`

Policy:
- Existing tenants: OFF by default
- Pilot tenants: enable in phases after backfills and validation
- General availability: enable after pilot sign-off

Suggested enablement phases:
1. Phase A (foundation): `feature_setup_wizard_v2`, `feature_subaccounts_v1`, `feature_consolidation_canonical_mapping_v1`
2. Phase B (approval gating): `feature_workflow_close_consolidation_v1`
3. Phase C (tax posting): `feature_tax_engine_v1`

SQL template (per tenant):
```sql
INSERT INTO tenant_features (tenant_id, feature_code, is_enabled, updated_by_user_id)
VALUES
  (?, 'FEATURE_SETUP_WIZARD_V2', 1, ?),
  (?, 'FEATURE_SUBACCOUNTS_V1', 1, ?),
  (?, 'FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1', 1, ?),
  (?, 'FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1', 0, ?),
  (?, 'FEATURE_TAX_ENGINE_V1', 0, ?)
ON DUPLICATE KEY UPDATE
  is_enabled = VALUES(is_enabled),
  updated_by_user_id = VALUES(updated_by_user_id),
  updated_at = CURRENT_TIMESTAMP;
```

Disable template (emergency stop):
```sql
UPDATE tenant_features
SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = ?
  AND feature_code IN (
    'FEATURE_SUBACCOUNTS_V1',
    'FEATURE_SETUP_WIZARD_V2',
    'FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1',
    'FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1',
    'FEATURE_TAX_ENGINE_V1'
  );
```

## 2.1 Pilot Feature Rollout Automation
Use scripted dry-run/apply to avoid manual feature-toggle mistakes.

Dry-run by phase:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase A
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase B
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase C
```

Apply by phase:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase A --apply
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase B --apply
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase C --apply
```

The script validates readiness signals for workflow, tax, and canonical mapping before writes.
Use `--force` only for controlled exception windows with explicit sign-off.

---

## 3. Tenant Backfill Sequence
Backfills are idempotent. Run dry-run first, then apply.

Recommended order per tenant:
1. Workflow defaults
2. Tax regimes and tax codes
3. Tax account mappings
4. Canonical consolidation mappings

Workflow default note:
- Period close default approval chain is scope-aware: `LEGAL_ENTITY -> GROUP`.
- Consolidation run default approval chain is scope-aware: `GROUP`.

Dry-run commands (PowerShell):
```powershell
cd backend
npm run backfill:workflow-defaults -- --tenantId <TENANT_ID>
npm run backfill:tax-regimes -- --tenantId <TENANT_ID>
npm run backfill:tax-account-mappings -- --tenantId <TENANT_ID>
npm run backfill:canonical-mappings -- --tenantId <TENANT_ID>
```

Apply commands (PowerShell):
```powershell
cd backend
npm run backfill:workflow-defaults -- --tenantId <TENANT_ID> --apply
npm run backfill:tax-regimes -- --tenantId <TENANT_ID> --apply
npm run backfill:tax-account-mappings -- --tenantId <TENANT_ID> --apply
npm run backfill:canonical-mappings -- --tenantId <TENANT_ID> --apply
```

Optional filters:
- Workflow assignments by group: `--groupCompanyId <GROUP_ID>`
- Effective date controls: `--effectiveFrom YYYY-MM-DD` / `--effectiveOn YYYY-MM-DD`
- Controlled batch scope: `--limit <N>`

Capture run output for audit:
```powershell
npm run backfill:tax-account-mappings -- --tenantId <TENANT_ID> --apply `
  | Tee-Object -FilePath ".\\logs\\backfill-tax-account-mappings-<TENANT_ID>.log"
```

---

## 4. Regression and Release-Gate Validation
Run PR-F13 expanded regression chain:
```powershell
cd backend
npm run test:followup:prf13-release-gate
```

Run unified release gate for follow-up stage only:
```powershell
cd backend
$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate
```

Mandatory coverage in this stage includes:
- Workflow regression checks
- Runtime operational smoke (workflow-gated period close + consolidation + tax pipeline)
- Tax engine regression checks
- Setup wizard regression checks
- Canonical mapping wiring checks
- Cross-track idempotency checks
- Backfill script checks

Optional standalone operational smoke command:
```powershell
cd backend
npm run test:followup:prf13-operational-smoke -- --tenantIds <TENANT_ID_1,TENANT_ID_2>
```

---

## 5. Go-Live Checklist
- [ ] Backup/restore point created before migration window
- [ ] `db:migrate` completed successfully in production
- [ ] Backfills executed for each pilot tenant (dry-run + apply + logs archived)
- [ ] PR-F13 release-gate regression chain passed
- [ ] Pilot feature flags enabled by phase (A -> B -> C)
- [ ] Readiness checks reviewed with finance operations
- [ ] Pilot close/consolidation/tax end-to-end smoke completed
- [ ] No blocking reconciliation/posting errors in pilot period
- [ ] Product + finance sign-off collected (team mode) or solo-owner self-approval recorded in `13-PR-F13-GA-SIGNOFF-RECORD.md`
- [ ] General availability enablement plan approved by responsible owner

---

## 6. Rollback and Mitigation
1. Disable rollout feature flags for impacted tenant(s) first.
2. Stop pilot expansion until issue classification is complete.
3. Fix setup gaps (workflow assignment, tax mappings, canonical mapping coverage).
4. Re-run idempotent backfills for impacted tenant(s).
5. Re-run PR-F13 release-gate stage before re-enabling flags.

Notes:
- Migrations in this track are additive/non-destructive; no production down-migration is assumed.
- Preferred rollback is feature-flag disable + setup remediation, not data deletion.

---

## 7. GA Switch Planning
Use `12-PR-F13-PILOT-GA-SWITCH-PLAN.md` to track:
- pilot phase progression (A -> B -> C)
- readiness and regression evidence
- close + consolidation + tax validation outcomes
- final GA go/no-go approvals

Use `13-PR-F13-GA-SIGNOFF-RECORD.md` to capture:
- finance operations decision (or solo-owner equivalent)
- product owner decision (or solo-owner equivalent)
- final GO/NO-GO approval audit trail

---

## 8. Evidence Template
Record per tenant:
- Tenant ID
- Migration window timestamp
- Backfill commands executed
- Backfill output log file paths
- Feature flags enabled (phase and timestamp)
- Validation command outputs (`test:followup:prf13-release-gate`, `test:release-gate`)
- Final approver/sign-off
