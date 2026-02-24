## 9) PR-16: Contracts Foundation (Backend First)

### Goal

Introduce contract domain without changing existing Cari behavior.

### Files to create

- `backend/src/migrations/m020_contracts_foundation.js`
- `backend/src/routes/contracts.js`
- `backend/src/routes/contracts.validators.js`
- `backend/src/services/contracts.service.js`
- `backend/scripts/test-contracts-pr16-schema-and-api.js`

### Files to update

- `backend/src/migrations/index.js`
- `backend/src/index.js`
- `backend/src/seedCore.js`
- `backend/scripts/generate-openapi.js`
- `backend/package.json`

### New backend endpoints

- `GET /api/v1/contracts`
- `GET /api/v1/contracts/{contractId}`
- `POST /api/v1/contracts`
- `PUT /api/v1/contracts/{contractId}`
- `POST /api/v1/contracts/{contractId}/activate`
- `POST /api/v1/contracts/{contractId}/close`
- `POST /api/v1/contracts/{contractId}/link-document`
- `GET /api/v1/contracts/{contractId}/documents`

### Migration skeleton

```js
const migration020ContractsFoundation = {
  key: "m020_contracts_foundation",
  description: "Contracts domain foundation and document links",
  async up(connection) {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS contracts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        legal_entity_id BIGINT UNSIGNED NOT NULL,
        counterparty_id BIGINT UNSIGNED NOT NULL,
        contract_no VARCHAR(80) NOT NULL,
        contract_type ENUM('CUSTOMER','VENDOR') NOT NULL,
        status ENUM('DRAFT','ACTIVE','SUSPENDED','CLOSED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        currency_code CHAR(3) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        total_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0,
        total_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0,
        notes VARCHAR(500) NULL,
        created_by_user_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_contract_no (tenant_id, legal_entity_id, contract_no),
        UNIQUE KEY uk_contracts_tenant_id_id (tenant_id, id),
        UNIQUE KEY uk_contracts_tenant_entity_id (tenant_id, legal_entity_id, id),
        KEY ix_contract_tenant_id (tenant_id),
        KEY ix_contract_scope (tenant_id, legal_entity_id, counterparty_id, status),
        CONSTRAINT fk_contracts_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        CONSTRAINT fk_contracts_entity_tenant
          FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
        CONSTRAINT fk_contracts_counterparty_tenant
          FOREIGN KEY (tenant_id, legal_entity_id, counterparty_id)
          REFERENCES counterparties(tenant_id, legal_entity_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS contract_lines (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        contract_id BIGINT UNSIGNED NOT NULL,
        line_no INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        line_amount_txn DECIMAL(20,6) NOT NULL,
        line_amount_base DECIMAL(20,6) NOT NULL,
        recognition_method ENUM('STRAIGHT_LINE','MILESTONE','MANUAL') NOT NULL DEFAULT 'STRAIGHT_LINE',
        recognition_start_date DATE NULL,
        recognition_end_date DATE NULL,
        deferred_account_id BIGINT UNSIGNED NULL,
        revenue_account_id BIGINT UNSIGNED NULL,
        status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_contract_lines_tenant_id_id (tenant_id, id),
        UNIQUE KEY uk_contract_line_no (tenant_id, contract_id, line_no),
        KEY ix_contract_line_scope (tenant_id, contract_id, status),
        CONSTRAINT fk_contract_lines_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        CONSTRAINT fk_contract_lines_contract_tenant
          FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts(tenant_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS contract_document_links (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        legal_entity_id BIGINT UNSIGNED NOT NULL,
        contract_id BIGINT UNSIGNED NOT NULL,
        cari_document_id BIGINT UNSIGNED NOT NULL,
        link_type ENUM('BILLING','ADVANCE','ADJUSTMENT') NOT NULL,
        linked_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0,
        linked_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0,
        created_by_user_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_contract_doc_links_tenant_id_id (tenant_id, id),
        UNIQUE KEY uk_contract_doc_link (tenant_id, contract_id, cari_document_id, link_type),
        KEY ix_contract_doc_link_scope (tenant_id, legal_entity_id, contract_id, cari_document_id),
        CONSTRAINT fk_contract_doc_links_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        CONSTRAINT fk_contract_doc_links_entity_tenant
          FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
        CONSTRAINT fk_contract_doc_links_contract_tenant
          FOREIGN KEY (tenant_id, legal_entity_id, contract_id)
          REFERENCES contracts(tenant_id, legal_entity_id, id),
        CONSTRAINT fk_contract_doc_links_cari_doc_tenant
          FOREIGN KEY (tenant_id, legal_entity_id, cari_document_id)
          REFERENCES cari_documents(tenant_id, legal_entity_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },
};

export default migration020ContractsFoundation;
```

