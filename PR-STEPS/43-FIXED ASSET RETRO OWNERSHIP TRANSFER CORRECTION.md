# 43 - FIXED ASSET RETRO OWNERSHIP TRANSFER CORRECTION

## Status
- Planned
- Follow-up track after Track 38 fixed-assets lifecycle/depreciation MVP
- Refreshed to account for Track 39 `IMPROVE_EXISTING` behavior and Track 40 line-charge allocation interaction

## Purpose
Add a proper SaaS-grade correction workflow for **late-entered ownership transfers** when depreciation for one or more impacted periods has already been posted.

Today, the strict accounting-safe answer in the repo is to unwind posted depreciation, reverse any late-posted transfer, and then repost everything in the right chronology. That is valid as a control model, but it is not a good day-to-day end-user workflow.

This track introduces a dedicated **retro ownership transfer correction** flow so users can record the real historical transfer date, keep already-posted depreciation history immutable where appropriate, and book a current-period correction / true-up instead of forcing broad depreciation-run reversals.

## Interaction With Track 40

Track 40 (`LINE CHARGES AND ANCILLARY COST ALLOCATION`) is upstream of this track, but once it lands it can materially change the asset basis that retro ownership correction must reason over.

Locked interaction rule:

- if a fixed-asset improvement line received allocated charges in Track 40, Track 43 must treat the resulting posted improvement amount as the ordinary asset basis increase
- Track 43 must **not** read `cari_document_line_charge_targets` directly to rebuild owner-attribution history
- retro ownership transfer correction must instead consume the already-posted `IMPROVEMENT`, depreciation, and schedule history that Track 39/40 produced

Practical meaning:

- charge allocation is upstream cost formation
- retro ownership transfer correction is downstream owner-attribution correction
- the correction engine should see only the final improvement/depreciation basis, not duplicate charge math itself

## Why a Separate Track

1. This is not a small validator tweak on the current transfer endpoint.
2. The feature spans fixed-assets lifecycle, depreciation attribution, journal design, reporting interpretation, and UX workflow.
3. The repo's existing `CATCH_UP` concept covers **missing depreciation**, not **wrong owner-OU attribution of already-posted depreciation**.
4. The target behavior is materially different from the Track 38 MVP chronology-first workflow and needs its own locked business rules.

## Problem Statement

Example:

- Depreciation for `March 2026` is posted.
- The real ownership transfer date was `March 15, 2026`.
- The user forgot to enter the ownership transfer on time.

Accounting truth:

- `March 1-14` depreciation belongs to the old owner OU.
- `March 15-31` depreciation belongs to the new owner OU.

The current MVP-safe answer is to reverse affected depreciation posting(s), then post the transfer, then repost depreciation. That is acceptable for strict chronology, but not desirable as the primary SaaS workflow when later runs already exist.

## Core Product Direction

Introduce a new workflow:

- `Retro Ownership Transfer Correction`

This is:

- not the plain `ownership-transfer` endpoint
- not the current depreciation `CATCH_UP`
- not a hidden automatic rewrite of prior posted months

This workflow must:

- capture the real historical ownership effective date
- determine which already-posted depreciation periods are affected
- calculate the owner-OU attribution delta using the effective posted depreciation basis, including any earlier `IMPROVEMENT` amounts that may already include Track 40 allocated charges
- persist corrected ownership history for future depreciation attribution
- post a **current-period correction / true-up**
- post a **mandatory current-period balance-sheet owner move** using current carrying values on the correction posting date so the asset itself sits on the new owner's books from the correction posting date onward
- preserve prior posted depreciation runs as immutable history by default
- stay owner-focused in V1; location correction remains a separate operational workflow

## Terminology Lock

Use these meanings consistently:

- `ownership transfer`: the normal lifecycle/accounting event posted in correct chronology
- `retro ownership transfer correction`: a late-entered correction workflow for already-posted depreciation periods
- `depreciation catch-up`: missing historical depreciation that was never posted
- `true-up` / `correction`: reallocation of already-posted depreciation attribution between owner OUs

Important:

- Do not reuse the existing `CATCH_UP` depreciation type for this feature.
- This track is about **owner-OU correction**, not **missing depreciation recognition**.

## Date Model Lock

The correction flow must separate the business date from the posting date explicitly.

Locked terms:

- `actualEffectiveDate`: the real historical business date on which ownership changed
- `correctionPostingDate`: the date on which the correction workflow is posted now
- `balanceSheetTransferPostingDate`: the posting date for any current-period carrying-value owner move created by the correction flow; in this track it is expected to match `correctionPostingDate`

Important:

- do not reuse the plain ownership-transfer posting with a backdated historical effective date while using current carrying values
- do not create a misleading historical transfer row that appears to move today's NBV on an old date
- if the correction flow needs a carrying-value owner move, that move must be a current-period posting tied to `correctionPostingDate`
- in V1, the correction flow always posts that current-period carrying-value owner move together with the retro owner-attribution true-up

Future-attribution lock:

- future depreciation attribution must read a correction-aware owner-history source
- the current-period carrying-value owner move must not be the only source of owner-timeline logic
- patch `loadAssetDepreciationLifecycleHistory(...)` or introduce a correction-aware equivalent consumed by both preview and future depreciation generation
- that lifecycle/history reader must remain charge-agnostic: if Track 40 has already augmented an `IMPROVEMENT`, consume the resulting fixed-asset state/transactions rather than re-reading CARI charge tables

## Decision Lock

### 1. Same-fiscal-year backdating is allowed only within chronology-safe correction rules

The product may accept a late-entered/backdated ownership effective date within the same fiscal year, but only when it stays chronologically valid and is corrected through current-period journal reclassification plus the mandatory current-period owner move rather than by editing posted history.

That means at minimum:

- `actualEffectiveDate` is not in a prior fiscal year
- the requested effective date does not predate the asset's latest compatible posted transaction boundary
- no later incompatible fixed-assets activity exists that would make the requested transfer historically inconsistent
- the correction posting period remains open

Use the normal ownership-transfer workflow only when the requested effective date is chronologically safe **and** no retro-correction handling is required.

That means at minimum:

- no impacted posted depreciation already exists for the asset
- no later posted fixed-assets lifecycle activity exists that would make the transfer historically inconsistent
- the posting period used by the transfer remains open

If those conditions are not true:

- the plain ownership-transfer workflow must not be the primary end-user fix
- the system must block direct backdated transfer posting and reroute the user into retro correction preview

### 2. V1 remains correction-first even when the impacted month is operationally isolated

If posted depreciation already exists for the asset:

- V1 uses `retro ownership transfer correction`
- V1 does **not** use `AUTO_UNWIND_REPOST` as the normal or optional end-user path
- the system posts the current-period true-up plus the mandatory current-period owner move

Important repo-shape clarification:

- the current repo supports run-level depreciation reversal, not a selective one-asset unwind of a posted run
- a future asset-only unwind / selective depreciation-adjustment feature would be a separate explicit track, not an implicit part of this V1 correction workflow

### 3. Posted history remains immutable by default

When later posted depreciation periods already exist:

- do not require the user to manually unwind multiple depreciation runs as the primary UX
- do not silently rewrite prior posted depreciation rows
- post the delta in the current open period

### 4. Future behavior must still be corrected

After the correction is posted:

- future depreciation attribution must follow the corrected owner history
- the real historical effective date remains part of the asset lifecycle/audit story

### 5. Current-period balance-sheet move is mandatory and must use current-period posting

For V1 retro ownership transfer correction:

- the carrying-value owner move is mandatory
- that posting must use `correctionPostingDate`
- it is distinct from the historical fact represented by `actualEffectiveDate`
- it must not become the only owner-history fact consumed by future depreciation attribution
- it moves the asset onto the new owner's books in the current open period while preserving the historical business date separately for audit and future attribution logic

### 6. Prior-fiscal-year backdating is not allowed

If the requested backdated transfer reaches a prior fiscal year:

- block the retro ownership transfer correction workflow in V1

If later design ever introduces a prior-period-adjustment path, it must be a separate explicit accounting-policy track, not an implicit extension of this workflow.

### 7. Current-year correction prefers journal-based reclassification over history rewrite

For same-fiscal-year late transfer correction:

- prefer a journal-based owner-attribution reclassification / true-up
- do not edit posted depreciation history in place
- keep `AUTO_UNWIND_REPOST` out of V1 scope

### 8. Impacted-period stop boundary is explicit

The correction engine must stop impacted-period discovery at the earliest applicable boundary:

- the next posted owner-changing lifecycle boundary
- a terminal lifecycle boundary such as write-off or sale
- the point where the corrected owner timeline and the already-persisted owner timeline become equal again for all later posted periods
- the current open-period cutoff, meaning the period containing `correctionPostingDate`

This boundary rule must be shared by preview, posting, and future correction-aware lifecycle reads.

### 9. V1 is owner-only; location remains separate

This track corrects ownership attribution only.

- `targetLocationOperatingUnitId` is out of scope for V1
- `location` here means the asset's physical / operational placement context, not inventory warehouse stock
- retro correction must not silently behave like physical move
- retro correction must not update physical/location fields on the asset master
- any location correction remains a separate physical-move workflow or future dedicated follow-up track

### 10. V1 adds an explicit retro-correction transaction type

For transaction feed and drillback consistency:

- add `RETRO_OWNERSHIP_CORRECTION` to `fixed_asset_transactions.transaction_type`
- use dedicated correction header/detail tables as the primary retro-correction audit source
- do not treat `RETRO_OWNERSHIP_CORRECTION` as the only owner-history fact; the lifecycle reader must still merge historical correction facts explicitly
- any supporting current-period carrying-value owner move posted as part of the correction must remain subordinate to the retro-correction record and must not be interpreted by lifecycle/history readers as a plain chronology `OWNERSHIP_TRANSFER`

### 11. Overlapping retro corrections are replacement-only

For one asset:

- two active overlapping retro ownership corrections must not coexist
- if a new correction overlaps a previously posted correction, the system must route through a safe replacement path that reverses or nets the earlier correction deterministically
- the original correction row must remain in audit history and be linked as replaced / superseded; it must not be deleted or mutated in place to masquerade as the new correction

### 12. Preview/post concurrency is explicit

For V1:

- posting must require a preview fingerprint / decision token tied to the asset history used by preview
- if asset history changes after preview, posting must fail with a stale-preview response and require a fresh preview

### 13. Persisted owner-allocation detail is required

For every impacted posted depreciation period:

- persisted owner-allocation detail must exist
- preview/post must not fall back to the asset's current owner to guess historical attribution
- if required owner-allocation detail is missing, the retro correction workflow is blocked in V1 until the underlying data gap is remediated

## Scenario Rules

### Scenario 1

Case:

- the real transfer date is inside `March 2026`
- `March 2026` depreciation is already posted
- no later affected month has been posted yet

Preferred behavior:

1. User opens retro correction workflow.
2. System identifies one impacted month: `March 2026`.
3. System previews the March owner-attribution delta.
4. System posts one current-period true-up journal in the current open period.
5. System posts the mandatory current-period carrying-value owner move on `correctionPostingDate`.
6. Future periods use the corrected ownership timeline.

### Scenario 2

Case:

- the real transfer date is inside `March 2026`
- `March 2026` and `April 2026` depreciation are already posted

Preferred behavior:

1. User opens retro correction workflow.
2. System identifies all impacted posted months from the real effective date forward until the current owner history becomes aligned.
3. System calculates the source-OU / target-OU depreciation attribution delta by month.
4. System posts one current-period correction journal for the cumulative delta.
5. System posts the mandatory current-period carrying-value owner move on `correctionPostingDate`.
6. Prior posted depreciation rows remain as historical fact.
7. Future months follow the corrected owner history.

### Scenario 3 (reference walk-through for closed-period correction)

Case:

- Asset cost 100,000 / monthly depreciation 10,000
- Old owner OU-A / New owner OU-B
- Real transfer date: 15.03.2026
- March 2026 depreciation posted entirely to OU-A, period closed
- April 2026 depreciation posted entirely to OU-A, period closed
- Today: 10.05.2026, May 2026 is the open period

Timeline:

1. 31.03.2026 - March depreciation posted to OU-A (10,000), period 03/2026
2. 30.04.2026 - April depreciation posted to OU-A (10,000), period 04/2026
3. 10.05.2026 - Error discovered, March/April cannot be reopened

Correct attribution:

- March: OU-A 4,516.13 (days 1-14) / OU-B 5,483.87 (days 15-31)
- April: OU-B 10,000.00 (full month)
- Total wrong attribution delta: 15,483.87

Preferred behavior:

1. User opens retro correction workflow with `actualEffectiveDate = 2026-03-15`, `correctionPostingDate = 2026-05-10`, target OU-B.
2. System identifies two impacted posted months: March 2026, April 2026.
3. System calculates cumulative delta: 15,483.87 (5,483.87 from March + 10,000 from April).
4. System posts two journals in period 05/2026 on 2026-05-10:
   - Journal A1: retro depreciation true-up reclassing 15,483.87 of depreciation expense and accumulated depreciation from OU-A to OU-B
   - Journal A2: current-period carrying-value owner move: gross cost 100,000, corrected accum depr 4,516.13, NBV 95,483.87 with self-balancing
5. March and April fiscal periods remain closed and untouched.
6. Audit shows `actualEffectiveDate = 2026-03-15` and `correctionPostingDate = 2026-05-10`.
7. Future May+ depreciation runs use the corrected owner timeline (OU-B from 15.03.2026 onward).

## Correction Calculation Rule

