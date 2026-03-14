# Cari v1 Operations Runbook

## Purpose

This runbook defines how to operate Cari v1 AR/AP workflows in production-like environments and how to troubleshoot common failures without violating ADR-frozen rules.

## Status Terminology (Important)

- Settlement apply results in `POSTED` status in runtime/API rows.
- Reversal remains `REVERSED` and is additive (original row is preserved and linked).
- Open-item report status filters use `OPEN | PARTIALLY_SETTLED | SETTLED | ALL`.

## Counterparty Role Model (Important)

- Counterparty role source of truth is dual booleans: `is_customer`, `is_vendor`.
- At least one role flag must be true.
- Any `counterpartyType` field in responses is derived from booleans (`CUSTOMER`, `VENDOR`, `BOTH`) for compatibility.

## Line-Based Documents and Legacy Compatibility

- New CARI documents may carry explicit `cari_document_lines` and `cari_document_line_taxes`.
- Header totals are derived snapshots from lines:
  - subtotal/net
  - tax total
  - gross total
- Legacy callers that do not send `lines[]` still work through the synthetic single-line compatibility path.
- Operational meaning:
  - old one-line invoice flows remain valid
  - new mixed-line invoices should use explicit lines for tax and stock behavior
- Legacy posted history is not backfilled destructively into fake commercial lines.
- If a support incident involves an older document that behaves like a one-line document, treat that as expected compatibility behavior, not data corruption.

## Mixed-Tax and Item-Card Defaults

- Mixed-tax invoices are line-based:
  - each commercial line resolves its own tax outcome
  - header totals are the aggregate of all line tax results
- Practical operator rule:
  - do not expect one invoice-level tax rate to cover every line
  - review line tax preview before post when different tax categories are mixed
- Item-card selection may auto-default:
  - posting account
  - tax category
  - stock impact mode
- If a line posts to an unexpected account, check in this order:
  - selected item card
  - line-level posting account override
  - fallback CARI purpose mappings
- If a line tax looks wrong, check in this order:
  - line `taxCategoryCode`
  - tax-rule match conditions
  - active tax regime/code/rule and mapping setup

## Inventory and Item-Card Permissions

- Inventory and item-card pages no longer inherit CARI-card access implicitly.
- Dedicated permissions are:
  - `item.card.read`
  - `item.card.upsert`
  - `inventory.read`
  - `inventory.upsert`
- Operational rule:
  - grant item-card maintenance separately from CARI counterparty maintenance
  - grant inventory read/upsert separately from item-card maintenance when warehouse operators do not maintain item masters
- Existing tenants need permission backfill after code rollout:
  - `cd backend && npm run db:seed:core`

## Stock Item and Inventory Handoff

- `STOCK_ITEM` lines still begin in CARI, but sell-side costing is now finalized in inventory materialization.
- Current operational handshake:
  - AP stock purchase line -> inventory asset posting + `RECEIPT_PENDING`
  - AR stock sale line -> revenue posting + `ISSUE_PENDING`
- Pending stock rows are materialized in:
  - `/app/stok-yansitma-islemleri`
- Expected workflow:
  1. post the CARI document
  2. verify pending stock-link row exists
  3. create/select warehouse
  4. materialize stock link into inventory movement
  5. verify receipt cost layer for inbound stock
  6. for AR issue, verify FIFO layer consumption and `COGS` journal link
- Current valuation meaning:
  - `RECEIPT` -> `VALUED`
  - `ISSUE` -> `VALUED` when stock is available and FIFO consumption succeeds
- Troubleshooting checks:
  - verify item card type is really `STOCK_ITEM`
  - verify pending link status is `PENDING` before materialization
  - verify warehouse is `ACTIVE`
  - verify source stock link flips to `LINKED` after movement create

## Issue Valuation and COGS Posting Lifecycle

- Outbound `ISSUE` materialization validates available stock before finalizing.
- Current valuation method is `FIFO`.
- Inventory service consumes open receipt layers and stores explicit issue-consumption rows.
- A successful valued issue creates one inventory-side journal:
  - `Dr COGS`
  - `Cr Inventory`
