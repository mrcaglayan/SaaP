# Security Role, Bundle, and Permission Matrix

## Purpose

This document is the broad security inventory companion to
`03-APRoleBundleMatrix.md`.

It is not AP-only. It lists:

- all current shipped role catalog entries
- all current reusable permission groups
- all current seeded helper bundles used to build roles
- all shipped bootstrap and local-role bundle catalogs
- the full seeded permission catalog

## Inventory Summary

- Seeded permission count: `246`
- Shared permission group count: `13`
- Shipped role catalog entry count: `27`
- Local operational role catalog count: `9`
- Bootstrap handoff preset count: `2`

## Source Of Truth

- Seeded permissions and role definitions:
  `backend/src/seedCore.js`
- Shared permission groups:
  `backend/src/constants/permission-groups.js`
- System-role derivation:
  `backend/src/services/systemRoles.service.js`
- Local operational role allow-list:
  `backend/src/services/localOperationalRoles.service.js`
- UI-facing role catalog and bootstrap presets:
  `frontend/src/pages/security/roleCatalog.js`

## 1. Shared Permission Groups

These groups are reusable permission bundles defined in
`backend/src/constants/permission-groups.js`.

| Group code | Includes | Primary contents | Typical consumers |
| --- | --- | --- | --- |
| `gl.readonly` | none | GL read/report visibility | `BranchOperator`, `GLOperator`, `GroupReportingController` |
| `gl.masterdata` | none | book/CoA/account/account-mapping write | `MasterDataSteward` |
| `gl.operations` | `gl.readonly` | manual draft journal create/update/cancel | `GLOperator`, `OUAccountant` |
| `gl.posting` | none | manual GL post/reverse/period close | `GLPostingAuthority` |
| `org.capital_fulfillment` | none | shareholder capital fulfillment plus basic org/bank/cash/account read | `ShareholderCapitalOperator` |
| `bank.readonly` | none | bank account/statement/reconcile/payment/audit read | `TreasuryApprover` and broad legacy roles |
| `bank.operations` | `bank.readonly` | bank master write, import, reconcile, export, returns write | `TreasuryOperator` and broad legacy roles |
| `bank.governance` | none | bank approval policies and request approvals | `TreasuryApprover` and broad legacy roles |
| `close.operator` | none | local close prepare/submit/request reopen | `LocalClosePreparer` |
| `close.reviewer` | none | local close review/approve/lock/reopen/admin | `LocalCloseReviewer` |
| `payroll.readonly` | none | payroll read and sensitive-read surfaces | `PayrollApprover`, `AuditorReadOnly`, broad legacy roles |
| `payroll.operations` | `payroll.readonly` | payroll import/preview/apply/review/finalize/payment prep | `PayrollOperator` |
| `payroll.governance` | none | payroll override/close approval and reopen | `PayrollApprover` |

## 2. Seeded Helper Bundles

These are the helper bundle constants in `backend/src/seedCore.js` used to
compose multiple roles.

