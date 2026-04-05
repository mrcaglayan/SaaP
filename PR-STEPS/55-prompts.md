# RBAC & Governance Redesign - Copy-Paste Implementation Prompts

Use these prompts with a coding agent working inside the repo. Each prompt is scoped to one PR or one frontend UI workstream.

---

## Source Of Truth

Use these prompts with:

- `55-RBAC-GOVERNANCE-REDESIGN-ROADMAP.md`
  - repo-local path: `pr-steps/55-RBAC-GOVERNANCE-REDESIGN-ROADMAP.md`
  - roadmap lock

These prompts assume roadmap 55 is the binding implementation baseline. If the live repo materially differs from roadmap 55 for the current slice, patch roadmap 55 first, then implement.

---

## Global Prompt Prefix

Paste this before any PR-specific prompt:

```text
You are implementing a scoped change in an existing Node/Express + React repo with a multi-entity RBAC system, workflow engine, seeded permission catalog, and mixed approval patterns.

Rules:
- Treat repo-local `pr-steps/55-RBAC-GOVERNANCE-REDESIGN-ROADMAP.md` (file `55-RBAC-GOVERNANCE-REDESIGN-ROADMAP.md`) as the roadmap lock for the current slice.
- First inspect the current repo and identify the exact files, helpers, routes, migrations, tests, and frontend surfaces involved.
- Compare the live repo seams against roadmap 55 before making changes.
- If the live repo materially differs from roadmap 55 for the current slice, update roadmap 55 first and then implement.
- Do not redesign outside the requested PR scope.
- Do not broaden into later phases unless the prompt explicitly allows it.
- Preserve existing behavior unless the PR explicitly changes it.
- Reuse existing patterns, naming, logging, validation, migrations, caching, and error helpers where possible.
- Keep backward compatibility where the PR says compatibility is required.
- Add or update tests for changed behavior.
- If a required primitive does not exist, create the smallest reusable version needed for this PR only.
- Respect repo documentation policy:
  - add JSDoc to exported non-trivial functions, hooks, route handlers, validators, and service methods you create or materially modify
  - add inline comments only for non-obvious rollout guards, compatibility logic, or business rules
- At the end, provide:
  1. summary of changes
  2. files changed
  3. migration notes
  4. compatibility risks
  5. follow-up PR suggestions only if truly needed
```

---
## Copy-Paste Order

Use the prompts below from top to bottom.

This order is dependency-aware rather than phase-pure: directly dependent UI prompts are placed immediately after the backend work they rely on, so you can execute linearly without jumping around the file.

Authoritative linear order:
1. `PR-0A`
2. `UI-0A`
3. `PR-0B`
4. `PR-0C`
5. `PR-1A`
6. `UI-1A`
7. `PR-1B`
8. `PR-2D`
9. `PR-1C`
10. `PR-1D`
11. `PR-2A`
12. `PR-2C`
13. `PR-2B`
14. `PR-3A`
15. `PR-3B`
16. `PR-3C`
17. `UI-3A`
18. `PR-3D`
19. `PR-3E`
20. `PR-3F`
21. `PR-4A`
22. `PR-4B`
23. `PR-4C`
24. `UI-4A`
25. `PR-5A`
26. `UI-5A`
27. `PR-5B`
28. `UI-5B`
29. `PR-5C`
30. `UI-5C`
31. `PR-5D`
32. `UI-5D`
33. `PR-5E`
34. `UI-5E`
35. `PR-6A`
36. `PR-6B`
37. `PR-6C`
38. `PR-6D`
39. `UI-6A`
40. `PR-6E`
41. `PR-7A`
42. `PR-7B`
43. `PR-7C`
44. `PR-7D`

---

## Batch 1 - Phase 0 Consistency

Normalize lifecycle vocabulary first, keep the UI on the same spelling immediately, then add the missing permissions and capability metadata before broader auth cleanup.

### Prompt - PR-0A Lifecycle Vocabulary Normalization

```text
Implement PR-0A: Lifecycle Vocabulary Normalization.

Objective:
Standardize lifecycle vocabulary pre-go-live and make CANCELLED the only active spelling used by runtime code paths.

Scope:
- Create a shared backend lifecycle constants module.
- Replace active usage of CANCELED with CANCELLED.
- Update validators, service logic, OpenAPI generation, frontend status maps, and tests/fixtures that compare exact status strings.
- If dev/demo rows or seed/demo fixtures use the old spelling, update them too.

Primary files to inspect first:
- backend/src/constants/lifecycle.js (new)
- backend/src/migrations/m029_cash_transit_workflow.js
- backend/src/services/inventory.transfer.service.js
- backend/src/queries/cash.queries.js
- backend/openapi.yaml
- backend/scripts/generate-openapi.js
- frontend files that render or filter exact status strings
- tests referencing CANCELED

Implementation requirements:
- Keep the change tightly scoped to lifecycle naming consistency.
- Standardize on CANCELLED everywhere in active repo code.
- If enum migrations are needed, write them cleanly for a pre-live system.
- Prefer shared constants over repeated inline status strings where practical.

Acceptance target:
- No active runtime path emits CANCELED.
- OpenAPI and frontend use CANCELLED.
- Repo search should not find active code-path checks for CANCELED except possibly in legacy migration comments if unavoidable.

Return a concise implementation summary, files changed, and any remaining repo locations that still intentionally keep legacy spelling.
```

### Prompt - UI-0A Frontend Lifecycle Consistency

```text
Implement UI-0A: Frontend Lifecycle Consistency.

Objective:
Align frontend labels, badges, filters, and exact-string comparisons with canonical lifecycle vocabulary and CANCELLED spelling.

Scope:
- Update status badges, filters, labels, and exact-string checks.
- Verify current pages still render correctly with normalized values.

Primary files/surfaces to inspect:
- status badge components
- list/detail pages with status filters
- any frontend constants or maps for workflow/payment/inventory/cash statuses
- demo fixtures/story-like data if present

Implementation requirements:
- Replace CANCELED checks with CANCELLED.
- Keep UI wording aligned with canonical verbs such as submit, approve, reject, return, withdraw, execute/post, lock, reopen, reverse.
- Do not redesign unrelated UI.

Acceptance target:
- No active page/filter/badge depends on old spelling.
- Existing screens still render correctly after backend vocabulary cleanup.
```

### Prompt - PR-0B Add Missing Permission Codes

