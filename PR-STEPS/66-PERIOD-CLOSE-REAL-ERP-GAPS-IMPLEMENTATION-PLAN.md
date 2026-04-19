# PR-66 — Period Close Real-ERP Gaps & AP Workflow Fix

## Context
Real ERP/SaaS systems (SAP, Oracle, NetSuite, Dynamics) handle period close differently from the current implementation:
- Period close never blocks on draft journals — it warns but proceeds.
- SOFT_CLOSED periods allow posting with an elevated permission; only HARD_CLOSED is a true seal.
- Pre-close review is a separate proactive step, not a gating blocker.
- Journals stranded in a closed period can be reclassified to the next open period.

This plan brings the app to parity with those behaviors.

---

## Bug Fix (Must Do First)

### BUG-01 — AP Workflow `approval_policies_chk_2` Constraint Violation
**Status:** ✅ Implemented  
**Symptom:** `Check constraint 'approval_policies_chk_2' is violated` on save at `upsertUnifiedWorkflowPolicyMirrorTx`  
**Root Cause:** `resolveWorkflowUnifiedBridgeStepCount` returns `bridgeSteps.length` for AP types, which can be 0 if no APPROVE steps are defined. The DB constraint enforces `step_count >= 1`.  

**Files to change:**
- `backend/src/services/workflows.service.js` — `resolveWorkflowUnifiedBridgeStepCount` (line ~2384) for Option A
- For Option B: validation goes in the **service entry point** (the public `saveWorkflowPolicy` or equivalent function that calls `upsertUnifiedWorkflowPolicyMirrorTx`) — not in `resolveWorkflowUnifiedBridgeStepCount` itself, and not in the route handler

**Option A (DB-safe floor):**
```js
// For AP process types, floor step_count at 1 to satisfy constraint
return Math.max(1, bridgeSteps.length);
```

**Option B (Validation — preferred):**  
In the service entry point, before calling `upsertUnifiedWorkflowPolicyMirrorTx`, check: if process type is AP and `listApWorkflowApproveSteps(steps).length === 0`, throw 400: `"AP workflow must have at least one APPROVE step before saving."` — this is more user-friendly than a silent DB error.

**Recommendation:** Option B — fail fast with a clear message rather than silently coercing the count.

---

## Gap 1 + Gap 5 — SOFT_CLOSED Posting Override + Audit Flag ✅
**Priority:** HIGH — highest real-ERP parity value  
**Effort:** ~half day

### What to build
1. New permission: `gl.journal.post_to_closed_period`
2. Change `ensurePeriodOpen` in `backend/src/routes/gl.js` to `ensurePeriodPostable`:
   - OPEN → always allowed
   - SOFT_CLOSED → allowed only if caller has `gl.journal.post_to_closed_period` permission
   - HARD_CLOSED → always blocked (throw 400)
   - **Signature change required:** current signature is `(bookId, fiscalPeriodId, actionLabel, runQuery)` — new signature needs `userId` added so the function can check the permission. All call sites must pass `userId`.
   - **Permission check pattern:** the codebase uses `requirePermission(...)` as route middleware. For this case, the check must be **inline inside `ensurePeriodPostable`** because the period status is only known at runtime. Use the same internal RBAC utility that `requirePermission` uses — find it in `backend/src/middleware/rbac.js`.
3. Add audit columns to `journal_entries` table:
   - `posted_after_close TINYINT(1) NOT NULL DEFAULT 0`
   - `posted_after_close_at DATETIME NULL`
4. **Where to set `posted_after_close`:** set it in the `UPDATE journal_entries SET status='POSTED', posted_at=NOW(), posted_after_close=1, posted_after_close_at=NOW()` query inside the post handler in `gl.write.journal.routes.js` — only when `ensurePeriodPostable` detected a SOFT_CLOSED period. One clean way: have `ensurePeriodPostable` return a boolean `wasClosedPeriod` so the caller knows whether to set the flag.

