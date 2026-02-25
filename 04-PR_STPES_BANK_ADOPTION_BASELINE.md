# Bank Roadmap Adoption Baseline (Before Implementation)

Date: 2026-02-25
Scope: Adapt `04-PR_STPES_BANK.md` into this repository's real architecture and conventions before any Bank PR code starts.

## Why This Is Required

`04-PR_STPES_BANK.md` contains useful functional goals, but the sample code is not drop-in compatible with this repo.

Hard incompatibilities:

1. Migration numbering conflict
- Bank doc starts at `m021_*`.
- This repo already has `m021..m026`.
- Bank must start from `m027_*`.

2. Module format mismatch
- Bank doc examples are mostly CommonJS (`module.exports`).
- This repo is ESM (`import` / `export default`).

3. Guardrail mismatch (tenant/legal-entity safety)
- Bank doc table/API samples do not consistently follow this repo's tenant/legal-entity scoping and RBAC resolution model.
- All Bank entities must be tenant-scoped and legal-entity-scoped where relevant.

4. Frontend auth API mismatch
- Bank doc uses `RequirePermission permission="..."`.
- This repo uses `RequirePermission` with `anyOf`/`allOf`.

5. Frontend route convention mismatch
- Bank doc uses `/bank/...`.
- This repo renders feature pages inside `/app/...` with sidebar-driven permissions and i18n by route path.

## Repository Rules Bank Must Follow

## Backend

1. Migration format
- Use ESM migration objects with `key`, `description`, `up(connection)`.
- Keep idempotent checks (`information_schema`) where applicable.

2. Scope model
- Include `tenant_id` and `legal_entity_id` on bank domain tables unless the table is truly tenant-global.
- Enforce scope in routes/services with existing RBAC helpers (`requirePermission`, `assertScopeAccess`, `buildScopeFilter`) and tenant guards.

3. Validation style
- Use route validators that parse/normalize fields and throw `badRequest(...)` on contract violations.
- Reuse existing common parsers in `cash.validators.common.js` where possible.

4. Service style
- Keep business rules in services.
- Keep routes thin: parse input -> service call -> standardized JSON response.

5. Router registration
- Mount routers in `backend/src/index.js` with `requireAuth`.

## Frontend

1. App route pattern
- Implement pages in `frontend/src/App.jsx` under `/app/...`.
- Wrap with `RequirePermission anyOf={[...]}` semantics through existing route guard pattern.

2. Sidebar pattern
- Use `requiredPermissions` arrays and `implemented: true` in `frontend/src/layouts/sidebarConfig.js`.

3. i18n pattern
- Add labels in `frontend/src/i18n/messages.js` `sidebar.byPath` for both TR and EN maps.

4. API client pattern
- Use `frontend/src/api/client.js` helper style, not custom fetch wrappers.

## Test/quality

1. Add dedicated scripts per Bank PR in `backend/scripts`.
2. Add npm aliases in `backend/package.json`.
3. Keep Bank gate separate at first; wire into release gate later as optional extension (same pattern used for contracts/revenue).

## Adopted Mapping: Original -> Repo-Native

## PR-B01 (Bank Foundation)

Original intent: bank master data + strict GL link.

Repo-native adoption:

- Migration file:
  - `backend/src/migrations/m027_bank_accounts_foundation.js`
- Suggested table:
  - `bank_accounts`
  - Required columns: `id`, `tenant_id`, `legal_entity_id`, `code`, `name`, `currency_code`, `gl_account_id`, `is_active`, `created_by_user_id`, timestamps.
- Required constraints/indexes:
  - Unique `(tenant_id, legal_entity_id, code)`
  - Unique `(tenant_id, legal_entity_id, gl_account_id)` for v1 one-to-one GL-bank link per legal entity
  - FK `(tenant_id, legal_entity_id)` -> `legal_entities`
  - FK `currency_code` -> `currencies(code)`
  - FK `created_by_user_id` -> `users(id)`
  - FK `gl_account_id` -> `accounts(id)` plus service-level tenant/legal-entity compatibility checks using tenant guards
- Router/validator/service:
  - `backend/src/routes/bank.accounts.routes.js`
  - `backend/src/routes/bank.accounts.validators.js`
  - `backend/src/services/bank.accounts.service.js`
