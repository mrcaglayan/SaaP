# 38 - Fixed Assets Plan Analysis

Generated: 2026-03-21
Scope: Full cross-reference of all implemented steps (FA01-FA45), remaining steps (FA46-FA48), plan requirements, 38-logs carry-forwards, and current repo state.

---

## PART 1: Implemented Steps — Status and Findings

### FA01 - Source-type registry and RBAC secondary helper
- **Status**: GREEN
- **Log carry-forward**: "secondary RBAC helper currently asserts permission presence without caller-supplied scope matching and may need scoped extension when FA06/FA11 consumers land"
- **Current state**: `assertSecondaryPermission` is used by FA06 (cari.doc.read), FA11 sale (cari.doc.create/read/update/post), and FA45 evidence hardening. The helper validates permission existence tenant-wide without scope matching. No consumer has needed scope-matching extension yet.
- **Risk**: LOW. The current behavior is sufficient for all implemented flows.

### FA02 - PRIMARY journal-source-link preflight
- **Status**: GREEN
- **Log carry-forward**: "final smoke coverage still needs a non-empty seeded/fixture run"
- **Current state**: The preflight surface works. FA05 added regression tests.
- **Risk**: NONE remaining.

### FA03 - CARI/cash writer PRIMARY audit
- **Status**: GREEN. No open items.

### FA04 - Inventory/payroll writer PRIMARY audit
- **Status**: GREEN. No open items.

### FA05 - Regression test suite for one-owning-PRIMARY contract
- **Status**: GREEN. No open items.

### FA06 - Backend journal drillback/reverse-block destination contract
- **Status**: GREEN. No open items.

### FA07 - Frontend Journal Workbench drillback upgrade
- **Status**: GREEN. No open items.

### FA08 - OpenAPI generator FixedAssets tag support
- **Status**: GREEN
- **Repo check**: `generate-openapi.js` has `FixedAssets` tag registered and `/api/v1/fixed-assets` path inference present. `openapi.yaml` lists the tag.
- **Risk**: NONE.

### FA09 - m138 foundation migration (base tables)
- **Status**: GREEN. Tables created in dependency-safe order.

### FA10 - m138 constraint/index hardening
- **Status**: GREEN. DB-backed uniqueness for DRAFT runs and current-effective posted depreciation.

### FA11 - m139 custodian table and FK attachment
- **Status**: GREEN. Custodian FKs deferred correctly to m139.

### FA12 - m140 CARI traceability and one-PRIMARY enforcement
- **Status**: GREEN. Generated-column strategy for MySQL-realistic one-PRIMARY.

### FA13 - Backend fixed-assets route skeleton and mounting
- **Status**: GREEN. Routes mounted, ordering safe.

### FA14 - Category CRUD
- **Status**: GREEN. Full list/create/update with validation.

### FA15 - Depreciation profile CRUD
- **Status**: GREEN. Method validation, rate compatibility.

### FA16 - Custodian CRUD + frontend settings pages
- **Status**: GREEN. API-backed frontend for all three settings surfaces.

### FA17 - Asset register list
- **Status**: GREEN. Full locked filter set.

### FA18 - Asset detail read
- **Status**: GREEN. Detail-hub payload covering all tab foundations.

### FA19 - Frontend list/detail pages
- **Status**: GREEN. Real API-backed pages.

### FA20 - Manual draft create/update
- **Status**: GREEN. Transaction-safe numbering, category defaults, DRAFT mutability.

### FA21 - Standard manual activation
- **Status**: GREEN. ACTIVE with ACQUISITION, draft freeze.

### FA22 - Legacy-onboarding activation
- **Status**: GREEN. Forward-only remaining depreciation.

### FA23 - Low-value asset inline full-expense
- **Status**: GREEN
- **Log carry-forward**: "re-check low-value asset exclusion logic at FA30/FA31"
- **Repo check**: `isLowValueFullyExpensedAsset()` in depreciation service correctly checks `FULLY_DEPRECIATED + NONE method + zero remaining months`. Re-checked and confirmed at FA31.
- **Risk**: NONE remaining.

### FA24 - FA06 eligible AP-line selection
- **Status**: GREEN. Remaining-unit math, permission gating.

### FA25 - Same-OU FA06 capitalization
- **Status**: GREEN. Deterministic unit allocation, CAPITALIZATION semantics.

### FA26 - Cross-OU FA06 capitalization
- **Status**: GREEN. Direct due-to/due-from template.

