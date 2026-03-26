# 40 - LINE CHARGES AND ANCILLARY COST ALLOCATION

## Status
- Implemented
- Verified with `npm --prefix backend run test:cari:lc40`
- Contract/build checks passed via `npm --prefix backend run openapi:generate`, `npm --prefix backend run check:openapi:parse`, and `npm --prefix frontend run build`
- Refreshed for the post-SL27 / SL29 fixed-asset improvement behavior in Track 39
- Post-implementation hardening applied for item-card/default interactions so charge lines cannot be mutated back into stock-affecting lines and stock-item selection clears stale charge state in the draft UI
- Follow-up hardening applied so AP charge drafts cannot be flipped to AR through header-only updates, and STOCK -> General transitions clear incompatible stock item-card state before charge mode is enabled
- Fixed-asset AP source reads now use charge-augmented line amounts for eligible-line previews, source-linked draft creation, and activation-time revalidation, so auto-created asset original cost stays aligned with the posted charge allocation
- Depends on Track 39 (Subledger-Aware Lines) being complete through at least SL05, SL07, SL27, and SL29

## Purpose
Enable **ancillary cost distribution** across CARI document lines — so that service/freight/installation charges on a purchase bill can be allocated to FIXED_ASSET or STOCK lines before posting, exactly how SAP Item Charges, Dynamics 365 Charges, and Oracle Landed Costs handle it.

Today, if a bill has `10 PCs at 100,000 TL` and a separate `Installation at 10,000 TL`, the installation posts as a standalone expense. The user must manually adjust each asset's cost after the fact via FA06. This is error-prone and breaks the "single entry surface" principle established in Track 39.

This track makes the CARI document line capable of declaring itself as a **charge line** that distributes its cost to target lines on the same document, so the final asset/inventory cost includes all ancillary charges at posting time.

## Why a Separate Track

1. Track 39 is already 25 steps — adding charge allocation would dilute its scope
2. Charge allocation affects **both FIXED_ASSET and STOCK** subledger types equally — it's a horizontal CARI line feature, not FA-specific
3. The feature requires its own linking table, allocation engine, UI components, and reversal logic
4. Track 39's FA06 workaround (post-creation cost adjustment) is a valid MVP path — this track is the evolution toward proper ERP behavior

## Core Design

### What Is a Charge Line?

A charge line is a regular `cari_document_line` with `charge_allocation_method != 'NONE'`. It is always `subledger_type = 'NONE'` — it doesn't create stock or asset entries itself. Instead, its amount is **distributed to target lines** on the same document before posting.

```
cari_document_lines (new columns):
  charge_allocation_method  ENUM('NONE','EQUAL','BY_AMOUNT','BY_QTY','MANUAL')
                            NOT NULL DEFAULT 'NONE'
```

When `charge_allocation_method != 'NONE'`, the line is treated as a charge line. Its `posting_account_id` is **ignored** during posting — instead, its amount flows into the target lines' posting accounts.

### Allocation Methods

| Method | Formula per target line | Use case |
|---|---|---|
| `EQUAL` | `charge_amount / N` (residual → last line) | Installation labor across identical units |
| `BY_AMOUNT` | `charge_amount × (target_net / total_target_net)` | Freight proportional to value |
| `BY_QTY` | `charge_amount × (target_qty / total_target_qty)` | Per-unit handling fee |
| `MANUAL` | User enters per-target amounts manually | Irregular splits |

### Charge Target Linking

New table to map charge lines to their target lines:

```sql
CREATE TABLE cari_document_line_charge_targets (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  legal_entity_id  BIGINT UNSIGNED NOT NULL,
  charge_line_id   BIGINT UNSIGNED NOT NULL,   -- FK → cari_document_lines.id
  target_line_id   BIGINT UNSIGNED NOT NULL,   -- FK → cari_document_lines.id
  allocated_amount_txn  DECIMAL(20,6) NOT NULL DEFAULT 0,
  allocated_amount_base DECIMAL(20,6) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_charge_target (charge_line_id, target_line_id),
  KEY idx_target_line (target_line_id),
  CONSTRAINT fk_charge_line FOREIGN KEY (charge_line_id)
    REFERENCES cari_document_lines(id) ON DELETE CASCADE,
  CONSTRAINT fk_target_line FOREIGN KEY (target_line_id)
    REFERENCES cari_document_lines(id) ON DELETE CASCADE
);
```

