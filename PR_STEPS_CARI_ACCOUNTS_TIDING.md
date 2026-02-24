## 12) PR-19: Counterparty AR/AP Account Mapping + Posting Resolution

### Goal

Introduce optional per-counterparty AR/AP account mapping for Cari flows without breaking existing behavior.

### Why this PR

Today, Cari posting resolves accounts from `journal_purpose_accounts` (`CARI_AR_CONTROL` / `CARI_AP_CONTROL` + offsets).
PR-19 adds counterparty-level overrides (`arAccountId` / `apAccountId`) with strict scope validation.

### Scope

- Add `ar_account_id` / `ap_account_id` to `counterparties`.
- Extend existing counterparty APIs to read/write these fields.
- Update document/settlement posting account resolution:
  - use counterparty mapped control account when present
  - fallback to existing purpose-account mapping when absent
- Keep offsets (`CARI_AR_OFFSET`, `CARI_AP_OFFSET`) unchanged.
- Preserve backward compatibility for existing tenants/cards.

### Files to create

- `backend/src/migrations/m022_counterparty_account_mapping.js`
- `backend/scripts/test-cari-pr19-counterparty-account-mapping-and-posting-resolution.js`
- `backend/scripts/test-cari-pr19-frontend-counterparty-account-fields-smoke.js` (optional but recommended)

### Files to update

- `backend/src/migrations/index.js`
- `backend/src/routes/cari.counterparty.validators.js`
- `backend/src/services/cari.counterparty.service.js`
- `backend/src/services/cari.document.service.js`
- `backend/src/services/cari.settlement.service.js`
- `backend/scripts/generate-openapi.js`
- `backend/package.json`
- `frontend/src/pages/cari/counterpartyFormUtils.js`
- `frontend/src/pages/cari/CariCounterpartyPage.jsx`
- `frontend/src/i18n/messages.js`

### Migration skeleton (`m022_counterparty_account_mapping.js`)

```js
const migration022CounterpartyAccountMapping = {
  key: "m022_counterparty_account_mapping",
  description: "Add per-counterparty AR/AP account mapping",
  async up(connection) {
    await connection.execute(`
      ALTER TABLE counterparties
      ADD COLUMN ar_account_id BIGINT UNSIGNED NULL AFTER default_payment_term_id
    `).catch(ignoreDuplicateColumn);

    await connection.execute(`
      ALTER TABLE counterparties
      ADD COLUMN ap_account_id BIGINT UNSIGNED NULL AFTER ar_account_id
    `).catch(ignoreDuplicateColumn);

    await connection.execute(`
      ALTER TABLE counterparties
      ADD KEY ix_counterparties_ar_account (ar_account_id)
    `).catch(ignoreDuplicateKey);

    await connection.execute(`
      ALTER TABLE counterparties
      ADD KEY ix_counterparties_ap_account (ap_account_id)
    `).catch(ignoreDuplicateKey);

    await connection.execute(`
      ALTER TABLE counterparties
      ADD CONSTRAINT fk_counterparties_ar_account
      FOREIGN KEY (ar_account_id) REFERENCES accounts(id)
    `).catch(ignoreDuplicateFk);

    await connection.execute(`
      ALTER TABLE counterparties
      ADD CONSTRAINT fk_counterparties_ap_account
      FOREIGN KEY (ap_account_id) REFERENCES accounts(id)
    `).catch(ignoreDuplicateFk);
  },
};

export default migration022CounterpartyAccountMapping;

Note:

If m022 is already used on your branch, bump migration number accordingly.
API contract updates (existing endpoints)
POST /api/v1/cari/counterparties
PUT /api/v1/cari/counterparties/{id}
GET /api/v1/cari/counterparties
GET /api/v1/cari/counterparties/{id}
New/extended fields:

arAccountId (optional)
apAccountId (optional)
response enrichment (optional but recommended):
arAccountCode, arAccountName
apAccountCode, apAccountName
Domain correctness lock (mandatory)
Account scope safety:
mapped account must belong to same tenant_id
mapped account must belong to same legal_entity_id (via account -> coa -> legal_entity)
Posting suitability:
account must be active and postable (is_active=true, allow_posting=true)
Type compatibility:
arAccountId must be ASSET
apAccountId must be LIABILITY
Role compatibility:
if isCustomer=false, reject arAccountId
if isVendor=false, reject apAccountId
Backward compatibility:
mappings are optional (nullable)
if missing, existing purpose-account path remains default
No change in offset resolution:
still from journal_purpose_accounts (CARI_AR_OFFSET / CARI_AP_OFFSET)
Posting resolution policy (explicit)
For AR document/settlement:

if counterparty has arAccountId, use it as control account
otherwise use CARI_AR_CONTROL
offset stays CARI_AR_OFFSET
For AP document/settlement:

if counterparty has apAccountId, use it as control account
otherwise use CARI_AP_CONTROL
offset stays CARI_AP_OFFSET

Tests (minimum)
Create CUSTOMER with valid arAccountId in same tenant/entity -> success.
Create VENDOR with valid apAccountId in same tenant/entity -> success.
Reject cross-tenant or cross-entity account mapping.
Reject wrong account types (ar not ASSET / ap not LIABILITY).
Reject non-postable or inactive account mapping.
Posting with mapped account uses mapped control account.
Posting without mapping falls back to journal_purpose_accounts.
Existing Cari PR-05/06/07/08 tests remain green.
Acceptance
Per-counterparty AR/AP mapping works and is optional.
Existing behavior remains unchanged when mappings are empty.
Posting safely resolves mapped control accounts where present.
Strict tenant/legal-entity/type validations prevent account leakage.
No regression in existing Cari document/settlement flows.
Commands
cd backend
npm run test:cari-pr19
npm run test:cari-pr05
npm run test:cari-pr06
npm run test:cari-pr07
npm run test:cari-pr08