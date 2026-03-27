# 44 — CARI DOCUMENT WORKBENCH PERFORMANCE AND RERENDER ISOLATION

## Status
- Planned
- No backend changes — frontend-only refactor
- No UX redesign — behavior-preserving structural split
- No state library migration (no Zustand) — local state stays local
- Design locks confirmed:
  - mechanical extraction first, ownership transfer second
  - every step must leave the page fully working
  - same folder, no subfolder reorganization until split is stable

## Purpose

Break `CariDocumentsPage.jsx` (14,906 lines) from a monolithic god file into an orchestration shell plus isolated section/panel components with co-located controller hooks.

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
- `cariDocumentsUtils.js` (1,344 lines) — form builders, payload builders, validation, charge allocation preview math
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

## Smoke Checklist (Run After Every Step)

Manually verify at `/app/cari-belgeler` after each step completes:

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

## Target End State

```text
frontend/src/pages/cari/
  CariDocumentsPage.jsx              ← orchestration shell (~100–200 lines)

  # Mechanical extractions (Phase 1)
  DocumentLineWorkbench.jsx          ← extracted inline component
  BufferedDraftLineTextInput.jsx     ← extracted inline component
  FixedAssetQuickCreateModal.jsx     ← extracted inline component
  FixedAssetCategorySetupModal.jsx   ← extracted inline component

  # Section components + controllers (Phases 2–7)
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

  # Line-level rerender isolation (Phase 8)
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
| CW01 | Extract `FixedAssetQuickCreateModal` to own file | Not started |
| CW02 | Extract `FixedAssetCategorySetupModal` to own file | Not started |
| CW03 | Extract `DocumentLineWorkbench` to own file | Not started |
| CW04 | Extract `BufferedDraftLineTextInput` to own file | Not started |
| CW05 | Move pure helper functions to `cariDocumentsPageHelpers.js` | Not started |
| CW06 | Create section + controller split | Not started |
| CW07 | Create list section + controller split | Not started |
| CW08 | Detail section shell + controller | Not started |
| CW09 | Edit panel + controller split | Not started |
| CW10 | Post/reverse panel + controller split | Not started |
| CW11 | Side panels split (related, comments, evidence, ops) | Not started |
| CW12 | `DocumentLineRow` extraction for rerender isolation | Not started |
| CW13 | Final cleanup + smoke verification | Not started |

---

## `STEP-CW01` — Extract `FixedAssetQuickCreateModal`

### Patch target
- `frontend/src/pages/cari/FixedAssetQuickCreateModal.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~1984 in `CariDocumentsPage.jsx`
- The helper `createInitialQuickCreateFixedAssetForm` at line ~1713 (used only by this modal)

### How to execute
1. Create `FixedAssetQuickCreateModal.jsx`.
2. Copy the `FixedAssetQuickCreateModal` function component exactly as-is, preserving all props.
3. Move `createInitialQuickCreateFixedAssetForm` into the new file as a local helper (it is only used by this component).
4. Add all needed imports at the top of the new file. The component uses:
   - React, useState, useCallback, useMemo, useEffect
   - UI primitives from the project's shared component library (check which Dialog/Modal/Button/Input/Select components are used)
   - `useI18n`, `useAuth` if used inside the modal
   - Any helper functions from `cariDocumentsUtils.js` or local helpers that the modal calls
5. In `CariDocumentsPage.jsx`, replace the inline definition with `import FixedAssetQuickCreateModal from "./FixedAssetQuickCreateModal.jsx"`.
6. Delete the old inline definition and `createInitialQuickCreateFixedAssetForm` from the page file.
7. **Do not rename any props** — pass them through identically.

### Dependency audit before executing
- Read the `FixedAssetQuickCreateModal` function body to identify every:
  - imported module it references (API calls, hooks, utilities)
  - local helper function from the page file it calls
  - local constant it references
- For each local helper/constant: if used **only** by this modal, move it. If shared with other parts of the page, import it from the page file or leave it in place and import.

### Risk assessment
- **Low risk.** This is a mechanical copy-paste extraction with no logic changes.
- The modal is self-contained — it renders in a portal/overlay, not inline in the page flow.