### How It Flows Through Posting

**Before subledger side-effects run**, a charge allocation step prepares augmented costs:

```
Original bill:
  Line 1: 10 PCs           FIXED_ASSET  qty=10  100,000 TL
  Line 2: Installation     CHARGE/EQUAL          10,000 TL  → targets: [Line 1]
  Line 3: Printer toner    STOCK        qty=20    5,000 TL

Charge allocation step (pre-posting):
  Line 2 distributes 10,000 TL equally to Line 1
  Line 1 effective_net = 100,000 + 10,000 = 110,000 TL
  Line 1 effective_unit_cost = 110,000 / 10 = 11,000 TL

Posting proceeds normally:
  Line 1 → SL05 creates 10 draft assets at 11,000 TL each (total 110,000 to asset account)
  Line 2 → no journal entry of its own (its amount is absorbed into Line 1)
  Line 3 → stock receipt at 5,000 TL (unchanged)
```

Key rules:
- Charge lines produce **no standalone journal debit** — their amount is folded into target lines
- The charge line's gross amount still appears on the document total (for VAT/withholding purposes)
- The charge line's tax, if any, posts normally (VAT on freight is a separate tax line)
- A charge line **cannot target another charge line** (no cascading)
- A charge line **must have at least one target** — validation rejects orphan charges

### Refresh Note: Track 39 Improvements

This plan was drafted before Track 39's `IMPROVE_EXISTING` flow grew into a richer fixed-asset path. The current dependency assumptions for this track are:

- Track 39 is effectively a 30-step track now, not 25
- ancillary charges may target not only `FIXED_ASSET + AUTO_CREATE`, but also `FIXED_ASSET + LINK_EXISTING` and `FIXED_ASSET + IMPROVE_EXISTING`
- if a charge targets `IMPROVE_EXISTING`, the allocated amount becomes part of the **effective improvement amount** and must feed the existing `improvementEffectiveDate`, same-month day-proration, suspended/reactivated-asset handling, and late-entry current-period `CATCH_UP` behavior already implemented in Track 39
- if Track 43 later introduces retro ownership transfer correction, that track should consume the resulting posted improvement/depreciation basis from fixed-asset history; it should not depend on charge-target rows or duplicate charge-allocation math

### Multi-Target Distribution

A single charge line can target multiple lines:

```
  Line 1: Laptop × 5       FIXED_ASSET  50,000 TL
  Line 2: Monitor × 5      FIXED_ASSET  15,000 TL
  Line 3: Freight           CHARGE/BY_AMOUNT  6,500 TL → targets: [Line 1, Line 2]

BY_AMOUNT allocation:
  Line 1 share = 6,500 × (50,000 / 65,000) = 5,000 TL
  Line 2 share = 6,500 × (15,000 / 65,000) = 1,500 TL

Result:
  Line 1 effective = 55,000 → 5 laptops at 11,000 each
  Line 2 effective = 16,500 → 5 monitors at 3,300 each
```

### What Stays the Same

- `subledger_type` enum — no new values added, charge uses existing `NONE`
- Document totals — charge line amounts are still included in `document_total_net_txn`
- Tax handling — charge line tax posts normally via the tax engine
- The charge concept is **AP-only in V1** (purchase charges). AR charge allocation is out of scope.
- Lines without `charge_allocation_method` (i.e., `NONE`) behave exactly as before

## Execution Tracking

### Master Tracker

