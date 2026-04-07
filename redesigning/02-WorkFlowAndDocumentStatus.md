# WORKFLOW GOVERNANCE EXPLAINABILITY AND RUNTIME ACTION GUIDANCE ROADMAP

## Status

- Planned — all blocking decisions resolved, ready to implement
- Repo-shaped against current workflow-governance and CARI/AP surfaces
- No workflow-engine redesign in this track
- Goal is explainability and operator clarity, not new approval math
- AP workflow behavior remains:
  - submit is a business action guarded by `cari.doc.submit`
  - approval is workflow-driven
  - posting is a business action guarded by posting authority
- Locked understanding from current implementation:
  - AP workflow steps keep `requiredPermissionCode = null`
  - AP approval authority is still resolved at runtime through step scope plus approval authority
  - runtime must explain effective authority in business language, even if step JSON is blank

### Pre-implementation decisions resolved

1. **effectiveApprovalPermissionCode** — No new approval logic needed.
   The route layer (`workflows.routes.js:85-102`) already falls back to `"approvals.requests.approve"` when `requiredPermissionCode` is null.
   The approval engine (`approval.engine.service.js:1254-1268`) sets `hasDirectPermission = true` when null, making authority scope-driven.
   Resolution: surface the existing fallback as a named field:
   `effectiveApprovalPermissionCode = step.requiredPermissionCode || "approvals.requests.approve"`

2. **Next-step lookahead** — No new queries needed.
   All steps are already loaded into `policy_snapshot.steps` when an instance is created (`workflows.service.js:1546-1561`).
   The instance tracks `current_step_no` and advancement already does `stepNo + 1`.
   Resolution: read next step from the already-loaded snapshot in `buildCariDocumentWorkflowGateSummary`.
   Derive `nextActorType` from `nextStep.stageScopeType`, `nextActionCode` = last step ? `"POST"` : `"APPROVE"`.

3. **blockingReasonCode enum** — Consolidation of existing scattered conditions.
   Codes already exist implicitly across `cari.document.service.js`, `useCariDocumentPostReverseController.js`, and `cariDocumentsPageHelpers.js`.
   Resolution: define formal enum in `shared/cariDocumentWorkflowGovernance.js`. See "Blocking reason code vocabulary" section below.

4. **Coverage diagnostics** — On-demand using existing `findUsersWithPermissionAtScope()`.
   The function already exists in `authz.scope.service.js`. `loadHierarchy()` gives all org scopes.
   Threshold: zero active users at scope (temporal guards already exist in query layer).
   Resolution: thin query-layer wrapper, not batch job.

5. **Role naming** — Use actual codebase names from `roleCatalog.js`.
   `EntityAPController`, `CountryAPApprover`, `APApprover`, `CountryAPController` etc.
   Spec-only names (`EntitySetupManager`, `CountryFinanceSetupManager`, `CountryAPPoster`) are not used.

---

## Purpose

Make workflow setup and runtime action states behave like a real-world ERP by adding a business-facing explanation layer on top of the current workflow engine.

This roadmap covers two related surfaces:

1. **Workflow Governance setup page**

   - make setup understandable in business language
   - show who submits, who approves, who posts
   - explain scope and effective authority without forcing admins to decode raw step JSON

2. **Runtime document/action surfaces**
   - explain why a document is waiting, blocked, or ready
   - explain who the system is waiting for
   - explain which scope is active
   - explain why the current user can or cannot act

The objective is that users and admins can answer these questions directly from the UI:

- What is this document waiting for?
- Who must act next?
- At which scope?
- Why is submit/approve/post blocked?
- What authority is needed?
- What happens after this step completes?

---

## Current repo behavior and gap summary

### What already exists

- Workflow governance setup flow exists in settings
- AP workflows already support multi-step stage scopes
- AP workflow step permission input is intentionally blank / disabled
- Submit / approve / post are already separate actions in the domain
- Runtime gate data already exists through `workflowGate`
- List/detail/action-panel surfaces already show basic waiting/blocked state

### What is missing

- Setup page still speaks too much in engine terms
- AP configuration does not clearly explain effective reviewer authority
- Runtime status messaging is too generic
- UI does not clearly say:
  - waiting for who
  - at what scope
  - requiring which effective authority
  - what the current user lacks
