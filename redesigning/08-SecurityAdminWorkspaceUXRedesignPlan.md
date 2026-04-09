# Security Admin Workspace UX Redesign Plan

## Status

- Planned
- Companion to `07-RolePermissionAdminPagePlan.md`
- Uses `Example of User Management Pages` as a visual reference only
- Assumes implementation inside the existing security/admin area, not a greenfield replacement

---

## Position

I agree with the direction behind the example UX.

The example is cleaner for:

- first-scan readability
- role browsing
- list/detail organization
- visual separation of matrix / assignments / SoD concerns

But the example cannot be adopted directly because the current repo has requirements that the mock UX does not cover:

- business-role labels are non-authoritative
- workflow packages and presets are first-class concepts
- fresh-tenant vs legacy visibility matters
- pages must be permission-gated
- pages must be API-backed
- pages must use repo i18n
- current security/admin state already spans assignments, delegations, diagnostics, presets, and migration seams

So the right approach is:

- keep the example's cleanliness and organization
- do **not** copy its data model or page structure literally

---

## Reference Inputs

### Visual reference

- `Example of User Management Pages/components/RolesPage.jsx`
- `Example of User Management Pages/components/RoleDetail.jsx`
- `Example of User Management Pages/components/PermissionMatrix.jsx`
- `Example of User Management Pages/components/UserAssignments.jsx`
- `Example of User Management Pages/components/SoDRules.jsx`

### Current repo implementation seams

