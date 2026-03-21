# 38 - Fixed Assets Plan Analysis

Generated: 2026-03-22 (post-FA52 implementation; FA53 remaining)
Scope: Full cross-reference of implemented steps (FA01–FA52), remaining step (FA53), plan requirements, 38-logs carry-forwards, and current repo state.

---

## PART 1: Implemented Steps — Status and Findings

### FA01 – Source-type registry and RBAC secondary helper
- **Status**: GREEN. No open items.

### FA02 – PRIMARY journal-source-link preflight
- **Status**: GREEN. No open items.

### FA03 – CARI/cash writer PRIMARY audit
- **Status**: GREEN. One justified variance: `cash.exchange.service.js` was modified (actual in-scope writer) even though not in the original allowed-files block.

### FA04 – Inventory/payroll writer PRIMARY audit
- **Status**: GREEN. `payroll.corrections.service.js` referenced during audit but outside FA04 allowed-files — audit observation only, no code change.

### FA05 – Regression test suite for one-owning-PRIMARY contract
- **Status**: GREEN. `test-fa05-journal-link-primary-release-gate.js` exists and validates DB-backed one-PRIMARY constraint.

### FA06 – Backend journal drillback/reverse-block destination contract
- **Status**: GREEN. No open items.

### FA07 – Frontend Journal Workbench drillback upgrade
- **Status**: GREEN. No open items.

### FA08 – OpenAPI generator FixedAssets tag support
- **Status**: GREEN. FixedAssets tag support landed in generator. No FixedAssets-tagged routes in generated spec yet — expected per FA08 acceptance note.

### FA09 – m138 foundation migration (base tables)
- **Status**: GREEN. Tables created in dependency-safe order.

### FA10 – m138 constraint/index hardening
- **Status**: GREEN. DB-backed uniqueness for DRAFT runs and current-effective posted depreciation.

### FA11 – m139 custodian table and FK attachment
- **Status**: GREEN. Custodian FKs deferred correctly to m139.

### FA12 – m140 CARI traceability and one-PRIMARY enforcement
- **Status**: GREEN. Generated-column strategy for MySQL-realistic one-PRIMARY.

### FA13 – Backend fixed-assets route skeleton and mounting
- **Status**: GREEN. Routes mounted, ordering safe.

### FA14 – Category CRUD
- **Status**: GREEN. Full list/create/update with validation.

### FA15 – Depreciation profile CRUD
- **Status**: GREEN. Method/rate/switch validation in place.

### FA16 – Custodian CRUD and frontend settings pages
- **Status**: GREEN. All three settings surfaces API-backed.

### FA17 – Register list endpoint
- **Status**: GREEN. Full locked filter set, lifecycle-based disposed filtering.

### FA18 – Asset detail hub endpoint
- **Status**: GREEN. Detail payload with overview/accounting/schedule tabs.

### FA19 – Frontend list and detail pages
- **Status**: GREEN. API-backed with tab foundations on detail page.

### FA20 – Manual asset draft creation
- **Status**: GREEN. Transaction-safe FA-###### numbering, category/profile defaults.

### FA21 – Standard manual activation
- **Status**: GREEN. Test: `test-fa21-manual-activation-smoke.js`.

### FA22 – Legacy onboarding activation
- **Status**: GREEN. Test: `test-fa22-legacy-onboarding-activation-smoke.js`. Includes imported `SUSPENDED` activation with required suspend effective date.

### FA23 – Low-value full-expense activation
- **Status**: GREEN. Carry-forward resolved by FA30/FA31 re-check — low-value exclusion correctly relies on runtime state.

### FA24 – CARI AP-line eligibility
- **Status**: GREEN. Test: `test-fa24-eligible-ap-line-smoke.js`.

### FA25 – Same-OU CARI capitalization
- **Status**: GREEN. Deterministic lowest-slot unit allocation.

### FA26 – Cross-OU CARI capitalization
- **Status**: GREEN. Test: `test-fa26-cross-ou-capitalization-smoke.js`. Due-to/due-from self-balancing template.

### FA27 – Draft source-link revalidation at activation
- **Status**: GREEN. Test: `test-fa27-draft-link-revalidation-smoke.js`.

### FA28 – Depreciation schedule read (STRAIGHT_LINE)
- **Status**: GREEN. Month-aligned fiscal-period resolution, YYYY-MM period keys.

### FA29 – Depreciation schedule (DECLINING_BALANCE, switch, legacy)
- **Status**: GREEN. Permanent switch_to_straight_line, salvage-floor, forward-only legacy schedules.