```text
Implement PR-0B: Add Missing Permission Codes.

Objective:
Add the missing permission codes required by later RBAC/governance cleanup without changing route guards yet.

Add these permissions:
- workflow.definition.read
- workflow.definition.write
- workflow.assignment.read
- workflow.assignment.write
- cari.request.review
- security.admin.system

Also confirm whether cari.audit.read already exists and, if so, only update role mapping where needed rather than duplicating it.

Primary files to inspect first:
- backend/src/seedCore.js
- seed/bootstrap flows that persist permissions and role-permission mappings

Requirements:
- Keep this PR additive only.
- Do not change route guards yet.
- Ensure fresh seed and reseed are both safe/idempotent.
- If seeded roles should temporarily receive the new permissions for later compatibility, do that carefully.

Return:
- exact permission rows added
- exact roles updated, if any
- notes on seed idempotency and compatibility
```

### Prompt - PR-0C Capability Group Constants

```text
Implement PR-0C: Permission Capability Group Constants.

Objective:
Create capability-group constants for later diagnostics and role redesign, without changing runtime authorization behavior yet.

Primary files:
- backend/src/constants/permission-groups.js (new)
- backend/src/seedCore.js if metadata references are useful

Requirements:
- Add capability groups such as:
  - gl.readonly
  - gl.masterdata
  - gl.operations
  - gl.posting
  - bank.readonly
  - bank.operations
  - bank.governance
  - close.operator
  - close.reviewer
  - payroll.readonly
  - payroll.operations
  - payroll.governance
- Keep this metadata-only in this PR.
- Do not change requirePermission behavior or role evaluation yet.
- Add brief code comments clarifying:
  - gl.readonly preserves OU balance/report visibility
  - gl.posting is only for free-form manual GL posting/reversal/period close

Return:
- capability groups created
- any ambiguous permission mappings that need later confirmation
```

---

## Batch 2 - Phase 1 Foundations

Fix semantic permission misuse first, align the admin UI terminology, then split TenantAdmin and add the shared authz helper layer required by later scope and approval work.

### Prompt - PR-1A Fix Semantic Permission Misuse

```text
Implement PR-1A: Fix Semantic Permission Misuse.

Objective:
Replace semantically wrong permission guards with the new correct permissions introduced earlier.

Changes required:
1. In workflow governance routes, replace onboarding.company.setup with workflow.definition.write and/or workflow.assignment.write where appropriate.
2. In CARI counterparty request approve/reject routes, replace cari.card.upsert with cari.request.review.
3. Update seeded role-permission mappings so the roles that currently rely on the old behavior keep working through the correct new permissions.
4. Keep old permission codes in the system for compatibility; do not delete them yet.

Primary files to inspect first:
- backend/src/routes/workflows.routes.js
- backend/src/routes/cari.counterparty-request.routes.js
- backend/src/seedCore.js

Requirements:
- Be precise about read vs write vs review semantics.
- Do not broaden authority accidentally.
- Keep compatibility where needed.

Acceptance target:
- Workflow definition/assignment endpoints are guarded by workflow permissions.
- Counterparty approve/reject no longer depends on card upsert authority.
```

### Prompt - UI-1A Permission/Admin Terminology Cleanup

```text
Implement UI-1A: Permission/Admin Terminology Cleanup.

Objective:
Align admin and review UI text with the corrected permission model.

Scope:
- Update admin/security screens, workflow management screens, and CARI review surfaces.
- Remove wording that implies workflow governance belongs to onboarding.
- Make review authority clearly separate from edit authority.

Primary surfaces to inspect:
- security/admin pages
- workflow setup/management UI
- CARI review pages/components
- any labels/help text describing permissions or roles

Requirements:
- Keep this as terminology/UX cleanup, not a full role-management redesign yet.
- Update button labels, descriptions, tooltips, and section names as needed.

Acceptance target:
- Governance/admin screens no longer use outdated semantics.
- Users can distinguish "no permission", "wrong scope", and "visibility narrowed" on main governed flows.
```

### Prompt - PR-1B TenantAdmin Compatibility Shim

```text
Implement PR-1B: TenantAdmin Compatibility Shim.

Objective:
Prepare the split of TenantAdmin into SecurityAdmin and SystemAdmin without breaking bootstrap/admin seams.

Primary files to inspect first:
- backend/src/routes/security.js
- backend/src/routes/provider.js
- backend/src/seed.js
- backend/src/seedStarter.js
- any helpers or logic checking literal TenantAdmin

Requirements:
- Add SecurityAdmin and SystemAdmin definitions.
- Introduce helper predicates such as:
  - canManageSecurity()
  - canManageOps()
  - canBootstrapTenant()
- Refactor direct literal TenantAdmin checks behind those helpers.
- Keep TenantAdmin temporarily alive as a compatibility role during Phases 1-2.

Acceptance target:
- Bootstrap/provider/security flows still work with current data.
- Direct literal TenantAdmin checks are removed from active runtime paths where helper-based checks should be used.
```

### Prompt - PR-2D Shared Authz / Scope Utility Layer

```text
Implement PR-2D: Shared Authz / Scope Utility Layer.

Objective:
Create a small foundational scope-aware authorization utility layer that later phases can reuse.

Primary files:
- backend/src/services/authz.scope.service.js (or equivalent new shared module)
- backend/src/middleware/rbac.js to reuse helpers where appropriate

Core helpers to provide:
- checkUserHasPermissionAtScope(userId, tenantId, permissionCode, scopeType, scopeId)
- findUsersWithPermissionAtScope(tenantId, permissionCode, scopeType, scopeId)
- shared scope-resolution helpers for:
  - request scope
  - row scope
  - diagnostics
- shared effective-date-aware entitlement loading helpers usable by middleware, /me, diagnostics, escalation, delegation, and field masking

Requirements:
- This is an enabling PR, not a behavior redesign.
- Avoid duplicating ad-hoc scope evaluation logic across modules.

Acceptance target:
- One consistent scope-aware source of truth exists.
- Later phases can import these helpers instead of inventing parallel ones.
```

## Batch 3 - Scope Model Clarification

Once the helper layer exists, finish role metadata cleanup, permission-graph validation, the explicit entitlements contract, temporal assignments, and then the frontend rollout that consumes them.

### Prompt - PR-1C Capability Metadata on Existing Roles

