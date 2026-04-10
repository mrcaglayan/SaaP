# Security Admin Workspace UX Redesign Plan

## Status

- Planned
- Companion to `07-RolePermissionAdminPagePlan.md`
- Uses `Example of User Management Pages` as a visual reference only
- Assumes implementation inside the existing security/admin area, not a greenfield replacement
- Superseded for security/RBAC legacy surfaces by `PR-STEPS/59-SECURITY-RBAC-LEGACY-RETIREMENT-ADJUSTED-PLAN.md`

### Security Legacy Retirement Overlay

`PR-STEPS/59-SECURITY-RBAC-LEGACY-RETIREMENT-ADJUSTED-PLAN.md` is now the current source of truth for retiring live-product security migration surfaces.

This means the earlier preservation requirements for the following are intentionally reversed:

- Role Migrations
- Legacy Migration Visibility
- `legacy_catalog`
- fresh-tenant legacy visibility behavior

The non-regression rule still applies to all non-retired security/admin companion surfaces. If old security-role data migration is ever needed, it must live in a separate one-off migration utility outside the live product, not in the admin UX.

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
- fresh-tenant-only security role visibility is the target after the legacy retirement track
- pages must be permission-gated
- pages must be API-backed
- pages must use repo i18n
- current security/admin state spans assignments, delegations, diagnostics, presets, and legacy seams that are being retired separately

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

No current security/admin capability may be silently dropped during the redesign, except for security/RBAC legacy migration surfaces explicitly retired by `PR-STEPS/59-SECURITY-RBAC-LEGACY-RETIREMENT-ADJUSTED-PLAN.md`.

Reorganization is allowed.

Feature loss is not, unless it is an intentional retirement decision captured in the security/RBAC legacy retirement track.

---

## Non-Regression Rule

This redesign is only valid if it preserves current non-retired capability while improving structure.

That means:

- pages may be regrouped
- pages may share one cleaner shell
- pages may move behind better tabs, drawers, or linked detail flows
- current non-retired features may **not** disappear just because they are visually secondary in the new UX

If a current page is merged into a new workspace flow, the rollout must provide:

- an equivalent reachable entry point
- the same permission gate behavior
- the same core actions
- route continuity through either preserved paths or explicit redirects
- smoke coverage proving the feature still exists

---

## Current Feature Preservation Matrix

The matrix below applies to non-retired security/admin capability. Security/RBAC legacy migration surfaces are intentionally retired by `PR-STEPS/59-SECURITY-RBAC-LEGACY-RETIREMENT-ADJUSTED-PLAN.md`.

### Primary workspace surfaces that must remain first-class

- Access Model Catalog
- Roles & Permissions
- User Assignments

### Companion security/admin surfaces that must remain reachable

- Local User Management (out of scope for this plan — separate owner, will be addressed independently)
- Scope Assignments
- Field Visibility Policies
- Approval Delegations
- Temporary Operational Coverage
- Access Debugger
- Group AP Post Extension, only if rewritten as fresh AP group-posting governance without legacy catalog or migration links
- Compliance Reports
- RBAC Audit Logs
- Raw Audit Logs
- Sensitive Data Audit

### Security/RBAC legacy surfaces intentionally retired

- Role Migrations
- Legacy Migration Visibility
- `legacy_catalog`
- fresh-tenant legacy visibility behavior

### Capability parity that must survive the redesign

- browse business roles, workflow packages, and workflow presets
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
- retain audit surfaces
- use the fresh-tenant security role model as the only steady-state UX model
- retain permission conflict detection on assignment creation (`buildCombinedRoleAssignmentWarnings`)
- retain data scope management (ALLOW/DENY narrowing beyond role scopes) via Scope Assignments companion page
- retain field visibility policy management via its companion page
- retain approval escalation visibility (escalation timers, auto-escalation state) reachable from Diagnostics or Audit

### Current non-retired route inventory that must stay reachable during rollout

