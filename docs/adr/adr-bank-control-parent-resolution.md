# ADR: Bank Control Parent Resolution For Multi-CoA Tenants

- Status: Accepted
- Date: 2026-03-10
- Decision owner: Core ERP team
- Applies to: bank account setup, strict bank validation, one-click GL provisioning

## Context

Historical bank account setup assumed a Turkish chart-of-accounts convention where the bank control parent account code was `102`.

This assumption appeared in the legacy implementation:

- backend strict validation uses tenant feature `FEATURE_SUBACCOUNTS_V1` and enforces that selected bank GL accounts must be descendants of code `102`
- one-click provisioning creates child accounts under `102` with deterministic codes such as `102.001`
- UI copy in bank setup explicitly describes auto-provisioning under `102`

Current implementation touchpoints:

- `backend/src/services/bank.accounts.service.js`
  - strict mode feature gate
  - historical `102` parent lookup/lock/allocation helpers
  - current generic `provisionBankAccountWithControlParentChild`
- `frontend/src/pages/bank/BankAccountsPage.jsx`
  - historical auto-create `102` child GL account checkbox and related messages

This works for tenants using a Turkish default CoA, but it breaks for tenants using a different chart such as US-style numbering where the bank parent may be `1000`, `1010`, or another tenant-specific code.

Example historical failure:

- `Control account code 102 is missing for legalEntityId. Create account 102 before one-click provisioning.`

This is not a true accounting rule. It is a localization-specific implementation rule.

## Problem Statement

The product needs to support multiple legal entities and multiple chart-of-accounts styles without forcing every tenant to create a synthetic `102` parent account just to satisfy bank setup.

The bank control parent must therefore be resolved in a configurable way, not by a hard-coded account code.

## Goals

- Remove global dependency on literal account code `102`
- Keep strict validation semantics for bank GL accounts
- Preserve one-click provisioning capability
- Support Turkish default CoA and non-Turkish CoA without branching product behavior by code hacks
- Keep migration risk low for existing tenants already using `102`

## Non-Goals

- Redesign the entire GL purpose mapping framework in one step
- Change chart-of-accounts numbering conventions for existing tenants
- Introduce destructive migration of current bank account links

## Current Behavior Summary

As implemented after the BANK control-parent cutover:

- strict mode resolves `BANK_CONTROL_PARENT` from `journal_purpose_accounts`
- one-click provisioning allocates children under the configured mapped parent
- deprecated alias `POST /api/v1/bank/accounts/provision-102-child` was removed on March 11, 2026

## Legacy Behavior Summary

### Strict mode

When `FEATURE_SUBACCOUNTS_V1` is enabled:

- bank GL account must be `ACTIVE`
- bank GL account must be postable leaf
- bank GL account must be under account code `102`

If `102` does not exist, strict validation fails.

### One-click provisioning

Provisioning:

- locks control account `102`
- validates it is active and `ASSET`
- allocates a child code under `102`
- creates the child account
- forces parent `102` to remain non-postable

If `102` does not exist, provisioning fails immediately.

## Real-World SaaS / ERP Handling

In real-world ERP systems, bank setup is usually handled as a configurable company-level accounting policy, not as a hard-coded national account number.

Common patterns:

- localization template provides a default parent account suggestion
- legal entity or company setup stores the bank control account or account group
- posting validation resolves bank eligibility from configured setup
- auto-provisioning, if present, creates children under the configured parent

Practical meaning:

- Turkey template may default to `102`
- US template may default to `1000` or another asset parent
- custom tenants may select any valid active asset header account as the bank parent

This is the common SaaS behavior because product rules should follow accounting intent, not specific numbering systems.

## Options

## Option A - Add `bankControlParentAccountId` Per Legal Entity

### Description

Add a legal-entity-level configuration field that explicitly points to the bank control parent account.

Strict validation and one-click provisioning both resolve the parent from this field instead of hard-coded code `102`.

### How it fits current code

This would have been the smallest change from the historical implementation because the old logic already expected a single parent concept.

The following code paths would conceptually change:

- replace `findControl102Account` with `resolveConfiguredBankControlParent`
- replace `lockControl102AccountForProvision` with `lockConfiguredBankControlParentForProvision`
- replace `createProvisionedChildAccountUnder102` with a generic parent-based allocator
- update UI text in bank setup from `102` language to configurable parent language

### Validation rules

Configured parent account must be:

- same tenant
- same legal entity
- `ASSET`
- `ACTIVE`
- suitable parent/header account

Provisioned child account must be:

- child of configured parent
- `ACTIVE`
- postable
- leaf

### Pros

- minimal conceptual change
- easiest migration from current `102` implementation
- simple to explain to finance users
- straightforward setup screen addition

### Cons

- bank-specific logic remains bespoke instead of using shared accounting mapping infrastructure
- future cases such as separate local/foreign bank parents may require more fields
- less elegant than a generalized posting-setup approach

### Best Use

Best short-term product fix when rapid compatibility is more important than architectural purity.

## Option B - Resolve Bank Parent Through Purpose Mapping

### Description

Treat bank control parent as accounting setup data, similar to other purpose mappings.

Example purpose codes:

- `BANK_CONTROL_PARENT`
- optional future variants:
  - `BANK_CONTROL_PARENT_LOCAL`
  - `BANK_CONTROL_PARENT_FOREIGN`
  - `BANK_CONTROL_PARENT_BY_OU`

