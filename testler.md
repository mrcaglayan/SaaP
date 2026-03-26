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