- Current payloads are not rich enough to drive ERP-style explanations
- Role/preset alignment around AP approval roles is not fully trustworthy yet

---

## Locked decisions

### 1) Do not redesign the workflow engine

This track does not replace or restructure:

- workflow instance lifecycle
- assignment resolution
- approval engine decision logic
- submit/post domain guards

This is an explainability layer.

### 2) AP setup must use business wording first

For AP, the default experience must speak in terms of:

- branch / OU submitter
- legal entity approver
- country approver
- country poster

Raw permission codes remain available only as advanced detail.

### 3) Runtime must show both business meaning and technical detail

The UI should show:

- business meaning first
- technical permission/scope detail second

Example:

- Waiting for: Legal Entity AP approval
- Technical authority: `approvals.requests.approve` at Legal Entity scope

### 4) Submit, approve, and post remain separate concepts

Do not blur them into a single action system.

The target ERP-like flow remains:

- draft
- submit
- approve
- post

### 5) AP step JSON remains supported but de-emphasized

Advanced JSON may remain for expert/admin use, but the normal AP flow should be understood without reading raw step JSON.

### 6) Runtime explanation must be user-relative

The system must explain both:

- document/global state
- current user’s ability or inability to act

### 7) Role/preset alignment is in scope for this roadmap

UI explainability should not ship while bootstrap role presets and visible role catalogs disagree on who can actually approve/post.

---

## Target user-facing outcomes

### Setup page target behavior

An admin configuring AP workflow should see plain language like:

> Branch operators with submit authority can submit this AP bill.  
> One Legal Entity AP reviewer must approve it.  
> After approval, Country posting authority can post it.

### Runtime target behavior

A branch user should see:

> Waiting for Legal Entity approval at Nistanc.  
> You cannot post yet because approval is still pending.  
> After approval, a Country poster can post the bill.

An entity approver should see:

> This document is waiting for your Legal Entity approval.  
> Required authority: AP approval at Legal Entity scope.  
> After your approval, Country posting becomes available.

A country poster should see before approval:

> Posting is blocked until Legal Entity approval is complete.

And after approval:

> Workflow approval is complete.  
> You can post this document because you hold Country posting authority.

---

## Scope

### In scope

- Workflow governance setup UX wording and guided explanation
- AP templates / business flow presets on workflow setup page
- Live plain-language process preview
- Richer backend workflow-gate explainability payload
- Runtime explanation panels on CARI/AP detail and action surfaces
- Better list/detail labels for waiting/blocked/ready states
- Role coverage / configuration diagnostics
- Role preset alignment for AP-related bootstrap/setup roles
- Tests and release-gate coverage for new explanation payloads

### Out of scope

- Replacing the workflow engine
- Replacing current approval persistence model
- Rewriting the permission model
- Introducing a new generic approval framework
- Large redesign of all non-AP modules
- Reworking core RBAC architecture beyond what is needed for explainability accuracy

---

## Implementation slices

# PR-WGX-01 — AP setup page business templates and wording cleanup

## Purpose

Make AP workflow configuration understandable in business language instead of engine language.

## Changes

- Add AP business templates such as:
  - Branch submits → Entity approves → Country posts
  - Branch submits → Country approves → Country posts
  - Branch submits → Entity approves → Entity posts
  - Direct post without workflow
- For AP workflows, replace the disabled “required reviewer permission” mental model with:
  - who reviews this step
  - at which scope
  - who posts after approval
- Add live plain-language preview of the configured business process
- Add assignment impact summary:
  - where the workflow applies
  - who reviews
  - who posts afterward
- Keep advanced JSON available, but secondary

