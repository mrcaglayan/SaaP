# 44 - CARI DOCUMENT WORKBENCH PERFORMANCE AND RERENDER ISOLATION

## Status
- Planned
- Depends on Track 39 (CARI Subledger-Aware Lines and FA Integration) being functionally complete through at least SL25

## Purpose
Harden the CARI document workbench frontend so line entry stays responsive, route-scoped drafts do not leak across canonical AP/AR pages, and unrelated panels do not rerender on every form keystroke.

Today, `frontend/src/pages/cari/CariDocumentsPage.jsx` is a very large page shell that owns list state, create state, edit state, posting state, reverse state, comments, evidence, related drillbacks, and many derived selectors in one component. A single line-description keystroke can invalidate broad parts of the page tree, which makes typing feel slow and causes route-level draft reuse bugs such as purchase-line content appearing on the sales page.

This track is the structural follow-up to the current tactical fixes. The short-term buffered-input and route-reset fixes are valid, but the long-term target is proper render isolation and smaller, bounded state domains.

## Guardrails

1. This is a frontend-only track. No backend services, routes, schema, OpenAPI, posting logic, or runtime contracts should change here.
2. Do not redesign CARI business flows. The work is about state ownership, render boundaries, and responsiveness, not new accounting behavior.
3. Keep canonical routes, permission guards, and existing AP/AR behavior intact.
4. Use existing repo patterns. Avoid introducing a new global state library just for this page.
5. Tactical buffering is allowed for free-text inputs, but the end state should still move toward real component and state isolation.

## Why a Separate Track

1. This is not a new business feature. It is frontend architecture and performance hardening around an already-large workflow.
2. Track 39 solved functional CARI/FA behavior. Mixing deep frontend performance work into that track would blur functional signoff.
3. The problem crosses create, edit, posting, related-detail, comments, evidence, and route-shell behavior. It deserves its own bounded rollout.
4. The work can be shipped incrementally without any API or database changes.

## Current Pain Points

1. `CariDocumentsPage.jsx` is now a very large file and owns too many responsibilities.
2. Top-level `createForm` and `editForm` updates fan out into wide `useMemo` and validation recomputations.
3. Free-text line fields are sensitive to rerender pressure because they currently live inside the page-level draft state model.
4. Fixed-route pages such as `/app/alis-faturalari` and `/app/satis-faturalari` can accidentally share create-draft state if route-scoped resets are not explicit.
5. Detail, evidence, comments, and related panels sit in the same parent component tree as active form typing.
6. Lookup loading and option-extension logic recompute more broadly than necessary.

## Core Design

### State Domain Isolation

Split the page into explicit state domains instead of one giant owner component:

- list and filters
- create draft
- edit draft
- posting form
- reverse form
- related drillback panels
- comments and evidence panels

Each domain should rerender only when its own state changes.

### Row-Level Rendering Contract

Each line row should become its own memoized unit. A change to one line description must not rerender:

- unrelated line rows
- the document list table
- related drillbacks
- evidence and comment panels
- posting and reverse forms

Free-text inputs may keep local draft state and commit upstream on pause or blur when the field does not drive immediate accounting calculations.

### Narrowed Derived Computations

Derived selectors should depend on the smallest possible input slice:

- line-level calculations should depend on `lines`
- payment-term due-date helpers should depend on the payment-term and date fields only
- operating-unit derivation should depend on legal entity and counterparty fields only
- detail-side panels should depend on `selectedDocumentId` and fetched detail state, not create-form typing

### Route-Scoped Draft Lifecycles

Canonical fixed-route pages must own distinct draft lifecycles:

- `/app/alis-faturalari`
- `/app/satis-faturalari`
- `/app/borc-dekontlari`
- `/app/alacak-dekontlari`

Switching between fixed-route directions must never carry line text, counterparty, or line-level subledger context unless the route explicitly supports draft persistence for that path.

### Incremental Extraction

The end state should move `CariDocumentsPage.jsx` toward a page shell plus focused subcomponents/hooks under `frontend/src/pages/cari/`, for example:

- `frontend/src/pages/cari/components/`
- `frontend/src/pages/cari/hooks/`

Possible extractions:

