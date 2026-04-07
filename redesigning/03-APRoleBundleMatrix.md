# AP Role Packet And Bundle Review Matrix

## Purpose

This document is a separate review matrix for AP/CARI duty-split roles and bundles.
It keeps the role review separate from the workflow explainability roadmap in
`02-WorkFlowAndDocumentStatus.md`.

Use this document to review:

- the current shipped role catalog
- the current shipped AP bootstrap bundles
- the existing atomic AP permission seams already present in the repo
- the proposed future packetized AP role model
- the preset combinations that could be offered on top of that role model

## Current Runtime Facts

- AP lifecycle is already split into create, submit, approve, and post.
- Draft creator and submitter can already be different users.
- `BranchOperator` is effectively a draft role.
- `EntityAPController` is effectively a submit/edit/submit role.
- `APApprover` is the approval-engine companion bundle.
- `CountryAPPoster` is the runtime post/reverse role, surfaced in the UI as
  `CountryAPController`.
- Current workflow/runtime explainability still derives poster scope from the
  last approval step. That means role packetization alone is not enough to model
  every desired submit/approve/post split cleanly.

## 1. Current Shipped Role Catalog

### System / Governance Roles

| Role code | Category | Recommended scopes | Primary use | Keep direction |
| --- | --- | --- | --- | --- |
| `SecurityAdmin` | system | `TENANT` | Role, scope, assignment governance | Keep |
| `SystemAdmin` | system | `TENANT` | Workflow governance, onboarding, ops | Keep |
| `TenantAdmin` | legacy | `TENANT` | Historical compatibility admin | Legacy only |

### Composable Operational Roles

| Role code | Category | Recommended scopes | Primary use | AP relevance |
| --- | --- | --- | --- | --- |
| `LocalUserAdmin` | composable | `COUNTRY`, `LEGAL_ENTITY` | Scoped invite and assignment admin | Indirect |
| `MasterDataSteward` | composable | `GROUP`, `COUNTRY`, `LEGAL_ENTITY` | Org / GL / master-data governance | Indirect |
| `CounterpartyCardEditor` | composable | `LEGAL_ENTITY` | Customer/vendor card maintenance | Indirect |
| `EntityAPController` | composable | `LEGAL_ENTITY` | AP read, edit, submit | Direct |
| `CountryAPApprover` | composable | `COUNTRY` | Country AP review participation | Direct |
| `CountryAPController` | composable | `COUNTRY` | Final AP post and reverse | Direct |
| `APApprover` | composable | `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY` | Approval engine read/approve/reject | Direct |
| `GLOperator` | composable | `COUNTRY`, `LEGAL_ENTITY` | GL operations and ledger visibility | Indirect |
| `GLPostingAuthority` | composable | `COUNTRY`, `LEGAL_ENTITY` | Manual GL post/reverse companion | Indirect |
| `ShareholderCapitalOperator` | composable | `LEGAL_ENTITY` | Capital fulfillment posting | None |
| `OUAccountant` | composable | `OPERATING_UNIT` | Local OU accounting exceptions | Possible supporting seam |
| `TreasuryOperator` | composable | `LEGAL_ENTITY` | Cash/bank operations | Indirect |
| `TreasuryApprover` | composable | `COUNTRY` | Treasury governance approval | None |
| `PayrollOperator` | composable | `LEGAL_ENTITY` | Payroll operations | None |
| `PayrollApprover` | composable | `COUNTRY` | Payroll governance approval | None |
| `LocalClosePreparer` | composable | `LEGAL_ENTITY` | Local close prep | None |
| `LocalCloseReviewer` | composable | `COUNTRY` | Local close approval | None |
| `GroupReportingController` | composable | `GROUP` | Consolidation and reporting | None |

### Scoped / Read Only Roles

| Role code | Category | Recommended scopes | Primary use | AP relevance |
| --- | --- | --- | --- | --- |
| `BranchOperator` | scoped | `OPERATING_UNIT` | Draft create/edit/cancel and branch operations | Direct |
| `AuditorReadOnly` | readonly | `TENANT`, `GROUP`, `COUNTRY`, `LEGAL_ENTITY`, `OPERATING_UNIT` | Cross-surface read-only audit visibility | Indirect |

### Legacy Compatibility Roles

