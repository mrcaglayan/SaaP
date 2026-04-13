# AP Action-Step Workflow Flexibility Plan

## Status

- Implemented and locally verified
- Repo-checked against the April 13, 2026 local snapshot
- Release-gate verified against the April 13, 2026 local snapshot
- Historical planning findings are retained below for traceability; the live implementation status is now reflected by code and tests
- Scope is AP document workflow flexibility only
- Assumes fresh database / fresh-tenant rollout only
- No backward-compatibility requirement for current AP approval-only workflow definitions
- No backfill requirement for existing `workflow_definition_steps`, `approval_policy_steps`, or local dev AP workflow records
- Locked decision: AP Step 4 becomes a true workflow action-step builder, not an approval-only builder
- Locked decision: AP action-step mode replaces the current implicit `submit -> approval steps -> post` behavior
- Locked decision: supported AP action codes in the first pass are `DRAFT`, `SUBMIT`, `APPROVE`, and `POST`
- Locked decision: AP step authorization is package-bound and scope-bound; business-role labels stay helper-only
- Locked decision: AP presets are out of scope for the first pass; manual step authoring is the primary UX
- Locked decision: non-AP workflow families keep their current approval-step model in this track
- Locked decision: local/dev database reset is acceptable if needed during rollout because the product is not live yet

---

## Goal

Let admins define AP workflows as explicit action chains where each step answers both of these questions:

1. what action happens at this step
2. at which scope that action is allowed

The builder must support flows such as:

1. `keo submits -> afmuhasebe posts at LEGAL_ENTITY`
2. `keo submits -> afmuhasebe approves at LEGAL_ENTITY -> countrycontroller approves at COUNTRY -> countrycontroller posts at COUNTRY`
3. `keo submits -> afmuhasebe approves at LEGAL_ENTITY -> countrycontroller posts at COUNTRY`
4. `keo drafts -> afmuhasebe submits at LEGAL_ENTITY -> countrycontroller posts at COUNTRY`
5. `keo drafts -> afmuhasebe submits at LEGAL_ENTITY -> countrycontroller approves at COUNTRY -> countrycontroller posts at COUNTRY`

This flexibility does not exist today because AP Step 4 only stores approval-stage steps and derives submit/post implicitly.

---

## Out Of Scope

- AR workflow redesign
- period close, local close pack, or consolidation action-step redesign
- preserving old AP preset semantics
- shipping preset authoring or preset cloning for AP in the first pass
- introducing business-role labels as a runtime authority source
- brownfield migration logic, compatibility shims, or production data backfill

---

## Current Repo Seams Confirmed

### Workflow schema and services

- `backend/src/migrations/m082_close_consolidation_workflow_approvals.js`
- `backend/src/migrations/m166_workflow_generic_bridge.js`
- `backend/src/migrations/m173_workflow_country_scope_foundation.js`
- `backend/src/migrations/m176_ap_document_workflow_integration_foundation.js`
- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/routes/workflows.routes.js`
- `backend/src/routes/workflows.validators.js`

### AP / CARI runtime

- `backend/src/services/cari.document.service.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/routes/cari.document.validators.js`
- `shared/cariDocumentWorkflowGovernance.js`

### Workflow admin UI

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowStepsBuilderStep.jsx`
- `frontend/src/pages/settings/workflows/components/ApprovalStepCard.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`

### Security / package catalog

- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/userAssignmentAuthorityPreview.js`

---

## Current-State Findings

### Conflict / plan gap

- Resolved in implementation; retained below for traceability.
- AP Step 4 is explicitly an approval-step editor, not a general workflow-step editor.
- The frontend currently limits AP step package selection to `PKG-AP-APPROVE`.
- The AP explainability preview injects implicit submit and post steps instead of using explicitly saved AP actions.
- `workflow_definition_steps` currently persists only:
  - `step_no`
  - `stage_scope_type`
  - `required_permission_code`
  - `min_approver_count`
  - `allow_self_approve`
  - `escalation_after_hours`
- The current AP validator intentionally rejects non-approval AP step payloads.
- The generic workflow bridge currently assumes every saved workflow step is approval-oriented.
- `cari.document.service.js` still treats `submit` and `post` as fixed route-level actions outside the saved AP step chain.
- Current AP runtime enrichment assumes the next non-approval terminal action is always post after the last approval step.
- Existing AP workflow roadmap assumptions in `57-COUNTRY-SCOPED-WORKFLOW-ASSIGNMENTS-AND-AP-DOCUMENT-APPROVAL-ROADMAP.md` are narrower than the product flexibility now required.

### Deferred item already covered

- Country-scoped workflow assignments already exist in the repo and can be reused.
- The workflow assignment resolver, workflow instance persistence, and approval engine bridge already exist and should be reused instead of creating a second approval subsystem.
- AP submit/post routes and governed-document lifecycle seams already exist and can be extended rather than rewritten from zero.

### Optional hardening

- After the manual builder lands, AP preset support can be rebuilt on top of the new explicit action-step contract instead of the old approval-only contract.
- Later tracks can decide whether non-AP workflow families should also move to action-step mode.

---

## Target Product Behavior

### AP step contract

Each saved AP step must explicitly persist:

- `actionCode`
- `stageScopeType`
- `requiredPackageCode`
- `minApproverCount`
- `allowSelfApprove`
- `escalationAfterHours`

For AP in the first pass, supported `actionCode` values are:

- `DRAFT`
- `SUBMIT`
- `APPROVE`
- `POST`

### Action semantics

- `DRAFT`
  - governs who may create/edit while the document remains draft
  - does not create an approval decision
- `SUBMIT`
  - governs who may hand the document forward into the next workflow step
  - does not create an approval decision
- `APPROVE`
  - governs who may approve / return / reject through the workflow engine
  - continues to use the generic approval engine bridge
- `POST`
  - governs who may final-post the AP document
  - does not create an approval decision

### Package bindings

The first-pass AP action/package matrix is:

- `DRAFT` -> `PKG-AP-DRAFT-SUBMIT`
- `SUBMIT` -> `PKG-AP-DRAFT-SUBMIT`
- `APPROVE` -> `PKG-AP-APPROVE`
- `POST` -> `PKG-AP-POST`
- `POST` at `GROUP` scope may later allow `PKG-AP-POST-GROUP`, but only when the extension is truly enabled

### Sequence rules

The AP builder must validate these rules:

- step numbers remain unique and strictly ordered
- `POST` must appear exactly once and must be the final step
- `DRAFT` may appear at most once and cannot appear after `SUBMIT`, `APPROVE`, or `POST`
- `SUBMIT` must appear exactly once and must appear before `APPROVE` or `POST`
- `APPROVE` may appear zero or more times before `POST`
- `minApproverCount` greater than `1` is valid only for `APPROVE`
- `allowSelfApprove` applies only to `APPROVE`; other action types treat it as false

### Workflow-instance lifecycle

- The AP workflow instance must track the current explicit step, not an approval-only interpretation.
- No implicit submit step is injected.
- No implicit post step is injected.
- The workflow instance enters a terminal completed state only after the explicit final `POST` step succeeds.
- Return / reject semantics apply only while the current step is `APPROVE`.

---

## Implementation Plan

# PR-ACTAP-00 - Planning Realignment

## Goal

Make the roadmap internally consistent before implementation starts.

## Changes

1. Treat this plan as superseding the AP-specific approval-only assumptions in:
   - `PR-STEPS/57-COUNTRY-SCOPED-WORKFLOW-ASSIGNMENTS-AND-AP-DOCUMENT-APPROVAL-ROADMAP.md`
   - `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
   - AP-specific Step 4 helper copy in the workflow setup UI
2. Do not spend implementation effort on preserving the old AP builder contract.
3. Keep non-AP workflow families untouched in this planning track.

## Acceptance

- The implementation plan is explicit that AP action-step mode is a clean replacement, not a compatibility layer.

---

# PR-ACTAP-01 - Schema and API Contract

## Goal

Persist explicit AP workflow actions instead of inferring submit/post around approval-only rows.

## Files

- new migration under `backend/src/migrations/`
- `backend/src/migrations/index.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
- `frontend/src/api/workflows.js`

## Changes

1. Extend `workflow_definition_steps` with at least:
   - `action_code`
   - `required_package_code`
2. Keep `required_permission_code` for non-AP workflow families, but stop using it as the authoring contract for AP steps.
3. Extend workflow-definition step validators so AP accepts explicit action/package payloads.
4. Add AP sequence validation for:
   - valid action ordering
   - valid action/package combinations
   - final `POST` requirement
5. Expose the new step fields on list/create/update/read endpoints.
6. Remove the current AP-only validator that forces AP into approval-only step semantics.

## Acceptance

- AP workflow definitions round-trip explicit `actionCode` and `requiredPackageCode`.
- Invalid AP step sequences are rejected with clear validation errors.
- Non-AP workflow families still round-trip unchanged.

---

# PR-ACTAP-02 - Step 4 UI Becomes a Real Workflow-Step Builder

## Goal

Make the admin UI match the new AP step contract.

## Files

- `frontend/src/pages/settings/workflows/components/WorkflowStepsBuilderStep.jsx`
- `frontend/src/pages/settings/workflows/components/ApprovalStepCard.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`

## Changes

1. Rename the AP Step 4 mental model from `approval steps` to `workflow steps`.
2. Add an AP action selector with:
   - `DRAFT`
   - `SUBMIT`
   - `APPROVE`
   - `POST`
3. Filter package options by the selected AP action.
4. Remove implicit AP submit/post preview generation.
5. Make the preview panel render the exact saved AP action sequence.
6. Hide or disable AP preset UX in the first pass so manual authoring is the only AP setup path.
7. Keep business-role labels as optional readability hints only.
8. Update coverage/explainability copy so it describes explicit AP actions instead of reviewer-only stages.

## Acceptance

- The admin can manually build each supported AP flow without relying on presets.
- The Step 4 preview exactly matches the saved AP action chain.
- The UI no longer tells AP admins that only approval-stage steps are supported.

---

# PR-ACTAP-03 - AP Runtime Becomes Step-Driven

## Goal

Drive AP document behavior from the explicit saved AP step chain.

## Files

- `backend/src/services/cari.document.service.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/routes/cari.document.validators.js`
- `shared/cariDocumentWorkflowGovernance.js`

## Changes

1. Introduce a shared AP workflow-step resolver that reads:
   - current AP workflow definition
   - current explicit step
   - current action code
   - current step scope
   - current required package
2. Make AP draft/create/update behavior respect a first-class `DRAFT` step when present.
3. Make AP submit behavior respect a first-class `SUBMIT` step instead of assuming submit is always implicit.
4. Make AP approval behavior respect explicit `APPROVE` steps only.
5. Make AP post behavior respect a first-class `POST` step instead of assuming post follows the last approval step automatically.
6. Replace AP waiting/next-action explainability with explicit current-step/action messaging.
7. Ensure return/reject sends the document back to the correct editable point in the explicit step chain.

## Acceptance

- AP runtime no longer relies on implicit AP submit/post steps.
- The current AP action available to the user is determined from the saved workflow steps.
- Posting is blocked until the explicit `POST` step becomes current.

---

# PR-ACTAP-04 - Bridge APPROVE Steps Only Into the Generic Approval Engine

## Goal

Reuse the generic approval engine for approval steps without forcing non-approval AP actions into an approval-only bridge.

## Files

- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/migrations/m166_workflow_generic_bridge.js`

