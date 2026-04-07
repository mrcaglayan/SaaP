# CANONICAL BACKEND ORG TREE PLATFORM PLAN

## Status

- Planned
- Replaces the earlier fast-path frontend-derived tree direction
- Preferred for better consistency, better scaling path, and lower long-term UI duplication
- No composite scope-model redesign in this track
- Aligned with `06-WorkflowGovernanceRolePackagePresetSpec.md`

## Purpose

Create one canonical backend-owned org-tree contract and one shared frontend
scope picker that can be reused across:

- workflow setup
- user assignments
- scope assignments
- approval delegations
- access debugger
- future workflow governance role/package/preset admin surfaces

This track is about shared scope-selection architecture.

It is not a redesign of RBAC semantics or workflow assignment persistence.

## Why This Direction

Compared with frontend-derived nesting, the canonical backend-tree direction is
stronger because it gives us:

- one authoritative hierarchy shape
- consistent ancestor handling for limited-scope users
- less duplicated derivation logic in frontend pages
- cleaner scaling for large tenants
- a better base for later lazy loading or virtualization
- better reuse for the workflow role/package/preset model in
  `06-WorkflowGovernanceRolePackagePresetSpec.md`

## Alignment With `06-WorkflowGovernanceRolePackagePresetSpec.md`

There is no conflict with the role/package/preset plan.

This org-tree plan should explicitly support it.

### Why it matters

`06-WorkflowGovernanceRolePackagePresetSpec.md` separates:

- business roles
- workflow packages
- workflow presets

All three need consistent scope targeting.

That means the shared tree must be reusable not only for workflow assignment,
but also for:

- package assignment at scope
- business-role assignment at scope
- preset application target scope
- governance setup admin targeting

### Impact on this plan

The shared picker must support:

- allowed scope-type filters
- disabled node reasons
- page-provided selectability rules
- stable scope labels and breadcrumb/path labels

### Important non-change

Even though `06-WorkflowGovernanceRolePackagePresetSpec.md` introduces cleaner business
role and package concepts, this tree plan still keeps current scope semantics:

- `TENANT`
- `GROUP`
- `COUNTRY`
- `LEGAL_ENTITY`
- `OPERATING_UNIT`

No `GROUP+COUNTRY` composite scope is introduced here.

## Locked Decisions

### 1. Backend owns the tree shape

Frontend should not invent the hierarchy page by page.

Backend returns the canonical nested tree.

### 2. Keep current selectable scope semantics

Selecting a node still resolves to only:

- `scopeType`
- `scopeId`

using the current scope model.

### 3. Additive migration first, cleanup second

During migration, existing flat list endpoints may continue to exist.

The new nested-tree contract becomes the preferred admin-facing source of truth,
then pages migrate incrementally.

### 4. Shared picker, not page-local selectors

The frontend should build one shared org-tree picker component and reuse it.

### 5. No RBAC redesign in this track

This track does not change:

- permission evaluation
- workflow assignment persistence shape
- role assignment persistence shape
- scope filter semantics

## Current Repo Facts

### Existing backend support

The backend already has an org tree route:

- `GET /api/v1/org/tree`

Current implementation returns flat collections:

- groups
- countries
- legal entities
- operating units

Current files:

- `backend/src/routes/org.js`
- `backend/src/services/org.read.service.js`
- `backend/src/services/org.read.queries.js`

### Existing frontend gap

The frontend does not currently consume one shared tree contract.

Admin pages still coordinate multiple flat lists independently.

