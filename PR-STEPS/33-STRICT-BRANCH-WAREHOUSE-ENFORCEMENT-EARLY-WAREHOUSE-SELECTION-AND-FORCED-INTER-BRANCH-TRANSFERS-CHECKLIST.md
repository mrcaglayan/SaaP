# 33 - STRICT BRANCH WAREHOUSE ENFORCEMENT, EARLY WAREHOUSE SELECTION, STRICT ISSUE VALIDATION, AND FORCED INTER-BRANCH TRANSFERS

## Execution tracking
- This file is the execution tracker for strict branch warehouse enforcement and stock-affecting document hardening.
- It replaces the loose "post now, resolve warehouse later" behavior for normal branch inventory operations.
- It keeps explicit inventory materialization and transfer workflows, but hardens them so warehouse readiness and stock sufficiency are enforced before stock-affecting posting.
- If product direction changes later, update this tracker before implementation continues.

## Scope
- branch warehouse readiness enforcement for stock-affecting transactions
- required warehouse selection before stock-affecting posting
- strict issue-side availability validation against the selected warehouse
- forced inter-branch transfer when stock must move between branches
- pending-link / materialization hardening for the new strict model
- legacy pending-link repair handling
- OpenAPI, UI validation, regression gates, and rollout notes

## Locked product decisions for this tracker
- [x] Each inventory-enabled branch must have at least one active warehouse before any stock-affecting transaction can be posted for that branch.
- [x] A stock-affecting sales document cannot be posted unless the selected warehouse has sufficient available stock for every stock line.
- [x] Warehouse selection is required before stock-affecting posting so stock can be validated against the correct warehouse.
- [x] Cross-branch fulfillment must use explicit inventory transfer; a branch cannot consume stock directly from another branch's warehouse.
- [x] No warehouse is auto-created by the system.
- [x] V1 uses required warehouse selection on each stock-affecting line, not "choose later from the queue."
- [x] Materialization still exists, but it materializes against the already-chosen warehouse and rechecks validity; it is no longer where the normal warehouse decision is made.
- [x] Legacy pending links created before this change are treated as repair items, not as the normal path going forward.

## Non-goals
- No negative inventory.
- No implicit cross-branch stock consumption.
- No automatic branch warehouse creation.
- No backorder / soft reservation / sales-order-first redesign in this wave.
- No drop-ship / MTO / advanced replenishment routing in this wave.

## Baseline repo implications
- Current stock-item CARI posting creates pending stock links before warehouse is bound.
- Current issue validation happens too late, during inventory movement / materialization.
- Current inventory materialization page lets the operator choose a warehouse too late in the flow.
- Current cross-context protection is directionally correct, but the product flow still allows misleading upstream documents to be created.
- This tracker moves warehouse/context/availability enforcement earlier, while keeping final movement posting and cost-layer consumption authoritative in inventory service.

## Master tracker
- [ ] `PR-INV01` - Strict warehouse policy foundation and terminology lock
- [ ] `PR-INV02` - Data model hardening for early warehouse binding
- [ ] `PR-INV03` - Branch warehouse readiness enforcement before stock-affecting posting
- [ ] `PR-INV04` - Required warehouse selection on stock-affecting lines
- [ ] `PR-INV05` - Strict issue-side available-stock validation at posting time
- [ ] `PR-INV06` - Receipt-side hardening against missing or invalid warehouse
- [ ] `PR-INV07` - Pending-link generation and materialization rework for strict mode
- [ ] `PR-INV08` - Forced inter-branch transfer workflow enforcement
- [ ] `PR-INV09` - Legacy pending-link repair and cutover handling
- [ ] `PR-INV10` - Frontend document form hardening
- [ ] `PR-INV11` - Inventory queue and movements UI hardening
- [ ] `PR-INV12` - Backend service guardrail consolidation
- [ ] `PR-INV13` - OpenAPI and contract updates
- [ ] `PR-INV14` - Regression tests and rollout gates

## PR-INV01 - Strict warehouse policy foundation and terminology lock

### Goal
- Lock the new product rules and remove ambiguity between "commercial document" and "stock-affecting posting."

### Checklist

#### Policy and terminology
- [ ] Define "inventory-enabled branch" in product/backend terms:
  - a branch attempting to post any stock-affecting line is treated as inventory-enabled for validation purposes
- [ ] Define "stock-affecting document/line" centrally:
  - stock item purchase receipt-side lines
  - stock item sales issue-side lines
  - transfer ship / receive flows
- [ ] Define central validation language used everywhere:
  - missing active warehouse
  - invalid warehouse for branch/context
  - insufficient available stock
  - cross-branch stock requires transfer
- [ ] Lock user-facing error messages and API error codes for these cases
- [ ] Create one canonical helper / policy module for these rules instead of duplicated ad hoc checks

