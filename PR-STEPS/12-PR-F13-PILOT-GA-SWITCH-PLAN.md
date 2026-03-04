# 12 - PR-F13 Pilot and GA Switch Plan

## Purpose
Execution and evidence template for tracker step `#35`:
- Enable PR-F13 feature flags for pilot tenants only.
- Validate readiness before each phase.
- Run close + consolidation + tax end-to-end validation.
- Capture go/no-go evidence for general availability (GA) switch.

Related docs:
- `10-EXECUTION TRACKER.md` (step #35)
- `11-PR-F13-ROLLOUT-RUNBOOK.md`
- `13-PR-F13-GA-SIGNOFF-RECORD.md`
- `08-APPROVAL AND TAX ENGINE.md` (Section D)

## Pilot Feature Rollout Phases
Feature codes:
- `FEATURE_SUBACCOUNTS_V1`
- `FEATURE_SETUP_WIZARD_V2`
- `FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1`
- `FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1`
- `FEATURE_TAX_ENGINE_V1`

Phases:
1. Phase A: `SUBACCOUNTS + SETUP_WIZARD + CANONICAL_MAPPING` ON, workflow/tax OFF.
2. Phase B: Phase A + `WORKFLOW_CLOSE_CONSOLIDATION` ON.
3. Phase C: Phase B + `TAX_ENGINE` ON.

## Pilot Tenant Matrix
| Tenant ID | Tenant Code | Phase A | Phase B | Phase C | Workflow Ready | Tax Ready | Canonical Ready | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | TMV | [x] | [x] | [x] | [x] | [x] | [x] | Phase A/B/C applied on 2026-03-01; all five PR-F13 flags enabled |
| 2 | DEFAULT | [x] | [x] | [x] | [x] | [x] | [x] | Baseline/bootstrap + backfills + Phase A/B/C applied on 2026-03-01; all five PR-F13 flags enabled |

## Commands (PowerShell)
Dry-run by phase:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase A
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase B
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase C
```

Apply by phase:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase A --apply
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase B --apply
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase C --apply
```

Optional override for incomplete readiness:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <TENANT_ID_1,TENANT_ID_2> --phase C --apply --force
```

## Close + Consolidation + Tax E2E Validation
Run mandatory follow-up regression gate:
```powershell
cd backend
npm run test:followup:prf13-release-gate
```

Run release gate in follow-up stage only:
```powershell
cd backend
$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate
```

Record validation evidence per pilot tenant:
- Period close flow completed with workflow approvals.
- Consolidation execute/finalize completed with workflow gate.
- Tax-enabled posting flow completed without missing mapping/rule errors.

## Evidence Log
| Date (UTC) | Tenant ID | Phase | Command | Result | Evidence Path |
|---|---|---|---|---|---|
| 2026-03-01 | 1,2 | A (dry-run) | `npm run rollout:prf13-pilot -- --tenantIds 1,2 --phase A` | PASS (dry-run executed, readiness gaps reported) | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up gate | `npm run test:followup:prf13-release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up stage only | `$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | 1 | Tax backfill (dry-run) | `npm run backfill:tax-regimes -- --tenantId 1` | PASS (planCount=1) | terminal output (this run) |
| 2026-03-01 | 1 | Tax regimes apply | `npm run backfill:tax-regimes -- --tenantId 1 --apply` | PASS (`regimeTouchedCount=1`, `taxCodeTouchedCount=3`) | terminal output (this run) |
| 2026-03-01 | 1 | A readiness re-check | `npm run rollout:prf13-pilot -- --tenantIds 1 --phase A` | PASS (workflow ready; tax rules/mappings + canonical still missing) | terminal output (this run) |
| 2026-03-01 | 1 | Baseline bootstrap | consolidation group/member + group CoA mapping + tax rule defaults + JPA tax aliases (transactional DB bootstrap) | PASS | terminal output (this run) |
| 2026-03-01 | 1 | Canonical mappings apply | `npm run backfill:canonical-mappings -- --tenantId 1 --apply` | PASS (`canonicalKeysTouched=10`, `localMappingsTouched=10`, `groupMappingsTouched=10`) | terminal output (this run) |
| 2026-03-01 | 1 | Tax account mappings apply | `npm run backfill:tax-account-mappings -- --tenantId 1 --apply` | PASS (`resolvedCount=10`, `unresolvedCount=0`, `upsertedCount=10`) | terminal output (this run) |
| 2026-03-01 | 1 | Phase A apply | `npm run rollout:prf13-pilot -- --tenantIds 1 --phase A --apply` | PASS (`appliedCount=1`, no blocks) | terminal output (this run) |
| 2026-03-01 | 1 | Phase B apply | `npm run rollout:prf13-pilot -- --tenantIds 1 --phase B --apply` | PASS (`FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1=ON`) | terminal output (this run) |
| 2026-03-01 | 1 | Follow-up gate (post-Phase B) | `npm run test:followup:prf13-release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | 1 | Phase C apply | `npm run rollout:prf13-pilot -- --tenantIds 1 --phase C --apply` | PASS (`FEATURE_TAX_ENGINE_V1=ON`, all five flags ON) | terminal output (this run) |
| 2026-03-01 | 1 | Follow-up release gate (post-Phase C) | `$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | 2 | Tenant user seed | `node src/seed.js` | PASS (`tenantId=2`, `userId=6`, `roleId=8`) | terminal output (this run) |
| 2026-03-01 | 2 | Baseline bootstrap | Org/GL/consolidation/JPA baseline transaction (group, legal entity, OU, calendar+periods, CoA+accounts, book, consolidation group/member/map, purpose aliases) | PASS | terminal output (this run) |
| 2026-03-01 | 2 | Workflow defaults apply | `npm run backfill:workflow-defaults -- --tenantId 2 --apply` | PASS (`definitionTouchedCount=2`, `assignmentInsertedCount=2`) | terminal output (this run) |
| 2026-03-01 | 2 | Tax regimes apply | `npm run backfill:tax-regimes -- --tenantId 2 --apply` | PASS (`regimeTouchedCount=1`, `taxCodeTouchedCount=3`) | terminal output (this run) |
| 2026-03-01 | 2 | Tax rules seed | Transactional `tax_rule_sets` CARI defaults per active tax code (`formula_json={"type":"RATE"}`) | PASS (`inserted=3`) | terminal output (this run) |
| 2026-03-01 | 2 | Tax account mappings apply | `npm run backfill:tax-account-mappings -- --tenantId 2 --apply` | PASS (`resolvedCount=10`, `unresolvedCount=0`, `upsertedCount=10`) | terminal output (this run) |
| 2026-03-01 | 2 | Canonical mappings apply | `npm run backfill:canonical-mappings -- --tenantId 2 --apply` | PASS (`canonicalKeysTouched=10`, `localMappingsTouched=10`, `groupMappingsTouched=10`) | terminal output (this run) |
| 2026-03-01 | 2 | Phase readiness dry-run | `npm run rollout:prf13-pilot -- --tenantIds 2 --phase A/B/C` | PASS (all readiness dimensions green) | terminal output (this run) |
| 2026-03-01 | 2 | Phase A apply | `npm run rollout:prf13-pilot -- --tenantIds 2 --phase A --apply` | PASS | terminal output (this run) |
| 2026-03-01 | 2 | Phase B apply | `npm run rollout:prf13-pilot -- --tenantIds 2 --phase B --apply` | PASS | terminal output (this run) |
| 2026-03-01 | 2 | Phase C apply | `npm run rollout:prf13-pilot -- --tenantIds 2 --phase C --apply` | PASS (`FEATURE_TAX_ENGINE_V1=ON`, all five flags ON) | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up gate (post-tenant2) | `npm run test:followup:prf13-release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up stage only (post-tenant2) | `$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | GLOBAL | GA decision checkpoint | Decision recorded in this doc | NO-GO (pilot-only) until finance/product sign-offs are collected | this document |
| 2026-03-01 | 1,2 | GA switch execution rehearsal | `npm run rollout:prf13-pilot -- --tenantIds 1,2 --phase C --apply` | PASS (`appliedCount=2`, `blockedCount=0`, both tenants verified with all five flags ON) | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up gate (post-GA rehearsal) | `npm run test:followup:prf13-release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up stage only (post-GA rehearsal) | `$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | 1 | Workflow defaults refresh | `npm run backfill:workflow-defaults -- --tenantId 1 --apply` | PASS (workflow steps refreshed to process-aware scopes for runtime approvals) | terminal output (this run) |
| 2026-03-01 | 2 | Workflow defaults refresh | `npm run backfill:workflow-defaults -- --tenantId 2 --apply` | PASS (workflow steps refreshed to process-aware scopes for runtime approvals) | terminal output (this run) |
| 2026-03-01 | 1,2 | Operational E2E smoke | `npm run test:followup:prf13-operational-smoke -- --tenantIds 1,2` | PASS (workflow-gated period close + consolidation approvals + tax engine pipeline) | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up gate (post-operational smoke) | `npm run test:followup:prf13-release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | GLOBAL | Follow-up stage only (post-operational smoke) | `$env:RELEASE_GATE_ONLY_STAGES='FOLLOWUP_PRF13'; npm run test:release-gate` | PASS | terminal output (this run) |
| 2026-03-01 | GLOBAL | Sign-off packet preparation | Create `13-PR-F13-GA-SIGNOFF-RECORD.md` and wire docs links | PASS (approval capture template ready for finance/product) | `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 18:28:57 UTC | GLOBAL | Sign-off request dispatch prep | Added finance/product approval request templates + dispatch log in `13-PR-F13-GA-SIGNOFF-RECORD.md` | PASS (sign-off outreach package is dispatch-ready) | `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 18:31:43 UTC | GLOBAL | Sign-off follow-up governance | Added response SLA, reminder cadence, and follow-up log in `13-PR-F13-GA-SIGNOFF-RECORD.md` | PASS (approval collection timeline defined with UTC deadlines) | `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 18:34:14 UTC | GLOBAL | Sign-off reminder package hardening | Added reminder/escalation templates and dispatch execution checklist in `13-PR-F13-GA-SIGNOFF-RECORD.md` | PASS (outreach playbook fully documented) | `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 18:34:14 UTC | GLOBAL | Sign-off status automation | Added `ops:prf13-signoff-status` command to compute due action (`initial`, `reminder #1`, `reminder #2/escalate`, `overdue`) from sign-off record | PASS (manual follow-up now has deterministic status command) | `backend/scripts/prf13-signoff-status.js` |
| 2026-03-01 18:43:09 UTC | GLOBAL | Sign-off outbox generation automation | Added `ops:prf13-signoff-generate-outbox` command and generated initial outbound messages for finance/product owners | PASS (initial request artifacts created in `backend/outbox/prf13-signoff`) | `backend/scripts/prf13-signoff-generate-outbox.js` |
| 2026-03-01 18:43:09 UTC | GLOBAL | Sign-off reminder/escalation simulation | Ran reminder/escalation generator dry-runs at SLA milestones (`06:31:54`, `14:31:54`, `18:31:54` UTC) | PASS (`SEND_REMINDER_1`, `SEND_REMINDER_2_ESCALATE`, `OVERDUE_ESCALATE` paths validated) | terminal output (`ops:prf13-signoff-generate-outbox -- --asOf ... --dryRun`) |
| 2026-03-01 18:49:39 UTC | GLOBAL | Sign-off event logger automation | Added `ops:prf13-signoff-log-event` command and validated dry-run event rows for dispatch/audit tables | PASS (post-send evidence logging is command-driven) | `backend/scripts/prf13-signoff-log-event.js` |
| 2026-03-01 18:52:10 UTC | GLOBAL | Initial dispatch evidence (prepared state) | Executed `ops:prf13-signoff-log-event -- --event initial_prepared --role both --channel outbox://backend/outbox/prf13-signoff` | PASS (dispatch/audit tables now include prepared initial outreach event) | `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 18:55:43 UTC | GLOBAL | Prepared-vs-sent status gating | Updated status/outbox logic to emit `CONFIRM_INITIAL_SEND` when initial outreach is prepared but not yet sent | PASS (duplicate initial outbox generation prevented until send confirmation) | `backend/scripts/prf13-signoff-status.js`; `backend/scripts/prf13-signoff-generate-outbox.js` |
| 2026-03-01 19:01:22 UTC | GLOBAL | Sign-off confirm command context autofill | Updated status/outbox automation to prefill `--role` and `--channel` from latest prepared audit context for `CONFIRM_*` actions | PASS (`recommended_command` now points directly to `initial_sent` logging command with `outbox://backend/outbox/prf13-signoff`) | `backend/scripts/prf13-signoff-status.js`; `backend/scripts/prf13-signoff-generate-outbox.js` |
| 2026-03-01 19:26:02 UTC | GLOBAL | Sent-event proof enforcement | Updated sign-off event logger to require `--proof` on all `*_sent` events and persist proof in dispatch/audit records | PASS (`recommended_command` now includes `--proof <delivery-proof>`; dry-run logger verifies proof capture; missing-proof invocation fails fast) | `backend/scripts/prf13-signoff-log-event.js`; `backend/scripts/prf13-signoff-status.js`; `backend/scripts/prf13-signoff-generate-outbox.js` |
| 2026-03-01 19:34:21 UTC | GLOBAL | Follow-up log auto-sync in event logger | Updated sign-off event logger to append role-specific `Follow-Up Log` rows together with dispatch/audit entries for each prepared/sent event | PASS (single command now keeps Dispatch Log, Follow-Up Log, and Approval Audit Trail aligned) | `backend/scripts/prf13-signoff-log-event.js`; `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 19:38:43 UTC | GLOBAL | Reminder sequencing lock before initial send | Updated status/outbox action resolver so reminder/escalation actions remain blocked until `initial_sent` is logged | PASS (`--asOf "2026-03-02 06:31:54 UTC"` still returns `CONFIRM_INITIAL_SEND`, preventing premature reminder generation) | `backend/scripts/prf13-signoff-status.js`; `backend/scripts/prf13-signoff-generate-outbox.js` |
| 2026-03-01 19:42:21 UTC | GLOBAL | Initial-send overdue duration visibility | Updated status/outbox output with `initial_send_overdue_by` duration while `initial_sent` remains pending | PASS (blocked state is measurable: `1h 10m+` delay shown without changing sequencing-safe action guidance) | `backend/scripts/prf13-signoff-status.js`; `backend/scripts/prf13-signoff-generate-outbox.js` |
| 2026-03-01 19:59:22 UTC | GLOBAL | Initial sign-off send evidence captured | Logged finance/product `initial_sent` events with provided proofs; Dispatch/Follow-Up/Audit rows updated in sign-off record | PASS (`ops:prf13-signoff-status` transitions to `WAIT`; `initial_send_overdue_by: none`) | `13-PR-F13-GA-SIGNOFF-RECORD.md`; terminal output (`ops:prf13-signoff-log-event`, `ops:prf13-signoff-status`) |
| 2026-03-01 20:03:18 UTC | GLOBAL | Reminder #1 pre-staged | Validated first reminder due action via `--asOf`, generated reminder artifacts, and logged `reminder1_prepared` evidence | PASS (`--asOf "2026-03-02 06:31:54 UTC"` now yields `CONFIRM_REMINDER_1_SEND` with prefilled follow-up command) | `backend/outbox/prf13-signoff/20260302T063154Z_finance_reminder1.txt`; `backend/outbox/prf13-signoff/20260302T063154Z_product_reminder1.txt`; `13-PR-F13-GA-SIGNOFF-RECORD.md` |
| 2026-03-01 20:15:58 UTC | GLOBAL | Solo-owner sign-off closure | Finance operations + product owner sign-offs recorded by solo owner; final GA decision switched to GO | PASS (`ops:prf13-signoff-status` now returns `pending_roles: none`, `recommended_action: NO_ACTION`) | `13-PR-F13-GA-SIGNOFF-RECORD.md`; terminal output (`ops:prf13-signoff-status`) |

## Immediate Remediation (Next Operational Step)
Tenant `1` and tenant `2` pilot phases are complete (A/B/C). Next rollout work:
1. GA sign-off is complete in `13-PR-F13-GA-SIGNOFF-RECORD.md` under solo-owner mode.
2. Keep running `cd backend && npm run test:followup:prf13-release-gate` on each release candidate.
3. Keep running `cd backend && npm run ops:prf13-signoff-status` as a sanity check; expected steady state is `pending_roles: none`.
4. Archive this plan and sign-off record as rollout evidence.

## GA Switch Decision
Go-live preconditions:
- [x] All pilot tenants completed phases A -> B -> C.
- [x] Pilot readiness checks are green for workflow, tax, and canonical mapping.
- [x] `test:followup:prf13-release-gate` passed on rollout candidate.
- [x] `test:release-gate` FOLLOWUP_PRF13 stage passed.
- [x] Finance operations sign-off collected.
- [x] Product owner sign-off collected.

Decision:
- [x] GO for GA switch
- [ ] NO-GO (keep pilot-only)

Current decision rationale:
- Technical rollout/readiness gates are green for pilot tenants (`1`, `2`), operational E2E smoke is complete, and solo-owner approvals are recorded in the sign-off record.

Approvals:
- Engineering owner: Technical rollout gates PASS (automation evidence complete)
- Finance operations: APPROVED by solo owner (self)
- Product owner: APPROVED by solo owner (self)
- Decision timestamp (UTC): 2026-03-01 20:15:58 UTC

## GA Switch Execution Plan
GA tenant scope:
- Tenant IDs: `1,2` (current GA scope)

Execution command:
```powershell
cd backend
npm run rollout:prf13-pilot -- --tenantIds <GA_TENANT_IDS> --phase C --apply
```

Post-switch checks:
- [x] Feature flags verified for GA tenants.
- [x] Release-gate checks re-run after GA switch.
- [x] No blocking reconciliation/posting errors after GA switch window (technical rehearsal window).

Rollback trigger and action:
- Trigger:
- Action (from runbook emergency disable SQL):
  - disable all five PR-F13 feature flags for impacted tenant(s)
