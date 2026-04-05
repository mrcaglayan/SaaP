# Tenant Bootstrap vs Legal-Entity Activation — Implementation Tracker

## Status
- Planned
- Repo-aligned with current onboarding/readiness structure
- Goal: reduce first-admin setup complexity by separating tenant birth from legal-entity go-live
- Locked decision: **shareholder setup is a legal-entity activation task, not a tenant bootstrap blocker**

---

## Purpose

Split the current readiness model into two business layers:

1. **Tenant Bootstrap Readiness**
   - owned by the first bootstrap admin
   - proves the tenant shell exists and can be handed off

2. **Legal-Entity Activation Readiness**
   - owned by entity/country finance setup owners
   - proves a specific legal entity is actually ready to operate

This keeps first login focused and prevents legal-entity accounting tasks from appearing as tenant-wide setup blockers.

---

## Current Repo Seams Confirmed

### Existing tenant readiness flow
- `backend/src/services/tenant-readiness.service.js`
- `frontend/src/api/readiness.js`
- `frontend/src/readiness/TenantReadinessProvider.jsx`
- `frontend/src/readiness/TenantReadinessChecklist.jsx`
- `frontend/src/readiness/RequireTenantReadiness.jsx`
- `frontend/src/layouts/AppLayout.jsx`

### Existing module readiness flow
- `backend/src/routes/onboarding.module-readiness.routes.js`
- `backend/src/services/module-readiness.service.js`
- `frontend/src/readiness/ModuleReadinessProvider.jsx`

### Existing bootstrap flow
- `backend/src/routes/onboarding.js`
- `/api/v1/onboarding/readiness/bootstrap-baseline`
- `frontend/src/pages/settings/CompanyOnboardingPage.jsx`

