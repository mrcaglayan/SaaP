# Track 51 – Post-Implementation Gap Analysis

> Generated 2026-04-01 against the living codebase.
> Cross-referenced with 51-MIZAN-DEFTER-I-KEBIR-MUAVIN-ROADMAP.md,
> 51-PROMPT-A.md, 51-PROMPT-B.md, and 51A-FOUNDATIONAL-IMPLEMENTATION-TRACKER.md.

---

## Priority Legend

| Tag | Meaning |
|-----|---------|
| **P0** | Data-integrity / enforcement gap – silent corruption possible |
| **P1** | Governance / correctness gap – wrong results under specific conditions |
| **P2** | Design smell / tech-debt – no immediate data risk but future hazard |

---

## 1. P0 – Unguarded Posting Services (Post-Lock Enforcement)

**RP08 enforcement coverage is incomplete.** The roadmap and 51A tracker explicitly list
13 services as "deferred" for close-pack enforcement. Six of those services create
`POSTED` journal entries via direct `INSERT INTO journal_entries` without calling
`assertLocalClosePackPostingAllowedForLines` or `assertLocalClosePackJournalActionAllowed`.

This means a user can post financial transactions into a period/OU scope that has been
APPROVED or LOCKED, silently breaking the close-pack integrity guarantee.

### Affected services

