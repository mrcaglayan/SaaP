Yes — here is the PR-style implementation plan for converting your current page into the new **ERP-style two-page flow**.

This plan is based on your existing `RolesPermissionsPage` structure, which currently combines:

- list/filter/create-role on the left
- selected role overview on the right
- warnings below
- permission editor below that, all in one page.

Also, your current page already has the right reusable building blocks for the detail page:

- `SelectedRoleOverviewPanel`
- `PermissionModuleEditor`
- `SecurityWarningList`
- role filtering/grouping/search state
- selected role state and permission-module grouping logic.

---

# Roles & Permissions ERP Refactor Roadmap

## Status

- Planned
- Based on current `RolesPermissionsPage` implementation
- Locked UX decision: **no split left/right workbench**
- Locked UX decision: **no breadcrumb requirement**
- Locked UX decision: **role list page + dedicated role detail page**
- Locked UX decision: detail page uses a **Back to role list** button only
- Locked UX decision: permission editing remains **tabbed and dense**, not card-heavy

---

# PR-01 — Split the current monolith into list-page vs detail-page responsibilities

## Goal

Break the current single-page workbench model into:

1. **Role list page**
2. **Role detail page**

## Why

Right now `RolesPermissionsPage` owns list browsing, selection, overview, warnings, and permission editing together, which makes the screen dense and cramped.

## Current state to refactor

The current page renders:

- left role-selection surface
- right selected-role overview
- warning block
- permission editor block.

## Files

- existing roles page file containing `RolesPermissionsPage`
- new detail page file, for example:

  - `RolePermissionsDetailPage.jsx`

- optional shared subcomponents folder for extracted list/detail pieces

## Tasks

- keep the existing page as the **catalog/list page**
- remove detail rendering from the list page
- create a new dedicated detail page component
- move selected-role-specific rendering out of the list page

## Acceptance

- list page no longer shows overview/warnings/permission editor inline
- clicking a role no longer updates an in-page right panel
- there is now a separate detail page component ready to own role editing

---

# PR-02 — Add dedicated route for role detail page

## Goal

Introduce a route-based navigation flow:

- list page
- detail page
- back button returns to list

## Why

This is the biggest UX correction. It removes the cramped two-pane workbench and makes the UI behave like a real admin catalog.

## Files

- security-admin route registry file
- new detail page component
- existing list page component

## Suggested route shape

Use whatever matches your current route conventions, but the pattern should be like:

```text
/app/ayarlar/security-admin/catalog/roles
/app/ayarlar/security-admin/catalog/roles/:roleId
```

## Tasks

- register a route for the list page
- register a route for the detail page
- on role row click, navigate to `:roleId`
- on detail page, read `roleId` from route params
- add simple back navigation button:

  - `Back to role list`

## Acceptance

- user can open a role directly by URL
- browser back works correctly
- top-left back button works correctly
- no breadcrumb required

---

# PR-03 — Convert role selection cards into a wider ERP-style role list/table

## Goal

Replace the current role-card browsing surface with a flatter, wider list/table.

## Why

Your current role selection surface uses `RoleSelectionCard`, which is visually informative but too bulky for scanning many records.

## Current state to refactor

The current page uses:

- `RoleMeaningFilterRail`
- grouped roles
- `RoleSelectionCard`
- card-style selection interaction.

## Files

- existing page
- new shared list component, for example:

  - `RoleListTable.jsx`
  - `RoleListRow.jsx`

## Tasks

- replace `RoleSelectionCard` usage with row-based rendering
- keep existing:

  - search
  - role meaning filter
  - grouped role logic

- widen columns so role names remain readable
- row columns should be approximately:

  - Role
  - Workflow family
  - Scope
  - Type
  - State

- label-only roles remain visible, but as locked rows rather than decorative cards

## UX rules

- row click opens detail page
- row hover is subtle
- no heavy badges overload
- keep label-only state visible with lock/minimal chip

## Acceptance

- list page becomes full-width
- role names are readable without truncation pressure
- browsing many roles feels lighter than the old card stack
- clicking row opens detail page

---

# PR-04 — Move selected-role content into detail-page tabs

## Goal

