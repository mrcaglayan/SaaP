# Consolidation Canonical Preflight Runbook
Date: 2026-03-05

Purpose
- Prevent consolidation execute failures from missing or invalid canonical mappings.
- Keep semantic-risk mapping changes explicit and auditable.

Scope
- Consolidation setup and run execute path.
- Canonical local/group account mappings.

## Pre-Consolidation Checklist
1. Open run compatibility snapshot.
  - Endpoint: `GET /api/v1/consolidation/runs/:runId`
  - Confirm `compatibility.subaccounts.checks.canonicalMappingCoverage === true`.
2. Preview canonical mapping candidates.
  - Endpoint: `GET /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates`
  - Review `SAFE`, `PARTIAL_MAPPING`, `MISSING_GROUP_MATCH`, `AMBIGUOUS_GROUP_MATCH`.
3. Apply safe deterministic candidates.
  - Endpoint: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/candidates/apply`
  - If safe rows include high-risk semantic warnings, include `reason`.
4. Resolve unresolved rows manually.
  - Local mapping endpoint: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/local`
  - Group mapping endpoint: `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/group`
  - If remap is high-risk (type/normal-side mismatch), include `reason`.
5. Re-check run compatibility snapshot.
  - Confirm missing count is zero before execute.
6. Execute run.
  - Endpoint: `POST /api/v1/consolidation/runs/:runId/execute`

## Failure Handling
- Execute `400` with canonical coverage error:
  - Inspect `details.reasonCounts` and `details.sampleRows`.
  - Fix mapping scope/date/status according to reason code:
    - `LOCAL_MAPPING_MISSING`
    - `LOCAL_MAPPING_INACTIVE`
    - `LOCAL_MAPPING_DATE_MISMATCH`
    - `CANONICAL_KEY_INACTIVE`
    - `GROUP_MAPPING_MISSING`
    - `GROUP_MAPPING_INACTIVE`
    - `GROUP_MAPPING_DATE_MISMATCH`

## Governance Rules
- Do not bypass canonical execute guard.
- Do not auto-apply ambiguous candidates.
- Require `reason` for high-risk remaps and high-risk safe candidate apply.
- Keep source tagging on updates (`source`) for audit traceability.

## One-Time Campaign (FUP-CM01)
- Goal: run candidate preview across active tenants/groups, apply only SAFE deterministic rows, and export unresolved backlog with assigned owner per tenant.
- Dry-run:
  - `cd backend`
  - `npm run ops:consolidation:canonical-campaign -- --candidateLimit 500 --limitGroups 50 --output artifacts/fup-cm01-backlog-dryrun.json`
- Apply wave:
  - `cd backend`
  - `npm run ops:consolidation:canonical-campaign -- --apply --reason "FUP-CM01 wave1 safe apply" --candidateLimit 500 --batchSize 25 --pauseMs 250 --output artifacts/fup-cm01-backlog-wave1.json`
- Optional scope filters:
  - `--tenantIds 1,2`
  - `--groupIds 10,11`
  - `--ownerUserId 123` (force preferred owner per tenant if valid)
- Backlog export includes:
  - unresolved row details by tenant/group/account
  - classification (`PARTIAL_MAPPING`, `MISSING_GROUP_MATCH`, `AMBIGUOUS_GROUP_MATCH`)
  - assigned owner (`ownerUserId`, `ownerEmail`, strategy)

## RBAC Parity Audit (FUP-CM02)
- Required permissions for canonical setup + execute flow:
  - `consolidation.coa_mapping.read`
  - `consolidation.coa_mapping.upsert`
  - `consolidation.run.read`
  - `consolidation.run.execute`
- Finance ops parity baseline is validated for:
  - `GroupController`
  - `CountryController`
  - `EntityAccountant`
- Run audit smoke:
  - `cd backend`
  - `npm run test:ux:consolidation-fup-cm02`

## Operational Readiness Surfacing (FUP-CM03)
- A dedicated canonical readiness snapshot is exposed separately from onboarding readiness contract:
  - `GET /api/v1/consolidation/groups/:groupId/canonical-readiness`
- Snapshot highlights:
  - `ready`, `coverageDetected`, `blockedReason`
  - summary counts (`safe`, `unresolved`, `missing`, `ambiguous`)
  - per-legal-entity readiness rows
- UI surfacing:
  - Consolidation Setup page includes a separate **Canonical Readiness** card with refresh action.
- Validation smoke:
  - `cd backend`
  - `npm run test:ux:consolidation-fup-cm03`

## Monitoring and Alerting (FUP-CM04)
- Execute failures caused by canonical coverage now emit a dedicated monitoring event:
  - audit action: `consolidation.execute.failure.canonical_mapping`
  - log event: `CONSOLIDATION_CANONICAL_EXECUTE_FAILURE`
- Failure subtype classification:
  - `MISSING_MAPPING`
  - `EFFECTIVE_DATE_MISMATCH`
- Event payload tags include:
  - `tenantId`
  - `consolidationGroupId` (when available)
  - `legalEntityId` (when available)
  - `reasonCounts`, `uncoveredCount`, sampled rows
- High-risk semantic overrides now emit:
  - log event: `CONSOLIDATION_CANONICAL_MAPPING_OVERRIDE_USAGE`
  - subtype: `SEMANTIC_RISK_OVERRIDE_USAGE`
  - contexts: `LOCAL_MAPPING_REMAP`, `GROUP_MAPPING_REMAP`, `SAFE_CANDIDATE_AUTO_APPLY`

- Repeated execute failure alert threshold:
  - env: `CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES` (default `60`)
  - env: `CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD` (default `3`)
  - alert log event: `CONSOLIDATION_CANONICAL_EXECUTE_FAILURE_ALERT`
  - behavior: when failure count in the rolling window meets/exceeds threshold, emit alert log.

