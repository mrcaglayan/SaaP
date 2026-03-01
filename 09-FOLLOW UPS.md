# 09 - FOLLOW-UPS PR LIST (00..08 Combined, repo-aware)


## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Combined Audit Result

## What is already mostly implemented (from 00..05)
- Cari core + frontend + quality gate chain (`PR-11..15`) and contracts/revenue blocks (`PR-16..28`) are present in code/test scripts.
- Cash-Cari integration (`PR-17..26`) exists, including transit workflow (`test-cash-pr26-transit-workflow.js`).
- Bank + Payroll roadmap (`04-*`) is largely implemented (`m031..m080`, PR-B/PR-P/PR-H script coverage present).
- UX/Hardening roadmap (`05-IMPROVEMENTS.md`) is largely implemented (PR-UX/PR-CORE scripts exist).

## Open work concentrated in 06..08
Not implemented yet in repo:
- `m081` Subaccounts hardening + bank OU ownership and strict 102 subtree controls.
- Setup Wizard V2 / country-first + onboarding account tree payload.
- Canonical consolidation mapping layer for different local chart codes.
- Explicit close/consolidation staged workflow approvals (`m082` track).
- Country tax/VAT engine (`m083` track).

---

## Follow-up PR List (with wiring/dependencies)

## PR-F01: Platform prerequisites and feature flags
Goal:
- Create cross-track toggles and guardrails before major behavior changes.

Deliverables:
- Tenant feature flags:
  - `feature_subaccounts_v1`
  - `feature_setup_wizard_v2`
  - `feature_consolidation_canonical_mapping_v1`
  - `feature_workflow_close_consolidation_v1`
  - `feature_tax_engine_v1`
- Readiness placeholders for new modules (initially warning-only).
- Detailed implementation checklist: `10-PR-F01-IMPLEMENTATION-CHECKLIST.md`

Depends on: none
Unblocks: all following PRs

## PR-F02: Subaccounts schema hardening (`m081`) and bank OU ownership
Goal:
- Implement `06-SUBACCOUNTS` PR-1/2 foundation.

Deliverables:
- Migration `m081_*`:
  - `bank_accounts.operating_unit_id` + indexes/FKs
  - bank account identity constraints (IBAN/account uniqueness policy)
- API/service/UI support for optional OU owner.

Depends on: PR-F01
Unblocks: PR-F03, PR-F04, PR-F12

## PR-F03: 102 subtree enforcement + immutability after posting
Goal:
- Complete `06-SUBACCOUNTS` integrity controls.

Deliverables:
- Enforce bank GL account under configured `102` subtree (flagged rollout).
- Block critical bank identity mutations once posted/consumed.
- Add compatibility checks for payments/reconciliation/payroll consumers.

Depends on: PR-F02
Unblocks: PR-F04, PR-F12

## PR-F04: Bank one-click provisioning (auto-create 102 child + bank account)
Goal:
- Complete subaccounts usability path.

Deliverables:
- Transactional service/API to create `102` child + bank account atomically.
- Frontend action in Bank Accounts page.
- Idempotency-safe retry semantics.

Depends on: PR-F03
Unblocks: PR-F12

## PR-F05: Setup Wizard V2 (country-first) + onboarding account tree payload
Goal:
- Implement `07-SETUPLOGIC` PR-1/2.

Deliverables:
- Wizard flow: Country -> entity -> template -> account tree -> branches.
- Onboarding payload supports hierarchical account creation (`parentCode`/resolution flow).
- Keep existing Company bootstrap backward-compatible.

Depends on: PR-F01
Can run parallel with: PR-F02/F03/F04
Unblocks: PR-F06, PR-F11

## PR-F06: Country pack expansion and onboarding binding
Goal:
- Implement `07-SETUPLOGIC` PR-3.

Deliverables:
- Pack metadata includes starter account tree + required mappings.
- Onboarding can preview/apply selected country pack in same transaction.

