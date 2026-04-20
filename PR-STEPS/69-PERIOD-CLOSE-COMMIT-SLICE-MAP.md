# Period Close Cutover Commit Slice Map

This file separates the current worktree into cleaner commit-sized slices for
plan 69.

It does not introduce new product work. It classifies the existing diff into:

- `PR-PCGOV-01`
- `PR-PCGOV-02`
- `PR-PCGOV-03`
- `PR-PCGOV-04`
- unrelated cleanup
- unrelated existing or generated noise to exclude from period-close commits

## Recommended commit order

1. `PR-PCGOV-01` foundation
2. `PR-PCGOV-02` roles and workflow model
3. `PR-PCGOV-03` runtime and OpenAPI cutover
4. `PR-PCGOV-04` legacy removal and final hardening
5. unrelated cleanup fixes

## Exclude from period-close commits

These changes are not part of plan 69 and should not be mixed into the period-close slices.

- `frontend/node_modules/.vite/deps/*`
  Generated Vite cache noise.
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
  Current diff is invite modal and scope-default behavior, not period-close governance.
- `PR-STEPS/69-PERIOD-CLOSE-ACTION-SPLIT-WORKFLOW-GOVERNANCE-PLAN.md`
  Working plan document, not code cutover behavior.

## PR-PCGOV-01

Goal: permission split, shared helpers, and hard no-`GROUP`-execute enforcement.

Primary files:

- `shared/periodCloseGovernance.js`
- `backend/src/constants/permission-groups.js`
- `backend/src/constants/permission-rules.js`
- `backend/src/routes/security.js`
- `backend/src/services/authz.scope.service.js`
- `frontend/src/auth/permissionAccess.js`
- `backend/scripts/test-security-pr1d-permission-rules.js`
- `backend/scripts/test-security-pr1e-period-close-split-guardrails.js`

Supporting files that still fit this slice:

- `backend/src/routes/org.js`
  Review surfaces now accept any valid period-close view authority instead of raw readiness only.
- `frontend/src/pages/security/accessDiagnosticsSummary.js`
- `frontend/src/pages/security/userAssignmentAuthorityPreview.js`

Mixed file notes:

- `backend/src/seedCore.js`
  Keep only the permission seeding changes here:
  - import shared period-close permission constants
  - replace raw `gl.period.close` permission seed with approve and execute
  Do not include role bundle retargeting from the later slice.

## PR-PCGOV-02

Goal: role bundles, workflow authorities, default workflow shape, and backend workflow validation.

Primary files:

- `backend/scripts/backfill-workflow-defaults.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
  Keep only the `assertPeriodCloseWorkflowDefinitionSteps` and workflow-step normalization validation hunk in this slice.
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- `frontend/src/pages/settings/workflows/components/WorkflowDefinitionStep.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`
- `frontend/src/pages/security/userAssignmentAuditSummary.js`
- `backend/scripts/test-security-ui3b-step-builder-refactor.js`
- `backend/scripts/test-security-ui3c-step-validation-inline-warnings.js`
- `backend/scripts/test-workflows-pr3e-unified-migration.js`

Supporting files that still fit this slice:

- `frontend/src/pages/security/accessDiagnosticsSummary.js`
  Suggested period-close authority completion now uses readiness, approval, and execution separately.
- `frontend/src/pages/security/userAssignmentAuthorityPreview.js`
  Same split authority suggestion logic.

Mixed file notes:

- `backend/src/seedCore.js`
  Keep these role-model changes here:
  - add `PeriodCloseSupervisorAuthority`
  - retarget `PeriodCloseAuthority` to execute
  - remove reopen and admin dependency on the old close bundle
  - keep closed-period override on its own authority
- `frontend/src/pages/security/roleCatalog.js`
  Keep only the period-close workflow authority and role-family changes here:
  - `WORKFLOW_AUTHORITY_CATALOG` split for readiness, approval, execution, reopen, admin, and closed-period post
  - `PeriodCloseSupervisorAuthority`
  - updated `PeriodCloseAuthority`, `PeriodReopenAuthority`, `PeriodAdminAuthority`, and `ClosedPeriodJournalOverrideAuthority`

## PR-PCGOV-03

Goal: runtime cutover, review vs execute separation, and OpenAPI/client/UI explainability alignment.

Primary files:

- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`
- `backend/src/routes/gl.period-closing.routes.js`
- `backend/src/services/workflows.service.js`
  Keep only the workflow-gate explainability metadata hunk in this slice:
  - `currentStepAccess`
  - `currentStepNo`
  - `stageScopeType`
  - `requiredPermissionCode`
