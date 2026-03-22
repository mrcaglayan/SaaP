# 39 - CARI SUBLEDGER-AWARE LINES, IMMEDIATE CASH SETTLEMENT, AP/AR NAVIGATION, AND FA INTEGRATION

## Status
- Planned
- Depends on Track 38 (Fixed Assets foundation) being complete through at least STEP-FA48

## Purpose
Make CARI document lines **subledger-aware** so that the document knows at entry time whether a line is a plain GL expense, an inventory receipt, or a fixed asset purchase/sale — exactly how SAP, Oracle, and Dynamics handle it.

Today, CARI lines are generic: every line has an amount and a manual account. The fixed-asset capitalization flow works backwards — the bill is posted first as a plain expense, then a separate "capitalize from AP" step creates the asset after the fact. The sale flow uses a multi-step staging API (create draft AR → link → finalize). Neither is how real ERP works.

This plan makes the CARI document line the **single entry surface** that dynamically adapts per line based on the selected subledger type.

## Why a Separate Track

1. This is a **CARI module change**, not a fixed-assets-only change
2. Track 38 is 50/52 steps complete — bolting a CARI redesign onto it would dilute the near-complete status
3. The subledger-aware line concept is reusable beyond FA (inventory already has a parallel pattern via `stock_impact_mode` + `item_card_id`)
4. Track 38's existing capitalization flow (FA24–FA27, FA51) works as-is for MVP — this track is the evolution toward proper ERP behavior

## Core Design

### Subledger Type on CARI Document Lines

New ENUM column on `cari_document_lines`:

```
subledger_type ENUM('NONE', 'STOCK', 'FIXED_ASSET') NOT NULL DEFAULT 'NONE'
```

| Subledger type | Line behavior | Existing analog |
|---|---|---|
| `NONE` | Current default — manual account selection, plain GL posting, including today's service / non-stock item-card lines with `stock_impact_mode = 'NONE'` | Today's default |
| `STOCK` | References a stock-managed item card, account auto-resolved from product/warehouse config | Today's `stock_impact_mode != 'NONE'` pattern |
| `FIXED_ASSET` | For AP: either auto-generates new asset units from line quantity or links one draft asset; for AR: references one eligible existing asset. Account auto-resolved from asset category | NEW |

Repo-specific rule: `itemCardId` is a shared commercial line-master reference in this codebase, not an inventory-only reference. `SERVICE`, `NON_STOCK_GOOD`, and `STOCK_ITEM` all use `itemCardId`; only `stock_impact_mode != 'NONE'` implies stock behavior. So `subledger_type` must not be inferred from `itemCardId` alone.

A single bill can have mixed lines:

- Line 1: Office supplies → `NONE` → expense account
- Line 2: Printer toner → `STOCK` → inventory card reference
- Line 3: Office Table × 10 → `FIXED_ASSET` → generated asset units from line quantity

### Purchase Flow (AP + FIXED_ASSET)

1. User creates a **CARI AP document**
2. On a line, user selects `subledger_type = FIXED_ASSET`
3. User enters the supplier-style line normally: example `Table`, `qty = 10`, `unit price = 100`
4. User keeps the default **auto-create mode** and fills the generated-asset setup: asset category, owner OU, location OU
5. UI shows a preview message: **"Posting this line will create 10 assets at 100 each."**
6. User optionally clicks **"Expand into individual asset lines"** / **"Customize generated assets"** when the units are not identical
7. Posting account **auto-resolves** to the selected asset category's asset account (no manual account selection needed)
8. User **posts the bill**
9. Posting logic sees FIXED_ASSET line → creates 10 draft asset units/cards, creates one CAPITALIZATION transaction per unit, updates cost fields and CARI provenance (`source document`, `line`, `unit no 1..10`)
10. User goes to asset detail/list → **activates** units later as needed (depreciation schedules generated, status → ACTIVE, no additional journal needed — cost already posted via CARI)

**Advanced/manual purchase mode (Rule B)**:

- `subledgerType = FIXED_ASSET`
- `fixedAssetMode = LINK_EXISTING`
- `targetFixedAssetId` present
- `quantity = 1`
- Use this only when the user has already prepared one specific draft asset and wants the bill line to capitalize that exact asset

### Sale Flow (AR + FIXED_ASSET)

1. User creates a **CARI AR document** (invoice to the buyer)
2. On a line, user selects `subledger_type = FIXED_ASSET`
3. User picks the **eligible existing asset** being sold (`ACTIVE`, `SUSPENDED`, or `FULLY_DEPRECIATED`)
4. Sale amount set on the line
5. Posting account **auto-resolves** to the disposal gain/loss account from the asset's category
6. User **posts the AR document**
7. Posting logic sees FIXED_ASSET line on AR → triggers the disposal flow:
   - Cutoff depreciation calculated and posted (if applicable)
   - Asset account credited (remove gross cost)
   - Accum depreciation account debited (remove accumulated depr)
   - Gain/loss recognized (sale proceeds vs NBV)
   - Asset status → DISPOSED
8. Single posting event handles everything — no separate multi-step FA sale staging API needed

### What This Replaces

| Current flow | New flow |
|---|---|
| Post bill → go to FA module → capitalize from AP line → create asset after the fact | Enter bill with one FIXED_ASSET line (`qty = N`) → post bill → system creates and capitalizes `N` asset units automatically |
| FA module creates draft AR → user edits → FA finalizes disposal via separate API | User creates AR with FA line → post AR → disposal happens automatically |
| User manually repeats identical lines or creates draft assets first | Supplier bill stays as one commercial line; asset system explodes it into per-unit assets underneath |
| `postingAccountId` manually picked | Account auto-resolved from asset category |

### Purchase UX: Quantity-Based Auto-Create First, Link-Existing Second

Real ERP systems handle the "asset doesn't exist yet" case in three ways:

| Pattern | Used by | How it works |
|---|---|---|
| **A: Quantity-based auto-create with generated asset defaults** | Oracle, Business Central-style bulk asset flows | Enter one commercial line (`qty = N`) → provide category/defaults → posting creates `N` asset cards/units. |
| **B: Inline Create + Link Existing** | SAP, Dynamics, modern SaaS | "+" button on the bill line opens a dialog → create one draft asset → auto-select on line. User never leaves the bill. |
| **C: Mass Additions Queue** | Oracle | Flag line as "capital" → lines queue up in FA module → admin reviews and creates assets. More steps. |

This plan uses **Pattern A as the primary AP UX** and keeps **Pattern B** as the escape hatch.

**Primary AP path**:

1. Select `FIXED_ASSET` on the line
2. Enter the real supplier line with `quantity = N`
3. Fill generated asset defaults: category, owner OU, location OU
4. Review preview text: **"Posting this line will create N assets at {per-unit amount} each."**
5. Continue entering the bill and post

**Escape hatches**:

- **Customize generated assets** when units are not identical
- **Expand into individual asset lines**
- **Link existing draft asset** when one specific draft asset already exists (`fixedAssetMode = LINK_EXISTING`, `targetFixedAssetId`, `quantity = 1`)

### Explicit AP Fixed-Asset Mode Contract

For AP `subledgerType = FIXED_ASSET`, the plan now makes the mode explicit in the request/UI contract:

- `fixedAssetMode = AUTO_CREATE`
- `fixedAssetMode = LINK_EXISTING`

This is an **API/UI field**, not a new persisted DB column. Draft lines continue to persist the underlying fields (`targetFixedAssetId` vs generated-asset defaults), and read responses may compute `fixedAssetMode` from those persisted values when needed.

This keeps the AP document close to the supplier invoice while letting the fixed-asset system do the per-unit explosion underneath. The full asset detail (serial number, legacy onboarding, account overrides) can be edited on the asset detail page after posting or through the optional customize flow.

### Immediate Cash Settlement (Cash Purchase in One Step)

**Problem**: For a one-time cash purchase (walk into a store, buy a printer, pay cash), the current system requires 3 separate operations: create AP bill → create cash payout → apply CARI settlement. This is too many steps for a simple cash purchase.

**How real ERP systems solve it**:

| Pattern | Used by | How it works |
|---|---|---|
| **Immediate Payment flag on bill** | SAP, Dynamics | Bill has a "pay now" toggle + payment source selector. Posting creates bill + payment + settlement atomically. |
| **Separate "Expense" entry** | QuickBooks, Xero | Simplified form distinct from "Bill". Under the hood still creates AP + payment. |

**This plan uses the Immediate Payment pattern** — a `settlement_mode` field on the CARI document header:

For this track, the repo-ready scope is cash only; `IMMEDIATE_BANK` is deferred until a bank-side immediate-payment primitive exists.

```
settlement_mode  ENUM('ACCRUAL', 'IMMEDIATE_CASH')  DEFAULT 'ACCRUAL'
```

| Settlement mode | Behavior |
|---|---|
| `ACCRUAL` | Current default — bill posted, AP open item created, pay later |
| `IMMEDIATE_CASH` | On posting: bill posted + cash payout auto-created + CARI settlement auto-applied. Requires `settlement_cash_register_id`. |

**User experience for a cash purchase**:

1. Create CARI AP document
2. Set payment: **"Cash Purchase"** → select cash register
3. Add lines (with subledger types as needed — FIXED_ASSET, STOCK, NONE)
4. **Post** → one click does everything:
   - AP journal posted
   - Subledger flows triggered (asset capitalized, stock received, etc.)
   - Cash payout transaction created
   - CARI settlement applied (AP open item cleared)
   - Bill shows as **"Paid"** immediately

The AP open item exists for milliseconds — created and cleared in the same database transaction. The user never sees an unpaid bill.

**This combines with subledger-aware lines**: a cash purchase of a fixed asset is just `settlement_mode = IMMEDIATE_CASH` + `subledger_type = FIXED_ASSET` on the line. Both features are orthogonal and compose naturally.

### AP/AR Navigation Split (Sidebar & Routing)

**Problem**: The current sidebar has a single "Cari Islemler" section that mixes customers + vendors, AP + AR documents, and settlements into one bucket. "Cari Belgeler" (Current Account Documents) is not standard accounting terminology — no real ERP puts vendor bills and sales invoices in the same list.

**How every real ERP does it**: AP and AR are **always separated** — SAP has Accounts Payable / Accounts Receivable as separate modules, Oracle has Payables / Receivables, Dynamics has the same split, QuickBooks uses Expenses vs Sales.

