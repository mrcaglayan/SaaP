# AMX — AP Amount-Based Approval Routing Matrix Implementation Tracker

## Status

- Planned
- Repo-checked against current project snapshot
- Locked decision: V1 applies to `AP_DOCUMENT_POSTING` first, not all workflow-governed process types
- Locked decision: amount thresholds must select the **workflow route / definition**, not hardcode a person, title, or package
- Locked decision: threshold evaluation uses **document base amount** in V1
- Locked decision: threshold logic belongs to the **workflow assignment / routing layer**, not to individual workflow steps
- Locked decision: there must be a **fallback routing rule** for each active AP routing scope to avoid silent “no matching route” gaps
- Locked decision: scope specificity still wins first; amount band selection happens within the matched scope layer
- Locked decision: workflow/runtime snapshots must record the matched routing rule and evaluated amount so operators and auditors can see why a path was chosen
- Locked decision: amount bands use **min-inclusive / max-inclusive** semantics in V1

---

## Goal

Add a real-world **Approval Routing Matrix** for AP workflow governance so admins can define different workflow routes based on **amount bands** and **organizational scope**.

Example target behavior:

- AP invoices from `0` to `50,000` base amount use one workflow route
- AP invoices above `50,000` base amount use a different workflow route
- the selected route is configurable by admin and can vary by `GROUP`, `COUNTRY`, `LEGAL_ENTITY`, or `OPERATING_UNIT`

This must feel like an enterprise ERP approval matrix:

- understandable to admins
- explainable to operators
- auditable after the fact
- extensible later to more process types and richer conditions

---

## Why this fits the current repo

Current repo analysis indicates the feature is a natural extension, not a parallel redesign:

- workflow assignment resolution already exists in `backend/src/services/workflows.service.js`
- AP workflow integration already exists and uses the workflow engine bridge
- workflow definitions are already mirrored into the generic approval-policy engine
- the generic approval engine already has amount-threshold concepts (`min_amount`, `max_amount`, `currency_code`, threshold evaluation)
- current AP reviewer authority is inferred from workflow scope/assignment rather than only from per-step permission codes

So V1 should extend **assignment selection** to become **scope + amount aware**.

---

# PR-AMX01 — Routing Matrix Schema Foundation

## Goal

Introduce amount-band routing metadata so one AP process type and scope can have multiple workflow routes based on document amount.

## Backend Files

- `backend/src/migrations/...` new migration for workflow assignment threshold fields
- `backend/src/services/workflows.service.js`
- `backend/src/routes/workflows.validators.js`
- any workflow-assignment DTO/validator/helper files currently used by settings/workflow pages

## Data Model Changes

Extend workflow assignment storage with fields equivalent to:

- `amount_basis`
  - V1 allowed values:
    - `BASE_AMOUNT`
- `min_amount`
- `max_amount`
- `priority`
- `is_fallback`

If assignment rows already support metadata JSON and the team prefers low-friction rollout, V1 may temporarily store these in metadata, but the preferred design is **first-class columns** for validation, querying, and indexing.

## Rules

- active routing rows in the same effective scope must not silently overlap unless overlap is explicitly supported by priority ordering
- `min_amount` and `max_amount` are inclusive/exclusive only if that rule is explicitly standardized in validation and UI copy
- one fallback row should be allowed per scope/process combination
- effective-date semantics must remain consistent with current workflow assignment behavior

## Checklist

- [x] Add migration for threshold-routing columns to workflow assignments
- [x] Add indexes for lookup by tenant/process/scope/effective dates
- [x] Add validation for:
  - [x] non-negative amounts
  - [x] `max_amount >= min_amount` when both exist
  - [x] valid `amount_basis`
  - [x] single fallback rule per active scope/process band set
- [x] Add overlap detection for active rows in same scope/process/effective window
- [x] Keep current non-threshold workflows backward compatible

## Acceptance

- admin can store multiple AP routing rows for the same scope with different amount bands
- invalid overlaps are blocked with a clear validation error
- existing workflow assignments with no amount fields continue to work

---

# PR-AMX02 — Amount-Aware Workflow Assignment Resolution

## Goal

Teach the workflow engine to resolve the matching workflow route by **scope + amount band + priority**.

## Backend Files

- `backend/src/services/workflows.service.js`

## Implementation Notes

Current assignment selection logic should be extended so route matching considers:

1. scope specificity
   - `OPERATING_UNIT` before `LEGAL_ENTITY`
   - `LEGAL_ENTITY` before `COUNTRY`
   - `COUNTRY` before `GROUP`
   - `GROUP` before tenant/global fallback, depending on current model
2. amount band match
3. explicit priority
4. effective-date fitness / currently active state
5. fallback row last

## Proposed Selection Inputs

The selection seam should accept:

- `processType`
- target scope snapshot
- `thresholdAmount`
- `amountBasis`
- effective date / current time

## Checklist

- [x] extend workflow assignment selection API/service to accept threshold context
- [x] add band matching helper
- [x] implement deterministic priority ordering
- [x] preserve old behavior when threshold fields are null / absent
- [x] make no-match outcome explicit instead of silently picking the wrong row
- [x] return enough diagnostics for runtime explainability