- `/app/ayarlar/sube-operatorleri` (out of scope — separate owner)
- `/app/ayarlar/rbac/access-model`
- `/app/ayarlar/rbac/roles-permissions`
- `/app/ayarlar/rbac/user-assignments`
- `/app/ayarlar/rbac/scope-assignments`
- `/app/ayarlar/rbac/field-visibility-policies`
- `/app/ayarlar/rbac/delegations`
- `/app/ayarlar/rbac/temporary-coverage`
- `/app/ayarlar/rbac/access-debugger`
- `/app/ayarlar/rbac/group-ap-post-extension` (only if retained as fresh AP group-posting governance)
- `/app/ayarlar/rbac/compliance-reports`
- `/app/ayarlar/rbac/audit-logs`
- `/app/ayarlar/rbac/raw-audit-logs`
- `/app/ayarlar/rbac/sensitive-data-audit`

### Route migration rule

- no current non-retired route is removed in the same PR that introduces the new shell
- if a route is consolidated into the workspace later, it must redirect to the equivalent tab/section state
- sidebar changes must preserve discoverability for lower-frequency admin utilities

### Test gate rule

- existing `security-ui0a` through current `security-ui5a` smoke coverage remains part of the redesign safety net
- redesign PRs must extend or replace stale frontend smokes instead of bypassing them
- add dedicated parity smokes before deleting any old entry point or major section chrome

### Per-slice test minimum

Each slice must pass the following before merge:

- all existing security-ui smoke tests still green
- a new parity smoke proving the slice's primary surface renders and shows correct data (e.g. catalog tabs render correct entry counts, assignment workspace shows users)
- route redirect tests for any paths consolidated into the shell in that slice
- targeted ESLint and frontend build pass

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
- visible fresh security model boundaries

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

The non-retired companion pages remain reachable and explicitly linked from the shell during early rollout:

- Access Debugger
- Approval Delegations
- Temporary Operational Coverage
- Scope Assignments
- Field Visibility Policies
- Group AP Post Extension, only if retained as fresh AP group-posting governance
- Compliance Reports
- RBAC Audit Logs
- Raw Audit Logs
- Sensitive Data Audit
- Local User Management

This keeps the first redesign slice realistic without implying non-retired pages are abandoned. Role Migrations, Legacy Migration Visibility, and the legacy catalog are retired by the security/RBAC legacy retirement track.

### Route architecture

The workspace shell reuses the existing `/app/ayarlar/rbac/` prefix. Sections map to URL state so deep-links and browser back/forward work correctly.

Target route mapping:

- `/app/ayarlar/rbac/access-model` — workspace shell, Catalog section (default)
  - `?tab=business_roles` / `?tab=workflow_packages` / `?tab=workflow_presets`
- `/app/ayarlar/rbac/roles-permissions` — workspace shell, Catalog section, Roles & Permissions focus
- `/app/ayarlar/rbac/user-assignments` — workspace shell, Assignments section

When an existing route is consolidated into the workspace shell:

- the old path must redirect to the equivalent shell section + tab state
- redirects land in the same PR or one preceding it — never deferred to a later PR

Non-retired companion routes that remain standalone during early rollout:

- `/app/ayarlar/sube-operatorleri` — out of scope for this plan (separate owner)
- `/app/ayarlar/rbac/scope-assignments`
- `/app/ayarlar/rbac/field-visibility-policies`
- `/app/ayarlar/rbac/delegations`
- `/app/ayarlar/rbac/temporary-coverage`
- `/app/ayarlar/rbac/access-debugger`
- `/app/ayarlar/rbac/group-ap-post-extension` (only if retained as fresh AP group-posting governance)
- `/app/ayarlar/rbac/compliance-reports`
- `/app/ayarlar/rbac/audit-logs`
- `/app/ayarlar/rbac/raw-audit-logs`
- `/app/ayarlar/rbac/sensitive-data-audit`

