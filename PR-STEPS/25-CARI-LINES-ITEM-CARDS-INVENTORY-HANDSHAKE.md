# 25 - CARI LINES, ITEM CARDS, AND INVENTORY HANDSHAKE

## Execution tracking
- This file is both the source/spec file and the execution tracker.
- Keep execution status in the `Master tracker` section below.

## Why this PR set exists
- Current CARI documents are header-based. They carry one document total, while real invoices often contain multiple commercial lines.
- Current tax integration is document-level. That is good enough for one-rate invoices, but not for mixed invoices such as:
  - food at `8%`
  - goods/services at `18%`
- Current stock/inventory entries exist in the sidebar, but they are still placeholder routes. That means future stock behavior needs a clean commercial line model first.
- Real AP/AR flows later need to support these accounting patterns without redesigning CARI again:
  - purchase stock item -> inventory asset such as `153`
  - sell stock item -> revenue such as `600`
  - cost recognition later through inventory movement valuation, not by guessing inside header-only CARI posting

## Current implementation facts that matter
- `backend/src/migrations/m017_cari_schema_foundation.js` defines `cari_documents` and `cari_open_items`, but there is no commercial invoice-line table yet.
- `backend/src/services/cari.tax.integration.service.js` currently augments tax once per document total.
- `backend/src/services/cari.document.service.js` posts from document/header context, not from explicit commercial lines.
- `backend/src/migrations/m020_contracts_foundation.js` already shows a valid child-line pattern in `contract_lines`; that is the local precedent for invoice lines.
- `frontend/src/layouts/sidebarConfig.js` already exposes stock/inventory menu entries, while `frontend/src/App.jsx` still routes them to placeholders.

## Locked decisions
- Add a real commercial line model to CARI. Do not keep treating one invoice as one taxable amount forever.
- `cari_documents` remains the commercial header and settlement anchor.
- Add `cari_document_lines` for business lines.
- Add `cari_document_line_taxes` for resolved tax components per line.
- Do not overload `cari_open_items` with commercial line behavior. Open items stay document/installment/settlement oriented.
- Settlement remains document/open-item based in this PR set. No line-level settlement in v1.
- Header totals must become aggregated snapshots from lines:
  - subtotal/net
  - tax total
  - gross total
- Tax determination must become line-based.
- One line may have multiple tax components in the model, even if the first rollout mainly uses one VAT line per commercial line.
- Journal posting should produce one gross AR/AP control line per document side where possible, not duplicate control lines for tax balancing.
- Introduce a generic `item_cards` layer before full inventory:
  - `SERVICE`
  - `NON_STOCK_GOOD`
  - `STOCK_ITEM`
- Invoice lines may reference an item card, but free-text/manual lines must remain allowed.
- Do not make stock cards the only way to create invoice lines.
- `STOCK_ITEM` must be future-compatible with inventory quantity/cost layers, but this PR set must not block on full warehouse logic.
- For stockable items:
  - AP line may resolve to inventory asset account such as `153`
  - AR line may resolve to revenue account
  - `COGS` posting must be handled later by inventory movement/cost logic, not fabricated directly by header-only CARI code

## Scope
- Add line tables, line APIs, line tax resolution, and line-driven posting for CARI.
- Add a minimal item-card master model that invoice lines can reference.
- Add the accounting handshake needed so future inventory work can attach to CARI lines safely.
- Update frontend CARI document entry so operators can create mixed-line invoices.
- Update docs/ADR/runbooks to reflect line-based tax and item-aware posting.

## Non-goals
- No warehouse, bin, lot, serial, or batch tracking in the first line-model PRs.
- No full procurement or sales-order lifecycle.
- No line-level settlement or per-line collection matching.
- No auto-COGS without inventory movement valuation.
- No destructive rewrite of existing posted CARI history.
- No requirement that every line must reference an item card.

## Unified execution order
1. `PR-CLI01` - CARI line schema foundation
2. `PR-CLI02` - Draft/create/read API compatibility for lines
3. `PR-CLI03` - Line-level tax determination and persistence
4. `PR-CLI04` - Line-driven journal posting refactor
5. `PR-CLI05` - CARI document UI line workbench
6. `PR-CLI06` - Item card master foundation
7. `PR-CLI07` - Stock accounting handshake from CARI lines
8. `PR-CLI08` - Inventory foundation and movement model
9. `PR-CLI09` - Rollout hardening, docs, and regression coverage

