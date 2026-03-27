# 45 - CARI DOCUMENT WORKBENCH FOLDER ORGANIZATION AND IMPORT CLEANUP

## Status
- In progress
- Follow-up track after `44-CARI DOCUMENT WORKBENCH PERFORMANCE AND RERENDER ISOLATION.md`
- Frontend-only structure cleanup
- No product behavior changes

## Purpose

Now that Track 44 finished the ownership split, reorganize the extracted CARI workbench files into a clearer folder layout so the module is easier to navigate and maintain without reintroducing risk into the workbench behavior.

Primary target:
- move controller hooks into a `hooks/` layer
- move extracted UI sections/panels into a `components/` layer
- decide deliberately whether `utils/` moves are worth the extra churn

## Why This Is Separate

1. Track 44 intentionally optimized for safe extraction, not ideal file taxonomy.
2. Folder reshuffling touches many import paths and should not be mixed with the behavior-preserving split itself.
3. The current code is stable and smoke-covered, so this is the first safe point to do organizational cleanup.

## Guardrails (Locked)

### Scope Guardrail
- No behavior changes.
- No API changes.
- No prop/interface redesign.
- No abstraction pass during reorganization. This track moves files only; it does not merge domains, redesign APIs, or invent new shared wrappers.

### Shell Guardrail
- Keep `CariDocumentsPage.jsx` in `frontend/src/pages/cari/`; the page shell does not move in this track.
- This is not another ownership refactor. The shell remains the shell.

### Naming Guardrail
- Do not rename exported symbols unless a path move absolutely requires it.
- Prefer stable names with import-path updates only.

### Move-Order Guardrail
- Move files in batches, not all at once.
- Preserve this order:
  - `hooks/` first
  - `components/` second
  - `utils/` last, and only if justified by the evidence

### Import Guardrail
- `utils` stay leaf modules:
  - utility files must not import from hooks or components
- Hooks must not import JSX components.
- Components may import other components, hooks, and utils, but extracted files must still never import from `CariDocumentsPage.jsx`.

### Folder Guardrail
- Do not create deep folder trees.
- Keep it simple:
  - `frontend/src/pages/cari/hooks/`
  - `frontend/src/pages/cari/components/`
  - optional `frontend/src/pages/cari/utils/` only if the churn is justified

### Verification Guardrail
- Run lint + circular-import check + browser smoke after each batch.

### Pragmatism Guardrail
- `utils` relocation is optional-by-evidence, not mandatory-by-ideology.
- If moving utility files creates too much churn for too little value, keep them where they are and document that decision.

## Import Direction Rules

These direction rules apply to the local `frontend/src/pages/cari/` module graph. They do not prohibit normal imports from shared app-level modules such as API clients, auth hooks, i18n hooks, shared components, or context utilities outside this folder.

Allowed direction for this cleanup:
- `utils` -> other `utils` only
- `hooks` -> `utils`
- `components` -> other `components`, `hooks`, and `utils`
- page shell -> `components` and `utils`

Forbidden direction for this cleanup:
- `utils` -> `hooks`
- `utils` -> `components`
- `hooks` -> `components`
- extracted files -> `CariDocumentsPage.jsx`

## Target Layout

