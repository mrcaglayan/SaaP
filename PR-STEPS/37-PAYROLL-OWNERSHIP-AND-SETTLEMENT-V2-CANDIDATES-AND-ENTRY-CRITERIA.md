# 37 - PAYROLL OWNERSHIP AND SETTLEMENT V2 CANDIDATES AND ENTRY CRITERIA

## Purpose

- This file is a dormant follow-on tracker for payroll ownership and settlement scope that sits outside [36 - PAYROLL EFFECTIVE-DATED EMPLOYEE OWNERSHIP, OU-ATTRIBUTED ACCRUALS, AND SELF-BALANCED PAYROLL SETTLEMENTS](C:/Users/ufukk/Desktop/SaaP/PR-STEPS/36%20-%20PAYROLL%20EFFECTIVE-DATED%20EMPLOYEE%20OWNERSHIP,%20OU-ATTRIBUTED%20ACCRUALS,%20AND%20SELF-BALANCED%20PAYROLL%20SETTLEMENTS.md).
- It exists so likely post-V1 expansion items are captured now and are not forgotten later.
- It must not be used to silently expand V1 scope while `36` is still the active implementation contract.

## Current status

- Status: `DORMANT`
- Activation rule: open this tracker only when one or more V2 triggers below becomes committed product scope.
- Default instruction: keep `36` frozen as the V1 delivery contract and treat this file as a future-scope holding area.

## Why this is separate from V1

- V1 fits the repo's current architecture:
  - one authoritative model: `employee_code -> operating_unit_id`
  - one owner per employee as of one locked run-level date
  - mixed-OU payroll runs allowed
  - central <-> OU payroll settlement only
  - reuse of existing OU self-balancing helper
  - no payment-batch schema redesign
  - no beneficiary banking redesign
  - no allocation engine
- V2 begins when payroll scope requires a new authority model, a new allocation model, broader settlement topology, or generic payment-schema redesign.

## V2 triggers

- Any of the following should move scope from `36` into this V2 tracker:
- percentage-based split of one employee's payroll across multiple OUs
- percentage-based split across cost centers, departments, projects, or other dimensions
- `cost_center_code` becoming an authoritative ownership source instead of validation-only
- support for OU bank paying another OU's payroll liability
- OU-scoped employee beneficiary banking
- payroll-specific treasury orchestration beyond the shared payment engine
- immutable payer/owner snapshots requiring `payment_batches` or `payment_batch_lines` schema redesign
- mandatory historical backfill of pre-V1 payroll ownership state instead of grandfathering
- manual ownership override flows on finalized payroll data
- payroll ownership source expanding beyond payroll-only employee assignment records into broader HR master redesign

## Non-triggers

- The following should normally stay in `36` and should not activate V2 by themselves:
- fixing V1 bugs
- missing tests or release-gate coverage
- API/response field additions that preserve the V1 contract
- reporting or UI polish for already-approved V1 fields
- performance tuning of V1 ownership resolution
- migration sequencing or rollout adjustments that do not change the authority model

## Candidate workstreams

- [ ] `PV2-01` - Multi-owner payroll allocation model
- [ ] `PV2-02` - Alternative ownership authority models
- [ ] `PV2-03` - OU-scoped payroll beneficiary and treasury model
- [ ] `PV2-04` - Expanded cross-context payroll settlement topology
- [ ] `PV2-05` - Generic payment-batch snapshot/schema hardening for payroll ownership
- [ ] `PV2-06` - Historical payroll backfill and upgrade tooling
- [ ] `PV2-07` - V2 controls, reporting, exports, and release gates

---

## `PV2-01` - Multi-owner payroll allocation model

### Why it exists

- V1 assumes one authoritative owner OU per employee as of one locked date.
- V2 starts here if product needs one employee's payroll split across multiple OUs or allocation dimensions.

### Candidate scope

- percentage-based payroll ownership split by employee and effective date
- allocation lines that total 100%
- optional layering of OU + cost center + department + project allocation dimensions
- line-level attribution rules for expense, liability, and statutory components
- allocation-aware accrual posting and reversal behavior

### Decisions to lock before implementation

- whether V2 allocation is OU-only or multi-dimensional
- whether statutory liabilities follow the same split as expenses
- rounding strategy and residual handling
- whether net pay follows allocation or a single owner context
- how reversals and retro corrections preserve historical split logic

---

## `PV2-02` - Alternative ownership authority models