For each impacted posted period:

1. Recompute the eligible-day ownership split using the real effective transfer date.
2. Compare:
   - what was actually posted under the wrong owner attribution
   - what should have been attributed to source OU vs target OU
3. Calculate the net delta by owner OU.
4. Aggregate those deltas into the current-period correction posting.

The correction engine must be deterministic and auditable:

- per-period breakdown retained
- source and target OUs explicit
- eligible-day logic consistent with existing `DAILY_PRORATA` rules
- historical effective date and current posting date both retained

## Journal Direction

The true-up journal should correct owner-OU attribution without changing total-entity depreciation.

At minimum, the design must support:

- depreciation expense reclass between source OU and target OU
- accumulated depreciation reclass between source OU and target OU

This journal is a dedicated **retro owner-attribution correction** template and is distinct from the normal ownership-transfer journal.

It must not be confused with the normal ownership-transfer journal, which moves:

- gross cost
- accumulated depreciation
- NBV / OU self-balancing lines

The exact posting template must be locked during implementation, but the economic intent is:

- total depreciation stays unchanged
- owner-OU attribution is corrected
- the asset's current carrying value remains correct after the correction set

For V1, this is locked explicitly:

- post a retro depreciation-attribution true-up that reclasses depreciation expense and accumulated depreciation between source OU and target OU
- post a separate current-period carrying-value owner move on `correctionPostingDate`
- the owner move uses the existing ownership-transfer-style balance-sheet template semantics for:
  - gross cost move between source and target owner OUs
  - accumulated depreciation move based on the corrected owner balances as of the correction posting
  - OU self-balancing due-from / due-to lines for current NBV
- the owner move is current-period only and is subordinate to the retro-correction record; it is not a plain historical ownership-transfer fact

### Locked Journal Template - Worked Example

Reference scenario for locking the journal shape:

- Asset: cost 100,000 / monthly depreciation 10,000
- Old owner: OU-A / New owner: OU-B
- Real transfer date: 15.03.2026
- March and April depreciation posted entirely to OU-A (wrong)
- March correct split: OU-A 4,516.13 / OU-B 5,483.87
- April correct split: OU-B 10,000.00
- Total wrong owner attribution delta: 15,483.87
- Correction posting date: 10.05.2026 (May is the open period)
- March and April are closed

**Originally posted (wrong) - March depreciation, period 03/2026:**

```
OU-A
  Dr  730.03  Amortisman Giderleri (depr expense)     10,000.00
  Cr  257.01  Birikmiş Amortismanlar (accum depr)     10,000.00
```

**Originally posted (wrong) - April depreciation, period 04/2026:**

```
OU-A
  Dr  730.03  Amortisman Giderleri (depr expense)     10,000.00
  Cr  257.01  Birikmiş Amortismanlar (accum depr)     10,000.00
```

**Journal A1 - Retro depreciation-attribution true-up (posted 10.05.2026, period 05/2026):**

This journal reclasses the cumulative wrong-owner attribution delta. It does not touch the closed March/April periods. Each OU is self-balanced within this journal.

```
OU-A  (remove excess attribution)
  Dr  257.01  Birikmiş Amortismanlar (accum depr)     15,483.87
  Cr  730.03  Amortisman Giderleri (depr expense)     15,483.87

OU-B  (recognize correct attribution)
  Dr  730.03  Amortisman Giderleri (depr expense)     15,483.87
  Cr  257.01  Birikmiş Amortismanlar (accum depr)     15,483.87
```

Economic effect:
- total-entity depreciation unchanged
- OU-A accumulated depreciation reduced by 15,483.87
- OU-B accumulated depreciation increased by 15,483.87
- no 136/336 self-balancing lines needed because each OU is internally balanced within this journal

**Journal A2 - Current-period carrying-value owner move (posted 10.05.2026, period 05/2026):**

After the true-up, the corrected OU-A accumulated depreciation is 4,516.13 (the March 1-14 share). The remaining carrying value to move:

- Gross cost: 100,000.00
- OU-A corrected accum depr: 4,516.13
- NBV transferred: 100,000.00 − 4,516.13 = 95,483.87

```
Dr  255.01  Demirbaşlar (asset account) - OU-B       100,000.00
Cr  255.01  Demirbaşlar (asset account) - OU-A       100,000.00

Dr  257.01  Birikmiş Amortismanlar (accum depr) - OU-A   4,516.13
Cr  257.01  Birikmiş Amortismanlar (accum depr) - OU-B   4,516.13

Dr  136.90  İç Birim Cari Alacak (due-from) - OU-A      95,483.87
Cr  336.90  İç Birim Cari Borç (due-to) - OU-B          95,483.87
```

Self-balance verification:

- OU-A: Cr 255 (100,000) = Dr 257 (4,516.13) + Dr 136 (95,483.87)
- OU-B: Dr 255 (100,000) = Cr 257 (4,516.13) + Cr 336 (95,483.87)

Both OUs are balanced. Entity-level balance sheet unchanged.

### Locked journal-shape rules

1. The true-up journal (A1) uses only `depr_expense_account_id` and `accum_depr_account_id` from the asset/category depreciation setup, reversing the wrong attribution in source OU and recognizing it in target OU
2. The true-up journal (A1) does **not** use 136/336 self-balancing lines because each OU pair (Dr accum depr / Cr depr expense in source OU, Dr depr expense / Cr accum depr in target OU) is internally balanced
3. The owner-move journal (A2) uses `asset_account_id`, `accum_depr_account_id`, and the OU self-balancing due-from / due-to accounts resolved via `resolveOuSelfBalancingAccountsTx`
4. The accumulated depreciation moved in journal A2 is the **corrected** source-OU accumulated depreciation (i.e., after the true-up), not the original wrong amount
5. The gross cost moved in journal A2 is the asset master's current `original_cost_txn` which already includes any Track 39/40 improvements
6. Both journals are posted in the same transaction, in the same open period, on `correctionPostingDate`

## Reporting Rule

By default:

- historical posted depreciation runs remain immutable
- the correction appears in the current open period
- audit surfaces must show both:
  - `actualEffectiveDate`
  - `correctionPostingDate`

Reporting lock:

- corrected owner-based reporting must not rely only on the asset master's current owner
- corrected reporting must use persisted correction rows, persisted owner allocations, or an explicit corrected-reporting mode
- a corrected owner-OU reporting treatment is a required design seam for this track, not an optional nice-to-have

Possible report modes:

- `as originally posted`
- `include retro corrections`
- `operationally corrected`

MVP does not need every report variant immediately, but the correction design must not leave owner-based reporting ambiguous.

V1 reporting lock:

- `reportDepreciationByOwnerOu` supports only `AS_POSTED` and `INCLUDE_RETRO_CORRECTIONS` in V1
- `OPERATIONALLY_CORRECTED` is reserved for a future track and is not implemented in Track 43
- requesting `OPERATIONALLY_CORRECTED` in V1 returns `400` with stable `reasonCode = UNSUPPORTED_REPORT_BASIS`
- corrected V1 export must include the explicit `UNRESOLVED` row/bucket output and must not silently omit unresolved attribution
- `reportByOwnerOu` remains a current-owner snapshot surface in V1 rather than a corrected historical owner report

## UX Direction

Provide a bounded wizard or guided form, not a raw backdated transfer form.

Minimum UX steps:

1. Select asset
2. Enter actual transfer effective date
3. Select target owner OU
4. Preview impacted posted periods and calculated deltas
5. Confirm current-period correction posting date
6. Post correction

The preview must clearly show:

- actual effective date
- impacted posted periods
- source OU / target OU
- estimated correction amount by period
- that the flow will book a current-period true-up in the current open period
- that the flow will also post the mandatory current-period carrying-value owner move

## Backend Scope

Expected backend work:

- new correction transaction concept and/or correction detail storage
- preview calculation service
- post service
- validation rules on plain ownership transfer
- audit/detail read surfaces
- current-period open-period enforcement
- correction-aware lifecycle-history loading for future depreciation attribution
- OpenAPI contract updates and regeneration for new preview/post/reroute surfaces
- explicit V1 owner-only contract with no location correction field
- preview fingerprint / stale-preview protection between preview and post
- overlap replacement handling so one asset cannot end up with multiple active overlapping retro corrections

Permission note:

- V1 may reuse `fixed_assets.transfer` unless product later requires a stricter permission split

The backend must not:

- hide this inside the existing transfer endpoint without a distinct correction contract
- call the existing ownership-transfer posting with a historical effective date while using current carrying values

## Explicit Non-Goals

- do not overload existing depreciation `CATCH_UP`
- do not silently mutate prior posted run rows
- do not force broad batch run reversals as the primary user workflow
- do not mix this into Track 39 CARI subledger-aware lines
- do not treat physical move as equivalent to ownership transfer correction

## Execution Tracking

### Context-sizing adjustment

The original 7-step tracker is too dense in three places for a single focused implementation/review context. The plan is therefore split into 10 steps:

- `ROT02` splits into `ROT02A` (eligibility / blocker decision shell) and `ROT02B` (period discovery + delta calculation + full preview assembly)
- `ROT03` splits into `ROT03A` (happy-path posting) and `ROT03B` (overlap replacement engine + explicit retro-correction reversal rejection path)
- `ROT05` splits into `ROT05A` (backend read/report treatment) and `ROT05B` (frontend detail/report surfaces)

### Master Tracker

| Step | Scope | Status |
|---|---|---|
| **Phase 1 - Foundation and decision gates** | | |
| ROT01 | Migration, correction taxonomy, and persisted audit model | Completed |
| ROT02A | Preview contract, eligibility checks, and decision response shell | Completed |
| ROT04 | Plain ownership-transfer endpoint blockers and reroute contract | Completed |
| ROT02B | Preview calculation engine and full preview response assembly | Completed |
| **Phase 2 - Posting and replacement control** | | |
| ROT03A | Happy-path posting engine: true-up journal and mandatory current-period owner move | Completed |
| ROT03B | Overlap replacement engine and explicit retro-correction reversal rejection path | Completed |
| **Phase 3 - Read surfaces and frontend** | | |
| ROT05A | Backend asset-detail history payload and owner-report treatment | Completed |
| ROT06 | Frontend retro correction wizard and preview UX | Completed |
| ROT05B | Frontend asset-detail correction history and owner-report UI | Completed |
| **Phase 4 - Test and release control** | | |
| ROT07 | Smoke coverage, readiness gates, and rollback verification | Completed |

### Sequence Notes

1. `ROT01` lands first because every later step depends on durable correction persistence, transaction taxonomy, and the correction-aware owner timeline wrapper.
2. `ROT02A` and `ROT04` can proceed in parallel once `ROT01` is stable because both are blocker/reroute decision work rather than full calculation work.
3. `ROT02B` depends on `ROT02A` because the full preview engine should extend the same eligibility shell rather than introduce a second decision surface.
4. `ROT03A` depends on `ROT02B` because happy-path posting must post from preview-backed calculation output, not separate posting-only math.
5. `ROT03B` depends on `ROT03A` because replacement-only overlap handling should extend the already-stable happy-path posting flow rather than mix both branches in one first-pass implementation.
6. `ROT05A` and `ROT06` can proceed in parallel after posting and preview surfaces stabilize: `ROT05A` is backend read/report plumbing, while `ROT06` is the retro-correction wizard on the detail page.
7. `ROT05B` depends on both `ROT05A` and `ROT06` because the frontend history/report surfaces need the backend payload shape and should align with the wizard/display-label behavior already introduced in `ROT06`.
8. `ROT07` closes the track only after all prior steps are stable and the plain transfer, catch-up, and correction paths are re-verified together.

### Focused Verification Note

- `backend/scripts/test-fa48-retro-correction-focused-smoke.js` is the reusable focused verification script for the highest-risk Track 43 preview/posting seams discovered before `ROT03B`
- `backend/scripts/test-fa49-retro-correction-replacement-smoke.js` is the reusable focused verification script for the `ROT03B` replacement/supersession branch and explicit retro-correction reversal rejection path
- `backend/scripts/test-fa50-retro-correction-release-gate.js` is the broader Track 43 readiness gate that reruns the focused retro correction suites, re-verifies plain ownership transfer continuity, and asserts OpenAPI/release-gate wiring
- it is not a separate tracker step, but it is expected to be rerun before overlap-replacement work and again as part of `ROT07` readiness
- the current focused script covers:
  - one-month preview success
  - multi-month preview success
  - third-OU posted-allocation blocker
  - later owner-changing event blocker
  - happy-path post with correction header/detail persistence plus OU-balanced A1/A2 journals
  - overlap replacement success with supersession lineage and paired reversal/re-post behavior
  - explicit generic reversal rejection for `RETRO_CORRECTION_NOT_INDIVIDUALLY_REVERSIBLE`
  - stale-preview `409`
  - negative corrected source carrying value blocker

---

## `STEP-ROT01` - Migration, correction taxonomy, and persisted audit model