- `DocumentCreateWorkbench.jsx`
- `DocumentEditWorkbench.jsx`
- `DocumentLineWorkbench.jsx`
- `DocumentLineRow.jsx`
- `DocumentRelatedPanels.jsx`
- `useCariDocumentCreateDraft.js`
- `useCariDocumentEditDraft.js`

The exact filenames can adapt during implementation, but the separation of responsibilities should be explicit.

## Execution Tracking

### Master Tracker

| Step | Scope | Status |
|---|---|---|
| **Phase 1 - Baseline and boundaries** | | |
| RI01 | Baseline profiling, rerender map, and acceptance budgets | Not started |
| RI02 | Route-scoped create-draft controller and reset semantics | Not started |
| **Phase 2 - Create-form isolation** | | |
| RI03 | Extract create workbench shell and header state from page root | Not started |
| RI04 | Row-level line component isolation and buffered free-text inputs | Not started |
| RI05 | Narrow create-form derived selectors and validation dependencies | Not started |
| **Phase 3 - Edit and detail isolation** | | |
| RI06 | Mirror workbench isolation for edit draft and posting form | Not started |
| RI07 | Split related, evidence, comments, and ops panels from active form rerenders | Not started |
| RI08 | Lookup loading, option extension, and preview isolation | Not started |
| **Phase 4 - Verification and release** | | |
| RI09 | Smoke and interaction verification using existing repo patterns | Not started |
| RI10 | Release-gate and backward-compatibility verification | Not started |

---

## `STEP-RI01` - Baseline profiling, rerender map, and acceptance budgets

### Patch target
`frontend/src/pages/cari/`

### In scope
1. Profile the current create/edit typing path with React DevTools or lightweight developer instrumentation.
2. Identify which state domains rerender during:
   - line description typing
   - quantity / unit price changes
   - counterparty selection
   - payment-term changes
   - fixed-route page switches
3. Record clear acceptance goals for the rest of this track, for example:
   - typing in one line description should not rerender unrelated line rows
   - route switch from AP page to AR page should not retain previous draft lines
   - detail-side panels should remain stable while typing in create/edit drafts
4. Add only safe, temporary profiling hooks if needed. Remove or disable them before track close unless they are intentionally kept as developer-only diagnostics.

### Explicit non-goals
- No business-logic changes
- No backend profiling work
- No visual redesign

### Definition of done
- Hot rerender paths are documented
- Acceptance checks exist for the remaining steps
- The team can point to specific components/state domains that must stop rerendering together

---

## `STEP-RI02` - Route-scoped create-draft controller and reset semantics

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/hooks/` if extraction starts here

### In scope
1. Make fixed-route direction the owner of the create-draft lifecycle.
2. Ensure the create draft is reset or explicitly reinitialized when the route changes across canonical AP/AR pages.
3. Keep safe context carryover only where intentional, such as legal entity or document date, and never carry line text implicitly across direction changes.
4. Clarify whether each fixed route has:
   - isolated in-memory draft
   - isolated persisted draft key
   - no persistence at all
5. Preserve current canonical routing and redirect behavior.

### Explicit non-goals
- No changes to document save APIs
- No autosave feature
- No local-storage redesign outside draft scoping

### Definition of done
- Purchase-page line entries do not appear on the sales page
- Fixed-route switches are deterministic and easy to reason about
- Create-draft reset behavior is documented in code

---

## `STEP-RI03` - Extract create workbench shell and header state from page root

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/components/`
`frontend/src/pages/cari/hooks/`

### In scope
1. Pull create-draft UI ownership into a focused create-workbench component or hook.
2. Separate create-header concerns from unrelated page concerns:
   - legal entity
   - operating unit
   - counterparty
   - payment term
   - settlement mode
   - currency and FX
3. Pass only the state needed by the create workbench rather than the whole page shell.
4. Keep existing business behavior intact:
   - due-date derivation
   - immediate-cash due-date lock
   - counterparty-derived OU behavior
   - fixed-asset setup prompts

### Explicit non-goals
- No create/edit unification refactor
- No API payload changes
- No permission model changes

### Definition of done
- The create workbench can rerender independently from unrelated page panels
- The page shell no longer owns all create behavior inline
- Existing create-flow UX remains functionally equivalent

---