- Validation smoke:
  - `cd backend`
  - `npm run test:ux:consolidation-fup-cm04`

## Mapping Governance Cadence (FUP-CM05)
- Month-end governance review is now available as a dedicated snapshot:
  - Endpoint: `GET /api/v1/consolidation/groups/:groupId/canonical-governance-review`
  - Ops command:
    - `cd backend`
    - `npm run ops:consolidation:canonical-governance-review -- --tenantId <id> --groupId <id> --fromDate 2026-03-01 --toDate 2026-03-31 --output artifacts/fup-cm05-governance.json`
- Snapshot sections:
  - `unmappedPostedAccounts`: posted local accounts without active canonical+group mapping coverage in review window.
  - `recentMappingChanges`: canonical local/group/candidate-apply changes from audit logs.
  - `highRiskOverrides`: change rows with semantic high-risk warnings or high-risk safe candidate apply usage.
  - `pendingCheckerReview`: queue of maker-checker required items.
- Maker-checker policy baseline:
  - checker must be different from maker.
  - required reason codes:
    - `AMBIGUOUS_CANDIDATE_SELECTION`
    - `HIGH_RISK_REMAP_OR_APPLY`
  - default review status: `PENDING_CHECKER_REVIEW`
- Required month-end review checks:
  - Review all `unmapped posted accounts` and resolve mapping gaps.
  - Review `recently changed canonical mappings` for scope/date/semantic correctness.
  - Review `overrides with semantic warnings` and complete checker sign-off before execution windows.

- Validation smoke:
  - `cd backend`
  - `npm run test:ux:consolidation-fup-cm05`

## Incident + Rollback Playbook (FUP-CM06)
- Trigger this playbook when:
  - consolidation execute is blocked with canonical mapping coverage `400`.
  - consolidation output is identified as wrong because of mapping error.

- Immediate containment:
  1. Stop further execute/finalize actions for the impacted group.
  2. Capture incident context:
    - `tenantId`, `groupId`, `runId`, `requestId`
    - error `reasonCounts` and sample rows
  3. Open readiness snapshots:
    - `GET /api/v1/consolidation/runs/:runId`
    - `GET /api/v1/consolidation/groups/:groupId/canonical-readiness`
    - `GET /api/v1/consolidation/groups/:groupId/canonical-governance-review`

- Rollback/correction procedure:
  1. Identify incorrect mapping scope:
    - local mapping scope: `(tenantId, consolidationGroupId, legalEntityId, localAccountId)`
    - group mapping scope: `(tenantId, consolidationGroupId, canonicalKeyId)`
  2. Close incorrect mapping with explicit incident reason:
    - `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/local`
    - `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/group`
    - set `status=INACTIVE` or set corrective `effectiveTo` as incident cutoff.
  3. Create corrected mapping with new effective window:
    - same endpoint(s), `status=ACTIVE`, corrected target, `effectiveFrom=<fix date>`, `reason=<incident id + rationale>`.
  4. Re-run preflight:
    - candidate preview/readiness must show no unresolved blocking gaps.
  5. Re-run consolidation in a **new run**:
    - create new run: `POST /api/v1/consolidation/runs`
    - execute new run: `POST /api/v1/consolidation/runs/:runId/execute`

- Important data model note:
  - canonical local/group mappings are unique per scope and are updated in-place (`ON DUPLICATE KEY UPDATE`).
  - history is preserved through `audit_logs` (source/reason/request metadata), not by multiple active history rows.

- Finance communication template:
  - Use: [docs/templates/consolidation-canonical-execute-blocked-notice.md](/c:/Users/Maarif/Desktop/my-app/docs/templates/consolidation-canonical-execute-blocked-notice.md)
  - Send immediately after containment and after final recovery confirmation.

- Validation smoke:
  - `cd backend`
  - `npm run test:ux:consolidation-fup-cm06`

## Performance and Scale Validation (FUP-CM07)
- Goal:
  - Validate canonical join behavior on higher-volume tenants for execute-path and report/governance paths.
  - Detect planner regressions early with `EXPLAIN` + latency thresholds.

- Ops benchmark command:
  - `cd backend`
  - `npm run ops:consolidation:canonical-performance-benchmark -- --tenantId <id> --groupId <id> --iterations 7 --output artifacts/fup-cm07-benchmark.json`

- Optional execute-path context (recommended for large tenants):
  - `--legalEntityId <id>`
  - `--fiscalPeriodId <id>`
  - `--effectiveOn <YYYY-MM-DD>`
  - If omitted, script auto-detects a posted context from the selected group when possible.

- Threshold controls:
  - `--executeThresholdMs <N>` (default `2000`)
  - `--candidateThresholdMs <N>` (default `2500`)
  - `--governanceThresholdMs <N>` (default `3000`)

- Planner checks included:
  - execute coverage canonical join plan (`journal_entries`/`journal_lines`/canonical local/group mappings)
  - candidate preview canonical join plan (`group_coa_mappings` + account code-match paths)
  - governance audit query plan (`audit_logs` action+scope+time path)

- If latency threshold breach occurs:
  1. Review benchmark report + EXPLAIN output.
  2. Confirm migration `m098_consolidation_canonical_performance_indexes` is applied.
  3. Re-run benchmark with same scope and thresholds.
  4. If still breached, open indexing follow-up with:
    - impacted query block
    - observed avg/p95 latency
    - tenant/group context and row volume estimate
    - proposed index/query-shape adjustment

- Validation smoke:
  - `cd backend`
  - `npm run test:ux:consolidation-fup-cm07`
