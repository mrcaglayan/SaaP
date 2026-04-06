# Country-Scoped Workflow Assignments and AP Document Approval Roadmap

## Status
- Planned
- Repo-checked against current project snapshot
- Locked decision: `COUNTRY` is a real cross-entity business scope and must become a first-class workflow assignment scope
- Locked decision: AP/CARI approval must use the existing workflow-governance engine, not a second parallel approval system
- Locked decision: steady-state design must not depend on legacy `CountryController`
- Locked decision: first rollout governs AP documents only; AR and other direct CARI flows keep their current `DRAFT -> POSTED` behavior unless later expanded deliberately
- Locked decision: PR-4 (permission codes + role split) runs **before** PR-2 and PR-3 so the new AP routes can enforce correct permissions from day one (no regression window on `cari.doc.update`/`cari.doc.post` gating the new submit/post paths)
- Locked decision: CARI country-scoped visibility stays in PR-5, but PR-4 role provisioning and `CountryAPApprover` / `CountryAPPoster` rollout must NOT ship to production until PR-5 visibility has merged; otherwise country approvers cannot see the documents they are assigned to
- Locked decision: `return_reason` is a first-class required field captured on every return action (required on the domain `return` path and on workflow-engine REJECTED decisions that map to RETURNED); stored on `cari_documents` and surfaced on GET
- Locked decision: approve / return / review are pure **workflow decisions**, authorized by workflow step assignment alone; no `cari.doc.approve`, `cari.doc.review`, or `cari.doc.return` CARI-side permission codes exist. CARI-side permissions are limited to `create`, `update`, `submit`, `post`, `reverse`, `cancel`
- Locked decision: `legal_entities.country_id` becomes NOT NULL (backfilled in PR-1 migration); country-scoped assignment resolution requires every LE to have a country
- Locked decision: governed-AP applicability is driven by a **per-doc-class `is_workflow_governed` flag** on the AP doc-class/type metadata. Supplier invoices always governed, petty cash adjustments always direct-post, etc. Both backend and frontend read the same flag via a shared helper; no duplicated allow-lists.
- Locked decision: compat-mode scope follows **two-flag Option B** — `FEATURE_AP_DOCUMENT_WORKFLOW_V1` (per tenant: "governed lifecycle available") + `ap_workflow_compat_mode` (per tenant: if ON, an in-scope governed AP doc whose workflow assignment resolution returns empty may still legacy-post; if OFF, absence of assignment blocks posting). Doc classes with `is_workflow_governed = false` are never affected by compat_mode — they always direct-post.
- Locked decision: workflow-instance lifecycle on return / resubmit / cancel:
  - **3a (return from APPROVED):** void the existing workflow instance (mark SUPERSEDED). Approvals are immutable.
  - **3b (resubmit from RETURNED):** create a brand-new workflow instance per submit. Each approval attempt is a distinct instance with its own SLA/escalation timer.
  - **3c (cancel from RETURNED after the doc was once APPROVED):** cancel cascades — any still-open workflow instance is auto-closed with outcome `cancelled_by_document_owner`.
  - **3d (workflow-engine REJECTED):** REJECTED decisions (manual or escalation-driven) map to the doc's `RETURNED` status; the workflow decision comment is copied into `return_reason`. No REJECTED status on the AP doc enum.

---

## Purpose

Implement the business flow below without collapsing legal-entity review and country-level final governance into one role:

1. `BranchOperator` creates the AP draft
2. legal-entity AP accountant / `afmuhasebe` reviews, corrects, and submits the AP document
3. country-level reviewer / controller approves the governed AP workflow
4. country-level poster performs the final post so the document is ready for close / consolidation governance

This roadmap covers two linked architecture changes:

1. add `COUNTRY` to workflow assignment and workflow step resolution
2. add a real AP document review lifecycle to CARI and connect it to workflow governance

---

## Current Repo Seams Confirmed

### Workflow governance
- `backend/src/migrations/m082_close_consolidation_workflow_approvals.js`
- `backend/src/migrations/m156_local_close_packs.js`
- `backend/src/migrations/m166_workflow_generic_bridge.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/services/approval.delegation.service.js`
- `backend/src/services/approval.escalation.service.js`
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/api/workflows.js`
- `docs/templates/tam-kapsam-finans-workflow-setup.json`

### CARI / AP lifecycle
- `backend/src/migrations/m017_cari_schema_foundation.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/routes/cari.document.validators.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.report.service.js`
- `frontend/src/lifecycle/lifecycleRules.js`
- `frontend/src/api/cariDocuments.js`
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/cariDocumentsPageHelpers.js`
- `frontend/src/pages/cari/hooks/useCariDocumentPostReverseController.js`

