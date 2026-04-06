Full Walkthrough — Entity-Level AP Workflow Setup
Pre-requisites
Fresh DB reset done (npm run db:reset)
Tenant onboarded via app
npm run db:seed:core run AFTER tenant exists
Login as tmv@gmail.com (SystemAdmin + SecurityAdmin)
Step 0 — Create Org Structure (as SystemAdmin)
As tmv@gmail.com, set up:

What	Example	Where
Group Company	ACME Group	Org setup
Country	TR	Should exist from seed
Legal Entity	TR01	Link to country TR, under ACME Group
Operating Unit	TR01-IST	Under TR01
Step 1 — Create Users with Correct Presets
As tmv@gmail.com, invite 3 users:

#	Email	Preset	Scope	What they get
1	entity@test.com	EntitySetupManager	LEGAL_ENTITY = TR01	LocalUserAdmin, MasterDataSteward, EntityAPController, GLOperator, TreasuryOperator, PayrollOperator, LocalClosePreparer, ShareholderCapitalOperator
2	country@test.com	CountryFinanceSetupManager	COUNTRY = TR	LocalUserAdmin, MasterDataSteward, CountryAPApprover, CountryAPPoster, GLOperator, TreasuryApprover, PayrollApprover, LocalCloseReviewer
3	branch@test.com	BranchOperator	OPERATING_UNIT = TR01-IST	Draft creation, cash, basic GL read
User 3 can also be created later by User 1 (entity person has LocalUserAdmin).

Step 2 — Create Workflow Definition
As tmv@gmail.com (or anyone with workflow.definition.write):

Go to Ayarlar > Workflow Kurulumu

Field	Value
Code	WF_STD_AP_COUNTRY_POSTING_V1 (or use seed template if exists)
Name	Standard AP Country Approval Gate
ProcessType	AP_DOCUMENT_POSTING
Active	Yes
Step 3 — Create Step
Inside that definition, add one step:

Field	Value	Why
stageScopeType	COUNTRY	Country-level approval
requiredPermissionCode	empty	AP uses workflow assignment, not RBAC permission
allowSelfApprove	false	Maker-checker
minApproverCount	1	Enough for pilot
Do NOT put a permission code — system will reject it for AP_DOCUMENT_POSTING.

Step 4 — Create Assignment
Field	Value	Why
processType	AP_DOCUMENT_POSTING	Links to your definition
scopeType	COUNTRY	Covers all entities in the country
Country	TR	Your pilot country
status	ACTIVE	
effectiveFrom	today or earlier	
This means: every governed AP doc from any legal entity in TR goes through this workflow.

Step 5 — Enable Feature Flags
Flag	Value	What it does
FEATURE_AP_DOCUMENT_WORKFLOW_V1	ON	Enables governed AP lifecycle
ap_workflow_compat_mode	ON	Direct-post fallback for scopes without assignment
Safe pilot config — non-covered areas still work.

Step 6 — Test the Flow
Order	Login as	Action	Expected
1	branch@test.com (BranchOperator)	Create draft AP doc on TR01	Draft saved
2	entity@test.com (EntityAPController)	Review draft → Submit	Status = SUBMITTED, gate = PENDING
3	country@test.com (CountryAPApprover)	See submitted doc → Approve or Return	If returned: gate = RETURNED with reason. If approved: gate = APPROVED
4	If returned: entity@test.com	Correct → resubmit	New workflow instance, gate = PENDING again
5	country@test.com (CountryAPPoster)	Post the approved doc	Status = POSTED
Step 7 — Go Strict (after pilot validated)
Once all governed scopes have assignments:

Flip ap_workflow_compat_mode = OFF
Now: no assignment = blocked, no fallback
Ready to start with Step 0?



----------------------------------------------------

Step 5 — Enable Feature Flags
Flag	Value	What it does
FEATURE_AP_DOCUMENT_WORKFLOW_V1	ON	Enables governed AP lifecycle
ap_workflow_compat_mode	ON	Direct-post fallback for scopes without assignment
Safe pilot config — non-covered areas still work.