| Step | Scope | Status |
|---|---|---|
| **Phase 1 — Schema & Allocation Engine** | | |
| LC01 | Migration: charge columns + targets table | Completed |
| LC02 | Backend validators: charge line rules | Completed |
| LC03 | Backend CARI service: charge target CRUD | Completed |
| LC04 | Backend CARI posting: allocation engine + cost augmentation | Completed |
| **Phase 2 — Frontend** | | |
| LC05 | Frontend: charge line UI (method selector, target picker) | Completed |
| LC06 | Frontend: allocation preview summary | Completed |
| **Phase 3 — Reversal & Integration** | | |
| LC07 | Backend reversal: unwind charge allocations | Completed |
| LC08 | Backend: STOCK landed cost - adjust inventory unit cost | Completed |
| **Phase 4 — Testing & Release** | | |
| LC09 | Smoke suite: charge allocation + mixed flows | Completed |
| LC10 | Release gates and backward-compatibility verification | Completed |

---

## `STEP-LC01` — Migration: add charge allocation columns and charge targets table

### Patch target
`backend/src/migrations/` — new migration file (expected next slot after `m152`, and add it to `backend/src/migrations/index.js`)

### In scope
1. Add `charge_allocation_method` ENUM('NONE','EQUAL','BY_AMOUNT','BY_QTY','MANUAL') NOT NULL DEFAULT 'NONE' to `cari_document_lines`
2. Create `cari_document_line_charge_targets` table with:
   - `id`, `tenant_id`, `legal_entity_id`
   - `charge_line_id` FK → `cari_document_lines.id` ON DELETE CASCADE
   - `target_line_id` FK → `cari_document_lines.id` ON DELETE CASCADE
   - `allocated_amount_txn` DECIMAL(20,6) NOT NULL DEFAULT 0
   - `allocated_amount_base` DECIMAL(20,6) NULL
   - UNIQUE KEY on `(charge_line_id, target_line_id)`
   - INDEX on `target_line_id` (for reverse lookups)
3. CHECK constraint: `charge_line_id != target_line_id` (a line cannot charge itself)

### Explicit non-goals
- No data backfill — all existing lines default to `charge_allocation_method = 'NONE'`
- No `BY_WEIGHT` method in V1 — requires a weight column that doesn't exist yet

### Definition of done
- Migration runs cleanly on existing database
- New column defaults preserve existing line behavior
- Rollback drops the table and column cleanly
- Migration is wired into `backend/src/migrations/index.js`

---

## `STEP-LC02` — Backend validators: charge line validation rules

### Patch target
`backend/src/routes/cari.document.validators.js`

### In scope
1. Accept `chargeAllocationMethod` / `charge_allocation_method` on line input (alias support matching existing pattern)
2. Accept `chargeTargets` array on charge lines: `[{ targetLineNo, allocatedAmountTxn? }]`
   - `targetLineNo` references another line's `line_no` on the same document (not DB id — lines may not be persisted yet)
   - `allocatedAmountTxn` required only when method = `MANUAL`, optional otherwise (computed by engine)
   - frontend note: the UI may keep target selections by stable client `rowId`, but the mutation payload sent to the backend serializes them as `targetLineNo`
3. Validation rules:
   - If `chargeAllocationMethod != 'NONE'`:
     - `subledgerType` must be `'NONE'` (or absent → inferred NONE)
     - `chargeTargets` must be a non-empty array
     - Each `targetLineNo` must reference a STANDARD line on the same document
     - Target lines must NOT themselves be charge lines (no cascading)
     - `stockImpactMode` must be `'NONE'`
   - If method = `MANUAL`:
     - Each target must have `allocatedAmountTxn`
     - Sum of `allocatedAmountTxn` must equal charge line's `lineNetAmountTxn` (tolerance: 0.01)
   - If method != `MANUAL` and method != `NONE`:
     - `allocatedAmountTxn` on targets is ignored (computed by engine)
4. Reject `chargeAllocationMethod` on AR documents (AP-only in V1)
5. Add an explicit second-pass cross-line validation phase after single-line parsing:
   - target line exists on the same payload
   - target is not the same line
   - target is not another charge line
   - duplicate target rows are rejected
   - manual allocations sum to the charge line net within tolerance

### Explicit non-goals
- No BY_WEIGHT validation
- No cross-document charge targeting