### Files to change
| File | Change |
|------|--------|
| `backend/src/routes/gl.js` | Rename `ensurePeriodOpen` → `ensurePeriodPostable`, add `userId` param, SOFT_CLOSED branch with permission check, return `wasClosedPeriod` boolean |
| `backend/src/routes/gl.write.journal.routes.js` | Update all **6** call sites: 5 documented (lines 446, 692, 1009, 1162, 1300) + **1 internal in gl.js at line 1851** — all must pass `userId` |
| `backend/src/migrations/` | New migration file: `ALTER TABLE journal_entries ADD COLUMN posted_after_close ...` |
| `backend/src/constants/permission-rules.js` | Add `gl.journal.post_to_closed_period` with prerequisite `["gl.journal.post"]` |
| `frontend/src/pages/security/roleCatalog.js` | Add permission to `PERIOD_CLOSE_CONTROLLED` and `PERIOD_CLOSE_GROUP_SUPERVISED` roles — **no new role needed**; users already assigned those roles inherit it automatically |

### Migration SQL
```sql
ALTER TABLE journal_entries
  ADD COLUMN posted_after_close TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN posted_after_close_at DATETIME NULL;
```

---

## Gap 2 — Pre-Close Draft Review Endpoint + UI ✅
**Priority:** HIGH — replaces the current "block on draft" non-ERP behavior with proactive review  
**Effort:** ~half day

### What to build
**Backend:** `GET /api/v1/gl/period-closing/:bookId/:periodId/pre-close-review`  
**Permission guard:** `requirePermission("gl.period.close")` — same as the close run endpoint.  
Returns:
```json
{
  "unpostedDrafts": [ { "id", "ref", "description", "amount", "created_by" } ],
  "pendingApprovals": [ { "id", "ref", "step", "assigned_to" } ],
  "unapprovedSubledger": [ { "source", "count" } ]
}
```
**Query guidance:**
- `unpostedDrafts`: `SELECT id, journal_no, description, total_debit_base, created_by_user_id FROM journal_entries WHERE book_id=? AND fiscal_period_id=? AND status='DRAFT'` — **implemented**
- `pendingApprovals`: GL journals do not have their own approval workflow (only AP/Cari documents do). Returns `[]` permanently unless a GL approval layer is added in a future PR.
- `unapprovedSubledger`: deferred — returns `[]` until subledger approval flow is built.

**Frontend:** Collapsible "Pre-Close Review" panel above the "Run Auto Close" button on `JournalWorkbenchPage`. Shows counts with drill-down list. Styled as warning (amber), not blocker (red). Has "Refresh" button. Does NOT prevent clicking Run Auto Close. Add i18n strings to `frontend/src/i18n/messages.js`.

### Files to change
| File | Change |
|------|--------|
| `backend/src/routes/gl.period-closing.routes.js` | Add GET pre-close-review handler with `requirePermission("gl.period.close")` guard |
| `frontend/src/pages/JournalWorkbenchPage.jsx` | Add PreCloseReviewPanel component above Run Auto Close form |
| `frontend/src/api/glAdmin.js` | Add `getPreCloseReview(bookId, periodId)` API helper |
| `frontend/src/i18n/messages.js` | Add labels for panel title, draft count, pending approvals, refresh button |

---

## Gap 3 — Bulk Post / Cancel for Draft Journals ✅
**Priority:** MEDIUM — enables users to resolve draft backlog from the workbench  
**Effort:** ~1 day

> **Implementation note (deviation from original spec):** Dedicated `/bulk-post` and `/bulk-cancel` backend endpoints were not added. During implementation it was found that `runPostJournals` (a frontend per-journal loop over the existing single-post endpoint) was already production-quality: it handles partial failures per entry, collects error messages, and refreshes state. Adding backend bulk endpoints would have duplicated that logic with no correctness or UX benefit. The implemented approach is:
> - **Bulk Post** — pre-existing `runPostJournals` loop + "Post Selected" button (already present)
> - **Bulk Cancel** — new `onBulkCancelSelected` loop using the existing single-cancel endpoint, prompts for a shared cancel reason, reports per-entry failures. Red "Cancel Selected (N)" button added next to "Post Selected".
> - No `bulkPostJournals` / `bulkCancelJournals` API helpers added (not needed — loops call existing helpers directly).

---