**This plan restructures the sidebar** from:

```
Cari Islemler (everything mixed)
  ├── Cari Kartlar
  │   ├── Alici Karti Olustur/Listesi
  │   └── Satici Karti Olustur/Listesi
  ├── Cari Belge ve Mutabakat
  │   ├── Cari Belgeler (AP + AR mixed)
  │   └── Cari Mahsuplastirma
  └── Cari Rapor ve Denetim
```

To:

```
Satinalma (Purchases / Accounts Payable)
  ├── Alis Faturalari (Vendor Bills)         — CARI documents filtered to direction=AP
  ├── Tedarikci Kartlari (Vendors)           — vendor cards only
  ├── Tedarikci Odemeler (AP Payments)       — settlements filtered to AP
  └── Tedarikci Bakiyeleri (AP Balances)     — AP aging/balance report

Satis (Sales / Accounts Receivable)
  ├── Satis Faturalari (Sales Invoices)      — CARI documents filtered to direction=AR
  ├── Musteri Kartlari (Customers)           — customer cards only
  ├── Musteri Tahsilatlar (AR Receipts)      — settlements filtered to AR
  ├── Musteri Bakiyeleri (AR Balances)       — AR aging/balance report
  ├── Sozlesmeler (Contracts)                — existing contracts page
  └── Donemsellik ve Tahakkuklar             — existing revenue recognition
```

**Backend doesn't change** — the CARI module still handles both AP and AR. The frontend pages are either:
- The same page pre-filtered (e.g., CariDocumentsPage with `direction=AP` prop)
- Or thin wrapper pages that pass the direction filter

**The old "Cari Islemler" menu is removed entirely** — its contents are distributed to Satinalma and Satis.

### What Stays the Same

- The manual acquisition flow (FA20–FA23) for assets not purchased through a vendor bill
- The existing CARI document structure (header, lines, taxes)
- The existing inventory `stock_impact_mode` pattern (formalized as `subledger_type = 'STOCK'`)
- All existing FA lifecycle operations (depreciation, transfer, writeoff, suspend/reactivate)

---

## Execution Tracking

Serialized steps `STEP-SL01` to `STEP-SL25`.

### Master Tracker

**Phase 1: Subledger-Aware Lines (Schema + Backend)**
- [ ] `STEP-SL01` — Migration: add `subledger_type`, fixed-asset target, and fixed-asset generation fields to `cari_document_lines`
- [ ] `STEP-SL02` — Backend validators: parse `subledgerType` with conditional required fields
- [ ] `STEP-SL03` — Backend CARI service: create/update document lines with subledger_type awareness
- [ ] `STEP-SL04` — Backend CARI service: auto-resolve posting account based on subledger_type + target entity
- [ ] `STEP-SL05` — 🔥 HOT — Backend CARI posting: FIXED_ASSET AP line → auto-create or capitalize assets from the bill line
- [ ] `STEP-SL06` — 🔥 HOT — Backend CARI posting: FIXED_ASSET AR line → trigger disposal flow on target eligible asset
- [ ] `STEP-SL07` — 🔥 HOT — Backend CARI reversal: reverse CAPITALIZATION / disposal when CARI document is reversed
- [ ] `STEP-SL08` — Backend FA service: adapt activation for assets already cost-posted via CARI
- [ ] `STEP-SL09` — Backend: backfill migration for existing stock-affecting lines (`subledger_type = 'STOCK'`)

**Phase 2: Subledger-Aware Lines (Frontend)**
- [ ] `STEP-SL10` — Frontend CARI form: add subledger_type selector to line entry
- [ ] `STEP-SL11` — Frontend CARI form: FIXED_ASSET conditional fields (auto-create defaults, link-existing picker, preview)
- [ ] `STEP-SL12` — Frontend CARI form: validation rules per subledger_type
- [ ] `STEP-SL13` — Frontend FA acquisitions page: show "linked from CARI" indicator, simplify capitalize section
- [ ] `STEP-SL14` — Frontend FA sale flow: simplify to "create AR doc with FIXED_ASSET line" guidance

**Phase 3: Immediate Cash/Bank Settlement**
- [ ] `STEP-SL15` — Migration: add `settlement_mode`, `settlement_cash_register_id`, and auto-settlement tracking to `cari_documents`
- [ ] `STEP-SL16` — 🔥 HOT — Backend CARI posting: immediate cash settlement (auto-create cash payout/receipt + auto-apply CARI settlement)
- [ ] `STEP-SL17` — Frontend CARI form: settlement mode selector (Accrual / Cash Purchase)
- [ ] `STEP-SL18` — 🔥 HOT — Backend CARI reversal: reverse immediate settlement when document is reversed

**Phase 4: AP/AR Navigation Split**
- [ ] `STEP-SL19` — Sidebar restructure: replace "Cari Islemler" with "Satinalma" and "Satis" sections
- [ ] `STEP-SL20` — Frontend routing: AP-filtered and AR-filtered views for CARI documents, cards, settlements
- [ ] `STEP-SL21` — Frontend pages: direction-aware wrappers for bills (AP), invoices (AR), vendor cards, customer cards
- [ ] `STEP-SL22` — i18n: AP/AR-specific labels (Vendor Bills, Sales Invoices, AP Payments, AR Receipts)
- [ ] `STEP-SL23` — Frontend: remove old "Cari Islemler" routes and redirect legacy URLs

**Phase 5: Testing & Release**
- [ ] `STEP-SL24` — Smoke suite: subledger lines + immediate settlement + AP/AR navigation + mixed flows + reversals
- [ ] `STEP-SL25` — Release gates and backward-compatibility verification

---

## `STEP-SL01` — Migration: add `subledger_type`, fixed-asset target, and fixed-asset generation fields to `cari_document_lines`

### Patch target
Add the schema foundation for subledger-aware lines.

### In scope
- Add `subledger_type` ENUM('NONE', 'STOCK', 'FIXED_ASSET') NOT NULL DEFAULT 'NONE' to `cari_document_lines`
- Add `target_fixed_asset_id` BIGINT UNSIGNED NULL to `cari_document_lines`
- Add `fixed_asset_category_id` BIGINT UNSIGNED NULL to `cari_document_lines`
- Add `fixed_asset_owner_operating_unit_id` BIGINT UNSIGNED NULL to `cari_document_lines`
- Add `fixed_asset_location_operating_unit_id` BIGINT UNSIGNED NULL to `cari_document_lines`
- Add FK constraint: `target_fixed_asset_id` → `fixed_assets(id)` (nullable, only set when `subledger_type = 'FIXED_ASSET'`)
- Add FK constraint: `fixed_asset_category_id` → `fixed_asset_categories(id)` (nullable, only set for AP FIXED_ASSET auto-create mode)
- Add FK constraints: `fixed_asset_owner_operating_unit_id` and `fixed_asset_location_operating_unit_id` → `operating_units(id)` (nullable, only set for AP FIXED_ASSET auto-create mode)
- Add CHECK constraint: `CHECK (subledger_type != 'FIXED_ASSET' OR target_fixed_asset_id IS NOT NULL OR fixed_asset_category_id IS NOT NULL)` — prevents persisting a FIXED_ASSET line without either a linked asset or generated-asset setup
- Add index: `ix_cari_doc_lines_tenant_target_fa (tenant_id, target_fixed_asset_id)` for reverse lookups
- Add index: `ix_cari_doc_lines_tenant_fa_category (tenant_id, fixed_asset_category_id)` for AP auto-create queries/reporting
- Use the repo's idempotent migration pattern (safeExecute, addColumnIfMissing)

### Explicit non-goals
- Do not backfill existing rows yet (SL09 handles that)
- Do not modify any service or validator code
- Do not change the ENUM values of `line_kind` or `stock_impact_mode`
- Do not add a persisted `fixed_asset_mode` database column in this step; mode stays in the API/UI contract only

### Definition of done
- Migration runs without error on a fresh database and on an existing database
- New columns exist with correct types and defaults
- FK constraints enforce referential integrity
- CHECK constraint prevents orphan FIXED_ASSET rows
- Existing data is untouched (all existing rows get `subledger_type = 'NONE'` from the DEFAULT)

---

## `STEP-SL02` — Backend validators: parse `subledgerType` with conditional required fields

### Patch target
Extend the CARI document line validator to accept and validate `subledgerType`, `fixedAssetMode`, `targetFixedAssetId`, and FIXED_ASSET auto-create metadata.

### In scope
- Parse `subledgerType` from line payload
- Parse `fixedAssetMode` from line payload for AP `FIXED_ASSET` lines
- Parse `fixedAssetCategoryId`, `fixedAssetOwnerOperatingUnitId`, and `fixedAssetLocationOperatingUnitId` from line payload
- **Backward-compat inference rule** (CRITICAL): When `subledgerType` is omitted or absent:
  - If `targetFixedAssetId` is present → auto-infer `subledgerType = 'FIXED_ASSET'`
  - Else if `stockImpactMode != 'NONE'` → auto-infer `subledgerType = 'STOCK'`
  - Otherwise → default `'NONE'`
  - `itemCardId` by itself does **not** imply `STOCK`; it remains valid under `NONE` for `SERVICE` / `NON_STOCK_GOOD` lines
  - **Why**: Existing clients send `{ itemCardId, stockImpactMode, warehouseId }` without any `subledgerType` field for stock-affecting rows, and they also send `{ itemCardId, stockImpactMode: 'NONE' }` for service / non-stock rows. Without this rule, stock requests would be misclassified as `NONE`, while a naive `itemCardId => STOCK` rule would incorrectly reclassify current non-stock/service usage.
- When `subledgerType = 'FIXED_ASSET'` on **AP**:
  - Accept `fixedAssetMode = 'AUTO_CREATE' | 'LINK_EXISTING'`
  - If `fixedAssetMode` is omitted for backward compatibility:
    - infer `LINK_EXISTING` when `targetFixedAssetId` is present
    - otherwise default to `AUTO_CREATE`
  - `fixedAssetMode = 'AUTO_CREATE'`: require `targetFixedAssetId` to be empty, require `quantity` to be a whole positive integer, and require `fixedAssetCategoryId`, `fixedAssetOwnerOperatingUnitId`, and `fixedAssetLocationOperatingUnitId`
  - `fixedAssetMode = 'LINK_EXISTING'`: require `targetFixedAssetId` and require `quantity = 1`
  - In both modes: reject `itemCardId` and `stockImpactMode != 'NONE'`