- Revenue remains in CARI posting; inventory relief remains in inventory valuation.
- Replay rule:
  - if the same stock link is materialized again after it is already `LINKED`, inventory returns the existing movement
  - if the issue journal already exists, the same journal is reused instead of double-posting
- If issue materialization fails:
  - verify there is enough remaining stock in open receipt layers
  - verify item card has `inventoryAssetAccountId`
  - verify item card has `defaultCogsAccountId` or approved fallback
  - verify the fiscal period for `movementDate` is `OPEN`

## Inventory Unwind Order Before CARI Reverse

- Posted CARI reverse now runs an inventory preflight before any additive reverse rows are created.
- If a linked live `ISSUE` or `RECEIPT` movement still exists, document reverse is blocked with the blocking inventory movement ids.
- Required unwind order:
  1. open `/app/stok-yansitma-islemleri`
  2. reverse the linked valued `ISSUE` first when outbound stock effect is still active
  3. if the commercial line still needs stock impact after correction, rematerialize the reopened successor pending stock link
  4. undo the linked materialized `RECEIPT` only when no later issue chronology still depends on that receipt layer history
  5. retry CARI reverse only after the blocking inventory movement is no longer active
- Practical rule:
  - do not reverse the CARI document first and expect inventory to catch up later
  - do not bypass the blocker by deleting stock-link or movement evidence
- If receipt undo is blocked by later issue consumption, clean up the dependent issue chronology first, then retry the receipt undo.

## Unapplied Cash Handling

- Unapplied cash is created when settlement incoming amount exceeds allocated amount.
- Unapplied balances are consumed by later settlement applies when `useUnappliedCash=true`.
- Consumption is as-of sensitive in reports; only effects with effective date `<= asOfDate` are included.
- Unapplied rows are never silently netted away in reports unless a report rule explicitly says so.
- Key checks:
  - Verify `cari_unapplied_cash.residual_amount_txn` and `residual_amount_base`.
  - Review settlement apply audit payload (`unappliedConsumed`, `createdUnappliedCashId`).
  - Confirm reversal effects are additive and traceable via linked settlement rows.

## FX Override Policy

FX resolution baseline (exact + prior-date fallback):

- FX override remains controlled by explicit permission (`cari.fx.override`).
- Settlement FX resolution order is deterministic:
  - request `fxRate` (if supplied)
  - exact-date SPOT rate
  - optional nearest-prior SPOT fallback (`PRIOR_DATE`) when enabled
- Fallback controls:
  - default mode can be set by `CARI_SETTLEMENT_FX_FALLBACK_MODE` (`EXACT_ONLY` or `PRIOR_DATE`)
  - max search depth can be set by `CARI_SETTLEMENT_FX_FALLBACK_MAX_DAYS`
  - request-level overrides are supported via `fxFallbackMode` and `fxFallbackMaxDays`
- If neither exact-date nor allowed prior-date rate is available and `fxRate` is not provided, apply must fail with explicit error.
- Operational actions:
  - Validate the expected currency pair rate chain (exact date + prior window) before batch apply windows.
  - Confirm audit/journal evidence captures fallback/override context when used.

## Evidence Storage Config (UX20/UX21)

- CARI evidence binary files are stored on backend local filesystem.
- Configure base path with `EVIDENCE_STORAGE_ROOT`.
  - Absolute path: used as-is.
  - Relative path: resolved from `backend/` root.
- Default when unset: `backend/storage/evidence`.
- Upload size limit is controlled by `EVIDENCE_MAX_UPLOAD_BYTES` (default: `15728640`, 15 MB).
- Compression mode is controlled by `EVIDENCE_STORAGE_COMPRESSION`:
  - `AUTO` (default): gzip only when stored file becomes smaller
  - `GZIP`: always gzip at storage time
  - `NONE`: store raw file bytes
- Downloads always return original file bytes (compressed storage is transparently decompressed).
- Risk-action evidence policy is controlled by:
  - `EVIDENCE_POLICY_MODE=OFF|RISKY|ALWAYS`
  - `EVIDENCE_POLICY_RISKY_POST_AMOUNT_BASE_MIN` (optional threshold rule in `RISKY` mode)
