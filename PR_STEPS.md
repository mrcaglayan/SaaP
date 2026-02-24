# PR Steps (Detailed, Non-Break, Repo-Aligned)

## 0) Baseline Snapshot (Current Repo)

This plan is aligned to the current implementation patterns in:

- Route wiring: `backend/src/index.js`, `backend/src/routes/*`
- Service split: `backend/src/services/*`
- Validation split: `backend/src/routes/*validators.js`
- Migration style: `backend/src/migrations/m01x_*.js`, `backend/src/migrations/index.js`
- Frontend route model: `frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`
- Frontend API style: `frontend/src/api/*.js`
- Smoke/integration tests style: `backend/scripts/test-cari-pr0x-*.js`

Current important facts:

- Cari backend is already strong for docs/settlement/reports/audit.
- Frontend has Cari Counterparty + Reports pages, but not Documents/Settlements/Audit pages.
- Sidebar has Contracts and Gelecek Yillar Gelirleri as placeholders (PR-18 upgrades this to full periodization split views).

---

## 1) Global Guardrails (Apply to Every PR)

- Keep ADR-frozen Cari behavior unchanged (`docs/adr/adr-cari-v1.md`).
- No destructive migration for existing Cari tables.
- Keep route -> validator -> service split exactly.
- Keep tenant and legal-entity scope checks on every write/read endpoint.
- Keep RBAC checks at route level and action-level UI checks in frontend.
- Keep OpenAPI generation source of truth in `backend/scripts/generate-openapi.js`.
- Keep existing tests green; add targeted script per PR.
- Use additive changes first, then integrations.

Important frontend guard detail:

- `withPermissionGuard` in `frontend/src/App.jsx` uses `RequirePermission anyOf`.
- Prefer single route-level read permission when it exists.
- If module has no read permission (current settlements case), use explicit any-of action permissions.
- Action buttons in pages must check specific write permissions with `hasPermission`.

---

## 2) Canonical Route and Permission Map

## 2.1 Frontend routes to add (PR-11)

| Module | Route | Sidebar Label | Route-Level Permission |
| --- | --- | --- | --- |
| Cari Documents | `/app/cari-belgeler` | `Cari Belgeler` | `cari.doc.read` |
| Cari Settlements | `/app/cari-settlements` | `Cari Mahsuplastirma / Tahsilat-Odeme` | `anyOf(cari.settlement.apply, cari.settlement.reverse, cari.bank.attach, cari.bank.apply)` |
| Cari Audit | `/app/cari-audit` | `Cari Denetim Izleri` | `cari.audit.read` |

## 2.2 Existing backend endpoints to consume (PR-11..14)

- Documents:
  - `GET /api/v1/cari/documents`
  - `GET /api/v1/cari/documents/{documentId}`
  - `POST /api/v1/cari/documents`
  - `PUT /api/v1/cari/documents/{documentId}`
  - `POST /api/v1/cari/documents/{documentId}/cancel`
  - `POST /api/v1/cari/documents/{documentId}/post`
  - `POST /api/v1/cari/documents/{documentId}/reverse`
- Settlements:
  - `POST /api/v1/cari/settlements/apply`
  - `POST /api/v1/cari/settlements/{settlementBatchId}/reverse`
  - `POST /api/v1/cari/bank/attach`
  - `POST /api/v1/cari/bank/apply`
- Reports:
  - `GET /api/v1/cari/reports/open-items`
  - `GET /api/v1/cari/reports/statement`
- Audit:
  - `GET /api/v1/cari/audit`

## 2.3 New backend endpoint namespaces (PR-16..18)

- Contracts:
  - `/api/v1/contracts/*`
- Deferred + Accrual Periodization (Gelecek Aylar/Yillar Gelirler + Gelir/Gider Tahakkuklari):
  - `/api/v1/revenue-recognition/*`

## 2.4 Exact Cari permission matrix for UI guards (must use backend names)

- Route-level guard:
  - Documents page: `cari.doc.read`
  - Settlements page: any of `cari.settlement.apply`, `cari.settlement.reverse`, `cari.bank.attach`, `cari.bank.apply`
  - Audit page: `cari.audit.read`
- Action-level guards:
  - Document list/detail: `cari.doc.read`
  - Draft create: `cari.doc.create`
  - Draft edit/cancel: `cari.doc.update`
  - Post: `cari.doc.post`
  - Reverse posted: `cari.doc.reverse`
  - Post with FX override: `cari.fx.override` (in addition to `cari.doc.post`)
  - Settlement apply: `cari.settlement.apply`
  - Settlement reverse: `cari.settlement.reverse`
  - Bank attach: `cari.bank.attach`
  - Bank apply: `cari.bank.apply`
  - Audit read: `cari.audit.read`

---

## 3) Existing Cari Data Model to Respect (No semantic drift)

Core tables already in use:

- `cari_documents`
  - keys: `tenant_id`, `legal_entity_id`, `counterparty_id`
  - amounts: `amount_txn`, `amount_base`, `open_amount_txn`, `open_amount_base`
  - status: `DRAFT`, `POSTED`, `PARTIALLY_SETTLED`, `SETTLED`, `CANCELLED`, `REVERSED`
  - snapshots: `counterparty_*_snapshot`, `payment_term_snapshot`, `due_date_snapshot`, `currency_code_snapshot`, `fx_rate_snapshot`
- `cari_open_items`
  - status: `OPEN`, `PARTIALLY_SETTLED`, `SETTLED`, `WRITTEN_OFF`, `CANCELLED`
  - residuals and settled amounts maintained during settlement apply/reverse
- `cari_settlement_batches`
  - status: `DRAFT`, `POSTED`, `REVERSED`, `CANCELLED`
  - bank link fields and idempotency fields
- `cari_settlement_allocations`
  - apply allocations against open items
- `cari_unapplied_cash`
  - status: `UNAPPLIED`, `PARTIALLY_APPLIED`, `FULLY_APPLIED`, `REFUNDED`, `REVERSED`
- `audit_logs`
  - source for `GET /api/v1/cari/audit`

---

## 4) PR-11: Cari API Clients + Route Foundation

### Goal

Add frontend foundations only, no backend business logic change.

### Files to create

- `frontend/src/api/cariCommon.js`
- `frontend/src/api/cariDocuments.js`
- `frontend/src/api/cariSettlements.js`
- `frontend/src/api/cariAudit.js`
- `backend/scripts/test-cari-pr11-frontend-routing-and-api-clients.js`

### Files to update

- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/i18n/messages.js`
- `frontend/src/api/cariCounterparty.js`
- `frontend/src/api/cariPaymentTerms.js`
- `frontend/src/api/cariReports.js`
- `backend/package.json`

### Concrete skeletons

`frontend/src/api/cariCommon.js`

```js
export function toCariQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function parseCariApiError(error) {
  const status = Number(error?.response?.status || 0) || null;
  const data = error?.response?.data || {};
  const message = String(data?.message || error?.message || "Request failed");
  return {
    status,
    message,
    requestId: data?.requestId || null,
    isValidation: status === 400,
    isPermission: status === 401 || status === 403,
    isIdempotentReplay: false,
  };
}

export function extractCariReplayAndRisks(payload) {
  return {
    idempotentReplay: Boolean(payload?.idempotentReplay),
    followUpRisks: Array.isArray(payload?.followUpRisks) ? payload.followUpRisks : [],
  };
}
```

`frontend/src/api/cariDocuments.js`

```js
import { api } from "./client.js";
import { parseCariApiError, toCariQueryString } from "./cariCommon.js";

async function run(requestFn) {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    throw parseCariApiError(error);
  }
}

export async function listCariDocuments(params = {}) {
  return run(() => api.get(`/api/v1/cari/documents${toCariQueryString(params)}`));
}

export async function getCariDocument(documentId) {
  return run(() => api.get(`/api/v1/cari/documents/${documentId}`));
}

export async function createCariDocument(payload) {
  return run(() => api.post("/api/v1/cari/documents", payload));
}

export async function updateCariDocument(documentId, payload) {
  return run(() => api.put(`/api/v1/cari/documents/${documentId}`, payload));
}

export async function cancelCariDocument(documentId) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/cancel`, {}));
}

export async function postCariDocument(documentId, payload = {}) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/post`, payload));
}

export async function reverseCariDocument(documentId, payload = {}) {
  return run(() => api.post(`/api/v1/cari/documents/${documentId}/reverse`, payload));
}
```

`frontend/src/api/cariSettlements.js`

```js
import { api } from "./client.js";
import { parseCariApiError } from "./cariCommon.js";

async function run(requestFn) {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    throw parseCariApiError(error);
  }
}

export async function applyCariSettlement(payload) {
  return run(() => api.post("/api/v1/cari/settlements/apply", payload));
}

export async function reverseCariSettlement(settlementBatchId, payload = {}) {
  return run(() =>
    api.post(`/api/v1/cari/settlements/${settlementBatchId}/reverse`, payload)
  );
}

export async function attachCariBankReference(payload) {
  return run(() => api.post("/api/v1/cari/bank/attach", payload));
}

export async function applyCariBankSettlement(payload) {
  return run(() => api.post("/api/v1/cari/bank/apply", payload));
}
```

`frontend/src/api/cariAudit.js`

```js
import { api } from "./client.js";
import { parseCariApiError, toCariQueryString } from "./cariCommon.js";

async function run(requestFn) {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    throw parseCariApiError(error);
  }
}

export async function listCariAudit(params = {}) {
  return run(() => api.get(`/api/v1/cari/audit${toCariQueryString(params)}`));
}
```

`frontend/src/App.jsx` (route entries)

```jsx
{
  appPath: "/app/cari-belgeler",
  childPath: "cari-belgeler",
  element: <ModulePlaceholderPage title="Cari Belgeler" path="/app/cari-belgeler" />,
},
{
  appPath: "/app/cari-settlements",
  childPath: "cari-settlements",
  element: <ModulePlaceholderPage title="Cari Mahsuplastirma / Tahsilat-Odeme" path="/app/cari-settlements" />,
},
{
  appPath: "/app/cari-audit",
  childPath: "cari-audit",
  element: <ModulePlaceholderPage title="Cari Denetim Izleri" path="/app/cari-audit" />,
},
```

`frontend/src/layouts/sidebarConfig.js` (under `Cari Islemler`)

```js
{
  label: "Cari Belgeler",
  to: "/app/cari-belgeler",
  requiredPermissions: ["cari.doc.read"],
  implemented: true,
},
{
  label: "Cari Mahsuplastirma / Tahsilat-Odeme",
  to: "/app/cari-settlements",
  requiredPermissions: [
    "cari.settlement.apply",
    "cari.settlement.reverse",
    "cari.bank.attach",
    "cari.bank.apply",
  ],
  implemented: true,
},
{
  label: "Cari Denetim Izleri",
  to: "/app/cari-audit",
  requiredPermissions: ["cari.audit.read"],
  implemented: true,
},
```

`backend/scripts/test-cari-pr11-frontend-routing-and-api-clients.js`

```js
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(c, m) { if (!c) throw new Error(m); }
function hasPath(source, pathValue) {
  const escaped = pathValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped).test(source);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const app = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const sidebar = await readFile(path.resolve(root, "frontend/src/layouts/sidebarConfig.js"), "utf8");
  const apiCommon = await readFile(path.resolve(root, "frontend/src/api/cariCommon.js"), "utf8");
  const apiDocs = await readFile(path.resolve(root, "frontend/src/api/cariDocuments.js"), "utf8");
  const apiSettle = await readFile(path.resolve(root, "frontend/src/api/cariSettlements.js"), "utf8");
  const apiAudit = await readFile(path.resolve(root, "frontend/src/api/cariAudit.js"), "utf8");
  const apiCounterparty = await readFile(
    path.resolve(root, "frontend/src/api/cariCounterparty.js"),
    "utf8"
  );
  const apiPaymentTerms = await readFile(
    path.resolve(root, "frontend/src/api/cariPaymentTerms.js"),
    "utf8"
  );
  const apiReports = await readFile(
    path.resolve(root, "frontend/src/api/cariReports.js"),
    "utf8"
  );

  assert(hasPath(app, "/app/cari-belgeler"), "missing route /app/cari-belgeler");
  assert(hasPath(app, "/app/cari-settlements"), "missing route /app/cari-settlements");
  assert(hasPath(app, "/app/cari-audit"), "missing route /app/cari-audit");
  assert(hasPath(sidebar, "/app/cari-belgeler"), "missing sidebar cari-belgeler");
  assert(apiCommon.includes("parseCariApiError"), "cariCommon parser missing");
  assert(apiCommon.includes("toCariQueryString"), "cariCommon query helper missing");
  assert(apiDocs.includes("/api/v1/cari/documents"), "docs api path missing");
  assert(apiSettle.includes("/api/v1/cari/settlements/apply"), "settlement api path missing");
  assert(apiAudit.includes("/api/v1/cari/audit"), "audit api path missing");
  assert(apiCounterparty.includes('./cariCommon.js'), "cariCounterparty should use cariCommon");
  assert(apiPaymentTerms.includes('./cariCommon.js'), "cariPaymentTerms should use cariCommon");
  assert(apiReports.includes('./cariCommon.js'), "cariReports should use cariCommon");

  console.log("PR-11 smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Checklist

- [ ] Create shared `frontend/src/api/cariCommon.js` and wire all Cari API files through it.
- [ ] Create 3 frontend API files with exact endpoint names.
- [ ] Refactor existing Cari API files to use `cariCommon.js`:
  - [ ] `frontend/src/api/cariCounterparty.js`
  - [ ] `frontend/src/api/cariPaymentTerms.js`
  - [ ] `frontend/src/api/cariReports.js`
- [ ] Add 3 implemented routes in `App.jsx`.
- [ ] Add 3 sidebar links under Cari section.
- [ ] Add i18n `sidebar.byPath` keys for the 3 routes (TR + EN message maps).
- [ ] Use exact backend permission names in route/sidebar guards (no alias names).
- [ ] Add PR-11 smoke script and package script:
  - [ ] `test:cari-pr11`
- [ ] Keep PR-11 smoke assertions formatting-agnostic (path/pattern checks instead of fragile exact string fragments).

### Acceptance

- Authorized users with route permission can open pages.
- Unauthorized users blocked via `RequirePermission`.
- Shared helper normalizes API errors and query-string behavior consistently across new and existing Cari API files.
- Existing Cari pages continue to work.

### Command

```powershell
cd backend
npm run test:cari-pr11
```

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-11)