| # | Service file | Posting path | Line | Action type |
|---|-------------|-------------|------|-------------|
| 1 | `cari.settlement.service.js` | `insertPostedJournalWithLinesTx` (local copy) | ~2078 | POST_SETTLEMENT_JOURNAL |
| 2 | `cari.settlement.service.js` | Settlement reversal (calls same function) | ~6935 | POST_SETTLEMENT_REVERSAL_JOURNAL |
| 3 | `cash.fx.revaluation.service.js` | `createSystemJournalTx` | ~863 | POST_CASH_FX_REVALUATION_JOURNAL |
| 4 | `cash.fx.revaluation.service.js` | Auto-reversal (calls same function) | ~1077 | (covered by #3) |
| 5 | `bank.reconciliationAutoPosting.service.js` | Direct INSERT | ~498 | POST_BANK_AUTO_RECONCILIATION_JOURNAL |
| 6 | `bank.reconciliationDifferences.service.js` | Direct INSERT | ~334 | POST_BANK_DIFFERENCE_JOURNAL |
| 7 | `org.capital-fulfillment.service.js` | `insertJournalForCapitalFulfillmentTx` | ~882 | POST_CAPITAL_FULFILLMENT_JOURNAL |
| 8 | `payroll.corrections.service.js` | `reverseJournalTx` | ~283 | POST_PAYROLL_REVERSAL_JOURNAL |

### Root cause

`insertPostedJournalWithLinesTx` is **copy-pasted** across 4 services instead of being
a single shared utility. Three copies (inventory, cari.document, revenue-recognition)
have the enforcement guard; one (cari.settlement) does not. The remaining services have
completely separate INSERT statements with no guard at all.

### Resolution

Add `assertLocalClosePackPostingAllowedForLines` calls before each INSERT, following
the same pattern used in `cari.document.service.js:3214`.

**Status: FIXED** – Guards added to all 6 services in this PR.

---

## 2. P0 – `insertPostedJournalWithLinesTx` Code Duplication

Four services maintain independent copies of the same ~60-line function:

1. `inventory.service.js` (guarded)
2. `cari.document.service.js` (guarded)
3. `revenue-recognition.service.js` (guarded)
4. `cari.settlement.service.js` (was unguarded, now fixed)

Each copy drifts independently. When enforcement was added (RP08), only 3 of 4 copies
were updated. This will happen again with any future cross-cutting concern.

### Recommendation

Extract into a shared `gl.journal-posting.service.js` utility that all 4 services import.
This is a P2 refactor but prevents future P0 regressions.

**Status: DEFERRED** – Tracked as tech-debt for a future PR.

---

## 3. P1 – REVREC Continuity Silently Passes When Next Period Missing

**File:** `revrec.year-end-review.service.js:222-238`

When `loadNextFiscalPeriod()` returns `null` (next fiscal period doesn't exist yet),
the function returns `applicable: false` with **zero blocking rows**. The close-pack
workflow therefore sees no REVREC blockers and allows APPROVE/LOCK.

### Business impact

An operator can approve and lock a year-end pack before the next fiscal year is set up
in the calendar. The carry-forward continuity check (the whole point of the REVREC
gate) is silently skipped.

### Recommendation

When `nextPeriod` is null for a year-end period (period_no = 12 or last period in
calendar), return at least one blocking row with reason code
`NEXT_FISCAL_YEAR_NOT_CONFIGURED` instead of `applicable: false`.

**Status: OPEN** – Requires business-rule decision on whether mid-year periods
should also block.

---

## 4. P1 – Balance Sheet Entity Scope Leak

**File:** `gl.statement-report.service.js` (balance sheet query)

The balance sheet WHERE clause uses:

```sql
(c.legal_entity_id IS NULL OR c.legal_entity_id = ?)
```

If two legal entities share the same chart of accounts and some chart rows have
`legal_entity_id IS NULL` (shared/template rows), balances from entity A's postings
against those shared accounts will appear in entity B's balance sheet.

### Business impact

Overstated or mixed balances on single-entity financial statements when entities share
a chart. The consolidation layer may mask this, but standalone entity reports are wrong.

### Recommendation

The balance query should join through `journal_entries.legal_entity_id` (the posting
entity) rather than relying on chart-of-accounts ownership to scope balances.

**Status: OPEN** – Requires investigation into how shared charts are used in
production data.

---

## 5. P1 – Year-End Close Exclusion Uses Fragile Pattern Matching

**File:** `gl.statement-report.service.js`

Year-end P&L close entries are excluded from the income statement via:

```sql
reference_no LIKE 'PERIOD_CLOSE_RUN:%' AND description LIKE 'Auto year-end P&L close%'
```

If the close-run service changes its reference format or description text, the
exclusion silently breaks and P&L close entries double-count.

### Recommendation

Use `source_type = 'YEAR_END_CLOSE'` or a dedicated journal flag rather than
string-pattern matching on user-visible fields.

**Status: OPEN** – Low probability but high impact if triggered.

---

## 6. P1 – Balance Epsilon Inconsistency

Three different tolerance values are used across the system for "is this amount zero":

| Constant | Value | Used in |
|----------|-------|---------|
| `AMOUNT_EPSILON` | 0.000001 | CARI settlement reconciliation |
| `BALANCE_EPSILON` | 0.0001 | Statement reports, consolidation gate |
| `BALANCE_MATCH_TOLERANCE` | 0.01 | REVREC continuity check |

### Business impact

The REVREC continuity check (0.01) is 100x more tolerant than the consolidation
gate (0.0001). A carry-forward mismatch of 0.005 passes the REVREC gate but would
fail the consolidation balance check. This creates a scenario where local close
succeeds but consolidation finalize fails with no actionable drill-down.

### Recommendation

Standardize on a single `BALANCE_MATCH_TOLERANCE` constant (suggest 0.0001) exported
from a shared module. REVREC tolerance can remain wider if there's a documented
business justification.

**Status: OPEN** – Needs tolerance alignment decision.

---

## 7. P1 – Consolidation Gate Dead Code Branch

**File:** `consolidation.review-gate.service.js:527`

```javascript
nextStatus: currentStatus === "LOCKED" ? "LOCKED" : "LOCKED"
```

Both branches return the same value. This is either:
- Dead code from an incomplete refactor (there was supposed to be a different target
  status for non-LOCKED current statuses), or
- Intentional (always LOCKED) and the ternary should be simplified.

### Recommendation

Simplify to `nextStatus: "LOCKED"` if intentional. If not, determine the correct
non-LOCKED branch.

**Status: OPEN** – Cosmetic but signals possible logic gap.

---

## 8. P2 – Entity Readiness States Partially Implemented

**File:** `entity.close-readiness.service.js`

Seven entity readiness states are defined in `local.close-packs.shared.js`:

```
NOT_READY, PARTIALLY_READY, READY_FOR_ENTITY_REVIEW,
ENTITY_IN_REVIEW, ENTITY_APPROVED, ENTITY_LOCKED, REOPENED
```

Only 4 are actually derivable today (`NOT_READY`, `PARTIALLY_READY`,
`READY_FOR_ENTITY_REVIEW`, `REOPENED`). The remaining 3 (`ENTITY_IN_REVIEW`,
`ENTITY_APPROVED`, `ENTITY_LOCKED`) require an entity-close workflow that does not
exist.

### Business impact

No immediate risk – the states are defined but never returned. However, downstream
consumers (consolidation gate, UI) may expect these states and behave incorrectly
when they never appear.

### Recommendation

Document explicitly in the enum that these states are reserved for a future
entity-close workflow. Consider removing them from the enum until implemented.

**Status: OPEN** – Design decision needed.

---

## 9. P2 – Current-Year Result Account Codes Hardcoded

**File:** `gl.statement-report.service.js`

Current-year result is calculated using hardcoded Turkish Tekdüzen Hesap Planı
code prefixes: `590`, `591`, `690`, `692`.

If a tenant uses a custom chart with different equity classification codes, the
balance sheet current-year result row will be zero and the BS equation delta
will flag a false positive imbalance.

### Recommendation

Make the current-year result code bands configurable per chart-of-accounts or
derive from an account attribute (e.g., `account_category = 'CURRENT_YEAR_RESULT'`).

**Status: OPEN** – Only affects non-standard Turkish charts (low priority).

---

## 10. P2 – Draft Journals in Locked Scope (Catch-22)

**Files:** `gl.reclass.routes.js:378, 1015`

The reclass service creates DRAFT journals that are not blocked by close-pack
enforcement (enforcement only blocks POSTED status). However, once the scope is
LOCKED, the draft cannot be submitted/posted without a reopen request.

### Business impact

Orphaned draft journals accumulate in locked periods. No data corruption, but
creates operational confusion and stale draft cleanup burden.

### Recommendation

Either:
1. Block DRAFT creation in APPROVED/LOCKED scopes, or
2. Add a "draft cleanup" step to the close-pack workflow that warns about
   pending drafts before APPROVE.

**Status: OPEN** – UX decision.

---

## 11. P2 – Report Fingerprinting Architecture Split

**Roadmap lock SDL-09** specifies frontend SHA-256 fingerprints for all local
reports but server-side persisted snapshots only for consolidated member-support
detail.

The current implementation follows this split, but it means:
- Local report integrity depends entirely on the frontend (no server-side audit trail)
- If a user clears browser storage, the fingerprint history is lost
- Consolidated snapshots have server-side persistence but local reports do not

### Recommendation

Consider persisting local report fingerprints server-side as well, at least for
reports that are referenced by close-pack review checkpoints.

**Status: OPEN** – Architecture trade-off, not a bug.

---

## 12. P2 – Track 41 (Landed-Cost Voucher) No Conflict

**File:** `inventory.service.js` (already guarded)

Track 41 uses `insertPostedJournalWithLinesTx` from `inventory.service.js` which
IS guarded. No enforcement conflict exists.

**Status: NO ACTION REQUIRED**

---

## Summary Matrix

| # | Severity | Category | Status |
|---|----------|----------|--------|
| 1 | P0 | Enforcement gap (6 services) | **FIXED** |
| 2 | P0 | Code duplication risk | DEFERRED |
| 3 | P1 | REVREC governance gap | OPEN |
| 4 | P1 | Balance sheet scope leak | OPEN |
| 5 | P1 | Fragile pattern matching | OPEN |
| 6 | P1 | Epsilon inconsistency | OPEN |
| 7 | P1 | Dead code branch | OPEN |
| 8 | P2 | Partial enum implementation | OPEN |
| 9 | P2 | Hardcoded account codes | OPEN |
| 10 | P2 | Draft catch-22 | OPEN |
| 11 | P2 | Fingerprint persistence | OPEN |
| 12 | — | Track 41 cross-check | NO ACTION |
