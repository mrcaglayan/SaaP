# Workflow Governance Role, Package, and Preset Specification

## Target model for AP Document Posting, Local Close Pack, Period Close, and Consolidation Run

## Status

- Proposed
- Repo-aligned to current shipped security inventory
- Admin-facing naming cleaned up from current mixed role/bundle naming
- BranchOperator is renamed in UI/business language to **Branch Accountant**
- Legacy compatibility roles remain in backend/runtime until separately refactored

---

## 1. Goal

Create a clear, user-friendly governance model for these 4 workflows:

1. AP Document Posting
2. Local Close Pack
3. Period Close
4. Consolidation Run

The design must allow:

- business-friendly role names
- reusable workflow action packages
- predefined workflow presets admins can select
- flexible assignment by scope
- the same business title to behave differently in different entities/groups
- the same workflow step to be assigned to different business roles in different tenants

Example of desired flexibility:

- Branch Accountant creates and submits
- Entity Accountant approves
- Entity CEO posts

or:

- Branch Accountant creates and submits
- Entity Accountant approves
- Group Approver posts

This flexibility is a required product behavior.

---

## 2. Core Design Rule

The governance model must separate:

### A. Business Roles

Who the person is in the organization

### B. Workflow Packages

What workflow action the person is allowed to perform

### C. Workflow Presets

A ready-made sequence of workflow steps admins can select

### D. Runtime/Legacy Roles

Current internal roles/bundles kept for compatibility until safely refactored

This separation is mandatory.

Business role must NOT directly hardcode workflow authority.

Instead:

- user gets one or more **business roles**
- user also gets one or more **workflow packages**
- packages are assigned at a specific **scope**
- workflow steps require **package authority**, not a title

---

## 3. Business Role Catalog (Admin-Facing)

These are the main business labels shown in the admin UI.

| Business Role     | Scope          | Meaning                                   |
| ----------------- | -------------- | ----------------------------------------- |
| Branch Accountant | OPERATING_UNIT | branch-level finance operator             |
| Branch Manager    | OPERATING_UNIT | branch-level reviewer/manager if included |
| Entity Accountant | LEGAL_ENTITY   | legal-entity accounting owner             |
| Entity Manager    | LEGAL_ENTITY   | legal-entity managerial approver          |
| Entity CEO        | LEGAL_ENTITY   | final legal-entity authority              |
| Group Checker     | GROUP          | group-level checker/reviewer              |
| Group Approver    | GROUP          | group-level approver/finalizer            |
| Group CEO         | GROUP          | executive final authority                 |

### Important Rule

These labels are business-facing labels only.

They do not directly define permissions.
Permissions come from workflow packages.

---

## 4. Admin UI Structure

The governance/security setup UI should be split into 3 clear tabs.

### Tab 1 — Business Roles

Show only the business-friendly labels:

- Branch Accountant
- Branch Manager
- Entity Accountant
- Entity Manager
- Entity CEO
- Group Checker
- Group Approver
- Group CEO

### Tab 2 — Workflow Packages

Show reusable action packages like:

- AP Documents / Draft & Submit
- AP Documents / Approve
- AP Documents / Post
- Local Close Pack / Prepare & Submit
- Local Close Pack / Review
- Local Close Pack / Approve & Lock
- Period Close / Readiness View
- Period Close / Approve & Close
- Consolidation / Prepare Run
- Consolidation / Execute Run
- Consolidation / Finalize

### Tab 3 — Workflow Presets

Show ready-made templates like:

- AP / Lean Entity
- AP / Standard Entity
- AP / Group-Controlled Post
- Local Close / Standard
- Local Close / Group-Supervised
- Period Close / Standard
- Consolidation / Standard
- Consolidation / Controlled

---

## 5. Legacy Role Treatment

These current roles should remain in runtime/backend for compatibility, but be hidden from normal fresh-tenant admin pickers:

- TenantAdmin
- Legacy broad AP posting role
- GroupController
- CountryController
- EntityAccountant (legacy inline broad role)
- CountryAPController label (replace with cleaner label)
- EntityAPController label (replace with cleaner label)

### Rename policy for admin UI

- BranchOperator -> Branch Accountant
- EntityAPController -> AP Submitter
- CountryAPApprover -> AP Reviewer
- CountryAPController / CountryAPPoster -> AP Poster

Runtime/internal codes can remain unchanged initially.

---

## 6. Shared Governance Setup Packages

These packages apply across all workflow families.