## Master tracker
- [x] `PR-CLI01` acceptance: `cari_document_lines` and `cari_document_line_taxes` exist, and line snapshots can coexist with current header/open-item rows without breaking existing reads.
- [x] `PR-CLI02` acceptance: old clients can still create/post a document through a synthetic single-line compatibility path, while new clients can send explicit `lines[]`.
- [x] `PR-CLI03` acceptance: one invoice can carry different tax outcomes on different lines and persist a traceable line-tax breakdown.
- [x] `PR-CLI04` acceptance: posting reads resolved lines, produces one gross control line plus revenue/expense/tax detail, and keeps reversals/history additive.
- [x] `PR-CLI05` acceptance: the CARI document UI supports mixed lines, inline totals, and line tax preview without breaking draft/edit/post flows.
- [x] `PR-CLI06` acceptance: item cards exist as reusable masters with account/tax defaults and can be selected from CARI lines.
- [x] `PR-CLI07` acceptance: stockable item lines can resolve to inventory asset posting on purchase side and carry future stock-impact linkage on sales side.
- [x] `PR-CLI08` acceptance: inventory module stops being placeholder-only and introduces stock movement/cost foundations that can link back to CARI lines.
- [x] `PR-CLI09` acceptance: ADR/runbooks/tests are updated and regression coverage proves old single-line CARI flows still work.

## PR-CLI01
Goal:
- Add the minimum line schema so a CARI document can hold real commercial lines and their tax results.

Deliverables:
- New migration `m115_cari_document_lines_foundation.js`
- Add `cari_document_lines` with at least:
  - `tenant_id`
  - `legal_entity_id`
  - `cari_document_id`
  - `line_no`
  - `line_kind`
  - `description`
  - `item_card_id` nullable
  - `quantity`
  - `unit_price_txn`
  - `line_net_amount_txn`
  - `line_tax_amount_txn`
  - `line_gross_amount_txn`
  - `posting_account_id` nullable snapshot/override field
  - `tax_category_code` nullable
  - `stock_impact_mode` nullable
  - `created_at`, `updated_at`
- Add `cari_document_line_taxes` with at least:
  - `tenant_id`
  - `legal_entity_id`
  - `cari_document_id`
  - `cari_document_line_id`
  - `component_no`
  - `tax_code`
  - `tax_kind`
  - `rate_pct`
  - `tax_base_amount_txn`
  - `tax_amount_txn`
  - `tax_purpose_code`
  - `account_id`
  - `created_at`, `updated_at`
- Add header snapshot totals to `cari_documents` if not already present in a usable form:
  - `subtotal_amount_txn`
  - `tax_amount_txn`
  - `gross_amount_txn`
  - base-currency mirrors when needed
- Preserve existing gross `amount_txn` compatibility on `cari_documents`.

Files:
- `backend/src/migrations/m115_cari_document_lines_foundation.js`
- `backend/src/migrations/index.js`

Acceptance:
- A CARI document can persist zero or more draft lines during rollout, with synthetic compatibility allowed by later PRs.
- `line_no` is unique within one document.
- Line taxes are stored per line, not only inferred from journal lines.
- Existing posted history remains readable without backfilling fake lines immediately.

Notes:
- This PR is schema-first. Do not mix it with posting logic yet.

## PR-CLI02
Goal:
- Make line-aware create/update/read flows work while preserving old header-only callers.

Deliverables:
- Extend document validators to accept `lines[]`.
- Extend create/update draft service paths to:
  - validate and persist explicit lines when provided
  - synthesize one compatibility line when only header amount data is provided
- Extend document detail/read payloads to include:
  - `lines`
  - per-line tax components
  - header totals derived from lines
- Keep old payload compatibility for existing callers until UI rollout completes.

Files:
- `backend/src/routes/cari.document.validators.js`
- `backend/src/routes/cari.document.routes.js`
- `backend/src/services/cari.document.service.js`
- `backend/openapi.yaml`

