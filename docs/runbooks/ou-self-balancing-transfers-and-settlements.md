# OU Self-Balancing Inventory Transfers and Cross-Context Settlements

This runbook covers OU-owned warehouse setup, cross-context inventory transfer lifecycle, settlement owner-vs-collector behavior, and the release-gate checks for the OU self-balancing rollout.

## Warehouse Ownership Setup

- Use `/app/ayarlar/organizasyon-yonetimi` to keep operating-unit current-account mappings complete before go-live.
- Use `/app/stok-transferleri` only for warehouse pairs that belong to different ownership contexts.
- Each warehouse must declare one explicit ownership scope:
  - `CENTRAL`
  - `OPERATING_UNIT`
- `OPERATING_UNIT` warehouses must carry an `operatingUnitId`.
- OpenAPI and setup payloads now expose both reverse-direction org fields:
  - `central_due_to_account_id`
  - `ou_due_from_central_account_id`

## Transfer Approval Requirement

- Transfer status flow is strict: `INITIATED -> APPROVED -> IN_TRANSIT -> RECEIVED`.
- Shipment must not start from `INITIATED`.
- Operators should read the transfer page action state before attempting shipment or receipt.
- `CANCELED` is only valid before shipment artifacts exist.
- `REVERSED` is additive and keeps the original shipment/receipt lineage visible.

## Item Transit Account Requirement

- Every shipped stock item in this flow must have `inventoryTransitAccountId` on the item card.
- Missing `inventoryTransitAccountId` blocks shipment.
- Reuse the same transit account for shipment and receipt clearing on the transfer workflow.

## Missing OU Current-Account Mapping Failures

- Cross-context shipment and cross-context collection both require complete OU self-balancing mappings.
- If the legal entity or OU setup is incomplete, stop and fix organization setup first.
- Typical failure areas:
  - missing `central_due_from_account_id` / `ou_due_to_central_account_id`
  - missing `central_due_to_account_id` / `ou_due_from_central_account_id`
  - missing partner OU current-account pair for source/target operating units

## Saved Current-Account Automation

- Choose parent control accounts once per legal entity in `Organization Management`.
- The system creates or reuses branch-specific children automatically for both `CENTRAL <-> OU` and `OU <-> OU` mappings.
- When a later branch is added, only delta is created.
- Old branches are not reset during later branch add automation.
- `Repair missing only` is the default saved-config rerun path.
- Manual Organization Management edit remains available for exceptions.

## Transfer Lifecycle Runbook

1. Create the transfer in `/app/stok-transferleri`.
2. Approve the transfer.
3. Ship the transfer.
4. Receive the transfer.
5. Reverse only when posted shipment and receipt lineage is complete and reversal is the intended additive correction.

Approve -> Ship -> Receive is the expected happy path.

- Same-context warehouse movement should stay outside this transfer workflow.
- Cross-context stock movement must use inventory transfer workflow.
- The transfer page should be treated as the audit trail for warehouse ownership, journals, evidence, and line-level shipment/receipt quantities.

## Accounting Examples

### Shipment

- Same context:
  - inventory leaves source warehouse through normal issue valuation
  - no OU self-balancing lines are added
- Cross context:
  - source inventory is credited
  - transit is debited/credited as required by the item transit account design
  - OU internal current accounts self-balance immediately at shipment time

### Receipt

- Receipt clears transit into destination inventory.
- Receipt journal stays in the destination ownership context.

### Reversal

- Reverse shipment/receipt journals additively.
- Do not delete historical movements or historical journals.
- Reversal should preserve audit visibility for shipment journal no, receipt journal no, and reversal journal no.

## Cross-Context Settlement Examples

- In `/app/cari-settlements`, the receivable/payable owner can differ from the cash/bank collector.
- `ownerOperatingUnitId` is the document/open-item owner context.
- `collectorOperatingUnitId` is the cash/bank collection context.
- `originatingCrossContextSettlementBatchId` links downstream settlement activity back to the original cross-context collector event.
- Same-context settlement:
  - owner and collector are the same context
  - no internal current-account split is added
- Cross-context settlement:
  - owner and collector differ
  - self-balancing current-account lines are posted immediately
  - reversal must respect downstream linkage discipline

## Cross-Context Cash and Bank Movements

- In `/app/kasa-islemleri`, `DEPOSIT_TO_BANK` and `WITHDRAWAL_FROM_BANK` now follow the same context rule as other OU self-balancing flows.
- The bank-side context is resolved from the selected bank account ownership:
  - central bank account -> `no OU`
  - OU-owned bank account -> that exact operating unit
- Same-context bank/cash movement stays on the normal 2-line asset movement.
- Different-context bank/cash movement posts immediate self-balancing lines:
  - `CENTRAL <-> OPERATING_UNIT`
  - `OPERATING_UNIT <-> OPERATING_UNIT`
- Missing current-account setup blocks posting and operators should repair the saved config from `Organization Management` or the surviving `Kasa Islemleri` repair path before retrying.

## Current-Account Automation Troubleshooting

- `Saved config missing`: no legal-entity current-account parent config has been saved yet. Go to `Organization Management`, choose the two parent control accounts, and save the config.
- `Saved config exists but apply not run`: the legal entity has saved parents but provisioning has not completed yet. Run `Repair missing only` or finish the onboarding apply step.
- `Saved config exists but mapping drift remains`: the config is saved, but one or more OU central fields or OU-pair directions are still missing. Use `Repair missing only` first, then use manual Organization Management edit only for exception rows that should stay outside the shared saved-config pattern.

## Troubleshooting: Blocked Generic Cross-Context Stock Movement

- If generic stock materialization fails with `Cross-context stock movement must use inventory transfer workflow`, do not bypass it.
- Move the scenario into `/app/stok-transferleri`.
- Verify:
  - warehouse ownership scope on both warehouses
  - item card has `inventoryTransitAccountId`
  - OU self-balancing mappings are complete
  - transfer is approved before shipment

## Scope Boundary

- A first-class cross-context collection document is still future scope.
- Current release scope is:
  - OU-aware warehouse ownership
  - explicit transfer workflow
  - settlement owner vs collector context
  - self-balancing accounting and reversal discipline

## Verification

- `cd backend && npm run test:ou:self-balancing:release-gate`
- `cd backend && npm run test:ou:current-account-automation:release-gate`
- `cd backend && npm run openapi:generate`
- `cd backend && npm run check:openapi`
