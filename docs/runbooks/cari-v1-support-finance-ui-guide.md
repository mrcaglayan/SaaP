# Cari v1 Support/Finance UI Guide

## Scope

This guide is for support and finance users operating the Cari UI modules:

- `/app/cari-belgeler`
- `/app/cari-settlements`
- `/app/cari-audit`

## Document Lifecycle

- Draft stage (`DRAFT`):
  - Create, edit, cancel actions are available only in draft.
- Posting:
  - Post action is allowed only for draft documents.
  - After post, journal linkage fields become the main accounting reference.
- Reversal:
  - Reverse is allowed only under backend reversal guards for posted lifecycle states.
  - Reversal keeps additive history; original rows remain traceable.

## Settlement Idempotency Behavior

- Apply action always requires `idempotencyKey`.
- Retry with the same key returns a deterministic result.
- Do not generate a new key for accidental double-click retries of the same intent.

## Replay Behavior (`idempotentReplay`)

- If response contains `idempotentReplay=true`, treat it as informational success.
- Operator message meaning:
  - request was already applied previously
  - current response mirrors existing result
- Do not re-open incident unless output is inconsistent with expected source data.

## Reverse Behavior (Document + Settlement)

- Document reverse:
  - reverses accounting effect with explicit linkage to reversal row/journal context.
- Settlement reverse:
  - called via `POST /api/v1/cari/settlements/{settlementBatchId}/reverse`.
  - re-opens affected balances according to effective-date/as-of rules.
- Always validate statement/open-items as-of dates before and after reverse date.

## Bank Attach/Apply Meaning

- Bank attach and bank apply are explicit workflows.
- They are not auto-triggered by settlement apply.
- Target rules:
  - `targetType=SETTLEMENT`: requires `settlementBatchId`, no `unappliedCashId`.
  - `targetType=UNAPPLIED_CASH`: requires `unappliedCashId`, no `settlementBatchId`.
- Both flows must send idempotency keys.

## FX Override Use-Case and Permissions

- FX override is a controlled exception path, not the default flow.
- Permission requirement: `cari.fx.override`.
- Override submissions must include explicit justification fields where required by UI/backend contract.
- Without permission, users must use standard rate behavior and should see clear inline guidance.

## Quick Triage Checklist

1. Confirm route-level access permission exists.
2. Confirm action-level permission for the specific button/panel exists.
3. Re-run with same idempotency key for replay-safe inspection.
4. Inspect `requestId` in audit records (`/app/cari-audit`).
5. Recheck report outputs with explicit `asOfDate` around reverse/apply dates.
