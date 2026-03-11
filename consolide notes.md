Short answer: your Afghan safe accounts should map to a group-level `cash on hand` leaf under `100`, not to `108`, and `100` is missing on the page because in your group COA it is only a header account, not a selectable posting account.

What I checked in your DB:

- Consolidation group: `TMV CON` (`groupId=2`)
- Afghan entity: `AFG / AFGHATURK MAARİF` (`legalEntityId=2`)
- Active CoA mapping:
  - AFG local COA `4` -> group COA `3` (`GRP_TMV`)
- AFG local cash/safe accounts:
  - `100.01 AFG HQ AFN`
  - `100.02 AFG HQ USD`
  - `100.03 KBL AFN`
  - `100.04 KBL USD`
  - `100.05 HRT AFN`
  - `100.06 HRT USD`
- All of those are currently unmapped.
- In the group COA, under cash I found only:
  - `100 KASA` with `allow_posting=0`
  - no `100.xx` children
  - `108 DIGER HAZIR DEGERLER` is posting, but it is not the right bucket for normal safes/cash on hand.

Why `100` does not appear in `konsolidasyon-kurulum`:

- The page only shows active postable leaf accounts, not headers at [ConsolidationSetupPage.jsx:85](c:/Users/ufukk/Desktop/SaaP/frontend/src/pages/settings/ConsolidationSetupPage.jsx:85) and [ConsolidationSetupPage.jsx:345](c:/Users/ufukk/Desktop/SaaP/frontend/src/pages/settings/ConsolidationSetupPage.jsx:345).
- Backend enforces the same rule for group mappings at [consolidation.canonical-mappings.service.js:1542](c:/Users/ufukk/Desktop/SaaP/backend/src/services/consolidation.canonical-mappings.service.js:1542).
- Auto candidate matching also requires a postable group leaf with the same code at [consolidation.canonical-mappings.service.js:2452](c:/Users/ufukk/Desktop/SaaP/backend/src/services/consolidation.canonical-mappings.service.js:2452).

Accounting recommendation:

- These Afghan `100.xx` accounts are physical safes / cash on hand.
- They should consolidate into a group `cash on hand` account under `100`.
- They should not go to `108 DIGER HAZIR DEGERLER` unless your policy intentionally treats them as “other liquid assets” rather than normal cash. For safes/register cash, that would usually be wrong.

What you should do:

1. Create a posting leaf under group `100`.
   - Best simple option: `100.01 - GROUP CASH ON HAND`
   - If finance wants currency split: `100.01 - CASH ON HAND AFN`, `100.02 - CASH ON HAND USD`
2. Then map AFG local safe accounts to that group leaf through canonical mapping.
   - Best semantic key: `CASH_ON_HAND`
   - Or currency-specific keys if you split by currency.
3. Use bulk mapping:
   - `CODE_PREFIX = 100.`
   - or `DESCENDANTS_OF_ACCOUNT` with local root `100`
4. Map all `100.01` to `100.06` into that one group cash leaf, unless you want AFN/USD separated.

Best-practice choice here:

- Branch-level safes should usually collapse into one group cash-on-hand bucket.
- Branch detail is local operational detail, not consolidated FS presentation.
- Only split by currency if group reporting wants that view.

If you want, I can do one of these next:

1. Tell you the exact group leaf accounts to create.
2. Inspect the page/API and create the needed group `100.xx` account(s) directly.
3. Prepare the exact canonical bulk-rule payload for your Afghan safes.