Acceptance:
- Old clients can still create a normal one-line invoice without knowing the new line schema.
- New clients can create multi-line drafts.
- Reads return deterministic line ordering and totals.
- Draft update keeps snapshot totals aligned with stored lines.

Notes:
- This PR should not yet change tax resolution rules. It only makes line data first-class.

## PR-CLI03
Goal:
- Resolve tax per commercial line so mixed-rate invoices become possible.

Deliverables:
- Extend tax rule resolution inputs to support line context, such as:
  - `taxCategoryCode`
  - item type or line kind
  - optional explicit line tax override path if governance allows it
- Refactor the current document-level tax integration so it can resolve each line independently.
- Persist resolved tax components into `cari_document_line_taxes`.
- Aggregate line taxes back into header tax totals.
- Preserve feature-flag gating through `FEATURE_TAX_ENGINE_V1`.

Files:
- `backend/src/services/tax.engine.service.js`
- `backend/src/services/cari.tax.integration.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/routes/tax.routes.js` if setup/read contracts need new line criteria fields
- `backend/src/services/tax.setup.service.js` if setup preview must expose line criteria

Acceptance:
- One invoice can contain at least:
  - one line taxed at `8%`
  - one line taxed at `18%`
  and compute the correct summed invoice total.
- Tax evidence is traceable per line.
- If line tax setup is incomplete, errors remain explicit and fail-fast.
- Single-line tax behavior remains compatible with current simple scenarios.

Notes:
- This is the PR where tax stops meaning "one document, one taxable base".

## PR-CLI04
Goal:
- Make journal posting read line results instead of inventing accounting from one header total.

Deliverables:
- Refactor document posting to build journal lines from commercial lines.
- Produce:
  - one gross AR/AP control line per document side
  - revenue/expense/inventory-asset detail by line or aggregated compatible bucket
  - tax journal lines from stored line-tax results
- Remove the need for duplicate tax-balancing control lines in the normal invoice output.
- Keep reversal generation line-aware and additive.