## Acceptance

- for the same scope, different AP amounts resolve to different workflow routes
- a more specific scope row beats a broader-scope fallback
- fallback route only applies when no non-fallback row matches
- null-threshold legacy rows still behave safely

---

# PR-AMX03 — AP Workflow Gate Integration

## Goal

Make AP submit/review/post flow automatically use the matched amount-based workflow route.

## Backend Files

- `backend/src/services/cari.document.workflow.runtime.service.js`
- AP/CARI workflow route files currently calling workflow gate evaluation
- any AP document service used to compute workflow readiness or route creation

## Locked Decision

V1 routes using **document base amount**.

## Required Runtime Data

At workflow-entry / workflow-gate time compute:

- AP document base amount
- target scope snapshot
- selected routing rule
- selected workflow definition

This must be persisted into workflow/runtime snapshots so the same instance remains historically explainable even if the routing matrix changes later.

## Checklist

- [x] compute `thresholdAmount` from AP document base amount
- [x] feed threshold context into assignment selection
- [x] persist matched routing rule snapshot into workflow instance / target snapshot
- [x] persist evaluated amount and amount basis
- [x] ensure returned/re-submitted AP documents re-evaluate correctly when business rules require re-routing
- [x] ensure posted/existing workflow instances do not mutate retroactively when admin later edits routing rules

## Acceptance

- AP submission chooses the correct route based on amount
- workflow instance stores why that route was chosen
- later routing changes do not rewrite historical approval decisions

---

# PR-AMX04 — Unified Policy / Snapshot Alignment

## Goal

Keep the workflow-governance layer and generic approval-policy layer coherent after amount-based routing is introduced.

## Backend Files

- `backend/src/services/workflows.service.js`
- `backend/src/services/approval.engine.service.js`
- `backend/src/services/approvalPolicies.service.js`
- any policy-mirror helper logic currently used by workflow definition sync

## Why this PR exists

Current mirroring appears definition-centric. Amount-based routing introduces “same process type, different route depending on amount band.” Even if the mirrored policy model is not fully redesigned in V1, the snapshot/audit story must remain coherent.

## V1 Direction

Do not redesign the whole generic approval engine. Instead:

- keep workflow-definition mirroring intact
- ensure runtime snapshots explicitly include:
  - matched route / routing rule
  - threshold amount
  - amount basis
  - matched scope layer

## Checklist

- [x] confirm mirror logic remains valid when multiple route rows point to different definitions
- [x] enrich request/policy snapshot model with matched route metadata
- [x] ensure audit/debug payloads can explain which route matched
- [x] avoid introducing duplicated parallel policy-selection logic

## Acceptance

- audit trail shows both workflow definition and matched routing rule context
- generic policy/debug views are not misleading after threshold rollout

---

# PR-AMX05 — Admin UI: Approval Routing Matrix

## Goal

Provide an admin-facing matrix editor that makes amount-based routing understandable and maintainable.

## Frontend Files

- workflow governance/settings page files under `frontend/src/pages/settings/workflows/...`
- helpers/components already used for definition and assignment setup
- relevant API client files for workflows/assignments

## UI Model

Add a new AP routing section named something like:

- **Approval Routing Matrix**
- **Routing Rules**
- **Workflow Route Selection**

Each row should display:

- scope type
- scope target
- amount from
- amount to
- amount basis
- workflow preset / workflow definition
- priority
- fallback
- effective from / to
- active status

## UX Requirements

- clear overlap validation
- plain-language preview
- clone row / duplicate rule
- easy fallback marker
- no technical jargon overload
- preserve current setup mental model rather than replacing it entirely

## Example Preview Text

- “AP documents in Legal Entity A from 0 to 50,000 base amount use Entity Approval Route.”
- “AP documents in Legal Entity A above 50,000 base amount use Group Review Route.”

## Checklist

- [x] add matrix list/editor UI
- [x] add create/edit/delete flow for routing rules
- [x] add client-side validation matching backend rules
- [x] add preview sentence renderer
- [x] allow admins to choose preset or definition as the route target
- [x] visually mark fallback rules
- [x] preserve current workflow-assignment UX where possible instead of forcing a whole new admin page if unnecessary

## Acceptance

- admin can configure multiple amount-band AP routes without editing raw JSON
- validation errors are understandable
- the chosen route is obvious before save

---

# PR-AMX06 — Operator Explainability on AP Documents

## Goal

Surface exactly why a document is waiting, which amount band matched, and who can act now.

## Frontend Files

- AP/CARI document workbench/detail pages
- workflow/status panels and helper functions already used to show “waiting/blocked” states

## UX Goal

Replace vague messages like:

- “Waiting”
- “Blocked”

with operationally useful messages like:

- matched routing rule
- evaluated amount
- selected route
- current step
- required acting scope
- required authority/package label
- why the current user cannot act

## Example Runtime Display

