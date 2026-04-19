# Close + Consolidation Operating Model

## Final corrected master plan

## 1) End-state goal

Keep the current core engines:

- period close run
- local close pack
- consolidation run
- workflow engine

Do not replace them.

Build a real close operating layer around them so the product behaves like a serious close platform:

- close cycle
- automatic provisioning
- explicit dependency model
- cockpit / monitors
- official-action blockers
- stale propagation
- certification-grade local close
- alerts / SLA
- later enterprise modules:
  - governed close journals
  - support schedules
  - reconciliations
  - intercompany controls
  - consolidation scenarios / KPI dashboards

---

# 2) Locked architecture decisions

## A. The close cycle is a control plane around existing engines

The close cycle layer wraps:

- `period_close_runs`
- `local_close_packs`
- `consolidation_runs`
- `workflow_*`

It does not replace them.

The cycle layer adds:

- cycle orchestration
- explicit participation rows
- dependency registration
- blocker visibility
- stale tracking
- later SLA / alerting

## B. PR-01 supported cycle anchors are `LEGAL_ENTITY` and `CONSOLIDATION_GROUP`

The repo's consolidation runtime is keyed by `consolidation_group_id`, not only by `group_company_id`.

So PR-01 supports:

- `LEGAL_ENTITY` cycles
- `CONSOLIDATION_GROUP` cycles

`COUNTRY` cycles are deferred until the repo has country-scoped close semantics for:

- local close participation
- technical period close participation
- consolidation expectations
- RBAC and readiness rules

`group_company_id` can still be stored on group-scoped cycles as denormalized context, but it is not the primary cycle anchor.

## C. `business_status` is stored and must stay source-compatible

`close_cycle_items.business_status` is a stored denormalized status, not computed on read.

Reason:

- cheaper cockpit queries
- easier filtering and counts
- easier alert / SLA logic
- better fit for the repo's service-layer write paths

But the stored value must not invent a lossy lifecycle that disagrees with the source object.

Rule:

- before a source object exists, expected items use `NOT_STARTED`
- once linked to a real source object, `business_status` mirrors the repo-native source status for that item family

Examples:

- local close pack: `NOT_OPENED`, `READY_FOR_REVIEW`, `LOCKED`, `REOPENED`
- period close run: `IN_PROGRESS`, `COMPLETED`, `FAILED`, `REOPENED`
- consolidation run: `DRAFT`, `COMPLETED`, `LOCKED`, `FAILED`

Do not use synthetic values like `FINALIZED` when the live source object is actually `LOCKED`.

## D. One cycle item row = one participating business object

A `close_cycle_item` row is not an action checkpoint row.

Examples:

- one row for one local close pack participation
- one row for one period close run participation
- one row for one consolidation run participation

Action-level semantics live in:

- dependency rows
- blocker evaluation
- workflow state
- service-layer rules

## E. Cycle item identity must be book-aware

The existing repo model makes local close packs unique by:

- `book_id`
- `fiscal_period_id`
- `scope_key`

So cycle items cannot be identified only by `scope_type` and `scope_id`.

PR-01 cycle items need a service-generated `item_key` plus explicit dimensions such as:

- `book_id`
- `legal_entity_id`
- `operating_unit_id`
- `consolidation_group_id`
- `run_name`

This is mandatory so the cycle layer can represent:

- one CENTRAL local close pack per book
- one OU local close pack per book
- one period close item per book
- one consolidation item per consolidation group / run-name pair

## F. Multi-book consolidation-group cycles are supported in PR-01

PR-01 explicitly supports multiple LOCAL books for the same member entity inside one consolidation-group cycle.

Rule:

- the cycle's provisioned `LOCAL_CLOSE_PACK` items are the authoritative participating book set
- when a consolidation run is linked to an open close cycle, consolidation readiness must evaluate all in-cycle participating books for that member
- `ENTITY_CLOSE_BOOK_AMBIGUOUS` must not fire just because one member entity has multiple in-cycle LOCAL books
- the legacy single-book ambiguity heuristic remains fallback behavior only when no linked close cycle exists

This means PR-01 must add a compatibility seam in `consolidation.review-gate.service.js` so cycle-linked group close works before dependency enforcement arrives in PR-02b.

PR-01 must first fix the current member-readiness fallback in `consolidation.review-gate.service.js` so it loads the full period window:

- `period_start_date`
- `period_end_date`

Do not treat the current missing-start-date blind spot as accepted baseline behavior.

### Consolidation expected-run identity in PR-01

`consolidation_runs` are natively identified by:

- `consolidation_group_id`
- `fiscal_period_id`
- `run_name`

PR-01 does not introduce scenario- or version-aware consolidation cycle items yet.

So the cycle layer uses one deterministic consolidation run name in PR-01:

- `run_name = OFFICIAL`

The expected PR-01 consolidation run also inherits:

- `presentation_currency_code = consolidation_groups.presentation_currency_code`

That value is a frozen snapshot copied onto the expected consolidation cycle item at first successful provision.

Any real consolidation run later linked to that expected cycle item must use the same presentation currency.

Changing the consolidation group's default presentation currency later does not mutate already-provisioned cycle items in PR-01.

PR-09 can later generalize this into multiple scenarios / versions.

### Ad hoc consolidation runs stay allowed in PR-01

The base consolidation runtime still allows non-`OFFICIAL` run names.

Rules:

- non-`OFFICIAL` runs are outside PR-01 close-cycle governance
- non-`OFFICIAL` runs do not auto-link to the PR-01 expected consolidation cycle item
- non-`OFFICIAL` runs do not satisfy the cycle's expected consolidation item
- non-`OFFICIAL` runs continue to use the repo's legacy non-cycle review behavior
- when an `OFFICIAL` consolidation run is created or linked for a group / period with an open cycle, the server must validate the frozen cycle-item snapshot:
  - same `consolidation_group_id`
  - same `fiscal_period_id`
  - same `run_name = OFFICIAL`
  - same `presentation_currency_code`
- for cycle-governed `OFFICIAL` runs, do not trust a client-authored presentation currency

## G. No `action_class` column

Removed completely.

## H. `business_status` and `stale_status` are separate

Example:

- `business_status = LOCKED`
- `stale_status = STALE_REVIEW_REQUIRED`

Do not create hybrid values.

## I. Existing hard gates remain live

The repo already hard-blocks some source actions today:

- period close workflow and FX gates
- local close approval / lock gates
- consolidation finalize review gate

So the rollout rule is:

- do not remove or weaken existing hard gates
- PR-02b adds close-cycle dependency enforcement on top of them

This avoids contradicting current repo behavior.

## J. Visibility before new close-cycle enforcement

Locked order:

1. create cycle + item model
2. create dependency model
3. expose blockers in cockpit
4. then enforce new close-cycle dependency blockers

So the sequence stays:

- PR-01
- PR-02a
- PR-03
- PR-02b
- PR-04
- PR-05
- then enterprise extensions

## K. Raw SQL only

All migrations follow the repo's current raw SQL style.

No ORM assumptions.

## L. Provisioning is mandatory

A close cycle must not become a monthly manual assembly exercise.

Provisioning must:

- discover participants
- create cycle items
- auto-create local close packs
- register expected period close items
- register expected consolidation items

## M. PR-01 only auto-creates safe underlying objects

In PR-01:

- local close packs: auto-create or reuse
- period close runs: do not auto-run, only expected items
- consolidation runs: do not auto-run, only expected items

## N. `workflows.service.js` is wrapped, not redesigned

Preferred pattern:

- workflow kernel
- dependency engine
- blocker composer
- one standard blocker payload

## O. RBAC is part of PR-01

The repo uses explicit permission-seeded route protection from day one.

So PR-01 must include:

- permission codes
- route scope resolution
- seed updates
- bootstrap / system role consideration where needed

Do not leave cycle routes ungoverned.

## P. Provisioning authority is cycle-scoped and internal

`close.cycle.provision` is sufficient authority for PR-01 cycle provisioning.

Rules:

- PR-01 adds an internal idempotent local-close-pack ensure seam used only by cycle provisioning
- do not route cycle provisioning through the public `createLocalClosePack(req, ...)` contract
- public / manual local close-pack creation still uses `ouclose.prepare`
- cycle provisioning must still validate scope, book, entity, OU, and period dimensions
- cycle provisioning must still write audit logs for create / reuse decisions

## Q. Cycle list/read RBAC is row-derived

`close_cycles` mixes entity-scoped and group-scoped rows, so one SQL scope column is not enough for safe list filtering.

Rules:

- `GET /api/v1/close/cycles` and `GET /api/v1/close/cycles/:id` derive each row's native scope from `scope_kind`
- `LEGAL_ENTITY` rows authorize against `legal_entity_id`
- `CONSOLIDATION_GROUP` rows authorize against derived `group_company_id`
- list / read filtering must reuse the repo's existing hierarchical RBAC against that derived native scope
- do not invent a synthetic "group sees all entity cycles" rule beyond what the current scope engine already grants

## R. The close cockpit gets a new frontend route

The repo already uses `/app/donem-sonu-islemler/yillik/kapanis-islemleri` for `YearEndRevrecChecklistPage`.

So PR-03 must:

- keep that existing route unchanged
- mount the new close cockpit at `/app/donem-sonu-islemler/yillik/kapanis-kokpiti`
- patch sidebar, readiness allowlist, frontend route registration, and i18n route labels for the new path

---

# 3) Core data model

## `close_cycles`

Parent object for one close window.

### Purpose

Represents the operational close context for one period and one primary scope.

### Columns

- `id`
- `tenant_id`
- `cycle_type`
- `scope_kind`
- `fiscal_calendar_id`
- `fiscal_period_id`
- primary scope columns:
  - `legal_entity_id`
  - or `consolidation_group_id`
- contextual denormalized scope columns:
  - `group_company_id`
- `scope_key`
- `status`
- `starts_at`
- `due_at`
- `owner_user_id`
- `created_by_user_id`
- `updated_by_user_id`
- timestamps

### Allowed `cycle_type`

- `MONTH_END`
- `QUARTER_END`
- `YEAR_END`

### Allowed `scope_kind` in PR-01

- `LEGAL_ENTITY`
- `CONSOLIDATION_GROUP`

Later:

- `COUNTRY`

### PR-01 active `status`

- `PLANNED`
- `OPEN`

PR-01 does not expose a cycle lock action yet.

### Later status activation

PR-02b activates:

- `LOCKED`

through:

- `lockCycle(cycleId, actorCtx)`
- `POST /api/v1/close/cycles/:id/lock`

Later roadmap statuses still exist conceptually:

- `IN_REVIEW`
- `CLOSED`
- `REOPENED`

but PR-01 does not activate them yet.

### `scope_key` definition

`scope_key` is a service-generated canonical anchor key.

The client does not send it.

`close.cycles.service.js` computes it in `createCycle(...)` from the supported scope.

Format:

- `LEGAL_ENTITY:<legal_entity_id>`
- `CONSOLIDATION_GROUP:<consolidation_group_id>`

Examples:

- `LEGAL_ENTITY:42`
- `CONSOLIDATION_GROUP:5`

### Scope rule

Exactly one primary PR-01 scope must be present:

- `legal_entity_id`
- or `consolidation_group_id`

If `scope_kind = CONSOLIDATION_GROUP`, then:

- `group_company_id` is derived from the consolidation group and may be stored for filtering / RBAC

### Fiscal calendar derivation rule

`fiscal_calendar_id` is stored, but `createCycle(...)` derives and validates it.

Rule:

- the client sends `fiscal_period_id`
- `close.cycles.service.js` derives `fiscal_calendar_id` from the selected fiscal period
- the selected fiscal period must belong to the stored `fiscal_calendar_id`
- if `scope_kind = CONSOLIDATION_GROUP`, the derived `fiscal_calendar_id` must equal `consolidation_groups.calendar_id`
- if `scope_kind = LEGAL_ENTITY`, later provisioning only uses books whose `calendar_id` matches the cycle calendar

### Unique rule

- unique on `(tenant_id, cycle_type, fiscal_period_id, scope_key)`

---

## `close_cycle_items`

Participation rows for business objects inside a close cycle.

### Columns

- `id`
- `close_cycle_id`
- `item_type`
- `item_key`
- `scope_type`
- `scope_id`
- `legal_entity_id`
- `operating_unit_id`
- `book_id`
- `consolidation_group_id`
- `run_name`
- `presentation_currency_code`
- `business_status`
- `stale_status`
- `owner_user_id`
- `due_at`
- timestamps

### Allowed `item_type` in PR-01

- `PERIOD_CLOSE_RUN`
- `LOCAL_CLOSE_PACK`
- `CONSOLIDATION_RUN`

Later:

- `SUPPORT_SCHEDULE`
- `JOURNAL_SET`
- `RECON_SET`

### Allowed `scope_type` in PR-01

- `BOOK`
- `CENTRAL`
- `OPERATING_UNIT`
- `CONSOLIDATION_GROUP`

### `scope_id` rule

- `BOOK` -> `book_id`
- `CENTRAL` -> `legal_entity_id`
- `OPERATING_UNIT` -> `operating_unit_id`
- `CONSOLIDATION_GROUP` -> `consolidation_group_id`

### `item_key` definition

`item_key` is a service-generated canonical identity inside one cycle.

Examples:

- `PERIOD_CLOSE_RUN:BOOK:12`
- `LOCAL_CLOSE_PACK:BOOK:12:CENTRAL`
- `LOCAL_CLOSE_PACK:BOOK:12:OPERATING_UNIT:77`
- `CONSOLIDATION_RUN:CONSOLIDATION_GROUP:5:RUN_NAME:OFFICIAL`

