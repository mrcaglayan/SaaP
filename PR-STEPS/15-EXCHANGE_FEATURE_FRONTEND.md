# 15 - EXCHANGE FEATURE FRONTEND (UI Surfacing Plan)

## Purpose
Define an implementation-ready frontend PR roadmap to surface the already implemented EX/EXF backend capabilities from [14-EXCHANGE_FEATURE.md](C:/Users/Maarif/Desktop/my-app/14-EXCHANGE_FEATURE.md).

This plan covers UI routes, API clients, permissions, close-gate UX, and rollout visibility for:

1. Cash exchange workflows.
2. Cash FX reporting.
3. FX ops dashboard and exception actions.
4. CARI settlement realized FX reporting.
5. Period-close FX gate UX hardening.

---

## 0) Analysis Snapshot (Repo-Verified)

### Backend is complete and ready
- EX + EXF tracker in [14-EXCHANGE_FEATURE.md](C:/Users/Maarif/Desktop/my-app/14-EXCHANGE_FEATURE.md) is `11/11 implemented`.
- The following backend routes already exist:
  - `/api/v1/cash/exchanges`
  - `/api/v1/cash/reports/exchange-history`
  - `/api/v1/cash/reports/foreign-balances`
  - `/api/v1/cash/reports/revaluation-runs`
  - `/api/v1/cash/reports/fx-ops-dashboard`
  - `/api/v1/cash/reports/fx-ops-exceptions/:exceptionId/rerun-job`
  - `/api/v1/cash/reports/fx-ops-exceptions/:exceptionId/override`
  - `/api/v1/cari/reports/settlement-realized-fx`
- OpenAPI route coverage exists for these endpoints in [backend/openapi.yaml](C:/Users/Maarif/Desktop/my-app/backend/openapi.yaml).

### Current frontend gaps to surface
- No dedicated UI for cash exchanges (`cash/exchanges`).
- No dedicated UI for cash FX reports (`exchange-history`, `foreign-balances`, `revaluation-runs`).
- No UI for FX ops dashboard and rerun/override actions.
- `ExceptionsWorkbenchPage` module filter does not expose `CASH`.
- `CariReportsPage` does not include settlement realized FX report tab.
- `JournalWorkbenchPage` period-close form does not expose FX close-gate override inputs or structured handling for:
  - `CASH_FX_REVALUATION_REQUIRED`
  - `CASH_FX_REVALUATION_REVERSAL_REQUIRED`

---

## 1) Locked Frontend Semantics

1. Do not introduce new backend contracts in this phase; consume existing endpoints as-is.
2. Preserve permission-first rendering on every route/action.
3. Keep idempotency-key usage explicit on write actions (exchange create/reverse, exception actions).
4. Surface txn/base amounts and FX metadata together where available.
5. Keep settlement same-currency UX rule explicit; guide user to exchange-first flow.

---

## 2) Global Guardrails

- Additive frontend changes only (no regressions to existing cash/cari pages).
- Reuse existing app patterns:
  - `api/*.js` wrappers
  - route -> page component
  - permission checks via `useAuth` and route guards.
- Ship each PR with frontend lint pass:
  - `cd frontend && npm run lint`
- Keep feature rollout controls visible using tenant feature codes where needed.

---

## 3) PR Sequence

1. `PR-EXUI01` - Frontend API contract layer for cash FX + CARI realized FX.
2. `PR-EXUI02` - Cash Exchange Workbench page (list/create/detail/reverse).
3. `PR-EXUI03` - Cash FX Reports page (exchange history, foreign balances, revaluation runs).
4. `PR-EXUI04` - FX Ops Dashboard page + CASH exception actions.
5. `PR-EXUI05` - Period-close FX gate UX hardening in Journal Workbench.
6. `PR-EXUI06` - CARI Reports: Settlement Realized FX tab and summaries.
7. `PR-EXUI07` - Nav/sidebar integration, feature-flag gating, runbook/UI smoke checklist.

---

## 3.1) Execution Tracker (Canonical Style)

Use this section as the single source of implementation status for frontend exchange-feature surfacing.

Update rule:
- `[ ]` = pending
- `[x]` = implemented
- After each merged PR, update this tracker line from `[ ]` to `[x]` with a short `(implemented)` note.
- Keep exactly one current `Next PR`.

### Tracker Lines

