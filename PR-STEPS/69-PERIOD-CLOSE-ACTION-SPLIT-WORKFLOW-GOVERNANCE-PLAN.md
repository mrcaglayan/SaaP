# Period Close Action-Split Governance Plan — Reset-DB Cutover Version

## Status

This version assumes the database will be reset before rollout.

That means this is a **clean cutover plan**, not a persisted-data migration plan.

So this plan intentionally removes:

- workflow-definition migration/backfill for already-saved tenant data
- approval snapshot remediation for in-flight requests
- RBAC cleanup/reporting for old tenant assignments
- bridge-exit gates that only exist to protect legacy stored state

The target is still the same product model:

- readiness review
- workflow approval
- close execution
- reopen
- admin/repair
- closed-period journal override kept separate

---

## Core product decision

Do **not** introduce `gl.period.close.group`.

Implement an **action-split model** instead:

1. `org.fiscal_period.read`

   - readiness/review visibility
   - allowed scopes: `LEGAL_ENTITY`, `COUNTRY`, `GROUP`

2. `gl.period.close.approve`

   - workflow approval only
   - allowed scopes: `LEGAL_ENTITY`, `COUNTRY`, `GROUP`

3. `gl.period.close.execute`

   - actual close execution only
   - allowed scopes: `LEGAL_ENTITY`, `COUNTRY`
   - **not** allowed at `GROUP`

4. `gl.period.reopen`

   - corrective reopen only
   - allowed scopes: `LEGAL_ENTITY`, `COUNTRY`

5. `gl.period.admin`

   - admin / operational repair only
   - allowed scopes: `COUNTRY`, `GROUP`

6. `gl.journal.post_to_closed_period`
   - stays separate for exceptional posting
   - not part of routine close governance

---

## Business shape

### Standard

`LEGAL_ENTITY readiness` → `LEGAL_ENTITY approval` → executor runs close

### Supervised

`LEGAL_ENTITY readiness` → `LEGAL_ENTITY approval` → `GROUP approval` → executor runs close

### Small-company fallback

Same user may hold both `approve` and `execute` if the tenant chooses that overlap, but the model must not force it.

---

## Locked product rules

These are not optional:

- workflow approval is not execution
- execution is not reopen
- admin is not routine execution
- `GROUP` may approve
- `GROUP` may not execute
- direct status mutation is not a valid routine close path
- workflow steps for `PERIOD_CLOSE` may use only readiness/review and approval semantics
- runtime close must be governed by execute authority plus completed workflow approval
- new code must stop treating raw `gl.period.close` as the period-close authority model

Because the DB is being reset, the release target is the **new model only**. Any temporary compatibility shims used during implementation must be removed before completion.

---

## Repo seams that the implementation must cover

The uploaded repo/draft already shows the key areas that still use the old single-permission model:

- `backend/src/constants/permission-rules.js`
- `backend/src/constants/permission-groups.js`
- `backend/src/routes/gl.period-closing.routes.js`
- `backend/scripts/backfill-workflow-defaults.js`
- `backend/src/routes/workflows.validators.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`
- `frontend/src/auth/permissionAccess.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- `frontend/src/pages/TrialBalancePage.jsx`
- `frontend/src/pages/periodCloseRuntimeExplainability.js`
- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/security/userAssignmentAuditSummary.js`

The plan is not complete unless all of those surfaces describe the same split model.

---

## Target permission model

### Keep

- `org.fiscal_period.read`
- `gl.period.reopen`
- `gl.period.admin`
- `gl.journal.post_to_closed_period`

### Add

- `gl.period.close.approve`
- `gl.period.close.execute`

### Dependency rules

- `gl.period.close.approve` depends only on review/read visibility as needed
- `gl.period.close.execute` must not be implied by approval
- `gl.period.reopen` must not depend on close approval or close execute
- `gl.period.admin` must not depend on close approval, close execute, or reopen

### Permission-group metadata

`gl.period_governance` must be updated to reflect the split family:

- `gl.period.close.approve`
- `gl.period.close.execute`
- `gl.period.reopen`
- `gl.period.admin`

Do not leave catalog/group metadata on the old one-close shape.

### SoD warnings

- warn on `gl.period.close.approve` + `gl.period.close.execute`
- warn on `gl.period.close.execute` + `gl.period.reopen`
- split readiness-vs-close warnings into:
  - readiness vs approval
  - approval vs execution
  - execution vs reopen
- optional later warning:
  - group approval + descendant entity execution on the same user

---

## Target role model

### Keep, but retarget

- `GLOperator`

  - readiness / operational GL visibility only
  - no approval or execute by default

- `PeriodCloseAuthority`

  - keep role code if useful for continuity
  - new meaning: **execute** bundle

- `PeriodReopenAuthority`

  - reopen only

- `PeriodAdminAuthority`

  - admin / repair only

