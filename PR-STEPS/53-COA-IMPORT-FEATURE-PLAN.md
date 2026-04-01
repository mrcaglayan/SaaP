# 53 - COA IMPORT FEATURE PLAN

## Status
- Planned
- GL setup follow-up track after starter-template apply foundation
- Page ownership lock confirmed:
  - first-time CoA bootstrap stays in `Organization Management`
  - explicit CoA import / merge / overwrite stays in `hesap-plani-olustur`

## Purpose
Add an ERP-grade Chart of Accounts import workflow so finance/admin users can:

- download a supported draft template
- fill or edit the draft offline
- upload the file back into the app
- preview validation and structural changes before commit
- apply the import as either `MERGE` or guarded `OVERWRITE`
- keep a durable import history with original file, normalized result, and error export

## Why a Separate Track

1. This is not only another account-editor shortcut.
2. The feature needs a real file contract, preview engine, validation summary, audit trail, and overwrite guard.
3. It must coexist cleanly with:
   - manual account edits in `GlSetupPage`
   - starter-template apply in `GlSetupPage`
   - legal-entity bootstrap defaults in `Organization Management`
4. It introduces destructive replacement behavior for existing CoAs and therefore needs an explicit operator workflow, not a hidden background helper.

## Current Repo Fit

The repo already has the right seams for this feature:

- `frontend/src/pages/settings/HesapPlaniOlustur.jsx`
  - already routes to `GlSetupPage` in `accounts` mode
- `frontend/src/pages/settings/GlSetupPage.jsx`
  - already owns CoA/account setup, manual tree editing, and starter-template apply
- `backend/src/services/gl.coa-starter-template.service.js`
  - already owns guarded `MERGE` / `OVERWRITE` starter-template apply logic for a selected CoA
- `frontend/src/pages/bank/BankStatementImportPage.jsx`
- `frontend/src/pages/payroll/PayrollRunImportPage.jsx`
  - already show the repo's preferred import UX pattern: download sample, local file read, send `csvText + originalFilename`, preview/result messaging, and history-adjacent workflow
- `backend/src/services/evidence.storage.adapter.js`
  - already provides the safe storage-path discipline the import track should reuse

The repo also has an important V1 constraint:

- there is no existing CSV/XLSX parsing dependency such as `xlsx`, `exceljs`, `papaparse`, `csv-parse`, or `fast-csv`

That means V1 should be intentionally `CSV-first` instead of pretending spreadsheet import is already a solved platform capability.

## Core Product Direction

- `CoA import` belongs inside `/app/ayarlar/hesap-plani-olustur`.
- V1 extends the existing `GlSetupPage` account setup workspace instead of creating a new menu route.
- V1 supports `LEGAL_ENTITY` CoAs only.
- V1 supports `CSV` only.
- Users download either:
  - a blank CSV template
  - a sample filled CSV
- Users upload the file, run preview, review warnings/errors, and then apply one of:
  - `MERGE`
  - `OVERWRITE`
- `OVERWRITE` is allowed only from `hesap-plani-olustur`, never from `Organization Management`.
- Every successful preview creates an import-history record, even if the operator does not apply it yet.
- The actual apply step should reuse the same structural guard philosophy already introduced for starter-template overwrite.

## Implementation Locks

### 1. Route and page ownership

- V1 route stays:
  - `/app/ayarlar/hesap-plani-olustur`
- Do not add a separate sidebar page like `CoA Import` in V1.
- The import workspace should be a new section/card inside `GlSetupPage` when `mode="accounts"`.

### 2. Scope lock

- V1 imports only into one selected `LEGAL_ENTITY` CoA.
- Group CoA import is out of scope in V1.
- One upload file targets exactly one CoA.

### 3. File-format lock

- V1 accepted upload format is `UTF-8 CSV`.
- Header row is mandatory.
- Delimiter is comma.
- Quoted values are supported.
- Blank lines are ignored.
- Comment rows are not supported in V1.
- Browser should read the file locally and send `csvText` plus `originalFilename` in JSON, following the repo's current bank/payroll import pattern.
- `XLSX` is a later follow-up, not part of this track.

