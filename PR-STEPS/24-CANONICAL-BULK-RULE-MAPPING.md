# 24 - CANONICAL BULK RULE MAPPING

## Execution tracking
- This file is both the source/spec file and the execution tracker.
- Keep execution status in the `Master tracker` section below.

## Why this PR set exists
- Current canonical mapping works at exact local-account level only.
- That is correct for runtime safety, but too manual when one local parent has many posting children.
- Real-world consolidation products usually let operators define a rule once and then materialize concrete mappings for many posting accounts.
- SaaP should support that without making execute-time mapping resolution dynamic or ambiguous.

## Current problem summary
- Operators currently need to save many local mappings one by one when multiple posting leaf accounts should roll into one canonical meaning and one group target.
- Parent/header accounts are not valid mapping targets, but operators still need a convenient way to say:
  - "all posting descendants under this parent"
  - or "all leaf accounts with this code prefix"
- Consolidation runtime today expects explicit local-account mappings and explicit group-account mappings.
- That runtime shape is good and should remain unchanged.

## Locked decisions
- Rules are an authoring and bulk-apply tool only.
- Consolidation execute/readiness runtime must continue to rely on explicit rows in:
  - `consolidation_canonical_local_account_mappings`
  - `consolidation_canonical_group_account_mappings`
- Do not introduce runtime wildcard or recursive rule evaluation during execute.
- Only active, postable, leaf accounts are eligible local/group mapping targets.
- Parent/header accounts may be used as a selection root for descendant expansion, but must not themselves be stored as local mapped accounts.
- Parent/header accounts selected for a rule may be shown in UI as context only:
  - selected root
  - selection summary
  - breadcrumb
  but must not appear as a resolved mapped target row.
- One local account still resolves to one canonical key at a time in the current model.
- One canonical key still resolves to one group account at a time in the current model.
- Many local accounts may converge into the same canonical key and same group target.
- Bulk apply must preview the resolved account set before writing anything.
- Bulk apply must not silently overwrite conflicting existing mappings.
- Already aligned rows must be shown separately from actionable rows and must not be re-applied by default.
- High-risk semantic remaps must keep the existing reason/audit requirements.

## Scope
- Add bulk canonical local-mapping authoring using deterministic rules.
- Keep explicit local/group canonical mapping runtime unchanged.
- Support preview, conflict surfacing, and apply from the consolidation setup UI.
- Support reusable saved rules in a second phase.

## Non-goals
- No execute-time wildcard resolution.
- No one-local-account to many-group-account split logic.
- No percentage allocation logic in this PR set.
- No regex rule language in v1.
- No destructive rewrite of existing exact mapping rows.
- No change to the current effective-date overlap protections.

## Recommended rollout shape
- Phase 1:
  - preview and apply deterministic bulk rules
  - materialize explicit local mappings
  - reuse existing explicit group mapping write path
- Phase 2:
  - persist reusable rules
  - re-preview/re-apply later when new matching local accounts appear
  - extend governance visibility

## Unified execution order
1. `PR-CBR01` - backend rule preview foundation
2. `PR-CBR02` - backend bulk apply and conflict controls
3. `PR-CBR03` - consolidation setup UI workbench
4. `PR-CBR04` - persisted saved rules and governance visibility
5. `PR-CBR05` - rollout hardening, tests, and docs

## Master tracker
- [x] `PR-CBR01` acceptance: preview can expand descendant/prefix rules into concrete active postable leaf local accounts without writing mappings.
  smoke: `backend/scripts/test-consolidation-cbr01-rule-preview.js`
- [x] `PR-CBR02` acceptance: bulk apply materializes explicit local mappings, preserves current runtime behavior, and blocks conflicts/high-risk remaps without required reason.
  smoke: `backend/scripts/test-consolidation-cbr02-bulk-apply.js`
