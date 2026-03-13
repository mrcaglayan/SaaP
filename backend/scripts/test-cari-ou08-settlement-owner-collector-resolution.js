import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  applyCariSettlement,
  reverseCariSettlementById,
} from "../src/services/cari.settlement.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertThrowsAsync(fn, expectedMessage) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `Expected async error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected async error containing "${expectedMessage}", got "${message}"`
  );
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueToken(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function buildReq(tenantId, userId) {
  return {
    user: {
      tenantId,
      userId,
    },
    headers: {},
  };
}

function assertScopeAccess() {
  return undefined;
}

async function createTenantAndUser() {
  await seedCore({
    ensureDefaultTenantIfMissing: true,
  });

  const tenantCode = uniqueToken("CARI_OU08_TENANT_").slice(0, 50);
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `${tenantCode} Name`]
  );
  const tenantResult = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantResult.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create OU08 tenant");

  const email = `${tenantCode.toLowerCase()}@example.com`;
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, '!', ?, 'ACTIVE')`,
    [tenantId, email, "OU08 Settlement User"]
  );
  const userResult = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toNumber(userResult.rows?.[0]?.id);
  assert(userId > 0, "Failed to create OU08 user");

  return { tenantId, userId, stamp: Date.now() };
}

async function createOrgFixtures({ tenantId, userId, stamp }) {
  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'US'
     LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  const currencyCode = String(
    countryResult.rows?.[0]?.default_currency_code || "USD"
  )
    .trim()
    .toUpperCase();
  assert(countryId > 0, "US country row is required");

  const groupCode = `OU08GC${stamp}`;
  const legalEntityCode = `OU08LE${stamp}`;
  const calendarCode = `OU08CAL${stamp}`;
  const bookCode = `OU08BOOK${stamp}`;
  const coaCode = `OU08COA${stamp}`;

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, groupCode, `OU08 Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, groupCode]
  );
  const groupId = toNumber(groupResult.rows?.[0]?.id);
  assert(groupId > 0, "Failed to create OU08 group company");

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, groupId, legalEntityCode, `OU08 Legal Entity ${stamp}`, countryId, currencyCode]
  );
  const legalEntityResult = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityCode]
  );
  const legalEntityId = toNumber(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create OU08 legal entity");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     ) VALUES (?, ?, ?, 1, 1)`,
    [tenantId, calendarCode, `OU08 Calendar ${stamp}`]
  );
  const calendarResult = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, calendarCode]
  );
  const calendarId = toNumber(calendarResult.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create OU08 calendar");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
     ) VALUES (?, 2026, 3, '2026-P03', '2026-03-01', '2026-03-31', FALSE)
     ON DUPLICATE KEY UPDATE period_name = VALUES(period_name)`,
    [calendarId]
  );

  await query(
    `INSERT INTO books (
        tenant_id,
        legal_entity_id,
        calendar_id,
        code,
        name,
        book_type,
        base_currency_code
     ) VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
    [tenantId, legalEntityId, calendarId, bookCode, `OU08 Book ${stamp}`, currencyCode]
  );

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     ) VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, coaCode, `OU08 COA ${stamp}`]
  );
  const coaResult = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, coaCode]
  );
  const coaId = toNumber(coaResult.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create OU08 COA");

  const createAccount = async ({
    code,
    name,
    accountType = "ASSET",
    normalSide = "DEBIT",
  }) => {
    await query(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
       ) VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
      [coaId, code, name, accountType, normalSide]
    );
    const result = await query(
      `SELECT id
       FROM accounts
       WHERE coa_id = ?
         AND code = ?
       LIMIT 1`,
      [coaId, code]
    );
    const accountId = toNumber(result.rows?.[0]?.id);
    assert(accountId > 0, `Failed to create account ${code}`);
    return accountId;
  };

  const accountPrefix = `OU08${String(stamp).slice(-5)}`;
  const arControlAccountId = await createAccount({
    code: `${accountPrefix}01`,
    name: "OU08 AR Control",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const arOffsetAccountId = await createAccount({
    code: `${accountPrefix}02`,
    name: "OU08 AR Offset",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const bankGlAccountId = await createAccount({
    code: `${accountPrefix}03`,
    name: "OU08 Bank GL",
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const fxGainAccountId = await createAccount({
    code: `${accountPrefix}04`,
    name: "OU08 FX Gain",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  });
  const fxLossAccountId = await createAccount({
    code: `${accountPrefix}05`,
    name: "OU08 FX Loss",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  });

  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     ) VALUES
       (?, ?, 'CARI_AR_CONTROL', ?),
       (?, ?, 'CARI_AR_OFFSET', ?),
       (?, ?, 'CARI_SETTLEMENT_FX_GAIN', ?),
       (?, ?, 'CARI_SETTLEMENT_FX_LOSS', ?)
     ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
    [
      tenantId,
      legalEntityId,
      arControlAccountId,
      tenantId,
      legalEntityId,
      arOffsetAccountId,
      tenantId,
      legalEntityId,
      fxGainAccountId,
      tenantId,
      legalEntityId,
      fxLossAccountId,
    ]
  );

  const createOperatingUnit = async (code, name) => {
    await query(
      `INSERT INTO operating_units (
          tenant_id,
          legal_entity_id,
          code,
          name,
          unit_type,
          has_subledger,
          status
       ) VALUES (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE')`,
      [tenantId, legalEntityId, code, name]
    );
    const result = await query(
      `SELECT id
       FROM operating_units
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, legalEntityId, code]
    );
    const operatingUnitId = toNumber(result.rows?.[0]?.id);
    assert(operatingUnitId > 0, `Failed to create operating unit ${code}`);
    return operatingUnitId;
  };

  const ownerOperatingUnitId = await createOperatingUnit(
    `OU08OWN${String(stamp).slice(-4)}`,
    "OU08 Owner OU"
  );
  const collectorOperatingUnitId = await createOperatingUnit(
    `OU08COL${String(stamp).slice(-4)}`,
    "OU08 Collector OU"
  );

  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        status
     ) VALUES (?, ?, ?, ?, TRUE, FALSE, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, `OU08CP${stamp}`, `OU08 Counterparty ${stamp}`, currencyCode]
  );
  const counterpartyResult = await query(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `OU08CP${stamp}`]
  );
  const counterpartyId = toNumber(counterpartyResult.rows?.[0]?.id);
  assert(counterpartyId > 0, "Failed to create OU08 counterparty");

  const createDocumentAndOpenItem = async ({
    documentNo,
    openAmount,
    operatingUnitId,
    sequenceNo,
  }) => {
    await query(
      `INSERT INTO cari_documents (
          tenant_id,
          legal_entity_id,
          counterparty_id,
          direction,
          document_type,
          sequence_namespace,
          fiscal_year,
          sequence_no,
          document_no,
          status,
          document_date,
          due_date,
          amount_txn,
          amount_base,
          open_amount_txn,
          open_amount_base,
          currency_code,
          fx_rate,
          counterparty_code_snapshot,
          counterparty_name_snapshot,
          currency_code_snapshot,
          fx_rate_snapshot,
          operating_unit_id
       ) VALUES (?, ?, ?, 'AR', 'INVOICE', 'OU08DOC', 2026, ?, ?, 'DRAFT', '2026-03-13', '2026-03-20', ?, ?, ?, ?, ?, 1.0000000000, ?, ?, ?, 1.0000000000, ?)`,
      [
        tenantId,
        legalEntityId,
        counterpartyId,
        sequenceNo,
        documentNo,
        openAmount,
        openAmount,
        openAmount,
        openAmount,
        currencyCode,
        `OU08CP${stamp}`,
        `OU08 Counterparty ${stamp}`,
        currencyCode,
        operatingUnitId,
      ]
    );
    const documentResult = await query(
      `SELECT id
       FROM cari_documents
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND document_no = ?
       LIMIT 1`,
      [tenantId, legalEntityId, documentNo]
    );
    const documentId = toNumber(documentResult.rows?.[0]?.id);
    assert(documentId > 0, `Failed to create document ${documentNo}`);

    await query(
      `INSERT INTO cari_open_items (
          tenant_id,
          legal_entity_id,
          counterparty_id,
          document_id,
          item_no,
          status,
          document_date,
          due_date,
          original_amount_txn,
          original_amount_base,
          residual_amount_txn,
          residual_amount_base,
          settled_amount_txn,
          settled_amount_base,
          currency_code
       ) VALUES (?, ?, ?, ?, 1, 'OPEN', '2026-03-13', '2026-03-20', ?, ?, ?, ?, 0.000000, 0.000000, ?)`,
      [
        tenantId,
        legalEntityId,
        counterpartyId,
        documentId,
        openAmount,
        openAmount,
        openAmount,
        openAmount,
        currencyCode,
      ]
    );
    const openItemResult = await query(
      `SELECT id
       FROM cari_open_items
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND document_id = ?
       LIMIT 1`,
      [tenantId, legalEntityId, documentId]
    );
    const openItemId = toNumber(openItemResult.rows?.[0]?.id);
    assert(openItemId > 0, `Failed to create open item for ${documentNo}`);

    return { documentId, openItemId };
  };

  const ownerDocument = await createDocumentAndOpenItem({
    documentNo: `OU08-DOC-A-${stamp}`,
    openAmount: 30,
    operatingUnitId: ownerOperatingUnitId,
    sequenceNo: 1,
  });
  const mixedDocument = await createDocumentAndOpenItem({
    documentNo: `OU08-DOC-B-${stamp}`,
    openAmount: 20,
    operatingUnitId: collectorOperatingUnitId,
    sequenceNo: 2,
  });

  await query(
    `INSERT INTO bank_accounts (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        code,
        name,
        currency_code,
        gl_account_id,
        bank_name,
        branch_name,
        account_no,
        is_active,
        created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [
      tenantId,
      legalEntityId,
      collectorOperatingUnitId,
      `OU08BANK${stamp}`,
      `OU08 Bank ${stamp}`,
      currencyCode,
      bankGlAccountId,
      "OU08 Bank",
      "Collector Branch",
      `ACCT-${stamp}`,
      userId,
    ]
  );
  const bankAccountResult = await query(
    `SELECT id
     FROM bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `OU08BANK${stamp}`]
  );
  const bankAccountId = toNumber(bankAccountResult.rows?.[0]?.id);
  assert(bankAccountId > 0, "Failed to create OU08 bank account");

  await query(
    `INSERT INTO bank_statement_imports (
        tenant_id,
        legal_entity_id,
        bank_account_id,
        import_source,
        original_filename,
        file_checksum,
        status,
        line_count_total,
        line_count_inserted,
        line_count_duplicates,
        imported_by_user_id
     ) VALUES (?, ?, ?, 'MANUAL', ?, ?, 'IMPORTED', 1, 1, 0, ?)`,
    [tenantId, legalEntityId, bankAccountId, `ou08-${stamp}.csv`, uniqueToken("CHK"), userId]
  );
  const importResult = await query(
    `SELECT id
     FROM bank_statement_imports
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND bank_account_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, legalEntityId, bankAccountId]
  );
  const bankImportId = toNumber(importResult.rows?.[0]?.id);
  assert(bankImportId > 0, "Failed to create OU08 bank statement import");

  await query(
    `INSERT INTO bank_statement_lines (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        import_id,
        bank_account_id,
        line_no,
        txn_date,
        value_date,
        description,
        reference_no,
        amount,
        currency_code,
        balance_after,
        line_hash,
        recon_status
     ) VALUES (?, ?, ?, ?, ?, 1, '2026-03-13', '2026-03-13', ?, ?, 30.000000, ?, 30.000000, ?, 'UNMATCHED')`,
    [
      tenantId,
      legalEntityId,
      collectorOperatingUnitId,
      bankImportId,
      bankAccountId,
      "OU08 collector bank line",
      `OU08-BANK-REF-${stamp}`,
      currencyCode,
      uniqueToken("LINEHASH"),
    ]
  );
  const bankLineResult = await query(
    `SELECT id
     FROM bank_statement_lines
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND import_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, bankImportId]
  );
  const bankStatementLineId = toNumber(bankLineResult.rows?.[0]?.id);
  assert(bankStatementLineId > 0, "Failed to create OU08 bank statement line");

  return {
    tenantId,
    userId,
    legalEntityId,
    currencyCode,
    counterpartyId,
    ownerOperatingUnitId,
    collectorOperatingUnitId,
    ownerOpenItemId: ownerDocument.openItemId,
    mixedOpenItemId: mixedDocument.openItemId,
    bankStatementLineId,
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m128_cari_settlement_owner_collector_contexts.js"),
    "utf8"
  );
  const settlementServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cari.settlement.service.js"),
    "utf8"
  );
  const settlementsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariSettlementsPage.jsx"),
    "utf8"
  );

  assert(
    migrationSource.includes("owner_operating_unit_id") &&
      migrationSource.includes("collector_operating_unit_id") &&
      migrationSource.includes("originating_cross_context_settlement_batch_id") &&
      migrationSource.includes("fk_cari_settle_originating_cross_context_batch"),
    "Migration m128 should add owner/collector/originating settlement context columns plus FKs"
  );
  assert(
    migrationIndexSource.includes("migration128CariSettlementOwnerCollectorContexts"),
    "Migration index should register m128 settlement owner/collector contexts"
  );
  assert(
    settlementServiceSource.includes("resolveSettlementOwnerOperatingUnitId") &&
      settlementServiceSource.includes("resolveSettlementCollectorOperatingUnitId") &&
      settlementServiceSource.includes("ownerOperatingUnitId") &&
      settlementServiceSource.includes("collectorOperatingUnitId") &&
      settlementServiceSource.includes("originatingCrossContextSettlementBatchId"),
    "Settlement service should resolve and persist owner/collector operating-unit context"
  );
  assert(
    settlementsPageSource.includes("ownerOperatingUnitId") &&
      settlementsPageSource.includes("collectorOperatingUnitId"),
    "CariSettlementsPage should expose owner/collector operating-unit context"
  );

  const bootstrap = await createTenantAndUser();
  const fixture = await createOrgFixtures(bootstrap);
  const req = buildReq(fixture.tenantId, fixture.userId);

  await assertThrowsAsync(
    () =>
      applyCariSettlement({
        req,
        assertScopeAccess,
        payload: {
          tenantId: fixture.tenantId,
          legalEntityId: fixture.legalEntityId,
          counterpartyId: fixture.counterpartyId,
          currencyCode: fixture.currencyCode,
          settlementDate: "2026-03-13",
          incomingAmountTxn: 50,
          idempotencyKey: uniqueToken("OU08-MIXED-"),
          useUnappliedCash: false,
          allocations: [
            { openItemId: fixture.ownerOpenItemId, amountTxn: 30 },
            { openItemId: fixture.mixedOpenItemId, amountTxn: 20 },
          ],
          userId: fixture.userId,
        },
      }),
    "multiple owner operating units"
  );

  const applyResponse = await applyCariSettlement({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityId,
      counterpartyId: fixture.counterpartyId,
      currencyCode: fixture.currencyCode,
      settlementDate: "2026-03-13",
      incomingAmountTxn: 30,
      idempotencyKey: uniqueToken("OU08-APPLY-"),
      useUnappliedCash: false,
      bankStatementLineId: fixture.bankStatementLineId,
      allocations: [{ openItemId: fixture.ownerOpenItemId, amountTxn: 30 }],
      userId: fixture.userId,
    },
  });

  assert(
    toNumber(applyResponse?.row?.ownerOperatingUnitId) === fixture.ownerOperatingUnitId,
    "Apply response should expose derived ownerOperatingUnitId"
  );
  assert(
    toNumber(applyResponse?.row?.collectorOperatingUnitId) === fixture.collectorOperatingUnitId,
    "Apply response should expose collectorOperatingUnitId from bank context"
  );
  assert(
    applyResponse?.row?.originatingCrossContextSettlementBatchId === null,
    "Ordinary settlement batch should keep originatingCrossContextSettlementBatchId null"
  );

  const persistedBatchResult = await query(
    `SELECT
        owner_operating_unit_id,
        collector_operating_unit_id,
        originating_cross_context_settlement_batch_id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?`,
    [fixture.tenantId, toNumber(applyResponse?.row?.id)]
  );
  const persistedBatch = persistedBatchResult.rows?.[0] || null;
  assert(persistedBatch, "Expected persisted settlement batch row");
  assert(
    toNumber(persistedBatch.owner_operating_unit_id) === fixture.ownerOperatingUnitId,
    "Persisted settlement batch should store owner_operating_unit_id"
  );
  assert(
    toNumber(persistedBatch.collector_operating_unit_id) === fixture.collectorOperatingUnitId,
    "Persisted settlement batch should store collector_operating_unit_id"
  );
  assert(
    persistedBatch.originating_cross_context_settlement_batch_id === null,
    "Persisted settlement batch should keep originating cross-context linkage null in OU08"
  );

  const reverseResponse = await reverseCariSettlementById({
    req,
    assertScopeAccess,
    payload: {
      tenantId: fixture.tenantId,
      settlementBatchId: toNumber(applyResponse?.row?.id),
      reversalDate: "2026-03-14",
      reason: "OU08 reversal smoke",
      userId: fixture.userId,
    },
  });

  assert(
    toNumber(reverseResponse?.row?.ownerOperatingUnitId) === fixture.ownerOperatingUnitId,
    "Reversal batch should preserve ownerOperatingUnitId"
  );
  assert(
    toNumber(reverseResponse?.row?.collectorOperatingUnitId) === fixture.collectorOperatingUnitId,
    "Reversal batch should preserve collectorOperatingUnitId"
  );
  assert(
    toNumber(reverseResponse?.original?.ownerOperatingUnitId) === fixture.ownerOperatingUnitId,
    "Reverse response should expose original ownerOperatingUnitId"
  );
  assert(
    toNumber(reverseResponse?.original?.collectorOperatingUnitId) ===
      fixture.collectorOperatingUnitId,
    "Reverse response should expose original collectorOperatingUnitId"
  );

  const reversalBatchId = toNumber(reverseResponse?.row?.id);
  const reversalRowResult = await query(
    `SELECT
        owner_operating_unit_id,
        collector_operating_unit_id,
        originating_cross_context_settlement_batch_id,
        reversal_of_settlement_batch_id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?`,
    [fixture.tenantId, reversalBatchId]
  );
  const reversalRow = reversalRowResult.rows?.[0] || null;
  assert(reversalRow, "Expected reversal settlement batch row");
  assert(
    toNumber(reversalRow.owner_operating_unit_id) === fixture.ownerOperatingUnitId,
    "Reversal settlement batch should persist owner_operating_unit_id"
  );
  assert(
    toNumber(reversalRow.collector_operating_unit_id) === fixture.collectorOperatingUnitId,
    "Reversal settlement batch should persist collector_operating_unit_id"
  );
  assert(
    reversalRow.originating_cross_context_settlement_batch_id === null,
    "Reversal settlement batch should not create originating linkage in OU08"
  );
  assert(
    toNumber(reversalRow.reversal_of_settlement_batch_id) === toNumber(applyResponse?.row?.id),
    "Reversal settlement batch should reference the original batch"
  );

  console.log("Cari OU08 settlement owner/collector resolution test passed.");
  console.log(
    JSON.stringify(
      {
        tenantId: fixture.tenantId,
        legalEntityId: fixture.legalEntityId,
        ownerOperatingUnitId: fixture.ownerOperatingUnitId,
        collectorOperatingUnitId: fixture.collectorOperatingUnitId,
        settlementBatchId: toNumber(applyResponse?.row?.id),
        reversalSettlementBatchId: reversalBatchId,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
