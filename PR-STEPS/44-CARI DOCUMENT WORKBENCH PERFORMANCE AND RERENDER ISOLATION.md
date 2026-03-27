# 44 — CARI DOCUMENT WORKBENCH PERFORMANCE AND RERENDER ISOLATION

## Status
- Completed (2026-03-28)
- No backend changes — frontend-only refactor
- No UX redesign — behavior-preserving structural split
- No state library migration (no Zustand) — local state stays local
- Follow-up file categorization / folder cleanup is tracked separately in `45-CARI DOCUMENT WORKBENCH FOLDER ORGANIZATION AND IMPORT CLEANUP.md`
- Current `backend/scripts/` release-gate source-inspection updates are explicitly out of scope here and are tracked in `46-CARI DOCUMENT RELEASE-GATE SOURCE-INSPECTION REALIGNMENT.md`
- Design locks confirmed:
  - mechanical extraction first, ownership transfer second
  - every step must leave the page fully working
  - same folder, no subfolder reorganization until split is stable

## Purpose

Break `CariDocumentsPage.jsx` (14,907 lines) from a monolithic god file into an orchestration shell plus isolated section/panel components with co-located controller hooks.

The page currently contains:
- ~4,700 lines of helpers and utilities (lines 95–4772)
- 4 inline component definitions (`FixedAssetQuickCreateModal`, `FixedAssetCategorySetupModal`, `DocumentLineWorkbench`, `BufferedDraftLineTextInput`)
- create, list, detail, edit, post/reverse, comments, evidence, ops-status state domains all co-located in one component function starting at line 4823
- every keystroke in any domain can trigger re-renders across all domains

## Why a Separate Track

1. This is a **structural refactor**, not a feature change
2. It touches only `frontend/src/pages/cari/` — no backend, no migrations, no API changes
3. It must not be interleaved with feature work on the same file (Track 40 charge allocation UI, Track 41 LCV frontend) because merge conflicts would be catastrophic
4. Every subsequent CARI feature (Track 40 LCV05, future line redesign) benefits from this split being done first

## Existing Extracted Files

Already outside the god file (do not re-extract):
- `cariDocumentsUtils.js` (1,345 lines) — form builders, payload builders, validation, charge allocation preview math
- `counterpartyInlineCreate.js` — inline counterparty creation helpers
- `InlineCounterpartyCreateModal.jsx` — counterparty modal component
- `InlineFixedAssetCategoryCreateModal.jsx` — FA category inline create modal
- `cariIdempotency.js` — idempotency key helpers

## Refactor Rules (Locked)

1. **No redesign.** Same layout, same flows, same API calls, same prop shapes.
2. **No store migration.** Keep state local to each controller hook. No Zustand, no context providers.
3. **No giant abstraction pass.** First isolate ownership. Shared helpers come later.
4. **Same folder.** All new files go in `frontend/src/pages/cari/`. No `components/` or `hooks/` subdirectories.
5. **Every step must keep the page working.** No long-lived broken state between steps.
6. **No prop reduction in mechanical extraction steps.** Move components exactly as-is first. Prop cleanup is a separate later concern.
7. **No circular imports.** Extracted child files may import from:
   - `cariDocumentsUtils.js`
   - `cariDocumentsPageHelpers.js`
   - their own local file
   - other extracted child files where appropriate

   Extracted child files must **never** import from `CariDocumentsPage.jsx`. If an extracted component needs shared pure helpers or constants, move those helpers into `cariDocumentsPageHelpers.js` immediately as part of that extraction, or move component-only helpers into the new component file. Do not defer shared helper moves to a later step if that would require importing from the page file.

## Smoke Checklist (Run After Every Step)

Manually verify on **both** `/app/alis-faturalari` (AP) and `/app/satis-faturalari` (AR) after each step completes. `/app/cari-belgeler` is a legacy redirect to `/app/alis-faturalari` — verify the redirect still works but do not use it as the primary smoke route. Both directions must be tested because `CariDocumentsPage` renders with `direction="AP"` or `direction="AR"` and direction-sensitive logic (fixed-asset modes, settlement modes, offset account types) can regress independently.

| # | Check | What to verify |
|---|---|---|
| S1 | List loads | Filters work, pagination works, rows render |
| S2 | Saved views | Load, save, delete saved views |
| S3 | Create draft | All fields, line workbench, item/account/warehouse lookups, tax preview |
| S4 | Edit draft | Select existing draft, modify, save |
| S5 | Cancel draft | Cancel a draft document |
| S6 | Post draft | Post a draft, verify journal created |
| S7 | Reverse posted | Reverse a posted document |
| S8 | Comments panel | Add/view internal comments, mention search |
| S9 | Evidence panel | Upload/download/delete evidence |
| S10 | Ops status | Load and save ops status |
| S11 | FA quick-create | Open fixed asset quick-create modal from line workbench |
| S12 | Inline counterparty | Create counterparty inline from create/edit forms |
| S13 | Charge allocation | Track 40 charge allocation method/targets on AP draft lines |
| S14 | URL deep link | Open with `?documentId=...`, correct row/detail loads, changing selection updates URL, URL selection sync works both directions |
| S15 | FA sale prefill | Open from fixed asset detail prefill route/query, create draft prefilled correctly, prefill query params cleared afterward |
| S16 | Cross-domain clone | Selected document → copy into create draft, cancel-and-copy still lands in correct create state, reverse-and-copy still lands in correct create state |

### Smoke Automation Seed

Use `browser-tests/cari-documents/walk-cari-documents-smoke.mjs` as the reusable browser starting point for future smoke passes on this plan.

Current seed coverage:
- `S1` list load/filter/pagination baseline
- `S2` saved views baseline
- `S3` create draft baseline
- `S4` edit draft baseline
- `S5` cancel draft baseline
- `S6` post draft baseline
- `S7` reverse posted baseline
- `S8` comments panel baseline
- `S9` evidence panel baseline
- `S10` ops status baseline
- `S11` fixed-asset quick-create modal open/close baseline
- `S12` inline counterparty create baseline
- `S13` charge allocation baseline
- `S14` URL deep link baseline
- `S15` fixed-asset sale prefill baseline
- `S16` cross-domain clone baseline
- `/app/cari-belgeler` legacy redirect verification

Current seed behavior:
- runs against both `/app/alis-faturalari` and `/app/satis-faturalari`
- auto-runs fixture bootstrap by default before the browser walk (`CARI_DOCS_SMOKE_BOOTSTRAP=1`)
- keeps screenshots + JSON report under `browser-tests/cari-documents/artifacts/`
- supports env overrides via `CARI_DOCS_SMOKE_*`

Fixture baseline:
- use `browser-tests/cari-documents/seed-cari-documents-fixtures.mjs` to ensure reusable live-tenant smoke fixtures exist before browser-walk runs
- current fixture seed is reset-safe from a tenant baseline where the user + permissions exist: it ensures a dedicated smoke group company, legal entity, default GL/bootstrap artifacts, CARI journal purpose mappings, operating unit, payment term, AFN-defaulted customer/vendor, one warehouse, one stock item card, one fixed-asset depreciation profile, one fixed-asset category, one draft fixed asset, one active fixed asset, one AP draft invoice, and one AR draft invoice
- keeps a JSON report under `browser-tests/cari-documents/cari-documents-fixtures-report.json`
- supports env overrides via `CARI_DOCS_FIXTURE_*`

Current automated baseline passes `40/40` on 2026-03-28 for the full `S1-S16` harness set above.

## Cross-Domain Bridges (Locked)

These page behaviors span multiple domains and must be explicitly handled during section splits. They are not obvious from looking at any single domain in isolation.

### 1. URL/deep-link selection bridge
The page synchronizes `selectedDocumentId` with URL search params. This means the list/detail split is not just local state separation — the page shell must own or explicitly coordinate:
- URL `documentId` read on mount
- Selection → URL sync (when user clicks a row)
- URL → selection sync (when user navigates directly)

**Rule:** `selectedDocumentId` URL synchronization remains page-shell responsibility until list/detail extraction is complete. Do not split URL sync across multiple controllers.

### 2. Fixed-asset sale prefill bridge
The page reads search params to prefill a create draft when navigating from fixed asset detail (sale flow). This means the create section split is not only `fixedDirection` + `onDraftCreated` — there is also search-param-driven prefill logic.

**Rule (locked):** Search-param-driven fixed-asset sale prefill stays in the page shell. The shell owns `useSearchParams`, the pending prefill payload/signature, and consumed-param clearing. It does **not** blindly inject FA sale prefill as static initial props before the create controller is ready. Instead, the shell waits until the create controller reports that default draft-template hydration has settled, then applies the pending sale prefill through a dedicated create-bridge handoff, and only then clears the consumed params. This is locked shell-owned because the prefill depends on search param orchestration, draft-template hydration ordering, and param clearing — keeping it in the shell reduces moving parts during the first ownership transfer (CW06).

The shell must still preserve the current ordering:
- draft templates load first
- default draft template hydration settles first
- fixed-asset sale prefill applies second, exactly once per prefill signature
- the consumed search params are then cleared

Do not let fixed-asset sale prefill race default draft-template hydration or silently lose the create success message.

### 3. Copy-selected-document-to-create bridge
There is a cross-domain "copy selected document into create draft" action that spans detail/list → create. `handleCopySelectedDocumentToCreateForm` reads from the selected detail and writes into the create form.

**Rule:** `handleCopySelectedDocumentToCreateForm` stays in the page shell initially. It is not moved into the create controller or detail controller until a clear bridge contract is defined. The page shell calls into the registered create bridge API when the user triggers a copy action.

### 4. Cancel-and-copy / reverse-and-copy bridge
Similar to the copy bridge above, `handleCancelAndCopyDraft` and `handleReverseAndCopyPosted` read from the current detail and populate a new create draft. These span the edit/post-reverse → create boundary.

**Rule:** The create-prefill bridge stays in the page shell, but mutation execution stays with the domain that owns the visible UX state:
- `handleCancelAndCopyDraft` — stays in shell (crosses into create domain)
- `handleCopySelectedDocumentToCreateForm` — stays in shell (crosses into create domain)

`handleCancelDraft` is handled separately below because it shares visible cancel UX state with `handleCancelAndCopyDraft`.

`handleReversePosted` and `handleReverseAndCopyPosted` both stay in the post/reverse controller because they share the same reverse form and reverse UX state. `handleReverseAndCopyPosted` may still request create-prefill through a shell callback after reverse succeeds.

### 5. Shared FA quick-create modal bridge
The `FixedAssetQuickCreateModal` is not create-only or edit-only. One shared modal state (`quickCreateFixedAssetOpen`, `quickCreateFixedAssetForm`, `quickCreateFixedAssetSaving`, `quickCreateFixedAssetError`) drives both `openCreateQuickCreateFixedAsset` (line ~7231) and `openEditQuickCreateFixedAsset` (line ~7553). The save handler `handleQuickCreateFixedAssetSave` (line ~7587) inspects `quickCreateFixedAssetForm.scope` and writes back into either `setCreateForm` or `setEditForm` depending on scope.

**Rule:** This shared modal state stays in the page shell through at least CW09 (edit panel split). The page shell owns:
- `quickCreateFixedAssetOpen`, `quickCreateFixedAssetForm`, `quickCreateFixedAssetSaving`, `quickCreateFixedAssetError`
- `openQuickCreateFixedAssetModal(context)` — shell-owned function that stores the pre-built context and opens the modal (see context-snapshot pattern below)
- `handleQuickCreateFixedAssetSave` — calls the appropriate registered bridge API (`createBridgeApi` or `editBridgeApi`) based on `scope` in the stored context; do not pass raw form setters into the shell
- `closeQuickCreateFixedAssetModal`, `patchQuickCreateFixedAssetForm`
- The `<FixedAssetQuickCreateModal />` mount point stays in the page shell JSX

Do not move this modal state into either the create or edit controller until both sides are split and a clear ownership contract exists.

**Context-snapshot-at-open-time pattern (locked):**
Today `openCreateQuickCreateFixedAsset(rowId)` (line ~7231) and `openEditQuickCreateFixedAsset(rowId)` (line ~7553) are shell functions that read domain form state (`createForm.lines`, `editForm.lines`, `createForm.legalEntityId`, etc.) to build the quick-create prefill. After domain splits, the shell no longer has access to `createForm` or `editForm`.

**Solution:** The child section reads its own form state and passes a pre-built scalar/source context object when requesting the modal open:
```js
// Inside create section (or edit panel):
onOpenQuickCreateAsset({
  scope: 'create',           // or 'edit'
  lineRowId,
  legalEntityId,
  documentDate,
  currencyCode,
  lineData: { description, amount, ... },  // line-level prefill fields
})
```
The shell stores this scalar/source snapshot in `quickCreateFixedAssetForm` (extended to hold the context fields). `handleQuickCreateFixedAssetSave` uses the stored snapshot for API payload construction (`legalEntityId`, `documentDate`, `currencyCode`) and line-targeting (`scope`, `lineRowId`). The active create/edit bridge API additionally exposes a live quick-create lookup snapshot (`getQuickCreateLookupContext()` or equivalent) that returns the current `categoryRows`, `categoryOptions`, `categoriesById`, and `operatingUnitOptions` for the stored `scope`. The shell modal render path and save handler must resolve those live lookup collections from the active bridge rather than treating them as permanently frozen open-time data, so `fixedAssetCategoryRefreshToken` / window-focus refreshes still update the modal while it is open. On save completion, the shell calls the appropriate bridge API (`createBridgeApi.applyQuickCreatedFixedAsset(...)` or `editBridgeApi.applyQuickCreatedFixedAsset(...)`) based on the stored `scope`.

This pattern also applies to `quickCreateSourceForm` / `quickCreateCategoryOptions` / `quickCreateOperatingUnitOptions` (line ~11682), which currently derive from `editForm`/`createForm` based on scope — after the split the scalar/source fields move into the open-time context snapshot, while the lookup collections move behind the active child bridge API so they can stay live.

**Execution breadcrumb:** the shell JSX that mounts `<FixedAssetQuickCreateModal />` currently passes `legalEntityId`, `acquisitionDate`, `currencyCode`, `categoryOptions`, `operatingUnitOptions`, and `categoriesById` via `quickCreateSourceForm` / `quickCreateCategoryOptions` / `quickCreateOperatingUnitOptions`. During CW06/CW09 this prop wiring must be rewritten to resolve from the stored scalar snapshot plus the active bridge-provided live lookup context. Do not leave any direct `createForm` / `editForm` / create-edit-lookup references in the shell modal props after those ownership transfers.

### 6. Shared FA category setup and inline category creation bridge
`fixedAssetCategorySetupPrompt`, `inlineFixedAssetCategoryCreateContext`, and `fixedAssetCategoryRefreshToken` (line ~5498–5502) are shared across create and edit. `handleInlineFixedAssetCategoryCreated` (line ~7459) writes into both `setCreateFixedAssetCategoryRows` and `setEditFixedAssetCategoryRows` depending on `legalEntityId` match. There is also a `window focus` / `visibilitychange` listener (line ~5544) that triggers `refreshFixedAssetCategoryLookups` across both domains.

**Rule:** This shared state stays in the page shell through at least CW09. The page shell owns:
- `fixedAssetCategorySetupPrompt` and its setter
- `inlineFixedAssetCategoryCreateContext` and its setter
- `fixedAssetCategoryRefreshToken` and `refreshFixedAssetCategoryLookups`
- `openInlineFixedAssetCategoryCreate(context)` — shell-owned opener that receives a pre-built `{ scope, rowId, legalEntityId, initialName }` context from the active create/edit child; do not pass raw `rowId` alone after the split
- `requestFixedAssetCategorySetup(issue)` — shell-owned callback used when create/edit line-category selection or quick-create validation detects missing category defaults and needs to open the shared setup modal
- `handleInlineFixedAssetCategoryCreated` — calls the registered create/edit bridge APIs rather than mutating child form state through raw setters
- `handleInlineFixedAssetCategoryCreated` must tolerate a missing target bridge registration: if the relevant create/edit bridge is unavailable, the shell still clears modal context, refreshes category lookups, and exits without throwing. The newly created category row should still become visible through the next lookup reload even when no form bridge is active.
- The `<InlineFixedAssetCategoryCreateModal />` and `<FixedAssetCategorySetupModal />` mount points stay in page shell JSX
- The window focus/visibility listener stays in the page shell

### 7. Detail model: `selectedSnapshot` vs `selectedDetailForPosting`
The page does not rely solely on `selectedDetail`. It synthesizes:
- `selectedRow` — the matching row from the list `rows` array (line ~5799)
- `selectedSnapshot = selectedDetail || selectedRow` — used for instant UI/action gating before detail finishes loading (line ~5803)
- `selectedDetailForPosting` — a strict memo that only resolves when `selectedDetail.id === selectedDocumentId`, used for posting-specific behavior where incomplete data is dangerous (line ~5993)

**Rule:** The detail split must preserve this dual model:
- `selectedSnapshot` provides instant row-backed UI before full detail loads. It must remain available to the page shell and to any panel that gates UI actions.
- `selectedDetailForPosting` must be the only input to post/reverse logic. Do not feed `selectedSnapshot` (which may be a list row without full detail) into posting/reversal handlers.
- During CW08, the detail controller should expose both `selectedDetail` and `selectedDetailForPosting`. The page shell synthesizes `selectedSnapshot` from `selectedDetail || selectedRow` (where `selectedRow` comes from the list controller).

## Controller Isolation and Bridge Registration Pattern (Locked)

True rerender isolation requires domain state to live below the page shell. Moving domain state into custom hooks but instantiating those hooks in `CariDocumentsPage.jsx` would still rerender the shell on every create/edit/detail/list state change.

**Rule:**
- `useCariDocumentCreateController` lives inside `CariDocumentsCreateSection.jsx`
- `useCariDocumentsListController` lives inside `CariDocumentsListSection.jsx`
- `useCariDocumentDetailController` lives inside `CariDocumentsDetailSection.jsx`
- `useCariDocumentEditController` lives inside `CariDocumentEditPanel.jsx`
- `useCariDocumentPostReverseController` lives inside `CariDocumentPostReversePanel.jsx`

The page shell may still coordinate cross-domain bridges, but only through narrow bridge APIs registered upward from child sections/panels. The shell stores bridge refs and lightweight snapshots, not the full child domain state.

Shell-owned bridge registrations use refs rather than state unless the registration must trigger visible UI updates. The shell stores only minimal cross-domain snapshots and bridge handles, not mirrored child controller state.

**Bridge registration pattern:**
- Create section registers a minimal create bridge API used by shell-owned copy / FA-sale-prefill / FA quick-create / FA category flows. Expected methods include `prefillCreateForm(sourceRow, options)`, `applyPendingFixedAssetSalePrefill(prefill, options)`, `isReadyForShellPrefill()`, `getQuickCreateLookupContext()`, `applyQuickCreatedFixedAsset(...)`, and `applyInlineFixedAssetCategory(...)`. `prefillCreateForm` is the bridge-era home of the current shell helper `copyDocumentIntoCreateDraft(sourceRow, options)`: it executes the full clone/correction flow, builds the cloned form via `buildCloneDraftFormFromRow`, applies it through `applyCreateDraftFormSnapshot` (resetting touched flags, validation, counterparty/line-preview state), sets `draftTemplatesMessage` from `options.message`, and scrolls to the create section. It is not a thin setter. `applyPendingFixedAssetSalePrefill(...)` is the dedicated shell-to-create handoff for FA sale prefill after template hydration settles; it is not treated as a static constructor prop.
- List section reports the current `selectedRow` snapshot upward whenever row selection changes or reloads affect the selected row, so the shell can preserve `selectedSnapshot = selectedDetail || selectedRow`.
- Detail section reports `selectedDetail` and `selectedDetailForPosting` upward when detail load/selection state changes, and registers a minimal detail bridge API used to apply immediate mutation-result rows before the authoritative refresh. **Reverse mutation caveat:** the reverse API returns `response.row` = the new reversal document (different document ID) and `response.original` = the original document after being marked reversed. Do not feed `response.row` into `applyMutationResultRow` for reverse — either apply `response.original`, or skip optimistic replacement entirely and rely on `requestDetailRefresh()`. The generic `applyMutationResultRow(response.row)` path is only safe for update, cancel, and post, where `response.row` is the same document.
- Edit panel registers a minimal edit bridge API used by shell-owned FA quick-create / FA category flows. Expected methods include `getQuickCreateLookupContext()`, `applyQuickCreatedFixedAsset(...)`, and `applyInlineFixedAssetCategory(...)`.

This keeps shell-level bridges honest without forcing the shell to own the full domain controllers.

## Refresh Orchestration Pattern (Locked)

After section splits, child sections/panels need to trigger list and detail refreshes without holding references to raw `loadDocuments` / `loadDocumentDetail` functions.

**Pattern:**
- Page shell owns `listRefreshToken` (a counter or timestamp)
- Page shell owns `detailRefreshToken` (a counter or timestamp)
- Create/edit/post/reverse panels call `requestListRefresh()` / `requestDetailRefresh()` callbacks provided by the page shell
- List controller reloads when `listRefreshToken` changes
- Detail controller reloads when `detailRefreshToken` changes

This is cleaner than passing raw loaders around and avoids stale closure bugs.

## Target End State

```text
frontend/src/pages/cari/
  CariDocumentsPage.jsx              ← orchestration shell (aspirational ~200–500 lines, may be larger due to bridge handlers)

  # Helper seed + bulk helpers
  cariDocumentsPageHelpers.js        ← all pure helpers/constants extracted from page

  # Mechanical extractions
  DocumentLineWorkbench.jsx          ← extracted inline component
  BufferedDraftLineTextInput.jsx     ← extracted inline component
  FixedAssetQuickCreateModal.jsx     ← extracted inline component
  FixedAssetCategorySetupModal.jsx   ← extracted inline component

  # Section components + controllers
  CariDocumentsCreateSection.jsx
  useCariDocumentCreateController.js
  CariDocumentsListSection.jsx
  useCariDocumentsListController.js
  CariDocumentsDetailSection.jsx
  useCariDocumentDetailController.js
  CariDocumentEditPanel.jsx
  useCariDocumentEditController.js
  CariDocumentPostReversePanel.jsx
  useCariDocumentPostReverseController.js
  CariDocumentRelatedPanel.jsx
  CariDocumentCommentsPanel.jsx
  useCariDocumentCommentsController.js
  CariDocumentEvidencePanel.jsx
  useCariDocumentEvidenceController.js
  CariDocumentOpsStatusPanel.jsx
  useCariDocumentOpsStatusController.js

  # Line-level rerender isolation
  DocumentLineRow.jsx

  # Already extracted (unchanged)
  cariDocumentsUtils.js
  counterpartyInlineCreate.js
  InlineCounterpartyCreateModal.jsx
  InlineFixedAssetCategoryCreateModal.jsx
  cariIdempotency.js
```

## Execution Tracking

| Step | Scope | Status |
|---|---|---|
| CW00 | Helper seed: create `cariDocumentsPageHelpers.js` with minimal subset needed by CW01–CW04 | Completed (2026-03-27) |
| CW01 | Extract `FixedAssetQuickCreateModal` to own file | Completed (2026-03-27) |
| CW02 | Extract `FixedAssetCategorySetupModal` to own file | Completed (2026-03-27) |
| CW03 | Extract `BufferedDraftLineTextInput` to own file | Completed (2026-03-27) |
| CW04 | Extract `DocumentLineWorkbench` to own file | Completed (2026-03-27) |
| CW05 | Bulk move remaining pure helpers into `cariDocumentsPageHelpers.js` | Completed (2026-03-27) |
| CW06 | Create section + controller split | Completed (2026-03-27) |
| CW07 | List section + controller split | Completed (2026-03-27) |
| CW08 | Detail section shell + controller | Completed (2026-03-27) |
| CW09 | Edit panel + controller split | Completed (2026-03-27) |
| CW10 | Post/reverse panel + controller split | Completed (2026-03-27) |
| CW11 | Side panels split (related, comments, evidence, ops) | Completed (2026-03-27) |
| CW12 | `DocumentLineRow` extraction for rerender isolation | Completed (2026-03-28) |
| CW13 | Final cleanup + smoke verification | Completed (2026-03-28) |

---

## `STEP-CW00` — Helper seed: create `cariDocumentsPageHelpers.js`

### Patch target
- `frontend/src/pages/cari/cariDocumentsPageHelpers.js` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (replace moved helpers with imports)

### Purpose
Create the helpers file early with only the minimal subset of pure helpers and constants needed by CW01–CW04. This ensures every subsequent extraction can import shared helpers from a non-page file from day one, preventing any circular import between extracted children and the page.

### How to identify the seed subset
Before executing CW01–CW04, audit each inline component to collect every helper/constant it references from the page file. The union of those references — minus anything already in `cariDocumentsUtils.js` — is the seed set.

The following list is a **search guide**, not a "move all of these" mandate. CW00 must be truly minimal: only the union of helpers/constants actually referenced by the CW01–CW04 component bodies. Audit each component to build the real seed set. Do not inflate CW00 into a hidden CW05.

Search guide for likely seed candidates (verify each by reading the component body):
- Constants: `FIXED_ASSET_AR_ELIGIBLE_STATUSES`, `FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES`, `FIXED_ASSET_AP_MODE_OPTIONS`, `DOCUMENT_LINE_EXPANSION_LIMIT`, `LINE_TEXT_INPUT_COMMIT_DELAY_MS`, `POSTING_LINE_AMOUNT_EPSILON`, route path constants, `FIXED_ASSET_*` constants, `INVENTORY_*_ROUTE` constants
- FA category helpers: `getFixedAssetCategoryDefault*` family, `formatFixedAssetCategoryDisplay`, `buildFixedAssetCategorySetupIssue`, `getFixedAssetCategorySetupIssue`, `formatFixedAssetCategorySetupRequirementLabel`, `formatFixedAssetCategorySetupRequirementList`, `upsertFixedAssetCategoryRow`
- Display formatters: `formatPostableAccountDisplay`, `formatFixedAssetStatusLabel`, `formatFixedAssetLifeMonths`, `formatFixedAssetCategoryDisplayFromAssetRow`, `formatOperatingUnitDisplay`, `formatWarehouseDisplay`, `formatFixedAssetTransactionTypeLabel`
- Lookup mappers: `mapPostableAccountRows`, `mapItemCardLookupOptions`, `mapWarehouseLookupOptions`, `mapFixedAssetCategoryLookupOptions`, `mapFixedAssetLookupOptions`
- Option extenders: `extendAccountOptionsForSelectedLines`, `extendItemCardOptionsForSelectedLines`, `extendWarehouseOptionsForSelectedLines`, `extendFixedAssetCategoryOptionsForSelectedLines`, `extendFixedAssetOptionsForSelectedLines`
- Transition builders: `buildChargeAllocationMethodTransitionPatch`, `buildItemCardSelectionTransitionPatch`, `buildSubledgerTypeTransitionPatch`, `buildFixedAssetModeTransitionPatch`, `expandAutoCreateFixedAssetLine`
- Small utilities: `toPositiveInt`, `normalizeText`, `todayIsoDate`, `firstDefinedRowValue`, `toPositiveDecimal`, `roundDocumentUiAmount`, `amountsMatch`, `normalizeChargeAllocationMethod`, `resolveLineDefaultsFromItemCard`, `getDefaultStockImpactModeForDirection`, `analyzeDocumentWarehouseBindings`, `resolveFixedAssetDisplayAccountId`, `allocateAmountAcrossUnits`, `buildChargeTargetDrafts`
- Draft form helpers: `createInitialQuickCreateFixedAssetForm` (used by both the modal AND page-level quick-create state/reset flows — do not treat as modal-only), `createInitialDraftForm`, `buildDirectionScopedDraftForm`, `resetDocumentLineTaxPreview`

### How to execute
1. Create `cariDocumentsPageHelpers.js` with named exports for each identified helper/constant.
2. In `CariDocumentsPage.jsx`, replace the moved inline definitions with `import { ... } from "./cariDocumentsPageHelpers.js"`.
3. Verify no circular imports. The helpers file must not import from any `.jsx` component file.
4. Run full smoke checklist — nothing should change behaviorally.

### What stays in the page file after this step
- All React component definitions (the 4 inline components — they move in CW01–CW04)
- All `useState`/`useEffect`/`useCallback`/`useMemo` declarations
- All handler functions that reference component state
- Any helper that is only used inside the main component function body (closures over state)

### Risk assessment
- **Low risk.** Pure function moves only. Every function in the seed is defined above line 4823 (the component function), confirming they do not close over component state.
- The only risk is missing a reference — mitigated by running the full smoke checklist.

### Definition of done
- `cariDocumentsPageHelpers.js` exists with the seed subset exported
- `CariDocumentsPage.jsx` imports from the helpers file
- No circular imports
- All S1–S16 smoke checks pass

---

## `STEP-CW01` — Extract `FixedAssetQuickCreateModal`

### Patch target
- `frontend/src/pages/cari/FixedAssetQuickCreateModal.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~1984 in `CariDocumentsPage.jsx`

### How to execute
1. Create `FixedAssetQuickCreateModal.jsx`.
2. Copy the `FixedAssetQuickCreateModal` function component exactly as-is, preserving all props.
3. Add imports at the top of the new file:
   - React hooks
   - UI primitives used by the modal
   - Helpers/constants from `cariDocumentsPageHelpers.js` (moved in CW00)
   - Helpers from `cariDocumentsUtils.js` if any
4. In `CariDocumentsPage.jsx`, replace the inline definition with `import FixedAssetQuickCreateModal from "./FixedAssetQuickCreateModal.jsx"`.
5. Delete the old inline definition from the page file.
6. **Do not rename any props.**

### Important: `createInitialQuickCreateFixedAssetForm`
This helper is used by both the modal AND the page-level quick-create state/reset flows. It was already moved to `cariDocumentsPageHelpers.js` in CW00. Both the modal and the page import it from there.

### Dependency audit before executing
- Read the modal function body to identify every reference
- Every helper/constant reference must resolve to either `cariDocumentsPageHelpers.js`, `cariDocumentsUtils.js`, or the modal's own file
- **No imports from `CariDocumentsPage.jsx`**

### Risk assessment
- **Low risk.** Mechanical copy-paste extraction. The modal is self-contained (portal/overlay).

### Definition of done
- `FixedAssetQuickCreateModal.jsx` exists as a standalone file
- Imports only from `cariDocumentsPageHelpers.js`, `cariDocumentsUtils.js`, shared libs — never from page file
- `CariDocumentsPage.jsx` imports and uses it identically
- Smoke checks S3, S4, S11 pass

---

## `STEP-CW02` — Extract `FixedAssetCategorySetupModal`

### Patch target
- `frontend/src/pages/cari/FixedAssetCategorySetupModal.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~2223 in `CariDocumentsPage.jsx`

### How to execute
Same mechanical extraction pattern as CW01:
1. Create the new file.
2. Copy the component exactly as-is.
3. Add imports from `cariDocumentsPageHelpers.js` and `cariDocumentsUtils.js` — the FA category setup helpers (`buildFixedAssetCategorySetupIssue`, `getFixedAssetCategorySetupIssue`, `formatFixedAssetCategorySetupRequirementLabel`, `formatFixedAssetCategorySetupRequirementList`) were moved to helpers in CW00.
4. Replace inline definition with import in page file.
5. Do not change any props.

### Dependency audit before executing
- **No imports from `CariDocumentsPage.jsx`.**

### Risk assessment
- **Low risk.** Same mechanical extraction pattern.

### Definition of done
- `FixedAssetCategorySetupModal.jsx` exists as a standalone file
- Imports only from helpers files — never from page file
- Smoke checks S3, S4, S11 pass

---

## `STEP-CW03` — Extract `BufferedDraftLineTextInput`

### Patch target
- `frontend/src/pages/cari/BufferedDraftLineTextInput.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~4404 in `CariDocumentsPage.jsx`
- Small component (~60 lines). References `LINE_TEXT_INPUT_COMMIT_DELAY_MS` (already in `cariDocumentsPageHelpers.js` from CW00).

### How to execute
1. Create the new file.
2. Copy the component exactly.
3. Import `LINE_TEXT_INPUT_COMMIT_DELAY_MS` from `cariDocumentsPageHelpers.js`.
4. Replace inline definition with import in page file.

### Risk assessment
- **Low risk.** Very small, self-contained component.

### Definition of done
- `BufferedDraftLineTextInput.jsx` exists
- Imports only from helpers files — never from page file
- Smoke checks S3, S4 pass

---

## `STEP-CW04` — Extract `DocumentLineWorkbench`

### Patch target
- `frontend/src/pages/cari/DocumentLineWorkbench.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~2326 in `CariDocumentsPage.jsx`
- This is the **largest inline component** (~2,000+ lines to line ~4403)

### How to execute
1. Create `DocumentLineWorkbench.jsx`.
2. Copy the entire `DocumentLineWorkbench` function component exactly as-is.
3. Add imports:
   - Helpers/constants from `cariDocumentsPageHelpers.js` (seeded in CW00)
   - Helpers from `cariDocumentsUtils.js`
   - `BufferedDraftLineTextInput` from `./BufferedDraftLineTextInput.jsx` (extracted in CW03)
4. Replace inline definition with import in page file.
5. Do not change any props.

The workbench should continue to use shell-provided callbacks for FA quick-create / FA category flows. Do not import or mount `FixedAssetQuickCreateModal` or `FixedAssetCategorySetupModal` inside the workbench unless a new direct render dependency is discovered during extraction.

### Dependency audit before executing (critical)
- The workbench references many helpers from lines 95–1984. Every one of these must already be in `cariDocumentsPageHelpers.js` (from CW00) or `cariDocumentsUtils.js`.
- If CW00 missed any helper the workbench needs, add it to `cariDocumentsPageHelpers.js` as part of this step — do not import from `CariDocumentsPage.jsx`.
- **No imports from `CariDocumentsPage.jsx`.** This is the hardest extraction to get right because the workbench has the most helper dependencies. The CW00 seed step exists specifically to make this step safe.