### New permissions (seed + RBAC)

- `contract.read`
- `contract.upsert`
- `contract.activate`
- `contract.close`
- `contract.link_document`

### Domain correctness lock (PR-16)

- DB integrity discipline (repo-style):
  - keep composite unique keys for tenant/entity-safe FK targets on new tables.
  - enforce composite FKs so cross-tenant/cross-entity mistakes fail at DB level, not only in service logic.
- Link-document direction compatibility must be enforced in service layer:
  - `contract_type=CUSTOMER` can link only to `cari_documents.direction=AR`
  - `contract_type=VENDOR` can link only to `cari_documents.direction=AP`
  - reject mismatches with explicit validation error.
- `contract_lines` legal-entity denormalization decision for PR-16:
  - keep normalized via parent `contracts.legal_entity_id` (no extra `legal_entity_id` column in `contract_lines` for now)
  - if reporting/index pressure appears later, add denormalization in a separate optimization PR.
- Contract-line account mapping safety (mandatory):
  - if `deferred_account_id` or `revenue_account_id` is provided, account must belong to same tenant.
  - account must be legal-entity compatible with contract scope (`account -> coa -> legal_entity_id`).
  - account must be active and postable (`is_active=true`, `allow_posting=true`).
  - account type compatibility:
    - `CUSTOMER`: `deferred_account_id` -> `LIABILITY`, `revenue_account_id` -> `REVENUE`
    - `VENDOR`: `deferred_account_id` -> `ASSET`, `revenue_account_id` -> `EXPENSE`
- `contract_document_links` legal-entity decision (freeze now):
  - store `legal_entity_id` on link rows to enable strong composite FK enforcement to both
    `contracts` and `cari_documents`.
- Link eligibility freeze:
  - link only accounting-final posted-family statuses (`POSTED`, `PARTIALLY_SETTLED`, `SETTLED`).
  - reject non-final/non-linkable statuses (`DRAFT`, `CANCELLED`, `REVERSED`).
- Contract lifecycle freeze for linking:
  - allow link when contract status is `DRAFT` or `ACTIVE`.
  - reject link when `SUSPENDED`, `CLOSED`, or `CANCELLED`.
- Link amount policy freeze:
  - partial linking is allowed.
  - cumulative linked amount per document must not exceed document amount
    (`linked_amount_txn` <= `cari_documents.amount_txn`, same for base).
  - cap validation must be transaction-safe:
    - lock source document row (`cari_documents`) with `FOR UPDATE`.
    - lock link rows/aggregate inputs for the same document with `FOR UPDATE`.
    - read current linked totals, validate cap, insert link, and commit in one DB transaction.
- Auditability freeze:
  - no silent link-row edits in PR-16.
  - corrections should be explicit (future unlink/adjustment action), with audit logging.
- Link immutability/uniqueness consistency freeze:
  - keep one immutable row per (`tenant_id`, `contract_id`, `cari_document_id`, `link_type`) in PR-16.
  - keep `uk_contract_doc_link` as-is in PR-16.
  - append-style correction rows for same tuple are out-of-scope for PR-16 and belong to future explicit unlink/adjustment PR.
- Scope boundary:
  - PR-16 is contracts foundation + lifecycle + link-document only.
  - periodization/deferred/accrual logic is out-of-scope and belongs to PR-17B/17C/17D.

### Checklist

- [ ] Add migration and wire `m020` in `backend/src/migrations/index.js`.
- [ ] Add contracts route/validator/service split.
- [ ] Add index mount in `backend/src/index.js`:
  - [ ] `app.use("/api/v1/contracts", requireAuth, contractsRoutes);`
