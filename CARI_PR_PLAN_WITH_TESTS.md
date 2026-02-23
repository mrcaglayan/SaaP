# PR-00 ADR + Scope Lock

## Scope

Create and freeze the v1 functional rules for Cari (AR/AP) before schema/API coding starts.

## Implementation Tasks

* Create `docs/adr/adr-cari-v1.md`.
* Freeze and document:

  * **Document numbering**: `tenant + legal_entity + document_type + fiscal_year`, assigned on **POST**
  * **Settlement numbering**: `tenant + legal_entity + sequence_namespace + fiscal_year`, assigned on **APPLY**
  * **Settlement namespace (v1)**: `SETTLEMENT`
  * **Status enums**

    * `cari_documents.status = DRAFT | POSTED | REVERSED | CANCELLED`
    * `cari_open_items.status = OPEN | PARTIAL | SETTLED | REVERSED`
    * `cari_settlement_batches.status = APPLIED | REVERSED`
  * **Reversal boundaries**

    * `CANCEL = draft-only`
    * `REVERSE = posted/applied-only`
    * no destructive edits
  * **Linkage requirements**

    * `cari_documents.posted_journal_entry_id`
    * `cari_documents.reversal_of_document_id` (recommended naming)
    * `cari_settlement_batches.posted_journal_entry_id`
    * `cari_settlement_batches.reversal_of_settlement_batch_id`
  * **Counterparty scope**: legal-entity scoped
  * **Snapshot policy** on documents
  * **Realized FX account source**: `journal_purpose_accounts`
  * **Concurrency/idempotency policy** for settlement apply
  * **Bank-ready scope** (v1 hooks only, no full bank reconciliation)
  * **As-of date/report semantics** (which date fields drive aging/statement)
* Add out-of-scope list:

  * dunning/collections workflows
  * credit insurance
  * full bank reconciliation module
  * e-invoice / tax engine extras (if out of scope)

## Tests

* No runtime tests required (docs-only PR).
* Optional lint/markdown check if you have doc linting.

## Acceptance Criteria

* ADR file exists and is reviewed.
* All frozen rules above are explicitly written (not implied).
* No runtime behavior changes in backend/frontend.
* Team can implement PR-01..PR-10 without re-deciding core accounting rules.

---

# PR-01 DB Schema Foundation

## Scope

Create all core Cari tables and constraints so APIs can be built on a stable schema.

## Implementation Tasks

Add migrations for:

### New tables

* `counterparties`
* `counterparty_contacts`
* `counterparty_addresses`
* `payment_terms`
* `cari_documents`
* `cari_open_items`
* `cari_settlement_batches`
* `cari_settlement_allocations`
* `cari_unapplied_cash`

### Required columns / design points

* `cari_settlement_batches`

  * `sequence_namespace`
  * `fiscal_year`
  * `sequence_no`
  * `settlement_no`
  * `status`
  * `posted_journal_entry_id`
  * `reversal_of_settlement_batch_id`
* `cari_documents`

  * status + posting linkage + reversal linkage
  * snapshot columns:

    * `counterparty_code_snapshot`
    * `counterparty_name_snapshot`
    * `payment_term_snapshot` (code/json/string, whichever you choose)
    * `due_date_snapshot`
    * `currency_code_snapshot` / `fx_rate_snapshot` (or equivalent)
  * `posted_journal_entry_id`
  * `reversal_of_document_id`
* `cari_open_items`

  * txn/base amounts + residual amounts
  * due date fields
  * status
* `cari_settlement_allocations`

  * allocation amounts in txn/base
  * links to settlement batch + target open item
* Bank-ready nullable link fields (for v2 attach/apply compatibility) on settlement/unapplied-cash relevant tables.

### Uniques

* `counterparties (tenant_id, legal_entity_id, code)` unique
* `cari_documents` numbering unique by ADR dimensions
* `cari_settlement_batches (tenant_id, legal_entity_id, sequence_namespace, fiscal_year, sequence_no)` unique
* idempotency unique keys for:

  * settlement apply
  * bank attach/apply

### Integrity checks (DB-level where feasible)