### Risk assessment
- **Medium risk.** Largest extraction. The workbench has deep prop dependency on the parent.
- Mitigation: CW00 already moved shared helpers to the helpers file. This step should be purely mechanical if CW00 was thorough.
- Key remaining risk: missing a helper reference. Run S3, S4, S13 immediately after.

### Definition of done
- `DocumentLineWorkbench.jsx` exists as a standalone file
- Imports only from `cariDocumentsPageHelpers.js`, `cariDocumentsUtils.js`, other extracted components — never from page file
- All smoke checks pass, especially S3, S4, S13

---

## `STEP-CW05` — Bulk move remaining pure helpers into `cariDocumentsPageHelpers.js`

### Patch target
- `frontend/src/pages/cari/cariDocumentsPageHelpers.js` (extend)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (shrink)

### Purpose
CW00 moved the seed subset needed by CW01–CW04. This step moves everything else that is a pure function or constant and was not already moved.

### In scope
Move all remaining **pure functions** (no hooks, no React, no component state) from `CariDocumentsPage.jsx` into `cariDocumentsPageHelpers.js`. After CW00, the remaining candidates are typically:

1. **Page-level formatters and normalizers** not needed by the inline components but used by handlers/JSX:
   - `normalizeDirection`, `normalizeCurrencyCode`, `normalizePositiveIntText`, `normalizeOptionalDecimalText`, `normalizeDocumentSettlementMode`, `normalizeRecurringCadence`, `normalizeRecurringInterval`, `normalizeRecurringAnchorDay`, `normalizeApiError`, `normalizeTranslatedApiError`, `normalizeInventoryReverseBlocks`, `translateDocumentMutationLineErrorMap`
2. **Lookup mappers not in the seed**: `mapCounterpartyLookupOption`, `mapLegalEntityLookupOption`, `mapPaymentTermLookupOption`, `mapOperatingUnitLookupOption`, `mapCashRegisterLookupOptions`, `extendCashRegisterOptionsForSelectedValue`
3. **Builder/factory helpers**: `buildInitialPostForm`, `createPostingLineDraft`, `buildRowsById`, `buildOperatingUnitsById`, `getDocumentOperatingUnitLabel`, `buildDocumentLifecycleEvents`, `buildFixedAssetSaleCreatePrefill`, `clearFixedAssetSaleCreatePrefill`, `buildTaxCategoryOptions`, `resolvePaymentTermDueDateCandidate`, `addDaysToIsoDate`
4. **Draft/template/saved-view builders**: `buildTemplateSafeDraftForm`, `buildRecurringTemplateRule`, `createInitialRecurringTemplateRule`, `buildDocumentDraftTemplateDefinition`, `resolveDocumentDraftTemplateState`, `buildCloneDraftFormFromRow`, `normalizeVisibleColumnIds`, `buildDocumentSavedViewDefinition`, `resolveDocumentSavedViewState`
5. **Status/predicate helpers**: `isDraft`, `isPosted`, `isImmediateCashSettled`, `canReverseDocument`, `resolveCounterpartyRoleFromDirection`, `isImmediateCashSettlementMode`, `getImmediateCashSettlementLabel`, `documentUsesStoredLineTaxes`
6. **Comment helpers**: `getInternalCommentMentionDraft`, `shouldInsertMentionSpacer`, `INTERNAL_COMMENT_MENTION_REGEX`
7. **Display helpers**: `formatDateTime`, `formatFileSize`, `formatCashRegisterLookupLabel`, `formatReadinessReason`
8. **Page-title helpers**: `resolveRouteFixedDirection`, `resolveOffsetAccountTypeByDirection`, `getDocumentPageTitle`, `getCreateDraftDocumentTitle`
9. **Remaining constants**: `DEFAULT_FILTERS`, `DOCUMENT_FILTER_CONTEXT_MAPPINGS`, `DOCUMENT_CREATE_CONTEXT_MAPPINGS`, `DOCUMENT_*` storage/module constants, `DOCUMENT_RECURRING_TEMPLATE_CADENCES`, `DOCUMENT_EXPORT_COLUMNS`, `DOCUMENT_TABLE_*` constants

### How to execute
1. Add remaining pure functions/constants to `cariDocumentsPageHelpers.js` as named exports.
2. In `CariDocumentsPage.jsx`, replace inline definitions with imports.
3. Update any previously extracted files (CW01–CW04) if they also reference newly moved helpers.
4. Verify no circular imports.

### Risk assessment
- **Medium risk.** Large number of moves but each is mechanical. The risk is moving a function that secretly closes over component state.
- Mitigation: every function moved in this step is defined above line 4823 (before the component function), confirming no state closures.

### Execution caution
CW05 is **not** "move everything above line 4823." Keep the boundary strict:
- move only demonstrably pure helpers/constants
- stop immediately if a candidate touches React state, refs, setters, navigation, search params, storage, timers, DOM/window listeners, API calls, or any other side effect
- if a helper is ambiguous, leave it in `CariDocumentsPage.jsx` until a later ownership split makes its boundary obvious

### Definition of done
- `cariDocumentsPageHelpers.js` contains all pure helpers and constants
- `CariDocumentsPage.jsx` contains only: the component function, state declarations, handler functions (which reference state), and JSX
- Page file is ~5,000–7,000 lines (component function + state + handlers + JSX only)
- All extracted files import from helpers file, never from page file
- All S1–S16 smoke checks pass

---