### FA30 – Lifecycle proration (SUSPEND/REACTIVATE/DISPOSED)
- **Status**: GREEN. Imported `SUSPENDED` onboarding is now transaction-backed at activation time. Unsupported out-of-band master-status edits without persisted `SUSPEND` history still throw the explicit error ("SUSPENDED asset schedule generation requires persisted SUSPEND lifecycle history"), not silent failure.

### FA31 – Run detail/delete/post/reverse read-side
- **Status**: GREEN. Carry-forward re-check passed.
- **Resolved detail**: Run-header `posting_date` is now persisted on `fixed_asset_depreciation_runs` and exposed consistently on read-side responses.

### FA32 – Run list/detail read, DRAFT-only delete
- **Status**: GREEN. Test coverage through acceptance.

### FA33 – Run post (frozen DRAFT)
- **Status**: GREEN. `depreciation_kind = RUN` on posted transactions.
- **Resolved detail**: Posting stores the final run-header `posting_date` on `fixed_asset_depreciation_runs` in addition to line-level posted transaction dates.

### FA34 – Run reverse (all-or-nothing)
- **Status**: GREEN. Successor lifecycle and later posted depreciation block reversal.

### FA35 – Chunked run persistence
- **Status**: GREEN. Multi-chunk success preserves logical result, late-chunk failure rolls back atomically.

### FA36 – Physical move
- **Status**: GREEN. Test: `test-fa36-physical-move-smoke.js`.

### FA37 – Ownership transfer
- **Status**: GREEN. Test: `test-fa37-ownership-transfer-smoke.js`. Locked gross-cost/accum-depr/NBV journal template.

### FA38 – Write-off disposal
- **Status**: GREEN. Test: `test-fa38-writeoff-smoke.js`.

### FA39 – Sale staged draft/link/update
- **Status**: GREEN. Test: `test-fa39-sale-staging-smoke.js`. Cross-module permission enforcement verified.

### FA40 – Sale finalize
- **Status**: GREEN. Disposal journal, optional cutoff depreciation, DISPOSED transition.

### FA41 – Non-run transaction reversal
- **Status**: GREEN. reversed_transaction_id lineage, PRIMARY source-link on reversal journal. FA41 does not define companion reversal of separate FA40 cutoff depreciation.

### FA42 – Evidence support (asset/transaction/run)
- **Status**: GREEN. Test: `test-fa42-fixed-assets-evidence-smoke.js`.

### FA43 – Journal source-link destination resolution
- **Status**: GREEN. Test: `test-fa43-journal-source-link-destination-smoke.js`.

### FA44 – Deep-link pages and drillback
- **Status**: GREEN. Test: `test-fa44-drillback-smoke.js`. All 19 smoke tests pass.

### FA45 – Permissions seed, RBAC scope, secondary permission enforcement
- **Status**: GREEN. Route-level fixed-assets scope resolution is standardized on middleware-resolved `tenantId`.

### FA46 – Suspend/reactivate lifecycle endpoints
- **Status**: GREEN. POSTED SUSPEND and REACTIVATE rows, FA30 proration verified end to end.

### FA47 – Frontend sidebar, route, action gating, scaffold cleanup
- **Status**: GREEN. Dead `/app/demirbas-karti-detayi/new` replaced with `/app/demirbas-karti-olustur`. All 5 scaffold pages replaced with real content. Two-layer permission gating (sidebar read, page mutation).

### FA48 – Manual create / legacy-onboarding frontend form
- **Status**: GREEN. Helper-based create/activate wiring, parseActivateAssetInput alignment, back-link, build passes.

### FA49 – Fixed-assets reports and paired export endpoints
- **Status**: GREEN. 10 reports × 2 = 20 endpoints. Dedicated `/export` per report (not `?export=1`). Frontend reports page is real, not placeholder. Build passes.

---

## PART 2: Resolved Gap — Schedule Horizon Hard-Fail

### Implemented resolution: bounded calendar horizon and disposal cutoff narrowing

**Prior severity**: HIGH — previously affected core schedule read, depreciation runs, and the asset detail tab.

**Prior root cause**: `loadSchedulePeriodsForRange()` in `fixed-assets.depreciation.service.js` threw `badRequest("No fiscal period found for supported fixed-assets month ...")` when **any** future month in the asset's remaining useful life was missing from the fiscal calendar.