### Important modeling rule

No `action_class` column exists here.

### Important identity rule

`scope_type` and `scope_id` are not enough to guarantee uniqueness.

The unique rule is:

- unique on `(close_cycle_id, item_type, item_key)`

This is what makes local close participation compatible with the repo's book-scoped pack model.

### `run_name` rule

- required when `item_type = CONSOLIDATION_RUN`
- null for `LOCAL_CLOSE_PACK` and `PERIOD_CLOSE_RUN`
- PR-01 uses `OFFICIAL`

### `presentation_currency_code` rule

- required when `item_type = CONSOLIDATION_RUN`
- null for `LOCAL_CLOSE_PACK` and `PERIOD_CLOSE_RUN`
- copied from `consolidation_groups.presentation_currency_code` at first successful provision
- treated as a frozen cycle-item snapshot in PR-01

---

## `close_cycle_item_links`

Links cycle items to real source objects.

### Purpose

A link row exists only when the underlying source object exists.

One cycle item may accumulate historical source links over time, but only one link is current.

### Columns

- `id`
- `close_cycle_item_id`
- `source_target_type`
- `source_target_id`
- `is_current`
- `created_at`
- `superseded_at`

### Source types in PR-01

- `LOCAL_CLOSE_PACK`
- `CONSOLIDATION_RUN`
- `PERIOD_CLOSE_RUN`

### Constraint rule

Keep:

- unique on `(close_cycle_item_id, source_target_type, source_target_id)`

Do not add:

- global unique on `(source_target_type, source_target_id)`

The same source object may legitimately be referenced by more than one cycle over time.

### Current-link uniqueness rule

A cycle item may have only one current link at a time.

The same source row may be current for multiple cycle items across different active cycles when those cycles legitimately share the same underlying business object.

The same source row must not be current for more than one cycle item within the same cycle.

If more than one current match exists for the same source row inside one cycle, treat that as data corruption and fail loudly.

### Keep indexes

- index on `(source_target_type, source_target_id, is_current)`
- index on `(close_cycle_item_id, is_current)`

### Service-layer rule

`linkCycleItemToSource(...)` must:

- detect conflicting reuse of the same source object within the same cycle and fail with a readable validation error
- validate that the source row exactly matches the cycle-item dimensions before linking
- local close pack links must match `book_id`, `fiscal_period_id`, `scope_key`, and `legal_entity_id`
- period close links must match `book_id` and `fiscal_period_id`
- consolidation links must match `consolidation_group_id`, `fiscal_period_id`, `run_name`, and frozen `presentation_currency_code`
- supersede the prior current link and insert the new current link in one transaction
- mark the prior current link as non-current and stamp `superseded_at` if a newer governing source row replaces it for the same cycle item
- allow the same source row to stay current across multiple active cycles when those cycles intentionally share it
- allow `syncCycleItemsBySource(...)` to update every current linked cycle item matched to the source row

---

# 4) Status model

## General rule

For expected-only cycle items with no source object yet:

- `business_status = NOT_STARTED`

Once the cycle item is linked to a real source object:

- `business_status` mirrors the source lifecycle used by the repo

## `business_status` by item type

### `LOCAL_CLOSE_PACK`

- `NOT_STARTED`
- `NOT_OPENED`
- `OPEN`
- `IN_PROGRESS`
- `READY_FOR_REVIEW`
- `RETURNED`
- `APPROVED`
- `LOCKED`
- `REOPENED`
- `SUPERSEDED`

### `CONSOLIDATION_RUN`

- `NOT_STARTED`
- `DRAFT`
- `IN_PROGRESS`
- `COMPLETED`
- `LOCKED`
- `FAILED`

### `PERIOD_CLOSE_RUN`

- `NOT_STARTED`
- `IN_PROGRESS`
- `COMPLETED`
- `FAILED`
- `REOPENED`

## `stale_status`

- `FRESH`
- `STALE`
- `STALE_REVIEW_REQUIRED`
- `FINALIZED_BUT_OUTDATED`

In PR-01 all rows start as:

- `FRESH`

## Important read-model rule

If the cockpit wants higher-order labels such as:

- ready
- blocked
- finalized
- attention required

those are derived read-model labels.

Do not overload `business_status` with a second semantic layer.

---

# 5) Provisioning model

Provisioning is owned by `close.cycles.service.js`.

## Book eligibility rule in PR-01

PR-01 does not invent a new `close_eligible` book flag.

Use the repo's live book model:

- local close packs and period close participation are provisioned from books where `book_type = 'LOCAL'`
- book calendar must match `close_cycles.fiscal_calendar_id`

## Consolidation-group member rule in PR-01

For `CONSOLIDATION_GROUP` cycles:

- resolve active members from `consolidation_group_members`
- use the cycle period window when evaluating `effective_from` / `effective_to`

## Provisioning success rule

Provisioning is transactional.

Only mark the cycle `OPEN` if:

- provisioning commits successfully
- at least one cycle item exists after provisioning

If provisioning fails, the cycle stays `PLANNED` and partial item / link creation is rolled back.

## Empty-scope rule

Fail provisioning with a readable validation error if the resolved scope contains no provisionable participation.

Examples:

- `LEGAL_ENTITY` cycle with zero eligible LOCAL books
- `CONSOLIDATION_GROUP` cycle with zero active members
- `CONSOLIDATION_GROUP` cycle with active members but zero eligible LOCAL books across them

## `provisionCycle(cycleId)`

Responsibilities:

1. load cycle
2. validate cycle state
3. resolve eligible participants from current repo setup
4. create or reuse cycle items using canonical `item_key`
5. auto-create or reuse local close packs
6. link cycle items to local close packs
7. create expected period close items
8. create expected consolidation item for consolidation-group cycles using `run_name = OFFICIAL`
9. initialize `business_status`
10. initialize `stale_status`
11. move cycle to `OPEN`
12. return provision summary

## Legal-entity cycle

Provision:

- for each eligible LOCAL book:
  - one `CENTRAL` `LOCAL_CLOSE_PACK` item
  - one `PERIOD_CLOSE_RUN` item
- for each active OU under the entity and for each eligible LOCAL book:
  - one `OPERATING_UNIT` `LOCAL_CLOSE_PACK` item
- no consolidation item

## Consolidation-group cycle

Provision:

- for each active member entity
- for each eligible LOCAL book under that member entity:
  - one `CENTRAL` `LOCAL_CLOSE_PACK` item
  - one `PERIOD_CLOSE_RUN` item
- for each active OU under each member entity and for each eligible LOCAL book:
  - one `OPERATING_UNIT` `LOCAL_CLOSE_PACK` item
- one `CONSOLIDATION_RUN` expected item keyed by `(consolidation_group_id, run_name = 'OFFICIAL')`