| Bundle constant | Purpose | Main composition summary | Current consumers |
| --- | --- | --- | --- |
| `ROLE_SCOPE_CONTEXT_PERMISSION_CODES` | baseline scope visibility | `org.tree.read`, `org.fiscal_calendar.read`, `org.fiscal_period.read` | many composable roles |
| `OPERATIONAL_COVERAGE_REQUEST_PERMISSION_CODES` | request-side temporary coverage seam | coverage read/request | many operational roles |
| `OPERATIONAL_COVERAGE_MANAGER_PERMISSION_CODES` | review-side temporary coverage seam | request bundle plus review/revoke and approval-request read | `LocalUserAdmin` |
| `LOCAL_USER_ADMIN_PERMISSION_CODES` | bounded local user admin | local user admin plus coverage manager seam | `LocalUserAdmin` |
| `MASTER_DATA_STEWARD_PERMISSION_CODES` | master-data and light workflow governance | `gl.masterdata` plus org write, counterparty review, unified approval read/approve/reject | `MasterDataSteward` |
| `COUNTERPARTY_CARD_EDITOR_PERMISSION_CODES` | live counterparty card maintenance | `cari.card.read`, `cari.card.upsert`, `gl.account.read` | `CounterpartyCardEditor` |
| `AP_DOCUMENT_POSTER_PERMISSION_CODES` | compatibility AP all-in-one | AP read/update/submit/cancel/post | `APDocumentPoster` |
| `ENTITY_AP_CONTROLLER_PERMISSION_CODES` | AP submitter-editor seam | AP read/update/submit | `EntityAPController` |
| `COUNTRY_AP_APPROVER_PERMISSION_CODES` | AP review-side read seam | scope context plus `cari.doc.read` | `CountryAPApprover` |
| `COUNTRY_AP_POSTER_PERMISSION_CODES` | AP posting seam | AP read/post/reverse | runtime `CountryAPPoster`, UI alias `CountryAPController` |
| `AP_APPROVER_PERMISSION_CODES` | generic approval-engine seam | approval policy/read/approve/reject | `APApprover` |
| `GL_OPERATOR_PERMISSION_CODES` | GL draft operation seam | `gl.operations` plus coverage request and FX read | `GLOperator`, `OUAccountant` |
| `GL_POSTING_AUTHORITY_PERMISSION_CODES` | manual GL posting seam | journal post/reverse and period close | `GLPostingAuthority` |
| `SHAREHOLDER_CAPITAL_OPERATOR_PERMISSION_CODES` | capital fulfillment seam | `org.capital_fulfillment` | `ShareholderCapitalOperator` |
| `TREASURY_OPERATOR_PERMISSION_CODES` | bank/cash operations seam | `bank.operations` plus operational coverage, cash ops, AP bank-link read/apply | `TreasuryOperator` |
| `TREASURY_APPROVER_PERMISSION_CODES` | bank governance seam | `bank.readonly` plus bank governance approvals and cash variance approve | `TreasuryApprover` |
| `PAYROLL_OPERATOR_PERMISSION_CODES` | payroll operations seam | `payroll.operations` plus coverage request | `PayrollOperator` |
| `PAYROLL_APPROVER_PERMISSION_CODES` | payroll governance seam | `payroll.readonly` plus `payroll.governance` | `PayrollApprover` |
| `LOCAL_CLOSE_PREPARER_PERMISSION_CODES` | close preparer seam | `close.operator` plus coverage request | `LocalClosePreparer` |
| `LOCAL_CLOSE_REVIEWER_PERMISSION_CODES` | close reviewer seam | `close.reviewer` | `LocalCloseReviewer` |
| `GROUP_REPORTING_CONTROLLER_PERMISSION_CODES` | group reporting seam | GL readonly plus intercompany and consolidation operations | `GroupReportingController` |
| `BRANCH_OPERATOR_PERMISSION_CODES` | branch operations seam | GL readonly plus cash/basic AP/inventory/contracts/revenue operational read/create/update actions | `BranchOperator` |
| `AUDITOR_READ_ONLY_PERMISSION_CODES` | broad read-only seam | every `.read` permission plus compliance audit/report actions | `AuditorReadOnly` |

## 3. System Role Derivation

These roles are not hand-curated in the same way as the bounded composable
roles. They are derived in `backend/src/services/systemRoles.service.js`.

| Role code | How it is built | Meaning |
| --- | --- | --- |
| `TenantAdmin` | all seeded permissions | Legacy compatibility super-role |
| `SecurityAdmin` | all `security.*` and `org.*` permissions except excluded system-only items | Tenant security and access governance |
| `SystemAdmin` | `ops.*`, `onboarding.*`, workflow definition/assignment permissions, unified approval policy/request permissions, plus `security.admin.system` | System operations, onboarding, workflow governance |

## 4. Current Shipped Role Catalog

This table matches the shipped UI catalog in
`frontend/src/pages/security/roleCatalog.js` and the seeded role definitions in
`backend/src/seedCore.js`.

