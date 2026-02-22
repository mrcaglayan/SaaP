# Cash Roles and Separation of Duties (SoD) - v1

This document defines minimum role boundaries for cash operations.

## Principle

No single user should create, approve, and post sensitive cash transactions without explicit override rights.

## Permission Set (new)

- `cash.register.read`
- `cash.register.upsert`
- `cash.session.open`
- `cash.session.close`
- `cash.txn.read`
- `cash.txn.create`
- `cash.txn.submit`
- `cash.txn.approve`
- `cash.txn.post`
- `cash.txn.reverse`
- `cash.override.post`
- `cash.variance.approve`
- `cash.report.read`

## Suggested Operational Roles

1. `Cashier`
- Allowed: create/submit transactions, open/close own session, read own register.
- Not allowed: approve own transaction, override cash-control posting.

2. `CashSupervisor`
- Allowed: approve transactions, approve close/variance by threshold, monitor exceptions.
- Not allowed: unrestricted override posting.

3. `FinancePoster`
- Allowed: post approved transactions, reverse posted transactions with reason.
- Not allowed: approve own submitted transaction (strict SoD mode).

4. `FinanceAdmin`
- Allowed: register setup, policy setup, threshold setup, emergency override with reason.
- Mandatory audit trail for all override operations.

## SoD Rules

1. Creator cannot approve own transaction (`created_by_user_id != approved_by_user_id`).
2. Approver and poster can be split by policy:
- Strict mode: `approved_by_user_id != posted_by_user_id`.
- Flexible mode: Finance role can approve+post.
3. Override posting always requires:
- `override_cash_control = true`
- non-empty `override_reason`
- dedicated permission `cash.override.post`
- audit log event

## Variance Controls

1. If absolute variance <= low threshold: auto-accept.
2. If variance > low threshold: supervisor comment required.
3. If variance > high threshold: finance approval required.
