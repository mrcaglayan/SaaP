Implemented PR-AMX03 and marked it complete in 58-50K ABOVE.MD (line 157). The AP flow now routes with persisted amount_base at submit time in cari.document.service.js (line 7004), stores the matched routing snapshot and evaluated amount into the bridged target snapshot during submit in cari.document.service.js (line 8492) and workflows.service.js (line 2397), and reads that persisted snapshot back in the workflow gate summary so later matrix edits do not rewrite existing instance explainability in cari.document.service.js (line 7257).

I also added test-workflows-amx03-ap-gate-integration.js (line 1), which proves three behaviors: submit uses base amount, existing instances keep their original routing snapshot after admin edits, and returned documents re-route on resubmission. workflowGate now carries routing fields such as evaluated amount, amount basis, matched scope layer, fallback usage, and the persisted routing-rule snapshot, which sets up the later explainability/UI steps cleanly.

Verified with node scripts/test-workflows-amx03-ap-gate-integration.js, node scripts/test-cari-pr27-governed-ap-review-states.js, node scripts/test-workflows-amx01-routing-matrix.js, node scripts/test-workflows-amx02-assignment-resolution.js, and node scripts/test-followup-prf05-workflows-definitions-assignments-api.js. The next planned step is PR-AMX04: align the unified approval-policy snapshots and debug views with the new matched-route metadata.

4 files changed
+1397
-309
Undo

Review
PR-STEPS/58-50K ABOVE.MD
backend/scripts/test-workflows-amx03-ap-gate-integration.js
cari.document.service.js
+573
-240

Review
backend/src/services/workflows.service.js
read the plan of 58-50k above.md file to see whole plan what to pay attention etc. then implement the next step after done mark them.

Worked for 14m 58s
Implemented PR-AMX04 and marked it complete in 58-50K ABOVE.MD (line 201).

The bridge now mirrors the already-resolved workflow route into unified policy_snapshot_json, so later audit/debug reads explain the original match without re-running selection after admin edits. The main changes are in workflows.service.js (line 746), workflows.service.js (line 2268), workflows.service.js (line 2565), approval.engine.service.js (line 319), approval.engine.service.js (line 1299), and approvalPolicies.service.js (line 245). I also added the dedicated smoke at test-workflows-amx04-policy-snapshot-alignment.js (line 1).

Verified with:

node scripts/test-workflows-amx04-policy-snapshot-alignment.js
node scripts/test-workflows-amx03-ap-gate-integration.js
node scripts/test-cari-pr27-governed-ap-review-states.js
node scripts/test-followup-prf05-workflows-definitions-assignments-api.js
I also checked the broader unified-engine smoke, but node scripts/test-approvals-pr3b-unified-engine.js still fails in this environment with Role TenantAdmin not found, so I did not use that as the gate for this step. The next planned step is PR-AMX05.

5 files changed
+965
-105
Undo

Review
PR-STEPS/58-50K ABOVE.MD
backend/scripts/test-workflows-amx04-policy-snapshot-alignment.js
backend/src/services/approval.engine.service.js
backend/src/services/approvalPolicies.service.js
backend/src/services/workflows.service.js
read the plan of 58-50k above.md file to see whole plan what to pay attention etc. then implement the next step after done mark them.

Worked for 24m 22s
Implemented PR-AMX05 and marked it complete in 58-50K ABOVE.MD (line 243).

The admin UI now has a dedicated AP routing matrix on the existing workflow setup page in WorkflowSetupPage.jsx (line 1528) with the new section component at ApprovalRoutingMatrixSection.jsx (line 216). It supports inline list/edit flow, clone, fallback marking, preview sentences, client-side overlap/fallback validation, and a remove flow that retires a rule by setting it inactive. I also wired preset-backed route saves in WorkflowSetupPage.jsx (line 1058), so choosing a preset creates a real AP workflow definition plus steps before binding the route. The shared matrix helpers live in workflowSetupHelpers.js (line 2067).

Verified with:

node ./node_modules/eslint/bin/eslint.js src/pages/settings/WorkflowSetupPage.jsx src/pages/settings/workflows/components/ApprovalRoutingMatrixSection.jsx src/pages/settings/workflows/utils/workflowSetupHelpers.js
node ./node_modules/vite/bin/vite.js build
I did not run browser/manual UI tests. The next planned step is PR-AMX06.

4 files changed
+1711
-71
Undo

Review
PR-STEPS/58-50K ABOVE.MD
frontend/src/pages/settings/WorkflowSetupPage.jsx
frontend/src/pages/settings/workflows/components/ApprovalRoutingMatrixSection.jsx
frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js
read the plan of 58-50k above.md file to see whole plan what to pay attention etc. then implement the next step after done mark them.

Worked for 25m 14s
Implemented PR-AMX06 and marked its checklist complete in 58-50K ABOVE.MD. The backend now exposes matched route definition code/name alongside persisted routing diagnostics in cari.document.service.js and workflows.service.js, including compatibility lookup support for older instances. I also extended the AP gate smoke in test-workflows-amx03-ap-gate-integration.js.

On the frontend, the AP explainability surfaces now render a routing context block with matched route, matched rule, evaluated amount, amount basis, explicit fallback usage, and clearer no-route/direct-post messaging in cariWorkflowExplainability.js and GovernedRuntimeExplainabilityPanel.jsx. The operator panel titles were also tightened in CariDocumentPostReversePanel.jsx and CariDocumentDetailContent.jsx, and the action-access lines now explain why the current user cannot submit, approve, or post.

Verified with:

node scripts/test-workflows-amx02-assignment-resolution.js
node scripts/test-workflows-amx03-ap-gate-integration.js
node scripts/test-cari-pr27-governed-ap-review-states.js
node ./node_modules/eslint/bin/eslint.js src/components/workflows/GovernedRuntimeExplainabilityPanel.jsx src/pages/cari/cariWorkflowExplainability.js src/pages/cari/components/CariDocumentPostReversePanel.jsx src/pages/cari/components/CariDocumentDetailContent.jsx
node ./node_modules/vite/bin/vite.js build
I did not run manual browser UI checks. The next planned step is PR-AMX07.

8 files changed
+710
-273
Undo

Review
PR-STEPS/58-50K ABOVE.MD
backend/scripts/test-workflows-amx03-ap-gate-integration.js
cari.document.service.js
+124
-20

Review
backend/src/services/workflows.service.js
frontend/src/components/workflows/GovernedRuntimeExplainabilityPanel.jsx
frontend/src/pages/cari/cariWorkflowExplainability.js
frontend/src/pages/cari/components/CariDocumentDetailContent.jsx
frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx
