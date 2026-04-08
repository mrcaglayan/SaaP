# Workflow Governance UI & Access Management — PR-Sliced Implementation Tracker

## Status

- Planned
- Companion to the Workflow Governance Role / Package / Preset specification
- Repo-aligned to the current security catalog, role bundle inventory, and workflow permission families
- Assumes extension/refactor of the current security area, not a greenfield replacement
- UI/business label `Branch Accountant` maps to current runtime role `BranchOperator`
- Legacy runtime roles remain until explicit migration tooling is ready

---

## Purpose

Build the admin and runtime UI surfaces needed to make the new access model usable.

This tracker covers:

- Access Model Catalog UI
- User Assignment UI
- Workflow Governance UI refactor
- Runtime Explainability UI
- Access Diagnostics UI
- Legacy / Migration visibility UI

This tracker does **not** redefine the core RBAC model itself.
That is handled by the companion roles/packages/presets plan.

---

## Current Repo Reality Confirmed

### Existing security/admin catalog seam

- `frontend/src/pages/security/roleCatalog.js`

### Existing catalog shape

- current role catalog mixes:
  - composable roles
  - legacy roles
  - AP-specific helper-style roles
  - system roles
- current shipped bootstrap preset count = `2`

### Current capability seams already available

- workflow setup permissions:
  - `workflow.definition.read`
  - `workflow.definition.write`
  - `workflow.assignment.read`
  - `workflow.assignment.write`
- approval permissions:
  - `approvals.policies.read`
  - `approvals.policies.write`
  - `approvals.requests.read`
  - `approvals.requests.approve`
  - `approvals.requests.reject`
- local close permissions:
  - `ouclose.*`
- period close authority:
  - `gl.period.close`
- consolidation permissions:
  - `consolidation.*`
- user/role admin permissions:
  - `security.role.*`
  - `security.role_assignment.*`
  - `security.data_scope.*`

### Existing composable role seams that matter for UI

- `EntityAPController`
- `CountryAPApprover`
- `CountryAPController` / runtime `CountryAPPoster`
- `APApprover`
- `LocalClosePreparer`
- `LocalCloseReviewer`
- `GroupReportingController`
- `BranchOperator`

### Existing legacy roles that should be hidden from fresh-tenant UX

- `TenantAdmin`
- `APDocumentPoster`
- `GroupController`
- `CountryController`
- `EntityAccountant` legacy broad role

---

## Locked UI Decisions

### Decision 1

The admin UX must separate:

- Business Roles
- Workflow Packages
- Workflow Presets
- Legacy Catalog

### Decision 2

Workflow steps bind to **packages**, not directly to business titles.

### Decision 3

Business titles remain human-facing labels only.

### Decision 4

Scope must be visible everywhere relevant:

- GROUP
- COUNTRY
- LEGAL_ENTITY
- OPERATING_UNIT

### Decision 5

Runtime screens must explain:

- what step is active
- what package is required
- what scope is required
- who can act
- why current user cannot act

### Decision 6

Legacy roles stay available for compatibility but are hidden by default for fresh tenants.

### Decision 7

UI wording must use business-friendly labels:

- Branch Accountant
- AP Submitter
- AP Reviewer
- AP Poster

---

# Phase 0 — Terminology & Surface Preparation

## Goal

Do the lowest-risk UI cleanup first so later pages do not keep using confusing old wording.

## Risk

Low

---

## UI-0A — Admin Terminology Cleanup

### Goal

Normalize admin-facing wording before structural redesign.

### Scope

- security/admin screens
- workflow governance screens
- role/preset labels
- help text / tooltips / section names

### Changes

- `BranchOperator` label -> `Branch Accountant`
- `EntityAPController` label -> `AP Submitter`
- `CountryAPApprover` label -> `AP Reviewer`
- `CountryAPController` / `CountryAPPoster` label -> `AP Poster`
- mark legacy roles with a visible `Legacy` badge
- stop using wording that implies workflow governance belongs to onboarding
- separate “edit authority” from “review authority” in UI text

### Acceptance

- no visible admin screen uses outdated AP/controller wording
- business users can understand who submits, approves, and posts
- legacy items are visually marked before structural redesign

### Non-goals

- no page rearchitecture yet
- no new data model yet

---

## UI-0B — Access Model Display Metadata

### Goal

Introduce frontend display metadata needed for later tabs without full UI redesign yet.

### Scope

- role display metadata
- package display metadata
- preset display metadata
- legacy replacement suggestions

### Changes

Add frontend metadata structure for:

- display name
- description
- category
- default scope
- legacy flag
- replacement label
- workflow family
- sort order

### Acceptance

- UI can distinguish role type, package type, preset type, and legacy state
- future tabs do not need hardcoded label logic everywhere