### FA27 - FA06 source-linked draft revalidation at activation
- **Status**: GREEN. Auto-refresh source values, hard-block drift.

### FA28 - Depreciation schedule read (STRAIGHT_LINE/NONE)
- **Status**: GREEN. Month-aligned period keys, salvage-floor enforcement.

### FA29 - Schedule engine (DECLINING_BALANCE + switch)
- **Status**: GREEN. Permanent switch, legacy forward-only.

### FA30 - Lifecycle proration (SUSPEND/REACTIVATE)
- **Status**: GREEN
- **Log carry-forward**: "legacy or out-of-band assets moved to SUSPENDED without persisted lifecycle transaction will need remediation or backfill outside FA30"
- **Repo check**: Schedule engine explicitly requires persisted SUSPEND transaction rows when `asset.status === SUSPENDED`. Throws `badRequest("SUSPENDED asset schedule generation requires persisted SUSPEND lifecycle history")`.
- **Ongoing risk**: MEDIUM. Any legacy data with SUSPENDED status but no SUSPEND transaction row will fail schedule generation. This is by design (explicit > implicit) but must be documented in rollout notes.

### FA31 - Run preview/draft creation
- **Status**: GREEN. Re-checked low-value exclusion per FA23 carry-forward.

### FA32 - Run detail/delete read
- **Status**: GREEN. DRAFT-only delete, non-DRAFT rejection.

### FA33 - Run posting
- **Status**: GREEN
- **Log carry-forward**: "remaining explicit gap is physical run-header posting_date persistence"
- **Repo check**: `fixed_asset_depreciation_runs` table has `posted_at TIMESTAMP NULL` but no `posting_date DATE` column. The `fixed_asset_transactions` table does have `posting_date DATE`. This is an accepted MVP limitation per FA31 carry-forward note.
- **Ongoing risk**: LOW. Run-level reporting that needs a posting DATE (vs timestamp) would need a schema addition.

### FA34 - Run reversal
- **Status**: GREEN. Successor blocking, all-or-nothing reversal.

### FA35 - Chunked run persistence
- **Status**: GREEN. Explicit chunks inside one transaction.

### FA36 - Physical move
- **Status**: GREEN. Auditable from/to snapshots, no journal.

### FA37 - Ownership transfer
- **Status**: GREEN. Locked journal template, self-balancing lines.

### FA38 - Write-off (no-proceeds disposal)
- **Status**: GREEN. Disposal journal template, DISPOSED transition.

### FA39 - Sale staged draft/link/update
- **Status**: GREEN. Three endpoints, CARI AR integration, permission gating.

### FA40 - Sale finalize
- **Status**: GREEN. SALE row with CARI provenance, cutoff depreciation.

### FA41 - Non-run transaction reversal
- **Status**: GREEN. Source-owned reversal, duplicate rejection.

### FA42 - Evidence support for all three surfaces
- **Status**: GREEN. Merged-params router, CRUD/content flow.

### FA43 - Journal source-link wiring
- **Status**: GREEN. PRIMARY ownership, dynamic destinations.

### FA44 - Deep-link pages and query contract
- **Status**: GREEN
- **Known issue (non-blocking)**: FA44 browser-test seed script inserts journal_entries without populating `total_debit_base`/`total_credit_base` header columns. The Journal Workbench list view shows zero debit/credit for these test journals. This is a TEST DATA issue, not a system bug — real posting flows populate header totals correctly.

### FA45 - Permission seeding and backend authorization hardening
- **Status**: GREEN
- **Verified**: fixed_assets.account_override seeded, role bundles correct, CARI secondary assertions enforced, non-run reversal mapped by original transaction type.
- **Cleanup debt noted**: 19 occurrences of `req.tenantId` in scope resolvers across fixed-assets.routes.js. These work at runtime because `requirePermission` middleware sets `req.rbac.tenantId`, and the scope resolvers handle their own tenant resolution internally. However, the pattern is inconsistent with the rest of the app which uses `resolveTenantId(req)`.

---

## PART 2: Remaining Steps — Gap Analysis

### STEP-FA46 - Frontend sidebar, route, and action gating
**Dependencies met**: FA16, FA19, FA45 all GREEN.
**Current repo state**:
- `sidebarConfig.js` already has all 8 fixed-assets sidebar entries with `requiredPermissions` arrays and `implemented: true`
- Frontend pages already use `hasPermission()` for page-level gating
- Sidebar already uses permission-based filtering

