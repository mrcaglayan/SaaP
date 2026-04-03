# RBAC Governance Operations Runbook

This runbook describes the steady-state operating model after the RBAC and governance redesign closure work.

## Scope

Use this document for:
- fresh-tenant seed/bootstrap
- brownfield role migration and rollback
- approval escalation scheduler operations
- compliance reporting
- unified approval/workflow runtime expectations

## Steady-State Expectations

- Composable duty-boundary roles are the active role model.
- `TenantAdmin`, `GroupController`, `CountryController`, and `EntityAccountant` are retired from the active catalog.
- All approval flows run through the unified approval engine.
- Legacy bank/workflow tables remain for audit and compatibility, not as alternate runtime engines.
- Scoped delegation and field visibility are active governance features.

## Fresh Tenant Bootstrap

Run from [backend/package.json](/c:/Users/Maarif/Desktop/my-app/backend/package.json) scripts:

```powershell
cd backend
npm run db:migrate
npm run db:seed:core
npm run db:seed:provider-admin
```

Optional:

```powershell
npm run db:seed
```

Notes:
- `db:seed:core` seeds the composable role catalog, permission metadata, and default field visibility policies.
- Legacy broad roles are not seeded for fresh tenants.
- If you use starter/demo fixtures, run the appropriate starter seed after the core seed.

## Brownfield Role Migration

The supported CLI is [role-migration-tool.js](/c:/Users/Maarif/Desktop/my-app/backend/scripts/role-migration-tool.js).

Preview:

```powershell
cd backend
node scripts/role-migration-tool.js preview --tenantId <TENANT_ID> --actorUserId <USER_ID>
```

Inspect a generated run:

```powershell
node scripts/role-migration-tool.js show --tenantId <TENANT_ID> --runId <RUN_ID>
```

Execute a reviewed run:

```powershell
node scripts/role-migration-tool.js execute --tenantId <TENANT_ID> --runId <RUN_ID> --actorUserId <USER_ID>
```

Execute only selected preview items:

```powershell
node scripts/role-migration-tool.js execute --tenantId <TENANT_ID> --runId <RUN_ID> --actorUserId <USER_ID> --itemIds 1,2,3
```

Rollback:

```powershell
node scripts/role-migration-tool.js rollback --tenantId <TENANT_ID> --runId <RUN_ID> --actorUserId <USER_ID>
```

Operator notes:
- Always review the preview output before execute.
- Keep the legacy rows in place until the tenant is validated on the new composable role model.
- Rollback uses the stored migration snapshot. Do not manually delete migration-run data before signoff.
- The UI may hide retired legacy roles, but rollback recoverability still depends on the stored DB rows.

## Unified Approval Runtime

Expected runtime state:
- no bank/workflow cutover feature flag remains in normal operation
- `approval_requests` and `approval_decisions` are the source of truth
- mirrored legacy bank/workflow rows remain available for audit/history

If approval behavior is investigated:
- inspect unified request state first
- treat legacy mirrored tables as compatibility/audit artifacts

## Approval Escalation Scheduler

One-shot scheduling tick:

```powershell
cd backend
npm run job:approval:escalation:schedule-due
```

Long-running scheduler:

```powershell
npm run jobs:approval:escalation:scheduler
```

Supported environment variables:
- `APPROVAL_ESCALATION_TENANT_ID`: optional tenant pin for targeted runs
- `APPROVAL_ESCALATION_USER_ID`: optional acting user id recorded on queued jobs
- `APPROVAL_ESCALATION_LIMIT`: max tenants considered per tick
- `APPROVAL_ESCALATION_INTERVAL_MINUTES`: scheduler idempotency bucket
- `APPROVAL_ESCALATION_POLL_MS`: polling interval for the long-running scheduler
- `APPROVAL_ESCALATION_DRY_RUN`: one-shot dry-run mode for schedule-due

Operational expectations:
- escalated requests remain actionable
- escalation is driven by per-step config on `approval_policy_steps`
- active fields are `escalation_after_hours`, `escalation_target_scope_mode`, and `escalation_max_count`

## Delegation Operations

Delegation facts:
- delegations are scope-aware
- delegators can only delegate authority they actually hold
- overlapping delegations for the same delegator/delegate/module/scope are rejected
- runtime state is derived from `effective_from`, `effective_to`, `is_active`, and revocation fields

Important:
- there is no required background expiry sweep for correctness
- expired delegations naturally stop resolving once `effective_to` is in the past

## Compliance Reporting

Backend endpoints from [rbac.js](/c:/Users/Maarif/Desktop/my-app/backend/src/routes/rbac.js):
- `POST /api/v1/rbac/audit-reports`
- `GET /api/v1/rbac/audit-reports/export.csv`

Admin UI:
- `/app/ayarlar/rbac/compliance-reports`

Supported report families:
- `ACCESS_MATRIX`
- `SOD_ANALYSIS`
- `APPROVAL_COVERAGE`
- `DELEGATION_LOG`
- `FULL` for JSON API generation only

Rules:
- CSV export is single-family only
- `reportType = FULL` is rejected on the CSV endpoint
- point-in-time reporting is driven by `asOfDate`

Required permissions:
- `security.audit.report.generate`
- `security.audit.report.export`

## Field Visibility

Expected behavior:
- field masking is row-scope-aware
- override permission is checked at the row scope, not as a global bypass
- masked access is audited in `sensitive_data_audit`

Operational note:
- default policies are seeded by `db:seed:core`
- security admins can manage policies from `/app/ayarlar/rbac/field-visibility-policies`
- policy CRUD continues to reuse the same runtime masking and audit seams

## Verification Checklist

After rollout or seed/migration changes, verify:
- users can log in and role admin pages load
- `GET /api/me/entitlements` reflects the expected scope summary
- at least one approval request can still be reviewed through the unified path
- escalation scheduler commands run without errors
- compliance report preview/export works for a security admin
- legacy role migration preview/execute/rollback still works on a non-fresh tenant