| Package Code       | Admin Label                            | Scope                                | Permission Codes                                                                                                                                            |
| ------------------ | -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PKG-WF-SETUP-ADMIN | Workflow Governance / Setup Admin      | TENANT, GROUP, COUNTRY, LEGAL_ENTITY | workflow.definition.read, workflow.definition.write, workflow.assignment.read, workflow.assignment.write, approvals.policies.read, approvals.policies.write |
| PKG-WF-QUEUE-VIEW  | Workflow Governance / Queue Visibility | TENANT, GROUP, COUNTRY, LEGAL_ENTITY | workflow.definition.read, workflow.assignment.read, approvals.requests.read                                                                                 |

---

## 7. AP Document Posting

### 7.1 AP Packages

| Package Code        | Admin Label                   | Scope                                        | Permission Codes                                                                                                       |
| ------------------- | ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PKG-AP-VIEW         | AP Documents / View           | OPERATING_UNIT, LEGAL_ENTITY, COUNTRY, GROUP | cari.doc.read, cari.report.read, cari.audit.read                                                                       |
| PKG-AP-DRAFT-SUBMIT | AP Documents / Draft & Submit | OPERATING_UNIT, LEGAL_ENTITY                 | cari.doc.read, cari.doc.create, cari.doc.update, cari.doc.submit, cari.doc.cancel                                      |
| PKG-AP-APPROVE      | AP Documents / Approve        | OPERATING_UNIT, LEGAL_ENTITY, COUNTRY        | cari.doc.read, approvals.policies.read, approvals.requests.read, approvals.requests.approve, approvals.requests.reject |
| PKG-AP-POST         | AP Documents / Post           | LEGAL_ENTITY, COUNTRY                        | cari.doc.read, cari.doc.post                                                                                           |
| PKG-AP-REVERSE      | AP Documents / Reverse        | LEGAL_ENTITY, COUNTRY                        | cari.doc.read, cari.doc.reverse                                                                                        |
| PKG-AP-FX-OVERRIDE  | AP Documents / FX Override    | LEGAL_ENTITY, COUNTRY                        | cari.doc.read, cari.fx.override                                                                                        |

### 7.2 AP Workflow Presets

#### AP / Lean Entity

| Step | Action                 | Scope          | Required Package    | Typical Actor     |
| ---- | ---------------------- | -------------- | ------------------- | ----------------- |
| 1    | Create / Edit / Submit | OPERATING_UNIT | PKG-AP-DRAFT-SUBMIT | Branch Accountant |
| 2    | Approve                | LEGAL_ENTITY   | PKG-AP-APPROVE      | Entity Accountant |
| 3    | Post                   | LEGAL_ENTITY   | PKG-AP-POST         | Entity Accountant |

#### AP / Standard Entity

| Step | Action                 | Scope          | Required Package    | Typical Actor                       |
| ---- | ---------------------- | -------------- | ------------------- | ----------------------------------- |
| 1    | Create / Edit / Submit | OPERATING_UNIT | PKG-AP-DRAFT-SUBMIT | Branch Accountant                   |
| 2    | Approve                | LEGAL_ENTITY   | PKG-AP-APPROVE      | Entity Accountant or Entity Manager |
| 3    | Post                   | LEGAL_ENTITY   | PKG-AP-POST         | Entity CEO                          |

#### AP / Group-Controlled Post

| Step | Action                 | Scope          | Required Package                    | Typical Actor     |
| ---- | ---------------------- | -------------- | ----------------------------------- | ----------------- |
| 1    | Create / Edit / Submit | OPERATING_UNIT | PKG-AP-DRAFT-SUBMIT                 | Branch Accountant |
| 2    | Approve                | LEGAL_ENTITY   | PKG-AP-APPROVE                      | Entity Accountant |
| 3    | Post                   | GROUP          | PKG-AP-POST-GROUP _(new extension)_ | Group Approver    |

### 7.3 AP Notes

- AP already has the strongest current split between submit/edit, approve, and post
- group-scoped AP posting is valid in the target model but should be introduced as a clean new package, not by using legacy GroupController
- Legacy broad AP posting role should be hidden from fresh-tenant UI as a compatibility role

---

## 8. Local Close Pack

### 8.1 Local Close Packages