### Definition of done
- Valid charge lines pass validation
- Invalid combinations (charge + STOCK, charge + FIXED_ASSET subledger, cascading charges, empty targets) produce clear error messages
- Non-charge lines are unaffected

---

## `STEP-LC03` — Backend CARI service: charge target CRUD (create, update, delete charge target rows)

### Patch target
`backend/src/services/cari.document.service.js`

### In scope
1. On document line creation (`replaceDocumentLinesTx`):
   - After inserting lines, process charge target mappings
   - Resolve `targetLineNo` references to persisted `target_line_id` values
   - Insert rows into `cari_document_line_charge_targets`
   - For non-MANUAL methods, compute `allocated_amount_txn` using the allocation formula:
     - EQUAL: `charge_net / target_count`, residual to last target
     - BY_AMOUNT: `charge_net × (target_net / sum_target_nets)`, residual to last target
     - BY_QTY: `charge_net × (target_qty / sum_target_qtys)`, residual to last target
   - For MANUAL: persist user-provided amounts directly
   - Convert to base currency using document exchange rate for `allocated_amount_base`
2. On document line replacement (edit draft):
   - Delete existing charge target rows for the document
   - Re-create from the updated line data
3. On document deletion:
   - CASCADE handles cleanup (FK ON DELETE CASCADE)
4. Extend the document read/reload path:
   - load persisted charge target rows alongside lines/taxes/stock links/generated fixed assets
   - expose `chargeAllocationMethod` and `chargeTargets` back through the document payload so draft save/reload preserves the charge graph
5. Reassert charge-line invariants after service-side item-card / account default resolution so a charge line cannot be mutated back into STOCK behavior by derived defaults before draft save or posting
6. Enforce the AP-only charge rule in service-layer draft update flows as well, including header-only updates where `direction` / `documentType` change without a replacement `lines` payload
7. When fixed-asset flows reload a source AP document, consume charge-augmented line amounts so FA06 eligibility, source-linked draft creation, and activation refresh do not drift back to raw pre-allocation line cost

### Explicit non-goals
- No standalone charge target API — targets are managed as part of the document lines payload
- No partial updates to charge targets

### Definition of done
- Creating a document with charge lines persists correct target rows and computed amounts
- Editing a draft document recalculates charge allocations
- Deleting a document removes all charge target rows
- Rounding residual is deterministically assigned to the last target line
- Reloading an existing draft returns the same charge configuration the user saved
- Service-side defaulting cannot reintroduce stock-affecting charge lines
- Header-only draft updates cannot strand charge lines under AR documents

---

## `STEP-LC04` — Backend CARI posting: charge allocation engine and cost augmentation

### Patch target
`backend/src/services/cari.document.service.js`

### In scope
1. **New pre-posting phase**: Before the existing subledger side-effects (SL05/SL06), run the charge allocation engine:
   - Query all charge lines for the document being posted
   - Query their persisted charge targets with allocated amounts
   - Build an `augmentedCosts` map: `{ targetLineId → additionalAmountTxn, additionalAmountBase }`
2. **Augment target line amounts** before subledger processing:
   - For each target line in `augmentedCosts`:
     - `effective_net_txn = line_net_amount_txn + allocated_charge_txn`
     - `effective_net_base = line_net_amount_base + allocated_charge_base`
   - Pass `effective_net` values to SL05 (FA capitalization), stock posting, and Track 39's `IMPROVE_EXISTING` posting path
   - If the target line uses `fixedAssetMode = IMPROVE_EXISTING`, the allocated charge becomes part of the effective improvement amount that feeds the existing `improvementEffectiveDate`, same-month day-proration, suspended/reactivated-asset handling, and late-entry current-period `CATCH_UP` logic
3. **Journal entry treatment for charge lines**:
   - Charge lines do NOT generate their own debit journal line
   - Their amount is absorbed into target lines' debit entries
   - patch the existing line-driven journal builder so it skips standalone debit generation for charge lines and uses augmented amounts when constructing target-line debit entries
   - The credit side (AP payable) includes the full document total (charge amounts still owed to vendor)
   - Charge line tax (if any) posts normally as a separate tax journal line