* allocation amounts `> 0`
* residual/open amounts `>= 0`
* non-negative base/txn amount fields where applicable
* logical status/date checks where practical
* prevent double reversal with unique nullable reversal linkage (recommended)

### FKs / indexes

* tenant-safe composite FKs (follow existing project pattern)
* report-critical indexes:

  * `tenant_id`
  * `legal_entity_id`
  * `counterparty_id`
  * `status`
  * `due_date`
  * `document_date`
  * residual/open amount columns

## Tests

* Migration tests / smoke:

  * `npm run db:migrate`
  * `npm run db:migrate:status`
  * rollback + re-run (if your workflow supports rollback)
* DB constraint tests (integration):

  * duplicate counterparty code in same tenant+LE fails
  * duplicate doc number in same numbering dimensions fails
  * duplicate settlement sequence fails
  * invalid negative residual/open amounts fail
  * allocation `<= 0` fails
  * duplicate idempotency key fails
* Schema existence checks:

  * all tables/columns/indexes exist
  * FK references valid
  * nullable bank-link fields exist

## Acceptance Criteria

* Migrations apply cleanly on a fresh DB.
* Migrations are deterministic and rerunnable via normal dev workflow.
* Core tables, FKs, uniques, checks, and indexes exist as designed.
* Constraint tests prove bad data is blocked at DB level where intended.
* No changes required in later PRs to add missing foundational columns.

---

# PR-02 RBAC + Seed Updates

## Scope

Add Cari permissions and seed role mappings before exposing APIs/pages.

## Implementation Tasks

* Add new permissions (consistent naming style), e.g.:

  * `cari.card.read`
  * `cari.card.upsert`
  * `cari.doc.read`
  * `cari.doc.create`
  * `cari.doc.update`
  * `cari.doc.post`
  * `cari.doc.reverse`
  * `cari.settlement.apply`
  * `cari.settlement.reverse`
  * `cari.report.read`
  * `cari.fx.override`
  * `cari.audit.read`
  * `cari.bank.attach`
  * `cari.bank.apply`
* Seed permission rows.
* Map permissions to base roles (admin/accountant/readonly etc.).
* Add backend route permission guards for upcoming `/api/v1/cari/*`.
* Add frontend permission guards for Cari pages/menu items (not placeholder-only access).

## Tests

* Seed tests:

  * permissions are inserted once (idempotent seed behavior)
  * role mappings applied correctly
* Permission matrix API tests:

  * allowed role can access
  * denied role gets forbidden
* Frontend guard smoke:

  * users without permission cannot open protected Cari pages
  * users with permission can access

## Acceptance Criteria

* All Cari permission codes exist in DB and are seeded.
* Role-to-permission mappings are applied.
* Backend routes are guard-ready for PR-03+.
* Frontend pages/menu visibility respects permissions.
* Unauthorized access is blocked consistently (API + UI).

---

# PR-03 Counterparty Master Backend APIs

## Scope

Build counterparty master APIs with tenant safety and legal-entity scope rules.

## Implementation Tasks

Implement:

* `POST /api/v1/cari/counterparties`
* `PUT /api/v1/cari/counterparties/:id`
* `GET /api/v1/cari/counterparties`
* `GET /api/v1/cari/counterparties/:id`

Enforce:

* tenant-safe access
* legal-entity scope checks
* dual flags rules:

  * `is_customer` and/or `is_vendor`
  * at least one must be true
* active/inactive status rules
* default contact/address/payment term consistency
* unique code within `(tenant_id, legal_entity_id)`

Recommended implementation pieces:

* route file
* validation schema
* service layer
* repository/query helpers (optional, depending on your style)
* audit logging for create/update

## Tests

* API integration tests:

  * create customer-only card
  * create vendor-only card
  * create dual-role card
  * reject neither customer nor vendor
  * list by tenant and legal entity scope
  * get detail returns related contacts/addresses/defaults
  * update active/inactive status
* Tenant safety tests:

  * cannot read/update another tenant’s counterparty
* Scope tests:

  * cannot access outside allowed legal entity scope
* Validation tests:

  * duplicate code rejected
  * invalid default contact/address/payment term rejected

## Acceptance Criteria