```text
Implement PR-1C: Capability Metadata on Existing Roles.

Objective:
Annotate current roles with capability groups without doing the final duty-boundary role redesign yet.

Primary files:
- backend/src/seedCore.js

Tasks:
- Add ROLE_CAPABILITY_GROUPS metadata for current broad roles.
- Apply transitional SoD cleanup:
  - remove bank/payroll approval powers from EntityAccountant
  - remove gl.journal.post from BranchOperator
  - preserve gl.readonly for branch/OU reporting visibility
  - add missing cari.audit.read where intended
- Only keep temporary gl.journal.create/update on BranchOperator if short-term migration safety clearly requires it.

Requirements:
- Do not yet replace the current broad role catalog.
- Make current roles easier to reason about for later migration.

Acceptance target:
- Existing roles are more understandable in seed definitions.
- Branch users retain visibility while losing broad posting authority.
```

### Prompt - PR-1D Permission Dependency & Conflict Validation

```text
Implement PR-1D: Permission Dependency & Conflict Validation.

Objective:
Validate permission graph quality at the correct seam.

Primary files:
- backend/src/constants/permission-rules.js (new)
- seed/build validation flows
- future role-definition editing hooks if present
- optional combined-role warning hook in role assignment flows

Requirements:
- Add dependency rules such as:
  - gl.journal.post -> gl.journal.read
  - gl.journal.reverse -> gl.journal.read
  - gl.period.close -> gl.journal.read + gl.trial_balance.read
  - ouclose.approve -> ouclose.read
  - ouclose.lock -> ouclose.read + ouclose.approve
- Add conflict rules for maker-checker and similar overlaps.
- Validate dependencies/conflicts when defining/editing roles and during seed/build-time.
- During user-role assignment, optionally warn when combined assigned roles create overlapping conflicts.
- Add guardrail that a role or role-set granting gl.posting must also provide required read visibility at the same or higher scope.
- Use the name GLPostingAuthority in any docs/comments/examples rather than older GLPoster wording.

Acceptance target:
- Invalid role definitions are flagged before assignment.
- Combined role-set warnings do not silently mutate permissions.
```

---

### Prompt - PR-2A Explicit Scope Model + `/api/me/entitlements`

```text
Implement PR-2A: Explicit Scope Model + /api/me/entitlements.

Objective:
Make action scope vs visibility scope explicit instead of using silent fallback behavior.

Primary files:
- backend/src/middleware/rbac.js
- backend/src/routes/me.js
- new entitlements route/service if needed

Requirements:
- Refactor the dual-scope bundle so it exposes:
  - permissionScopeContext
  - visibilityScopeContext
  - backward-compatible scopeContext
- visibilityScopeContext must be null when no data scopes exist, instead of silently reusing permission scope.
- Add /api/me/entitlements endpoint.
- Define a stable minimum response contract for /api/me/entitlements including permissions, visibilityOverrides, scopeSummary, isVisibilityNarrowed, and maskedFields. Empty/default values are acceptable before later phases fully populate every field, but the response shape should exist from the first rollout.
- Keep backward compatibility where existing code still expects effective scopeContext.

Acceptance target:
- Users with data scopes can be diagnosed clearly.
- The API contract distinguishes action scope from visibility narrowing without forcing frontend agents to invent their own entitlements shape.
- The API contract distinguishes action scope from visibility narrowing.
```

### Prompt - PR-2C Temporal Role Assignments

```text
Implement PR-2C: Temporal Role Assignments.

Objective:
Add effective dating to user_role_scopes and keep all permission loaders consistent.

Primary files:
- migration adding effective_from / effective_to to user_role_scopes
- backend/src/middleware/rbac.js
- backend/src/routes/me.js
- any admin/report endpoints computing effective permissions outside middleware

Requirements:
- Add effective_from and effective_to to user_role_scopes.
- Filter expired and not-yet-effective assignments in RBAC middleware.
- Reuse the same effective-date filtering logic in /me and any other endpoint that computes effective permissions outside middleware.
- Keep cache behavior coherent with effective-dated access.

Acceptance target:
- Expired assignments no longer grant runtime access.
- /me does not over-report future or expired permissions.
```

### Prompt - PR-2B Frontend Scope Awareness Rollout

```text
Implement PR-2B: Frontend Scope Awareness Rollout.

Objective:
Make frontend scope-aware without breaking current auth behavior.

Primary files/surfaces:
- frontend/src/auth/AuthContext.jsx
- frontend/src/auth/RequirePermission.jsx
- entity/OU scoped pages, action toolbars, forms, menus

Requirements:
- Keep /me backward-compatible.
- Fetch /api/me/entitlements alongside /me.
- Expose entitlements, scopeSummary, and isVisibilityNarrowed in auth context.
- Replace blind hide-only behavior with richer UX states:
  - visible but disabled with explanation
  - explicit scope-mismatch message
  - clear distinction between missing permission and visibility narrowing
- Add lightweight entitlement-aware helpers for menus, buttons, and record pages.
- Do not redesign the entire app shell; focus on governed pages and shared auth surfaces.

Acceptance target:
- Users can distinguish "no permission", "wrong scope", and "visibility narrowed" on main governed flows.
- Existing auth behavior continues to work during rollout.
```

---

## Batch 4 - Approval Engine Pilot

Build the generic approval schema and service, cut over the CARI pilot, then standardize the pilot UX before migrating the rest of the approval estate.

### Prompt - PR-3A Generic Approval Engine Schema

```text
Implement PR-3A: Generic Approval Engine Schema.

Objective:
Create generic approval tables in parallel with current systems.

Create schema for:
- approval_policies
- approval_policy_assignments
- approval_policy_steps
- approval_requests
- approval_decisions

Requirements:
- Include explicit request scope, policy versioning, policy applicability, decision tracking, and request/execution status separation.
- Preserve scope precedence rules:
  - policy scope = natural ownership/default bound
  - assignment scope = authoritative runtime applicability
  - assignment may narrow policy scope but not broaden it
- Enforce the assignment-scope narrowing rule in approval policy create/update validation or service logic, not as a future assumption left for later phases.
- Prevent the same reviewer from counting twice on the same request step, using a schema constraint and/or explicit service-level dedupe rule.
- Keep current bank/workflow systems untouched in this PR.
- Write migrations cleanly and defensively.

Acceptance target:
- New schema migrates cleanly on the current repo.
- Scope precedence rules are documented in code comments and/or migration notes.
- Threshold counting cannot double-count the same reviewer on a single step.
```