- [x] `PR-CBR03` acceptance: consolidation setup UI exposes a guided bulk-rule workflow with preview/apply, edit actions for existing mappings, and clear `selection root vs mapped leaf` semantics.
  smoke: `backend/scripts/test-consolidation-cbr03-frontend-smoke.js`
- [x] `PR-CBR04` acceptance: saved rules can be created, listed, deactivated, re-previewed, and reapplied for newly matching local accounts while runtime still reads explicit mappings.
  smoke: `backend/scripts/test-consolidation-cbr04-saved-rules.js`
- [x] `PR-CBR05` acceptance: regression scripts, runbook guidance, and rollout notes are present and existing explicit canonical mapping flows remain green.
  smoke: `backend/scripts/test-consolidation-cbr05-regression.js`
- [x] `PR-CBR06` follow-up hardening: same-key inactive local mappings are reactivatable through bulk rules, governance review evaluates the full active saved-rule set, saved-rule quick apply reuses the effective-date safety guard, and the governance snapshot query is runtime-verified.
  regression: `backend/scripts/test-consolidation-cbr06-followup-regressions.js`

## PR-CBR01
Goal:
- Add a deterministic backend preview path that expands a rule into concrete postable leaf accounts without changing execute-time mapping behavior.

Deliverables:
- Add a new bulk-rule preview service in `backend/src/services/consolidation.canonical-mappings.service.js`.
- Support these rule types in v1:
  - `DESCENDANTS_OF_ACCOUNT`
  - `CODE_PREFIX`
- Resolve only active postable leaf local accounts.
- Return preview rows grouped by:
  - matched accounts
  - already-aligned accounts
  - conflicting existing mappings
  - semantic warnings against the chosen group account, when provided
- For descendant rules, include the selected parent/root account only as preview context metadata, not as a resolved target row.
- Reuse existing canonical-key and semantic-warning logic where possible.
- Add preview endpoint in `backend/src/routes/consolidation.js`:
  - `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/preview`

Suggested request shape:
- `legalEntityId`
- `ruleType`
- `parentLocalAccountId` for `DESCENDANTS_OF_ACCOUNT`
- `codePrefix` for `CODE_PREFIX`
- `canonicalKey`
- `canonicalName`
- `groupAccountId` optional
- `effectiveFrom`
- `effectiveTo`

Files:
- `backend/src/services/consolidation.canonical-mappings.service.js`
- `backend/src/routes/consolidation.js`

Acceptance:
- Preview returns only active postable leaf local accounts.
- Preview never includes parent/header accounts as resolved targets.
- Preview may show the selected parent/root account as context only.
- Preview flags conflicts instead of hiding them.
- Preview works without writing mappings.

Notes:
- No DB migration is required for `PR-CBR01`.
- This PR should stay backend-first.

## PR-CBR02
Goal:
- Apply a previewed bulk rule by materializing normal explicit canonical mapping rows while preserving current safety rules.

Deliverables:
- Add bulk-apply service path in `backend/src/services/consolidation.canonical-mappings.service.js`.
- Add apply endpoint in `backend/src/routes/consolidation.js`:
  - `POST /api/v1/consolidation/groups/:groupId/canonical-mappings/rules/apply`
- For each resolved local posting account:
  - call `upsertLocalAccountCanonicalMapping(...)`
- If `groupAccountId` is provided:
  - call `upsertGroupAccountCanonicalMapping(...)` once for the canonical key, or validate existing alignment
- Reject apply when:
  - preview contains conflicts and no explicit override model exists
  - selected local accounts are not postable leaf accounts
  - semantic remap is high-risk and no reason is provided
- Return an apply summary:
  - `createdLocalMappings`
  - `updatedLocalMappings`
  - `skippedAlreadyAligned`
  - `conflictCount`
  - `groupMappingAction`

Files:
- `backend/src/services/consolidation.canonical-mappings.service.js`
- `backend/src/routes/consolidation.js`