| Package Code        | Admin Label                         | Scope                        | Permission Codes                                                        |
| ------------------- | ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| PKG-LC-VIEW         | Local Close Pack / View             | LEGAL_ENTITY, COUNTRY, GROUP | ouclose.read                                                            |
| PKG-LC-PREPARE      | Local Close Pack / Prepare & Submit | LEGAL_ENTITY                 | ouclose.read, ouclose.prepare, ouclose.submit, ouclose.request_reopen   |
| PKG-LC-REVIEW       | Local Close Pack / Review           | LEGAL_ENTITY, COUNTRY        | ouclose.read, ouclose.review                                            |
| PKG-LC-APPROVE-LOCK | Local Close Pack / Approve & Lock   | LEGAL_ENTITY, COUNTRY        | ouclose.read, ouclose.approve, ouclose.lock                             |
| PKG-LC-REOPEN-ADMIN | Local Close Pack / Reopen & Admin   | COUNTRY, GROUP               | ouclose.read, ouclose.reopen, ouclose.override_post_lock, ouclose.admin |

### 8.2 Local Close Workflow Presets

#### Local Close / Standard

| Step | Action           | Scope        | Required Package    | Typical Actor     |
| ---- | ---------------- | ------------ | ------------------- | ----------------- |
| 1    | Prepare & Submit | LEGAL_ENTITY | PKG-LC-PREPARE      | Entity Accountant |
| 2    | Review           | LEGAL_ENTITY | PKG-LC-REVIEW       | Entity Manager    |
| 3    | Approve & Lock   | LEGAL_ENTITY | PKG-LC-APPROVE-LOCK | Entity CEO        |

#### Local Close / Branch-Assisted

| Step | Action               | Scope        | Required Package    | Typical Actor                                 |
| ---- | -------------------- | ------------ | ------------------- | --------------------------------------------- |
| 1    | Prepare working pack | LEGAL_ENTITY | PKG-LC-PREPARE      | Branch Accountant assisting Entity Accountant |
| 2    | Review               | LEGAL_ENTITY | PKG-LC-REVIEW       | Entity Accountant or Entity Manager           |
| 3    | Approve & Lock       | LEGAL_ENTITY | PKG-LC-APPROVE-LOCK | Entity CEO                                    |

#### Local Close / Group-Supervised

| Step | Action           | Scope                              | Required Package    | Typical Actor     |
| ---- | ---------------- | ---------------------------------- | ------------------- | ----------------- |
| 1    | Prepare & Submit | LEGAL_ENTITY                       | PKG-LC-PREPARE      | Entity Accountant |
| 2    | Review           | LEGAL_ENTITY                       | PKG-LC-REVIEW       | Entity Manager    |
| 3    | Approve & Lock   | GROUP or COUNTRY supervision model | PKG-LC-APPROVE-LOCK | Group Approver    |

### 8.3 Local Close Notes

- Local close already has a strong permission family
- current LocalCloseReviewer is too broad for polished UI naming
- admin UI should split current broad reviewer behavior into:
  - Review
  - Approve & Lock
  - Reopen & Admin

---

## 9. Period Close

### 9.1 Period Close Packages

| Package Code     | Admin Label                    | Scope                        | Permission Codes                                                                                                                                                                      |
| ---------------- | ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PKG-PC-READINESS | Period Close / Readiness View  | LEGAL_ENTITY, COUNTRY, GROUP | org.fiscal_period.read, gl.book.read, gl.account.read, gl.journal.read, gl.trial_balance.read, gl.report.local.read, gl.report.ledger.read, gl.report.statement.read                  |
| PKG-PC-CLOSE     | Period Close / Approve & Close | LEGAL_ENTITY, COUNTRY        | org.fiscal_period.read, gl.book.read, gl.account.read, gl.journal.read, gl.trial_balance.read, gl.report.local.read, gl.report.ledger.read, gl.report.statement.read, gl.period.close |

### 9.2 Period Close Workflow Presets

#### Period Close / Standard

| Step | Action           | Scope        | Required Package | Typical Actor                |
| ---- | ---------------- | ------------ | ---------------- | ---------------------------- |
| 1    | Review readiness | LEGAL_ENTITY | PKG-PC-READINESS | Entity Accountant            |
| 2    | Close period     | LEGAL_ENTITY | PKG-PC-CLOSE     | Entity Manager or Entity CEO |

#### Period Close / Controlled

| Step | Action            | Scope        | Required Package | Typical Actor     |
| ---- | ----------------- | ------------ | ---------------- | ----------------- |
| 1    | Review readiness  | LEGAL_ENTITY | PKG-PC-READINESS | Entity Accountant |
| 2    | Internal approval | LEGAL_ENTITY | PKG-PC-CLOSE     | Entity Manager    |
| 3    | Final close       | LEGAL_ENTITY | PKG-PC-CLOSE     | Entity CEO        |

#### Period Close / Group-Supervised