## Gap 4 — Reclassify Journal to Next Open Period ✅
**Priority:** MEDIUM — lets drafts stranded in HARD_CLOSED period be moved forward  
**Effort:** ~half day

### What to build
**Backend:** `POST /api/v1/gl/journals/:id/reclassify-period`  
**Permission:** `gl.journal.update`  
Body: `{ targetFiscalPeriodId }` — changes `fiscal_period_id` on a DRAFT journal. Allowed if source period is **SOFT_CLOSED or HARD_CLOSED** (both prevent posting, so reclassify is valid for both) and target period is OPEN. Records original period in `original_fiscal_period_id` for audit.

**Frontend:** "Reclassify to Next Period" action in the journal detail overflow menu. Available only on DRAFT journals where the current period is SOFT_CLOSED or HARD_CLOSED. Add i18n strings to `frontend/src/i18n/messages.js`.

### Files to change
| File | Change |
|------|--------|
| `backend/src/routes/gl.write.journal.routes.js` | Add reclassify-period handler with `requirePermission("gl.journal.update")` guard |
| `backend/src/migrations/` | New migration: `ALTER TABLE journal_entries ADD COLUMN original_fiscal_period_id INT NULL` |
| `frontend/src/pages/JournalWorkbenchPage.jsx` | Add reclassify action in journal detail overflow menu |
| `frontend/src/api/glAdmin.js` | Add `reclassifyJournalPeriod(journalId, targetFiscalPeriodId)` API helper |
| `frontend/src/i18n/messages.js` | Add label for reclassify action and confirmation dialog |

---

## Implementation Order

| # | Gap | Effort | Value | Start When |
|---|-----|--------|-------|------------|
| 1 | BUG-01 AP Workflow fix | 1 hour | Unblocks AP workflow setup | Now |
| 2 | Gap 1 + Gap 5 (SOFT_CLOSED + audit flag) | 0.5 day | Core ERP parity | After BUG-01 |
| 3 | Gap 2 (Pre-close review panel) | 0.5 day | Replaces blocking behavior | After Gap 1 |
| 4 | Gap 3 (Bulk post/cancel) | 1 day | Speeds up draft resolution | After Gap 2 |
| 5 | Gap 4 (Reclassify period) | 0.5 day | Edge case completeness | After Gap 3 |

---

## Acceptance Criteria

- [x] BUG-01: Saving AP workflow with no APPROVE steps returns 400 with `"AP workflow must have at least one APPROVE step"` — no DB constraint error in console
- [x] Gap 1: Posting a journal to a SOFT_CLOSED period succeeds for a user with `gl.journal.post_to_closed_period`; fails with **403** (Forbidden — correct HTTP semantics for a permission denial, not 400) for a user without it
- [x] Gap 5: `posted_after_close = 1` and `posted_after_close_at` populated on journal entries posted into SOFT_CLOSED, including auto-posted reversal journals
- [x] Gap 2: Pre-close review panel shows correct unposted-draft count; `pendingApprovals` and `unapprovedSubledger` return `[]` (GL has no approval workflow; subledger deferred — see query guidance above); Run Auto Close works regardless
- [x] Gap 3: Bulk Post via "Post Selected" button loops single-post calls with per-entry error reporting; Bulk Cancel via "Cancel Selected (N)" button does the same using the single-cancel endpoint with a shared reason prompt
- [x] Gap 4: "Reclassify to Next Period" moves draft from SOFT/HARD_CLOSED period to target OPEN period; `original_fiscal_period_id` preserved

---

## Related Files (Quick Reference)

- `backend/src/routes/gl.js` — `ensurePeriodOpen` (lines ~196–214)
- `backend/src/routes/gl.write.journal.routes.js` — 5 call sites of `ensurePeriodOpen`
- `backend/src/routes/gl.period-closing.routes.js` — close run handler, current gates
- `backend/src/services/workflows.service.js` — `resolveWorkflowUnifiedBridgeStepCount` (~line 2384)
- `frontend/src/pages/JournalWorkbenchPage.jsx` — period close UI (lines 3593–3819)
- `PR-STEPS/65-Close + Consolidation Operating Model.md` — full close cycle architecture