These are linked from the shell sidebar or utility links but keep their own routes until explicitly consolidated in a later slice.

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

### Specific patterns to adopt from the example

- **Domain-colored sidebar filter** (`RolesPage.jsx` left panel): domain buttons with counts, maps well to workflow families (AP_DOCUMENT_POSTING, LOCAL_CLOSE_PACK, PERIOD_CLOSE, CONSOLIDATION_RUN). Use for Catalog and Assignment surfaces.
- **Inline SoD indicator on cards** (`RolesPage.jsx` RoleCard): AlertTriangle badge on catalog cards where SoD conflicts exist. Complements the dedicated SoD summary in UX-RBAC-06 — both should exist.
- **Scope level pills** (`RoleDetail.jsx`): render all 5 scope levels as active/inactive pills instead of plain text. Adopt as standard detail drawer pattern across all catalog tabs.
- **Permissions grouped by module** (`RoleDetail.jsx`): collapsible module sections with permission descriptions and dependency badges (e.g. "Requires READ"). Carry forward into UX-RBAC-02 and UX-RBAC-03 detail views.
- **User assignment cards with temporal badges** (`UserAssignments.jsx`): `Temporal` badge with date ranges, ALLOW/DENY effect pills, scope initial badges. Adopt for the assignment workspace in UX-RBAC-04.
- **SoD split by enforcement level** (`SoDRules.jsx`): BLOCK and WARN sections with stat cards and per-rule conflict pairs. Use as the layout reference for UX-RBAC-06.

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
- missing fresh-tenant security role behavior

---

## Implementation Slices

# UX-RBAC-01 - Shared Workspace Shell

## Status

- Completed on April 9, 2026
- Revalidated on April 9, 2026 after route/state and shell follow-up patches
- Shared shell implemented for:
  - `AccessModelCatalogPage.jsx`
  - `RolesPermissionsPage.jsx`
  - `UserAssignmentsPage.jsx`
- Companion security/admin routes remain reachable from both the sidebar and the new shell
- Shell now exposes the stable 4-section map:
  - Catalog
  - Assignments
  - Diagnostics
  - Audit & SoD
- Primary wrapped surfaces are still limited to the first rollout set:
  - `AccessModelCatalogPage.jsx`
  - `RolesPermissionsPage.jsx`
  - `UserAssignmentsPage.jsx`

## Implementation notes

- Shared component extracted:
  - `frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx`
- Current shell responsibilities:
  - shared page header
  - summary stat strip
  - stable workspace section map
  - primary-surface navigation
  - permission-aware companion route cards
- Current page-local responsibilities that are **not** yet extracted:
  - catalog tab rail and detail drawer inside `AccessModelCatalogPage.jsx`
  - role selection/detail surface inside `RolesPermissionsPage.jsx`
  - assignment workspace tab rail inside `UserAssignmentsPage.jsx`
- The shell now supports the full 4-section workspace architecture, but only the 3 primary surfaces are wrapped directly in this slice
- URL-backed state confirmed in the first shell rollout:
  - catalog tab + selected item via `/app/ayarlar/rbac/access-model?...`
  - assignment workspace tab state via `/app/ayarlar/rbac/user-assignments?...`

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

## Status

- Completed on April 9, 2026
- Delivered in `frontend/src/pages/security/AccessModelCatalogPage.jsx`
- Revalidated with focused catalog shell/backend smoke coverage on April 9, 2026

## Implementation notes

- Business Roles now render as browse-first cards with starter-package guidance and scoped action affordances
- Workflow Packages now use card/list hybrids with:
  - runtime mapping summary
  - workflow-family browse rail
  - grouped permission-module detail in the drawer
