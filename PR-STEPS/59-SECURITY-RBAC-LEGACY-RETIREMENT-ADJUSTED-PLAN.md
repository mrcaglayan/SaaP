# Security / RBAC Legacy Retirement - Adjusted PR Plan

## Status

- Completed on April 10, 2026
- Repo-checked against the April 10, 2026 local snapshot
- Scope is security / RBAC legacy retirement only
- Assumes fresh database / fresh-tenant rollout only
- This plan adjusts the original tracker to avoid known breakpoints in the current repo

## Goal

Remove live-product security migration surfaces and retired security-role compatibility paths so fresh tenants behave as a clean steady-state product.

Fresh tenants should use `SecurityAdmin` plus `SystemAdmin` for bootstrap and administration. Retired roles such as `TenantAdmin`, `GroupController`, `CountryController`, `EntityAccountant`, and the legacy broad AP posting role should not be seeded, exposed, assignable, or required by runtime or tests.

## Out Of Scope

Do not remove unrelated legacy compatibility just because it contains the word `legacy`.

Keep these separate:

- workflow bridge persistence
- bank approval bridge compatibility
- fixed asset opening / legacy NBV fields
- CARI / FA / cash fallback posting paths
- non-security migration scripts and release gates

## Repo-Fit Adjustments From Review

### Conflict / Plan Gap

The active security workspace redesign plan still says Role Migrations, Legacy Migration Visibility, fresh-tenant legacy visibility, and `legacy_catalog` must remain reachable. This retirement track intentionally reverses that decision.

Before implementation, land a small planning PR that marks this plan as superseding the preserved-legacy parts of `redesigning/08-SecurityAdminWorkspaceUXRedesignPlan.md`.

### Conflict / Plan Gap

Do not delete `backend/src/services/roleMigration.service.js` in the same PR that removes only backend migration routes. The service is still imported by `seedCore.js`, `systemRoles.service.js`, and normal security route guards.

Delete the service only after seed, system-role logic, and role-list/assignment guards no longer depend on it.

### Conflict / Plan Gap

Frontend cleanup must include more than the initial page list. The current repo also exposes migration/legacy surfaces through:

- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/api/rbacAdmin.js`
- `frontend/src/i18n/messages.js`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`

### Conflict / Plan Gap

`GroupApPostExtensionPage.jsx` depends on legacy catalog data and links to Legacy Migration Visibility. It is not optional unless it is rewritten to remove those dependencies.

### Deferred item already covered

The long `TenantAdmin` test tail is real and belongs in the later helper/test sweep. `backend/scripts/ex05-test-helpers.js` already provides fresh helpers such as `createBootstrapAdmin`, `seedAndCreateBootstrapAdmin`, and `assignSecurityAdminAndSystemAdmin` for the replacement pass.

### Optional hardening

When removing `TenantAdmin` from runtime behavior, also remove it from `canManageSecurity`, `canManageOps`, and `canBootstrapTenant`.

---

# PR-LEGSEC-00 - Planning Realignment

## Status

- Completed on April 10, 2026
- Documentation-only first pass
- Updated `redesigning/08-SecurityAdminWorkspaceUXRedesignPlan.md` so security/RBAC legacy retirement supersedes the earlier preserved-legacy UX requirements

## Goal

Make the roadmap internally consistent before deleting any capability.

## Files

- `redesigning/08-SecurityAdminWorkspaceUXRedesignPlan.md`
- this tracker, if the implementation scope changes during review

## Changes

1. Add a clear note to the redesign plan that this retirement track supersedes the earlier preservation requirements for:
   - Role Migrations
   - Legacy Migration Visibility
   - `legacy_catalog`
   - fresh-tenant legacy visibility behavior
2. Keep the non-regression rule for all non-retired security/admin companion surfaces.
3. State that old data migration, if ever needed, belongs in a separate one-off utility outside the live product.

## Acceptance

- The active redesign plan no longer contradicts this retirement tracker.
- Reviewers can tell that removing migration pages is intentional feature retirement, not accidental UX regression.
- No code is changed in this PR.

---

# PR-LEGSEC-01 - Frontend Legacy Surface Retirement

## Status

- Completed on April 10, 2026
- Frontend-only implementation
- Removed live role migration routes, sidebar/workspace links, legacy catalog exposure, migration API clients, and migration UI-state consumers
- Kept `GroupApPostExtensionPage.jsx` as a fresh AP group-posting governance page without legacy migration messaging

## Goal

Remove all live-product security migration UI surfaces and legacy catalog exposure from the frontend.