- [ ] Add permissions in `seedCore` and role mapping.
- [ ] Add OpenAPI route docs in generator.
- [ ] Add composite unique keys/FKs on new tables in migration (tenant/entity-safe).
- [ ] Enforce contract-line account mapping safety:
  - [ ] validate `deferred_account_id` / `revenue_account_id` with tenant-safe account guard
  - [ ] enforce legal-entity compatibility via `account -> coa`
  - [ ] enforce `is_active=true` and `allow_posting=true`
  - [ ] enforce account-type matrix:
    - [ ] CUSTOMER -> deferred `LIABILITY`, revenue `REVENUE`
    - [ ] VENDOR -> deferred `ASSET`, revenue `EXPENSE`
- [ ] Enforce strict scope checks in link service:
  - [ ] linked `cari_document` must match contract `tenant_id`
  - [ ] linked `cari_document` must match contract `legal_entity_id`
- [ ] Enforce `contract_type` vs document direction compatibility:
  - [ ] CUSTOMER -> AR only
  - [ ] VENDOR -> AP only
- [ ] Enforce link eligibility rules:
  - [ ] only posted-family statuses can be linked (`POSTED`/`PARTIALLY_SETTLED`/`SETTLED`)
  - [ ] reject `DRAFT`/`CANCELLED`/`REVERSED` documents
- [ ] Enforce contract status rules for linking:
  - [ ] allow only `DRAFT`/`ACTIVE`
  - [ ] reject `SUSPENDED`/`CLOSED`/`CANCELLED`
- [ ] Enforce partial-link cap:
  - [ ] cumulative linked txn/base per document cannot exceed document txn/base
  - [ ] enforce cap check inside one DB transaction with locking:
    - [ ] lock source `cari_documents` row under `FOR UPDATE`
    - [ ] lock current link rows/aggregate inputs under `FOR UPDATE`
    - [ ] read current linked totals + cap reference rows under lock
    - [ ] validate + insert link within same transaction
    - [ ] commit atomically (rollback on validation failure)
- [ ] Keep `contract_lines` normalized (no `legal_entity_id` denormalization in PR-16 migration).
- [ ] Keep `contract_document_links` with `legal_entity_id` for DB-level entity safety.
- [ ] Keep link rows immutable in PR-16 (no silent update flow).
- [ ] Keep link immutability + uniqueness model internally consistent in PR-16:
  - [ ] keep one immutable row per (`tenant_id`,`contract_id`,`cari_document_id`,`link_type`)
  - [ ] keep `uk_contract_doc_link` unique key unchanged
  - [ ] defer append-style adjustments to future explicit unlink/adjustment PR
- [ ] Keep PR-16 free of periodization/deferred/accrual posting logic.
- [ ] Add PR-16 integration test + package script.

### Acceptance

- Contracts CRUD and lifecycle stable.
- Contract-document links are tenant-safe and scope-safe.
- Contract-document linking enforces type/direction compatibility (`CUSTOMER/AR`, `VENDOR/AP`).
- Contract linking enforces posted-only + contract-status eligibility rules.
- Contract-line account references are tenant/entity safe, postable/active, and type-compatible.
- DB-level FKs/composite keys prevent cross-tenant/cross-entity link corruption.
- Partial linking works with capped totals per document.
- Capped linking remains correct under concurrency (no race-based cap overshoot).
- Link immutability policy is unambiguous and consistent with DB uniqueness constraints.
- Contracts foundation remains isolated from periodization engine concerns.
- No regressions in Cari endpoints/tests.

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-16)

- Section `2.3` namespace coverage:
  - `/api/v1/contracts/*`
- Section `2.4` permission alignment:
  - `contract.read`, `contract.upsert`, `contract.activate`, `contract.close`, `contract.link_document`
- Section `3` data model alignment:
  - existing Cari tables stay unchanged semantically.
  - `contract_document_links` includes `legal_entity_id` and references both `contracts` and `cari_documents`
    with composite tenant/entity-safe FKs.
  - `contract_lines` stays normalized through `contracts` in PR-16 (no premature denormalization).

---

## 10) PR-17 Split: Deferred + Accrual Periodization Engine (18x/28x/38x/48x)

### Why split PR-17 into 17A/17B/17C/17D

- Reviewability: each accounting family/lifecycle is independently reviewable.
- Rollback safety: a bad phase can be reverted without rolling back full engine scope.
- Cleaner test gates: each PR has its own deterministic pass/fail boundary.
- Lower regression risk on existing accounting behavior.

### Shared accounting semantics (apply to PR-17A..17D)