### Prompt - PR-3B Unified Approval Service

```text
Implement PR-3B: Unified Approval Service.

Objective:
Create the module-agnostic approval engine behavior.

Primary file:
- backend/src/services/approval.engine.service.js (new)

Core functions to implement:
- evaluateApprovalNeed(moduleCode, targetType, actionType, context)
- submitRequest(policyId, targetType, targetId, submitter, snapshot)
- recordDecision(requestId, userId, decision, comment)
- withdrawRequest(requestId, userId)
- escalateRequest(requestId)
- executeRequest(requestId)
- reverseExecution(requestId)
- getRequestDiagnostics(requestId)

Requirements:
- Enforce maker-checker and step-level self-approval rules.
- Keep request scope authoritative for decision checks.
- Reuse the shared scope-aware helpers from PR-2D.
- Ensure repeated decisions by the same reviewer on the same request step do not count twice toward min_approvals.
- Preserve a clear separation between request/review status and execution status.

Acceptance target:
- The engine runs end-to-end on test targets.
- Status transitions and audit trail are deterministic and reviewable.
```

### Prompt - PR-3C Pilot: CARI Counterparty Request

```text
Implement PR-3C: Pilot Unified Approval Engine on CARI Counterparty Request.

Objective:
Prove the generic engine on a contained, lower-blast-radius approval flow.

Primary files:
- backend/src/routes/cari.counterparty-request.routes.js
- current CARI request services/model code
- backend/src/services/approval.engine.service.js

Requirements:
- Rewire the CARI request submit/review flow to the unified engine.
- Use cari.request.review for approve/reject authority.
- Validate request/review/execution behavior, scope handling, and audit trail.
- Keep rollback/feature-flag capability if practical.

Acceptance target:
- The CARI request lifecycle works through the new engine.
- The flow demonstrates correct request scope, review behavior, and audit history.
```

### Prompt - UI-3A Shared Approval UX Library + CARI Pilot

```text
Implement UI-3A: Shared Approval UX Library + CARI Pilot.

Objective:
Standardize approval/request UX so backend unification is reflected in the frontend.

Primary surfaces:
- CARI counterparty request pages/components
- shared action modals/drawers
- shared decision history/timeline components
- shared request/review/execution status badges

Requirements:
- Build reusable UI patterns/components for:
  - submit for review
  - approve
  - reject
  - return for revision
  - withdraw
  - request/review status badges
  - execution status badges
  - decision history/timeline
- Pilot these shared components first on the CARI flow.
- Make request/review status and execution status visually distinct.
- Reuse existing component patterns where possible.

Acceptance target:
- The first pilot flow feels more consistent than the old mixed approval UX.
- Unified lifecycle verbs are reflected consistently in UI components.
```

## Batch 5 - Approval Engine Expansion

After the pilot proves out the engine, migrate bank approvals, workflow approvals, and the remaining ad-hoc approval paths.

### Prompt - PR-3D Bank Approval Migration

```text
Implement PR-3D: Bank Approval Migration to Unified Engine.

Primary files:
- backend/src/services/bank.approvals.service.js
- backend/src/services/approvalPolicies.service.js
- bank approval mapping scripts/migrations

Requirements:
- Map bank policies/requests/decisions to generic equivalents.
- Make bank approval service delegate to the generic engine.
- Preserve old tables for audit history.
- Remove bank-shaped assumptions from generic approval abstractions.

Acceptance target:
- Bank approvals behave equivalently or better under feature flag.
- The generic approvals layer is no longer bank-shaped internally.
```

### Prompt - PR-3E Workflow Approval Migration

```text
Implement PR-3E: Workflow Approval Migration to Unified Engine.

Primary files:
- backend/src/services/workflows.service.js
- backend/src/routes/workflows.routes.js
- workflow mapping scripts/migrations

Requirements:
- Map workflow definitions, steps, assignments, instances, and decisions into the generic engine structures.
- Preserve:
  - workflow_assignments.effective_from/effective_to
  - workflow_definitions.version_no
  - stage_scope_type
- Ensure dynamic step permission resolution still works against the new engine.
- Use feature flags if needed for rollout safety.

Acceptance target:
- Existing close/consolidation workflow behaviors remain intact.
- Dynamic workflow authorization still behaves correctly after migration.
```

### Prompt - PR-3F Remaining Ad-Hoc Approvals

```text
Implement PR-3F: Migrate Remaining Ad-Hoc Approvals.

Primary files:
- backend/src/routes/payments.routes.js
- backend/src/routes/payroll.settlementOverrides.routes.js
- backend/src/services/inventory.transfer.service.js
- backend/src/routes/local.close-packs.routes.js

Requirements:
- Migrate remaining ad-hoc approval flows after pilot learnings are incorporated.
- Normalize request/review/execution separation across modules.
- Preserve module-specific business logic while moving approval concerns into the unified engine.

Acceptance target:
- Ad-hoc approval logic is minimized or removed.
- Governed modules share one approval vocabulary and audit shape.
```

---

## Batch 6 - Role Redesign And SoD

With the approval layer stabilized, introduce duty-boundary roles, service-level SoD, the migration tool, and then redesign the admin role-management UI around the new model.

### Prompt - PR-4A Duty-Boundary Roles

```text
Implement PR-4A: Duty-Boundary Roles.

Objective:
Replace broad title-based roles with smaller composable roles aligned to bounded responsibilities.

Primary file:
- backend/src/seedCore.js
- any role-management backend exposing system roles

Target roles to introduce:
- SecurityAdmin
- SystemAdmin
- MasterDataSteward
- GLOperator
- GLPostingAuthority
- OUAccountant
- TreasuryOperator
- TreasuryApprover
- PayrollOperator
- PayrollApprover
- LocalClosePreparer
- LocalCloseReviewer
- GroupReportingController
- AuditorReadOnly
- BranchOperator

Requirements:
- Keep GLPostingAuthority as a companion-only role, not a standalone business persona.
- Preserve BranchOperator as visibility + operational-document role, not posting role.
- Keep OU visibility separate from manual GL posting authority.
- Do not silently over-grant authority during role mapping.

Acceptance target:
- Each new role has a bounded responsibility.
- Reporting visibility remains separate from manual posting authority.
```