- Section `2.1` route coverage:
  - `/app/cari-belgeler`
  - `/app/cari-settlements`
  - `/app/cari-audit`
- Section `2.2` endpoint families to wire in API clients:
  - `/api/v1/cari/documents*`
  - `/api/v1/cari/settlements*` + `/api/v1/cari/bank/*`
  - `/api/v1/cari/audit`
- Section `2.4` permission alignment:
  - route guards use exact backend names (`cari.doc.read`, settlements `anyOf(...)`, `cari.audit.read`)
- Section `3` data model alignment:
  - PR-11 does not mutate DB tables; only frontend wiring and API client contracts.

---

## 5) PR-12: Cari Documents Page (Draft/Post/Reverse UI)

### Goal

Implement complete document lifecycle UI on existing backend.

### Files to create

- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `backend/scripts/test-cari-pr12-frontend-documents-smoke.js`
- `backend/scripts/test-cari-pr12-documents-date-filter-contract.js`

### Files to update

- `frontend/src/App.jsx` (replace placeholder element for `/app/cari-belgeler`)
- `frontend/src/i18n/messages.js`
- `backend/src/routes/cari.document.validators.js` (add date-range filter parsing)
- `backend/src/services/cari.document.service.js` (apply date-range SQL conditions)
- `backend/scripts/generate-openapi.js` (document new query params)
- `backend/package.json`

### Concrete route

- `/app/cari-belgeler` -> `<CariDocumentsPage />`

### UI behavior rules (must match backend)

- Reverse action only when document status is `POSTED`.
- Cancel/Edit only for `DRAFT`.
- Post only for `DRAFT`.
- List/filter must support:
  - `legalEntityId`
  - `counterpartyId`
  - `direction` (`AR`/`AP`)
  - `documentType`
  - `status`
  - `dateFrom` + `dateTo` (document date range)
- Detail drawer/modal must show:
  - `documentNo`
  - `status`
  - `postedJournalEntryId`
  - snapshot fields (`counterparty*Snapshot`, `dueDateSnapshot`, `fxRateSnapshot`, `currencyCodeSnapshot`)
  - reversal linkage:
    - `reversalOfDocumentId` from document `GET/list` response
    - `reversalDocumentId` and `reversalJournalEntryId` from reverse action response (`POST /reverse`)
- FX override in post action:
  - UI must expose explicit `useFxOverride` checkbox + `fxOverrideReason` field.
  - `useFxOverride=true` requires `fxOverrideReason`.
  - only users with `cari.fx.override` can submit with override.
  - when unauthorized, show explicit inline message (not generic failure).

Important repo note:

- Current `parseDocumentReadFilters` does not parse date range yet.
- PR-12 must include backend support for `dateFrom`/`dateTo` so UI filter contract is real (not client-only filtering).
- Option A lock for reversal linkage (scope-safe):
  - backend mapper field is `reversalOfDocumentId` (not `reversedDocumentId`)
  - do not require `reversalDocumentId` / `reversalJournalEntryId` in `GET /documents` for PR-12
  - show those from reverse action response, or add separate backend enhancement PR later.
- Create draft payload alignment:
  - do not force line-items in UI if backend create contract is header-level for current scope
  - keep payload minimal and backend-validator-compatible
- Due date rule alignment:
  - `dueDate` is conditionally required based on `documentType` validator rules
  - UI validation/help text must follow backend rule, not a single global required flag

### Skeleton

`frontend/src/pages/cari/cariDocumentsUtils.js`

```js
export const DOCUMENT_STATUSES = [
  "DRAFT",
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "CANCELLED",
  "REVERSED",
];

export function buildDocumentListQuery(filters) {
  return {
    legalEntityId: filters.legalEntityId || undefined,
    counterpartyId: filters.counterpartyId || undefined,
    direction: filters.direction || undefined,
    documentType: filters.documentType || undefined,
    status: filters.status || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    q: filters.q || undefined,
    limit: filters.limit || 100,
    offset: filters.offset || 0,
  };
}
```

`frontend/src/pages/cari/CariDocumentsPage.jsx` (minimal structure)

```jsx
import { useEffect, useMemo, useState } from "react";
import {
  listCariDocuments,
  createCariDocument,
  updateCariDocument,
  cancelCariDocument,
  postCariDocument,
  reverseCariDocument,
} from "../../api/cariDocuments.js";
import { useAuth } from "../../auth/useAuth.js";
import { buildDocumentListQuery } from "./cariDocumentsUtils.js";

export default function CariDocumentsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("cari.doc.read");
  const canCreate = hasPermission("cari.doc.create");
  const canUpdate = hasPermission("cari.doc.update");
  const canPost = hasPermission("cari.doc.post");
  const canReverse = hasPermission("cari.doc.reverse");
  const canFxOverride = hasPermission("cari.fx.override");

  // filters, list state, form state, selected row state
  // load list on mount/filter changes
  // action handlers: create/update/cancel/post/reverse
  // map backend error message to inline alert
  // render table + form + action panel
  return <div>Cari Documents</div>;
}
```

### Checklist