## Changes

1. Mirror only AP `APPROVE` steps into `approval_policy_steps`.
2. Do not mirror AP `DRAFT`, `SUBMIT`, or `POST` steps as approval-policy steps.
3. Keep workflow assignments as the governing scope-resolution layer.
4. Keep approval decisions and escalations only for `APPROVE` steps.
5. Stop overloading the generic approval engine to explain AP submit/post behavior it does not actually own.

## Acceptance

- Multi-step AP approval chains still work through the generic approval engine.
- Non-approval AP actions are executed by AP runtime logic, not approval-policy rows.
- Approval-engine behavior remains unchanged for non-AP workflow families.

---

# PR-ACTAP-05 - Tests, Diagnostics, and Cleanup

## Goal

Lock the new AP flexibility with scenario-driven coverage and remove stale approval-only AP assumptions.

## Files

- new backend scripts under `backend/scripts/`
- `backend/package.json`
- AP workflow diagnostics / explainability surfaces touched by the new runtime
- relevant workflow setup frontend tests or static guards

## Changes

1. Add backend scenario coverage for these manual AP flows:
   - `submit -> post`
   - `submit -> approve -> post`
   - `submit -> approve -> approve -> post`
   - `draft -> submit -> post`
   - `draft -> submit -> approve -> post`
2. Add coverage that step scope really controls actor authority:
   - `OPERATING_UNIT`
   - `LEGAL_ENTITY`
   - `COUNTRY`
3. Remove stale AP helper text, validation messages, and comments that still describe AP as approval-only.
4. Update diagnostics/explainability output so current step, next action, and waiting actor reflect explicit AP action steps.
5. If local schema drift or incompatible dev data appears, reset the local DB instead of adding compatibility code.

## Acceptance

- The new AP manual-builder flexibility is covered by deterministic scenario tests.
- Diagnostics show explicit AP step/action state instead of inferred approval-only state.
- No AP setup helper text still claims that AP Step 4 can only model `APPROVE`.

---

## Must-Pass Scenario Matrix

The implementation is not complete until all of these can be authored in the UI and executed by runtime:

1. `keo submits -> afmuhasebe posts at LEGAL_ENTITY`
2. `keo submits -> afmuhasebe approves at LEGAL_ENTITY -> countrycontroller approves at COUNTRY -> countrycontroller posts at COUNTRY`
3. `keo submits -> afmuhasebe approves at LEGAL_ENTITY -> countrycontroller posts at COUNTRY`
4. `keo drafts -> afmuhasebe submits at LEGAL_ENTITY -> countrycontroller posts at COUNTRY`
5. `keo drafts -> afmuhasebe submits at LEGAL_ENTITY -> countrycontroller approves at COUNTRY -> countrycontroller posts at COUNTRY`

For current local analysis, the known scope chain is:

- `KEO - Kabil Erkek Okulu` -> `OPERATING_UNIT #1`
- `AF - Afghan-Türk Maarif Foundation` -> `LEGAL_ENTITY #1`
- `AF - Afghanistan` -> `COUNTRY #5`

Those fixtures are sufficient for initial implementation and comparison checks.

---

## Implementation Notes

- Do not hide this flexibility behind a feature flag.
- Do not add a second AP approval subsystem.
- Do not preserve the old AP approval-only contract just because helper code already exists.
- Prefer deleting or rewriting narrow AP assumptions over layering compatibility branches onto them.
- Keep the first pass focused on AP action-step flexibility; only generalize further after AP works end to end.