### Existing entity activation UI seam
- `frontend/src/App.jsx`
- route: `/app/ayarlar/entity-aktivasyon-alani`
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`

### Existing bootstrap user / role seam
- `backend/src/routes/provider.js`
- `backend/src/services/systemRoles.service.js`

---

## Locked Business Rules

### Rule 1 — Tenant bootstrap only answers
**“Does this tenant exist in a minimally usable structure?”**

### Rule 2 — Legal-entity activation answers
**“Is this legal entity ready to operate?”**

### Rule 3 — Shareholder setup is not tenant-wide readiness
Shareholder/equity setup belongs to **legal-entity activation**.

### Rule 4 — Bootstrap wizard may prefill advanced setup
Bootstrap may save optional shareholder/current-account/workflow settings if provided,
but those must not determine whether tenant bootstrap is complete.

### Rule 5 — Scoped entity setup users should not be blocked by tenant-global noise
If tenant bootstrap is complete enough, legal-entity owners should be able to work on entity activation without seeing unrelated tenant-wide blockers.

---

## Target Readiness Classification

### A. Tenant Bootstrap Readiness
Keep these checks in tenant readiness:
- `groupCompanies`
- `legalEntities`
- `fiscalCalendars`
- `fiscalPeriods`
- `books`
- `openBookPeriods`
- `chartsOfAccounts`
- `accounts`

Optional future check:
- `bootstrapHandoffUsers`

### B. Legal-Entity Activation Readiness
Move these out of tenant readiness and into entity activation:
- `shareholders`
- `shareholderCommitmentConfigs`
- `workflowCloseConsolidationV1`
- `operatingUnitCurrentAccounts`

### C. Optional / module readiness
Keep as optional or module-level, not first-login blockers:
- tax engine packs
- advanced workflow packs
- future subaccount canonical setup
- other policy-pack-driven extras that are not universally required

---

# PR-1 — Reclassify Tenant Readiness to Bootstrap Only

## Goal
Turn current tenant readiness into **tenant bootstrap readiness only**.

## Files
### Backend
- `backend/src/services/tenant-readiness.service.js`

### Frontend
- `frontend/src/readiness/TenantReadinessChecklist.jsx`
- `frontend/src/readiness/TenantReadinessProvider.jsx`
- `frontend/src/readiness/RequireTenantReadiness.jsx`
- `frontend/src/layouts/AppLayout.jsx`
- `frontend/src/i18n/messages.js`

## Backend changes
1. Remove these checks from tenant readiness definitions:
   - `shareholders`
   - `shareholderCommitmentConfigs`
   - `workflowCloseConsolidationV1`
   - `operatingUnitCurrentAccounts`
2. Remove their counting / readiness aggregation from the tenant snapshot.
3. Keep the response contract stable where possible, but update labels/summary to reflect **bootstrap** meaning.
4. Preserve existing `ready` boolean semantics, now only based on bootstrap checks.

## Frontend changes
1. Update readiness checklist labels and descriptions to say **Tenant Bootstrap Readiness** or equivalent user-facing wording.
2. Remove setup-link routing for:
   - shareholder mappings
   - workflow readiness
   - OU current accounts
   from the tenant-wide checklist.
3. Update AppLayout readiness chip summary so the first admin does not see legal-entity blockers as tenant-wide blockers.
4. Update guard copy so setup users understand the gap is **bootstrap**, not full go-live.

## Acceptance
- First login no longer shows shareholder as a tenant-wide blocker.
- Tenant readiness only reflects structural tenant setup.
- Readiness chip becomes shorter and easier to understand.
- Scoped users are no longer indirectly warned about unrelated entity-level blockers through tenant readiness UI.

## Smoke checks
- bootstrap admin logs in to empty tenant and sees only bootstrap tasks
- readiness badge becomes green after structural setup is complete even if shareholder/workflow/ou tasks are unfinished
- existing consumers of `/api/v1/onboarding/readiness` still render without crashing

---

# PR-2 — Add Legal-Entity Activation Readiness Service and API

## Goal
Create a dedicated backend API that summarizes readiness **per legal entity**.

## Files
### Backend new
- `backend/src/services/legal-entity-activation-readiness.service.js`
- `backend/src/routes/onboarding.activation-readiness.routes.js`

### Backend touched
- `backend/src/index.js`
- `backend/scripts/generate-openapi.js`
- `backend/openapi.yaml`

## Endpoint
`GET /api/v1/onboarding/legal-entity-activation`

### Query behavior
Lock **Option B** explicitly:

- no `legalEntityId`: return all legal entities visible to the caller's visibility scope
  - bootstrap / tenant-wide user -> all active tenant legal entities they can oversee
  - country-scoped user -> only legal entities visible in that country scope
  - legal-entity-scoped user -> only that visible legal entity
- with `legalEntityId`: return only that entity, and reject out-of-scope access with `403`

### Route-level permission and scope enforcement
Match current repo authz style, but do **not** copy the current `/api/v1/onboarding/module-readiness` tenant-scope fallback for the no-param case:

- require `org.tree.read`
- when `legalEntityId` **is provided**:
  - `resolveScope(...)` must return `{ scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }`
  - call `assertLegalEntityBelongsToTenant(...)`
  - call `assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId")`
- when `legalEntityId` is **not provided**:
  - `resolveScope(...)` must return `null`, not `TENANT`
  - allow the route guard to validate that the caller has some valid visible scope for `org.tree.read`
  - then filter legal entities in SQL using the existing repo visibility helper pattern such as `buildScopeFilter(req, "legal_entity", "le.id", params)`
- do **not** return cross-entity activation rows outside the caller's scoped visibility

### Implementation lock for Option B
Because `requestedScope = TENANT` requires tenant-wide scope in the current authz model, the no-param branch cannot be guarded as tenant scope first and filtered later.
So PR-2 must implement this shape explicitly:

- route layer resolves explicit `legalEntityId` access strictly
- no-param route layer resolves no requested scope
- route layer computes the visible legal-entity id set using scope-aware SQL filtering
- activation service receives explicit `legalEntityIds[]` and must **not** independently expand to all tenant entities

Recommended service shape:
- `getLegalEntityActivationReadiness(tenantId, { legalEntityIds, runQuery })`