## Safe object creation in PR-01

- local close packs: create or reuse
- period close runs: expected item only
- consolidation runs: expected item only

## Provisioning seam rule

PR-01 provisioning must use an internal idempotent local close-pack ensure helper.

Do:

- reuse the existing pack when `(tenant_id, book_id, fiscal_period_id, scope_key)` already exists
- create the missing pack inside the provisioning transaction when it does not exist

Do not:

- call the request-bound public local close-pack create route
- require `ouclose.prepare` for cycle provisioning

## Linking rule

PR-01 links only to source rows that already exist:

- local close packs: yes, because PR-01 creates or reuses them
- period close runs: only after a real run exists
- consolidation runs: only after a real run exists

If a newer source row later becomes the governing source for the same cycle item, PR-01 supersedes the prior current link instead of deleting history.

## Idempotency

Provisioning must be safe to rerun.

No duplicate:

- cycle items
- local close packs
- links

## Participant freeze rule

After the first successful provision, PR-01 freezes participant structure for that cycle.

For an already-`OPEN` cycle, `reprovisionCycle(...)` may only:

- repair missing links
- create missing safe source objects that should already exist for established participant keys
- resync status or ownership fields for already-established participant keys

For an already-`OPEN` cycle, `reprovisionCycle(...)` must not:

- add new participant keys because org setup changed later
- remove participant keys because org setup changed later
- replace the frozen consolidation presentation-currency snapshot

---

# 6) Stored-status sync model

Because `business_status` is stored, sync discipline is mandatory from PR-01.

## Required service seam in `close.cycle-items.service.js`

- `ensureCycleItem(input, actorCtx)`
- `linkCycleItemToSource(input, actorCtx)`
- `findLinkableCycleItemsForSource(sourceTargetType, sourceIdentity, actorCtx)`
- `findCurrentCycleItemsBySource(sourceTargetType, sourceTargetId, actorCtx)`
- optional `findCurrentCycleItemBySourceInCycle(sourceTargetType, sourceTargetId, cycleId, actorCtx)`
- `setItemBusinessStatus(itemId, status, actorCtx)`
- `setItemStaleStatus(itemId, status, actorCtx)`
- `syncCycleItemsBySource(sourceTargetType, sourceTargetId, actorCtx)`
- `listCycleItems(cycleId, filters, actorCtx)`

## Reverse lookup rule

PR-01 reverse lookup supports:

- source row -> all current linked cycle items
- source row + cycle -> one current linked cycle item inside that cycle

So:

- `findCurrentCycleItemsBySource(...)` filters to `is_current = true`
- it may return more than one row when `LEGAL_ENTITY` and `CONSOLIDATION_GROUP` cycles both share the same source object
- `findCurrentCycleItemBySourceInCycle(...)` filters to `is_current = true` plus `cycleId`
- it returns `null` when the source row has no current link in that cycle
- historical link inspection is a separate query concern, not this singular service seam

## First-link fan-out rule

When a real source row is created for an expected item family that was provisioned without a source object yet:

- source writers must find all matching linkable cycle items across active cycles by source dimensions
- source writers must link every matching cycle item, not just the first one found
- if no matching cycle item exists, the source write continues without cycle linkage
- if more than one matching candidate exists inside the same cycle, fail loudly as data corruption

This is required for:

- period close run initialize
- consolidation run create

## Required PR-01 write-path sync points

These paths must update the linked cycle item when source status changes:

- local close pack create / reuse
- local close submit
- local close return
- local close approve
- local close lock
- local close reopen
- period close run initialize
- period close run complete
- period close run reopen
- consolidation run create
- consolidation execute start
- consolidation execute complete
- consolidation execute fail
- consolidation finalize / lock

Current repo touchpoints for PR-01 are:

- `backend/src/services/local.close-packs.service.js`
- `backend/src/services/local.close-pack.workflow.service.js`
- `backend/src/services/local.close-reopen.service.js`
- `backend/src/routes/gl.period-closing.routes.js`
- `backend/src/routes/consolidation.js`

Patch those exact seams in PR-01. Do not defer source write-path sync to a later PR.

## Important PR-01 implementation rule

Stored status is not a PR-02 concern.

If PR-01 stores `business_status`, PR-01 must also patch the current source writers so cycle items do not drift immediately after go-live.

Only current links drive status sync. Superseded links remain audit history and must not keep mutating the cycle item.

---

# 7) Dependency model

Dependencies do not exist in PR-01.

They arrive in PR-02a.

## Important sequencing rule

PR-01 creates cycles and cycle items.
PR-02a creates dependency schema.

So PR-02a must also own post-provision dependency wiring.

Add:

- `registerCycleDependencies(cycleId)`
- optional `syncCycleDependencies(cycleId)`

This function must:

- load existing provisioned cycle items
- detect required relationships
- insert missing dependency rows
- avoid duplicates
- be safe to rerun

## Initial dependency rules

1. `PERIOD_CLOSE_RUN completed -> LOCAL_CLOSE_PACK approve`
2. `PERIOD_CLOSE_RUN completed -> LOCAL_CLOSE_PACK lock`
3. `PERIOD_CLOSE_RUN completed -> close cycle lock`
4. `LOCAL_CLOSE_PACK locked -> CONSOLIDATION_RUN lock/finalize path`
5. `LOCAL_CLOSE_PACK locked -> close cycle lock`
6. `CONSOLIDATION_RUN locked -> close cycle lock`

## Important modeling rule

When multiple books exist, dependencies are explicit item-to-item rows.

Do not re-discover them later with heuristic single-book lookups if the cycle already knows the exact participating items.

---

# 8) Standard blocker model

Added in PR-02a.

## Blocker payload

- `code`
- `message`
- `severity`
- `blockingItemType`
- `blockingItemId`
- `blockingAction`
- `owner`
- `dueDate`
- `firstBlockedAt`
- `drillPath`

## Composer pattern

`close.blocker-composer.service.js` merges:

- existing workflow-gate and source review-gate result
- close-cycle dependency result
- later stale result

into one payload shape.

---

# 9) RBAC and route policy

## PR-01 permission codes

Add at minimum:

- `close.cycle.read`
- `close.cycle.write`
- `close.cycle.provision`

## PR-02b permission code

Add:

- `close.cycle.lock`

## PR-02b seed / bootstrap rule

PR-02b must also update:

- `backend/src/seedCore.js`
- any bootstrap or system-role mapping needed to grant `close.cycle.lock`

## PR-03 permission code

Add:

- `close.cockpit.read`

## PR-03 seed / bootstrap rule

PR-03 must also update:

- `backend/src/seedCore.js`
- any bootstrap or system-role mapping needed to grant `close.cockpit.read`

## Scope resolution rule

Cycle routes must resolve to existing repo scopes:

- legal-entity cycle -> `legal_entity`
- consolidation-group cycle -> `group` using stored / derived `group_company_id`

## List / read RBAC rule

Because cycle rows span more than one native scope kind:

- `listCycles(...)` and `getCycleById(...)` must derive scope row by row
- implementation may use row-level post-filtering after fetch if that is simpler and safer than one mixed SQL filter
- do not assume one shared SQL scope column can safely filter both `LEGAL_ENTITY` and `CONSOLIDATION_GROUP` rows

## Seed / bootstrap rule

PR-01 must update:

- `backend/src/seedCore.js`
- any bootstrap or system-role mapping needed so admins can reach the new routes

---

# 10) PR roadmap

## PR-01 - Close Cycle foundation + provisioning

### Goal

Create the close-cycle layer and make it operational from day one without breaking current source workflows.

### Migrations

- `m181_close_cycles.js`
- `m182_close_cycle_items.js`
- `m183_close_cycle_item_links.js`

### Backend files

New:

- `backend/src/services/close.cycles.service.js`
- `backend/src/services/close.cycle-items.service.js`
- `backend/src/routes/close.cycles.routes.js`

Patch:

- `backend/src/index.js`
- `backend/src/routes/gl.period-closing.routes.js`
- `backend/src/routes/consolidation.js`
- `backend/src/services/consolidation.review-gate.service.js`
- `backend/src/services/local.close-pack.workflow.service.js`
- `backend/src/services/local.close-reopen.service.js`
- `backend/src/services/local.close-packs.service.js`
- `backend/src/migrations/index.js`
- `backend/src/seedCore.js`

### Frontend files

- `frontend/src/api/closeCycles.js`

### Routes

- `POST /api/v1/close/cycles`
- `GET /api/v1/close/cycles`
- `GET /api/v1/close/cycles/:id`
- `POST /api/v1/close/cycles/:id/provision`

### What PR-01 does

- create `LEGAL_ENTITY` and `CONSOLIDATION_GROUP` close cycles
- provision book-aware cycle items
- auto-create or reuse local close packs
- register expected period close items
- register expected consolidation item with `run_name = OFFICIAL`
- register dependency rows during provision
- seed support-schedule and reconciliation-control scaffolds during provision
- keep non-`OFFICIAL` consolidation runs allowed but outside PR-01 cycle-governed expected-run linking
- store `business_status`
- store `stale_status`
- support reverse lookup by current source object across concurrently linked cycles
- sync cycle item status from existing source write paths
- validate source-to-cycle link dimensions before status sync is allowed
- fix the current fallback consolidation member-readiness period-window blind spot before layering cycle-linked readiness
- make cycle-linked consolidation readiness use the explicit in-cycle multi-book participation set
- mount the cycle route family under `/api/v1/close`
- seed and enforce cycle permissions

### What PR-01 does not do

- cockpit
- new close-cycle blockers
- stale events
- new hard enforcement
- certification sections
- alerts / SLA
- country cycles

### What PR-01 must not change

- existing period close gates keep working
- existing local close gates keep working
- existing consolidation finalize gates keep working, but cycle-linked runs use the provisioned cycle participant set instead of fallback single-book discovery

### Risk

Medium

---

## PR-02a - Dependency registry + blocker evaluation only

### Goal

Create the dependency schema and blocker model, but do not enforce new close-cycle dependency blockers yet.

### Migrations

- `m184_close_dependencies.js`
- `m185_close_stale_events.js`

### Backend files

- `backend/src/services/close.dependencies.service.js`
- `backend/src/services/close.blockers.service.js`
- `backend/src/services/close.blocker-composer.service.js`
- `backend/src/services/close.stale.service.js`

Extend:

- `close.cycles.service.js` or companion seam with:
  - `registerCycleDependencies(cycleId)`
  - optional `syncCycleDependencies(cycleId)`

### Initial dependency rules

1. period close complete -> local close approve
2. period close complete -> local close lock
3. local close lock -> consolidation lock / finalize path
4. consolidation lock -> cycle lock

### What PR-02a does

- creates dependency schema
- registers dependencies for already provisioned cycles
- provides blocker evaluation
- provides standard payload
- provides stale-service foundation

### What PR-02a does not do

- hard-fail new close-cycle dependency checks on live actions yet

### Risk

Low-Medium

---

## PR-03 - Close Cockpit + monitors + blocker visibility

### Goal

Expose the whole close for a period on one operational surface.

### Backend

Extend:

- `backend/src/routes/close.cycles.routes.js`
- `backend/src/seedCore.js`

with:

- `GET /api/v1/close/cycles/:id/cockpit`
- `GET /api/v1/close/cycles/:id/worklist`
- `GET /api/v1/close/cycles/:id/blockers`
- `GET /api/v1/close/cycles/:id/readiness`

### Frontend

Add:

- `CloseCockpitPage.jsx`
- `EntityCloseMonitorPage.jsx`
- `GroupCloseMonitorPage.jsx`

Extend:

- `frontend/src/api/closeCycles.js`
- `frontend/src/App.jsx`
- `frontend/src/layouts/sidebarConfig.js`
- `frontend/src/readiness/RequireTenantReadiness.jsx`
- `frontend/src/i18n/messages.js`

Mount the primary cockpit page at:

- `/app/donem-sonu-islemler/yillik/kapanis-kokpiti`

Do not replace:

- `/app/donem-sonu-islemler/yillik/kapanis-islemleri`

### What it shows

- period close status
- local close readiness
- consolidation status
- source-gate blockers already live in the repo
- close-cycle dependency blockers
- stale state
- drill-through to existing detail pages

### Risk

Low

---

## PR-02b - Official-action hard enforcement + stale propagation

### Goal

Turn on close-cycle dependency blockers after users can already see them.

### Backend patches

- `gl.period-closing.routes.js`
- `local.close-pack.workflow.service.js`
- `consolidation.review-gate.service.js`
- `backend/src/services/close.cycles.service.js`
- `backend/src/routes/close.cycles.routes.js`
- `backend/src/seedCore.js`

Touch `workflows.service.js` only if necessary.

### Route activated in PR-02b

- `POST /api/v1/close/cycles/:id/lock`

### Service method activated in PR-02b

- `lockCycle(cycleId, actorCtx)`

### Permission activated in PR-02b

- `close.cycle.lock`

### Hard-blocks added

- local close approve blocked if linked cycle dependency says technical period close is incomplete
- local close lock blocked if linked cycle dependency says technical period close is incomplete
- consolidation finalize / lock blocked if linked cycle dependencies are unresolved
- cycle lock blocked if required terminal dependencies are unresolved

### Important

Do not remove existing source hard-gates here.

PR-02b adds cycle-governed enforcement on top of:

- existing workflow gates
- existing review gates
- existing reopen / draft / FX / REVREC gates

### Important group-close rule

