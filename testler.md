# FA Improvement Regression Notes

## Automated Smoke

Scripts:
- `backend/scripts/test-fa46-retro-multi-improvement-smoke.js`
- `backend/scripts/test-fa47-lifecycle-blocker-and-disposal-preview-smoke.js`
- `backend/scripts/test-fa46-fa47-improvement-release-gate.js`

Run:

```powershell
node backend/scripts/test-fa46-retro-multi-improvement-smoke.js
node backend/scripts/test-fa47-lifecycle-blocker-and-disposal-preview-smoke.js
```

Run them sequentially, not in parallel. Both scripts create/post CARI drafts in the shared smoke tenant, and parallel execution can deadlock on the shared draft-sequence tables.

Combined runner:

```powershell
node backend/scripts/test-fa46-fa47-improvement-release-gate.js
```

The combined runner forces cleanup mode for FA46/FA47 automatically so repeated executions do not keep filling the shared smoke tenant with retained artifacts.

Or from `backend/`:

```powershell
npm run test:fa46-fa47:improvement-gate
```

Optional cleanup mode:

```powershell
$env:FA46_SMOKE_KEEP_ARTIFACTS='0'
node backend/scripts/test-fa46-retro-multi-improvement-smoke.js
Remove-Item Env:FA46_SMOKE_KEEP_ARTIFACTS

$env:FA47_SMOKE_KEEP_ARTIFACTS='0'
node backend/scripts/test-fa47-lifecycle-blocker-and-disposal-preview-smoke.js
Remove-Item Env:FA47_SMOKE_KEEP_ARTIFACTS
```

What `FA46` covers:
- Retro same-month multi-improvement catch-up does not double-count
- Later-dated same-month improvement can be posted first, then earlier-dated same-month improvement can be inserted and resequenced
- Reordered retro path matches a chronological control asset
- Same-day multiple cost-only improvements remain allowed
- Second same-day life-changing improvement is rejected with `FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT`

What `FA47` covers:
- Later `PHYSICAL_MOVE` no longer blocks a backdated earlier improvement
- Replayed physical-move path matches a chronological control asset for schedule values
- Later financial lifecycle activity still blocks backdated improvement insertion
- Blocker details identify the exact later transaction (`OWNERSHIP_TRANSFER` in the smoke)
- Disposed assets with already-posted same-period depreciation return `SKIPPED` in run preview
- Disposal-period preview does not come back as `ERROR`
- Improvement can be posted while the asset is `SUSPENDED`
- Depreciation stays paused during suspension and resumes from `reactivationDate`

Expected result:
- Console prints `STEP-FA46 smoke passed.`
- Console prints `STEP-FA47 smoke passed.`
- Combined runner prints `FA46-FA47 improvement regression gate passed.`

## Manual UI Test Guide

### Preconditions

- Restart backend and frontend before testing
- Use a legal entity with FA permissions
- Make sure the current open fiscal period is known
- Use a fresh fixed asset for each scenario unless the scenario explicitly reuses one

### Scenario 1: Retro Same-Month Reorderability

Purpose:
- Verify a later-dated same-month improvement can be posted first
- Verify an earlier-dated same-month improvement can then be inserted without reversal
- Verify depreciation schedule and transaction snapshots remain coherent

Steps:
1. Create a new fixed asset from CARI AP bill or FA page.
2. Activate it in an earlier month.
3. Post depreciation through the prior month.
4. Enter improvement bill A:
   - `documentDate` in current open period
   - `improvementEffectiveDate` in historical month, later day of that month
5. Post improvement bill B:
   - `documentDate` in current open period
   - `improvementEffectiveDate` in the same historical month, earlier day than bill A
6. Open fixed asset detail.
7. Check `Transactions`.
8. Check `Depreciation Schedule`.

Expected:
- Both improvements post successfully
- A current-period `CATCH_UP` depreciation appears
- Historical corrected month is shown as corrected in schedule
- Later improvement transaction reflects resequenced pre-cost, not stale pre-cost
- Next-period opening NBV and planned depreciation are stable and coherent

### Scenario 2: Same-Day Cost-Only Improvements

Purpose:
- Verify multiple same-day cost-only improvements remain allowed

Steps:
1. Create a fresh active asset in the current period.
2. Post improvement bill A with:
   - same `improvementEffectiveDate`
   - cost amount only
3. Post improvement bill B with:
   - same `improvementEffectiveDate`
   - cost amount only
4. Open asset detail.

Expected:
- Both post successfully
- `Original Cost` increases by the sum of both improvements
- No chronology blocker appears
- Depreciation schedule uses the stacked cost basis

### Scenario 3: Same-Day Life-Change Conflict

Purpose:
- Verify only one life-changing same-day improvement is allowed

Steps:
1. Use a fresh asset or continue from Scenario 2.
2. Post one improvement with:
   - same `improvementEffectiveDate`
   - `lifeExtensionMonths` or `revisedUsefulLifeMonths`
3. Try to post a second same-day improvement with another life change.

Expected:
- Second posting is rejected
- Error reason is `FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT`
- CARI page shows user-friendly guidance
- Guidance includes asset id, blocking transaction info, and deep link to asset transactions

### Scenario 4: Later Physical Move Does Not Block Earlier Improvement

Purpose:
- Verify a later posted `PHYSICAL_MOVE` does not block back-inserting an earlier improvement
- Verify the move history and current location remain intact after the improvement is inserted

Steps:
1. Create a fresh asset.
2. Post depreciation through the prior month.
3. Post a later `PHYSICAL_MOVE` in the current period.
4. Post a backdated earlier improvement with:
   - `documentDate` in the current open period
   - `improvementEffectiveDate` earlier than the move date
5. Open fixed asset detail and depreciation schedule.

Expected:
- Improvement posts successfully without reversing the move
- Current location / custodian / department / cost center still reflect the move
- Physical move transaction history remains intact
- Depreciation schedule is coherent and does not diverge from the same chronology entered in natural order

### Scenario 5: Later Financial Lifecycle Blocker

Purpose:
- Verify back-insertion is still blocked when a later financial lifecycle event already exists

Steps:
1. Create a fresh asset.
2. Post depreciation through the prior month.
3. Post a later lifecycle action such as:
   - ownership transfer
   - sale
   - write-off
4. Try to post a backdated earlier improvement effective before that lifecycle event.

Expected:
- Posting is rejected
- User sees a friendly explanation, not only a raw backend message
- Guidance points user to asset transactions and explains that the later lifecycle event must be reversed or corrected first

### Scenario 6: Retro Improvement Catch-Up In Current Period

Purpose:
- Verify late-entered improvement uses current-period catch-up instead of rewriting posted periods

Steps:
1. Create a fresh asset in an older month.
2. Post depreciation for at least one historical month.
3. In the current open period, enter an improvement bill with:
   - `documentDate` in current open period
   - `improvementEffectiveDate` in an older already-posted month
4. Post the bill.
5. Open `Transactions` and `Depreciation Schedule`.

Expected:
- Improvement posts successfully
- A `CATCH_UP` depreciation transaction is created in the current period
- Historical month in the schedule is displayed as corrected
- Future schedule opens from corrected NBV

### Scenario 7: Regression Check On Disposal Month Preview

Purpose:
- Verify disposed assets do not poison later depreciation preview

Steps:
1. Use one asset sold or written off in a prior period.
2. Open depreciation run preview for a later period.

Expected:
- Disposed asset is skipped, not shown as preview-breaking error
- Remaining active assets still preview normally

### Scenario 8: Suspended Asset Improvement During Repair

Purpose:
- Verify an improvement bill can be entered while the asset is suspended for repair
- Verify the cost is capitalized immediately
- Verify the new depreciation basis does not start until reactivation

Steps:
1. Create a fresh asset in an older month and post depreciation through the prior month.
2. Suspend the asset in the current period.
3. While the asset is still `SUSPENDED`, enter an `IMPROVE_EXISTING` AP bill with:
   - `documentDate` in the current open period
   - `improvementEffectiveDate` during the suspension interval
4. Post the bill before reactivating the asset.
5. Open fixed asset detail and verify the asset is still `SUSPENDED`.
6. Open `Depreciation Schedule` and check the current period:
   - only pre-suspend active days should be depreciable
   - there should be no active segment yet for the suspended interval
