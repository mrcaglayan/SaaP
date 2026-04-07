Full Walkthrough - Entity-Level AP Workflow Setup

Pre-requisites
- Fresh DB reset done (`npm run db:reset`)
- Tenant onboarded via app
- `npm run db:seed:core` run after tenant exists
- Login as `tmv@gmail.com` (`SystemAdmin` + `SecurityAdmin`)

Step 0 - Create Org Structure (as `tmv@gmail.com`)

Set up:

What | Example | Where
--- | --- | ---
Group Company | `ACME Group` | Org setup
Country | `TR` | Should exist from seed
Legal Entity | `TR01` | Link to country `TR`, under `ACME Group`
Operating Unit | `TR01-IST` | Under `TR01`

Step 1 - Create Users with Correct Presets

Invite 3 users:

# | Email | Preset | Scope | What they get
--- | --- | --- | --- | ---
1 | `entity@test.com` | `EntityAPController` | `LEGAL_ENTITY = TR01` | `LocalUserAdmin`, `MasterDataSteward`, `CounterpartyCardEditor`, `EntityAPController`, `APApprover`, `GLOperator`, `TreasuryOperator`, `PayrollOperator`, `LocalClosePreparer`, `ShareholderCapitalOperator`
2 | `country@test.com` | `CountryAPApprover` | `COUNTRY = TR` | `CountryAPApprover`, `CountryAPController` (`CountryAPPoster` runtime code), `APApprover`, `GLOperator`, `TreasuryApprover`, `PayrollApprover`, `LocalCloseReviewer`
3 | `branch@test.com` | `BranchOperator` | `OPERATING_UNIT = TR01-IST` | Draft creation, cash, basic GL read

User 3 can also be created later by User 1 because the entity user has `LocalUserAdmin`.

Step 2 - Create Workflow Definition

Go to `Ayarlar > Workflow Kurulumu`.

Fresh tenant'larda bu tanim otomatik gelmez; burada siz olusturursunuz.

Field | Value
--- | ---
Code | `WF_STD_AP_COUNTRY_POSTING_V1`
Name | `Standard AP Country Approval Gate`
ProcessType | `AP_DOCUMENT_POSTING`
Active | `Yes`

Step 3 - Create Step

Inside that definition, add one step:

Field | Value | Why
--- | --- | ---
`stageScopeType` | `COUNTRY` | Country-level approval
`requiredPermissionCode` | empty | AP uses workflow assignment, not RBAC permission
`allowSelfApprove` | `false` | Maker-checker
`minApproverCount` | `1` | Enough for pilot

Do not put a permission code. The system rejects it for `AP_DOCUMENT_POSTING`.

Step 4 - Create Assignment

Field | Value | Why
--- | --- | ---
`processType` | `AP_DOCUMENT_POSTING` | Links to your definition
`scopeType` | `COUNTRY` | Covers all entities in the country
`Country` | `TR` | Your pilot country
`status` | `ACTIVE` |
`effectiveFrom` | today or earlier |

This means every governed AP document from any legal entity in `TR` goes through this workflow.

Step 5 - Start Pilot Coverage

There are no tenant feature flags anymore.

In the pure ERP model:
- Doc-class metadata (`is_workflow_governed`) decides which AP document classes can be governed.
- Workflow assignment presence decides which scopes are actually governed.
- Governed AP class + no assignment = that scope stays on direct-post.
- Governed AP class + assignment = that scope uses submit/review/approve/post.

Safe pilot config:
- Create one active `COUNTRY = TR` assignment first.
- Only covered scopes use workflow.
- Uncovered scopes keep direct-post behavior.

Step 6 - Test the Flow

Order | Login as | Action | Expected
--- | --- | --- | ---
1 | `branch@test.com` (`BranchOperator`) | Create draft AP doc on `TR01` | Draft saved
2 | `entity@test.com` (`EntityAPController`) | Review draft -> Submit | Status = `SUBMITTED`, gate = `PENDING`
3 | `country@test.com` (`CountryAPApprover`) | See submitted doc -> Approve or Return | If returned: gate = `RETURNED` with reason. If approved: gate = `APPROVED`
4 | `entity@test.com` | Correct -> resubmit | New workflow instance, gate = `PENDING` again
5 | `country@test.com` (`CountryAPController`) | Post the approved doc | Status = `POSTED`

Step 7 - Expand Coverage

Once the pilot is validated:
- Add more `COUNTRY` or `LEGAL_ENTITY` assignments for the remaining governed scopes.
- Use `LEGAL_ENTITY` assignment only where you need an override over the country default.
- There is no global strict toggle. Assignment coverage itself is the rollout mechanism.

How to enable it?

You do not enable AP workflow with tenant feature flags anymore.

To activate governed AP flow for a scope:
1. Make sure the AP doc class is workflow-governed.
2. Create or activate an `AP_DOCUMENT_POSTING` workflow definition.
3. Create an active workflow assignment for the target scope (`COUNTRY`, `LEGAL_ENTITY`, `GROUP`, or `TENANT`).
4. Refresh the UI and test with a governed AP document in that scope.

If a governed AP scope has no assignment:
- Submit is not available for that scope.
- The document stays on the direct-post path.
- The fix is to add the correct assignment, not to toggle a tenant flag.
