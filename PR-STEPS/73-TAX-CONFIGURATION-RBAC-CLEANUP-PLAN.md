# PR-73: Tax Configuration RBAC Cleanup Plan

## Status

Planned.

This PR replaces the current broad Tax Setup authorization model with a narrower, SaaS-style tax configuration role while preserving operational tax lookup behavior used by CARI, inventory, and posting flows.

## Problem

`/app/ayarlar/vergi-kurulumu` currently mixes two separate concerns:

- Tax configuration writes are gated by `onboarding.company.setup`.
- Account lookup and inline child-account creation are gated by GL permissions:
  - `gl.account.read`
  - `gl.account.upsert`

This creates two real-world problems:

- Setup/admin users may be able to save tax configuration but cannot use the account picker or inline child-account helper.
- Accounting/master-data users may be able to create/select GL accounts but cannot save tax regimes, codes, rules, or mappings.

The current permission name also overstates the user's authority. A user who maintains tax rules does not need the full company onboarding bootstrap permission.

## Current System Facts

- Tax setup page write gate:
  - `frontend/src/pages/settings/TaxSetupPage.jsx`
  - `hasPermission("onboarding.company.setup")`
- Tax mutation backend gates:
  - `backend/src/routes/tax.routes.js`
  - `POST/PATCH /regimes`
  - `POST/PATCH /codes`
  - `POST/PATCH /rules`
  - `POST/PATCH /account-mappings`
- Tax setup sidebar gate:
  - `frontend/src/layouts/sidebarConfig.js`
  - `TAX_SETUP_PAGE_PERMISSIONS = ["org.tree.read", "onboarding.company.setup"]`
- Frontend route/sidebar guards use `anyOf`, not `allOf`.
  - Adding `org.tree.read` to a page permission list exposes the page to ordinary org readers.
- Tax read/preview routes are used outside the setup page:
  - Inventory item-card tax category options use `listTaxRules`.
  - CARI document create/edit tax preview uses `previewTaxComputation`.
- Seeded role definitions are authoritative.
  - Reseeding removes role permissions not present in `ALL_ROLE_DEFINITIONS`.
- Current tax setup scope logic is tenant/legal-entity based.
  - Rows without `legal_entity_id` are treated as tenant-wide, not country-scoped.
  - PR-73 should not advertise `COUNTRY` as a supported `TaxConfigurationManager` scope unless it also implements country-aware tax service authorization.

## Target Design

Add dedicated tax setup permissions:

```text
tax.setup.read
tax.setup.upsert
```

Add dedicated role:

```text
TaxConfigurationManager
```

Recommended role permissions:

```text
org.tree.read
tax.setup.read
tax.setup.upsert
gl.account.read
```

Do not include `gl.account.upsert` by default. Assign `gl.account.upsert` separately when the user is allowed to create mapped child accounts from the helper.

## PR Scope

### 1. Permission Catalog

Add permissions in `backend/src/seedCore.js`:

```text
tax.setup.read
tax.setup.upsert
```

Suggested descriptions:

```text
tax.setup.read   Read tax setup configuration
tax.setup.upsert Create/update tax setup configuration
```

### 2. Permission Groups

Add a group in `backend/src/constants/permission-groups.js`:

```js
"tax.configuration": {
  permissions: [
    "org.tree.read",
    "tax.setup.read",
    "tax.setup.upsert",
    "gl.account.read",
  ],
}
```

Do not add `gl.account.upsert` to this group.

### 3. Permission Dependency Rules

Add dependency rules in `backend/src/constants/permission-rules.js`:

```js
"tax.setup.read": Object.freeze(["org.tree.read"]),
"tax.setup.upsert": Object.freeze(["tax.setup.read", "org.tree.read"]),
```

This prevents a role from receiving write access without the org visibility the page and scope checks need.

### 4. Seeded Role

Add a seeded role in `backend/src/seedCore.js`:

```text
TaxConfigurationManager
```

Role definition:

```text
Tax Configuration Manager
```

Permissions:

```js
const TAX_CONFIGURATION_MANAGER_PERMISSION_CODES = buildPermissionList({
  permissionGroups: ["tax.configuration"],
});
```

Do not put `"tax.configuration"` directly in the seeded role `permissions` array. It is a permission group, not a permission code. The seeded role should use the expanded permission list:

```js
{
  code: "TaxConfigurationManager",
  name: "Tax Configuration Manager",
  permissions: TAX_CONFIGURATION_MANAGER_PERMISSION_CODES,
}
```

Add `TaxConfigurationManager` to `ROLE_CAPABILITY_GROUPS` with:

```text
tax.configuration
```

### 5. System Admin Compatibility

Update `backend/src/services/systemRoles.service.js`.

`SystemAdmin` is currently generated from:

- `ops.*`
- `close.*`
- `onboarding.*`
- explicit additions in `SYSTEM_ADMIN_ADDITIONAL_PERMISSION_CODES`

Add:

```text
org.tree.read
tax.setup.read
tax.setup.upsert
gl.account.read
```

to `SYSTEM_ADMIN_ADDITIONAL_PERMISSION_CODES`.

Do not add broad `tax.*` unless the project intentionally wants all future tax permissions to flow to `SystemAdmin`.

Do not add `gl.account.upsert` to `SystemAdmin` as part of PR-73. `SystemAdmin` should be able to open Tax Setup and select existing mapping accounts, but GL account creation should stay with GL/master-data authority unless the tenant intentionally grants it.

### 6. Backend Route Gates

Change Tax Setup mutation routes from:

```text
onboarding.company.setup
```

to:

```text
tax.setup.upsert
```

Routes:

- `POST /api/v1/tax/regimes`
- `PATCH /api/v1/tax/regimes/:regimeId`
- `POST /api/v1/tax/codes`
- `PATCH /api/v1/tax/codes/:codeId`
- `POST /api/v1/tax/rules`
- `PATCH /api/v1/tax/rules/:ruleId`
- `POST /api/v1/tax/account-mappings`
- `PATCH /api/v1/tax/account-mappings/:mappingId`

Keep all tax read and preview routes compatible in this PR.

Do not blindly switch these routes to `tax.setup.read` yet:

- `GET /api/v1/tax/regimes`
- `GET /api/v1/tax/codes`
- `GET /api/v1/tax/rules`
- `GET /api/v1/tax/account-mappings`
- `POST /api/v1/tax/preview`

Those routes are used by operational CARI/inventory flows or by setup screens that still depend on operational read compatibility. Since `TaxConfigurationManager` receives `org.tree.read` through `tax.configuration`, leaving these routes on `org.tree.read` keeps the new setup role working without breaking operational tax lookup and preview flows. Tightening them requires a separate operational permission design such as `tax.runtime.read` or `tax.preview.run`.

### 7. Frontend Tax Setup Gates

Update `frontend/src/pages/settings/TaxSetupPage.jsx`:

```js
const canRead = hasPermission("tax.setup.read");
const canWrite = hasPermission("tax.setup.upsert");
```

Keep account-specific gates unchanged:

```js
const canReadAccounts = hasPermission("gl.account.read");
const canUpsertAccounts = hasPermission("gl.account.upsert");
```

Update missing-permission copy:

- `Missing permission: tax.setup.read`
- `Missing permission: tax.setup.upsert`

### 8. Sidebar And Route Visibility

Update `frontend/src/layouts/sidebarConfig.js`.

Important: route guards use `anyOf`. Do not include `org.tree.read` in `TAX_SETUP_PAGE_PERMISSIONS`.

Use:

```js
const TAX_SETUP_PAGE_PERMISSIONS = [
  "tax.setup.read",
  "tax.setup.upsert",
];
```

This means a read-only tax configuration reviewer can open the page, while ordinary org readers cannot.

### 9. Security Catalog UI

Update `frontend/src/pages/security/roleCatalog.js`:

Add `TaxConfigurationManager`:

- category: `composable`
- summary: maintains tax regimes, tax codes, tax rules, and tax account mappings without broad onboarding authority
- capabilities:
  - `Tax regime setup`
  - `Tax rule maintenance`
  - `Tax account mapping`
- recommended scopes:
  - `TENANT`
  - `LEGAL_ENTITY`
- sort order near other setup/governance roles

Do not recommend `COUNTRY` scope in PR-73. Current tax setup service behavior treats non-legal-entity rows as tenant-wide, not country-scoped. Add country-scope recommendation only after a later PR implements country-aware tax setup authorization and tests.

Do not add it to the default entity accountant preset by default.

### 10. Assignment Model Decision

Decide whether `TaxConfigurationManager` is locally assignable.

Option A: central-only setup role.

- Do not add it to `backend/src/services/localOperationalRoles.service.js`.
- Security/admin users assign it through central role assignment flows.
- Recommended default for this PR.

Option B: local admin assignable.

- Add `TaxConfigurationManager` to `LOCAL_OPERATIONAL_ROLE_CATALOG`.
- Allow `LEGAL_ENTITY` scope only in PR-73.
- Only choose this if local admins are trusted to delegate tax setup rights.

Recommended for PR-73: Option A.

### 11. Migration And Existing Tenant Backfill

Create `m208_tax_configuration_rbac.js` after the current latest migration (`m207`) and register it in `backend/src/migrations/index.js`.

The migration must:

1. Insert the new permission rows if missing.
2. Insert or refresh `TaxConfigurationManager` for every tenant.
3. Bind role permissions for `TaxConfigurationManager`.
4. Add `org.tree.read`, `tax.setup.read`, `tax.setup.upsert`, and `gl.account.read` to existing `SystemAdmin` roles.
5. Compatibility bridge: for roles that currently have `onboarding.company.setup`, also grant `org.tree.read`, `tax.setup.read`, and `tax.setup.upsert`.

The compatibility bridge prevents existing admin users from losing tax setup access during rollout.

Do not grant tax setup permissions to all GL/accounting roles automatically. Do not automatically grant `gl.account.read` to every bridged onboarding role unless that role must immediately use tax account mapping pickers.

### 12. Tests

Add or update targeted tests/scripts for:

- Update `backend/scripts/test-security-pr4a-duty-boundary-roles.js`.
  - Add `TaxConfigurationManager` to the `roleCodes` list so the seeded role is fetched and validated.
  - Assert `SystemAdmin` has `org.tree.read`.
  - Assert `SystemAdmin` has `tax.setup.read`.
  - Assert `SystemAdmin` has `tax.setup.upsert`.
  - Assert `SystemAdmin` has `gl.account.read`.
  - Assert `SystemAdmin` does not receive `gl.account.upsert` from PR-73.
  - Assert `TaxConfigurationManager` exists through the seeded role fetch.
  - Assert `ROLE_CAPABILITY_GROUPS.TaxConfigurationManager` is `["tax.configuration"]`.
  - Assert `TaxConfigurationManager` does not have `onboarding.company.setup`.
- `SystemAdmin` can save tax setup after migration.
- `TaxConfigurationManager` can save regimes, codes, rules, and mappings.
- GL-only user with `gl.account.read` and `gl.account.upsert` cannot save tax setup.
- Tax setup page is not visible to a user with only `org.tree.read`.
- Tax setup page is visible to a user with `tax.setup.read`.
- Inline child-account helper still requires `gl.account.upsert`.
- CARI document tax preview still works for operational users after the route-gate change.
- Inventory item-card tax category loading still works for operational users.
- `TaxConfigurationManager` exists after reseed and does not include `onboarding.company.setup`.
- `SystemAdmin` includes `org.tree.read`, `tax.setup.read`, `tax.setup.upsert`, and `gl.account.read`, but not `gl.account.upsert` from PR-73.
- A `LEGAL_ENTITY` scoped `TaxConfigurationManager` can maintain legal-entity tax setup but cannot create tenant-wide tax setup rows.
- A `LEGAL_ENTITY` scoped `TaxConfigurationManager` cannot update a legal-entity scoped tax regime into a tenant-wide regime by clearing `legalEntityId`.

## Out Of Scope

- Reworking tax engine computation.
- Reworking tax schema.
- Adding approval workflows for tax setup changes.
- Removing `onboarding.company.setup` from company onboarding.
- Tightening operational tax read/preview endpoints.
- Automatically granting `TaxConfigurationManager` to every entity accountant.
- Country-scoped tax setup authorization.

## Follow-Up PR

Create a later PR to split operational tax runtime permissions from setup permissions:

```text
tax.runtime.read
tax.preview.run
```

That later PR can move:

- tax rule lookup used by item cards and CARI document forms
- tax preview computation used by CARI document lines

away from `org.tree.read` without breaking operational users.

Create a separate later PR if country-level tax setup managers are required. That PR must update tax setup scope resolution and row filtering so country-scoped users can manage country-level regimes without requiring tenant-wide authority.

## Acceptance

- New permissions exist in the permission catalog.
- `TaxConfigurationManager` exists for every tenant after seed/migration.
- `SystemAdmin` keeps tax setup write access.
- `SystemAdmin` can open Tax Setup and use the existing-account picker through `org.tree.read` and `gl.account.read`, without receiving `gl.account.upsert` from PR-73.
- Tax setup mutation routes require `tax.setup.upsert`.
- Tax setup frontend write actions require `tax.setup.upsert`.
- Tax setup page route/sidebar access no longer opens for users with only `org.tree.read`.
- Users with `TaxConfigurationManager` and `gl.account.read` can select mapping accounts.
- Users without `gl.account.upsert` cannot create child accounts from the helper.
- Existing CARI and inventory tax lookup/preview flows still work.
- Existing seed and role validation pass.
- `TaxConfigurationManager` role catalog recommends only `TENANT` and `LEGAL_ENTITY` scopes in PR-73.

## Rollout Notes

Recommended rollout sequence:

1. Add permissions, group, role, and migration.
2. Backfill `SystemAdmin` and existing `onboarding.company.setup` roles.
3. Change backend mutation routes.
4. Change frontend Tax Setup gates and sidebar route visibility.
5. Add tests for old and new role combinations.
6. After rollout, manually assign `TaxConfigurationManager` to users such as legal-entity tax setup owners.
7. Later, remove tax setup reliance on `onboarding.company.setup` entirely after confirming tenant assignments.