### Acceptance
- [ ] Product wording is consistent in backend, frontend, OpenAPI, and tests.
- [ ] There is one canonical helper / policy module for these rules, not duplicated ad hoc checks.

## PR-INV02 - Data model hardening for early warehouse binding

### Goal
- Store the chosen warehouse early enough that the document line, pending link, and final movement all point to the same warehouse intent.

### Checklist

#### Warehouse binding model
- [ ] Add required warehouse binding for stock-affecting lines at the document-line level.
- [ ] Persist selected `warehouse_id` on stock-affecting source lines or equivalent line-level inventory metadata.
- [ ] Copy the selected warehouse into generated pending stock links so downstream materialization is bound to the same warehouse.
- [ ] Add migration(s) needed for the new warehouse binding field(s).
- [ ] Keep legacy rows nullable only for pre-existing data; new rows must satisfy the new rule.

#### API shape
- [ ] Ensure pending-link list/read APIs expose:
  - document id / line id
  - branch / OU context
  - selected warehouse id and warehouse name
  - pending direction (`RECEIPT_PENDING` / `ISSUE_PENDING`)
  - requested quantity and remaining quantity

### Acceptance
- [ ] New stock-affecting lines cannot exist without warehouse binding.
- [ ] New pending stock links inherit the warehouse binding.
- [ ] APIs surface enough context for the UI to show exactly what is pending and where.

## PR-INV03 - Branch warehouse readiness enforcement before stock-affecting posting

### Goal
- Block stock-affecting posting when the branch has no active warehouse.

### Checklist

#### Backend posting validation
- [ ] In document-posting services, add pre-post readiness validation:
  - resolve branch / OU context for each stock-affecting line
  - confirm at least one active warehouse exists for that exact branch/context
- [ ] Reject posting if the branch has no active warehouse.
- [ ] Reject posting if the selected warehouse is inactive.
- [ ] Reject posting if the selected warehouse belongs to another branch/context.
- [ ] Apply this to both purchase-side receipt-affecting lines and sales-side issue-affecting lines.
- [ ] Return clear, operator-friendly validation errors.

### Acceptance
- [ ] A branch without an active warehouse cannot post stock-affecting purchase receipt lines.
- [ ] A branch without an active warehouse cannot post stock-affecting sales issue lines.
- [ ] No normal pending stock link is created when readiness fails.

## PR-INV04 - Required warehouse selection on stock-affecting lines

### Goal
- Move warehouse selection into the upstream document flow, not the late inventory queue.

### Checklist

#### Create/edit flow hardening
- [ ] Make warehouse selection required on every stock-affecting line in create/edit flows.
- [ ] Filter selectable warehouses to the branch/context of that document/line only.
- [ ] Prevent save/post if a stock-affecting line has no warehouse.
- [ ] Prevent save/post if a warehouse from another branch is selected.
- [ ] Keep non-stock lines unaffected.
- [ ] Ensure edit/read responses return warehouse binding cleanly.

### Acceptance
- [ ] Operators must choose the warehouse before posting a stock-affecting document.
- [ ] Operators cannot choose KEO warehouse on a WEO stock-affecting line.
- [ ] The inventory queue is no longer the first time warehouse is decided for normal flows.

## PR-INV05 - Strict issue-side available-stock validation at posting time

### Goal
- Do not allow stock-affecting sales posting unless the chosen warehouse can fulfill it.

### Checklist

#### Availability enforcement
- [ ] Before posting any issue-side stock line, calculate available stock in the selected warehouse.
- [ ] Validate per line using exact item + warehouse + context.
- [ ] Reject posting if requested quantity exceeds available quantity.
- [ ] Validate all stock lines before the document is committed.
- [ ] Return precise shortage error per item/warehouse.
- [ ] Keep materialization-time recheck as a second protection against race conditions.

### Acceptance
- [ ] A stock-affecting sales document cannot post with insufficient stock in the selected warehouse.
- [ ] KEO stock does not satisfy WEO issue validation.
- [ ] "Sell first, fail later in queue" no longer happens in normal flow.

## PR-INV06 - Receipt-side hardening against missing or invalid warehouse

### Goal
- Make purchase-side receipt behavior consistent with the strict model.

### Checklist

#### Receipt-side validation
- [ ] Require warehouse selection on receipt-affecting purchase lines.
- [ ] Validate branch/context ownership of selected warehouse.
- [ ] Reject receipt-affecting posting when no valid warehouse is bound.
- [ ] Preserve current materialization/costing mechanics, but against the preselected warehouse.
- [ ] Ensure receiving into one branch cannot bind a warehouse from another branch.

