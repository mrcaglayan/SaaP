# 18 - CARI MULTI-CURRENCY SETTLEMENTS (ROLLOUT + UAT + PROD SIGNOFF)

## Purpose
Close the implementation-to-production gap after `17-CARI-MULTI-CURRENCY-SETTLEMENTS.md` by defining UAT, reconciliation, rollout controls, and GA signoff.

## Why This Exists
`PR-MCS01..05` delivered core capabilities (schema, FX policy, apply/reverse logic, frontend preview, reporting/release-gate).  
This follow-up track ensures safe activation on real tenant data and repeatable production operations.

## Entry Criteria
1. `test:cari:mcs-release-gate` passes on the target branch.
2. Required migration(s) are applied in target environment.
3. Finance owner confirms chart/purpose mappings are configured for legal entities in scope.

---

## Scope
1. UAT matrix for all currency-direction combinations and both AR/AP flows.
2. Tenant reconciliation/consistency checks before and after rollout.
3. Rollout runbook for pilot tenants, rollback actions, and GA signoff.
4. Operational support checklist (common errors, diagnostics, operator actions).

Out of scope:
1. New accounting semantics beyond PR-17.
2. Auto-FX/exchange execution inside settlement workflow.
3. Re-design of unrelated Cari/Cash modules.

---

## PR Sequence

1. `PR-MCSR01` - UAT matrix + deterministic fixtures
- Define scenario matrix:
  - Document local -> settlement local/foreign
  - Document foreign -> settlement local/foreign
  - AR + AP for each
  - Manual + cash-linked settlement variants
- Add executable test fixture script(s) for seeded deterministic runs.

2. `PR-MCSR02` - Reconciliation and data-quality gate hardening
- Standardize reconciliation execution:
  - `reconcile:cari:mcs01 -- --tenantId <id> --failOnSuspicious true`
- Add post-deploy SQL checks for:
  - missing dual-currency allocation metadata
  - parity-source inconsistencies
  - reversal chain integrity
- Produce operator-readable reconcile summary format.

3. `PR-MCSR03` - Ops diagnostics and support playbook
- Document high-frequency errors and exact causes/actions:
  - linked cash fxRate mismatch
  - missing FX for settlement/document pair
  - session/cash-link preconditions
- Add quick triage commands and expected outputs for support.

4. `PR-MCSR04` - Pilot rollout + rollback runbook
- Pilot wave plan (tenant list, dates, owners, go/no-go criteria).
- Rollback path:
  - stop new settlements (operational freeze)
  - isolate/repair suspicious rows
  - replay validation gates
- Evidence checklist per pilot tenant.

5. `PR-MCSR05` - GA readiness signoff and closure
- Final signoff template:
  - Engineering
  - Finance/Accounting owner
  - Operations
- GA release checklist and post-GA monitoring window.

---

## Test Artifacts (Planned)
1. `backend/scripts/test-cari-mcsr01-uat-matrix.js`
2. `backend/scripts/test-cari-mcsr02-reconcile-gate.js`
3. `backend/scripts/test-cari-mcsr03-error-playbook-smoke.js`
4. `backend/scripts/test-cari-mcsr04-pilot-rollout-checklist.js`
5. `backend/scripts/test-cari-mcsr05-ga-signoff-gate.js`
6. `backend/scripts/test-cari-mcsr-release-gate.js`

`backend/package.json` additions:
1. `test:cari:mcsr`
2. `test:cari:mcsr-release-gate`

---

## Acceptance Criteria
1. All UAT currency combinations pass with expected posting + realized FX behavior.
2. Reconciliation reports zero suspicious rows for pilot tenants (or approved exceptions with owner signoff).
3. Reversal behavior is auditable as original vs reversal in reports with no ambiguity.
4. Pilot rollout completes with documented evidence and no unresolved blocker severity issues.
5. GA signoff record is completed and archived.

---

## Rollout Checklist (Operational)
1. Run `npm run test:cari:mcs-release-gate`.
2. Run `npm run reconcile:cari:mcs01 -- --tenantId <id> --failOnSuspicious true`.
3. Execute pilot UAT matrix and store evidence.
4. Freeze-change window for cutover.
5. Enable GA and monitor for defined stabilization window.

---

## Notes
1. This file is a follow-up tracker for productionization; implementation baseline remains in `17-CARI-MULTI-CURRENCY-SETTLEMENTS.md`.
