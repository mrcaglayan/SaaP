# 55 Ã¢â‚¬â€ RBAC & Governance Redesign Roadmap

## Origin

Two independent deep analyses of the current RBAC/approval/workflow system were performed.
This document synthesizes their agreements, resolves their differences, and defines a phased
implementation roadmap.

---

## Convergence Summary (Both Analyses Agree)

| # | Finding | Verdict |
|---|---------|---------|
| 1 | Core permission + scoped role model is solid | **Keep** |
| 2 | Hierarchical scope cascading (GROUPÃ¢â€ â€™LEGAL_ENTITYÃ¢â€ â€™OU) works correctly | **Keep** |
| 3 | ALLOW/DENY effect model is the right foundation | **Keep** |
| 4 | Multi-tier cache (requestÃ¢â€ â€™memoryÃ¢â€ â€™RedisÃ¢â€ â€™DB) with version-stamp invalidation | **Keep** |
| 5 | Dynamic `requirePermission(code, { resolveScope })` pattern | **Keep** |
| 6 | Workflow step permission resolution is well-designed | **Keep** |
| 7 | Maker-checker enforcement in workflow decisions | **Keep** |
| 8 | Local close pack is the most mature lifecycle/workflow Ã¢â‚¬â€ use as reference | **Keep & replicate** |
| 9 | TenantAdmin = god mode (all 280+ perms) is dangerous | **Must fix** |
| 10 | Roles are too broad, title-based, massive permission lists with high overlap | **Must fix** |
| 11 | Two+ approval systems (bank, workflow, ad-hoc) need unification | **Must fix** |
| 12 | Maker-checker is bank-only but needed system-wide | **Must fix** |
| 13 | Lifecycle vocabulary is inconsistent (CANCELED vs CANCELLED, etc.) | **Must fix** |
| 14 | "Return for revision" is not first-class across modules | **Must fix** |
| 15 | Frontend is scope-blind Ã¢â‚¬â€ only knows permission codes, not scope context | **Must fix** |

---

## Divergence Resolution (Where Analyses Differed)

### D1: Dual-Scope Model (permission scope + data scope)

- **Analysis A**: Called data scopes "a strong pattern for finance"
- **Analysis B**: Called it "the single biggest architectural smell" Ã¢â‚¬â€ the silent fallback in `rbac.js:568-575` is too implicit

**Verdict: B is more correct.**

The implicit behavior at `rbac.js:569` (`dataScopeRows.length > 0 ? dataScopeRows : permissionRows`) means:
- If you have 0 data_scope rows Ã¢â€ â€™ you see everything your role allows
- If you have 1 data_scope row Ã¢â€ â€™ suddenly only that scope is visible
- Frontend has no idea which mode you're in
- The `security.js:171-179` explicit refusal of delegated admin for users with data scopes proves the model leaks

**Action**: Make the dual-scope explicit, not silent-fallback. Both sources should be visible in diagnostics. Never silently substitute one for the other.

> **Shipped**: PR-2A introduced explicit `permissionScopeContext` / `visibilityScopeContext` in the bundle. PR-6C completed the cutover so that `assertScopeAccess()` uses permission scope and `buildScopeFilter()` uses visibility scope. The silent fallback is eliminated from governed paths.

---

### D2: Approval Status Model

- **Analysis A**: Add statuses (RETURNED, WITHDRAWN, ESCALATED, ON_HOLD)
- **Analysis B**: Propose three-layer separation: Business Object Ã¢â€ â€™ Request/Review Ã¢â€ â€™ Execution

**Verdict: B's architecture is cleaner, A's specific statuses are correct.**

The three-layer model prevents the "approve-apply" anti-pattern where decision and execution are conflated. Combined approach:

```
Layer 1: Business Object    (journal, payment batch, close pack, contract...)
Layer 2: Request/Review      DRAFT Ã¢â€ â€™ SUBMITTED Ã¢â€ â€™ PENDING_REVIEW Ã¢â€ â€™
                              RETURNED / APPROVED / REJECTED / WITHDRAWN / ESCALATED
Layer 3: Execution           NOT_EXECUTED Ã¢â€ â€™ EXECUTED / FAILED / REVERSED
```

---

### D3: Permission Dependencies & Conflicts

- **Analysis A**: Proposed dependency rules (gl.journal.post requires gl.journal.read) and conflict rules
- **Analysis B**: Did not mention this

**Verdict: A adds real value.** Broken assignments (write without read) are a real problem. Implement dependency auto-include and conflict validation at role-definition/edit time and during seed/build-time, with optional warnings when combined assigned role sets create overlapping conflicts.

---

### D4: Temporal Access / Delegation

- **Analysis A**: Proposed `effective_from/to` on `user_role_scopes` plus delegation table
- **Analysis B**: Did not mention this

**Verdict: A is correct but lower priority.** Real need (audit season access, leave coverage) but can come in a later phase.

---

### D5: Field-Level Permissions

- **Analysis A**: Raised this (masked bank accounts, salary restrictions)
- **Analysis B**: Did not mention this

**Verdict: Valid but Phase 5+.** Not blocking current operations. Park for future.

---

### D6: Counterparty Request Approval Uses `cari.card.upsert`

- **Analysis A**: Did not catch this
- **Analysis B**: Correctly identified as mixing creation/review/governance authority

**Verified in code**: `cari.counterparty-request.routes.js:98,121` uses `cari.card.upsert` for approve/reject.

**Verdict: B is correct.** Must add explicit `cari.request.review` or `cari.request.approve` permission.

---

### D7: Workflow Setup Uses `onboarding.company.setup`

- **Analysis A**: Did not catch this
- **Analysis B**: Correctly identified as semantically wrong

**Verified in code**: `workflows.routes.js:117,135,172,215,239` all guard with `onboarding.company.setup`.

**Verdict: B is correct.** Workflow governance Ã¢â€°Â  onboarding. Needs dedicated `workflow.definition.*` and `workflow.assignment.*` permissions.

---

### D8: "Generic Approvals" Facade Is Bank-Shaped

- **Analysis A**: Said "unify the two systems"
- **Analysis B**: More precisely identified that `approvalPolicies.service.js` is a thin facade over `bank.approvals.service.js`, meaning every future module asks "does this fit the bank model?" instead of "what is the generic model?"

**Verified in code**: `approvalPolicies.service.js:1-50` literally re-exports bank approval functions with a `moduleCode` wrapper.

**Verdict: Both agree. B's framing is more precise.** The unification must start from a genuinely generic model, not wrap bank internals.

---

### D9: OU Balance Visibility vs Posting Authority

- Additional concern: branch / OU users must be able to see the OU's actual balance, ledger drilldown, and local reports without automatically receiving broad manual GL posting power
- Risk in the current draft: removing `gl.journal.post` from BranchOperator is correct, but the roadmap must also explicitly preserve OU reporting visibility and avoid conflating manual journal posting with source-document execution

**Verdict: Separate visibility, manual journal operations, and manual posting authority.**

The target model should distinguish:
- `gl.readonly` = see posted balances, ledger movement, statements, and drilldown
- `gl.operations` = create / update / cancel manual journals
- `gl.posting` = post / reverse / period-close authority for manual GL
- Module-specific execution permissions = post / execute source documents inside CASH / CARI / INVENTORY / PAYROLL / other modules, without implying broad free-form GL posting

**Action**: Update capability groups and role redesign so OU / branch roles keep `gl.readonly` by default, manual journal operations are narrower, and broad `gl.posting` is granted only to explicit accountant / poster roles.

---

## Combined Target Architecture (5 Layers)

```
Ã¢â€Å’Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â
Ã¢â€â€š  Layer 1: CAPABILITY                                Ã¢â€â€š
Ã¢â€â€š  What action can this actor perform?                Ã¢â€â€š
Ã¢â€â€š  (permission codes Ã¢â‚¬â€ pure, action-oriented)         Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â¤
Ã¢â€â€š  Layer 2: SCOPE ENTITLEMENT                         Ã¢â€â€š
Ã¢â€â€š  Where can this actor perform it?                   Ã¢â€â€š
Ã¢â€â€š  (TENANT/GROUP/COUNTRY/LEGAL_ENTITY/OU + ALLOW/DENY)Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â¤
Ã¢â€â€š  Layer 3: VISIBILITY POLICY                         Ã¢â€â€š
Ã¢â€â€š  What records can this actor list/read?             Ã¢â€â€š
Ã¢â€â€š  (Explicit, diagnosable Ã¢â‚¬â€ not silent fallback)      Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â¤
Ã¢â€â€š  Layer 4: REVIEW / WORKFLOW                         Ã¢â€â€š
Ã¢â€â€š  Who reviews, returns, approves, escalates?         Ã¢â€â€š
Ã¢â€â€š  (Unified engine Ã¢â‚¬â€ all modules)                     Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â¤
Ã¢â€â€š  Layer 5: BUSINESS LIFECYCLE                        Ã¢â€â€š
Ã¢â€â€š  What happens after approval?                       Ã¢â€â€š
Ã¢â€â€š  (DraftÃ¢â€ â€™PostedÃ¢â€ â€™LockedÃ¢â€ â€™Reversed, per domain)         Ã¢â€â€š
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Ëœ
```

---

## Implementation Phases

---

### PHASE 0 Ã¢â‚¬â€ Vocabulary & Permission Hygiene (Pre-Go-Live Consistency)

**Goal**: Fix naming inconsistencies and add missing permissions before broader security changes land.

**Risk**: Low if completed before go-live with no preserved production data; medium otherwise. This repo is still pre-live, so prefer one coordinated consistency pass now rather than compatibility shims later.

#### PR-0A: Normalize Lifecycle Vocabulary

Lock the canonical verb meanings system-wide in a shared constants file:

| Verb | Meaning | Used When |
|------|---------|-----------|
| `submit` | Requester sends for review | Any request/review flow |
| `approve` | Reviewer accepts | Any approval step |
| `reject` | Reviewer denies conclusively (terminal) | Approval denied |
| `return` | Reviewer asks for revision (non-terminal) | Fix and resubmit |
| `revise` | Requester edits returned item | After return |
| `resubmit` | Requester sends revised version | After revise |
| `cancel` / `withdraw` | Requester withdraws before execution | Submitter-initiated |
| `execute` / `apply` / `post` | Business effect happens | After approval |
| `lock` | Post-execution immutability gate | Period/close finality |
| `reopen` | Exception path after approval/closure | Post-lock exception |
| `reverse` | Undo executed accounting/business effect | Error correction |
| `escalate` | Auto-advance after timeout | Workflow timeout |