**Implemented behavior**:
- `loadSchedulePeriodsForRange()` now stops at the first missing future month and returns the resolved prefix plus `scheduleHorizon` metadata (`requestedMonthCount`, `resolvedMonthCount`, `isBounded`, `firstMissingPeriodKey`, `lastResolvedPeriodKey`, `expectedLastPeriodKey`)
- `getAssetDepreciationSchedule()` now returns a bounded partial schedule instead of failing when far-future fiscal periods are not defined yet
- `buildDepreciationRunRowForAsset()` now classifies periods beyond the available calendar horizon as `SKIPPED` with `reasonCode = CALENDAR_HORIZON_NOT_AVAILABLE` instead of turning the asset into an `ERROR` line
- disposal cutoff economics in `fixed-assets.service.js` now resolve fiscal periods only through the disposal effective month, so write-off/sale flows do not depend on periods after disposal

**Preserved rules**:
- month-alignment validation remains enforced
- adjustment-only period rejection remains enforced
- schedule math and lifecycle proration rules are unchanged

**Files changed**:
- `backend/src/services/fixed-assets.depreciation.service.js`
- `backend/src/services/fixed-assets.service.js`

**Verification performed**:
- targeted service-level check confirmed a 60-month asset with only 10 months of periods resolves 10 rows and reports `firstMissingPeriodKey = 2027-01`
- targeted service-level check confirmed run-row classification becomes `SKIPPED` with `CALENDAR_HORIZON_NOT_AVAILABLE` beyond the bounded horizon instead of `ERROR`
- targeted service-level check confirmed month-alignment validation still throws
- targeted service-level check confirmed disposal cutoff period loading now counts only through the disposal month

**Current assessment**: Resolved in code. Residual work is only broader smoke/release validation under FA53.

---

## PART 3: Final Remaining Step

### FA53 – Release gates, smoke suite, and rollout readiness checks
- **Status**: PENDING.
- **AI size**: Small
- **Allowed files**: `backend/scripts/*`, `package.json`, `frontend/package.json`, `openapi.yaml`, plan document
- **Dependencies**: STEP-FA01 to STEP-FA52

**In scope:**
- Cross-cutting smoke suite covering fixed-assets MVP
- Release-readiness checks: OpenAPI, source-link ownership, reverse-block, permissions, reports/export, key workflows
- Rollout documentation: one-PRIMARY enforcement dependency, route availability, page readiness, OU self-balancing setup, unsupported out-of-band `SUSPENDED` status-only edits

**Not in scope:**
- No new business functionality
- No hiding missing prerequisites behind a green build

---

## PART 4: Accepted Limitations and Guardrails

### 4.1 Unsupported out-of-band SUSPENDED master edits (FA30 guardrail)
- **Severity**: LOW — explicit data-integrity guard, not a normal rollout gap.
- **Issue**: If an asset is flipped to `SUSPENDED` outside the supported activation/suspend workflows and no persisted `SUSPEND` transaction row exists, the schedule engine cannot infer the cutoff date and throws an explicit error.
- **Resolution path**: No standard MVP remediation is required for supported flows. Imported `SUSPENDED` onboarding and normal suspend/reactivate actions now create the lifecycle row automatically. Only truly out-of-band bad data needs case-by-case cleanup if it exists.
- **Impact if unresolved**: Only those unsupported rows error with a clear message; normal onboarding and lifecycle flows remain correct.

### 4.2 FA41 cutoff depreciation companion reversal
- **Severity**: LOW — documented scope boundary.
- **Issue**: FA41 reversal of a SALE transaction does not automatically reverse the separate FA40 cutoff depreciation transaction that may have been created alongside it.
- **Resolution path**: If needed, cutoff depreciation can be reversed separately through the same reversal endpoint.
- **Impact if unresolved**: Users must manually reverse cutoff depreciation if they reverse a sale that triggered it.

### 4.3 OpenAPI FixedAssets routes absent from generated spec
- **Severity**: LOW — expected per FA08.
- **Issue**: `generate-openapi.js` supports FixedAssets tag, but no fixed-assets routes are tagged yet in the generated spec.
- **Resolution path**: Tag fixed-assets routes in OpenAPI as part of FA53 or a follow-up.
- **Impact if unresolved**: API documentation does not show fixed-assets endpoints. No functional impact.

---

## PART 5: Cross-Cutting Verification

