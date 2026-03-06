`PR4A` is in place.

I updated [PayrollRunsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunsPage.jsx#L5) and [PayrollRunDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunDetailPage.jsx#L21) to use `MoneyText` for payroll run row-level amounts. That now covers run-list gross/net, run detail summary totals, accrual preview line amounts, employee line amounts, and the missing-mapping amount text, all using the run `currency_code`.

I intentionally left the accrual preview `Debit Total` and `Credit Total` plain in [PayrollRunDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunDetailPage.jsx#L755), since that still needs a reliable base/book currency decision in the later base-currency pass.

Verification: `npm --prefix frontend run build` passed.

`PR4B` is in place.

I updated [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L22) to use the shared money display on the safe liability-level surfaces:
- liability table `Amount / Settled / Outstanding` at [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L997)
- payment batch preview row amounts at [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L730)
- sync preview row amounts and bank-evidence totals at [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L899)
- selected liability detail amounts at [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L1193)
- manual override request amounts, plus the manual-settlement prompt text, at [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L147) and [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx#L1263)

I intentionally left the summary tiles and aggregate totals plain for now, because those can still span mixed liability scopes and need the later mixed/base-currency pass.

Verification: `npm --prefix frontend run build` passed.

`PR5` is in place.

I added shared base-currency resolvers in [money.js](/c:/Users/Maarif/Desktop/my-app/frontend/src/utils/money.js), refactored [ContractsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/contracts/ContractsPage.jsx) to use them, labeled payroll accrual preview debit/credit totals in [PayrollRunDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunDetailPage.jsx), labeled cash exchange `feeAmountBase` / `spreadAmountBase` in [CashExchangesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashExchangesPage.jsx), and completed the safe base-amount surfaces in [JournalWorkbenchPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/JournalWorkbenchPage.jsx) for account balances, draft totals, trial balance, journal history, detail lines, and post-confirm rows.

The behavior is intentionally conservative: base currency is shown only when the page can resolve it from the selected legal entity or book context. If that context is missing, the amount stays unlabeled instead of showing a wrong currency.

Verification: `npm --prefix frontend run build` passed.

`PR6` is complete.

Mixed and aggregate totals are now handled conservatively across the four target pages:
- [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx) and [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx) already use aggregate money metadata, so single-currency totals show amount + currency and ambiguous totals show `Mixed`.
- [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx) now applies the same rule to run summary cards, payment-batch preview totals, sync-preview totals, and the liabilities header total.
- [ConsolidationReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/ConsolidationReportsPage.jsx) now uses the selected run’s presentation currency for report totals, normalized balances, and adjustment debit/credit amounts.

I also removed the leftover page-local `formatAmount` usage from the PR6 target modules, so these surfaces now rely on the shared money formatting approach instead of ad hoc amount rendering.

Verification: `npm --prefix frontend run build` passed.