PR-01 already makes cycle-linked consolidation readiness read the provisioned cycle participant set so multi-book entities do not fail the legacy ambiguity heuristic.

PR-02b builds dependency-based hard blocking on top of that same cycle-linked participant set.

### Stale propagation activated on

- period close reopen / reset
- local close reopen / unlock
- later extensible official reversals

### Stale meaning

- `stale_status` is a current-state flag, not a permanent scar
- successful rerun / reapprove / relock / refinalize clears active stale back to `FRESH`
- stale resolution stamps `stale_resolved_at` and optionally `stale_resolved_by`
- `close_stale_events` remains the permanent audit history even after current stale clears

### Risk

High

---

## PR-04 - Local Close Certification Pack v2

### Goal

Turn local close into a stronger certification pack without re-architecting the current pack engine.

### Migrations

- `m186_local_close_pack_certification.js`
- `m187_local_close_pack_sections.js`

### Backend patches

- `local.close-pack.workflow.service.js`
- `local.close-pack.workspace.service.js`
- `local.close-pack.evidence.service.js`
- `local.close-pack.comments.service.js`

### Frontend patches

- `LocalCloseWorkspacePage.jsx`
- `LocalClosePackDetailPage.jsx`

### New gate added here

- local close lock blocked if required certification sections are incomplete

### Risk

Low

---

## PR-05 - Alerts, due dates, SLA, escalation, stale visibility

### Goal

Make the process operationally manageable without manual chasing.

### Migrations

- `m188_close_alerts.js`
- `m189_close_sla_rules.js`

### Backend files

- `close.alerts.service.js`
- `close.sla.service.js`

### Frontend additions

- alerts panel
- stale panel
- due soon
- overdue
- better blocked-button explainability

### Step 65 boundary

PR-05 in Step 65 delivers live operational alert visibility on cockpit reads.

This means:

- alerts are derived live from due-state, blocker, and stale inputs at read time
- due-soon and overdue visibility are active now
- `escalate_after_hours` currently raises live overdue severity only; it does not create durable scheduled escalations
- `close_alerts` is still a foundation table for later persisted notification / escalation snapshots
- `stale_grace_hours` is reserved in the SLA catalog but is not active in current Step 65 SLA state transitions

### Risk

Low

---

## PR-06 - Governed Close Journals foundation

### Goal

Add a close-journal control layer.

### Migrations

- `m190_close_journal_profiles.js`
- `m191_close_journal_templates.js`

### Journal families

- `LOCAL_ADJUSTMENT`
- `TOPSIDE`
- `ELIMINATION`
- `CONSOLIDATION_ADJUSTMENT`
- `RECLASS`
- `REVERSING`
- `RECURRING`

### Risk

Low-Medium

---

## PR-07 - Support schedules / disclosure packs

### Goal

Add structured support data collection.

### Migrations

- `m192_close_support_schedule_templates.js`
- `m193_close_support_schedules.js`

### Risk

Low

---

## PR-08 - Reconciliation + intercompany control foundation

### Goal

Add the first real close-control layer beyond approvals.

### Migrations

- `m194_close_reconciliation_sets.js`
- `m195_close_reconciliation_items.js`
- `m196_intercompany_mismatch_queue.js`

### Phase-1 scope

- bank rec
- subledger-to-GL rec
- suspense / clearing rec
- intercompany rec

### Risk

Low-Medium

---

## PR-09 - Consolidation scenarios / versions + KPI dashboards

### Goal

Add scenario distinction and management monitoring.

### Migrations

- `m197_consolidation_run_scenarios.js`
- `m198_close_kpi_snapshots.js`

### Scenarios

- `TRIAL`
- `OFFICIAL`
- `RESTATED`
- `SIMULATION`

### KPIs

- close completion %
- overdue count
- stale count
- reopen events total
- items reopened at least once
- currently reopened items
- avg approval SLA
- bottleneck step
- entity readiness heatmap

### Risk

Low

---

# 11A) As Implemented

- initial cycle provision already registers dependency rows inside the same provision flow
- initial cycle provision already syncs support schedules and reconciliation controls
- cockpit reads persist KPI snapshot rows as the interim snapshot mechanism
- original PR boundaries are therefore partially collapsed in code; operational behavior is governed by runtime guarantees, not by the historical phase labels alone

---

# 11B) Behavioral Guarantees

- cycle lock is a completion gate, not a manual admin freeze
- entity cycle lock requires provisioned period-close items to be `COMPLETED` and provisioned local-close items to be `LOCKED`
- group cycle lock requires provisioned period-close items to be `COMPLETED`, provisioned local-close items to be `LOCKED`, and the provisioned `OFFICIAL` consolidation item to be `LOCKED`
- stale means currently outdated; it clears when the downstream official step is successfully rerun, reapproved, relocked, or refinalized
- stale audit history remains durable in `close_stale_events` even after current stale clears
- reopen KPIs are event-backed, so fixing the item later does not erase reopen history
- `OFFICIAL` remains the only cycle-governed official consolidation run; other scenarios stay preview / analysis surfaces unless separately promoted by governance

---

# 11) Final locked implementation order

1. PR-01 - Close Cycle foundation + provisioning
2. PR-02a - Dependency registry + blocker evaluation only
3. PR-03 - Close Cockpit + monitors + blocker visibility
4. PR-02b - Official-action hard enforcement + stale propagation
5. PR-04 - Local Close Certification Pack v2
6. PR-05 - Alerts, due dates, SLA, stale visibility
7. PR-06 - Governed Close Journals foundation
8. PR-07 - Support schedules / disclosure packs
9. PR-08 - Reconciliation + intercompany control foundation
10. PR-09 - Consolidation scenarios / versions + KPI dashboards

---

# 11C) Release-close cleanup before signoff

Step 65 is in release-close cleanup territory, not core architecture-reopen territory.

The remaining work is:

- 1 runtime visibility fix
- 1 documentation source-of-truth cleanup
- 1 PR-05 boundary clarification
- 2 targeted regression tests

## Required before Step 65 signoff

### PR-A - Period-close cockpit blocker hydration

Extend the PR-03 source-gate blocker hydration so `PERIOD_CLOSE_RUN` items surface the same live source blockers that already exist at action time.

This includes:

- workflow approval-gate blockers
- later period-close source gates if more are added in the same source review model

Done means:

- the cockpit shows blocked `PERIOD_CLOSE_RUN` items
- the cycle item shows those blocker rows
- managers do not need to discover the blocker only by attempting the close action

### PR-B - Step 65 source-of-truth cleanup

Canonical Step 65 plan:

- `PR-STEPS/65-Close + Consolidation Operating Model.md`

Completed cleanup:

- `redesigning/65-Close + Consolidation Operating Model.md`

was deleted so the repo no longer carries a second Step 65 business-meaning variant.

Done means the reviewer reads one canonical Step 65 operating model only.

### PR-C - PR-05 boundary clarification

