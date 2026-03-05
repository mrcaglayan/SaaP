# 16 - Consolidation Mapping Reliability (Guarded Automation)
Date: 2026-03-05

Purpose
- Prevent consolidation execute failures caused by missing canonical mappings.
- Prevent date-scope mistakes (`effectiveFrom`/`effectiveTo`) from blocking runs unexpectedly.
- Reduce semantic mapping mistakes (same code, different meaning) with controlled automation and review.

Scope
- Consolidation mapping and execute flow only.
- Keep current fail-fast behavior in execute endpoint.
- Add preflight visibility and operator workflow in setup UI.

------------------------------------------------------------------------------
Current Problem Summary
------------------------------------------------------------------------------

- `POST /api/v1/consolidation/runs/:runId/execute` fails when posted local accounts do not have active canonical mapping coverage.
- Common error pattern:
  - `Canonical consolidation mapping is missing ... Sample codes: 1100, 4000`
- Existing setup currently allows proceeding until execute, which is too late for operators.

------------------------------------------------------------------------------
Global Rules (All PRs)
------------------------------------------------------------------------------

- Keep backend hard-stop protection in execute flow.
- No silent auto-apply for ambiguous mappings.
- Mapping operations must remain tenant/group/legal-entity scoped.
- Effective-date consistency is mandatory: no overlap/gap behavior for active mapping coverage windows.
- All changes must preserve auditability of who changed what and when.

------------------------------------------------------------------------------
PR-CM01 - Execute Preflight Gate in UI
------------------------------------------------------------------------------

Goal
- Block execute from UI when compatibility preflight indicates missing canonical coverage.

Backend
- Reuse existing run details endpoint compatibility payload:
  - `GET /api/v1/consolidation/runs/:runId`
- No behavior change to execute guard.

Frontend
- Add `getConsolidationRun(runId)` API client call.
- In consolidation setup page:
  - Fetch compatibility before execute.
  - Show canonical coverage status and missing-count.
  - Disable Execute button when `compatibility.subaccounts.checks.canonicalMappingCoverage !== true`.
  - Show actionable guidance text.

Acceptance
- User cannot execute a run from UI when canonical coverage is missing.
- User sees preflight status and reason before clicking execute.

Tests
- Add/update smoke to assert execute button lock behavior based on compatibility payload.

------------------------------------------------------------------------------
PR-CM02 - Canonical Mapping Workbench in Setup UI
------------------------------------------------------------------------------

Goal
- Provide deterministic manual path to resolve missing mappings in-product.

Backend
- Reuse existing endpoints:
  - `GET /api/v1/consolidation/groups/:groupId/canonical-mappings`
  - `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/local`
  - `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/group`

Frontend
- Add canonical mapping section in Consolidation Setup page:
  - Filter by legal entity.
  - Show local account, canonical key, group account, status, effective dates.
  - Add create/update actions for local/group mappings.
  - Surface validation errors directly.

Acceptance
- Operator can map uncovered local accounts to canonical keys and group accounts without scripts.
- Execute succeeds after mapping is completed.

Tests
- API smoke for local/group canonical upsert and list.
- UI smoke for map-and-retry flow.

------------------------------------------------------------------------------
PR-CM03 - Candidate Generator + Controlled Auto-Apply
------------------------------------------------------------------------------

Goal
- Reduce manual work safely using strict candidate rules.

Backend
- Lift candidate logic from script (`backfill-canonical-consolidation-mappings.js`) into service/API.
- Add endpoints:
  - Preview candidates (dry-run).
  - Apply safe candidates (explicit apply).
- Safe candidate rules:
  - Active `group_coa_mappings`.
  - Exact local/group account code match.
  - Deterministic one-to-one result only.
- Ambiguous results must be flagged, not auto-applied.

Frontend
- Add preview/apply actions in setup page.
- Show counts:
  - Safe candidates.
  - Ambiguous/unresolved rows.

Acceptance
- Preview returns clear safe vs ambiguous output.
- Apply writes only safe candidates.

Tests
- Backend tests for candidate classification and apply behavior.

------------------------------------------------------------------------------
PR-CM04 - Effective Date Safety
------------------------------------------------------------------------------

Goal
- Prevent mapping-date regressions from breaking execute.

Backend
- Enforce strict effective-date consistency on mapping updates:
  - `effectiveTo >= effectiveFrom`
  - no accidental overlapping active windows for same mapping scope.
- Improve execute failure detail payload for date-related misses.

Frontend
- Validate mapping date input against run period context.
- Warn/block obvious misalignment:
  - mapping effective start after run period end.