- [x] PR-EXUI01 acceptance: frontend API wrappers expose all required cash FX and CARI realized FX endpoints with normalized error handling. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/api/cashAdmin.js`, `frontend/src/api/cariReports.js`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

- [x] PR-EXUI02 acceptance: users can create/list/review/reverse cash exchange batches from UI with permission-gated actions and idempotent behavior. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/pages/cash/CashExchangesPage.jsx`, `frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

- [x] PR-EXUI03 acceptance: finance can run exchange history, foreign balance, and revaluation-run reports from UI with filters and summarized totals. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/pages/cash/CashFxReportsPage.jsx`, `frontend/src/api/cashAdmin.js`, `frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

- [x] PR-EXUI04 acceptance: FX ops dashboard sections and CASH exception actions (rerun/override) are actionable and auditable from UI. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/pages/cash/CashFxOpsDashboardPage.jsx`, `frontend/src/pages/ExceptionsWorkbenchPage.jsx`, `frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`, `frontend/src/api/cashAdmin.js`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

- [x] PR-EXUI05 acceptance: period-close UI handles FX close-gate/reversal-integrity errors with structured guidance and optional override payloads for authorized users. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/pages/JournalWorkbenchPage.jsx`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

- [x] PR-EXUI06 acceptance: CARI report UI includes settlement realized FX reporting with period/counterparty/currency filtering and summary cards. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/pages/cari/CariReportsPage.jsx`, `frontend/src/api/cariReports.js`, `frontend/src/pages/cari/cariReportsUtils.js`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

- [x] PR-EXUI07 acceptance: sidebar/routes/docs/feature gates are aligned for pilot->GA visibility without exposing incomplete flows to non-enabled tenants. (implemented)  
  status: `implemented (2026-03-04)`  
  target files: `frontend/src/layouts/sidebarConfig.js`, `frontend/src/App.jsx`, `frontend/src/auth/AuthContext.jsx`, `docs/runbooks/cash-fx-exchange-operations.md`  
  smoke: `cd frontend && npm run lint`  
  result: `pass`

### Status Snapshot

- Implemented: `7 / 7`
- Completed PRs: `PR-EXUI01, PR-EXUI02, PR-EXUI03, PR-EXUI04, PR-EXUI05, PR-EXUI06, PR-EXUI07`
- Next PR: `none (frontend exchange-feature tracker complete)`

### Progress Update Template (Use After Each Merge)

- before: `- [ ] PR-EXUI0X acceptance: ...`
- after: `- [x] PR-EXUI0X acceptance: ... (implemented)`
  - status: `implemented (YYYY-MM-DD)`
  - target files: `path1, path2, ...`
  - smoke: `cd frontend && npm run lint`
  - result: `pass/fail`

---

## PR-EXUI01: Frontend API Contract Layer

### Goal
Expose all backend FX/cash-report endpoints through frontend API modules to unblock UI pages.

### Frontend Changes
- Add API wrappers for:
  - `GET /api/v1/cash/exchanges`
  - `GET /api/v1/cash/exchanges/:exchangeBatchId`
  - `POST /api/v1/cash/exchanges`
  - `POST /api/v1/cash/exchanges/:exchangeBatchId/reverse`
  - `GET /api/v1/cash/reports/exchange-history`
  - `GET /api/v1/cash/reports/foreign-balances`
  - `GET /api/v1/cash/reports/revaluation-runs`
  - `GET /api/v1/cash/reports/fx-ops-dashboard`
  - `POST /api/v1/cash/reports/fx-ops-exceptions/:exceptionId/rerun-job`
  - `POST /api/v1/cash/reports/fx-ops-exceptions/:exceptionId/override`
  - `GET /api/v1/cari/reports/settlement-realized-fx`
- Keep query-string helpers consistent (`skip null/empty` behavior).
- Normalize API error handling for consistent page-level messages.

### Acceptance
- Every required endpoint is callable from frontend code without direct axios usage in page components.
- Error shape is consistent enough for shared page banners/toasts.

---

## PR-EXUI02: Cash Exchange Workbench UI

### Goal
Give finance/ops a dedicated UI for exchange lifecycle (create, list, reverse).

### Frontend Changes
- Add page: `CashExchangesPage.jsx` (name can be adjusted to repo naming conventions).
- Include:
  - Filter bar: legal entity, source register, target register, status, date range.
  - List table: source/target amounts + currencies, fx rate source/date, fee, spread, status, created/posted/reversed.
  - Create panel/form with idempotency key support.
  - Detail drawer/panel for linked transactions and reversal links.
  - Reverse action with mandatory reason.
- Add route + sidebar link under `Kasa`.
- Permission gating:
  - read: `cash.txn.read`
  - create: `cash.txn.create`
  - reverse: `cash.txn.reverse`

### Acceptance
- User can create an exchange batch and immediately see it in list/detail.
- Reverse action creates deterministic reversal flow and refreshes UI state.

---

## PR-EXUI03: Cash FX Reports UI

