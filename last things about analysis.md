Current repo: no, that `Detail + Actions` draft form does not currently expose invoice amount, base amount, currency, or FX rate for editing. The draft edit form starts at [CariDocumentsPage.jsx](c:/Users/ufukk/Desktop/SaaP/frontend/src/pages/cari/CariDocumentsPage.jsx#L5375), and the read-only detail block shows `currencyCodeSnapshot` and `fxRateSnapshot`, but not `amountBase`, at [CariDocumentsPage.jsx](c:/Users/ufukk/Desktop/SaaP/frontend/src/pages/cari/CariDocumentsPage.jsx#L4824).

In real ERP/accounting SaaS, the common pattern is:

- For `DRAFT` or unposted invoices, users usually edit the foreign amount and the exchange rate.
- The local/base amount is usually shown, but derived by the system, not free-typed.
- After posting/completing, rate/base are typically locked; correction is done by uncomplete/reverse/credit/recreate, not direct edit.

That pattern is consistent with official docs:
- Oracle Receivables says foreign-currency transactions use entered conversion info to calculate ledger currency amount, and on a completed invoice you cannot adjust the conversion rate; you must incomplete it or reverse/recreate it: [Oracle Receivables](https://docs.oracle.com/cd/E51367_01/financialsop_gs/FAOFC/F1479507AN1004D.htm)
- Microsoft Business Central describes `Currency Factor` as the relationship to local currency and shows “LCY Amount on document” as a derived document value: [Business Central currencies](https://learn.microsoft.com/en-ca/dynamics365/business-central/finance-set-up-currencies)
- SAP states that during foreign-currency entry you can specify the exchange rate, and if local/foreign amounts conflict, the system corrects mismatched entries: [SAP Foreign Currency Postings](https://help.sap.com/docs/SAP_ERP/192e92660a1e42a08756831fee30ce18/1a06c5536a51204be10000000a174cb4.html)

So my answer is: `base amount should be visible`, but in a serious accounting app it is usually better as `calculated/read-only`, not a normal editable field. If you need flexibility, the safer real-life design is:

- editable: `foreign amount`
- editable: `exchange rate` while unposted
- visible/calculated: `base amount`
- optional exception flow: audited `FX override`, not a naked free-edit base field

If you want, I can next outline 2-3 concrete UX options for the draft `Detail + Actions` panel without changing code yet.