| Role code | Runtime alias | Category | Recommended scopes | Permission source | Review note |
| --- | --- | --- | --- | --- | --- |
| `TenantAdmin` | same | legacy | `TENANT` | system-role derived, all permissions | Compatibility only |
| `SecurityAdmin` | same | system | `TENANT` | system-role derived | Keep |
| `SystemAdmin` | same | system | `TENANT` | system-role derived | Keep |
| `LocalUserAdmin` | same | composable | `COUNTRY`, `LEGAL_ENTITY` | `LOCAL_USER_ADMIN_PERMISSION_CODES` | Scoped user admin |
| `MasterDataSteward` | same | composable | `GROUP`, `COUNTRY`, `LEGAL_ENTITY` | `MASTER_DATA_STEWARD_PERMISSION_CODES` | Broad master-data lead |
| `CounterpartyCardEditor` | same | composable | `LEGAL_ENTITY` | `COUNTERPARTY_CARD_EDITOR_PERMISSION_CODES` | Live card maintenance |
| `EntityAPController` | same | composable | `LEGAL_ENTITY` | `ENTITY_AP_CONTROLLER_PERMISSION_CODES` | AP submit/edit seam |
| `CountryAPApprover` | same | composable | `COUNTRY` | `COUNTRY_AP_APPROVER_PERMISSION_CODES` | AP review-side read seam |
| `CountryAPController` | runtime `CountryAPPoster` | composable | `COUNTRY` | `COUNTRY_AP_POSTER_PERMISSION_CODES` | UI label differs from runtime code |
| `APApprover` | same | composable | `OPERATING_UNIT`, `LEGAL_ENTITY`, `COUNTRY` | `AP_APPROVER_PERMISSION_CODES` | Approval-engine companion |
| `APDocumentPoster` | same | legacy | `LEGAL_ENTITY` | `AP_DOCUMENT_POSTER_PERMISSION_CODES` | Compatibility AP all-in-one |
| `GLOperator` | same | composable | `COUNTRY`, `LEGAL_ENTITY` | `GL_OPERATOR_PERMISSION_CODES` | GL draft operations |
| `GLPostingAuthority` | same | composable | `COUNTRY`, `LEGAL_ENTITY` | `GL_POSTING_AUTHORITY_PERMISSION_CODES` | Companion posting seam |
| `ShareholderCapitalOperator` | same | composable | `LEGAL_ENTITY` | `SHAREHOLDER_CAPITAL_OPERATOR_PERMISSION_CODES` | Capital fulfillment |
| `OUAccountant` | same | composable | `OPERATING_UNIT` | `GL_OPERATOR_PERMISSION_CODES` | OU GL draft seam |
| `TreasuryOperator` | same | composable | `LEGAL_ENTITY` | `TREASURY_OPERATOR_PERMISSION_CODES` | Bank and cash operations |
| `TreasuryApprover` | same | composable | `COUNTRY` | `TREASURY_APPROVER_PERMISSION_CODES` | Treasury governance approval |
| `PayrollOperator` | same | composable | `LEGAL_ENTITY` | `PAYROLL_OPERATOR_PERMISSION_CODES` | Payroll operations |
| `PayrollApprover` | same | composable | `COUNTRY` | `PAYROLL_APPROVER_PERMISSION_CODES` | Payroll governance approval |
| `LocalClosePreparer` | same | composable | `LEGAL_ENTITY` | `LOCAL_CLOSE_PREPARER_PERMISSION_CODES` | Close prep |
| `LocalCloseReviewer` | same | composable | `COUNTRY` | `LOCAL_CLOSE_REVIEWER_PERMISSION_CODES` | Close approval |
| `GroupReportingController` | same | composable | `GROUP` | `GROUP_REPORTING_CONTROLLER_PERMISSION_CODES` | Consolidation and group reporting |
| `AuditorReadOnly` | same | readonly | `TENANT`, `GROUP`, `COUNTRY`, `LEGAL_ENTITY`, `OPERATING_UNIT` | `AUDITOR_READ_ONLY_PERMISSION_CODES` | Broad read-only |
| `BranchOperator` | same | scoped | `OPERATING_UNIT` | `BRANCH_OPERATOR_PERMISSION_CODES` | Branch draft/operator seam |
| `GroupController` | same | legacy | `GROUP` | inline broad legacy permission list | Compatibility only |
| `CountryController` | same | legacy | `COUNTRY` | inline broad legacy permission list | Compatibility only |
| `EntityAccountant` | same | legacy | `LEGAL_ENTITY` | inline broad legacy permission list | Compatibility only |

## 5. Shipped Bundle Catalogs

### 5.1 Bootstrap Handoff Presets

These are the current shipped preset bundles in
`frontend/src/pages/security/roleCatalog.js`.

| Preset code | Scope | Included roles | Optional roles | Main purpose |
| --- | --- | --- | --- | --- |
| `EntityAPController` | `LEGAL_ENTITY` | `LocalUserAdmin`, `MasterDataSteward`, `CounterpartyCardEditor`, `EntityAPController`, `APApprover`, `GLOperator`, `TreasuryOperator`, `PayrollOperator`, `LocalClosePreparer`, `ShareholderCapitalOperator` | `GLPostingAuthority` | Legal-entity AP setup lead |
| `CountryAPApprover` | `COUNTRY` | `CountryAPApprover`, `CountryAPPoster`, `APApprover`, `GLOperator`, `TreasuryApprover`, `PayrollApprover`, `LocalCloseReviewer` | `GLPostingAuthority` | Country AP reviewer/controller lead |

### 5.2 Compatibility Bootstrap Roles

Current steady-state bootstrap role codes from
`backend/src/services/systemRoles.service.js`:

- `SecurityAdmin`
- `SystemAdmin`

### 5.3 Local Operational Role Catalog

These are the roles allowed through bounded local user administration in
`backend/src/services/localOperationalRoles.service.js`.

| Role code | Allowed local scope types |
| --- | --- |
| `LocalClosePreparer` | `LEGAL_ENTITY` |
| `AuditorReadOnly` | `LEGAL_ENTITY`, `OPERATING_UNIT` |
| `BranchOperator` | `OPERATING_UNIT` |
| `GLOperator` | `LEGAL_ENTITY` |
| `MasterDataSteward` | `LEGAL_ENTITY` |
| `OUAccountant` | `OPERATING_UNIT` |
| `PayrollOperator` | `LEGAL_ENTITY` |
| `ShareholderCapitalOperator` | `LEGAL_ENTITY` |
| `TreasuryOperator` | `LEGAL_ENTITY` |

## 6. Full Seeded Permission Catalog

This is the full seeded permission inventory from `backend/src/seedCore.js`,
grouped by prefix/domain.

### 6.1 `org`

- `org.tree.read`: Read org hierarchy tree
- `org.fiscal_calendar.read`: Read fiscal calendars
- `org.fiscal_period.read`: Read fiscal periods
- `org.group_company.upsert`: Create/update group companies
- `org.legal_entity.upsert`: Create/update legal entities
- `org.operating_unit.upsert`: Create/update operating units/branches
- `org.fiscal_calendar.upsert`: Create/update fiscal calendars
- `org.fiscal_period.generate`: Generate fiscal periods
- `org.shareholder.upsert`: Create/update shareholder setup and commitment journals
- `org.shareholder.capital_fulfillment.upsert`: Create/preview/reverse shareholder capital fulfillment

### 6.2 `security`

- `security.permission.read`: Read permission catalog
- `security.role.read`: Read security roles
- `security.role.upsert`: Create/update security roles
- `security.role_permissions.assign`: Assign permissions to roles
- `security.role_assignment.read`: Read role assignments
- `security.role_assignment.upsert`: Assign roles to users and scopes
- `security.data_scope.read`: Read user data scopes
- `security.data_scope.upsert`: Create/update/delete user data scopes
- `security.field_visibility.read`: Read field visibility policies
- `security.field_visibility.write`: Create/update field visibility policies
- `security.user_admin.local`: Manage bounded local user administration within entity scope
- `security.user_admin.entity`: Manage legacy branch operator users within entity scope
- `security.operational_coverage.read`: Read temporary operational coverage requests
- `security.operational_coverage.request`: Request temporary operational coverage
- `security.operational_coverage.review`: Review temporary operational coverage requests
- `security.operational_coverage.revoke`: Revoke approved temporary operational coverage
- `security.audit.read`: Read RBAC audit logs
- `security.audit.report.generate`: Generate compliance audit reports
- `security.audit.report.export`: Export compliance audit reports as CSV
- `security.admin.system`: Manage system administration and onboarding controls
- `security.sensitive_data.audit.read`: Read sensitive data lifecycle audit trail (encryption, masking, purging)

### 6.3 `gl`

- `gl.book.read`: Read books
- `gl.book.upsert`: Create/update books
- `gl.coa.read`: Read chart of accounts
- `gl.coa.upsert`: Create/update chart of accounts
- `gl.account.read`: Read accounts
- `gl.account.upsert`: Create/update accounts
- `gl.account_mapping.upsert`: Create/update account mappings
- `gl.journal.read`: Read journals
- `gl.journal.create`: Create journals
- `gl.journal.update`: Update draft journals
- `gl.journal.cancel`: Cancel draft journals
- `gl.journal.post`: Post journals
- `gl.journal.reverse`: Reverse posted journals
- `gl.trial_balance.read`: Read trial balance
- `gl.report.local.read`: Read local summary reports
- `gl.report.ledger.read`: Read local ledger detail reports
- `gl.report.statement.read`: Read local financial statement reports
- `gl.period.close`: Close accounting periods

### 6.4 `ouclose`

- `ouclose.read`: Read local close packs and status
- `ouclose.prepare`: Prepare local close packs
- `ouclose.submit`: Submit local close packs for review
- `ouclose.review`: Review local close packs
- `ouclose.approve`: Approve local close packs
- `ouclose.lock`: Lock approved local close packs
- `ouclose.request_reopen`: Request local close-pack reopen
- `ouclose.reopen`: Reopen local close packs
- `ouclose.override_post_lock`: Override approved or locked local close-pack controls
- `ouclose.admin`: Administer local close-pack configuration and governance

### 6.5 `cash`

- `cash.register.read`: Read cash registers
- `cash.register.upsert`: Create/update cash registers
- `cash.session.open`: Open cash sessions
- `cash.session.close`: Close cash sessions
- `cash.txn.read`: Read cash transactions
- `cash.txn.create`: Create cash transactions
- `cash.txn.cancel`: Cancel draft/submitted cash transactions
- `cash.txn.post`: Post cash transactions
- `cash.txn.reverse`: Reverse posted cash transactions
- `cash.override.post`: Post cash entries with cash-control override
- `cash.variance.approve`: Approve cash session variances
- `cash.report.read`: Read cash reports
- `cash.fx.revaluation.override`: Override cash FX revaluation close gate with explicit reason

### 6.6 `bank`

- `bank.accounts.read`: Read bank account master records and GL links
- `bank.accounts.write`: Create/update/activate/deactivate bank account master records
- `bank.connectors.read`: Read bank connector masters, account links, and sync run logs (B05)
- `bank.connectors.write`: Create/update bank connector masters and connector-account mappings (B05)
- `bank.connectors.sync`: Test bank connectors and pull statement feeds via B02 import pipeline (B05)
- `bank.statements.import`: Import bank statement files and create normalized bank statement lines
- `bank.statements.read`: Read bank statement imports and normalized statement line queue
- `bank.reconcile.read`: Read bank reconciliation queue, suggestions, and audit trail
- `bank.reconcile.write`: Create/reverse bank reconciliation matches and ignore actions
- `bank.reconcile.templates.read`: Read bank reconciliation auto-posting templates (B08-A)
- `bank.reconcile.templates.write`: Create/update bank reconciliation auto-posting templates (B08-A)
- `bank.reconcile.diffprofiles.read`: Read bank reconciliation difference profiles (B08-B)
- `bank.reconcile.diffprofiles.write`: Create/update bank reconciliation difference profiles (B08-B)
- `bank.reconcile.rules.read`: Read bank reconciliation automation rules (B07)
- `bank.reconcile.rules.write`: Create/update bank reconciliation automation rules (B07)
- `bank.reconcile.auto.run`: Run bank reconciliation automation preview/apply (B07)
- `bank.reconcile.exceptions.read`: Read bank reconciliation exception queue (B07)
- `bank.reconcile.exceptions.write`: Assign/resolve/ignore/retry bank reconciliation exceptions (B07)
- `bank.payments.export.read`: Read bank-facing payment file export runs for generic payment batches
- `bank.payments.export.create`: Create bank-facing payment files (B06 wrapper export) for generic payment batches
- `bank.payments.ack.read`: Read imported bank acknowledgement files for generic payment batches
- `bank.payments.ack.import`: Import bank acknowledgement files and update payment execution status (B06)
- `bank.payments.returns.read`: Read bank payment return/rejection events (B08-B)
- `bank.payments.returns.write`: Create/ignore bank payment return/rejection events (B08-B)
- `bank.approvals.policies.read`: Read bank governance approval policies (B09)
- `bank.approvals.policies.create`: Create bank governance approval policies (B09)
- `bank.approvals.policies.update`: Update bank governance approval policies (B09)
- `bank.approvals.requests.read`: Read bank governance approval request queue and decisions (B09)
- `bank.approvals.requests.submit`: Submit manual bank approval requests (B09)
- `bank.approvals.requests.approve`: Approve bank governance requests (B09)
- `bank.approvals.requests.reject`: Reject bank governance requests (B09)
- `bank.approvals.requests.approve.payment`: Approve bank payment export/release requests (B09)
- `bank.approvals.requests.approve.reconConfig`: Approve bank reconciliation rule/template/profile changes (B09)
- `bank.approvals.requests.approve.reconOverride`: Approve bank reconciliation exception override requests (B09)
- `bank.approvals.requests.approve.manualReturn`: Approve bank manual return/rejection creation requests (B09)
- `bank.integration.retention.manage`: Mask/purge raw payload retention for bank integration feeds/webhooks/imports