## Files

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/components/ApprovalStepCard.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowStepsBuilderStep.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowReviewStep.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`

## Acceptance

- Admin can understand AP workflow without decoding raw step JSON
- AP setup clearly explains submit / approve / post roles
- Preview text reflects actual AP flow semantics
- Template selection pre-fills sensible AP stage scope defaults

---

# PR-WGX-02 — Backend workflow-gate explainability payload

## Purpose

Provide enough backend data for frontend ERP-style explanations.

## Changes

Extend the current CARI document workflow gate summary to include richer explanation fields.

## Target shape

Extend the existing 9-field gate summary with enrichment fields.
Fields marked (existing) are already returned by `buildCariDocumentWorkflowGateSummary`.
Fields marked (new) will be added in this PR.
js
workflowGate: {
// --- existing fields ---
state, // (existing) "NONE"|"PENDING"|"RETURNED"|"APPROVED"|"BLOCKED"
message, // (existing) human-readable gate message
workflowGoverned, // (existing) boolean
assignmentResolved, // (existing) boolean
workflowDefinitionId, // (existing) number|null
workflowAssignmentId, // (existing) number|null
workflowInstanceId, // (existing) number|null
workflowInstanceStatus, // (existing) "PENDING"|"APPROVED"|etc.
latestDecisionComment, // (existing) string|null

// --- new enrichment fields ---
assignmentScopeType, // (new) from resolved assignment
assignmentScopeId, // (new) from resolved assignment
assignmentScopeLabel, // (new) human label for assignment scope

currentStepNo, // (new) from instance.current_step_no
totalSteps, // (new) from policy_snapshot.steps.length
currentStageScopeType, // (new) from current step's stageScopeType
currentStageScopeLabel, // (new) human label for current stage scope

// Derived from existing fallback logic — not new approval logic.
// When step.requiredPermissionCode is null (AP default),
// effectiveApprovalPermissionCode = "approvals.requests.approve"
// Source: workflows.routes.js:85-102, approval.engine.service.js:1254-1268
effectiveApprovalPermissionCode, // (new) step.requiredPermissionCode || "approvals.requests.approve"
effectiveApprovalPermissionLabel, // (new) business label for above

// Derived from policy_snapshot.steps — all steps already loaded at instance creation.
// Source: workflows.service.js:1546-1561
// nextStep = steps.find(s => s.step_no === currentStepNo + 1)
// If no next step, next action is POST.
nextActorType, // (new) from nextStep.stageScopeType or "POSTER"
nextActionCode, // (new) "APPROVE" if next step exists, else "POST"
nextActionLabel, // (new) business label e.g. "Country posting"

waitingForSummary, // (new) e.g. "Waiting for Legal Entity approval at Nistanc"
blockingReasonCode, // (new) from consolidated enum — see vocabulary below
blockingReasonDetail, // (new) human-readable expansion of blocking reason

submitPermissionCode, // (new) "cari.doc.submit" — constant, for UI display
postPermissionCode, // (new) "cari.doc.post" — constant, for UI display
}

```

```

## Notes

- For AP, `requiredPermissionCode` remains blank in step JSON
- Backend should still expose the **effective runtime approval authority** used for explanation
- The explainability object should not lie about engine behavior
- Do not create new approval logic just to populate UI labels
- `effectiveApprovalPermissionCode` is derived from the existing route-layer fallback, not invented
- Next-step lookahead reads from `policy_snapshot.steps` which is already loaded — no new DB queries

## Likely seams

- `backend/src/services/cari.document.service.js` — `buildCariDocumentWorkflowGateSummary` (line ~6868) is the enrichment point
- `backend/src/services/workflows.service.js` — `resolveUnifiedWorkflowDecisionAccessFromRequestRow` (line ~1244) provides step/scope data
- `backend/src/services/approval.engine.service.js` — approval authority fallback logic (line ~1254)
- `shared/cariDocumentWorkflowGovernance.js` — home for new `blockingReasonCode` enum

## Blocking reason code vocabulary

Define in `shared/cariDocumentWorkflowGovernance.js` alongside existing `CARI_DOCUMENT_WORKFLOW_GATE_STATES`.
Derived from conditions already evaluated in the codebase:

```js
// Workflow governance blocking
"WORKFLOW_APPROVAL_PENDING"; // gate state = PENDING
"WORKFLOW_APPROVAL_REJECTED"; // gate state = RETURNED
"WORKFLOW_APPROVAL_REQUIRED"; // unsubmitted governed doc
"WORKFLOW_ASSIGNMENT_NOT_CONFIGURED"; // no assignment found
"WORKFLOW_ASSIGNMENT_NOT_RESOLVED"; // assignment exists but unresolved
"NO_WORKFLOW_INSTANCE"; // missing workflow instance

