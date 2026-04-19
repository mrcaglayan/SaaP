Here is the full gap analysis:

PR-68 Implementation Status
DONE (4/6)
PR-ROLEONLY-01 — All 14 runtime roles seeded in seedCore.js and registered in roleCatalog.js. Acceptance criteria met.

PR-ROLEONLY-03 — No WORKFLOW_PACKAGE assignment UI in UserAssignmentsPage.jsx or UserAssignmentWorkbench.jsx. Admin overview summaries no longer count package assignments.

PR-ROLEONLY-04 — userAssignmentAuthorityPreview.js no longer calls resolveWorkflowPackagesForRuntimeRoles(). No package-catalog indirection in accessDiagnosticsSummary.js. Fully role-native.

PR-ROLEONLY-06 — Migration m202_drop_workflow_definition_steps_required_package_code.js exists and is registered. Cleanup script cleanup-delete-workflow-package-managed-roles.js exists.

PARTIAL / GAPS (2/6)
PR-ROLEONLY-02 — AP_DOCUMENT_REQUIRED_PACKAGE_BY_ACTION is gone and AP steps correctly use requiredPermissionCode. However, legacy package code remains:

workflowSetupHelpers.js:157-175 — getWorkflowPackageLabel() and deriveActionLabelFromPackage() still present
workflowSetupHelpers.js:238-248 — legacy fallback in inferApWorkflowStepActionCode() for old AP package codes
workflowSetupHelpers.js:607-614 — normalizeStepDraft() still outputs requiredPackageCode for non-AP workflows
Acceptance criterion "no shared AP action contract still exports AP_DOCUMENT_REQUIRED_PACKAGE_BY_ACTION" passes, but the broader "no AP workflow payload or validator still carries requiredPackageCode" does not.
PR-ROLEONLY-05 — RISKY_RUNTIME_ROLE_RULES is populated (not the empty freeze from the plan's gap description). However, it needs verification that all 6 SoD scenarios from the plan are covered (AP maker/reviewer, reviewer/poster, local close prepare/review, review/approve-lock, period close, consolidation operator/finalizer). The agent confirmed rules exist with severity levels but did not verify all 6 scenarios explicitly.

Residual Issues Cutting Across PRs
Issue	File	Plan Gate
WORKFLOW_PACKAGE_CATALOG still exported	roleCatalog.js	PR-ROLEONLY-06 acceptance: "Remove WORKFLOW_PACKAGE_CATALOG"
WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX still in security.js + roleCatalog.js	security.js	PR-ROLEONLY-06: "Remove WORKFLOW_PACKAGE_ASSIGNMENT_ROLE_PREFIX handling" — current use is detection-only, not creation, so arguably acceptable
Bottom Line
The structural hard work is done — roles seeded, package assignment UI gone, explainability is role-native, migration and cleanup scripts exist. The remaining gaps are:

PR-ROLEONLY-02: legacy requiredPackageCode normalization code in workflowSetupHelpers.js not yet deleted (non-AP path still outputs it)
PR-ROLEONLY-05: need to verify all 6 SoD rule scenarios are explicitly covered in RISKY_RUNTIME_ROLE_RULES
PR-ROLEONLY-06: WORKFLOW_PACKAGE_CATALOG export not yet removed from roleCatalog.js