### 6.7 `payments`

- `payments.batch.read`: Read generic payment batches, lines, exports, and audit
- `payments.batch.create`: Create generic payment batches
- `payments.batch.approve`: Approve generic payment batches (maker-checker)
- `payments.batch.export`: Export generic payment batches to payment files (v1 CSV)
- `payments.batch.post`: Post generic payment batch settlement journals
- `payments.batch.cancel`: Cancel non-posted generic payment batches

### 6.8 `approvals`

- `approvals.policies.read`: Read unified approval policies across bank and payroll (H04)
- `approvals.policies.write`: Create/update unified approval policies across bank and payroll (H04)
- `approvals.requests.read`: Read unified approval requests and decisions across bank and payroll (H04)
- `approvals.requests.submit`: Submit unified approval requests manually (H04)
- `approvals.requests.approve`: Approve unified approval requests (H04)
- `approvals.requests.reject`: Reject unified approval requests (H04)

### 6.9 `workflow`

- `workflow.definition.read`: Read workflow definitions
- `workflow.definition.write`: Create/update workflow definitions
- `workflow.assignment.read`: Read workflow assignments
- `workflow.assignment.write`: Create/update workflow assignments

### 6.10 `payroll`

- `payroll.runs.read`: Read payroll runs, lines, and payroll import audit trail
- `payroll.runs.import`: Import payroll provider CSV into payroll subledger runs
- `payroll.provider.read`: Read payroll provider adapters, connections, employee refs, and import jobs
- `payroll.provider.write`: Create/update payroll provider connections
- `payroll.provider.mapping.read`: Read payroll external employee to internal employee mappings
- `payroll.provider.mapping.write`: Create/update payroll external employee to internal employee mappings
- `payroll.provider.import.read`: Read payroll provider import preview/apply jobs and audit trail
- `payroll.provider.import.preview`: Preview payroll provider imports and store normalized canonical payloads
- `payroll.provider.import.apply`: Apply payroll provider import previews into payroll runs (maker-checker)
- `payroll.provider.import.retention.manage`: Mask/purge raw payload retention for payroll provider import jobs
- `payroll.mappings.read`: Read effective-dated payroll component to GL mappings
- `payroll.mappings.write`: Create/update payroll component to GL mappings
- `payroll.runs.review`: Mark payroll runs as reviewed before accrual posting
- `payroll.runs.finalize`: Finalize payroll runs and post accrual journals to GL
- `payroll.liabilities.read`: Read payroll liabilities, run-level liability summaries, and audit
- `payroll.liabilities.build`: Build payroll liabilities from finalized payroll runs
- `payroll.ownership.read`: Read payroll employee owner-context assignments
- `payroll.ownership.write`: Create/update/deactivate payroll employee owner-context assignments
- `payroll.payment.prepare`: Prepare generic payment batches from payroll liabilities
- `payroll.payment.sync.read`: Preview payroll liability settlement sync from payments and bank reconciliation
- `payroll.payment.sync.apply`: Apply payroll liability settlement sync from payments and bank reconciliation
- `payroll.settlement.override.read`: Read payroll manual settlement override requests and liability override history
- `payroll.settlement.override.request`: Create payroll manual settlement override requests (maker)
- `payroll.settlement.override.approve`: Approve/apply or reject payroll manual settlement override requests (checker)
- `payroll.beneficiary.read`: Read payroll beneficiary bank master accounts
- `payroll.beneficiary.write`: Create/update payroll beneficiary bank master accounts
- `payroll.beneficiary.set_primary`: Set primary payroll beneficiary bank account
- `payroll.beneficiary.snapshot.read`: Read payroll liability beneficiary bank snapshots
- `payroll.sensitive.read`: Override masking for payroll salary and payroll bank fields
- `payroll.close.read`: Read payroll close controls, checklist results, and close audit
- `payroll.close.prepare`: Prepare payroll close checklist and lock flags for a payroll period
- `payroll.close.request`: Request payroll period close after checklist passes (maker)
- `payroll.close.approve`: Approve and close payroll period after request (checker)
- `payroll.close.reopen`: Reopen closed payroll period close controls and release locks
- `payroll.corrections.read`: Read payroll correction links, reversal runs, and correction shell relationships
- `payroll.corrections.create`: Create payroll correction shells (OFF_CYCLE/RETRO)
- `payroll.corrections.reverse`: Reverse finalized payroll runs and create linked reversal runs