- [ ] Build list/filter with backend query params exactly.
- [ ] Add backend date-range support for documents list (`dateFrom`, `dateTo`).
- [ ] Build create draft form with required fields.
- [ ] Build edit/cancel/post/reverse action panel.
- [ ] Implement permission-aware buttons.
- [ ] Render posted journal reference and snapshot fields.
- [ ] Add detail drawer/modal with reversal linkage visibility using `reversalOfDocumentId`.
- [ ] Show `reversalDocumentId` + `reversalJournalEntryId` from reverse action response in result panel/detail state.
- [ ] Keep create payload header-level unless backend contract expands (no artificial line-items requirement in PR-12).
- [ ] Apply `dueDate` conditional required logic based on selected `documentType` and backend validator rules.
- [ ] Add explicit FX override UX and unauthorized guidance text.
- [ ] Add frontend smoke script:
  - [ ] verify route mounts `CariDocumentsPage`
  - [ ] verify filters include date range
  - [ ] verify action buttons and labels exist
  - [ ] verify API function usage by source scan
  - [ ] verify source uses `reversalOfDocumentId` and does not reference `reversedDocumentId`
  - [ ] verify reverse action result wiring for `reversalDocumentId` + `reversalJournalEntryId`
- [ ] Add backend filter contract test for new date params.
- [ ] Add script alias: `test:cari-pr12`

### Acceptance

- Draft create/update/cancel works.
- Post works and shows `postedJournalEntryId`.
- Reverse works only on posted docs.
- Reversal linkage rendering matches real backend payload names and sources.
- Create flow matches real backend payload contract (header-level scope for this PR).
- `dueDate` required behavior matches backend `documentType` validation.
- Date-range filter is supported server-side and reflected in OpenAPI.
- No regressions in `test:cari-pr05` and `test:cari-pr06`.

### Commands

```powershell
cd backend
npm run test:cari-pr12
npm run test:cari-pr12-documents-date-filter
npm run test:cari-pr05
npm run test:cari-pr06
```

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-12)

- Section `2.1` route coverage:
  - `/app/cari-belgeler`
- Section `2.2` endpoint coverage:
  - `GET /api/v1/cari/documents`
  - `GET /api/v1/cari/documents/{documentId}`
  - `POST /api/v1/cari/documents`
  - `PUT /api/v1/cari/documents/{documentId}`
  - `POST /api/v1/cari/documents/{documentId}/cancel`
  - `POST /api/v1/cari/documents/{documentId}/post`
  - `POST /api/v1/cari/documents/{documentId}/reverse`
- Section `2.4` permission alignment:
  - `cari.doc.read`, `cari.doc.create`, `cari.doc.update`, `cari.doc.post`, `cari.doc.reverse`, `cari.fx.override`
- Section `3` data model alignment:
  - `cari_documents` status + snapshot fields are primary UI source.
  - open/residual values must stay consistent with backend-managed fields.

---

## 6) PR-13: Settlement Workbench UI

### Goal

Implement settlement apply/reverse with unapplied and bank-link controls.

### Files to create

- `frontend/src/pages/cari/CariSettlementsPage.jsx`
- `frontend/src/pages/cari/cariSettlementsUtils.js`
- `frontend/src/pages/cari/cariIdempotency.js`
- `backend/scripts/test-cari-pr13-frontend-settlement-smoke.js`

### Files to update

- `frontend/src/App.jsx` (replace placeholder for `/app/cari-settlements`)
- `frontend/src/i18n/messages.js`
- `frontend/src/api/cariReports.js` (if query contract needs alignment for preview filters)
- `backend/package.json`

### Concrete route

- `/app/cari-settlements` -> `<CariSettlementsPage />`

### Backend payload rules to enforce in UI

- `allocations` required when `autoAllocate=false`.
- `allocations` must be empty when `autoAllocate=true`.
- `idempotencyKey` required for apply.
- Reverse uses `POST /settlements/{settlementBatchId}/reverse`.
- Bank attach target rules:
  - `targetType=SETTLEMENT` => `settlementBatchId` required, `unappliedCashId` empty.
  - `targetType=UNAPPLIED_CASH` => inverse.

Critical UX requirements

- Client-side idempotency key handling:
  - generate once per submit intent
  - reuse same key on retry
  - do not regenerate on double-click or refresh retry
  - keep last pending key in `sessionStorage` until success/final failure
- Final-failure classification for pending key cleanup:
  - clear pending key on final client-side failures (`400`, `401`, `403`)
  - keep pending key on retryable/server failures (`408`, `429`, `5xx`, network/timeout)
  - clear pending key on successful apply responses (including `idempotentReplay=true`)
- Replay feedback:
  - if backend returns `idempotentReplay=true`, show info banner:
    - "Bu istek daha once uygulanmis; mevcut sonuc gosteriliyor."
- Show backend `followUpRisks` in warning panel.
- Deterministic allocation preview:
  - when `autoAllocate=true`, show expected allocation order (oldest due first)
  - preview columns: open item id/doc no, due date, open amount, expected applied, expected residual
- Keep workflows explicit:
  - settlement apply/reverse UI separate from bank attach/apply UI
  - no hidden automatic bank attach during settlement apply

### Auto-allocation preview data source (mandatory)

- Source API client: `getCariOpenItemsReport(...)` from `frontend/src/api/cariReports.js`
- Source endpoint: `GET /api/v1/cari/reports/open-items`
- Required preview filters:
  - `legalEntityId`
  - `counterpartyId`
  - `asOfDate`
- Optional preview filter:
  - `direction` (`AR`/`AP`) when direction is selected in UI
- Wiring rule:
  - Fetch open items when preview filters change and feed returned rows into
    `buildAutoAllocatePreview(openItems, incomingAmountTxn)`.
  - Do not use static/empty arrays for preview calculation except initial empty state.

### Skeleton

`frontend/src/pages/cari/cariSettlementsUtils.js`

