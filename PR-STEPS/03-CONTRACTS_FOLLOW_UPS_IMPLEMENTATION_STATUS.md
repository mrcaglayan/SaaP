# Contracts Follow-Ups Implementation Status

Status:
- Repo-aware audit document
- Last checked against code/tests: `2026-03-19`
- Purpose: replace the stale "next PR backlog" framing for contracts follow-ups

This file is intentionally not a backlog anymore. It records whether the deferred contracts follow-up PR lines were actually implemented in the repo.

## Verified Tracker

- [x] PR-20 Contract document unlink/adjustment flow
- [x] PR-21 Contract amendment/versioning + partial line update semantics
- [x] PR-22 Negative/credit contract line model
- [x] PR-23 Multi-currency contract-document linking
- [x] PR-24 Advanced `MILESTONE` / `MANUAL` recognition semantics
- [x] PR-25 Contract-scoped linkable-documents endpoint
- [x] PR-26 Counterparty enrichment search/sort/filter by AR/AP account fields
- [x] PR-27 Reporting/index optimization pass
- [x] PR-28 Product/module rename hardening + route alias/redirect compatibility
- [x] PR-29 Release gate expansion to include contracts/revenue modules

## Repo-Aware Status Table

| PR | Scope | Repo Status | Evidence | Action |
| --- | --- | --- | --- | --- |
| PR-20 | Contract document unlink/adjustment flow | Verified implemented | Routes: `backend/src/routes/contracts.js`; service: `backend/src/services/contracts.service.js`; frontend API: `frontend/src/api/contracts.js`; tests: `backend/scripts/test-contracts-pr20-link-corrections.js`, `backend/scripts/test-contracts-pr20-frontend-link-corrections-smoke.js` | No standalone PR work remains |
| PR-21 | Contract amendment/versioning + partial line update semantics | Verified implemented | Routes: `backend/src/routes/contracts.js`; service: `backend/src/services/contracts.service.js`; frontend API: `frontend/src/api/contracts.js`; tests: `backend/scripts/test-contracts-pr21-amendment-versioning-and-partial-lines.js`, `backend/scripts/test-contracts-pr21-frontend-amendment-smoke.js`, `backend/scripts/test-contracts-pr21-billing-generation.js` | No standalone PR work remains |
| PR-22 | Negative/credit contract line model | Verified implemented | Signed-line coverage is part of `backend/scripts/test-contracts-pr21-amendment-versioning-and-partial-lines.js` and `backend/scripts/test-contracts-pr22-revrec-generation.js` | No standalone PR work remains |
| PR-23 | Multi-currency contract-document linking | Verified implemented | Covered by `backend/scripts/test-contracts-pr23-revrec-line-account-derivation.js` and OpenAPI generation | No standalone PR work remains |
| PR-24 | Advanced `MILESTONE` / `MANUAL` semantics | Verified implemented | Covered by `backend/scripts/test-contracts-pr21-amendment-versioning-and-partial-lines.js` and `backend/scripts/test-contracts-pr24-financial-rollups.js` | No standalone PR work remains |
| PR-25 | Contract-scoped linkable-documents endpoint | Verified implemented | Covered by route/client wiring plus `backend/scripts/test-contracts-pr25-frontend-linkable-documents-smoke.js` | No standalone PR work remains |
| PR-26 | Counterparty enrichment search/sort/filter by AR/AP account fields | Verified implemented | Covered by `backend/scripts/test-cari-pr19-counterparty-account-mapping-and-posting-resolution.js` and `backend/scripts/test-cari-pr19-frontend-counterparty-account-fields-smoke.js` | No standalone PR work remains |
| PR-27 | Reporting/index optimization pass | Verified implemented | Covered by `backend/scripts/test-contracts-pr27-reporting-index-optimization.js` | No standalone PR work remains |
| PR-28 | Rename hardening + route alias compatibility | Verified implemented | Covered by `backend/scripts/test-contracts-pr28-frontend-rename-and-route-aliases.js` | No standalone PR work remains |
| PR-29 | Contracts/revenue module release gate expansion | Verified implemented | `backend/scripts/test-contracts-revenue-gate.js`, `backend/scripts/test-release-gate.js`, `backend/package.json` | No standalone PR work remains |

## Verification Snapshot

Verified directly on `2026-03-19`:
- `npm run test:contracts-pr20`
- `npm run test:contracts-pr21`
- `npm run test:contracts-pr21-billing`

Additional repo evidence:
- Contracts/revenue gate already includes PR-20 and PR-21 coverage in `backend/scripts/test-contracts-revenue-gate.js`
- Usage documentation already describes PR-21 billing, amendment, adjust, and unlink behavior in `docs/kullanim-kilavuzlari/KULLANIM_KILAVUZU_CONTRACTS_REVENUE_PR16_PR19.md`

## Outcome

There is no open follow-up backlog remaining in the original `PR-20` .. `PR-29` chain. Do not use this file to choose new contracts work as if `PR-20` or `PR-21` were still pending.

If new contracts work is needed, create a fresh candidate/entry-criteria document for net-new scope instead of reopening this follow-up chain.