| Step | Action           | Scope                              | Required Package                                  | Typical Actor     |
| ---- | ---------------- | ---------------------------------- | ------------------------------------------------- | ----------------- |
| 1    | Review readiness | LEGAL_ENTITY                       | PKG-PC-READINESS                                  | Entity Accountant |
| 2    | Final close      | GROUP or COUNTRY supervision model | PKG-PC-CLOSE _(group-scoped extension if needed)_ | Group Approver    |

### 9.3 Period Close Notes

- period close is currently less packetized than AP/local close
- it currently behaves more like a powerful GL posting authority than a full governance family
- do not pretend V1 has reopen/admin semantics unless new period-close-specific permissions are introduced later
- a future enhancement may add:
  - PKG-PC-REOPEN
  - PKG-PC-ADMIN

---

## 10. Consolidation Run

### 10.1 Consolidation Packages

| Package Code     | Admin Label                       | Scope | Permission Codes                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PKG-CON-VIEW     | Consolidation / View              | GROUP | consolidation.group.read, consolidation.coa_mapping.read, consolidation.elimination_placeholder.read, consolidation.run.read, consolidation.report.trial_balance.read, consolidation.report.summary.read, consolidation.report.balance_sheet.read, consolidation.report.income_statement.read                                   |
| PKG-CON-PREPARE  | Consolidation / Prepare Run       | GROUP | consolidation.group.read, consolidation.coa_mapping.read, consolidation.elimination_placeholder.read, consolidation.run.read, consolidation.run.create                                                                                                                                                                          |
| PKG-CON-EXECUTE  | Consolidation / Execute Run       | GROUP | consolidation.run.read, consolidation.run.execute                                                                                                                                                                                                                                                                               |
| PKG-CON-ADJUST   | Consolidation / Post Adjustments  | GROUP | consolidation.run.read, consolidation.adjustment.create, consolidation.adjustment.post                                                                                                                                                                                                                                          |
| PKG-CON-ELIM     | Consolidation / Post Eliminations | GROUP | consolidation.run.read, consolidation.elimination.create, consolidation.elimination.post                                                                                                                                                                                                                                        |
| PKG-CON-FINALIZE | Consolidation / Finalize          | GROUP | consolidation.run.read, consolidation.run.finalize                                                                                                                                                                                                                                                                              |
| PKG-CON-SETUP    | Consolidation / Setup Admin       | GROUP | consolidation.group.read, consolidation.group.upsert, consolidation.group_member.upsert, consolidation.coa_mapping.read, consolidation.coa_mapping.upsert, consolidation.elimination_placeholder.read, consolidation.elimination_placeholder.upsert, intercompany.flag.read, intercompany.flag.upsert, intercompany.pair.upsert |

### 10.2 Consolidation Workflow Presets

#### Consolidation / Standard

| Step | Action      | Scope | Required Package | Typical Actor                   |
| ---- | ----------- | ----- | ---------------- | ------------------------------- |
| 1    | Prepare run | GROUP | PKG-CON-PREPARE  | Group Checker                   |
| 2    | Execute run | GROUP | PKG-CON-EXECUTE  | Group Checker or Group Approver |
| 3    | Finalize    | GROUP | PKG-CON-FINALIZE | Group Approver                  |

#### Consolidation / Controlled

| Step | Action            | Scope | Required Package | Typical Actor  |
| ---- | ----------------- | ----- | ---------------- | -------------- |
| 1    | Prepare run       | GROUP | PKG-CON-PREPARE  | Group Checker  |
| 2    | Post adjustments  | GROUP | PKG-CON-ADJUST   | Group Checker  |
| 3    | Post eliminations | GROUP | PKG-CON-ELIM     | Group Checker  |
| 4    | Finalize          | GROUP | PKG-CON-FINALIZE | Group Approver |

#### Consolidation / Executive

| Step | Action      | Scope | Required Package | Typical Actor  |
| ---- | ----------- | ----- | ---------------- | -------------- |
| 1    | Prepare run | GROUP | PKG-CON-PREPARE  | Group Checker  |
| 2    | Execute run | GROUP | PKG-CON-EXECUTE  | Group Approver |
| 3    | Finalize    | GROUP | PKG-CON-FINALIZE | Group CEO      |

### 10.3 Consolidation Notes

- consolidation is already strong functionally in the current permission model
- current GroupReportingController should be split in admin UI into cleaner action packages
- avoid using broad legacy GroupController for future clean governance design

---

## 11. Starter Bundle Suggestions by Business Role

These are default starter suggestions only.
Admins must be able to add/remove packages.