### Prompt - PR-4B SoD Service Integration

```text
Implement PR-4B: SoD Service Integration.

Objective:
Move per-record SoD enforcement into business/service seams.

Primary files:
- backend/src/constants/sod-rules.js
- backend/src/services/sod.service.js
- journal posting services
- payment approval/release services
- payroll override approval services
- approval/workflow decision handlers

Requirements:
- Implement evaluateSoD and assertSoD.
- Integrate SoD checks where record context exists.
- Keep RBAC middleware focused on capability + scope.
- Make SoD results reusable later by diagnostics/reporting.

Acceptance target:
- Same-record maker/checker conflicts are enforced at the right service seams.
- SoD outcomes are structured enough to surface later in diagnostics.
```

### Prompt - PR-4C Role Migration Tool

```text
Implement PR-4C: Role Migration Tool.

Objective:
Safely migrate old role assignments to new composable roles.

Primary files:
- new migration/report utility
- optional admin backend endpoints for preview/execute flows

Requirements:
- Build preview mapping output per tenant.
- Support review before execution.
- Execute remap with rollback option.
- Keep old roles disabled but recoverable after migration.

Acceptance target:
- Migration output is understandable before execution.
- Tenants can roll back if needed.
```

---

### Prompt - UI-4A Role Management Redesign

```text
Implement UI-4A: Role Management Redesign for Composable Roles.

Objective:
Make role management usable with smaller composable roles instead of only large title-based roles.

Primary surfaces:
- security/admin role assignment pages
- user access detail pages
- role detail/capability summary pages
- migration preview UI if admin-facing

Requirements:
- Redesign role-management UI around composable roles.
- Add scoped role-assignment UX that makes scope type and scope target obvious.
- Show role capability summaries in assignment dialogs and detail views.
- Surface SoD warnings during role assignment/admin review.
- Make it clear that GLPostingAuthority is a companion authority role, not a full standalone business persona.

Acceptance target:
- Admins can assign new roles without tribal knowledge.
- Scope and SoD consequences are understandable before saving assignments.
```

## Batch 7 - Governance Maturity

Deliver advanced governance features in backend-first pairs so each UI surface lands against a concrete backend contract: field visibility, explainability, escalation, delegation, and compliance reporting.

### Prompt - PR-5A Field-Level Visibility Policies

```text
Implement PR-5A: Field-Level Visibility Policies.

Objective:
Add row-scope-aware field masking/hiding for sensitive data.

Primary files:
- migration for field_visibility_policies
- backend/src/middleware/fieldVisibility.js (new)
- backend/src/utils/redaction.js
- routes returning sensitive bank/payroll data

Requirements:
- Implement the policy table and row-scope-aware masking middleware.
- Use checkUserHasPermissionAtScope for scoped override permissions.
- Never rely only on a global permission when the row belongs to a scoped entity/OU.
- Log masked access to sensitive_data_audit.
- Keep this generic enough for bank/payroll first, but extensible later.

Acceptance target:
- Cross-entity lists evaluate override permissions per row scope.
- Sensitive values can be masked/hidden without route duplication.
```

### Prompt - UI-5A Sensitive Field UX

```text
Implement UI-5A: Sensitive Field UX.

Objective:
Make field-level masking understandable and consistent in the UI.

Primary surfaces:
- bank account detail/list pages
- payroll run detail/list pages
- any UI rendering masked/hideable sensitive fields

Requirements:
- Show masked values consistently.
- Handle hidden fields cleanly.
- Use maskedFields summary from entitlements where helpful.
- Make restricted values visually understandable, not confusing.
- Preserve layout stability where possible when fields are hidden or masked.

Acceptance target:
- Users can tell the difference between masked and missing data.
- Cross-entity views remain consistent with row-scope-aware masking.
```

### Prompt - PR-5B Explainability / Access Debugger API

```text
Implement PR-5B: Explainability / Access Debugger API.

Objective:
Explain access decisions across layers.

Primary files:
- backend/src/services/rbac.diagnostics.service.js (new)
- backend/src/routes/rbac.js

Requirements:
- Add /api/v1/rbac/access-check.
- Support self-check for any authenticated user.
- Report layers as PASS / FAIL / SKIPPED / NOT_APPLICABLE.
- Keep explicit layer slots for:
  - capability
  - scope entitlement
  - visibility policy
  - SoD
  - workflow
  - business_state
  - field_visibility
- Leave room for domain-state blockers such as period closed, record locked, already posted, reopen not allowed, invalid status transition.

Acceptance target:
- A denied user can inspect their own access chain.
- Admins can debug other users with elevated permission.
```

### Prompt - UI-5B Access Debugger Experience

```text
Implement UI-5B: Access Debugger Experience.

Objective:
Expose the explainability API in a user-friendly way.

Primary surfaces:
- "Why can't I do this?" button/modal
- admin access debugger panel in organization/security settings

Requirements:
- Call /api/v1/rbac/access-check for self-service denial debugging.
- Render layered results clearly, including PASS/FAIL/SKIPPED/NOT_APPLICABLE.
- Show actionable recommendations where provided.
- Keep the UI understandable to admins and non-technical users.

Acceptance target:
- Users can self-diagnose common access issues.
- Admins can debug another user's access chain from one place.
```

### Prompt - PR-5C Approval Escalation Engine

```text
Implement PR-5C: Approval Escalation Engine.

Objective:
Make escalation settings operational.

Primary files:
- migration altering approval_policy_steps
- migration for approval_escalation_events
- backend/src/services/approval.escalation.service.js (new)
- backend/src/jobs/approval-escalation.job.js (new)
- notification integration

Requirements:
- Add escalation target config and max escalation count.
- Sweep overdue approval requests.
- Keep ESCALATED reviewable and visible in pending queues.
- Reuse scope-aware approver lookup helpers.
- Do not re-add escalation_after_hours if it already exists on approval_policy_steps from earlier phases.

Acceptance target:
- Overdue approvals generate escalation events and notifications.
- Escalated requests remain actionable.
```

### Prompt - UI-5C Escalation UX

```text
Implement UI-5C: Escalation UX.

Objective:
Make escalation visible without breaking actionability.

Primary surfaces:
- approval request detail pages
- approval queues
- notification surfaces
- policy setup screens

Requirements:
- Show escalation timeline alongside decision history.
- Keep escalated requests visible in normal pending queues with elevated urgency styling.
- Add escalation configuration UI for approval policies.
- Make it clear that escalated requests are still reviewable and actionable.

Acceptance target:
- Escalated requests are visible, understandable, and still actionable.
- Escalation configuration is usable in policy setup UI.
```

