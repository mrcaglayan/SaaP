# 10 - PR-F01 IMPLEMENTATION CHECKLIST

## Scope
PR-F01 from `09-FOLLOW UPS.md`:
- Tenant feature flags
- Readiness placeholders (warning-only)
- Implementation checklist artifact

## Source Reference
- `09-FOLLOW UPS.md` -> `PR-F01: Platform prerequisites and feature flags`

## Implementation Checklist

### A) Tenant Feature Flags
- [x] Define known tenant feature codes:
  - `FEATURE_SUBACCOUNTS_V1` (`feature_subaccounts_v1`)
  - `FEATURE_SETUP_WIZARD_V2` (`feature_setup_wizard_v2`)
  - `FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1` (`feature_consolidation_canonical_mapping_v1`)
  - `FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1` (`feature_workflow_close_consolidation_v1`)
  - `FEATURE_TAX_ENGINE_V1` (`feature_tax_engine_v1`)
- [x] Expose known-but-unconfigured flags as `false` in `/me/features` when `includeDisabled=true`
- [x] Keep existing enabled-feature behavior unchanged

Files:
- `backend/src/services/features.catalog.js`
- `backend/src/services/me.features.service.js`

Validation:
- `cd backend && npm run test:followup:prf01-flags`
- `cd backend && npm run test:ux:prux34`

### B) Readiness Placeholders (Warning-Only)
- [x] Add readiness checks for:
  - `subaccountsV1`
  - `setupWizardV2`
  - `consolidationCanonicalMappingV1`
  - `workflowCloseConsolidationV1`
  - `taxEngineV1`
- [x] Set each placeholder check to warning-only (`minimum: 0`)
- [x] Add i18n labels for checklist rendering (TR + EN)

Files:
- `backend/src/routes/onboarding.js`
- `frontend/src/i18n/messages.js`

Validation:
- `cd backend && npm run test:followup:prf01-readiness`

### C) Tracker Wiring
- [x] Step `#1` marked `DONE` in `10-EXECUTION TRACKER.md` with evidence
- [x] Step `#2` marked `DONE` in `10-EXECUTION TRACKER.md` with evidence
- [x] Step `#3` file created (`10-PR-F01-IMPLEMENTATION-CHECKLIST.md`)

## Exit Criteria for PR-F01
- [x] Known feature flags exist and are returned as disabled defaults when not configured
- [x] Readiness placeholder checks exist and are non-blocking
- [x] Tests for PR-F01 flags and readiness placeholders pass
- [x] Tracker is updated and points to the next implementation step

## Hand-off to Next Step
- Next execution item is `10-EXECUTION TRACKER.md` step `#4` (`m081` migration for subaccounts hardening).