Files:
- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.tax.integration.service.js`
- `backend/src/routes/gl.read.journal.routes.js` only if read serialization needs extra line/source references

Acceptance:
- A posted mixed-line invoice journals correctly from explicit line data.
- Control account appears as one gross line per side in the normal case.
- Tax lines remain separately traceable by tax code/account.
- Existing reversal/open-item behavior remains intact.

Notes:
- This PR is where commercial intent becomes actual accounting input.

## PR-CLI05
Goal:
- Replace header-only invoice entry with a real line workbench in the CARI document UI.

Deliverables:
- Add a line grid to the document create/edit flow.
- Support:
  - free-text/manual lines
  - optional item-card selection
  - quantity
  - unit price
  - line net/tax/gross preview
  - add/remove/reorder lines
- Show header totals derived from lines.
- Show tax preview by line and aggregated invoice total.
- Keep single-line fast entry simple; do not force item-card usage.

Files:
- `frontend/src/pages/cari/CariDocumentsPage.jsx`
- `frontend/src/pages/cari/cariDocumentsUtils.js`
- `frontend/src/api/cariDocuments.js`
- `frontend/src/i18n/messages.js`

Acceptance:
- Operator can create a mixed invoice with multiple lines and see the correct total before post.
- A simple one-line service invoice still takes only a few inputs.
- Draft edit and post flows still work.
- Validation errors point to the specific line when possible.

Notes:
- Avoid making the first version feel like a warehouse screen. This is still a finance-first invoice workbench.

## PR-CLI06
Goal:
- Introduce reusable item masters so invoice lines can inherit tax and GL defaults without waiting for full inventory.

Deliverables:
- New migration `m116_item_cards_foundation.js`
- Add `item_cards` with at least:
  - `tenant_id`
  - `legal_entity_id` nullable if tenant-global is allowed later
  - `code`
  - `name`
  - `item_type` = `SERVICE | NON_STOCK_GOOD | STOCK_ITEM`
  - `default_sales_account_id`
  - `default_purchase_account_id`
  - `inventory_asset_account_id` nullable
  - `default_cogs_account_id` nullable
  - `tax_category_code` nullable
  - `status`
- Minimal CRUD/read endpoints for item cards.
- CARI line picker integration so a selected item card can default:
  - description
  - accounts
  - tax category
  - stock impact semantics

Files:
- `backend/src/migrations/m116_item_cards_foundation.js`
- `backend/src/migrations/index.js`
- `backend/src/routes` new item-card routes/validators
- `backend/src/services` new item-card service
- `frontend/src/api` new item-card API client
- `frontend/src/pages` minimal item-card maintenance UI
- `frontend/src/i18n/messages.js`

Acceptance:
- A finance user can create and reuse item cards without full inventory setup.
- Service lines, non-stock goods, and stock items are distinguishable.
- Selecting an item card on a CARI line pre-fills sensible defaults but still allows controlled overrides.

Notes:
- This is intentionally broader than "stock card" so services and non-stock goods fit the same invoice model.

## PR-CLI07
Goal:
- Add the accounting handshake so stockable-item invoices are future-safe before full inventory lands.

Deliverables:
- Define how `STOCK_ITEM` lines resolve accounts:
  - AP purchase line may debit `inventory_asset_account_id` such as `153`
  - AR sale line credits sales/revenue account
- Add a future-link model for stock-impacting lines, for example:
  - pending stock receipt/source link
  - pending stock issue/source link
- Persist enough metadata on CARI lines so later inventory jobs or flows can connect without re-deriving business intent from journal text.
- Make sure non-stock/service items keep their simpler finance-only behavior.

Files:
- `backend/src/services/cari.document.service.js`
- `backend/src/services` item-card resolution helpers
- `backend/src/migrations` for stock-link metadata if needed
- `frontend/src/pages/cari/CariDocumentsPage.jsx`

Acceptance:
- AP invoice with `STOCK_ITEM` can post to inventory asset account.
- AR invoice with `STOCK_ITEM` still posts revenue normally, while carrying a traceable stock-impact marker for later issue/COGS handling.
- No fake automatic `COGS` entry is created yet.

Notes:
- This PR is the bridge between finance documents and future stock logic. It is not the stock module itself.

## PR-CLI08
Goal:
- Turn inventory from placeholder routing into a real foundation that can link to item cards and CARI lines.

Deliverables:
- Add inventory foundations such as:
  - stock locations/warehouses
  - stock movements
  - cost layers/valuation basis
- Decide whether `item_cards` are the same master as stock cards or whether stock details extend them one-to-one.
- Replace placeholder inventory pages with actual read/write flows.
- Add CARI linkage so:
  - AP stock purchase can create or link to inbound stock movement
  - AR stock sale can create or link to outbound stock movement
  - inventory valuation can later post `Dr COGS / Cr Inventory`

Files:
- inventory backend routes/services/migrations
- inventory frontend pages currently routed from placeholders
- CARI/inventory link services as needed

Acceptance:
- Inventory menu stops being placeholder-only.
- Stock movements can be linked back to originating CARI lines.
- Cost recognition becomes a stock-driven process, not a header-only CARI guess.

Notes:
- This PR deserves its own ADR once the exact inventory valuation model is chosen.

## PR-CLI09
Goal:
- Finish rollout safely with docs, ADR alignment, compatibility notes, and regression coverage.

Deliverables:
- Update or extend ADR coverage:
  - amend `docs/adr/adr-cari-v1.md` where its frozen assumptions are no longer sufficient
  - add a companion ADR if the line model is too large for an inline amendment
- Update runbooks:
  - `docs/runbooks/cari-v1-operations.md`
  - finance/operator guidance for line tax and item-card flows
- Add regression scripts covering:
  - synthetic one-line compatibility
  - mixed-tax invoices
  - item-card defaults
  - stock-item AP/AR accounting handshake
- Add rollout notes for legacy documents with no explicit stored lines.

Files:
- `docs/adr/adr-cari-v1.md`
- `docs/runbooks/cari-v1-operations.md`
- `docs/specs/*` as needed
- backend/frontend regression scripts and package commands

Acceptance:
- Operators and developers have one clear source of truth for the new line model.
- Legacy one-line flows are still proven by tests.
- Mixed-tax scenarios and stock-handshake scenarios are covered by regression.

Notes:
- Do not close this PR set without explicit documentation of the compatibility path for pre-line documents.