* Counterparty CRUD endpoints work for valid users.
* Tenant/scope violations are blocked.
* Dual-role rules are enforced.
* Defaults are consistent and validated.
* Audit logs are written for create/update actions.

---

# PR-04 Counterparty Frontend Pages

## Scope

Implement buyer/vendor card create/list pages and connect to PR-03 APIs.

## Implementation Tasks

Implement pages:

* `/app/alici-kart-olustur`
* `/app/alici-kart-listesi`
* `/app/satici-kart-olustur`
* `/app/satici-kart-listesi`

Build:

* shared counterparty form component (recommended)

  * buyer/vendor flags
  * legal entity selector/filter
  * code, name, status
  * contacts/addresses
  * payment term defaults
* list pages:

  * filters (active/inactive, legal entity, code/name)
  * role-specific default filters (buyer vs vendor)
* API module for Cari counterparty endpoints
* permission guards on routes and UI actions
* user-friendly validation/error states

## Tests

* Frontend integration tests (or manual smoke if no test framework):

  * create buyer card
  * create vendor card
  * edit existing card
  * list/filter works
  * permission-based hide/disable behavior
* API contract smoke:

  * frontend payload matches backend validation
* UX checks:

  * form validation messages shown
  * duplicate code error handled cleanly

## Acceptance Criteria

* All 4 pages are usable and connected to real APIs.
* Permission checks work in UI.
* Create/edit/list flows work end-to-end.
* Buyer/vendor pages correctly preconfigure or filter card roles.
* No placeholder route is shown for these implemented pages.

---

# PR-05 Cari Document APIs (Draft Flow)

## Scope

Create draft document lifecycle APIs for the 10 frozen transaction types.

## Implementation Tasks

Implement endpoints for `cari_documents` draft flow:

* create draft
* list drafts/documents
* get detail
* update draft

Rules:

* only frozen 10 types allowed
* status transitions enforced (`DRAFT` editable)
* validate mandatory fields per txn type
* legal-entity / counterparty scope validation
* no posting yet in this PR (posting comes in PR-06)
* prepare snapshot capture logic to execute on POST boundary (can be in service layer now, invoked in PR-06)

Recommended:

* doc validators by txn type
* standardized response shape for future frontend/report use
* audit logs for draft create/update/cancel (draft cancel)

## Tests

* API tests:

  * create valid draft by each major txn category (at least representative set)
  * reject invalid txn type
  * reject missing mandatory fields
  * update draft succeeds
  * updating non-draft fails
* Scope/tenant tests:

  * invalid counterparty/legal entity combination rejected
  * cross-tenant access blocked
* Status tests:

  * only valid draft transitions allowed
  * draft cancel works (if implemented here)

## Acceptance Criteria

* Draft document APIs exist and support all frozen types.
* Validation is txn-type aware and scope-aware.
* Non-draft mutation is blocked.
* API contracts are stable for posting engine integration in PR-06.

---

# PR-06 Posting Engine + GL Integration

## Scope

Implement document posting (Draft -> Posted), GL journal creation, linkage fields, FX lock rules, and open-item creation.

## Implementation Tasks

Implement document posting workflow:

* `POST /api/v1/cari/documents/:id/post` (or your chosen route)
* assign **document number on POST** per ADR dimensions
* capture immutable snapshots on POST
* create GL journal entry + journal lines
* populate `subledger_reference_no`
* populate `cari_documents.posted_journal_entry_id`
* create `cari_open_items` rows from posted docs
* enforce FX rate date-lock rules
* allow override only with `cari.fx.override`
* write audit logs for post + override usage

Implement reversal/cancel boundaries:

* `CANCEL = draft-only`
* `REVERSE = posted-only`
* no destructive edits
* create reversal linkage (`reversal_of_document_id`)
* prevent double reverse

## Tests

* Posting tests:

  * draft posts successfully
  * number assigned only on POST
  * journal entry and lines created
  * `subledger_reference_no` populated
  * open item created with correct amounts/status
  * snapshots captured and persisted
* FX tests:

  * locked FX date blocks post for non-override user
  * override user can post with audit trail