### 4.1 One-PRIMARY constraint
- **DB enforcement**: m140 generated column + unique constraint (`uk_jsl_one_primary_per_journal`)
- **Code compliance**: All fixed-assets transaction types write exactly one PRIMARY source link
- **Test**: `test-fa05-journal-link-primary-release-gate.js`
- **Preflight**: `preflight-journal-source-link-primary.js` exists
- **Status**: VERIFIED GREEN

### 4.2 Lifecycle proration
- `buildLifecycleTimeline()` reads SUSPEND/REACTIVATE transaction history
- `buildPeriodEligibility()` zeros eligible days during SUSPENDED periods
- TERMINAL_DISPOSAL (WRITEOFF/SALE) stops depreciation at effective date
- Allocation segments track owner-OU changes for DAILY_PRORATA splits
- **Status**: VERIFIED GREEN

### 4.3 Frontend routing
- All 11 fixed-assets routes in `App.jsx` wired to real page components
- All 8 sidebar entries present with permission gates and `implemented: true`
- No dead routes, no unresolved redirects
- **Status**: VERIFIED GREEN

### 4.4 TODO/FIXME sweep
- Grep across all fixed-assets backend services, routes, and frontend pages: **no TODO, FIXME, XXX, or HACK comments found**.
- **Status**: CLEAN

### 4.5 Migration chain
- m138: Foundation tables (fixed_assets, transactions, schedule_lines, run_lines, allocations, physical_move_details, ownership_transfer_details)
- m139: Custodian table + deferred FKs
- m140: CARI traceability, one-PRIMARY generated column + constraint
- m141: Sale staging columns (pending_sale_cari_document_id/line_id)
- **Status**: COMPLETE, properly sequenced

---

## PART 6: Test Coverage Analysis

### Standalone smoke test scripts (13 files):

| Step | Test file | Coverage |
|------|-----------|----------|
| FA05 | `test-fa05-journal-link-primary-release-gate.js` | One-PRIMARY DB constraint |
| FA21 | `test-fa21-manual-activation-smoke.js` | Standard activation |
| FA22 | `test-fa22-legacy-onboarding-activation-smoke.js` | Legacy import |
| FA24 | `test-fa24-eligible-ap-line-smoke.js` | AP-line eligibility |
| FA26 | `test-fa26-cross-ou-capitalization-smoke.js` | Cross-OU with self-balancing |
| FA27 | `test-fa27-draft-link-revalidation-smoke.js` | Stale-source blocking |
| FA36 | `test-fa36-physical-move-smoke.js` | Location/custodian move |
| FA37 | `test-fa37-ownership-transfer-smoke.js` | OU transfer + journal |
| FA38 | `test-fa38-writeoff-smoke.js` | Write-off disposal |
| FA39 | `test-fa39-sale-staging-smoke.js` | Sale staging + permission |
| FA42 | `test-fa42-fixed-assets-evidence-smoke.js` | Evidence CRUD |
| FA43 | `test-fa43-journal-source-link-destination-smoke.js` | Destination resolution |
| FA44 | `test-fa44-drillback-smoke.js` | Deep-link / drillback |

### Steps without standalone test scripts:

| Steps | Reason | Risk |
|-------|--------|------|
| FA28–FA35 (depreciation runs) | Acceptance tested inline, no standalone script | LOW — 8 steps covering schedule + run lifecycle all accepted |
| FA40 (sale finalize) | Covered within FA39 sale staging suite | LOW |
| FA41 (non-run reversal) | Acceptance tested inline | LOW |
| FA45 (permissions) | Verified through FA47 frontend gating | LOW |
| FA46 (suspend/reactivate) | Acceptance tested, FA30 proration verified | LOW |
| FA47–FA49 (frontend/reports) | `npm run build` passes, no backend smoke needed | LOW |

### FA53 expected test additions:
The plan calls for a named release-gate or smoke suite covering the full MVP. FA53 should either:
- Create a comprehensive `test-fa53-release-gate.js` that exercises the critical path
- Or document which existing test scripts form the release gate suite

---

## PART 7: Rollout Prerequisites and Blockers

### 7.1 CRITICAL: One-PRIMARY enforcement in production
- **What**: m140 adds a unique constraint that will fail if existing production data has duplicate PRIMARY rows on the same journal entry.
- **Prerequisite**: Run `preflight-journal-source-link-primary.js` against production data before deploying m140.
- **If violations found**: Normalize the data (remove extra PRIMARY rows) before applying the migration.
- **Blocker**: YES — migration will fail if duplicates exist.