## `STEP-RI04` - Row-level line component isolation and buffered free-text inputs

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/components/DocumentLineWorkbench.jsx`
`frontend/src/pages/cari/components/DocumentLineRow.jsx`

### In scope
1. Extract each line row into its own memoized component.
2. Stop passing broad objects when a row only needs:
   - its own line
   - row-level validation
   - row-specific option subsets
   - stable callbacks
3. Keep buffered local draft input behavior for free-text fields such as description when immediate upstream recompute is not required.
4. Preserve immediate updates for fields that do drive accounting or validation behavior where needed.
5. Ensure focus and cursor position remain stable while typing.

### Explicit non-goals
- No virtualization of line rows in V1
- No speculative debounce for accounting-sensitive fields
- No change to line payload shape

### Definition of done
- Typing in one description field does not visibly stall
- Unrelated line rows do not rerender for that keystroke path
- No text loss occurs on blur, submit, or route reset

---

## `STEP-RI05` - Narrow create-form derived selectors and validation dependencies

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/cariDocumentsUtils.js`
`frontend/src/pages/cari/hooks/`

### In scope
1. Audit create-form `useMemo`, `useCallback`, and validation helpers that currently depend on the full form object.
2. Replace broad dependencies with exact slices where practical.
3. Keep tax preview and similar expensive work on explicit actions or on the smallest safe dependency set.
4. Separate read-only computed display values from mutating form updates.
5. Make sure option extension helpers do not rebuild large maps unnecessarily when unrelated fields change.

### Explicit non-goals
- No rewrite to a different form library
- No removal of required validations
- No backend-side validation changes

### Definition of done
- A line-description update no longer triggers broad create-form recomputation chains
- Expensive derived data only recomputes when its own inputs change
- The create workbench remains behaviorally equivalent

---

## `STEP-RI06` - Mirror workbench isolation for edit draft and posting form

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/components/`
`frontend/src/pages/cari/hooks/`

### In scope
1. Apply the same isolation approach to edit-draft state.
2. Decouple posting-form typing from edit/create state where possible.
3. Prevent posting-side line edits from rerendering unrelated create or list sections.
4. Preserve current edit/post behavior:
   - immediate-cash due-date lock
   - posting-line validations
   - offset-account selection
   - stock and fixed-asset posting-line data

### Explicit non-goals
- No posting workflow redesign
- No backend posting changes
- No edit/create behavior merge

### Definition of done
- Edit-form typing and posting-line edits remain responsive
- Posting-form updates do not fan out into unrelated page areas
- Edit and post paths stay functionally unchanged

---

## `STEP-RI07` - Split related, evidence, comments, and ops panels from active form rerenders

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/components/`

### In scope
1. Move selected-document related panels behind stable boundaries:
   - related journal and open items
   - linked cash
   - exceptions
   - internal comments
   - evidence
   - ops status
2. Ensure these panels depend on selected-document state and their own fetch state, not on create/edit keystrokes.
3. Keep loading and error messages stable while active forms are being edited.

### Explicit non-goals
- No new tabs or UX redesign
- No backend fetch changes
- No permission changes

### Definition of done
- Typing in create/edit drafts does not rerender related side panels
- Selected-document side panels remain stable unless their own state changes

---

## `STEP-RI08` - Lookup loading, option extension, and preview isolation

### Patch target
`frontend/src/pages/cari/CariDocumentsPage.jsx`
`frontend/src/pages/cari/hooks/`
`frontend/src/pages/cari/cariDocumentsUtils.js`

### In scope
1. Isolate lookup-fetch hooks by exact driver fields:
   - legal entity
   - operating unit
   - counterparty role/direction
   - selected settlement mode
2. Prevent unrelated keystrokes from re-triggering lookup shaping and option-map rebuilding.
3. Keep preview refresh actions explicit where possible instead of letting passive form rerenders recreate preview state.
4. Preserve current option-enrichment behavior for selected but out-of-scope values.

### Explicit non-goals
- No API contract changes
- No caching framework migration
- No change to canonical empty/error messaging beyond what isolation requires

### Definition of done
- Lookup and option recomputation is driven by the narrowest practical inputs
- Free-text typing does not churn large lookup maps or preview helpers

---

## `STEP-RI09` - Smoke and interaction verification using existing repo patterns

### Patch target
`backend/scripts/` only if an existing frontend smoke pattern already fits
`PR-STEPS/41-logs.md` if this track later gets a dedicated log file

