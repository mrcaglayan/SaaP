# 40 - FIXED ASSET RETRO OWNERSHIP TRANSFER CORRECTION

## Status
- Planned
- Follow-up track after Track 38 fixed-assets lifecycle/depreciation MVP

## Purpose
Add a proper SaaS-grade correction workflow for **late-entered ownership transfers** when depreciation for one or more impacted periods has already been posted.

Today, the strict accounting-safe answer in the repo is to unwind posted depreciation, reverse any late-posted transfer, and then repost everything in the right chronology. That is valid as a control model, but it is not a good day-to-day end-user workflow.

This track introduces a dedicated **retro ownership transfer correction** flow so users can record the real historical transfer date, keep already-posted depreciation history immutable where appropriate, and book a current-period correction / true-up instead of forcing broad depreciation-run reversals.

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
- calculate the owner-OU attribution delta
- persist corrected ownership history for future depreciation attribution
- post a **current-period correction / true-up**
- post any required current-period balance-sheet owner move using current carrying values on the correction posting date
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

Future-attribution lock:

- future depreciation attribution must read a correction-aware owner-history source
- the current-period carrying-value owner move must not be the only source of owner-timeline logic
- patch `loadAssetDepreciationLifecycleHistory(...)` or introduce a correction-aware equivalent consumed by both preview and future depreciation generation

## Decision Lock

### 1. Same-fiscal-year backdating is allowed only within chronology-safe correction rules

The product may accept a late-entered/backdated ownership effective date within the same fiscal year, but only when it stays chronologically valid and is corrected through journal reclassification or a bounded unwind path rather than by editing posted history.

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
- the system must block direct backdated transfer posting unless an allowed automated unwind path exists

### 2. Open isolated month vs already-progressed history

If the impacted month is still operationally isolated:

- no later depreciation run exists for that asset
- the month is still open
- reversal scope is bounded and safe

Then the system may offer:

- `auto unwind and repost`

Important repo-shape clarification:

- automated unwind/repost means reversing and reposting the affected depreciation run(s), not re-running only one asset line in isolation

Otherwise, the preferred workflow is:

- `retro ownership transfer correction`

### 3. Posted history remains immutable by default

When later posted depreciation periods already exist:

- do not require the user to manually unwind multiple depreciation runs as the primary UX
- do not silently rewrite prior posted depreciation rows
- post the delta in the current open period

### 4. Future behavior must still be corrected

After the correction is posted:

- future depreciation attribution must follow the corrected owner history
- the real historical effective date remains part of the asset lifecycle/audit story

### 5. Current-period balance-sheet move must use current-period posting

If the correction flow must also align carrying-value ownership on the balance sheet:

- the carrying-value owner move is a current-period posting
- that posting must use `correctionPostingDate`
- it is distinct from the historical fact represented by `actualEffectiveDate`
- it must not become the only owner-history fact consumed by future depreciation attribution

### 6. Prior-fiscal-year backdating is not allowed

If the requested backdated transfer reaches a prior fiscal year:

- block the retro ownership transfer correction workflow in V1

If later design ever introduces a prior-period-adjustment path, it must be a separate explicit accounting-policy track, not an implicit extension of this workflow.

### 7. Current-year correction prefers journal-based reclassification over history rewrite

For same-fiscal-year late transfer correction:

- prefer a journal-based owner-attribution reclassification / true-up
- do not edit posted depreciation history in place
- keep `AUTO_UNWIND_REPOST` optional, bounded, and non-primary

### 8. Impacted-period stop boundary is explicit

The correction engine must stop impacted-period discovery at the earliest applicable boundary:

- the next posted owner-changing lifecycle boundary
- a terminal lifecycle boundary such as write-off or sale
- the point where owner history is already aligned
- the current open-period cutoff

This boundary rule must be shared by preview, posting, and future correction-aware lifecycle reads.

### 9. V1 is owner-only; location remains separate

This track corrects ownership attribution only.

- `targetLocationOperatingUnitId` is out of scope for V1
- retro correction must not silently behave like physical move
- any location correction remains a separate physical-move workflow or future dedicated follow-up track

### 10. V1 adds an explicit retro-correction transaction type

For transaction feed and drillback consistency:

- add `RETRO_OWNERSHIP_CORRECTION` to `fixed_asset_transactions.transaction_type`
- use dedicated correction header/detail tables as the primary retro-correction audit source
- do not treat `RETRO_OWNERSHIP_CORRECTION` as the only owner-history fact; the lifecycle reader must still merge historical correction facts explicitly

## Scenario Rules

### Scenario 1

Case:

