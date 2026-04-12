# 61 - Security Admin Redesign Tracker

## Status

- Planned
- Repo-checked against the post-cleanup snapshot
- Assumes the fresh-only security model is already in place
- Scope covers security admin information architecture, navigation, shared shell behavior, and workbench redesign
- Does not redesign unrelated company setup, organization setup, or business operation pages

## Why this track exists

Legacy retirement cleaned the model, but the admin UX is still structurally fragmented:

- `frontend/src/layouts/sidebarConfig.js` still exposes a flat security tool list under `Ayarlar`
- `frontend/src/App.jsx` still registers many first-class RBAC routes one by one
- `frontend/src/pages/security/UserAssignmentsPage.jsx` is still ~5.5k lines
- `frontend/src/pages/security/AccessModelCatalogPage.jsx` is still ~2.6k lines
- `frontend/src/pages/security/RolesPermissionsPage.jsx` is still ~1.2k lines
- `frontend/src/pages/security/AccessDebuggerPage.jsx` is still ~887 lines
- `frontend/src/pages/settings/WorkflowSetupPage.jsx` still lives as a separate setup surface at `/app/ayarlar/workflow-kurulumu`
- `frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx` already exists, but today it only wraps part of the area and does not define the canonical route model

So the next problem is no longer stale legacy behavior. The problem is now:

- information architecture
- route sprawl
- oversized page ownership
- inconsistent workbench chrome

## Repo-check outcome

### Conflict / plan gap

- Do not force `/app/ayarlar/sube-operatorleri` into the phase-1 tabbed users workbench implementation. The current redesign notes already classify local user management as a separate-owned surface, and the page uses distinct local-user-admin flows. In this track, it should stay reachable as a companion route from the new security admin area first. A later dedicated slice can decide whether it becomes an embedded tab or remains a linked surface.

### Deferred item already covered

- Old-route retirement belongs in `PR-SECUX-08`. Earlier PRs should keep the current routes alive either as full pages or explicit redirects/adapters.

### Optional hardening

- `PR-SECUX-02` should explicitly allow a small summary helper or backend aggregation endpoint if the current API surface cannot provide overview counts and warnings cheaply. Today `getSecurityAdminUiState()` only returns `tenantId` and `canManageSecurity`.
- `PR-SECUX-01` should update `frontend/src/i18n/messages.js` for the new route-family labels because `AppLayout.jsx` resolves sidebar and breadcrumb display text by route path.
- Each PR should define redirect and parity smoke coverage by extending the existing `test:security:ui*` scripts instead of relying only on manual QA.
- The new tabbed routes should lock deep-link query conventions early, for example `tab`, `userId`, `roleCode`, `packageCode`, `definitionId`, shared scope filters, and table-state keys such as `page`, `pageSize`, `sort`, `search`, and `view`, so later PRs do not invent incompatible query-state shapes.

## Locked decisions

- One new top-level settings area will exist:
  - Turkish: `Kullanici ve Erisim Yonetimi`
  - English: `Security Administration`
- Sidebar should show fewer primary security entries
- Most current flat RBAC routes should become tabs inside workbenches, not long-term first-class sidebar links
- Existing backend APIs should be reused first
- This track is refactor-first, redesign-second
- Old routes may stay temporarily as redirects or compatibility wrappers during the transition
- The new `/app/ayarlar/security-admin/*` family becomes canonical as soon as the regrouping lands, even when a workbench route still delegates to a current page body through a tab-based adapter
- Real workbench-native page bodies should land incrementally in `PR-SECUX-03` through `PR-SECUX-06`; `PR-SECUX-01` should not try to physically split every domain at once
- Workflow governance stays inside the same admin family, but does not need to be merged into the same physical page in phase 1
- Local user management at `/app/ayarlar/sube-operatorleri` stays reachable in phase 1, but should be treated as a companion route until owner/alignment work is done

## Non-goals