Strict validation and provisioning both resolve the parent account through that mapping.

### How it fits current code

This aligns better with the general ERP direction already present in the repo where many modules resolve accounting behavior through setup mappings rather than literal account codes.

This is the implemented approach. The historical `102` logic was replaced rather than kept as a runtime fallback.

### Validation rules

Mapped parent account must be:

- same tenant
- legal-entity scoped
- `ASSET`
- `ACTIVE`
- suitable parent/header account

Provisioning then allocates descendants under the mapped parent.

### Pros

- best long-term multi-country architecture
- avoids hard-coded local numbering assumptions
- aligns bank behavior with configurable accounting setup patterns
- supports future extensions more cleanly

### Cons

- higher implementation cost than Option A
- more setup complexity for users
- more migration and UX work in bank setup and readiness flows

### Best Use

Best long-term design if the product is intended to support many chart templates seriously.

## Comparison Against Current Code Paths

| Area | Current | Option A | Option B |
|---|---|---|---|
| Strict bank validation | hard-coded `102` subtree | configured parent account subtree | mapped parent subtree |
| Provisioning allocator | `102.xxx` child generation | `<configured-parent>.xxx` child generation | `<mapped-parent>.xxx` child generation |
| Setup dependency | account code exists | legal entity field configured | purpose mapping configured |
| Localization flexibility | low | medium | high |
| Implementation effort | current baseline | lower | higher |
| Migration risk | n/a | lower | medium |
| Architectural fit | poor for multi-CoA | acceptable | strongest |

## Decision Recommendation

Adopt Option B directly.

Implemented policy:

1. bank control parent is resolved from `journal_purpose_accounts`
2. required module/purpose pair is `BANK` + `BANK_CONTROL_PARENT`
3. no direct `bankControlParentAccountId` field is introduced
4. hard-coded `102` is not allowed as a runtime fallback when the BANK mapping is missing
5. one-click provisioning and strict validation both use the same mapped-parent resolution path

## Why Not Keep Hard-Coded `102`

Keeping hard-coded `102` has these problems:

- forces non-Turkish tenants to create fake compatibility accounts
- couples core bank behavior to one national numbering scheme
- leaks localization assumptions into shared backend service logic
- makes one-click provisioning look broken for tenants whose setup is actually valid under their own CoA design

This is not acceptable for a multi-CoA SaaS ERP posture.

## Migration Strategy

The implemented rollout used this sequence:

1. `PR-BPM01`: BANK purpose-mapping foundation
   - added `BANK` module support and `BANK_CONTROL_PARENT` validation profile
2. `PR-BPM02`: service cutover
   - strict validation and provisioning resolved the parent from `BANK_CONTROL_PARENT`
3. `PR-BPM03`: neutral API/UI/readiness
   - introduced `POST /api/v1/bank/accounts/provision-control-parent-child`
   - kept a temporary `/provision-102-child` alias only for deploy sequencing
4. `PR-BPM04`: policy-pack and legacy backfill support
   - seeded BANK mappings for new installs and backfilled strict-mode legacy tenants where the parent was unambiguous
5. `PR-BPM05`: regression coverage, rollout docs, and compatibility removal
   - removed the deprecated `/provision-102-child` alias on March 11, 2026

No direct-field phase shipped. Legacy tenants were migrated to purpose mappings instead of carrying a permanent fallback path.

## UX and Readiness Guidance

Error messages should change from code-specific to intent-specific.

Current:

- `Control account code 102 is missing for legalEntityId.`

Preferred:

- `Bank control parent account is not configured for legalEntityId.`
- `Selected bank GL account must be a descendant of the configured bank control parent.`

This is more correct for both finance users and support teams.

## Data Model Direction

Implemented model:

- canonical source of truth is `journal_purpose_accounts`
- module key is `BANK`
- required purpose code is `BANK_CONTROL_PARENT`
- no `bankControlParentAccountId` compatibility field was added

## Acceptance Criteria

The design should be considered successful when:

- a TR tenant can keep using `102`
- a US tenant can configure a different parent without creating `102`
- strict validation still ensures bank accounts are children of the configured parent
- one-click provisioning creates valid descendants under the configured parent
- error and readiness messages refer to configured setup, not Turkish code assumptions

## Follow-up Considerations

1. Whether a future v2 needs multiple BANK variants such as `BANK_CONTROL_PARENT_LOCAL`, `BANK_CONTROL_PARENT_FOREIGN`, or OU-scoped bank parents.
2. Whether readiness/setup flows should add deeper guided remediation for ambiguous legacy charts beyond the current backfill report.
3. Whether future provisioning rules need non-hierarchical child-code strategies for charts that do not use dotted descendants.

## Final Recommendation

Approved and implemented policy:

- `102` is a localization default, not a global product rule
- bank control parent is configured through BANK purpose mapping, not a direct legal-entity field
- strict validation requires the selected bank GL account to be a descendant of the mapped parent, not the parent itself
- one-click provisioning creates children under the mapped parent and uses neutral endpoint and UI naming
- missing BANK mapping is a readiness/setup problem, not a silent fallback to `102`

This preserves Turkish default behavior through `BANK_CONTROL_PARENT -> 102` while supporting non-Turkish charts without synthetic compatibility accounts.