- In `RISKY` mode, evidence is required for:
  - CARI document reverse actions
  - CARI document post actions with FX override
  - CARI document post actions above configured base-amount threshold (if set)

## Reversal Effects on Statements and Aging

- Reversal is additive history, not destructive mutation.
- Document reversal impacts statement status and as-of inclusion based on reversal effective date.
- Settlement reversal re-opens impacted residuals as-of the reversal date and deactivates reversed allocations as-of.
- Aging and open-items outputs must change when `asOfDate` crosses reversal dates.
- Operator verification steps:
  - Compare `asOfDate` before/after reversal date.
  - Confirm statement shows reversal links (`reversalOf*`, `reversedBy*`).
  - Confirm residual totals reconcile between document/open-item views.

## Bank-Link Meaning in Cari v1

- Bank-link fields are integration hooks before full bank module rollout.
- `bank_statement_line_id` and `bank_transaction_ref` indicate external bank linkage context.
- `bank_attach_idempotency_key` and `bank_apply_idempotency_key` protect against duplicate bank-triggered requests.
- Bank-linked flows follow the same accounting and idempotency rules as manual apply.

## Source-Aware Settlement Posting Context

- Settlement posting derives context from source linkage and intent:
  - `CASH_LINKED`
  - `MANUAL`
  - `ON_ACCOUNT_APPLY`
- The context influences posting derivation while preserving generic mapping fallback for compatibility.
- Practical checks:
  - verify linked-cash settlements carry cash references (`cash_transaction_id`, link metadata)
  - verify manual flows remain cash-agnostic
  - verify on-account consumption leaves a traceable unapplied-cash history

## Cash Register Ownership Context

- Cash-linked settlement selectors must show register ownership explicitly as `Central` or `OU: <code>`.
- `Central` remains a central/no-OU posting context; do not use a blank operating-unit selector as the operator-facing signal for central ownership.
- If cash needs to move between different operating-unit contexts, use the transit workflow with `CASH_IN_TRANSIT` instead of a direct transfer.
- Posting completion for different-context transfers depends on the right current-account setup:
  - `Central Due From OU` + `OU Due To Central` for `Central <-> OU`
  - partner-specific `Due From Partner OU` + `Due To Partner OU` mappings for `OU <-> OU`
- `Kasa Islemleri` can now run saved-config repair during `Transfer Out` using the saved current-account config:
  - `Center / Branch Current Accounts` card for `Central <-> OU`
  - `Branch Pair Current Accounts` card for `OU <-> OU`
- Legacy parent-pick auto-provision endpoints were removed after the app-reset cleanup so operators use one canonical saved-config apply path instead of two competing provisioning models.
- `Organization Management` remains the canonical setup screen for reviewing and editing those mappings outside the transfer flow.
- `Cash Transit Transfers` still expects that setup to already exist; if receive/post fails there, return to `Kasa Islemleri` `Transfer Out` to run the saved current-account config repair or use `Organization Management`.

### Current-account setup troubleshooting

- `Saved config missing`: the legal entity still has no saved OU current-account parent selection. Save the config in `Organization Management` before retrying the transfer or settlement.
- `Saved config exists but apply not run`: parents were saved, but the provisioning apply has not completed yet. Run `Repair missing only` or finish the bootstrap apply step.
- `Saved config exists but mapping drift remains`: some central OU fields or partner-OU directions are still missing. Start with `Repair missing only`; keep manual Organization Management edit only for exception mappings that should not be reset to the shared saved-config pattern.

## Operational Troubleshooting

### Audit visibility endpoint

- Use `GET /api/v1/cari/audit` for support/finance investigation of Cari actions.
- Scope filters: `legalEntityId`, `action`, `resourceType`, `resourceId`, `actorUserId`, `requestId`.
- Time filters: `createdFrom`, `createdTo`.
- Paging/payload controls: `limit`, `offset`, `includePayload`.
- Endpoint is tenant-safe and legal-entity scope-safe via `cari.audit.read`.

### Permission and scope failures (401/403)