### Definition of done
- `FixedAssetQuickCreateModal.jsx` exists as a standalone file
- `CariDocumentsPage.jsx` imports and uses it identically
- Page behavior unchanged — smoke checks S3, S4, S11 pass

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
3. Identify and move any helpers used **only** by this component (check `buildFixedAssetCategorySetupIssue`, `getFixedAssetCategorySetupIssue`, `formatFixedAssetCategorySetupRequirementLabel`, `formatFixedAssetCategorySetupRequirementList` — if used only here, move them).
4. Add imports, replace inline definition with import in page file.
5. Do not change any props.

### Dependency audit before executing
- Check whether the `buildFixedAssetCategorySetupIssue` family of helpers (lines ~719–807) is used elsewhere in the page. If yes, leave them in the page and import from there. If only this modal uses them, move them.

### Risk assessment
- **Low risk.** Same mechanical extraction pattern.

### Definition of done
- `FixedAssetCategorySetupModal.jsx` exists as a standalone file
- Page imports and uses it identically
- Smoke checks S3, S4, S11 pass

---

## `STEP-CW03` — Extract `DocumentLineWorkbench`

### Patch target
- `frontend/src/pages/cari/DocumentLineWorkbench.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~2326 in `CariDocumentsPage.jsx`
- This is the **largest inline component** (~2,000+ lines to line ~4403)

### How to execute
1. Create `DocumentLineWorkbench.jsx`.
2. Copy the entire `DocumentLineWorkbench` function component exactly as-is.
3. This component likely calls many helper functions defined earlier in the page file. **Do not move shared helpers in this step.** Instead, import them from `CariDocumentsPage.jsx` by adding named exports to those helpers temporarily, or import from `cariDocumentsUtils.js` if they are already there.
4. Add all needed imports.
5. Replace inline definition with import in page file.
6. Do not change any props.

### Dependency audit before executing (critical for this step)
- The workbench references many helpers from lines 95–1984. Audit each:
  - Helpers already in `cariDocumentsUtils.js` → import from there
  - Helpers used by both the workbench and other page code → temporarily export from the page file, or accept the prop-passing pattern
  - Helpers used only by the workbench → move into the new file
- Common shared helpers likely include: `formatPostableAccountDisplay`, `mapItemCardLookupOptions`, `mapWarehouseLookupOptions`, `roundDocumentUiAmount`, `buildChargeTargetDrafts`, `buildChargeAllocationMethodTransitionPatch`, `buildItemCardSelectionTransitionPatch`, `buildSubledgerTypeTransitionPatch`, `buildFixedAssetModeTransitionPatch`, `expandAutoCreateFixedAssetLine`, `resolveLineDefaultsFromItemCard`, `analyzeDocumentWarehouseBindings`, charge allocation helpers, FA category/asset display helpers

### Strategy for shared helpers
- If a helper is used by both the workbench and the page's create/edit handlers, **leave it in the page file and export it** so the workbench file can import it. This keeps CW03 mechanical.
- Step CW05 will later move these shared pure helpers into a dedicated helpers file.

### Risk assessment
- **Medium risk.** This is the largest extraction. The workbench has deep prop dependency on the parent. The key risk is missing an import or breaking a closure reference.
- Mitigation: do not change any logic. Treat this as a pure file-boundary move.

### Definition of done
- `DocumentLineWorkbench.jsx` exists as a standalone file
- Page imports and uses it identically
- All smoke checks pass, especially S3 (create draft lines), S4 (edit draft lines), S13 (charge allocation)

---

## `STEP-CW04` — Extract `BufferedDraftLineTextInput`

### Patch target
- `frontend/src/pages/cari/BufferedDraftLineTextInput.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove inline definition, add import)

### Extraction source
- Component function at line ~4404 in `CariDocumentsPage.jsx`
- Small component (~60 lines). Also references `LINE_TEXT_INPUT_COMMIT_DELAY_MS` constant.

### How to execute
1. Create the new file.
2. Copy the component exactly.
3. Move `LINE_TEXT_INPUT_COMMIT_DELAY_MS` into the new file (it is likely used only by this component).
4. Add imports, replace inline definition with import.

### Risk assessment
- **Low risk.** Very small, self-contained component.

### Definition of done
- `BufferedDraftLineTextInput.jsx` exists
- Page imports and uses it identically
- Smoke checks S3, S4 pass (text input in line workbench still works)