- `frontend/src/pages/security/AccessModelCatalogPage.jsx`
- `frontend/src/pages/security/RolesPermissionsPage.jsx`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/UserAssignmentWorkbench.jsx`
- `frontend/src/pages/security/RoleSummaryCard.jsx`
- `frontend/src/pages/security/roleCatalog.js`

---

## Locked Constraints

### Constraint 1

Do not regress the current business-role / workflow-package / workflow-preset split.

### Constraint 2

Do not make business-role labels authoritative just because the example uses role cards.

### Constraint 3

Do not collapse assignments, delegations, and diagnostics into one oversimplified mock page that hides existing capability.

### Constraint 4

Do not ship a frontend-only redesign that ignores existing permission gating and fresh-tenant visibility rules.

### Constraint 5

Use the current repo visual stack:

- Tailwind
- existing shared UI primitives
- `lucide-react`
- `useI18n`

### Constraint 6

Prefer shared layout components over one huge replacement page.

### Constraint 7

No current security/admin capability may be silently dropped during the redesign.

Reorganization is allowed.

Feature loss is not.

---

## Non-Regression Rule

This redesign is only valid if it preserves current capability while improving structure.

That means:

- pages may be regrouped
- pages may share one cleaner shell
- pages may move behind better tabs, drawers, or linked detail flows
- current features may **not** disappear just because they are visually secondary in the new UX

If a current page is merged into a new workspace flow, the rollout must provide:

- an equivalent reachable entry point
- the same permission gate behavior
- the same core actions
- route continuity through either preserved paths or explicit redirects
- smoke coverage proving the feature still exists

---

## Current Feature Preservation Matrix

### Primary workspace surfaces that must remain first-class

- Access Model Catalog
- Roles & Permissions
- User Assignments

### Companion security/admin surfaces that must remain reachable

- Local User Management
- Scope Assignments
- Field Visibility Policies
- Role Migrations
- Approval Delegations
- Temporary Operational Coverage
- Access Debugger
- Legacy Migration Visibility
- Group AP Post Extension
- Compliance Reports
- RBAC Audit Logs
- Raw Audit Logs
- Sensitive Data Audit

### Capability parity that must survive the redesign

- browse business roles, workflow packages, workflow presets, and legacy catalog entries
- create or update runtime roles where allowed today
- replace role permissions where allowed today
- review permission-rule and warning surfaces already exposed today
- invite users
- assign preset-based business bundles
- assign or remove business-role labels
- assign or remove workflow-package authority
- retain advanced raw role-row assignment where it exists today
- retain scope-aware filtering and org-tree lookups
- retain effective authority preview and access debugger entry points
- retain approval delegation and temporary coverage operations
- retain migration, audit, and legacy visibility surfaces
- retain fresh-tenant vs legacy visibility behavior

### Current route inventory that must stay reachable during rollout

- `/app/ayarlar/sube-operatorleri`
- `/app/ayarlar/rbac/access-model`
- `/app/ayarlar/rbac/roles-permissions`
- `/app/ayarlar/rbac/user-assignments`
- `/app/ayarlar/rbac/scope-assignments`
- `/app/ayarlar/rbac/field-visibility-policies`
- `/app/ayarlar/rbac/role-migrations`
- `/app/ayarlar/rbac/delegations`
- `/app/ayarlar/rbac/temporary-coverage`
- `/app/ayarlar/rbac/access-debugger`
- `/app/ayarlar/rbac/legacy-migration-visibility`
- `/app/ayarlar/rbac/group-ap-post-extension`
- `/app/ayarlar/rbac/compliance-reports`
- `/app/ayarlar/rbac/audit-logs`
- `/app/ayarlar/rbac/raw-audit-logs`
- `/app/ayarlar/rbac/sensitive-data-audit`

### Route migration rule

- no current route is removed in the same PR that introduces the new shell
- if a route is consolidated into the workspace later, it must redirect to the equivalent tab/section state
- sidebar changes must preserve discoverability for lower-frequency admin utilities

### Test gate rule

- existing `security-ui0a` through current `security-ui5a` smoke coverage remains part of the redesign safety net
- redesign PRs must extend or replace stale frontend smokes instead of bypassing them
- add dedicated parity smokes before deleting any old entry point or major section chrome

---

## UX Goals

### Goal 1

Make the security/admin area feel like one calm workspace instead of several disconnected forms.

### Goal 2

Make the first screen readable within seconds:

- what area am I in
- what can I manage here
- what object is selected
- what the selected object means

### Goal 3

Reduce admin reliance on tribal knowledge:

- clearer business labels
- visible scope
- visible package/preset relationships
- visible legacy markers

### Goal 4

Keep advanced power-user capability available without making it the dominant UX.

---

## Proposed Information Architecture

Create one **Security Admin Workspace** shell with stable top-level sections:

1. Catalog
2. Assignments
3. Diagnostics
4. Audit & SoD

Inside those sections, keep the repo-aligned concepts already defined in the earlier plan.

### Catalog

Contains:

- Business Roles
- Workflow Packages
- Workflow Presets
- Legacy Catalog

### Assignments

Contains:

- assignment workbench
- preset/starter apply flow
- direct package assignment
- business-role label assignment
- active delegation visibility

### Diagnostics

Contains:

- effective authority preview
- access debugger entry points
- runtime explainability jump-offs

### Audit & SoD

Contains:

- SoD warnings
- assignment history summaries
- raw / enriched audit links

### Scope of the first shell rollout

The first shell rollout should wrap the 3 primary surfaces first:

- Access Model Catalog
- Roles & Permissions
- User Assignments

The companion pages remain reachable and explicitly linked from the shell during early rollout:

- Access Debugger
- Approval Delegations
- Temporary Operational Coverage
- Scope Assignments
- Field Visibility Policies
- Role Migrations
- Legacy Migration Visibility
- Group AP Post Extension
- Compliance Reports
- RBAC Audit Logs
- Raw Audit Logs
- Sensitive Data Audit
- Local User Management

This keeps the first redesign slice realistic without implying those pages are abandoned.

---

## Layout Pattern

Use one shared layout pattern across the workspace.

### Page anatomy

- top summary band
- tab or segment navigation
- filter/search rail
- primary content pane
- optional sticky detail pane or drawer

### Summary band

Should show small calm stats instead of large admin forms first.

Examples:

- total business roles
- active packages
- shipped presets
- users with active assignments
- open delegations
- legacy usage count

### Primary browsing mode

Default to scan-friendly cards or grouped list rows.

### Secondary inspection mode

Use a right-side detail pane or drawer for:

- role/package/preset meaning
- scope guidance
- replacement guidance
- exact permission/package composition

### Dense matrix mode

Keep matrix views available, but behind a clear tab or toggle rather than as the default landing view.

---

## What to Borrow From the Example

### Keep

- card-based browsing for roles and similar catalog objects
- split list/detail interaction
- visible summary metrics
- a dedicated matrix view
- dedicated SoD and assignment views
- stronger visual grouping by business domain

### Adapt

- role cards become catalog entries, not automatic permission containers
- role detail becomes business-role / package / preset detail depending on tab
- assignment cards must become API-backed grouped bundles, not static mock rows
- SoD cards should summarize current warnings and existing enforcement metadata

### Reject

- static mock data architecture
- direct role-as-permission-authority mental model
- missing i18n
- missing permission checks
- missing org-tree scope integration
- missing legacy/fresh-tenant behavior

---

## Implementation Slices

# UX-RBAC-01 - Shared Workspace Shell

## Status

- Completed on April 9, 2026
- Shared shell implemented for:
  - `AccessModelCatalogPage.jsx`
  - `RolesPermissionsPage.jsx`
  - `UserAssignmentsPage.jsx`
- Companion security/admin routes remain reachable from both the sidebar and the new shell

## Goal

Create the common shell that gives the whole security/admin area one organized frame.

## Scope

- shared page header
- summary stat strip
- section tabs / segmented nav
- shared search/filter slot
- consistent right-side detail pattern

## Candidate files

- new shared shell component under `frontend/src/pages/security/`
- wire into:
  - `AccessModelCatalogPage.jsx`
  - `RolesPermissionsPage.jsx`
  - `UserAssignmentsPage.jsx`

## Acceptance

- security/admin screens feel visually related
- page chrome is no longer rebuilt differently on each screen
- existing companion security/admin features stay reachable from the new shell or existing routes

---

# UX-RBAC-02 - Catalog Surface Cleanup

## Goal

Refactor the catalog area into a cleaner browse-first experience.

## Changes

- make Business Roles the most readable catalog tab
- convert dense rows into card/list hybrids where appropriate
- keep detail drawer richer than the list row
- preserve workflow package and preset tabs from the existing plan
- visually demote legacy items without hiding needed compatibility data

## Acceptance

- admins can browse business roles, packages, and presets without switching mental models
- detail view explains each item without opening code or raw config
- legacy, migration, and audit-adjacent companion flows remain discoverable rather than being hidden by the cleaner catalog UI

---

# UX-RBAC-03 - Roles & Permissions Page Reframe

## Goal

Reduce the current raw-editor feel of `RolesPermissionsPage.jsx`.

## Changes

- add cleaner role selection surface
- make role meaning and warnings more prominent
- keep permission editing available but secondary
- add clearer distinction between:
  - composable runtime roles
  - legacy compatibility roles
  - label-only business roles

## Acceptance

- role editing no longer feels like a spreadsheet-first screen
- dangerous or legacy roles are recognizable before selection

---

# UX-RBAC-04 - Assignment Workspace Re-organization

## Goal

Make assignments easier to understand than the current long multipurpose page.

## Changes

- preserve current capability
- reorganize into calmer panels:
  - people directory
  - business assignment bundles
  - raw role/package assignment tools
  - delegation / temporary coverage
- make preset-based assignment the primary guided path
- keep raw role row creation available but visually secondary

## Acceptance

- admins can understand the normal assignment path at a glance
- advanced raw-role operations remain available without dominating the page
- delegation, invite, and compatibility operations are still reachable without fallback to removed legacy screens

---

# UX-RBAC-05 - Matrix View Upgrade

## Goal

Introduce a cleaner matrix view without making it the only way to understand authority.

## Changes

- create a matrix mode for cross-role or cross-package comparison
- allow module-family grouping
- allow scope-aware hints
- show granted / not granted / companion-only / legacy indicators distinctly

## Acceptance

- matrix is useful for comparison
- matrix is not required for basic role understanding

---

# UX-RBAC-06 - SoD and Audit Summary Cards

## Goal

Make SoD and audit visibility feel operational instead of buried.

## Changes

- add a dedicated SoD summary surface
- split BLOCK vs WARN clearly
- show affected assignments / roles / packages where available
- link out to deeper audit and diagnostics pages

## Acceptance

- risky combinations are visible quickly
- admins can move from warning to action without hunting through unrelated pages

---

# UX-RBAC-07 - Diagnostics Entry Surface

## Goal

Create a clear bridge from admin catalog/assignments into access debugging.

## Changes

- add obvious entry points to:
  - access debugger
  - effective authority preview
  - runtime explainability references
- surface these near selected user / selected role / selected package context

## Acceptance

- admins can move from "what is this role?" to "why can this user act?" cleanly

---

## Visual Language Direction

### Direction

Use a cleaner, more organized enterprise shell with:

- lighter summary surfaces
- fewer simultaneous forms
- stronger section hierarchy
- richer detail panels
- calm accent usage instead of heavy saturation everywhere

### Typography

Keep current repo typography stack, but improve hierarchy through weight, spacing, and grouping rather than more font variety.

### Color

Use domain tinting carefully for:

- Security
- Finance
- Payroll
- Audit
- Close
- AR/AP
- Inventory
- Consolidation

Do not let domain color become the only navigation signal.

### Motion

Use minimal motion:

- section transition
- drawer slide
- hover emphasis

No decorative animation-first redesign.

---

## Data / Architecture Notes

### Data model alignment required

The redesign must remain aligned to:

- `roleCatalog.js`
- current API contracts in `rbacAdmin.js`
- security admin UI state
- org-tree scope lookups
- assignment bundle grouping
- workflow package / preset metadata

### No mock-first implementation

Do not introduce temporary mock catalog or assignment models just to match the reference visuals.

### Component strategy

Prefer extracting shared components such as:

- stats strip
- filter toolbar
- card list
- detail drawer
- matrix table
- status pill group

instead of copying the example pages as monoliths.

---

## Test Plan

Keep the current repo pattern of frontend-smoke validation through backend script checks and targeted lint/build verification.

### Add or extend smokes for

- security workspace shell rendering
- catalog tab organization
- role detail / package detail / preset detail readback
- assignment workspace segmentation
- matrix rendering
- SoD summary visibility
- diagnostics entry affordances
- route and capability parity for the current security/admin feature set

### Verification minimum

- targeted ESLint
- frontend build
- backend smoke scripts for the touched pages

---

## Delivery Order

1. `UX-RBAC-01` shared shell
2. `UX-RBAC-02` catalog cleanup
3. `UX-RBAC-03` roles & permissions reframe
4. `UX-RBAC-04` assignment workspace re-organization
5. `UX-RBAC-05` matrix view upgrade
6. `UX-RBAC-06` SoD and audit summary cards
7. `UX-RBAC-07` diagnostics entry surface

---

## Success Standard

This redesign is successful when:

- the security/admin area feels like one organized workspace
- admins can browse the catalog without reading raw implementation details first
- assignments are easier to understand than they are today
- the normal path is guided and calm
- advanced capability remains available without cluttering the default UX
- the repo's current RBAC/package/preset architecture stays intact