- Confirm user has required permission (`cari.*`) and legal-entity scope.
- For scoped users, verify access with and without `legalEntityId` filter.

### Posting/apply blocked by policy or data

- Check fiscal period status and posting preconditions.
- Verify document/open-item statuses are valid for attempted transition.
- Ensure required mappings exist for posting and realized FX entries.
- If line-tax posting fails:
  - verify tax feature flag state
  - verify an active tax regime exists for the legal entity/date
  - verify line tax match criteria (`taxCategoryCode`, `lineKind`) and tax account mappings

### Legacy document behaves like one-line compatibility flow

- Confirm whether the document was created without explicit `lines[]`.
- A single stored/synthetic line is valid rollout behavior for legacy callers.
- Support checks:
  - verify document totals still reconcile to journal/open item
  - verify there is no unintended multi-line expectation on that specific document
  - do not force manual backfill just to make history look like post-rollout documents

### Stock-link materialization issues

- If `/app/stok-yansitma-islemleri` shows no pending rows:
  - verify the CARI line is a `STOCK_ITEM`
  - verify the posted line carried `RECEIPT_PENDING` or `ISSUE_PENDING`
  - verify the source document is actually `POSTED`
- If movement create fails:
  - verify warehouse/legal-entity match
  - verify stock link is still `PENDING`
  - verify the source item card is still `ACTIVE` and `STOCK_ITEM`
- If receipt has no cost layer:
  - verify the source stock link was `RECEIPT_PENDING`
  - verify movement status is `VALUED`
  - verify movement quantity/cost fields were populated
- If issue stays unvalued or no `COGS` journal appears:
  - verify receipt cost layers exist and still have remaining quantity
  - verify item card `inventoryAssetAccountId` and `defaultCogsAccountId`
  - verify movement detail exposes `postedJournalEntryId` / `postedJournalNo`
  - verify replay did not already create the journal on a prior run

### Idempotency and duplicate-click incidents

- Reuse the same idempotency key to safely replay and inspect prior result.
- Different idempotency keys represent distinct operations and can legitimately fail/succeed independently.

### Reversal failures

- Confirm original row is in reversible state and not already reversed.
- Validate dependent balances were not progressed beyond reversible boundary.
- If document reverse is blocked by inventory:
  - use the blocking inventory movement ids shown in `/app/cari-belgeler`
  - complete the required unwind order in `/app/stok-yansitma-islemleri`
  - retry document reverse only after the linked inventory effect is no longer active

### Reporting mismatches

- Re-run with same `asOfDate`, then with date before/after key events (settle/reverse).
- Check report filters (`role`, `status`, `direction`, `legalEntityId`, `counterpartyId`).
- Use `EXPLAIN` checks to confirm expected indexes are still used on key report query shapes.

### Counterparty payment-term dropdown is empty

- `POST /api/v1/onboarding/company-bootstrap` now auto-seeds default payment terms for each onboarded legal entity.
- `POST /api/v1/org/legal-entities` now also seeds payment terms when `autoProvisionDefaults=true`.
- `POST /api/v1/org/legal-entities` can accept custom `paymentTerms` definitions to seed legal-entity-specific terms at creation time.
- If `POST /api/v1/org/legal-entities` is called with `autoProvisionDefaults=false` and without `paymentTerms`, no terms are seeded for that entity.
- Cari counterparty forms read payment terms from `GET /api/v1/cari/payment-terms` filtered by legal entity.
- If no terms exist for the tenant/legal-entity pair, bootstrap defaults with:
  - `POST /api/v1/onboarding/payment-terms/bootstrap`
- This endpoint is idempotent; reruns only insert missing terms.
- To seed one legal entity or custom terms, pass `legalEntityId`/`legalEntityIds` and `terms` in the request body.

### Audit verification

- Verify audit rows for critical actions:
  - `cari.document.post`
  - `cari.document.reverse`
  - `cari.settlement.apply`
  - `cari.settlement.reverse`

## Manual Smoke Checklist