Implemented boundary:

- live operational alert visibility
- not yet durable scheduled escalation

Documented explicitly that:

- alerts are computed live at cockpit read time
- `escalate_after_hours` affects live overdue severity, not durable scheduler-backed escalation
- durable escalation snapshots / scheduler-backed escalation remain future work
- `stale_grace_hours` is reserved but not active in SLA state evaluation yet

This closes the boundary ambiguity without reopening the architecture.

## Strongly recommended hardening

### PR-D - Two targeted regression additions

Implemented exactly these two regression cases:

1. Multi-book ambiguity
2. OFFICIAL frozen-currency rejection

Test A asserts that consolidation review/finalize surfaces `ENTITY_CLOSE_BOOK_AMBIGUOUS` when multiple local-close books exist for a member and no single governed close chain can be resolved.

Test B asserts that `OFFICIAL` consolidation rejects a caller-supplied presentation currency that conflicts with the frozen close-cycle snapshot.

Implemented scripts:

- `backend/scripts/test-close-cycle-consolidation-book-ambiguity.js`
- `backend/scripts/test-close-cycle-official-frozen-currency-rejection.js`

## Step 65 signoff gate

Required:

- cockpit shows `PERIOD_CLOSE_RUN` source blockers
- only one Step 65 plan doc is canonical
- PR-05 wording explicitly matches live visibility behavior

Strongly recommended:

- regression covers `ENTITY_CLOSE_BOOK_AMBIGUOUS`
- regression covers OFFICIAL frozen-currency rejection

Once the required items are true, Step 65 can be signed off as implemented with targeted follow-up hardening only.

---

# 12) PR-01 detailed build spec

## Goal

Create the first usable close-cycle layer without contradicting the current repo runtime.

## PR-01 schema

### `close_cycles`

Columns:

- `id`
- `tenant_id`
- `cycle_type`
- `scope_kind`
- `fiscal_calendar_id`
- `fiscal_period_id`
- `legal_entity_id`
- `consolidation_group_id`
- `group_company_id`
- `scope_key`
- `status`
- `starts_at`
- `due_at`
- `owner_user_id`
- `created_by_user_id`
- `updated_by_user_id`
- timestamps

Unique:

- `(tenant_id, cycle_type, fiscal_period_id, scope_key)`

### `close_cycle_items`

Columns:

- `id`
- `close_cycle_id`
- `item_type`
- `item_key`
- `scope_type`
- `scope_id`
- `legal_entity_id`
- `operating_unit_id`
- `book_id`
- `consolidation_group_id`
- `run_name`
- `presentation_currency_code`
- `business_status`
- `stale_status`
- `owner_user_id`
- `due_at`
- timestamps

`scope_id` mapping:

- `BOOK` -> `book_id`
- `CENTRAL` -> `legal_entity_id`
- `OPERATING_UNIT` -> `operating_unit_id`
- `CONSOLIDATION_GROUP` -> `consolidation_group_id`

Unique:

- `(close_cycle_id, item_type, item_key)`

### `close_cycle_item_links`

Columns:

- `id`
- `close_cycle_item_id`
- `source_target_type`
- `source_target_id`
- `is_current`
- `created_at`
- `superseded_at`

Unique:

- `(close_cycle_item_id, source_target_type, source_target_id)`

Index:

- `(source_target_type, source_target_id, is_current)`
- `(close_cycle_item_id, is_current)`

No global unique on source object alone.

---

## PR-01 service methods

### `close.cycles.service.js`

Required:

- `createCycle(input, actorCtx)`
- `listCycles(filters, actorCtx)`
- `getCycleById(cycleId, actorCtx, options)`
- `provisionCycle(cycleId, actorCtx)`
- `reprovisionCycle(cycleId, actorCtx)`
- internal `_resolveCycleParticipants(cycle, actorCtx)`

Create-cycle rule:

- derive `fiscal_calendar_id` from `fiscal_period_id`
- validate the fiscal period belongs to that calendar
- for `CONSOLIDATION_GROUP`, validate the derived cycle calendar equals `consolidation_groups.calendar_id`
- derive `group_company_id` from the consolidation group when applicable

`reprovisionCycle(...)` is an internal PR-01 service seam:

- allow it only for already-created cycles
- freeze participant structure after the first successful provision
- limit it to repairing already-established participant keys
- do not let it add or remove participants after the cycle is `OPEN`
- PR-01 does not need a public reprovision route yet

Provisioning rule:

- fail and leave the cycle `PLANNED` when zero provisionable participants are resolved
- set the cycle `OPEN` only after transactional provisioning succeeds and at least one cycle item exists
- provisioning uses internal system orchestration; `close.cycle.provision` is sufficient authority
- do not call the public request-bound `createLocalClosePack(...)` contract from cycle provisioning
- use an internal idempotent local-close-pack ensure helper instead

Later activation:

- PR-02b adds `lockCycle(cycleId, actorCtx)`

### `close.cycle-items.service.js`

Required:

- `ensureCycleItem(input, actorCtx)`
- `linkCycleItemToSource(input, actorCtx)`
- `findLinkableCycleItemsForSource(sourceTargetType, sourceIdentity, actorCtx)`
- `findCurrentCycleItemsBySource(sourceTargetType, sourceTargetId, actorCtx)`
- optional `findCurrentCycleItemBySourceInCycle(sourceTargetType, sourceTargetId, cycleId, actorCtx)`
- `setItemBusinessStatus(itemId, status, actorCtx)`
- `setItemStaleStatus(itemId, status, actorCtx)`
- `syncCycleItemsBySource(sourceTargetType, sourceTargetId, actorCtx)`
- `listCycleItems(cycleId, filters, actorCtx)`

Reverse lookup contract:

- `findCurrentCycleItemsBySource(...)` returns all current linked cycle items for the source row
- `findCurrentCycleItemBySourceInCycle(...)` returns one current linked cycle item inside the requested cycle
- historical link reads use direct link queries, not this singular lookup seam

First-link contract:

- `findLinkableCycleItemsForSource(...)` returns every linkable cycle item whose frozen dimensions match the source identity
- source create paths use that seam to fan out first-time links across all matching active cycles

Link validation contract:

- `linkCycleItemToSource(...)` rejects dimension mismatches between the cycle item and the source row
- local close pack links must match `book_id`, `fiscal_period_id`, `scope_key`, and `legal_entity_id`
- period close links must match `book_id` and `fiscal_period_id`
- consolidation links must match `consolidation_group_id`, `fiscal_period_id`, `run_name`, and frozen `presentation_currency_code`

---

## PR-01 provisioning rules

### Legal-entity cycle

Provision:

- for each eligible LOCAL book for the entity:
  - one `CENTRAL` local close item
  - one `BOOK` period-close item
- for each active OU and each eligible LOCAL book:
  - one `OPERATING_UNIT` local close item