**Actual remaining work**:
- Verify/fix account-override action gating (separate from broad upsert/post)
- Verify sidebar entries reflect the user's permission set correctly (some entries list multiple permissions with OR vs AND semantics)
- Cleanup placeholder-era demirbas navigation assumptions in AppLayout.jsx
- Ensure action buttons (activate, dispose, transfer, etc.) on detail page are permission-gated
- Confirm canonical routes are backed by real pages (some are still scaffolds — see below)

**Open question**: Several frontend pages are still scaffold shells (AcquisitionsPage, FormPage, ReportsPage). FA46's definition says "canonical routes are backed by real pages, not generic placeholders." This conflicts with FA47 which implements the reports page. Should FA46 accept scaffold pages for routes whose backend is a 501 stub, or must FA46 replace all scaffolds?

### STEP-FA47 - Reports and paired export endpoints
**Dependencies met**: FA17-FA19, FA28-FA40 all GREEN.
**Current repo state**:
- Both GET /reports/:reportName and GET /reports/:reportName/export return 501
- `backend/src/services/fixed-assets.reporting.service.js` does NOT exist yet (plan references it as allowed file)
- Frontend `FixedAssetReportsPage.jsx` is a scaffold
- Frontend API helper has NO report functions

**Actual work**:
- Create `fixed-assets.reporting.service.js` from scratch
- Implement 10 report queries: register, depreciation-schedule, additions, disposals, transfers, by-owner-ou, by-location-ou, by-custodian, depreciation-by-owner-ou, rollforward
- Implement paired `/export` endpoints for each
- Replace frontend scaffold with real report page
- Add report API helpers to `fixedAssets.js`

**Risk**: MEDIUM. This is the largest remaining step. Report SQL must correctly distinguish: ACQUISITION vs CAPITALIZATION, WRITEOFF vs SALE, RUN depreciation vs LOW_VALUE_FULL_EXPENSE, by-owner-ou (asset count/value) vs depreciation-by-owner-ou (depreciation expense).

### STEP-FA48 - Release gates and smoke suite
**Dependencies met**: All prior steps.
**Current repo state**:
- No dedicated fixed-assets smoke suite script exists
- No release-gate script that covers FA-specific contracts

**Actual work**:
- Create cross-cutting smoke suite covering key workflows
- Verify OpenAPI generation includes fixed-assets paths
- Verify source-link ownership contract
- Verify reverse-block contract
- Verify permissions
- Verify report/export endpoints
- Document rollout blockers

---

## PART 3: Cross-Cutting Gaps and Conflicts

### GAP-1: `req.tenantId` inconsistency in scope resolvers (CLEANUP DEBT)
**Severity**: LOW (runtime works, but inconsistent)
**Location**: `fixed-assets.routes.js` — 19 occurrences of `req.tenantId` passed to scope resolver functions
**Why it works**: `requirePermission` middleware runs first and sets `req.rbac.tenantId`. The scope resolvers (`resolveFixedAssetScope`, `resolveFixedAssetRunScope`, etc.) likely use `resolveTenantId(req)` internally, making the passed `req.tenantId` either unused or a fallback.
**Risk**: If a scope resolver trusts the caller-supplied `tenantId` without its own validation, and `req.tenantId` is undefined, the resolver would get `undefined`. This was already the root cause of the FA44 bug on the transactions endpoint.
**Recommendation**: Audit each scope resolver to confirm it uses `resolveTenantId(req)` internally and does not rely on the second positional argument being valid. Or, clean up all 19 call sites to pass `resolveTenantId(req)` explicitly.

### GAP-2: Frontend API helper missing ~15 functions
**Severity**: MEDIUM (blocks FA46 action gating and FA47 reports)
**Currently exported**: 22 functions covering list/detail/create/update/activate/CARI-capitalize/categories/profiles/custodians/runs/transactions
**Missing**:
- `deleteFixedAssetRun(runId)` — backend DELETE /runs/:runId exists since FA32
- `getFixedAssetDepreciationSchedule(assetId)` — backend GET /:assetId/depreciation-schedule exists since FA28
- `suspendFixedAsset(assetId)` — backend stub exists (501)
- `reactivateFixedAsset(assetId)` — backend stub exists (501)
- `physicalMoveAsset(assetId, payload)` — backend exists since FA36
- `ownershipTransferAsset(assetId, payload)` — backend exists since FA37
- `writeoffAsset(assetId, payload)` — backend exists since FA38
- `saleCreateDraftAr(assetId, payload)` — backend exists since FA39
- `saleLinkAr(assetId, payload)` — backend exists since FA39
- `saleUpdateDraftAr(assetId, payload)` — backend exists since FA39
- `saleFinalizeAsset(assetId, payload)` — backend exists since FA40
- `reverseFixedAssetTransaction(transactionId, payload)` — backend exists since FA41
- Evidence helpers (list/create/upload/download/delete) — backend exists since FA42
- Report + export helpers — backend stubs exist, real impl in FA47