### Non-goals

- no CRUD editor yet
- no backend change required unless metadata is server-driven

---

# Phase 1 — Access Model Catalog

## Goal

Create one clean admin catalog surface for business roles, workflow packages, presets, and legacy items.

## Risk

Medium-low

---

## UI-1A — Access Model Catalog Shell

### Goal

Create the new parent screen and tab structure.

### Navigation

Security / Access Model

### Tabs

1. Business Roles
2. Workflow Packages
3. Workflow Presets
4. Legacy Catalog

### Changes

- add new page shell
- add tab routing/state
- add shared filters/search
- add common detail drawer pattern

### Acceptance

- admin can navigate between the 4 catalog concepts cleanly
- no tab mixes legacy roles with normal business labels by default

### Non-goals

- no assignment workflow yet
- no runtime explainability yet

---

## UI-1B — Business Roles Tab

### Goal

Show the human-friendly business role catalog only.

### Rows to support

- Branch Accountant
- Branch Manager
- Entity Accountant
- Entity Manager
- Entity CEO
- Group Checker
- Group Approver
- Group CEO

### Columns

- Business Role Name
- Default Scope
- Description
- Suggested Starter Packages
- Active / Hidden

### Actions

- create role label
- edit label
- hide from picker
- duplicate
- view where used

### Acceptance

- business roles are understandable without reading raw permission codes
- admin can see suggested starter packages without confusing them with actual granted authority

### Non-goals

- this tab must not be the raw permission editor

---

## UI-1C — Workflow Packages Tab

### Goal

Show reusable action-based packages.

### Example packages

- AP Documents / Draft & Submit
- AP Documents / Approve
- AP Documents / Post
- Local Close Pack / Prepare & Submit
- Local Close Pack / Review
- Local Close Pack / Approve & Lock
- Period Close / Readiness View
- Period Close / Approve & Close
- Consolidation / Prepare Run
- Consolidation / Execute Run
- Consolidation / Finalize

### Columns

- Package Name
- Workflow Family
- Allowed Scopes
- Underlying Permission Codes
- Current Runtime Mapping
- Used In Presets
- Status

### Detail drawer

- description
- exact permission codes
- existing helper bundle mapping
- existing role mapping
- legacy warnings

### Acceptance

- admin can understand package intent without tribal knowledge
- package scopes are obvious
- AP/local close/period close/consolidation packages appear under one consistent model

### Non-goals

- no workflow-step editing here
- no user assignment yet

---

## UI-1D — Workflow Presets Tab

### Goal

Show ready-made workflow templates admins can start from.

### Example presets

#### AP

- AP / Lean Entity
- AP / Standard Entity
- AP / Group-Controlled Post

#### Local Close

- Local Close / Standard
- Local Close / Branch-Assisted
- Local Close / Group-Supervised

#### Period Close

- Period Close / Standard
- Period Close / Controlled
- Period Close / Group-Supervised

#### Consolidation

- Consolidation / Standard
- Consolidation / Controlled
- Consolidation / Executive

### Columns

- Preset Name
- Workflow Family
- Primary Scope
- Step Count
- Typical Actors
- Uses Extension? (Yes/No)
- Active / Draft

### Detail view

- ordered steps
- step scope
- required package
- eligible business roles
- min approver count
- self-approve rule
- escalation rule

### Acceptance

- admin can preview a preset before using it
- presets read like business flows, not raw system objects

### Non-goals

- no actual workflow save/apply yet; that lands in Phase 3

---

## UI-1E — Legacy Catalog Tab

### Goal

Keep compatibility items visible to power admins without polluting fresh-tenant UX.

### Items to show

- TenantAdmin
- APDocumentPoster
- GroupController
- CountryController
- EntityAccountant legacy role
- old AP controller/poster labels

### Columns

- Runtime Code
- Scope
- Legacy Reason
- Replacement
- Used By Count
- Visible In New Tenant? (default No)

### Acceptance

- admins can see what is legacy and what replaces it
- fresh-tenant admin experience is no longer dominated by old role names

### Non-goals

- no migration execution yet

---

# Phase 2 — User Assignment Workbench

## Goal

Make assignment of business roles and packages understandable and scope-aware.

## Risk

Medium

---

## UI-2A — User Assignment Page Refactor

### Goal

Refactor user assignment into a two-panel workbench.

### Navigation

Security / User Assignment

### Left panel

- user list
- filters:
  - name/email
  - active/inactive
  - business role
  - workflow package
  - scope type
  - scope target
  - direct/preset-derived
  - legacy/composable

### Right panel

Selected user authority detail

### Acceptance

- admins can find users by role, package, or scope
- assignment management is no longer a flat role-only list