- Workflow Presets now surface business-flow cards, step previews, and richer ordered-step detail
- Historical note: legacy catalog demotion shipped in this slice, but `PR-STEPS/59-SECURITY-RBAC-LEGACY-RETIREMENT-ADJUSTED-PLAN.md` supersedes it and retires the live legacy catalog surface.
- Scope level pills are now the standard drawer pattern across catalog tabs
- Detail drawers stay richer than the list cards and remain the place where mapping, warnings, and deeper explanation live

## Goal

Refactor the catalog area into a cleaner browse-first experience.

## Changes

- make Business Roles the most readable catalog tab
- convert dense rows into card/list hybrids where appropriate
- keep detail drawer richer than the list row
- preserve workflow package and preset tabs from the existing plan
- remove legacy catalog exposure through the security/RBAC legacy retirement track

## Acceptance

- admins can browse business roles, packages, and presets without switching mental models
- detail view explains each item without opening code or raw config
- audit-adjacent companion flows remain discoverable; legacy and migration flows are intentionally retired by the security/RBAC legacy retirement track

---

# UX-RBAC-03 - Roles & Permissions Page Reframe

## Status

- Completed on April 9, 2026
- Delivered in `frontend/src/pages/security/RolesPermissionsPage.jsx`
- Revalidated with focused role-editor/backend smoke coverage on April 9, 2026

## Implementation notes

- Role selection now uses a browse-first list/detail surface instead of a spreadsheet-first editor
- Added a role-meaning filter rail that separates:
  - composable runtime roles
  - label-only business roles
  - legacy compatibility roles before the retirement track superseded that surface
- Selected-role detail now makes meaning, scope posture, and warnings prominent before permission editing
- Permission editing remains available but now sits in grouped permission-module sections with dependency badges
- Hidden, companion, and label-only states are visible directly on selection cards and in the detail surface; legacy role visibility is superseded by the retirement track
- Runtime-role creation remains available but is visually demoted behind the new meaning-first browsing flow

## Goal

Reduce the current raw-editor feel of `RolesPermissionsPage.jsx`.

## Changes

- add cleaner role selection surface
- make role meaning and warnings more prominent
- keep permission editing available but secondary
- add clearer distinction between:
  - composable runtime roles
  - label-only business roles

## Acceptance

- role editing no longer feels like a spreadsheet-first screen
- dangerous non-retired roles are recognizable before selection

---

# UX-RBAC-04 - Assignment Workspace Re-organization

## Status

- Completed on April 9, 2026
- Delivered in `frontend/src/pages/security/UserAssignmentsPage.jsx`, `frontend/src/pages/security/UserAssignmentWorkbench.jsx`, and `backend/src/routes/security.js`
- Revalidated with focused assignment/invite/delegation coverage on April 9, 2026

## Implementation notes

- Added a workspace lane map that explicitly frames the page as:
  - people directory
  - business assignment bundles
  - raw role/package assignment tools
  - delegation / temporary coverage
- Preset-based business bundles remain the primary guided path while raw role rows stay collapsed inside the advanced flow
- Selected-user business labels and direct workflow-package grants now show lifecycle badges plus effective date windows
- Temporary coverage rows now show the same active/upcoming/expired/revoked temporal language used across delegation badges, while still preserving review-state visibility
- The users API now projects pending invite metadata from `user_invites`, so invited users appear in the directory beside active and disabled users with visible invite expiry
- Permission conflict warnings remain surfaced through the existing `assignmentWarnings` / `SecurityWarningList` flow

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
- show temporal assignment visibility:
  - active / upcoming / expired indicators on assignments with effective_from / effective_to dates
  - delegation and coverage temporal status (ACTIVE, UPCOMING, EXPIRED, REVOKED) with date ranges
  - temporal badge styling consistent with the example UX pattern
- show invite status in the people directory:
  - INVITED users visible alongside ACTIVE and DISABLED users
  - pending invite status and expiry visible per user
  - this prevents invite management from being orphaned when companion pages are not yet consolidated
- preserve permission conflict warnings on assignment creation (currently in `buildCombinedRoleAssignmentWarnings`)

## Acceptance

