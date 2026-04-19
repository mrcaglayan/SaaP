# PR-67 - AP/Cari Draft + Approved/Post-Ready Work Queues Plan

## Context

Current repo behavior is internally consistent, but the UX is easy to misread:

- `/app/mahsup-islemleri` reads actual `journal_entries` history only.
- Some modules, such as shareholder commitment, create real `journal_entries` in `DRAFT` status immediately, so those items do appear in journal history.
- Governed AP/Cari document `DRAFT` rows are business documents, not GL journals.
- Governed AP metadata does not always mean active workflow governance at runtime. If no assignment is resolved for the current scope, the current gradual-rollout model still lets the document direct-post as a normal draft.
- Governed AP/Cari documents move to `APPROVED` after workflow approval when the workflow definition includes an explicit `APPROVE` stage.
- Some governed AP/Cari workflows can also move from `SUBMIT` directly to the explicit `POST` step, leaving the document `SUBMITTED` but already ready for posting.
- No GL journal row is created when a document becomes `APPROVED` or otherwise reaches the explicit `POST` step.
- The GL journal is created only when the user runs the explicit post action, and it is inserted directly as `POSTED`.

So an AP/Cari document can be:

- draft and waiting for submit
- returned and waiting for correction / resubmit
- submitted and waiting for approval
- approved and waiting for explicit post
- submitted but already waiting for explicit post in a `SUBMIT -> POST` workflow
- waiting for accounting post
- absent from GL journal history

That is closer to real ERP behavior than it may look at first. Mainstream ERP products typically keep subledger document work in dedicated document queues or parked-document workbenches, not inside normal GL journal history.

---

## Locked product decision

PR-67 should implement the ERP-aligned option and reject the tempting shortcuts.

### We will do

- Keep `/app/mahsup-islemleri` as real GL journal history only.
- Add dedicated AP/Cari business-document work queues on the AP documents surface.
- Split the queues by operational state:
  - `Needs Submit`
  - `Ready to Post`
- Keep the existing explicit-post lifecycle for governed AP documents, including both `APPROVED -> POSTED` flows and workflow definitions that go directly `SUBMIT -> POST`.
- Preserve the current direct-post fallback for governed AP drafts whose scope has no active workflow assignment.

### We will not do

- We will **not** show AP/Cari business-document drafts as fake GL draft journals in journal history.
- We will **not** show approved or otherwise post-ready AP/Cari documents as fake GL draft journals in journal history.
- We will **not** create synthetic `journal_entries` draft rows at workflow approval time.

This avoids duplicate truth, keeps reversal/accounting semantics clean, and matches the current backend design.

---

## Scope

### In scope for PR-67

- AP governed CARI documents that are still in draft/correction state and need submit
- AP governed CARI documents that are post-ready and still waiting for explicit post, including approved rows and any `SUBMITTED` rows already at the explicit `POST` step
- UI clarity so users understand why those items are not in journal history
- first-class AP/Cari work queue/workbench entry points
- additive backend queue filtering needed to make those queues authoritative
- explicit carve-out for governed AP drafts that are still using the current no-assignment direct-post fallback

### Explicit first-PR boundary

PR-67 is AP-first. It does not redesign every subledger posting surface.

### Out of scope for PR-67

- AR posting queue
- submitted-pending-approval queue redesign
- cross-module unified pending-accounting inbox
- new DB lifecycle states
- automatic journal draft creation on approval
- changing pre-close review to mix AP approved or otherwise post-ready docs into GL draft review

---

## Current behavior to preserve

The following behavior is correct and should remain true after this PR:

- `DRAFT` and `RETURNED` AP/Cari documents are still business documents, not GL journals.
- `APPROVED` AP/Cari documents are still business documents, not GL journals.
- Governed AP rows whose effective workflow gate is already at `POST` may still be `SUBMITTED` or `APPROVED` until explicit posting, depending on workflow definition.
- `POSTED` is still the event that creates the GL journal and fills `posted_journal_entry_id`.
- `mahsup-islemleri` still lists only actual `journal_entries`.
- GL pre-close review still means unposted GL drafts, not subledger documents waiting for post.
- Governed AP drafts with no active workflow assignment remain direct-post candidates under the current gradual-rollout behavior.
- Governed AP `RETURNED` rows that no longer resolve an active assignment remain correction items, not direct-post fallback candidates.

PR-67 is a visibility and work-queue improvement, not an accounting-engine redesign.

---

## Recommended implementation shape

## 1) Add a first-class `Needs Submit` queue on the AP CARI documents surface

The cleanest implementation is backend-authoritative on queue membership and frontend-led on queue entry points.

The AP documents page can remain the UX home, but queue inclusion, counts, and paging must be owned by the backend contract rather than inferred after a mixed list response is already fetched.

### Queue definition

The queue should show:

- governed AP documents only
- `governed` here means the same runtime rule the submit/post flows already use, including the shared AP doc-class governance fallback when persisted metadata rows are absent
- active workflow assignment resolved for the current scope
- `direction = AP`
- `status IN (DRAFT, RETURNED)`

That is already the operational meaning of:

- document preparation still in progress
- or correction/resubmission is required before the workflow can proceed

Explicit carve-out:

- governed AP `DRAFT` rows with `assignmentResolved = false` are not part of `Needs Submit`
- those rows stay on the normal AP workbench and continue to follow the current direct-post fallback

No new database columns are required for PR-67.

### Queue contract

This queue must not rely on a single `status` filter plus client-side guesswork.

For PR-67, `Needs Submit` should use one explicit scalar queue contract:

- required: a backend `workQueue=NEEDS_SUBMIT` alias

The queue should also be governed-aware on the backend so pagination and counts stay correct. Client-side filtering after fetch is not sufficient once governed and non-governed AP rows are mixed together.

The queue should also be assignment-aware on the backend so direct-post fallback drafts are not incorrectly mixed into `Needs Submit`.

Queue membership for draft/correction work must be evaluated against the document's current scope, not only the last persisted workflow-instance routing snapshot.

In particular:

- `RETURNED` rows must re-check whether a live active assignment still resolves for the document's current scope after edits or scope changes
- persisted workflow snapshots may still power explainability, but stale snapshot routing alone must not be enough to keep a row in `Needs Submit` or imply that resubmit will succeed
- if a `RETURNED` row no longer resolves an active assignment, it must leave `Needs Submit`
- PR-67 does not convert that returned/no-assignment row into a direct-post candidate; it stays on the normal AP surface as a correction item until routing is fixed and resubmit becomes valid again

This queue rule also needs to stay aligned with the shared workflow-gate surface used by list badges, detail explainability, and submit affordances.

That alignment must include the submit mutation path itself, not only queue membership and UI explainability.

In particular:

- PR-67 must align effective submit-governance evaluation with the same runtime governed-AP fallback semantics used by queue membership and shared workflow-gate enrichment
- `Needs Submit` must not surface rows that the existing submit action would still reject as non-governed solely because persisted metadata rows are absent
- if the team intentionally keeps a narrower persisted-metadata-only submit contract, the queue definition itself must narrow to match that contract instead of advertising a broader runtime-governed submit surface

For `RETURNED` rows:

- the same live current-scope assignment result that decides queue membership must also drive the effective `assignmentResolved` / resubmit-available frontend surface state
- persisted routing snapshots may still be shown as historical context, but they must not leave the detail panel or row explainability implying that resubmit is currently available after the row has already left `Needs Submit`

The service-level queue predicate must run before the returned `total`, `limit`, and `offset` are finalized. A page-limited mixed fetch followed by post-fetch queue filtering is not authoritative.

Because `assignmentResolved` is derived in service workflow-gate enrichment today, the implementation may need a two-phase backend pass:

- first narrow to visible AP candidate rows by normal scope filters, governed doc-class, and `status IN (DRAFT, RETURNED)`
- then resolve queue membership for those candidates using live current-scope assignment resolution for rows that still need submit
- then compute queue `total` and apply final `limit` / `offset`

Current list behavior also enriches workflow gate state after row fetch, so PR-67 should avoid turning queue membership into an unbounded per-row workflow-resolution tax on larger AP pages.

For implementation hardening:

- batch or cache live assignment / workflow-gate resolution where practical so queue totals and page fetches do not regress into avoidable N+1 behavior
- make queue ordering explicit instead of inheriting it accidentally from the current generic list path
- for PR-67, keep both AP queue presets on a stable newest-first ordering family to match the current document workbench expectation, with `id DESC` as the safe default tie-breaker unless a separate aging sort is explicitly approved later

For PR-67, do not widen the route around ad hoc multi-status arrays as the primary queue state. A scalar `workQueue` preset aligns better with query params, saved views, and backend-authoritative pagination.

Queue preset state also needs explicit precedence rules so the existing persisted filters and saved-view hydration do not silently override queue intent:

- when a queue preset is activated, force `direction = AP`
- when a queue preset is activated, clear incompatible raw `status` filter state instead of layering `workQueue` on top of stale status values
- on initial page load, explicit query-param `workQueue` takes precedence over default saved-view hydration and other persisted filter state
- when a saved view includes `workQueue`, hydrate that scalar queue state directly rather than combining it with incompatible pre-existing filter state

`workQueue` is AP-only for PR-67:

- fixed AR routes must ignore or clear `workQueue` and fall back to the normal AR document list
- saved views applied on AR routes must not leave the page stranded on an AP-only queue preset
- the backend should reject `workQueue` with `400` when the effective direction is not AP, rather than returning a misleading mixed or empty queue
- when `workQueue` is present, the backend must not silently intersect it with contradictory raw `status` values; contradictory combinations should return `400`, while redundant matching state may be normalized away by documented precedence

### Queue placement

Use the AP CARI workbench as the primary home for this queue, not the GL journal page.

Recommended surface:

- add a built-in queue preset or pinned view at the AP documents page
- label it `Needs Submit`

This can be implemented as:

- a prominent preset chip/filter
- a built-in saved view
- or a top-of-page queue card that applies the filter automatically

### Queue row content

Each row should show:

- document no
- counterparty summary
- legal entity
- operating unit
- document date
- amount / currency
- workflow gate badge
- current draft/correction state
- queue blocking reason when submit is currently unavailable; if the full reason depends on selected-detail context, keep the row visible and surface the complete explanation in the detail panel
- action buttons

### Queue actions

Primary actions:

- `Open detail`
- `Submit`
- `Resubmit` for returned items

Secondary behavior:

- after successful submit, the item leaves this queue
- if it later returns for correction, it re-enters this queue
- rows may stay visible but show disabled `Submit/Resubmit` actions when the user lacks the required permission or is otherwise view-only for that queue row
- PR-67 does not require a separate queue-only submit lifecycle; selecting the row and using the existing detail submit action is acceptable
- governed AP drafts with no active resolved assignment stay outside this queue and should not be presented as if they are waiting for submit

---

## 2) Add a first-class `Ready to Post` queue on the AP CARI documents surface

### Queue definition

The queue should show:

- governed AP documents only
- `governed` here means the same runtime rule the submit/post flows already use, including the shared AP doc-class governance fallback when persisted metadata rows are absent
- `direction = AP`
- the effective workflow gate is already at the explicit `POST` step under the same evaluation rules the current post flow uses
- `status IN (SUBMITTED, APPROVED)`
- `posted_journal_entry_id IS NULL`
- no real posted journal exists yet
- when a post-ready document already has persisted workflow-instance routing, that persisted route remains sufficient for queue membership if the current post flow would still allow posting through it

That is already the operational meaning of:

- workflow approval is complete, or the workflow definition routes directly from submit to posting
- explicit posting still pending

No new database columns are required for PR-67.

### Queue contract

This queue should also be authoritative at the backend contract level.

Use one explicit scalar queue contract:

- `workQueue=READY_TO_POST`

It should stay workflow-gate-aware so the queue represents governed AP posting work that has already reached the explicit `POST` step, not draft direct-post fallback rows.

Queue membership must stay consistent with the current governed-AP post gate:

- only governed AP rows
- only `status IN (SUBMITTED, APPROVED)`
- only rows whose effective workflow gate is already at the explicit `POST` stage under the same evaluation rules the current post flow uses
- only rows with no linked posted journal yet; `posted_journal_entry_id` hard-excludes the row even if stale status or workflow data would otherwise match

The "effective workflow gate is at POST step" check must be implemented as a shared helper (e.g. `isDocAtExplicitPostStep`) in `cari.document.workflow.runtime.service.js`, using the same step-traversal logic the current post flow already uses (`findFirstApWorkflowStepByAction`, `resolveApWorkflowRuntimeStepContext`). Queue membership and post-flow explainability must call this same helper so the two surfaces cannot disagree.

Persisted post-stage instance routing remains valid for queue membership when the current post flow already relies on it after the document reaches the explicit `POST` step. `Ready to Post` must not disappear rows solely because a fresh live assignment lookup no longer resolves after approval or after a direct `SUBMIT -> POST` transition unless PR-67 is also changing posting behavior.

Rows may remain visible when posting is blocked by permission or posting readiness. Rows that are not postable under the current effective gate do not belong in this queue.

As with `Needs Submit`, the backend must apply the queue predicate before returned `total`, `limit`, and `offset` are finalized. A mixed post-ready-doc page plus post-fetch correction is not authoritative.

### Queue placement

Use the AP CARI workbench as the primary home for this queue, not the GL journal page.

Recommended surface:

- add a built-in queue preset or pinned view at the AP documents page
- label it `Ready to Post`

This can be implemented as:

- a prominent preset chip/filter
- a built-in saved view
- or a top-of-page queue card that applies the filter automatically

### Queue row content

Each row should show:

- document no
- counterparty summary
- legal entity
- operating unit
- document date
- amount / currency
- workflow gate badge
- posting readiness signal
- queue blocking reason when post is currently unavailable; if the full blocker depends on post-form or line-level analysis, keep the row visible and surface the complete blocker in the selected detail panel
- action buttons

### Queue actions

Primary actions:

- `Open detail`
- `Post` via the existing detail-panel post flow

Secondary behavior:

- PR-67 does not require a new one-click inline posting contract or a queue-specific posting modal
- an inline `Post` button is optional only if it routes into the existing post flow rather than inventing a second payload shape
- after successful post, the row leaves the queue
- the posted journal link becomes available through existing behavior
- rows may stay visible but show disabled `Post` actions when posting readiness is blocked or the user lacks the required permission

---

## 3) Make the draft/correction and post-ready-not-posted states explicit in document detail

Today the data model already distinguishes these cases, but the UX does not explain them clearly enough.

For an AP governed document with:

- `status = DRAFT` or `status = RETURNED`
- no GL journal yet

show an informational banner in the document detail/submit panel:

- this is a business-document draft or correction item
- it is not yet a GL journal draft
- it will not appear in GL journal history unless a real journal is later created by posting

For a governed AP `DRAFT` row with no active workflow assignment resolved for the current scope, show a distinct informational banner instead of a dead-end submit affordance:

- workflow submit is not currently available because no active assignment matches this document scope
- this row is not part of the `Needs Submit` queue
- it remains on the normal AP workbench and continues to follow the existing direct-post fallback

For a governed AP `RETURNED` row whose current scope no longer resolves an active workflow assignment, show a different informational banner:

- this document is still a correction item, but resubmit is currently unavailable because no active assignment matches its current scope
- this row is not part of the `Needs Submit` queue until workflow routing resolves again
- PR-67 does not convert this returned/no-assignment case into a direct-post fallback path
- the user can continue correction work, but workflow assignment or scope must be fixed before resubmit can succeed

That same returned/no-assignment rule must drive the queue, the list-row explainability, the detail banner, and the submit button state together:

- PR-67 should not stop at queue filtering while stale shared workflow-gate enrichment still tells the user resubmit is available
- once the row leaves `Needs Submit`, the detail surface must also stop presenting it as immediately resubmittable

For an AP governed document with:

- no posted journal yet
- an effective workflow gate already at the explicit `POST` step, including the common `status = APPROVED` case and any `status = SUBMITTED` row in a `SUBMIT -> POST` workflow

show an explicit informational banner in the document detail/post panel:

- this document is ready for explicit posting
- it may already be approved, or it may have reached posting directly from submit under its workflow definition
- it is waiting for explicit posting
- it will not appear in GL journal history until posted

For post-ready rows, shared explainability should stay aligned with the same effective post gate the current post flow uses:

- PR-67 must not add a stricter live assignment re-check in detail explainability that would disagree with `Ready to Post` or hide rows the current post flow still allows
- shared labels should prefer a neutral post-ready phrase such as `Ready to Post` rather than hard-coding `Approved / Waiting for posting` across surfaces that also cover direct `SUBMIT -> POST` flows

This removes the current confusion without changing accounting behavior.

The workflow explainability wording should also be tightened from generic state labels to something closer to:

- `Draft / Needs submit`
- `Returned / Needs correction`
- `Ready to Post`

That wording is more faithful to the runtime model.

---

## 4) Add a clarity note in `mahsup-islemleri`

The GL journal workbench should help users understand the split instead of silently letting them assume data is missing.

Add a small informational note or empty-state helper on the history area:

- AP/Cari document drafts are not GL journal drafts
- post-ready AP/Cari documents waiting for explicit post are not GL draft journals
- manage them from the AP/Cari `Needs Submit` or `Ready to Post` queues

Important:

- do not union AP/Cari documents into the journal history query
- do not change the meaning of journal history filters

This is a UX explanation only.

---

## 5) Required additive backend queue contract and server-driven pagination

PR-67 does not require a backend redesign, but it does require an additive backend queue contract because the queues are meant to be authoritative.

The list API should expose explicit scalar queue presets:

- `workQueue=NEEDS_SUBMIT`
- `workQueue=READY_TO_POST`

Internally those should resolve to:

- runtime-governed AP using the same governance semantics as submit/post, not raw metadata rows alone
- live current-scope `assignmentResolved = true` + `status IN (DRAFT, RETURNED)` for `Needs Submit`
- runtime-governed AP + `status IN (SUBMITTED, APPROVED)` + the same effective post gate the current post flow uses for `Ready to Post`
- `Ready to Post` rows must also satisfy `posted_journal_entry_id IS NULL`
- for post-ready rows, persisted workflow-instance routing remains sufficient whenever that is what the current post flow already relies on after the document reaches the explicit `POST` step
- when `workQueue` is present, contradictory raw `status` values should be rejected instead of silently combined with queue semantics

This is more than a validator alias. The service must apply queue membership before it returns:

- queue `total`
- queue `limit`
- queue `offset`
- final page rows

What must not happen:

- current single-status API plus client-only filtering
- mixed-list page fetch followed by post-page queue filtering
- client-side pagination by slicing only the current response page

The two-phase backend pass is required for PR-67, not optional:

- fetch the visible governed AP candidate set for the relevant status band
- resolve queue membership with live current-scope assignment rules for `Needs Submit` and the shared `isDocAtExplicitPostStep` helper for `Ready to Post`
- compute queue total from the filtered candidate set
- page the final queue rows

This restructure is necessary because `listCariDocuments` currently resolves workflow-gate state (including `assignmentResolved`) per row after pagination. Queue membership must move before pagination so `total` is authoritative. Live assignment resolution across the pre-page candidate set must be batched or cached to avoid N+1 — per-row serial resolution is not acceptable at this phase.

Submit-path governance must stay aligned with that same queue contract:

- the effective runtime-governed fallback used by `Needs Submit` membership must also be used by the submit mutation path
- a row must not be queue-eligible yet still fail submit solely because the submit path is checking narrower persisted metadata semantics

Queue ordering should also be explicit at the contract level for implementation and QA:

- PR-67 keeps `Needs Submit` and `Ready to Post` on a stable newest-first ordering family rather than leaving queue order implicit
- if no new operational aging sort is approved in this PR, keep the existing newest-first behavior with `id DESC` as the safe default tie-breaker

Frontend state should also treat `workQueue` as a first-class saved-view and query-param field. That keeps queue presets scalar, shareable, and stable across reloads.

`workQueue` must be added to `DEFAULT_FILTERS` as `workQueue: null` so that saved-view serialisation, hydration, and diff logic all include the field consistently. `buildDocumentListQuery` must include `workQueue` in the query object when non-null, and omit it when null so existing non-queue requests are unaffected.

Frontend queue state also needs explicit normalization rules:

- `workQueue` beats default saved-view hydration on first load when the URL explicitly supplies a queue preset
- activating `workQueue` forces AP direction and clears incompatible ad hoc `status` state
- when a user activates a built-in AP queue preset from the page UI, preserve the user's current narrowing filters such as `legalEntityId`, `operatingUnitId`, `counterpartyId`, `dateFrom`, `dateTo`, and `q`; queue activation should replace queue-defining state, not silently wipe unrelated scope/search choices
- activating `workQueue` resets `offset` to `0`
- changing queue-affecting filters while a queue preset is active resets `offset` to `0` before refetch
- AR routes must clear or ignore `workQueue` so the shared AP/AR page controller cannot carry an AP-only queue into the AR surface
- if the team keeps one shared saved-view module for AP and AR, the controller must suppress AP-only queue presets when the active route is AR
- default saved-view hydration should not silently reapply a stale nonzero `offset` when a queue preset is first activated unless the URL explicitly carries that page state
- when the URL explicitly supplies `workQueue`, working-context auto-defaults must not silently inject `legalEntityId`, `operatingUnitId`, `dateFrom`, or `dateTo` unless those same filters are also explicit in the URL or selected saved view
- selecting a document while a queue preset is active must preserve `workQueue` in the URL alongside the existing `documentId` deep-link behavior

Queue pages should use backend-driven pagination state end-to-end. The AP documents page should stop deriving list pages only from `rows.length` when a queue preset is active, and preferably align the general list with the same server-driven pagination model.

If the chosen queue entry surface shows queue cards with counts, those counts must also be authoritative for the same effective filter envelope the card click preserves:

- do not show a global queue count that disagrees with the filtered list the user lands on after clicking the card
- if matching authoritative counts are not available for the preserved narrowing filters, prefer no count over a misleading count

This backend addition should stay additive:

- no schema change
- no status-model change
- no change to posting lifecycle

---

## Files to change

Files marked **[NEW]** must be created. All others are modifications to existing files.

| File | Change |
|------|--------|
| `frontend/src/pages/cari/CariDocumentsPage.jsx` | Wire scalar `workQueue` query-param handling and queue-focused initial state; suppress queue presets when the active route is AR |
| `frontend/src/pages/cari/components/CariDocumentsListSection.jsx` | Add `Needs Submit` and `Ready to Post` entry points, queue callouts, and server-driven pagination UI |
| `frontend/src/pages/cari/hooks/useCariDocumentsListController.js` | Add `workQueue` filter state, saved-view/query-param support, and backend-driven pagination instead of client-only row slicing; on AR routes, clear `workQueue` before fetch |
| `frontend/src/pages/cari/cariDocumentsPageHelpers.js` | Add `workQueue: null` to `DEFAULT_FILTERS` so saved-view serialisation and hydration round-trip the field correctly; include `workQueue` in any saved-view key set |
| `frontend/src/pages/cari/cariDocumentsUtils.js` | Include scalar `workQueue` in `buildDocumentListQuery`; omit it from the query object when null/undefined so existing non-queue requests are not affected |
| `frontend/src/pages/cari/cariWorkflowExplainability.js` | Tighten wording to distinguish `Needs Submit` from `Ready to Post`, including direct `SUBMIT -> POST` flows; use neutral `Ready to Post` label rather than hard-coding `Approved / Waiting for posting` |
| `frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx` | Add business-document draft banner plus post-ready-but-not-posted informational banner and clearer submit/post guidance for detail-routed queue actions |
| `frontend/src/pages/cari/hooks/useCariDocumentPostReverseController.js` | Make no-assignment direct-post fallback guidance explicit and avoid presenting dead-end submit affordances for rows outside `Needs Submit` |
| `frontend/src/pages/JournalWorkbenchPage.jsx` | Add non-blocking help text pointing users to the AP/Cari work queues |
| `backend/src/routes/cari.document.validators.js` | Add scalar `workQueue` parsing with enum validation (`NEEDS_SUBMIT`, `READY_TO_POST`); reject contradictory `status + workQueue` combinations with `400`; reject `workQueue` when the effective direction is not AP (i.e. direction is explicitly `AR`) with `400` |
| `backend/src/services/cari.document.service.js` | Add authoritative two-phase queue filtering inside `listCariDocuments` — phase 1 narrows to governed AP candidates, phase 2 resolves queue membership — both phases must run before `total`, `limit`, and `offset` are computed; batch or cache live assignment resolution across the candidate set to avoid N+1; align submit-path governance with the same runtime-governed fallback semantics used by `Needs Submit`; keep queue ordering explicit (`id DESC` default) |
| `backend/src/services/cari.document.workflow.runtime.service.js` | Add `isDocAtExplicitPostStep(doc, workflowContext)` helper that mirrors the effective post-gate check the current post flow uses; `Ready to Post` queue membership must call this helper so the two surfaces stay in sync |
| `backend/src/routes/cari.document.routes.js` | Extend the list route contract to pass `workQueue` from validated filters into the service |
| `backend/scripts/test-cari-pr67-workqueues.js` **[NEW]** | Cover backend queue membership, returned/no-assignment exit, post-ready membership for both `APPROVED` and direct `SUBMIT -> POST` rows, posted-journal exclusion hardening, backend-driven pagination totals, and submit-path governance alignment for runtime-governed rows |
| `backend/scripts/test-ux-pr67-workqueue-precedence.js` **[NEW]** | Cover `workQueue` URL precedence over default saved view and working-context defaults, filter normalization on queue activation (direction forced, status cleared, offset reset), preserved narrowing filters, and `documentId` + `workQueue` URL coexistence |
| `backend/scripts/test-security-ui4b-ap-runtime-explainability.js` | Extend (do not replace) existing explainability coverage so returned/no-assignment and post-ready rows keep list/detail messaging aligned with queue membership and the current post gate |

---

## Acceptance criteria

1. An AP governed document in `DRAFT` with an active resolved workflow assignment appears in the AP/Cari `Needs Submit` queue.
2. A returned AP governed document with an active resolved workflow assignment appears in the same `Needs Submit` queue.
3. A governed AP draft with no active workflow assignment does not appear in `Needs Submit`; it remains a direct-post fallback candidate under the current gradual-rollout model.
4. Queue governance matching uses the same runtime governed-AP semantics as submit/post, including shared AP doc-class governance fallback when persisted metadata rows are absent.
5. `RETURNED` queue membership is based on live current-scope assignment resolution; stale workflow-instance routing snapshots alone do not keep the row in `Needs Submit`.
6. An AP governed document that is not yet posted appears in the AP/Cari `Ready to Post` queue when its effective workflow gate is already at the explicit `POST` step under the current post-flow rules, including the common `APPROVED` case and any `SUBMITTED` row in a `SUBMIT -> POST` workflow.
7. `Ready to Post` excludes rows that already have a linked posted journal via `posted_journal_entry_id`, even if stale status or workflow data would otherwise match the queue predicate.
8. None of those AP/Cari business-document states appear in `/app/mahsup-islemleri` journal history unless a real `journal_entries` row exists.
9. The document detail panel explicitly explains the difference between a business-document draft and a real GL journal draft.
10. The document detail panel explicitly explains that post-ready rows are still waiting for explicit posting and do not appear in GL journal history until posted.
11. A governed AP `DRAFT` row with no active resolved assignment shows direct-post fallback guidance in detail and is not presented as if it is waiting for submit.
12. A governed AP `RETURNED` row whose current scope no longer resolves an active assignment leaves `Needs Submit`, shows that resubmit is unavailable until routing is fixed, and is not treated as a direct-post fallback candidate.
13. Shared workflow explainability and submit affordances for `RETURNED` rows use the same live current-scope assignment result as queue membership; the list row, detail panel, and queue do not disagree about whether resubmit is currently available.
14. Shared workflow explainability for post-ready rows remains aligned with the existing post gate; PR-67 does not add a stricter live assignment re-check that would hide or block rows the current post flow still allows.
15. Effective submit-path governance uses the same runtime governed-AP fallback semantics as `Needs Submit` queue membership; queue-eligible rows are not rejected by submit solely because persisted metadata rows are absent.
16. Both AP queue presets use an explicit stable newest-first ordering family; queue order is not left to incidental generic-list behavior.
17. `Needs Submit` is fetched authoritatively via backend `workQueue=NEEDS_SUBMIT`; it is not built by client-only filtering over a single-status list response.
18. `Ready to Post` is fetched authoritatively via backend `workQueue=READY_TO_POST`; it is not built by client-only filtering over mixed AP rows.
19. Queue counts and page boundaries remain correct beyond the first page; queue paging is backend-driven, not derived only from `rows.length` on the current response page.
20. Queue preset state round-trips through query params and saved views using scalar `workQueue`.
21. An explicit query-param queue preset takes precedence over default saved-view hydration and stale persisted filter state on initial load.
22. Activating a queue preset clears incompatible raw `status` filter state and forces the effective direction to AP.
23. When `workQueue` is present, contradictory raw `status` values are rejected with `400`, while redundant matching state may be normalized by documented server precedence rather than silently intersected into misleading results.
24. Activating a queue preset or changing queue-affecting filters resets backend `offset` to `0`, unless an explicit paged URL is intentionally being followed.
25. Activating a built-in AP queue preset from the page UI preserves the user's current narrowing scope/date/search filters unless the user explicitly resets them; queue activation does not silently wipe unrelated filter intent.
26. An explicit URL `workQueue` is not silently narrowed by working-context default filters unless those same filters are also explicit in the URL or selected saved view.
27. Selecting a document while a queue preset is active preserves `workQueue` in the URL alongside the existing `documentId` deep-link behavior.
28. AR routes ignore or clear `workQueue`; AP-only queue presets never strand the shared AP/AR page on an empty or misleading AR queue state.
29. Queue rows can remain visible even when action is blocked, and the UI surfaces the blocking reason inline or in the selected detail panel instead of hiding the row.
30. A user with `cari.doc.read` but without `cari.doc.submit` can still see `Needs Submit` queue rows, but cannot submit them.
31. Submitting from `Needs Submit` uses the existing submit flow and existing submit permissions.
32. Posting from `Ready to Post` routes through the existing post flow/detail panel and the existing `cari.doc.post` permission.
33. After successful post, the item leaves the queue and the posted journal link is available through the existing related-journal path.
34. Existing RBAC and data-scope visibility rules remain unchanged; the queues never expand visibility.
35. If queue cards display counts, those counts are authoritative for the same preserved non-queue filter envelope the card click applies, or the cards omit counts rather than showing misleading totals.
36. Focused regression coverage exists for backend queue membership and pagination, submit-path governance alignment, direct `SUBMIT -> POST` ready-to-post membership, posted-journal exclusion hardening, queue URL and saved-view precedence, invalid `workQueue` contract rejection, queue-card/count consistency, and explainability alignment for returned/no-assignment and post-ready rows.
37. No synthetic GL draft journal rows are created by submit or approval.
38. Existing GL pre-close draft review behavior remains unchanged.

---

## QA checklist

- Create or pick a governed AP document in `DRAFT`
- Configure an active workflow assignment for that document scope
- Confirm it appears in `Needs Submit`
- Confirm it does not appear in `mahsup-islemleri` journal history
- Verify a separate governed AP draft with no active workflow assignment does not appear in `Needs Submit` and stays directly postable from the normal document surface
- Verify that same no-assignment draft shows direct-post fallback guidance in detail instead of a dead-end submit queue message
- Submit it into workflow
- Confirm it leaves `Needs Submit`
- Return one document for correction
- Confirm it reappears in `Needs Submit`
- If the returned document can change scope-driving fields, change them so no active assignment resolves and confirm it leaves `Needs Submit`, stops presenting resubmit as currently available, and does not become directly postable
- Confirm that returned/no-assignment case shows correction-only guidance in detail rather than direct-post fallback guidance
- Confirm the list-row workflow badge/explainability and detail submit affordance both reflect the same returned/no-assignment state after the row leaves `Needs Submit`
- Approve it
- Confirm it appears in `Ready to Post`
- If available, test a governed AP workflow definition that goes `SUBMIT -> POST` and confirm a still-`SUBMITTED` document also appears in `Ready to Post` once it reaches the explicit `POST` step
- If feasible, change or disable the matching assignment after the row reaches the explicit `POST` step and confirm `Ready to Post` still follows the existing post-gate semantics rather than disappearing solely because a fresh live assignment lookup no longer resolves
- If feasible, seed or identify a stale row with non-null `posted_journal_entry_id` and confirm it does not appear in `Ready to Post` even if its raw status or workflow data would otherwise look post-ready
- Confirm it does not appear in `mahsup-islemleri` history before post
- Confirm a row with blocked posting readiness still appears, but with a disabled `Post` action and a visible blocking reason inline or in the selected detail panel
- Confirm the detail panel explains why
- Post it
- Confirm it disappears from the queue
- Confirm the related posted journal link works
- Verify a user with `cari.doc.read` but without `cari.doc.post` can see the queue but cannot post
- Verify returned, cancelled, reversed, and already-posted documents do not appear in the wrong queue
- Verify queue totals and paging remain correct when matching rows exceed one page
- Verify queue preset state survives reload/share via query param and survives save/apply via saved view
- Verify an explicit query-param queue preset wins over any default saved view on initial load
- Verify switching into a queue preset clears incompatible raw `status` filter state instead of leaving the page empty or contradictory
- Verify contradictory raw `status` + `workQueue` combinations are rejected with `400` or prevented by the UI according to the documented server contract instead of producing misleading queue results
- Verify a non-AP request carrying `workQueue` is rejected by the backend contract while AR routes in the UI clear or ignore the AP-only queue preset before fetch
- Verify switching queue preset or changing queue-affecting filters resets paging back to the first backend page instead of reusing a stale offset
- Verify activating a built-in AP queue preset preserves intentional narrowing scope/date/search filters already selected on the page instead of silently wiping them
- Verify an explicit URL queue preset is not silently narrowed by working-context default filters unless the URL or selected saved view also carries those same scope/date filters
- Verify selecting a document while a queue preset is active keeps `workQueue` in the URL together with `documentId`
- Verify AR routes ignore or clear `workQueue` and continue to show the normal AR document list
- If queue cards show counts, verify the displayed count matches the resulting queue list under the same preserved narrowing filters, or that the surface omits counts entirely
- Verify a user with `cari.doc.read` but without `cari.doc.submit` can see `Needs Submit` rows but cannot submit
- Verify queue membership matches the same governed AP invoice/debit/credit semantics used by submit/post even if governance is coming from shared default doc-class behavior rather than an explicit metadata row
- Verify a queue-eligible governed AP draft that relies on shared runtime doc-class fallback can actually submit successfully; it must not appear in `Needs Submit` yet fail submit only because the submit path still checks narrower persisted metadata semantics
- Verify a direct `SUBMIT -> POST` governed AP workflow can produce a `Ready to Post` row while the document status is still `SUBMITTED`
- Verify a row with a linked posted journal never remains in `Ready to Post`, even if stale lifecycle data would otherwise match
- Verify both AP queue presets use the documented newest-first ordering family consistently across reloads and pagination boundaries

---

## Automated hardening

PR-67 should add focused regression coverage instead of relying on manual QA only.

Minimum automation:

- backend queue-contract coverage for governed AP queue membership, returned/no-assignment exit, ready-to-post membership for both `APPROVED` and direct `SUBMIT -> POST` rows, posted-journal exclusion hardening, and totals/paging beyond the first page
- backend submit-path coverage proving a `Needs Submit`-eligible runtime-governed AP row does not fail submit solely because persisted metadata rows are absent
- backend contract coverage for invalid `workQueue` combinations, including contradictory `status + workQueue` and non-AP `direction + workQueue`
- frontend/controller precedence coverage for `workQueue` URL precedence over default saved views and working-context defaults
- frontend/controller coverage for activating queue presets while preserving unrelated narrowing scope/date/search filters
- deep-link coverage for `documentId` + `workQueue` URL coexistence on the AP documents page
- queue-card/count coverage if counts are shown, proving the displayed count matches the authoritative filtered queue the user lands on
- explainability coverage proving returned/no-assignment and post-ready rows keep list/detail messaging aligned with queue membership and the current post gate

---

## Deferred follow-ups

These are valid later improvements, but they are not blockers for PR-67:

- dedicated `Pending Approval` queue for `SUBMITTED` AP documents
- dedicated `Direct Post Drafts` queue if no-assignment fallback drafts should later become a first-class work queue
- AR-side `Ready to Post` queue
- tenant-wide `Pending Accounting` inbox across AP, AR, cash, bank, and other subledgers
- optional close/readiness warning for post-ready-but-not-posted AP documents
- dedicated `approved_at` persistence on `cari_documents` if current workflow timestamps are not sufficient for queue aging
- dashboard counters and SLA aging for pending posting workload

---

## Recommendation

Implement PR-67 as a minimal, explicit, backend-authoritative queue workflow:

- keep journal history pure
- make the business-document draft state obvious
- make the post-ready-not-posted state obvious
- add scalar `workQueue` presets on the AP/Cari page
- keep queue membership, counts, and paging authoritative at the backend
- keep `Ready to Post` aligned with the existing effective post gate rather than adding a stricter live assignment re-check
- route `Ready to Post` through the existing detail post flow rather than inventing a second posting UX

That gives users the missing operational visibility without destabilizing the GL journal model.