// Permission blocking
"MISSING_PERMISSION_SUBMIT"; // no cari.doc.submit
"MISSING_PERMISSION_APPROVE"; // no approvals.requests.approve at scope
"MISSING_PERMISSION_POST"; // no cari.doc.post
"MISSING_PERMISSION_REVERSE"; // no cari.doc.reverse

// Document status blocking
"INVALID_DOCUMENT_STATUS_FOR_SUBMIT"; // not DRAFT/RETURNED
"INVALID_DOCUMENT_STATUS_FOR_POST"; // not APPROVED (governed) or not DRAFT (ungoverned)
"INVALID_DOCUMENT_STATUS_FOR_APPROVAL"; // not SUBMITTED

// Posting readiness (already coded in cariDocumentsPageHelpers.js:2357-2405)
"CARI_POSTING_MODULE_NOT_READY";
"INVALID_BOOK_CONFIG";
"INVALID_PERIOD_CONFIG";
"PERIOD_NOT_OPEN";
"ACCOUNT_NOT_FOUND";
"ACCOUNT_INACTIVE";
"ACCOUNT_NOT_POSTABLE";
"ACCOUNT_SCOPE_NOT_LEGAL_ENTITY";
"ACCOUNT_LEGAL_ENTITY_MISMATCH";

// Reverse blocking
"ACTIVE_LINKED_INVENTORY_MOVEMENTS";
"ACTIVE_LANDED_COST_VOUCHER_SOURCE_APPLICATIONS";
"DOCUMENT_ALREADY_REVERSED";
"POSTED_JOURNAL_LINKAGE_MISSING";
"JOURNAL_ALREADY_REVERSED";
```

## Acceptance

- Frontend receives enough information to explain:

  - who is next
  - what step is active
  - what scope is active
  - why action is blocked
  - what permission/authority is effectively needed

---

# PR-WGX-03 — Action panel explanation layer

## Purpose

Turn the action panel into an ERP-style action explanation surface.

## Changes

Upgrade the current CARI/AP post/reverse/action panel to show:

### A. Process status

- Draft
- Submitted
- Approved
- Posted

With workflow-aware subtext:

- submitted by branch
- pending entity approval
- ready for country posting
- returned for correction

### B. Waiting / blocked explanation

Examples:

- Waiting for Legal Entity approval
- Scope: Nistanc
- Required authority: AP approval authority
- Technical permission: `approvals.requests.approve`
- After approval: Country poster may post

### C. Current user capability explanation

Examples:

- You can submit
- You cannot approve this step
- You can post after approval
- You cannot post because approval is still pending

## Files

- `frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx`
- `frontend/src/pages/cari/hooks/useCariDocumentPostReverseController.js`

## Acceptance

- Action buttons are accompanied by clear explanation
- Users know why they are blocked
- Users know who the system is waiting for
- Posting/approval distinction is visible

---

# PR-WGX-04 — Detail and list view workflow explanation upgrades

## Purpose

Make list/detail screens operationally readable without opening raw workflow records.

## Changes

### Detail page

Replace generic workflow-gate rendering with a richer explanation card that can show:

- workflow status
- waiting for who
- current step x of y
- active scope
- next action after completion
- latest decision comment / return reason

### List page

Improve compact list labels from generic state labels to business-facing summaries such as:

- Waiting for Legal Entity approval
- Waiting for submission
- Returned for branch correction
- Ready for Country posting

## Files

- `frontend/src/pages/cari/components/CariDocumentDetailContent.jsx`
- `frontend/src/pages/cari/components/CariDocumentsListSection.jsx`

## Acceptance

- List view conveys queue meaning, not just status color/state
- Detail view clearly explains workflow position and next actor
- Returned/resubmitted flows are understandable

---

# PR-WGX-05 — Role coverage and configuration diagnostics

## Purpose

Warn admins when a workflow setup is valid on paper but has no real actors.

## Changes

Add coverage diagnostics that can detect issues such as:

- no Legal Entity users currently have AP approval authority
- no Country users currently have posting authority
- no in-scope users can submit because `cari.doc.submit` is missing
- assignment/process/template combination leaves no valid reviewers
- frontend role catalog and backend bootstrap preset expectations diverge

## Implementation approach — on-demand query layer

Coverage diagnostics will be on-demand (not batch), built on top of existing infrastructure:

- `findUsersWithPermissionAtScope(tenantId, permissionCode, scopeType, scopeId)` in `authz.scope.service.js` — already answers “who can do X at scope Y”
- `loadHierarchy()` in `authz.scope.service.js` — gives all org scopes
- Existing 30s Redis cache for permission bundles
- Temporal guards (`effective_from`/`effective_to`) already in query layer

Threshold: zero **active** users at scope = gap warning (temporal guards already filter inactive assignments).

## Likely seam

- `backend/src/services/rbac.diagnostics.service.js` — extend with coverage gap functions
- `backend/src/services/authz.scope.service.js` — reuse `findUsersWithPermissionAtScope`, `loadHierarchy`

## UI target

On setup/review screen, show warnings like:

- “This workflow uses Legal Entity approval, but no Legal Entity users currently have AP approval authority.”
- “Country posting is selected, but no Country users currently have posting authority.”
- “Branch submission is expected, but no in-scope users currently have submit authority.”

## Acceptance

- Admin gets operational warnings before rollout
- Dead-on-arrival workflow configurations are detectable
- Diagnostics are informative, not noisy
- Diagnostics are on-demand (triggered on setup save/review), not background jobs

---

# PR-WGX-06 — AP role preset alignment and label consistency

## Purpose

Make visible role labels, bootstrap presets, and runtime capabilities agree.

## Changes

Align AP-related setup/bootstrap roles using **actual codebase names** from `roleCatalog.js`:

- `EntityAPController` (not spec-only "EntitySetupManager")
- `CountryAPApprover` (not spec-only "CountryFinanceSetupManager")
- `APApprover`
- `CountryAPController` (not spec-only "CountryAPPoster")

The spec-only names (`EntitySetupManager`, `CountryFinanceSetupManager`, `CountryAPPoster`) are discarded.
All templates, labels, and diagnostics will reference the actual role catalog names.

## Expected alignment outcomes

- If setup UI says a role can approve, backend preset actually grants approval authority
- If setup UI says a role can post, backend preset actually grants posting authority
- Bootstrap-created admin/setup users are not silently under-permissioned

## Likely files

- `backend/src/services/systemRoles.service.js` — bootstrap role assignment (`assignCompatibilityBootstrapRolesToUser`, line ~292)
- `frontend/src/pages/security/roleCatalog.js` — role catalog with `CATEGORY_LABELS` and `ROLE_CATALOG`

## Acceptance

- No visible mismatch between documented role intent and actual granted capabilities
- Explainability UI is backed by true runtime access

---

# PR-WGX-07 — Tests, smoke coverage, and release gates

## Purpose

Keep the new explanation layer correct through regression.

## Backend tests

Add/extend tests around:

- enriched `workflowGate` payload
- correct active step and stage scope labels
- correct `waitingForSummary`
- correct blocking reason details
- correct effective approval authority exposure
- returned/resubmitted message behavior

## Existing likely test seams

- `backend/scripts/test-cari-pr27-governed-ap-review-states.js`
- `backend/scripts/test-cari-pr29-ap-workflow-rollout-and-uat.js`
- `backend/scripts/test-followup-prf06-workflow-decisions-runtime.js`

## Frontend smoke

Cover:

- AP template selection
- setup preview wording
- pending entity approval wording
- ready-to-post wording after approval
- returned/resubmit wording
- blocked action explanation for current user

## Acceptance

- New payload fields are stable
- Frontend explanation stays in sync with backend truth
- Regression surfaces are covered by release checks

---

## Detailed design notes

### Effective approval authority derivation (resolved)

For AP workflows where `requiredPermissionCode = null`:

```
Route layer (workflows.routes.js:85-102):
  if (!requiredPermissionCode)
    → fallback to "approvals.requests.approve" at step's resolved scope

