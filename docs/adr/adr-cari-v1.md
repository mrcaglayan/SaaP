# ADR: Cari (AR/AP) v1 Scope Lock

- Status: Accepted
- Date: 2026-02-23
- Decision owner: Core ERP team
- Applies to: Cari v1 implementation (PR-01 through PR-10)

## Context

This ADR freezes Cari (AR/AP) v1 accounting and lifecycle rules before deeper API and workflow implementation.  
Goal: avoid re-deciding core rules during PR-01..PR-10 and keep schema/API/UI behavior consistent.

## Decisions (Frozen)

### 1) Document numbering

- Numbering dimensions: `tenant + legal_entity + document_type + fiscal_year`.
- Number is assigned only on `POST` (never at draft creation).
- Draft documents do not consume final sequence numbers.
- Posted document numbers are immutable.

### 2) Settlement numbering

- Numbering dimensions: `tenant + legal_entity + sequence_namespace + fiscal_year`.
- Number is assigned only on settlement `APPLY`.
- Settlement namespace for v1 is fixed to: `SETTLEMENT`.
- Applied settlement numbers are immutable.

### 3) Status enums (v1 canonical)

- `cari_documents.status = DRAFT | POSTED | REVERSED | CANCELLED`
- `cari_open_items.status = OPEN | PARTIAL | SETTLED | REVERSED`
- `cari_settlement_batches.status = APPLIED | REVERSED`

### 4) Reversal and cancel boundaries

- `CANCEL` is draft-only.
- `REVERSE` is posted/applied-only.
- No destructive edits for posted/applied records.
- Reversal is additive/accounting-safe (history is preserved, not overwritten).

### 5) Mandatory linkage fields

- Documents:
  - `cari_documents.posted_journal_entry_id`
  - `cari_documents.reversal_of_document_id`
- Settlements:
  - `cari_settlement_batches.posted_journal_entry_id`
  - `cari_settlement_batches.reversal_of_settlement_batch_id`

### 6) Counterparty scope model

- Counterparty master is legal-entity scoped.
- Same `code` may exist in different legal entities under same tenant, but not duplicated within same `(tenant_id, legal_entity_id)`.
- All Cari document and settlement operations must validate legal-entity ownership/scope.

### 7) Snapshot policy on documents

- On `POST`, immutable snapshots are captured on document rows.
- Snapshot fields include (at minimum):
  - counterparty code/name
  - payment term snapshot
  - due date snapshot
  - currency/fx snapshot
- Reports and historical statements must use snapshot-safe values so later master-data changes do not rewrite history.

### 8) Realized FX account source

- Realized FX gain/loss account mapping source is `journal_purpose_accounts`.
- Settlement-time FX realization must resolve accounts from this source (no hardcoded account IDs in service logic).

### 9) Concurrency and idempotency policy (settlement apply)

- Settlement apply must be idempotent by idempotency key.
- Duplicate requests with same idempotency key must not create duplicate accounting effects.
- Apply logic must execute transactionally with row-level locking on targeted open items/unapplied balances.
- Lock order must be deterministic (stable ordering, e.g., by ascending ID) to reduce deadlock risk.
- Over-allocation under concurrent requests is not allowed.

### 10) Bank-ready scope (v1)

- v1 includes bank-link hooks only (attach/apply compatibility fields and contracts).
- v1 does not include full bank reconciliation lifecycle.
- Bank-linked apply must follow the same accounting rules as manual apply.

### 11) As-of/report semantics

- Aging/statement as-of processing uses a report `as_of_date` cutoff.
- Aging bucket basis is open-item `due_date`.
- Statement timeline basis is document `document_date` and settlement/apply effective date.
- Inclusion rule: include only effects with effective date `<= as_of_date`.
- Displayed residual/open balances must reflect reversals and applies up to `as_of_date`.
- Snapshot values drive historical display labels in statements/reports.

## Out of Scope (v1)

- Dunning/collections workflows
- Credit insurance workflows
- Full bank reconciliation module
- E-invoice and tax-engine extras beyond core posting/settlement needs

## Implementation guardrails

- PR-01..PR-10 must conform to this ADR.
- Any deviation requires explicit ADR amendment before code change.
- No PR may silently alter these lifecycle, numbering, or status rules.