### Acceptance
- [ ] Purchase-side stock-affecting posting cannot proceed without a valid warehouse.
- [ ] A receipt cannot be posted into "no warehouse" state.
- [ ] The selected warehouse is branch-correct from the start.

## PR-INV07 - Pending-link generation and materialization rework for strict mode

### Goal
- Keep pending links/materialization only as execution state, not as a place to decide warehouse ownership.

### Checklist

#### Strict-mode pending links
- [ ] Change pending-link generation so warehouse is already bound when the link is created.
- [ ] Inventory movement creation must use the warehouse already attached to the pending link.
- [ ] Remove or disable the normal "choose warehouse on materialization" behavior for newly created strict-mode links.

#### Materialization recheck
- [ ] Recheck at materialization time:
  - warehouse still active
  - warehouse still matches branch/context
  - issue-side stock still sufficient at execution time
- [ ] Keep authoritative costing/open-layer consumption in inventory service.
- [ ] Mark links clearly if they fail recheck due to later stock movement or warehouse deactivation.

### Acceptance
- [ ] Normal strict-mode links are warehouse-bound before they ever enter the queue.
- [ ] Materialization does not let the operator switch to another warehouse for normal links.
- [ ] Inventory service remains the final guardrail.

## PR-INV08 - Forced inter-branch transfer workflow enforcement

### Goal
- Make cross-branch stock movement explicit and mandatory.

### Checklist

#### Transfer-only cross-branch movement
- [ ] Enforce that a branch can only issue from its own warehouses.
- [ ] Enforce that stock in KEO cannot satisfy WEO issue directly.
- [ ] Keep or tighten the explicit transfer workflow:
  - transfer out from source branch warehouse
  - transfer in / receipt into target branch warehouse
  - only then target branch can issue sale
- [ ] Add clear operator-facing guidance when stock exists in another branch:
  - "Stock exists in KEO but WEO must use transfer before issue"
- [ ] Ensure cross-branch warehouse selection is impossible in normal sales documents.
- [ ] Preserve audit trail linking transfer source and destination branches.

### Acceptance
- [ ] Cross-branch consumption without transfer is impossible.
- [ ] WEO sale cannot consume KEO stock directly.
- [ ] Inter-branch transfer is the only valid route.

## PR-INV09 - Legacy pending-link repair and cutover handling

### Goal
- Handle old data created under the loose model without weakening the new rules.

### Checklist

#### Legacy repair workflow
- [ ] Identify legacy pending links missing warehouse binding.
- [ ] Mark them as legacy repair-required items in list/read endpoints.
- [ ] Add repair rules:
  - receipt legacy link may be assigned a valid warehouse within the same branch/context
  - issue legacy link may only be repaired by assigning a valid same-branch warehouse and passing strict stock validation
  - cross-branch legacy issue cannot be "repaired" by selecting another branch's warehouse; it must be canceled/reversed and re-created correctly or resolved via transfer flow as product policy allows
- [ ] Add admin/ops UX for repair or controlled cancellation.
- [ ] Block creation of new legacy-style links after rollout.

### Acceptance
- [ ] Existing bad/old pending links are visible and repairable under controlled rules.
- [ ] New data never re-enters the loose mode.
- [ ] Legacy cleanup does not reopen the design hole.

## PR-INV10 - Frontend document form hardening

### Goal
- Make the strict rules obvious in the UI before the user posts.

### Checklist

#### Document form UX
- [ ] Add required warehouse selector to every stock-affecting line form.
- [ ] Filter warehouses by the selected branch/context.
- [ ] Show inline stock availability for issue-side lines after warehouse selection.
- [ ] Validate on line change and again on submit.
- [ ] Show precise blocking reason:
  - no active warehouse in branch
  - warehouse belongs to another branch
  - insufficient stock
  - stock exists in another branch and transfer is required
- [ ] Do not let a stock-affecting line silently remain warehouse-empty.

### Acceptance
- [ ] Users see the warehouse requirement before submit.
- [ ] Users see shortages before posting, not only later in the queue.
- [ ] Users are guided toward transfer instead of guessing.

## PR-INV11 - Inventory queue and movements UI hardening

### Goal
- Make the queue reflect execution state, not hidden decision state.

### Checklist

#### Queue presentation
- [ ] Remove auto-selection of the first pending stock link.
- [ ] Show explicit columns for:
  - branch/context
  - selected warehouse
  - pending direction
  - requested quantity
  - materialized quantity
  - legacy repair status
- [ ] For strict-mode links, make warehouse read-only in the queue.
- [ ] For legacy repair links, expose restricted repair actions only.
- [ ] Fix incorrect display fallbacks / quantity rendering bugs on the page.
- [ ] Add status badges:
  - ready to materialize
  - blocked by stock shortage
  - blocked by inactive warehouse
  - legacy repair required
  - cross-branch transfer required