```js
export function buildAutoAllocatePreview(openItems = [], incomingAmountTxn = 0) {
  const sorted = [...openItems].sort((a, b) => {
    const aDue = String(a?.dueDate || "");
    const bDue = String(b?.dueDate || "");
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return Number(a?.openItemId || 0) - Number(b?.openItemId || 0);
  });

  let remaining = Number(incomingAmountTxn || 0);
  return sorted.map((item) => {
    const openTxn = Number(item?.openAmountTxn || 0);
    const applyTxn = Math.max(0, Math.min(openTxn, remaining));
    remaining = Math.max(0, remaining - applyTxn);
    return {
      openItemId: item?.openItemId || null,
      documentNo: item?.documentNo || null,
      dueDate: item?.dueDate || null,
      openAmountTxn: openTxn,
      expectedApplyTxn: applyTxn,
      expectedResidualTxn: Math.max(0, openTxn - applyTxn),
    };
  });
}

export function buildSettlementApplyPayload(form) {
  return {
    legalEntityId: Number(form.legalEntityId),
    counterpartyId: Number(form.counterpartyId),
    settlementDate: form.settlementDate,
    currencyCode: form.currencyCode,
    incomingAmountTxn: Number(form.incomingAmountTxn || 0),
    idempotencyKey: String(form.idempotencyKey || "").trim(),
    autoAllocate: Boolean(form.autoAllocate),
    useUnappliedCash: Boolean(form.useUnappliedCash),
    allocations: Array.isArray(form.allocations) ? form.allocations : [],
    fxRate: form.fxRate || undefined,
    note: form.note || undefined,
  };
}
```

`frontend/src/pages/cari/cariIdempotency.js`

```js
const STORAGE_KEY = "cari:settlement:pending-idempotency-key";

export function loadPendingIdempotencyKey() {
  return sessionStorage.getItem(STORAGE_KEY) || "";
}

export function createPendingIdempotencyKey() {
  const existing = loadPendingIdempotencyKey();
  if (existing) return existing;
  const key = `CARI-SET-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(STORAGE_KEY, key);
  return key;
}

export function clearPendingIdempotencyKey() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function shouldClearPendingKeyAfterError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  return status === 400 || status === 401 || status === 403;
}
```

`frontend/src/pages/cari/CariSettlementsPage.jsx`

```jsx
import { useEffect, useMemo, useState } from "react";
import {
  applyCariSettlement,
  reverseCariSettlement,
  attachCariBankReference,
  applyCariBankSettlement,
} from "../../api/cariSettlements.js";
import { getCariOpenItemsReport } from "../../api/cariReports.js";
import { extractCariReplayAndRisks } from "../../api/cariCommon.js";
import { useAuth } from "../../auth/useAuth.js";
import {
  buildAutoAllocatePreview,
  buildSettlementApplyPayload,
} from "./cariSettlementsUtils.js";
import {
  clearPendingIdempotencyKey,
  createPendingIdempotencyKey,
  loadPendingIdempotencyKey,
  shouldClearPendingKeyAfterError,
} from "./cariIdempotency.js";

export default function CariSettlementsPage() {
  const { hasPermission } = useAuth();
  const canApply = hasPermission("cari.settlement.apply");
  const canReverse = hasPermission("cari.settlement.reverse");
  const canBankAttach = hasPermission("cari.bank.attach");
  const canBankApply = hasPermission("cari.bank.apply");
  const [previewFilters, setPreviewFilters] = useState({
    legalEntityId: "",
    counterpartyId: "",
    asOfDate: "",
    direction: "",
  });
  const [openItems, setOpenItems] = useState([]);
  const [applyForm, setApplyForm] = useState({
    legalEntityId: "",
    counterpartyId: "",
    settlementDate: "",
    currencyCode: "",
    incomingAmountTxn: 0,
    idempotencyKey: loadPendingIdempotencyKey(),
    autoAllocate: true,
    useUnappliedCash: false,
    allocations: [],
    fxRate: "",
    note: "",
  });

  // separate tabs/sections:
  // 1) Settlement Apply/Reverse
  // 2) Bank Attach/Apply
  // apply submit:
  // - reuse stable idempotency key until request completes
  // - parse idempotentReplay + followUpRisks
  // - clear key on success and final client failures; keep key for retryable failures
  useEffect(() => {
    const { legalEntityId, counterpartyId, asOfDate, direction } = previewFilters;
    if (!legalEntityId || !counterpartyId || !asOfDate) {
      setOpenItems([]);
      return;
    }

    let isMounted = true;
    async function loadPreviewOpenItems() {
      const payload = await getCariOpenItemsReport({
        legalEntityId,
        counterpartyId,
        asOfDate,
        direction: direction || undefined,
      });
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      if (isMounted) setOpenItems(rows);
    }

    loadPreviewOpenItems();
    return () => {
      isMounted = false;
    };
  }, [
    previewFilters.legalEntityId,
    previewFilters.counterpartyId,
    previewFilters.asOfDate,
    previewFilters.direction,
  ]);

  const previewRows = useMemo(
    () => buildAutoAllocatePreview(openItems, Number(applyForm.incomingAmountTxn || 0)),
    [openItems, applyForm.incomingAmountTxn]
  );

  async function onApply(form = applyForm) {
    const idempotencyKey = form.idempotencyKey || createPendingIdempotencyKey();
    setApplyForm((prev) => ({ ...prev, idempotencyKey }));
    try {
      const payload = buildSettlementApplyPayload({ ...form, idempotencyKey });
      const response = await applyCariSettlement(payload);
      const replayState = extractCariReplayAndRisks(response);
      // replay is also a successful terminal result
      clearPendingIdempotencyKey();
      return { response, replayState };
    } catch (error) {
      if (shouldClearPendingKeyAfterError(error)) {
        clearPendingIdempotencyKey();
      }
      throw error;
    }
  }

  return <div>Cari Settlements</div>;
}
```

### Checklist

- [ ] Build apply section (manual/auto allocate).
- [ ] Build reverse section.
- [ ] Fetch preview source data via `getCariOpenItemsReport(...)` (not static rows).
- [ ] Send required preview filters: `legalEntityId`, `counterpartyId`, `asOfDate`.
- [ ] Send optional `direction` filter when selected.
- [ ] Build deterministic auto-allocation preview (oldest due first).
- [ ] Build bank attach + bank apply sections as separate workflow panel.
- [ ] Render response blocks for `allocations`, `fx`, `unapplied`, `followUpRisks`.
- [ ] Implement stable idempotency key reuse across retries/double-click and preload from `loadPendingIdempotencyKey()` after refresh.
- [ ] Implement final-failure classification for pending key cleanup:
  - [ ] clear on `400/401/403`
  - [ ] keep on retryable/server/network failures
  - [ ] clear on successful apply (including `idempotentReplay=true`)
- [ ] Show idempotent replay info as non-error.
- [ ] Show `followUpRisks` as warning box.
- [ ] Add smoke script + `test:cari-pr13`.

### Acceptance

- Partial/full settlement flows work through UI.
- Reverse settlement flow works.
- Unapplied consumption/create visibility works.
- Replay and idempotency behavior is explicit and support-friendly.
- Bank attach/apply actions stay explicit and separate from settlement actions.
- Auto-allocation preview is fed by `/api/v1/cari/reports/open-items` rows using
  `legalEntityId`, `counterpartyId`, `asOfDate` (and optional `direction`).
- Pending idempotency key cleanup matches final-failure classification rules.
- No regressions in `test:cari-pr07` and `test:cari-pr08`.

### Commands

```powershell
cd backend
npm run test:cari-pr13
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

