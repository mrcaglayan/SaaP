# 46 - CARI DOCUMENT RELEASE-GATE SOURCE-INSPECTION REALIGNMENT

## Status
- Completed (2026-03-28)
- Follow-up track after `44-CARI DOCUMENT WORKBENCH PERFORMANCE AND RERENDER ISOLATION.md`
- Follow-up track after `45-CARI DOCUMENT WORKBENCH FOLDER ORGANIZATION AND IMPORT CLEANUP.md`
- Backend-script-only contract maintenance
- No product behavior changes

## Purpose

Realign the active `backend/scripts/` source-inspection gates with the new CARI documents feature layout after the workbench split moved logic from `CariDocumentsPage.jsx` into local `components/` and `hooks/` folders.

Primary target:
- stop release gates from assuming every CARI documents handler, label, and API wire-up still lives inline in `CariDocumentsPage.jsx`
- keep the gates validating the CARI documents feature contract
- avoid false negatives caused by purely structural file moves

## Why This Is Separate

1. Track 44 intentionally excluded `backend/scripts/` source-inspection churn.
2. Track 45 focused on frontend folder organization and import cleanup, not backend gate maintenance.
3. The failure mode is isolated to static contract scripts, so this work should stay separate from runtime frontend verification.

## Guardrails (Locked)

- No product behavior changes.
- No frontend API changes.
- No test-intent dilution: keep checking that the CARI documents feature still exposes the same capabilities.
- Prefer one shared helper for the local CARI documents feature boundary instead of duplicating path lists across scripts.
- Do not touch generated `browser-tests/tmp-cari-smoke/` artifacts.

## Target Scripts

- `backend/scripts/test-cari-pr12-frontend-documents-smoke.js`
- `backend/scripts/test-cari-sl24-subledger-cash-fa-smoke.js`
- `backend/scripts/test-inventory-pr26-release-gate.js`
- `backend/scripts/test-ux-prux02-context-defaults.js`
- `backend/scripts/test-ux-prux11-counterparty-typeahead.js`
- `backend/scripts/test-ux-prux13a-inline-counterparty-create.js`
- `backend/scripts/test-ux-prux15-cari-documents-lifecycle-ui.js`
- `backend/scripts/test-ux-prux18-deep-link-support.js`
- `backend/scripts/test-ux-prux19-related-panel.js`
- `backend/scripts/test-ux-prux21-evidence-uploader-ui.js`
- `backend/scripts/test-ux-prux23-shared-csv-export-helper.js`
- `backend/scripts/test-ux-prux24-table-prefs-and-sticky-columns.js`
- `backend/scripts/test-ux-prux25-saved-views-server-side.js`
- `backend/scripts/test-ux-prux26-smarter-cari-form-defaults.js`
- `backend/scripts/test-ux-prux27-cari-clone-and-recurring-templates.js`
- `backend/scripts/test-ux-prux29-internal-comments-v1.js`
- `backend/scripts/test-ux-prux30-mentions-and-inapp-notifications.js`
- `backend/scripts/test-ux-prux31-ops-status-note-blocked-reason.js`

## Verification Standard

Run the affected static/source-inspection scripts directly after the update and confirm they pass against the split feature layout.

## Execution Tracking

| Step | Scope | Status |
|---|---|---|
| RG00 | Confirm the failure mode and identify stale CARI documents gate scripts | Completed (2026-03-28) |
| RG01 | Add a shared helper that reads the local CARI documents feature source boundary | Completed (2026-03-28) |
| RG02 | Retarget affected source-inspection scripts to the feature-source helper | Completed (2026-03-28) |
| RG03 | Run targeted script verification for the updated gate set | Completed (2026-03-28) |

## Step Notes

### `STEP-RG00` - Failure confirmation

Confirmed on 2026-03-28:
- multiple active gateway scripts still read only `frontend/src/pages/cari/CariDocumentsPage.jsx`
- representative failures reproduced after the folder split:
  - `backend/scripts/test-cari-pr12-frontend-documents-smoke.js`
  - `backend/scripts/test-ux-prux21-evidence-uploader-ui.js`
  - `backend/scripts/test-ux-prux29-internal-comments-v1.js`

Root cause:
- the page shell file still exists
- but many handlers, labels, and API wires now live under local `components/` and `hooks/`
- old page-only string checks therefore produce false negatives

### `STEP-RG01` - Shared helper

Added:
- `backend/scripts/_cariDocumentsFeatureSource.js`

Helper behavior:
- reads `CariDocumentsPage.jsx`
- reads local CARI utility files that still belong to the feature boundary
- reads all local `components/` and `hooks/` files
- returns one aggregated source string for contract-style inspection

### `STEP-RG02` - Script retargeting

Updated the target scripts to validate the CARI documents feature boundary instead of only the old monolithic page file.

### `STEP-RG03` - Verification

Verification completed on 2026-03-28 by running the updated source-inspection scripts directly.