7. Reactivate the asset later:
   - same period later date, or
   - next period / next month
8. Reopen `Depreciation Schedule`.

Expected:
- Improvement bill posts successfully even while asset status is `SUSPENDED`
- `Original Cost` increases immediately
- Asset status remains `SUSPENDED` until reactivation
- No depreciation is recognized for suspended days
- After reactivation, depreciation resumes from the reactivation date
- If reactivation happens in the same period, that period shows:
  - pre-suspend active segment on old basis
  - post-reactivation active segment on improved basis
- If reactivation happens next month, the first resumed month starts from the improved carrying value

## What To Check In UI

On `CARI Documents`:
- `improvementEffectiveDate` appears only for `FIXED_ASSET + IMPROVE_EXISTING`
- `SUSPENDED` assets are selectable for improvement
- Later `PHYSICAL_MOVE` does not block an earlier improvement
- Error panel explains blockers in business language
- Deep link to asset transactions works

On `Fixed Asset Detail`:
- `Transactions` ordering is chronological and understandable
- Improvement transactions show sensible gross / NBV progression
- Catch-up depreciation is visible when applicable
- Reverse action is available on reversible posted transactions

On `Depreciation Schedule`:
- Historical corrected periods show corrected values
- Same-month improvements do not create impossible jumps
- Next-period opening NBV matches prior corrected closing NBV

## Pass Criteria

- Smoke script passes
- All manual scenarios behave as expected
- No raw chronology blocker leaves the user without guidance
- Reordered same-month retro improvements produce the same depreciation result as chronological control

# LC40 Inline Charge Regression Notes

## Automated Smoke

Scripts:
- `backend/scripts/test-cari-lc40-charge-allocation-smoke.js`

Run:

```powershell
node backend/scripts/test-cari-lc40-charge-allocation-smoke.js
```

Or from `backend/`:

```powershell
npm run test:cari:lc40
```

Optional cleanup mode:

```powershell
$env:LC40_SMOKE_KEEP_ARTIFACTS='0'
node backend/scripts/test-cari-lc40-charge-allocation-smoke.js
Remove-Item Env:LC40_SMOKE_KEEP_ARTIFACTS
```

What `LC40` covers:
- Charge lines reject stock-item defaulting that would reintroduce stock behavior
- AP charge draft cannot be flipped to AR through header-only update without replacing lines
- `FIXED_ASSET + AUTO_CREATE` draft assets keep charge-augmented original cost through activation
- `FIXED_ASSET + IMPROVE_EXISTING` uses augmented improvement amount and skips standalone charge debit
- Reversal restores fixed-asset basis and preserves the charge graph
- `STOCK` charge allocation persists computed targets and lands in inventory cost

Expected result:
- Console prints `LC40 smoke passed`

## Manual UI Test Guide

### Preconditions

- Restart backend and frontend before testing
- Use a legal entity with CARI, inventory, and fixed asset permissions
- Ensure at least one active warehouse exists in the selected ownership context for stock scenarios
- Use a fresh AP draft for each scenario unless the scenario explicitly reuses one
- Use positive whole quantities for `AUTO_CREATE` fixed-asset scenarios

### Scenario 1: AP-Only Charge Line Creation

Purpose:
- Verify charge allocation is available only on AP drafts
- Verify charge line itself remains a General/`NONE` line

Steps:
1. Open `Vendor Bills`.
2. Add one normal target line.
3. Add one General line and enable `Distribute as charge`.
4. Confirm allocation controls appear.
5. Switch the document direction or route to AR / customer invoice flow.

Expected:
- Charge controls are available on AP only
- Charge line remains General/`NONE`
- AR flow does not allow charge allocation UI

### Scenario 2: Draft Save, Reload, And Target Persistence

Purpose:
- Verify inline charge targets survive save/reload and line reorder

Steps:
1. Create an AP draft with:
   - line 1 target
   - line 2 target
   - line 3 charge line
