# ADR: Cash Control Subledger v1

- Status: Accepted
- Date: 2026-02-22
- Scope: SAAP backend + frontend cash operation model

## Context

SAAP already has a solid GL and journal core, but cash operations are currently generic journal activity. In real-world accounting workflows this increases operational risk (duplicate posting, weak physical cash control, poor day-end reconciliation).

The target is to keep GL as the accounting source of truth while forcing cash operations through a controlled subledger workflow.

## Decisions

1. Register/account model
- v1 uses `1 cash register = 1 GL account`.
- Register account must be leaf, postable, active, and in the same legal entity.
- One register cannot map to multiple GL accounts.

2. Register typing and session policy
- Supported register types: `VAULT`, `DRAWER`, `TILL`.
- Supported session modes: `REQUIRED`, `OPTIONAL`, `NONE`.
- Default policy:
  - `TILL` -> `REQUIRED`
  - `DRAWER` -> `OPTIONAL`
  - `VAULT` -> `OPTIONAL` (can be `NONE` by policy)

3. Currency model
- One currency per register.
- Cash transaction currency must match register currency.
- No FX conversion in cash module v1.

4. Posting ownership and source control
- GL cash control remains strict: GL is source of truth.
- Accounts flagged `is_cash_controlled = true` can only be posted through cash workflow with `source_type = CASH`.
- Emergency override is allowed only for privileged role, with mandatory reason and audit log.

5. Transaction mutability and lifecycle
- Posted cash transactions are immutable.
- Corrections are `reversal + re-entry` only.
- v1 statuses:
  - `DRAFT`
  - `SUBMITTED`
  - `APPROVED`
  - `POSTED`
  - `REVERSED`
  - `CANCELLED`

6. Session controls
- Only one open session per register.
- For `REQUIRED` session mode, posting requires an open session.
- Session close captures expected closing, counted closing, and variance.

7. Variance policy
- Session close variance is posted to configured gain/loss accounts.
- Threshold policies can require comment and/or approval.

8. Reliability controls
- Idempotency key is required for create/post operations.
- Posting must be transactionally locked around register/session/transaction state.
- Double-post prevention is mandatory.
- `txn_no` sequencing is deterministic per `legal_entity + year` (resets yearly).

9. Rollout strategy
- Start with monitoring and pilot registers.
- Move to strict cash-controlled account enforcement after pilot stabilization.

## Consequences

- Better auditability and lower operational cash risk.
- Slightly larger schema and more explicit workflow steps.
- Stronger SoD and control design for external audit readiness.

## Out of Scope for v1

- Multi-currency cash in a single register.
- Complex AP/AR native object linkage (kept as reference fields for now).
- Advanced analytics dashboards beyond operational minimum.