Do **not** reuse the current module-readiness internal resolver that returns all active tenant legal entities when `legalEntityId` is omitted.

## Response target
Each legal entity should return:
- `legalEntityId`
- `legalEntityCode`
- `legalEntityName`
- `status`
- `ready`
- summary counts
- `checks[]`

### Minimum activation checks
1. `baseAccountingStructure`
   - at least one usable book linked to the legal entity
   - at least one usable CoA path for that legal entity; a shared/group CoA counts only if the current repo rules make it actually selectable/usable for that entity, not merely visible in a broad list
   - at least one open non-adjustment fiscal period belonging to that entity's usable linked book path, not just any visible period row in the workspace
2. `workflowCloseConsolidation`
   - reuse current module-readiness logic
3. `operatingUnitCurrentAccounts`
   - reuse current module-readiness logic
4. `shareholderActivation`
   - require at least one shareholder record for the legal entity where applicable
   - require shareholder parent mapping readiness

## Service composition
Build the new service by composing:
- direct legal-entity/base-accounting checks
- `getCloseConsolidationWorkflowReadiness(...)`
- `getOperatingUnitCurrentAccountReadiness(...)`
- `getShareholderCommitmentReadiness(...)`

Important implementation seam:
- extend the already-shipped onboarding/module-readiness + activation-workspace seams
- do **not** introduce a parallel entitlement or workspace model for entity activation
- keep scope filtering in the route layer and keep the activation service pure over an explicit `legalEntityIds[]` input

Implementation preference:
- better: refactor module-readiness internals so they can accept explicit `legalEntityIds[]`
- acceptable fallback: call the existing per-entity helpers one entity at a time for the filtered set when entity counts are modest

## Important lock
Do **not** rely only on shareholder parent-mapping readiness.
The activation rule must also include actual shareholder master presence.

Final shareholder activation readiness rule:
- `shareholderMasterPresent === true`
- `shareholderCommitmentMappingReady === true`
- only then `shareholderActivation.ready = true`

## Acceptance
- API returns per-entity activation summaries
- shareholder is evaluated at legal-entity scope
- legal-entity activation remains usable even if tenant readiness is already green
- no tenant-wide logic depends on shareholder presence anymore

## Smoke checks
- country-scoped user with no `legalEntityId` gets only visible entities and never receives out-of-scope legal entities (explicit Option B regression smoke)
- entity with books/coa/periods but no shareholders => shareholder activation blocked
- entity with shareholders but missing parent mappings => blocked
- entity with both => shareholder activation ready
- entities without applicable advanced setup show clear non-blocking or not-applicable state if policy says so

---

# PR-3 — Wire the Entity Activation Workspace UI

## Goal
Make the existing **Entity Activation Workspace** the real guided page for legal-entity setup blockers.

## Files
### Frontend new
- `frontend/src/api/legalEntityActivation.js`
- `frontend/src/readiness/LegalEntityActivationProvider.jsx`
- `frontend/src/readiness/useLegalEntityActivation.js`
- `frontend/src/readiness/LegalEntityActivationChecklist.jsx`

### Frontend touched
- `frontend/src/pages/settings/OrganizationManagementPage.jsx`
- `frontend/src/i18n/messages.js`
- optional: `frontend/src/App.jsx` if route metadata/title text needs adjustment

## UI model
Preserve and extend the already-shipped activation workspace instead of narrowing it.
The current local-operating checklist coverage in `OrganizationManagementPage.jsx` must remain intact.

For each visible legal entity, show an activation checklist/grouped card surface that **at minimum preserves** these current rows:
- books and ledgers
- chart-of-accounts usage / mapping
- fiscal configuration
- bank setup
- cash and register setup
- branches and operating units
- self-balancing current-account readiness
- shareholder and equity setup
- local readiness blockers / local close blockers
- bank control-parent mapping

This may be rendered either as:
- the existing broader checklist rows, or
- grouped cards/domains with the same underlying coverage

If grouped, prefer these five domains:

### Domain 1 — Base accounting structure
- books and ledgers
- chart-of-accounts usage / mapping
- fiscal configuration
- CTA: organization / GL setup

### Domain 2 — Local operating setup
- bank setup
- cash and register setup
- branches and operating units

### Domain 3 — Control configuration
- self-balancing current-account readiness
- bank control-parent mapping

### Domain 4 — Shareholder / equity setup
- shareholder master exists for that legal entity
- shareholder parent mapping exists
- CTA: shareholder setup section within activation workspace or org management flow

### Domain 5 — Local blockers and workflow
- local readiness blockers / local close blockers
- workflow setup / close-consolidation readiness
- clearly separate blocking vs optional/policy-driven items

## UX rules
1. Entity activation must feel like a per-entity checklist, not a tenant-global punishment screen.
2. Shareholder card must appear here, not in tenant bootstrap readiness.
3. Legal-entity setup users should see only entities they can work on.
4. Bootstrap admin may see all entities and their progress, but the messaging should emphasize handoff and local completion.
5. PR-3 must explicitly preserve PR-7B/local-workspace breadth; the redesign may improve grouping and copy, but must not regress current checklist coverage.

## Acceptance
- OrganizationManagementPage shows per-entity blockers without losing any currently shipped local-operating checklist areas
- Shareholder readiness is visible only here
- Entity setup managers can complete activation without confusion from tenant-wide readiness copy
- Route `/app/ayarlar/entity-aktivasyon-alani` remains the obvious home for legal-entity setup work
- the broader activation workspace from `OrganizationManagementPage.jsx` is preserved and extended, not replaced by a narrower five-row UI

## Smoke checks
- bootstrap admin sees all entities and their activation states
- entity-scoped manager sees only permitted entities
- status updates refresh correctly after shareholder/workflow/ou/bank/cash/bank-control-parent changes
- no circular dependency with existing TenantReadinessProvider or ModuleReadinessProvider
- existing activation-workspace rows remain reachable after the redesign

---

# PR-4 — Make Bootstrap Wizard Supportive, Not Blocking

## Goal
Keep the existing bootstrap wizard useful, but stop using it as the place where every future legal-entity task must be completed.

## Files
### Backend
- `backend/src/routes/onboarding.js`

### Frontend
- `frontend/src/pages/settings/CompanyOnboardingPage.jsx`
- `frontend/src/i18n/messages.js`

## Changes
1. Keep baseline bootstrap creation focused on:
   - group company
   - legal entity
   - fiscal calendar
   - periods
   - books
   - starter CoA
   - starter accounts
2. Allow optional advanced setup inputs to remain if already present in the wizard:
   - current-account config
   - shareholder parent config
   - maybe workflow defaults if already supported
3. Persist optional data if user supplies it.
4. But do **not** let skipped optional advanced fields cause tenant bootstrap readiness failure.

## Acceptance
- bootstrap wizard can finish successfully without shareholder setup
- optional shareholder/current-account fields still save if entered
- readiness model stays consistent with the new split

## Smoke checks
- baseline bootstrap succeeds with only structural setup
- tenant readiness turns green without shareholder setup
- entity activation later shows shareholder blocker until it is actually completed

## Optional hardening
- Rename wizard step `Responsibles` to a clearer bootstrap-handoff label such as `Setup owners` or `Handoff owners`
- or move that step later so the first tenant user is more clearly framed as the bootstrap owner created by provider provisioning, not as a generic long-term tenant admin workflow
- this is not required to land the readiness split, but it better matches the real SaaS ERP onboarding mental model

---

# PR-5 — Guard / Navigation Cleanup

## Goal
Make readiness navigation coherent after the split.

## Files
- `frontend/src/readiness/RequireTenantReadiness.jsx`
- `frontend/src/layouts/AppLayout.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/App.jsx`
- `frontend/src/i18n/messages.js`