### Canonical Route/Permission/Data Model Mapping (PR-13)

- Section `2.1` route coverage:
  - `/app/cari-settlements`
- Section `2.2` endpoint coverage:
  - `POST /api/v1/cari/settlements/apply`
  - `POST /api/v1/cari/settlements/{settlementBatchId}/reverse`
  - `POST /api/v1/cari/bank/attach`
  - `POST /api/v1/cari/bank/apply`
  - `GET /api/v1/cari/reports/open-items` (preview source for auto-allocation UI)
- Section `2.4` permission alignment:
  - `cari.settlement.apply`, `cari.settlement.reverse`, `cari.bank.attach`, `cari.bank.apply`
- Section `3` data model alignment:
  - `cari_settlement_batches`, `cari_settlement_allocations`, `cari_unapplied_cash`
  - `cari_open_items` and `cari_documents` open balances must reconcile after apply/reverse.

---

## 7) PR-14: Cari Audit Page

### Goal

Expose finance/support investigation screen for existing audit endpoint.

Repo reality check (locked for this plan):

- `GET /api/v1/cari/audit` is already implemented in `backend/src/services/cari.audit.service.js`.
- This PR is frontend-first, not a fake page on a stub endpoint.
- Optional backend hardening in this PR is limited to query/index/perf checks, not endpoint creation.

### Files to create

- `frontend/src/pages/cari/CariAuditPage.jsx`
- `backend/scripts/test-cari-pr14-frontend-audit-smoke.js`

### Files to update

- `frontend/src/App.jsx` (replace placeholder for `/app/cari-audit`)
- `frontend/src/i18n/messages.js`
- `backend/package.json`

### Concrete route

- `/app/cari-audit` -> `<CariAuditPage />`

### Skeleton

```jsx
import { useEffect, useState } from "react";
import { listCariAudit } from "../../api/cariAudit.js";
import { useAuth } from "../../auth/useAuth.js";

export default function CariAuditPage() {
  const { hasPermission } = useAuth();
  const canReadAudit = hasPermission("cari.audit.read");
  const [filters, setFilters] = useState({
    legalEntityId: "",
    action: "",
    resourceType: "",
    resourceId: "",
    actorUserId: "",
    requestId: "",
    createdFrom: "",
    createdTo: "",
    includePayload: false,
    limit: 100,
    offset: 0,
  });
  // load list, pagination
  // requestId should be copyable from each row
  // payload detail panels should be collapsed by default and expanded on demand
  return <div>Cari Audit</div>;
}
```

### Checklist

- [ ] Implement filter form for all backend query params.
- [ ] Implement paginated table.
- [ ] Support `includePayload` toggle.
- [ ] Show `byAction` summary counts.
- [ ] Show `requestId` prominently.
- [ ] Add copy button for `requestId` in row/detail views.
- [ ] Keep payload panels collapsed by default; expand only when user requests.
- [ ] Keep `legalEntityId`, `action`, `resourceType`, `resourceId`, `actorUserId`, `requestId`, `createdFrom`, `createdTo` filters visible by default.
- [ ] Add smoke script + `test:cari-pr14`.

### Acceptance

- Tenant/legal-entity safe visibility preserved by backend.
- Support and finance can filter quickly by action/resource/date.
- Page is backed by live `audit_logs` data (not placeholder output).
- `requestId` and payload visibility patterns are support-friendly (copyable IDs, lazy payload read).
- Existing PR-10 docs/openapi checks remain green.

### Commands

```powershell
cd backend
npm run test:cari-pr14
npm run test:cari-pr10
```

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-14)

- Section `2.1` route coverage:
  - `/app/cari-audit`
- Section `2.2` endpoint coverage:
  - `GET /api/v1/cari/audit`
- Section `2.4` permission alignment:
  - `cari.audit.read`
- Section `3` data model alignment:
  - read-only view over `audit_logs`.

---

## 8) PR-15: Quality Gate Lock + Docs Sync

### Goal

Finalize Cari operational quality gate after PR-11..14.

### Files to update

- `backend/package.json`
- `backend/scripts/test-cari-pr10-quality-gate-and-docs.js`
- `docs/runbooks/cari-v1-operations.md`
- `docs/kullanim-kilavuzlari/cari-islemler-kullanim-kilavuzu.md`
- `backend/openapi.yaml` (generated output)

### Files to create

- `docs/runbooks/cari-v1-support-finance-ui-guide.md`

### Checklist

- [ ] Add scripts:
  - [ ] `test:cari-pr11`
  - [ ] `test:cari-pr12`
  - [ ] `test:cari-pr12-documents-date-filter`
  - [ ] `test:cari-pr13`
  - [ ] `test:cari-pr14`
- [ ] Extend `test:cari-quality-gate` chain with PR-11..14 scripts plus `test:cari-pr12-documents-date-filter`.
- [ ] Update runbook with new UI routes and operator flows.
- [ ] Add short support/finance UI operations guide:
  - [ ] document lifecycle
  - [ ] settlement idempotency behavior
  - [ ] replay behavior (`idempotentReplay`)
  - [ ] reverse behavior (document + settlement)
  - [ ] bank attach/apply meaning
  - [ ] FX override use-case and permission expectations
- [ ] Regenerate OpenAPI:
  - [ ] `cd backend && npm run openapi:generate`
- [ ] Validate OpenAPI generation in CI script (fail if stale).
- [ ] Keep `test:cari-pr10` openapi/doc assertions valid.

### Acceptance

- All Cari flows now covered:
  - Counterparty + Payment terms
  - Documents
  - Settlements
  - Reports
  - Audit
- Support/finance can operate using runbook + UI guide without dev intervention.

### Commands

```powershell
cd backend
npm run test:cari-quality-gate
npm run test:release-gate
```

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-15)

- Section `2.1` route coverage (quality gate scope):
  - `/app/cari-belgeler`, `/app/cari-settlements`, `/app/cari-audit`
- Section `2.2` endpoint coverage (quality gate scope):
  - all Cari document, settlement/bank, report, and audit endpoints
- Section `2.4` permission alignment:
  - quality scripts validate route/action permission assumptions remain correct
- Section `3` data model alignment:
  - no semantic drift in `cari_documents`, `cari_open_items`, `cari_settlement_batches`,
    `cari_settlement_allocations`, `cari_unapplied_cash`, `audit_logs`.