how to enable it ?
Grep "FEATURE_AP_DOCUMENT_WORKFLOW_V1|ap_workflow_compat_mode" (in c:\Users\ufukk\Desktop\SaaP\backend\src)
41 lines of output
Grep "rollout|phase" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes, glob: *rollout*|*feature*|*ap*workflow*")
1 line of output
Grep "ap.*workflow.*rollout|rollout.*phase|advanceRollout" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes)
11 lines of output
Grep "rollout|feature_code|tenant_features|advancePhase" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes, glob: *feature*|*tenant*")
1 line of output
Grep "tenant_features|advanceRolloutPhase|rolloutPhase" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes)
47 lines of output
Grep "advanceRolloutPhase|ap.*rollout|rollout.*route" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes)
16 lines of output
Grep "advanceRolloutPhase|apWorkflowRollout" (in c:\Users\ufukk\Desktop\SaaP\backend\src)
1 line of output
Grep "FEATURE_AP_DOCUMENT_WORKFLOW_V1|AP_WORKFLOW_COMPAT_MODE" (in c:\Users\ufukk\Desktop\SaaP\shared\cariDocumentWorkflowGovernance.js)
10 lines of output
Grep "tenant_features|feature.*toggle|feature.*enable" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes\provider.js)
65 lines of output
Grep "feature.*route|features.*router|/features" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes)
24 lines of output
Grep "/features|feature_code|toggle.*feature" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes\provider.js)
61 lines of output
Grep "features.*patch|features.*put|features.*post|toggle" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes\provider.js)
1 line of output
Grep ""\/tenants|patch.*tenant|put.*tenant|features"" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes\provider.js)
81 lines of output
Grep "FEATURE_AP_DOCUMENT_WORKFLOW|AP_WORKFLOW_COMPAT" (in c:\Users\ufukk\Desktop\SaaP\backend\src\routes)
1 line of output
Grep "FEATURE_AP_DOCUMENT_WORKFLOW|AP_WORKFLOW_COMPAT" (in c:\Users\ufukk\Desktop\SaaP\frontend\src)
2 lines of output
Grep "FEATURE_AP_DOCUMENT_WORKFLOW|AP_WORKFLOW_COMPAT|featureEnabled|compatMode" (in c:\Users\ufukk\Desktop\SaaP\frontend\src)
35 lines of output
Grep "hasFeature|/me/features" (in c:\Users\ufukk\Desktop\SaaP\frontend\src)
31 lines of output
Feature flags are stored in the tenant_features table and managed through the provider admin panel (not the tenant UI). There's no tenant-facing route to toggle these flags — they're set via the provider API.

How to enable them:

Option A — Via Provider Admin UI:

Login as provider admin (admin@gmail.com — seeded by db:seed:provider-admin)
Go to the tenant management page
Enable the feature flags there (if the UI supports it)
Option B — Direct DB insert (quickest for dev/pilot):


node -e "
import {query} from './src/db.js';
const tenants = await query('SELECT id FROM tenants LIMIT 1');
const tenantId = tenants.rows[0].id;
for (const code of ['FEATURE_AP_DOCUMENT_WORKFLOW_V1', 'AP_WORKFLOW_COMPAT_MODE']) {
  await query(\`INSERT INTO tenant_features (tenant_id, feature_code, is_enabled)
    VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE is_enabled = 1\`, [tenantId, code]);
  console.log('Enabled:', code);
}
process.exit(0);
"
The frontend reads these via GET /me/features on login, so after enabling, just refresh the page.

Want me to run the DB insert for you, or do you want to check if the provider admin panel has a toggle for it?




-------------------------------------------------------------------------

Now I see it. PR-6 says:

Files → Backend: "feature-flag seed or rollout config files as needed"

It was deliberately left vague — PR-6 is a rollout/UAT PR, not a feature PR. The roadmap assumed someone would build the toggle mechanism as part of PR-6, but it was never specified where the UI should live. The roadmap only defined:

The data model — tenant_features table (done in earlier PRs)
The flag semantics — what each flag does (documented)
The rollout sequence — pilot → strict (documented)
The backend reading logic — mapFeatureRows, hasFeature (done)
What's missing from PR-6:

A provider admin UI to toggle flags per tenant (provider manages rollout across tenants)
OR a SystemAdmin settings page where the tenant admin can self-enable (tenant manages their own rollout)
Given the roadmap says "per tenant" and the rollout is a deliberate tenant-by-tenant decision, the natural home is the provider admin tenant detail page — the provider decides when a tenant is ready and flips the switch. SystemAdmin shouldn't self-enable because they might not understand the prerequisites (assignments must exist first, etc.).

For now — do you want me to just run the DB insert to unblock your walkthrough, and we track the provider admin UI as a separate task?