### Prompt - PR-5D Approval Delegation

```text
Implement PR-5D: Approval Delegation.

Objective:
Allow scoped, auditable approval acting delegation.

Primary files:
- migration for approval_delegations
- backend/src/services/approval.delegation.service.js (new)
- backend/src/services/approval.engine.service.js
- optional delegation admin backend routes

Requirements:
- Implement create/revoke/resolve delegation.
- Make delegation checks scope-aware.
- Record acting user, delegator, and delegation ID on approval decisions.
- Ensure scopeType/scopeId used for delegation checks come from resolved approval request context, not unchecked caller input.
- Apply SoD checks to both delegate and delegator.

Acceptance target:
- Delegate approval works only where delegator authority truly exists at request scope.
- Audit trail shows both the human actor and the delegated authority source.
```

### Prompt - UI-5D Delegation UX

```text
Implement UI-5D: Delegation UX.

Objective:
Make approval delegation understandable and auditable in the UI.

Primary surfaces:
- user profile/settings "My Delegations" area
- delegated approvals indicator on approval actions
- admin delegation management page

Requirements:
- Build outgoing and incoming delegation views.
- Show "approving on behalf of X" when applicable.
- Add admin list/filter/revoke management surfaces.
- Keep the state clear across ACTIVE / REVOKED / EXPIRED delegations.

Acceptance target:
- Delegation state is visible to both end users and admins.
- Approval actions clearly show delegated authority when used.
```

### Prompt - PR-5E Compliance Audit Report Package

```text
Implement PR-5E: Compliance Audit Report Package.

Objective:
Generate structured audit outputs from the new governance model.

Primary files:
- audit report service/route
- export helpers
- optional compliance backend support

Report families to support:
- Access matrix
- SoD analysis
- Approval coverage
- Delegation log

Requirements:
- Support point-in-time views.
- Support CSV export.
- Reuse already implemented diagnostics/reporting helpers rather than duplicating entitlement logic.
- Keep report shapes aligned with the roadmap.

Acceptance target:
- Reports can be generated for point-in-time views.
- CSV export is usable for external audit.
```

### Prompt - UI-5E Compliance Reporting Screens

```text
Implement UI-5E: Compliance Reporting Screens.

Objective:
Expose audit/compliance reporting in admin UI.

Primary surfaces:
- compliance reports section under security/admin

Requirements:
- Add report filters, previews, and export actions.
- Support report families:
  - access matrix
  - SoD analysis
  - approval coverage
  - delegation log
- Keep export flows clear and admin-friendly.

Acceptance target:
- Security admins can generate/export audit reports without manual DB inspection.
```

---

With the governance model implemented end-to-end, close the transitional seams, promote the unified runtime as the steady state, and sync the roadmap/docs with the shipped operating model.

### Prompt - PR-6A Legacy Role Retirement and Fresh-Tenant Defaults

```text
Implement PR-6A: Legacy Role Retirement and Fresh-Tenant Defaults.

Objective:
Finish the Phase 4 role cutover by retiring compatibility-only legacy roles from the active end-state.

Primary files:
- backend/src/seedCore.js
- backend/src/services/roleMigration.service.js
- backend/src/services/systemRoles.service.js
- frontend/src/pages/security/roleCatalog.js
- any role-assignment admin backend/UI still exposing legacy roles

Requirements:
- Retire TenantAdmin, GroupController, CountryController, and EntityAccountant from the normal active role catalog.
- For fresh tenants, do not seed legacy broad roles as assignable defaults.
- Preserve rollback recoverability for already-migrated tenants where PR-4C depends on it.
- Keep any required compatibility only behind explicit migration/rollback seams, not in the main admin UX.
- Remove stale warnings/comments that still describe legacy roles as normal runtime roles.
- Do not silently over-grant replacement roles.

Acceptance target:
- New tenants only see bounded composable roles.
- Legacy roles are no longer part of the normal steady-state RBAC model.
```

### Prompt - PR-6B Unified Approval/Workflow Hard Cutover

```text
Implement PR-6B: Unified Approval/Workflow Hard Cutover.

Objective:
Promote the unified approval engine from rollout mode to the only supported runtime path.

Primary files:
- backend/src/services/bank.approvals.service.js
- backend/src/services/workflows.service.js
- backend/src/services/approval.engine.service.js
- any approval/workflow compatibility route/service seams still checking feature flags

Requirements:
- Remove BANK_APPROVALS_UNIFIED_ENGINE and WORKFLOWS_UNIFIED_ENGINE runtime branching once the unified path is confirmed stable.
- Eliminate fallback logic that keeps legacy approval/workflow execution paths alive as primary behavior.
- Preserve legacy tables only where still needed for audit/history, not as alternate runtime engines.
- Remove bank-shaped/workflow-shaped internal assumptions that only exist for compatibility.
- Keep request/review/execution separation and current audit outputs intact.

Acceptance target:
- Unified approvals are the only active runtime engine.
- Legacy approval/workflow systems are no longer switchable primary execution paths.
```

### Prompt - PR-6C Explicit Scope Semantics Cutover

```text
Implement PR-6C: Explicit Scope Semantics Cutover.

Objective:
Finish the Phase 2 authz redesign by migrating remaining callers off backward-compatible effective scope semantics.

Primary files:
- backend/src/middleware/rbac.js
- backend/src/services/authz.scope.service.js
- routes/services still consuming req.rbac.scopeContext or getScopeContext()

Requirements:
- Audit and migrate remaining governed callers so they intentionally choose:
  - permissionScopeContext
  - visibilityScopeContext
  - or explicit effective scope only where still justified
- Remove default reliance on backward-compatible scopeContext for cases where permission scope and visibility scope must remain distinguishable.
- Keep cross-entity list filtering and scoped permission checks behaviorally correct.
- Preserve /api/me/entitlements and access-debugger contracts.
- Document any remaining intentional effective-scope compatibility seam in code comments if one truly must survive.

Acceptance target:
- Governed authz paths use explicit scope semantics instead of accidental effective-scope reuse.
- The dual-scope model is fully reflected in active runtime code, not only in diagnostics.
```

