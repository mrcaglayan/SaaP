# 57 - COUNTRY-SCOPED AP WORKFLOW (ROLLOUT + UAT + SIGNOFF)

## Purpose
Close the implementation-to-production gap after PR-1 through PR-5 by defining the rollout order, UAT checklist, rollback posture, and evidence capture for country-scoped AP workflow governance.

## Fresh Install Assumption
- This PR-6 tracker assumes a fresh database/bootstrap path.
- No brownfield AP draft normalization or historical-data correction script is required for this environment.
- New tenants should receive the default AP workflow definition seed, but rollout flags remain OFF until finance intentionally enables pilot mode.

## Entry Criteria
1. PR-1 through PR-5 code is merged on the target branch.
2. `node backend/scripts/test-cari-pr27-governed-ap-review-states.js` passes.
3. `node backend/scripts/test-cari-pr28-country-visibility-and-workbench.js` passes.
4. Finance/setup owner confirms pilot country/legal-entity scope and named rollout owners.

---

## Scope
1. Default AP workflow template bootstrap for fresh tenants.
2. Pilot rollout + rollback runbook for the two-flag AP workflow model.
3. UAT checklist for country-scoped AP visibility, approve/return/resubmit, and post gating.
4. Go/no-go criteria and evidence capture for pilot tenants.

Out of scope:
1. Brownfield draft-data repair or historical AP correction backfills.
2. Silent auto-assignment of country workflow rules.
3. Re-design of close/consolidation governance.

---

## Pilot Rollout + Rollback Runbook

### Phase 1 - Pilot
1. Seed/bootstrap the tenant so the default AP definition exists:
   - `WF_STD_AP_COUNTRY_POSTING_V1`
   - one step
   - `stageScopeType = COUNTRY`
   - `requiredPermissionCode = null`
2. Create explicit AP workflow assignments for the pilot country or legal entity.
3. Run dry-run rollout:
   - `cd backend`
   - `npm run rollout:ap-workflow:pr6 -- --tenantIds <TENANT_ID> --phase PILOT`
4. Apply pilot rollout:
   - `npm run rollout:ap-workflow:pr6 -- --tenantIds <TENANT_ID> --phase PILOT --apply`
5. Validate governed AP flow only in pilot scope while compat fallback stays ON elsewhere.

### Phase 2 - Strict
1. Expand explicit AP assignments until every active legal entity is covered by tenant/group/country/legal-entity fallback.
2. Run dry-run strict rollout:
   - `npm run rollout:ap-workflow:pr6 -- --tenantIds <TENANT_ID> --phase STRICT`
3. Apply strict rollout only after coverage is clean:
   - `npm run rollout:ap-workflow:pr6 -- --tenantIds <TENANT_ID> --phase STRICT --apply`

### Rollback Path
1. Disable governed AP rollout for the affected tenant:
   - `npm run rollout:ap-workflow:pr6 -- --tenantIds <TENANT_ID> --phase ROLLBACK --apply`
2. Keep workflow definitions and assignments for evidence; do not delete them during rollback.
3. Correct assignment gaps or role/scope issues.
4. Re-run pilot dry-run and targeted UAT before enabling the feature again.

---

## Pilot Wave Plan
1. Start with one tenant and one pilot country where two legal entities already exist.
2. Use one legal entity that relies on country fallback and one legal entity that has an explicit override.
3. Name owners for:
   - engineering
   - finance/AP process owner
   - security/RBAC owner
   - operations/support

## UAT Focus
1. Same-country multi-entity AP posting governance.
2. Entity override over country assignment.
3. Return and resubmit behavior with preserved correction copy.
4. Country-scoped visibility of governed AP documents.
5. Posting block messages while workflow approval is pending.
6. Coexistence with close / consolidation workflow governance.

## UAT Scenario Checklist
1. Branch or entity user creates AP draft; country-scoped reviewer can find it from the workbench.
2. Submit -> approve -> post succeeds when assignment coverage exists.
3. Submit -> return -> correct -> resubmit -> approve -> post succeeds with a new workflow instance.
4. Country assignment governs multiple legal entities in the same country.
5. Legal-entity assignment overrides country assignment.
6. Pending workflow gate blocks post with readable explanation.
7. Non-governed AP class still direct-posts.
8. Period-close and consolidation workflow paths remain operational during AP rollout.

---

## Go/No-Go Criteria
1. Pilot tenant has explicit AP assignments for the intended rollout scope.
2. Country-scoped AP users can list/read governed AP documents across same-country entities.
3. Entity AP controller and country AP poster duties are separated in real role assignments.
4. No blocker-severity issue remains open on submit, approve/return, post, or visibility paths.
5. Close/consolidation smoke remains green after AP rollout changes.

## Evidence
Capture per pilot tenant:
1. Dry-run JSON output from `rollout:ap-workflow:pr6`.
2. Apply JSON output from `rollout:ap-workflow:pr6`.
3. Screenshot or export of workflow definition `WF_STD_AP_COUNTRY_POSTING_V1`.
4. Screenshot or export of explicit AP workflow assignments in scope.
5. UAT results for submit/return/resubmit/post.
6. Confirmation that close/consolidation workflow screens still operate.

---

## Rollout Checklist (Operational)
1. Run `node backend/scripts/test-cari-pr27-governed-ap-review-states.js`.
2. Run `node backend/scripts/test-cari-pr28-country-visibility-and-workbench.js`.
3. Run `npm run test:followup:pr6-rollout`.
4. Dry-run pilot rollout for the target tenant.
5. Apply pilot rollout.
6. Execute pilot UAT and store evidence.
7. Expand assignments.
8. Dry-run strict rollout.
9. Apply strict rollout only after go/no-go approval.

## Notes
1. Assignment presence stays explicit by design; this tracker does not authorize automatic country assignment creation.
2. The AP rollout CLI seeds the default definition when missing, but it never creates workflow assignments for the tenant.