2. Choose `EQUAL`, `BY_AMOUNT`, `BY_QTY`, or `MANUAL`.
3. Save the draft.
4. Reopen the draft.
5. Reorder target lines and save again.
6. Reopen the draft again.

Expected:
- Charge line still shows the saved method
- Target selections remain attached to the intended lines
- Manual allocations remain preserved
- Reordered lines do not silently retarget the charge graph

### Scenario 3: Fixed Asset Auto-Create With Charge

Purpose:
- Verify auto-created draft assets and later activation keep the augmented basis

Steps:
1. Create an AP bill with:
   - one `FIXED_ASSET + AUTO_CREATE` line
   - quantity greater than 1
   - one General charge line targeting that FA line
2. Post the document.
3. Open `Fixed Asset List`.
4. Check the created draft assets.
5. Activate one of the draft assets.
6. Return to `Fixed Asset List`.

Expected:
- Draft assets are created at per-unit cost including allocated charge
- Activation does not drop `Original Cost` back to the raw pre-charge amount
- Asset remains consistent before and after activation

### Scenario 4: Improve Existing With Charge

Purpose:
- Verify allocated charge becomes part of the improvement amount

Steps:
1. Prepare an active asset.
2. Create an AP bill with:
   - one `FIXED_ASSET + IMPROVE_EXISTING` line
   - one General charge line targeting that improvement line
3. Post the document.
4. Open fixed asset detail.
5. Check `Original Cost`, transactions, and linked journal if needed.

Expected:
- Improvement posts successfully
- Asset `Original Cost` increases by base line amount plus allocated charge
- No standalone debit is posted for the charge line
- Improvement transaction amount reflects the augmented cost

### Scenario 5: Stock Receipt With Charge

Purpose:
- Verify allocated charge lands in stock receipt cost

Steps:
1. Create an AP bill with:
   - one or more `STOCK` lines
   - one General charge line targeting those stock lines
2. Bind each stock line to a warehouse in the same ownership context.
3. Post the document.
4. Materialize the pending stock movement if your flow requires it.
5. Open inventory movement / valuation detail.

Expected:
- Stock lines post successfully
- Stock link amount includes allocated charge
- Inventory receipt total cost and unit cost include allocated charge
- Audit note indicates allocated charges were included

### Scenario 6: Reversal Of Posted Charged Document

Purpose:
- Verify posted augmented costs unwind correctly

Steps:
1. Use a posted AP document from Scenario 3, 4, or 5.
2. Reverse the posted document.
3. Reopen the related fixed asset or stock detail.
4. Open the reversal document.

Expected:
- Reversal succeeds
- Asset basis or stock cost is restored to the pre-document state
- Charge line still has no standalone reversal debit
- Reversal document preserves charge allocation method and target graph for audit

### Scenario 7: Charge-Line Guard Rails In UI

Purpose:
- Verify incompatible state transitions are cleaned up instead of being hidden

Steps:
1. Start with a General charge line.
2. Select a stock item card on that line.
3. Observe whether charge state remains.
4. Start with a stock line.
5. Change it back to General.
6. Turn on `Distribute as charge`.

Expected:
- Selecting a stock item card clears charge allocation state
- Demoting a stock line to General clears the incompatible stock item-card state
- User does not end up with hidden charge targets or hidden stock defaults

### Scenario 8: AP-Only Service-Layer Guard

Purpose:
- Verify charge lines cannot survive under AR through edit tricks

Steps:
1. Create an AP draft with a charge line and save it.
2. Attempt to switch the header to AR without replacing lines.
3. Reopen the draft.

Expected:
- Update is rejected
- Draft remains AP
- Charge graph is not partially mutated or stranded

## What To Check In UI

On `Vendor Bills` / `CARI Documents`:
- `Distribute as charge` appears only on General/`NONE` lines
- Charge target picker lists only eligible non-charge lines
- Method preview and manual totals are mathematically correct
- Stock and fixed-asset target lines show effective augmented amounts
- Stock warehouse choices respect the effective document ownership context

On `Fixed Asset List` / `Fixed Asset Detail`:
- Auto-created draft assets show augmented per-unit basis
- Activation keeps the same basis
- Improvement transactions reflect augmented amounts