4. **Validation at posting time**:
   - If a charge line's targets resolve to zero effective targets (e.g., all targets deleted), reject posting with clear error
   - If allocated amounts don't sum to charge line net (data integrity check), reject posting

### Explicit non-goals
- No charge allocation for AR documents
- No retroactive charge allocation (adding charges to already-posted documents)
- No cross-document charge allocation

### Definition of done
- Posting a bill with charge lines creates assets/stock at augmented costs
- Posting a bill with a charge line targeting `FIXED_ASSET + IMPROVE_EXISTING` uses the augmented improvement amount end to end
- Charge lines produce no standalone debit journal entry
- Document total and AP payable amount are correct (include charge amounts)
- Tax on charge lines posts correctly
- Posting rejects if charge target integrity is broken

---

## `STEP-LC05` — Frontend: charge line UI (allocation method selector, target line picker)

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/cariDocumentsUtils.js`

### In scope
1. **Charge toggle on line entry**: When user selects a STANDARD line with `subledger_type = 'NONE'`, show an optional "Distribute as charge" toggle
2. **Allocation method dropdown**: EQUAL | BY_AMOUNT | BY_QTY | MANUAL — appears when charge toggle is on
3. **Target line picker**: Multi-select showing other non-charge STANDARD lines on the document
   - Display: line number, description, amount, subledger type badge
   - Pre-select all eligible lines by default (user can deselect)
   - Disable other charge lines in the picker (no cascading)
   - keep target selection in UI state by stable line `rowId`; serialize to `targetLineNo` only when building the mutation payload
4. **Manual allocation inputs**: When method = MANUAL, show per-target amount fields
   - Running total vs charge line amount with difference indicator
   - Validation: sum must match charge line net amount
5. **Computed allocation preview**: For non-MANUAL methods, show read-only per-target amounts
6. **AP-only guard**: Charge UI elements hidden on AR documents
7. **Posting-account UX behavior**: When a line is marked as a charge line:
   - hide or visually disable misleading normal posting-account input/defaults for that line
   - make it clear the line's debit effect will be absorbed into target lines at posting time
8. **Item-card transition guard**: if item-card selection promotes a line to `STOCK`, clear charge allocation method / targets in the draft so hidden charge state cannot survive the subledger transition
9. **STOCK -> General guard**: when a stock line is demoted back to General/`NONE`, clear the incompatible stock item-card selection so the user does not carry a hidden stock-item state into charge mode

### Explicit non-goals
- No drag-and-drop allocation
- No charge line templates or presets
- No inline editing of target line amounts from the charge line row

### Definition of done
- User can create a charge line, select method, pick targets
- Computed allocations display correctly for EQUAL/BY_AMOUNT/BY_QTY
- Manual entry validates sum matches
- Charge UI is hidden on AR documents
- Charge-line UX does not imply that a normal standalone posting account will be used for the debit side
- Non-charge lines are unaffected by the new UI elements
- Switching a charge line onto a stock item-card clears charge allocation state instead of leaving hidden stale targets
- Switching a STOCK line back to General clears the stock item-card before the line can be used as a charge line

---

## `STEP-LC06` — Frontend: allocation preview summary on document form

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/cariDocumentsUtils.js`

### In scope
1. **Allocation summary panel**: Below the line grid (or as an expandable section), show a table:
   - Target line | Original amount | Allocated charges | Effective amount | Per-unit effective
   - One row per target line that receives any charge
   - Highlight lines where effective amount differs from original
2. **Charge distribution visualization**: For each charge line, show where its amount flows:
   - `Installation (10,000 TL) → Line 1: 5,000 | Line 2: 3,000 | Line 3: 2,000`
3. **Asset preview update**: If target line is FIXED_ASSET with AUTO_CREATE, update the existing preview text to show effective per-unit cost:
   - Before: "Posting will create 10 assets at 10,000 TL each"
   - After: "Posting will create 10 assets at 11,000 TL each (includes 10,000 TL allocated charges)"
   - If target line is FIXED_ASSET with `IMPROVE_EXISTING`, show that the improvement amount already includes allocated charges before the existing improvement-effective-date logic runs