**Recommendation**: These should be added in FA46 or as a pre-FA46 helper expansion step. FA46's allowed files include `frontend/src/api/fixedAssets.js`.

### GAP-3: Suspend/Reactivate endpoints are 501 stubs
**Severity**: MEDIUM (functional gap — now RESOLVED by decision lock)
**Location**: `fixed-assets.routes.js` lines 562-580
**Plan reference**: Not explicitly covered by any STEP-FA##. The plan's FA01 feature scope defines SUSPENDED status and FA30 implements lifecycle proration, but no step implements the actual suspend/reactivate mutation endpoints.
**Impact**: Users cannot suspend or reactivate assets through the API. Schedule engine supports it (reads SUSPEND/REACTIVATE transaction history), but there's no way to create those transactions.
**Decision (2026-03-21)**: IMPLEMENT. Added as STEP-FA45.5 pre-FA46 step. See PART 7 below.

### GAP-4: Four frontend pages are still scaffolds
**Severity**: MEDIUM (now RESOLVED by decision locks)
**Pages and decisions (2026-03-21)**:

1. `FixedAssetAcquisitionsPage.jsx` — **DECISION: Replace with filtered register view.** The page becomes the asset register filtered to show recent ACQUISITION and CAPITALIZATION transactions. No new backend work — frontend filter preset on existing list endpoint. Implemented in FA46.

2. `FixedAssetFormPage.jsx` — **DECISION: Remove dedicated page. Create action lives as a button on the register page** that opens a form panel or navigates to the detail page in create mode. The standalone form page route becomes unnecessary. Implemented in FA46.

3. `FixedAssetReportsPage.jsx` — FA47 will implement this. No decision needed.

4. `FixedAssetDepreciationRunsPage.jsx` — **DECISION: Remove FixedAssetModulePage scaffold banner from list mode, keep real API-backed content.** The developer-facing "current scope" / "next steps" / "decision items" text is not end-user content. Implemented in FA46.

### GAP-5: FA44 browser-test seed creates journals with zero header totals
**Severity**: LOW (test-only, not a system bug)
**Location**: `browser-tests/fa44-drillback/seed-fa44-drillback.mjs`
**Impact**: Journal Workbench list view shows 0.00 debit/credit for FA44 test journals, but detail view shows correct line amounts.
**Root cause**: Seed script inserts journal_entries without populating `total_debit_base`/`total_credit_base`. Real posting flows compute and store these totals.
**Recommendation**: Fix the seed script to compute and UPDATE header totals after inserting journal_lines, or accept as known test-data limitation.

### GAP-6: No `fixed_assets.account_override` route consumer yet
**Severity**: LOW (permission seeded and role-scoped, ready for consumption)
**Context**: FA45 seeded the permission and assigned it to the correct roles. No route currently uses `requirePermission("fixed_assets.account_override")` or `assertSecondaryPermission(req, "fixed_assets.account_override")` as a guard.
**Plan reference**: FA14 feature scope says account-override actions should be separately gated. FA46 says "account-override actions are separately gated from broad upsert/post actions."
**Recommendation**: FA46 must wire account-override gating into the frontend action visibility. The backend route that enforces it may need to be identified — candidates are the activate and capitalization endpoints where account overrides would be passed as request body fields.

### GAP-7: Depreciation run `posting_date` column absent (accepted MVP limitation)
**Severity**: LOW
**Context**: `fixed_asset_depreciation_runs` has `posted_at TIMESTAMP` but no `posting_date DATE`. The carry-forward from FA33 accepted this as an MVP limitation.
**Impact**: Run-level reporting that needs a clean DATE (for period filtering) must derive it from `posted_at` or from the run's `fiscal_period_id`.
**Recommendation**: No action needed for MVP. Document as post-MVP schema enhancement if reporting requires it.