- the real transfer date is inside `March 2026`
- `March 2026` depreciation is already posted
- no later affected month has been posted yet

Preferred behavior:

1. User opens retro correction workflow.
2. System identifies one impacted month: `March 2026`.
3. If safe and open, system may offer `auto unwind and repost March`.
4. In the current repo shape, that means reversing and reposting the affected March depreciation run, not re-running only this asset line.
5. If not safe to unwind automatically, system posts a current-period correction instead.
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
5. Prior posted depreciation rows remain as historical fact.
6. Future months follow the corrected owner history.

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

If the current-period correction also needs to align the balance-sheet owner context for the asset itself, the workflow may need:

- a current-period carrying-value owner move posted on `correctionPostingDate`
- plus a retro depreciation-attribution true-up

Lock this during implementation; do not leave it implicit.

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
- whether the flow will:
  - auto unwind/repost
  - or book a current-period true-up

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

### Master Tracker

| Step | Scope | Status |
|---|---|---|
| **Phase 1 - Data model and backend decision surface** | | |
| ROT01 | Migration, correction taxonomy, and persisted audit model | Not started |
| ROT02 | Preview engine and chronology/routing decision response | Not started |
| ROT03 | Posting engine: true-up journal, optional current-period owner move, and bounded unwind orchestration | Not started |
| ROT04 | Plain ownership-transfer endpoint blockers and reroute contract | Not started |
| **Phase 2 - Read surfaces and frontend** | | |
| ROT05 | Asset detail/history exposure and owner-report treatment | Not started |
| ROT06 | Frontend retro correction wizard and preview UX | Not started |
| **Phase 3 - Test and release control** | | |
| ROT07 | Smoke coverage, readiness gates, and rollback verification | Not started |

---

## `STEP-ROT01` - Migration, correction taxonomy, and persisted audit model

### Patch target
- `backend/src/migrations/` - new migration file, expected next slot `m151_fixed_asset_retro_transfer_corrections.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js`

### In scope
1. Introduce a dedicated persisted correction header table, for example `fixed_asset_retro_transfer_corrections`, carrying at minimum:
   - `tenant_id`, `legal_entity_id`, `asset_id`
   - `from_owner_operating_unit_id`, `to_owner_operating_unit_id`
   - `actual_effective_date`
   - `correction_posting_date`
   - `balance_sheet_transfer_posting_date`
   - `resolution_mode` such as `CURRENT_PERIOD_TRUE_UP` or `AUTO_UNWIND_REPOST`
   - `status`
   - `note`
   - `posted_by_user_id`
   - transaction links for any posted correction journal and any posted current-period carrying-value owner move
2. Extend `fixed_asset_transactions.transaction_type` with `RETRO_OWNERSHIP_CORRECTION` for transaction-list and drillback consistency.
3. Introduce a persisted per-period breakdown table, for example `fixed_asset_retro_transfer_correction_periods`, carrying at minimum:
   - correction header id
   - `period_key`
   - related posted depreciation run id when applicable
   - source and target owner OU ids
   - eligible-day split used by the calculation
   - originally posted source/target attribution
   - corrected source/target attribution
   - net delta that fed the posting
4. Add service-layer taxonomy constants and read helpers so the correction is a first-class fixed-assets concept rather than an ad hoc note on normal ownership transfer rows.
5. Lock the historical owner source used by future depreciation:
   - extend `loadAssetDepreciationLifecycleHistory(...)` to merge retro-correction history
   - or introduce a correction-aware equivalent used by both preview and future depreciation generation
   - do not rely only on the current-period carrying-value owner move for future owner allocation
6. Define persisted status/state transitions for the correction record:
   - preview-only is not persisted
   - posted correction persists immutable header/detail rows
   - reversal, if supported later, must preserve the original correction row and add reversal linkage rather than mutate in place
7. Lock the V1 audit/source-of-truth model:
   - dedicated retro-correction header/detail tables are the primary source of retro audit history
   - supporting `fixed_asset_transactions` rows use `RETRO_OWNERSHIP_CORRECTION` for journal lineage/drillback
   - supporting transaction rows must not be the only retro-correction record

### Explicit non-goals
- Do not overload `fixed_asset_ownership_transfer_details` for retro-correction storage
- Do not store this feature only as free-text transaction notes
- Do not finalize the exact report-mode UI in this step

### Definition of done
- Migration is reversible and runs cleanly on current schema
- A posted retro correction has durable header + per-period audit rows
- Service-layer constants and read helpers exist for later API/UI steps

---

## `STEP-ROT02` - Preview engine and chronology/routing decision response

