Yes — **mostly yes**.

Before building a full period-end layer, you should first make sure the **core source modules are reliable enough**. Otherwise period-end features will become a patch layer on top of unstable operational data.

For your app, I would think about it like this:

## What must be reasonably solid first

### Bank

Should be stable enough because period-end depends on:

- bank balances being trustworthy
- bank postings hitting correct GL accounts
- transfers/reconciliation behavior being correct
- FX bank behavior being correct if foreign currency exists

It does **not** need to be “perfect enterprise banking” first, but it should be good enough that month-end cash/bank balances are believable.

### Payroll

If payroll expense and payroll liabilities will feed accounting, then yes, payroll should be at least structurally correct first.

You need confidence in:

- payroll accrual postings
- liability breakdowns
- settlement/payment sync
- correction flows

If payroll is still very incomplete, period-end payroll accrual logic will be hard to design correctly.

### Fixed assets

This one is especially important before depreciation.

If fixed assets are not modeled properly, then depreciation/amortization becomes weak or fake.
You need at least:

- asset master
- capitalization rules
- useful life / start date
- disposal or deactivation direction
- link to GL posting

Without that, “period-end depreciation” becomes just manual journals, not a real module.

---

## What does **not** have to be fully finished first

You do **not** need every feature in those modules complete before period-end work starts.

You do **not** need:

- full bank connectivity
- advanced payroll edge cases
- full fixed-asset sophistication
- all approval/reporting polish

What you need is a **stable accounting core** for each source module.

---

## Best sequencing for your app

I would use this rule:

### First make sure these are true

- bank postings are correct
- payroll accounting outputs are correct enough
- fixed asset model is good enough to support depreciation
- GL/manual journal foundation is reliable
- period lock design is clear

### Then build period-end

Because period-end depends on those modules as accounting sources.

---

## Practical priority order

I would sequence it like this:

1. **Bank foundation correct enough**
2. **Payroll accounting foundation correct enough**
3. **Fixed assets foundation correct enough**
4. **Manual journals + period locks**
5. **Reversing / recurring journals**
6. **FX revaluation**
7. **Depreciation**
8. **Year-end carry-forward**
9. **Close workspace / checklist later**

---

## Important distinction

There are two kinds of period-end features:

### Can start earlier

These do not depend heavily on unfinished modules:

- manual journals
- reversing journals
- recurring journals
- period locking

These are safe to build relatively early.

### Should wait for source modules

These depend directly on module correctness:

- bank revaluation
- payroll accrual automation
- depreciation from fixed assets
- advanced close automation

These should wait until their source modules are structurally right.

---

## My recommendation for you

Before following the full period-end roadmap, make sure:

- **bank** is accounting-correct
- **payroll** is accounting-correct
- **fixed assets** has enough structure for depreciation

But you can still start early on:

- **manual journals**
- **reversing journals**
- **recurring journals**
- **period locks**

So the answer is not “wait for everything.”

It is:

**stabilize source modules first where period-end depends on them, but start the generic accounting-close foundation earlier.**

If you want, I can map your existing bank/payroll/fixed-assets trackers into a **dependency order** showing exactly what must ship before each period-end slice.