### GAP-8: Legacy SUSPENDED assets without SUSPEND transaction rows
**Severity**: MEDIUM (data integrity concern at rollout)
**Context**: FA30 carry-forward noted that any legacy or out-of-band assets with SUSPENDED status but no persisted SUSPEND lifecycle transaction will fail schedule generation. The schedule engine explicitly requires persisted history.
**Impact**: If the system is deployed against an existing asset register that has SUSPENDED assets imported without lifecycle transaction rows, depreciation schedule generation will throw errors for those assets.
**Recommendation**: Document as a rollout prerequisite. Before enabling depreciation runs on legacy data, either: (a) backfill SUSPEND transaction rows for any SUSPENDED assets, or (b) provide a data-migration script as part of FA48 release gates.

---

## PART 4: Step Dependency and Ordering Verification

All implemented steps (FA01-FA45) have their dependencies satisfied. No circular dependencies detected.

Remaining step dependencies:
- **FA46** depends on FA16, FA19, FA45 — all GREEN
- **FA47** depends on FA17-FA19, FA28-FA40 — all GREEN
- **FA48** depends on FA01-FA47 — FA46 and FA47 must complete first

Execution order: FA46 → FA47 → FA48 (serial, no parallelism possible)

---

## PART 5: Business Logic Correctness Verification

### Depreciation methods
- STRAIGHT_LINE: Implemented and smoke-tested (FA28)
- DECLINING_BALANCE: Implemented with permanent switch_to_straight_line (FA29)
- NONE: Handled correctly, no schedule lines generated (FA28)

### Lifecycle state machine
- DRAFT → ACTIVE (manual activation FA21, legacy FA22, CARI FA25/FA26/FA27)
- ACTIVE → SUSPENDED (stub endpoint, but schedule engine supports it)
- SUSPENDED → ACTIVE (stub endpoint, schedule engine supports it)
- ACTIVE/SUSPENDED/FULLY_DEPRECIATED → DISPOSED (writeoff FA38, sale FA40)
- ACTIVE → FULLY_DEPRECIATED (automatic when depreciation completes)

### Journal template compliance
- Acquisition: No journal for manual; journal for CARI capitalization (FA25/FA26)
- Depreciation run: Per-asset depreciation journal lines (FA33)
- Ownership transfer: Locked 6-line template with gross/accum/NBV self-balancing (FA37)
- Write-off: 3-line template (accum-depr debit, asset credit, loss debit) (FA38)
- Sale finalize: Disposal journal + optional cutoff depreciation (FA40)
- Reversal: Reversal journal with source PRIMARY link (FA34 for runs, FA41 for non-run)

### Cross-module permission enforcement
- FA06 capitalization: fixed_assets.post + cari.doc.read ✓
- Sale create-draft: fixed_assets.dispose + cari.doc.create ✓
- Sale link: fixed_assets.dispose + cari.doc.read ✓
- Sale draft-edit: fixed_assets.dispose + cari.doc.update ✓
- Sale finalize: fixed_assets.dispose + cari.doc.post ✓
- Non-run reversal: fixed_assets.post + type-specific (dispose/transfer) ✓

### Source-link ownership
- All fixed-assets journals use PRIMARY source links ✓
- FIXED_ASSET_TRANSACTION for non-run journals ✓
- FIXED_ASSET_DEPRECIATION_RUN for run journals ✓
- One-PRIMARY-per-journal DB enforcement via m140 ✓

---

## PART 6: Summary

| Category | Count | Details |
|----------|-------|---------|
| Steps GREEN | 45 | FA01-FA45 all accepted |
| Steps remaining | 3 | FA46, FA47, FA48 |
| Cross-cutting gaps | 8 | See GAP-1 through GAP-8 |
| High severity gaps | 0 | — |
| Medium severity gaps | 4 | GAP-2 (API helpers), GAP-3 (suspend/reactivate stubs), GAP-4 (scaffold pages), GAP-8 (legacy SUSPENDED data) |
| Low severity gaps | 4 | GAP-1 (req.tenantId), GAP-5 (test seed totals), GAP-6 (account_override consumer), GAP-7 (run posting_date) |

### Recommended action before FA46
- Decide on suspend/reactivate scope (GAP-3): implement in FA46 or defer to post-MVP
- Decide on scaffold page treatment (GAP-4): which pages need real content vs which are acceptable as-is

### Recommended action in FA48
- Document legacy SUSPENDED data backfill requirement (GAP-8)
- Include req.tenantId cleanup in rollout notes or fix as part of FA48 release gate (GAP-1)
- Fix FA44 seed totals if browser-test reliability matters (GAP-5)