---

## `STEP-CW05` — Move pure helper functions to `cariDocumentsPageHelpers.js`

### Patch target
- `frontend/src/pages/cari/cariDocumentsPageHelpers.js` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (shrink by removing moved helpers, add import)
- `frontend/src/pages/cari/DocumentLineWorkbench.jsx` (update imports to point to helpers file)
- `frontend/src/pages/cari/FixedAssetQuickCreateModal.jsx` (update imports if needed)
- `frontend/src/pages/cari/FixedAssetCategorySetupModal.jsx` (update imports if needed)

### In scope
Move all **pure functions** (no hooks, no React, no component state) from lines 95–4772 of `CariDocumentsPage.jsx` into `cariDocumentsPageHelpers.js`. These are functions that:
- Take arguments and return values
- Have no side effects
- Are not React components or hooks
- Are not already in `cariDocumentsUtils.js`

### Categories of helpers to move
1. **Display formatters**: `formatPostableAccountDisplay`, `formatFixedAssetCategoryDisplay`, `formatFixedAssetStatusLabel`, `formatFixedAssetLifeMonths`, `formatFixedAssetCategoryDisplayFromAssetRow`, `formatOperatingUnitDisplay`, `formatWarehouseDisplay`, `formatDateTime`, `formatFileSize`, `formatFixedAssetTransactionTypeLabel`, `formatReadinessReason`, `formatCashRegisterLookupLabel`
2. **Lookup mappers**: `mapPostableAccountRows`, `mapItemCardLookupOptions`, `mapWarehouseLookupOptions`, `mapFixedAssetCategoryLookupOptions`, `mapFixedAssetLookupOptions`, `mapCounterpartyLookupOption`, `mapLegalEntityLookupOption`, `mapPaymentTermLookupOption`, `mapOperatingUnitLookupOption`, `mapCashRegisterLookupOptions`
3. **Option extenders**: `extendAccountOptionsForSelectedLines`, `extendItemCardOptionsForSelectedLines`, `extendWarehouseOptionsForSelectedLines`, `extendFixedAssetCategoryOptionsForSelectedLines`, `extendFixedAssetOptionsForSelectedLines`, `extendCashRegisterOptionsForSelectedValue`
4. **Transition builders**: `buildChargeAllocationMethodTransitionPatch`, `buildItemCardSelectionTransitionPatch`, `buildSubledgerTypeTransitionPatch`, `buildFixedAssetModeTransitionPatch`, `expandAutoCreateFixedAssetLine`
5. **Normalizers/validators**: `normalizeDirection`, `normalizeChargeAllocationMethod`, `normalizeCurrencyCode`, `normalizePositiveIntText`, `normalizeOptionalDecimalText`, `normalizeDocumentSettlementMode`, `normalizeRecurringCadence`, `normalizeRecurringInterval`, `normalizeRecurringAnchorDay`, `normalizeApiError`, `normalizeTranslatedApiError`, `normalizeInventoryReverseBlocks`, `translateDocumentMutationLineErrorMap`
6. **Builder/factory helpers**: `buildInitialPostForm`, `createPostingLineDraft`, `buildRowsById`, `buildOperatingUnitsById`, `getDocumentOperatingUnitLabel`, `buildDocumentLifecycleEvents`, `buildFixedAssetSaleCreatePrefill`, `clearFixedAssetSaleCreatePrefill`, `buildTaxCategoryOptions`, `resolvePaymentTermDueDateCandidate`, `addDaysToIsoDate`, `buildInventoryMovementLink`, `buildInventoryTransferLink`, `extractTransferRequiredGuidanceFromError`, `extractFixedAssetImprovementGuidanceFromError`, `analyzeDocumentWarehouseBindings`, `resolveLineDefaultsFromItemCard`, `getDefaultStockImpactModeForDirection`, `resolveFixedAssetDisplayAccountId`, `allocateAmountAcrossUnits`, `roundDocumentUiAmount`, `buildChargeTargetDrafts`
7. **Small utility functions**: `todayIsoDate`, `firstDefinedRowValue`, `toPositiveInt`, `normalizeText`, `toPositiveDecimal`, `amountsMatch`, `isDraft`, `isPosted`, `isImmediateCashSettled`, `canReverseDocument`, `resolveCounterpartyRoleFromDirection`, `isImmediateCashSettlementMode`, `getImmediateCashSettlementLabel`, `documentUsesStoredLineTaxes`, `shouldInsertMentionSpacer`, `getInternalCommentMentionDraft`, `resolveRouteFixedDirection`, `resolveOffsetAccountTypeByDirection`, `getDocumentPageTitle`, `getCreateDraftDocumentTitle`
8. **Constants**: `DEFAULT_FILTERS`, `DOCUMENT_FILTER_CONTEXT_MAPPINGS`, `DOCUMENT_CREATE_CONTEXT_MAPPINGS`, all `DOCUMENT_*` constants, `FIXED_ASSET_*` constants, `POSTING_LINE_AMOUNT_EPSILON`, `INTERNAL_COMMENT_MENTION_REGEX`, route path constants
9. **Draft/template/saved-view builders**: `createInitialDraftForm`, `buildDirectionScopedDraftForm`, `buildTemplateSafeDraftForm`, `buildRecurringTemplateRule`, `createInitialRecurringTemplateRule`, `buildDocumentDraftTemplateDefinition`, `resolveDocumentDraftTemplateState`, `buildCloneDraftFormFromRow`, `normalizeVisibleColumnIds`, `buildDocumentSavedViewDefinition`, `resolveDocumentSavedViewState`, `resetDocumentLineTaxPreview`
10. **FA category helpers**: `getFixedAssetCategoryDefault*` family, `buildFixedAssetCategorySetupIssue`, `getFixedAssetCategorySetupIssue`, `formatFixedAssetCategorySetupRequirementLabel`, `formatFixedAssetCategorySetupRequirementList`, `upsertFixedAssetCategoryRow`