- `ClosedPeriodJournalOverrideAuthority`
  - unchanged, stays separate

### Add

- `PeriodCloseSupervisorAuthority`
  - approval-only bundle
  - recommended scopes: `LEGAL_ENTITY`, `COUNTRY`, `GROUP`

### Optional later

- `PeriodCloseReadinessReviewer`

### Catalog / diagnostics requirement

Role catalog, assignment audit summaries, and risky-role descriptions must show separate families for:

- readiness
- approval
- execution
- reopen

Do not keep period close collapsed into one family in the admin UI.

---

## Target workflow model

For `PERIOD_CLOSE`, workflow steps represent **review and approval only**.
They do **not** represent runtime execution.

### Allowed workflow-step permissions

- `org.fiscal_period.read`
- `gl.period.close.approve`

### Forbidden workflow-step permissions

- `gl.period.close.execute`
- `gl.period.reopen`
- `gl.period.admin`

### Default workflow chain

- step 1: `LEGAL_ENTITY` readiness review using `org.fiscal_period.read`
- step 2: `LEGAL_ENTITY` approval using `gl.period.close.approve`

### Optional supervised chain

- step 1: `LEGAL_ENTITY` readiness review
- step 2: `LEGAL_ENTITY` approval
- step 3: `GROUP` approval

### Hard backend rule

`backend/src/routes/workflows.validators.js` and the workflow save path must reject invalid `PERIOD_CLOSE` step permissions even if the frontend is bypassed.

---

## Runtime route decision

The legacy route:
`/api/v1/gl/period-statuses/{bookId}/{periodId}/close`

must not remain a normal supported close path in the final build.

### Preferred outcome

- remove checked-in client use
- deprecate/remove it from OpenAPI
- stop using it in app runtime

### Allowed temporary implementation tactic inside the PR track only

If that route must survive briefly while code is being refactored, it may only proxy into governed close-run logic and must not mutate `period_statuses` directly.

### Forbidden outcome

- no admin-only direct-close backdoor
- no second close path that bypasses workflow approval

---

## Shared access helpers requirement

Even without a release bridge, you still need canonical helpers so checks do not drift.

### Backend helpers

Introduce shared helpers for:

- can review readiness
- can approve close step
- can execute close
- can reopen
- can perform admin repair

Reuse them in:

- period-close routes
- workflow gate explainability payloads
- diagnostics / eligibility checks
- any route/service touching period-close permission logic

### Frontend helpers

Introduce shared helpers for:

- review access
- approval access
- execute access
- missing-permission messaging for the split model

Reuse them in:

- `JournalWorkbenchPage.jsx`
- `TrialBalancePage.jsx`
- `periodCloseRuntimeExplainability.js`
- sidebar / navigation gating

### Completion rule

By the end of the track, there should be no remaining active runtime/UI checks that hardcode old single-close semantics.

---

## Hard enforcement rules

The backend must reject every mutation path that could create effective `GROUP` execute.

That includes:

- assigning an execute-carrying role at `GROUP` scope
- moving an execute-carrying assignment to `GROUP` scope
- adding `gl.period.close.execute` to a role that already supports `GROUP` assignment states
- replacing a role permission set with one that newly includes `gl.period.close.execute` in a way that makes `GROUP` execution possible
- local-admin flows writing to the same assignment tables

Warnings are not enough. These must hard-fail server-side.

---

## Implementation plan

## PR-PCGOV-01 — Permission split and hard no-`GROUP`-execute enforcement

### Goal

Create the split permission model and lock the scope boundary correctly before runtime/UI cutover starts.

### Files

- `backend/src/seedCore.js`
- `backend/src/constants/permission-rules.js`
- `backend/src/constants/permission-groups.js`
- `backend/src/routes/security.js`
- `backend/src/services/authz.scope.service.js`
- `frontend/src/auth/permissionAccess.js`
- `frontend/src/pages/security/UserAssignmentWorkbench.jsx`
- security rule / assignment enforcement tests

### Changes

- seed `gl.period.close.approve`
- seed `gl.period.close.execute`
- remove reopen/admin dependency on legacy close
- update `gl.period_governance` metadata to the split model
- add backend shared helper semantics for review / approve / execute / reopen / admin
- add frontend shared helper semantics for the same split access model
- add SoD warnings for approve+execute and execute+reopen
- hard-block `GROUP` execute creation on every assignment/role mutation path

### Acceptance

- security catalog shows both new permissions
- permission-group metadata reflects split governance
- backend rejects all tested paths that would create effective `GROUP` execute
- reopen/admin no longer depend on the old close authority model

---

## PR-PCGOV-02 — Roles, workflow authorities, and backend workflow validation

### Goal

Make shipped role bundles and workflow definitions reflect approval-vs-execution separation.

### Files