4. Show summary only when at least one charge line exists on the document

### Explicit non-goals
- No editable fields in the summary panel — it's read-only computed display
- No chart/graph visualization

### Definition of done
- Summary panel appears when charge lines exist
- Effective amounts are mathematically correct
- Asset preview text reflects augmented costs
- Panel hidden when no charge lines present

---

## `STEP-LC07` — Backend reversal: unwind charge allocations when document is reversed

### Patch target
`backend/src/services/cari.document.service.js` (reversal path)

### In scope
1. **Reversal must use augmented costs**: When reversing a posted document that had charge lines:
   - The reversal journal must reverse the **augmented** amounts (not the original line amounts)
   - Target assets were capitalized at augmented cost → reversal must decapitalize at the same augmented cost
   - Target asset improvements posted at augmented cost → reversal must undo the same augmented improvement amount and any linked late-entry depreciation delta created from it
   - Target stock was received at augmented cost → reversal must issue at the same augmented cost
2. **Charge target rows preservation**: Charge target rows with `allocated_amount` values are preserved on reversal (they're part of the document's audit trail)
   - The document status moves to REVERSED, but the charge allocation data remains queryable
3. **Integration with SL07 / SL28**: Track 39's reversal logic already handles FA decapitalization, improvement reversal, linked `CATCH_UP` reversal, and stock reversal — this step ensures the amounts passed into those paths are the augmented amounts, not the raw line amounts
4. **Reversal journal structure**:
   - Charge lines still produce no standalone reversal debit — their reversal is embedded in target line reversals
   - AP payable reversal uses the full document total (includes charges)

### Explicit non-goals
- No partial reversal of charge allocations
- No charge reallocation on edit-after-post (document must be reversed and re-entered)

### Definition of done
- Reversing a posted bill with charges correctly reverses augmented asset/stock costs
- FA assets created at augmented cost are decapitalized at augmented cost
- FA improvements posted at augmented cost are reversed at the same augmented amount, including any linked late-entry depreciation delta
- Stock received at augmented cost is reversed at augmented cost
- Charge target rows preserved for audit
- AP payable fully reversed

---

## `STEP-LC08` — Backend: STOCK integration — landed cost impact on inventory valuation

### Patch target
`backend/src/services/cari.document.service.js`
`backend/src/services/inventory.service.js`

### In scope
1. **Augmented cost passthrough to inventory**: When a STOCK line receives allocated charges, the stock receipt must use the **effective cost** (original + charges), not the raw line amount
   - This affects the item's weighted-average cost or FIFO layer cost
2. **Stock link amounts**: `cari_document_line_stock_links.posted_net_amount_txn/base` must reflect the augmented amount
   - patch the CARI stock-link write/update path so pending stock links are seeded from augmented amounts rather than raw `line_net_amount_*`
   - lock one source of truth: the same augmented amounts used by posting must also be the amounts written to stock links, so preview, pending-link state, and posted valuation cannot diverge
3. **Inventory valuation report impact**: No report changes needed — reports already read from stock movement amounts, which will now include allocated charges
4. **Audit trail**: The stock movement record should include a reference or note that the cost includes allocated charges (for transparency in cost analysis)