| Business Role     | Suggested Default Packages                                    |
| ----------------- | ------------------------------------------------------------- |
| Branch Accountant | PKG-AP-DRAFT-SUBMIT, optional PKG-PC-READINESS visibility     |
| Branch Manager    | optional PKG-AP-APPROVE, optional PKG-LC-REVIEW               |
| Entity Accountant | PKG-AP-APPROVE, PKG-LC-PREPARE, PKG-PC-READINESS              |
| Entity Manager    | optional PKG-AP-APPROVE, PKG-LC-REVIEW, optional PKG-PC-CLOSE |
| Entity CEO        | optional PKG-AP-POST, PKG-LC-APPROVE-LOCK, PKG-PC-CLOSE       |
| Group Checker     | PKG-CON-PREPARE, optional PKG-CON-EXECUTE                     |
| Group Approver    | PKG-CON-FINALIZE, optional PKG-CON-ADJUST, PKG-CON-ELIM       |
| Group CEO         | optional PKG-CON-FINALIZE only                                |

---

## 12. Workflow Step Configuration Model

Each workflow step in the governance page should expose these fields:

| Field                   | Meaning                             | Example             |
| ----------------------- | ----------------------------------- | ------------------- |
| Step No                 | order in workflow                   | 1                   |
| Step Scope Type         | where authority is resolved         | OPERATING_UNIT      |
| Step Action Label       | business-readable stage name        | Submit AP Document  |
| Required Package        | package required to act             | PKG-AP-DRAFT-SUBMIT |
| Eligible Business Roles | who may usually hold the package    | Branch Accountant   |
| Min Approver Count      | number of required actors           | 1                   |
| Allow Self Approve      | whether maker can approve same item | false               |
| Escalation After Hours  | optional escalation                 | null                |

### Key behavior

A step should bind to **Required Package**, not directly to a title.

Business roles should only help:

- filter eligible assignees
- improve admin understanding
- improve UI readability

---

## 13. Explainability Requirement on Approval/Posting Screens

The end-user action screens should not only show:

- Waiting
- Blocked
- Submitted

They should also show:

- current step name
- current required package
- current required scope
- who can act next
- why current user cannot act
- whether the user has visibility but lacks action authority
- whether the item is waiting on entity/group/country scope

### Example status text

- Waiting for **Entity Approval**
- Waiting for role package **AP Documents / Approve**
- Required scope: **LEGAL_ENTITY**
- Eligible actors: **Entity Accountant, Entity Manager**
- You can view this document but cannot approve it

This is a mandatory UX improvement.

---

## 14. Scope Rules

### General principle

Packages are assigned at a scope.
Workflow step scope decides where permission is resolved.

### Recommended scope use

- Branch Accountant / Branch Manager -> OPERATING_UNIT
- Entity Accountant / Entity Manager / Entity CEO -> LEGAL_ENTITY
- Group Checker / Group Approver / Group CEO -> GROUP

### Extension rule

If group-supervised AP or group-supervised period close is required,
introduce clean new group-scoped packages rather than reusing legacy broad roles.

---

## 15. Implementation Order

### Phase 1 — UI Naming Cleanup

- rename BranchOperator label to Branch Accountant
- rename EntityAPController label to AP Submitter
- rename CountryAPApprover label to AP Reviewer
- rename CountryAPController/CountryAPPoster label to AP Poster
- hide legacy roles from fresh-tenant pickers

### Phase 2 — Package Catalog

- introduce package catalog in frontend/admin UI
- keep runtime/internal role codes unchanged initially
- map package labels to current helper bundles/permission sets

### Phase 3 — Preset Catalog

- ship predefined presets for the 4 governance models
- allow admins to clone and customize presets

### Phase 4 — Workflow Explainability

- improve status screens to show current step/package/scope/waiting actor
- show “why you cannot act” messages

### Phase 5 — Extensions

- group-scoped AP post package
- finer period close governance family
- possible split of current broad local close reviewer into cleaner backend bundles if needed

---

## 16. Non-Negotiable Product Decisions

- business roles and workflow packages remain separate
- workflow steps bind to package authority, not job titles
- legacy compatibility roles are hidden for fresh tenants
- admin-facing names must be business-friendly and stage-based
- explainability must be added to approval/posting screens
- group-scoped AP posting, if needed, must be a clean new package, not legacy GroupController reuse

---

## 17. Summary

This model gives the exact flexibility required.

Examples that become valid:

- Branch Accountant submits, Entity Accountant approves and posts
- Branch Accountant submits, Entity Accountant approves, Entity CEO posts
- Branch Accountant submits, Entity Accountant approves, Group Approver posts
- Branch Manager included in one tenant and omitted in another
- Group approval used only for selected workflows/entities

This is the target governance direction.

---