- Namespace: `/api/v1/revenue-recognition/*`
- Classification fields in schedule/run/subledger rows:
  - `liability_bucket` (`SHORT_TERM` | `LONG_TERM`)
  - `maturity_date`
  - `reclass_required`
  - `account_family` (`DEFREV` | `ACCRUED_REVENUE` | `ACCRUED_EXPENSE` | `PREPAID_EXPENSE`)
- Initial bucket split by maturity:
  - <= 12 months -> short-term (`180/181/380/381`)
  - > 12 months -> long-term (`280/281/480/481`)
- Mandatory long->short reclass:
  - `280 -> 180`, `281 -> 181`, `480 -> 380`, `481 -> 381`
- GL must reconcile to subledger by tenant/legal-entity/period/currency.
- Consolidation reports must show short/long balances separately by family (no default netting).

### Shared accounting mapping (journal_purpose_accounts)

- `PREPAID_EXP_SHORT_ASSET` (180)
- `PREPAID_EXP_LONG_ASSET` (280)
- `ACCR_REV_SHORT_ASSET` (181)
- `ACCR_REV_LONG_ASSET` (281)
- `DEFREV_SHORT_LIABILITY` (380)
- `DEFREV_LONG_LIABILITY` (480)
- `ACCR_EXP_SHORT_LIABILITY` (381)
- `ACCR_EXP_LONG_LIABILITY` (481)
- `DEFREV_REVENUE`
- `DEFREV_RECLASS`

### Shared posting setup guard (mandatory across PR-17B/17C)

- Posting must hard-fail if required `journal_purpose_accounts` mappings are missing.
- Behavior must stay consistent with existing Cari posting services:
  - resolve required purpose codes by tenant + legal entity
  - return explicit setup-required validation when mapping is absent
- Do not silently fallback to arbitrary accounts.

### Shared permissions (seed + RBAC)

- `revenue.schedule.read`
- `revenue.schedule.generate`
- `revenue.run.read`
- `revenue.run.create`
- `revenue.run.post`
- `revenue.run.reverse`
- `revenue.report.read`

### 10.1 PR-17A: Foundation (No posting)

Goal:

- Build schema, permissions, route/validator/service skeletons, and OpenAPI base.
- Do not implement posting/reversal/accrual settlement logic in this PR.

Files to create:

- `backend/src/migrations/m021_revenue_recognition_schedules.js`
- `backend/src/routes/revenue-recognition.js`
- `backend/src/routes/revenue-recognition.validators.js`
- `backend/src/services/revenue-recognition.service.js`
- `backend/scripts/test-revenue-pr17a-foundation.js`

Files to update:

- `backend/src/migrations/index.js`
- `backend/src/index.js`
- `backend/src/seedCore.js`
- `backend/scripts/generate-openapi.js`
- `backend/package.json`

Scope checklist:

- [ ] Create base tables:
  - [ ] `revenue_recognition_schedules`
  - [ ] `revenue_recognition_schedule_lines`
  - [ ] `revenue_recognition_runs`
  - [ ] `revenue_recognition_run_lines`
  - [ ] `revenue_recognition_subledger_entries`
- [ ] Mount namespace route:
  - [ ] `app.use("/api/v1/revenue-recognition", requireAuth, revenueRecognitionRoutes);`
- [ ] Add permissions in seed + role mappings.
- [ ] Add OpenAPI tags/routes for foundation endpoints.
- [ ] Define canonical PR-17 purpose-code set and OpenAPI docs for operator setup expectations.
- [ ] Add test script `test:revenue-pr17a`.
- [ ] Assert no posting/reversal side effects are active in PR-17A.

Acceptance:

- Schema and permission foundation is ready.
- Namespace and validator/service skeletons are in place.
- No accounting posting behavior has been introduced yet.

### 10.2 PR-17B: DEFREV + PREPAID (380/480, 180/280)

Goal:

- Implement posting/reversal/reclass for deferred revenue and prepaid expense families.

Primary endpoints activated in this PR:

- `POST /api/v1/revenue-recognition/schedules/generate`
- `GET /api/v1/revenue-recognition/schedules`
- `POST /api/v1/revenue-recognition/runs`
- `GET /api/v1/revenue-recognition/runs`
- `POST /api/v1/revenue-recognition/runs/{runId}/post`
- `POST /api/v1/revenue-recognition/runs/{runId}/reverse`