### Why it exists

- V1 intentionally avoids `cost_center_code` authority and broader HR-master authority.

### Candidate scope

- `cost_center_code -> operating_unit_id` authority
- rule-priority resolution across employee assignment, cost center, department, project, or HR master sources
- source precedence controls and auditability
- ownership conflict diagnostics and operator override governance

### Decisions to lock before implementation

- single authority vs precedence chain
- whether cost center is a full replacement or only fallback authority
- whether authority can vary by legal entity or payroll provider
- whether imported source values are trusted or validated only

---

## `PV2-03` - OU-scoped payroll beneficiary and treasury model

### Why it exists

- V1 keeps employee beneficiary banking employee/legal-entity scoped and uses the shared payment engine.

### Candidate scope

- OU-scoped employee beneficiary bank accounts
- payer-bank selection rules by owner OU
- payroll-specific treasury constraints or bank-priority rules
- cross-OU payment orchestration policies beyond current batch-prep checks

### Decisions to lock before implementation

- whether beneficiary setup is employee + OU or employee + OU + currency
- whether central fallback remains allowed
- how beneficiary snapshots behave when OU changes after payroll import
- whether treasury rules live in payroll or generic payments

---

## `PV2-04` - Expanded cross-context payroll settlement topology

### Why it exists

- V1 allows same-context, central -> OU, and OU -> central settlement only.

### Candidate scope

- OU -> OU payroll settlement
- chained settlement routing rules
- explicit disallow / allow lists by OU pair
- enhanced self-balancing journal structures and diagnostics

### Decisions to lock before implementation

- whether OU -> OU is direct or always routed through central
- whether all OU pairs are allowed or only configured pairs
- whether generic payment posting remains reusable without module-specific forks
- how settlement evidence and sync logic recognize more complex routing

---

## `PV2-05` - Generic payment-batch snapshot/schema hardening for payroll ownership

### Why it exists

- V1 tries to avoid payment-batch schema redesign.
- V2 begins here if query-only enrichment is no longer enough for immutable payroll ownership evidence.

### Candidate scope

- immutable owner/payer context snapshots on payment batch lines
- batch-level mixed-context metadata
- richer journal-line linkage than one `settlement_journal_line_ref`
- replay-safe post/export/ack contracts for cross-context payroll batches

### Decisions to lock before implementation

- which ownership fields must be immutable snapshots vs query-time joins
- whether generic payments stays source-agnostic or accepts payroll-specific columns
- backward-compatibility strategy for legacy payment batches
- whether bank export / ack flows need new contracts for context-rich payroll batches

---

## `PV2-06` - Historical payroll backfill and upgrade tooling

### Why it exists

- V1 allows grandfathering of historical finalized payroll data.

### Candidate scope

- backfill of historical payroll run line OU snapshots
- backfill of historical liability owner OU
- historical settlement verification and remediation
- dry-run + audit tooling for upgrade safety

### Decisions to lock before implementation

- mandatory vs optional backfill
- whether historical data is inferred, imported, or manually curated
- acceptable confidence threshold for inferred ownership
- whether historical close periods can be reopened or only supplemented

---

## `PV2-07` - V2 controls, reporting, exports, and release gates

### Why it exists

- Expanded ownership and settlement models will require tighter downstream controls than V1.

### Candidate scope

- V2-specific close checks
- richer reporting for allocation and cross-context routing
- export snapshots that preserve V2 ownership and settlement evidence
- new end-to-end release gates spanning payroll, payments, and bank reconciliation

### Decisions to lock before implementation

- which V2 states are blocking vs warning-only
- minimum audit evidence required for close
- whether export snapshots become migration-grade artifacts
- release-gate coverage threshold before production rollout

## Entry checklist

- [ ] `36` is materially complete or intentionally frozen
- [ ] At least one V2 trigger is approved as committed product scope
- [ ] Product direction is written down as explicit locked decisions, not implied assumptions
- [ ] Required generic-module changes are identified up front
- [ ] Historical-data policy is chosen before implementation starts
- [ ] Reporting / export / release-gate impact is included from the start

## Definition of ready

- [ ] A new active implementation tracker is opened from this file or this file is promoted from dormant to active
- [ ] V2 scope is explicitly separated from unresolved V1 defects
- [ ] All authority-model and settlement-topology decisions needed for coding are locked
- [ ] Repo-wide contract changes are named before implementation starts
