# 06 - SUBACCOUNTS Implementation Plan (my-app)

## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Implementation Status Note
- Section A is implemented.
- Literal `102` references in PR-3, PR-5, PR-6, PR-7, and PR-8 are historical source-plan text.
- Current bank-control-parent behavior is defined by `23-BANK-CONTROL-PARENT-PURPOSE-MAPPING.md`: runtime resolution uses `BANK_CONTROL_PARENT`, the neutral provisioning endpoint is `/provision-control-parent-child`, and the deprecated `/provision-102-child` alias was removed on March 11, 2026.

## Audit Summary (Current State)

### What already aligns
- `accounts` model already supports hierarchy via `parent_account_id`, with posting control via `allow_posting`.
- Journal posting already enforces `active + postable + leaf` account usage.
- `bank_accounts` already maps 1:1 to GL account with unique `(tenant_id, legal_entity_id, gl_account_id)`.
- Bank account API/UI already enforce legal entity + active + postable + leaf + ASSET account selection.

### Historical gaps found against target model
- No `bank_accounts.operating_unit_id` exists yet in schema/service/API/UI.
- No explicit enforcement that bank-linked GL account must be under the configured bank control-parent subtree (historically `102` for TDHP-style charts).
- `iban`/`account_no` uniqueness is not enforced at DB level.
- Update flow allows changing key identity fields (e.g. `gl_account_id`, `iban`, `currency`) without "has-postings" guardrails.
- No guided "create bank + auto-create mapped control-parent child account" flow.
- OpenAPI for bank accounts remains generic (`AnyObject`) and does not document strong request/response contract.

## Implementation Principles
- Keep the configured bank control parent as a non-postable control account.
- Each real bank account (IBAN/account no) maps 1:1 to one postable leaf subaccount under the configured bank control parent.
- Operating Unit is optional ownership/reporting dimension only (not identity).
- Do not break existing bank/payments/reconciliation flows; rollout with backward compatibility.

## PR Roadmap

## PR-1: Schema Hardening + OU Ownership (m081)
Goal: Add missing data model fields/constraints safely.

Changes:
- New migration `m081_bank_accounts_subaccount_hardening.js`.
- Add nullable `bank_accounts.operating_unit_id`.
- Add index `(tenant_id, legal_entity_id, operating_unit_id, is_active)`.
- Add FK `(operating_unit_id) -> operating_units(id)`.
- Add uniqueness for IBAN/account identity (choose one policy and apply consistently):
  - Preferred: `UNIQUE (tenant_id, legal_entity_id, iban)` where `iban IS NOT NULL`.
  - Fallback: `UNIQUE (tenant_id, legal_entity_id, account_no)` where IBAN absent.
- Keep existing unique `(tenant_id, legal_entity_id, gl_account_id)`.

Acceptance:
- Migration is idempotent.
- Existing tenants migrate without data loss.
- New OU column is nullable and non-breaking.

## PR-2: Bank Accounts API + Service Support for OU
Goal: End-to-end support for optional OU owner dimension.

Changes:
- Validators:
  - Accept `operatingUnitId` in POST/PUT bodies (optional).
  - Accept `operatingUnitId` in list filter query (optional).
- Service:
  - Persist/read `operating_unit_id`.
  - Join `operating_units` to return `operating_unit_code`, `operating_unit_name`.
  - Validate OU if present:
    - belongs to tenant,
    - ACTIVE,
    - same `legal_entity_id` as bank account.
- Routes/OpenAPI generation contract updated.

Acceptance:
- Create/update/list/get endpoints support OU owner cleanly.
- Cross-entity OU assignment fails with clear 400 error.

## PR-3: Enforce Bank Control-Parent Subtree Policy for Bank GL Link
Goal: Ensure bank accounts only link to valid bank subaccounts.

Changes:
- In bank account GL validation, enforce selected `glAccountId` is descendant/leaf under the configured bank control parent in the same legal entity CoA.
- Add policy fallback strategy:
  - If strict mode enabled and the bank control parent mapping is missing/invalid -> fail with actionable message.
  - If strict mode disabled -> keep current ASSET+leaf checks.
- Optional: attach/reuse `journal purpose mapping` for BANK control parent to avoid hardcoded code assumptions in non-TR packs.

Acceptance:
- Cannot link a bank account to a leaf outside the configured bank control-parent subtree when strict mode is on.
- Existing tenants can opt-in safely.

## PR-4: Bank Identity Immutability After First Posting
Goal: Protect accounting integrity.

Changes:
- Before updating bank account identity fields (`gl_account_id`, `currency_code`, `iban`, `account_no`, optionally `legal_entity_id`), check if account has dependent records:
  - statement lines,
  - payment batches/payment lines,
  - reconciliation references,
  - posted journals through payment/reconciliation flows.
- If used, block direct mutation and require controlled migration path.

Acceptance:
- Mutable before usage, guarded after usage.
- Error messages state why update is blocked and recommended next action.

## PR-5: Auto-Create Bank Control-Parent Child + Bank Account (UX/API)
Goal: Remove manual two-step setup friction.

Changes:
- Add endpoint (or transactional service method) to:
  1) create GL leaf under the configured bank control parent with deterministic code policy,
  2) create `bank_accounts` row linked to that new account,
  3) rollback all on failure.
- Add duplicate-safe child code allocation under the configured control parent (for example `102.001`, `1000.001`).
- Add idempotency key support for safe retries.

Acceptance:
- One-click bank setup works.
- No orphan GL account or bank account on partial failures.

## PR-6: Frontend Bank Accounts UX Upgrade
Goal: Expose new model clearly to end users.

Changes:
- `BankAccountsPage`:
  - Add optional Operating Unit dropdown.
  - Show OU column/label in list.
  - Add optional "Auto-create control-parent child" action in create flow.
  - Improve GL dropdown hints to indicate configured bank control-parent subtree constraints.
- Add list filtering by OU.

Acceptance:
- User can create/edit/list/filter by OU owner.
- UX clearly distinguishes identity (`GL/IBAN`) from ownership (`OU`).

## PR-7: Test Coverage for Subaccounts + OU
Goal: lock behavior and prevent regressions.

Changes:
- Add/extend backend scripts for:
  - OU ownership validations,
  - configured bank control-parent subtree enforcement,
  - immutability after first posting,
  - auto-create transactional rollback.
- Add frontend smoke tests for Bank Accounts form/list updates.

Acceptance:
- Existing release gate scripts remain green.
- New scenarios fail before implementation and pass after.

## PR-8: Documentation + Rollout Runbook
Goal: operationalize safely.

Changes:
- Update user guide sections for bank account setup.
- Add migration/backfill runbook:
  - identify accounts not under the configured bank control parent,
  - remediation strategy,
  - feature-flag rollout order (tenant pilot -> general availability).
- Update architecture docs with "control account + subledger" pattern.

Acceptance:
- Finance/ops teams can execute rollout without engineering intervention.

## Suggested Delivery Order (Legacy Section A Order - use Unified Execution Order above)
1. PR-1
2. PR-2
3. PR-3
4. PR-4
5. PR-6
6. PR-5
7. PR-7
8. PR-8

(Reason: establish schema/validation guardrails first, then UX convenience and rollout artifacts.)

## Notes for This Repo
- Keep migration key sequence continuous after `m080`.
- Preserve backward compatibility for current `bank_accounts` consumers (payments/reconciliation/payroll).
- Avoid changing existing unique constraints unless data audit confirms no collisions.



## Section B - Setup Logic (Audit + Implementation Plan)