Because the product is still under development and there is no production data contract to preserve, standardize on `CANCELLED` now in one coordinated consistency PR.

**Files to create/modify**:
- `backend/src/constants/lifecycle.js` Ã¢â‚¬â€ canonical status enums and verb constants
- Fix `CANCELED` Ã¢â€ â€™ `CANCELLED` in:
  - `m029_cash_transit_workflow.js` (migration to ALTER ENUM)
  - `inventory.transfer.service.js` (all references)
  - `cash.queries.js:1073` (uses `CANCELED` while `:1267` uses `CANCELLED`)
- Update any validators, OpenAPI/schema generation, frontend status maps, tests, and fixtures that compare exact status strings

If any dev/demo rows already exist, rebuild or migrate them in the same PR so the repo does not continue carrying mixed spellings.

#### PR-0B: Add Missing Permission Codes

Add to `PERMISSIONS` array in `seedCore.js` (seed-only, no route changes yet):

```
workflow.definition.read
workflow.definition.write
workflow.assignment.read
workflow.assignment.write
cari.request.review          (for counterparty request approve/reject)
cari.audit.read              (already exists, but add to CountryController/EntityAccountant)
security.admin.system         (for ops/onboarding admin separation)
```

**No routes change yet** Ã¢â‚¬â€ just make the permission codes exist so Phase 1 can reference them.

#### PR-0C: Permission Capability Groups (Constants Only)

Create `backend/src/constants/permission-groups.js`:

```js
export const PERMISSION_GROUPS = {
  "gl.readonly":       ["gl.book.read", "gl.coa.read", "gl.account.read", "gl.journal.read",
                         "gl.trial_balance.read", "gl.report.local.read", "gl.report.ledger.read",
                         "gl.report.statement.read"],
  "gl.masterdata":     ["gl.book.upsert", "gl.coa.upsert", "gl.account.upsert",
                         "gl.account_mapping.upsert"],
  "gl.operations":     ["gl.readonly.*", "gl.journal.create", "gl.journal.update",
                         "gl.journal.cancel"],
  "gl.posting":        ["gl.journal.post", "gl.journal.reverse", "gl.period.close"],
  "bank.readonly":     ["bank.accounts.read", "bank.connectors.read", "bank.statements.read",
                         "bank.reconcile.read", ...],
  "bank.operations":   ["bank.readonly.*", "bank.accounts.write", "bank.connectors.write", ...],
  "bank.governance":   ["bank.approvals.*", "payments.batch.approve"],
  "close.operator":    ["ouclose.read", "ouclose.prepare", "ouclose.submit", "ouclose.request_reopen"],
  "close.reviewer":    ["ouclose.review", "ouclose.approve", "ouclose.lock", "ouclose.reopen",
                         "ouclose.override_post_lock", "ouclose.admin"],
  "payroll.readonly":  [...],
  "payroll.operations": [...],
  "payroll.governance": [...],
  // ... all modules
};
```

Design notes:
- `gl.readonly` is the OU balance-visibility bundle. Removing posting authority must never remove OU balance visibility.
- `gl.posting` means free-form manual GL posting / reversal / period close only.
- Module-driven document execution remains governed by source-module permissions and workflows, not implied by `gl.posting`.

This is **constants only** Ã¢â‚¬â€ no runtime change. Used in Phase 1 for diagnostics/transitional mapping and in Phase 4 for the final role redesign.

---

### PHASE 1 Ã¢â‚¬â€ Permission Architecture Cleanup

**Goal**: Fix wrong permission assignments, split god-mode safely, and add capability-group metadata without doing the final role redesign twice.

**Risk**: Medium Ã¢â‚¬â€ changes what permissions roles have. Requires careful migration.

#### PR-1A: Fix Semantic Permission Misuse

1. **Workflow routes**: Replace `onboarding.company.setup` with `workflow.definition.write` / `workflow.assignment.write` in `workflows.routes.js:117,135,172,215,239`

2. **Counterparty request routes**: Replace `cari.card.upsert` with `cari.request.review` in `cari.counterparty-request.routes.js:98,121`

3. Update `seedCore.js` role definitions to include these new permissions for the roles that currently have the old ones.