- `backend/src/seedCore.js`
- `backend/src/routes/workflows.validators.js`
- `backend/src/services/workflows.service.js`
- `backend/scripts/backfill-workflow-defaults.js`
- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/security/userAssignmentAuditSummary.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
- `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`
- `frontend/src/pages/settings/workflows/components/WorkflowDefinitionStep.jsx`
- `frontend/src/pages/settings/WorkflowSetupPage.jsx`
- role/workflow tests

### Changes

- add `PeriodCloseSupervisorAuthority`
- retarget `PeriodCloseAuthority` to execute semantics
- keep reopen/admin separate
- split period-close catalog/audit families into readiness / approval / execution / reopen
- update workflow authority options and copy to use read + approve only
- update default workflow creation/defaults so `PERIOD_CLOSE` uses readiness + approval, not old close
- add backend rule that `PERIOD_CLOSE` allows only:
  - `org.fiscal_period.read`
  - `gl.period.close.approve`
- reject execute/admin/reopen as workflow-step permissions

### Acceptance

- default period-close workflow no longer recreates single-close semantics
- backend rejects invalid `PERIOD_CLOSE` step permissions even if frontend is bypassed
- role catalog and audit summaries present separate readiness / approval / execution / reopen families
- `GROUP` is valid for approval and invalid for execute

---

## PR-PCGOV-03 — Runtime cutover, direct-close path removal, and UI explainability update

### Goal

Make runtime behavior match the split model everywhere the user can act or see permissions.

### Files

- `backend/src/routes/gl.period-closing.routes.js`
- `backend/src/services/gl.period-closing.service.js`
- `backend/src/services/workflows.service.js`
- `backend/src/services/rbac.diagnostics.service.js`
- `frontend/src/api/glAdmin.js`
- `frontend/src/auth/permissionAccess.js`
- `frontend/src/pages/JournalWorkbenchPage.jsx`
- `frontend/src/pages/TrialBalancePage.jsx`
- `frontend/src/pages/periodCloseRuntimeExplainability.js`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/layouts/AppLayout.jsx`
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`
- route/UI smoke tests

### Changes

- split review access from execute access in period-close routes
- allow readiness/review surfaces for review users without granting execute
- require `gl.period.close.execute` for actual close-run execution
- update workflow gate messages to resolve approval requirements via `gl.period.close.approve`
- remove checked-in client usage of the direct-close status route
- remove or fully deprecate the direct-close route from normal support
- update Journal Workbench, Trial Balance, sidebar, and explainability to use shared split-access helpers
- update diagnostics/explainability text to distinguish readiness, approval, and execution
- update OpenAPI and generated contracts to the final supported route model

### Acceptance

- readiness reviewer can review but cannot execute
- approval-only user can approve but cannot execute
- execute-only user can execute once workflow approval is complete
- no supported runtime path bypasses governed close-run flow
- no active UI/runtime surface still models period close as one undifferentiated close authority

---

## PR-PCGOV-04 — Legacy removal, final hardening, and cross-domain scan

### Goal

Remove leftover old-model references and make the repo internally consistent after the cutover.

### Files

- remaining tests/fixtures referencing raw `gl.period.close`
- `backend/scripts/test-cari-pr29-ap-workflow-rollout-and-uat.js`
- `backend/src/services/localOperationalRoles.service.js`
- `backend/src/routes/onboarding.js`
- any admin/bootstrap/preset surfaces that expose period-close roles

### Changes

- remove residual raw old-close checks from tests and helper code
- rescan non-period-close scripts/surfaces for stale one-permission assumptions
- decide explicitly whether `PeriodCloseSupervisorAuthority` is centrally managed only or can be locally assignable
- document the final exposure choice instead of leaving it implicit

### Acceptance

- no residual cross-domain path reintroduces old single-close semantics
- repo/test fixtures no longer assume `gl.period.close` is both approval and execution
- local assignability decision for `PeriodCloseSupervisorAuthority` is explicit

---

## Recommended implementation order

1. `PR-PCGOV-01`
2. `PR-PCGOV-02`
3. `PR-PCGOV-03`
4. `PR-PCGOV-04`

### Order guardrails

- do not start runtime cutover before the split permission model and no-`GROUP`-execute rule exist
- do not start runtime cutover before workflow validators/defaults are corrected
- do not consider the track complete while OpenAPI/tests/admin UI still describe one close authority

---

## Final success criteria

This plan is complete only when all of the following are true:

- period close no longer uses one permission for both approval and execution
- workflow definitions for `PERIOD_CLOSE` can only use review/read and approval semantics
- runtime close execution is governed only by execute authority plus completed workflow approval
- `gl.period.admin` is separated from routine close execution
- `GROUP` supervision exists without creating `GROUP` execute power
- role catalog, audit summaries, workflow setup, runtime explainability, diagnostics, client contracts, and OpenAPI all describe the same split model
- there are no remaining active raw checks that silently treat `gl.period.close` as both approval and execution