Current examples:

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/ScopeAssignmentsPage.jsx`
- `frontend/src/pages/security/ApprovalDelegationsPage.jsx`
- `frontend/src/pages/security/AccessDebuggerPage.jsx`

## Target Backend Contract

## Goal

Expose one canonical nested org tree for admin scope selection.

## Response shape

Suggested target shape:

```json
{
  "tenantId": 1,
  "shape": "nested",
  "root": {
    "key": "TENANT:1",
    "scopeType": "TENANT",
    "scopeId": 1,
    "label": "Tenant",
    "code": null,
    "selectable": true,
    "pathLabels": ["Tenant"],
    "meta": {},
    "children": [
      {
        "key": "GROUP:10",
        "scopeType": "GROUP",
        "scopeId": 10,
        "label": "North Hub Group",
        "code": "NHG",
        "selectable": true,
        "pathLabels": ["Tenant", "North Hub Group"],
        "meta": {},
        "children": []
      }
    ]
  }
}
```

## Node fields

| Field | Purpose |
| --- | --- |
| `key` | stable UI key such as `LEGAL_ENTITY:14` |
| `scopeType` | existing scope type |
| `scopeId` | numeric scope id |
| `label` | admin-facing label |
| `code` | optional business code |
| `selectable` | whether the node is inherently selectable |
| `pathLabels` | breadcrumb labels |
| `meta` | optional extra metadata such as status, iso2, unit type |
| `children` | nested child nodes |

## Route strategy

Preferred migration approach:

- keep the current flat tree behavior available during transition
- add a canonical nested response without breaking existing callers

Safe options:

- `GET /api/v1/org/tree?shape=nested`
  or
- `GET /api/v1/org/tree/nested`

The exact route shape can be finalized during implementation, but the migration
must be additive first.

## Backend Builder Rules

### Tenant root

The tree must always start from a tenant root node.

### Group nodes

Groups hang directly under tenant.

### Country nodes

Countries should be attached in a stable backend-defined way for admin
navigation.

Because the current persistence model does not make `country under group` a
first-class assignment scope, this remains navigation structure, not a new
scope type.

### Legal entities

Legal entities must appear beneath the correct parent branch using their
existing org relationships.

### Operating units

Operating units must appear beneath their legal entity.

### Ancestor completeness

For limited-scope users, the backend tree builder must include enough ancestor
nodes to render a navigable path to visible descendants.

This is one of the main reasons to prefer backend-owned tree building over
frontend derivation.

## Frontend Shared Contract

Frontend should consume the nested tree through one helper and one reusable
component.

### Shared API helper

Add to:

- `frontend/src/api/orgAdmin.js`

Suggested helper:

- `listOrgTree({ shape: "nested" })`

### Shared picker

Suggested component:

- `frontend/src/components/org/OrgScopeTreePicker.jsx`

Suggested optional hook:

- `frontend/src/components/org/useOrgScopeTree.js`

### Shared picker capabilities

- expand/collapse
- current selection
- search/filter by code/name/iso2
- allowed scope-type filtering
- page-provided node disabling
- disabled reason text
- breadcrumb display

## Selection Semantics

Selecting a node still maps to current scope semantics only:

- `TENANT`
- `GROUP`
- `COUNTRY`
- `LEGAL_ENTITY`
- `OPERATING_UNIT`

Examples:

- selecting one group returns `GROUP + groupCompanyId`
- selecting one country returns `COUNTRY + countryId`
- selecting one legal entity returns `LEGAL_ENTITY + legalEntityId`
- selecting one operating unit returns `OPERATING_UNIT + operatingUnitId`

## Execution Order Relative To 04 And 06

This plan should be implemented before:

- `06-WorkflowGovernanceRolePackagePresetSpec.md`
- `07-RolePermissionAdminPagePlan.md`

Recommended order:

1. Finish the platform slices in this document
2. Implement the role/package/preset model from
   `06-WorkflowGovernanceRolePackagePresetSpec.md`
3. Implement the admin surfaces from `07-RolePermissionAdminPagePlan.md`

Reason:

- `05` provides the shared org-tree platform
- `04` defines the access model that later UI must expose
- `06` builds the admin UI on top of both

## Initial Reuse Order

### 1. Workflow setup

First consumer:

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`

### 2. Future governance and admin surfaces

After `06-WorkflowGovernanceRolePackagePresetSpec.md` lands, the same tree should be
reused for:

- business role assignment
- workflow package assignment
- workflow preset target-scope selection
- user assignment
- scope assignment
- approval delegations
- access debugger

## Implementation Slices

# PR-WGX-08 - Backend canonical nested org-tree contract

## Purpose

Move tree ownership to the backend and create the canonical nested contract.

## Changes

- add a backend nested-tree builder
- expose canonical nested tree response through org routes
- keep migration additive while old flat behavior remains available if needed
- ensure ancestor nodes are present for limited-scope users
- preserve current scope semantics

## Files

- `backend/src/routes/org.js`
- `backend/src/services/org.read.service.js`
- `backend/src/services/org.read.queries.js`
- any needed backend test files

## Acceptance

- backend returns one nested tenant-group-country-entity-unit tree
- limited-scope users still get a navigable ancestor path
- no composite scope semantics are introduced

---

# PR-WGX-09 - Frontend API helper and shared tree consumption layer

## Purpose

Create the frontend foundation that consumes the canonical backend tree.

## Changes

- add `listOrgTree()` helper in `frontend/src/api/orgAdmin.js`
- add shared frontend tree utilities only for consumption concerns, not for
  hierarchy invention
- add selection mapping helpers from tree node to current scope form fields
- add focused tests for selection mapping and filtering helpers

## Files

- `frontend/src/api/orgAdmin.js`
- `frontend/src/shared/orgScopeTree.js`
  or