4. **Migration**: Add the new permissions to `permissions` table and `role_permissions` for existing roles. Keep old permission codes functional (don't remove yet) for backwards safety.

#### PR-1B: Introduce SecurityAdmin / SystemAdmin with Compatibility Shims

Replace single TenantAdmin with two system roles:

| Role | Responsibility | Permissions |
|------|---------------|-------------|
| **SecurityAdmin** | Manages roles, users, scopes, audit | `security.*`, `org.*` (structure only) |
| **SystemAdmin** | Manages ops, jobs, retention, onboarding | `ops.*`, `onboarding.*` |

Neither gets operational permissions (no `gl.journal.post`, no `cash.txn.create`, no `bank.reconcile.write`). If an admin needs operational access, they get a second role at a specific scope.

**Compatibility step required before user migration**:
- Add helper functions such as `canManageSecurity()`, `canManageOps()`, and `canBootstrapTenant()`
- Refactor direct literal `TenantAdmin` checks in known bootstrap / provider / security flows behind those helpers
- ~~Keep `TenantAdmin` temporarily as a compatibility role during Phases 1-2~~ Ã¢â€ â€™ **Retired in PR-6A; no longer seeded for fresh tenants**

**Migration**: Existing TenantAdmin users get both SecurityAdmin + SystemAdmin via the PR-4C migration tool. The old role is retired from the active catalog (PR-6A) but preserved in the database for rollback safety.

#### PR-1C: Capability Group Metadata on Existing Roles

Annotate the existing role catalog with capability groups for diagnostics, seed clarity, and later migration. Do **not** do the final duty-boundary role cutover here.

Add transitional metadata in `seedCore.js`, for example:

```js
const ROLE_CAPABILITY_GROUPS = {
  GroupController: ["gl.readonly", "bank.readonly", "close.reviewer",
                    "payroll.readonly", "consolidation.full", "reporting.full"],
  CountryController: ["gl.readonly", "gl.masterdata", "gl.operations", "gl.posting",
                      "bank.operations", "bank.governance",
                      "close.operator", "close.reviewer", "payroll.full",
                      "cari.full", "inventory.full", "fixed_assets.full"],
  EntityAccountant: ["gl.readonly", "gl.masterdata", "gl.operations", "gl.posting",
                     "bank.operations", "close.operator", "payroll.operations",
                     "cari.full", "inventory.full", "fixed_assets.full"],
  BranchOperator: ["gl.readonly", "cash.basic", "cari.doc.basic", "inventory.basic"],
};
```

Now the **actual difference** between CountryController and EntityAccountant is visible in 2 lines without forcing the Phase 4 role migration early:
- CountryController adds `bank.governance`, `close.reviewer`, `payroll.full` (vs `.operations`)
- EntityAccountant lacks those

Phase 4 is the first full business-role redesign. Phase 1 only adds metadata and transitional cleanup.

**Critical SoD fixes in this PR**:
- **EntityAccountant**: Remove `bank.approvals.requests.approve.*`, `payroll.settlement.override.approve`, all `.approve` variants. Keep `.submit` and `.read` only. An entity accountant should not approve their own bank payments or payroll overrides.
- **BranchOperator**: Remove `gl.journal.post`. Keep `gl.readonly` so branch users can see OU actual balance and drilldown. Target end-state: BranchOperator does **not** own free-form manual journal creation; use `OUAccountant` in Phase 4 where an OU truly needs manual adjustments. If short-term migration safety requires it, retain `gl.journal.create` and `gl.journal.update` only until that Phase 4 cutover.
- **GroupController**: Add `cari.audit.read` (currently missing despite having `cari.*` read access).

#### PR-1D: Permission Dependency & Conflict Rules

Create `backend/src/constants/permission-rules.js`:

```js
export const PERMISSION_DEPENDENCIES = {
  "gl.journal.post":     ["gl.journal.read"],
  "gl.journal.reverse":  ["gl.journal.read"],
  "gl.period.close":     ["gl.journal.read", "gl.trial_balance.read"],
  "ouclose.approve":     ["ouclose.read"],
  "ouclose.lock":        ["ouclose.read", "ouclose.approve"],
  "bank.reconcile.write": ["bank.reconcile.read"],
  "payments.batch.approve": ["payments.batch.read"],
  // ... all writeÃ¢â€ â€™read dependencies
};

export const PERMISSION_CONFLICTS = [
  // Soft warnings Ã¢â‚¬â€ flagged during role setup, not hard-blocked
  { a: "payments.batch.create", b: "payments.batch.approve", severity: "warn",
    reason: "Maker-checker: creator should not approve same batch" },
  { a: "gl.journal.create",     b: "gl.journal.post",       severity: "warn",
    reason: "SoD: journal creator should not post without review" },
  { a: "payroll.settlement.override.request", b: "payroll.settlement.override.approve",
    severity: "warn", reason: "Override requester should not self-approve" },
];
```

Primary enforcement seam:
- Validate dependencies and conflicts when defining or editing roles
- Run the same validation during seed/build-time and in any future role editor
- During user-role assignment, optionally warn when the **combined assigned role set** creates a conflict at overlapping scope, but do not try to repair the permission graph there

GL posting guardrail:
- A role or role-set that grants `gl.posting` must also provide the required read visibility at the same or higher scope
- In practice, either dependency expansion must guarantee the needed read permissions or `GLPostingAuthority` must be paired with a read-bearing role such as `GLOperator`

---

### PHASE 2 Ã¢â‚¬â€ Scope Model Clarification

**Goal**: Make the dual-scope behavior explicit, add diagnostics, make frontend scope-aware.

**Risk**: Medium Ã¢â‚¬â€ adds new diagnostics and frontend context handling. Keep `/me` backward-compatible during rollout.

#### PR-2A: Explicit Scope Model (No Silent Fallback)

Refactor `rbac.js:568-575` Ã¢â‚¬â€ the core of the problem:

**Current** (implicit):
```js
const scopeRowsForData = dataScopeRows.length > 0 ? dataScopeRows : permissionRows;
```

**New** (explicit):
```js
const bundle = {
  missingPermission: false,
  source: dataScopeRows.length > 0 ? "data_scopes" : "permission_scopes",
  permissionScopeContext,                                    // what you CAN DO
  visibilityScopeContext: dataScopeRows.length > 0           // what you CAN SEE
    ? buildScopeContext(tenantId, dataScopeRows, hierarchy)
    : null,                                                  // null = same as permission scope
  scopeContext: buildScopeContext(                            // effective (for backward compat)
    tenantId,
    dataScopeRows.length > 0 ? dataScopeRows : permissionRows,
    hierarchy
  ),
};
```

Key change: `visibilityScopeContext` is **explicitly null** when no data scopes exist (meaning "not narrowed"), rather than silently falling back.

Add a `GET /api/me/entitlements` diagnostic endpoint with a stable minimum contract:
```json
{
  "permissions": [
    {
      "code": "gl.journal.post",
      "scopeType": "LEGAL_ENTITY",
      "scopeIds": [1, 3, 7],
      "visibilityNarrowed": false
    }
  ],
  "visibilityOverrides": [
    { "scopeType": "LEGAL_ENTITY", "scopeId": 3, "effect": "DENY" }
  ],
  "scopeSummary": {
    "permissionScopeContext": {
      "scopeTypes": ["LEGAL_ENTITY"]
    },
    "visibilityScopeContext": null
  },
  "isVisibilityNarrowed": false,
  "maskedFields": []
}
```

Minimum contract notes:
- `scopeSummary.permissionScopeContext` and `scopeSummary.visibilityScopeContext` mirror the explicit backend scope model introduced in this phase.
- `isVisibilityNarrowed` is a convenience boolean for frontend gating and explanation states.
- `maskedFields` should exist from the first contract version, even if it is an empty array until Phase 5 field-visibility work starts populating it.

This answers "why can't I do X?" without guessing.

#### PR-2B: Frontend Scope Awareness (Backward-Compatible)

Roll this out in two steps:
1. Keep existing `/me` response backward-compatible
2. Fetch `/api/me/entitlements` alongside `/me`, then gradually teach the frontend to use scope/visibility diagnostics

After the frontend has adopted the new endpoint, an optional lightweight `scopeSummary` may be added to `/me` for convenience, but it is **not** required for the first rollout.

Update `AuthContext.jsx` to expose:
```js
const { hasPermission, scopeSummary, isVisibilityNarrowed, entitlements } = useAuth();
```

Update `RequirePermission.jsx` to optionally show scope-aware messaging:
- "You have this permission, but not for this entity" instead of just hiding the button.

#### PR-2C: Temporal Role Assignments (No Generic Delegation Yet)

Add to `user_role_scopes`:
```sql
ALTER TABLE user_role_scopes
  ADD COLUMN effective_from DATE NULL DEFAULT NULL,
  ADD COLUMN effective_to DATE NULL DEFAULT NULL;
```

RBAC middleware adds date check: if `effective_to` is set and past, skip row.
Cache invalidation handles expiry naturally (30s TTL means expired assignments drop within 30s).

Parity requirement:
- Update permission loading in `backend/src/routes/me.js` so `/me` does not report permissions from expired or not-yet-effective assignments
- Any endpoint that computes effective permissions outside RBAC middleware, including admin/access-report style endpoints, must reuse the same effective-date filtering logic

Generic entitlement delegation is intentionally deferred. Approval acting delegation is handled later in Phase 5D because it has a very different audit and SoD profile.

If the product later needs broader temporary access, model it explicitly as `temporary_role_assignments`, not as a second generic `delegations` concept overlapping with approval delegation.

#### PR-2D: Shared Authz / Scope Utility Layer

Create a small foundational authorization utility layer that later phases can reuse instead of each PR inventing its own scope checks.

Core helpers to add:
- `checkUserHasPermissionAtScope(userId, tenantId, permissionCode, scopeType, scopeId)`
- `findUsersWithPermissionAtScope(tenantId, permissionCode, scopeType, scopeId)`
- shared scope-resolution helpers for request scope, row scope, and diagnostics
- shared effective-date-aware entitlement loading helpers usable by middleware, `/me`, diagnostics, escalation, delegation, and field masking

This is an enabling PR, not a behavior redesign. Its purpose is to prevent later PRs from depending on implied primitives that do not yet exist in the repo.

---

### PHASE 3 Ã¢â‚¬â€ Unified Approval Engine

**Goal**: One approval/review system for all modules.

**Risk**: High Ã¢â‚¬â€ touches all approval flows. Requires careful module-by-module migration. Use pilot-first rollout; do not cut bank + workflow + ad-hoc over simultaneously.

#### PR-3A: Generic Approval Engine Schema

New tables (not replacing existing yet Ã¢â‚¬â€ parallel operation):

```sql
CREATE TABLE approval_policies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  module_code VARCHAR(30) NOT NULL,        -- 'BANK', 'PAYROLL', 'CLOSE', 'CARI', etc.
  target_type VARCHAR(60) NOT NULL,
  action_type VARCHAR(60) NOT NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NULL,
  scope_id BIGINT UNSIGNED NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  step_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_approvals TINYINT UNSIGNED NOT NULL DEFAULT 1,
  maker_checker_required BOOLEAN NOT NULL DEFAULT FALSE,
  allow_self_approve BOOLEAN NOT NULL DEFAULT TRUE,
  auto_execute BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_after_hours INT UNSIGNED NULL,
  min_amount DECIMAL(20,6) NULL,
  max_amount DECIMAL(20,6) NULL,
  currency_code VARCHAR(3) NULL,
  approver_permission_code VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE approval_policy_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id BIGINT UNSIGNED NOT NULL,
  scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NOT NULL,
  scope_id BIGINT UNSIGNED NOT NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_policy_assignment (policy_id, scope_type, scope_id, effective_from),
  FOREIGN KEY (policy_id) REFERENCES approval_policies(id)
);

CREATE TABLE approval_policy_steps (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id BIGINT UNSIGNED NOT NULL,
  step_no TINYINT UNSIGNED NOT NULL,
  required_permission_code VARCHAR(120) NOT NULL,
  scope_resolution_mode ENUM(
    'REQUEST_SCOPE',
    'POLICY_SCOPE',
    'TARGET_LEGAL_ENTITY',
    'TARGET_OPERATING_UNIT',
    'CUSTOM'
  ) NOT NULL DEFAULT 'REQUEST_SCOPE',
  custom_scope_resolver_key VARCHAR(60) NULL,
  min_approvals TINYINT UNSIGNED NOT NULL DEFAULT 1,
  allow_self_approve BOOLEAN NOT NULL DEFAULT TRUE,
  escalation_after_hours INT UNSIGNED NULL,
  UNIQUE KEY uk_policy_step (policy_id, step_no),
  FOREIGN KEY (policy_id) REFERENCES approval_policies(id)
);

CREATE TABLE approval_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  policy_id BIGINT UNSIGNED NOT NULL,
  policy_version_no INT UNSIGNED NOT NULL,
  module_code VARCHAR(30) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NOT NULL,
  scope_id BIGINT UNSIGNED NOT NULL,
  legal_entity_id BIGINT UNSIGNED NULL,
  operating_unit_id BIGINT UNSIGNED NULL,
  -- Request lifecycle
  status ENUM('DRAFT','SUBMITTED','PENDING_REVIEW','RETURNED',
              'APPROVED','REJECTED','WITHDRAWN','ESCALATED') NOT NULL DEFAULT 'DRAFT',
  current_step_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  -- Execution lifecycle (separate from review)
  execution_status ENUM('NOT_EXECUTED','EXECUTED','FAILED','REVERSED') NOT NULL DEFAULT 'NOT_EXECUTED',
  -- Submitter
  submitted_by_user_id INT NULL,
  submitted_at TIMESTAMP NULL,
  last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Snapshot
  policy_snapshot JSON NOT NULL,
  target_snapshot JSON NULL,
  -- Idempotency
  idempotency_key VARCHAR(120) NULL,
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_idempotency (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (policy_id) REFERENCES approval_policies(id)
);

CREATE TABLE approval_decisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  step_no TINYINT UNSIGNED NOT NULL,
  decision ENUM('APPROVE','REJECT','RETURN') NOT NULL,
  decided_by_user_id INT NOT NULL,
  comment TEXT NULL,
  decided_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_request_step_reviewer (request_id, step_no, decided_by_user_id),
  FOREIGN KEY (request_id) REFERENCES approval_requests(id),
  FOREIGN KEY (decided_by_user_id) REFERENCES users(id)
);
```

Key differences from current systems:
- **RETURN decision type** Ã¢â‚¬â€ "fix and resubmit" is first-class
- **Execution status is separate** from review status (no "approve-apply" conflation)
- **Multi-step is built-in** via `approval_policy_steps` (not bank-only or workflow-only)
- **Module-agnostic** Ã¢â‚¬â€ `module_code` is just a tag, not a behavioral switch
- **WITHDRAWN** status for submitter self-cancellation (different from REJECTED)
- **Request scope is explicit** on `approval_requests`, so escalation, delegation, diagnostics, and step-resolution all work against the same stored scope context
- **Policy versioning and effective windows are first-class**, rather than hidden only inside JSON snapshots
- **Policy applicability is separate from policy definition** via `approval_policy_assignments`, preserving current workflow assignment semantics
- **Step scope resolution is explicit and resolver-driven**, not a vague free-form column

Scope precedence rules:
- `approval_policies.scope_type/scope_id` define the policy template's natural ownership/default bound when needed
- `approval_policy_assignments` are the authoritative runtime applicability bindings
- If both are present, assignment scope may narrow policy scope but must not broaden it beyond the policy's declared bound
- The "narrow but not broaden" rule is enforced in the approval policy create/update validation/service seam before persistence, not left as a runtime-only assumption
- Scope-neutral policies with scoped assignments are preferred for migrated workflow-style approvals
- Counted approvals are reviewer-unique per request step; the same reviewer must not satisfy `min_approvals` twice on the same step

#### PR-3B: Unified Approval Service

Create `backend/src/services/approval.engine.service.js`:

Core functions:
```
evaluateApprovalNeed(moduleCode, targetType, actionType, context)
submitRequest(policyId, targetType, targetId, submitter, snapshot)
recordDecision(requestId, userId, decision, comment)
  - APPROVE: check threshold Ã¢â€ â€™ advance step or finalize
  - REJECT: terminal
  - RETURN: set status=RETURNED, submitter can revise+resubmit
withdrawRequest(requestId, userId)
escalateRequest(requestId)  // called by scheduled job
executeRequest(requestId)   // separate from approval
reverseExecution(requestId)
getRequestDiagnostics(requestId)  // full audit trail
```

SoD enforcement built into `recordDecision`:
- If `maker_checker_required` and `decided_by_user_id === submitted_by_user_id` Ã¢â€ â€™ reject
- If `!allow_self_approve` on step Ã¢â€ â€™ reject

Reviewer threshold counting is per request+step+reviewer. If the same reviewer acts again on the same step, do not count them twice toward `min_approvals`; replace/update the counted decision only if revised decisions are intentionally supported.

Migration parity requirement: when workflows are migrated, `workflow_assignments.effective_from/effective_to`, `workflow_definitions.version_no`, and `stage_scope_type` must map directly into the new engine rather than being flattened away.

#### PR-3C: Pilot Unified Engine on a Contained Flow

Do the first production cutover on one contained, low-blast-radius approval flow:
- first pilot: `cari` counterparty request
- second pilot / follow-up candidate: payroll settlement override

Success criteria for the pilot:
- request / review / execution statuses behave as designed
- maker-checker and SoD checks are preserved
- diagnostics and audit trail are complete
- policy version + scope assignment semantics are proven against real route/service behavior

Only after the pilot passes should bank and workflow move over.

#### PR-3D: Migrate Bank Approvals to Unified Engine

1. Map existing `bank_approval_policies` Ã¢â€ â€™ `approval_policies` with `module_code = 'BANK'`
2. Map existing `bank_approval_requests` Ã¢â€ â€™ `approval_requests`
3. Map existing `bank_approval_request_decisions` Ã¢â€ â€™ `approval_decisions`
4. Update `bank.approvals.service.js` to delegate to `approval.engine.service.js`
5. Keep old tables readable for audit history
6. ~~Feature-flag the cutover~~ Ã¢â€ â€™ **Completed and flags removed in PR-6B**

#### PR-3E: Migrate Workflow Approvals to Unified Engine

1. Map `workflow_definitions` + `workflow_definition_steps` Ã¢â€ â€™ `approval_policies` + `approval_policy_steps`
2. Map `workflow_assignments` Ã¢â€ â€™ `approval_policy_assignments`
3. Map `workflow_instances` Ã¢â€ â€™ `approval_requests`
4. Map `workflow_instance_decisions` Ã¢â€ â€™ `approval_decisions`
5. Update `workflows.service.js` to delegate to `approval.engine.service.js`
6. ~~Feature-flag the cutover~~ Ã¢â€ â€™ **Completed and flags removed in PR-6B**

#### PR-3F: Migrate Remaining Ad-Hoc Approvals

Standardize the remaining ad-hoc approval patterns after the pilot learnings are incorporated:

| Module | Current Pattern | Target |
|--------|----------------|--------|
| Payment batch approve | Direct state transition (`payments.routes.js:110-208`) | Unified engine with `module_code = 'PAYMENTS'` |
| Payroll settlement override | Request/decision model (`payroll.settlementOverrides.routes.js`) | Unified engine with `module_code = 'PAYROLL'` (unless already chosen as pilot) |
| Counterparty request | Uses `cari.card.upsert` permission (`cari.counterparty-request.routes.js:98`) | Unified engine with `module_code = 'CARI'`, `cari.request.review` permission (unless already chosen as pilot) |
| Inventory transfer approve | Direct state transition (`inventory.transfer.service.js`) | Unified engine with `module_code = 'INVENTORY'` |
| Local close reopen request | Request model (`local.close-packs.routes.js:572-632`) | Unified engine (already has best lifecycle Ã¢â‚¬â€ model should match it) |

---

### PHASE 4 Ã¢â‚¬â€ Role Redesign

**Goal**: Smaller, composable roles aligned to duty boundaries. Fix all SoD violations.

**Risk**: High Ã¢â‚¬â€ changes user access. Requires per-tenant migration planning.

#### PR-4A: Define Duty-Boundary Roles

Replace 6 broad title-roles with ~12-15 composable responsibility roles:

| New Role | Replaces | Key Permissions |
|----------|----------|----------------|
| SecurityAdmin | TenantAdmin (partial) | `security.*`, `org.tree.read` |
| SystemAdmin | TenantAdmin (partial) | `ops.*`, `onboarding.*` |
| MasterDataSteward | Ã¢â‚¬â€ | `org.*` (upsert), `gl.masterdata` |
| GLOperator | EntityAccountant (GL ops portion) | `gl.operations` |
| GLPostingAuthority | Ã¢â‚¬â€ | `gl.posting` |
| OUAccountant | BranchOperator (accounting exception) | `gl.operations` at OU scope only |
| TreasuryOperator | EntityAccountant (bank portion) | `bank.operations`, `cash.operations` |
| TreasuryApprover | CountryController (bank portion) | `bank.governance`, `cash.variance.approve` |
| PayrollOperator | EntityAccountant (payroll portion) | `payroll.operations` |
| PayrollApprover | CountryController (payroll portion) | `payroll.governance` |
| LocalClosePreparer | BranchOperator (close portion) | `close.operator` |
| LocalCloseReviewer | CountryController (close portion) | `close.reviewer` |
| GroupReportingController | GroupController | `consolidation.*`, `reporting.*`, `intercompany.*` |
| AuditorReadOnly | AuditorReadOnly | All `*.read` permissions |
| BranchOperator | BranchOperator | `gl.readonly`, `cash.basic`, `cari.doc.create`, `inventory.basic` |

Design rules:
- `BranchOperator` is not blind. It keeps OU balance visibility via `gl.readonly`, including trial balance, ledger, local report, and drilldown access.
- `OUAccountant` is optional and only used where an operating unit truly acts as a mini accounting center.
- `GLPostingAuthority` stays separate from both `BranchOperator` and `OUAccountant`.
- `GLPostingAuthority` must never be granted without matching read visibility at the same or higher scope.
- `GLPostingAuthority` is a companion role, not a standalone business role. It should be paired with a read-bearing accounting role at the same or broader scope.
- Source-document execution remains module-specific and may still create accounting entries without granting broad free-form GL posting.
- Default policy decision: `BranchOperator` does not create or post free-form manual journals. Branch accounting should come from operational documents by default; only explicitly approved OUs get `OUAccountant`, and only explicitly approved posting actors get `GLPostingAuthority`.

Users are composed by assigning **multiple roles at different scopes**:
- A Country Controller gets: GLOperator + GLPostingAuthority + TreasuryApprover + PayrollApprover + LocalCloseReviewer at COUNTRY scope
- An Entity Accountant gets: GLOperator + TreasuryOperator + PayrollOperator + LocalClosePreparer at LEGAL_ENTITY scope; add `GLPostingAuthority` only where that entity is explicitly authorized to post manual journals
- A branch user gets: BranchOperator at OPERATING_UNIT scope; add `OUAccountant` only where the OU truly owns local accounting adjustments

#### PR-4B: Generic SoD Service Layer

Create `backend/src/constants/sod-rules.js` and `backend/src/services/sod.service.js`. Primary enforcement lives in posting / approval / override services, not in generic RBAC middleware:

```js
export const SOD_RULES = [
  {
    action_a: "gl.journal.create",
    action_b: "gl.journal.post",
    scope: "per-record",  // same journal
    enforcement: "warn",  // or "block"
  },
  {
    action_a: "payments.batch.create",
    action_b: "payments.batch.approve",
    scope: "per-record",  // same batch
    enforcement: "block",
  },
  {
    action_a: "payroll.settlement.override.request",
    action_b: "payroll.settlement.override.approve",
    scope: "per-record",
    enforcement: "block",
  },
  {
    action_a: "cash.txn.create",
    action_b: "cash.override.post",
    scope: "per-record",
    enforcement: "warn",
  },
];
```

Service helpers:
- `evaluateSoD({ userId, actionCode, recordType, recordId, context })`
- `assertSoD({ userId, actionCode, recordType, recordId, context })`

Call sites:
- journal posting / reversal services
- payment batch approval / release services
- payroll override approval services
- workflow / approval engine decision handlers

A thin route helper may still call the SoD service when a route already has record context, but RBAC middleware should remain focused on capability + scope.

#### PR-4C: Migration Tool

Build a migration utility that:
1. Maps existing `user_role_scopes` (old roles) Ã¢â€ â€™ new role combinations
2. Generates a preview report: "User X currently has [CountryController at scope Y]. New assignment: [GLOperator + GLPostingAuthority + TreasuryApprover + PayrollApprover + LocalCloseReviewer at scope Y]"
3. Tenant admin reviews and confirms
4. Executes re-mapping
5. Old roles kept in `is_system = false` state for rollback

---

### PHASE 5 Ã¢â‚¬â€ Advanced Governance & Operational Maturity

**Goal**: Field-level security, full access diagnostics, approval escalation automation, delegation model, and compliance audit reporting.

**Risk**: Low-medium Ã¢â‚¬â€ additive features on top of the unified engine from Phases 3-4. Each PR is independently deployable.

---

#### PR-5A: Field-Level Permission Policies

**Problem**: The current system is operation-level only. A user who can `bank.accounts.read` sees the full IBAN and account number. A user who can `payroll.runs.read` sees salary amounts. There is no way to restrict specific fields based on role or scope.

**What exists today**:
- `backend/src/utils/redaction.js` already has `maskString()` and `redactObject()` with `DEFAULT_SENSITIVE_KEY_FRAGMENTS` (password, iban, account_number, etc.)
- `m054_sensitive_data_security.js` has `sensitive_data_audit` table for lifecycle tracking
- `bank.connectors.service.js:52` has a manual `maskConnectorCredentials()` function
- But none of this is **role-aware** Ã¢â‚¬â€ it is either always masked or never masked

**Schema**:

```sql
CREATE TABLE field_visibility_policies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  module_code VARCHAR(30) NOT NULL,          -- 'BANK', 'PAYROLL', 'CARI', etc.
  object_type VARCHAR(60) NOT NULL,          -- 'bank_account', 'payroll_run_line', etc.
  field_name VARCHAR(120) NOT NULL,          -- 'iban', 'account_number', 'base_salary'
  visibility_rule ENUM(
    'FULL',                                  -- show as-is
    'MASKED',                                -- show masked (****1234)
    'HIDDEN',                                -- omit from response entirely
    'LAST_4'                                 -- show only last 4 chars
  ) NOT NULL DEFAULT 'FULL',
  applies_to_scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NULL,
  applies_to_scope_id BIGINT UNSIGNED NULL,
  required_permission_code VARCHAR(120) NULL, -- if set, users WITH this perm see FULL regardless
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by_user_id INT NULL,
  UNIQUE KEY uk_field_vis_policy (tenant_id, module_code, object_type, field_name, 
                                  applies_to_scope_type, applies_to_scope_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

**Default policies** (seeded, can be overridden per tenant):

| module_code | object_type | field_name | Default Rule | Override Permission |
|-------------|------------|------------|-------------|-------------------|
| BANK | bank_account | iban | MASKED | `security.sensitive_data.audit.read` |
| BANK | bank_account | account_no | MASKED | `security.sensitive_data.audit.read` |
| BANK | bank_connector | credentials_json | HIDDEN | `security.admin.system` |
| PAYROLL | payroll_run_line | base_salary | MASKED | `payroll.sensitive.read` (new perm) |
| PAYROLL | payroll_run_line | net_pay | MASKED | `payroll.sensitive.read` |
| PAYROLL | beneficiary | iban | MASKED | `payroll.sensitive.read` |
| PAYROLL | beneficiary | account_number | MASKED | `payroll.sensitive.read` |

**Service layer**:

Create `backend/src/middleware/fieldVisibility.js` with row-scope-aware evaluation:

```js
/**
 * Middleware that applies field-level masking based on user's role/scope.
 * 
 * Usage in routes:
 *   router.get("/bank-accounts", 
 *     requirePermission("bank.accounts.read"),
 *     applyFieldVisibility("BANK", "bank_account", {
 *       resolveRowScope: (row) => ({
 *         type: "LEGAL_ENTITY",
 *         id: row.legalEntityId,
 *       }),
 *     }),
 *     handler
 *   );
 * 
 * The middleware attaches req.fieldVisibility with:
 *   - applyToRow(row)      Ã¢â‚¬â€ masks fields in a single row object using that row's scope
 *   - applyToRows(rows)    Ã¢â‚¬â€ masks fields in an array of row objects using each row's scope
 *   - isFieldVisible(field) Ã¢â‚¬â€ check if a specific field is FULL for this user
 */
export function applyFieldVisibility(moduleCode, objectType, { resolveRowScope } = {}) {
  return async (req, res, next) => {
    const tenantId = req.rbac?.tenantId;
    const userId = req.user?.id;
    
    const policies = await loadFieldPolicies(tenantId, moduleCode, objectType);

    req.fieldVisibility = {
      applyToRow: async (row) => applyMaskingForRow({
        row,
        policies,
        userId,
        tenantId,
        resolveRowScope,
      }),
      applyToRows: async (rows) => Promise.all(rows.map((row) => applyMaskingForRow({
        row,
        policies,
        userId,
        tenantId,
        resolveRowScope,
      }))),
    };
    
    next();
  };
}

async function applyMaskingForRow({ row, policies, userId, tenantId, resolveRowScope }) {
  if (!row || typeof row !== 'object') return row;

  const masked = { ...row };
  const rowScope = resolveRowScope ? resolveRowScope(row) : null;

  for (const policy of policies) {
    if (!(policy.fieldName in masked)) continue;

    let hasOverride = false;
    if (policy.requiredPermissionCode) {
      hasOverride = rowScope
        ? await checkUserHasPermissionAtScope(
            userId, tenantId, policy.requiredPermissionCode, rowScope.type, rowScope.id
          )
        : await checkUserHasPermission(userId, tenantId, policy.requiredPermissionCode);
    }
    if (hasOverride) continue;

    switch (policy.visibilityRule) {
      case 'MASKED':  masked[policy.fieldName] = maskString(masked[policy.fieldName]); break;
      case 'HIDDEN':  delete masked[policy.fieldName]; break;
      case 'LAST_4':  masked[policy.fieldName] = last4(masked[policy.fieldName]); break;
    }
  }
  return masked;
}
```

**Must-have rule**: never decide sensitive-field override based only on a global user permission code when the row belongs to a scoped entity / OU. Cross-entity lists must evaluate the override against each row's scope.

**Cache**: Field policies are tenant-scoped and rarely change Ã¢â‚¬â€ cache in memory with 5-minute TTL, invalidate on policy update.

**Audit**: Every field-level access where masking is applied gets logged to `sensitive_data_audit` with `action = 'FIELD_MASKED_ACCESS'`, so compliance can see who accessed masked data vs full data.

**New permissions to add**:
```
security.field_visibility.read    Ã¢â‚¬â€ Read field visibility policies
security.field_visibility.write   Ã¢â‚¬â€ Create/update field visibility policies
payroll.sensitive.read            Ã¢â‚¬â€ Override masking for payroll salary/bank fields
```

**Frontend integration**:
- Expose a `maskedFields` summary through `/api/me/entitlements` first; optionally mirror a lightweight summary into `/me` later if needed for performance
- UI components check `maskedFields` before rendering input fields vs masked display
- Bank account detail page shows `****5678` for IBAN unless user has override permission
- Payroll run lines show `*****` for salary unless user has `payroll.sensitive.read`

---

#### PR-5B: Full Diagnostic / Explainability API

**Problem**: When a user gets a 403, there are too many possible causes:
1. Missing permission
2. Permission scope denied (role doesn't cover this entity)
3. Data scope denied (explicit visibility override)
4. Workflow step permission denied
5. Workflow assignment missing
6. Business status blocked (period closed, record locked)
7. SoD rule blocked (user created this record, can't approve)
8. Field-level policy masked a field

Today the user (and the admin troubleshooting for them) has no way to know which layer blocked them.

**What exists today**:
- `rbac_audit_logs` table (from `m003`) tracks role/scope assignment changes
- The middleware returns 403 with a message but doesn't explain the full chain
- No diagnostic endpoint exists

**API**: `GET /api/v1/rbac/access-check`

Query parameters:
```
userId         Ã¢â‚¬â€ target user to check (optional for self-check; omit to check req.user.id, required only when checking another user, which needs elevated audit/security permission)
permissionCode Ã¢â‚¬â€ permission to check (required)
scopeType      Ã¢â‚¬â€ TENANT/GROUP/COUNTRY/LEGAL_ENTITY/OPERATING_UNIT (optional)
scopeId        Ã¢â‚¬â€ specific scope target (optional)
recordId       Ã¢â‚¬â€ specific record for SoD check (optional)
recordType     Ã¢â‚¬â€ record type for SoD check (optional)
```

Response:
```json
{
  "userId": 42,
  "permissionCode": "gl.journal.post",
  "requestedScope": { "type": "LEGAL_ENTITY", "id": 7 },
  
  "result": "DENIED",
  "deniedBy": "data_scope",
  
  "checks": [
    {
      "layer": "capability",
      "result": "PASS",
      "detail": {
        "hasPermission": true,
        "grantedViaRoles": [
          { "roleCode": "GLPostingAuthority", "roleId": 5, "scopeType": "COUNTRY", "scopeId": 2, "effect": "ALLOW" }
        ],
        "dependencies": {
          "gl.journal.read": "SATISFIED"
        }
      }
    },
    {
      "layer": "scope_entitlement",
      "result": "PASS",
      "detail": {
        "source": "permission_scopes",
        "tenantWide": false,
        "accessibleLegalEntities": [3, 7, 12],
        "requestedEntity": 7,
        "hierarchyPath": "COUNTRY:2 Ã¢â€ â€™ LEGAL_ENTITY:7"
      }
    },
    {
      "layer": "visibility_policy",
      "result": "FAIL",
      "detail": {
        "hasExplicitDataScopes": true,
        "dataScopes": [
          { "scopeType": "LEGAL_ENTITY", "scopeId": 3, "effect": "ALLOW" },
          { "scopeType": "LEGAL_ENTITY", "scopeId": 12, "effect": "ALLOW" }
        ],
        "requestedEntity": 7,
        "reason": "User has explicit data scopes that do not include LEGAL_ENTITY:7. Permission scope would allow it, but data scope narrows visibility."
      }
    },
    {
      "layer": "sod",
      "result": "SKIPPED",
      "detail": { "reason": "No recordId provided" }
    },
    {
      "layer": "workflow",
      "result": "SKIPPED",
      "detail": { "reason": "Not a workflow-gated action" }
    },
    {
      "layer": "business_state",
      "result": "SKIPPED",
      "detail": { "reason": "No recordId provided" }
    },
    {
      "layer": "field_visibility",
      "result": "NOT_APPLICABLE",
      "detail": { "reason": "gl.journal.post is not a read action" }
    }
  ],
  
  "recommendations": [
    "Add data scope ALLOW for LEGAL_ENTITY:7 to user 42",
    "OR remove all explicit data scopes to fall back to permission-derived visibility"
  ]
}
```

**Implementation**:

Create `backend/src/services/rbac.diagnostics.service.js`:

```js
export async function checkAccessChain({ userId, tenantId, permissionCode, 
                                          scopeType, scopeId, recordId, recordType }) {
  const checks = [];
  
  // Layer 1: Capability Ã¢â‚¬â€ does user have the permission via any role?
  const capabilityCheck = await checkCapabilityLayer(userId, tenantId, permissionCode);
  checks.push(capabilityCheck);
  if (capabilityCheck.result === 'FAIL') {
    return buildResult('DENIED', 'capability', checks);
  }
  
  // Layer 2: Scope entitlement Ã¢â‚¬â€ does the role assignment cover the requested scope?
  const scopeCheck = await checkScopeEntitlementLayer(
    userId, tenantId, permissionCode, scopeType, scopeId
  );
  checks.push(scopeCheck);
  if (scopeCheck.result === 'FAIL') {
    return buildResult('DENIED', 'scope_entitlement', checks);
  }
  
  // Layer 3: Visibility policy Ã¢â‚¬â€ do data scopes narrow visibility?
  const visibilityCheck = await checkVisibilityLayer(
    userId, tenantId, scopeType, scopeId
  );
  checks.push(visibilityCheck);
  if (visibilityCheck.result === 'FAIL') {
    return buildResult('DENIED', 'data_scope', checks);
  }
  
  // Layer 4: SoD Ã¢â‚¬â€ if recordId provided, check separation of duties
  const sodCheck = recordId 
    ? await checkSoDLayer(userId, tenantId, permissionCode, recordType, recordId)
    : { layer: 'sod', result: 'SKIPPED', detail: { reason: 'No recordId provided' } };
  checks.push(sodCheck);
  if (sodCheck.result === 'FAIL') {
    return buildResult('DENIED', 'sod', checks);
  }
  
  // Layer 5: Workflow Ã¢â‚¬â€ is there a workflow assignment that gates this action?
  const workflowCheck = await checkWorkflowLayer(
    tenantId, permissionCode, scopeType, scopeId
  );
  checks.push(workflowCheck);

  // Layer 6: Business state Ã¢â‚¬â€ if record context exists, check domain-state blockers
  const businessStateCheck = recordId
    ? await checkBusinessStateLayer(userId, tenantId, permissionCode, recordType, recordId)
    : { layer: 'business_state', result: 'SKIPPED', detail: { reason: 'No recordId provided' } };
  checks.push(businessStateCheck);
  if (businessStateCheck.result === 'FAIL') {
    return buildResult('DENIED', 'business_state', checks);
  }
  
  // Layer 7: Field visibility (informational only for read actions)
  const fieldCheck = await checkFieldVisibilityLayer(
    userId, tenantId, permissionCode
  );
  checks.push(fieldCheck);
  
  return buildResult('ALLOWED', null, checks);
}
```

Layer applicability rule:
- Not every layer is authoritative for every action type
- Read actions are usually governed by capability + visibility + field masking
- Write actions are usually governed by capability + scope + SoD + workflow + business-state checks
- Approval actions are usually governed by capability + request-step context + scope + delegation + SoD
- The service shape should keep an explicit slot for domain-state blockers such as period closed, record locked, already posted, reopen not allowed, or invalid status transition
- The API should therefore report layers intentionally as `PASS`, `FAIL`, `SKIPPED`, or `NOT_APPLICABLE` rather than pretending every layer always decides every action

**Route**: Add to `backend/src/routes/rbac.js`:

```js
router.get("/access-check",
  requireAuth,
  validateAccessCheckParams,
  async (req, res) => {
    const targetUserId = req.query.userId 
      ? parseInt(req.query.userId)
      : req.user.id;  // users can always check themselves
    
    // Self-check is always allowed for authenticated users.
    // Checking another user requires elevated permission.
    if (targetUserId !== req.user.id) {
      assertSecondaryPermission(req, "security.audit.read");
    }
    
    const result = await checkAccessChain({
      userId: targetUserId,
      tenantId: req.rbac.tenantId,
      permissionCode: req.query.permissionCode,
      scopeType: req.query.scopeType || null,
      scopeId: req.query.scopeId ? parseInt(req.query.scopeId) : null,
      recordId: req.query.recordId ? parseInt(req.query.recordId) : null,
      recordType: req.query.recordType || null,
    });
    
    res.json(result);
  }
);
```

**Self-service**: Users can always check their own access without needing `security.audit.read`. This enables the frontend to call the endpoint and show contextual "why can't I do this?" help.

**Frontend integration**:
- When a user gets a 403, the UI can offer a "Why?" button that calls `/access-check` for the user's own ID
- The response is displayed as a layered checklist showing which layer blocked
- SecurityAdmin gets a dedicated "Access Debugger" panel in organization settings

**Audit**: Access-check calls are logged to `rbac_audit_logs` with `action = 'ACCESS_CHECK'` so admins can see who is troubleshooting access issues (useful for security reviews).

---

#### PR-5C: Approval Escalation Engine

**Problem**: The system already stored step escalation timing, but overdue requests did not escalate operationally. Pending approvals could sit indefinitely with no scheduler, events, or notifications.

**Shipped implementation**:
- `approval_policy_steps.escalation_after_hours` remains the base timing control
- `m170_approval_escalation_engine` adds `escalation_target_scope_mode` and `escalation_max_count`
- `approval_escalation_events` persists each escalation firing
- `approval.escalation.service.js` resolves overdue requests and records events
- `approval-escalation.job.js` plus scheduler scripts operationalize the sweep
- Escalated requests remain reviewable and visible in normal pending queues

**Runtime commands**:
```
npm run job:approval:escalation:schedule-due
npm run jobs:approval:escalation:scheduler
```

**Behavior**:
- escalation is driven by per-step configuration, not a global feature flag
- `ESCALATED` is non-terminal and still actionable
- the scheduler queues tenant sweeps idempotently by time bucket
- notifications are created through the existing in-app notification infrastructure

**Frontend impact**:
- approval detail pages show escalation history alongside decision history
- queues highlight escalated requests without moving them into a separate dead-end state
- policy setup UI exposes escalation timing and scope-mode configuration

---
#### PR-5D: Approval Delegation Model

**Problem**: Approvals needed a scoped delegation mechanism so leave coverage and temporary authority transfers could happen without bypassing RBAC, request scope, or audit trails.

**Shipped implementation**:
- `m171_approval_delegations` creates the delegation table
- `approval.delegation.service.js` provides create, revoke, list, detail, and resolve helpers
- `approval.engine.service.js` resolves delegation only from the approval request's authoritative scope context
- approval decisions record `acting_user_id`, `delegator_user_id`, `delegation_id`, and `reviewer_authority_user_id`
- SoD checks apply to both the delegate and the delegator during decision recording

**Constraints**:
- delegators can only delegate authority they actually hold
- overlapping delegations for the same delegator, delegate, module, and scope are rejected
- runtime delegation state is derived from `effective_from`, `effective_to`, `is_active`, and revocation metadata
- expired delegations naturally stop resolving after `effective_to`; no dedicated expiry sweep is required for correctness

**Audit shape**:
- decisions preserve both the human actor and the delegated authority source
- admin and self-service UI can distinguish `ACTIVE`, `UPCOMING`, `EXPIRED`, and `REVOKED` delegations

**UI impact**:
- users get incoming/outgoing delegation visibility
- approval actions can show "approving on behalf of X" when delegation is in effect
- admins can list, filter, create, and revoke delegations from the security area

---
#### PR-5E: Compliance Audit Report Package

**Problem**: External auditors need a structured report of who has access to what, what SoD violations exist, and how approval workflows are configured. Today this requires manually querying multiple tables.

**API**:
- `POST /api/v1/rbac/audit-reports` - generate one JSON report payload
- `GET /api/v1/rbac/audit-reports/export.csv` - export one report family as CSV

Parameters for JSON body / CSV query string:
```
reportType  - 'ACCESS_MATRIX' | 'SOD_ANALYSIS' | 'APPROVAL_COVERAGE' | 'DELEGATION_LOG' | 'FULL'
asOfDate    - point-in-time snapshot (default: today)
scopeType   - optional filter (LEGAL_ENTITY, GROUP, etc.)
scopeId     - optional filter
```

Contract notes:
- `FULL` is supported on the JSON API only and returns all four report families in one response.
- CSV export is intentionally limited to a single report family and rejects `reportType = FULL`.
- The admin UI exposes the four single-family reports; `FULL` is primarily for API consumers and audit tooling.

**Report types**:

**1. ACCESS_MATRIX** - Who has what permissions at what scope:
```json
{
  "reportType": "ACCESS_MATRIX",
  "asOfDate": "2026-04-02",
  "matrix": [
    {
      "userId": 42,
      "userName": "John Smith",
      "email": "john@example.com",
      "status": "ACTIVE",
      "roles": [
        {
          "roleCode": "GLPostingAuthority",
          "scopeType": "LEGAL_ENTITY",
          "scopeId": 7,
          "scopeName": "Acme Turkey Ltd",
          "effect": "ALLOW",
          "assignedAt": "2025-11-01",
          "effectiveFrom": null,
          "effectiveTo": null
        }
      ],
      "effectivePermissions": [
        {
          "code": "gl.journal.post",
          "scopes": [
            { "type": "LEGAL_ENTITY", "id": 7, "name": "Acme Turkey Ltd" }
          ]
        }
      ],
      "dataScopes": [],
      "activeDelegations": [],
      "scopeSummary": {
        "permissionScopeContext": { "scopeTypes": ["LEGAL_ENTITY"] },
        "visibilityScopeContext": null
      },
      "isVisibilityNarrowed": false
    }
  ]
}
```

**2. SOD_ANALYSIS** - Potential separation-of-duties conflicts:
```json
{
  "reportType": "SOD_ANALYSIS",
  "conflicts": [
    {
      "userId": 42,
      "userName": "John Smith",
      "conflictRule": {
        "actionA": "gl.journal.create",
        "actionB": "gl.journal.post",
        "severity": "warn"
      },
      "roleA": "GLOperator",
      "roleB": "GLPostingAuthority",
      "overlappingScopes": [
        { "type": "LEGAL_ENTITY", "id": 7, "name": "Acme Turkey Ltd" }
      ],
      "mitigatingControls": [
        "Workflow approval required for journal posting at LEGAL_ENTITY:7"
      ]
    }
  ],
  "summary": {
    "totalUsers": 45,
    "usersWithConflicts": 3,
    "blockLevelConflicts": 0,
    "warnLevelConflicts": 5,
    "mitigatedConflicts": 4,
    "unmitigatedConflicts": 1
  }
}
```

**3. APPROVAL_COVERAGE** - Which business actions require approval and which do not:
```json
{
  "reportType": "APPROVAL_COVERAGE",
  "coveredActions": [
    {
      "moduleCode": "BANK",
      "targetType": "PAYMENT_BATCH",
      "actionType": "RELEASE",
      "policyCount": 2,
      "policies": [
        {
          "id": 1,
          "minAmount": 0,
          "maxAmount": 50000,
          "requiredApprovals": 1,
          "makerCheckerRequired": true,
          "steps": 1
        },
        {
          "id": 2,
          "minAmount": 50000,
          "maxAmount": null,
          "requiredApprovals": 2,
          "makerCheckerRequired": true,
          "steps": 2
        }
      ]
    }
  ],
  "uncoveredActions": [
    {
      "moduleCode": "CASH",
      "targetType": "CASH_OVERRIDE",
      "actionType": "POST",
      "note": "Cash control overrides have no approval policy configured"
    },
    {
      "moduleCode": "CARI",
      "targetType": "DOCUMENT",
      "actionType": "REVERSE",
      "note": "Document reversals have no approval policy configured"
    }
  ]
}
```

**4. DELEGATION_LOG** - All delegation activity for the point-in-time snapshot:
```json
{
  "reportType": "DELEGATION_LOG",
  "asOfDate": "2026-04-02",
  "delegations": [
    {
      "id": 12,
      "delegatorUserId": 14,
      "delegatorName": "Jane Doe",
      "delegateUserId": 27,
      "delegateName": "Bob Wilson",
      "moduleCode": "APPROVAL",
      "scopeType": "LEGAL_ENTITY",
      "scopeId": 7,
      "scopeName": "Acme Turkey Ltd",
      "effectiveFrom": "2026-03-10",
      "effectiveTo": "2026-03-24",
      "reason": "Annual leave",
      "status": "EXPIRED",
      "revokedAt": null,
      "revokedReason": null,
      "decisionsActedOn": 7,
      "decisionDetails": [
        { "requestId": 456, "action": "APPROVE", "moduleCode": "BANK", "decidedAt": "2026-03-15" }
      ]
    }
  ],
  "summary": {
    "totalDelegations": 12,
    "activeDelegations": 4,
    "revokedDelegations": 3,
    "expiredDelegations": 5,
    "delegatedDecisionCount": 7
  }
}
```

**New permissions**:
```
security.audit.report.generate    - Generate compliance audit reports
security.audit.report.export      - Export audit reports as CSV
```

**Frontend**:
- SecurityAdmin - Compliance Reports section
  - Generate each report type with date and scope filters
  - Preview results in the admin UI
  - Export the current filter state as CSV for external auditor consumption
- The UI currently exposes the four single-family reports. `FULL` remains API-only.
---

## Implementation Order & Dependencies

```
PHASE 0 (low risk pre-go-live, do first)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-0A: Vocabulary normalization
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-0B: Add missing permission codes          Ã¢â€ Â parallel
  Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ PR-0C: Permission capability groups (constants)

PHASE 1 (medium risk, do second)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-1A: Fix semantic permission misuse         Ã¢â€ Â depends on 0B
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-1B: TenantAdmin compatibility shims        Ã¢â€ Â depends on 0C
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-1C: Capability-group metadata on roles     Ã¢â€ Â depends on 0C, 1A, 1B
  Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ PR-1D: Permission dependency/conflict rules   Ã¢â€ Â depends on 0C

PHASE 2 (medium risk, parallel with Phase 1)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-2A: Explicit scope model + `/me/entitlements` Ã¢â€ Â independent
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-2B: Frontend scope awareness rollout       Ã¢â€ Â depends on 2A
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-2C: Temporal role assignments only         Ã¢â€ Â independent
  Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ PR-2D: Shared authz / scope utility layer     Ã¢â€ Â independent

PHASE 3 (high risk, do after Phases 1+2)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-3A: Generic approval engine schema          Ã¢â€ Â independent
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-3B: Unified approval service                Ã¢â€ Â depends on 3A, 2D
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-3C: Pilot contained approval flow           Ã¢â€ Â depends on 3B
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-3D: Migrate bank approvals                  Ã¢â€ Â depends on 3B, 3C
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-3E: Migrate workflow approvals              Ã¢â€ Â depends on 3B, 3C
  Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ PR-3F: Migrate remaining ad-hoc approvals     Ã¢â€ Â depends on 3B, 3C

PHASE 4 (high risk, do after Phase 3)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-4A: Duty-boundary roles                     Ã¢â€ Â depends on 1C, 3B
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-4B: SoD service integration                 Ã¢â€ Â depends on 4A
  Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ PR-4C: Migration tool                          Ã¢â€ Â depends on 4A, 4B

PHASE 5 (medium risk, do after Phase 4)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-5A: Field-level permission policies         Ã¢â€ Â depends on 4A (roles), 2D
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-5B: Diagnostic / explainability API         Ã¢â€ Â depends on 2A (scope model), 4B (SoD service), 2D
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-5C: Approval escalation engine              Ã¢â€ Â depends on 3B (unified engine), 2D, uses notification infra (m074)
  Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ PR-5D: Approval delegation model               Ã¢â€ Â depends on 3B (unified engine), 4B (SoD service), 2D
  Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ PR-5E: Compliance audit report package         Ã¢â€ Â depends on 5A, 5B, 5D (reads from all prior structures)
```

---

## Frontend Delivery Track (Companion Workstream)

This roadmap is not backend-only. Frontend delivery should start in parallel with the backend critical path so APIs, diagnostics, and admin workflows are shaped by real UX requirements instead of being integrated only at the end.

### PHASE 0 Ã¢â‚¬â€ Frontend Consistency

**UI-0A: Lifecycle UI Consistency**
- Normalize status badges, filters, labels, and exact-string checks to `CANCELLED`
- Remove any active UI dependency on `CANCELED`
- Keep frontend lifecycle vocabulary aligned with the canonical constants introduced in Phase 0

### PHASE 1 Ã¢â‚¬â€ Frontend Terminology Cleanup

**UI-1A: Permission / Admin Terminology Cleanup**
- Update workflow-management UI so governance is no longer described as onboarding setup
- Update CARI review screens so approval/review actions are clearly distinct from edit authority
- Add transitional capability summaries where useful, without attempting the full role-management redesign yet

### PHASE 2 Ã¢â‚¬â€ Scope-Aware UX Foundation

**PR-2B remains the primary frontend auth rollout**
- Fetch `/api/me/entitlements` alongside `/me`
- Extend `AuthContext.jsx` and `RequirePermission.jsx` to support scope-aware UX
- Replace hide-only behavior on governed screens with clearer states:
  - disabled with explanation
  - wrong-scope messaging
  - visibility-narrowed messaging
- Introduce reusable UI primitives for scope and entitlement awareness:
  - scope badges / scope summary
  - denied-state panel
  - visibility-narrowed notice
  - entitlement-aware action wrapper

### PHASE 3 Ã¢â‚¬â€ Shared Approval UX + CARI Pilot

**UI-3A: Shared Approval UX Library**
- Build reusable approval UI components for:
  - submit for review
  - approve / reject / return / withdraw
  - request / review status badges
  - execution status badges
  - decision history / timeline
- Pilot those components first on the `cari` counterparty request flow
- Keep request/review status visually distinct from execution status

### PHASE 4 Ã¢â‚¬â€ Role Management Redesign

**UI-4A: Composable Role Management UX**
- Redesign role-assignment UI around smaller composable roles instead of only broad title roles
- Make scope type and scope target explicit in assignment flows
- Show role capability summaries and SoD warnings before save
- Make it clear that `GLPostingAuthority` is a companion authority role, not a standalone business persona

### PHASE 5 Ã¢â‚¬â€ Advanced Governance Screens

**UI-5A: Sensitive Field UX**
- Show masked values, hidden values, and unrestricted values consistently
- Keep cross-entity views aligned with row-scope-aware masking decisions

**UI-5B: Access Debugger Experience**
- Add a user-facing "Why can't I do this?" flow powered by `/api/v1/rbac/access-check`
- Add a SecurityAdmin access-debugger panel in organization/security settings

**UI-5C: Escalation UX**
- Keep escalated requests visible in normal pending queues with elevated urgency styling
- Show escalation timeline alongside decision history
- Add escalation configuration UI to approval policy setup

**UI-5D: Delegation UX**
- Add outgoing and incoming delegation views
- Show "approving on behalf of X" during delegated approval actions
- Provide admin delegation management surfaces

**UI-5E: Compliance Reporting Screens**
- Add compliance report filters, previews, and export actions for:
  - access matrix
  - SoD analysis
  - approval coverage
  - delegation log

### Suggested Frontend Batches

1. UI-0A, UI-1A, and `AuthContext` preparation for entitlements fetch
2. PR-2B and the first explainable permission/scope states on main governed pages
3. UI-3A and the `cari` pilot approval UI migration
4. UI-4A role-management redesign
5. UI-5A, UI-5B, UI-5C, UI-5D, and UI-5E

### Frontend Freeze Criteria Before Starting Phase 3

- `AuthContext` can consume `/api/me/entitlements` without breaking existing flows
- At least one governed screen distinguishes missing permission, wrong scope, and visibility narrowing
- The `cari` pilot has reusable approval UI primitives rather than module-specific one-off buttons

---

## What NOT to Change (Preserved from Current System)

| Component | Why Keep It |
|-----------|-------------|
| 5-level scope hierarchy (TENANTÃ¢â€ â€™GROUPÃ¢â€ â€™COUNTRYÃ¢â€ â€™LEGAL_ENTITYÃ¢â€ â€™OU) | Matches real multi-entity holding structure |
| Hierarchical scope cascading in `rbac.js:784-897` | Correct downward expansion with deny subtraction |
| ALLOW/DENY effect model on `user_role_scopes` | Enables scope carve-outs without role duplication |
| Multi-tier cache with version-stamp invalidation | Well-engineered, handles Redis fallback gracefully |
| `requirePermission(code, { resolveScope })` pattern | Clean dynamic scope binding per route |
| Workflow step permission resolution (`workflows.service.js:1181-1215`) | Best-in-class dynamic step authorization |
| Maker-checker in workflow decisions (`workflows.service.js:1271-1279`) | Correct SoD enforcement (extend, don't replace) |
| Local close pack lifecycle (prepareÃ¢â€ â€™submitÃ¢â€ â€™returnÃ¢â€ â€™approveÃ¢â€ â€™lockÃ¢â€ â€™reopen) | Most mature workflow Ã¢â‚¬â€ use as reference model |
| Idempotency keys on approval requests | Critical for financial double-execution prevention |
| Permission catalog approach (280+ granular action codes) | Better than role-hardcoded behavior |

---

## Implementation Status (as of PR-6D Closure)

All phases of the RBAC & Governance Redesign have been implemented. This section records what shipped and what operators need to know.

### Phase Completion Summary

| Phase | Status | Key Artifacts |
|-------|--------|---------------|
| **Phase 0** Ã¢â‚¬â€ Vocabulary & Permission Hygiene | **Shipped** | `backend/src/constants/lifecycle.js`, `CANCELLED` normalization, missing permission codes seeded |
| **Phase 1** Ã¢â‚¬â€ Permission Architecture Cleanup | **Shipped** | Semantic permission fixes on workflow/cari routes, SecurityAdmin + SystemAdmin roles in `seedCore.js`, capability group metadata in `permission-groups.js`, dependency/conflict rules in `permission-rules.js` |
| **Phase 2** Ã¢â‚¬â€ Scope Model Clarification | **Shipped** | Explicit dual-scope model (`permissionScopeContext` / `visibilityScopeContext`) in `authz.scope.service.js`, `/api/me/entitlements` endpoint, temporal role assignments (`m162`), shared authz utility layer |
| **Phase 3** Ã¢â‚¬â€ Unified Approval Engine | **Shipped** | Generic schema (`m163`), `approval.engine.service.js`, CARI pilot, bank bridge (`m165`), workflow bridge (`m166`), ad-hoc migration complete |
| **Phase 4** Ã¢â‚¬â€ Role Redesign | **Shipped** | Duty-boundary roles (SecurityAdmin, SystemAdmin, GLOperator, TreasuryOperator, etc.), SoD service (`sod.service.js`, `sod-rules.js`), role migration tool (`m168`, `roleMigration.service.js`) |
| **Phase 5** Ã¢â‚¬â€ Advanced Governance | **Shipped** | Field-level visibility (`fieldVisibility.js`), access-debugger (`rbac.diagnostics.service.js`, `/access-check` route), escalation engine (`approval.escalation.service.js`), delegation model (`m171`, `approval.delegation.service.js`), compliance reports (`rbac.auditReport.service.js`) |
| **Phase 6** Ã¢â‚¬â€ Closure | **Shipped** | PR-6A: legacy role retirement, PR-6B: unified approval hard cutover (feature flags removed), PR-6C: explicit scope semantics cutover, PR-6D: this document |

### Retired Transitional Artifacts

| Artifact | Disposition |
|----------|-------------|
| `BANK_APPROVALS_UNIFIED_ENGINE` env var | **Removed** Ã¢â‚¬â€ unified engine is the only runtime path |
| `WORKFLOWS_UNIFIED_ENGINE` env var | **Removed** Ã¢â‚¬â€ unified engine is the only runtime path |
| `isBankUnifiedApprovalEnabled()` | **Removed** Ã¢â‚¬â€ dead code after PR-6B |
| `isWorkflowUnifiedApprovalEnabled()` | **Removed** Ã¢â‚¬â€ dead code after PR-6B |
| `getEffectiveScopeContext()` | **Removed** Ã¢â‚¬â€ replaced by explicit `getVisibilityScope()` and `getPermissionScope()` in PR-6C |
| `getScopeContext()` | **Removed** - callers migrated to explicit `getVisibilityScope()` / `getPermissionScope()` |
| `TenantAdmin` role | **Retired from active catalog** Ã¢â‚¬â€ preserved only for rollback recovery |
| `GroupController` / `CountryController` / `EntityAccountant` | **Retired from active catalog** Ã¢â‚¬â€ replaced by composable duty-boundary roles |
| Legacy bank approval direct-insert path | **Removed** Ã¢â‚¬â€ all bank approvals route through unified engine with legacy table mirroring for audit |
| Legacy workflow decision path | **Removed** Ã¢â‚¬â€ all workflow decisions route through unified engine |

---

## Post-Migration Operating Model

This section documents how operators should run the governance system in its shipped steady state.

**Operator runbook**: `docs/runbooks/rbac-governance-operations.md`

### 1. Role Model

**Fresh tenants** are seeded with composable duty-boundary roles only (SecurityAdmin, SystemAdmin, GLOperator, TreasuryOperator, etc.). Legacy broad roles (TenantAdmin, GroupController, CountryController, EntityAccountant) are not seeded for new tenants.

**Brownfield tenants** that completed the PR-4C migration have users on composable roles. The legacy roles remain in the database with `is_system = false` for rollback safety but are hidden from the normal role catalog UI.

**Assigning roles**: Users receive multiple roles at different scopes. For example, a country controller receives GLOperator + GLPostingAuthority + TreasuryApprover + PayrollApprover + LocalCloseReviewer at COUNTRY scope.

**Rollback**: If a migrated tenant encounters issues, `roleMigration.service.js` supports rollback to the previous role set. Legacy roles are preserved in the database for this purpose. Once the operator confirms the migration is stable, legacy role rows can be archived.

### 2. Unified Approval Engine

**Runtime**: All approval flows (bank, workflow, CARI, payments, payroll, inventory, close/reopen) route through `approval.engine.service.js`. There are no feature flags or alternate runtime paths.

**Legacy tables**: `bank_approval_requests`, `bank_approval_request_decisions`, `workflow_instances`, and `workflow_instance_decisions` continue to receive mirrored writes from the unified engine for audit and compatibility. They are **not** alternate runtime engines. The source of truth for approval state is the `approval_requests` / `approval_decisions` tables.

**Policy management**: Approval policies are managed through `approval_policies` + `approval_policy_steps` + `approval_policy_assignments`. Legacy `bank_approval_policies` and `workflow_definitions` are bridged to generic policies automatically.

### 3. Scope Model

**Dual-scope model**: The RBAC middleware distinguishes two scope contexts on every authenticated request:

| Context | Purpose | Accessor |
|---------|---------|----------|
| `permissionScopeContext` | Where the user can **act** (mutation/action guards) | `getPermissionScope(req)` from `rbac.js` |
| `visibilityScopeContext` | What data the user can **see** (list filtering) | `getVisibilityScope(req)` from `rbac.js` |

- `assertScopeAccess()` and `hasScopeAccess()` use **permission scope**
- `buildScopeFilter()` uses **visibility scope** (falls back to permission scope when no data-scope narrowing exists)
- `req.rbac.scopeContext` is kept on the request object for backward-compatible list-filtering readers but points to the visibility scope

**Diagnostics**: `/api/me/entitlements` returns the full permission + scope + visibility model for the authenticated user. `/api/v1/rbac/access-check` provides layered diagnostic checks for troubleshooting.

### 4. Escalation Scheduler

**Service**: `approval.escalation.service.js` provides `sweepDueApprovalEscalations()`, while `approval-escalation.job.js` provides the scheduler/job seam that queues and runs tenant sweep jobs.

**Enablement**:
- One-shot scheduling tick: `npm run job:approval:escalation:schedule-due`
- Long-running scheduler loop: `npm run jobs:approval:escalation:scheduler`

Supported environment variables:
- `APPROVAL_ESCALATION_TENANT_ID` - optional tenant pin for manual/operator runs
- `APPROVAL_ESCALATION_USER_ID` - optional acting user id recorded on queued jobs
- `APPROVAL_ESCALATION_LIMIT` - max tenants scanned per scheduler tick
- `APPROVAL_ESCALATION_INTERVAL_MINUTES` - idempotency bucket for due scheduling
- `APPROVAL_ESCALATION_POLL_MS` - loop interval for the long-running scheduler
- `APPROVAL_ESCALATION_DRY_RUN` - one-shot scheduler dry-run mode

**Behavior**: Escalated requests remain reviewable (`ESCALATED` is non-terminal). Escalation changes urgency and notifications, not whether the request can still be decided.

**Configuration**: Per-step escalation is configured on `approval_policy_steps` through `escalation_after_hours`, `escalation_target_scope_mode`, and `escalation_max_count`. No global toggle exists; escalation is active for any step that has `escalation_after_hours` set.
### 5. Delegation

**Service**: `approval.delegation.service.js` manages scoped approval delegations and resolves delegated authority only from the approval request's authoritative scope.

**Constraints**:
- Delegators can only delegate permissions they actually hold at the relevant scope.
- Overlapping delegations for the same delegator, delegate, module, and scope are rejected.
- Delegation checks remain scope-aware and SoD-aware when used during approval decisions.

**State model**: Delegation rows store `effective_from`, `effective_to`, `is_active`, and revocation metadata. Runtime state such as `ACTIVE`, `UPCOMING`, `EXPIRED`, and `REVOKED` is derived from those fields at read time.

**Expiry**: A dedicated expiry sweep is not required for correctness in the shipped implementation. Expired delegations naturally stop resolving once `effective_to` is in the past.
### 6. Compliance Reporting

**Service**: `rbac.auditReport.service.js` provides `buildComplianceAuditReport()` and `buildComplianceAuditReportCsv()`.

**Report types**:
- `ACCESS_MATRIX`
- `SOD_ANALYSIS`
- `APPROVAL_COVERAGE`
- `DELEGATION_LOG`
- `FULL` (JSON API only)

**Access**: Reports are gated by `security.audit.report.generate` and `security.audit.report.export`.

**Usage**:
- JSON generation: `POST /api/v1/rbac/audit-reports`
- CSV export: `GET /api/v1/rbac/audit-reports/export.csv`
- Admin UI: `/app/ayarlar/rbac/compliance-reports`

**Export rule**: CSV export is intentionally limited to one report family at a time; `reportType = FULL` is rejected on the CSV endpoint.
### 7. Field-Level Visibility

**Middleware**: `fieldVisibility.js` applies row-scope-aware masking based on `field_visibility_policies`. Policies are seeded for sensitive fields (IBAN, salary, credentials) and can be overridden per tenant.

**Override**: Users with the policy's `required_permission_code` at the row's scope see unmasked values. Cross-entity lists evaluate masking per row, not per request.

### 8. Seed and Migration

**Fresh tenants**: `seedCore.js` seeds composable roles, permission codes, capability group metadata, and default field visibility policies. Legacy broad roles are not seeded.

**Existing tenants**: Run the migration tool (`roleMigration.service.js`) to map old role assignments to composable roles. The tool generates a preview report before executing. Keep legacy roles until the operator confirms stability.

**Schema migrations**: All governance schema changes are in the migration index (`migrations/index.js`). Key migrations: `m162` (temporal roles), `m163` (generic approval engine), `m165` (bank bridge), `m166` (workflow bridge), `m168` (role migration), `m171` (delegations).