* Boundary tests:

  * cannot cancel posted doc
  * cannot reverse draft
  * reverse posted doc creates proper linkage
  * cannot reverse same doc twice
* Immutability tests:

  * posted docs cannot be mutated except allowed reversal metadata/state transitions
* Tenant/scope tests:

  * cross-tenant/cross-scope post blocked

## Acceptance Criteria

* Draft->Posted works end-to-end and produces GL + open items.
* Posting snapshots are immutable and stored.
* Reversal/cancel boundaries are enforced exactly as ADR.
* FX date-lock/override behavior is permissioned and audited.
* Posting/reversal linkage fields are correctly populated.

---

# PR-07 Settlement + Unapplied Cash Engine

## Scope

Implement settlement apply/reverse, allocation lines, unapplied cash behavior, realized FX posting, and concurrency safety.

## Implementation Tasks

Implement:

* settlement apply endpoint(s)
* settlement reverse endpoint(s)
* `cari_settlement_batches` + `cari_settlement_allocations` persistence
* settlement number assignment on **APPLY** using `SETTLEMENT` namespace
* partial allocations and residual updates
* open-item status transitions:

  * `OPEN -> PARTIAL -> SETTLED`
  * reversal restores prior state correctly
* unapplied cash bucket behavior:

  * store residual unapplied amounts
  * consume unapplied balances in later apply operations
* realized FX logic:

  * compute at settlement time
  * post gains/losses to accounts from `journal_purpose_accounts`
  * populate `cari_settlement_batches.posted_journal_entry_id` if journal created
* reversal linkage:

  * `reversal_of_settlement_batch_id`

Concurrency / idempotency:

* transactional flow
* `FOR UPDATE` locks on targeted open items and unapplied balances
* lock rows in deterministic order (e.g., `id ASC`)
* deterministic auto-allocation (oldest due date first, tie-breakers fixed)
* duplicate-apply protection via idempotency keys
* prevent over-allocation under concurrent requests

## Tests

* Settlement correctness tests:

  * manual full settlement
  * manual partial settlement
  * auto-allocation oldest due first
  * residual amounts update correctly (txn/base)
  * status transitions OPEN/PARTIAL/SETTLED
* Unapplied cash tests:

  * overpayment creates unapplied balance
  * later apply consumes unapplied correctly
* Realized FX tests:

  * settlement on different FX date creates gain/loss posting correctly
  * account source comes from `journal_purpose_accounts`
* Reversal tests:

  * reverse applied settlement creates reversal linkage
  * open-item residuals restored correctly
  * cannot reverse twice
* Concurrency/idempotency tests:

  * same idempotency key duplicate request is safe/no duplicate result
  * simulated double-click/concurrent apply cannot over-allocate
  * locking order avoids deadlock in test scenario (best-effort integration test)

## Acceptance Criteria

* Settlement apply/reverse works for manual and auto allocation.
* Open items and unapplied cash stay mathematically correct under partials.
* Realized FX posting is correct and linked.
* Duplicate apply/concurrency issues are prevented.
* Settlement numbering/linkage fields are correctly populated.

---

# PR-08 Bank-Ready Integration Points

## Scope

Expose stable attach/apply contracts and link fields so future bank import can integrate without schema changes.

## Implementation Tasks

* Add/finish bank-link fields on settlement/unapplied flows (if any were deferred)
* Implement endpoints for:

  * bank attach/link to settlement/unapplied cash
  * bank-initiated apply using same settlement contracts (or wrappers)
* Keep contracts idempotent:

  * idempotency key required/accepted
  * duplicate attach/apply safe handling
* Add audit logs for bank attach/apply actions
* Ensure no dependency on a full bank module exists yet

## Tests

* API tests:

  * attach bank reference to settlement
  * attach bank reference to unapplied cash entry (if supported)
  * bank apply path calls same apply rules and validations
* Idempotency tests:

  * duplicate bank attach/apply request does not duplicate effects
* Audit tests:

  * attach/apply events logged
* Backward compatibility tests:

  * manual settlement flows still work unchanged

## Acceptance Criteria

