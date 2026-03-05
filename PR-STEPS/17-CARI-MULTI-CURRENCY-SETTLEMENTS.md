# 17 - CARI MULTI-CURRENCY SETTLEMENTS (Document Currency <> Settlement Currency)

## Purpose
Define an implementation-ready PR roadmap to support settlement/apply flows where:

1. Document currency can be local or foreign.
2. Collection/payment currency can be local or foreign.
3. Any valid document/settlement currency combination can be processed with deterministic FX conversion, posting, reversal, and reporting.

---

## Target Behavior (Required)

Supported combinations:

1. Document local -> settlement local.
2. Document local -> settlement foreign.
3. Document foreign -> settlement local.
4. Document foreign -> settlement foreign (same or different foreign currency).

Both directions must work:

1. `AR` collections.
2. `AP` payments.

---

## Current Gap Summary

Current implementation is effectively same-currency settlement per batch/open-item selection.

Main blockers:

1. Open-item selection is tied to settlement currency.
2. Allocation stores one txn amount, not dual document/settlement txn amounts.
3. Linked cash settlement path can default to parity-like base values if not resolved through unified FX policy.
4. UI preview does not expose currency conversion context clearly enough for mixed-currency settlement.

---

## Locked Semantics (Non-Negotiable)

1. `document currency` and `settlement currency` are separate concepts.
2. Settlement allocation must preserve both:
   - amount consumed in document currency.
   - amount paid/collected in settlement currency.
3. GL base impacts must be derived from one deterministic FX policy per settlement event.
4. Reversal must exactly invert original conversion and amounts.
5. Idempotency must remain strict for apply/reverse.

---

## Scope (This Track)

1. API/model/service support for cross-currency settlement.
2. Correct cash-linked settlement behavior in mixed currency.
3. Reporting updates for dual-currency allocations and realized FX clarity.
4. Frontend UX updates for currency selection, conversion preview, and validation.

Out of scope:

1. Auto-exchange execution inside settlement apply (exchange remains explicit workflow).
2. New treasury hedging logic.

---

## Data Model Changes

Add settlement allocation dual-currency fields (migration, additive):

1. `cari_settlement_allocations.allocation_amount_doc_txn`
2. `cari_settlement_allocations.allocation_amount_settlement_txn`
3. `cari_settlement_allocations.document_currency_code`
4. `cari_settlement_allocations.settlement_currency_code`
5. `cari_settlement_allocations.applied_cross_rate`
6. `cari_settlement_allocations.cross_rate_source`
7. `cari_settlement_allocations.cross_rate_date`

Keep and continue using base amount:

1. `allocation_amount_base`

---

## FX & Conversion Policy

Per settlement apply:

1. Resolve settlement->functional rate (existing policy, exact/fallback/requested).
2. Resolve settlement->document rate:
   - direct rate if available.
   - derived via functional currency if direct not available.
3. Apply deterministic rounding policy at line level and enforce batch-level residual tolerance.

---

## Posting Rules

1. Continue AR/AP control-offset accounting model.
2. Base posting uses computed settlement base amount (not implicit parity).
3. Realized FX remains computed as:
   - settlement-base-applied minus historical-base-relieved.
4. Reversal posts exact inverse using persisted rates/amounts from original settlement.

---

## UX Requirements

Settlement Apply page:

1. Show `Document Currency` and `Settlement Currency` explicitly.
2. Show conversion preview columns:
   - Open amount (document currency)
   - Apply amount (settlement currency)
   - Equivalent document amount
   - Cross rate + source/date
3. Validate and message clearly when FX rate is missing.
4. Keep manual allocation workflow with dual-currency display.

---

## PR Sequence

1. `PR-MCS01` - Schema foundation for dual-currency allocations + read contracts.
2. `PR-MCS02` - FX resolver extension for settlement/document cross-rate.
3. `PR-MCS03` - Apply/reverse engine upgrade + linked cash base correctness.
4. `PR-MCS04` - Frontend settlement UX for dual-currency allocation preview.
5. `PR-MCS05` - Reports, reconciliation checks, and release gate coverage.

---

## Test Artifacts (Planned)

1. `backend/scripts/test-cari-mcs01-schema-allocation-dual-currency.js`
2. `backend/scripts/test-cari-mcs02-fx-cross-rate-resolution.js`
3. `backend/scripts/test-cari-mcs03-apply-reverse-multi-currency.js`
4. `backend/scripts/test-cari-mcs04-cash-linked-base-and-status.js`
5. `backend/scripts/test-cari-mcs05-reporting-reconcile-multi-currency.js`
6. `backend/scripts/test-cari-mcs-release-gate.js`

`backend/package.json` additions:

1. `test:cari:mcs`
2. `test:cari:mcs-release-gate`

---

## Acceptance Criteria

1. All 4 document/settlement currency combinations post and reverse correctly.
2. Linked cash transaction and settlement base amounts reconcile under foreign-currency entities.
3. Allocation history is auditable with dual-currency amounts and persisted cross-rate metadata.
4. Reports show original vs reversal and dual-currency values without ambiguity.
5. Release-gate scripts pass idempotently.

---

## Rollout Notes

1. No feature flag required (production-ready target behavior).
2. Add migration/backfill guards for existing same-currency settlement rows.
3. Include one-time consistency check script for linked cash vs settlement base reconciliation.