### 6.11 `ops`

- `ops.jobs.read`: Read tenant-scoped background jobs and attempts
- `ops.jobs.manage`: Cancel/requeue tenant-scoped background jobs
- `ops.jobs.run`: Run one tenant-scoped background job manually (admin/ops)
- `ops.dashboard.read`: Read operational dashboard KPI/SLA/health summaries
- `ops.exceptions.read`: Read unified exception workbench queue and audit
- `ops.exceptions.manage`: Claim/resolve/ignore/reopen unified exceptions
- `ops.retention.read`: Read data retention policies/runs and retention execution history (H07)
- `ops.retention.manage`: Create/update/execute data retention policies and runs (H07)
- `ops.export_snapshot.read`: Read closed-period immutable export snapshots and hashes (H07)
- `ops.export_snapshot.create`: Create immutable export snapshots for closed payroll periods (H07)

### 6.12 `cari`

- `cari.card.read`: Read counterparty (cari) cards
- `cari.card.request`: Submit/read counterparty (cari) master requests
- `cari.request.review`: Approve/reject counterparty (cari) master requests
- `cari.card.upsert`: Create/update counterparty (cari) cards
- `cari.doc.read`: Read Cari documents
- `cari.doc.create`: Create Cari documents
- `cari.doc.update`: Update draft Cari documents
- `cari.doc.submit`: Submit governed Cari documents for workflow review
- `cari.doc.cancel`: Cancel draft or returned Cari documents
- `cari.doc.post`: Post Cari documents
- `cari.doc.reverse`: Reverse posted Cari documents
- `cari.settlement.apply`: Apply Cari settlement allocations
- `cari.settlement.reverse`: Reverse Cari settlement batches
- `cari.report.read`: Read Cari reports
- `cari.fx.override`: Override Cari FX rates during posting/settlement
- `cari.audit.read`: Read Cari audit trail
- `cari.bank.attach`: Attach Cari records to bank lines
- `cari.bank.apply`: Apply Cari bank-linked settlements/unapplied cash

### 6.13 `item`

- `item.card.read`: Read item cards
- `item.card.upsert`: Create/update item cards

### 6.14 `inventory`

- `inventory.read`: Read inventory warehouses, stock links, movements, and cost layers
- `inventory.upsert`: Create/update inventory warehouses and movements

### 6.15 `fixed_assets`