### Prompt - PR-6D Governance Closure and Runbook Sync

```text
Implement PR-6D: Governance Closure and Runbook Sync.

Objective:
Close the redesign with accurate operator documentation and rollout guidance.

Primary files:
- pr-steps/55-RBAC-GOVERNANCE-REDESIGN-ROADMAP.md
- pr-steps/55-prompts.md
- operational docs/runbooks for seed, migration, escalation scheduler, and compliance reporting

Requirements:
- Update roadmap/docs to match shipped API/routes and final architecture.
- Document final post-migration operating model for:
  - role migration execution/rollback expectations
  - escalation scheduler enablement
  - unified approval/workflow runtime expectations
  - compliance report usage
- Mark temporary compatibility phases as completed/retired where applicable.
- Remove stale roadmap text that still implies transitional behavior is the intended end-state.

Acceptance target:
- The roadmap matches the shipped implementation.
- Operators can run the governance model without relying on tribal knowledge.
```

---

Optional hardening after the closure track can simplify fresh-tenant operations and reduce admin dependence on seeded defaults.

### Prompt - UI-6A Fresh-Tenant Admin Simplification

```text
Implement UI-6A: Fresh-Tenant Admin Simplification.

Objective:
Reduce brownfield migration noise in the admin UI for fresh/pre-live tenants.

Primary surfaces:
- security/admin sidebar
- role management screens
- migration/delegation/reporting navigation where tenant state matters

Requirements:
- Hide or de-emphasize migration-only admin surfaces when the tenant has no legacy assignments to migrate.
- Keep role migration UI accessible where needed for brownfield tenants.
- Preserve compliance, delegation, and diagnostics surfaces that are part of the steady state.
- Make the admin information architecture reflect the post-migration model.

Acceptance target:
- Fresh tenants see a cleaner governance UI.
- Migration tools remain available without dominating the steady-state admin experience.
```

### Prompt - PR-6E Field Visibility Policy Administration

```text
Implement PR-6E: Field Visibility Policy Administration.

Objective:
Make field visibility policies admin-manageable without code changes.

Primary files:
- backend routes/services for field visibility policies
- security/admin UI for field visibility policy management

Requirements:
- Add CRUD/list support for field_visibility_policies.
- Keep row-scope-aware permission requirements explicit.
- Reuse existing masking diagnostics and policy evaluation logic.
- Preserve sensitive_data_audit behavior.

Acceptance target:
- Security admins can manage field visibility policies from the product.
- Field masking remains generic and policy-driven.
```

---

The original Track 55 closure is complete. The prompts below are follow-on operating-model work built on top of the shipped RBAC redesign, not a reopening of the original closure phases.

Status note:
- PR-7A, PR-7B, PR-7C, and PR-7D are implemented in the current repo.
- Keep these prompts as historical implementation records and regression references, not as open follow-on backlog items.

### Prompt - PR-7A Central Bootstrap Handoff And Setup Presets

Implemented status:
- Shipped in the current repo. Use this prompt as historical scope, not as an unstarted backlog item.

```text
Implement PR-7A: Central Bootstrap Handoff And Setup Presets.

Objective:
Add a first-class handoff step to fresh-tenant bootstrap so central setup can assign bounded local setup responsibility per legal entity or country without reintroducing broad legacy controller roles.

Primary files:
- frontend/src/pages/settings/CompanyOnboardingPage.jsx
- backend/src/routes/onboarding.js
- backend/src/routes/security.js
- frontend/src/api/rbacAdmin.js
- frontend/src/pages/security/roleCatalog.js
- backend/scripts/test-followup-prf13-setup-wizard-regression.js
- any onboarding or RBAC smoke tests affected by the new handoff step

Requirements:
- Extend the onboarding/bootstrap flow with a dedicated handoff step after the central structure skeleton is defined.
- Allow the bootstrap actor to invite or select responsible users per legal entity and, where needed, per country.
- Implement setup presets as bounded bundles of existing composable roles, not as new broad permanent legacy-style roles:
  - EntitySetupManager preset at LEGAL_ENTITY scope:
    - MasterDataSteward
    - GLOperator
    - TreasuryOperator
    - PayrollOperator
    - LocalClosePreparer
    - ShareholderCapitalOperator
  - CountryFinanceSetupManager preset at COUNTRY scope:
    - GLOperator
    - TreasuryApprover
    - PayrollApprover
    - LocalCloseReviewer
- Keep GLPostingAuthority optional and explicit. Do not auto-grant it.
- Reuse existing invite and role-assignment primitives where possible, but package them into an explicit onboarding handoff workflow instead of expecting SecurityAdmin to do everything later by hand.
- Preserve the Phase 6 role-retirement end-state. Do not re-add TenantAdmin, CountryController, EntityAccountant, or similar compatibility roles as the steady-state answer.
- Add or update tests for:
  - onboarding step presence and payload contract
  - resulting invite/assignment behavior
  - no silent over-grant of GLPostingAuthority

Acceptance target:
- Central bootstrap can create the tenant skeleton and hand each entity/country off to bounded local responsible users through the product.
- The handoff uses composable role presets at the right scope and does not require tenant-wide security powers for local setup.
```

### Prompt - PR-7B Scoped Entity Activation Workspace

Implemented status:
- Shipped in the current repo. Use this prompt as historical scope, not as an unstarted backlog item.

```text
Implement PR-7B: Scoped Entity Activation Workspace.

Objective:
Turn local legal-entity activation into a first-class scoped workspace so entity/country setup managers can complete local reality without wading through central-only onboarding noise.

Primary files:
- frontend/src/pages/settings/OrganizationManagementPage.jsx
- frontend/src/readiness/RequireTenantReadiness.jsx
- frontend/src/layouts/sidebarConfig.js
- frontend/src/App.jsx
- frontend/src/i18n/messages.js
- backend/src/routes/org.js
- backend/src/routes/onboarding.js
- frontend/backend smoke tests covering organization management, route wiring, and readiness behavior

Requirements:
- Add a clearly scoped entity-activation workspace, either as:
  - a dedicated new page, or
  - a scoped mode inside Organization Management if that keeps the UX cleaner in this repo
- Limit the workspace to the acting user's current legal entity/country context unless they also hold central bootstrap permissions.
- Surface the real local activation checklist, reusing existing contracts where possible:
  - books and local ledger prerequisites
  - chart-of-accounts usage or mapping work
  - fiscal configuration
  - bank and cash setup
  - branch / operating-unit setup
  - local readiness blockers tied to that entity
- Hide tenant-wide onboarding/setup checklist noise for scoped setup users who do not hold onboarding.company.setup.
- Preserve central-admin functionality for users who still hold the broader bootstrap/admin permissions.
- Reuse the existing readiness model and avoid creating a second incompatible readiness framework.
- Add or update route/sidebar/i18n and smoke coverage for the new workspace behavior.

Acceptance target:
- A local setup manager can log in and see a bounded, entity-scoped activation workspace that reflects only their own operational reality.
- Central admins still retain the broader cross-tenant or cross-entity management views they already need.
```