On inventory screens:
- Stock link amounts match augmented amounts
- Inventory movement note indicates allocated charges were included

## Pass Criteria

- `LC40` smoke passes
- Manual AP charge scenarios behave as expected
- Fixed asset and stock targets receive augmented costs
- Activation and reversal do not lose allocated-charge basis
- UI guard rails prevent hidden stock/charge mixed state

# Track 41 Cross-Document Landed Cost Voucher Regression Notes

This section is added on top of the existing FA/LC40 notes so all plan scenarios stay in one file.

## Goal

- test the full Track 41 workflow from first receipt to downstream valuation and reversal
- keep Track 40 same-document charges and Track 41 cross-document vouchers clearly separate
- cover both happy path and rejection/blocking cases

## 0. Base Setup / Readiness

Scenario:
- create one legal entity with base currency
- create at least two warehouses under `CENTRAL`
- create at least two warehouses under different `OPERATING_UNIT`s
- create one stock item with inventory asset + COGS/purchase fallback accounts
- create one vendor
- ensure the test user has `inventory.read` and `inventory.upsert`

Expected:
- stock receipts can be posted
- AP bills can be posted
- inventory transfers can be approved, shipped, received, and reversed
- landed-cost voucher list page and new voucher page open without permission errors

## 1. Simple Separate Freight Bill After Receipt

Business story:
- receive stock on Day 1
- freight AP bill arrives on Day 5
- freight is allocated to one posted receipt

Steps:
1. Post AP receipt invoice with one `STOCK` line.
2. Materialize the inventory receipt.
3. Post a separate AP invoice with one `GENERAL` freight line.
4. Open `/app/stok-maliyet-voucherleri/yeni`.
5. Select the freight line as source.
6. Select the posted receipt as target.
7. Preview with `BY_AMOUNT` or `BY_QTY`.
8. Post the voucher.

Expected:
- voucher posts successfully
- source AP line is reclassed, not double-expensed
- inventory value increases in current period
- receipt history stays intact
- voucher detail shows source, target, journal, and layer allocation rows

## 2. One Voucher Targeting Multiple Receipts

Business story:
- one freight bill covers two receipts from the same ownership context

Steps:
1. Post two separate stock receipts for the same vendor or shipment batch.
2. Post one later AP freight bill.
3. Create one landed-cost voucher using that source line.
4. Select both receipt targets.
5. Preview with `BY_QTY`.

Expected:
- one voucher can target both receipts
- allocation splits across both targets
- target count and totals on list/detail are correct
- journal debit side reflects total capitalized plus consumed split if any

## 3. Partial Consumption Split: On-Hand + Consumed

Business story:
- part of the receipt is already sold/issued before customs bill arrives

Steps:
1. Post receipt for quantity 10.
2. Issue/sell quantity 4.
3. Post later customs AP bill.
4. Create landed-cost voucher against the original receipt.

Expected:
- preview shows on-hand quantity 6 and consumed quantity 4
- voucher splits cost into:
  - capitalized inventory portion
  - consumed adjustment portion
- posting debits inventory for remaining stock only
- posting debits consumed adjustment/COGS path for already-consumed slice

## 4. Same-Context Transfer-Aware Targeting

Business story:
- goods are received into one central warehouse and later transferred to another central warehouse before the freight bill arrives

Steps:
1. Post original receipt in central warehouse A.
2. Transfer part or all stock to central warehouse B.
3. Receive the transfer.
4. Post later AP freight/customs bill.
5. Create voucher against the original receipt anchor.

Expected:
- preview follows descendant receipt layers
- on-hand quantity can resolve in warehouse B instead of warehouse A
- voucher still posts because ownership context is the same
- layer allocation detail shows original anchor and descendant path clearly

## 5. Cross-Context Split Required

Business story:
- HQ receives stock centrally
- later some stock is transferred to an operating-unit-owned warehouse
- customs bill arrives after that movement

Steps:
1. Post original central receipt.
2. Transfer quantity to an OU warehouse and receive it.
3. Try to create one voucher covering both central and OU state together.

Expected:
- mixed ownership-context selection is blocked
- UI shows a clear banner to split into separate vouchers
- one voucher cannot mix `CENTRAL` and `OPERATING_UNIT`