## `STEP-CW06` — Create section + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentCreateController.js` (new)
- `frontend/src/pages/cari/CariDocumentsCreateSection.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove create state/handlers/JSX, render section component)

### State to move into `useCariDocumentCreateController`
All `useState`/`useMemo`/`useCallback`/`useEffect` declarations related to create:
- `createForm` and its setter
- `createContextDefaultsSuspended`
- `createValidation`, `createMessage`, `createError`, `createLoading`, `createSaving`
- Payment-term / due-date / currency touched flags
- `createOperatingUnitOverrideOpen`
- Create-specific lookup option states (counterparty, legal entity, account, item card, warehouse, FA category, FA asset, payment term, operating unit, tax rule, cash register)
- Create-specific lookup loaders
- Create line preview states (tax preview, line expansion)
- Recurring template state
- Draft template state and handlers (~lines 11218–11405)
- Inline counterparty create state for create form
- The create-side `useWorkingContextDefaults(setCreateForm, DOCUMENT_CREATE_CONTEXT_MAPPINGS, ...)` wiring and the derived counterparty-primary operating-unit behavior
- All `handleCreate*` functions
- `handleCreateDraft`, `handleInlineCreateCounterpartyForCreateForm`, `handleInlineCounterpartyCreatedForCreateForm`

### JSX to move into `CariDocumentsCreateSection`
The entire create card/form block from the page's JSX return. This includes:
- Create header fields (direction, legal entity, counterparty, document type, dates, currency, FX, settlement mode)
- Create recurring/template controls
- Inline counterparty button/modal trigger
- Create `DocumentLineWorkbench` instance
- Submit/reset area
- Create validation/error/message display blocks

### Controller hook interface
```js
// useCariDocumentCreateController({ fixedDirection, onDraftCreated }) returns:
{
  createForm, setCreateForm,
  createSaving, createError, createMessage,
  // lookup options and loaders
  // handlers
  handleCreateDraft,
  resetCreateForm,
  prefillCreateForm,   // for cross-domain clone/prefill bridges
  // ... all create-domain state
}
```

### Controller instantiation (locked)
`useCariDocumentCreateController` is instantiated inside `CariDocumentsCreateSection.jsx`, **not** in `CariDocumentsPage.jsx`. The section registers a narrow create bridge API upward to the shell so cross-domain handlers can call `prefillCreateForm(...)` and the FA bridge methods without forcing create state into the shell.

### What stays in the page shell
- `fixedRouteDirection` and URL search params handling
- `selectedDocumentId` and URL sync
- Create-success selection handoff: when the create section reports success, the shell sets `selectedDocumentId` to the new document id (and may seed `selectedRow` from `responseRow`) before/alongside refresh orchestration so detail load and URL synchronization remain unchanged
- `listRefreshToken`, `detailRefreshToken` and their incrementors
- `cancelSaving` and `cancelError` — shell-owned because plain cancel and cancel-and-copy share the same visible UX state
- Shared FA quick-create modal state (bridge #5) — `quickCreateFixedAssetOpen`, form, saving, error, open/close/save handlers
- Shared FA category setup/inline create state (bridge #6) — `fixedAssetCategorySetupPrompt`, `inlineFixedAssetCategoryCreateContext`, `fixedAssetCategoryRefreshToken`, window focus listener
- `<FixedAssetQuickCreateModal />`, `<InlineFixedAssetCategoryCreateModal />`, `<FixedAssetCategorySetupModal />` mount points
- Cross-domain copy bridges:
  - `handleCopySelectedDocumentToCreateForm` — calls `createBridgeApi.prefillCreateForm(...)`
  - `handleCancelDraft` — stays in shell, updates shell-owned cancel UX state, applies the returned `responseRow` through `detailBridgeApi.applyMutationResultRow(...)`, then requests list/detail refresh
  - `handleCancelAndCopyDraft` — stays in shell, updates shell-owned cancel UX state, applies the returned `responseRow` through `detailBridgeApi.applyMutationResultRow(...)`, then calls `createBridgeApi.prefillCreateForm(...)` and requests list/detail refresh
  - `requestCreatePrefill(sourceRow, options)` — shell-owned helper that uses `createBridgeApi.prefillCreateForm(...)`; used by copy flows and by the post/reverse panel after a successful reverse-and-copy
  - Fixed-asset sale prefill from search params — stays in page shell (locked). The shell reads `useSearchParams`, stores the pending sale-prefill payload/signature, waits until `createBridgeApi.isReadyForShellPrefill()` reports that default draft-template hydration has settled, then calls `createBridgeApi.applyPendingFixedAssetSalePrefill(...)`, and only after that clears the consumed params. This is locked shell-owned because the prefill depends on `useSearchParams`, create readiness orchestration, and param clearing — moving it into the create controller would add unnecessary complexity during the first ownership transfer

**Sequencing note for shell-owned cancel flows:**
- Before CW07 completes, `handleCancelDraft` and `handleCancelAndCopyDraft` must stop calling `loadDocuments(filters)` directly and switch to `requestListRefresh()`, because CW07 moves both `filters` and `loadDocuments` into the list controller.
- Before CW08 completes, those same shell handlers must stop calling `setSelectedDetail(response?.row || null)` directly and switch to `detailBridgeApi.applyMutationResultRow(response?.row)` for same-document optimistic replacement, followed by normal refresh orchestration.
- Do not defer either conversion to CW13 cleanup; the shell handlers must remain valid at the end of each ownership-transfer step.

### Communication contract
- Create section receives: `fixedDirection`, `fixedAssetCategoryRefreshToken`, `onDraftCreated({ documentId, responseRow })` callback, `onOpenQuickCreateAsset(context)` callback (bridge #5 context-snapshot pattern), `onOpenInlineFixedAssetCategoryCreate(context)` callback, `onRequestFixedAssetCategorySetup(issue)` callback, and `registerCreateBridgeApi(api)` for shell-owned bridges
- Create section does NOT need list state, detail state, edit state, or any other domain
- Page shell sets `selectedDocumentId` from `documentId` on create success, may seed `selectedRow` from `responseRow`, and calls `requestListRefresh()` inside `onDraftCreated`

### Risk assessment
- **High risk — highest value step.** This is the first ownership transfer. The create form is the largest state domain.
- Mitigation: move state declarations one-by-one, keeping the page working after each cluster. Test S3, S12, S15, S16 after each sub-move.
- Key danger: functions that reference both create state AND other state (e.g., a shared legal entity change handler). These must be identified and either duplicated or passed as callbacks.

### Definition of done
- `CariDocumentsPage.jsx` renders `<CariDocumentsCreateSection />` with a small prop interface
- Create form typing does not trigger re-renders in list/detail/edit domains
- Smoke checks S3, S12, S13, S15, S16 pass
- Page file shrinks by ~2,000–3,000 lines

---

## `STEP-CW07` — List section + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentsListController.js` (new)
- `frontend/src/pages/cari/CariDocumentsListSection.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove list state/handlers/JSX)

### State to move into `useCariDocumentsListController`
- `filters` and its setter
- `filterContextDefaultsSuspended`
- `rows`, `totalRows`, `listLoading`, `listError`
- Filter option states
- Pagination state
- Saved views state
- Visible columns / table preferences / active popover state
- `loadDocuments` and supporting data fetchers
- Filter lookup loaders
- The list-side `useWorkingContextDefaults(setFilters, DOCUMENT_FILTER_CONTEXT_MAPPINGS, ...)` wiring
- Saved view handlers (~lines 11419–11606)
- Table preference handlers (~lines 11617–11665)
- Export handler

### Controller hook interface
```js
// useCariDocumentsListController({ fixedDirection, listRefreshToken }) returns:
{
  rows, totalRows, listLoading, listError,
  // filter/pagination/saved view state
  // handlers
  loadDocuments,  // also triggered by listRefreshToken changes
}
```

The controller watches `listRefreshToken` and reloads when it changes. The page shell increments the token when create/edit/post/reverse actions complete.

**Required cutover during CW07:** any shell-owned mutation handler that still calls `loadDocuments(filters)` directly (notably `handleCancelDraft` and `handleCancelAndCopyDraft`) must be rewritten in this step to call `requestListRefresh()` instead, because the shell no longer owns list filters or the raw loader after the list split.

### Controller instantiation (locked)
`useCariDocumentsListController` is instantiated inside `CariDocumentsListSection.jsx`, not in the page shell.

### JSX to move into `CariDocumentsListSection`
- Filter controls
- Saved view controls
- Visible column popover
- List table
- Pagination
- Export button

### Communication contract
- List section receives: `fixedDirection`, `selectedDocumentId`, `onSelectDocument(id, rowSnapshot)`, and `listRefreshToken`
- `onSelectDocument(id, rowSnapshot)` is called when the user clicks a row — the page shell handles URL sync and stores the lightweight `selectedRow` snapshot used for `selectedSnapshot`
- After list reloads, the list section also refreshes the shell's `selectedRow` snapshot for the current `selectedDocumentId`

### URL sync rule
`selectedDocumentId` URL synchronization remains page-shell responsibility. The list section receives `selectedDocumentId` for highlight/selection state and calls `onSelectDocument` to change it. The page shell writes the URL.

### Risk assessment
- **Medium-high risk.** The list section is large but its state is more self-contained than create.
- Key danger: `loadDocuments` being called from outside the list. Solved by `listRefreshToken` pattern.

### Definition of done
- `CariDocumentsPage.jsx` renders `<CariDocumentsListSection />`
- List filtering/pagination does not trigger create/edit re-renders
- Smoke checks S1, S2, S14 pass

---

## `STEP-CW08` — Detail section shell + controller

### Patch target
- `frontend/src/pages/cari/useCariDocumentDetailController.js` (new)
- `frontend/src/pages/cari/CariDocumentsDetailSection.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove detail state)

### State to move
- `selectedDetail`, `detailLoading`, `detailError`
- `loadDocumentDetail`
- `selectedDetailForPosting` — the strict memo that only resolves when `selectedDetail.id === selectedDocumentId`
- Lightweight derived memos from the selected detail

Note: `selectedDocumentId` stays in page shell as the bridge between list and detail.

### Controller instantiation (locked)
`useCariDocumentDetailController` is instantiated inside `CariDocumentsDetailSection.jsx`, not in the page shell. The detail section reports lightweight detail snapshots upward through `onDetailStateChange(...)` so the shell can preserve cross-domain bridges without owning the detail controller state.

### Controller hook interface
```js
// useCariDocumentDetailController({ selectedDocumentId, detailRefreshToken }) returns:
{
  selectedDetail, detailLoading, detailError,
  selectedDetailForPosting,  // strict: only when selectedDetail.id === selectedDocumentId
  // derived memos
}
```

The controller watches `detailRefreshToken` and reloads when it changes. The page shell increments the token when edit/post/reverse actions complete.

### Detail model preservation (locked)
The page shell synthesizes:
- `selectedRow` — from the list section's lightweight row snapshot callback
- `selectedDetail` — from the detail section's `onDetailStateChange(...)` callback
- `selectedSnapshot = selectedDetail || selectedRow` — for instant UI/action gating before detail finishes loading
- `selectedDetailForPosting` — from the detail section's `onDetailStateChange(...)` callback, strict match only

The split must preserve both values: `selectedSnapshot` for UI gating and `selectedDetailForPosting` for posting logic. Do not feed `selectedSnapshot` into posting/reversal handlers.

### Detail fixed-asset label resolution (locked)
The current detail area resolves fixed-asset labels for `selectedSnapshot.lines` using a merged map built from create/edit fixed-asset lookup rows. That coupling must not survive the split.

After CW08, detail rendering must resolve fixed-asset labels through a detail-owned source instead:
- either the detail section/controller loads and maintains its own fixed-asset label map for referenced ids
- or the page shell maintains a separate lightweight detail-only fixed-asset label map

Do not make the detail section depend on create/edit lookup state for fixed-asset labels once those domains are isolated.

### Immediate mutation-result handoff (locked)
Token-based refresh remains authoritative, but mutation handlers must also support immediate row handoff to avoid stale-detail flashes after update/cancel/post/reverse.