Turn the current selected-role blocks into tabs on the new detail page.

## Why

You already have the right content blocks; they are just in the wrong place.

## Current reusable blocks

These should be reused instead of rewritten from scratch:

- `SelectedRoleOverviewPanel`
- `PermissionModuleEditor`
- `SecurityWarningList`.

## Files

- new detail page
- optional extracted tab components:

  - `RoleOverviewTab.jsx`
  - `RolePermissionsTab.jsx`
  - `RoleWarningsTab.jsx`

## Tasks

- create detail page header with:

  - back button
  - role display name
  - muted metadata line

- add tabs:

  - Overview
  - Permissions
  - Warnings

- move overview content into Overview tab
- move grouped permission editor into Permissions tab
- move warning list into Warnings tab

## Detail page header target

Use something plain like:

```text
← Back to role list
Entity Accountant
ENTITY_ACCOUNTANT · AP Document Flow · Legal Entity
```

## Acceptance

- detail page has no split-panel feel
- each concern is isolated into a tab
- overview, warnings, and permission editing are no longer stacked one under another
- detail page feels calmer than current page

---

# PR-05 — Re-scope state so list state lives on list page, edit state lives on detail page

## Goal

Cleanly separate browsing state from editing state.

## Why

Your current page holds all of these together:

- `selectedRoleId`
- `selectedPermissionCodes`
- `roleSearchValue`
- `roleMeaningFilter`
- validation warnings
- loading/saving states.

That made sense in a one-page workbench, but not after the split.

## Files

- list page
- detail page
- any shared hooks/helpers if you choose to extract them

## Tasks

### Keep on list page

- `roleSearchValue`
- `roleMeaningFilter`
- grouped/filtering logic
- create-role form state
- list loading state

### Move to detail page

- selected role lookup by route param
- `selectedPermissionCodes`
- permission grouping
- replace-permissions save flow
- warning state related to replace action
- detail-page tab state

### Optional extraction

If you want cleaner code, extract:

- role loading hook
- permission grouping helper
- selected-role resolver helper

## Acceptance

- list page no longer tracks selected-role editing state
- detail page owns its own permission-editing state
- state boundaries match navigation boundaries

---

# PR-06 — Simplify the detail-page header and remove unnecessary decoration

## Goal

Keep the detail page professional and plain.

## Why

The mockup direction you chose is intentionally flatter and less decorative. That means the real page should avoid falling back into badge-heavy, card-heavy presentation.

## Current state to trim

The current selected-role surface includes multiple chips, metrics, guidance cards, and operational action blocks.

## Tasks

- reduce badge count in the detail header
- keep only core metadata visible
- avoid multiple stacked “meaning/guidance/operational” cards at the top
- put the real focus on the tab content
- keep summary metrics minimal:

  - saved permissions
  - warnings
  - staged selection or staged changes

## Acceptance

- detail page header is flatter and more serious
- tab content is the visual focus
- page does not feel like a dashboard

---

# PR-07 — Flatten the permissions surface into a denser ERP editing view

## Goal

Make the permissions tab feel like a real admin table/editor instead of a decorative panel.

## Why

Your current `PermissionModuleEditor` already has strong grouped logic, but it still visually reads like a panel stack rather than a dense admin editor.

## Files

- permission tab component
- optional permission table subcomponents

## Tasks

- keep module grouping
- render modules in flatter containers
- reduce decorative helper text repetition
- make permission rows more table-like
- keep dependency labels visible
- keep sticky save area compact
- keep label-only roles locked and non-editable

## Keep

- grouped module logic
- checkbox selection logic
- replace permissions flow
- dependency/read hints

## Acceptance

- permissions tab is denser and easier to scan
- save area remains visible without dominating screen
- editing a runtime role feels structured
- viewing a label-only role feels clearly read-only

---

# PR-08 — Keep create-role only on the list page

## Goal

Preserve a clean mental model.

## Why

Create-role belongs to catalog browsing, not role detail editing. Your current page already includes a create-role section in the toolbar area.

## Tasks

- keep create-role form/button only on list page
- do not duplicate it on detail page
- detail page should focus on one selected role only