## 6. Future Issue Must Consume Landed-Cost Uplift

Business story:
- voucher is posted while stock is still on hand
- later sale/issue happens

Steps:
1. Post landed-cost voucher on open stock.
2. After voucher posting, issue some of that stock.

Expected:
- later issue valuation includes original layer cost plus landed-cost uplift
- landed-cost consumption rows are created
- open landed-cost balance decreases accordingly

## 7. Future Transfer Shipment Must Consume Landed-Cost Uplift

Business story:
- voucher is posted on open stock
- later a transfer shipment moves that stock out

Steps:
1. Post landed-cost voucher on still-open stock.
2. Create and ship a transfer for part of that stock.

Expected:
- shipment consumes open landed-cost balance additively
- landed-cost consumption rows link to the shipment movement
- transfer shipment is not treated as final expense; it is carry-forward behavior

## 8. Transfer Receipt Must Recreate Carried-Forward Open Balance

Business story:
- stock with landed-cost uplift is transferred and received into another warehouse/context-valid descendant layer

Steps:
1. Complete Scenario 7 through shipment.
2. Receive the transfer.

Expected:
- destination receipt movement gets carried-forward landed-cost balance rows
- new open landed-cost balance ties to destination receipt movement/cost layer
- detail/audit can show carry-forward source and destination lineage

## 9. Issue Reversal Must Restore Landed-Cost Open Balance

Business story:
- issued stock is reversed after landed-cost uplift was consumed

Steps:
1. Post landed-cost voucher.
2. Issue stock that consumes uplift.
3. Reverse that inventory issue.

Expected:
- landed-cost consumption is restored deterministically
- remaining adjusted quantity and amount reopen correctly
- no orphaned landed-cost consumption rows remain active after reversal

## 10. Transfer Reversal Must Restore Origin Open Balance

Business story:
- a transfer using landed-cost uplift is reversed

Steps:
1. Post landed-cost voucher.
2. Ship and receive transfer that carries forward uplift.
3. Reverse the transfer.

Expected:
- destination carry-forward landed-cost balance is unwound
- origin landed-cost open balance is restored
- no duplicate or stranded open balances remain

## 11. Duplicate Source AP Line Application Guard

Business story:
- the same freight line is accidentally selected twice or reused after full application

Steps:
1. Post one freight AP line.
2. Use it fully on voucher A.
3. Try to use the same line again on voucher B.

Expected:
- lookup shows no remaining unapplied amount or disabled state
- preview/post blocks over-application
- remaining unapplied amount stays accurate

## 12. Source Eligibility Rejections

Test these AP source rows separately:
- tax line
- Track 40 charge line
- stock-affecting line
- fixed-asset line
- comment/rounding/adjustment line
- reversed or reversal-blocked source document line
- line with zero remaining unapplied amount

Expected:
- each row is not selectable as a valid landed-cost source
- UI shows disabled reason badge
- backend rejects invalid payload even if frontend is bypassed

## 13. Cross-Legal-Entity Rejection

Business story:
- user tries to apply a source AP line from one legal entity to a receipt in another legal entity

Steps:
1. Create source AP line in legal entity A.
2. Create stock receipt in legal entity B.
3. Attempt preview/post.

Expected:
- preview blocks before posting
- source/target legal entity mismatch is rejected clearly

## 14. Track 40 and Track 41 Separation

Business story:
- a receipt already had same-document charge allocation
- later another separate freight/customs bill arrives

Steps:
1. Post a Track 40 receipt with same-document charge lines.
2. Materialize the receipt.
3. Post a separate later AP freight/customs bill.
4. Create Track 41 landed-cost voucher on that receipt.

Expected:
- both costs stack additively
- original receipt cost, Track 40 charge cost, and Track 41 voucher cost stay distinguishable
- no Track 40 behavior regresses

## 15. Cross-Currency Source With Base-Authoritative Allocation

Business story:
- base currency is USD
- freight bill is in EUR
- receipt layer may also carry different txn currency context

Steps:
1. Post stock receipt.
2. Post later AP source line in foreign currency.
3. Create landed-cost voucher.