* Bank-link fields and endpoints exist and are stable.
* Attach/apply operations are idempotent and auditable.
* No schema changes are needed later to connect a bank import job.
* Manual and future bank-driven settlement share the same accounting rules.

---

# PR-09 Reports

## Scope

Deliver AR/AP aging, open-items, and counterparty statement endpoints + UI using snapshot-safe and as-of-date logic.

## Implementation Tasks

Backend endpoints:

* AR aging
* AP aging
* open items
* counterparty statement

Frontend UI:

* report pages/tabs/components
* filters:

  * as-of date
  * legal entity
  * counterparty
  * customer/vendor
  * status
* include settlement and bank-link context in responses/UI

Rules:

* use snapshot-safe fields for historical display
* enforce ADR as-of-date logic
* include txn/base amounts and residual/open balances
* display unapplied balances clearly (not hidden/netted unless ADR says so)

## Tests

* Report correctness tests:

  * as-of date changes output correctly
  * aging buckets classify correctly
  * partially settled docs show correct residuals
  * settled docs excluded/included correctly per report rules
  * unapplied balances appear correctly
  * statement shows settlement links/references and reversals correctly
* Tenant/scope tests:

  * user sees only allowed tenant/legal entity data
* UI smoke tests:

  * filters work
  * totals reconcile with API results
* Query-shape/perf checks:

  * `EXPLAIN` on main report queries
  * confirm key indexes are used (where expected)

## Acceptance Criteria

* AR/AP aging, open-items, and statements are correct as-of a given date.
* Reports use immutable snapshots (historical names/terms don’t drift).
* Residuals, settlements, unapplied balances, and reversals display correctly.
* UI filters and totals work.
* Report queries are indexed and acceptable for v1 scale.

---

# PR-10 Quality Gate + Docs

## Scope

Lock quality with tests, OpenAPI updates, and operational documentation.

## Implementation Tasks

### Test coverage completion

Add/finish automated tests for:

* permission matrix
* tenant safety
* lifecycle/status transitions
* cancel/reverse boundaries
* posting immutability
* snapshot immutability
* settlement apply/reverse
* unapplied cash behavior
* realized FX logic
* idempotency (manual + bank)
* concurrency double-click protection
* report correctness (as-of, buckets, residuals)

### Performance checks

* add query-shape checks (`EXPLAIN`) for report endpoints
* verify index coverage exists for critical report paths
* add lightweight smoke/perf checks (no brittle CI timing thresholds)

### OpenAPI + docs

* update OpenAPI for `/api/v1/cari/*`
* tag routes under `/api/v1/cari`
* add runbook docs:

  * unapplied cash handling
  * FX override policy
  * reversal effect on statements/aging
  * bank-link meaning before full bank module
  * operational troubleshooting (recommended)

## Tests

* Full CI / release-gate run
* OpenAPI generation validation (if scripted)
* Manual smoke:

  * create counterparty
  * create draft doc
  * post doc
  * settle partially
  * reverse settlement/doc
  * run reports
  * verify audit logs

## Acceptance Criteria

* All critical Cari flows are covered by automated tests.
* No high-severity gaps remain in permission, tenant safety, posting, settlement, FX, or reporting.
* OpenAPI is updated and usable by frontend/integrators.
* Runbook explains core operational behavior clearly.
* PR-10 marks Cari v1 as release-ready behind your normal rollout controls.

---

## Optional copy-paste prompt wrapper for each PR (for Codex)

You can prefix each PR prompt with this:

```text
Implement PR-0X exactly as scoped below. 
Requirements:
- Follow existing project patterns (tenant safety, RBAC, audit logs, OpenAPI style, migration style).
- Do not change ADR-frozen rules.
- Include automated tests for this PR’s scope.
- At the end, provide:
  1) files changed
  2) tests added
  3) acceptance checklist result (pass/fail by item)
  4) any follow-up risks (if any)
```

---

If you want, I can also give you the **repo-specific file map per PR** (suggested migration filenames, backend route/service/test files, and frontend page/API files) so your Codex prompts can be even more precise.

[1]: https://chatgpt.com/c/699bf58e-26b0-83a2-aa13-579cbffb521d "Project.zip Analysis and PR Review"