## Changes
1. Keep tenant readiness redirects only for genuine bootstrap gaps.
2. Allow legal-entity setup users to continue into entity activation workspace even when local blockers remain.
3. Add an activation-summary source after tenant bootstrap is green:
   - reuse the new legal-entity activation API/provider to compute incomplete entity counts
   - surface it in `AppLayout.jsx` even when tenant readiness itself is green
   - do **not** rely only on the current tenant-readiness chip, because it disappears once `tenantReady === true`
4. Update readiness chip/menu text from generic “system readiness” to clearer stage-based wording.
5. Prefer wording like:
   - `Tenant bootstrap complete`
   - `2 legal entities need activation`
6. Optional secondary affordance: a small green/amber indicator near the current-user header/avatar may reflect the status of the **current working legal entity** only, but it must not replace the main activation summary because activation is entity-scoped, not user-scoped.

## Acceptance
- no accidental redirect loops
- bootstrap gaps route users to bootstrap pages
- entity activation gaps route users to entity activation workspace, not tenant bootstrap
- readiness menu language matches the new staged model
- after bootstrap is complete, users can still see an activation summary surface in the shell/header/menu

---

# Suggested DTO / Contract Shapes

## Tenant Bootstrap Readiness
```json
{
  "tenantId": 1,
  "stage": "TENANT_BOOTSTRAP",
  "ready": false,
  "checks": [
    { "key": "groupCompanies", "ready": true, "count": 1, "minimum": 1 },
    { "key": "legalEntities", "ready": true, "count": 2, "minimum": 1 },
    { "key": "chartsOfAccounts", "ready": false, "count": 0, "minimum": 1 }
  ],
  "missingKeys": ["chartsOfAccounts"]
}
```

## Legal-Entity Activation Readiness
```json
{
  "tenantId": 1,
  "stage": "LEGAL_ENTITY_ACTIVATION",
  "byLegalEntity": [
    {
      "legalEntityId": 10,
      "legalEntityName": "Afghanistan Entity",
      "ready": false,
      "status": "IN_PROGRESS",
      "summary": {
        "readyCheckCount": 2,
        "totalCheckCount": 4,
        "blockingCheckCount": 2
      },
      "checks": [
        { "key": "baseAccountingStructure", "ready": true },
        { "key": "workflowCloseConsolidation", "ready": true },
        { "key": "operatingUnitCurrentAccounts", "ready": false },
        { "key": "shareholderActivation", "ready": false }
      ]
    }
  ]
}
```

---

# Rollout Notes

## Sequencing
Recommended order:
1. PR-1 — shrink tenant readiness first
2. PR-2 — add legal-entity activation API
3. PR-3 — wire activation workspace UI
4. PR-4 — relax bootstrap wizard semantics
5. PR-5 — polish guard/navigation language

This order reduces confusion early, even before the activation workspace is fully finished.

## Compatibility
- preserve current tenant readiness route during the split
- add the new activation route without breaking existing module-readiness consumers
- prefer additive rollout first, then UI cleanup second

## Risk to watch
If tenant readiness is reduced before entity activation UI lands, some blockers will disappear from the first-login surface. That is acceptable only if:
- the activation workspace route is already reachable
- or a temporary dashboard callout points users there

A safe temporary mitigation:
- add a lightweight banner on dashboard / organization page:
  - “Tenant bootstrap is complete. Legal entities still require activation.”

---

# Final Acceptance Criteria

The redesign is complete when all of the following are true:

1. The first bootstrap admin no longer sees shareholder as a tenant-wide blocker.
2. Tenant readiness only checks structural bootstrap requirements.
3. Shareholder setup appears under legal-entity activation.
4. Legal-entity activation evaluates both shareholder master presence and mapping readiness.
5. Entity setup users can work in the activation workspace without tenant-wide confusion.
6. The bootstrap wizard may prefill advanced setup but does not force it.
7. User-facing wording clearly distinguishes:
   - tenant bootstrap
   - legal-entity activation
   - optional module setup

---

# One-Line Operating Model

**Provider creates the tenant, bootstrap admin creates the shell, legal-entity owners activate their own accounting reality, and shareholder setup lives inside that legal-entity activation stage.**