- Do not redesign unrelated settings surfaces such as company onboarding, organization management, tax setup, FX setup, or consolidation setup
- Do not rewrite existing security APIs before the route and workbench structure is stable
- Do not merge every security capability into one mega-page
- Do not remove old routes before replacement workbenches and redirect coverage exist
- Do not reintroduce retired legacy-security behavior into the redesign

## Target navigation model

### New sidebar structure under `Ayarlar`

- `Benim Ayarlarim`
  - `Delegasyonlarim`
- `Platform Kurulumu`
  - existing org/setup pages stay where they are
- `Kullanici ve Erisim Yonetimi`
  - `Genel Bakis`
  - `Kullanicilar ve Atamalar`
  - `Erisim Katalogu`
  - `Workflow Governance`
  - `Tanilama ve Denetim`

### Old route mapping

#### Users & Assignments workbench

Absorbs:

- `/app/ayarlar/rbac/user-assignments`
- `/app/ayarlar/rbac/scope-assignments`
- `/app/ayarlar/rbac/delegations`
- `/app/ayarlar/rbac/temporary-coverage`

Phase-1 companion route only:

- `/app/ayarlar/sube-operatorleri`

#### Access Catalog workbench

Absorbs:

- `/app/ayarlar/rbac/access-model`
- `/app/ayarlar/rbac/roles-permissions`
- `/app/ayarlar/rbac/field-visibility-policies`
- `/app/ayarlar/rbac/group-ap-post-extension`

#### Workflow Governance workbench

Absorbs:

- `/app/ayarlar/workflow-kurulumu`

#### Diagnostics & Audit workbench

Absorbs:

- `/app/ayarlar/rbac/access-debugger`
- `/app/ayarlar/rbac/compliance-reports`
- `/app/ayarlar/rbac/audit-logs`
- `/app/ayarlar/rbac/raw-audit-logs`
- `/app/ayarlar/rbac/sensitive-data-audit`

## Recommended route model

Create a new route family:

```text
/app/ayarlar/security-admin
/app/ayarlar/security-admin/users
/app/ayarlar/security-admin/catalog
/app/ayarlar/security-admin/workflows
/app/ayarlar/security-admin/diagnostics
```

Use query tabs inside them:

```text
/app/ayarlar/security-admin/users?tab=users
/app/ayarlar/security-admin/users?tab=assignments
/app/ayarlar/security-admin/users?tab=scopes
/app/ayarlar/security-admin/users?tab=delegations
/app/ayarlar/security-admin/users?tab=coverage

/app/ayarlar/security-admin/catalog?tab=access-model
/app/ayarlar/security-admin/catalog?tab=roles
/app/ayarlar/security-admin/catalog?tab=field-visibility
/app/ayarlar/security-admin/catalog?tab=group-ap-post

/app/ayarlar/security-admin/workflows?tab=definitions
/app/ayarlar/security-admin/workflows?tab=assignments
/app/ayarlar/security-admin/workflows?tab=coverage
/app/ayarlar/security-admin/workflows?tab=records
/app/ayarlar/security-admin/workflows?tab=setup

/app/ayarlar/security-admin/diagnostics?tab=access
/app/ayarlar/security-admin/diagnostics?tab=compliance
/app/ayarlar/security-admin/diagnostics?tab=audit
/app/ayarlar/security-admin/diagnostics?tab=raw-audit
/app/ayarlar/security-admin/diagnostics?tab=sensitive-data
```

During transition:

- current RBAC routes should redirect to the equivalent tabbed workbench route
- canonical workbench routes should first render the existing page bodies by selected `tab` until each domain redesign PR replaces that adapter with a native workbench implementation
- `/app/ayarlar/sube-operatorleri` should remain directly reachable until its ownership and embedding decision is settled
- deep-link query migration should preserve selected object state where practical

## PR-SECUX-00 - IA lock and route strategy

### Goal

Lock the new information architecture, route family, and transition rules before changing live navigation.

### Files

- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/App.jsx`
- `frontend/src/i18n/messages.js`
- `frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx`
- this tracker doc in `PR-STEPS/`

### Changes

1. Define the new top-level area:
   - `Kullanici ve Erisim Yonetimi`
2. Lock the canonical route family:
   - `/app/ayarlar/security-admin/*`
3. Decide which current pages become:
   - sidebar items
   - tabbed workbench routes
   - redirect-only compatibility routes
   - companion routes that remain standalone in phase 1
4. Lock the phase-1 rule for `/app/ayarlar/sube-operatorleri`:
   - reachable from the new area
   - not embedded as a required tab implementation yet
5. Lock the deep-link query contract for:
   - tab selection
   - selected-object state
   - persisted table state such as `page`, `pageSize`, `sort`, `search`, and `view`

### Acceptance

- Repo has one explicit target IA
- Reviewers can see exactly which old routes survive as redirects and which survive as standalone companion routes
- No internal page redesign is required yet

## PR-SECUX-01 - Sidebar and route regrouping

### Goal

Replace the flat security menu with the new grouped admin structure.

### Files

- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/App.jsx`
- `frontend/src/i18n/messages.js`
- `frontend/src/layouts/AppLayout.jsx`

### Changes

1. Add the new sidebar section:
   - `Kullanici ve Erisim Yonetimi`
2. Add submenu items:
   - `Genel Bakis`
   - `Kullanicilar ve Atamalar`
   - `Erisim Katalogu`
   - `Workflow Governance`
   - `Tanilama ve Denetim`
3. Add the new route entries under `/app/ayarlar/security-admin/*`
4. Remove flat first-class sidebar links for the long-term absorbed RBAC pages
5. Keep old routes alive as redirects to the new workbench tabs
6. Keep `/app/ayarlar/sube-operatorleri` reachable without forcing a route deletion

### Acceptance

- Sidebar is no longer a flat security tool list
- Security surfaces are grouped by admin mental model
- Old deep links still work
- New route labels render correctly in sidebar and breadcrumbs

### Important note

This PR changes navigation only. Do not redesign page internals yet.

Canonical workbench routes in this PR may use thin route-adapter components that choose which current page to render from `tab=...`. That is expected in phase 1 and should be replaced later by true workbench-native implementations in the domain PRs.

## PR-SECUX-02 - Security admin landing page

### Goal

Create a real landing page for the new admin area.

### New page

- `frontend/src/pages/security/SecurityAdminOverviewPage.jsx`

### Supporting files

- `frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx`
- `frontend/src/api/rbacAdmin.js`
- a small frontend summary helper or additive backend summary endpoint if reuse-first is not enough

### What the page should show

- active users
- direct assignments count
- workflow package assignments count
- delegation count
- temporary coverage count
- workflow definition or assignment count
- quick links into catalog, users, diagnostics, and workflows
- top warnings:
  - missing workflow coverage
  - conflicting access posture
  - recent audit signal if available

### Repo-fit note

`SecurityAdminWorkspaceShell.jsx` already expresses the area concept. This PR should turn that concept into the main landing surface instead of repeating mini navigation inside each page.

The early independent surfaces in this track are the overview page, the shared shell, and the canonical route adapters. The large domain pages should only become physically independent workbench implementations in their later PRs.

### Acceptance

- `/app/ayarlar/security-admin` becomes the main entry point
- Admin lands on an overview instead of a random tool page
- Quick actions point into the new workbenches

## PR-SECUX-03 - Users & Assignments workbench

### Goal

Turn the current assignment-related sprawl into one coherent workbench.

### Files

- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/UserAssignmentWorkbench.jsx`
- `frontend/src/pages/security/ApprovalDelegationsPage.jsx`
- `frontend/src/pages/security/TemporaryOperationalCoveragePage.jsx`
- `frontend/src/pages/security/ScopeAssignmentsPage.jsx`
- `frontend/src/pages/security/userAssignmentAuthorityPreview.js`
- possible new files:
  - `frontend/src/pages/security/SecurityUsersWorkbenchPage.jsx`
  - `frontend/src/pages/security/components/users/*`

### Target tabs

- `Users`
- `Assignments`
- `Scope Access`
- `Delegations`
- `Temporary Coverage`

### Structural goal

`UserAssignmentsPage.jsx` should stop being the place that does everything. Break the area into:

- workbench orchestration shell
- user list panel
- selected user summary panel
- tabbed content sections
- authority review that stays inside the selected-user surface without needing a duplicate tab

### What to preserve

- existing assignment APIs
- workflow package assignment flows
- bundle, preset, and direct runtime-role visibility
- selected-user detail behavior
- links into compliance and audit where needed

### Important repo-fit note

- `/app/ayarlar/sube-operatorleri` should be linked from this workbench as a companion surface in phase 1
- it is not required to become an embedded tab in this PR

### Acceptance

- Users and related assignment tools live in one workbench
- Delegations and temporary coverage no longer feel like separate products
- The page is materially smaller and easier to reason about
- Authority review stays easy to reach without a duplicate tab

## PR-SECUX-04 - Access Catalog workbench

### Goal

Separate catalog definition from user assignment and make the access model readable.

### Files

- `frontend/src/pages/security/AccessModelCatalogPage.jsx`
- `frontend/src/pages/security/RolesPermissionsPage.jsx`
- `frontend/src/pages/security/FieldVisibilityPoliciesPage.jsx`
- `frontend/src/pages/security/GroupApPostExtensionPage.jsx`
- `frontend/src/pages/security/roleCatalog.js`
- possible new files:
  - `frontend/src/pages/security/SecurityCatalogWorkbenchPage.jsx`
  - `frontend/src/pages/security/components/catalog/*`

### Target tabs

- `Access Model`
- `Roles & Permissions`
- `Field Visibility`
- `Group AP Posting`

### Structural goal

- `AccessModelCatalogPage.jsx` becomes the catalog shell instead of the giant everything page
- `RolesPermissionsPage.jsx` becomes a focused editor/detail tab inside that shell instead of a detached route in the long term

### What to preserve

- role catalog helpers
- workflow package catalog
- workflow preset catalog
- permission detail and assignment awareness
- links to workflow governance and users workbench

### What to improve

- make object hierarchy obvious:
  - business roles
  - runtime roles
  - workflow packages
  - workflow presets
- make “what this thing is” and “where it is used” obvious
- move edit actions into consistent detail surfaces

### Acceptance

- Catalog feels like one domain
- Roles page no longer feels detached from the access-model page
- Group AP extension is positioned as a governance capability instead of a random extra page

## PR-SECUX-05 - Workflow Governance redesign

### Goal

Make workflow governance feel like an admin workbench, not only a guided setup wizard.

### Files

- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/components/*`
- `frontend/src/pages/settings/workflows/utils/*`
- possible new wrapper:
  - `frontend/src/pages/security/SecurityWorkflowWorkbenchPage.jsx`

### Target tabs

- `Definitions`
- `Assignments`
- `Coverage`
- `Records`
- `Setup / Edit Wizard`

### Key repo-fit observation

`WorkflowSetupPage.jsx` already has useful seams:

- definition step
- assignment step
- review step
- records section
- coverage diagnostics
- routing matrix

So the redesign should reframe it, not rewrite it from scratch.

### Strategy

1. Make list/detail the primary entry
2. Keep the wizard only for create and edit flows
3. Surface records and coverage as first-class tabs
4. Keep current reusable workflow components where possible

### Acceptance

- Workflow governance becomes inspectable before it becomes editable
- Create and edit still work, but the wizard is no longer the whole mental model
- Links from catalog and governed runtime pages feel natural

## PR-SECUX-06 - Diagnostics & Audit workbench

### Goal

Unify explainability, compliance, and audit into one investigation surface.

### Files

- `frontend/src/pages/security/AccessDebuggerPage.jsx`
- `frontend/src/pages/security/ComplianceReportsPage.jsx`
- `frontend/src/pages/security/RbacAuditLogsPage.jsx`
- `frontend/src/pages/security/RawAuditLogsPage.jsx`
- `frontend/src/pages/security/SensitiveDataAuditPage.jsx`
- `frontend/src/pages/security/accessDiagnosticsSummary.js`
- possible new files:
  - `frontend/src/pages/security/SecurityDiagnosticsWorkbenchPage.jsx`

### Target tabs

- `Access Explainability`
- `Compliance`
- `RBAC Audit`
- `Raw Audit`
- `Sensitive Data Audit`

### Structural goal

These pages should look like one investigation family instead of five unrelated reports.

### What to preserve

- existing data APIs
- explainability summary logic
- audit log tables
- compliance report surfaces

### What to improve

- shared filters where practical:
  - user
  - scope
  - role or package
  - time window
- consistent summary header
- easy jump from explainability to raw evidence

### Acceptance

- Diagnostics and audit feel like one workbench
- Access debugger becomes the starting point for “why can’t this user act?”
- Audit tabs become the evidence layer behind it

## PR-SECUX-07 - Shared shell, page chrome, and component seams

### Goal

Finish the redesign by standardizing shared shell behavior across the new workbenches.

### Files

- `frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx`
- new shared components under `frontend/src/pages/security/components/`
- any tab shell, header, summary strip, or right-panel components

### Changes

1. Turn `SecurityAdminWorkspaceShell` into a true shared shell
2. Standardize:
   - page header
   - summary strip
   - tabs
   - companion links
   - right-side help or explainability panel
3. Remove repeated per-page mini workspace-navigation blocks
4. Normalize empty states, loading states, and header actions

### Acceptance

- The new security area feels like one product
- Workbenches share a consistent visual grammar
- Repetition across large pages is reduced

### Implementation caution

Keep this PR disciplined. It should standardize shared chrome and scaffolding only:

- page header
- summary strip
- tabs
- right-side companion or explainability panel
- empty and loading states

It should not become a hidden second redesign of every workbench's internal flows at once.

## PR-SECUX-08 - Route cleanup and old page retirement

### Goal

After the new workbenches are stable, retire the old route sprawl.

### Files

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/i18n/messages.js`
- any old page files that have become wrappers only

### Changes

1. Decide which old routes:
   - stay as redirects
   - stay as deep-link aliases
   - are removed
2. Remove wrapper pages that no longer add value
3. Simplify route labels for retired paths
4. Keep bookmarks safe with redirect shims where needed

### Acceptance

- New route model is the canonical one
- Old route sprawl is no longer the main architecture
- No dead pages remain unless intentionally kept as aliases

## Recommended implementation order

1. `PR-SECUX-00` - IA lock and route strategy
2. `PR-SECUX-01` - Sidebar and route regrouping
3. `PR-SECUX-02` - Security admin landing page
4. `PR-SECUX-03` - Users & Assignments workbench
5. `PR-SECUX-04` - Access Catalog workbench
6. `PR-SECUX-05` - Workflow Governance redesign
7. `PR-SECUX-06` - Diagnostics & Audit workbench
8. `PR-SECUX-07` - Shared shell and component seams
9. `PR-SECUX-08` - Route cleanup and old page retirement

## Why this order is right

The biggest risk is not visual design. The risk is breaking navigation and mental model while the giant pages still exist.

This order does the safe thing:

- first lock IA
- then change navigation
- then create a proper landing page
- then split the biggest domain first: users and assignments
- then catalog
- then workflow
- then diagnostics
- then shared shell normalization
- then final route cleanup

That keeps review scope controlled and avoids one giant redesign PR.

## Test and rollout rule

Each PR in this track should keep or extend the current security smoke safety net. At minimum:

- existing `test:security:ui1*` through `test:security:ui5*` scripts stay green when their covered surfaces still exist
- new workbench or redirect slices add parity smoke coverage before old entry points are removed
- frontend build passes
- targeted route redirect behavior is tested before old sidebar entries disappear

## Final acceptance for the whole redesign track

This track is complete when:

- sidebar shows one coherent security admin area
- flat security route clutter is gone
- users and assignments are one workbench
- catalog and model surfaces are one workbench
- workflow governance is inspectable and not only wizard-driven
- diagnostics and audit are one investigation family
- old route sprawl is retired or reduced to redirects
- the whole area feels like one enterprise admin system instead of many unrelated admin tools
