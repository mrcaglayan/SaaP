# 07 - SETUPLOGIC (Audit + Implementation Plan)

## Execution Tracking
- This is a source/spec file.
- Execution status is tracked only in 11-PROJECT-FOLLOWING-TRACKER.md.

## Scope
This document audits `my-app` against the requested setup logic and defines how to implement the missing parts.

Requested logic summary:
- First setup should start from country selection.
- Show country-relevant chart template.
- Let user choose parent vs subaccount behavior (parent non-postable).
- Allow adding subaccounts in wizard and later in settings.
- Allow custom account definitions (code, name, type, debit/credit nature).
- Support multinational structure (country HQ + branches).
- Branch-level control -> regional control -> top/global approval -> consolidation.
- Consolidate countries with different local account codes into one unified view.
- Country-specific tax/VAT (KDV/vergi) differences.

## Current Coverage Audit

## 1) First login: choose country
Status: PARTIAL

What exists:
- Company onboarding requires `countryIso2` (or `countryId`) per legal entity.
- Legal entities are country-linked and functional-currency-linked.

Gap:
- There is no strict "country-first wizard step" that drives all later setup choices automatically.

## 2) Country-specific account list appears automatically
Status: PARTIAL

What exists:
- Policy pack infrastructure exists (`TR_UNIFORM_V1`, `AF_STARTER_V1`, `US_GAAP_STARTER_V1`).
- GL Setup template wizard filters packs by selected legal entity country and supports preview/apply.

Gap:
- This runs in GL Setup page, not in first onboarding flow.
- Company bootstrap still uses a flat `DEFAULT_ACCOUNTS` fallback unless custom `defaultAccounts` is passed.

## 3) Parent/subaccount selection + parent non-postable behavior
Status: MOSTLY COVERED

What exists:
- `accounts.parent_account_id` supports hierarchy.
- `allow_posting` supported.
- Upsert account logic auto-forces parent accounts to non-postable when children exist.
- Journal posting validates active + postable + leaf account.

Gap:
- Wizard UX for account tree modeling is missing in first onboarding.

## 4) Add subaccounts in setup wizard and later in settings
Status: PARTIAL

What exists:
- Later settings: fully possible in GL Setup (`coaId`, `code`, `name`, `accountType`, `normalSide`, `allowPosting`, `parentAccountId`).

Gap:
- First setup wizard does not model hierarchical account tree (`parentAccountId` not part of onboarding account payload).

## 5) Custom account create (code/name/type/normal side)
Status: COVERED (post-setup), PARTIAL (wizard)

What exists:
- GL Setup supports custom account creation with type and normal side.
- Onboarding `defaultAccounts` accepts account code/name/type/normalSide/allowPosting.

Gap:
- Onboarding account payload cannot define parent-child relations cleanly.

## 6) Multinational model (countries, entities, branches)
Status: COVERED (foundation)

What exists:
- Group company -> legal entities -> operating units (branches/plants/stores/departments).
- Scope-aware RBAC supports TENANT/GROUP/COUNTRY/LEGAL_ENTITY/OPERATING_UNIT.
- Consolidation group + members + runs exist.

Gap:
- Operating unit hierarchy (region -> branch tree) is not explicit; units are flat under legal entity.

## 7) Branch -> regional -> top approval chain before consolidation
Status: PARTIAL / MISSING

What exists:
- Generic approval policy/request engine (mainly bank/payroll-centric usage).
- Multi-scope RBAC can enforce who can see/do actions by OU/entity/country/group.

Gap:
- No explicit workflow engine binding branch/regional/global approval stages to close/consolidation lifecycle.
- Consolidation execution/finalization is permission-based, not staged approval-request-based.

## 8) Consolidate different country CoAs into one unified structure
Status: PARTIAL

What exists:
- Consolidation groups and group CoA mappings exist.
- Consolidation run pipeline, reporting, adjustments, eliminations are implemented.