### In scope
1. Verify the key interaction paths manually or with existing repo smoke patterns:
   - create AP draft typing responsiveness
   - create AR draft typing responsiveness
   - route switch AP -> AR draft reset
   - fixed asset line entry still behaves correctly
   - due-date auto-fill and immediate-cash lock remain correct
   - counterparty-derived OU behavior still works
2. Keep the verification bounded to the frontend/performance scope.
3. Do not invent a new automation framework just for this track.

### Explicit non-goals
- No backend runtime patches
- No new end-to-end framework
- No artificial benchmarks that are not reproducible in this repo

### Definition of done
- The track has repeatable verification steps
- No known functional regressions remain in the touched create/edit flows

---

## `STEP-RI10` - Release-gate and backward-compatibility verification

### Patch target
Verification only

### In scope
1. Confirm canonical routes still behave as before.
2. Confirm legacy redirects still land on the correct pages.
3. Confirm permissions, route guards, and route-driven titles still work.
4. Confirm no AP/AR behavior changed beyond responsiveness and draft-scope correctness.
5. Confirm no backend/API contract drift was introduced.

### Explicit non-goals
- No deprecation of legacy routes
- No backend release-gate widening
- No contract changes

### Definition of done
- Frontend performance hardening ships without changing product contracts
- The team can clearly state "responsive UI improvement only; no business-flow drift"

---

## Step Impact Summary

### `STEP-RI01`
- Modifies: `frontend/src/pages/cari/` profiling and documentation only
- Depends on: Existing Track 39 behavior already running
- Risk: Low

### `STEP-RI02`
- Modifies: create-draft route synchronization in `frontend/src/pages/cari/`
- Depends on: Current canonical fixed routes already in place
- Risk: Medium - draft reset semantics must be explicit and predictable

### `STEP-RI03`
- Modifies: create-workbench structure in `frontend/src/pages/cari/`
- Depends on: RI01, RI02
- Risk: Medium - large component extraction with no behavior drift allowed

### `STEP-RI04`
- Modifies: line workbench and row rendering in `frontend/src/pages/cari/`
- Depends on: RI03
- Risk: Medium - typing and focus behavior must remain stable

### `STEP-RI05`
- Modifies: selector and derived-computation ownership in `frontend/src/pages/cari/`
- Depends on: RI03, RI04
- Risk: Medium - easy to accidentally miss a dependency or stale display update

### `STEP-RI06`
- Modifies: edit and posting workbench structure in `frontend/src/pages/cari/`
- Depends on: RI03, RI04
- Risk: Medium - editing and posting still touch many legacy paths

### `STEP-RI07`
- Modifies: related/document-side panels in `frontend/src/pages/cari/`
- Depends on: RI03
- Risk: Low to Medium

### `STEP-RI08`
- Modifies: lookup hooks, option shaping, preview-state boundaries
- Depends on: RI03, RI05, RI06
- Risk: Medium

### `STEP-RI09`
- Modifies: verification artifacts only if existing repo patterns fit
- Depends on: RI01-RI08
- Risk: Low

### `STEP-RI10`
- Modifies: verification only
- Depends on: RI01-RI09
- Risk: Low

## Dependencies

### On Track 39
This track assumes the current CARI document flows already exist and are functionally signed off:

- canonical AP/AR page routes
- subledger-aware line UI
- immediate-cash settlement UI behavior
- counterparty and operating-unit derivation rules
- fixed-asset line prompts and validations

This track does not change those contracts. It only changes how the frontend owns and renders the state.

### On existing frontend patterns
The work should stay compatible with the current repo approach:

- React component extraction under existing feature folders
- existing permission and routing helpers
- current i18n message patterns
- current manual/smoke verification style

## Future Extensions (Out of Scope)

| Feature | Description | Why deferred |
|---|---|---|
| Full route-level autosave | Persist in-progress drafts per route automatically | Separate product decision; not required for rerender isolation |
| New global state manager | Move CARI forms to a new state library | Too wide for this track |
| Virtualized line tables | Window very large line counts | Useful later, but first fix current rerender ownership |
| Generic form-engine rewrite | Rebuild CARI forms on a new abstraction | Too risky while business behavior is still evolving |
| Backend-side performance work | Service or API optimization | Outside this frontend-only track |