### Prompt - PR-7C Generalized Scoped Local User Administration

Implemented status:
- Shipped in the current repo. Use this prompt as historical scope, not as an unstarted backlog item.

```text
Implement PR-7C: Generalized Scoped Local User Administration.

Objective:
Replace the narrow branch-operator-only seam with a generalized legal-entity-scoped user administration capability for bounded local roles.

Primary files:
- backend/src/routes/security.js
- backend/src/seedCore.js
- frontend/src/api/rbacAdmin.js
- frontend/src/pages/security/BranchOperatorManagementPage.jsx
- frontend/src/pages/security/UserAssignmentsPage.jsx
- frontend/src/pages/security/roleCatalog.js
- backend/scripts/test-security-branch-operator-management-smoke.js
- any RBAC migration / permission / admin UX smokes affected by the new local-admin model

Requirements:
- Introduce an explicit bounded local-admin capability for entity-scoped user administration. If the current security.user_admin.entity permission is too narrow semantically, add a new bounded permission and keep compatibility only where needed during rollout.
- Generalize the existing entity-branch-operator flow into an allow-listed local role administration surface.
- Minimum allow-listed catalog:
  - BranchOperator
  - OUAccountant
  - AuditorReadOnly at local scopes
  - any other already-shipped bounded local operational roles that fit this model without over-granting
- Prevent local managers from:
  - assigning SecurityAdmin or SystemAdmin
  - editing role definitions
  - granting access outside their own entity/country
  - managing tenant-wide data scopes
- Preserve invite support, scope enforcement, audit logging, and role-retirement rules.
- Prefer compatibility bridges over abrupt route deletion if existing branch-operator admin seams are already consumed by tests or live flows.
- Add or update tests for:
  - allow-listed assignment success
  - blocked assignment of non-local or system roles
  - entity-bound scope enforcement
  - compatibility handling for the old branch-operator-only seam if it remains bridged

Acceptance target:
- A legal-entity-scoped manager can invite, assign, revoke, and review bounded local role assignments inside their own entity without becoming a tenant security admin.
```

### Prompt - PR-7D Temporary Operational Coverage Workflow

Implemented status:
- Shipped in the current repo. Use this prompt as historical scope, not as an unstarted backlog item.

```text
Implement PR-7D: Temporary Operational Coverage Workflow.

Objective:
Productize absence coverage as a dedicated request/review/activate workflow that is separate from approval delegation and activates time-bounded local role authority through the existing temporal role-assignment model.

Primary files:
- backend/src/services/approval.engine.service.js
- backend/src/services/approval.delegation.service.js
- backend/src/routes/security.js
- backend/src/routes/approvalPolicies.routes.js
- backend/src/services/authz.scope.service.js
- frontend/src/pages/security/ApprovalDelegationsPage.jsx
- frontend/src/api/rbacAdmin.js
- frontend/src/api/approvalDelegations.js
- any new local-admin or temporary-coverage page you add
- tests covering approval flow, temporal assignments, and scoped runtime resolution

Requirements:
- Implement temporary operational coverage as a dedicated workflow with these states:
  - requested
  - approved
  - active
  - revoked
  - expired
- Use the unified approval engine for review/approval, not a parallel ad-hoc approval stack.
- On approval, materialize the coverage into effective-dated role assignment(s) in user_role_scopes using effective_from and effective_to.
- Keep this separate from approval delegation:
  - approval delegation stays about acting on approval requests
  - temporary operational coverage stays about temporary runtime role authority
- Restrict coverage to an allow-listed set of local operational roles and to scopes the approving manager is allowed to govern.
- Support:
  - requester
  - delegate/coverage user
  - role being covered
  - scope
  - start date
  - end date
  - revoke before expiry
  - auditability of who requested, approved, activated, and revoked
- Reuse natural expiry from effective_to for correctness; do not require a cleanup job just to make expiry work.
- Add or update tests for:
  - request creation
  - approval activation into user_role_scopes
  - reject / revoke behavior
  - expired coverage no longer granting runtime authority
  - no accidental reuse of approval delegation logic for operational coverage

Acceptance target:
- A local operator can request temporary coverage, a scoped manager can approve it, the system activates it for a defined window, and the coverage expires without manual cleanup.
- Approval delegation and operational coverage remain clearly separate concepts in code and UI.
```

---

## Historical Implementation Order

This was the intended execution order for the follow-on track and is now preserved as historical sequence.

### Batch 1 - Phase 0 Consistency
- PR-0A
- UI-0A
- PR-0B
- PR-0C

### Batch 2 - Phase 1 Foundations
- PR-1A
- UI-1A
- PR-1B
- PR-2D

### Batch 3 - Phase 3 Scope Model Clarification
- PR-1C
- PR-1D
- PR-2A
- PR-2C
- PR-2B

### Batch 4 - Approval Engine Pilot
- PR-3A
- PR-3B
- PR-3C
- UI-3A

### Batch 5 - Approval Engine Expansion
- PR-3D
- PR-3E
- PR-3F

### Batch 6 - Role Redesign And SoD
- PR-4A
- PR-4B
- PR-4C
- UI-4A

### Batch 7 - Governance Maturity
- PR-5A
- UI-5A
- PR-5B
- UI-5B
- PR-5C
- UI-5C
- PR-5D
- UI-5D
- PR-5E
- UI-5E

### Batch 8 - Closure
- PR-6A
- PR-6B
- PR-6C
- PR-6D

### Batch 9 - Optional Hardening
- UI-6A
- PR-6E

### Batch 10 - Post-55 Scoped Setup Operating Model
- PR-7A
- PR-7C
- PR-7B
- PR-7D