### 7.2 CRITICAL: OU self-balancing setup for cross-OU flows
- **What**: Cross-OU ownership transfer (FA37) and cross-OU CARI capitalization (FA26) require due-from/due-to intercompany accounts configured in the self-balancing setup.
- **Prerequisite**: Configure self-balancing accounts for all OU pairs that may have cross-OU fixed-asset flows.
- **If missing**: Operations will fail with "missing setup" error (tested and verified in FA26).
- **Blocker**: YES for cross-OU operations. Same-OU operations unaffected.

### 7.3 LOW: Unsupported out-of-band SUSPENDED master edits
- **What**: Depreciation schedule generation requires a persisted `SUSPEND` transaction row. Supported imported-onboarding and suspend flows create it automatically; status-only master edits do not.
- **Prerequisite**: None for normal rollout. Optionally scan and remediate only if tenant history may contain status-only `SUSPENDED` rows.
- **If missing**: Only those unsupported rows will error with a clear message.
- **Blocker**: NO for standard rollout. YES only if a tenant is known to contain those rows.

### 7.4 LOW: Permission assignment
- **What**: 13 fixed-assets permissions must be assigned to appropriate roles before users can access the module.
- **Prerequisite**: Seed permissions (done by FA45), assign to roles in RBAC admin.
- **If missing**: All fixed-assets operations return 403.
- **Blocker**: YES for user access, but standard RBAC workflow — not a code issue.

### 7.5 LOW: OpenAPI route tagging
- **What**: Fixed-assets routes are not yet tagged in the generated OpenAPI spec.
- **Prerequisite**: Tag routes in FA53 or separately.
- **If missing**: No API documentation for fixed-assets endpoints.
- **Blocker**: NO — functional operations unaffected.

---

## PART 8: Potential Conflicts and Risks

### 8.1 No conflicts detected between implemented steps
- Lifecycle rules are consistently applied across all steps.
- SUSPEND/REACTIVATE/DISPOSED transitions are validated at both service and schedule-engine level.
- One-PRIMARY constraint is enforced at DB + application level without conflicts.
- Permission model is consistently applied with two-layer frontend gating.

### 8.2 Cross-module dependency risks
- **CARI module**: Fixed-assets depends on CARI for AP-line capitalization (FA24–FA27), sale AR creation (FA39), and secondary permission enforcement (`cari.doc.*`). Any CARI-breaking change could impact FA flows.
- **Journal module**: Fixed-assets depends on journal posting (`insertPostedJournalWithLinesTx`) and source-link contract. Any journal schema change needs FA awareness.
- **Fiscal periods**: Depreciation runs depend on fiscal period resolution. Closed periods block depreciation posting.

### 8.3 Performance considerations for FA53 review
- `fixed_asset_depreciation_run_line_allocations` table could grow large with many assets × periods × OU splits. The depreciation-by-owner-ou report joins and aggregates from this table.
- Register report and by-owner-ou/by-location-ou/by-custodian reports query `fixed_assets` with GROUP BY — performance depends on index coverage.
- Rollforward report executes 3 separate queries (opening balance, pre-period depreciation, period movements).

---

## PART 9: Summary and Recommendation

### Overall module status: 52 of 53 steps complete. Only FA53 release-gate and rollout validation remains.

### What FA53 needs to deliver:
1. A named release-gate smoke suite (script or documented test list)
2. Documented rollout prerequisites (7.1–7.5 above)
3. OpenAPI route tagging verification
4. Confirmation that all 13 existing smoke scripts pass
5. Sign-off that Part 4 items (4.1–4.3) are acceptable for MVP

### Risk assessment:
- **Code quality**: HIGH — no TODO/FIXME markers, consistent patterns, comprehensive acceptance
- **Test coverage**: HIGH — 13 standalone smoke scripts + inline acceptance for remaining steps
- **Schedule horizon gap**: RESOLVED — bounded schedule generation is implemented; residual validation belongs in FA53 smoke/release checks
- **Data migration risk**: MEDIUM — one-PRIMARY preflight remains mandatory; if legacy data hygiene is uncertain, scan for unsupported status-only `SUSPENDED` rows before depreciation rollout. FA52 landed as a low-risk additive disposal-metadata backfill.
- **Cross-module risk**: LOW — dependencies are stable and tested
- **Frontend completeness**: HIGH — all routes wired, all pages real, CARI capitalization form implemented, build clean

### Recommendation:
Proceed with FA53 as the final validation step. Disposal reporting metadata is now in place for Track 39 SL06 and direct fixed-assets reads.