Approval engine (approval.engine.service.js:1254-1268):
  if (!requiredPermissionCode)
    → hasDirectPermission = true (authority is scope-driven)

AP default definition (ap.document.workflow.rollout.service.js:14-20):
  → stepNo: 1, stageScopeType: "COUNTRY", requiredPermissionCode: null

Runtime resolution flow:
  Workflow Assignment → scopeResolutionMode (e.g. TARGET_COUNTRY)
    → resolves to { scopeType: "COUNTRY", scopeId: <doc.country_id> }
    → user must have "approvals.requests.approve" at that scope
```

This is not new logic — `effectiveApprovalPermissionCode` surfaces what the route layer already computes.

### Next-step lookahead derivation (resolved)

```
policy_snapshot.steps = [...all steps loaded at instance creation...]
instance.current_step_no = N

nextStep = steps.find(s => s.step_no === N + 1)
if (nextStep) → nextActionCode = "APPROVE", nextActorType = nextStep.stageScopeType
if (!nextStep) → nextActionCode = "POST", nextActorType = "POSTER"
```

No new DB queries. Pure in-memory derivation from already-loaded data.

### AP setup page wording model

For AP workflows, default setup text should be actor-driven:

- Who can submit?
- Who reviews this step?
- At which organizational scope?
- Who can post after approval?

Do not lead with:

- raw permission code
- raw step JSON
- generic engine-only terms

### Runtime explanation wording model

For every document/action surface, show in this order:

1. Current business state
2. Waiting for / blocked by
3. Current user capability
4. What happens next

### Technical detail placement

Technical detail should be present, but secondary.

Examples:

- Business: Waiting for Legal Entity AP approval
- Technical detail: `approvals.requests.approve` at Legal Entity scope

### Returned flow wording

Returned documents must explicitly say:

- returned for correction
- by which level if available
- what the next valid action is
- whether the current user can edit/resubmit

### Posting wording

Do not say only “blocked”.
Say:

- posting blocked until approval completes
- or ready for posting by Country poster

## Recommended rollout order

### First

PR-WGX-01 — setup templates and business wording
High-value and mostly frontend-safe.

### Second

PR-WGX-02 — backend explainability payload
Foundation for all runtime clarity.

### Third

PR-WGX-03 and PR-WGX-04 — runtime action/detail/list explanation
Consume the new payload.

### Fourth

PR-WGX-05 — diagnostics
Prevent invalid operational rollout.

### Fifth

PR-WGX-06 — preset alignment
Make explanation trustworthy.

### Sixth

PR-WGX-07 — tests and release gates
Lock behavior.

---

## Risks and pitfalls

### 1) UI over-promising beyond backend truth

Do not invent explanations the backend cannot justify.
If a value is inferred, label it carefully.
NOTE: `effectiveApprovalPermissionCode` and next-step lookahead are now confirmed to be derivable from existing engine state — no inference risk for these fields.

### 2) Mixing approval authority and posting authority

These must remain distinct in all messaging.

### 3) Showing business labels that do not match actual preset roles

This is why preset alignment is mandatory before rollout confidence.

### 4) Overloading list views

List page explanations must stay compact and scannable.

### 5) Exposing too much technical detail to normal users

Keep permission-code detail secondary and collapsible when possible.

---

## Acceptance checklist for the whole roadmap

A mature-ERP-feeling implementation is achieved when:

- Workflow setup can be understood without reading raw JSON
- AP setup clearly explains submit / approve / post roles
- Runtime pages say who the system is waiting for
- Runtime pages say why the current user is blocked
- Runtime pages say what happens next
- List views show queue meaning, not only generic states
- Setup warns when nobody can actually operate the workflow
- Visible role labels match real granted runtime authority
- Tests protect the new explanation layer

---

## Example target outcome for your intended AP flow

### Setup page

> Branch operators with submit authority can submit this AP bill.
> One Legal Entity AP reviewer must approve it.
> After approval, Country posting authority can post it.

### Branch user after submit

> Waiting for Legal Entity approval at Nistanc.
> You cannot post because approval is still pending.
> After approval, a Country poster can post the bill.

### Entity approver

> This document is waiting for your Legal Entity approval.
> Required authority: AP approval at Legal Entity scope.
> After your approval, Country posting becomes available.

### Country poster before approval

> Posting is blocked until Legal Entity approval is complete.

### Country poster after approval

> Workflow approval is complete.
> You can post this document because you hold Country posting authority.

---

## Final implementation intent

This roadmap does not make the workflow engine more complex.

It makes the existing engine understandable.

That is the exact step that will make the product feel more like a polished, real-world ERP.
