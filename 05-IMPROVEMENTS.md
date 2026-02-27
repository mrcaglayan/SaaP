# 05-IMPROVEMENTS

## Scope
Execution tracker for the post-`04-BANKS_AND_PAYROLLS_ESM.md` improvement wave.
Format intentionally matches your checklist style so we can mark items as we ship.

## Baseline Notes (Repo Reality)
- Latest migration is `m066_*`; next new migration must start from `m067_*`.
- Current auth/profile route style is `/me` and `/auth/*`.
- `Exceptions Workbench`, `Jobs`, `Retention`, and much of idempotency are already implemented and should be treated as extension/hardening work, not net-new foundations.

## Execution Tracker (Update As You Implement)
Tag legend: `(hot: yes)` means likely touches conflict-prone files (`AppLayout.jsx`, `sidebarConfig.js`, `messages.js`, `App.jsx`).

### UX + Product Flow (ordered)
- [x] PR-UX01 Working Context Provider (LE/OU/Period) - header + provider foundations (implemented, hot: yes)
- [x] PR-UX02 Apply Working Context defaults on existing pages/forms (implemented, hot: no)
- [ ] PR-UX03 Persist filters/table prefs in local storage hooks (not started, hot: low)
- [ ] PR-UX04 Server-side user context preferences (`/me/preferences`, migration `m067_*`) (not started)
- [ ] PR-UX05 Permissions visible in sidebar (disabled + reason, not hidden) (not started, hot: yes)

- [ ] PR-UX06 Upgrade `Dashboard.jsx` into actionable finance console (not started)
- [ ] PR-UX07 Exception queue tabs + queue counts (backend already returns `summary.by_status`; mostly FE work) (not started)
- [ ] PR-UX08 Add `sla_due_at` + urgency sort (severity already exists in DB/API) (not started)
- [ ] PR-UX09 Exception bulk actions (preferred: backend bulk endpoints; fallback: FE batching with concurrency control) (not started)

- [ ] PR-CORE05 Extend existing backend error envelope + FE centralized toasts/handling (`message` + `requestId` already exists) (partial foundation exists)
- [ ] PR-CORE01 Standardize pagination contracts across modules (partial foundation exists)

- [ ] PR-UX10 Shared `Combobox` component (new `frontend/src/components`) (not started)
- [ ] PR-UX11 Counterparty typeahead in Cari Documents/Settlements (not started)
- [ ] PR-UX12 GL account lookup with searchable API (`q`) + breadcrumb display (not started)
- [ ] PR-UX13-A Inline counterparty create from lookups (API exists; not started)
- [ ] PR-UX13-B Inline payment term create (backend write endpoint required first) (blocked)

- [ ] PR-UX14 Shared lifecycle rules + `StatusTimeline` component (not started)
- [ ] PR-UX15 Apply lifecycle UI to Cari Documents (not started)
- [ ] PR-UX16 Apply lifecycle UI to Cash Transactions/Sessions (not started)
- [ ] PR-UX17 Apply lifecycle UI to Payroll flows (not started)

- [ ] PR-UX18 Deep-link support (`documentId/journalId/exceptionId`) (not started)
- [ ] PR-UX19 Related panel (GL/open items/exceptions/audit) + source-link strategy (blocked by backend linking design)

- [ ] PR-UX20 Evidence storage foundation (DB + adapter + routes) (not started)
- [ ] PR-UX21 Evidence uploader UI + attach to Cari Docs (not started)
- [ ] PR-UX22 Evidence-required policy checks for risky actions (not started)

- [ ] PR-UX23 Shared CSV export helper + list page export actions (not started)
- [ ] PR-UX24 Column chooser + sticky headers + per-page table prefs (not started)
- [ ] PR-UX25 Saved Views (server-side, per-user) (not started)

- [ ] PR-UX26 Smarter defaults in Cari forms (not started)
- [ ] PR-UX27 Cari clone + recurring templates (not started)
- [ ] PR-UX28 Cash transaction templates/presets (not started)

- [ ] PR-UX29 Internal comments v1 (not started)
- [ ] PR-UX30 Mentions + in-app notifications (not started)
- [ ] PR-UX31 Ops status note / blocked reason (not started)

- [ ] PR-UX32 Invite flow (copy-link, no SMTP dependency) (not started)
- [ ] PR-UX33 Password reset token flow (not started)
- [ ] PR-UX34 Tenant feature flags (`tenant_features` + `/me/features`) (not started)
- [ ] PR-UX35 Usage + audit export endpoints/UI (not started)

- [ ] PR-CORE02 Idempotency standardization for remaining risky endpoints (partial foundation exists)
- [ ] PR-CORE03 Optimistic locking (`row_version`) on editable entities (not started)
- [ ] PR-CORE04 Job progress/retry UX on top of H02 jobs engine (partial foundation exists)

## Follow-up RS Tracker (Improvement Scope Only)

### Scope note
Intentional not-yet-implemented placeholders (Stock, Fixed Assets, generic Reports, and period-end placeholder submodules) are excluded from this tracker by request.

### Wiring follow-ups to prevent misses in implemented modules
- [ ] RS-WIRE-01 For each improvement PR, enforce same-PR wiring across:
  `App.jsx route`, `sidebarConfig.js` entry, `messages.js` labels, and related API client wiring
- [ ] RS-WIRE-02 Add a lightweight CI check for new implemented routes so a page cannot ship without sidebar + i18n wiring
- [ ] RS-WIRE-03 Add release-gate smoke coverage for each newly implemented improvement page before marking `[x]`

## Dependency Follow-ups (Non-placeholder blockers)
- [ ] RS-DEP-01 Payment term write API for UX13-B (`POST /api/v1/cari/payment-terms` + permission + frontend client)
- [ ] RS-DEP-02 Source-linking contract for UX19 Related Panel:
  choose minimal contract (`journal_source_links` table OR `source_ref_type` + `source_ref_id` on journals), write links during posting, then ship UI
- [ ] RS-DEP-03 Global frontend error/toast strategy required by CORE05 (`frontend/src/api/client.js` interceptor + UI surface)

## Working Rules While Executing
- Keep additive migrations only, no destructive changes.
- Batch hot-file edits (`AppLayout.jsx`, `App.jsx`, `sidebarConfig.js`, `messages.js`) to reduce merge conflicts.
- Keep route-level permission guards even when adding better UX visibility.
- Add smoke/test scripts per PR as done in Bank/Payroll wave.

## Acceptance + Smoke Placeholders
- [ ] PR-UX02 acceptance: context defaults are applied only to empty fields; user-entered values are never overwritten
  smoke: `backend/scripts/test-ux-prux02-context-defaults.js` (or FE e2e equivalent)
- [ ] PR-UX03 acceptance: filters survive refresh/navigation; reset clears state + storage
  smoke: `backend/scripts/test-ux-prux03-persisted-filters.js` (or FE e2e equivalent)
- [ ] PR-CORE05 acceptance: standardized user-facing error handling + copyable requestId/details
  smoke: `backend/scripts/test-ux-prcore05-error-envelope.js`

## Immediate Next Step
- Continue with `PR-UX03` -> `PR-CORE05`.
- After each merged PR, update this tracker line from `[ ]` to `[x]` with a short `(implemented)` note.