| Role code | Category | Recommended scopes | Primary use | Keep direction |
| --- | --- | --- | --- | --- |
| `APDocumentPoster` | legacy | `LEGAL_ENTITY` | Compatibility AP submit/cancel/post role | Legacy only |
| `GroupController` | legacy | `GROUP` | Broad historical reporting role | Legacy only |
| `CountryController` | legacy | `COUNTRY` | Broad historical controller role | Legacy only |
| `EntityAccountant` | legacy | `LEGAL_ENTITY` | Broad historical entity operator role | Legacy only |

## 2. Current Shipped AP Bootstrap Bundles

### Bootstrap Preset Matrix

| Preset code | Scope | Included roles | Optional roles | Review note |
| --- | --- | --- | --- | --- |
| `EntityAPController` | `LEGAL_ENTITY` | `LocalUserAdmin`, `MasterDataSteward`, `CounterpartyCardEditor`, `EntityAPController`, `APApprover`, `GLOperator`, `TreasuryOperator`, `PayrollOperator`, `LocalClosePreparer`, `ShareholderCapitalOperator` | `GLPostingAuthority` | Broad setup lead bundle, not a pure AP-only packet |
| `CountryAPApprover` | `COUNTRY` | `CountryAPApprover`, `CountryAPPoster`, `APApprover`, `GLOperator`, `TreasuryApprover`, `PayrollApprover`, `LocalCloseReviewer` | `GLPostingAuthority` | Broad country reviewer/controller bundle |

### AP-Adjacent Current Runtime Role Meanings

| Runtime role | Main permissions | Current business meaning |
| --- | --- | --- |
| `BranchOperator` | `cari.doc.read`, `cari.doc.create`, `cari.doc.update`, `cari.doc.cancel` | Branch drafter |
| `EntityAPController` | `cari.doc.read`, `cari.doc.update`, `cari.doc.submit` | Entity AP submitter/editor |
| `CountryAPApprover` + `APApprover` | `cari.doc.read` + approval-engine permissions | Country approver |
| `CountryAPPoster` | `cari.doc.read`, `cari.doc.post`, `cari.doc.reverse` | Country poster |
| `APDocumentPoster` | `cari.doc.read`, `cari.doc.update`, `cari.doc.submit`, `cari.doc.cancel`, `cari.doc.post` | Legacy broad AP operator |

## 3. Existing Atomic AP Permission Seams

These seams already exist in the permission model and should be reused before
inventing new low-level permission codes.

| Packet code | Existing permission codes | Current closest shipped role | Review direction |
| --- | --- | --- | --- |
| `AP_DRAFT_OPS` | `cari.doc.read`, `cari.doc.create`, `cari.doc.update`, `cari.doc.cancel` | `BranchOperator` | Keep as atomic packet |
| `AP_SUBMIT_OPS` | `cari.doc.read`, `cari.doc.submit` | `EntityAPController` | Keep as atomic packet |
| `AP_APPROVAL_OPS` | `approvals.policies.read`, `approvals.requests.read`, `approvals.requests.approve`, `approvals.requests.reject` | `APApprover` | Keep as atomic packet |
| `AP_POST_OPS` | `cari.doc.read`, `cari.doc.post`, `cari.doc.reverse` | `CountryAPPoster` | Keep as atomic packet |
| `AP_REPORTING_LIGHT` | `cari.doc.read`, `cari.report.read`, `cari.audit.read` | `AuditorReadOnly` | Optional add-on packet |
| `AP_MASTERDATA_LIGHT` | `cari.card.read`, optionally `cari.card.request` | `BranchOperator` / `MasterDataSteward` | Optional add-on packet |

## 4. Proposed Future Packetized AP Roles

These are review candidates for a cleaner ERP-style future catalog.

| Proposed role | Scope | Packet composition | Business meaning | Closest current role |
| --- | --- | --- | --- | --- |
| `BranchAPDrafter` | `OPERATING_UNIT` | `AP_DRAFT_OPS` | Creates and corrects draft AP documents only | `BranchOperator` |
| `BranchAPSubmitter` | `OPERATING_UNIT` | `AP_SUBMIT_OPS` | Submits governed AP drafts from one branch | none cleanly shipped |
| `BranchAPManager` | `OPERATING_UNIT` | `AP_DRAFT_OPS` + `AP_SUBMIT_OPS` | Drafts and submits but does not approve or post | split between `BranchOperator` and `EntityAPController` today |
| `EntityAPSubmitter` | `LEGAL_ENTITY` | `AP_SUBMIT_OPS` | Entity-level submitter for shared-service or supervisory use | `EntityAPController` |
| `EntityAPApprover` | `LEGAL_ENTITY` | `AP_APPROVAL_OPS` | Entity approval actor | `APApprover` plus scope discipline |
| `CountryAPApprover` | `COUNTRY` | `AP_APPROVAL_OPS` | Country approval actor | current `CountryAPApprover` + `APApprover` |
| `EntityAPPoster` | `LEGAL_ENTITY` | `AP_POST_OPS` | Entity posting actor | none cleanly shipped |
| `CountryAPPoster` | `COUNTRY` | `AP_POST_OPS` | Country posting actor | current runtime `CountryAPPoster` |
| `APReadOnlyAuditor` | any business scope | `AP_REPORTING_LIGHT` | Read-only AP reviewer/auditor | `AuditorReadOnly` |