Acceptance:
- Bulk apply writes normal explicit local mapping rows.
- Existing execute/readiness flows continue to work without understanding rules.
- Conflicts are blocked, not silently overwritten.
- Existing exact local/group manual mapping endpoints remain unchanged.

Notes:
- This PR completes the backend MVP.

## PR-CBR03
Goal:
- Add a guided bulk mapping workbench to the consolidation setup page.

Deliverables:
- Add a new `Bulk Canonical Mapping` card to `frontend/src/pages/settings/ConsolidationSetupPage.jsx`.
- Inputs:
  - legal entity
  - rule type
  - parent local account or code prefix
  - canonical key
  - canonical name
  - group account optional
  - effective dates
  - reason
- Add preview and apply actions calling the new backend endpoints.
- Show preview result buckets:
  - matched leaves
  - already aligned
  - conflicts
  - semantic warnings
- Exclude `already aligned` rows from default apply selection.
- Add an `Edit` action next to existing canonical mapping list rows:
  - prefill the manual local/group mapping forms or open an inline edit state
  - allow changing canonical key, target group account, status, and effective dates using the existing guarded write paths
  - keep audit/reason rules for risky remaps
- Reuse current combobox/postable-leaf filtering behavior.
- Add inline operator guidance:
  - parent account is only a selection root
  - mappings are created for posting child accounts
  - many local accounts may map into one group target

Files:
- `frontend/src/pages/settings/ConsolidationSetupPage.jsx`
- `frontend/src/api/consolidationAdmin.js`
- `frontend/src/i18n/messages.js`

Acceptance:
- Operator can bulk-map descendants/prefix-matched leaf accounts from the setup page.
- UI clearly distinguishes selection root vs actual mapped leaf accounts.
- No parent/header account can be selected as a final local mapping target.
- Existing mapping rows can be edited from the list without re-entering everything from scratch.
- Already mapped rows remain visible, but clearly shown as aligned/non-actionable unless the user explicitly edits them.

Notes:
- Do not remove existing manual local/group mapping forms.
- Bulk workbench is additive.

## PR-CBR04
Goal:
- Persist reusable rules so operators can rerun them when new matching local accounts appear later.

Deliverables:
- Add migration for saved rules:
  - `consolidation_canonical_mapping_rules`
- Suggested columns:
  - `id`
  - `tenant_id`
  - `consolidation_group_id`
  - `legal_entity_id`
  - `rule_type`
  - `parent_local_account_id` nullable
  - `code_prefix` nullable
  - `canonical_key_id`
  - `group_account_id` nullable
  - `status`
  - `effective_from`
  - `effective_to`
  - `reason`
  - `created_by_user_id`
  - timestamps
- Add read/create/deactivate endpoints for saved rules.
- Add rerun-preview and rerun-apply support for saved rules.
- Extend governance/review output so operators can see:
  - exact mappings
  - rule-backed coverage source
  - unresolved accounts outside saved rule coverage

Files:
- `backend/src/migrations/<new migration>.js`
- `backend/src/migrations/index.js`
- `backend/src/services/consolidation.canonical-mappings.service.js`
- `backend/src/routes/consolidation.js`
- `frontend/src/pages/settings/ConsolidationSetupPage.jsx`

Acceptance:
- Operators can save a rule and reuse it later.
- New matching leaf accounts can be previewed/applied without redefining the rule from scratch.
- Saved rules do not change runtime mapping behavior directly; explicit rows still drive execute.

Notes:
- Keep v1 saved-rule set limited to `DESCENDANTS_OF_ACCOUNT` and `CODE_PREFIX`.

## PR-CBR05
Goal:
- Finish rollout hardening, regression coverage, and operator docs for bulk canonical mapping.

Deliverables:
- Add backend regression scripts for:
  - descendant preview
  - prefix preview
  - conflict blocking
  - high-risk remap reason enforcement
  - saved-rule rerun behavior
- Add frontend smoke coverage for the new setup card.
- Add runbook/docs updates:
  - operator guidance
  - when to use bulk rules vs manual mapping
  - examples:
    - `120.* -> AR_TRADE`
    - descendants of `320` -> `AP_TRADE`