Expected:
- preview and posting are authoritative in base currency
- transaction currency remains audit-only where applicable
- no descendant layer txn-currency restatement is attempted

## 16. Source Document Reversal Blocker

Business story:
- user tries to reverse the AP freight/customs bill after its source line has been applied to an active voucher

Steps:
1. Post landed-cost voucher from posted AP source line.
2. Try to reverse the AP source document.

Expected:
- AP document reversal is blocked
- blocker identifies active landed-cost voucher dependency
- after voucher reversal, source document reversal becomes available again

## 17. Voucher Reversal While Still Eligible

Business story:
- voucher was posted but nothing downstream consumed the capitalized slice yet

Steps:
1. Post landed-cost voucher on open stock.
2. Do not issue or transfer that stock.
3. Reverse the voucher from detail page drawer.

Expected:
- reversal succeeds
- journal reverses cleanly
- source application is released
- inventory uplift and consumed adjustment unwind symmetrically
- voucher history remains visible

## 18. Voucher Reversal Blocked After Downstream Dependency

Business story:
- voucher was posted
- later issue or transfer consumed the capitalized slice
- user tries to reverse the voucher

Steps:
1. Post voucher.
2. Issue or transfer stock that consumes open landed-cost balance.
3. Try to reverse the voucher.

Expected:
- reversal is blocked
- detail drawer shows precise dependency detail:
  - resolved cost layer
  - dependent movement
  - dependency type
  - date
- no partial unwind occurs

## 19. Journal Drillback and Audit Lineage

Business story:
- finance opens journal from voucher detail or GL drillback

Steps:
1. Post landed-cost voucher.
2. Open the posted journal.
3. Follow the source link drillback.

Expected:
- source link type is `STOCK_LANDED_COST_VOUCHER`
- drillback lands on landed-cost voucher page
- journal lines show correct inventory vs consumed adjustment vs AP reclass behavior
- context and operating unit visibility are preserved

## 20. List, Wizard, Detail, and Permission Behavior

Steps:
1. Open list page with `inventory.read`.
2. Confirm filter bar works by legal entity, context, OU, status, vendor, search.
3. Open new wizard with `inventory.upsert`.
4. Walk through source selection, target selection, preview, review, and post.
5. Open detail page with `inventory.read`.
6. Test reverse action visibility with and without `inventory.upsert`.

Expected:
- list/detail/preview are readable with `inventory.read`
- mutating actions require `inventory.upsert`
- missing mutating permission is shown inline, not hidden silently
- summary totals stay visible during wizard flow

## 21. Suggested Full End-to-End UAT Flow

Use this as the final real-life acceptance run:

1. Post one stock receipt with Track 40 same-document charge.
2. Materialize inventory receipt.
3. Transfer part of stock to another valid warehouse.
4. Post later freight/customs AP bill with `GENERAL` source line.
5. Create Track 41 voucher and preview transfer-aware split.
6. Post the voucher.
7. Issue some of the now-uplifted stock.
8. Review list page, detail page, layer allocations, and consumptions.
9. Try reversing source AP document and confirm blocker.
10. Try reversing voucher and confirm blocked state because of downstream issue.
11. Reverse the downstream issue.
12. Reverse voucher successfully.
13. Reverse the source AP document successfully afterward.

Expected:
- every major Track 41 lock is exercised in one business story
- Track 40 and Track 41 remain separate but additive
- source, target, journal, lineage, consumption, carry-forward, and reversal behavior all stay coherent

## Minimum Release Signoff Checklist

Before calling Track 41 done, confirm:
- separate-bill landed cost can be posted after receipt
- same-document Track 40 still works unchanged
- partial-consumption split is explicit and correct
- transfer-aware lineage works
- future issue consumes uplift
- future transfer carries uplift forward
- issue/transfer reversal restores uplift state
- duplicate source application is blocked
- ineligible source lines are rejected
- cross-legal-entity use is rejected
- source-document reversal blocker works
- voucher reversal works when eligible and blocks when not eligible
- journal drillback resolves to voucher workflow
- list, wizard, and detail pages are usable end to end