1. Create a counterparty in an allowed legal entity.
2. Create a draft Cari document.
3. Post the document and verify posting snapshots.
4. Apply a partial settlement.
5. Reverse the settlement.
6. Reverse the posted document.
7. Run AR/AP aging, open-items, and statement reports with explicit `asOfDate`.
8. Verify audit logs for post/apply/reverse actions.
9. Validate idempotency replay behavior for one apply request.
10. Confirm bank-link fields display where available.
11. Run one `paymentChannel=CASH` apply and verify linked cash references are present.
12. Validate settlement reverse guard when linked cash transaction is still `POSTED`.
13. Validate FX fallback behavior:
  - `EXACT_ONLY` missing rate -> explicit failure
  - `PRIOR_DATE` with available prior rate -> success
14. Create one synthetic one-line document without explicit `lines[]` and verify it still posts.
15. Create one mixed-line invoice with at least two tax outcomes and verify header total = line total aggregate.
16. Create one `STOCK_ITEM` AP line and one `STOCK_ITEM` AR line, then materialize both in `/app/stok-yansitma-islemleri`.
17. Verify the outbound issue becomes `VALUED`, stores FIFO layer consumption, and links one `COGS` journal.
18. Rerun the same outbound stock-link materialization and verify the existing movement/journal is reused.
19. Attempt CARI reverse while one linked valued `ISSUE` is still active and verify reverse is blocked with inventory movement detail.
20. Reverse that valued issue and verify one reopened successor pending stock link is created.
21. Rematerialize from the reopened successor stock link and verify the new movement/journal are linked to the successor.
22. Attempt CARI reverse while one linked valued `RECEIPT` is still active and verify reverse is blocked until receipt undo is completed.
23. Undo one fully available receipt materialization, then retry the CARI reverse and verify the blocker clears.

## UI Route Coverage (PR-11..14)

- `/app/cari-belgeler`: document lifecycle operations (draft, post, reverse) with document-level permissions.
- `/app/cari-settlements`: settlement and bank-link workbench (route open is any-of; actions are permission-gated per panel).
- `/app/cari-audit`: support/finance investigation view over `GET /api/v1/cari/audit`.

## Operator Flow Summary

- Document lifecycle:
  - Create/update/cancel only in `DRAFT`.
  - Post only in `DRAFT`.
  - Reverse only from posted lifecycle states per backend guards.
- Settlement lifecycle:
  - Apply requires idempotency key and allocation rule compliance (`autoAllocate` vs `allocations`).
  - `paymentChannel=CASH` allows linking existing cash txn (`cashTransactionId`) or creating one (`linkedCashTransaction`).
  - Reverse uses `POST /api/v1/cari/settlements/{settlementBatchId}/reverse`.
  - Reverse is blocked when linked cash txn is still posted; reverse cash first.
- Replay and idempotency:
  - `idempotentReplay=true` must be treated as safe replay of an already-applied request.
  - `followUpRisks` is an operational warning input, not a silent ignore field.
- Bank-link meaning:
  - Bank attach/apply actions are explicit, separate from settlement apply.
  - Bank flows keep their own idempotency keys and target validation rules.
- FX override:
  - Only permitted for users with `cari.fx.override`.
  - Override/fallback behavior must be reviewable (`EXACT_ONLY` vs `PRIOR_DATE`, optional max-day bound).
- Line-model rollout:
  - explicit lines are preferred for new commercial documents
  - synthetic one-line compatibility remains supported for old callers
  - stock-item lines require the inventory handoff step when quantity movement should be tracked

For day-to-day support and finance execution details, use:
- `docs/runbooks/cari-v1-support-finance-ui-guide.md`
- `docs/runbooks/ou-self-balancing-transfers-and-settlements.md` for owner-vs-collector cross-context settlement and `/app/stok-transferleri` transfer rollout guidance

## Recommended Commands

- Backend release gate:
  - `cd backend && npm run test:release-gate`
  - Core-only (skip contracts/revenue module extension): `cd backend && RELEASE_GATE_SKIP_CONTRACTS_REVENUE=1 npm run test:release-gate`
- Cari focused quality gate:
  - `cd backend && npm run test:cari-quality-gate`
- OpenAPI/docs validation:
  - `cd backend && npm run test:cari-pr10`