### Non-goals

- no diagnostics engine yet

---

## UI-2B — Business Role Assignment UX

### Goal

Support assignment of business role labels independently from package authority.

### Features

- assign business role
- remove business role
- show default scope suggestion
- show non-authoritative nature of business role label

### Acceptance

- admin can assign Branch Accountant without automatically granting posting authority
- business labels are visibly separate from capability packages

### Non-goals

- no hidden raw permission mutation via business label alone

---

## UI-2C — Workflow Package Assignment UX

### Goal

Support direct package assignment by scope.

### Features

- assign package
- remove package
- choose scope type
- choose scope target
- show allowed scopes for package
- show package summary before save

### Acceptance

- admin can give AP Approve at entity scope without giving AP Post
- same user can have different package mixes across different scopes

### Non-goals

- no workflow-step editing yet

---

## UI-2D — Starter Bundle / Preset Apply UX

### Goal

Allow quick assignment from recommended starter bundles or presets.

### Features

- apply starter package bundle for selected business role
- preview resulting packages
- partial apply
- remove one derived package without destroying all direct grants
- mark source as direct vs preset-derived

### Acceptance

- admin can start from a default model without losing flexibility
- source of each assignment is visible

### Non-goals

- no hidden “magic” grants

---

## UI-2E — Effective Authority Preview

### Goal

Show what the selected user can actually do in readable language.

### Example outputs

- Can draft and submit AP in OU Kabul
- Can approve Local Close in Entity Afghanistan
- Can finalize Consolidation in Group Holding
- Can view but cannot post AP in Entity Turkey

### Acceptance

- admin can understand user authority without reading raw permission codes
- scope mismatches become visible

### Non-goals

- no per-record diagnostics yet

---

## UI-2F — Assignment Audit & SoD Warnings

### Goal

Surface assignment history and role/package conflict warnings.

### Features

- granted by
- granted at
- direct/preset source
- temporary/effective dates if available
- SoD warning summary where applicable

### Acceptance

- admins can see who granted what
- risky combinations are visible before save where possible

### Non-goals

- no final service-layer SoD enforcement; this is UI warning only

---

# Phase 3 — Workflow Governance Page Refactor

## Goal

Make workflow configuration package-based and explainable.

## Risk

Medium-high

---

## UI-3A — Preset Selector in Workflow Governance

### Goal

Add preset selection and preview into workflow governance.

### Features

- choose preset
- preview preset
- clone preset into tenant-specific copy
- compare preset vs customized flow
- reset to preset baseline

### Acceptance

- admin can start from a business-readable preset rather than raw JSON only
- preset selection is visible at header level

### Non-goals

- do not remove advanced JSON yet; keep it as power-user surface if needed

---

## UI-3B — Step Builder Refactor

### Goal

Refactor workflow steps to bind to packages and show business role suggestions.

### Step fields

- Step No
- Step Action Label
- Step Scope Type
- Required Package
- Eligible Business Roles
- Min Approver Count
- Allow Self Approve
- Escalation After Hours
- Notes

### Acceptance

- step authority is defined by package
- business role list is shown as helper/eligibility text, not as raw enforcement source
- admin can configure AP/local close/period close/consolidation with same mental model

### Non-goals

- no conditional branching redesign yet

---

## UI-3C — Step Validation & Inline Warnings

### Goal

Catch bad workflow setup before activation.

### Warnings

- no package selected
- selected package invalid for selected scope
- no eligible users found for this scope/package
- self-approve conflicts with policy
- legacy package used in new-tenant flow
- group AP post selected but group AP post extension not enabled
- period-close extension step selected but backend support not ready

### Acceptance

- invalid or risky workflow designs are visible before save
- admins do not have to discover scope mistakes only at runtime

### Non-goals

- no backend auto-fix logic

---

## UI-3D — Explainability Preview Panel

### Goal

Show a readable business preview of the workflow currently being configured.

### Example

- Step 1: AP Documents / Draft & Submit at OPERATING_UNIT scope — usually Branch Accountant
- Step 2: AP Documents / Approve at LEGAL_ENTITY scope — usually Entity Accountant
- Step 3: AP Documents / Post at LEGAL_ENTITY scope — usually Entity CEO

### Acceptance

- workflow designers can read the flow in business language before saving
- advanced JSON is no longer the only understandable view

### Non-goals

- no execution/audit history here

---

# Phase 4 — Runtime Explainability on Governed Screens

## Goal

Explain what is waiting, who can act, and why current user cannot act.

## Risk

Medium

---

## UI-4A — Shared Explainability Component

### Goal

Create a reusable explainability panel component for governed business pages.

### Content

- current status
- current step label
- required package
- required scope
- eligible roles
- current user can/cannot act explanation
- prior step history

