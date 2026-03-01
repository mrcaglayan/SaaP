# 10 - EXECUTION TRACKER (06+07+08+09)

## How to Use
- Update `Status` per row: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`.
- Keep exactly one row marked `NEXT` in `Next` column.
- Do not skip order unless a row says `Parallel allowed`.
- Add PR/commit/test evidence in `Evidence` when done.

## Status Legend
- `NOT_STARTED`: no implementation work started.
- `IN_PROGRESS`: currently being implemented.
- `BLOCKED`: cannot proceed due to dependency/issue.
- `DONE`: implemented and verified.

## Linear Execution Tracker

| # | Next | Status | Work Item (exact execution step) | Source | Depends On | Evidence |
|---|---|---|---|---|---|---|
| 1 | NEXT | NOT_STARTED | Add tenant feature flags: `feature_subaccounts_v1`, `feature_setup_wizard_v2`, `feature_consolidation_canonical_mapping_v1`, `feature_workflow_close_consolidation_v1`, `feature_tax_engine_v1`. | 09-F01 | - |  |
| 2 |  | NOT_STARTED | Add readiness placeholder checks (warning-only) for subaccounts, setup wizard v2, workflow approvals, tax engine, canonical mapping. | 09-F01 | #1 |  |
| 3 |  | NOT_STARTED | Create and commit implementation checklist file for platform prerequisites (`10-PR-F01-IMPLEMENTATION-CHECKLIST.md`) and link it to tracker updates. | 09-F01 | #1, #2 |  |
| 4 |  | NOT_STARTED | Create migration `m081_bank_accounts_subaccount_hardening.js` adding `bank_accounts.operating_unit_id` (nullable) with index and FK to `operating_units(id)`. | 06 PR-1 / 09-F02 | #1 |  |
| 5 |  | NOT_STARTED | Enforce bank identity uniqueness policy at DB level (`iban` preferred; fallback `account_no`) without breaking existing data. | 06 PR-1 / 09-F02 | #4 |  |
| 6 |  | NOT_STARTED | Extend bank account validators/routes/services to accept/persist/filter `operatingUnitId`. | 06 PR-2 / 09-F02 | #4 |  |
| 7 |  | NOT_STARTED | Add OU validation rules: same tenant, active OU, OU legal entity matches bank legal entity. | 06 PR-2 / 09-F02 | #6 |  |
| 8 |  | NOT_STARTED | Add frontend Bank Accounts form/list support for OU selection and OU filtering. | 06 PR-6 / 09-F02 | #6, #7 |  |
| 9 |  | NOT_STARTED | Enforce strict bank GL link policy: selected bank `glAccountId` must be leaf descendant of configured `102` control account (flag-gated). | 06 PR-3 / 09-F03 | #1, #6 |  |
| 10 |  | NOT_STARTED | Implement strict/fallback behavior when `102` parent is missing (strict: fail actionable; non-strict: keep existing checks). | 06 PR-3 / 09-F03 | #9 |  |
| 11 |  | NOT_STARTED | Add bank identity immutability guard after first usage/posting for `gl_account_id`, `currency_code`, `iban`, `account_no` (and configured critical fields). | 06 PR-4 / 09-F03 | #6 |  |
| 12 |  | NOT_STARTED | Implement usage detector queries (statement lines, payment flows, reconciliation refs, posted journals) before allowing mutation. | 06 PR-4 / 09-F03 | #11 |  |
| 13 |  | NOT_STARTED | Implement transactional one-click provisioning API/service: create `102` child account + linked bank account + rollback on failure + idempotency key handling. | 06 PR-5 / 09-F04 | #9, #10, #11 |  |
| 14 |  | NOT_STARTED | Add Bank Accounts UI action for one-click provisioning and enforce deterministic duplicate-safe code allocator under `102` (e.g., `102.001`). | 06 PR-5 / 09-F04 | #13 |  |
| 15 |  | NOT_STARTED | Implement Setup Wizard V2 flow: Country -> Entity -> CoA Template -> Account Tree -> Branches. | 07 PR-1 / 09-F05 | #1 |  |
| 16 |  | NOT_STARTED | Extend onboarding payload to hierarchical accounts (`parentCode`) and backend parent resolution order with parent non-postable enforcement. | 07 PR-2 / 09-F05 | #15 |  |
| 17 |  | NOT_STARTED | Keep bootstrap backward compatibility for existing flat `defaultAccounts` payloads. | 07 PR-2 / 09-F05 | #16 |  |
| 18 |  | NOT_STARTED | Expand country policy packs to include starter trees, required parent accounts, required purpose mappings. | 07 PR-3 / 09-F06 | #15 |  |
| 19 |  | NOT_STARTED | Add onboarding API path to preview/apply selected country pack in the same bootstrap transaction. | 07 PR-3 / 09-F06 | #18 |  |
| 20 |  | NOT_STARTED | Create migration `m082_close_consolidation_workflow_approvals.js` with workflow definition, steps, assignments, instances, decisions tables and constraints. | 08 A1 / 09-F07 | #1 |  |
| 21 |  | NOT_STARTED | Build workflow definition and assignment APIs (`GET/POST/PATCH`) with validators and scope-safe access. | 08 A4 / 09-F07 | #20 |  |
| 22 |  | NOT_STARTED | Implement workflow decision endpoints (`approve/reject`) with maker-checker, permission checks, and min approver advancement rules. | 08 A2+A4 / 09-F08 | #20, #21 |  |
| 23 |  | NOT_STARTED | Gate period close and consolidation finalize routes with workflow approval checks; return `APPROVAL_REQUIRED`/related error contracts when needed. | 08 A3 / 09-F08 | #22 |  |
| 24 |  | NOT_STARTED | Add workflow setup/status UI and readiness checklist integration for approval gate visibility. | 08 C1+C2 / 09-F09 | #23 |  |
| 25 |  | NOT_STARTED | Create migration `m083_country_tax_engine_foundation.js` with `tax_regimes`, `tax_codes`, `tax_rule_sets`, `tax_account_mappings` tables and constraints. | 08 B1 / 09-F10 | #1 |  |
| 26 |  | NOT_STARTED | Build tax setup APIs (`regimes`, `codes`, `rules`, `account-mappings`, `preview`) with validators and explicit error contracts. | 08 B4 / 09-F10 | #25 |  |
| 27 |  | NOT_STARTED | Implement `tax.engine.service.js` core functions: regime resolver, rule resolver, tax computation, account resolver, journal line builder. | 08 B2 / 09-F11 | #25, #26 |  |
| 28 |  | NOT_STARTED | Integrate tax engine into CARI document and settlement posting flows with fail-fast mapping/rule errors. | 08 B3 / 09-F11 | #27, #19 |  |
| 29 |  | NOT_STARTED | Implement canonical consolidation mapping model (local account -> canonical key -> group account), including migration/backfill scaffolding. | 07 PR-4 / 09-F12 | #19, #23, #28 |  |
| 30 |  | NOT_STARTED | Update consolidation extraction/run logic to use canonical mapping (remove same-code dependency). | 07 PR-4 / 09-F12 | #29 |  |
| 31 |  | NOT_STARTED | Wire compatibility checks across tracks: subaccounts (F03/F04), approval gate (F08), tax-posted lines (F11) in consolidation outputs. | 09-F12 | #30 |  |
| 32 |  | NOT_STARTED | Add backfill scripts: workflow defaults, tax regimes/codes, tax account mappings, canonical mapping bootstrap. | 08 E2 / 09-F13 | #31 |  |
| 33 |  | NOT_STARTED | Expand regression/release-gate scripts for workflow, tax, setup wizard, canonical mapping, and cross-track idempotency. | 08 F / 09-F13 | #32 |  |
| 34 |  | NOT_STARTED | Write rollout runbook and docs: migration order, pilot flag strategy, tenant backfill sequence, and go-live checklist. | 06 PR-8 / 08 D+E / 09-F13 | #33 |  |
| 35 |  | NOT_STARTED | Pilot rollout: enable flags for pilot tenants only, validate readiness, run close+consolidation+tax end-to-end, then prepare GA switch plan. | 08 D / 09-F13 | #34 |  |

## Parallel Windows (allowed)
- Track A (Subaccounts): #4 to #14 after #1.
- Track B (Setup Wizard + Country packs): #15 to #19 after #1.
- Track C (Workflow approvals): #20 to #24 after #1.
- Track D (Tax engine): #25 to #28 after #1.
- Convergence starts at #29 (requires outputs from B, C, D).

## Current Next Action
- Execute step #1.