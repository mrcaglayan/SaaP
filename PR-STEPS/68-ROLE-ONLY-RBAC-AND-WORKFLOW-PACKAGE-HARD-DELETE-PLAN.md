# PR-68 - Role-Only RBAC and Workflow-Package Hard-Delete Plan

## Status

- Proposed on April 19, 2026
- Repo-checked against the April 19, 2026 local snapshot
- Scope is security assignment, explainability, SoD, and workflow authorization contract cleanup
- Assumes fresh database / fresh-tenant rollout or one coordinated local reset
- Locked decision: raw scoped runtime roles become the only assignable authority model
- Locked decision: workflow packages are deleted completely from live product code, not merely hidden behind compatibility code
- Locked decision: SoD, explainability, missing, and blocked diagnostics must be derived from roles and permissions
- Locked decision: workflow routing stays, but AP step authorization and persistence must stop depending on package codes or package vocabulary

---

## Goal

Make raw role assignments the single source of truth for:

1. what a user can do
2. where a user can do it
3. what role or permission is missing for a target function
4. what assignment should be blocked because it creates a SoD conflict

The end state is:

- users are assigned only runtime roles
- runtime authorization is still permission-based
- explainability summarizes effective capabilities from assigned roles
- SoD evaluates role and permission conflicts directly
- workflow setup remains available, but it uses permission-based step contracts and no workflow-package abstraction survives in live code

---

## Out Of Scope

- removing the generic workflow / approval engine itself
- redesigning the org-scope hierarchy
- brownfield migration / compatibility for old production tenants
- preserving workflow-package vocabulary, schema fields, helpers, or fallback adapters after cutover
- broad business-role redesign outside the package-only authority gaps listed below
- unrelated security-admin UX cleanup that does not depend on workflow-package hard deletion

---

## Current Repo Seams Confirmed

### Security and assignment surfaces

- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/userAssignmentAuditSummary.js`
- `frontend/src/pages/security/userAssignmentAuthorityPreview.js`
- `frontend/src/pages/security/accessDiagnosticsSummary.js`
- `backend/src/routes/security.js`
- `backend/src/services/authz.scope.service.js`

### Workflow definition and routing

- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/routes/workflows.validators.js`
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `shared/cariDocumentWorkflowGovernance.js`

### AP runtime seams

- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.document.workflow.runtime.service.js`
- `backend/src/routes/cari.document.routes.js`

---

## Current-State Findings

### Conflict / plan gap

- Runtime authorization is already role and permission based. `checkUserHasPermissionAtScope()` resolves authority from `user_role_scopes -> role_permissions -> permissions`, not from workflow-package rows.
- Security explainability and SoD are not truly role-native yet. They still translate active role bundles into workflow-package coverage and reason in package terms.
- `RISKY_RUNTIME_ROLE_RULES` is still empty in `frontend/src/pages/security/userAssignmentAuditSummary.js`. PR-ROLEONLY-05 needs an explicit role-native rule matrix for the six shipped SoD warning scenarios; otherwise there is no concrete definition of done.
- AP workflow definitions are structurally package-bound today. `AP_DOCUMENT_POSTING` steps require `requiredPackageCode` and reject `requiredPermissionCode`.
- `shared/cariDocumentWorkflowGovernance.js` is the first AP seam to replace, not just another file in the list. The shared `AP_DOCUMENT_REQUIRED_PACKAGE_BY_ACTION` contract is imported across AP workflow/runtime code, so PR-ROLEONLY-02 must swap that map to a permission-first contract before the rest of the AP refactor can stabilize.
- Non-AP workflow families are already permission-first. `PERIOD_CLOSE`, `LOCAL_CLOSE_PACK`, and `CONSOLIDATION_RUN` require `requiredPermissionCode` and reject `requiredPackageCode`.
- `required_package_code` is a real persisted column on `workflow_definition_steps`, introduced by `backend/src/migrations/m179_ap_workflow_action_step_contract.js`. Hard deletion is incomplete without an explicit later drop migration.
- `frontend/src/pages/security/userAssignmentAuthorityPreview.js` still resolves active roles through `resolveWorkflowPackagesForRuntimeRoles()` and the workflow-package catalog. Explainability therefore has to move before or with security-UI package removal; otherwise the preview breaks during transition.
- Direct workflow-package grants are currently persisted as managed roles with the `WORKFLOW_PACKAGE__` prefix. That means package assignments are already piggybacking on the same role-assignment table.
- Hard deletion also needs a real live-data cleanup path. Existing `WORKFLOW_PACKAGE__...` rows in `roles`, `role_permissions`, and `user_role_scopes` will survive indefinitely unless a reset or cleanup script removes them.
- Several business authorities are still represented only as package definitions or as package-only direct grants, not as clean narrow runtime roles. Workflow-package hard deletion cannot finish until those authorities have real runtime roles.

### Deferred item already covered

- The workflow engine, routing matrix, approval bridge, and scope resolution do not need replacement in this track.
- The security UI already computes derived package coverage from runtime roles. That existing derivation path is the right seam to replace with role-native capability summaries.

### Optional hardening

- Add an internal capability-rule layer that groups permissions into explainable business actions such as `AP_POST`, `PERIOD_CLOSE`, `CONSOLIDATION_FINALIZE`, and `WORKFLOW_SETUP_ADMIN`. This should stay internal and should not reintroduce package assignment as a user-facing abstraction.

---

## Target End State

| Concern | End-state source of truth |
|---|---|
| Assignment | raw runtime roles only |
| Runtime authorization | permissions granted by roles |
| Workflow step gating | `requiredPermissionCode` |
| Workflow step persistence | permission-first step definitions, no package-code fields |
| Explainability | role summaries + permission/capability derivation |
| SoD | role conflict rules and permission conflict rules |
| Missing / blocked guidance | permissions required at scope + roles that satisfy them + SoD blockers |
| Admin UX | no workflow-package surfaces, labels, filters, or counters |

### What stays

- `roles`
- `permissions`
- `workflow definitions`
- `workflow assignments`
- `approval engine`
- `scope-based RBAC`

### What gets hard-deleted

- direct workflow-package assignment as an admin concept
- managed `WORKFLOW_PACKAGE__...` roles
- workflow-package catalogs, helpers, constants, and UI vocabulary
- package-backed explainability and package-backed SoD rules
- AP action-step validation or persisted step fields that depend on package codes

---

## Required Role Coverage Before Hard Deletion

The following package-only or overly abstract authorities need explicit runtime roles before workflow packages can be removed cleanly:

| Area | Runtime role outcome needed |
|---|---|
| Workflow governance | `WorkflowGovernanceAdmin`, `WorkflowQueueViewer` |
| Local close | `LocalClosePreparer`, `LocalCloseReviewer`, `LocalCloseApproveLockAuthority`, optional `LocalCloseReopenAdminAuthority` |
| Period close | `PeriodCloseAuthority`, `PeriodReopenAuthority`, `PeriodAdminAuthority`, `ClosedPeriodJournalOverrideAuthority` |
| Consolidation | `ConsolidationRunPreparer`, `ConsolidationRunExecutor`, `ConsolidationAdjustmentPoster`, `ConsolidationEliminationPoster`, `ConsolidationFinalizer`, optional `ConsolidationSetupAdmin` |
| AP action coverage | existing AP roles can stay if their permission sets remain the runtime source of truth |

Notes:

- Local close hard deletion is cleaner if `LocalCloseReviewer` no longer doubles as both review and approve/lock authority. If that split is deferred, PR-ROLEONLY-05 must still implement permission-family SoD warnings for the broad current runtime role.
- AP already has real runtime roles for draft/submit, approve, post, and reverse coverage. The main blocker is the AP workflow-definition contract, not missing AP roles.

---

## Implementation Plan

### PR-ROLEONLY-00 - Planning Realignment

#### Goal

Make the roadmap internally consistent before code changes start.

#### Changes

1. Mark this plan as superseding package-bound decisions in:
   - `PR-STEPS/63-AP-ACTION-STEP-WORKFLOW-FLEXIBILITY-PLAN.md`
   - package-assignment parts of the security-admin redesign tracks that still assume direct package grants remain first-class
2. Lock the product decision that workflow-package semantics do not survive this track in live product code, persistence, or UI vocabulary.
3. Document that fresh reset is acceptable and preferred if legacy local data depends on `WORKFLOW_PACKAGE__...` roles or package-coded workflow definitions.

#### Acceptance

- No active roadmap still claims that AP authorization must stay package-bound.
- Reviewers can tell that workflow-package hard deletion is intentional, not incidental cleanup.

---

### PR-ROLEONLY-01 - Seed Explicit Runtime Roles For Package-Only Authorities

#### Goal

Ensure every kept business authority is backed by a real runtime role before workflow-package deletion begins.

#### Files

- `backend/src/seedCore.js`
- `frontend/src/pages/security/roleCatalog.js`
- any related release-gate or seed assertions

#### Changes

1. Add narrow runtime roles for the package-only authorities listed above.
2. Keep their permission sets explicit and ERP-style narrow.
3. Update the role catalog so these roles are first-class assignable roles, not just package mappings.
4. Remove any expectation that direct package assignment is required to obtain these authorities.

#### Acceptance

- Every currently supported governed authority has at least one explicit runtime role.
- No business function is available only through direct workflow-package grants.

---

### PR-ROLEONLY-02 - Refactor AP Workflow Definitions To Permission-Based Steps

#### Goal

Remove the last structural dependency on workflow-package codes from workflow-definition validation and persistence.

#### Files

- `backend/src/services/workflows.service.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/rbac.diagnostics.service.js`
- `shared/cariDocumentWorkflowGovernance.js`
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/components/WorkflowStepsBuilderStep.jsx`
- `backend/src/services/cari.document.service.js`