## 5. Proposed Preset Combination Matrix

These are business-flow presets that could be offered if the role model becomes
packetized and the workflow model eventually supports explicit submitter and
poster scope separately.

| Preset code | Business flow | Scope assignments | Role packets involved | Review note |
| --- | --- | --- | --- | --- |
| `AP_OU_DRAFT_OU_SUBMIT_LE_APPROVE_COUNTRY_POST` | OU draft -> OU submit -> LE approve -> Country post | `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY` | `BranchAPDrafter`, `BranchAPSubmitter`, `EntityAPApprover`, `CountryAPPoster` | Strong ERP-style separation |
| `AP_OU_DRAFTSUBMIT_LE_APPROVE_COUNTRY_POST` | OU draft+submit -> LE approve -> Country post | `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY` | `BranchAPManager`, `EntityAPApprover`, `CountryAPPoster` | Lean branch model |
| `AP_OU_DRAFT_LE_SUBMIT_LE_APPROVE_LE_POST` | OU draft -> LE submit -> LE approve -> LE post | `OPERATING_UNIT`, `LEGAL_ENTITY` | `BranchAPDrafter`, `EntityAPSubmitter`, `EntityAPApprover`, `EntityAPPoster` | Shared-service / HQ entity accounting |
| `AP_OU_DRAFT_OU_SUBMIT_COUNTRY_APPROVE_COUNTRY_POST` | OU draft -> OU submit -> Country approve -> Country post | `OPERATING_UNIT`, `COUNTRY` | `BranchAPDrafter`, `BranchAPSubmitter`, `CountryAPApprover`, `CountryAPPoster` | Centralized approval model |
| `AP_SHARED_DRAFT_LE_SUBMIT_COUNTRY_APPROVE_COUNTRY_POST` | Shared-service draft -> LE submit -> Country approve -> Country post | `LEGAL_ENTITY`, `COUNTRY` | `EntityAPController` or future `EntityAPSubmitter`, `CountryAPApprover`, `CountryAPPoster` | Useful for centralized AP teams |

## 6. Review Decisions To Make

### Decision A - Role Catalog Direction

Choose one:

- keep current roles only and rely on assignment discipline
- add future packetized AP roles alongside current roles
- replace current AP roles for fresh tenants and keep old roles only for compatibility

### Decision B - Submitter Modeling

Choose one:

- keep submit bundled into `EntityAPController`
- add explicit `BranchAPSubmitter`
- add both `BranchAPSubmitter` and `EntityAPSubmitter`

### Decision C - Poster Modeling

Choose one:

- keep only `CountryAPPoster`
- add `EntityAPPoster`
- support both and make poster scope explicit in workflow configuration

### Decision D - Preset Strategy

Choose one:

- keep a small curated preset list only
- support packet bundles plus presets
- support packet bundles, presets, and fully manual composition

## 7. Recommended Direction

Recommended review baseline:

1. Keep current shipped roles for compatibility.
2. Introduce new packetized AP roles for fresh tenants:
   `BranchAPDrafter`, `BranchAPSubmitter`, `BranchAPManager`,
   `EntityAPApprover`, `CountryAPApprover`, `EntityAPPoster`,
   `CountryAPPoster`.
3. Reuse existing permission seams instead of inventing many new permission
   codes.
4. Add explicit workflow concepts for:
   - submitter scope
   - approval step scopes
   - poster scope
5. Ship presets on top of those packets, not instead of those packets.

## Source References

- Current role catalog:
  `frontend/src/pages/security/roleCatalog.js`
- Current permission bundles and seeded roles:
  `backend/src/seedCore.js`
- Current workflow setup templates:
  `frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js`
  and `frontend/src/pages/settings/workflows/utils/workflowSetupText.js`