- Mount:
  - `app.use("/api/v1/bank/accounts", requireAuth, bankAccountsRoutes);`
- Permissions to add:
  - `bank.account.read`
  - `bank.account.upsert`
  - `bank.account.activate`
- Frontend:
  - `frontend/src/api/bankAccounts.js`
  - `frontend/src/pages/bank/BankAccountsPage.jsx`
  - Route under `/app/...` (see routing note below)
- Test:
  - `backend/scripts/test-bank-prb01-foundation.js`
  - npm: `test:bank-prb01`

## PR-B02 (Statement Import Foundation)

Original intent: import + line queue, no recon matching.

Repo-native adoption:

- Migration file:
  - `backend/src/migrations/m028_bank_statement_imports.js`
- Tables:
  - `bank_statement_imports` (tenant-scoped, legal-entity-scoped)
  - `bank_statement_lines` (tenant-scoped, legal-entity-scoped, `recon_status`)
- APIs under:
  - `/api/v1/bank/statements/*`
- Permissions:
  - `bank.statement.import`
  - `bank.statement.read`
- Test:
  - `backend/scripts/test-bank-prb02-import-foundation.js`
  - npm: `test:bank-prb02`

## PR-B03 (Reconciliation Core)

Original intent: queue, suggestions, match/unmatch/ignore, audit.

Repo-native adoption:

- Migration file:
  - `backend/src/migrations/m029_bank_reconciliation_core.js`
- Tables:
  - `bank_reconciliation_matches`
  - `bank_reconciliation_audit`
- APIs under:
  - `/api/v1/bank/reconciliation/*`
- Permissions:
  - `bank.reconcile.read`
  - `bank.reconcile.write`
- Test:
  - `backend/scripts/test-bank-prb03-reconciliation-core.js`
  - npm: `test:bank-prb03`

## PR-B04 (Generic Payment Batch Engine)

Original intent: reusable payment batch with approval/export/post.

Repo-native adoption:

- Migration file:
  - `backend/src/migrations/m030_payment_batches_core.js`
- Tables:
  - `payment_batches`
  - `payment_batch_lines`
  - `payment_batch_exports`
- APIs under:
  - `/api/v1/payments/*`
- Permissions:
  - `payments.batch.read`
  - `payments.batch.create`
  - `payments.batch.approve`
  - `payments.batch.export`
  - `payments.batch.post`
  - `payments.batch.cancel`
- Test:
  - `backend/scripts/test-payments-prb04-batch-engine.js`
  - npm: `test:payments-prb04`

## Frontend Routing Adoption Notes (Mandatory)

Do not introduce a parallel top-level `/bank/...` frontend namespace.
Use `/app/...` routes to stay consistent with current app layout and guards.

Adopted path plan:

- PR-B01 page:
  - Canonical: `/app/banka-tanimla` (reuse existing placeholder)
  - Optional alias: `/app/banka-hesaplari` -> redirect to canonical
- PR-B02 pages:
  - `/app/banka-ekstre-ice-aktar`
  - `/app/banka-ekstre-kuyrugu`
- PR-B03 page:
  - `/app/banka-mutabakat`
- PR-B04 pages:
  - `/app/odeme-batchleri`
  - `/app/odeme-batchleri/:id`

## Release Gate Adoption

Do not immediately hard-wire Bank into the final release gate.

Adopt staged scripts:

1. `test:bank-gate` (new chain for B01..B03 or B04 when ready)
2. Keep release gate extension optional by env flag, same strategy used for contracts/revenue.

Example target after bank stabilizes:

- `test:release-gate:core` (existing)
- optional extension call from release orchestrator:
  - skip env e.g. `RELEASE_GATE_SKIP_BANK=1`

## Recommended Implementation Order (After Adoption)

1. PR-B01 only (bank accounts foundation)
2. PR-B02 (statement import queue)
3. PR-B03 (reconciliation core)
4. PR-B04 (generic payment batches)

## "Definition of Ready" For Starting PR-B01

Before coding PR-B01:

1. Confirm migration number `m027_*` is reserved.
2. Confirm permission codes and role seed mapping are finalized in design.
3. Confirm canonical frontend route (`/app/banka-tanimla`) for Bank Accounts page.
4. Confirm Bank smoke script name and npm alias.
5. Confirm OpenAPI generation flow includes new endpoints.