- Add rollout notes for existing tenants:
  - no migration of current explicit mappings required
  - bulk rules are additive

Suggested smoke scripts:
- `backend/scripts/test-consolidation-cbr01-rule-preview.js`
- `backend/scripts/test-consolidation-cbr02-bulk-apply.js`
- `backend/scripts/test-consolidation-cbr04-saved-rules.js`
- `backend/scripts/test-consolidation-cbr05-regression.js`

Files:
- `backend/scripts/*`
- `backend/package.json`
- `docs/runbooks/consolidation-canonical-preflight.md`
- `PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md`

Acceptance:
- Bulk-rule flow has regression coverage.
- Operator documentation exists.
- Existing explicit canonical mapping flows remain green.

## PR-CBR06
Goal:
- Close the post-implementation gaps found during the PR24 review without changing the runtime model.

Deliverables:
- Treat same-key inactive local mappings as bulk-rule reactivation candidates instead of hard conflicts.
- Evaluate all active saved rules in governance saved-rule coverage reporting; do not silently cap at 50.
- Reuse the unresolved-run effective-date safety guard when applying a saved rule directly from the UI.
- Add a DB-backed regression that exercises:
  - inactive local mapping reactivation through bulk rule apply
  - governance saved-rule coverage beyond 50 active rules
  - governance snapshot query runtime execution

Files:
- `backend/src/services/consolidation.canonical-mappings.service.js`
- `frontend/src/pages/settings/ConsolidationSetupPage.jsx`
- `backend/scripts/test-consolidation-cbr06-followup-regressions.js`
- `backend/scripts/test-consolidation-prcm04-effective-date-safety.js`
- `backend/package.json`
- `docs/runbooks/consolidation-canonical-preflight.md`

Acceptance:
- Bulk preview/apply can reactivate a same-key inactive local mapping using the existing guarded upsert path.
- Governance review saved-rule coverage is not truncated below the active rule set.
- Saved-rule quick apply is blocked when its `effectiveFrom` would miss unresolved run period-end coverage.
- A real DB-backed regression covers the follow-up behavior.

## Example target workflow
- Local chart:
  - `120` parent
  - `120.01`
  - `120.02`
  - `120.03`
- Operator selects:
  - `legalEntityId = LE_AFG`
  - `ruleType = DESCENDANTS_OF_ACCOUNT`
  - `parentLocalAccountId = 120`
  - `canonicalKey = AR_TRADE`
  - `groupAccountId = Group 120`
- Preview resolves:
  - `120.01`
  - `120.02`
  - `120.03`
- Apply creates:
  - `120.01 -> AR_TRADE`
  - `120.02 -> AR_TRADE`
  - `120.03 -> AR_TRADE`
  - `AR_TRADE -> Group 120`

Result:
- many local posting children
- one canonical meaning
- one group reporting target
- no need to create one group subaccount per child

## Linear execution tracker