- no consolidation item

### Consolidation-group cycle

Provision:

- resolve active member entities from `consolidation_group_members`
- for each eligible LOCAL book across the in-scope member entities:
  - one `BOOK` period-close item
- for each member entity and each eligible LOCAL book:
  - one `CENTRAL` local close item
- for each member OU and each eligible LOCAL book:
  - one `OPERATING_UNIT` local close item
- one `CONSOLIDATION_GROUP` consolidation expected item using `run_name = OFFICIAL`

That expected consolidation item uses a frozen snapshot of the consolidation group's `presentation_currency_code`.

### Safe object creation in PR-01

- local close packs: create or reuse
- period close runs: expected item only
- consolidation runs: expected item only

### Initial status rule

- auto-created / reused local close pack items get the live pack status
- expected period close items start as `NOT_STARTED`
- expected consolidation item starts as `NOT_STARTED`
- all items start with `stale_status = FRESH`

---

## PR-01 routes and permissions

### `POST /api/v1/close/cycles`

Create cycle.

Permission:

- `close.cycle.write`

Request body required:

- `cycleType`
- `fiscalPeriodId`
- exactly one of `legalEntityId` or `consolidationGroupId`

Request body optional:

- `ownerUserId`
- `startsAt`
- `dueAt`

Derived by the service and not client-authored:

- `fiscalCalendarId`
- `scopeKey`
- `groupCompanyId`
- `status`

### `GET /api/v1/close/cycles`

List cycles.

Permission:

- `close.cycle.read`

Read rule:

- derive row scope from `scope_kind` and filter row by row using existing RBAC
- do not rely on one shared SQL scope column for mixed entity / group rows

### `GET /api/v1/close/cycles/:id`

Get cycle detail.

Permission:

- `close.cycle.read`

### `POST /api/v1/close/cycles/:id/provision`

Provision cycle.

Permission:

- `close.cycle.provision`

Authority rule:

- `close.cycle.provision` authorizes the internal orchestration even when provisioning creates or reuses local close packs

---

## PR-01 acceptance criteria

- cycle can be created for `LEGAL_ENTITY`
- cycle can be created for `CONSOLIDATION_GROUP`
- duplicate cycle is blocked
- cycle can be listed and fetched
- cycle route family is mounted under `/api/v1/close`
- provisioning builds the expected book-aware structure
- local close packs are created or reused safely
- period close expected items are created
- consolidation expected item is created for consolidation-group cycles using `run_name = OFFICIAL`
- expected consolidation presentation currency comes from the consolidation group
- expected consolidation presentation currency is frozen at first successful provision
- an `OFFICIAL` cycle-linked consolidation run rejects presentation-currency mismatch against the frozen cycle snapshot
- non-`OFFICIAL` consolidation runs remain allowed but do not satisfy or auto-link the PR-01 expected cycle item
- cycle-linked consolidation readiness supports more than one eligible LOCAL book for the same member entity
- no duplicate items on reprovision
- no duplicate links on reprovision
- reprovision does not add or remove participants after the cycle is `OPEN`
- cycle becomes `OPEN` after successful provisioning
- provisioning fails cleanly and leaves the cycle `PLANNED` when no provisionable participants exist
- reverse lookup by current source object works across concurrently linked cycles
- source-to-cycle linking rejects dimension-mismatched source rows
- cycle list / detail reads enforce row-derived native scope using existing RBAC
- local close submit / return / approve / lock / reopen writes sync linked cycle item status
- period close run initialize fans out first-time links to all matching expected cycle items across active cycles
- period close source writes sync linked cycle item status
- consolidation run create fans out first-time links to all matching expected cycle items across active cycles
- consolidation source writes sync all current linked cycle items
- relinking a replacement source row supersedes the prior current link without deleting history
- existing source hard gates still behave exactly as before
- fallback consolidation member readiness still evaluates the full period window when no linked cycle exists
- no accounting-close mechanics are auto-triggered
- no consolidation execution is auto-triggered

---

## PR-01 smoke checklist

### Legal-entity cycle

1. create legal-entity cycle
2. provision
3. verify:

- central local close items exist per eligible LOCAL book
- OU local close items exist per eligible LOCAL book
- local close packs were created or reused
- period close items exist per eligible LOCAL book
- no consolidation item exists

### Consolidation-group cycle

1. create consolidation-group cycle
2. provision
3. verify:

- member entity central local close items exist per eligible LOCAL book
- member OU local close items exist per eligible LOCAL book
- local close packs were created or reused
- period close items exist
- one group consolidation expected item exists with `run_name = OFFICIAL`
- that expected consolidation item uses the group's `presentation_currency_code`
- if one member entity has multiple eligible LOCAL books, all of them remain represented without ambiguity failure

### `OFFICIAL` vs ad hoc consolidation runs

1. create a non-`OFFICIAL` run for the same group / period
2. verify it does not auto-link to or satisfy the PR-01 expected consolidation cycle item
3. create or link an `OFFICIAL` run with mismatched presentation currency
4. verify the mismatch is rejected
5. create or link an `OFFICIAL` run with the frozen matching snapshot
6. verify the cycle item links and syncs correctly

### Idempotency

1. provision same cycle again
2. verify:

- no duplicate cycle items
- no duplicate local close packs
- no duplicate links

### Reprovision freeze

1. open a cycle with one resolved participant set
2. change repo setup so a new eligible participant would now appear, or an old one would disappear
3. reprovision
4. verify already-established participant keys are repaired if needed
5. verify no new participant keys were added and none were removed

### Empty-scope validation

1. create a cycle whose resolved scope has no provisionable participants
2. provision
3. verify provisioning fails with a readable validation error
4. verify the cycle remains `PLANNED`

### Reverse lookup

1. reuse the same local close pack in one legal-entity cycle and one consolidation-group cycle
2. resolve current linked cycle items by source
3. verify both current cycle items are returned
4. resolve current linked cycle item by source + cycle id
5. verify the cycle-scoped lookup returns only that cycle row

### First-link fan-out

1. provision one legal-entity cycle and one consolidation-group cycle that both expect the same period close or consolidation source row
2. create the real source row once
3. verify every matching active cycle item becomes linked
4. verify no duplicate links are created inside either cycle

### Status sync

1. submit, return, approve, lock, or reopen a linked local close pack
2. complete or reopen a linked period close run
3. create, complete, fail, or lock a linked consolidation run
4. verify linked cycle item status updates correctly each time

### Current-link supersession

1. relink one period close or consolidation cycle item to a newer source row
2. verify the previous link remains stored with `is_current = false`
3. verify only the current link keeps driving cycle item status

---

# 13) Final blunt recommendation

Do not start with journals or reconciliation.

Start with the control plane:

- close cycle
- provisioning
- stored statuses
- dependencies
- cockpit
- enforcement
- stale propagation
- certification
- alerts