### 4. Downloadable draft lock

The page must offer two explicit downloads:

- `coa-import-template.csv`
  - header-only blank draft
- `coa-import-sample.csv`
  - filled example that shows valid parent/child structure and accepted enum values

The blank template is:

```csv
code,parent_code,name,account_type,normal_side,allow_posting
```

The sample filled draft is:

```csv
code,parent_code,name,account_type,normal_side,allow_posting
1000,,Cash and Cash Equivalents,ASSET,DEBIT,FALSE
1010,1000,Main Cashbox,ASSET,DEBIT,TRUE
1020,1000,Bank Current Accounts,ASSET,DEBIT,TRUE
1100,,Accounts Receivable,ASSET,DEBIT,TRUE
2000,,Accounts Payable,LIABILITY,CREDIT,TRUE
4000,,Revenue,REVENUE,CREDIT,TRUE
5000,,Operating Expense,EXPENSE,DEBIT,TRUE
```

### 5. Template-column lock

V1 accepted columns are locked to:

- `code` required
- `parent_code` optional
- `name` required
- `account_type` required
- `normal_side` required
- `allow_posting` optional, default `TRUE`

Accepted enums:

- `account_type`
  - `ASSET`
  - `LIABILITY`
  - `EQUITY`
  - `REVENUE`
  - `EXPENSE`
- `normal_side`
  - `DEBIT`
  - `CREDIT`
- `allow_posting`
  - `TRUE`
  - `FALSE`
  - `1`
  - `0`

No extra optional columns should be promised in V1 for:

- account mappings
- tax behavior
- currency behavior
- opening balances
- external reference metadata
- localization columns

### 6. Import-mode lock

- Preview is mandatory before apply.
- `MERGE`
  - updates matching accounts by `code`
  - inserts new codes
  - leaves unrelated existing accounts untouched
- `OVERWRITE`
  - replaces the existing account tree for the selected CoA
  - is allowed only after structural guard checks pass
  - must stay in `hesap-plani-olustur`, not legal-entity creation

### 7. Shared apply-engine lock

- CSV import should not build a second independent tree-apply engine.
- The import track should either:
  - call the existing starter-template transactional apply service, or
  - extract a lower shared tree-normalize/apply service used by both starter templates and CSV import
- `MERGE` / `OVERWRITE` semantics must stay aligned across:
  - starter template apply
  - CSV import

### 8. Validation lock

Preview must validate at least:

- required headers exist
- duplicate `code` inside file
- invalid enum values
- self-parent rows
- missing parent resolution
- parent cycle / loop
- invalid empty `code` or `name`
- `MERGE` parent resolution against:
  - rows inside the file
  - already-existing account codes inside the same CoA
- `OVERWRITE` parent resolution against:
  - rows inside the file only
- code preservation as string
  - leading zeros must not be lost

Preview must also return:

- create count
- update count
- unchanged count
- warning count
- error count

### 9. Parent/posting behavior lock

- A row that becomes a parent must end up non-postable in the resulting tree.
- V1 normalized preview may automatically coerce parent rows to `allow_posting = FALSE`.
- If coercion happens, preview must show a visible warning so the operator understands what changed.

### 10. Overwrite safety lock

`OVERWRITE` must block when the current CoA is already in use in ways that make replacement unsafe.

Blockers must include at least:

- posted journal-line usage
- draft journal-line usage if the row remains linked structurally
- OU current-account config references
- journal-purpose account mappings
- shareholder sub-account references
- bank or other module setup references to specific account ids

The blocker must return a clear operator-facing message that overwrite cannot continue because current accounts are already referenced.

### 11. Storage and audit lock

V1 must persist:

- original uploaded CSV
- normalized CSV used for preview/apply
- error CSV, when errors exist
- file checksum
- actor / timestamps
- selected mode
- preview/apply status summary