### Patch target
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.depreciation.service.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Add a dedicated preview endpoint:
   - `POST /api/v1/fixed-assets/:assetId/retro-ownership-transfer-correction/preview`
2. Validate a dedicated preview contract with fields such as:
   - `actualEffectiveDate`
   - `correctionPostingDate`
   - `targetOwnerOperatingUnitId`
   - optional `note`
3. Build a deterministic impacted-period discovery engine that:
   - reads ownership transfer history
   - reads posted depreciation runs and run allocations
   - identifies the first impacted posted month from `actualEffectiveDate`
   - stops at the earliest of the next posted owner-changing lifecycle boundary, a terminal disposal boundary, owner-history alignment, or the current open-period cutoff
4. Reuse existing depreciation owner-split logic where possible so day-split behavior stays aligned with `DAILY_PRORATA` and current owner-allocation semantics.
5. Make preview and future depreciation attribution share the same correction-aware lifecycle-history reader so the preview result and the next depreciation run cannot diverge.
6. Return a structured decision payload, not just a number. At minimum include:
   - `resolutionMode`: `NORMAL_TRANSFER_ALLOWED`, `AUTO_UNWIND_REPOST_ELIGIBLE`, `CURRENT_PERIOD_TRUE_UP_REQUIRED`, or `BLOCKED`
   - chronology blockers
   - closed-year blocker if applicable
   - impacted posted periods
   - source/target OU deltas by period
   - cumulative delta
   - whether a current-period carrying-value owner move is also required
7. Return stable machine-readable reason codes so the frontend and plain transfer endpoint can share the same decision surface.

### Explicit non-goals
- No posting in preview endpoint
- No implicit writes to asset history from preview
- No silent fallback from blocked state into plain ownership transfer

### Definition of done
- Preview returns deterministic period-by-period results for scenario 1 and scenario 2
- Blocked/eligible/current-period-correction outcomes are explicit and machine-readable
- Preview logic is isolated enough to be reused by posting and UI

---

## `STEP-ROT03` - Posting engine: true-up journal, optional current-period owner move, and bounded unwind orchestration

### Patch target
- `backend/src/services/fixed-assets.service.js`
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Add a dedicated post endpoint:
   - `POST /api/v1/fixed-assets/:assetId/retro-ownership-transfer-correction`
2. Require the post endpoint to consume a preview-backed payload so the user confirms the same dates, OUs, and resolution mode they previewed.
3. Implement `CURRENT_PERIOD_TRUE_UP` posting:
   - persist correction header/detail rows
   - create a supporting `fixed_asset_transactions` row with `transaction_type = 'RETRO_OWNERSHIP_CORRECTION'`
   - post the retro owner-attribution correction journal
   - if required by locked policy, post a separate current-period carrying-value owner move on `correctionPostingDate`
   - link posted transaction ids back to the correction row
4. Lock the dedicated owner-attribution correction journal template in code, distinct from normal ownership transfer. Expected economic effect:
   - reclass depreciation expense between source and target OUs
   - reclass accumulated depreciation between source and target OUs
   - preserve total-entity depreciation and total NBV
5. Resolve and validate the true-up posting accounts from the asset/category depreciation setup:
   - `depr_expense_account_id`
   - `accum_depr_account_id`
   - fail clearly if the asset/category accounting setup is incomplete
6. Keep the retro-correction audit source explicit:
   - dedicated correction header/detail tables remain the primary retro-correction record
   - supporting `RETRO_OWNERSHIP_CORRECTION` rows and linked GL journals serve lineage/drillback, not the sole historical fact
7. If the design keeps `AUTO_UNWIND_REPOST` in V1, implement it only as a bounded orchestrated path:
   - reverse affected posted depreciation run(s) in reverse chronological order
   - reverse any late-posted ownership transfer if required
   - post the normal ownership transfer in correct chronology
   - repost the affected run(s)
   - persist a correction header showing that the chosen resolution mode was unwind/repost, not current-period true-up
8. Enforce current-period open-period checks for any correction posting and any carrying-value owner move.

### Explicit non-goals
- Do not post a misleading historical carrying-value move dated with `actualEffectiveDate`
- Do not reuse the current `CATCH_UP` depreciation posting path
- Do not allow the correction endpoint to mutate old posted run rows directly

### Definition of done
- Current-period true-up can be previewed and posted end-to-end
- If unwind mode is included in V1, it is fully orchestrated and reverse-chronological
- Posted correction rows link cleanly to their resulting GL/fixed-asset transactions

---

## `STEP-ROT04` - Plain ownership-transfer endpoint blockers and reroute contract