Gap:
- Current run logic maps local accounts to group accounts by same account `code` in mapped CoAs.
- True cross-country different-code normalization (local code A -> canonical purpose -> group code B) is not fully modeled.

## 9) Country-specific tax/VAT/KDV rules
Status: MISSING (rule engine)

What exists:
- `tax_id` on legal entities and `tax_code` on journal lines.

Gap:
- No country tax rule engine, no VAT/KDV calculation packs, no tax posting policy framework per country.

## Implementation Plan (How to Make It)

## PR-1: Setup Wizard V2 (country-first flow)
Goal:
- Add onboarding steps: Country -> Entity -> CoA template -> Account tree -> Branches.

Changes:
- Frontend wizard stepper in `CompanyOnboardingPage`.
- Once country selected, fetch recommended policy pack and default account tree template.
- Keep manual override path.

## PR-2: Onboarding Account Tree Payload
Goal:
- Enable hierarchical account modeling during first setup.

Changes:
- Extend onboarding payload from flat `defaultAccounts` to tree-compatible rows:
  - `code`, `name`, `accountType`, `normalSide`, `allowPosting`, `parentCode`.
- Backend resolves parent links after insert in deterministic order.
- Enforce parent `allowPosting=false`.

## PR-3: Country Pack Expansion (CoA + rules)
Goal:
- Make country packs first-class onboarding artifacts.

Changes:
- Extend policy pack definitions to include:
  - starter account trees,
  - required parent accounts,
  - required purpose mappings.
- Add API endpoint to apply selected pack during company bootstrap transaction.

## PR-4: Canonical Mapping Layer for Consolidation
Goal:
- Remove same-code dependency across countries.

Changes:
- Add canonical account/purpose mapping table:
  - local account -> canonical key -> group account.
- Update consolidation extraction to use mapping table instead of `group_acc.code = local_acc.code` coupling.
- Provide migration/backfill helpers.

## PR-5: OU Hierarchy + Ownership Model
Goal:
- Support regional oversight explicitly.

Changes:
- Add optional `parent_operating_unit_id` and/or `region_id` model.
- Add manager assignment table for OU/regional/global responsibility.
- Add UI for maintaining hierarchy and managers.

## PR-6: Approval Workflow for Close/Consolidation
Goal:
- Enforce branch -> regional -> global approvals before consolidation finalization.

Changes:
- Introduce approval stages for:
  - period close run,
  - consolidation run execute/finalize.
- Bind stages to scope (OU, legal entity, group) and threshold rules.
- Gate consolidation actions until approval chain is completed.

## PR-7: Country Tax Rule Pack Engine
Goal:
- Handle KDV/VAT/tax differences per country.

Changes:
- Add tax rule definitions by country (rates, account mapping rules, posting behaviors).
- Add tax validation + computation service for supported modules.
- Attach tax rules to policy pack / legal entity config.

## PR-8: UX + Test + Rollout Hardening
Goal:
- Make implementation operable and safe.

Changes:
- Update setup/readiness UI and docs to show missing country/tax/mapping prerequisites.
- Add regression scripts for new wizard flow, consolidation mapping, and approval chain gates.
- Add rollout runbook for existing tenants (backfill mappings and account trees).

## Recommended Delivery Order (Legacy Section B Order - use Unified Execution Order above)
1. PR-1
2. PR-2
3. PR-3
4. PR-4
5. PR-5
6. PR-6
7. PR-7
8. PR-8

## Practical Notes for my-app
- Reuse existing strengths instead of replacing them:
  - policy pack preview/apply,
  - GL account hierarchy enforcement,
  - RBAC scoped permissions,
  - consolidation run pipeline.
- Main architectural gap is orchestration:
  - onboarding should drive country template + hierarchy from day 1,
  - consolidation should rely on explicit canonical mappings and staged approvals.



## Section C - Approval and Tax Engine Blueprint