- `frontend/src/api/glAdmin.js`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- `frontend/src/pages/TrialBalancePage.jsx`
- `frontend/src/pages/periodCloseRuntimeExplainability.js`
- `backend/scripts/test-cash-exf02-close-reopen-integrity.js`
- `backend/scripts/test-security-ui4d-period-close-runtime-explainability.js`

Supporting files that still fit this slice:

- `backend/src/routes/org.js`
  If you prefer to keep review-surface gating with the runtime cutover instead of the helper foundation, move this file here.
- `backend/scripts/test-cari-pr29-ap-workflow-rollout-and-uat.js`
  This validates the final governed runtime path and can live here or in the final hardening slice.

Mixed file notes:

- `backend/src/routes/gl.period-closing.routes.js`
  This file is runtime-only and can stay whole in `PR-PCGOV-03`.
- `frontend/src/auth/permissionAccess.js`
  The helper definitions belong in `PR-PCGOV-01`; the runtime pages that consume them belong here.

## PR-PCGOV-04

Goal: remove stale old-model references and make central-only exposure explicit.

Primary files:

- `backend/src/routes/onboarding.js`
- `backend/src/services/localOperationalRoles.service.js`
- `backend/scripts/test-followup-prf13-bootstrap-handoff.js`
- `backend/scripts/test-security-branch-operator-management-smoke.js`
- `backend/scripts/test-security-governance-release-gate.js`

Supporting files that still fit this slice:

- `backend/scripts/test-cari-pr29-ap-workflow-rollout-and-uat.js`
  Use this here if you want the final hardening slice to own the cross-domain validation pass.

Mixed file notes:

- `frontend/src/pages/security/roleCatalog.js`
  Keep only the explicit central-management wording for `PeriodCloseSupervisorAuthority` here if you want the exposure decision isolated from the broader role-family cutover.

## Unrelated cleanup

These changes are valid, but they are not part of the numbered plan-69 cutover.

- `backend/src/seedCore.js`
  Remove `fixed_assets.post` from `BranchFixedAssetOperator`.
- `backend/scripts/test-security-pr4a-duty-boundary-roles.js`
  Regression for the branch fixed-asset duty boundary.
- `frontend/src/pages/security/roleCatalog.js`
  Add synthetic handling for `WORKFLOW_PACKAGE__...` role codes used by the roles UI test.
- `frontend/src/pages/security/RolesPermissionsPage.jsx`
  Restore `Package-backed roles` wording expected by the UX-RBAC browse surface test.
- `frontend/src/pages/security/RolesPermissionsPanels.jsx`
  Restore `Package-backed authority` wording expected by the UX-RBAC panel test.
- `backend/scripts/test-security-ux-rbac-03-roles-permissions-reframe.js`
  Exercises the roles UI expectations that drove the unrelated cleanup above.

## Practical staging guidance

Because a few files are mixed, do not stage by filename only for every slice.

Files that should be split by hunk:

- `backend/src/seedCore.js`
- `backend/src/services/workflows.service.js`
- `frontend/src/pages/security/roleCatalog.js`

Files that are safe to stage whole for one slice:

- `backend/src/constants/permission-groups.js`
- `backend/src/constants/permission-rules.js`
- `backend/src/routes/security.js`
- `backend/src/routes/gl.period-closing.routes.js`
- `backend/src/routes/onboarding.js`
- `backend/src/services/localOperationalRoles.service.js`
- `frontend/src/auth/permissionAccess.js`
- `frontend/src/api/glAdmin.js`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- `frontend/src/pages/TrialBalancePage.jsx`
- `frontend/src/pages/periodCloseRuntimeExplainability.js`
- `frontend/src/pages/security/RolesPermissionsPage.jsx`
- `frontend/src/pages/security/RolesPermissionsPanels.jsx`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`

