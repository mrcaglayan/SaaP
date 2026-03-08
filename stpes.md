Yes — steps first is the right move.

I checked your repo, and the important repo reality is:

* `cash_exchange_batches` already exists and is **clearing-first** today in `backend/src/migrations/m091_cash_exchange_batches.js`.
* fee / spread fields already exist from `backend/src/migrations/m096_cash_exchange_fee_spread_accounting.js`.
* the backend currently **always resolves/uses a clearing account** in `backend/src/services/cash.exchange.service.js`.
* the page `frontend/src/pages/cash/CashExchangesPage.jsx` already has the clearing-account picker and already sends `feeAccountId` / `feeAmountTxn` in payload, but the form does **not actually expose fee inputs yet**.
* `cash.service.js` already supports **DIRECT** posting for same-currency `TRANSFER_OUT/TRANSFER_IN`, but it explicitly rejects cross-currency direct transfer, so we cannot just reuse that as-is for FX exchange.

So the clean conclusion is:

**this is not a “UI toggle only” change.**
To make “Direct mode vs Clearing mode” real, we need backend foundation first.

---

# Recommended implementation order

## Execution sequence

1. Step 1 - Backend schema + validator foundation
2. Step 2 - Backend posting + reversal behavior
3. Step 3 - Frontend toggle + commission fields
4. Step 4 - Test coverage

That is the order to implement. The detailed sections below follow the same order.

## 1. Step 1 - Add explicit posting mode to cash exchange batches

Goal: make the mode explicit and backward-compatible.

### Files to update

* `backend/src/migrations/m106_cash_exchange_posting_mode.js`
* `backend/src/migrations/index.js`
* `backend/src/routes/cash.exchange.validators.js`
* `backend/src/services/cash.exchange.service.js`

### What to change

1. Add `posting_mode` to `cash_exchange_batches`

   * enum: `CLEARING`, `DIRECT`
   * default: `CLEARING`

2. Make `clearing_account_id` nullable

   * required only for `CLEARING`
   * nullable for `DIRECT`

3. Update create validators:

   * if `postingMode = CLEARING`:

     * allow manual `clearingAccountId`
     * or auto-resolve from `CASH_EXCHANGE_CLEARING`
   * if `postingMode = DIRECT`:

     * `clearingAccountId` must be empty/null

4. Keep all existing rows compatible:

   * backfill existing rows to `posting_mode='CLEARING'`

### Why this step must come first

Right now the service always resolves a clearing account and `postCashExchangeBatchById()` treats missing clearing metadata as invalid. So without this step, any frontend toggle would be fake.

---

## 2. Step 2 - Implement real backend posting behavior for both modes

Goal: make the accounting actually differ by mode.

### Files to update

* `backend/src/services/cash.exchange.service.js`
* possibly `backend/src/services/cash.service.js` only if you want to extract a reusable shared-journal helper
* maybe small helper export if needed from cash journal posting internals

### Behavior to keep for `CLEARING`

No accounting change. Keep current flow:

* exchange out transaction:

  * Dr clearing
  * Cr source safe
* exchange in transaction:

  * Dr target safe
  * Cr clearing

This preserves your current `108.xx` flow.

### Behavior to add for `DIRECT`

For direct mode, do **not** post through 108.

Use one shared exchange journal for the two cash legs:

* **Dr target safe account**
* **Cr source safe account**

Important:

* still create both cash transaction records so register balances, sessions, audit, and FX lot logic continue to work
* but both exchange legs should point to the **same posted journal entry**
* fee transaction, if present, can stay as a separate payout posting:

  * Dr commission/expense account
  * Cr source safe

That keeps the direct exchange clean, while not overcomplicating fee logic.

### Direct mode reversal

Add the mirror reverse flow:

* reverse source leg
* reverse target leg
* create one reversal journal:

  * Dr source safe
  * Cr target safe

If fee exists, reverse fee separately as today.

### Guardrails

For `DIRECT`:

* same legal entity only
* same rules as current exchange batch
* source/target base effect must net cleanly
* no 108 lines should appear in the exchange journal

---

## 3. Step 3 - Add the page toggle and expose commission fields

Goal: make the UI match the accounting modes.

### Files to update

* `frontend/src/pages/cash/CashExchangesPage.jsx`
* `frontend/src/i18n/messages.js`

### UI changes

1. Add `postingMode` field to create form

   * default: `CLEARING`
   * options:

     * `CLEARING (108.xx / staged)`
     * `DIRECT (safe-to-safe)`

2. UI rules

   * if `CLEARING`:

     * show clearing account picker
     * keep current `108.xx` help text
   * if `DIRECT`:

     * hide/disable clearing account picker
     * show help text like:

       * “Direct mode posts target safe vs source safe without 108 clearing.”

3. Expose fee/commission fields already supported by backend:

   * `feeAmountTxn`
   * `feeAmountBase`
   * `feeAccountId`
   * keep rule: fee amount requires fee account

4. Keep spread fields visible if you still want ops reporting:

   * `spreadReferenceRate`
   * `spreadRateDelta`
   * `spreadAmountBase`

5. In list/detail view:

   * show `postingMode`
   * show whether clearing account was used
   * show fee account when present

---

## 4. Step 4 - Add test coverage before release

Goal: make sure direct mode is not just visually working.

### New/updated tests

* `backend/scripts/test-cash-ex03-exchange-workflow.js`
  extend to assert `postingMode=CLEARING` still behaves exactly as before

* `backend/scripts/test-cash-exf03-exchange-fee-and-spread.js`
  extend to assert fee account selection and fee posting still works in both modes

* new:

  * `backend/scripts/test-cash-exf06-direct-mode-exchange.js`
  * `backend/scripts/test-cash-exf07-direct-mode-reversal.js`

### What these tests should prove

#### Clearing mode

* batch can omit manual clearing account if purpose mapping exists
* postings hit clearing account
* clearing nets to zero across exchange legs

#### Direct mode

* batch can be created without clearing account
* posting creates no 108 line for exchange legs
* one leg credits source safe, one leg debits target safe
* both exchange txns are linked and posted correctly
* FX lot processing still works
* reversal works

#### Fee logic

* fee requires `feeAccountId`
* fee journal posts to selected commission/expense account
* fee reversal works

---

# Exact design I recommend for your app

## Modes

* `CLEARING` = current 108.xx accounting
* `DIRECT` = direct safe-to-safe accounting

## Commission behavior

Do **not** add a separate “commission mode” first.
Just use:

* optional `feeAmountTxn`
* optional `feeAmountBase`
* required `feeAccountId` when fee exists

That is already aligned with your current backend schema.

## Default behavior

Default to `CLEARING`, so old behavior remains safe.

---

# Small but important repo note

There is already a useful GL setup convention for:

* `CASH_EXCHANGE_CLEARING`

So for step 1/2 we should **keep that purpose mapping exactly as it is** for clearing mode.
No need to redesign that part.

For commission, first pass should be **manual account selection on the exchange page**.
A default purpose mapping for commission can be a later refinement.

---

## Final execution order

1. Backend schema + validator foundation
2. Backend direct posting + reversal
3. Frontend toggle + fee picker
4. Tests

Start with Step 1.