### Explicit non-goals
- No retroactive landed cost adjustment (adding charges to already-received stock)
- No separate landed cost voucher document (that's a future "Landed Costs" track)
- No impact on stock valuation method selection (WAC vs FIFO)

### Definition of done
- Stock received with charge allocation uses augmented unit cost
- Weighted-average cost recalculation uses augmented amounts
- Stock links reflect augmented amounts
- Reversal correctly unwinds augmented stock costs

---

## `STEP-LC09` — Smoke suite: charge allocation + mixed flows

### Patch target
`backend/scripts/` — add dedicated CARI/FA/Inventory smoke scripts following existing repo convention

### In scope
1. **Unit tests for allocation engine**:
   - EQUAL split with exact division
   - EQUAL split with rounding residual (e.g., 100 / 3 = 33.33 + 33.33 + 33.34)
   - BY_AMOUNT proportional allocation
   - BY_QTY proportional allocation
   - MANUAL allocation with exact sum match
   - MANUAL allocation with sum mismatch → rejection
2. **Integration tests**:
   - AP bill with 1 charge line + 1 FIXED_ASSET line → assets created at augmented cost
   - AP bill with 1 charge line targeting a `FIXED_ASSET + IMPROVE_EXISTING` line → existing asset improvement posts at augmented cost
   - AP bill with retro `improvementEffectiveDate` + charge line targeting that improvement → current-period `CATCH_UP` uses the augmented improvement amount
   - AP bill with 1 charge line + 1 STOCK line → stock received at augmented cost
   - AP bill with 1 charge line + 2 targets (mixed FIXED_ASSET + STOCK) → correct split
   - AP bill with 2 charge lines targeting the same line → amounts stack correctly
   - AP bill with charge line + NONE target line → charge distributes to expense
   - Draft line reorder after selecting charge targets → UI still serializes correct `targetLineNo` values and reload preserves the intended target graph
   - Reversal of posted bill with charges → full unwind
   - Edit draft bill with charges → recalculates allocations
   - AP bill with `FIXED_ASSET + AUTO_CREATE` plus 1 charge line -> draft assets and later activation both keep the same augmented original cost
3. **Validation tests**:
   - Charge on AR document → rejected
   - Charge targeting another charge → rejected
   - Charge with empty targets → rejected
   - Charge line with subledgerType STOCK or FIXED_ASSET → rejected

   - Charge line + `STOCK_ITEM` item-card default path -> rejected even if incoming payload said `stockImpactMode = NONE`
   - AP charge draft header update -> AR without `lines` replacement is rejected

### Explicit non-goals
- No performance/load testing
- No E2E browser tests (manual QA covers UI)

### Definition of done
- All allocation math edge cases covered
- All validation rejection cases covered
- Mixed-subledger charge flows tested end-to-end
- Reversal flows tested
- Smoke scripts follow the existing `backend/scripts/test-*.js` pattern and are suitable for release-gate chaining
- Service-side post-validation defaulting regressions are covered by smoke coverage
- AP-only charge enforcement is covered even on header-only draft update paths

---

## `STEP-LC10` — Release gates and backward-compatibility verification

### Patch target
Multiple files — verification checklist

### In scope
1. **Backward compatibility**:
   - All existing documents (no charge lines) behave identically to pre-Track-40
   - `charge_allocation_method` defaults to `'NONE'` — no migration impact on existing data
   - API calls without `chargeAllocationMethod` field work exactly as before
2. **Data integrity**:
   - `allocated_amount_txn` sums match charge line net amounts for all posted documents
   - No orphan charge target rows (FK CASCADE verified)
3. **Performance**:
   - Posting with charge lines adds no more than 10% overhead vs posting without
   - Charge target queries use indexed lookups
4. **Documentation**:
   - API changelog documents new fields
   - User-facing help text for charge allocation methods
5. **Repo-shape release checks**:
   - migration file is added to `backend/src/migrations/index.js`
   - `backend/openapi.yaml` is regenerated through `backend/scripts/generate-openapi.js`
   - any charge-specific smoke scripts can be chained through the existing `backend/scripts/` release-gate pattern

### Explicit non-goals
- No migration of historical bills to use charge allocation retroactively
- No automatic detection of "this looks like a charge line" on legacy data

### Definition of done
- Existing smoke suite passes without modification
- New charge-specific tests pass
- No regression in posting performance
- API backward compatibility verified

---

## Codex Execution Matrix

### `STEP-LC01`
- Modifies: `backend/src/migrations/` (new file)
- Depends on: Track 39 SL01 (subledger_type column exists)
- Risk: Low — additive schema change with safe defaults

### `STEP-LC02`
- Modifies: `backend/src/routes/cari.document.validators.js`
- Depends on: LC01 (columns exist), Track 39 SL02 (subledger validation exists)
- Risk: Medium — must not break existing validation paths

### `STEP-LC03`
- Modifies: `backend/src/services/cari.document.service.js`
- Depends on: LC01, LC02
- Risk: Medium — touches `replaceDocumentLinesTx` which Track 39 SL03 also modifies

### `STEP-LC04`
- Modifies: `backend/src/services/cari.document.service.js`
- Depends on: LC03, Track 39 SL05 (FA capitalization hooks exist), Track 39 SL27 (IMPROVE_EXISTING posting and catch-up path exist)
- Risk: High — core posting path augmentation, must not break non-charge posting

### `STEP-LC05`
- Modifies: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/cariDocumentsUtils.js`
- Depends on: LC02 (validator accepts charge fields), Track 39 SL10/SL11 (subledger UI exists)
- Risk: Medium — new UI elements on existing form

### `STEP-LC06`
- Modifies: `frontend/src/pages/cari/CariDocumentsPage.jsx`, `frontend/src/pages/cari/cariDocumentsUtils.js`
- Depends on: LC05
- Risk: Low — read-only display component

### `STEP-LC07`
- Modifies: `backend/src/services/cari.document.service.js` (reversal path)
- Depends on: LC04, Track 39 SL07 (subledger reversal hooks exist), Track 39 SL28 (improvement reversal path exists)
- Risk: High — reversal amounts must exactly match posting amounts

### `STEP-LC08`
- Modifies: `backend/src/services/cari.document.service.js`, `backend/src/services/inventory.service.js`
- Depends on: LC04
- Risk: Medium — affects inventory costing, must preserve existing valuation logic

### `STEP-LC09`
- Modifies: `backend/scripts/`
- Depends on: LC01–LC08
- Risk: Low — test-only

### `STEP-LC10`
- Modifies: Multiple files (verification)
- Depends on: LC01–LC09
- Risk: Low — verification checklist

## Dependencies

### On Track 39 (Subledger-Aware Lines)
This track assumes Track 39 is complete through at least:
- **SL01**: `subledger_type` column exists on `cari_document_lines`
- **SL02**: Subledger validation logic exists (charge validation extends it)
- **SL03**: `replaceDocumentLinesTx` handles subledger columns (charge target CRUD hooks into same function)
- **SL05**: AP FIXED_ASSET capitalization hooks exist (charge augmentation runs before them)
- **SL07**: Reversal logic handles subledger lines
- **SL27**: `IMPROVE_EXISTING` exists with `improvementEffectiveDate`, same-month day-proration, suspended/reactivated-asset support, and current-period `CATCH_UP`
- **SL29**: The CARI form already understands the richer FA line modes and target-asset UI patterns the charge UI now needs to coexist with

Track 39's existing posting flow is **not redesigned** — charge allocation remains a **pre-processing step** that augments line amounts before the existing SL05 / SL06 / SL27 hooks run.

### On Track 38 (Fixed Assets)
No direct dependency beyond what Track 39 already requires. Charge allocation is transparent to the FA module — it only changes the effective amount seen by FA posting:

- higher acquisition cost on `AUTO_CREATE` / `LINK_EXISTING`
- higher improvement amount on `IMPROVE_EXISTING`

### On existing Inventory module
LC08 requires the stock receipt costing path to accept an external `effective_cost` override rather than always computing cost from the raw line amount. This may require a minor interface change in the inventory service.

## Future Extensions (Out of Scope)

| Feature | Description | Why deferred |
|---|---|---|
| `BY_WEIGHT` method | Allocate by item weight column | Requires weight field on item cards — separate enhancement |
| AR charge allocation | Distribute freight/handling on sales invoices | Different accounting treatment (cost of goods sold allocation) |
| Landed Cost Voucher | Separate post-receipt document for import duties/freight | Different workflow — charges applied after receipt, not at receipt time |
| Cross-document charges | Charge on one document allocated to lines on another | Complex FK/reconciliation — future track |
| Retroactive adjustment | Add charges to already-posted documents | Requires adjustment journal generation — future track |