Scope checklist:

- [ ] Implement DEFREV family flow (`380/480`) with recognition posting.
- [ ] Implement PREPAID family flow (`180/280`) with amortization posting.
- [ ] Implement long->short reclass for `280->180` and `480->380`.
- [ ] Add duplicate-line guard for reruns (same source should not create duplicate open lines).
- [ ] Enforce posting setup guard:
  - [ ] load required purpose-account mappings by tenant/legal-entity
  - [ ] fail with explicit setup-required error if any required mapping is missing
- [ ] Keep explicit original-run linkage on reversals.
- [ ] Add test script `test:revenue-pr17b`.

Acceptance:

- DEFREV/PREPAID posting and reversal are balanced and auditable.
- Reclass behavior is deterministic.
- Reruns are idempotent at schedule/run-line level for this scope.
- Missing required purpose-account setup fails fast with explicit setup-required errors.

### 10.3 PR-17C: Accruals (181/281, 381/481) + Settle/Reverse

Goal:

- Implement accrued revenue/expense generation and due-based settle/reverse lifecycle.

Primary endpoints activated in this PR:

- `POST /api/v1/revenue-recognition/accruals/generate`
- `POST /api/v1/revenue-recognition/accruals/{accrualId}/settle`
- `POST /api/v1/revenue-recognition/accruals/{accrualId}/reverse`

Scope checklist:

- [ ] Implement ACCRUED_REVENUE (`181/281`) lifecycle.
- [ ] Implement ACCRUED_EXPENSE (`381/481`) lifecycle.
- [ ] Enforce due-based closure and reversal boundaries.
- [ ] Implement long->short reclass for `281->181` and `481->381`.
- [ ] Enforce posting setup guard for accrual posting/settlement/reversal paths (same rules as PR-17B).
- [ ] Add test script `test:revenue-pr17c`.

Acceptance:

- Accrual generation/settlement/reversal behavior is deterministic and scoped correctly.
- Subledger and GL remain reconciled for accrual families.
- Missing required purpose-account setup fails fast with explicit setup-required errors.

### 10.4 PR-17D: Reports + Reconciliation + UI-facing Endpoint Polish

Goal:

- Finalize reporting surface and reconciliation guarantees for frontend consumption.

Primary endpoints activated/refined in this PR:

- `GET /api/v1/revenue-recognition/reports/future-year-rollforward`
- `GET /api/v1/revenue-recognition/reports/deferred-revenue-split`
- `GET /api/v1/revenue-recognition/reports/accrual-split`

Scope checklist:

- [ ] Add/finish rollforward and split reports with legal-entity/time filters.
- [ ] Add reconciliation assertions between rollforward totals and posted GL movements.
- [ ] Add subledger-to-GL reconciliation checks per period/legal-entity/currency.
- [ ] Add query-shape/index checks for report queries (`EXPLAIN`).
- [ ] Add test script `test:revenue-pr17d`.

Acceptance:

- Reporting layer is stable, auditable, and frontend-ready.
- Consolidation consumers can use split balances without manual corrections.

### Global Guardrails Check (Mandatory for each PR-17x)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-17A..17D)

- Section `2.3` namespace coverage:
  - `/api/v1/revenue-recognition/*`
- Permission alignment:
  - `revenue.schedule.read`, `revenue.schedule.generate`, `revenue.run.read`,
    `revenue.run.create`, `revenue.run.post`, `revenue.run.reverse`, `revenue.report.read`
- Section `3` data model alignment:
  - existing Cari tables remain semantically stable.
  - new revenue-recognition tables stay tenant/legal-entity safe.
  - periodization semantics remain explicit across DEFREV/ACCRUAL/PREPAID families.

---

## 11) PR-18: UI for Contracts + Periodization Split

### Goal

Convert both placeholder main-menu modules into real UI modules, with periodization split UX:

- Gelecek Aylar Gelirleri / Gelecek Yillar Gelirleri
- Gelir Tahakkuklari (kisa/uzun)
- Gider Tahakkuklari (kisa/uzun)
- Gelecek Aylara/Yillara Ait Giderler (prepaid carry)

### Product naming note (future-safe)

- Current route `/app/gelecek-yillar-gelirleri` can stay for backward compatibility.
- Since UI scope includes deferred + accrual + prepaid families, consider a broader product/module name later
  (for example `Donemsellik ve Tahakkuklar` / `Periodization & Accruals`).