Use the evidence-storage safety pattern, but keep CoA import files in a separate root:

- `backend/storage/imports/coa`

Recommended relative storage shape:

- `tenant-{tenantId}/le-{legalEntityId}/coa-{coaId}/import-{importId}/original-{stamp}.csv`
- `tenant-{tenantId}/le-{legalEntityId}/coa-{coaId}/import-{importId}/normalized-{stamp}.csv`
- `tenant-{tenantId}/le-{legalEntityId}/coa-{coaId}/import-{importId}/errors-{stamp}.csv`

### 12. UX style lock

- Reuse the existing `GlSetupPage` admin card/table style.
- Do not build a modal-only import flow.
- Keep the workflow visible on the page with:
  - context selectors
  - download actions
  - upload + preview controls
  - preview summary
  - history
- The page should feel like the repo's current setup/admin surfaces, not like a standalone consumer upload wizard.

## Scope Lock

V1 includes:

- one-CoA CSV import
- template download
- local file read + preview
- `MERGE`
- guarded `OVERWRITE`
- import history list
- original/error download

V1 explicitly excludes:

- XLSX import
- group CoA import
- importing multiple CoAs from one file
- opening balance import
- account-mapping import
- automatic purpose-mapping creation
- auto-remap of referenced historical accounts during overwrite
- background job queue processing

## Page Specification

### Page location

- Existing route:
  - `/app/ayarlar/hesap-plani-olustur`
- Existing page owner:
  - `frontend/src/pages/settings/GlSetupPage.jsx`

### Section layout

The `accounts` mode page should gain a dedicated `CoA Import` workspace under the current CoA context.

Recommended surface order:

1. existing book / CoA / legal-entity selectors
2. existing starter-template card
3. new `Hesap Plani Ice Aktar` card
4. existing account tree/editor area
5. new `Ice Aktarma Gecmisi` table

### Import card content

The import card should contain:

- selected legal entity and CoA summary
- mode selector:
  - `MERGE`
  - `OVERWRITE`
- download actions:
  - blank template
  - sample CSV
- file input
- original filename field
- read-only accepted-column helper
- inline warning surface for overwrite
- `Preview` action
- `Apply` action

### Preview panel content

The preview result area should show:

- total parsed rows
- creates / updates / unchanged
- warnings / errors
- top blocking messages
- top coercions
- sample row diff table
- download error CSV action when errors exist

### History table content

Each history row should show:

- import id / import no
- created at
- created by
- selected mode
- original filename
- checksum
- preview status
- apply status
- row counts summary
- actions:
  - view summary
  - download original
  - download normalized
  - download errors

### Disable states

The whole workspace should stay disabled with an inline reason when:

- no legal entity is selected
- no `LEGAL_ENTITY` CoA is selected
- user lacks read permission
- user lacks upsert permission for apply

## Naming Policy

### User-facing file names

- blank template:
  - `coa-import-template.csv`
- sample file:
  - `coa-import-sample.csv`
- exported errors:
  - `coa-import-errors-{importId}.csv`
- exported normalized file:
  - `coa-import-normalized-{importId}.csv`

### Internal import identifier

Use a stable import reference for UI/history:

- `COAIMP-{id}`

### Repo module/file shape

Preferred frontend additions:

- `frontend/src/api/glAdmin.js`
  - preview/apply/list/get/download helpers
- `frontend/src/pages/settings/GlSetupPage.jsx`
  - import workspace UI
- `frontend/src/utils/coaImportTemplate.js`
  - blank/sample CSV generation
- `frontend/src/utils/coaImportValidation.js`
  - small frontend helpers for display formatting only

Preferred backend additions:

- `backend/src/routes/gl.coa-import.routes.js`
- `backend/src/services/gl.coa-import.service.js`
- `backend/src/services/gl.coa-import.csv.js`
- `backend/src/services/gl.coa-import.storage.js`
- `backend/src/migrations/m1xx_gl_coa_imports.js`

Do not keep inflating generic route files if the import track becomes more than a tiny helper.

## API Surface