Acceptance
- Date-scope errors are detected before execute whenever possible.
- Execute errors are specific enough for immediate correction.

Tests
- Add tests for date overlap/misalignment edge cases.

------------------------------------------------------------------------------
PR-CM05 - Semantic Quality + Governance
------------------------------------------------------------------------------

Goal
- Reduce wrong consolidation caused by technically valid but semantically wrong mappings.

Backend
- Add warning checks on candidate/mapping workflow:
  - `accountType` mismatch
  - `normalSide` mismatch
  - suspicious name mismatch
- Require note/reason for high-risk remap changes.
- Ensure audit log entries for mapping create/update/apply source.

Frontend
- Display warning badges for semantic-risk rows.
- Require confirmation/reason for risk-flagged changes.

Acceptance
- Operators are warned before applying semantically risky mappings.
- Changes are traceable through audit trail.

Tests
- Add semantic warning detection tests and audit emission checks.

------------------------------------------------------------------------------
PR-CM06 - Release Gate and Runbook Hardening
------------------------------------------------------------------------------

Goal
- Make the process repeatable and CI-safe.

Backend/Tests
- Keep intercompany/consolidation integration test seeded with canonical mapping prerequisites.
- Add dedicated regression checks:
  - execute blocked when canonical mapping missing.
  - execute blocked for date-scope invalid mapping.
  - candidate preview/apply expected behavior.

Ops Runbook
- Add pre-consolidation checklist:
  - Check run compatibility snapshot.
  - Run candidate preview.
  - Apply safe candidates.
  - Resolve ambiguous items manually.
  - Execute run.

Acceptance
- Release gate catches mapping regressions early.
- Ops team has a deterministic preflight procedure.

------------------------------------------------------------------------------
Implementation Order
------------------------------------------------------------------------------

1. PR-CM01 (preflight gate visibility and execute lock)
2. PR-CM02 (manual canonical mapping workbench)
3. PR-CM03 (candidate preview + controlled apply)
4. PR-CM04 (effective-date safety)
5. PR-CM05 (semantic quality + governance)
6. PR-CM06 (tests + runbook hardening)

------------------------------------------------------------------------------
Initial File Touch List (Expected)
------------------------------------------------------------------------------

- `backend/src/routes/consolidation.js`
- `backend/src/services/consolidation.canonical-mappings.service.js`
- `backend/scripts/backfill-canonical-consolidation-mappings.js`
- `backend/scripts/test-intercompany-and-consolidation-reports.js`
- `frontend/src/api/consolidationAdmin.js`
- `frontend/src/pages/settings/ConsolidationSetupPage.jsx`
- `frontend/src/i18n/messages.js`

------------------------------------------------------------------------------
Follow-up Steps (Post PR-CM06)
------------------------------------------------------------------------------

FUP-CM01 - One-Time Tenant Backfill Campaign
- Run canonical candidate preview for all active tenants/groups.
- Apply only safe deterministic candidates in controlled batches.
- Produce unresolved backlog (ambiguous/unmapped accounts) per tenant and assign owner.

FUP-CM02 - RBAC/Role Parity Audit
- Verify tenant admin and finance ops roles include:
  - `consolidation.coa_mapping.read`
  - `consolidation.coa_mapping.upsert`
  - consolidation run read/execute permissions already required by flow
- Add a smoke test for permission regressions on canonical mapping endpoints.

FUP-CM03 - Operational Readiness Surfacing
- Surface canonical mapping readiness as a first-class setup signal in consolidation setup workflow.
- If onboarding readiness contract must remain stable, expose this as a separate setup card (do not break existing response contracts).

FUP-CM04 - Monitoring and Alerting
- Add structured metric/log event for execute failures with canonical mapping cause.
- Track by tenant/group/legalEntity and error subtype:
  - missing mapping
  - effective date mismatch
  - semantic-risk override usage
- Add alert threshold for repeated execute failures per tenant.

FUP-CM05 - Mapping Governance Cadence
- Define maker-checker process for ambiguous and high-risk remaps.
- Require periodic review (e.g., month-end) of:
  - unmapped posted accounts
  - recently changed canonical mappings
  - overrides with semantic warnings

FUP-CM06 - Incident + Rollback Playbook
- Document quick response for bad mapping incidents:
  - set incorrect mapping inactive / close via `effectiveTo`
  - create corrected mapping with new `effectiveFrom`
  - re-run consolidation in a new run
- Include communication template for finance users when execute is intentionally blocked.

FUP-CM07 - Performance/Scale Validation
- Validate canonical joins on higher volume tenants (execute + reports).
- Add/query-plan checks and indexing follow-up if run execution latency crosses agreed threshold.