### Roles / onboarding / visibility context
- `backend/src/seedCore.js`
- `backend/src/services/roleMigration.service.js`
- `backend/src/routes/onboarding.js`
- `backend/src/services/authz.scope.service.js`
- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/api/orgAdmin.js`

### Existing smoke / release-gate seams to extend
- `backend/scripts/test-workflows-pr3e-unified-migration.js`
- `backend/scripts/test-cari-pr05-draft-documents-and-payment-term-lookup.js`
- `backend/scripts/test-cari-pr06-posting-engine-and-gl-integration.js`

---

## Current-State Findings

### Conflict / plan gap
- `COUNTRY` already exists in RBAC / scope-assignment surfaces, but workflow-governance resolution still does not support it.
- Workflow assignments currently support tenant fallback plus `GROUP`, `LEGAL_ENTITY`, and `OPERATING_UNIT`, but not `COUNTRY`.
- Workflow step definitions currently allow `OPERATING_UNIT`, `LEGAL_ENTITY`, and `GROUP`, but not `COUNTRY`.
- Workflow runtime scope resolution currently knows `TARGET_OPERATING_UNIT`, `TARGET_LEGAL_ENTITY`, and `TARGET_GROUP`, but not country scope.
- Workflow generic-approval bridge support must also be extended; this is not only a `workflows.service.js` change.
- Workflow setup UI and API currently only expose tenant, group, legal entity, and operating unit assignment targets.
- CARI documents currently do not support `SUBMITTED`, `RETURNED`, or `APPROVED` as first-class business states.
- CARI routes currently expose create, update, cancel, post, and reverse only; there is no real AP submit / governed return path yet.
- CARI permission model currently has `cari.doc.create`, `cari.doc.update`, `cari.doc.post`, and `cari.doc.reverse`, but not separated submit / review / approve / return permissions.
- Existing composable AP role `APDocumentPoster` collapses legal-entity review and posting into one role.
- The current composable replacement for legacy `CountryController` does not include AP-document final approval / posting authority.
- CARI document visibility currently maps only `LEGAL_ENTITY` and `OPERATING_UNIT`, so country-scoped AP actors would not reliably see the documents they govern.
- Several accounting / reporting queries currently exclude only `DRAFT` and `CANCELLED`, which would leak `SUBMITTED`, `RETURNED`, and `APPROVED` into accounting-facing surfaces unless corrected.
- Some linked-flow guards still assume CARI documents are only `DRAFT` or `POSTED`, so governed AP status expansion needs an intentional guard review.

### Deferred item already covered
- Close / consolidation workflow governance is already mature enough to reuse as the implementation pattern.
- Local close already demonstrates the right "return for correction" business-object pattern; AP should reuse that pattern instead of inventing a different rejection vocabulary.

### Optional hardening
- Extend activation-readiness and onboarding checks later so entity / country setup warns when required AP workflow assignments are missing.
- Add richer AP status-history / audit projections later if the first pass only stores transition timestamps and relies on audit logs for detail.

---

## Locked Design Choices

### Workflow scope precedence
Use this precedence for assignment resolution:

`OPERATING_UNIT > LEGAL_ENTITY > COUNTRY > GROUP > TENANT`

Reason:
- country is more specific than group
- country is less specific than one legal entity
- this preserves existing specific-to-broad fallback behavior

### Precedence vs process design
- The precedence above is the engine fallback order, not a first-pass tenant-by-tenant configuration surface.
- Actual business variation comes from:
  - which AP permissions are assigned to branch / entity / country roles
  - which workflow steps exist in the chosen AP definition
  - which scope level the AP workflow definition is assigned to
- If one process should behave like `OPERATING_UNIT > LEGAL_ENTITY > GROUP > TENANT`, that can still be achieved by not using country-scoped assignments for that process.
- In other words: `COUNTRY` exists in the engine, but a given AP rollout can choose whether to use it or not.

### AP document status model
Recommended first-class CARI/AP business statuses:

- `DRAFT`
- `SUBMITTED`
- `RETURNED`
- `APPROVED`
- `POSTED`
- `PARTIALLY_SETTLED`
- `SETTLED`
- `CANCELLED`
- `REVERSED`

### Status rollout scope
- `SUBMITTED`, `RETURNED`, and `APPROVED` are introduced on the shared `cari_documents.status` enum
- but business use is AP-only in V1
- AR and other non-governed CARI flows continue to behave as direct `DRAFT -> POSTED` unless later expanded deliberately

### Governed AP applicability rule
- V1 governed lifecycle is controlled by a **per-doc-class `is_workflow_governed` boolean flag** on the AP doc-class / doc-type metadata row.
- Hard constraints (enforced at the flag-authoring layer):
  - a doc class with `direction = 'AP'` may have `is_workflow_governed` true or false
  - a doc class with `direction = 'AR'` must have `is_workflow_governed = false` (AR governance is not in V1)
- Backend and frontend both read this flag through one shared helper (e.g. `isDocClassWorkflowGoverned(docClass)`); no separate allow-lists, no duplicated predicates.
- The flag is evaluated at: submit-route enablement, post-gate evaluation, workflow-instance creation, and all frontend action-visibility checks.
- Initial suggested V1 flag values (to be confirmed by finance at rollout time):
  - supplier invoices: governed
  - credit notes against supplier invoices: governed
  - AP accruals: governed
  - petty cash / expense adjustments: not governed (legacy direct-post)
  - all AR doc classes: not governed
- PR-2 introduces the column and the shared helper; PR-3 consumes the same helper for workflow-instance and gate decisions. No drift possible.

### AP transition model
Recommended business transitions:

- `submit`: `DRAFT` or `RETURNED` -> `SUBMITTED`
- `return`: `SUBMITTED` or `APPROVED` -> `RETURNED`
- `approve`: `SUBMITTED` -> `APPROVED`
- `post`: `APPROVED` -> `POSTED`
- `post`: `DRAFT` -> `POSTED` only when workflow is not required and compatibility mode explicitly allows legacy AP posting
- `cancel`: `DRAFT` or `RETURNED` -> `CANCELLED`
- `reverse`: `POSTED` -> `REVERSED`

### Reject vs return
- Use `RETURNED` on the AP document business object
- Keep `REJECTED` as a workflow-engine decision / request outcome if needed internally
- Do not add `REJECTED` to the AP document enum in the first pass unless there is a real terminal business case that forbids resubmission of the same document

### Recommended workflow enums
Recommended new workflow-governance identifiers:

- `processType`: `AP_DOCUMENT_POSTING`
- `targetType`: `CARI_DOCUMENT`

First rollout should gate AP documents only.
If CARI later needs separate AR governance, add that as a later process type rather than overloading the first AP rollout.

### Country step resolution mode
- Add explicit workflow / generic-approval support for `TARGET_COUNTRY`
- Do not fake country approval through group or legal-entity scope

### Role split target
- `BranchOperator`: create / update / cancel draft AP documents only
- `EntityAPController` or equivalent: read / update / submit at legal-entity scope (returning a submitted document is a workflow decision on the assigned step — this role gets workflow-step assignment on the LE step where applicable, not a CARI return permission)
- `CountryAPApprover`: read at country scope + workflow-step assignment on the country approval step (approve / return are workflow decisions, not CARI permissions)
- `CountryAPPoster`: read / post / reverse at country scope

Rollout note:
- for pilot speed, `CountryAPApprover` and `CountryAPPoster` may be assigned to the same user set at first
- permissions must still stay split so separation of duties can be tightened later without another schema redesign
- default `BranchOperator` does not include submit
- if a tenant wants direct branch-to-country handoff, `cari.doc.submit` must be granted as an explicit tenant-specific override, not treated as the default branch role shape

---

## Default Pilot Workflow Shape

Default tenant template for the business flow discussed so far:

1. branch creates draft outside workflow
2. legal-entity AP controller reviews and submits the document into governed review
3. workflow step 1 resolves at `COUNTRY` scope with country-level approval authority
4. after approval, country-level poster posts the document

Why this pilot shape first:
- it matches the user-stated operational flow most closely
- it keeps workflow complexity lower than a two-step AP review on day one
- it still preserves the legal-entity vs country separation in role design

Optional stricter template after pilot:

1. workflow step 1: `LEGAL_ENTITY`
2. workflow step 2: `COUNTRY`
3. posting after final approval

That stricter template becomes possible once AP/CARI is fully integrated into workflow governance.

---

## Supported AP Flow Variants

These examples are intended to be explicitly supported by the target design after PR-1 through PR-4 land.

### Variant A - Branch drafts, country final-posts
Business shape:

1. `BranchOperator` creates the AP draft
2. country-level AP authority performs the final approve / post path

Recommended implementation shape:
- default `BranchOperator`: `create`, `update`
- optional tenant-specific override: add `submit` only for tenants that intentionally want direct branch-to-country handoff
- AP workflow definition: one `COUNTRY` review step, or a direct operational submit into country review
- country role: `approve` and `post`

Use case:
- entities where local branch users prepare the draft, but country finance owns the full final accounting decision

### Variant B - Entity accountant drafts, country final-posts
Business shape:

1. no branch draft owner is involved
2. legal-entity accountant creates the draft
3. country-level AP authority performs the final approve / post path

Recommended implementation shape:
- legal-entity AP controller: `create`, `update`, `submit`
- AP workflow definition: one `COUNTRY` review step
- country role: `approve` and `post`

Use case:
- countries or entities that do not use the branch-drafter operating model

### Variant C - Branch drafts, entity accountant submits, country final-posts
Business shape:

1. `BranchOperator` creates the AP draft
2. legal-entity accountant reviews / controls / submits
3. country-level AP authority performs the final approve / post path

Recommended implementation shape:
- `BranchOperator`: `create`, `update`
- legal-entity AP controller: `read`, `update`, `submit` (return authority comes from workflow-step assignment, not a CARI permission)
- country role: `post` (approve/return authority comes from workflow-step assignment on the country step)

This can be modeled in two valid ways:
- operational handoff model:
  - branch creates draft
  - entity accountant reviews and submits
  - workflow definition contains one `COUNTRY` step
- stricter governed model:
  - workflow step 1 = `LEGAL_ENTITY`
  - workflow step 2 = `COUNTRY`
  - posting happens only after the final country approval

Use case:
- entities where legal-entity accounting control must remain visible before country-level final governance

### Mixed rollout is allowed
The target design should allow these variants to coexist:

- one country can have a default AP workflow definition assigned at `COUNTRY` scope
- one legal entity inside that country can override it with a stricter `LEGAL_ENTITY` assignment
- one operating unit can override both with an `OPERATING_UNIT` assignment if needed

Example:
- Country A default: `Entity accountant -> Country final post`
- Legal Entity X override: `Branch -> Entity -> Country`
- Legal Entity Y in the same country: `Entity only -> Country`

### Important implementation note
- The system should support these flow variants through workflow definitions, assignments, and role design.
- The steady-state design should not depend on the legacy `CountryController` role code itself.
- Legacy labels may appear during migration, but the replacement should be explicit country-scoped AP roles.

---

# PR-1 - Add COUNTRY to Workflow Governance Foundation

## Goal
Make `COUNTRY` a first-class workflow assignment scope and workflow decision scope without breaking existing period-close, local-close, consolidation, or the generic-approval bridge.

## Files
### Backend
- new additive workflow migration after the current latest workflow migrations
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/services/approval.delegation.service.js`
- `backend/src/services/approval.escalation.service.js`
- `backend/scripts/generate-openapi.js`
- generated `backend/openapi.yaml`