### Acceptance

- the component can be reused in AP, local close, period close, and consolidation pages
- vague “Waiting” / “Blocked” language is reduced

### Non-goals

- no full audit screen replacement yet

---

## UI-4B — AP Runtime Explainability

### Goal

Add explainability to AP document pages.

### Features

- Waiting for Entity Approval
- Waiting for AP Documents / Post at LEGAL_ENTITY scope
- You can view but cannot approve
- disabled button reason tooltips

### Acceptance

- AP users can tell who must act next and why they personally cannot

### Non-goals

- no unrelated AP redesign

---

## UI-4C — Local Close Runtime Explainability

### Goal

Add explainability to local close pages.

### Features

- current close stage
- review/approve/lock requirement
- scope + package requirement
- current user actionability text

### Acceptance

- local close becomes the reference-quality explainability surface

### Non-goals

- no full local-close lifecycle redesign

---

## UI-4D — Period Close Runtime Explainability

### Goal

Make period close less opaque even if its backend governance family is still simpler.

### Features

- readiness vs close distinction
- who can close
- what scope is required
- why close button is disabled

### Acceptance

- period close is understandable even before future advanced reopen/admin family exists

### Non-goals

- no fake reopen/admin UX before backend support exists

---

## UI-4E — Consolidation Runtime Explainability

### Goal

Add explainability to consolidation run pages.

### Features

- current run stage
- who can prepare/execute/finalize
- adjustment/elimination stage visibility
- disabled button tooltips

### Acceptance

- group users can understand run progression without internal knowledge

### Non-goals

- no consolidation math/report redesign

---

# Phase 5 — Diagnostics, Migration, and Advanced Admin Views

## Goal

Give admins troubleshooting and migration tools after the main surfaces are live.

## Risk

Medium

---

## UI-5A — Access Diagnostics Page

### Goal

Show why a user does or does not have effective authority.

### Inputs

- user
- workflow family
- target scope
- optional target record/process

### Output

- business roles
- workflow packages
- matching scopes
- missing scope
- missing package
- legacy mapping used
- final readable result

### Acceptance

- admin can diagnose “user can view but cannot act” without DB digging
- scope mismatch becomes explicit

### Non-goals

- no full policy simulator yet

---

## UI-5B — Legacy Migration Visibility

### Goal

Expose how many users/flows still depend on legacy runtime roles.

### Features

- legacy role usage counts
- suggested replacement packages
- migration readiness status
- hide/show in picker controls
- migration warnings

### Acceptance

- admins can see when it is safe to retire legacy roles from normal UX
- rollout risk is visible before migration

### Non-goals

- no migration execution yet unless backend tool exists

---

## UI-5C — Optional Group AP Posting Extension UX

### Goal

Support the clean extension where AP posting can be group-scoped.

### Notes

This is optional and should only ship when the backend package/entitlement model supports it.

### Acceptance

- if group AP post is enabled, the UI can configure and explain it cleanly
- no reliance on legacy `GroupController`

### Non-goals

- no forced early shipment

---

## UI-5D — Optional Advanced Period Close Governance UX

### Goal

Support future period-close-specific reopen/admin packages if introduced later.

### Acceptance

- UI can add these as real packages later without redesigning the page again

### Non-goals

- do not fake this in early phases

---

# Suggested Delivery Order

## Recommended order

1. UI-0A done
2. UI-0B done
3. UI-1A done
4. UI-1B done
5. UI-1C done
6. UI-1D done
7. UI-1E done
8. UI-2A done
9. UI-2B done
10. UI-2C done
11. UI-2D done
12. UI-2E done
13. UI-2F done
14. UI-3A done
15. UI-3B done
16. UI-3C done
17. UI-3D done
18. UI-4A done
19. UI-4B done
20. UI-4C done
21. UI-4D done
22. UI-4E done
23. UI-5A done
24. UI-5B
25. UI-5C
26. UI-5D

---

# Companion Backend Dependencies

These UI PRs assume or benefit from companion backend work where needed:

- roles/packages/presets catalog contract
- workflow definition/assignment APIs
- effective entitlements / diagnostics API
- explainability payloads for governed records
- optional legacy migration reporting
- optional group-scoped AP post extension
- optional future period-close family extension

Where backend seams do not yet exist, pair the UI PR with a small backend companion PR rather than hardcoding temporary logic into the frontend.

---

# Acceptance Standard for the Whole UI Track

The UI track is successful when:

- admins can understand the difference between business roles, packages, and presets
- users can be assigned different package mixes at different scopes
- workflow designers can configure flows without relying only on raw step JSON
- governed business pages explain who is waiting and why
- legacy roles are no longer the default mental model for fresh tenants

---