### Patch target
- `backend/src/migrations/` - new migration file, expected next slot `m155_fixed_asset_retro_transfer_corrections.js` (m151-m154 are taken by improvement transaction type, CARI improvement effective date, CARI charge allocations, and stock landed-cost vouchers respectively)
- `backend/src/migrations/index.js` - register new migration after `migration154StockLandedCostVouchers`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js`

### In scope
1. Introduce a dedicated persisted correction header table, for example `fixed_asset_retro_transfer_corrections`, carrying at minimum:
   - `tenant_id`, `legal_entity_id`, `asset_id`
   - `from_owner_operating_unit_id`, `to_owner_operating_unit_id`
   - `actual_effective_date`
   - `correction_posting_date`
   - `balance_sheet_transfer_posting_date`
   - `resolution_mode` ENUM with `CURRENT_PERIOD_TRUE_UP` as the only V1 mode
   - `status` ENUM(`POSTED`, `SUPERSEDED`) - preview-only state is not persisted; only posted corrections are stored; `SUPERSEDED` is used when a later correction replaces this one
   - `note`
   - `posted_by_user_id`
   - replacement linkage: `replaces_correction_id` and `replaced_by_correction_id` (self-referencing FKs)
   - true-up transaction link: `true_up_transaction_id` FK to `fixed_asset_transactions`
   - true-up journal link: `true_up_journal_entry_id` FK to `journal_entries`
   - owner-move transaction link: `owner_move_transaction_id` FK to `fixed_asset_transactions`
   - owner-move journal link: `owner_move_journal_entry_id` FK to `journal_entries`
2. Extend `fixed_asset_transactions.transaction_type` with `RETRO_OWNERSHIP_CORRECTION` for transaction-list and drillback consistency.
3. Introduce a persisted per-period breakdown table, for example `fixed_asset_retro_transfer_correction_periods`, carrying at minimum:
   - correction header id
   - `period_key`
   - related posted depreciation run id when applicable
   - source and target owner OU ids
   - eligible-day split used by the calculation
   - originally posted source/target attribution (dual-currency `_txn`/`_base` per locked decision #23)
   - corrected source/target attribution (dual-currency `_txn`/`_base`)
   - net delta that fed the posting (dual-currency `_txn`/`_base`)
   - amounts are aggregated per-period per-OU, not raw day-level segments (see locked decision #34)
4. Add service-layer taxonomy constants and read helpers so the correction is a first-class fixed-assets concept rather than an ad hoc note on normal ownership transfer rows.
5. Lock the historical owner source used by future depreciation (see locked decision #13):
   - introduce a correction-aware wrapper `loadCorrectionAwareOwnerTimeline(...)` that calls the existing `loadAssetDepreciationLifecycleHistory(...)` unchanged, then merges posted retro-correction events from `fixed_asset_retro_transfer_corrections` as synthetic ownership-transfer entries at their `actual_effective_date` position
   - filter out raw `RETRO_OWNERSHIP_CORRECTION` transaction entries from the base timeline (they carry NULL owner columns via the LEFT JOIN)
   - synthetic events must carry `fromOwnerOperatingUnitId`, `toOwnerOperatingUnitId`, `transactionId`, `effectiveDate`, and `kind: "OWNERSHIP_TRANSFER"` (see locked decision #43)
   - **all owner-timeline consumers** must use the correction-aware wrapper, not the raw `loadAssetDepreciationLifecycleHistory` directly — this includes the preview engine, normal depreciation schedule building, future depreciation runs, retro-improvement catch-up recalculation, reversal state-restoration logic, and any disposal/sale preview or cutoff logic that reasons over owner chronology
   - do not rely only on the current-period carrying-value owner move for future owner allocation
   - do not let the supporting current-period owner-move transaction masquerade as a plain chronology ownership-transfer event in lifecycle reads
6. Define persisted status/state transitions for the correction record:
   - preview-only is not persisted
   - posted correction persists immutable header/detail rows
   - superseded / replaced correction rows remain immutable and are linked forward/backward to the replacing correction
   - reversal, if supported later, must preserve the original correction row and add reversal linkage rather than mutate in place
7. Lock the V1 audit/source-of-truth model:
   - dedicated retro-correction header/detail tables are the primary source of retro audit history
   - supporting `fixed_asset_transactions` rows use `RETRO_OWNERSHIP_CORRECTION` for journal lineage/drillback
   - supporting transaction rows must not be the only retro-correction record
8. Lock the asset-master update rule (see locked decisions #16 and #30):
   - the correction flow always updates `fixed_assets.owner_operating_unit_id` to the target OU
   - this is safe because decision #30 blocks the correction entirely when any later posted owner-changing event exists after `actualEffectiveDate`

### Explicit non-goals
- Do not overload `fixed_asset_ownership_transfer_details` for retro-correction storage
- Do not store this feature only as free-text transaction notes
- Do not finalize the exact report-mode UI in this step

### Definition of done
- Migration is reversible and runs cleanly on current schema
- A posted retro correction has durable header + per-period audit rows
- Service-layer constants and read helpers exist for later API/UI steps

---

## `STEP-ROT02A` - Preview contract, eligibility checks, and decision response shell

### Split note

- `ROT02A` is the "can we do this?" slice: validator, route, fiscal-year check, blocker checks, and the structured decision shell.
- `ROT02B` is the "what are the numbers?" slice: impacted-period discovery, day-split reuse, dual-currency delta calculation, `previewFingerprint`, and full preview response assembly.
- Treat the detailed preview bullets below as the combined reference surface for `ROT02A` + `ROT02B`; use the split above for actual implementation sizing.

### Patch target
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`
- `backend/src/services/fixed-assets.depreciation.service.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### Implementation boundary

For actual step sizing, stop `ROT02A` at the blocker/eligibility decision shell. Detailed impacted-period discovery, period breakdowns, delta amounts, replacement metadata, and `previewFingerprint` belong to `ROT02B` even though the combined reference bullets below still describe the end-state preview surface.

### In scope
1. Add a dedicated preview endpoint:
   - `POST /api/v1/fixed-assets/:assetId/retro-ownership-transfer-correction/preview`
2. Validate a dedicated preview contract with fields such as:
   - `actualEffectiveDate`
   - `correctionPostingDate`
   - `targetOwnerOperatingUnitId`
   - optional `note`
   - no location correction field in V1 — reject with a validation error if `targetLocationOperatingUnitId` is present (see locked decision #36)
3. Build a deterministic impacted-period discovery engine that:
   - reads ownership transfer history
   - reads posted depreciation runs and run allocations, treating both `depreciation_kind = 'RUN'` and `depreciation_kind = 'CATCH_UP'` equally (see locked decision #15)
   - reads improvement/lifecycle history using the same correction-aware fixed-asset timeline the depreciation engine consumes, so any charge-augmented `IMPROVEMENT` basis coming from Track 40 is already reflected without separate charge-table joins
   - requires persisted owner-allocation detail for each impacted posted period and returns `BLOCKED` if that detail is missing
   - blocks preview with `reasonCode = UNSUPPORTED_OWNER_ALLOCATION_OPERATING_UNIT` if an impacted posted owner-allocation row contains an OU outside the derived source/target pair; V1 must block instead of guessing more complex owner attribution
   - checks for in-flight draft depreciation runs covering the asset and returns `BLOCKED` with reason `DRAFT_DEPRECIATION_RUN_IN_PROGRESS` if found (see locked decision #28)
   - validates self-balancing account configuration between source and target OUs and returns `BLOCKED` with reason `SELF_BALANCING_ACCOUNTS_NOT_CONFIGURED` if not configured (skipped only when the corrected source-OU carrying value after A1 is exactly zero, see locked decisions #26 and #33)
   - checks that the asset's current status is in `OWNERSHIP_TRANSFER_ELIGIBLE_STATUSES` (`ACTIVE`, `SUSPENDED`, `FULLY_DEPRECIATED`) and returns `BLOCKED` with reason `ASSET_DISPOSED` if the asset is disposed (see locked decision #29)
   - checks for any later posted owner-changing lifecycle event after `actualEffectiveDate` and returns `BLOCKED` with reason `LATER_OWNER_CHANGING_EVENT_EXISTS` if found (see locked decision #30)
   - identifies the first impacted posted month from `actualEffectiveDate`
   - stops at the earliest of the next posted owner-changing lifecycle boundary, a terminal disposal boundary, owner-history alignment, or the current open-period cutoff
   - respects suspension segments within impacted periods: eligible-day split for owner attribution only covers days the asset was active, consistent with existing `buildPeriodEligibility` behavior (see locked decision #19)
4. Reuse existing depreciation owner-split logic where possible so day-split behavior stays aligned with `DAILY_PRORATA` and current owner-allocation semantics. If the asset is currently suspended at `correctionPostingDate`, the correction is still allowed because it only reclasses already-posted amounts and moves carrying values, not generating new depreciation.
5. Make preview and future depreciation attribution share the same correction-aware lifecycle-history reader so the preview result and the next depreciation run cannot diverge.
6. Return a structured decision payload, not just a number. At minimum include:
   - `resolutionMode`: `NORMAL_TRANSFER_ALLOWED`, `CURRENT_PERIOD_TRUE_UP_REQUIRED`, or `BLOCKED`
   - chronology blockers
   - closed-year blocker if applicable (determined by comparing `fiscal_year` values from `resolveFiscalPeriodForDate`, see locked decision #41)
   - impacted posted periods
   - source/target OU deltas by period (dual-currency `_txn`/`_base` per locked decision #23)
   - cumulative delta (dual-currency `_txn`/`_base`)
   - `previewFingerprint` (SHA-256 content hash per locked decision #17 - no server-side session required)
   - whether replacement of an earlier overlapping correction is required
   - the correction id that would be replaced, when applicable
   - a flag that any location change remains a separate physical-move workflow in V1
   - the derived source OU (`from_owner_operating_unit_id`) resolved from the lifecycle timeline at `actualEffectiveDate` (see locked decision #44)
   - whether the mandatory current-period carrying-value owner move will be posted
   - `currentOwnerChanged: true` confirming the correction updates the asset master owner in V1 (see locked decision #39)
7. Return stable machine-readable reason codes so the frontend and plain transfer endpoint can share the same decision surface.
8. Lock preview HTTP semantics:
   - malformed input / validator failures return `400`
   - business-state blockers return `409`
   - every `409` preview response carries stable `reasonCode`
   - frontend branching must use `status + reasonCode`, not free-text messages

### Explicit non-goals
- No posting in preview endpoint
- No implicit writes to asset history from preview
- No silent fallback from blocked state into plain ownership transfer
- No period-by-period delta calculation in the scoped `ROT02A` implementation slice
- No `previewFingerprint` generation in the scoped `ROT02A` implementation slice

### Definition of done
- Eligibility outcomes are explicit and machine-readable
- The plain transfer endpoint can reuse the same decision shell for reroute handling
- The heavier calculation work is cleanly isolated for `ROT02B`

---

## `STEP-ROT02B` - Preview calculation engine and full preview response assembly

### Patch target
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Extend the `ROT02A` preview endpoint from an eligibility shell into the full calculation path when `resolutionMode = CURRENT_PERIOD_TRUE_UP_REQUIRED`.
2. Land the heavy math slice:
   - deterministic impacted-period discovery
   - stop-boundary handling
   - day-split reuse aligned with `DAILY_PRORATA`
   - dual-currency per-period delta calculation
   - cumulative delta assembly
3. Include the remaining full-preview fields:
   - impacted period breakdown
   - replacement-required / replacement-target metadata
   - `previewFingerprint`
   - full machine-readable preview response assembly
4. Keep preview and posting on the same calculation path so posting does not invent separate math.

### Explicit non-goals
- No posting in this step
- No generic plain-transfer reroute work in this step; that stays in `ROT04`

### Definition of done
- Preview returns full period-by-period delta output
- `previewFingerprint` is present and tied to the same asset history the post step will validate
- The calculation engine is isolated enough that `ROT03A` can post from it directly

---

## `STEP-ROT03A` - Happy-path posting engine: true-up journal and mandatory current-period owner move

### Split note

- `ROT03A` is the happy-path posting slice: re-run preview-backed validation, persist correction header/detail, post Journal A1 + A2, link journals, update asset master owner, and reject stale previews.
- `ROT03B` is the replacement-only slice: overlap replacement/reversal sub-engine plus the explicit generic reversal rejection for `RETRO_OWNERSHIP_CORRECTION`.
- Treat the detailed posting bullets below as the combined reference surface for `ROT03A` + `ROT03B`; use the split above for actual implementation sizing.

### Patch target
- `backend/src/services/fixed-assets.service.js`
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### Implementation boundary

For actual step sizing, keep `ROT03A` to the no-overlap happy path. Replacement/supersession mechanics and the explicit generic reversal rejection for `RETRO_OWNERSHIP_CORRECTION` belong to `ROT03B` even though the combined reference bullets below still describe the end-state posting surface.

### In scope
1. Add a dedicated post endpoint:
   - `POST /api/v1/fixed-assets/:assetId/retro-ownership-transfer-correction`
2. Require the post endpoint to consume a preview-backed payload so the user confirms the same dates, OUs, and resolution mode they previewed, including a required `previewFingerprint`.
3. Implement `CURRENT_PERIOD_TRUE_UP` posting:
   - persist correction header/detail rows
   - check for in-flight draft depreciation runs covering the asset and reject if found (see locked decision #28)
   - check asset status eligibility — block if `DISPOSED` (see locked decision #29)
   - create two supporting `fixed_asset_transactions` rows, both with `transaction_type = 'RETRO_OWNERSHIP_CORRECTION'` (see locked decision #11):
     - true-up transaction with `source_ref_type = 'RETRO_CORRECTION_TRUE_UP'` — insert FIRST so it gets the lower `id` (see locked decision #24)
     - owner-move transaction with `source_ref_type = 'RETRO_CORRECTION_OWNER_MOVE'` — insert SECOND so it gets the higher `id` and `resolveCurrentAssetNbv` returns this as the latest snapshot
   - both transaction rows must use `effective_date = correctionPostingDate`, not `actualEffectiveDate` (see locked decision #25)
   - both transaction rows must populate all six amount fields: `grossAmountTxn`/`Base`, `accumDeprAmountTxn`/`Base`, `nbvAmountTxn`/`Base` in both `_txn` and `_base` currencies (see locked decision #23)
   - post the retro owner-attribution correction journal (Journal A1 per locked template) with dual-currency amounts on every journal line
   - post a separate current-period carrying-value owner move journal (Journal A2 per locked template) on `correctionPostingDate` as a mandatory part of the correction set
   - compute the corrected source-OU carrying value after A1 for Journal A2; if that amount is positive include due-from/due-to, if it is exactly zero omit them, and if it would be negative block the correction in V1 with a stable reason code (see locked decision #26)
   - call `upsertJournalSourceLinkTx` after each journal post to link journal entries back to their respective `fixed_asset_transactions` rows (see locked decision #27)
   - do NOT create a `fixed_asset_ownership_transfer_details` row for the owner move (see locked decision #12)
   - link posted transaction ids back to the correction header row
   - if any later posted owner-changing event exists after `actualEffectiveDate`, reject the correction entirely (see locked decision #30)
4. Lock the dedicated owner-attribution correction journal template in code, distinct from normal ownership transfer (see **Locked Journal Template - Worked Example** in Journal Direction section):
   - Journal A1: reclass depreciation expense and accumulated depreciation between source and target OUs; each OU is internally balanced within this journal; no 136/336 self-balancing lines needed
   - Journal A2: move gross cost, move corrected accumulated depreciation, and post OU self-balancing due-from / due-to lines for transferred NBV
   - preserve total-entity depreciation and total NBV
5. Resolve and validate the true-up posting accounts from the asset/category depreciation setup (see locked decision #18):
   - `depr_expense_account_id` (for Journal A1) - must be loaded from asset master or category fallback
   - `accum_depr_account_id` (for both Journal A1 and A2)
   - `asset_account_id` (for Journal A2)
   - fail clearly if the asset/category accounting setup is incomplete
6. Lock the current-period carrying-value owner-move template in code as a mandatory companion journal (see locked decision #14):
   - move gross cost from asset master's current `original_cost_txn` (includes any Track 39/40 improvements) between source and target owner OUs
   - move the **corrected** source-OU accumulated depreciation (post true-up amount, not the original wrong amount) between source and target owner OUs
   - post OU self-balancing due-from / due-to lines for current NBV using `resolveOuSelfBalancingAccountsTx`
   - do not represent this supporting owner move as a plain historical `OWNERSHIP_TRANSFER` lifecycle fact
7. Enforce no-overlap replacement behavior (see locked decision #21 for detailed mechanics):
   - do not allow two active overlapping posted retro corrections for one asset
   - reversal of prior correction journals is an internal replacement-only engine path, not reachable through the generic user-triggered reversal workflow (see locked decision #37). Do NOT add `RETRO_OWNERSHIP_CORRECTION` to `NON_RUN_REVERSIBLE_TRANSACTION_TYPES`.
   - patch the generic non-run reversal rejection path (`assertSupportedFixedAssetReversalTarget` in `fixed-assets.service.js` line ~3054) to return a specific reason code `RETRO_CORRECTION_NOT_INDIVIDUALLY_REVERSIBLE` when `transactionType === 'RETRO_OWNERSHIP_CORRECTION'`, instead of the current generic "not reversible through the fixed-assets non-run reversal workflow" message. The frontend should surface this as a clear notice (e.g., "Retro corrections cannot be reversed individually. Use the retro correction replacement workflow instead.").
   - when preview/post indicates a safe replacement:
     1. create reversal transactions for the prior correction's journals using existing `REVERSAL` / `reversed_transaction_id` linkage
     2. mark prior correction header as `SUPERSEDED` with `replaced_by_correction_id`
     3. compute the new correction's delta from scratch (not as a net against the reversed correction)
     4. post the new correction's journals as fresh entries
     5. all within a single database transaction
   - if safe replacement cannot be derived deterministically, block posting instead of stacking overlapping corrections
8. Keep the retro-correction audit source explicit:
   - dedicated correction header/detail tables remain the primary retro-correction record
   - supporting `RETRO_OWNERSHIP_CORRECTION` rows and linked GL journals serve lineage/drillback, not the sole historical fact
9. Enforce current-period open-period checks for any correction posting and any carrying-value owner move.
10. Reject stale post attempts when the supplied `previewFingerprint` no longer matches the asset history used by preview.
11. The post response must include `currentOwnerChanged: true` confirming the asset master owner was updated (see locked decision #39). This field must be present in the response contract so the frontend can display confirmation without re-fetching the asset.
12. Keep the journal logic decoupled from Track 40 internals:
   - if an impacted period includes depreciation on a charge-augmented improvement, reclass the already-posted depreciation attribution delta only
   - do not generate any extra charge-allocation journal lines or re-open CARI charge math in this track
13. Lock post HTTP semantics:
   - malformed input / contract mismatch returns `400`
   - stale preview and other business-state conflicts return `409`
   - `STALE_PREVIEW` is returned as `409` with stable machine-readable metadata so the frontend can force a fresh preview

### Explicit non-goals
- Do not post a misleading historical carrying-value move dated with `actualEffectiveDate`
- Do not reuse the current `CATCH_UP` depreciation posting path
- Do not allow the correction endpoint to mutate old posted run rows directly
- Do not implement `AUTO_UNWIND_REPOST` in V1
- Do not land overlap replacement mechanics in the scoped `ROT03A` implementation slice

### Definition of done
- Current-period true-up can be previewed and posted end-to-end
- Mandatory current-period owner move posts together with the true-up and links cleanly to the correction record
- Posted correction rows link cleanly to their resulting GL/fixed-asset transactions
- The replacement-only branch is left isolated for `ROT03B`

---

## `STEP-ROT03B` - Overlap replacement engine and explicit retro-correction reversal rejection path

### Patch target
- `backend/src/services/fixed-assets.service.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Implement the replacement-only overlap path:
   - reverse the prior correction pair as one correction set
   - mark the prior correction `SUPERSEDED`
   - recompute the new correction from scratch
   - post the replacement correction in the same database transaction