### Frontend
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/api/orgAdmin.js` using existing `listCountries()` only
- `frontend/src/api/workflows.js`
- `frontend/src/i18n/messages.js`

### Docs
- `docs/templates/tam-kapsam-finans-workflow-setup.json`

## Backend changes
- Make `legal_entities.country_id` NOT NULL: migration must detect rows with null `country_id`, fail loudly if any are found in staging/prod seed data, and require the owning tenant to set a country on every legal entity before the migration runs. No silent fallback country is set. Activation-readiness surface must refuse to enable AP-workflow features until every LE has a country.
- Add `COUNTRY` to workflow step `stage_scope_type`.
- Add `country_id` to `workflow_assignments`.
- Add indexes and foreign keys so `country_id` can be resolved and filtered efficiently.
- Extend workflow assignment validation to accept `countryId`.
- Extend workflow step validation to accept `COUNTRY`.
- Enforce one-row-one-scope invariant for workflow assignments:
  - tenant fallback with no specific scope target, or exactly one of `groupCompanyId`, `countryId`, `legalEntityId`, `operatingUnitId`
  - reject ambiguous rows that try to set more than one assignment target
- Extend assignment-scope resolution and precedence logic to use `COUNTRY`.
- Extend workflow runtime target-scope projection so targets can carry `target_country_id`.
- Document the derivation path explicitly: for CARI/AP targets, `target_country_id` is derived from `legal_entities.country_id` of the document's owning legal entity. Other governed target types (close pack, consolidation, etc.) derive country from their own owning legal entity in the same way.
- Add `TARGET_COUNTRY` to workflow / generic-approval scope-resolution mapping.
- Extend unified workflow bridge logic so current-step access can resolve `TARGET_COUNTRY`.
- Do this with new additive migrations; do not rewrite old shipped migration files like `m082`, `m156`, or `m166` in place.
- Update OpenAPI and any workflow release-gate coverage in the same PR, not later at rollout time.

## Frontend changes
- Add `COUNTRY` to assignment scope selection in workflow setup UI.
- Load country options with existing `listCountries()`.
- Update assignment forms, tables, and filters so country-scoped workflow assignments are visible and editable.
- Update step JSON examples and any helper copy to show `COUNTRY` as a valid stage scope type.

## Acceptance
- A workflow assignment can be created at country scope from the UI and API.
- Workflow steps can use `COUNTRY` as `stageScopeType`.
- Assignment resolution uses `OPERATING_UNIT > LEGAL_ENTITY > COUNTRY > GROUP > TENANT`.
- Existing period close, local close, and consolidation flows continue to resolve correctly when no country-scoped assignment exists.

## Smoke checks
- create one tenant fallback assignment and confirm it still applies
- create one country-scoped assignment and confirm it overrides group / tenant fallback for entities in that country
- create one legal-entity-scoped assignment and confirm it overrides the country assignment for that entity only
- confirm ambiguous assignment rows are rejected when more than one scope target is provided
- confirm the workflow / generic-approval bridge resolves a country-scoped step to `TARGET_COUNTRY`
- review an existing local-close pack and confirm approval gating still works unchanged
- assert no in-flight workflow instance uses a `COUNTRY` step at PR-1 merge time (trivially true day-one, makes the additive-migration claim provable)

---

# PR-2 - Add Real AP Review States to CARI Documents

## Goal
Expand the AP/CARI document lifecycle so the document can be submitted, returned, approved, and then posted.

## Files
### Backend
- new additive migration after `backend/src/migrations/m017_cari_schema_foundation.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/routes/cari.document.validators.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.report.service.js`
- `backend/scripts/generate-openapi.js`
- generated `backend/openapi.yaml`

### Frontend
- `frontend/src/lifecycle/lifecycleRules.js`
- `frontend/src/api/cariDocuments.js`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `frontend/src/pages/cari/cariDocumentsPageHelpers.js`
- `frontend/src/pages/cari/hooks/useCariDocumentPostReverseController.js`
- `frontend/src/pages/cari/CariDocumentsPage.jsx`

## Backend changes
- Add `SUBMITTED`, `RETURNED`, and `APPROVED` to the CARI document status enum.
- Add a first-class `return_reason` (text) column on `cari_documents`, populated on every transition into `RETURNED`. Required on the domain return path. When a workflow-engine REJECTED decision is translated to `RETURNED`, the workflow decision comment is copied into `return_reason` (reject without a comment is itself rejected at the workflow-decision validator level). Null `return_reason` is disallowed whenever `status = 'RETURNED'`.
- Surface `return_reason` and `returned_at` on the document GET response so the workbench can show correction context directly.
- Add route and service actions for AP submit and return paths.
- Decide whether AP final approval is represented by:
  - a thin domain route that delegates to workflow decisioning, or
  - only the generic workflow decision surface
- Add an `is_workflow_governed` boolean column on the AP doc-class / doc-type metadata table, defaulting to false. Migration must reject any AR-direction doc class from being set to true. Seed the recommended V1 values (supplier invoice / credit note / AP accrual = true; petty cash and AR classes = false); final tenant-specific values are set at rollout time.
- Add a shared helper `isDocClassWorkflowGoverned(docClass)` (or equivalent) in a module imported by both the CARI service and the governed-AP applicability checks; PR-3 will import the same helper. Do not duplicate the predicate.
- Use the helper as the single governed-AP applicability rule everywhere: it gates submit / return / approve behavior on the shared `cari_documents.status` enum so AR and non-governed AP classes never reach SUBMITTED/RETURNED/APPROVED.
- Enforce status guards so:
  - only `DRAFT` or `RETURNED` can be submitted
  - only `SUBMITTED` or `APPROVED` can be returned
  - only `APPROVED` can be posted once workflow is active
- Keep current settlement / reverse semantics after `POSTED`.
- Explicitly preserve AP-only business use of the new governed statuses in V1.
- Fix CARI accounting / report queries so `SUBMITTED`, `RETURNED`, and `APPROVED` are not treated as accounting-visible posted documents.
- Review linked-flow guards that currently assume only `DRAFT` / `POSTED` and lock intended behavior explicitly.
- Update OpenAPI and CARI smoke / release-gate coverage in the same PR.

## Frontend changes
- Add AP statuses and transitions to CARI lifecycle metadata.
- Show correct badges, allowed actions, and copy for `SUBMITTED`, `RETURNED`, and `APPROVED`.
- Remove any assumptions that AP documents jump directly from `DRAFT` to `POSTED`.
- Keep AR and non-governed document paths behavior-preserving where applicable.
- Apply the same governed-AP applicability rule in frontend action visibility and lifecycle UI.

## Acceptance
- A draft AP document can be submitted.
- A submitted AP document can be returned for correction and resubmitted.
- An approved AP document can be posted.
- Posted AP documents still settle and reverse the same way as today.
- Accounting-facing CARI reports do not include `SUBMITTED`, `RETURNED`, or `APPROVED` as posted accounting results.

## Smoke checks
- create AP draft -> submit -> return -> edit -> resubmit
- create AP draft -> submit -> approve -> return -> edit -> resubmit (exercises the higher-risk path where an already-decided document is reopened)
- confirm cancel is blocked after submit and only allowed in `DRAFT` / `RETURNED`
- confirm reverse remains available only after posting
- confirm open-item / statement / aging queries do not surface pre-post governed AP statuses as posted accounting rows

---

# PR-3 - Integrate AP Documents with Workflow Governance

## Goal
Make AP document approval use the workflow-governance engine so flow selection can vary by tenant, group, country, legal entity, or operating unit.

## Files
### Backend
- new additive workflow migration for new process / target enums
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/services/approval.delegation.service.js`
- `backend/src/services/approval.escalation.service.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/services/cari.document.service.js`
- `backend/scripts/generate-openapi.js`
- generated `backend/openapi.yaml`