---

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
        KEY ix_contract_scope (tenant_id, legal_entity_id, counterparty_id, status)
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
        UNIQUE KEY uk_contract_line_no (tenant_id, contract_id, line_no),
        KEY ix_contract_line_scope (tenant_id, contract_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS contract_document_links (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        contract_id BIGINT UNSIGNED NOT NULL,
        cari_document_id BIGINT UNSIGNED NOT NULL,
        link_type ENUM('BILLING','ADVANCE','ADJUSTMENT') NOT NULL,
        linked_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0,
        linked_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0,
        created_by_user_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_contract_doc_link (tenant_id, contract_id, cari_document_id, link_type),
        KEY ix_contract_doc_link_scope (tenant_id, contract_id, cari_document_id)
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

### Checklist

- [ ] Add migration and wire `m020` in `backend/src/migrations/index.js`.
- [ ] Add contracts route/validator/service split.
- [ ] Add index mount in `backend/src/index.js`:
  - [ ] `app.use("/api/v1/contracts", requireAuth, contractsRoutes);`
- [ ] Add permissions in `seedCore` and role mapping.
- [ ] Add OpenAPI route docs in generator.
- [ ] Enforce strict scope checks in link service:
  - [ ] linked `cari_document` must match contract `tenant_id`
  - [ ] linked `cari_document` must match contract `legal_entity_id`
- [ ] Add PR-16 integration test + package script.

### Acceptance

- Contracts CRUD and lifecycle stable.
- Contract-document links are tenant-safe and scope-safe.
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
  - `contract_document_links` must reference `cari_documents` safely (tenant/legal entity boundaries).

---

## 10) PR-17: Deferred + Accrual Periodization Engine (18x/28x/38x/48x)

### Goal

Add schedule generation and posting engine for Turkish periodization accounts:

- deferred revenue (`380/480`)
- accrued revenue (`181/281`)
- accrued expense (`381/481`)
- prepaid expense carry-forward (`180/280`)

### Fazli implementation lock (mandatory)

- Faz A (Phase A): foundation
  - model + posting rules + mapping + subledger + reclass altyapisi
  - no UI dependency
- Faz B (Phase B): first accounting families
  - `380/480` + `180/280`
  - posting/reversal/reclass + reconciliation
- Faz C (Phase C): accrual families
  - `181/281` + `381/481` kapanis/settlement akislari
  - due-based closure + reversal controls
- Faz D (Phase D): reporting + consolidation + UI depth
  - consolidation reports and split rollforward depth
  - UI deepening for all families and reconciliation visibility

### Files to create

- `backend/src/migrations/m021_revenue_recognition_schedules.js`
- `backend/src/routes/revenue-recognition.js`
- `backend/src/routes/revenue-recognition.validators.js`
- `backend/src/services/revenue-recognition.service.js`
- `backend/scripts/test-revenue-pr17-engine.js`

### Files to update

- `backend/src/migrations/index.js`
- `backend/src/index.js`
- `backend/src/seedCore.js`
- `backend/scripts/generate-openapi.js`
- `backend/package.json`

### New backend endpoints

- `GET /api/v1/revenue-recognition/schedules`
- `POST /api/v1/revenue-recognition/schedules/generate`
- `GET /api/v1/revenue-recognition/runs`
- `POST /api/v1/revenue-recognition/runs`
- `POST /api/v1/revenue-recognition/runs/{runId}/post`
- `POST /api/v1/revenue-recognition/runs/{runId}/reverse`
- `GET /api/v1/revenue-recognition/reports/future-year-rollforward`
- `GET /api/v1/revenue-recognition/reports/deferred-revenue-split`
- `GET /api/v1/revenue-recognition/reports/accrual-split`
- `POST /api/v1/revenue-recognition/accruals/generate`
- `POST /api/v1/revenue-recognition/accruals/{accrualId}/settle`
- `POST /api/v1/revenue-recognition/accruals/{accrualId}/reverse`

### Data model (new)

- `revenue_recognition_schedules`
- `revenue_recognition_schedule_lines`
- `revenue_recognition_runs`
- `revenue_recognition_run_lines`
- `revenue_recognition_subledger_entries`

Required classification fields in schedule/run lines:

- `liability_bucket` (`SHORT_TERM` | `LONG_TERM`)
- `maturity_date`
- `reclass_required` flag
- `account_family` (`DEFREV` | `ACCRUED_REVENUE` | `ACCRUED_EXPENSE` | `PREPAID_EXPENSE`)

### Accounting mapping requirement

Use `journal_purpose_accounts` with purpose codes:

- `PREPAID_EXP_SHORT_ASSET` (180 Gelecek Aylara Ait Giderler)
- `PREPAID_EXP_LONG_ASSET` (280 Gelecek Yillara Ait Giderler)
- `ACCR_REV_SHORT_ASSET` (181 Gelir Tahakkuklari)
- `ACCR_REV_LONG_ASSET` (281 Gelir Tahakkuklari)
- `DEFREV_SHORT_LIABILITY` (Gelecek Aylar Gelirleri)
- `DEFREV_LONG_LIABILITY` (Gelecek Yillar Gelirleri)
- `ACCR_EXP_SHORT_LIABILITY` (381 Gider Tahakkuklari)
- `ACCR_EXP_LONG_LIABILITY` (481 Gider Tahakkuklari)
- `DEFREV_REVENUE`
- `DEFREV_RECLASS` (optional dedicated reclass purpose)

### Turkish periodization lock rules (must implement)

- Initial recognition split by maturity:
  - <= 12 months -> short-term bucket (`180/181/380/381`)
  - > 12 months -> long-term bucket (`280/281/480/481`)
- Mandatory long->short reclass on maturity horizon change:
  - `280 -> 180`, `281 -> 181`, `480 -> 380`, `481 -> 381`
- Closing/settlement flows:
  - deferred revenue recognition: `380/480` decreases as revenue is recognized.
  - accrued revenue closure: `181/281` closes when receivable/cash posting occurs.
  - accrued expense closure: `381/481` closes when payable/cash posting occurs.
  - prepaid expense amortization: `180/280` closes into expense accounts by period.
- Subledger rows must store bucket, family, due/maturity, and source contract/document reference.
- GL postings must always reconcile to subledger balances by legal entity, currency, and period.
- Consolidation must include short-term and long-term balances separately for each family (no netting by default).

### New permissions

- `revenue.schedule.read`
- `revenue.schedule.generate`
- `revenue.run.read`
- `revenue.run.create`
- `revenue.run.post`
- `revenue.run.reverse`
- `revenue.report.read`

### Checklist

- [ ] Add `m021` migration and wire index.
- [ ] Add route/validator/service files for engine.
- [ ] Add index mount:
  - [ ] `app.use("/api/v1/revenue-recognition", requireAuth, revenueRecognitionRoutes);`
- [ ] Add permissions in `seedCore`.
- [ ] Add OpenAPI generator entries and tags.
- [ ] Implement short/long bucket split logic for all periodization families.
- [ ] Implement automatic or scheduled long->short reclass flow (`280->180`, `281->181`, `480->380`, `481->381`).
- [ ] Implement accrual generate/settle/reverse flows for `181/281/381/481`.
- [ ] Implement prepaid expense carry/amortization flow for `180/280`.
- [ ] Add subledger-to-GL reconciliation checks per period/legal entity.
- [ ] Add consolidation-facing report/query for periodization split.
- [ ] Add PR-17 integration tests (generate -> post -> settle/reverse -> reclass).
- [ ] Add duplicate-line guard for schedule generation reruns (same source should not create duplicate open lines).
- [ ] Keep explicit original-run linkage on reversals for full traceability.
- [ ] Add reconciliation assertions between rollforward report totals and posted GL movements.
- [ ] Execute in strict faz order: A -> B -> C -> D (no phase skipping).
- [ ] Add per-phase gate tests and mark phase completion in PR notes.

### Acceptance

- Schedule generation deterministic and rerun-safe.
- Posting/reversal creates balanced GL entries.
- Rollforward report matches schedule balances.
- 18x/28x/38x/48x split is correct and traceable in subledger.
- Reclass (long -> short) is correct and auditable.
- Consolidation can consume split balances without manual adjustments.
- Phase A complete before any phase-specific UI is enabled.
- Phase B (`380/480`, `180/280`) and Phase C (`181/281`, `381/481`) pass independently.
- Phase D reports/UI operate only on reconciled subledger+GL data.

### Global Guardrails Check (Mandatory)

- [ ] Section 1) Global Guardrails maddeleri bu PR icin tek tek dogrulandi.
- [ ] ADR-frozen kurallar korunuyor (docs/adr/adr-cari-v1.md).
- [ ] Tenant/legal-entity scope ve RBAC kontrolleri korunuyor.
- [ ] Route -> validator -> service ayrimi korunuyor.
- [ ] Endpoint kontrati degistiyse OpenAPI generator guncellendi ve cikti uretildi.
- [ ] Bu PR testi + mevcut regresyon testleri yesil.

### Canonical Route/Permission/Data Model Mapping (PR-17)

- Section `2.3` namespace coverage:
  - `/api/v1/revenue-recognition/*`
- Permission alignment:
  - `revenue.schedule.read`, `revenue.schedule.generate`, `revenue.run.read`,
    `revenue.run.create`, `revenue.run.post`, `revenue.run.reverse`, `revenue.report.read`
- Section `3` data model alignment:
  - existing Cari tables remain semantically stable.
  - new revenue-recognition tables must stay tenant/legal-entity safe.
  - periodization engine must keep explicit `SHORT_TERM` and `LONG_TERM` buckets across DEFREV/ACCRUAL/PREPAID families.

---

## 11) PR-18: UI for Contracts + Periodization Split

### Goal

Convert both placeholder main-menu modules into real UI modules, with periodization split UX:

- Gelecek Aylar Gelirleri / Gelecek Yillar Gelirleri
- Gelir Tahakkuklari (kisa/uzun)
- Gider Tahakkuklari (kisa/uzun)
- Gelecek Aylara/Yillara Ait Giderler (prepaid carry)

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

### Placeholder-to-implemented conversion lock (mandatory)

- `frontend/src/App.jsx`
  - Replace placeholder elements with real components for:
    - `/app/contracts`
    - `/app/gelecek-yillar-gelirleri`
  - Ensure both are included in implemented route list/branch used by app shell
    (no fallback `ModulePlaceholderPage` for these two routes).
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
- [ ] Set sidebar permission/implementation flags:
  - [ ] `/app/contracts` -> `requiredPermissions: ["contract.read"]`, `implemented: true`
  - [ ] `/app/gelecek-yillar-gelirleri` -> `requiredPermissions: ["revenue.report.read"]`, `implemented: true`
- [ ] Add/verify `messages.js` `sidebar.byPath` labels for both routes.
- [ ] Keep frontend API helper pattern consistent with PR-11:
  - [ ] use shared API error/query helpers (extend to generic `apiCommon` if adopted)
- [ ] Add per-action permission checks (not only route-level).
- [ ] Update sidebar labels/translations.
- [ ] Add PR-18 frontend smoke script:
  - [ ] assert `App.jsx` uses real components (not placeholders) for both routes
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

## 12) Test Script and NPM Script Matrix

Add the following scripts in `backend/package.json`:

- `test:cari-pr11`
- `test:cari-pr12`
- `test:cari-pr12-documents-date-filter`
- `test:cari-pr13`
- `test:cari-pr14`
- `test:contracts-pr16`
- `test:revenue-pr17`
- `test:contracts-revenue-pr18`

Update chained scripts:

- Extend `test:cari-quality-gate` with PR-11..14 plus date-filter contract script.
- Add a new chain script:
  - `test:contracts-revenue-gate` -> PR-16 + PR-17 + PR-18
- Optionally extend `test:release-gate` once modules are production-ready.

---

## 13) Recommended Execution Order

1. PR-11
2. PR-12
3. PR-13
4. PR-14
5. PR-15
6. PR-16
7. PR-17 Phase A
8. PR-17 Phase B (`380/480` + `180/280`)
9. PR-17 Phase C (`181/281` + `381/481`)
10. PR-17 Phase D (consolidation reports depth + data-readiness)
11. PR-18 (UI deepening on completed phase data)

Do not start PR-16 before PR-15 is green.
Do not start Phase B before Phase A is green.
Do not start Phase C before Phase B is green.
Do not start Phase D or PR-18 before Phase C is green.

---

## 14) Final Release Checklist

- [ ] `npm run test:cari-quality-gate` passes.
- [ ] `npm run openapi:generate` completed and `backend/openapi.yaml` updated.
- [ ] `docs/runbooks/cari-v1-operations.md` updated with final operational flow.
- [ ] `docs/runbooks/cari-v1-support-finance-ui-guide.md` is present and current.
- [ ] `docs/kullanim-kilavuzlari/cari-islemler-kullanim-kilavuzu.md` reflects final UI.
- [ ] Periodization split (18x/28x/38x/48x) reconciles across subledger, GL, and consolidation.
- [ ] Contracts + periodization test gate passes.
- [ ] No unresolved high-severity permission/tenant-scope issues.