## Acceptance

- list page = catalog management
- detail page = single-role inspection/editing
- no create/edit mental overlap

---

# PR-09 — Cleanup pass after split

## Goal

Remove split-workbench leftovers and dead code paths.

## Why

After the split, some one-page assumptions will become obsolete.

## Likely cleanup targets

- card-selection-specific styling
- inline selected-role placeholders on list page
- layout grid that assumed left selection + right detail
- action links that made sense only in the split page
- repeated helper copy about “role meaning first” in too many places.

## Tasks

- remove obsolete layout containers
- remove unused imports/components
- trim repeated guidance copy
- ensure empty states still make sense on both pages
- make terminology consistent:

  - role list
  - role detail
  - permissions
  - warnings

## Acceptance

- no dead split-view scaffolding remains
- code is easier to understand than before
- UI copy is less repetitive

---

# Suggested component structure after refactor

## List side

- `RolesPermissionsListPage.jsx`
- `RoleListTable.jsx`
- `RoleListRow.jsx`

## Detail side

- `RolePermissionsDetailPage.jsx`
- `RoleDetailHeader.jsx`
- `RoleOverviewTab.jsx`
- `RolePermissionsTab.jsx`
- `RoleWarningsTab.jsx`

## Optional shared

- `rolesPermissions.helpers.js`
- `useRolesPermissionsData.js`

---

# Recommended execution order

## Phase 1

- PR-01 split responsibilities
- PR-02 add routing
- PR-03 replace card list with row list

## Phase 2

- PR-04 move detail blocks into detail-page tabs
- PR-05 separate state ownership

## Phase 3

- PR-06 simplify detail header
- PR-07 flatten permissions tab
- PR-08 keep create-role on list page only
- PR-09 cleanup

---

# Smoke checklist

## List page

- search works
- role meaning filter works
- grouped role rendering works
- create role still works
- clicking a role opens detail page

## Detail page

- back button returns to list
- direct URL by role id works
- correct role loads
- Overview tab renders
- Permissions tab renders
- Warnings tab renders
- label-only role stays locked
- runtime role can still replace permissions
- save flow still shows validation warnings correctly

## Regression checks

- `listRoles({ includePermissions: true })` flow still supports both pages
- `listPermissions()` still only loads where needed
- `replaceRolePermissions()` still works
- permission assignment permission checks still gate actions correctly.

---

# Final implementation note

Do **not** try to redesign every internal component first.

The safest path is:

1. **route split**
2. **list becomes table**
3. **existing right-side blocks move into detail tabs**
4. **then visual cleanup**

That way you preserve your current business logic while fixing the page model first.

import React, { useMemo, useState } from "react";
import {
Search,
Filter,
Plus,
ChevronDown,
Shield,
AlertTriangle,
CheckCircle2,
Lock,
RefreshCw,
Save,
X,
Info,
ArrowLeft,
} from "lucide-react";

const roles = [
{
id: 1,
code: "BRANCH_ACCOUNTANT",
name: "Branch Accountant",
family: "AP Document Flow",
type: "Runtime",
scope: "Operating Unit",
permissions: 8,
editable: true,
status: "Active",
description: "Creates and submits AP documents for branch-level operations.",
warnings: 0,
capabilities: ["Draft", "Submit", "View workflow status"],
},
{
id: 2,
code: "ENTITY_ACCOUNTANT",
name: "Entity Accountant",
family: "AP Document Flow",
type: "Runtime",
scope: "Legal Entity",
permissions: 11,
editable: true,
status: "Active",
description: "Reviews and approves submitted AP documents at entity level.",
warnings: 1,
capabilities: ["Approve", "Return", "Review evidence"],
},
{
id: 3,
code: "GROUP_APPROVER",
name: "Group Approver",
family: "Consolidation",
type: "Runtime",
scope: "Group",
permissions: 17,
editable: true,
status: "Active",
description: "Final approval layer for group-level governance and consolidation actions.",
warnings: 2,
capabilities: ["Approve consolidation", "Review exceptions", "Governance sign-off"],
},
{
id: 4,
code: "BRANCH_MANAGER",
name: "Branch Manager",
family: "Business Label",
type: "Label Only",
scope: "Operating Unit",
permissions: 0,
editable: false,
status: "Label only",
description: "Business-facing role label used for assignment clarity. Direct permissions are locked.",
warnings: 0,
capabilities: ["Assignment label only"],
},
{
id: 5,
code: "LOCAL_CLOSE_REVIEWER",
name: "Local Close Reviewer",
family: "Period Close",
type: "Runtime",
scope: "Legal Entity",
permissions: 14,
editable: true,
status: "Active",
description: "Reviews close readiness and entity close tasks before period sign-off.",
warnings: 1,
capabilities: ["Review close tasks", "Sign-off", "Open blockers"],
},
];