### Frontend
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/api/workflows.js`
- `frontend/src/pages/cari/*` approval-action surfaces that need workflow-gate messaging

## Backend changes
- Add the new workflow `processType` and `targetType` for AP documents.
- Extend workflow assignment and definition validation to accept the AP process type.
- Extend workflow setup template docs with AP examples.
- Reuse the same governed-AP applicability rule from PR-2 so workflow instance creation and workflow gate checks only run for in-scope AP documents.
- On AP submit, resolve the active AP workflow assignment and **always create a new workflow instance** (never reactivate an existing one), then move the business document to `SUBMITTED`. Each submit cycle is its own instance with its own SLA/escalation timer.
- When the workflow reaches final approval, transition the AP document to `APPROVED`.
- When the workflow returns / rejects for correction, transition the AP document to `RETURNED`; copy the workflow decision comment into `cari_documents.return_reason`. The workflow-decision validator must reject return/reject actions that carry an empty comment.
- On a **return from `APPROVED`**, void the existing workflow instance (mark it `SUPERSEDED`, preserve its history read-only). Approvals are immutable; a subsequent resubmit will create a brand-new instance.
- On a **cancel from `RETURNED`** (including after the doc was once `APPROVED`), cascade the cancel to any still-open workflow instance: auto-close it with outcome `cancelled_by_document_owner`. Document-status cancel and workflow-instance close must happen in one transaction.
- Escalation- and delegation-driven `REJECTED` decisions follow the same path as manual returns: map to document `RETURNED`, copy comment to `return_reason`. Escalation that rejects without a human comment uses a templated escalation message (e.g. `auto-returned: SLA breach after N days`) as `return_reason`.
- On AP post:
  - if the doc class has `is_workflow_governed = false`: direct-post path, no workflow gate (this path is not affected by compat_mode).
  - if the doc class is governed AND a workflow assignment resolves: require approved workflow gate.
  - if the doc class is governed AND no workflow assignment resolves: if tenant `ap_workflow_compat_mode = ON`, allow legacy direct-post with an explicit audit-log marker (`compat_mode_legacy_post`); if `ap_workflow_compat_mode = OFF`, block the post with a "no workflow assignment configured" error.
- Compat-mode behavior is purely a *fallback when assignment resolution is empty*; it never bypasses an active assignment that returned a pending/blocked gate.
- Extend the CARI document GET response to surface workflow-gate state directly on the document payload (gate: `none` | `pending` | `returned` | `approved` | `blocked`, plus the latest decision reason / comment if present). Frontend must not evaluate gate state from lifecycle metadata alone.
- Update OpenAPI (including the new gate fields on the document response schema) and workflow/AP release-gate coverage in the same PR.

## Frontend changes
- Let workflow setup UI create AP workflow definitions and assignments.
- Show AP workflow-gate status in the CARI workbench so users know whether posting is blocked, pending review, returned, or approved.
- Prefer reusing generic workflow decision surfaces for actual reviewer approval actions unless the AP workbench needs a thin convenience wrapper.

## Acceptance
- AP workflow definitions and assignments can be created from the workflow setup screen.
- Country-scoped AP workflow assignment can govern multiple legal entities in the same country.
- AP post is blocked until the workflow gate resolves to approved.
- AP documents with no active AP workflow assignment keep legacy behavior only if rollout compatibility mode is intentionally enabled.

## Smoke checks
- tenant with country assignment: one country workflow governs two entities in the same country
- legal entity with stricter local assignment overrides country assignment
- post attempt before approval returns workflow-gate message rather than posting
- submit -> approve -> return creates instance #1, voids it on return, resubmit creates instance #2 (confirms 3a + 3b lock)
- submit -> approve -> return -> cancel closes the voided/open workflow instance atomically with the cancel (confirms 3c lock)
- workflow-engine REJECTED decision without a comment is rejected at the validator; with a comment, comment is copied into `cari_documents.return_reason` (confirms 3d lock)
- governed AP doc class without a resolvable assignment: post is allowed under `ap_workflow_compat_mode = ON` (with `compat_mode_legacy_post` audit marker) and blocked under `ap_workflow_compat_mode = OFF`
- non-governed doc class (e.g. petty cash): post proceeds directly regardless of compat-mode or assignment presence
- document GET response surfaces the correct workflow-gate state for blocked, pending, returned, and approved documents

---

# PR-4 - Split AP Permissions and Roles Cleanly

## Goal
Replace the current compressed AP posting role with explicit AP submit / review / approve / post authorities.

## Files
### Backend
- `backend/src/seedCore.js`
- `backend/src/services/roleMigration.service.js`
- `backend/src/routes/onboarding.js`
- `backend/scripts/generate-openapi.js`
- generated `backend/openapi.yaml`

### Frontend
- `frontend/src/pages/security/roleCatalog.js`

## Backend changes
- Add new CARI-side permission codes:
  - `cari.doc.submit`
  - `cari.doc.cancel` (if not already separated from `cari.doc.update`)
- Do NOT add `cari.doc.approve`, `cari.doc.review`, or `cari.doc.return`: approve / return / review are pure workflow decisions. Authorization for those actions is driven entirely by workflow step assignment on the AP workflow definition — not by a parallel CARI permission gate. This keeps the authz model single-sourced and avoids UI-visible-but-blocked or blocked-but-UI-visible contradictions.
- Keep `cari.doc.post` and `cari.doc.reverse` separate.
- Redefine `APDocumentPoster` or replace it with narrower composable roles.
- Add country-scoped AP final roles to the new replacement model so legacy `CountryController` is no longer needed for AP.
- Update onboarding presets so country finance setup can provision the new AP final-governance roles.
- If onboarding/security API contracts change, update OpenAPI in the same PR rather than deferring to rollout.

## Frontend changes
- Update role catalog labels and descriptions so legal-entity AP review and country-level AP final governance are clearly distinct.

## Acceptance
- `BranchOperator` no longer needs AP posting authority.
- Legal-entity AP reviewers can submit without automatically receiving country-level final posting power; their return / review authority comes from workflow-step assignment on the LE step (where such a step exists) rather than a CARI permission.
- Country-level AP approvers / posters can govern final AP posting across more than one legal entity in the same country.

## Smoke checks
- branch user can still create draft but cannot post
- entity AP controller can review and submit but cannot final-post at country scope
- country AP approver can approve without needing reverse unless poster authority is also assigned
- country AP poster can post approved AP documents across two legal entities in the same country

---

# PR-5 - Finish AP Workbench and Workflow UI

## Goal
Make the CARI workbench, visibility layer, and workflow setup UI understandable for the new country-scoped AP review model.

## Files
### Frontend
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/lifecycle/lifecycleRules.js`
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/components/CariDocumentsDetailSection.jsx`
- `frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx`
- `frontend/src/pages/cari/cariDocumentsPageHelpers.js`
- `frontend/src/i18n/messages.js`

### Backend
- `backend/src/services/cari.document.service.js`

## Frontend changes
- Add AP workflow setup defaults and helper text for country-scoped assignment.
- Show AP document lifecycle states and workflow block reasons in one place.
- Show `RETURNED` with correction-oriented copy, not terminal rejection copy.
- Make action visibility depend on the new permission split and workflow-gate state.
- Keep UI responsive even when workflow gate is pending or missing.

## Backend changes
- Extend CARI list visibility / filtering so country-scoped AP users can list and read AP documents across multiple legal entities in the same country.

## Acceptance
- country-scoped AP actors can actually find the AP documents they govern
- users can understand why a document is blocked from posting
- returned AP documents clearly tell the user to correct and resubmit
- workflow setup page can create AP definitions and country assignments without manual JSON-only work

## Smoke checks
- open approved AP document and confirm only post is available
- open submitted AP document as branch user and confirm only read visibility remains
- open returned AP document as entity controller and confirm edit / resubmit path is visible
- country-scoped reviewer can list AP documents across two entities in the same country

---

# PR-6 - Rollout, Migration, and UAT

## Goal
Roll out the new country-scoped AP approval model safely without breaking existing tenants.

## Files
### Backend
- feature-flag seed or rollout config files as needed
- migration / backfill helpers if existing draft data needs normalization
- targeted workflow / AP lifecycle smoke or release-gate scripts as needed

### Docs
- add rollout tracker or UAT checklist after implementation starts

## Rollout rules
- Two-flag rollout model (locked):
  - `FEATURE_AP_DOCUMENT_WORKFLOW_V1` (per tenant): enables the governed AP lifecycle for a tenant. When OFF, tenant stays on legacy direct-post across all AP classes; `is_workflow_governed` metadata is inert for that tenant.
  - `ap_workflow_compat_mode` (per tenant): only meaningful while `FEATURE_AP_DOCUMENT_WORKFLOW_V1 = ON`. Controls fallback behavior when a governed AP doc class has no matching workflow assignment. ON = legacy direct-post fallback permitted; OFF = posting blocked until an assignment exists.
- Typical rollout path per tenant:
  1. enable `FEATURE_AP_DOCUMENT_WORKFLOW_V1`, keep `ap_workflow_compat_mode = ON`.
  2. create AP workflow assignments for pilot country / LE.
  3. verify governed flow in pilot scope; non-pilot scopes continue direct-post via compat fallback.
  4. expand assignments to remaining countries / LEs.
  5. flip `ap_workflow_compat_mode = OFF` once every governed-class scope has a resolvable assignment, to enforce "no assignment = no post".
- `is_workflow_governed` per-doc-class flag is set at the doc-class metadata layer (PR-2), independently of either feature flag. Non-governed classes (petty cash, AR) always direct-post regardless of flags.
- Do not silently auto-assign country workflows; make assignment presence explicit.
- Seed at least one default AP workflow template that uses country scope so setup teams are not forced to hand-build the first definition.
- Do not defer contract/docs updates to rollout; OpenAPI and route-level release gates belong in the API-touching PRs above.

## UAT focus
- same-country multi-entity AP posting governance
- entity override over country assignment
- return and resubmit behavior
- country-scoped visibility of governed AP documents
- posting block messages when workflow approval is pending
- coexistence with already-mature close / consolidation workflow governance

## Exit criteria
- country-scoped AP workflow assignment works across multiple legal entities
- legal-entity AP controller and country AP poster responsibilities are separated
- AP posting can be governed by workflow assignment rather than legacy role bundles
- country-scoped AP actors can see and act on the governed documents appropriately
- close / consolidation governance remains operational throughout rollout

---

## Recommended Implementation Order

1. PR-1 (COUNTRY workflow foundation + `legal_entities.country_id` NOT NULL backfill)
2. PR-4 (permission codes + role split) — must land before PR-2/PR-3 so new routes enforce correct permissions
3. PR-2 (CARI AP review states)
4. PR-3 (AP ↔ workflow integration)
5. PR-5 (AP workbench + country-scoped CARI visibility)
6. PR-6 (rollout, UAT) — country-scoped AP role assignment to real users must not ship to production until PR-5 merges

Do not start PR-3 before PR-1 is merged, because AP cannot use country-scoped governance correctly until country assignment exists, `TARGET_COUNTRY` exists, target snapshots carry country context, and generic workflow decision access can resolve country steps correctly.

Do not start PR-2 before PR-4 is merged, because PR-2 introduces new submit/post enforcement paths that need the new permission codes to gate correctly. PR-4 introduces the permission codes only — the actual role re-composition (retiring `APDocumentPoster`, adding `EntityAPController` / `CountryAPApprover` / `CountryAPPoster`) can still be split between PR-4 and PR-5 as needed.

Do not ship PR-4 role provisioning to production tenants until PR-5 has merged, because country-scoped AP actors need the PR-5 CARI visibility extension to actually see the documents they must approve.

Do not treat PR-2 as "just add enum values". It must also harden CARI accounting / reporting visibility assumptions before governed AP statuses are allowed into production.