Depends on: PR-F05
Unblocks: PR-F11, PR-F12

## PR-F07: Approval workflow engine schema + read APIs (`m082`, PR-A1)
Goal:
- Build workflow definition/assignment/runtime data model.

Deliverables:
- Migration `m082_*` (`workflow_definitions`, `workflow_definition_steps`, `workflow_assignments`, `workflow_instances`, `workflow_instance_decisions`).
- Read/setup APIs and validators.

Depends on: PR-F01
Unblocks: PR-F08, PR-F09, PR-F12

## PR-F08: Close/consolidation gating by staged approvals (PR-A2)
Goal:
- Enforce branch->regional->global approval chain.

Deliverables:
- Integrate workflow checks into:
  - `gl.period-closing.routes.js`
  - `consolidation.js`
- Decision endpoints (`approve/reject`) with maker-checker and scope checks.

Depends on: PR-F07
Unblocks: PR-F09, PR-F12

## PR-F09: Workflow UI + readiness integration (PR-A3)
Goal:
- Operational visibility and setup usability for approval chains.

Deliverables:
- UI indicators for pending/current approval step in period close + consolidation pages.
- Setup pages for workflow definitions/assignments.
- Readiness checklist integration.

Depends on: PR-F08
Unblocks: PR-F12

## PR-F10: Country tax engine foundation schema + setup APIs (`m083`, PR-T1)
Goal:
- Create tax regime/code/rule/mapping foundation.

Deliverables:
- Migration `m083_*`:
  - `tax_regimes`, `tax_codes`, `tax_rule_sets`, `tax_account_mappings`
- Tax setup APIs + validators.

Depends on: PR-F01
Can run parallel with: PR-F07/F08
Unblocks: PR-F11, PR-F12

## PR-F11: Tax runtime engine + CARI posting integration (PR-T2)
Goal:
- Put tax rules into posting behavior safely.

Deliverables:
- `tax.engine.service.js` core resolvers/calculators.
- Integrate first with CARI document/settlement posting.
- Explicit setup errors when tax mapping/rules missing.

Depends on: PR-F10, PR-F06
Unblocks: PR-F12

## PR-F12: Canonical consolidation mapping layer + cross-track wiring
Goal:
- Implement `07-SETUPLOGIC` PR-4 and finalize cross-country consolidation consistency.

Deliverables:
- Canonical mapping table(s) (local account -> canonical key -> group account).
- Consolidation run logic updated to use canonical mapping (not same-code coupling).
- Wiring checks:
  - subaccounts (`F03/F04`) remain compatible,
  - approval gate (`F08`) required before finalize,
  - tax-posted lines (`F11`) reconcile in consolidated reports.

Depends on: PR-F06, PR-F08, PR-F11
Critical wiring milestone: yes

## PR-F13: Rollout/backfill/release gate expansion (PR-X1 + hardening)
Goal:
- Make all above safely deployable for existing tenants.

Deliverables:
- Backfill scripts:
  - workflow defaults
  - tax regime/code/account mapping seeds
  - canonical consolidation mapping bootstrap
- Expanded regression/release gate across Cari/Cash/Contracts/Bank/Payroll/Consolidation/Setup.
- Runbook updates for finance/ops rollout sequence.

Depends on: PR-F12

---

## Execution Order (Legacy Section D Recommendation - already normalized in Unified Execution Order above)
1. PR-F01
2. PR-F02
3. PR-F03
4. PR-F05
5. PR-F06
6. PR-F07
7. PR-F08
8. PR-F10
9. PR-F11
10. PR-F04
11. PR-F09
12. PR-F12
13. PR-F13

Notes:
- `F02/F03` and `F05/F06` can progress in parallel teams.
- `F12` is the main convergence PR where most wiring risks appear.
- Keep gating flags ON only for pilot tenants until `F13` completes.





check it again you still summarizing things....