#### Pending CARI Stock Links card hardening
- [ ] Pending CARI Stock Links card must show the owning branch / OU for every pending row.
- [ ] Pending CARI Stock Links card must show the bound warehouse for strict-mode rows.
- [ ] Card must default to current working context and support optional cross-branch visibility.
- [ ] Rows must be visually grouped or badged by branch to avoid wrong materialization.

### Acceptance
- [ ] Queue no longer behaves like a warehouse decision screen for normal flow.
- [ ] Operators cannot accidentally materialize the wrong pending link due to auto-selection.
- [ ] Pending rows are understandable without digging into raw data.
- [ ] Pending CARI Stock Links always display the owning branch / OU and bound warehouse so operators can immediately see which branch the pending inventory action belongs to.

## PR-INV12 - Backend service guardrail consolidation

### Goal
- Ensure no alternate API path can bypass the strict rules.

### Checklist

#### Shared backend guardrails
- [ ] Consolidate warehouse/context/readiness/availability rules in shared service helpers.
- [ ] Apply the same checks in:
  - document create/update/post
  - stock-link generation
  - inventory movement creation
  - transfer execution
  - reversal/cancel flows where relevant
- [ ] Ensure imports, background scripts, or admin endpoints cannot bypass the rules unless explicitly designed to.
- [ ] Preserve idempotency and rollback behavior on validation failure.

### Acceptance
- [ ] There is no route that can still create a new stock-affecting pending link without a valid warehouse.
- [ ] There is no route that can still post issue-side stock without sufficient warehouse-local stock.
- [ ] Error behavior is consistent across entry points.

## PR-INV13 - OpenAPI and contract updates

### Goal
- Make the strict warehouse model visible and testable in the API contract.

### Checklist

#### Contract changes
- [ ] Update request schemas to require warehouse binding on stock-affecting lines.
- [ ] Update response schemas to surface warehouse binding, branch context, and queue state.
- [ ] Document strict validation rules and possible failure responses.
- [ ] Document explicit inter-branch transfer requirement.
- [ ] Add examples for:
  - valid same-branch receipt
  - valid same-branch issue
  - blocked issue due to insufficient stock
  - blocked issue due to missing active warehouse
  - blocked cross-branch consumption
  - valid transfer then issue

### Acceptance
- [ ] Generated OpenAPI matches behavior.
- [ ] Contract tests fail if the repo drifts back toward loose warehouse selection.

## PR-INV14 - Regression tests and rollout gates

### Goal
- Protect the strict model from future regressions.

### Checklist

#### Backend regression
- [ ] Add backend tests for:
  - missing active warehouse blocks stock-affecting posting
  - invalid-branch warehouse blocks posting
  - insufficient stock blocks issue-side posting
  - same-branch valid stock passes
  - cross-branch direct consumption fails
  - explicit transfer then issue passes
  - materialization recheck catches post-posting stock changes

#### Frontend regression
- [ ] Add frontend tests for:
  - warehouse required on stock lines
  - branch-filtered warehouse selection
  - inline shortage validation
  - queue read-only warehouse for strict-mode links
  - no auto-select of first pending row

#### Rollout checks
- [ ] Add rollout scripts/checks for legacy pending-link detection and repair visibility.
- [ ] Add negative tests ensuring no late warehouse selection path is used for new strict-mode links.

### Acceptance
- [ ] All main strict-mode scenarios are covered.
- [ ] Cross-branch bug path from the KEO/WEO scenario is permanently gated.

## Rollout order
- [ ] Deploy schema additions first.
- [ ] Deploy backend read support for warehouse-bound lines/links.
- [ ] Deploy frontend warehouse-required forms.
- [ ] Enable strict validation in backend.
- [ ] Expose legacy repair UX.
- [ ] Clean or repair legacy pending links.
- [ ] Turn on rollout gate that blocks any new loose-mode records.

## Migration / compatibility notes
- [ ] Existing documents/pending links without warehouse binding are legacy only.
- [ ] New documents must use strict mode immediately after cutover.
- [ ] Legacy issue rows missing warehouse cannot be silently materialized under the new rules.
- [ ] Cross-branch legacy shortages must be resolved by explicit transfer or document correction, not by selecting another branch warehouse at execution time.

## Final acceptance criteria
- [ ] A branch without an active warehouse cannot post stock-affecting purchase or sales lines.
- [ ] A stock-affecting sales document cannot post unless selected warehouse stock is sufficient.
- [ ] Warehouse is chosen before posting, not later in the queue.
- [ ] One branch cannot consume another branch's warehouse stock directly.
- [ ] Inter-branch transfer is the only valid cross-branch stock path.
- [ ] New pending links are warehouse-bound from creation.
- [ ] Legacy loose-mode data is isolated to repair workflows only.