### Patch target
- `backend/src/routes/fixed-assets.validators.js`
- `backend/src/routes/fixed-assets.routes.js`
- `backend/src/services/fixed-assets.service.js`

### In scope
1. Extend plain ownership-transfer validation to call the chronology decision logic before posting.
2. Block plain backdated ownership transfer when:
   - impacted posted depreciation already exists
   - later fixed-assets lifecycle activity makes the transfer historically unsafe
   - the posting period is closed
3. Return structured reroute responses from the plain endpoint, not only generic validation text. Include:
   - stable error/reason code
   - whether retro correction preview is required
   - whether auto unwind is eligible
   - the first impacted period key
4. Keep direct plain ownership transfer working for chronologically safe cases so the new track does not regress normal same-period operational flow.
5. Ensure the detail page can detect this reroute and open the retro-correction path instead of leaving the user at a dead end.

### Explicit non-goals
- Do not remove the existing ownership transfer capability
- Do not make the retro correction endpoint silently callable through the plain endpoint contract

### Definition of done
- Unsafe backdated transfer attempts are blocked with deterministic reason codes
- Safe same-chronology transfers continue to post unchanged
- Backend exposes enough reroute context for the frontend wizard step

---

## `STEP-ROT05` - Asset detail/history exposure and owner-report treatment

### Patch target
- `backend/src/services/fixed-assets.service.js`
- `backend/src/services/fixed-assets.reporting.service.js`
- `frontend/src/pages/fixedAssets/FixedAssetDetailPage.jsx`

### In scope
1. Expose retro-correction history on the asset detail payload:
   - correction id/status
   - `actualEffectiveDate`
   - `correctionPostingDate`
   - source and target owner OUs
   - impacted periods
   - posted correction transaction ids
2. Add an asset-detail audit/history section showing retro corrections separately from normal ownership transfers so users can see the difference.
3. Surface `RETRO_OWNERSHIP_CORRECTION` coherently in the standard asset transaction feed and drillback paths without treating it as a normal ownership-transfer lifecycle event.
4. Update owner-based reporting treatment so correction-aware results do not rely only on the asset master's current owner.
5. Introduce or reserve report modes such as:
   - `AS_POSTED`
   - `INCLUDE_RETRO_CORRECTIONS`
   - `OPERATIONALLY_CORRECTED`
6. Treat corrected owner-based reporting as mandatory for this track, not optional follow-up.
7. For V1, it is acceptable if only one corrected mode is wired to the report service, but the service contract must make the reporting basis explicit.

### Explicit non-goals
- No requirement to retrofit every fixed-assets report in this step
- No silent change of existing report semantics without a visible mode or documented default

### Definition of done
- Asset detail shows retro correction history distinctly from normal ownership transfer
- At least one owner-based reporting path can include persisted retro corrections explicitly
- Reporting semantics are documented in code and API shape

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
3. Show preview output before posting:
   - detected resolution mode
   - impacted posted periods
   - source OU / target OU
   - per-period delta
   - cumulative correction amount
   - whether a current-period carrying-value owner move will also be posted
4. If the plain ownership-transfer endpoint returns a retro-correction reroute reason, guide the user into this wizard with the relevant context prefilled where possible.
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

## `STEP-ROT07` - Smoke coverage, readiness gates, and rollback verification

### Patch target
- `backend/scripts/` - add new FA smoke scripts, expected next slots after `test-fa45-late-activation-catchup-smoke.js`
- existing fixed-assets smoke/readiness scripts as needed
- `backend/openapi.yaml`
- `backend/scripts/generate-openapi.js`

### In scope
1. Add smoke coverage for at least these cases:
   - scenario 1: one posted month impacted, preview result correct, chosen resolution path behaves as designed
   - scenario 2: multiple posted months impacted, current-period true-up posted correctly
   - plain ownership transfer blocked and rerouted when chronology is unsafe
   - closed-year correction blocked or routed according to locked policy
   - owner-based reporting includes persisted correction rows in the chosen corrected mode
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

## Entry Criteria Before Implementation

Lock these before coding:

1. When is auto unwind/repost allowed versus forbidden?
2. What exact journal template is used for the true-up?
3. Does the correction also post a current carrying-value owner move, or only depreciation reallocation?
4. How should owner-OU reports treat corrections by default?
5. What transaction / detail shape is persisted for auditability?
6. Confirm the lifecycle-history reader change that will feed corrected owner history into future depreciation.
7. Confirm the V1 policy that prior-fiscal-year backdating is not allowed.
8. Confirm the V1 impacted-period stop boundary rule and keep it shared across preview/posting/reporting surfaces.

Until those are answered, this track is ready for planning and serialization, not one-go implementation.