#### Changes

1. Replace `AP_DOCUMENT_REQUIRED_PACKAGE_BY_ACTION` in `shared/cariDocumentWorkflowGovernance.js` with an AP action-to-permission contract first. All later AP workflow validation and runtime changes in this PR depend on that shared contract swap.
2. Replace AP `requiredPackageCode` validation with `requiredPermissionCode` or an equivalent permission-first action contract.
3. Update AP step persistence, validation, diagnostics, and explainability so AP no longer stores, returns, or depends on package codes.
4. Remove package-coded AP normalization branches from shared validators and diagnostics helpers.
5. Keep scope-bound action authoring in the setup wizard, but present role guidance as recommendations instead of package requirements.

#### Acceptance

- AP workflow definitions can be created and updated without any package code.
- AP submit, approve, and post gating still works using the permissions granted by assigned roles.
- No AP workflow payload, validator, or stored definition still carries `requiredPackageCode`.
- No shared AP action contract still exports `AP_DOCUMENT_REQUIRED_PACKAGE_BY_ACTION`.

---

### PR-ROLEONLY-04 - Replace Package-Based Explainability With Role-Based Explainability

#### Goal

Explain effective authority directly from roles and permissions.

#### Files

- `frontend/src/pages/security/userAssignmentAuthorityPreview.js`
- `frontend/src/pages/security/accessDiagnosticsSummary.js`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/roleCatalog.js`

#### Changes

1. Land this PR before or alongside PR-ROLEONLY-03. The current authority preview still resolves roles through the workflow-package catalog, so removing package-assignment UI first would break explainability during transition.
2. Replace package-coverage summaries with role-native or capability-native summaries.
3. For each governed family, compute:
   - roles present
   - permissions satisfied
   - roles or permissions missing
   - candidate roles that would satisfy the missing authority
4. Preserve scope-sensitive reasoning and inherited-coverage diagnostics.
5. Update labels from `package` vocabulary to `role` / `authority` / `permission` vocabulary.

#### Acceptance

- Explainability panels no longer depend on package codes.
- Users can understand what they can do from the assigned roles alone.
- Missing and blocked guidance references roles and permissions, not packages.

---

### PR-ROLEONLY-03 - Remove Direct Workflow-Package Assignment From Security

#### Goal

Make security assignment role-only after the explainability path is already role-native.

#### Files

- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/UserAssignmentWorkbench.jsx`
- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/security/securityAdminOverviewSummary.js`
- `backend/src/routes/security.js`

#### Changes

1. Remove direct workflow-package assignment forms, tabs, counts, and source labels from the security UI.
2. Remove managed-package role creation / repair flows.
3. Stop treating `WORKFLOW_PACKAGE__...` roles as a supported assignment mode.
4. Update admin summaries to count only role assignments, not package assignments.

#### Acceptance

- Security admin can assign only runtime roles.
- No live security UI offers direct workflow-package assignment.
- No new `WORKFLOW_PACKAGE__...` roles are created.
- Existing `WORKFLOW_PACKAGE__...` special casing is removed instead of retained as dormant compatibility code.

---

### PR-ROLEONLY-05 - Replace Package-Based SoD With Role/Permission SoD

#### Goal

Evaluate SoD directly from runtime role sets and effective permissions.

#### Files

- `frontend/src/pages/security/userAssignmentAuditSummary.js`
- any SoD helper catalog introduced in this track
- related security-admin UI consumers

#### Changes

1. Replace `SOD_PACKAGE_RULES` with role-conflict and permission-conflict rules, and stop leaving `RISKY_RUNTIME_ROLE_RULES` empty.
2. Ship an explicit role-native SoD matrix for the six current warning scenarios:
   - AP maker / reviewer overlap: `BranchOperator`, `OUAPSubmitter`, `EntityAPController` versus `CountryAPApprover`, `APApprover`
   - AP reviewer / poster overlap: `CountryAPApprover`, `APApprover` versus `CountryAPPoster`
   - local close prepare / review overlap: `LocalClosePreparer` versus `LocalCloseReviewer`
   - local close review / approve-lock overlap: `LocalCloseReviewer` versus `LocalCloseApproveLockAuthority`, with permission-family fallback if the split is still pending
   - period close readiness / close overlap: readiness roles such as `BranchOperator`, `GLOperator`, `GroupReportingController` versus `PeriodCloseAuthority`
   - consolidation operator / finalizer overlap: `ConsolidationRunPreparer`, `ConsolidationRunExecutor`, `ConsolidationAdjustmentPoster`, `ConsolidationEliminationPoster` versus `ConsolidationFinalizer`
3. Keep permission-conflict fallback for any still-broad runtime role that spans both sides of a control before narrower runtime roles fully ship.
4. Make warnings explain:
   - which active roles caused the overlap
   - which permission families overlap
   - which candidate new role should be blocked
5. Add role-based blocked-assignment diagnostics so the UI can warn before saving a conflicting role.

#### Acceptance

- SoD warnings still appear with no package assignments in the system.
- Warnings cite actual roles and scope, not package labels.
- The admin UI can explain why a candidate role should be blocked.
- `RISKY_RUNTIME_ROLE_RULES` is populated with a shipped rule catalog instead of `Object.freeze({})`.

---

### PR-ROLEONLY-06 - Remove Package Catalog Consumers And Legacy Code

#### Goal

Delete the workflow-package abstraction after all remaining consumers are gone.

#### Files

- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `backend/src/migrations/m202_drop_workflow_definition_steps_required_package_code.js`
- `backend/scripts/cleanup-delete-workflow-package-managed-roles.js` or equivalent reset/cleanup script
- package-related admin pages / filters / counters
- any tests or fixtures that still expect package-backed roles

#### Changes

1. Remove `WORKFLOW_PACKAGE_CATALOG` and direct package-assignment helpers after the role-only refactor is complete.
2. Remove package filters, package counters, and package labels from security admin surfaces.
3. Remove `WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX` handling.
4. Delete or rewrite tests and fixtures that depend on direct package assignments.
5. Add an explicit migration, `m202_drop_workflow_definition_steps_required_package_code.js`, to drop `workflow_definition_steps.required_package_code`.
6. Add a reset/cleanup path that deletes existing `WORKFLOW_PACKAGE__...` managed roles and their dependent rows from live local data.
7. Remove package-related schema fields or normalization branches that only existed for package contracts.

#### Acceptance

- No live product code requires workflow packages as an assignment abstraction or workflow-definition concept.
- No package-backed role special casing remains in security assignment logic.
- `workflow_definition_steps.required_package_code` no longer exists after migration.
- No live local data still depends on `WORKFLOW_PACKAGE__...` managed roles after reset or cleanup.
- Workflow setup and runtime behavior still function.

---

## Implementation Order

| Order | PR | Why first |
|---|---|---|
| 1 | `PR-ROLEONLY-00` | avoid roadmap contradictions |
| 2 | `PR-ROLEONLY-01` | create real roles before deleting package paths |
| 3 | `PR-ROLEONLY-02` | remove AP structural dependency on package codes |
| 4 | `PR-ROLEONLY-04` | land role-native explainability before UI package removal |
| 5 | `PR-ROLEONLY-03` | switch security assignment to roles only after preview is safe |
| 6 | `PR-ROLEONLY-05` | restore SoD and blocked-role diagnostics on the new model |
| 7 | `PR-ROLEONLY-06` | final hard deletion of package abstraction and remnants |

---

## Release Gates

### Search gate before final cleanup

- no direct package-assignment UI remains
- no active code path creates `WORKFLOW_PACKAGE__...` roles
- no active code path still exports or consumes `AP_DOCUMENT_REQUIRED_PACKAGE_BY_ACTION`
- no SoD rule still depends on package codes
- AP workflow definitions no longer require `requiredPackageCode`
- no workflow-definition payload, validator, or persisted record still carries package-code fields
- `workflow_definition_steps.required_package_code` has been dropped
- no local data still depends on `WORKFLOW_PACKAGE__...` managed roles after reset or cleanup

### Functional gate before package deletion

1. Assign only roles to a user and verify:
   - submit AP
   - approve AP
   - post AP
   - prepare / review / approve local close
   - review / close / reopen / administer period close
   - prepare / execute / finalize consolidation
2. Confirm explainability shows:
   - active roles
   - missing authority
   - blocked authority
3. Confirm SoD warnings still fire from raw role assignments only.

---

## Success Criteria

- The system can be administered entirely through raw role assignments.
- Workflow packages no longer exist in live product code as an assignment, explainability, SoD, or workflow-definition abstraction.
- AP no longer has a structural package dependency.
- Explainability and SoD continue to work using the roles a user actually has.