- When `subledgerType = 'FIXED_ASSET'` on **AR**: require `targetFixedAssetId` and require `quantity = 1`
- When `subledgerType = 'STOCK'` (explicit or inferred): require `itemCardId` and `stockImpactMode != 'NONE'`, reject `targetFixedAssetId`
- When `subledgerType = 'NONE'`: reject `targetFixedAssetId`, reject fixed-asset generation fields, allow normal fields including `itemCardId` so long as `stockImpactMode = 'NONE'`

### Explicit non-goals
- Do not change existing validation logic for non-subledger fields
- Do not validate whether the target asset exists (SL03/SL04 handle that)
- Do not validate account resolution yet (SL04 handles that)
- Do not persist `fixedAssetMode` as a DB column in this step

### Definition of done
- Existing create/update document requests without subledgerType continue to work unchanged (inference rule auto-promotes to STOCK only when stock fields are present)
- AP `subledgerType=FIXED_ASSET, fixedAssetMode=LINK_EXISTING` with `quantity != 1` returns 400
- AP `subledgerType=FIXED_ASSET, fixedAssetMode=AUTO_CREATE` with `targetFixedAssetId` returns 400
- AP `subledgerType=FIXED_ASSET, fixedAssetMode=AUTO_CREATE` without generated-asset fields returns 400
- AR `subledgerType=FIXED_ASSET` without `targetFixedAssetId` returns 400
- FIXED_ASSET with `itemCardId` returns 400
- subledgerType=STOCK without itemCardId returns 400
- Legacy request `{ itemCardId: 5, stockImpactMode: 'RECEIPT_PENDING', warehouseId: 3 }` (no subledgerType) succeeds and persists `subledger_type = 'STOCK'`
- Existing service/non-stock request `{ itemCardId: 5, stockImpactMode: 'NONE' }` (no subledgerType) succeeds and persists `subledger_type = 'NONE'`

---

## `STEP-SL03` — Backend CARI service: create/update document lines with subledger_type awareness

### Patch target
Persist `subledger_type`, `target_fixed_asset_id`, and FIXED_ASSET auto-create metadata when creating or updating CARI document lines, while exposing `fixedAssetMode` as an explicit API/UI contract field.

### In scope
- **Update `replaceDocumentLinesTx`** (currently at line ~2497 in `cari.document.service.js`): add `subledger_type`, `target_fixed_asset_id`, `fixed_asset_category_id`, `fixed_asset_owner_operating_unit_id`, and `fixed_asset_location_operating_unit_id` to the hardcoded INSERT statement
- **Update line normalization** (currently at line ~2128): parse and pass through `subledgerType`, `fixedAssetMode`, `targetFixedAssetId`, and generated-asset metadata from the validated input
- **Update `loadDocumentLinesForDocument`** SELECT queries (around line ~775-855): add the new fixed-asset columns to the SELECT list and include them in the response mapping
- Preserve current repo behavior where `itemCardId` may remain populated on `subledger_type = 'NONE'` lines for `SERVICE` / `NON_STOCK_GOOD` items; only stock-affecting lines (`stockImpactMode != 'NONE'`) are `STOCK`
- When `subledger_type = 'FIXED_ASSET'` and `target_fixed_asset_id` is present: validate that it references an existing asset in the same tenant/legal entity
- For AP documents in link-existing mode: validate target asset is in `DRAFT` status
- For AP documents in auto-create mode: validate `fixed_asset_category_id` exists in the same tenant/legal entity and that the chosen owner/location OUs are valid
- For AR documents: validate target asset is in `ACTIVE`, `SUSPENDED`, or `FULLY_DEPRECIATED` status — **not just ACTIVE**. The existing `SALE_STAGING_ELIGIBLE_STATUSES` (line ~5360 in `fixed-assets.service.js`) allows all three. Fully-depreciated assets being sold is a common real-world scenario.
- Return `subledgerType`, `fixedAssetMode`, `targetFixedAssetId`, and generated-asset metadata in document line read responses
- Compute `fixedAssetMode` on reads instead of persisting it:
  - AP + `target_fixed_asset_id` present => `LINK_EXISTING`
  - AP + `subledger_type = 'FIXED_ASSET'` and no `target_fixed_asset_id` => `AUTO_CREATE`
  - AR => omit or return `null`

### Explicit non-goals
- Do not change posting logic yet (SL05/SL06)
- Do not auto-resolve accounts yet (SL04)
- Do not add a `fixed_asset_mode` DB column

### Definition of done
- Creating a CARI AP document with a FIXED_ASSET auto-create line and valid generated-asset metadata succeeds
- Creating a CARI AP document with a FIXED_ASSET link-existing line and valid draft asset ID succeeds
- Creating a CARI AR document with a FIXED_ASSET line and valid active/suspended/fully-depreciated asset ID succeeds
- Creating a CARI line with `itemCardId` + `stockImpactMode = 'NONE'` persists `subledger_type = 'NONE'` without stock side effects
- Target asset validation rejects wrong status, wrong tenant, wrong legal entity
- Document read responses include the new fields, including computed `fixedAssetMode`
- `replaceDocumentLinesTx` persists all new fixed-asset line fields correctly

---

## `STEP-SL04` — Backend CARI service: auto-resolve posting account based on subledger_type + target entity

### Patch target
When a line has `subledger_type = 'FIXED_ASSET'`, automatically resolve the `posting_account_id` from the target asset's category instead of requiring manual selection.

### In scope
- For AP + FIXED_ASSET link-existing mode: resolve `posting_account_id` to the target asset's `default_asset_account_id` (from its category)
- For AP + FIXED_ASSET auto-create mode: resolve `posting_account_id` to the selected `fixed_asset_category_id`'s `default_asset_account_id`
- For AR + FIXED_ASSET: resolve `posting_account_id` to the target asset's `default_disposal_gain_account_id` (from its category)
- If user provides an explicit `postingAccountId` on a FIXED_ASSET line, reject it (account is category-driven, not user-selected)
- Store the resolved account on the line so it's visible before posting
- **NULL account guard**: All five category account columns (`default_asset_account_id`, `default_accum_depr_account_id`, `default_depr_expense_account_id`, `default_disposal_gain_account_id`, `default_disposal_loss_account_id`) are nullable in `fixed_asset_categories`. If the required account is NULL when resolving, throw a clear 400 error: "Asset category '{name}' does not have a configured {account type} account. Configure the category's accounts before using it on a CARI document." — This prevents a confusing deferred error at posting time. The existing FA06 flow (line ~2859-2878 in `fixed-assets.service.js`) validates all five accounts are non-null and throws `badRequest` if any is missing; this step applies the same guard earlier.

### Explicit non-goals
- Do not change account resolution for STOCK or NONE lines
- Do not change posting logic yet

### Definition of done
- FIXED_ASSET AP auto-create and link-existing modes auto-resolve to the correct asset account
- FIXED_ASSET AR line auto-resolves to disposal gain account
- Explicit postingAccountId on FIXED_ASSET line is rejected
- Account change on asset category before posting is reflected (re-resolved on post, not cached)
- Category with NULL required account returns a clear 400 error at draft save time (not at posting time)

---

## `STEP-SL05` — Backend CARI posting: FIXED_ASSET AP line → auto-create or capitalize assets from the bill line

### Patch target
When posting a CARI AP document, lines with `subledger_type = 'FIXED_ASSET'` trigger the fixed-asset capitalization flow. The primary mode is quantity-based asset creation from one commercial bill line; linking one pre-existing draft asset remains the constrained advanced mode.

### In scope
- During `postCariDocumentByIdTx()`, **after** the CARI journal is created via `insertPostedJournalWithLinesTx` (and after stock links at line ~4293), add a new `processFixedAssetLineSideEffectsTx()` call — analogous to the existing `replaceDocumentLineStockLinksTx` pattern. For each FIXED_ASSET line:
  - Determine mode:
    - Prefer explicit `fixedAssetMode` from the validated AP payload
    - Backward-compatible fallback if `fixedAssetMode` is omitted:
      - `target_fixed_asset_id IS NOT NULL` => `LINK_EXISTING`
      - otherwise => `AUTO_CREATE`
    - `AUTO_CREATE` and `LINK_EXISTING` are AP-only mode concepts; AR continues to use direct existing-asset selection
  - In both modes, reuse the already-created CARI posting journal's `journal_entry_id` — **do NOT create a separate acquisition journal**
  - In both modes, create CAPITALIZATION `fixed_asset_transaction` rows with:
    - `transactionType`: `'CAPITALIZATION'`
    - `effectiveDate`: document date
    - `postingDate`: document date
    - `bookId` / `fiscalPeriodId`: reuse the values resolved by `postCariDocumentByIdTx` for the posting
    - `journalEntryId`: the CARI posting journal's `journal_entry_id`
    - `sourceRefType`: `'CARI_DOCUMENT'`
    - `sourceRefId`: document ID
    - `sourceRefLineId`: line ID
    - `currencyCode`: document currency
  - **Auto-create mode**:
    - Treat one supplier line with `quantity = N` as **N asset units/cards**
    - Reuse the FA06 per-unit split logic (`computeFa06PerUnitAmounts` / equivalent) so `line net / quantity` is allocated consistently in txn and base currency, with normal rounding handling on the final unit
    - Create `quantity` new DRAFT fixed-asset rows using:
      - line description as the base asset name
      - `fixed_asset_category_id`
      - `fixed_asset_owner_operating_unit_id`
      - `fixed_asset_location_operating_unit_id`
    - Apply numbering / labeling so the created units remain distinguishable (`Table #1`, `Table #2`, ... or equivalent asset-no driven naming)
    - For each generated asset unit, create one CAPITALIZATION transaction and set:
      - `grossAmountTxn/Base`, `accumDeprAmountTxn/Base`, `nbvAmountTxn/Base`
      - `source_cari_document_id`
      - `source_cari_document_line_id`
      - `source_cari_document_line_unit_no = 1..N`
    - Add `upsertJournalSourceLinkTx` links from the shared CARI journal to each generated FA transaction
  - **Link-existing mode**:
    - Re-validate target asset is still DRAFT and in the same tenant/legal entity (`SELECT ... FOR UPDATE`)
    - Create one CAPITALIZATION transaction on the referenced draft asset
    - Update the asset's cost fields: `original_cost_txn`, `original_cost_base`, `acquisition_date` (from document date), `currency_code`, `source_cari_document_id`, `source_cari_document_line_id`, `source_cari_document_line_unit_no = 1`
    - Add a `upsertJournalSourceLinkTx` linking the CARI journal to the FA transaction