Recommended V1 routes:

- `POST /api/v1/gl/coas/:coaId/imports/preview`
  - input:
    - `originalFilename`
    - `csvText`
    - `mode`
  - output:
    - persisted preview record
    - summary counts
    - warnings/errors
    - normalized preview rows
- `POST /api/v1/gl/coas/:coaId/imports/:importId/apply`
  - applies the already-previewed import
- `GET /api/v1/gl/coas/:coaId/imports`
  - list history
- `GET /api/v1/gl/coas/:coaId/imports/:importId`
  - read one history item
- `GET /api/v1/gl/coas/:coaId/imports/:importId/download/:kind`
  - `kind = original | normalized | errors`

## Data Model Direction

Preferred V1 persistence is one header table plus stored artifacts.

Header table should capture:

- tenant / legal entity / CoA scope
- original filename
- file checksum
- storage paths
- selected mode
- preview status
- apply status
- summary counts
- actor / timestamps

V1 does not need a row-per-import-line table if:

- normalized preview rows can be reconstructed from stored normalized CSV
- history UI only needs summary + downloadable artifacts

If row-level history becomes a hard product need later, that can be a follow-up table rather than a blocker for V1.

## Permission Model

Reuse current GL setup permissions:

- read:
  - `gl.book.read`
  - `gl.coa.read`
  - `gl.account.read`
- apply:
  - `gl.account.upsert`

No new permission code is required in V1 unless the product later wants a separate import-only permission.

## Validation and Apply Rules

### `MERGE`

- match existing accounts by `code` inside the same selected CoA
- create missing codes
- update mutable attributes on matching codes
- keep unrelated existing codes untouched
- allow `parent_code` to point at:
  - another row in the file
  - an already-existing account code in the same CoA

### `OVERWRITE`

- replace the selected CoA tree with the uploaded file's normalized tree
- do everything inside one transaction
- run overwrite guard checks first
- if guard checks fail, stop without partial deletion
- if guard checks pass, clear the current tree and apply the normalized file in the same transaction

### Error contract

Errors should be split into:

- blocking structural errors
- non-blocking normalization warnings

Blocking errors stop apply.

Warnings allow apply, but the operator must see:

- what was normalized
- what was coerced
- what will be created or updated

## Suggested Implementation Order

### Phase 1: contract and template foundation

1. Lock the CSV schema and enums.
2. Add blank/sample template download helpers on `GlSetupPage`.
3. Add backend CSV parser + normalization helpers.

### Phase 2: preview and history foundation

1. Add import header table and storage adapter.
2. Add preview route and preview-only UI.
3. Add history list and artifact download support.

### Phase 3: merge apply

1. Wire previewed `MERGE` imports into the shared tree apply engine.
2. Refresh account tree after apply.
3. Add focused smoke coverage for merge preview/apply.

### Phase 4: guarded overwrite

1. Reuse or extract overwrite guard logic from starter-template apply.
2. Add `OVERWRITE` warning UX and blocker messages.
3. Add transactional replace behavior with no partial state.
4. Add focused smoke coverage for overwrite-block and overwrite-success paths.

### Phase 5: audit and hardening

1. Add better history summaries and operator messages.
2. Add normalized/error file download actions.
3. Update OpenAPI and route smoke checks.

## Acceptance Criteria

The track is ready for implementation signoff when:

- a user can download a valid blank template
- a user can download a valid filled sample
- a user can upload CSV from `hesap-plani-olustur`
- preview clearly shows structural errors and non-blocking warnings
- `MERGE` works against the selected `LEGAL_ENTITY` CoA
- `OVERWRITE` is blocked when current accounts are already referenced
- successful imports appear in history with downloadable artifacts
- the workflow does not create a second conflicting CoA-apply engine

## Deferred Follow-Ups

These are intentionally deferred and should not block V1:

- `XLSX` parity
- multi-language account-name import columns
- account-mapping import in the same file
- opening-balance import companion flow
- queue/background processing for very large files
- group CoA import