The detail section therefore registers a minimal detail bridge API upward. Expected method:
- `applyMutationResultRow(responseRow)` — replaces the current detail snapshot immediately when a mutation returns an updated row for the **same document id**, then the normal refresh flow re-reads authoritative detail

This generic method is only for same-document mutations such as update, cancel, and post. Reverse is a special case because the backend returns `response.row` = reversal document and `response.original` = updated original document. For reverse, the caller must either:
- pass `response.original` into the detail bridge as the optimistic replacement for the currently selected document
- or skip optimistic detail replacement entirely and rely on `requestDetailRefresh()`

The detail section consumes child-panel mutation callbacks first, applies any returned same-document row through its local detail controller immediately, and then invokes shell `onDocumentChanged()` to request authoritative list/detail refresh when needed. Reverse must not call the generic path with the reversal row.

**Required cutover during CW08:** any shell-owned mutation handler that still calls `setSelectedDetail(response?.row || null)` directly (notably `handleCancelDraft` and `handleCancelAndCopyDraft`) must be rewritten in this step to use the registered detail bridge API or pure token refresh. After CW08, the shell no longer owns raw detail state.

### What the detail section becomes
The shell for the selected document experience:
- Header summary / lifecycle / timeline (uses `selectedSnapshot` for instant rendering)
- Allowed action summary
- Hosts: edit panel, post/reverse panel, related/comments/evidence/ops panels

### URL sync rule
`selectedDocumentId` URL synchronization remains page-shell responsibility. The detail section receives `selectedDocumentId` as a prop and loads detail data from it.

### Communication contract
- Receives: `selectedDocumentId`, `fixedDirection`, `detailRefreshToken`, `selectedSnapshot`, `onDetailStateChange({ selectedDetail, selectedDetailForPosting })`, `registerDetailBridgeApi(api)`, and `onDocumentChanged()` (calls `requestListRefresh` + `requestDetailRefresh`)

### Risk assessment
- **Medium risk.** This is the pivot point — after this, the page is truly a coordinator.

### Definition of done
- Page shell passes `selectedDocumentId` to detail section
- Detail loading is isolated from create/list internals
- Smoke checks S4, S5, S6, S7, S8, S9, S10, S14 pass

---

## `STEP-CW09` — Edit panel + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentEditController.js` (new)
- `frontend/src/pages/cari/CariDocumentEditPanel.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsDetailSection.jsx` (host the panel)

### State to move
- `editForm` and setter
- Edit validation/message/error/loading/saving states
- Edit lookup states (counterparty, account, item, warehouse, FA category, FA asset, operating unit, tax rule, cash register)
- Edit-side loaders
- Edit inline counterparty state
- Handlers: `handleUpdateDraft`, `handleEditSettlementModeChange`, `handleEditLegalEntityChange`, `handleEditDocumentLineTaxPreview`, `handleInlineCreateCounterpartyForEditForm`, `handleInlineCounterpartyCreatedForEditForm`

### Cross-domain bridge handlers
- `handleCancelDraft` — stays in page shell because `cancelSaving` / `cancelError` are shared with `handleCancelAndCopyDraft`
- `handleCancelAndCopyDraft` — stays in page shell (crosses into create domain via `createBridgeApi.prefillCreateForm`)

### Shared modal bridges
- `onOpenQuickCreateAsset(context)` — provided by page shell as a callback prop (bridge #5 context-snapshot pattern); the edit panel reads its own form state and passes the pre-built context
- `onOpenInlineFixedAssetCategoryCreate(context)` — provided by page shell as a callback prop; the edit panel reads its own form state and passes the pre-built `{ scope, rowId, legalEntityId, initialName }` context (bridge #6)
- `onRequestFixedAssetCategorySetup(issue)` — provided by page shell as a callback prop so the edit panel can open the shared setup modal when category defaults are missing (bridge #6)

### Cancel UX ownership (locked)
`cancelSaving` and `cancelError` stay in `CariDocumentsPage.jsx` through CW09 because both plain cancel and cancel-and-copy surface the same visible UI state. Do not split cancel UX state into the edit controller while `handleCancelAndCopyDraft` remains shell-owned.

### Edit form self-hydration from detail (locked)
Today `loadDocumentDetail` (line ~8368) directly calls `setEditForm(mapDocumentRowToForm(row))` plus five edit-flag resets when the loaded document is a draft. After this split, the detail controller no longer owns edit state.

**Rule:** The edit controller must self-hydrate from `selectedDetail`. When `selectedDetail` changes and `isDraft(selectedDetail)` is true, the edit controller populates `editForm` via `mapDocumentRowToForm(selectedDetail)` and resets `editDueDateTouched`, `editValidationVisible`, and line-preview error/message state. This replaces the cross-domain side effect that currently lives inside `loadDocumentDetail`. The detail controller's `loadDocumentDetail` drops the edit-form writes entirely.

### Controller instantiation / bridge registration (locked)
`useCariDocumentEditController` is instantiated inside `CariDocumentEditPanel.jsx`, not in the page shell. The edit panel registers a minimal edit bridge API upward so the shell-owned FA quick-create / category flows can call `applyQuickCreatedFixedAsset(...)` and `applyInlineFixedAssetCategory(...)` without owning edit state.

### Communication contract
- Receives: `selectedDetail`, `fixedDirection`, `fixedAssetCategoryRefreshToken`, `onDocumentUpdated({ responseRow, refreshList, refreshDetail })`, `onCancelDraft()`, `onCancelAndCopyDraft()`, `cancelSaving`, `cancelError`, `onOpenQuickCreateAsset(context)` (bridge #5 context-snapshot pattern), `onOpenInlineFixedAssetCategoryCreate(context)`, `onRequestFixedAssetCategorySetup(issue)`, and `registerEditBridgeApi(api)`

### Risk assessment
- **Medium risk.** Edit and create look similar but have different lifecycles. Do not merge them.

### Definition of done
- Edit panel renders inside detail section
- Edit form typing does not re-render list or create sections
- Smoke checks S4, S5, S12, S16 pass

---

## `STEP-CW10` — Post/reverse panel + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentPostReverseController.js` (new)
- `frontend/src/pages/cari/CariDocumentPostReversePanel.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsDetailSection.jsx` (host the panel)

### State to move
- `postForm`, `postSaving`, `postError`, `postMessage`
- `postTransferGuidance`, `postFixedAssetImprovementGuidance`
- Offset account options/loaders
- Post warehouse options/loaders
- Reverse state, reverse result, reverse inventory blocks
- Linked cash rows/loaders
- Handlers: `handlePostDraft`, `loadPostWarehouses`, `loadPostOffsetAccounts`, `loadLinkedCashRows`

### Localized reverse-form default (locked)
Today `reverseForm` initializes with `reason: l("Manual reversal", "Manuel ters kayit")`. After CW10, the post/reverse controller must still own this localized default. That means the controller either:
- calls `useI18n()` internally and initializes/resets `reverseForm` from its own `l`
- or receives `l` explicitly and computes the default inside the controller

Do not replace this with a static untranslated default during the extraction.

### Cross-domain bridge handlers
- `handlePostDraft` — can live in the post/reverse controller (does not cross into create domain)
- `handleReversePosted` — can live in the post/reverse controller (plain reverse does not cross into create domain)
- `handleReverseAndCopyPosted` — lives in the post/reverse controller; after a successful reverse it calls a shell callback to prefill the create draft from the resolved source row

### Detail model input (locked)
The post/reverse controller must receive **both**:
- `selectedSnapshot` — for `buildInitialPostForm(...)`, displayed totals, offset-account filtering inputs, and posting-line total validation
- `selectedDetailForPosting` — the strict memo used for actual posting/reversal execution safety

Do not use `selectedSnapshot` as the authoritative posting/reversal document payload.

### Controller instantiation (locked)
`useCariDocumentPostReverseController` is instantiated inside `CariDocumentPostReversePanel.jsx`, not in the page shell.

### Post-specific derived selectors
Once `selectedSnapshot` is provided to the post/reverse controller, post-specific snapshot-derived selectors should move with that controller. This includes values such as:
- `selectedDocumentAmountTxn`
- `selectedDocumentAmountBase`
- `selectedOffsetAccountType`
- `postFormPostingLineSummary`

The controller also owns the post-only guidance surfaces driven by posting failures:
- `postTransferGuidance`
- `postFixedAssetImprovementGuidance`

### Communication contract
- Receives: `selectedSnapshot`, `selectedDetailForPosting`, `fixedDirection`, `onDocumentPosted({ responseRow, refreshList, refreshDetail })`, `onDocumentReversed({ originalRow, reversalRow, refreshList, refreshDetail })`, and `requestCreatePrefill(sourceRow, options)` for reverse-and-copy handoff into the create domain

### Reverse optimistic handoff rule (locked)
When reverse succeeds, `onDocumentReversed(...)` must not treat `reversalRow` as the current detail row because it is a different document id. The allowed paths are:
- `originalRow` is passed upward as the optimistic replacement for the currently selected document, while `reversalRow` is used only for reverse-result UI/linkage
- or no optimistic detail replacement is performed and the flow relies on `requestDetailRefresh()`

Do not call a generic `applyMutationResultRow(reversalRow)` path for reverse.

### Risk assessment
- **Medium risk.** Well-bounded domain.

### Definition of done
- Post/reverse no longer re-renders because of unrelated create/edit typing
- Smoke checks S6, S7, S16 pass

---

## `STEP-CW11` — Side panels split (related, comments, evidence, ops)

### Patch target
- `frontend/src/pages/cari/CariDocumentRelatedPanel.jsx` (new)
- `frontend/src/pages/cari/CariDocumentCommentsPanel.jsx` (new)
- `frontend/src/pages/cari/useCariDocumentCommentsController.js` (new)
- `frontend/src/pages/cari/CariDocumentEvidencePanel.jsx` (new)
- `frontend/src/pages/cari/useCariDocumentEvidenceController.js` (new)
- `frontend/src/pages/cari/CariDocumentOpsStatusPanel.jsx` (new)
- `frontend/src/pages/cari/useCariDocumentOpsStatusController.js` (new)
- `frontend/src/pages/cari/CariDocumentsDetailSection.jsx` (host all panels)

### State to move

**Related panel** (no controller needed — read-only):
- `relatedLoading`, `relatedError`, `relatedJournal`, `relatedOpenItems`, `relatedExceptions`, `relatedAuditRows`
- `loadRelatedPanel`

**Comments panel**:
- Comment rows/loading/error/message
- Mention draft/search/highlight state
- `handleInternalCommentBody*` handlers, `handleCreateInternalComment`, `loadInternalComments`

**Evidence panel**:
- Evidence rows/loading/message/error
- Upload note/file/input key
- Upload/download/delete states
- `handleAttachEvidence`, `handleDownloadEvidence`, `handleDeleteEvidence`, `loadEvidenceRows`

**Ops status panel**:
- Ops row/loading/error/message/saving
- Ops form
- `loadOpsStatus`, `handleSaveOpsStatus`

### Side panel input model (locked)
Today all side panels derive their document ID from `selectedDocumentNumericId = toPositiveInt(selectedSnapshot?.id)` (line ~5836), which resolves from `selectedSnapshot` (not `selectedDetail`). This means panels load immediately when a row is selected, before full detail finishes loading.

**Rule:** Side panels must receive either `selectedSnapshot` directly, or the scalar IDs derived from it (`documentId`, `legalEntityId`, `counterpartyId`). Do not pass only `selectedDetail` — that would break the instant-selection behavior where panels start loading as soon as a list row is clicked.

### Risk assessment
- **Low-medium risk.** These panels are largely self-contained and communicate through `selectedSnapshot`-derived IDs.

### Definition of done
- Detail section shell mounts these panels
- Each panel owns its own data flow
- Panels load immediately on row selection (before detail finishes loading)
- Smoke checks S8, S9, S10 pass

---

## `STEP-CW12` — `DocumentLineRow` extraction for rerender isolation

### Patch target
- `frontend/src/pages/cari/DocumentLineRow.jsx` (new)
- `frontend/src/pages/cari/DocumentLineWorkbench.jsx` (extract row rendering)

### In scope
Extract the repeated per-line rendering block from `DocumentLineWorkbench.jsx` into a `DocumentLineRow` component wrapped in `React.memo()`.

Each row receives only:
- `line` — the line data object
- Row-level validation/errors
- Row-specific lookup slices (if any)
- Stable callbacks (wrapped in `useCallback`):
  - `onPatchLine(rowId, patch)`
  - `onRemoveLine(rowId)`
  - `onPreviewTax(rowId)`
  - `onOpenQuickCreateAsset(rowId)`
  - `onChargeTargetChange(rowId, targets)`
  - etc.

### Why this matters most for performance
One line change currently forces all lines and all page domains to reflow. After this step, a line change re-renders only its own `DocumentLineRow` component (assuming stable callback references).

### How to verify performance improvement
- Open React DevTools Profiler
- Edit a field on one line in a 10+ line document
- Confirm that editing one line re-renders the edited row and any minimal aggregate UI that genuinely depends on it (e.g., totals/summary blocks), but does not re-render unrelated sibling line rows

### Risk assessment
- **Medium risk.** The line rendering block likely references many variables from the workbench closure. Callbacks must be stable (useCallback with correct deps) to avoid defeating memoization.
- `React.memo()` on `DocumentLineRow` is required for the isolation to be effective.

### Definition of done
- `DocumentLineRow.jsx` exists and is used by `DocumentLineWorkbench`, wrapped in `React.memo()`
- Editing one line field does not re-render unrelated sibling line rows (totals/summary re-renders are acceptable)
- Smoke checks S3, S4, S13 pass

---

## `STEP-CW13` — Final cleanup and smoke verification

### Patch target
- All files created in CW00–CW12
- `frontend/src/pages/cari/CariDocumentsPage.jsx`

### In scope
1. Verify `CariDocumentsPage.jsx` is now an orchestration shell containing:
   - Route direction handling
   - Permission gates
   - `selectedDocumentId` bridge + URL synchronization
   - `selectedSnapshot` synthesis (`selectedDetail || selectedRow`)
   - Lightweight bridge refs / callbacks (`createBridgeApi`, `detailBridgeApi`, `editBridgeApi`, `selectedRow`, `selectedDetail`, `selectedDetailForPosting`, `requestCreatePrefill`)
   - `listRefreshToken` / `detailRefreshToken` orchestration
   - Cross-domain bridge handlers (copy-to-create, cancel/cancel-and-copy, FA sale prefill)
   - Shell-owned cancel UX state (`cancelSaving`, `cancelError`)
   - Shared FA quick-create modal state + mount
   - Shared FA category setup/inline create state + mount
   - Section/panel mounting
2. Remove any dead code, unused imports, or leftover artifacts from earlier steps.
3. Run full smoke checklist S1–S16.
4. Verify no circular imports exist between any files.
5. Verify import direction: `cariDocumentsUtils.js` and `cariDocumentsPageHelpers.js` do not import from any `.jsx` component file or controller file.

### Risk assessment
- **Low risk.** Cleanup only.

### Shell size expectation
The aspirational target is ~200–500 lines, but this is **not** a hard definition-of-done gate. With URL sync, FA sale prefill, create-prefill bridges, shell-owned cancel UX state, shared FA quick-create/category flows, `selectedSnapshot` synthesis, lightweight bridge refs, and refresh orchestration all shell-owned, the real shell may be larger. That is acceptable. The success criterion is that the shell is orchestration-only — no domain-specific rendering logic, no form field JSX, no lookup loaders.

### Definition of done
- Page shell is orchestration-only (no domain-specific rendering logic remains in the file)
- No dead code remains
- All S1–S16 smoke checks pass
- No circular import warnings
- Import graph flows one-way: helpers → components/controllers → page shell

---

## Dependencies

- No backend dependencies
- No migration dependencies
- Should ideally land **before** Track 40 LCV05 (frontend voucher workflow) and any other CARI workbench feature work, to avoid merge conflict hell on the god file
- Track 40 backend (LCV01–LCV04) can proceed in parallel since it does not touch frontend

## Recommended Execution Order

**Minimum viable refactor** (highest value, lowest risk):
1. CW00 — helper seed (prerequisite for everything)
2. CW01 + CW02 + CW03 — small modal/component extractions (quick wins, very safe)
3. CW04 — workbench extraction (largest mechanical move, safe because CW00 already moved helpers)
4. CW05 — bulk remaining helpers (biggest line-count reduction)

**Full refactor** (after minimum viable is stable):
5. CW06 — create section (highest-value ownership transfer)
6. CW07 — list section
7. CW08 — detail shell
8. CW09 — edit panel
9. CW10 — post/reverse panel
10. CW11 — side panels
11. CW12 — line row isolation (performance payoff)
12. CW13 — cleanup

## What NOT to Do in This Track

- Do not introduce Zustand, Redux, or Context providers
- Do not redesign the UI layout
- Do not merge create and edit into a generic "document form" abstraction
- Do not create `components/` or `hooks/` subdirectories
- Do not refactor the API call patterns
- Do not change prop names or component interfaces beyond what is needed for extraction
- Do not optimize re-renders via memoization except in CW12 (line row isolation)
- Do not import from `CariDocumentsPage.jsx` in any extracted file