| # | Next | Status | Work Item (exact execution step) | Source Step Ref | Read Command (PowerShell) | Depends On | Evidence |
|---|---|---|---|---|---|---|---|
| 1 |  | DONE | Add backend bulk-rule preview foundation for `DESCENDANTS_OF_ACCOUNT` and `CODE_PREFIX`, resolving only active postable leaf local accounts. | `24-CANONICAL-BULK-RULE-MAPPING.md` -> `PR-CBR01` | `Get-Content -Raw 'PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md'` | - | `node --check backend/src/services/consolidation.canonical-mappings.service.js`; `node --check backend/src/routes/consolidation.js`; `node backend/scripts/test-consolidation-cbr01-rule-preview.js` |
| 2 |  | DONE | Add backend bulk apply endpoint/service that materializes explicit local mappings and reuses/validates the group mapping for the canonical key. | `24-CANONICAL-BULK-RULE-MAPPING.md` -> `PR-CBR02` | `Get-Content -Raw 'PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md'` | #1 | `node --check backend/src/services/consolidation.canonical-mappings.service.js`; `node --check backend/src/routes/consolidation.js`; `node backend/scripts/test-consolidation-cbr02-bulk-apply.js`; `npm run test:ux:consolidation-cbr02` |
| 3 |  | DONE | Add `Bulk Canonical Mapping` UI workbench in consolidation setup with preview/apply flow, edit actions for existing mappings, and operator guidance. | `24-CANONICAL-BULK-RULE-MAPPING.md` -> `PR-CBR03` | `Get-Content -Raw 'PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md'` | #1, #2 | `node backend/scripts/test-consolidation-cbr03-frontend-smoke.js`; `npm run test:ux:consolidation-cbr03`; `cd frontend && npm run build` |
| 4 |  | DONE | Add persisted saved rules schema/API/UI and governance visibility for rerun-preview and rerun-apply flows. | `24-CANONICAL-BULK-RULE-MAPPING.md` -> `PR-CBR04` | `Get-Content -Raw 'PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md'` | #3 | `node --check backend/src/migrations/m114_consolidation_canonical_saved_rules.js`; `node --check backend/src/services/consolidation.canonical-mappings.service.js`; `node --check backend/src/routes/consolidation.js`; `npm run db:migrate`; `npm run test:ux:consolidation-cbr04`; `cd frontend && npm run build` |
| 5 |  | DONE | Add regression coverage, rollout docs, and operator runbook updates for bulk-rule canonical mapping. | `24-CANONICAL-BULK-RULE-MAPPING.md` -> `PR-CBR05` | `Get-Content -Raw 'PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md'` | #4 | `npm run test:ux:consolidation-cbr01`; `npm run test:ux:consolidation-cbr02`; `npm run test:ux:consolidation-cbr03`; `npm run test:ux:consolidation-cbr04`; `npm run test:ux:consolidation-cbr05`; `npm run test:ux:consolidation-prcm02`; `npm run test:ux:consolidation-prcm03` |

## Suggested validation commands
- `node --check backend/src/services/consolidation.canonical-mappings.service.js`
- `node --check backend/src/routes/consolidation.js`
- `cd frontend && npm run build`
- `git diff -- backend/src/services/consolidation.canonical-mappings.service.js backend/src/routes/consolidation.js frontend/src/pages/settings/ConsolidationSetupPage.jsx`

## Step code checks (mandatory)
- `#1` Files: `backend/src/services/consolidation.canonical-mappings.service.js`, `backend/src/routes/consolidation.js`
  Command: `rg -n "DESCENDANTS_OF_ACCOUNT|CODE_PREFIX|rules/preview|postable|leaf|canonical" backend/src -S`
- `#2` Files: `backend/src/services/consolidation.canonical-mappings.service.js`, `backend/src/routes/consolidation.js`
  Command: `rg -n "rules/apply|upsertLocalAccountCanonicalMapping|upsertGroupAccountCanonicalMapping|conflict|high-risk|reason" backend/src -S`
- `#3` Files: `frontend/src/pages/settings/ConsolidationSetupPage.jsx`, `frontend/src/api/consolidationAdmin.js`, `frontend/src/i18n/messages.js`
  Command: `rg -n "Bulk Canonical Mapping|rules/preview|rules/apply|DESCENDANTS_OF_ACCOUNT|CODE_PREFIX|Edit" frontend/src -S`
- `#4` Files: migration, consolidation routes/services, consolidation setup page
  Command: `rg -n "consolidation_canonical_mapping_rules|saved rules|re-preview|re-apply|governance" backend/src frontend/src -S`
- `#5` Files: backend scripts, package scripts, runbook/docs
  Command: `rg -n "test-consolidation-cbr|bulk-rule|canonical-preflight|AR_TRADE|AP_TRADE" backend scripts docs PR-STEPS -S`