## Files

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/layouts/AppLayout.jsx`
- `frontend/src/api/rbacAdmin.js`
- `frontend/src/i18n/messages.js`
- `frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx`
- `frontend/src/pages/security/AccessModelCatalogPage.jsx`
- `frontend/src/pages/security/RolesPermissionsPage.jsx`
- `frontend/src/pages/security/UserAssignmentsPage.jsx`
- `frontend/src/pages/security/roleCatalog.js`
- `frontend/src/pages/security/GroupApPostExtensionPage.jsx`
- delete `frontend/src/pages/security/RoleMigrationsPage.jsx`
- delete `frontend/src/pages/security/LegacyMigrationVisibilityPage.jsx`

## Changes

1. Remove route imports and route registrations for:
   - `/app/ayarlar/rbac/role-migrations`
   - `/app/ayarlar/rbac/legacy-migration-visibility`
2. Remove sidebar entries and route labels for:
   - role migrations
   - legacy migration visibility
3. Remove workspace companion links for:
   - Role migrations
   - Legacy migration visibility
4. Remove frontend API client functions that only call `/api/v1/security/role-migrations*`.
5. Remove `adminUiStateKey === "roleMigrations"` handling after sidebar/shell consumers are gone.
6. Remove `roleMigrations` UI-state branches from:
   - `AccessModelCatalogPage.jsx`
   - `RolesPermissionsPage.jsx`
   - `UserAssignmentsPage.jsx`
7. Remove legacy catalog exposure from `AccessModelCatalogPage.jsx` and `roleCatalog.js`:
   - remove `legacy_catalog`
   - remove `ACCESS_MODEL_SECTION_LABELS.legacy_catalog`
   - remove `ACCESS_MODEL_SECTION_ORDER.legacy_catalog`
   - remove `listLegacyRoleCatalogEntries()` and related legacy tab helpers if no longer used
   - remove migration CTA links
8. Remove legacy compatibility sections from `RolesPermissionsPage.jsx`:
   - legacy role meaning filter
   - legacy stats card
   - legacy warning cards
   - migration action link
   - fresh-tenant note that exists only because migration UI exists
9. Rewrite or remove `GroupApPostExtensionPage.jsx`:
   - keep only if it remains useful as fresh AP group-posting governance
   - remove dependency on `listLegacyRoleCatalogEntries()`
   - remove legacy avoidance copy
   - remove links to Legacy Migration Visibility

## Acceptance

- No sidebar, workspace card, route, or CTA points to role migration pages.
- Access catalog has no `legacy_catalog` tab.
- Roles page has no legacy compatibility section.
- User assignments page does not read `securityAdminUiState.roleMigrations`.
- Security admin UX contains no `legacy migration` wording.
- Frontend build has no dead imports.

## Search Gate

Run after this PR:

- `rg -n "role-migrations|legacy-migration-visibility|legacy_catalog|roleMigrations" frontend/src`
- `rg -n "Legacy Migration|Role Migrations|legacy migration" frontend/src`

Expected result: no live frontend references, except intentionally retained historical notes if any are documented.

---

# PR-LEGSEC-02 - Backend Route And UI-State Retirement

## Status

- Completed on April 10, 2026
- Removed backend role migration routes and `roleMigrations` admin UI-state
- Deleted the live role migration CLI and role migration smoke script
- Removed release-gate/package references to the retired migration smoke
- Regenerated `backend/openapi.yaml` without `/api/v1/security/role-migrations*`
- Also deleted the stale UI-1E legacy catalog smoke because it referenced the retired migration route and removed legacy catalog helper

## Goal

Remove runtime backend support for role migration pages and remove migration UI state, without deleting shared legacy helper code that seed/system-role logic still imports.

## Files

- `backend/src/routes/security.js`
- `backend/scripts/role-migration-tool.js`
- `backend/scripts/test-security-pr4c-role-migration-tool.js`
- `backend/scripts/test-security-governance-release-gate.js`
- `backend/scripts/fixtures/rswire03-release-gate-manifest.json`
- `backend/package.json`
- `backend/openapi.yaml`

## Changes

1. In `backend/src/routes/security.js`, remove:
   - `getRoleMigrationUiState`
   - `createRoleMigrationPreviewRun`
   - `executeRoleMigrationRun`
   - `getRoleMigrationRunDetail`
   - `listRoleMigrationRuns`
   - `rollbackRoleMigrationRun`
   - `assertSecurityMigrationManageAllowed`
2. Remove role migration UI state from `GET /api/v1/security/admin-ui-state`.
3. Remove backend routes:
   - `GET /api/v1/security/role-migrations`
   - `POST /api/v1/security/role-migrations/preview`
   - `GET /api/v1/security/role-migrations/:runId`
   - `POST /api/v1/security/role-migrations/:runId/execute`
   - `POST /api/v1/security/role-migrations/:runId/rollback`
4. Delete `backend/scripts/role-migration-tool.js`.
5. Delete or retire `backend/scripts/test-security-pr4c-role-migration-tool.js`.
6. Remove package scripts and release-gate references that only validate removed role migration surfaces.
7. Remove role migration route manifest entries from release-gate fixtures.
8. Regenerate OpenAPI with `npm run openapi:generate` from `backend`.

## Do Not Do In This PR

- Do not delete `backend/src/services/roleMigration.service.js` yet.
- Do not remove `loadActiveLegacyDisabledRoleCodeSet`, `isRetiredLegacyRoleCode`, or `isRoleLegacyDisabled` consumers yet.
- Do not remove the migration schema file yet.

## Acceptance

- Security admin UI state payload contains no `roleMigrations`.
- OpenAPI contains no `/api/v1/security/role-migrations*` paths.
- Backend starts with no missing imports.
- Frontend no longer requests removed migration state or endpoints.
- Governance release gate no longer invokes the removed migration-tool smoke.

## Search Gate

Run after this PR:

- `rg -n "role-migrations|role_migration\\.preview|role_migration\\.execute|role_migration\\.rollback" backend/src backend/scripts backend/openapi.yaml backend/package.json`

Expected result: no live backend route, script, package, OpenAPI, or release-gate references.

---

# PR-LEGSEC-03 - Fresh-Only System Roles And Seed

## Status

- Completed on April 10, 2026
- System-role builder is fresh-only and no longer imports role migration helpers
- Runtime authority checks now accept `SecurityAdmin` for security management and `SystemAdmin` for ops/bootstrap management
- Seed output no longer generates retired security role definitions
- Security role listing and assignment routes no longer return `legacyDisabled` or `legacyRetired`
- Frontend security role catalog and assignment diagnostics no longer carry retired-role metadata
- Deleted `backend/src/services/roleMigration.service.js` after all runtime imports were removed

## Goal

Make the core security model fresh-only by removing `TenantAdmin` retention and retired-role seeding from runtime, seed, and role admin behavior.

## Files

- `backend/src/services/systemRoles.service.js`
- `backend/src/seedCore.js`
- `backend/src/routes/security.js`
- `frontend/src/pages/security/roleCatalog.js`, if retired metadata remains after PR-01
- delete `backend/src/services/roleMigration.service.js` after all imports are gone

## Changes

1. In `systemRoles.service.js`:
   - remove dependency on `loadActiveLegacyDisabledRoleCodeSet`
   - remove `LEGACY_TENANT_ADMIN_ROLE_CODE`
   - remove `LEGACY_TENANT_ADMIN_ROLE_NAME`
   - remove `includeLegacyTenantAdmin`
   - remove `shouldRetainLegacyTenantAdminRole()`
   - remove `TenantAdmin` from `canManageSecurity`
   - remove `TenantAdmin` from `canManageOps`
   - remove `TenantAdmin` from `canBootstrapTenant`
   - rename fresh-only helpers when practical:
     - `buildCompatibilitySystemRoleDefinitions` to `buildSystemRoleDefinitions`
     - `ensureCompatibilitySystemRolesForTenant` to `ensureSystemRolesForTenant`
     - `getCompatibilityBootstrapRoleCodes` to `getBootstrapRoleCodes`
2. In `seedCore.js`:
   - remove imports from `roleMigration.service.js`
   - remove `RETIRED_LEGACY_ROLE_CODES`
   - remove `isRetiredLegacyRoleCode`
   - remove `includeLegacyTenantAdmin: true`
   - remove retained legacy role definition paths
   - stop generating retired legacy role definitions entirely
3. In `routes/security.js`:
   - remove `isRetiredLegacyRoleCode`
   - remove `isRoleLegacyDisabled`
   - remove `loadActiveLegacyDisabledRoleCodeSet`
   - simplify role listing so it no longer returns `legacyDisabled` or `legacyRetired`
   - remove retired legacy assignment guard messages tied to migration/rollback seams
4. Delete `backend/src/services/roleMigration.service.js` only after all imports are gone.

## Acceptance

- Fresh seed creates `SecurityAdmin` and `SystemAdmin`, but not `TenantAdmin`.
- Retired legacy roles are not seeded into a new tenant.
- Runtime auth helpers no longer treat `TenantAdmin` as sufficient authority.
- No runtime service imports `roleMigration.service.js`.
- Role catalog reflects only steady-state roles and packages.

## Search Gate

Run after this PR:

- `rg -n "roleMigration|roleMigration\\.service|loadActiveLegacyDisabledRoleCodeSet|isRetiredLegacyRoleCode|isRoleLegacyDisabled|includeLegacyTenantAdmin|LEGACY_TENANT_ADMIN" backend/src frontend/src`
- `rg -n "TenantAdmin|GroupController|CountryController|EntityAccountant" backend/src frontend/src`

Expected result: no steady-state runtime dependencies. Some non-security domain references may remain in tests until PR-04.

---

# PR-LEGSEC-04 - Schema, Helper Alias, And Test Tail Cleanup

## Status

- Completed on April 10, 2026
- Removed the role migration schema registration and deleted `backend/src/migrations/m168_role_migration_tool.js`
- Retired `createTenantAdmin` and `seedAndCreateTenantAdmin` helper aliases from `backend/scripts/ex05-test-helpers.js`
- Repointed backend scripts from `TenantAdmin` to fresh bootstrap plus test-full-access helpers
- Removed stale security compatibility and legacy-catalog scripts from `backend/package.json` and the governance release gate

## Goal

Delete the remaining role migration schema and update test helpers/scripts that still expect `TenantAdmin`.

## Files

- `backend/src/migrations/index.js`
- delete `backend/src/migrations/m168_role_migration_tool.js`
- `backend/scripts/ex05-test-helpers.js`
- security legacy tests/scripts under `backend/scripts/`
- non-security test scripts under `backend/scripts/` that still resolve or assign `TenantAdmin`
- `backend/package.json`

## Changes

1. Remove migration registration:
   - delete import of `m168_role_migration_tool.js`
   - remove it from the migration array
   - delete `backend/src/migrations/m168_role_migration_tool.js`
2. Remove helper aliases from `backend/scripts/ex05-test-helpers.js`:
   - remove `createTenantAdmin`
   - remove `seedAndCreateTenantAdmin`
   - keep or add fresh-only helpers:
     - `createBootstrapAdmin`
     - `seedAndCreateBootstrapAdmin`
     - `assignSecurityAdminAndSystemAdmin`, if tests need explicit dual-role assignment without the test full-access role
3. Update scripts that still resolve or assign `TenantAdmin`:
   - replace `SELECT id FROM roles WHERE code='TenantAdmin'`
   - replace `roleCode: "TenantAdmin"`
   - replace imports of legacy helper aliases
4. Remove or rewrite security tests that assert compatibility retention:
   - `test-security-pr1b-tenantadmin-compat-shim.js`
   - `test-security-pr6a-legacy-role-retirement.js`
   - legacy catalog frontend smokes
5. Keep unrelated legacy tests from workflow, bank, fixed asset, CARI, FA, and cash unless they truly depend on security-role migration.

## Acceptance

- No security test or helper depends on `TenantAdmin`.
- No migration file or migration index entry exists for role migration tooling.
- Package scripts contain no security-role-migration smoke tasks.
- Fresh DB migration and seed work without creating role migration tables.
- Release gates use fresh admin helpers or explicit `SecurityAdmin` plus `SystemAdmin` assignment.

## Search Gate

Run after this PR:

- `rg -n "TenantAdmin|roleMigration|role_migration|role-migration|legacy_catalog|role-migrations|legacy-migration-visibility" backend/src backend/scripts frontend/src backend/package.json backend/openapi.yaml`

Expected result: no security/RBAC legacy retirement references remain, except deliberately documented historical notes outside live product code.

---

# Recommended Implementation Order

1. PR-LEGSEC-00 - planning realignment
2. PR-LEGSEC-01 - frontend surface retirement
3. PR-LEGSEC-02 - backend route and UI-state retirement
4. PR-LEGSEC-03 - fresh-only system roles and seed
5. PR-LEGSEC-04 - schema, helper alias, and test tail cleanup

This order keeps each reviewable and avoids deleting shared backend helper code before all imports are removed.

---

# Final Acceptance

The cleanup is complete when all of these are true:

- Admin UX has no migration/legacy security pages, cards, CTAs, or tabs.
- Backend exposes no role-migration endpoints or migration UI state.
- Fresh seed produces only fresh security roles.
- `TenantAdmin` is not seeded, assignable, or accepted as runtime authority.
- Retired security roles are not required by runtime or tests.
- No `role_migration_*` schema is created for fresh databases.
- No unrelated workflow, bank, fixed asset, CARI, FA, or cash legacy compatibility is removed as part of this track.