const permissionModules = [
{
key: "cari.doc",
label: "CARI / Documents",
selected: 4,
total: 6,
rows: [
{ code: "cari.doc.read", action: "READ", description: "View AP/CARI documents", selected: true, dependency: "-" },
{ code: "cari.doc.create", action: "CREATE", description: "Create AP/CARI documents", selected: true, dependency: "READ" },
{ code: "cari.doc.update", action: "UPDATE", description: "Edit draft AP/CARI documents", selected: true, dependency: "READ" },
{ code: "cari.doc.submit", action: "SUBMIT", description: "Submit AP/CARI documents into workflow", selected: true, dependency: "READ" },
{ code: "cari.doc.approve", action: "APPROVE", description: "Approve submitted AP/CARI documents", selected: false, dependency: "READ" },
{ code: "cari.doc.post", action: "POST", description: "Post approved AP/CARI documents", selected: false, dependency: "READ" },
],
},
{
key: "workflow.assignment",
label: "Workflow Assignments",
selected: 1,
total: 3,
rows: [
{ code: "workflow.assignment.read", action: "READ", description: "View workflow assignments", selected: true, dependency: "-" },
{ code: "workflow.assignment.write", action: "WRITE", description: "Edit workflow assignments", selected: false, dependency: "READ" },
{ code: "workflow.definition.read", action: "READ DEF", description: "View workflow definitions", selected: false, dependency: "-" },
],
},
{
key: "evidence",
label: "Supporting Evidence",
selected: 1,
total: 2,
rows: [
{ code: "evidence.read", action: "READ", description: "View supporting evidence", selected: true, dependency: "-" },
{ code: "evidence.write", action: "WRITE", description: "Upload or update supporting evidence", selected: false, dependency: "READ" },
],
},
];

function cls(...parts) {
return parts.filter(Boolean).join(" ");
}