- **Why reuse the CARI journal**: The existing FA06 flow (`createAssetsFromCariDocumentLineFa06`, line ~2728) creates its OWN separate journal via `insertPostedJournalWithLinesTx`. The new flow is different — the CARI posting already created the correct journal lines (asset account debit from SL04's auto-resolution + AP control credit). The FA transaction just needs to reference that journal ID, not create a duplicate.
- If a link-existing target asset is no longer DRAFT at posting time, reject the posting with a clear error

### Explicit non-goals
- Do not change posting logic for NONE or STOCK lines
- Do not change the activation flow (SL08 handles that)
- Do not create a separate journal — the CARI posting journal already has the correct debit/credit lines
- Do not force users to enter repeated manual lines for identical units

### Definition of done
- Posting an AP doc with a FIXED_ASSET auto-create line and `quantity = N` creates `N` draft assets/cards and `N` CAPITALIZATION transactions
- Posting an AP doc with a FIXED_ASSET link-existing line creates one CAPITALIZATION transaction on the referenced draft asset
- The CAPITALIZATION transaction references the CARI posting journal (same `journal_entry_id`, no duplicate journal)
- Per-unit asset cost is allocated from the line amounts using quantity-based split logic
- `source_cari_document_line_unit_no` is `1..N` for auto-create mode and `1` for link-existing mode
- Journal entry debits asset account, credits AP control account (normal AP posting)
- Asset can subsequently be activated without posting an additional journal
- Posting is rejected if a link-existing target asset is not DRAFT

---

## `STEP-SL06` — Backend CARI posting: FIXED_ASSET AR line → trigger disposal flow on target eligible asset

### Patch target
When posting a CARI AR document, lines with `subledger_type = 'FIXED_ASSET'` trigger the fixed-asset disposal flow.

### In scope
- **Important repo-specific framing**: SL06 is a **parallel CARI posting path**, not a reuse of the current FA39/FA40 staged sale orchestration.
  - The existing sale flow in `fixed-assets.service.js` depends on asset-level pending sale state (`pending_sale_cari_document_id`, `pending_sale_cari_document_line_id`), a dedicated linked AR line, and two separate journals (`cutoffDepreciationJournalEntryId` and `saleJournalEntryId`) before it clears the pending linkage.
  - SL06 should reuse only the portable parts of that implementation:
    - `SALE_STAGING_ELIGIBLE_STATUSES`
    - `resolveDisposalCutoffEconomics()`
    - gain/loss math
    - disposal account validation rules
  - SL06 should **not** be framed as adapting `saleFinalizeAsset()` directly, because the new path posts from the CARI document itself and appends disposal effects into the same posting event.
- During `postCariDocumentByIdTx()`, within the same `processFixedAssetLineSideEffectsTx()` hook (created in SL05), for each FIXED_ASSET line on AR:
  - Re-validate target asset is in `ACTIVE`, `SUSPENDED`, or `FULLY_DEPRECIATED` status (matching existing `SALE_STAGING_ELIGIBLE_STATUSES` at line ~5360 in `fixed-assets.service.js`) and in the same tenant/legal entity
  - **Lock the asset row** (`SELECT ... FOR UPDATE`) to prevent concurrent modifications
  - Calculate cutoff depreciation through the day before disposal (reuse existing `resolveDisposalCutoffEconomics`), using the CARI posting's resolved `bookId` and `calendarId` for fiscal period context
  - **Append disposal journal lines to the CARI `postingLines` array BEFORE `ensureBalancedJournalLines` is called** — not after. The disposal creates balanced debit/credit pairs (asset credit + accum depr debit + gain/loss), so total journal balance is preserved. Cutoff depreciation lines (depr expense debit + accum depr credit) are also balanced pairs. Do NOT create a separate journal.
  - Create SALE transaction on the asset (same pattern as SL05: reference the CARI posting journal's `journal_entry_id`)
  - Post disposal journal lines: credit asset account (remove cost), debit accum depr (remove accumulated), recognize gain/loss (sale proceeds vs NBV)
  - Update asset status → DISPOSED
  - Set disposal metadata on `fixed_assets` using Track 38 FA52 schema: `disposal_date` (from document date), `disposal_type = 'SALE'`, `disposed_at = NOW()`, `disposal_proceeds_base`, and `disposal_gain_loss_base`
- Sale proceeds are the AR line amount; NBV is computed from asset records

### Explicit non-goals
- Do not remove or retrofit the existing multi-step sale staging API (FA39) — it remains as an alternative path with its own orchestration
- Do not handle write-off via CARI (write-off has no AR document — it stays as a standalone FA operation)

### Definition of done
- Posting an AR doc with a FIXED_ASSET line disposes the asset in a single posting
- Cutoff depreciation is calculated and posted
- Gain/loss is correctly recognized
- Asset status changes to DISPOSED
- Single journal entry covers AR + disposal + cutoff depreciation (all lines in one `postingLines` array)
- Sale of fully-depreciated and suspended assets works correctly (not just ACTIVE)

---

## `STEP-SL07` — Backend CARI reversal: reverse CAPITALIZATION / disposal when CARI document is reversed

### Patch target
When a CARI document containing FIXED_ASSET lines is reversed, undo the fixed-asset side effects.

### In scope

**Prerequisite — reversal line copy must include new columns**:
- The existing `reverseCariPostedDocumentById` (line ~4563 in `cari.document.service.js`) creates a reversal document by copying lines via `replaceDocumentLinesTx` (line ~2472). The current INSERT at line ~2497-2539 does NOT include `subledger_type` or `target_fixed_asset_id`. The line copy mapping at line ~4839-4916 also doesn't map these fields.
- **Both must be updated**: add `subledger_type` and `target_fixed_asset_id` to the INSERT columns and the line-copy field mapping. Without this, the reversal document's lines lose their subledger context and the FA reversal hooks below can't determine which lines to process.

**Shared-journal constraint — do not call the generic FA reversal helper here**:
- The existing `reverseFixedAssetTransaction()` in `fixed-assets.service.js` directly calls `reverseJournalEntryTx()` on `target.journalEntryId` when the target transaction has a journal.
- Under SL05 and SL06, the new FA `CAPITALIZATION` / `SALE` rows intentionally reuse the already-posted CARI `journal_entry_id` instead of creating a dedicated FA journal.
- Therefore the generic FA reversal helper must **not** be used for these shared-journal CARI-linked FA transactions. Doing so would reverse the whole posted CARI journal independently from the source CARI document reversal, which is incorrect.
- Required SL07 rule:
  - reverse the shared journal **only through CARI document reversal**
  - then mark the related FA transaction(s) reversed and restore asset state through FA-specific reversal/state-restore logic
  - do not let non-run FA reversal endpoints independently reverse shared-journal SL05 / SL06 transactions

**FA reversal side-effects** (added parallel to existing `buildDocumentReverseInventoryBlocks` pattern at line ~4641):

- For AP reversal with FIXED_ASSET lines:
  - Find all CAPITALIZATION transactions on `fixed_asset_transactions` where `source_ref_type = 'CARI_DOCUMENT'`, `source_ref_id = documentId`, `source_ref_line_id = lineId`, `reversal_transaction_id IS NULL`
  - If none are found (already reversed independently), skip this line's FA side-effects
  - If any linked asset status != DRAFT, **block the CARI reversal** with error: "Asset {assetNo} has been activated since capitalization. Reverse the activation first before reversing the source CARI document."
  - If the line used **auto-create mode** and the generated assets are still untouched DRAFT assets: mark the CAPITALIZATION rows reversed, then remove or archive the generated draft assets so the bill reversal leaves no orphan empty asset shells
  - If the line used **link-existing mode** and the linked asset is still DRAFT: mark the CAPITALIZATION transaction reversed, restore cost fields to zero, clear `source_cari_document_id/line_id/unit_no`, and do **not** independently reverse the shared journal through `reverseFixedAssetTransaction()`
- For AR reversal with FIXED_ASSET lines:
  - Find the SALE transaction on `fixed_asset_transactions` with the same lookup pattern
  - If the asset has had subsequent transactions since disposal, block the reversal
  - Reverse the SALE transaction + cutoff depreciation transaction through CARI-owned reversal orchestration (not via generic `reverseFixedAssetTransaction()` on the shared-journal SALE row)
  - Restore the asset to its pre-disposal status (ACTIVE, SUSPENDED, or FULLY_DEPRECIATED — stored on the SALE transaction or derived from the asset's depreciation state)

### Explicit non-goals
- Do not handle partial reversals (all-or-nothing document reversal is the existing pattern)

### Definition of done
- Reversal document lines include `subledger_type`, `target_fixed_asset_id`, and generated-asset metadata (copied from original)
- Reversing an AP doc with FIXED_ASSET auto-create lines removes or archives untouched generated draft assets and clears their capitalization effects
- Reversing an AP doc with FIXED_ASSET link-existing lines restores the linked draft asset to pre-capitalization state
- Reversing an AR doc with FIXED_ASSET lines restores the asset to pre-disposal status
- Reversal is blocked if asset state has progressed beyond what can be safely reversed
- Already-reversed FA transactions are skipped gracefully (no double-reversal)
- Shared-journal SL05 / SL06 transactions are never reversed through the generic non-run FA reversal helper
- Reversal journal correctly mirrors the original posting

---

## `STEP-SL08` — Backend FA service: adapt activation for assets already cost-posted via CARI

### Patch target
The activation flow must handle assets that already have cost posted via CARI (CAPITALIZATION transaction already exists) vs. manual acquisitions (ACQUISITION transaction created at activation time).

### In scope

**Current repo-specific gap that SL08 must absorb**:

The current `activateAsset()` implementation in `fixed-assets.service.js` does not only update status/schedule metadata. It also **unconditionally inserts an `ACQUISITION` transaction** after the asset update (current block around line ~3656). So for SL05-created CARI-capitalized assets, SL08 must suppress both:

- any additional acquisition-cost journal logic
- the extra activation-time `ACQUISITION` lifecycle transaction

Otherwise the asset would keep the original CARI-linked `CAPITALIZATION` row from SL05 and then get a second acquisition lifecycle row on activation, duplicating asset history even if accounting journals are not duplicated.

**Dual-mode `revalidateSourceLinkageForActivation`** (CRITICAL):

The existing `revalidateSourceLinkageForActivation()` (line ~1659 in `fixed-assets.service.js`) hard-requires all three source columns: `source_cari_document_id`, `source_cari_document_line_id`, AND `source_cari_document_line_unit_no`. It then performs unit-slot validation (slot number <= quantity, no slot collision, per-unit cost recomputation via `computeFa06PerUnitAmounts`). This is the **FA06 multi-asset path**.

The new SL05 flow now has **two AP variants**:

- **Auto-create mode**: generated assets use `source_cari_document_line_unit_no = 1..N`, which is conceptually close to the FA06 multi-asset split flow
- **Link-existing mode**: one pre-existing draft asset uses `source_cari_document_line_unit_no = 1`

The revalidation must detect which path created the asset and behave accordingly:

- **Detection**: Check if a CAPITALIZATION transaction exists on `fixed_asset_transactions` with `source_ref_type = 'CARI_DOCUMENT'` for this asset and whether its `journal_entry_id` belongs to the posted CARI document. If yes → SL05 path. If no → FA06/manual path.

- **SL05 path (CARI-capitalized asset)**:
  - Validate source CARI document is still POSTED and direction = AP
  - Validate source line still exists
  - If the asset came from **auto-create mode**: validate the asset's `source_cari_document_line_unit_no` is within the source line quantity and validate cost against the expected per-unit split for that slot
  - If the asset came from **link-existing mode**: validate asset cost matches the full line amount (`quantity = 1`)
  - Skip creating any new acquisition-cost journal logic (cost already journaled via CARI posting)
  - Skip inserting the activation-time `ACQUISITION` transaction (the existing lifecycle history already contains the SL05 `CAPITALIZATION` row)
  - Generate depreciation schedule as normal
  - Change status to ACTIVE
  - The activation becomes a metadata/schedule operation, not a new accounting or acquisition-lifecycle event

- **FA06 path (unchanged)**:
  - Existing `revalidateSourceLinkageForActivation` behavior unchanged (unit-slot validation, per-unit cost recomputation)

- Add a computed/exposed field `hasCariCapitalization` on asset detail so the frontend knows which path was taken

### Explicit non-goals
- Do not change the manual acquisition activation path (assets without source linkage)
- Do not force CARI capitalization — manual path remains valid

### Definition of done
- Asset with CARI-posted CAPITALIZATION (SL05 path) activates without double-posting
- Asset with CARI-posted CAPITALIZATION (SL05 path) does **not** get an extra activation-time `ACQUISITION` transaction
- Auto-created quantity-split assets validate against per-unit slot cost correctly at activation time
- Asset with FA06 source linkage activates with the existing unit-slot revalidation
- Asset without any CAPITALIZATION (manual path) activates with the normal `ACQUISITION` transaction path
- Depreciation schedule generation works identically in all cases
- `hasCariCapitalization` field is exposed on asset detail responses

---

## `STEP-SL09` — Backend: backfill migration for existing stock-affecting lines

### Patch target
Set `subledger_type = 'STOCK'` on existing lines that have `stock_impact_mode != 'NONE'` so the data is consistent with the new schema.

### In scope
- UPDATE `cari_document_lines` SET `subledger_type = 'STOCK'` WHERE `stock_impact_mode != 'NONE'`
- Idempotent — safe to run multiple times
- All other rows remain `subledger_type = 'NONE'`

### Explicit non-goals
- Do not change any behavior — this is a data alignment migration only

### Definition of done
- All existing stock-affecting lines have `subledger_type = 'STOCK'`
- All other lines have `subledger_type = 'NONE'`
- Migration is idempotent

---

## `STEP-SL10` — Frontend CARI form: add subledger_type selector to line entry

### Patch target
Add a subledger type dropdown to each line in the CARI document entry form.

### In scope
- Add `subledgerType` dropdown to line form: `NONE` (default), `STOCK`, `FIXED_ASSET`
- Label: "Line Type" / "Satir Tipi" (or "Subledger" / "Alt Defter")
- When changed, clear only fields that are incompatible with the new type:
  - switching from STOCK to FIXED_ASSET clears `itemCardId`, `warehouseId`, resets `stockImpactMode` to `NONE`, and initializes AP `fixedAssetMode` to `AUTO_CREATE`
  - switching from FIXED_ASSET to NONE clears `targetFixedAssetId`, `fixedAssetMode`, and generated-asset defaults (`fixedAssetCategoryId`, owner/location OUs)
  - switching from STOCK to NONE clears stock-only fields (`warehouseId`, non-`NONE` stockImpactMode) but may retain `itemCardId`
- Position: first field on each line row (before description)

### Explicit non-goals
- Do not implement conditional field rendering yet (SL11)
- Do not add validation (SL12)

### Definition of done
- Subledger type dropdown appears on each line
- Changing it clears cross-type fields
- AP FIXED_ASSET lines default `fixedAssetMode` to `AUTO_CREATE`
- Default is NONE
- Existing document creation continues to work (NONE = current behavior, including service/non-stock item-card usage)

---

## `STEP-SL11` — Frontend CARI form: FIXED_ASSET conditional fields (auto-create defaults, link-existing picker, preview)

### Patch target
When `subledgerType = 'FIXED_ASSET'` is selected on a line, show the correct purchase/sale UI for the chosen mode and surface the generated-asset preview.

### In scope
- For **AP documents**, show an explicit `fixedAssetMode` choice inside FIXED_ASSET:
  - `AUTO_CREATE` (default)
  - `LINK_EXISTING` (advanced)
- **AP `fixedAssetMode = AUTO_CREATE`** shows:
  - generated asset defaults: category, owner OU, location OU
  - quantity-aware preview text: **"Posting this line will create {quantity} assets at {perUnitAmount} each."**
  - optional action: **"Expand into individual asset lines"** or **"Customize generated assets"** for non-identical units
  - auto-resolved account (read-only, from selected category)
- **AP `fixedAssetMode = LINK_EXISTING`** shows:
  - a **draft asset picker** (search/select from existing DRAFT assets)
  - quantity locked to `1`
  - auto-resolved account (read-only, from the selected asset's category)
  - optional **"+ New Asset"** shortcut that opens a lightweight draft-asset modal and auto-selects the new draft asset on the line
- For **AR documents**, show an **active asset picker** (search/select from existing eligible sale assets) and keep quantity locked to `1`
- Asset picker shows: asset no, name, category, owner OU
- Hide the manual `postingAccountId` field when subledger_type is FIXED_ASSET
- When `subledgerType = 'STOCK'`: show existing stock-specific fields: `itemCardId`, `warehouseId`, `stockImpactMode`
- When `subledgerType = 'NONE'`: keep existing manual fields and continue allowing `itemCardId` for `SERVICE` / `NON_STOCK_GOOD` lines with `stockImpactMode = 'NONE'`
- **Inline "Create Asset" shortcut** remains available only for the AP link-existing path:
  - Clicking it opens a **modal/dialog** with the essential draft asset fields: name, category, owner OU, location OU
  - Category selection auto-fills depreciation profile, useful life, salvage rule from category defaults (same behavior as the existing create form)
  - On save, the draft asset is created via the existing `createFixedAsset()` API and auto-selected on the bill line
  - The user never leaves the CARI document page — the modal closes and the line is populated

### Explicit non-goals
- Do not replicate the full FixedAssetFormPage inside the modal — only essential fields (name, category, owner OU, location OU); advanced fields like serial number, legacy onboarding, account overrides are edited on the asset detail page after creation
- Do not force users into link-existing mode when the commercial bill is naturally one line with `quantity > 1`
- Do not expose `fixedAssetMode` on AR lines; AR always selects an existing asset directly

### Definition of done
- AP FIXED_ASSET line exposes explicit `fixedAssetMode`
- AP FIXED_ASSET line defaults to `fixedAssetMode = AUTO_CREATE` and shows generated-asset defaults
- AP `fixedAssetMode = AUTO_CREATE` shows preview text: **"Posting this line will create {quantity} assets at {perUnitAmount} each."**
- AP FIXED_ASSET line can switch to `fixedAssetMode = LINK_EXISTING`, which shows the draft asset picker
- AP `fixedAssetMode = LINK_EXISTING` includes a "+ New Asset" button that opens a quick-create modal
- Modal creates a draft asset and auto-selects it on the line without navigating away
- AR FIXED_ASSET line shows the active-asset picker and keeps quantity = 1
- STOCK line shows existing inventory fields
- NONE line shows existing manual fields and preserves current service/non-stock item-card behavior
- All three types can coexist on the same document

---

## `STEP-SL12` — Frontend CARI form: validation rules per subledger_type

### Patch target
Enforce form-level validation rules based on the selected subledger type and AP `fixedAssetMode`.

### In scope
- FIXED_ASSET AP requires explicit `fixedAssetMode`
- FIXED_ASSET AP `fixedAssetMode = AUTO_CREATE`: `targetFixedAssetId` must be empty, `quantity` must be a whole positive integer, and generated-asset defaults (`fixedAssetCategoryId`, `fixedAssetOwnerOperatingUnitId`, `fixedAssetLocationOperatingUnitId`) are required
- FIXED_ASSET AP `fixedAssetMode = LINK_EXISTING`: `targetFixedAssetId` required and `quantity = 1`
- FIXED_ASSET AR mode: `targetFixedAssetId` required and `quantity = 1`
- STOCK: `itemCardId` required, `stockImpactMode` required, `targetFixedAssetId` must be empty
- NONE: standard existing validation; `targetFixedAssetId` must be empty, and `itemCardId` remains allowed when `stockImpactMode = 'NONE'`
- Prevent document submission if validation fails
- Show inline validation messages per line

### Explicit non-goals
- Do not duplicate backend validation — frontend validation is UX-only

### Definition of done
- Cannot submit an AP FIXED_ASSET line without choosing `fixedAssetMode`
- Cannot submit an AP FIXED_ASSET `AUTO_CREATE` line without generated-asset defaults
- Cannot submit an AP FIXED_ASSET `LINK_EXISTING` line without selecting an asset
- Cannot submit an AP FIXED_ASSET `LINK_EXISTING` line or AR FIXED_ASSET line with `quantity != 1`
- Cannot submit a STOCK line without item card
- Can submit a NONE line with `itemCardId` when it is a non-stock/service line and `stockImpactMode = 'NONE'`
- Validation messages are visible inline

---

## `STEP-SL13` — Frontend FA acquisitions page: show "linked from CARI" indicator, simplify capitalize section

### Patch target
Update the acquisitions page to reflect the new CARI-integrated flow.

### In scope
- Show a "Linked from CARI" indicator on assets that have `source_cari_document_id` set
- Add a note: "Preferred flow: enter one vendor bill line with `FIXED_ASSET` and quantity, let posting create the asset units automatically. Use link-existing mode only when you already prepared a specific draft asset."
- Keep the existing "Capitalize from AP" section as a **fallback** (for bills already posted without subledger_type), but add guidance that the preferred flow is through the CARI form
- When an asset has a CAPITALIZATION transaction from CARI posting, show the source document link

### Explicit non-goals
- Do not remove the existing capitalize-from-AP flow — it's the fallback for legacy bills

### Definition of done
- Assets with CARI source show linked document indicator
- Guidance text directs users to the new CARI-integrated flow
- Existing capitalize flow still works as fallback

---

## `STEP-SL14` — Frontend FA sale flow: simplify to "create AR doc with FIXED_ASSET line" guidance

### Patch target
Update the FA sale UI to guide users toward the new CARI-integrated sale flow.

### In scope
- On the asset detail page sale action: instead of (or in addition to) the multi-step staging flow, show guidance: "Create a CARI AR document with a Fixed Asset line type pointing to this asset"
- Optionally: add a "Create Sale Invoice" shortcut button that navigates to the CARI document form pre-populated with `direction = 'AR'`, `subledgerType = 'FIXED_ASSET'`, `targetFixedAssetId = {currentAssetId}`
- Keep the existing multi-step sale staging API as a fallback

### Explicit non-goals
- Do not remove the existing sale staging API endpoints (FA39)

### Definition of done
- Users can reach the CARI AR document form from the asset detail page
- The new flow works end-to-end (create AR doc → FIXED_ASSET line → post → asset disposed)
- Existing sale staging flow still works as fallback

---

## `STEP-SL15` — Migration: add settlement_mode, settlement_cash_register_id, and auto-settlement tracking to cari_documents

### Patch target
Add the schema foundation for immediate cash settlement on CARI documents.

### In scope
- Add `settlement_mode` ENUM('ACCRUAL', 'IMMEDIATE_CASH') NOT NULL DEFAULT 'ACCRUAL' to `cari_documents`
- Add `settlement_cash_register_id` BIGINT UNSIGNED NULL to `cari_documents` — FK to `cash_registers(id)`
- Add `auto_settlement_batch_id` BIGINT UNSIGNED NULL to `cari_documents` — tracks the settlement batch created by immediate settlement for reversal lookup (SL18 needs this)
- Add `auto_settlement_cash_transaction_id` BIGINT UNSIGNED NULL to `cari_documents` — tracks the cash transaction created by immediate settlement for reversal lookup
- Add CHECK-like constraint: `settlement_cash_register_id` must be set when `settlement_mode = 'IMMEDIATE_CASH'`
- Use the repo's idempotent migration pattern

### Explicit non-goals
- Do not modify any service or validator code
- Do not change posting logic
- Do not add `IMMEDIATE_BANK` in this step; bank-side immediate payment is deferred to a later dedicated design/implementation step

### Definition of done
- Migration runs without error on fresh and existing databases
- New columns exist with correct types and defaults
- All existing documents get `settlement_mode = 'ACCRUAL'` from DEFAULT
- FK constraints enforce referential integrity
- `auto_settlement_batch_id` and `auto_settlement_cash_transaction_id` columns exist for SL16/SL18 to use

---

## `STEP-SL16` — Backend CARI posting: immediate cash settlement (auto-create cash payout/receipt + auto-apply CARI settlement)

### Patch target
When posting a CARI document with `settlement_mode = 'IMMEDIATE_CASH'`, automatically create the cash transaction and apply the CARI settlement in the same database transaction.

### In scope

**Transaction nesting problem** (CRITICAL):

The existing `applyCariSettlement()` (line ~4349 in `cari.settlement.service.js`) wraps its logic in its own `withTransaction()` call (line ~4493). The existing `createCashTransaction()` (line ~1931 in `cash.transaction.service.js`) also wraps in `withTransaction()` (line ~2033). But `postCariDocumentByIdTx()` already runs inside a `withTransaction()`. Calling these functions from within the CARI posting transaction would create nested `withTransaction` calls.

**Fix**: Extract the core logic of each into **transaction-aware internal variants** that accept a `queryFn`/`tx` parameter and skip the `withTransaction()` wrapper:
- `applyCariSettlementTx(tx, params)` — core settlement logic, receives an existing transaction handle
- `createCashTransactionTx(tx, params)` — core cash transaction logic, receives an existing transaction handle
- The public-facing functions remain unchanged (they wrap the `*Tx` variant in `withTransaction`)
- SL16 calls the `*Tx` variants from within `postCariDocumentByIdTx`, ensuring all operations share the same transaction
- `IMMEDIATE_BANK` is intentionally out of scope here because the repo does not yet expose an equivalent single-transaction bank payment creation/posting primitive that can safely participate in the same posting transaction

**Posting flow**:
- During `postCariDocumentByIdTx()`, after the normal AP/AR journal is posted and open item is created:
  - If `settlement_mode = 'IMMEDIATE_CASH'`:
    - Create a cash payout/receipt via `createCashTransactionTx(tx, ...)` (PAYOUT for AP, RECEIPT for AR) on the specified `settlement_cash_register_id`
    - Auto-apply CARI settlement via `applyCariSettlementTx(tx, ...)`
    - Store the created IDs on the document: `auto_settlement_cash_transaction_id`, `auto_settlement_batch_id` (for SL18 reversal lookup)
    - Mark the document as immediately settled (the open item balance should be zero after posting)
    - The AP/AR open item is created and cleared atomically
- Validate that the cash register belongs to the same tenant and legal entity
- Validate that the cash register has an active session (for IMMEDIATE_CASH) if sessions are required
- The settlement amount equals the document gross total — no partial settlement on immediate mode
- All operations happen in the same transaction — if any step fails, the entire posting rolls back

### Explicit non-goals
- Do not support partial immediate settlement (it's all or nothing — the full document amount is settled)
- Do not change the existing manual settlement flow (users can still create AP docs in ACCRUAL mode and settle later)
- Do not support mixed settlement (part cash, part credit) in this step
- Do not implement `IMMEDIATE_BANK` in this step; that requires a separate bank-side posting design first

### Definition of done
- Posting an AP doc with `settlement_mode = 'IMMEDIATE_CASH'` creates: AP journal + cash payout + settlement — AP open item balance = 0
- Posting an AR doc with `settlement_mode = 'IMMEDIATE_CASH'` creates: AR journal + cash receipt + settlement — AR open item balance = 0
- `settlement_mode = 'ACCRUAL'` (default) works exactly as before — no change
- Cash register validation rejects wrong tenant or missing session
- Transaction atomicity: failure in settlement step rolls back the entire posting (verified via `*Tx` variants, not nested `withTransaction`)
- `auto_settlement_batch_id` and `auto_settlement_cash_transaction_id` are stored on the document for SL18 reversal

---

## `STEP-SL17` — Frontend CARI form: settlement mode selector (Accrual / Cash Purchase)

### Patch target
Add a settlement mode selector to the CARI document form header.

### In scope
- Add a **"Payment"** section to the document header form:
  - Radio or dropdown: `On Credit (Accrual)` | `Cash Purchase`
  - Default: `On Credit (Accrual)` — current behavior
- When `Cash Purchase` is selected: show a **cash register picker** (dropdown of active cash registers)
- When `On Credit` is selected: hide payment source fields
- i18n labels for all new UI elements in both TR and EN
- The settlement mode and payment source are sent as part of the document create/update payload

### Explicit non-goals
- Do not implement split payment (part cash, part credit)
- Do not show settlement mode on AR documents initially (start with AP only; AR can be added later)
- Do not expose `IMMEDIATE_BANK` in the UI in this step

### Definition of done
- AP document form has a payment mode selector
- Cash Purchase shows cash register dropdown
- On Credit hides payment source fields
- Payload includes `settlementMode` and `settlementCashRegisterId` when needed

---

## `STEP-SL18` — Backend CARI reversal: reverse immediate settlement when document is reversed

### Patch target
When reversing a CARI document that was immediately settled, also reverse the auto-created payment and settlement.

### In scope
- During CARI document reversal (within `reverseCariPostedDocumentById`), if the document has `settlement_mode != 'ACCRUAL'`:
  - **Lookup the auto-created settlement and cash transaction** using `auto_settlement_batch_id` and `auto_settlement_cash_transaction_id` stored on the document by SL16. These columns provide a reliable, direct FK-based lookup — no guessing or convention-based search needed.
  - Reverse the CARI settlement via `reverseCariSettlementTx(tx, ...)` (transaction-aware variant, same pattern as SL16)
  - Reverse the auto-created cash payout/receipt via `reverseCashTransactionTx(tx, ...)`
  - All reversal operations happen in the same transaction (using `*Tx` variants, not nested `withTransaction`)
- The reversed cash transaction should reference the original as its reversal source
- If the cash register session has been closed since posting, the reversal creates a new cash transaction in the current active session (or fails if no session is active)

### Explicit non-goals
- Do not handle partial reversal
- Do not reverse if the settlement has been partially cleared by other transactions (block with error)

### Definition of done
- Reversing an immediately settled AP doc restores: AP open item cleared, cash payout reversed, settlement reversed
- Reversing an immediately settled AR doc restores: AR open item cleared, cash receipt reversed, settlement reversed
- Reversal finds the settlement/cash transaction via `auto_settlement_batch_id` / `auto_settlement_cash_transaction_id` (not by convention or search)
- Reversal fails gracefully if cash session is unavailable
- All operations are atomic (verified via `*Tx` variants)

---

## `STEP-SL19` — Sidebar restructure: replace "Cari Islemler" with "Satinalma" and "Satis" sections

### Patch target
Reorganize the sidebar from a single "Cari Islemler" bucket into separate "Satinalma" (Purchases/AP) and "Satis" (Sales/AR) top-level sections — matching standard ERP navigation.

### In scope
- Remove the "Cari Islemler" section from `sidebarConfig.js`
- Add **"Satinalma"** (Purchases) section with:
  - Alis Faturalari (Vendor Bills) → route to AP-filtered documents page
  - Tedarikci Kartlari (Vendors) → route to vendor card list
  - Tedarikci Odemeler (AP Payments) → route to AP-filtered settlements
  - Tedarikci Bakiyeleri (AP Balances) → route to AP balance report
- Add **"Satis"** (Sales) section with:
  - Satis Faturalari (Sales Invoices) → route to AR-filtered documents page
  - Musteri Kartlari (Customers) → route to customer card list
  - Musteri Tahsilatlar (AR Receipts) → route to AR-filtered settlements
  - Musteri Bakiyeleri (AR Balances) → route to AR balance report
  - Sozlesmeler (Contracts) → existing contracts page (moved here)
  - Donemsellik ve Tahakkuklar → existing revenue recognition (moved here)
- Move "Cari Rapor ve Denetim" sub-items as follows:
  - "Cari Raporlari" (`/app/cari-raporlari`) → duplicate under both "Satinalma" (as "Tedarikci Raporlari" / AP Reports) and "Satis" (as "Musteri Raporlari" / AR Reports), each pre-filtered by direction. If a shared view is needed, it can live under an existing "Raporlar" top-level section.
  - "Cari Denetim Izleri" (`/app/cari-audit`) → move to the existing "Ayarlar ve Yonetim" (Settings & Admin) section, since audit trails are cross-cutting and don't belong exclusively to AP or AR
- Preserve all existing `requiredPermissions` on each item (permissions stay as `cari.*`, not renamed)
- Update sidebar icons to match the new sections

### Explicit non-goals
- Do not change any backend route or endpoint
- Do not rename internal permission strings (they stay as `cari.*`)
- Do not change the CARI document data model

### Definition of done
- "Cari Islemler" no longer appears in the sidebar
- "Satinalma" and "Satis" appear as separate top-level sections
- All existing pages are reachable from the new navigation
- Permissions still gate correctly

---

## `STEP-SL20` — Frontend routing: AP-filtered and AR-filtered views for CARI documents, cards, settlements

### Patch target
Create new frontend routes that present the existing CARI pages pre-filtered by direction (AP or AR).

### In scope

**Actual codebase structure** (no `CariCardsPage` exists):
- Card pages use **`CariCounterpartyPage`** with a `pageKey` prop (`buyerCreate`, `buyerList`, `vendorCreate`, `vendorList`)
- Each `pageKey` maps to a `PAGE_CONFIG` entry with `mode` (create/list), `roleDefault` (CUSTOMER/VENDOR), and title
- Routes are already role-split: `/app/alici-kart-listesi` (buyer) vs `/app/satici-kart-listesi` (vendor)
- So card pages don't need a new `cardType` prop — they already filter by role via `pageKey`

**New routes to add:**
- `/app/alis-faturalari` → CariDocumentsPage with `direction="AP"` prop
- `/app/satis-faturalari` → CariDocumentsPage with `direction="AR"` prop
- `/app/tedarikci-kartlari` → CariCounterpartyPage with `pageKey="vendorList"` (reuses existing `PAGE_CONFIG`)
- `/app/tedarikci-kartlari/olustur` → CariCounterpartyPage with `pageKey="vendorCreate"`
- `/app/musteri-kartlari` → CariCounterpartyPage with `pageKey="buyerList"` (reuses existing `PAGE_CONFIG`)
- `/app/musteri-kartlari/olustur` → CariCounterpartyPage with `pageKey="buyerCreate"`
- `/app/tedarikci-odemeler` → CariSettlementsPage with `direction="AP"` prop
- `/app/musteri-tahsilatlar` → CariSettlementsPage with `direction="AR"` prop
- Register these routes in `App.jsx`
- The existing CariDocumentsPage should accept an optional `direction` prop to pre-filter and hide the direction selector when pre-set
- CariSettlementsPage should accept an optional `direction` prop to pre-filter

### Explicit non-goals
- Do not create entirely new page components — reuse existing pages with existing props
- Do not remove the old routes yet (SL23 handles that)
- Card pages need NO new prop — `pageKey` already handles role filtering

### Definition of done
- `/app/alis-faturalari` shows only AP documents
- `/app/satis-faturalari` shows only AR documents
- `/app/tedarikci-kartlari` shows only vendors (via existing `pageKey="vendorList"`)
- `/app/musteri-kartlari` shows only customers (via existing `pageKey="buyerList"`)
- Direction filter is hidden when pre-set via prop
- Old routes still work (not removed yet)

---

## `STEP-SL21` — Frontend pages: direction-aware wrappers for bills (AP), invoices (AR), vendor cards, customer cards

### Patch target
Create thin wrapper components or enhance existing pages to work cleanly with the direction-filtered routes.

### In scope
- If CariDocumentsPage currently doesn't accept a `direction` prop, add it:
  - When `direction` is set, pre-filter the list and hide the direction dropdown
  - When creating a new document, pre-set the direction to the filtered value
  - Page title should reflect the context: "Alis Faturalari" for AP, "Satis Faturalari" for AR
- **Card pages already work** — `CariCounterpartyPage` uses `pageKey` which maps to `PAGE_CONFIG` with role-specific titles and `roleDefault`. The new routes just pass the appropriate `pageKey`. Only title updates needed if the plan's new Turkish labels differ from the existing `PAGE_CONFIG` titles (e.g., "Tedarikci Kartlari" vs current "Satici Karti Listesi"). Update `PAGE_CONFIG` titles to match the new naming convention.
- CariSettlementsPage: add optional `direction` prop to pre-filter
- Ensure the "Create New" button on filtered pages creates with the correct direction/type

### Explicit non-goals
- Do not redesign the existing page layouts
- Do not change any API endpoints

### Definition of done
- AP-filtered page shows "Alis Faturalari" title and only AP documents
- AR-filtered page shows "Satis Faturalari" title and only AR documents
- "Create New" on AP page creates an AP document by default
- "Create New" on AR page creates an AR document by default
- Vendor card page shows "Tedarikci Kartlari" title (updated from "Satici Karti Listesi")
- Customer card page shows "Musteri Kartlari" title (updated from "Alici Karti Listesi")

---

## `STEP-SL22` — i18n: AP/AR-specific labels (Vendor Bills, Sales Invoices, AP Payments, AR Receipts)

### Patch target
Add i18n labels for the new AP/AR-specific navigation and page titles.

### In scope
- Add labels in both TR and EN for:
  - Sidebar sections: "Satinalma" / "Purchases", "Satis" / "Sales"
  - Page titles: "Alis Faturalari" / "Vendor Bills", "Satis Faturalari" / "Sales Invoices"
  - Card pages: "Tedarikci Kartlari" / "Vendors", "Musteri Kartlari" / "Customers"
  - Settlement pages: "Tedarikci Odemeler" / "AP Payments", "Musteri Tahsilatlar" / "AR Receipts"
  - Balance pages: "Tedarikci Bakiyeleri" / "AP Balances", "Musteri Bakiyeleri" / "AR Balances"
  - Action labels: "Yeni Alis Faturasi" / "New Vendor Bill", "Yeni Satis Faturasi" / "New Sales Invoice"
- Add labels for breadcrumbs if used

### Explicit non-goals
- Do not change existing i18n keys — only add new ones

### Definition of done
- All new pages and sidebar items have proper TR and EN labels
- No hardcoded strings in the new navigation components

---

## `STEP-SL23` — Frontend: remove old "Cari Islemler" routes and redirect legacy URLs

### Patch target
Clean up old routes and add redirects so bookmarks and links don't break.

### In scope
- Add redirects from old routes to new routes:
  - `/app/cari-belgeler` → `/app/alis-faturalari` (or a smart redirect based on user's last direction)
  - `/app/alici-kart-listesi` → `/app/musteri-kartlari`
  - `/app/satici-kart-listesi` → `/app/tedarikci-kartlari`
  - `/app/alici-kart-olustur` → `/app/musteri-kartlari/olustur`
  - `/app/satici-kart-olustur` → `/app/tedarikci-kartlari/olustur`
  - `/app/cari-settlements` → `/app/tedarikci-odemeler`
  - `/app/cari-raporlari` → `/app/tedarikci-raporlari` (or shared reports section)
  - `/app/cari-audit` → `/app/ayarlar/cari-denetim` (moved to Settings & Admin)
- Remove old sidebar entries (already done in SL19, this step cleans up route registrations)
- Remove or mark as deprecated any unused page wrappers

### Explicit non-goals
- Do not remove the underlying CariDocumentsPage component — it's still used by the new routes
- Do not change any API endpoint

### Definition of done
- All old CARI URLs redirect to their new equivalents
- No 404s for bookmarked old URLs
- Old sidebar entries are gone
- No unused route registrations remain

---

## `STEP-SL24` — Smoke suite: subledger lines + immediate settlement + AP/AR navigation + mixed flows + reversals

### Patch target
Verify the complete subledger-aware line and immediate settlement flows end to end.

### In scope
**Subledger line smokes:**
- **Purchase auto-create smoke**: create AP doc with one FIXED_ASSET line (`qty = 10`) → post → verify 10 draft assets/cards created, each has CAPITALIZATION transaction, per-unit cost split is correct, and unit provenance is `1..10`
- **Purchase link-existing smoke**: create one draft asset → create AP doc with FIXED_ASSET link-existing line (`qty = 1`) → post → verify referenced asset has CAPITALIZATION transaction
- **Sale smoke**: create and activate asset → create AR doc with FIXED_ASSET line → post → verify asset is DISPOSED with correct gain/loss
- **Mixed-line smoke**: create AP doc with one NONE line, one STOCK line, one FIXED_ASSET line → post → verify each line posted correctly
- **Reversal smoke**: post AP doc with FIXED_ASSET auto-create line → reverse → verify generated draft assets are removed/archived and no orphan capitalization remains
- **Reversal guard smoke**: post AP doc with FIXED_ASSET line → activate asset → attempt to reverse CARI doc → verify reversal is blocked
- **Link-existing quick-create smoke**: on CARI form, switch AP FIXED_ASSET line to link-existing mode → use "+ New Asset" modal → verify draft created and auto-selected on line
- **Preview/customize smoke**: on CARI form, select FIXED_ASSET with `qty > 1` → verify preview text shows "Posting this line will create N assets at X each" and customize/expand action is visible

**Immediate settlement smokes:**
- **Cash purchase smoke**: create AP doc with `settlement_mode = IMMEDIATE_CASH` → post → verify cash payout created + settlement applied + AP open item balance = 0
- **Cash + FA combined smoke**: create AP doc with `settlement_mode = IMMEDIATE_CASH` + FIXED_ASSET line → post → verify asset capitalized AND cash settled in one operation
- **Cash reversal smoke**: post immediately settled AP doc → reverse → verify cash payout reversed + settlement reversed + AP open item cleared
- **Accrual default smoke**: create AP doc without settlement_mode → post → verify no auto-settlement (current behavior unchanged)

**Frontend build:** `npm run build` passes

### Explicit non-goals
- Do not create automated test scripts unless they follow existing repo patterns

### Definition of done
- All smoke scenarios pass
- Build clean
- No regression in existing CARI, FA, or cash flows

---

## `STEP-SL25` — Release gates and backward-compatibility verification

### Patch target
Final validation that all new flows work alongside existing flows without regression.

### In scope
- Verify existing manual acquisition flow (FA20–FA23) works unchanged
- Verify existing after-the-fact capitalize flow (FA24–FA27) works unchanged
- Verify existing sale staging flow (FA39) works unchanged
- Verify existing CARI document creation/posting without subledger_type works unchanged
- Verify existing inventory stock-impact flow works unchanged
- Verify existing CARI → cash manual settlement flow works unchanged (ACCRUAL mode)
- Verify existing cash transaction creation without CARI works unchanged
- Document: which flow is recommended vs. which is fallback
- Verify OpenAPI spec includes new fields (subledger_type, target_fixed_asset_id, settlement_mode, settlement_cash_register_id)

### Explicit non-goals
- Do not deprecate or remove any existing endpoint
- Do not block deployment on fallback paths being removed

### Definition of done
- Zero regression in existing flows (CARI, FA, cash, bank, inventory)
- New subledger-aware flow documented as the recommended path
- New immediate settlement flow documented as the recommended path for cash purchases
- `IMMEDIATE_BANK` explicitly documented as deferred until a bank-side immediate-posting primitive exists
- Existing flows documented as fallback
- All smoke tests pass

---

## Codex Execution Matrix

### `STEP-SL01`
- `AI size`: Small
- `Allowed files`: `backend/src/migrations/m144_cari_document_lines_subledger_type.js`, `backend/src/migrations/index.js`
- `Dependencies`: Track 38 STEP-FA09 to STEP-FA12 (FA tables must exist for FK)
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL02`
- `AI size`: Small
- `Allowed files`: `backend/src/routes/cari.document.validators.js`
- `Dependencies`: SL01
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL03`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/cari.document.service.js`
- `Dependencies`: SL01, SL02
- `Blocked by`: none
- `Rollback risk`: Medium

### `STEP-SL04`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: SL03
- `Blocked by`: none
- `Rollback risk`: Medium

### `STEP-SL05`
- `AI size`: Large
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: SL04, Track 38 FA24-FA27
- `Blocked by`: none
- `Rollback risk`: High — changes posting logic

### `STEP-SL06`
- `AI size`: Large
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: SL05, Track 38 FA39, Track 38 FA52
- `Blocked by`: none
- `Rollback risk`: High — changes posting logic + disposal accounting

### `STEP-SL07`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/fixed-assets.service.js`
- `Dependencies`: SL05, SL06
- `Blocked by`: none
- `Rollback risk`: High — reversal must exactly mirror posting

### `STEP-SL08`
- `AI size`: Small
- `Allowed files`: `backend/src/services/fixed-assets.service.js`
- `Dependencies`: SL05
- `Blocked by`: none
- `Rollback risk`: Medium — must not break manual activation

### `STEP-SL09`
- `AI size`: Small
- `Allowed files`: `backend/src/migrations/m145_cari_document_lines_subledger_backfill.js`, `backend/src/migrations/index.js`
- `Dependencies`: SL01
- `Blocked by`: none
- `Rollback risk`: Low — data-only, idempotent

### `STEP-SL10`
- `AI size`: Small
- `Allowed files`: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/cariDocumentsUtils.js`, `frontend/src/i18n/messages.js`
- `Dependencies`: SL02
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL11`
- `AI size`: Medium
- `Allowed files`: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/cariDocumentsUtils.js`, `frontend/src/api/fixedAssets.js`, `frontend/src/i18n/messages.js`
- `Dependencies`: SL10
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL12`
- `AI size`: Small
- `Allowed files`: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/cariDocumentsUtils.js`
- `Dependencies`: SL11
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL13`
- `AI size`: Small
- `Allowed files`: `frontend/src/pages/fixedAssets/FixedAssetAcquisitionsPage.jsx`, `frontend/src/i18n/messages.js`
- `Dependencies`: SL05
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL14`
- `AI size`: Small
- `Allowed files`: `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`, `frontend/src/i18n/messages.js`
- `Dependencies`: SL06
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL15`
- `AI size`: Small
- `Allowed files`: `backend/src/migrations/m146_cari_documents_settlement_mode.js`, `backend/src/migrations/index.js`
- `Dependencies`: none beyond repo baseline (`cash_registers` table must exist)
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL16`
- `AI size`: Large
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/cash.transaction.service.js`, `backend/src/services/cari.settlement.service.js`, `backend/src/routes/cari.document.validators.js`
- `Dependencies`: SL15, SL05
- `Blocked by`: none
- `Rollback risk`: High — changes posting logic, touches cash + settlement

### `STEP-SL17`
- `AI size`: Medium
- `Allowed files`: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/cariDocumentsUtils.js`, `frontend/src/i18n/messages.js`
- `Dependencies`: SL16
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL18`
- `AI size`: Medium
- `Allowed files`: `backend/src/services/cari.document.service.js`, `backend/src/services/cash.transaction.service.js`, `backend/src/services/cari.settlement.service.js`
- `Dependencies`: SL16
- `Blocked by`: none
- `Rollback risk`: High — reversal must exactly mirror posting

### `STEP-SL19`
- `AI size`: Medium
- `Allowed files`: `frontend/src/layouts/sidebarConfig.js`, `frontend/src/i18n/messages.js`
- `Dependencies`: none (can be done in parallel with Phase 1–3)
- `Blocked by`: none
- `Rollback risk`: Low — sidebar config only

### `STEP-SL20`
- `AI size`: Medium
- `Allowed files`: `frontend/src/App.jsx`, `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/CariCounterpartyPage.jsx`, `frontend/src/pages/cari/CariSettlementsPage.jsx`
- `Dependencies`: SL19
- `Blocked by`: none
- `Rollback risk`: Low — additive routes only
- `Note`: Card pages use existing `pageKey` prop (not a new `cardType` prop) — no `CariCardsPage` exists

### `STEP-SL21`
- `AI size`: Medium
- `Allowed files`: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/CariCounterpartyPage.jsx`, `frontend/src/pages/cari/CariSettlementsPage.jsx`
- `Dependencies`: SL20
- `Blocked by`: none
- `Rollback risk`: Low

### `STEP-SL22`
- `AI size`: Small
- `Allowed files`: `frontend/src/i18n/messages.js`
- `Dependencies`: SL21
- `Blocked by`: none
- `Rollback risk`: Low — i18n only

### `STEP-SL23`
- `AI size`: Small
- `Allowed files`: `frontend/src/App.jsx`, `frontend/src/layouts/sidebarConfig.js`
- `Dependencies`: SL20, SL21
- `Blocked by`: none
- `Rollback risk`: Medium — removing old routes, must ensure redirects work

### `STEP-SL24`
- `AI size`: Large
- `Allowed files`: smoke test scripts, plan documents
- `Dependencies`: SL01–SL23
- `Blocked by`: any incomplete prerequisite step
- `Rollback risk`: Low — test-only

### `STEP-SL25`
- `AI size`: Small
- `Allowed files`: plan documents, `backend/openapi.yaml`
- `Dependencies`: SL24
- `Blocked by`: any failing smoke test
- `Rollback risk`: Low

---

## Dependencies

### On Track 38 (Fixed Assets)
This track assumes Track 38 is complete through at least:
- **FA09–FA12**: FA tables exist (FK target for `target_fixed_asset_id`)
- **FA17–FA23**: Draft asset creation and manual activation work
- **FA24–FA27**: Existing after-the-fact capitalization logic (reused/adapted in SL05)
- **FA39**: Existing sale staging logic (reused/adapted in SL06)
- **FA52**: Disposal metadata columns exist so SL06 can persist `disposal_type`, `disposed_at`, proceeds, and gain/loss directly on `fixed_assets`
- **FA45**: FA permissions seeded

Track 38's existing capitalization flow (FA24–FA27, FA51) and sale staging flow (FA39) are **not removed** — they become fallback paths for legacy documents that were created without subledger_type awareness.

### On existing Cash module
Phase 3 (SL15–SL18) depends on the cash module being operational:
- **Cash registers** table and CRUD must exist
- **Cash transactions** with PAYOUT/RECEIPT types must be creatable programmatically
- **`applyCariSettlement()`** in `cari.settlement.service.js` must be callable from within a transaction
- **Cash sessions** (if enforced) must be queryable for active session lookup

### On existing Bank module
`IMMEDIATE_BANK` is **deferred from this track**. The current repo does not yet expose a clear bank-side equivalent to `createCashTransactionTx(...)` that can create and post an immediate bank payment inside the same posting transaction.

If bank-immediate settlement is later added, it should be designed as a separate follow-up step with its own migration/service/reversal contract:
- **Bank accounts** table and CRUD must exist
- Bank payment creation must be invocable programmatically from the posting transaction
- A bank-side `*Tx` primitive must exist before extending `settlement_mode`
