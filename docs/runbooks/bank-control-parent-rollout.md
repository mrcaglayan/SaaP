# Bank Control Parent Rollout Runbook

This runbook covers rollout, remediation, and rollback for BANK control-parent mapping after the direct `BANK_CONTROL_PARENT` cutover.

## Scope

- Strict bank validation now depends on `journal_purpose_accounts` row `BANK_CONTROL_PARENT`.
- One-click bank provisioning uses `POST /api/v1/bank/accounts/provision-control-parent-child`.
- Deprecated compatibility alias `POST /api/v1/bank/accounts/provision-102-child` was removed on March 11, 2026.

## Preflight

1. Confirm the tenant uses strict bank mode:
   - `tenant_features.feature_code = 'FEATURE_SUBACCOUNTS_V1'`
   - `tenant_features.is_enabled = 1`
2. Confirm the legal entity has a valid BANK mapping:
   - `journal_purpose_accounts.purpose_code = 'BANK_CONTROL_PARENT'`
   - mapped account is `ACTIVE`, `ASSET`, and belongs to the legal-entity chart
3. Confirm frontend users can reach:
   - GL Setup BANK mapping card
   - bank page readiness warning and neutral provisioning flow

## Tenant Audit Query

Use this query before pilot rollout to find strict-mode tenants that are still missing `BANK_CONTROL_PARENT`:

```sql
SELECT
  t.id AS tenant_id,
  t.code AS tenant_code,
  le.id AS legal_entity_id,
  le.code AS legal_entity_code,
  le.name AS legal_entity_name
FROM tenants t
JOIN tenant_features tf
  ON tf.tenant_id = t.id
 AND tf.feature_code = 'FEATURE_SUBACCOUNTS_V1'
 AND tf.is_enabled = 1
JOIN legal_entities le
  ON le.tenant_id = t.id
LEFT JOIN journal_purpose_accounts jpa
  ON jpa.tenant_id = t.id
 AND jpa.legal_entity_id = le.id
 AND jpa.purpose_code = 'BANK_CONTROL_PARENT'
WHERE jpa.account_id IS NULL
ORDER BY t.id, le.id;
```

Use this query when a tenant needs manual remediation because legacy `102` is ambiguous:

```sql
SELECT
  le.tenant_id,
  le.id AS legal_entity_id,
  le.code AS legal_entity_code,
  COUNT(*) AS legacy_102_candidate_count
FROM legal_entities le
JOIN charts_of_accounts c
  ON c.tenant_id = le.tenant_id
 AND c.scope = 'LEGAL_ENTITY'
 AND c.legal_entity_id = le.id
JOIN accounts a
  ON a.coa_id = c.id
 AND a.code = '102'
GROUP BY le.tenant_id, le.id, le.code
HAVING COUNT(*) <> 1
ORDER BY le.tenant_id, le.id;
```

## Backfill Sequence

1. Run dry-run first:

```bash
cd backend
npm run backfill:bank-control-parent -- --tenantId <TENANT_ID>
```

2. Review output:
   - `eligible` rows can be backfilled safely
   - `already_mapped` rows need no action
   - `remediation_required` rows must be fixed manually
3. Apply only after dry-run output is clean for the target tenant:

```bash
cd backend
npm run backfill:bank-control-parent -- --tenantId <TENANT_ID> --apply
```

4. Re-run the dry-run to confirm there are no remaining missing rows.
5. For remediation cases, open GL Setup and set `BANK_CONTROL_PARENT` manually to the correct active asset parent.

## Pilot Cohort

Pilot rollout should use a small set of strict-mode tenants with known bank activity:

1. Start with one TR-style tenant where the expected parent is legacy `102`.
2. Add one non-TR tenant where bank children live under a non-`102` asset parent.
3. For each pilot tenant:
   - run the audit query
   - run `backfill:bank-control-parent` dry-run
   - apply backfill or manual mapping
   - verify bank page readiness is green
   - verify create/update bank account flows
   - verify one-click provisioning creates children under the mapped parent, not a synthetic `102`

## Manual Remediation

Use manual setup instead of backfill when any of these conditions are true:

- there is no legal-entity `102` account
- there is more than one legal-entity `102` candidate
- the legacy `102` account is not `ACTIVE`
- the legacy `102` account is not `ASSET`
- the tenant intentionally uses another parent such as `1000` or `1150`

Correction path:

1. Open GL Setup.
2. Select module `BANK`.
3. Map `BANK_CONTROL_PARENT` to the correct active asset parent.
4. Re-check module readiness and bank page readiness.

## Compatibility And Sunset

- Required provisioning endpoint: `POST /api/v1/bank/accounts/provision-control-parent-child`
- Removed endpoint: `POST /api/v1/bank/accounts/provision-102-child`
- Removal date: March 11, 2026
- Required frontend API helper: `provisionBankAccountControlParentChild`

Any client still calling the removed alias must be updated before deployment. There is no longer any supported backend or frontend compatibility wrapper for `102` provisioning names.

## Rollback Posture

Preferred rollback is configuration rollback, not data deletion.

1. If rollout blocks a tenant unexpectedly, disable `FEATURE_SUBACCOUNTS_V1` for that tenant.
2. Correct `BANK_CONTROL_PARENT` mapping manually or rerun the backfill after remediation.
3. Re-test:
   - bank page readiness
   - manual bank account save
   - one-click provisioning under the mapped parent
4. Existing `bank_accounts` rows remain valid; do not delete bank accounts or GL children as part of rollback unless there is a separate accounting correction plan.

## Verification Checklist

- `node backend/scripts/test-bank-control-bpm01-purpose-mapping.js`
- `node backend/scripts/test-bank-control-bpm02-service-cutover.js`
- `node backend/scripts/test-bank-control-bpm03-readiness-api.js`
- `node backend/scripts/test-bank-control-bpm03-frontend-smoke.js`
- `node backend/scripts/test-bank-control-bpm04-policy-pack-backfill.js`
- `node backend/scripts/test-hardening-prh10-bank-provisioning.js`
- `node backend/scripts/test-bank-control-bpm05-regression.js`
