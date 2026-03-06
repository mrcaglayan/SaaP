STEPS: **Assessment**
This is implementable, but not as a single safe sweep.

Current frontend state:
- No shared money-display component exists under [frontend/src/components](/c:/Users/Maarif/Desktop/my-app/frontend/src/components)
- There are `26` separate local `formatAmount` definitions across `frontend/src`
- There are `262` amount-format call sites in page files
- There are `314` currency-field usages

So the right approach is phased, with a shared display rule first.

The main distinction that matters:
- `txn/document amounts`: usually easy, because rows already carry `currencyCode` / `currency_code`
- `base amounts`: medium, because the UI must know the legal-entity or book base currency
- `totals across mixed currencies`: hard, because showing one currency can be wrong

**Recommended Standard**
Use one UI rule everywhere:
- Transaction amount: always show amount + transaction currency
- Base amount: always show amount + base/functional currency, but only when that currency is known
- Mixed-currency totals: do not show a fake single currency; either group by currency or label as mixed

I would introduce:
- [frontend/src/components/MoneyText.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/components/MoneyText.jsx)
- optional helper: [frontend/src/utils/money.js](/c:/Users/Maarif/Desktop/my-app/frontend/src/utils/money.js)

Core props:
- `amount`
- `currencyCode`
- `variant="inline" | "stack"`
- `fallback="-"`
- `showCurrency=true`

This gives one rendering pattern instead of 26 page-local ones.

**PR Steps**
1. `PR1: Money Display Foundation`
- Add shared `MoneyText` component and a small formatter helper.
- Define app-wide rules for `txn`, `base`, and mixed totals.
- Do not change many pages yet.
- Acceptance: one reusable component exists and can render `123,456.78 USD` or stacked amount/code.

2. `PR2: CARI High-Value Surfaces`
- Update [CariDocumentsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariDocumentsPage.jsx)
- Update [CariSettlementsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariSettlementsPage.jsx)
- Update [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx)
- Cover document list, open items, settlement preview, settlement results, statement rows, realized-FX report rows.
- Acceptance: users can always distinguish AFN vs USD in core CARI flows.

3. `PR3: CASH + PAYMENTS`
- Update [CashTransactionsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashTransactionsPage.jsx)
- Update [CashExchangesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashExchangesPage.jsx)
- Update [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx)
- Update [PaymentBatchListPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payments/PaymentBatchListPage.jsx)
- Update [PaymentBatchDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payments/PaymentBatchDetailPage.jsx)
- Acceptance: operational cash/payment pages always show row currency next to amounts.

4. `PR4: PAYROLL + CONTRACTS`
- Update payroll list/detail pages where amount columns are currently currency-blind
- Update contracts pages where txn/base are shown together
- For payroll, use run/liability currency where available instead of guessing
- Acceptance: payroll and contracts no longer show bare amounts when currency is known.

5. `PR5: Base-Currency Completion`
- Audit pages showing `amountBase`, `debitBase`, `creditBase`, `residualAmountBase`
- Where base currency is not on the row, derive it from selected legal entity/book if the page already has that context
- If a page cannot safely know base currency, leave the amount unlabeled and mark it for backend/data follow-up
- Acceptance: base amounts are labeled correctly where context is reliable.

6. `PR6: Mixed-Currency Totals + Cleanup`
- Review summary cards/totals across reports
- Prevent misleading single-currency labels on mixed totals
- Group by currency or show “mixed” where needed
- Replace duplicated local `formatAmount` usage in touched modules with `MoneyText`
- Acceptance: no misleading currency on aggregate totals.

**Where It Is Easy**
- CARI row tables
- Cash row tables
- Payment rows
- Detail drawers where the record currency already exists

**Where It Needs Care**
- Consolidation reports
- Reclassification screens
- Journal base totals
- Any report aggregating multiple legal entities or currencies

**Implementation Notes**
- Prefer updating existing amount cells first instead of adding many new columns; that avoids saved-view friction.
- If you do add columns later, [CariDocumentsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariDocumentsPage.jsx#L368) already normalizes visible column ids, so old saved views won’t break badly.
- Don’t auto-append currency to every `formatAmount(...)` blindly. Some totals are mixed or base-only.

**Best First Slice**
If you want the highest-value first implementation:
- `PR1`
- `PR2`
- `PR3`

That gets CARI/CASH/PAYMENTS into a good state with low risk.




UPDATES: 
PR1 is in place.

I added the shared money-display foundation in money.js (line 1) and MoneyText.jsx (line 1). It gives us one reusable way to render amount-only, inline amount+currency, or stacked amount+currency.

As the pilot integration, I wired CariDocumentsPage.jsx (line 928) to use MoneyText for the document list Invoice Amount column, and also for the related open-item residual display in the detail panel at CariDocumentsPage.jsx (line 4179). That keeps PR1 small and gives us a concrete pattern to roll out in PR2/PR3.

Verification: npm --prefix frontend run build passed.
PR2 is in place. The shared money display from [MoneyText.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/components/MoneyText.jsx#L1) and [money.js](/c:/Users/Maarif/Desktop/my-app/frontend/src/utils/money.js#L1) is now used across the main CARI row-level surfaces.

Updated:
- [CariDocumentsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariDocumentsPage.jsx#L928) keeps the document list and related open-item residuals currency-aware.
- [CariSettlementsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariSettlementsPage.jsx#L962) now formats reverse-settlement lookup totals with currency, and [CariSettlementsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariSettlementsPage.jsx#L3065) shows currency on all preview amount columns.
- [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx#L58) adds safe currency resolvers, and [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx#L589), [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx#L640), [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx#L689), [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx#L779), and [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx#L823) now show currencies on open-item rows, unapplied balances, statement rows, and realized-FX rows. Base amounts in realized-FX rows use the legal entity functional currency.

Intentionally unchanged: mixed-currency summary cards and aging bucket aggregates still show plain amounts, because attaching one currency there can be wrong.

Verification: `npm --prefix frontend run build` passed.
PR3 is in place.

I updated the planned cash and payments pages to use the shared money display on row-level amounts:
- [CashTransactionsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashTransactionsPage.jsx#L3859) now shows currency in the selected-apply total, open-item residuals, and the main transaction table amount cell.
- [CashExchangesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashExchangesPage.jsx#L1308) now shows source and target transaction amounts with their currencies in the exchange list.
- [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx#L133) now resolves legal-entity base currency when needed, and [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx#L1181), [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx#L1333), and [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx#L1422) now show currencies on exchange-history rows, foreign-balance rows, and revaluation run/details rows.
- [PaymentBatchListPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payments/PaymentBatchListPage.jsx#L341) and [PaymentBatchDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payments/PaymentBatchDetailPage.jsx#L296) now show batch totals and payment line amounts with batch currency.

Intentionally unchanged:
- mixed/aggregate summary cards in cash FX reports still use plain amounts
- fee/spread base amounts on [CashExchangesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashExchangesPage.jsx#L1339) still use plain formatting because that page does not yet have a reliable per-row base-currency source

Verification: `npm --prefix frontend run build` passed.



Yes. Based on the actual remaining files, I’d tighten the follow-up plan like this.

**Follow-up PRs**
1. `PR4A: Payroll Runs`
- Update [PayrollRunsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunsPage.jsx) and [PayrollRunDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunDetailPage.jsx).
- Use `MoneyText` for run list gross/net, run header summary cards, employee row amounts, and accrual preview line amounts.
- Use the run `currency_code` for row-level payroll amounts.
- Leave `debit_total` and `credit_total` plain unless the page already exposes a reliable base/book currency.
- Acceptance: payroll run list/detail no longer shows bare row-level amounts.

2. `PR4B: Payroll Liabilities`
- Update [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx).
- Use `MoneyText` for liability rows, selected liability cards, preview rows, bank-match totals, and settlement-related row amounts.
- Use `row.currency_code` or selected liability currency where available.
- Keep cross-row summary tiles plain if the filter can produce mixed currencies.
- Acceptance: payroll liability operations show currency on row/detail amounts.

3. `PR4C: Contracts`
- Update [ContractsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/contracts/ContractsPage.jsx) and, if needed, small helpers in [contractsUtils.js](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/contracts/contractsUtils.js).
- Use `MoneyText` for contract list totals, billable line txn amounts, linked document txn/base amounts, and financial rollup tiles.
- Show txn amounts with contract/document currency.
- Show base amounts only when the base currency is explicit and reliable from the page context.
- Acceptance: contracts row/detail surfaces no longer hide txn currency.

4. `PR5: Base-Currency Completion`
- Finish remaining base-amount surfaces in:
  - [ContractsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/contracts/ContractsPage.jsx)
  - [PayrollRunDetailPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollRunDetailPage.jsx)
  - [CashExchangesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashExchangesPage.jsx)
  - [JournalWorkbenchPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/JournalWorkbenchPage.jsx)
- Add a shared base-currency resolver where the page already knows legal entity or book context.
- Acceptance: `amountBase`, `debitBase`, `creditBase`, and similar values show currency when it is actually known.

5. `PR6: Mixed-Currency Totals + Cleanup`
- Review mixed/aggregate totals in:
  - [CariReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cari/CariReportsPage.jsx)
  - [CashFxReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/cash/CashFxReportsPage.jsx)
  - [ConsolidationReportsPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/ConsolidationReportsPage.jsx)
  - [PayrollLiabilitiesPage.jsx](/c:/Users/Maarif/Desktop/my-app/frontend/src/pages/payroll/PayrollLiabilitiesPage.jsx)
- Do not attach one fake currency to mixed totals. Either group by currency or label the total as mixed.
- Replace leftover local `formatAmount` usage in touched modules with `MoneyText` / `formatMoneyText`.
- Acceptance: no misleading aggregate totals, and duplicate money-formatting logic is reduced further.

**Recommended order**
- `PR4A`
- `PR4B`
- `PR4C`
- `PR5`
- `PR6`

I’d keep payroll and contracts separate from the base-currency/mixed-total work. That keeps the next merges small and makes regressions easier to spot.

If you want, I can start with `PR4A` now.