### How to execute
1. Create `cariDocumentsPageHelpers.js` with all the functions listed above, each as a named export.
2. In `CariDocumentsPage.jsx`, replace inline definitions with `import { ... } from "./cariDocumentsPageHelpers.js"`.
3. Update `DocumentLineWorkbench.jsx`, `FixedAssetQuickCreateModal.jsx`, `FixedAssetCategorySetupModal.jsx` imports to point to the helpers file instead of the page file.
4. Verify no circular imports are created.

### Why this step exists
After CW01–CW04, the page file is still ~10,000+ lines because the helper functions remain. Moving pure helpers out is safe (no state, no hooks, no closures over component state) and dramatically shrinks the page file before the harder section splits begin.

### Risk assessment
- **Medium risk.** Large number of functions to move, but each is a pure function with no React state dependency. The risk is missing an import or moving a function that secretly closes over component state.
- Mitigation: every function in this list is defined **above** the component function (before line 4823), confirming they do not close over component state.

### Definition of done
- `cariDocumentsPageHelpers.js` exists with all pure helpers exported
- `CariDocumentsPage.jsx` is down to ~10,000 lines or less (component function + state + handlers + JSX only)
- All previously extracted files import from helpers file, not page file
- All smoke checks pass

---

## `STEP-CW06` — Create section + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentCreateController.js` (new)
- `frontend/src/pages/cari/CariDocumentsCreateSection.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove create state/handlers/JSX, render section component)

### State to move into `useCariDocumentCreateController`
All `useState`/`useMemo`/`useCallback`/`useEffect` declarations related to create:
- `createForm` and its setter
- `createValidation`, `createMessage`, `createError`, `createLoading`, `createSaving`
- Payment-term / due-date / currency touched flags
- Create-specific lookup option states (counterparty, legal entity, account, item card, warehouse, FA category, FA asset, payment term, operating unit, tax rule, cash register)
- Create-specific lookup loaders
- Create line preview states (tax preview, line expansion)
- Recurring template state
- Draft template state and handlers (~lines 11218–11405)
- Inline counterparty create state for create form
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
// useCariDocumentCreateController returns:
{
  createForm, setCreateForm,
  createSaving, createError, createMessage,
  // lookup options and loaders
  // handlers
  handleCreateDraft,
  resetCreateForm,
  // ... all create-domain state
}
```

### What stays in the page
- `fixedRouteDirection`
- `selectedDocumentId`
- Callbacks the create section needs from outside (e.g., `onDraftCreated` that triggers list refresh)

