In real ERP/SaaS accounting systems, the usual pattern is not “journal line lists every invoice directly.” The normal pattern is:

- `GL journal` stores the accounting impact only
- `AR/AP subledger` stores which invoices were settled
- UI drill-down connects them

So for a payment/settlement, the journal usually looks like:

- Dr AP / AR control
- Dr/Cr FX gain-loss
- Cr/Dr Bank or Cash

And the invoice-level truth lives in a settlement/allocation table like your `cari_settlement_allocations`.

That is how serious systems usually do it, because one payment can:
- pay many invoices
- partially pay one invoice
- mix old unapplied cash with new payment
- create FX differences

If you try to encode all of that directly into GL lines, the journal becomes noisy and fragile.

What real systems usually provide on top of that is better drill-down:

1. From journal -> open the source settlement/payment batch.
2. Inside that batch -> show applied invoices/documents.
3. From invoice/vendor ledger -> show related payment/settlement journal ids.

So the accounting model in SAAP is actually aligned with real-world ERP design.  
What is missing right now is mostly the `UI drill-down convenience`, not the underlying audit chain.

Best-practice UX for SAAP would be:
- keep journal lines summarized
- keep allocations in settlement tables
- show an `Applied Documents` section inside journal detail when source is `CARI_SETTLEMENT_BATCH`

That gives both:
- clean GL
- clear auditability

If you want, I can add that journal-detail drill-down next so when you click `View`, it also shows the paid invoice list under the journal.