function SmallBadge({ children, tone = "slate" }) {
const tones = {
slate: "border-slate-200 bg-slate-100 text-slate-700",
blue: "border-blue-200 bg-blue-50 text-blue-700",
amber: "border-amber-200 bg-amber-50 text-amber-800",
emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
rose: "border-rose-200 bg-rose-50 text-rose-700",
};
return (
<span className={cls("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
{children}
</span>
);
}

function ToolbarButton({ children, primary = false, icon: Icon }) {
return (
<button
className={cls(
"inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
primary
? "border-slate-900 bg-slate-900 text-white"
: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
)} >
{Icon ? <Icon className="h-4 w-4" /> : null}
{children}
</button>
);
}

function SectionTitle({ eyebrow, title, subtitle }) {
return (

<div>
<div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div>
<div className="mt-1 text-lg font-semibold text-slate-950">{title}</div>
{subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
</div>
);
}

function RoleRow({ role, onClick }) {
return (
<button
      onClick={onClick}
      className="grid w-full grid-cols-[minmax(340px,2.1fr)_minmax(220px,1.2fr)_170px_150px_90px] items-center gap-4 border-b border-slate-200 bg-white px-4 py-3 text-left text-sm hover:bg-slate-50"
    >

<div className="min-w-0">
<div className="flex items-center gap-2">
<div className="font-medium leading-5 text-slate-900">{role.name}</div>
{role.type === "Label Only" ? <Lock className="h-3.5 w-3.5 text-slate-400" /> : null}
</div>
<div className="mt-1 text-xs text-slate-500">{role.code}</div>
</div>
<div className="min-w-0 text-sm text-slate-600">{role.family}</div>
<div className="text-sm text-slate-600">{role.scope}</div>
<div className="text-sm text-slate-600">{role.type}</div>
<div className="text-right">
{role.warnings > 0 ? (
<SmallBadge tone="amber">{role.warnings} warn</SmallBadge>
) : (
<SmallBadge tone="emerald">OK</SmallBadge>
)}
</div>
</button>
);
}

function OverviewPane({ role }) {
return (

<div className="space-y-4">
<div className="rounded-md border border-slate-200 bg-white">
<div className="border-b border-slate-200 px-4 py-3">
<SectionTitle eyebrow="Overview" title="Role summary" subtitle="Compact factual summary on a dedicated detail page." />
</div>
<div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
{[
["Code", role.code],
["Type", role.type],
["Scope", role.scope],
["Saved permissions", role.editable ? String(role.permissions) : "Locked"],
].map(([label, value]) => (
<div key={label} className="border-b border-r border-slate-200 px-4 py-3 last:border-r-0 xl:nth-[4n]:border-r-0">
<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
<div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
</div>
))}
</div>
</div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Description</div>
        <div className="px-4 py-3 text-sm leading-6 text-slate-700">{role.description}</div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Capabilities</div>
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {role.capabilities.map((item) => (
              <SmallBadge key={item} tone="slate">{item}</SmallBadge>
            ))}
          </div>
        </div>
      </div>
    </div>

);
}

function PermissionTablePane({ role, stagedChanges, setStagedChanges }) {
const [openModules, setOpenModules] = useState(["cari.doc", "workflow.assignment"]);

const toggleOpen = (key) => {
setOpenModules((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
};

if (!role.editable) {
return (

<div className="rounded-md border border-slate-200 bg-white">
<div className="flex items-start gap-3 px-4 py-4 text-sm text-slate-700">
<Info className="mt-0.5 h-4 w-4 text-blue-600" />
<div>
<div className="font-medium text-slate-900">This role is label-only</div>
<div className="mt-1 leading-6">Direct permission editing is disabled. In real ERP setups this kind of record would often stay viewable, but authority would come from runtime roles or workflow packages.</div>
</div>
</div>
</div>
);
}

return (

<div className="space-y-3">
{permissionModules.map((module) => {
const expanded = openModules.includes(module.key);
return (
<div key={module.key} className="overflow-hidden rounded-md border border-slate-200 bg-white">
<button
onClick={() => toggleOpen(module.key)}
className="flex w-full items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-left" >
<div className="min-w-0">
<div className="text-sm font-semibold text-slate-900">{module.label}</div>
<div className="text-xs text-slate-500">{module.selected} of {module.total} selected</div>
</div>
<div className="flex items-center gap-2">
{module.selected > 0 ? <SmallBadge tone="emerald">Active</SmallBadge> : null}
<ChevronDown className={cls("h-4 w-4 text-slate-500 transition", expanded ? "rotate-180" : "")} />
</div>
</button>

            {expanded ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <div className="flex flex-wrap gap-2">
                    <ToolbarButton>Select all</ToolbarButton>
                    <ToolbarButton>Clear</ToolbarButton>
                    <ToolbarButton>Read only</ToolbarButton>
                  </div>
                  <div className="text-xs text-slate-500">Dense table layout instead of cards</div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="w-14 px-4 py-3">Use</th>
                        <th className="px-4 py-3">Action</th>
                        <th className="px-4 py-3">Permission code</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Dependency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {module.rows.map((row) => (
                        <tr key={row.code} className="border-t border-slate-200 hover:bg-slate-50">
                          <td className="px-4 py-3 align-top">
                            <input
                              type="checkbox"
                              defaultChecked={row.selected}
                              onChange={() => setStagedChanges((n) => n + 1)}
                              className="mt-0.5 h-4 w-4 rounded"
                            />
                          </td>
                          <td className="px-4 py-3 align-top font-medium text-slate-900">{row.action}</td>
                          <td className="px-4 py-3 align-top font-mono text-xs text-slate-700">{row.code}</td>
                          <td className="px-4 py-3 align-top text-slate-600">{row.description}</td>
                          <td className="px-4 py-3 align-top">
                            {row.dependency === "-" ? (
                              <span className="text-xs text-slate-400">-</span>
                            ) : (
                              <SmallBadge tone="amber">{row.dependency}</SmallBadge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {stagedChanges > 0 ? (
        <div className="sticky bottom-0 z-10 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-blue-700" />
              <div>
                <div className="text-sm font-semibold text-blue-900">{stagedChanges} unsaved changes</div>
                <div className="text-sm text-blue-800">Still compact, but on a dedicated detail page.</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToolbarButton icon={X}>Reset</ToolbarButton>
              <ToolbarButton icon={RefreshCw}>Review dependencies</ToolbarButton>
              <ToolbarButton primary icon={Save}>Save changes</ToolbarButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>

);
}

function WarningsPane({ role }) {
const warnings = role.warnings === 0
? []
: role.warnings === 1
? ["Approver authority detected. Review least-privilege before broadening edit access."]
: [
"Broad approval role. Confirm maker-checker separation remains intact.",
"Cross-module authority is present across workflow and finance areas.",
];

return (

<div className="space-y-3">
<div className="rounded-md border border-slate-200 bg-white">
<div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Validation and guidance</div>
<div className="px-4 py-3">
{warnings.length === 0 ? (
<div className="flex items-start gap-3 text-sm text-emerald-800">
<CheckCircle2 className="mt-0.5 h-4 w-4" />
<div>No active warnings for this role selection.</div>
</div>
) : (
<div className="space-y-2">
{warnings.map((item) => (
<div key={item} className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
<span>{item}</span>
</div>
))}
</div>
)}
</div>
</div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Recommended review order</div>
        <div className="grid gap-0 md:grid-cols-3">
          {[
            "Confirm role meaning",
            "Confirm intended scope",
            "Apply permission changes",
          ].map((step, i) => (
            <div key={step} className="border-r border-slate-200 px-4 py-3 last:border-r-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Step {i + 1}</div>
              <div className="mt-1 text-sm font-medium text-slate-900">{step}</div>
            </div>
          ))}
        </div>
      </div>
    </div>

);
}

function ListPage({ query, setQuery, typeFilter, setTypeFilter, filteredRoles, onOpenRole }) {
return (

<div className="space-y-4">
<div className="rounded-md border border-slate-300 bg-white shadow-sm">
<div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
<div>
<div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Security Administration</div>
<h1 className="mt-1 text-2xl font-semibold text-slate-950">Roles & Permissions</h1>
<div className="mt-1 text-sm text-slate-500">Cleaner ERP-style list page. Click a role to open a dedicated detail page.</div>
</div>
<div className="flex flex-wrap gap-2">
<ToolbarButton icon={RefreshCw}>Refresh</ToolbarButton>
<ToolbarButton icon={Shield}>Open access model</ToolbarButton>
<ToolbarButton primary icon={Plus}>Create role</ToolbarButton>
</div>
</div>

        <div className="grid gap-0 md:grid-cols-4">
          {[
            ["Managed roles", "24"],
            ["Runtime roles", "18"],
            ["Label-only roles", "6"],
            ["Pending warnings", "4"],
          ].map(([label, value]) => (
            <div key={label} className="border-r border-slate-200 px-4 py-3 last:border-r-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <SectionTitle eyebrow="Selection" title="Role list" subtitle="Wider list layout so role names stay readable." />
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative xl:w-95">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search role, code, family, scope..."
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-900"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["All", "All"],
                  ["Runtime", "Runtime"],
                  ["Label Only", "Label only"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setTypeFilter(value)}
                    className={cls(
                      "rounded-md border px-3 py-1.5 text-xs font-medium",
                      typeFilter === value
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    {label}
                  </button>
                ))}
                <button className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                  <Filter className="h-3.5 w-3.5" /> More filters
                </button>
              </div>
            </div>
            <div className="text-sm text-slate-500">{filteredRoles.length} roles</div>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(340px,2.1fr)_minmax(220px,1.2fr)_170px_150px_90px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <div>Role</div>
          <div>Workflow family</div>
          <div>Scope</div>
          <div>Type</div>
          <div className="text-right">State</div>
        </div>

        <div className="max-h-190 overflow-auto">
          {filteredRoles.map((role) => (
            <RoleRow key={role.id} role={role} onClick={() => onOpenRole(role.id)} />
          ))}
        </div>
      </div>
    </div>

);
}

function DetailPage({ role, tab, setTab, stagedChanges, setStagedChanges, onBack }) {
const tabs = ["Overview", "Permissions", "Warnings", "Assignments"];

return (

<div className="space-y-4">
<div className="rounded-md border border-slate-300 bg-white shadow-sm">
<div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
<div className="min-w-0">
<button
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
<ArrowLeft className="h-4 w-4" />
Back to role list
</button>
<div className="mt-4 flex flex-wrap items-center gap-2">
<div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Role detail</div>
<SmallBadge tone={role.type === "Label Only" ? "blue" : "emerald"}>
{role.type === "Label Only" ? "Label only" : "Runtime"}
</SmallBadge>
<SmallBadge tone="slate">{role.family}</SmallBadge>
</div>
<h1 className="mt-2 text-2xl font-semibold text-slate-950">{role.name}</h1>
<div className="mt-1 text-sm text-slate-500">{role.code} · Recommended scope: {role.scope}</div>
</div>
<div className="grid gap-0 border border-slate-200 md:grid-cols-3">
{[
["Permissions", role.editable ? String(role.permissions) : "Locked"],
["Warnings", String(role.warnings)],
["Staged", role.editable ? String(stagedChanges) : "0"],
].map(([label, value]) => (
<div key={label} className="min-w-27.5 border-r border-slate-200 px-3 py-2 last:border-r-0">
<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
<div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
</div>
))}
</div>
</div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={cls(
                  "rounded-md border px-3 py-1.5 text-sm font-medium",
                  tab === item
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <ToolbarButton>Assignments</ToolbarButton>
            <ToolbarButton>Package map</ToolbarButton>
          </div>
        </div>

        <div className="px-4 py-4">
          {tab === "Overview" ? <OverviewPane role={role} /> : null}
          {tab === "Permissions" ? (
            <PermissionTablePane
              role={role}
              stagedChanges={stagedChanges}
              setStagedChanges={setStagedChanges}
            />
          ) : null}
          {tab === "Warnings" ? <WarningsPane role={role} /> : null}
          {tab === "Assignments" ? (
            <div className="rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Assignments</div>
              <div className="px-4 py-4 text-sm leading-6 text-slate-600">
                In a real implementation this could route into its own assignment page, but even here the main improvement is clear: role selection and role editing are separated into two pages.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>

);
}

export default function RolesPermissionsErpStyleMockup() {
const [query, setQuery] = useState("");
const [typeFilter, setTypeFilter] = useState("All");
const [selectedRoleId, setSelectedRoleId] = useState(null);
const [tab, setTab] = useState("Permissions");
const [stagedChanges, setStagedChanges] = useState(2);

const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

const filteredRoles = useMemo(() => {
return roles.filter((role) => {
const haystack = `${role.name} ${role.code} ${role.family} ${role.scope} ${role.type}`.toLowerCase();
const matchesQuery = !query || haystack.includes(query.toLowerCase());
const matchesType = typeFilter === "All" || role.type === typeFilter;
return matchesQuery && matchesType;
});
}, [query, typeFilter]);

return (

<div className="min-h-screen bg-slate-100 p-5 text-slate-900">
<div className="mx-auto max-w-425 space-y-4">
{selectedRole ? (
<DetailPage
role={selectedRole}
tab={tab}
setTab={setTab}
stagedChanges={stagedChanges}
setStagedChanges={setStagedChanges}
onBack={() => setSelectedRoleId(null)}
/>
) : (
<ListPage
query={query}
setQuery={setQuery}
typeFilter={typeFilter}
setTypeFilter={setTypeFilter}
filteredRoles={filteredRoles}
onOpenRole={(roleId) => {
setSelectedRoleId(roleId);
setTab("Permissions");
}}
/>
)}
</div>
</div>
);
}