- Routing rule: `Entity > 50k`
- Amount basis: `Base Amount`
- Evaluated amount: `78,240.00`
- Selected route: `WF-AP-ENTITY-APPROVE-GROUP-POST`
- Current step: `Group Review`
- Waiting for: `AP Group Reviewer` at `GROUP` scope
- You cannot act because: `You do not hold the required reviewer authority at GROUP scope`

## Checklist

- [x] expose matched routing diagnostics in API payloads
- [x] render routing rule summary in AP document UI
- [x] show current step and acting scope
- [x] show why current user cannot act
- [x] show fallback usage explicitly when a fallback route matched

## Acceptance

- AP operators can understand the route without opening admin settings
- support teams can diagnose “why is this waiting?” from the document page itself

---

# PR-AMX07 — Tests, Boundaries, and Safety Hardening

## Goal

Protect the routing matrix from silent misrouting and regression.

## Backend Test Areas

- workflow assignment selection
- AP workflow gate evaluation
- route snapshot persistence
- overlap validation

## Frontend Test Areas

- matrix validation
- preview rendering
- explainability panel rendering

## Required Test Cases

- [x] exact lower/upper threshold boundary behavior
- [x] `50000` vs `50000.01`
- [x] no matching route
- [x] fallback route chosen
- [x] overlapping rows rejected
- [x] more specific scope beats broader-scope rule
- [x] expired rule ignored
- [x] inactive rule ignored
- [x] re-submission after amount change re-evaluates correctly
- [x] historical workflow instance still shows original matched route after admin changes matrix
- [x] multi-currency AP still routes by base amount

## Acceptance

- threshold routing is deterministic
- audit trail remains stable
- admin mistakes are blocked early

---

## Recommended V1 Naming Catalog

### Admin-Facing Terms

- **Approval Routing Matrix**
- **Routing Rule**
- **Workflow Route**
- **Fallback Route**
- **Amount Band**
- **Amount Basis**

### Avoid

- overly technical DB-style labels
- hardcoded role naming in the routing logic
- exposing “thresholdAmount” as raw system language in the UI if a friendlier label is available

---

## Example V1 Configuration

### Rule 1

- Process Type: `AP_DOCUMENT_POSTING`
- Scope Type: `LEGAL_ENTITY`
- Scope Target: `Entity A`
- Amount Basis: `BASE_AMOUNT`
- Min Amount: `0`
- Max Amount: `50000`
- Route: `WF-AP-ENTITY-APPROVE-POST`
- Priority: `100`
- Fallback: `false`

### Rule 2

- Process Type: `AP_DOCUMENT_POSTING`
- Scope Type: `LEGAL_ENTITY`
- Scope Target: `Entity A`
- Amount Basis: `BASE_AMOUNT`
- Min Amount: `50000.01`
- Max Amount: `null`
- Route: `WF-AP-ENTITY-APPROVE-GROUP-POST`
- Priority: `100`
- Fallback: `false`

### Rule 3

- Process Type: `AP_DOCUMENT_POSTING`
- Scope Type: `GROUP`
- Scope Target: `Group X`
- Amount Basis: `BASE_AMOUNT`
- Min Amount: `0`
- Max Amount: `null`
- Route: `WF-AP-GROUP-DEFAULT`
- Priority: `10`
- Fallback: `true`

---

## Deferred / Not in V1

These are good future phases, but should not block initial rollout:

- condition builder beyond amount (`vendor risk`, `department`, `counterparty class`, etc.)
- per-step threshold logic
- auto-escalation by threshold and aging combined
- cross-entity segregation-of-duties enforcement
- time-bound delegated coverage tied into amount matrix
- hard SoD save-blocking instead of warnings only
- multi-dimensional routing matrix UI with nested conditions
- AR rollout and non-AP process rollout

---

## Open Questions to Lock Before Coding

### 1) Boundary semantics

Locked in implementation:

- `min` inclusive and `max` inclusive

### 2) Scope order confirmation

Confirm whether `COUNTRY` is already a first-class routing scope in the workflow assignment layer for this rollout, since AP roadmap work has been moving in that direction.

### 3) Preset vs definition target

Decide whether routing rules point to:

- workflow definition only
  or
- preset and resolve preset to definition
  Recommendation:
- store the resolved **workflow definition**
- allow preset-driven creation in UI for convenience

### 4) Amount source

V1 recommendation remains:

- route using persisted AP document **base amount**
- do not route on transaction currency amount in V1

---

## Final Recommendation

Implement this feature as a **routing-matrix extension of workflow assignments**, not as step-level hacks and not as hardcoded role thresholds.

That keeps the system:

- audit-friendly
- admin-friendly
- extensible
- aligned with the current repo architecture

---

## Master Tracker Summary

- `PR-AMX01` — Routing Matrix Schema Foundation
- `PR-AMX02` — Amount-Aware Workflow Assignment Resolution
- `PR-AMX03` — AP Workflow Gate Integration
- `PR-AMX04` — Unified Policy / Snapshot Alignment
- `PR-AMX05` — Admin UI: Approval Routing Matrix
- `PR-AMX06` — Operator Explainability on AP Documents
- `PR-AMX07` — Tests, Boundaries, and Safety Hardening
