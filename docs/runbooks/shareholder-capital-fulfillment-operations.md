# Shareholder Capital Fulfillment Operations

## Purpose

This runbook covers setup, posting, reversal, and cash-transfer follow-up for shareholder capital fulfillment in Organization Management.

## Scope

- Central-only fulfillment into:
  - `BANK_ACCOUNT`
  - `ASSET_GL`
  - `CASH_REGISTER`
- Direct OU-targeted fulfillment into:
  - branch `BANK_ACCOUNT`
  - branch `ASSET_GL`
  - branch `CASH_REGISTER`
- Central-first cash movement after central cash receipt via the existing cash transit transfer workflow

## Required Setup

- Legal entity must have an OPEN book/fiscal period for the contribution date.
- Shareholder must belong to the legal entity and have:
  - `capital_sub_account_id`
  - `commitment_debit_sub_account_id`
- OU-targeted fulfillment requires OU internal current accounts:
  - `central_due_from_account_id`
  - `ou_due_to_central_account_id`
- Bank destinations can be preconfigured in `bank_accounts`.
- If no bank account exists for the selected legal entity / OU scope, Organization Management can create it inline during capital fulfillment without leaving the modal.
- Cash-register destinations must be configured in `cash_registers`.

## Posting Rules

- Shareholder capital and commitment lines remain central.
- `BANK_ACCOUNT` and `ASSET_GL` use the org capital-fulfillment journal flow.
- `CASH_REGISTER` never posts directly to cash-controlled GL from org logic.
- Cash-register fulfillment always goes through `cash_transactions` and the cash posting pipeline.

## Cash Register Controls

- Register must be `ACTIVE`.
- Register account must remain cash-controlled, active, postable, and leaf.
- Register currency must match the legal entity base currency for shareholder capital fulfillment.
- If `session_mode=REQUIRED`, users must select an OPEN `cash_session_id`.

## Cash Register Ownership Context

- Cash register selectors must show ownership explicitly as `Central` or `OU: <code>`.
- `Central` remains the central/no-OU posting context; there is no synthetic central operating unit behind these cash flows.
- A blank operating-unit selector must not be treated as the user-facing signal for central ownership.
- Follow-up cash movement is required whenever source and target sit in different operating-unit contexts.

## Central Cash Flow

- Central `CASH_REGISTER` fulfillment posts a `RECEIPT` cash transaction.
- The posted cash journal becomes the fulfillment journal.
- Paid capital increases because the posted cash journal credits the shareholder commitment debit sub-account.

## Branch Cash Flow

- OU-targeted `CASH_REGISTER` fulfillment posts two linked layers:
  - branch cash receipt in the cash subledger
  - separate central capital journal for paid-capital recognition
- Fulfillment history should show:
  - central journal link
  - cash transaction link
  - cash journal link when separate

## Reversal Rules

- Non-cash fulfillment reversal uses shared GL reverse behavior.
- Cash-register fulfillment reversal must reverse the linked `cash_transaction_id` through the cash reversal flow.
- OU-targeted cash reversal also reverses the linked central capital journal.
- Expected final state:
  - original row `status=REVERSED`
  - `reversal_journal_entry_id` populated
  - `cash_reversal_transaction_id` populated for cash destinations

## Central To Branch Cash Movement

- After central `CASH_REGISTER` fulfillment, physical movement to a branch register must use the existing cash transit workflow.
- The Organization Management success modal offers a shortcut that prefills:
  - source central register
  - target branch register
  - amount
  - reference/description
- Operators must still review:
  - transfer book date
  - required source/target sessions
  - current-account readiness for the chosen central/branch route

Accounting note:
- The follow-up central-to-branch transit posts through self-balancing current-account lines.
- Normal operator flow does not require a transit-clearing account override.

## Troubleshooting

### Preview/create fails with session error

- Confirm the selected register has an OPEN session.
- Confirm the chosen `cashSessionId` belongs to the same register.

### OU-targeted fulfillment fails on current-account readiness

- Confirm the OU row shows both current accounts configured.
- Re-check account type and normal-side rules:
  - `central_due_from_account_id` must be asset/debit
  - `ou_due_to_central_account_id` must be liability/credit

### Central cash to branch transfer fails

- Confirm source and target registers belong to the same legal entity.
- Confirm source and target are not the same register.
- Confirm the transfer uses different operating-unit contexts:
  - central register to branch register, or
  - branch to a different branch/central context

### Paid capital looks wrong after reverse

- Recheck fulfillment history for:
  - original journal
  - reversal journal
  - cash transaction
  - cash reversal transaction
- Recheck posted journal lines on the shareholder's `commitment_debit_sub_account_id`.

## Manual Smoke Checklist

- Post central bank fulfillment and confirm a 2-line posted journal.
- Post OU bank fulfillment and confirm the Option B 4-line journal.
- Post central cash fulfillment and confirm a linked `cash_transaction_id`.
- Verify `session_mode=REQUIRED` rejects missing `cashSessionId`.
- Post OU cash fulfillment and confirm both:
  - branch cash transaction
  - central capital journal
- Reverse OU cash fulfillment and confirm both layers reverse cleanly.
- Use the central-to-branch shortcut after central cash fulfillment and complete a cash transit transfer.
- Confirm shareholder `paid_capital` and `unpaid_capital` reflect posted fulfillments net of reversals.