2. Patch the generic non-run reversal flow so `RETRO_OWNERSHIP_CORRECTION` returns an explicit reason code such as `RETRO_CORRECTION_NOT_INDIVIDUALLY_REVERSIBLE`.
3. Keep replacement lineage explicit in the persisted audit model and response shape.

### Explicit non-goals
- No standalone user-triggered retro-correction reversal in V1
- No silent stacking of overlapping active corrections

### Definition of done
- Overlapping corrections either replace deterministically or fail with a clear blocker
- Generic reversal of retro-correction transactions is explicitly rejected with the dedicated reason code
- Supersession lineage remains auditable end to end

---

## `STEP-ROT04` - Plain ownership-transfer endpoint blockers and reroute contract

### Patch target
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/services/fixed-assets.service.js`

### Behavioral change notice
The current `ownershipTransferAsset()` has zero chronology validation — a user can today post a backdated ownership transfer regardless of whether depreciation has already been posted for that period. This step introduces net-new blocking logic that will prevent previously-allowed backdated transfers when they conflict with posted depreciation (see locked decision #20). No migration-time feature toggle is required; the blocking behavior activates on deployment.

### In scope
1. Extend plain ownership-transfer validation to call the chronology decision logic before posting. Add a new pre-posting check function (e.g., `evaluateOwnershipTransferChronologySafety(...)`) that:
   - queries for posted depreciation transactions on the asset with `effective_date >= effectiveDate`
   - queries for later posted lifecycle activity (ownership transfers, improvements, disposals) after `effectiveDate`
   - returns a structured decision object, not a thrown error
2. Block plain backdated ownership transfer when:
   - impacted posted depreciation already exists for any period at or after `effectiveDate`
   - later fixed-assets lifecycle activity makes the transfer historically unsafe
   - the posting period is closed
   - the request includes both an owner change AND a location change (`targetLocationOperatingUnitId` is present) AND the transfer is chronology-unsafe (see locked decision #36). Mixed requests that require retro correction must be rejected outright — do not silently drop the location part or defer it.
3. Return structured reroute responses from the plain endpoint, not only generic validation text. Include:
   - stable error/reason code (e.g., `RETRO_CORRECTION_REQUIRED`, `PERIOD_CLOSED`, `LATER_LIFECYCLE_CONFLICT`, `MIXED_OWNER_LOCATION_REQUIRES_SEPARATE_SUBMISSION`)
   - `reroute` object with:
     - `retroCorrectionPreviewRequired: true`
     - `firstImpactedPeriodKey`
     - `impactedPostedPeriodCount`
     - `locationChangeMustBeSeparate: true` (if the request included a location change)
     - `mixedRequestRejected: true` (if the request was rejected because it mixed owner + location changes with an unsafe chronology, see locked decision #36)
   - the response shape must match what the frontend retro-correction wizard expects for auto-prefill
4. Keep direct plain ownership transfer working for chronologically safe cases so the new track does not regress normal same-period operational flow. A transfer is chronologically safe when:
   - no posted depreciation exists for the asset at or after `effectiveDate`
   - no later posted lifecycle activity conflicts
   - the posting period is open
5. Ensure the detail page can detect this reroute and open the retro-correction path instead of leaving the user at a dead end.
6. Lock plain-transfer HTTP semantics:
   - malformed input / validator failures return `400`
   - chronology reroute, blocked business-state responses, and mixed-request separation responses return `409`
   - reroute-capable `409` responses must include the structured `reroute` object
   - the frontend must treat `409 + reasonCode` as a business-state branch, not a generic form-validation failure
7. Regenerate and commit the plain-transfer endpoint contract so the documented response set includes the reroute/blocker `409` shape, stable `reasonCode`, and `reroute` payload.

### Explicit non-goals
- Do not remove the existing ownership transfer capability
- Do not make the retro correction endpoint silently callable through the plain endpoint contract

### Definition of done
- Unsafe backdated transfer attempts are blocked with deterministic reason codes
- Safe same-chronology transfers continue to post unchanged
- Backend exposes enough reroute context for the frontend wizard step

---

## `STEP-ROT05A` - Backend asset-detail history payload and owner-report treatment

### Split note

- `ROT05A` is backend only: correction history payload, corrected owner timeline exposure, report-basis parsing, and corrected owner-report treatment.
- `ROT05B` is frontend only: detail-page correction history UI, shared transaction display labels, report-mode selector UI, and non-reversible retro-correction presentation.
- Treat the detailed read-surface bullets below as the combined reference surface for `ROT05A` + `ROT05B`; use the split above for actual implementation sizing.

### Patch target
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.reporting.service.js`
- `backend/src/routes/fixed-assets.validators.js` - add `reportBasis` field to `parseReportFilters()` for basis-aware corrected report handling
- `backend/src/routes/fixed-assets.routes.js` - expand fixed-asset transaction read payload for retro-correction feed metadata
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### Implementation boundary

For actual step sizing, keep `ROT05A` backend-only. The asset-detail JSX section, shared frontend display-label utility, report-mode selector UI, and non-reversible retro-correction presentation belong to `ROT05B` even though the combined reference bullets below still describe the end-state read surfaces.