- If renamed later, keep route aliases/redirects to avoid breaking bookmarks/integrations.

### Existing placeholder routes to convert

- `/app/contracts`
- `/app/gelecek-yillar-gelirleri`

### Files to create

- `frontend/src/api/contracts.js`
- `frontend/src/api/revenueRecognition.js`
- `frontend/src/pages/contracts/ContractsPage.jsx`
- `frontend/src/pages/contracts/contractsUtils.js`
- `frontend/src/pages/revenue/FutureYearRevenuePage.jsx`
- `frontend/src/pages/revenue/revenueRecognitionUtils.js`
- `backend/scripts/test-contracts-revenue-pr18-frontend-smoke.js`

### Files to update

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/i18n/messages.js`
- `backend/package.json`

### Route wiring

- `/app/contracts` -> `<ContractsPage />` (permission: `contract.read`)
- `/app/gelecek-yillar-gelirleri` -> `<FutureYearRevenuePage />` (permission: `revenue.report.read`)

Guard source note (repo-aligned):

- Permission labels above are enforced via `sidebarConfig.js` `requiredPermissions`.
- In current `App.jsx`, `withPermissionGuard` reads permissions from sidebar map by `appPath`.
- Do not rely on a route object `permissions` field for PR-18.

### Placeholder-to-implemented conversion lock (mandatory)

- `frontend/src/App.jsx`
  - Replace placeholder elements with real components for:
    - `/app/contracts`
    - `/app/gelecek-yillar-gelirleri`
  - Ensure both are included in implemented route list/branch used by app shell
    (no fallback `ModulePlaceholderPage` for these two routes).
  - Repo-specific rule:
    - in current `App.jsx`, placeholder routing is derived from `implementedPaths` vs sidebar links.
    - therefore `sidebarConfig.js` `implemented: true` alone is not sufficient.
    - both routes must exist in `implementedRoutes` (so they are part of `implementedPaths`).
- `frontend/src/layouts/sidebarConfig.js`
  - `Contracts` menu item must include:
    - `requiredPermissions: ["contract.read"]`
    - `implemented: true`
  - `Gelecek Yillar Gelirleri` menu item must include:
    - `requiredPermissions: ["revenue.report.read"]`
    - `implemented: true`
- `frontend/src/i18n/messages.js`
  - Add/verify `sidebar.byPath` keys for:
    - `/app/contracts`
    - `/app/gelecek-yillar-gelirleri`

### Checklist

- [ ] Implement Contracts list/create/edit/activate/close/link-document flow.
- [ ] Implement Periodization Split UI:
  - [ ] schedule generation trigger
  - [ ] run create/post/reverse
  - [ ] rollforward report filters + table/cards
  - [ ] split liability cards/tables: Gelecek Aylar Gelirleri vs Gelecek Yillar Gelirleri
  - [ ] tahakkuk cards/tables: Gelir Tahakkuklari (181/281) and Gider Tahakkuklari (381/481)
  - [ ] prepaid carry cards/tables: 180/280
  - [ ] reclass visibility: moved from long-term to short-term (period basis)
  - [ ] subledger/GL reconciliation summary panel
- [ ] Replace placeholders in `App.jsx` with real page components for both routes (implemented route list included).
- [ ] Verify both routes are in `implementedRoutes`/`implementedPaths` and not rendered via `placeholderRoutes`.
- [ ] Set sidebar permission/implementation flags:
  - [ ] `/app/contracts` -> `requiredPermissions: ["contract.read"]`, `implemented: true`
  - [ ] `/app/gelecek-yillar-gelirleri` -> `requiredPermissions: ["revenue.report.read"]`, `implemented: true`
- [ ] Keep guard model repo-aligned (no route object `permissions` dependency for these routes).
- [ ] Add/verify `messages.js` `sidebar.byPath` labels for both routes.
- [ ] Keep frontend API helper pattern consistent with PR-11:
  - [ ] use shared API error/query helpers (extend to generic `apiCommon` if adopted)
- [ ] Add per-action permission checks (not only route-level).
- [ ] Update sidebar labels/translations.
- [ ] Add PR-18 frontend smoke script:
  - [ ] assert `App.jsx` uses real components (not placeholders) for both routes
  - [ ] assert both routes are present in implemented route branch (not only sidebar metadata)
  - [ ] assert `sidebarConfig.js` contains `requiredPermissions` and `implemented: true` for both routes
  - [ ] assert `messages.js` contains `sidebar.byPath` entries for both routes

### Acceptance

- Main menu modules are fully functional (not placeholders).
- Unauthorized users cannot see/use menu actions outside granted permissions.
- Contract and periodization flows reconcile with backend reports.
- Deferred revenue UI clearly separates short-term vs long-term balances and reclass movements.
- Tahakkuk and prepaid flows are visible with open/closed status and due-based closures.
- No regression in Cari quality gate.

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-18)

- Frontend route coverage for new modules:
  - `/app/contracts`
  - `/app/gelecek-yillar-gelirleri`
- Section `2.3` backend namespace consumption:
  - `/api/v1/contracts/*`
  - `/api/v1/revenue-recognition/*`
- Permission alignment:
  - contracts and revenue permissions must match backend names exactly.
- Data model alignment:
  - UI payloads must preserve tenant/legal-entity boundaries and not change Cari v1 semantics.
  - periodization UI must honor `SHORT_TERM` / `LONG_TERM` bucket semantics from backend across all families.

---

## 12) PR-19: Counterparty AR/AP Account Mapping + Posting Resolution

### Goal

Introduce optional per-counterparty AR/AP control-account mapping for Cari flows without breaking current behavior.

### Why this PR

- Today Cari posting resolves control+offset accounts from `journal_purpose_accounts`.
- Some deployments need counterparty-level control account overrides (customer segment/vendor segment).
- PR-19 adds these overrides safely while keeping current fallback behavior.

### Scope

- Add nullable account mapping fields on `counterparties`:
  - `ar_account_id`
  - `ap_account_id`
- Extend existing counterparty create/update/read contracts.
- Update Cari document/settlement posting resolution:
  - control account: counterparty override if present, otherwise existing purpose mapping
  - offset account: continue from existing purpose mapping (no behavioral change)
- Keep backward compatibility for existing tenants and counterparties.

### Files to create

- `backend/src/migrations/m022_counterparty_account_mapping.js`
- `backend/scripts/test-cari-pr19-counterparty-account-mapping-and-posting-resolution.js`
- `backend/scripts/test-cari-pr19-frontend-counterparty-account-fields-smoke.js` (optional but recommended)

### Files to update

- `backend/src/migrations/index.js`
- `backend/src/routes/cari.counterparty.validators.js`
- `backend/src/services/cari.counterparty.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.settlement.service.js`
- `backend/scripts/generate-openapi.js`
- `backend/package.json`
- `frontend/src/pages/cari/counterpartyFormUtils.js`
- `frontend/src/pages/cari/CariCounterpartyPage.jsx`
- `frontend/src/i18n/messages.js`

### API contract updates (existing endpoints)

- `POST /api/v1/cari/counterparties`
- `PUT /api/v1/cari/counterparties/{counterpartyId}`
- `GET /api/v1/cari/counterparties`
- `GET /api/v1/cari/counterparties/{counterpartyId}`

New/extended fields:

- `arAccountId` (optional)
- `apAccountId` (optional)

Response enrichment (recommended):

- `arAccountCode`, `arAccountName`
- `apAccountCode`, `apAccountName`

### Migration skeleton (`m022_counterparty_account_mapping.js`)

```js
const migration022CounterpartyAccountMapping = {
  key: "m022_counterparty_account_mapping",
  description: "Add per-counterparty AR/AP account mapping",
  async up(connection) {
    await connection
      .execute(`
        ALTER TABLE counterparties
        ADD COLUMN ar_account_id BIGINT UNSIGNED NULL AFTER default_payment_term_id
      `)
      .catch(ignoreDuplicateColumn);

    await connection
      .execute(`
        ALTER TABLE counterparties
        ADD COLUMN ap_account_id BIGINT UNSIGNED NULL AFTER ar_account_id
      `)
      .catch(ignoreDuplicateColumn);

    await connection
      .execute(`
        ALTER TABLE counterparties
        ADD KEY ix_counterparties_ar_account (ar_account_id)
      `)
      .catch(ignoreDuplicateKey);

    await connection
      .execute(`
        ALTER TABLE counterparties
        ADD KEY ix_counterparties_ap_account (ap_account_id)
      `)
      .catch(ignoreDuplicateKey);

    await connection
      .execute(`
        ALTER TABLE counterparties
        ADD CONSTRAINT fk_counterparties_ar_account
        FOREIGN KEY (ar_account_id) REFERENCES accounts(id)
      `)
      .catch(ignoreDuplicateFk);

    await connection
      .execute(`
        ALTER TABLE counterparties
        ADD CONSTRAINT fk_counterparties_ap_account
        FOREIGN KEY (ap_account_id) REFERENCES accounts(id)
      `)
      .catch(ignoreDuplicateFk);
  },
};

export default migration022CounterpartyAccountMapping;
```

### Domain correctness lock (mandatory)

- Account scope safety:
  - mapped account must belong to same tenant (tenant-safe guard).
  - mapped account must be legal-entity compatible with counterparty scope via `accounts -> charts_of_accounts`.
  - mapped account must use legal-entity scoped chart for Cari control usage (`coa.scope='LEGAL_ENTITY'`).
- Posting suitability:
  - mapped account must be active and postable (`is_active=true`, `allow_posting=true`).
- Type compatibility:
  - `arAccountId` must be `ASSET`.
  - `apAccountId` must be `LIABILITY`.
- Role compatibility:
  - if `isCustomer=false`, reject `arAccountId`.
  - if `isVendor=false`, reject `apAccountId`.
- Backward compatibility:
  - mappings are optional.
  - if missing, existing purpose-account path remains default.
- Offset resolution unchanged:
  - offsets continue from `journal_purpose_accounts` (`CARI_AR_OFFSET`, `CARI_AP_OFFSET`).

### Posting resolution policy (explicit)

For AR document/settlement:

- if counterparty has `arAccountId`, use it as control account
- otherwise use `CARI_AR_CONTROL`
- offset remains `CARI_AR_OFFSET`

For AP document/settlement:

- if counterparty has `apAccountId`, use it as control account
- otherwise use `CARI_AP_CONTROL`
- offset remains `CARI_AP_OFFSET`

### Checklist

- [ ] Add migration and wire `m022` in `backend/src/migrations/index.js`.
- [ ] Extend counterparty validator/service contracts for `arAccountId` / `apAccountId`.
- [ ] Validate account scope + legal-entity compatibility via account guard (`accounts -> coa`).
- [ ] Validate account suitability (`is_active`, `allow_posting`).
- [ ] Validate account type compatibility (`ASSET` for AR, `LIABILITY` for AP).
- [ ] Validate role compatibility (`isCustomer` / `isVendor`).
- [ ] Update posting account resolution in:
  - [ ] `cari.document.service.js`
  - [ ] `cari.settlement.service.js`
- [ ] Keep fallback behavior to `journal_purpose_accounts` when no mapping exists.
- [ ] Keep offset account resolution unchanged.
- [ ] Update OpenAPI generator + generated output.
- [ ] Add tests:
  - [ ] valid CUSTOMER + `arAccountId` in same tenant/entity -> success
  - [ ] valid VENDOR + `apAccountId` in same tenant/entity -> success
  - [ ] reject cross-tenant / wrong-entity mapping
  - [ ] reject wrong account type
  - [ ] reject inactive/non-postable mapped account
  - [ ] posting uses mapped control account when present
  - [ ] posting falls back correctly when mapping absent
- [ ] Add script `test:cari-pr19` in `backend/package.json`.

### Acceptance

- Per-counterparty AR/AP mapping works and remains optional.
- Existing behavior remains unchanged when mappings are empty.
- Posting safely resolves mapped control accounts where present.
- Strict tenant/legal-entity/type/postability checks prevent account leakage.
- No regressions in existing Cari document/settlement flows.

### Commands

```powershell
cd backend
npm run test:cari-pr19
npm run test:cari-pr05
npm run test:cari-pr06
npm run test:cari-pr07
npm run test:cari-pr08
```

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-19)

- Section `2.2` affected endpoint families:
  - `/api/v1/cari/counterparties*`
  - existing document/settlement posting paths (resolution logic only)
- Section `2.4` permission alignment:
  - existing Cari card/doc/settlement permissions remain in force (no new permission required).
- Section `3` data model alignment:
  - `counterparties` gains optional `ar_account_id` and `ap_account_id`.
  - no semantic mutation in `cari_documents` / settlement tables.