- `fixed_assets.read`: Read fixed asset register, detail, lifecycle transactions, and evidence metadata
- `fixed_assets.upsert`: Create/update draft fixed assets and category-defaulted asset masters
- `fixed_assets.post`: Activate and post fixed-asset acquisition or capitalization entries
- `fixed_assets.depreciation.run`: Preview/create/post fixed-asset depreciation runs
- `fixed_assets.depreciation.reverse`: Reverse posted fixed-asset depreciation runs
- `fixed_assets.transfer`: Transfer fixed-asset ownership between operating units
- `fixed_assets.dispose`: Dispose, write off, or sell fixed assets
- `fixed_assets.settings.read`: Read fixed-asset categories, depreciation profiles, and account defaults
- `fixed_assets.settings.upsert`: Create/update fixed-asset categories, depreciation profiles, and account defaults
- `fixed_assets.custodian.read`: Read fixed-asset interim custodian setup records
- `fixed_assets.custodian.write`: Create/update fixed-asset interim custodian setup records
- `fixed_assets.account_override`: Override fixed-asset account defaults during acquisition, capitalization, or disposal posting
- `fixed_assets.report.read`: Read fixed-asset register, rollforward, depreciation, and disposal reports

### 6.16 `contract`

- `contract.read`: Read contracts and linked document summaries
- `contract.upsert`: Create/update draft contracts and line sets
- `contract.activate`: Activate contracts
- `contract.suspend`: Suspend active contracts
- `contract.close`: Close contracts
- `contract.cancel`: Cancel draft contracts
- `contract.link_document`: Create contract-document links

### 6.17 `revenue`

- `revenue.schedule.read`: Read revenue-recognition schedules
- `revenue.schedule.generate`: Generate revenue-recognition schedules
- `revenue.run.read`: Read revenue-recognition runs
- `revenue.run.create`: Create revenue-recognition runs
- `revenue.run.post`: Post revenue-recognition runs
- `revenue.run.reverse`: Reverse revenue-recognition runs
- `revenue.report.read`: Read revenue-recognition reports

### 6.18 `fx`

- `fx.rate.bulk_upsert`: Bulk upsert FX rates
- `fx.rate.read`: Read FX rates

### 6.19 `intercompany`

- `intercompany.flag.read`: Read legal entity intercompany flags
- `intercompany.flag.upsert`: Create/update legal entity intercompany flags
- `intercompany.pair.upsert`: Create/update intercompany pairs
- `intercompany.reconcile.run`: Run intercompany reconciliation

### 6.20 `consolidation`

- `consolidation.group.read`: Read consolidation groups
- `consolidation.group.upsert`: Create/update consolidation groups
- `consolidation.group_member.upsert`: Create/update consolidation members
- `consolidation.coa_mapping.read`: Read group CoA mappings
- `consolidation.coa_mapping.upsert`: Create/update group CoA mappings
- `consolidation.elimination_placeholder.read`: Read elimination placeholders
- `consolidation.elimination_placeholder.upsert`: Create/update elimination placeholders
- `consolidation.run.read`: Read consolidation runs
- `consolidation.run.create`: Create consolidation runs
- `consolidation.run.execute`: Execute consolidation runs
- `consolidation.elimination.create`: Create elimination entries
- `consolidation.elimination.post`: Post elimination entries
- `consolidation.adjustment.create`: Create consolidation adjustments
- `consolidation.adjustment.post`: Post consolidation adjustments
- `consolidation.run.finalize`: Finalize consolidation runs
- `consolidation.report.trial_balance.read`: Read consolidation trial balance
- `consolidation.report.summary.read`: Read consolidation summary report
- `consolidation.report.balance_sheet.read`: Read consolidation balance sheet
- `consolidation.report.income_statement.read`: Read consolidation income statement

### 6.21 `onboarding`

- `onboarding.company.setup`: Run company onboarding bootstrap flow

## 7. Review Questions

- Which current roles should remain compatibility-only?
- Which helper bundles are good long-term seams versus temporary assembly helpers?
- Should more shipped roles move toward explicit packetized composition?
- Which broad legacy inline roles should be frozen and hidden for fresh tenants?
- Which bootstrap presets should remain bundled versus broken into smaller packets?

## Companion Docs

- AP-focused future packet review:
  `redesigning/03-APRoleBundleMatrix.md`
- Workflow/runtime explainability roadmap:
  `redesigning/02-WorkFlowAndDocumentStatus.md`