- `frontend/src/pages/security/utils/orgScopeTree.js`
- related test files

## Acceptance

- frontend can load the canonical nested tree through one helper
- selection mapping back to current scope fields is centralized
- utility tests cover current-scope output and allowed-scope filtering

---

# PR-WGX-10 - Shared OrgScopeTreePicker component

## Purpose

Create one reusable picker for all admin scope-selection flows.

## Changes

- add `OrgScopeTreePicker`
- add optional state hook if it reduces duplication
- support:
  - expand/collapse
  - search/filter
  - allowed scope types
  - disabled node reasons
  - breadcrumb display

## Files

- `frontend/src/components/org/OrgScopeTreePicker.jsx`
- `frontend/src/components/org/useOrgScopeTree.js`
- related component tests

## Acceptance

- one reusable picker works against the backend nested tree
- the picker returns current scope semantics only
- component tests cover interaction basics and disabled/selectable behavior

---

# PR-WGX-11 - Workflow setup adopts canonical org tree

## Purpose

Replace workflow scope selection with the shared tree while preserving current
assignment persistence.

## Changes

- use the shared tree in workflow setup
- replace flat scope selection UI in the assignment step
- keep current payload writing unchanged
- preserve current write-access checks and assignment summary behavior

## Files

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowAssignmentStep.jsx`
- shared tree files

## Acceptance

- workflow setup selects scope from the shared tree
- save payload shape remains unchanged
- existing assignment permission behavior still works

---

# PR-WGX-12 - Workflow wizard order and early target-scope selection

## Purpose

Move target-scope choice earlier in the workflow setup flow now that a strong
shared scope-selection surface exists.

## Changes

- reorder workflow setup to:
  1. workflow type
  2. target scope
  3. definition
  4. approval steps
  5. review
- keep definition and assignment persistence separate
- refresh scope-dependent summary text and diagnostics coherently

## Files

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowTypeStep.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowAssignmentStep.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowSetupProgress.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`

## Acceptance

- target scope is chosen before workflow detail setup
- no backend workflow redesign is required
- scope choice cleanly drives later setup and review text

---

# PR-WGX-13 - Platform hardening, workflow smoke coverage, and 04/06 handoff

## Purpose

Finish the shared-org-tree platform work cleanly before the role/package/preset
model and admin-surface refactors begin.

## Changes

- add smoke coverage for workflow setup using the shared tree
- remove duplicated local workflow scope-selection logic where safe
- document the integration handoff points for:
  - `06-WorkflowGovernanceRolePackagePresetSpec.md`
  - `07-RolePermissionAdminPagePlan.md`
- verify picker support for:
  - allowed scope-type rules
  - disabled node reasons
  - stable breadcrumb labels

## Files

- shared tree utilities/components
- workflow setup tests
- `redesigning/05-CanonicalBackendOrgTreePlatformPlan.md`

## Acceptance

- shared tree behavior has smoke coverage in workflow setup
- workflow setup no longer keeps duplicated local scope-selection logic
- the tree contract is clearly ready to be consumed by the 04 and 06 plans

## Tests

### Backend coverage

- nested tree shape generation
- ancestor inclusion for limited-scope users
- stable node typing and path data

### Frontend unit coverage

- selection mapping to current scope fields
- allowed-scope filtering
- disabled node behavior

### Component coverage

- expand/collapse
- search/filter
- selection output

### Integration coverage

- workflow setup selects a scope node and still saves the same assignment shape

## Acceptance Criteria

- backend owns the canonical nested org-tree contract
- frontend consumes that contract through one shared helper
- one shared picker is reused in workflow setup and is ready for later 04/06
  admin-surface reuse
- no composite scope semantics are introduced in this track
- the plan remains compatible with `06-WorkflowGovernanceRolePackagePresetSpec.md`

## Deferred Items Already Covered By Later Direction

- security admin page adoption from `07-RolePermissionAdminPagePlan.md`
- business role/package/preset UI adoption from
  `06-WorkflowGovernanceRolePackagePresetSpec.md`
- composite scope semantics such as `GROUP+COUNTRY`
- lazy subtree fetching if not yet needed
- virtualization if tenant size later demands it
- broader RBAC redesign

## Companion Docs

- workflow/runtime explainability roadmap:
  `redesigning/02-WorkFlowAndDocumentStatus.md`
- AP role packet review:
  `redesigning/03-APRoleBundleMatrix.md`
- workflow role/package/preset specification:
  `redesigning/06-WorkflowGovernanceRolePackagePresetSpec.md`
- admin surface plan:
  `redesigning/07-RolePermissionAdminPagePlan.md`