### Communication contract
- Create section receives: `fixedDirection`, `onDraftCreated(newDocumentId)` callback
- Create section does NOT need list state, detail state, edit state, or any other domain

### Risk assessment
- **High risk — highest value step.** This is the first ownership transfer. The create form is the largest state domain.
- Mitigation: move state declarations one-by-one, keeping the page working after each cluster. Test S3 and S12 after each sub-move.
- Key danger: functions that reference both create state AND other state (e.g., a shared legal entity change handler). These must be identified and either duplicated or passed as callbacks.

### Definition of done
- `CariDocumentsPage.jsx` renders `<CariDocumentsCreateSection />` with a small prop interface
- Create form typing does not trigger re-renders in list/detail/edit domains
- Smoke checks S3, S12, S13 pass
- Page file shrinks by ~2,000–3,000 lines

---

## `STEP-CW07` — List section + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentsListController.js` (new)
- `frontend/src/pages/cari/CariDocumentsListSection.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove list state/handlers/JSX)

### State to move into `useCariDocumentsListController`
- `rows`, `totalRows`, `listLoading`, `listError`
- Filter option states
- Pagination state
- Saved views state
- Visible columns / table preferences / active popover state
- `loadDocuments` and supporting data fetchers
- Filter lookup loaders
- Saved view handlers (~lines 11419–11606)
- Table preference handlers (~lines 11617–11665)
- Export handler

### JSX to move into `CariDocumentsListSection`
- Filter controls
- Saved view controls
- Visible column popover
- List table
- Pagination
- Export button

### Communication contract
- List section receives: `fixedDirection`, `selectedDocumentId`, `onSelectDocument(id)`
- Optionally: `onCopyToCreate(row)` if the "copy to create" action exists

### Risk assessment
- **Medium-high risk.** The list section is large but its state is more self-contained than create.
- Key danger: `loadDocuments` may be called from outside the list (e.g., after post/reverse to refresh). Solution: expose a `refreshList` callback or use a simple event pattern.

### Definition of done
- `CariDocumentsPage.jsx` renders `<CariDocumentsListSection />`
- List filtering/pagination does not trigger create/edit re-renders
- Smoke checks S1, S2 pass

---

## `STEP-CW08` — Detail section shell + controller

### Patch target
- `frontend/src/pages/cari/useCariDocumentDetailController.js` (new)
- `frontend/src/pages/cari/CariDocumentsDetailSection.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsPage.jsx` (remove detail state)

### State to move
- `selectedDocumentId` (stays in page as the bridge, but detail loading moves)
- `selectedDetail`, `detailLoading`, `detailError`
- `loadDocumentDetail`
- Lightweight derived memos from the selected detail

### What the detail section becomes
The shell for the selected document experience:
- Header summary / lifecycle / timeline
- Allowed action summary
- Hosts: edit panel, post/reverse panel, related/comments/evidence/ops panels

### Communication contract
- Receives: `selectedDocumentId`, `fixedDirection`, `onDocumentChanged()` (to trigger list refresh)

### Risk assessment
- **Medium risk.** This is the pivot point — after this, the page is truly a coordinator.

### Definition of done
- Page shell passes `selectedDocumentId` to detail section
- Detail loading is isolated from create/list internals
- Smoke checks S4, S5, S6, S7, S8, S9, S10 pass

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
- Handlers: `handleUpdateDraft`, `handleCancelDraft`, `handleCancelAndCopyDraft`, `handleEditSettlementModeChange`, `handleEditLegalEntityChange`, `handleEditDocumentLineTaxPreview`, `handleInlineCreateCounterpartyForEditForm`, `handleInlineCounterpartyCreatedForEditForm`

### Communication contract
- Receives: `selectedDetail`, `fixedDirection`, `onDocumentUpdated()`, `onDocumentCanceled()`

### Risk assessment
- **Medium risk.** Edit and create look similar but have different lifecycles. Do not merge them.

### Definition of done
- Edit panel renders inside detail section
- Edit form typing does not re-render list or create sections
- Smoke checks S4, S5, S12 pass

---

## `STEP-CW10` — Post/reverse panel + controller split

### Patch target
- `frontend/src/pages/cari/useCariDocumentPostReverseController.js` (new)
- `frontend/src/pages/cari/CariDocumentPostReversePanel.jsx` (new)
- `frontend/src/pages/cari/CariDocumentsDetailSection.jsx` (host the panel)

### State to move
- `postForm`, `postSaving`, `postError`, `postMessage`
- Offset account options/loaders
- Post warehouse options/loaders
- Reverse state, reverse result, reverse inventory blocks
- Linked cash rows/loaders
- Handlers: `handlePostDraft`, `handleReversePosted`, `handleReverseAndCopyPosted`, `loadPostWarehouses`, `loadPostOffsetAccounts`, `loadLinkedCashRows`

### Communication contract
- Receives: `selectedDetail`, `fixedDirection`, `onDocumentPosted()`, `onDocumentReversed()`

### Risk assessment
- **Medium risk.** Well-bounded domain.

### Definition of done
- Post/reverse no longer re-renders because of unrelated create/edit typing
- Smoke checks S6, S7 pass

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

### Risk assessment
- **Low-medium risk.** These panels are largely self-contained and communicate only through `selectedDocumentId`.

### Definition of done
- Detail section shell mounts these panels
- Each panel owns its own data flow
- Smoke checks S8, S9, S10 pass

---

## `STEP-CW12` — `DocumentLineRow` extraction for rerender isolation

### Patch target
- `frontend/src/pages/cari/DocumentLineRow.jsx` (new)
- `frontend/src/pages/cari/DocumentLineWorkbench.jsx` (extract row rendering)

### In scope
Extract the repeated per-line rendering block from `DocumentLineWorkbench.jsx` into a `DocumentLineRow` component.

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
- Confirm that only the edited `DocumentLineRow` re-renders, not all siblings

### Risk assessment
- **Medium risk.** The line rendering block likely references many variables from the workbench closure. Callbacks must be stable (useCallback with correct deps) to avoid defeating memoization.
- Consider wrapping `DocumentLineRow` in `React.memo()` for the isolation to be effective.

### Definition of done
- `DocumentLineRow.jsx` exists and is used by `DocumentLineWorkbench`
- Editing one line field does not re-render sibling line rows
- Smoke checks S3, S4, S13 pass

---

## `STEP-CW13` — Final cleanup and smoke verification

### Patch target
- All files created in CW01–CW12
- `frontend/src/pages/cari/CariDocumentsPage.jsx`

### In scope
1. Verify `CariDocumentsPage.jsx` is now an orchestration shell of ~100–300 lines.
2. Remove any dead code, unused imports, or temporary export hacks from earlier steps.
3. Run full smoke checklist S1–S13.
4. Verify no circular imports exist between the new files.
5. Check that `cariDocumentsUtils.js` and `cariDocumentsPageHelpers.js` do not import from any component files (helpers should flow one-way: helpers → components, not the reverse).

### Risk assessment
- **Low risk.** Cleanup only.

### Definition of done
- Page shell is orchestration-only
- No dead code remains
- All S1–S13 smoke checks pass
- No circular import warnings

---

## Dependencies

- No backend dependencies
- No migration dependencies
- Should ideally land **before** Track 40 LCV05 (frontend voucher workflow) and any other CARI workbench feature work, to avoid merge conflict hell on the god file
- Track 40 backend (LCV01–LCV04) can proceed in parallel since it does not touch frontend

## Recommended Execution Order

**Minimum viable refactor** (highest value, lowest risk):
1. CW01 + CW02 + CW04 — small modal/component extractions (quick wins, very safe)
2. CW03 — workbench extraction (largest mechanical move)
3. CW05 — helpers extraction (biggest line-count reduction)

**Full refactor** (after minimum viable is stable):
4. CW06 — create section (highest-value ownership transfer)
5. CW07 — list section
6. CW08 — detail shell
7. CW09 — edit panel
8. CW10 — post/reverse panel
9. CW11 — side panels
10. CW12 — line row isolation (performance payoff)
11. CW13 — cleanup

## What NOT to Do in This Track

- Do not introduce Zustand, Redux, or Context providers
- Do not redesign the UI layout
- Do not merge create and edit into a generic "document form" abstraction
- Do not create `components/` or `hooks/` subdirectories
- Do not refactor the API call patterns
- Do not change prop names or component interfaces beyond what is needed for extraction
- Do not optimize re-renders via memoization except in CW12 (line row isolation)