### In scope
1. Expose retro-correction history on the asset detail payload:
   - correction id/status
   - `actualEffectiveDate`
   - `correctionPostingDate`
   - source and target owner OUs
   - impacted periods
   - posted correction transaction ids
   - replacement / supersession linkage when one correction safely replaces an earlier overlapping correction
   - `currentOwnerChanged: true` confirming the correction updated the asset master owner in V1 (see locked decision #39)
   - retro-corrected historical owner timeline as a distinct view alongside the current owner from asset master
2. Add an asset-detail audit/history section showing retro corrections separately from normal ownership transfers so users can see the difference. Use the grouped parent/child layout: one correction record with two nested child transactions (see locked decision #38).
3. Expand fixed-asset transaction read surfaces so `RETRO_OWNERSHIP_CORRECTION` rows can be labeled and grouped coherently in the standard transaction feed and drillback paths without being treated as normal ownership-transfer lifecycle events. At minimum expose:
   - `sourceRefType`
   - `retroCorrectionId` or an explicitly-defined correction-header linkage field
   - optional convenience `displayLabel`
   - the "Reverse" button must not appear for these transactions in the frontend (see locked decision #37)
4. Update owner-based reporting treatment so correction-aware results do not rely only on the asset master's current owner. Specifically address each existing report's gap (see locked decision #31):
   - `reportTransfers`: reads `fixed_asset_ownership_transfer_details` — retro corrections are invisible because they do not write there (decision #12). This is intentional for V1: transfer report remains plain-transfer-only (see locked decision #40). No correction-aware union query needed in this report.
   - `reportByOwnerOu`: remains a current-owner snapshot report in V1. It groups by the asset master's current owner after correction and must expose its basis explicitly; it does **not** attempt corrected historical owner attribution in this track.
   - `reportDepreciationByOwnerOu`: reads depreciation allocation table with fallback to current owner — does not include correction true-up reclassifications. V1 ships `INCLUDE_RETRO_CORRECTIONS` as the only correction-aware basis for this report. It must include correction journal amounts in that mode, must block the current-owner fallback in that mode, and must surface incomplete legacy data as an explicit `UNRESOLVED` row/bucket in both API rows and export output rather than silently guessing owner attribution (see locked decisions #35 and #49/#50).
   - `reportRollforward`: remains an entity-level economic movement report in V1. `RETRO_OWNERSHIP_CORRECTION` rows are excluded from rollforward output and must not affect opening or closing NBV (see locked decision #45).
5. Introduce or reserve report modes such as:
   - `AS_POSTED`
   - `INCLUDE_RETRO_CORRECTIONS`
   - `OPERATIONALLY_CORRECTED`
6. Treat corrected owner-based reporting as mandatory for this track, not optional follow-up.
7. For V1, only `INCLUDE_RETRO_CORRECTIONS` is wired as the correction-aware mode on `reportDepreciationByOwnerOu`; `OPERATIONALLY_CORRECTED` remains reserved and unsupported in this track.
8. Validate `reportBasis` per report name at the request-contract level:
   - unsupported combinations return `400`
   - requesting `reportBasis = OPERATIONALLY_CORRECTED` on `reportDepreciationByOwnerOu` in V1 returns `400` with stable `reasonCode = UNSUPPORTED_REPORT_BASIS`
   - do not silently ignore unsupported basis values
   - `reportByOwnerOu` must reject corrected-history basis values in V1 rather than pretending to support them
   - the backend/API/query-param name is `reportBasis`; UI copy may still label the selector as `Report Mode`
9. Regenerate and commit the affected report/read contracts so the documented query params, response metadata, and transaction-read payload shapes match the implemented backend behavior.

### Explicit non-goals
- No requirement to retrofit every fixed-assets report in this step
- No silent change of existing report semantics without a visible mode or documented default
- No frontend detail-page JSX or report selector work in the scoped `ROT05A` implementation slice

### Definition of done
- Asset detail payload exposes the correction history and corrected owner timeline needed by the frontend
- Transaction-feed payload exposes the metadata required to label and visually group retro-correction rows
- At least one owner-based reporting path can include persisted retro corrections explicitly
- Reporting semantics are documented in code and API shape
- OpenAPI reflects the new report-basis contract, transaction-read payload fields, and unsupported-combination validation behavior

---

## `STEP-ROT06` - Frontend retro correction wizard and preview UX

### Patch target
- `frontend/src/api/fixedAssets.js`
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`

### In scope
1. Add frontend API helpers for:
   - retro correction preview
   - retro correction posting
2. Add a bounded wizard or guided modal on the asset detail page that captures:
   - `actualEffectiveDate`
   - `correctionPostingDate`
   - target owner OU
   - note
   - no location field in V1
3. Show preview output before posting:
   - detected resolution mode
   - impacted posted periods
   - source OU / target OU
   - per-period delta
   - cumulative correction amount
   - that the mandatory current-period carrying-value owner move will also be posted
   - that the correction updates the current owner on the asset master (`currentOwnerChanged: true` in V1, see locked decision #39)
   - whether the post would replace an earlier overlapping correction
4. If the plain ownership-transfer endpoint returns a retro-correction reroute reason, guide the user into this wizard with the relevant context prefilled where possible.
   - if the reroute response includes `mixedRequestRejected: true` and `locationChangeMustBeSeparate: true`, display a notice that the location change must be submitted separately via physical move after the retro correction is posted (see locked decision #36)
   - preserve the originally requested `targetLocationOperatingUnitId` from the reroute response as informational guidance only — do NOT pass it to the retro correction preview/post endpoints
   - distinguish malformed-input failures from business-state reroute/conflict responses by branching on `400` vs `409` plus `reasonCode`
5. Keep the existing normal ownership transfer form for safe cases; do not collapse both workflows into one ambiguous form.
6. Reuse `fixed_assets.transfer` permission in V1 unless product later requests a stricter split.

### Explicit non-goals
- No separate full-screen page in V1 unless the detail page becomes unmanageable
- No generic lifecycle mega-wizard that mixes suspend, move, write-off, and retro correction together

### Definition of done
- User can preview and post a retro correction from the fixed asset detail experience
- Unsafe plain transfer attempts can pivot into the retro wizard without losing context
- The UI clearly distinguishes historical business date from current posting date

---

## `STEP-ROT05B` - Frontend asset-detail correction history and owner-report UI

### Patch target
- `frontend/src/api/fixedAssets.js` - forward `reportBasis` query param to report endpoints
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetReportsPage.jsx`
- `frontend/src/pages/fixedAssets/FixedAssetDisposalsPage.jsx`
- shared frontend display-label utility file as needed

### In scope
1. Add the asset-detail correction history section using the grouped parent/child layout for one correction with two child transactions.
2. Introduce a shared transaction display-label formatter so true-up and owner-move rows render distinctly anywhere `RETRO_OWNERSHIP_CORRECTION` appears, using the backend-provided `sourceRefType` and correction-linkage metadata from `ROT05A`.
3. Add corrected owner-report UI plumbing:
   - forward `reportBasis`
   - add a report-mode selector only where the backend actually supports selectable `reportBasis` values in V1
   - `reportDepreciationByOwnerOu` exposes `AS_POSTED` vs `INCLUDE_RETRO_CORRECTIONS`
   - keep corrected-mode semantics visible in the UI
   - keep `reportByOwnerOu` visibly labeled as a current-owner snapshot basis in V1
   - show `UNRESOLVED` warning state when corrected `reportDepreciationByOwnerOu` returns incomplete attribution data
   - do not offer unsupported corrected modes or unsupported basis selectors on unaffected reports
4. Keep retro-correction rows non-reversible in the frontend presentation.

### Explicit non-goals
- No backend query changes in this step
- No full-screen retro-correction page

### Definition of done
- Asset detail clearly separates retro corrections from plain ownership transfers
- Fixed-assets frontend pages show distinct true-up vs owner-move labels consistently
- Owner-report UI exposes the reporting basis explicitly

---

## `STEP-ROT07` - Smoke coverage, readiness gates, and rollback verification

### Patch target
- `backend/scripts/` - keep and rerun `test-fa48-retro-correction-focused-smoke.js` as the focused Track 43 preview/posting baseline, keep and rerun `test-fa49-retro-correction-replacement-smoke.js` as the focused `ROT03B` replacement/reversal baseline, and add any broader FA smoke scripts using the next available `test-fa##-*` slots after `FA49` (see locked decision #22)
- existing fixed-assets smoke/readiness scripts as needed
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Add smoke coverage for at least these cases:
   - rerun `test-fa48-retro-correction-focused-smoke.js` as a focused baseline before broader Track 43 readiness checks
   - scenario 1: one posted month impacted, preview result correct, chosen resolution path behaves as designed
   - scenario 2: multiple posted months impacted, current-period true-up posted correctly
   - owner correction after a posted `IMPROVEMENT` that already includes Track 40 allocated charges still computes the correct owner-attribution delta from the effective depreciation basis
   - plain ownership transfer blocked and rerouted when chronology is unsafe
   - closed-year correction blocked or routed according to locked policy
   - stale preview is rejected and requires a fresh preview before post
   - overlapping correction requests do not create two active overlapping corrections and instead follow the replacement path or block deterministically
   - missing owner-allocation detail blocks the workflow in V1
   - impacted posted owner allocations containing a third OU outside the derived source/target pair block preview with `UNSUPPORTED_OWNER_ALLOCATION_OPERATING_UNIT`
   - owner-based reporting includes persisted correction rows in the chosen corrected mode
   - later owner-changing event scenario: retro correction is blocked when a later posted ownership transfer exists after `actualEffectiveDate` (see locked decision #30)
   - disposed asset blocked from correction (see locked decision #29)
   - corrected-source-carrying-value-zero case omits A2 self-balancing lines; negative corrected source carrying value is blocked (see locked decision #26)
   - dual-currency amounts (`_txn`/`_base`) computed independently and stored correctly (see locked decision #23)
   - draft depreciation run in progress blocks correction (see locked decision #28)
   - journal source links exist for both correction journals (see locked decision #27)
   - `reportRollforward` excludes `RETRO_OWNERSHIP_CORRECTION` rows and closing NBV does not change solely because of the correction posting
   - fixed-asset transaction feed rows for retro correction expose `sourceRefType` plus correction-linkage metadata so the two child rows can be labeled and grouped reliably
   - corrected `reportDepreciationByOwnerOu` returns `UNRESOLVED` rather than current-owner fallback when required historical owner attribution data is missing
   - corrected `reportDepreciationByOwnerOu` export includes the explicit `UNRESOLVED` row/bucket when unresolved attribution exists in the requested result set
   - requesting `reportBasis = OPERATIONALLY_CORRECTED` on `reportDepreciationByOwnerOu` in V1 returns `400` with stable `reasonCode = UNSUPPORTED_REPORT_BASIS`
   - unsupported `reportBasis` combinations return `400` rather than being silently ignored
   - plain-transfer reroute / blocker responses and stale-preview post failures return `409`, while malformed input remains `400`
2. Verify transaction linkage and audit rows:
   - correction header/detail rows persisted
   - linked posted transaction ids exist
   - `RETRO_OWNERSHIP_CORRECTION` appears correctly in transaction feed/drillback
   - asset detail shows correction history
3. Verify rollback/readiness concerns:
   - migration rollback works
   - non-retro ownership transfer flows still pass existing smoke behavior
   - existing `CATCH_UP` behavior is unchanged
4. Verify contract/readiness concerns:
   - OpenAPI spec is regenerated and committed
   - preview/post/reroute response shapes match the documented contract

### Explicit non-goals
- No broad regression suite rewrite
- No silent shipping without scenario-based smoke coverage for both preview and posting paths

### Definition of done
- New smoke scripts cover the main retro-correction decision branches
- Existing ownership transfer and catch-up smoke coverage still passes
- The track has explicit release gates for migration safety and accounting-path isolation

## Locked Decisions Before Implementation

Locked decisions from planning:

1. V1 does not implement `AUTO_UNWIND_REPOST`. Once posted depreciation exists and retro correction is required, the workflow uses current-period true-up plus the mandatory current-period carrying-value owner move.
2. The true-up journal reclasses depreciation expense and accumulated depreciation between source OU and target OU without changing total-entity depreciation.
3. The correction always posts a mandatory current-period carrying-value owner move on `correctionPostingDate` so the asset itself sits on the new owner's books from the correction posting date onward.
4. The current-period owner move uses existing ownership-transfer-style balance-sheet semantics for gross cost, accumulated depreciation, and OU self-balancing due-from / due-to lines, but remains subordinate to the retro-correction record and is not treated as a plain historical `OWNERSHIP_TRANSFER`.
5. Two active overlapping retro corrections for one asset cannot coexist. A later overlapping correction must follow a safe replacement path with explicit supersession linkage or be blocked.
6. Posting requires a preview fingerprint / decision token. If asset history changes after preview, the post attempt is stale and must be rejected until the user previews again.
7. V1 is owner-only. Location / physical placement changes are not included in retro correction and must be handled separately through physical move.
8. Persisted owner-allocation detail is required for every impacted posted depreciation period. The workflow must not guess historical owner attribution from the asset's current owner.
9. Prior-fiscal-year backdating remains blocked in V1.
10. The impacted-period stop boundary rule remains shared across preview, posting, future depreciation attribution, and corrected reporting surfaces.
11. Supporting owner-move transaction type is `RETRO_OWNERSHIP_CORRECTION` with `source_ref_type` differentiation, not `OWNERSHIP_TRANSFER`.
12. The supporting owner move does not create a `fixed_asset_ownership_transfer_details` row.
13. Lifecycle-history reader uses a correction-aware wrapper consumed by **all** owner-timeline consumers (depreciation, reversal, disposal, preview), not inline LEFT JOIN modification.
14. Gross cost for the owner-move journal uses the asset master's current `original_cost_txn`.
15. `CATCH_UP` depreciation periods are in scope for impacted-period discovery.
16. Asset master `owner_operating_unit_id` is always updated to the correction's target OU (later owner-changing events block the correction entirely per decision #30).
17. Preview fingerprint is a self-contained SHA-256 content hash, no server-side session.
18. Correction query must load `depr_expense_account_id` in addition to existing account fields.
19. Suspended-asset periods within the correction window respect existing suspension segments.
20. ROT04 is a behavioral change that blocks previously-allowed backdated transfers.
21. Overlap replacement reversal mechanics are an explicit sub-step within ROT03B.
22. Smoke test naming follows existing `test-fa##-*` convention.
23. All correction amounts tracked in dual-currency (`_txn`/`_base`) independently.
24. NBV values and insertion order: true-up transaction first (lower id), owner-move second (higher id).
25. `effective_date` on both correction transaction rows is `correctionPostingDate`, not `actualEffectiveDate`.
26. Journal A2 self-balancing is keyed off corrected source-OU carrying value after A1.
27. Journal source links (`upsertJournalSourceLinkTx`) required for both journals.
28. Draft depreciation run conflict check before posting.
29. Disposed assets blocked from retro ownership transfer correction in V1.
30. Later owner-changing event after `actualEffectiveDate` blocks the entire retro correction in V1.
31. Existing owner-based reports are not correction-aware; must be explicitly addressed across ROT05A and ROT05B.
32. Reversal of a posted retro correction is out of scope for V1.
33. Preview must validate self-balancing account configuration before returning eligible.
34. Period breakdown table stores aggregated run-level amounts, not raw day-level segments.
35. `reportDepreciationByOwnerOu` current-owner fallback must be blocked in corrected reporting mode; missing allocations must surface as `UNRESOLVED`, never as current-owner fallback.
36. Mixed owner+location plain transfer requests must be rejected outright when chronology is unsafe; user must re-submit owner and location changes separately.
37. Retro-correction reversal is an internal replacement-only engine path, not exposed through the generic user-triggered reversal workflow in V1.
38. Transaction feed display must use `source_ref_type` to produce distinct human-readable labels; asset detail shows one grouped correction record with two child transactions.
39. Asset detail must show retro-corrected historical owner timeline alongside current owner (always updated in V1 per decision #30/#16).
40. Transfer report (`reportTransfers`) remains plain-transfer-only in V1; retro corrections appear only in correction history and corrected owner reports.
41. Fiscal year boundary determination uses `resolveFiscalPeriodForDate` and compares `fiscal_year` values from the `fiscal_periods` table.
42. `RETRO_OWNERSHIP_CORRECTION` transactions are "sealing" events — they block generic reversal of earlier transactions on the same asset (V1 intended behavior).
43. Synthetic timeline events injected by the correction-aware wrapper must carry `fromOwnerOperatingUnitId`, `toOwnerOperatingUnitId`, and `transactionId`.
44. Source OU (`from_owner_operating_unit_id`) is derived from the lifecycle timeline at `actualEffectiveDate`, not from the asset master.
45. `reportRollforward` remains an entity-level economic movement report in V1; `RETRO_OWNERSHIP_CORRECTION` rows are excluded and must not affect opening or closing NBV.
46. Any fixed-asset transaction read surface that can return `RETRO_OWNERSHIP_CORRECTION` rows must expose `sourceRefType` plus correction-linkage identity (`retroCorrectionId` or explicitly-defined equivalent); convenience `displayLabel` is optional and not a substitute for linkage identity.
47. `reportByOwnerOu` remains a current-owner snapshot report in V1; it groups by the asset master's current owner after correction and does not attempt corrected historical owner attribution.
48. HTTP semantics are locked: `400` for malformed input, `409` for chronology reroute / blocked business-state responses / stale preview conflicts; all `409` responses must include stable machine-readable `reasonCode`, and reroute-capable responses must include the structured `reroute` object.
49. `reportDepreciationByOwnerOu` supports only `AS_POSTED` and `INCLUDE_RETRO_CORRECTIONS` in V1; `OPERATIONALLY_CORRECTED` remains reserved and requesting it must return `400` with stable `reasonCode = UNSUPPORTED_REPORT_BASIS`.
50. In corrected `reportDepreciationByOwnerOu`, unresolved attribution must surface as an explicit `UNRESOLVED` row/bucket in API rows and export output; report metadata should also expose unresolved totals/flags.
51. `reportBasis` is the only backend/API/query-param name for report basis selection in Track 43; unsupported basis combinations must be rejected with `400` and stable reason codes, and must not be silently ignored.
52. If impacted posted owner-allocation detail contains an OU outside the derived source/target pair, preview/post must block with stable `reasonCode = UNSUPPORTED_OWNER_ALLOCATION_OPERATING_UNIT`; V1 does not guess or collapse more complex owner-attribution histories.

### Ordering guidance for combined catch-up + transfer scenarios

When a user has BOTH a missing transfer AND unrun depreciation, the system naturally steers the correct order:

- **If no depreciation is posted at or after `effectiveDate`:** ROT04 does NOT block. The plain transfer posts. Subsequent depreciation runs (including catch-up) will correctly split by OU using the lifecycle timeline. No retro correction needed.
- **If depreciation IS already posted at or after `effectiveDate` (whether `RUN` or `CATCH_UP`):** ROT04 blocks the plain transfer and reroutes to retro correction. The correction engine treats `CATCH_UP` periods identically to `RUN` periods (locked decision #15).

This means the system cannot reach an incorrect state regardless of user ordering:

| Scenario | User Action Order | System Response |
|----------|------------------|-----------------|
| No depreciation posted yet, transfer missing | Register transfer → run depreciation | Plain transfer allowed, catch-up correctly splits |
| Depreciation posted with wrong OU, transfer missing | Try transfer → blocked, reroute to retro correction | Retro correction fixes posted periods |
| Depreciation posted, transfer posted on time | Run depreciation | Already correct, no correction needed |
| Suspension + transfer + catch-up | Any order | Suspension segments respected in both depreciation engine and correction engine (locked decision #19) |

The frontend (ROT06) does not need a special "combined catch-up + transfer" wizard. The existing depreciation run and retro correction workflows are sufficient when used in sequence.

### Decisions locked after repo analysis

11. **Supporting owner-move transaction type is `RETRO_OWNERSHIP_CORRECTION`, not `OWNERSHIP_TRANSFER`.**
    - The current-period carrying-value owner move posted as part of the correction set must use `transaction_type = 'RETRO_OWNERSHIP_CORRECTION'` with a distinguishing `source_ref_type` (e.g., `RETRO_CORRECTION_OWNER_MOVE`) so it can be differentiated from the true-up transaction which also uses `RETRO_OWNERSHIP_CORRECTION`.
    - Do not use `OWNERSHIP_TRANSFER` for the supporting owner move because any code path that reads `OWNERSHIP_TRANSFER` transactions (including `loadAssetDepreciationLifecycleHistory`) would misinterpret it as a plain chronology transfer event.
    - Do not add a separate enum value for this in V1; distinguish via `source_ref_type`.

12. **The supporting owner move must NOT create a `fixed_asset_ownership_transfer_details` row.**
    - The existing `fixed_asset_ownership_transfer_details` table is LEFT JOINed by `loadAssetDepreciationLifecycleHistory`. If a row existed there for the correction's owner move, the lifecycle reader would treat it as a plain chronology ownership-transfer event, violating decision #10.
    - The retro-correction header/detail tables are the sole audit source for the correction's owner provenance.

13. **Lifecycle-history reader design: introduce a correction-aware wrapper (not inline LEFT JOIN).**
    - `loadAssetDepreciationLifecycleHistory(...)` queries `fixed_asset_transactions` LEFT JOIN `fixed_asset_ownership_transfer_details`. The new `RETRO_OWNERSHIP_CORRECTION` transaction type passes the `<> 'REVERSAL'` filter but its owner data lives in `fixed_asset_retro_transfer_corrections`, not `fixed_asset_ownership_transfer_details`, so the LEFT JOIN returns NULLs for owner columns.
    - Introduce a correction-aware wrapper function (e.g., `loadCorrectionAwareOwnerTimeline(...)`) that:
      1. Calls the existing `loadAssetDepreciationLifecycleHistory(...)` unchanged
      2. Queries `fixed_asset_retro_transfer_corrections` for POSTED corrections on the asset
      3. Merges the correction's `actual_effective_date` as a synthetic ownership-transfer event into the timeline at the correct chronological position
      4. Filters out the correction's own `RETRO_OWNERSHIP_CORRECTION` transaction entries from the base timeline (so they don't appear as lifecycle events with NULL owner data)
    - **All owner-timeline consumers** must use the correction-aware wrapper, not the raw `loadAssetDepreciationLifecycleHistory` directly. This includes the preview engine, normal depreciation schedule building, future depreciation runs, retro-improvement catch-up recalculation, reversal state-restoration logic (which reads lifecycle history to determine the owner to restore), and any disposal/sale preview or cutoff logic that reasons over owner chronology. Leaving any consumer on the raw reader after a retro correction would create internal inconsistency.

14. **Gross cost for the owner-move journal uses the asset master's current `original_cost_txn`.**
    - After Track 39 improvements, the `fixed_assets.original_cost_txn` field is updated in place to reflect the cumulative gross cost (original + all posted improvements). This is the correct source for the owner-move journal's gross cost lines.
    - Do not reconstruct gross cost by summing `ACQUISITION` + `IMPROVEMENT` transactions; use the asset master field directly.

15. **`CATCH_UP` depreciation periods are in scope for impacted-period discovery.**
    - The correction engine must treat both `depreciation_kind = 'RUN'` and `depreciation_kind = 'CATCH_UP'` equally when scanning for impacted posted periods.
    - If a late-activated asset had catch-up depreciation posted for a period that falls within the retro correction window, that period's owner-allocation detail must be included in the impacted-period scan and delta calculation.

16. **Asset master `owner_operating_unit_id` is always updated to the correction's target OU.**
    - Since decision #30 blocks the entire retro correction when any later posted owner-changing event exists after `actualEffectiveDate`, the correction flow can always safely update `fixed_assets.owner_operating_unit_id` to the correction's target OU.
    - There is no conditional update logic needed in V1 — if the correction posts, the asset master owner is updated.

17. **Preview fingerprint content and mechanics.**
    - The `previewFingerprint` must be a deterministic hash (SHA-256) of:
      - asset id
      - the id of the asset's latest posted `fixed_asset_transactions` row
      - the id of the latest posted `fixed_asset_depreciation_runs` row that includes this asset
      - the id of the latest posted `fixed_asset_retro_transfer_corrections` row for this asset (if any)
      - the correction input parameters: `actualEffectiveDate`, `correctionPostingDate`, `targetOwnerOperatingUnitId`
    - The fingerprint is a self-contained content hash returned to the client; no server-side session storage is required.
    - The post endpoint recomputes the fingerprint from current state and rejects if it differs from the supplied value.

18. **Correction query must load `depr_expense_account_id` in addition to existing account fields.**
    - The current `ownershipTransferAsset` query loads `asset_account_id` and `accum_depr_account_id` from the asset master. The correction flow additionally needs `depr_expense_account_id` for the true-up journal. The correction's initial asset query must SELECT this column (with category fallback if the asset-level field is null).

19. **Suspended-asset periods within the correction window.**
    - If an impacted posted period includes a suspension event, the correction engine must respect the existing suspension segments in its day-split calculation. The eligible-day split for owner attribution only covers days the asset was active, consistent with how the depreciation engine already handles suspension in `buildPeriodEligibility`.
    - If the asset is currently suspended at `correctionPostingDate`, the correction is still allowed because the correction does not generate new depreciation; it only reclasses already-posted amounts and moves carrying values.

20. **ROT04 is a behavioral change that blocks previously-allowed backdated transfers.**
    - The current `ownershipTransferAsset()` has zero chronology validation — a user can today post a backdated ownership transfer regardless of posted depreciation. ROT04 introduces net-new blocking logic.
    - The blocking response must include a `reroute` object with enough context for the frontend to pivot into the retro-correction wizard without a dead end.
    - HTTP contract lock for ROT04:
      - malformed input / validator failures return `400`
      - chronology reroute and blocked business-state responses return `409`
      - reroute-capable `409` responses include stable `reasonCode` plus the structured `reroute` object
    - No migration-time feature toggle is required; the blocking behavior activates when the ROT04 code is deployed.

21. **Overlap replacement reversal mechanics are an explicit sub-step within ROT03B.**
    - When a replacement correction supersedes a prior correction, the system must:
      1. Create reversal transactions for the prior correction's true-up journal and owner-move journal using the existing `REVERSAL` transaction type and `reversed_transaction_id` / `reversal_transaction_id` linkage
      2. Mark the prior correction header as `SUPERSEDED` and set `replaced_by_correction_id`
      3. Compute the new correction's delta from scratch (not as a net against the reversed correction) to ensure determinism
      4. Post the new correction's journals as fresh entries
    - All reversal and re-posting happens within a single database transaction.

22. **Smoke test naming follows existing `test-fa##-*` convention.**
    - Existing FA smoke scripts go up to `test-fa47-*`. `test-fa48-retro-correction-focused-smoke.js` is the reusable focused Track 43 verification script. Any broader Track 43 smoke coverage added afterward should continue from the next available FA numbers (for example `test-fa49-*`, `test-fa50-*`, etc.).
    - Do not use the `ROT##` step codes as smoke script file names.

23. **All correction amounts must be tracked in both transaction currency (`_txn`) and base currency (`_base`).**
    - The repo tracks every monetary field as dual-currency: `grossAmountTxn`/`grossAmountBase`, `accumDeprAmountTxn`/`accumDeprAmountBase`, `nbvAmountTxn`/`nbvAmountBase` on `fixed_asset_transactions`; `allocated_amount_txn`/`allocated_amount_base` on depreciation allocations; `buildCariDirectionalJournalLine` requires both `amountTxn` and `amountBase`.
    - The correction delta calculation must compute both `_txn` and `_base` amounts independently for every impacted period.
    - The per-period breakdown table (`fixed_asset_retro_transfer_correction_periods`) must store dual-currency columns: `originally_posted_source_amount_txn`/`_base`, `corrected_source_amount_txn`/`_base`, `delta_amount_txn`/`_base`.
    - Journal A1 and Journal A2 lines must each carry both `amountTxn` and `amountBase`.
    - The preview response must include dual-currency deltas per period and cumulatively.

24. **NBV values and insertion order for the two correction transaction rows.**
    - `resolveCurrentAssetNbv` reads the last posted non-reversed transaction by `effective_date DESC, id DESC LIMIT 1`. The two correction transactions (true-up and owner-move) must be inserted in the correct order so the final NBV snapshot is correct:
      1. Insert the true-up transaction first. Its `nbvAmountTxn`/`nbvAmountBase` should equal the asset's NBV before the correction (unchanged by the true-up, which only reclasses P&L and accum depr between OUs without changing total NBV).
      2. Insert the owner-move transaction second. Its `nbvAmountTxn`/`nbvAmountBase` should equal the asset's NBV after the owner move (which also does not change total NBV, only moves it between OUs).
    - Since both transactions have the same `effective_date` (`correctionPostingDate`), the auto-increment `id` ordering determines which one `resolveCurrentAssetNbv` returns. The owner-move transaction must have the higher `id`.
    - Both transactions must populate all six amount fields (`grossAmountTxn`/`Base`, `accumDeprAmountTxn`/`Base`, `nbvAmountTxn`/`Base`) on `fixed_asset_transactions`.

25. **`effective_date` on both correction transaction rows must be `correctionPostingDate`, not `actualEffectiveDate`.**
    - The `actualEffectiveDate` is the historical business date stored only on the correction header for audit and lifecycle-timeline purposes.
    - The `fixed_asset_transactions.effective_date` for both the true-up and owner-move rows must be `correctionPostingDate` because:
      - they are current-period postings, not historical postings
      - `resolveCurrentAssetNbv` sorts by `effective_date DESC`, so using a historical date would cause NBV resolution to skip over later transactions
      - the depreciation engine's `buildLifecycleTimeline` uses `effective_date` to order events chronologically

26. **Journal A2 self-balancing is keyed off corrected source-OU carrying value after A1.**
    - Do **not** decide due-from/due-to from entity-level current NBV alone.
    - Compute the corrected source-OU carrying value after A1 as the gross cost moved in Journal A2 minus the corrected source-OU accumulated depreciation moved in Journal A2.
    - If the corrected source-OU carrying value is positive, include the due-from / due-to self-balancing lines for that amount.
    - If the corrected source-OU carrying value is exactly zero, omit the due-from / due-to lines.
    - If the corrected source-OU carrying value would be negative, block the correction in V1 with a stable reason code because the owner-move template is not defined for negative source carrying value.

27. **Journal source links (`upsertJournalSourceLinkTx`) are required for both journals.**
    - The repo requires `upsertJournalSourceLinkTx` after every journal post to link the journal entry back to its source transaction for drillback and reconciliation.
    - The correction flow must call `upsertJournalSourceLinkTx` twice:
      1. After posting Journal A1 (true-up): link the true-up journal entry to the true-up `fixed_asset_transactions` row
      2. After posting Journal A2 (owner-move): link the owner-move journal entry to the owner-move `fixed_asset_transactions` row
    - Missing source links would break the GL drillback path for correction journals.

28. **Draft depreciation run conflict check before posting.**
    - The repo tracks depreciation runs with `status = 'DRAFT'` during computation before finalizing to `POSTED`. If a draft run exists that includes the correction's asset and overlaps with the correction window, the correction could produce inconsistent results.
    - The correction post endpoint must check for in-flight draft depreciation runs covering the asset before posting. If a draft run exists, block the correction with a clear error code (e.g., `DRAFT_DEPRECIATION_RUN_IN_PROGRESS`) and require the user to finalize or discard the draft run first.
    - The preview endpoint should also surface this as a warning or blocker in the decision payload.

29. **Disposed assets are blocked from retro ownership transfer correction in V1.**
    - `OWNERSHIP_TRANSFER_ELIGIBLE_STATUSES` in the repo is `[ACTIVE, SUSPENDED, FULLY_DEPRECIATED]` — `DISPOSED` is excluded.
    - The retro correction workflow must apply the same eligibility rule: if the asset's current status is `DISPOSED`, block the correction with a clear reason code.
    - Rationale: a disposed asset has terminal lifecycle events (write-off, sale) that would conflict with the owner-move journal. Allowing correction on disposed assets requires careful handling of disposal accounting that is out of scope for V1.
    - If the asset was disposed after `actualEffectiveDate` but before `correctionPostingDate`, the impacted-period stop boundary (decision #8) already stops at the terminal disposal boundary, but the owner-move journal still cannot fire on a disposed asset. Block the entire workflow.

30. **Later owner-changing event after `actualEffectiveDate` blocks the entire retro correction in V1.**
    - If any posted owner-changing lifecycle event (OWNERSHIP_TRANSFER or another posted retro correction) exists with `effective_date > actualEffectiveDate`, the retro correction workflow must return `BLOCKED` with reason `LATER_OWNER_CHANGING_EVENT_EXISTS`.
    - Rationale: in the typical "A→B was missed, then A→C was posted" scenario, the later transfer was posted as A→C (because B was never on the books). If a retro A→B correction posts Journal A1 (true-up reclassing accum depr from A to B) and/or Journal A2 (owner-move from A to B), it creates phantom OU-level balances on A and B that don't match the actual books — A's accum depr may already be zero (transferred to C), so debiting it creates an accounting-nonsense debit balance on a normally-credit account.
    - Even the true-up (Journal A1) alone is unsafe in this scenario: the depreciation accum depr balances for A were already transferred to C by the later A→C posting. Reclassing between A and B produces balances that have no real-world book backing.
    - V1 does not support chained multi-transfer correction. If the user needs to correct a missed A→B when a later A→C already exists, V1 requires:
      1. Reverse the A→C transfer first (existing reversal flow)
      2. Post the A→B transfer (now chronologically safe, ROT04 allows it)
      3. Post the B→C transfer
      4. Re-run depreciation if needed
    - A future track may add a chained correction design that reasons over the full transfer chain, but that requires careful multi-OU balance-sheet reconciliation that is out of scope for V1.
    - ROT07 must include a smoke test verifying that this scenario is correctly blocked with a clear reason code.

31. **Existing owner-based reports are not correction-aware and must be explicitly addressed across ROT05A and ROT05B.**
    - `reportTransfers` reads `fixed_asset_ownership_transfer_details` — retro corrections do not write there (decision #12), so corrections are invisible.
    - `reportByOwnerOu` groups by `fixed_assets.owner_operating_unit_id` on the asset master — this only reflects the current owner, not corrected historical attribution.
    - `reportDepreciationByOwnerOu` reads the depreciation allocation table with fallback to the current owner — it does not include correction true-up reclassifications.
    - ROT05A must address the backend report semantics, and ROT05B must surface the chosen reporting basis clearly in the UI.

40. **Transfer report (`reportTransfers`) remains plain-transfer-only in V1; retro corrections appear only in correction history and corrected owner reports.**
    - `reportTransfers` reads `fixed_asset_ownership_transfer_details` joined through `fixed_asset_transactions`. Retro corrections do not write to `fixed_asset_ownership_transfer_details` (decision #12), so they are already invisible to this report.
    - Hard lock for V1: this is intentional, not a gap to fix. The transfer report shows "what actually posted chronologically as plain ownership transfers." Retro corrections are a different accounting concept (correction of historical attribution) and must not be injected into the transfer report.
    - Retro corrections are surfaced through:
      - the correction history section on asset detail (decision #38, #39)
      - the corrected owner-based depreciation report modes (`INCLUDE_RETRO_CORRECTIONS`, `OPERATIONALLY_CORRECTED`) on `reportDepreciationByOwnerOu`
      - a future dedicated "Retro Corrections Report" if product requires a consolidated view across assets
    - A future track (Option B) may add an explicit combined owner-movement report mode that includes both plain transfers and retro owner moves, but never by pretending retro corrections are plain `OWNERSHIP_TRANSFER` rows. That report would union `fixed_asset_ownership_transfer_details` with `fixed_asset_retro_transfer_corrections` and label each row's source clearly.

39. **Asset detail must show the retro-corrected historical owner timeline alongside current owner.**
    - Since decision #30 blocks corrections when later owner-changing events exist, the correction always updates the asset master owner (decision #16). The `currentOwnerChanged` flag is always `true` in V1.
    - Hard lock on asset detail UI (`ROT05A`/`ROT05B`/`ROT06`):
      - the asset header section shows the current owner from `fixed_assets.owner_operating_unit_id` — updated by the correction
      - the correction history section must show the retro-corrected historical owner timeline as a distinct view: which OU owned the asset during which date ranges, as derived from the correction-aware lifecycle reader
      - this is important for audit: the user can see that the asset was historically owned by OU-A until `actualEffectiveDate`, then by OU-B from that date onward, even though the correction was posted on `correctionPostingDate`
    - The backend correction response (both preview and post) must return `currentOwnerChanged: true` so the frontend can display confirmation that the asset master owner was updated.

38. **Transaction feed display must use `source_ref_type` to produce distinct human-readable labels; asset detail shows one grouped correction record with two child transactions.**
    - The frontend currently renders `tx.transactionType` raw in the transaction feed (e.g., `FixedAssetDetailPage.jsx` line ~2883, `FixedAssetDisposalsPage.jsx` line ~334, `FixedAssetReportsPage.jsx` line ~76). Two rows both displaying "RETRO_OWNERSHIP_CORRECTION" with no differentiation would be confusing.
    - Hard lock on transaction-read contract — any fixed-asset transaction read surface that can return `RETRO_OWNERSHIP_CORRECTION` rows must expose:
      - `sourceRefType`
      - `retroCorrectionId` or an explicitly-defined correction-header linkage field
      - optional convenience `displayLabel`
    - Hard lock on display labels — the backend may return a computed `displayLabel`, but the frontend shared formatter must still have access to raw `transactionType + sourceRefType` so the feed shows distinct labels:
      - `RETRO_CORRECTION_TRUE_UP` → display as "Retro Ownership Correction – True-up"
      - `RETRO_CORRECTION_OWNER_MOVE` → display as "Retro Ownership Correction – Owner Move"
    - Hard lock on asset detail layout — the correction history section (`ROT05B`) must show:
      - one grouped parent correction record per posted correction (header-level: `actualEffectiveDate`, `correctionPostingDate`, source/target OUs, status, replacement linkage)
      - two child transaction rows nested under the parent (true-up and owner-move), each with its own journal link, amounts, and distinct label
      - this is NOT two flat transactions in the feed with no visual grouping
    - The flat transaction feed (scrollable transaction list) may show both rows individually with their distinct labels, but must include a visual indicator (e.g., a correction-id badge or grouping border) that they belong to the same correction set.
    - The frontend `NON_RUN_REVERSIBLE_TRANSACTION_TYPES` whitelist (`FixedAssetDetailPage.jsx` line ~220) must NOT include `RETRO_OWNERSHIP_CORRECTION` — the "Reverse" button must not appear for these transactions (consistent with backend decision #37).
    - The display-label mapping must be applied everywhere `transactionType` is rendered raw, not just `FixedAssetDetailPage.jsx`. The repo also renders raw `transactionType` in:
      - `FixedAssetDisposalsPage.jsx` (line ~334 and ~269)
      - `FixedAssetReportsPage.jsx` (line ~76, ~88, ~132)
    - Preferred approach: introduce a shared `formatFixedAssetTransactionDisplayLabel(transactionType, sourceRefType)` utility that all three pages consume, rather than duplicating the mapping logic. This utility returns the distinct label when `transactionType === 'RETRO_OWNERSHIP_CORRECTION'` and falls back to the raw type otherwise.

37. **Retro-correction reversal is an internal replacement-only engine path, not exposed through generic user-triggered reversal in V1.**
    - The repo's existing generic reversal flow uses a whitelist (`NON_RUN_REVERSIBLE_TRANSACTION_TYPES` at line ~2594 in `fixed-assets.service.js`) containing `ACQUISITION`, `CAPITALIZATION`, `DEPRECIATION`, `IMPROVEMENT`, `OWNERSHIP_TRANSFER`, `SALE`. `RETRO_OWNERSHIP_CORRECTION` is not in this set, so the generic reversal endpoint already rejects it — but this is accidental, not intentional.
    - Hard lock for V1:
      - do NOT add `RETRO_OWNERSHIP_CORRECTION` to `NON_RUN_REVERSIBLE_TRANSACTION_TYPES`
      - the generic user-triggered reversal workflow must explicitly reject `RETRO_OWNERSHIP_CORRECTION` transactions with a clear reason code (e.g., `RETRO_CORRECTION_NOT_INDIVIDUALLY_REVERSIBLE`)
      - reversal of retro-correction transactions is only permitted through the internal overlap-replacement engine path in ROT03B (decision #21), which reverses both the true-up and owner-move journals as a pair within a single database transaction
    - Rationale: the generic reversal flow includes `assertNoLaterFixedAssetLifecycleEventTx` checks and asset-master restore logic that are not designed for the retro-correction lifecycle shape. Exposing retro-correction reversal through the generic path without proper restore-state semantics (which OU to restore to? which correction-aware timeline state to revert?) would produce inconsistent asset state.
    - A future track may add standalone user-triggered retro-correction reversal with proper permissions, UI confirmation, correction-aware restore logic, and lifecycle-timeline cleanup. Until then, the only supported undo path is overlap replacement (decision #5 / #21) or manual journal entry with support intervention (decision #32).

36. **Mixed owner+location plain transfer requests must be rejected outright when chronology is unsafe.**
    - The current plain ownership transfer endpoint (`parseOwnershipTransferInput` in `fixed-assets.validators.js` lines 614-663) accepts both `targetOwnerOperatingUnitId` and an optional `targetLocationOperatingUnitId` in a single request. The service (`ownershipTransferAsset`) processes both in one transaction.
    - When ROT04 detects that the transfer is chronology-unsafe and would require retro correction, but the request also includes a location change:
      - **Reject the entire request** with reason code `MIXED_OWNER_LOCATION_REQUIRES_SEPARATE_SUBMISSION`
      - Do NOT silently drop the location part and reroute only the owner change to retro correction (the user would lose the location intent without knowing)
      - Do NOT silently preserve the location change and tell the UI to open physical move afterward (this creates an implicit workflow dependency)
      - The response must clearly tell the user to submit the owner change via retro correction and the location change via physical move as two separate actions
    - When the transfer IS chronologically safe, the existing mixed owner+location behavior remains unchanged — this decision only applies to the unsafe/reroute path.
    - The frontend (ROT06) should detect `mixedRequestRejected: true` in the reroute response and display guidance explaining that the two changes must be submitted separately.
    - Hard lock on preview/post endpoints: the retro correction preview and post endpoints must NOT accept or consume `targetLocationOperatingUnitId`. If present in the request, reject with a validation error. The retro correction contract is owner-only (decision #7); location must never leak into correction input.
    - Hard lock on reroute payload: when `locationChangeMustBeSeparate: true`, the reroute response must echo the originally requested `targetLocationOperatingUnitId` so the UI can preserve it as guidance for a separate physical-move workflow, but never as retro-correction input.
    - Hard lock on UI: ROT06 retro-correction wizard must not include a location field. If the wizard was opened from a rerouted mixed request, it must display a notice that the location change must be submitted separately via physical move after the retro correction is posted.

35. **`reportDepreciationByOwnerOu` current-owner fallback must be blocked in corrected reporting mode.**
    - `reportDepreciationByOwnerOu` (line ~745 in `fixed-assets.reporting.service.js`) has a two-query design: first it reads persisted `OWNER_OU` allocations, then for run lines with no persisted allocations it falls back to `fa.owner_operating_unit_id` (the asset master's current owner). After a retro correction, this fallback silently misattributes depreciation to the wrong OU.
    - For corrected reporting mode (`INCLUDE_RETRO_CORRECTIONS` or `OPERATIONALLY_CORRECTED`):
      - do NOT use the asset master's current owner as fallback
      - Track 43 V1 wires `INCLUDE_RETRO_CORRECTIONS` as the only supported corrected basis for this report
      - if persisted allocation or correction detail is missing for a run line, mark the row or bucket as `UNRESOLVED` in the report output rather than blocking the whole report by default
      - unresolved amounts must not be assigned to any OU total
      - the response should surface report-level incomplete-data metadata such as `hasUnresolvedRows`, `unresolvedAmountTxn`, and `unresolvedAmountBase`
      - export output must preserve the same unresolved-attribution visibility by including an explicit `UNRESOLVED` row/bucket rather than dropping unresolved amounts from CSV
    - The fallback is acceptable in `AS_POSTED` mode (it represents what was originally posted) but must be suppressed or flagged in any correction-aware mode.
    - Pre-Track-43 assets that never had persisted allocations (legacy data before `DAILY_PRORATA` was introduced) are expected to hit this — the corrected report mode must not silently guess their owner attribution.

32. **Reversal of a posted retro correction is out of scope for V1.**
    - V1 supports overlap replacement (decision #5 / #21) but does not support standalone reversal of a posted retro correction.
    - If a user needs to undo a correction without posting a new overlapping one, V1 requires manual journal entry or support intervention.
    - The correction header `status` enum includes only `POSTED` and `SUPERSEDED` in V1 — no `REVERSED` status.
    - A future track may add standalone reversal with proper reverse-journal and lifecycle-timeline cleanup.

33. **Preview must validate self-balancing account configuration before returning `CURRENT_PERIOD_TRUE_UP_REQUIRED`.**
    - `resolveOuSelfBalancingAccountsTx` throws if due-from/due-to accounts are not configured between the source and target OUs.
    - The preview endpoint must call this resolution (or a read-only equivalent) during preview so the user sees a `BLOCKED` result with reason `SELF_BALANCING_ACCOUNTS_NOT_CONFIGURED` before attempting to post, rather than encountering a runtime error at posting time.
    - Exception: if the corrected source-OU carrying value after A1 is exactly zero, self-balancing accounts are not needed (decision #26), so the check can be skipped.

34. **Period breakdown table stores aggregated run-level amounts per period, not raw day-level allocation segments.**
    - The depreciation engine stores per-allocation segments in `fixed_asset_depreciation_run_allocations` with day-level granularity (`from_date`, `to_date`, `eligible_days`, `operating_unit_id`). A single period can have multiple allocation rows (e.g., split by ownership transfer date or suspension).
    - The correction's per-period breakdown table (`fixed_asset_retro_transfer_correction_periods`) stores the **aggregated** amounts per period per OU: total originally posted, total corrected, and net delta. It does not replicate the raw day-level segments.
    - The correction engine must read and sum the raw allocation segments from `fixed_asset_depreciation_run_allocations` to derive the per-period per-OU totals, then store only the aggregated result in the correction period table.
    - This keeps the correction audit table compact while the raw day-level detail remains available in the depreciation allocation table for drill-down.

41. **Fiscal year boundary determination uses `resolveFiscalPeriodForDate` and compares `fiscal_year` values.**
    - Decision #6 blocks prior-fiscal-year backdating but does not specify the mechanism. The repo already has `resolveFiscalPeriodForDate(calendarId, date)` (`fixed-assets.service.js` lines 2347-2365) which queries `fiscal_periods` and returns a `fiscal_year` field.
    - Hard lock on fiscal year comparison:
      1. Resolve the fiscal period for `actualEffectiveDate` using the asset's legal entity book calendar (via `resolveBookForLegalEntity` → `calendarId`)
      2. Resolve the fiscal period for `correctionPostingDate` using the same calendar
      3. Compare the `fiscal_year` values from both periods
      4. If `fiscal_year(actualEffectiveDate) < fiscal_year(correctionPostingDate)`, return `BLOCKED` with reason `PRIOR_FISCAL_YEAR`
    - Do not use calendar-year logic or hardcoded fiscal-year-start-month. Use the fiscal period table, which already handles non-calendar fiscal years (e.g., April-March fiscal year).
    - Both the preview and post endpoints must perform this check.

42. **`RETRO_OWNERSHIP_CORRECTION` transactions are "sealing" events for earlier reversals (V1 intended behavior).**
    - `assertNoLaterFixedAssetLifecycleEventTx` (`fixed-assets.service.js` lines 3293-3328) checks for ANY later non-DRAFT/non-CANCELLED transaction on the asset, regardless of `transaction_type`. It does not filter by type.
    - After a retro correction posts two `RETRO_OWNERSHIP_CORRECTION` transactions with `effective_date = correctionPostingDate`, every earlier transaction on the same asset becomes non-reversible through the generic reversal flow (because the check finds a later transaction).
    - Hard lock for V1: this is accepted as intended behavior. The retro correction is a "sealing" event — if someone needs to reverse an earlier transaction (e.g., an IMPROVEMENT posted before the correction), they must first remove the correction through the overlap-replacement path (decision #21) or manual intervention.
    - Do not modify `assertNoLaterFixedAssetLifecycleEventTx` to exclude `RETRO_OWNERSHIP_CORRECTION` in V1. Adding type-specific exceptions would create subtle reversal ordering bugs.
    - A future track may add type-aware later-event checks if the product requires finer-grained reversal after corrections.

43. **Synthetic timeline events injected by the correction-aware wrapper must carry `fromOwnerOperatingUnitId`, `toOwnerOperatingUnitId`, and `transactionId`.**
    - `resolveInitialOwnerOperatingUnitId` (`fixed-assets.depreciation.service.js` lines 1180-1208) walks backward through OWNERSHIP_TRANSFER events reading `fromOwnerOperatingUnitId` from each. It **throws** if either field is null (line 1196).
    - The correction-aware wrapper (decision #13) injects synthetic ownership-transfer events at `actualEffectiveDate`. Each synthetic event must carry:
      - `transactionId`: the correction header id (or the true-up transaction id) — required for the throw message if validation fails
      - `fromOwnerOperatingUnitId`: the correction's `from_owner_operating_unit_id`
      - `toOwnerOperatingUnitId`: the correction's `to_owner_operating_unit_id`
      - `effectiveDate`: the correction's `actual_effective_date`
      - `kind`: `"OWNERSHIP_TRANSFER"` (so the depreciation engine processes it identically to a real transfer)
    - Missing any of these fields will cause `resolveInitialOwnerOperatingUnitId` to throw or `buildLifecycleTimeline` to skip the event.

44. **Source OU (`from_owner_operating_unit_id`) is derived from the lifecycle timeline at `actualEffectiveDate`, not from the asset master.**
    - The correction header stores `from_owner_operating_unit_id`. During preview, this must be derived by running the correction-aware lifecycle reader (without this correction) and resolving which OU owned the asset at `actualEffectiveDate`.
    - Derivation method: call the correction-aware lifecycle reader for the asset's already-posted history (the candidate correction itself is not yet persisted, so it is naturally absent), build the lifecycle timeline via `buildLifecycleTimeline`, apply events up to `actualEffectiveDate` via `applyLifecycleEventToState`, and read `state.ownerOperatingUnitId`. This is the source OU.
    - Do NOT use `fixed_assets.owner_operating_unit_id` from the asset master — this reflects the current owner, not the owner at `actualEffectiveDate`.
    - The derived source OU must equal the asset master's current owner in V1 (because decision #30 blocks the correction when later owner-changing events exist). If they differ, it indicates an inconsistency that should be surfaced as a validation error.
    - The preview must return the derived source OU so the user can confirm it before posting.

45. **`reportRollforward` remains an entity-level economic movement report in V1.**
    - The current report groups posted transaction rows broadly by `transaction_type`, so a new `RETRO_OWNERSHIP_CORRECTION` type would otherwise start appearing there automatically.
    - Hard lock for V1: exclude `RETRO_OWNERSHIP_CORRECTION` rows from rollforward output entirely.
    - `RETRO_OWNERSHIP_CORRECTION` must not affect opening NBV, movement math, or closing NBV in `reportRollforward`.
    - Retro corrections remain visible through correction history, transaction feed / drillback, and corrected owner-based reporting surfaces rather than the entity rollforward.

46. **Transaction-feed contract must expose retro-correction linkage metadata.**
    - The flat fixed-asset transaction feed and related drillback read surfaces must expose enough raw metadata to distinguish and group the two correction child rows reliably.
    - Hard lock for V1:
      - return `sourceRefType`
      - return `retroCorrectionId` or an explicitly-defined equivalent correction-header linkage field
      - `displayLabel` is optional convenience, not a substitute for linkage identity
    - The frontend must not infer grouping only from `transactionType`.

47. **`reportByOwnerOu` remains a current-owner snapshot report in V1.**
    - `reportByOwnerOu` groups by `fixed_assets.owner_operating_unit_id` and naturally reflects the asset master's current owner after correction.
    - Hard lock for V1: do not attempt corrected historical owner attribution in this report.
    - The API/UI must label its basis clearly as a current-owner snapshot.
    - Corrected historical owner analysis is provided through correction history, corrected owner timeline on asset detail, and corrected `reportDepreciationByOwnerOu` modes.

48. **HTTP status contract is explicit for preview, reroute, blocker, and stale-preview flows.**
    - Use `400 Bad Request` for malformed input / contract validation failures.
    - Use `409 Conflict` for well-formed requests rejected because of business state or concurrency state, including chronology reroute, period/lifecycle blockers, draft-run blockers, and `STALE_PREVIEW`.
    - Every `409` response must include a stable machine-readable `reasonCode`.
    - Reroute-capable `409` responses must include the structured `reroute` object expected by the frontend pivot flow.

49. **V1 corrected depreciation-by-owner reporting ships only `INCLUDE_RETRO_CORRECTIONS`.**
    - The repo currently has one concrete depreciation-by-owner report path and one CSV export shape; Track 43 should not split that into multiple corrected-history semantics in V1.
    - Hard lock for V1:
      - `reportDepreciationByOwnerOu` supports `AS_POSTED`
      - `reportDepreciationByOwnerOu` supports `INCLUDE_RETRO_CORRECTIONS`
      - `OPERATIONALLY_CORRECTED` stays reserved for a future track
      - requesting `OPERATIONALLY_CORRECTED` in V1 returns `400` with stable `reasonCode = UNSUPPORTED_REPORT_BASIS`

50. **`UNRESOLVED` must be export-visible, not metadata-only.**
    - The repo's report export path writes CSV from `rows`, so unresolved attribution cannot live only in top-level metadata if it must survive export.
    - Hard lock for V1:
      - unresolved attribution appears as an explicit `UNRESOLVED` row/bucket in API `rows`
      - the same `UNRESOLVED` row/bucket is included in CSV export output
      - corrected V1 export must not silently omit unresolved attribution
      - report-level metadata may additionally expose `hasUnresolvedRows`, `unresolvedAmountTxn`, and `unresolvedAmountBase`

51. **`reportBasis` is the only backend/API/query-param name, and it is validated per report.**
    - Once Track 43 introduces basis-aware report filters, the backend must not silently ignore unsupported `reportBasis` values because that would create misleading UI/report behavior.
    - Hard lock for V1:
      - use `reportBasis` consistently in validators, routes, OpenAPI, frontend API helpers, and report requests
      - UI copy may still label the control as `Report Mode`, but that is presentation only and not a second contract name
      - unsupported `reportBasis` combinations return `400` with stable reason codes; `UNSUPPORTED_REPORT_BASIS` is used when the requested basis exists conceptually but is not implemented for V1
      - `reportByOwnerOu` rejects corrected-history basis values and remains current-owner snapshot only
      - unaffected reports such as transfers and rollforward do not silently accept correction-aware basis values

52. **Impacted posted owner allocations must stay within the derived source/target OU pair in V1.**
    - If an impacted posted owner-allocation row contains an operating unit outside the derived `from_owner_operating_unit_id` and requested `targetOwnerOperatingUnitId`, the retro correction workflow must block with `reasonCode = UNSUPPORTED_OWNER_ALLOCATION_OPERATING_UNIT`.
    - V1 does not attempt to collapse, net, or guess more complex posted owner-attribution histories involving a third OU.
    - This is an explicit safety rule, not an incidental implementation detail: Track 43 must block instead of inventing owner attribution when persisted posted allocation history is more complex than the V1 correction model.