### Goal
Surface reporting already provided by backend for finance close activities.

### Frontend Changes
- Add page: `CashFxReportsPage.jsx` with tabs:
  - Exchange History
  - Foreign Balances
  - Revaluation Runs
- Add filter controls mapped to backend validators (as-of dates, run type/status, legal entity/register/book).
- Add summary cards based on response `summary`.
- Add row drilldown for revaluation line currency summary where available.
- Reuse CSV export utility for report rows.
- Route + sidebar integration with `cash.report.read` guard.

### Acceptance
- Finance user can run all three report types from one page with correct totals and pagination.
- Revaluation run lines can be inspected by currency without raw JSON parsing.

---

## PR-EXUI04: FX Ops Dashboard + CASH Exception Actions

### Goal
Operationalize missing rates/job failures/out-of-policy balances from UI.

### Frontend Changes
- Add page: `CashFxOpsDashboardPage.jsx`:
  - Top summary cards (`missingRates`, `revaluationJobs`, `outOfPolicyBalances`, `settlementCurrencyMismatch`).
  - Section tables from `sections.*`.
  - Action buttons:
    - rerun job (`ops.jobs.manage`)
    - override (`ops.exceptions.manage`, reason required)
- Extend [ExceptionsWorkbenchPage.jsx](C:/Users/Maarif/Desktop/my-app/frontend/src/pages/ExceptionsWorkbenchPage.jsx):
  - Add `CASH` in module filter options.
  - Add deep-link handling from FX ops page (`moduleCode=CASH`, optional `exceptionId`).
- Ensure action results refresh section and preserve auditability.

### Acceptance
- Ops can rerun eligible CASH FX job exceptions from UI.
- Ops can override CASH exceptions with reason and see updated status without page reload.

---

## PR-EXUI05: Period-Close FX Gate UX Hardening

### Goal
Make FX gate failures actionable in period close UI and expose override payload controls for authorized users.

### Frontend Changes
- Update [JournalWorkbenchPage.jsx](C:/Users/Maarif/Desktop/my-app/frontend/src/pages/JournalWorkbenchPage.jsx):
  - Detect structured backend error codes:
    - `CASH_FX_REVALUATION_REQUIRED`
    - `CASH_FX_REVALUATION_REVERSAL_REQUIRED`
  - Show actionable details from `error.response.data.details`.
  - Add optional fields to close-run payload:
    - `cashFxRevaluationOverride`
    - `cashFxRevaluationOverrideReason`
  - Render override controls only when user has `cash.fx.revaluation.override`.
  - Provide quick links/CTA text to FX reports/ops pages.

### Acceptance
- Close-gate failures are visible as guided UI states, not generic error text.
- Authorized users can submit override + reason; unauthorized users cannot.

---

## PR-EXUI06: CARI Settlement Realized FX Reporting UI

### Goal
Expose the new CARI realized FX report in the existing CARI reporting experience.

### Frontend Changes
- Update [cariReports.js](C:/Users/Maarif/Desktop/my-app/frontend/src/api/cariReports.js) with `getCariSettlementRealizedFxReport`.
- Update [CariReportsPage.jsx](C:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx):
  - Add new tab: `Settlement Realized FX`.
  - Add filters: as-of/date window, legal entity, counterparty, currency.
  - Add summary cards: net/gain/loss totals.
  - Add rows for settlement-level inspection.

### Acceptance
- Users can query settlement realized FX without leaving CARI reports page.
- Report summaries reconcile with row totals in UI.

---

## PR-EXUI07: Nav, Feature Flags, and Rollout Hardening

### Goal
Finalize discoverability and rollout safety for pilot->GA.

### Frontend Changes
- Sidebar and route cleanup for all new FX pages in:
  - [frontend/src/layouts/sidebarConfig.js](C:/Users/Maarif/Desktop/my-app/frontend/src/layouts/sidebarConfig.js)
  - [frontend/src/App.jsx](C:/Users/Maarif/Desktop/my-app/frontend/src/App.jsx)
- Gate page visibility by tenant feature codes where rollout requires:
  - `FEATURE_CASH_FX_EXF05_PILOT_V1`
  - `FEATURE_CASH_FX_EXF05_GA_V1`
- Add/update runbook UI section in:
  - [docs/runbooks/cash-fx-exchange-operations.md](C:/Users/Maarif/Desktop/my-app/docs/runbooks/cash-fx-exchange-operations.md)
  - include page paths, permission matrix, and smoke-click checklist.

### Acceptance
- Non-enabled tenants do not see incomplete FX rollout pages.
- Pilot/GA enabled tenants can access all required pages from sidebar.
- Runbook includes a UI verification checklist aligned with backend rollout.