- admins can understand the normal assignment path at a glance
- advanced raw-role operations remain available without dominating the page
- delegation, invite, and compatibility operations are still reachable without fallback to removed legacy screens
- temporal assignments and delegations are visually distinguishable from permanent ones
- pending invites are visible in the people directory without navigating to a separate page

---

# UX-RBAC-05 - Matrix View Upgrade

## Status

- Completed on April 9, 2026
- Delivered in `frontend/src/pages/security/AccessModelCatalogPage.jsx`
- Revalidated with focused catalog matrix coverage on April 9, 2026

## Implementation notes

- Added a URL-backed `browse` / `matrix` view toggle so comparison stays secondary and the browse cards plus detail drawer remain the default explanation path
- Added per-tab comparison groups:
  - business roles compare starter packages, optional packages, preset coverage, and scope coverage
  - workflow packages compare permission-module families, runtime/helper compatibility mapping, preset coverage, and scope coverage
  - workflow presets compare required packages, typical actors, ordered steps, and scope coverage
- Matrix cells now distinguish granted, not granted, companion-only, and linked posture without turning the page into the only authority explanation surface
- Added a workflow assignment routing visibility callout in matrix context that links to workflow governance and the access debugger so amount-band routing questions stay reachable

## Goal

Introduce a cleaner matrix view without making it the only way to understand authority.

## Changes

- create a matrix mode for cross-role or cross-package comparison
- allow module-family grouping
- allow scope-aware hints
- show granted / not granted / companion-only indicators distinctly
- include workflow assignment routing visibility where relevant:
  - amount band routing rules (min/max amount thresholds, priority, fallback) are a power-user feature on workflow assignments
  - the matrix or a linked diagnostic view should surface which assignment resolves for a given scope + amount combination
  - this is not the primary matrix purpose, but the data should be reachable from the matrix or from UX-RBAC-07

## Acceptance

- matrix is useful for comparison
- matrix is not required for basic role understanding
- amount band routing configuration is visible or linked from the matrix context when workflow assignments are compared

---

# UX-RBAC-06 - SoD and Audit Summary Cards

## Status

- Completed on April 9, 2026
- Delivered in `frontend/src/pages/security/UserAssignmentsPage.jsx`, `frontend/src/pages/security/UserAssignmentWorkbench.jsx`, and `frontend/src/pages/security/userAssignmentAuditSummary.js`
- Revalidated with focused assignment-audit coverage on April 9, 2026

## Implementation notes

- Added a dedicated `Audit & SoD summary` surface above the assignment workbench so tenant-wide risk signals appear before the deeper per-user editor
- Added a tenant-wide `SOD_ANALYSIS` preview fetch, split `BLOCK` vs `WARN` summary cards clearly, and surfaced per-conflict role sets plus overlapping scopes where the backend report returns them
- Combined the tenant-wide snapshot with the selected user's local UI-level warning summary so affected packages, runtime-role labels, and recent assignment audit items remain visible in one operational surface
- Added direct handoff links to compliance reports, RBAC audit logs, and the access debugger, with permission-aware disabled states instead of burying the next action in unrelated pages
- Kept the existing detailed workbench section but upgraded its warning cards to show affected packages and affected roles directly

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

### Visual density benchmark

The example components (`RolesPage.jsx`, `RoleDetail.jsx`, `SoDRules.jsx`) demonstrate the target visual density. Use them as the benchmark for:

- card sizing and padding (`p-4 rounded-xl`)
- border radius and border weight (`border-gray-100`, `rounded-xl`)
- stat strip layout (small `rounded-xl` cards with bold number + muted label)
- domain color application (tinted backgrounds + matching text, not heavy fills)
- detail panel information density (section headers as `text-xs uppercase tracking-wider`, content as `text-sm`)

The example is visually closer to the plan's target than the current implementation. Current security pages are denser and more form-heavy. The redesign should converge toward the example's weight and spacing.

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