Expected end-state:
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/hooks/`
- `frontend/src/pages/cari/components/`
- `frontend/src/pages/cari/`
  - existing module-level utilities may remain here if that is lower-risk

## Candidate Files

### Hooks
- `useCariDocumentCreateController.js`
- `useCariDocumentsListController.js`
- `useCariDocumentDetailController.js`
- `useCariDocumentEditController.js`
- `useCariDocumentPostReverseController.js`
- `useCariDocumentCommentsController.js`
- `useCariDocumentEvidenceController.js`
- `useCariDocumentOpsStatusController.js`

### Components
- `CariDocumentsCreateSection.jsx`
- `CariDocumentsListSection.jsx`
- `CariDocumentsDetailSection.jsx`
- `CariDocumentDetailContent.jsx`
- `CariDocumentEditPanel.jsx`
- `CariDocumentPostReversePanel.jsx`
- `CariDocumentRelatedPanel.jsx`
- `CariDocumentCommentsPanel.jsx`
- `CariDocumentEvidencePanel.jsx`
- `CariDocumentOpsStatusPanel.jsx`
- `DocumentLineWorkbench.jsx`
- `DocumentLineRow.jsx`
- `BufferedDraftLineTextInput.jsx`
- `FixedAssetQuickCreateModal.jsx`
- `FixedAssetCategorySetupModal.jsx`
- `InlineCounterpartyCreateModal.jsx`
- `InlineFixedAssetCategoryCreateModal.jsx`

### Utilities
- `cariDocumentsUtils.js`
- `cariDocumentsPageHelpers.js`
- `counterpartyInlineCreate.js`
- `cariIdempotency.js`

## Verification Standard

After each batch:
- `npx eslint "frontend/src/pages/cari/**/*.js" "frontend/src/pages/cari/**/*.jsx" "frontend/src/pages/cari/*.js" "frontend/src/pages/cari/*.jsx"`
- `npx madge --circular --extensions js,jsx frontend/src/pages/cari`
- `node browser-tests/cari-documents/walk-cari-documents-smoke.mjs`

Browser smoke remains the same `S1-S16` reusable harness from Track 44.

## Execution Tracking

| Step | Scope | Status |
|---|---|---|
| FO00 | Create folder skeleton and move controller hooks into `hooks/` | Completed (2026-03-28) |
| FO01 | Move extracted section/panel/modal components into `components/` | Completed (2026-03-28) |
| FO02 | Re-evaluate utility placement; move only if justified | Completed (2026-03-28) |
| FO03 | Final import cleanup, circular check, full smoke verification | Not started |

## Step Notes

### `STEP-FO00` - Hooks

Move only controller hooks first.

Definition of done:
- all `useCari*Controller.js` files live under `hooks/`
- imports are updated
- no circular imports
- full smoke passes

### `STEP-FO01` - Components

Move the extracted JSX files next.

Definition of done:
- extracted sections, panels, modals, and line-workbench components live under `components/`
- `CariDocumentsPage.jsx` imports only from the new component paths plus utilities
- full smoke passes

### `STEP-FO02` - Utilities

This step is optional-by-evidence, not mandatory-by-ideology.

If moving `cariDocumentsUtils.js` / `cariDocumentsPageHelpers.js` causes too much churn for too little value, keep them where they are and document that decision.

Definition of done:
- utility placement is deliberate and documented
- utility files still do not import hooks/components

Decision recorded on 2026-03-28:
- Keep `cariDocumentsUtils.js` in `frontend/src/pages/cari/`
- Keep `cariDocumentsPageHelpers.js` in `frontend/src/pages/cari/`
- Keep `counterpartyInlineCreate.js` in `frontend/src/pages/cari/`
- Keep `cariIdempotency.js` in `frontend/src/pages/cari/`

Evidence:
- `cariDocumentsPageHelpers.js` currently has 22 local import sites across the shell, hooks, and components
- `cariDocumentsUtils.js` currently has 9 local import sites
- `counterpartyInlineCreate.js` is shared by both the workbench and `CariSettlementsPage.jsx`
- `cariIdempotency.js` is a tiny settlement helper used only by `CariSettlementsPage.jsx`
- the utility files already satisfy the import-direction guardrail:
  - `cariDocumentsUtils.js`, `counterpartyInlineCreate.js`, and `cariIdempotency.js` import nothing
  - `cariDocumentsPageHelpers.js` imports only from `cariDocumentsUtils.js`

Conclusion:
- moving these files into a `utils/` subfolder would create high import churn and low structural gain
- for this track, keeping them at the module root is the lower-risk and more maintainable choice

### `STEP-FO03` - Final cleanup

Definition of done:
- imports are tidy
- no dead old paths remain
- no circular imports
- full `S1-S16` smoke passes
