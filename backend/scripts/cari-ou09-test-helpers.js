import { query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  insertCashRegister,
  markAccountAsCashControlled,
} from "../src/services/cash.queries.js";

const TEST_DATE = "2026-03-13";
const TEST_DUE_DATE = "2026-03-20";
const TEST_FISCAL_YEAR = 2026;

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function assertThrowsAsync(fn, expectedMessage) {
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

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function uniqueToken(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export function roundAmount(value) {
  return Number(Number(value || 0).toFixed(6));
}

export function buildReq(tenantId, userId) {
  return {
    user: {
      tenantId,
      userId,
    },
    rbac: {
      scopeContext: {
        tenantWide: true,
        groups: new Set(),
        countries: new Set(),
        legalEntities: new Set(),
        operatingUnits: new Set(),
      },
    },
    headers: {},
  };
}

export function assertScopeAccess() {
  return undefined;
}

async function fetchSingleId(sql, params) {
  const result = await query(sql, params);
  return toNumber(result.rows?.[0]?.id);
}

async function createTenantAndUser(prefix) {
  await seedCore({
    ensureDefaultTenantIfMissing: true,
  });

  const tenantCode = uniqueToken(`${prefix}_TENANT_`).slice(0, 50);
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `${tenantCode} Name`]
  );
  const tenantId = await fetchSingleId(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  assert(tenantId > 0, `Failed to create ${prefix} tenant`);

  const email = `${tenantCode.toLowerCase()}@example.com`;
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, '!', ?, 'ACTIVE')`,
    [tenantId, email, `${prefix} Settlement User`]
  );
  const userId = await fetchSingleId(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  assert(userId > 0, `Failed to create ${prefix} user`);

  return {
    tenantId,
    userId,
    stamp: Date.now(),
  };
}

async function createAccount({
  coaId,
  code,
  name,
  accountType = "ASSET",
  normalSide = "DEBIT",
}) {
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
  const accountId = await fetchSingleId(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, code]
  );
  assert(accountId > 0, `Failed to create account ${code}`);
  return accountId;
}

async function createOperatingUnit({
  tenantId,
  legalEntityId,
  code,
  name,
}) {
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
  const operatingUnitId = await fetchSingleId(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  assert(operatingUnitId > 0, `Failed to create operating unit ${code}`);
  return operatingUnitId;
}

export async function setupCariOu09Fixture({ prefix = "OU09" } = {}) {
  const bootstrap = await createTenantAndUser(prefix);
  const { tenantId, userId, stamp } = bootstrap;

  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'US'
     LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  const functionalCurrencyCode = String(
    countryResult.rows?.[0]?.default_currency_code || "USD"
  )
    .trim()
    .toUpperCase();
  assert(countryId > 0, "US country row is required");

  const groupCode = `${prefix}GC${stamp}`;
  const legalEntityCode = `${prefix}LE${stamp}`;
  const calendarCode = `${prefix}CAL${stamp}`;
  const bookCode = `${prefix}BOOK${stamp}`;
  const coaCode = `${prefix}COA${stamp}`;

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, groupCode, `${prefix} Group ${stamp}`]
  );
  const groupId = await fetchSingleId(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, groupCode]
  );
  assert(groupId > 0, `Failed to create ${prefix} group company`);

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
    [tenantId, groupId, legalEntityCode, `${prefix} Legal Entity ${stamp}`, countryId, functionalCurrencyCode]
  );
  const legalEntityId = await fetchSingleId(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityCode]
  );
  assert(legalEntityId > 0, `Failed to create ${prefix} legal entity`);

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     ) VALUES (?, ?, ?, 1, 1)`,
    [tenantId, calendarCode, `${prefix} Calendar ${stamp}`]
  );
  const calendarId = await fetchSingleId(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, calendarCode]
  );
  assert(calendarId > 0, `Failed to create ${prefix} calendar`);

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
     ) VALUES (?, ?, 3, ?, '2026-03-01', '2026-03-31', FALSE)
     ON DUPLICATE KEY UPDATE period_name = VALUES(period_name)`,
    [calendarId, TEST_FISCAL_YEAR, `${TEST_FISCAL_YEAR}-P03`]
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
    [tenantId, legalEntityId, calendarId, bookCode, `${prefix} Book ${stamp}`, functionalCurrencyCode]
  );
  const bookId = await fetchSingleId(
    `SELECT id
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, bookCode]
  );
  assert(bookId > 0, `Failed to create ${prefix} book`);

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     ) VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, coaCode, `${prefix} COA ${stamp}`]
  );
  const coaId = await fetchSingleId(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, coaCode]
  );
  assert(coaId > 0, `Failed to create ${prefix} chart of accounts`);

  const accountPrefix = `${prefix}${String(stamp).slice(-5)}`;
  const arControlAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}01`,
    name: `${prefix} AR Control`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const arOffsetAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}02`,
    name: `${prefix} AR Offset`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const fxGainAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}03`,
    name: `${prefix} FX Gain`,
    accountType: "REVENUE",
    normalSide: "CREDIT",
  });
  const fxLossAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}04`,
    name: `${prefix} FX Loss`,
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  });
  const centralBankGlAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}05`,
    name: `${prefix} Central Bank`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const collectorBankGlAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}06`,
    name: `${prefix} Collector Bank`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const missingCollectorBankGlAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}07`,
    name: `${prefix} Missing Collector Bank`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const collectorCashGlAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}08`,
    name: `${prefix} Collector Cash`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const centralDueFromOwnerAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}09`,
    name: `${prefix} Central Due From Owner`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const centralDueToOwnerAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}10`,
    name: `${prefix} Central Due To Owner`,
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const ownerDueFromCentralAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}11`,
    name: `${prefix} Owner Due From Central`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const ownerDueToCentralAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}12`,
    name: `${prefix} Owner Due To Central`,
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const centralDueFromCollectorAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}13`,
    name: `${prefix} Central Due From Collector`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const centralDueToCollectorAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}14`,
    name: `${prefix} Central Due To Collector`,
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const collectorDueFromCentralAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}15`,
    name: `${prefix} Collector Due From Central`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const collectorDueToCentralAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}16`,
    name: `${prefix} Collector Due To Central`,
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const ownerDueFromCollectorAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}17`,
    name: `${prefix} Owner Due From Collector`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const ownerDueToCollectorAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}18`,
    name: `${prefix} Owner Due To Collector`,
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  });
  const collectorDueFromOwnerAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}19`,
    name: `${prefix} Collector Due From Owner`,
    accountType: "ASSET",
    normalSide: "DEBIT",
  });
  const collectorDueToOwnerAccountId = await createAccount({
    coaId,
    code: `${accountPrefix}20`,
    name: `${prefix} Collector Due To Owner`,
    accountType: "LIABILITY",
    normalSide: "CREDIT",
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

  const ownerOperatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId,
    code: `${prefix}OWN${String(stamp).slice(-4)}`,
    name: `${prefix} Owner OU`,
  });
  const collectorOperatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId,
    code: `${prefix}COL${String(stamp).slice(-4)}`,
    name: `${prefix} Collector OU`,
  });
  const missingCollectorOperatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId,
    code: `${prefix}MIS${String(stamp).slice(-4)}`,
    name: `${prefix} Missing Collector OU`,
  });

  await query(
    `UPDATE operating_units
     SET central_due_from_account_id = ?,
         central_due_to_account_id = ?,
         ou_due_from_central_account_id = ?,
         ou_due_to_central_account_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [
      centralDueFromOwnerAccountId,
      centralDueToOwnerAccountId,
      ownerDueFromCentralAccountId,
      ownerDueToCentralAccountId,
      tenantId,
      legalEntityId,
      ownerOperatingUnitId,
    ]
  );
  await query(
    `UPDATE operating_units
     SET central_due_from_account_id = ?,
         central_due_to_account_id = ?,
         ou_due_from_central_account_id = ?,
         ou_due_to_central_account_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [
      centralDueFromCollectorAccountId,
      centralDueToCollectorAccountId,
      collectorDueFromCentralAccountId,
      collectorDueToCentralAccountId,
      tenantId,
      legalEntityId,
      collectorOperatingUnitId,
    ]
  );

  await query(
    `INSERT INTO operating_unit_partner_current_accounts (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        partner_operating_unit_id,
        due_from_account_id,
        due_to_account_id
     ) VALUES
       (?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       due_from_account_id = VALUES(due_from_account_id),
       due_to_account_id = VALUES(due_to_account_id)`,
    [
      tenantId,
      legalEntityId,
      ownerOperatingUnitId,
      collectorOperatingUnitId,
      ownerDueFromCollectorAccountId,
      ownerDueToCollectorAccountId,
      tenantId,
      legalEntityId,
      collectorOperatingUnitId,
      ownerOperatingUnitId,
      collectorDueFromOwnerAccountId,
      collectorDueToOwnerAccountId,
    ]
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
    [
      tenantId,
      legalEntityId,
      `${prefix}CP${stamp}`,
      `${prefix} Counterparty ${stamp}`,
      functionalCurrencyCode,
    ]
  );
  const counterpartyId = await fetchSingleId(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `${prefix}CP${stamp}`]
  );
  assert(counterpartyId > 0, `Failed to create ${prefix} counterparty`);

  const bankAccounts = {};
  const bankImportIds = {};
  const bankLineCounters = new Map();
  let bankAccountSequence = 0;

  async function createBankAccount({ contextKey, operatingUnitId = null, glAccountId, currencyCode }) {
    bankAccountSequence += 1;
    const bankCode = `${prefix}BANK${String(stamp).slice(-4)}${bankAccountSequence}`;
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
        operatingUnitId,
        bankCode,
        `${prefix} ${contextKey} Bank`,
        currencyCode,
        glAccountId,
        `${prefix} Bank`,
        `${contextKey} Branch`,
        `${contextKey}-${stamp}-${bankAccountSequence}`,
        userId,
      ]
    );
    const bankAccountId = await fetchSingleId(
      `SELECT id
       FROM bank_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, legalEntityId, bankCode]
    );
    assert(bankAccountId > 0, `Failed to create ${contextKey} bank account`);

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
       ) VALUES (?, ?, ?, 'MANUAL', ?, ?, 'IMPORTED', 0, 0, 0, ?)`,
      [
        tenantId,
        legalEntityId,
        bankAccountId,
        `${bankCode}.csv`,
        uniqueToken(`${prefix}_CHK_`).slice(0, 60),
        userId,
      ]
    );
    const importId = await fetchSingleId(
      `SELECT id
       FROM bank_statement_imports
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND bank_account_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, legalEntityId, bankAccountId]
    );
    assert(importId > 0, `Failed to create ${contextKey} bank import`);

    bankAccounts[contextKey] = {
      bankAccountId,
      glAccountId,
      operatingUnitId: operatingUnitId || null,
      currencyCode,
    };
    bankImportIds[contextKey] = importId;
    bankLineCounters.set(importId, 0);
  }

  await createBankAccount({
    contextKey: "CENTRAL",
    operatingUnitId: null,
    glAccountId: centralBankGlAccountId,
    currencyCode: functionalCurrencyCode,
  });
  await createBankAccount({
    contextKey: "COLLECTOR",
    operatingUnitId: collectorOperatingUnitId,
    glAccountId: collectorBankGlAccountId,
    currencyCode: functionalCurrencyCode,
  });
  await createBankAccount({
    contextKey: "MISSING",
    operatingUnitId: missingCollectorOperatingUnitId,
    glAccountId: missingCollectorBankGlAccountId,
    currencyCode: functionalCurrencyCode,
  });

  await markAccountAsCashControlled({
    accountId: collectorCashGlAccountId,
    runQuery: query,
  });
  const collectorCashRegisterId = await insertCashRegister({
    payload: {
      tenantId,
      legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: collectorOperatingUnitId,
      accountId: collectorCashGlAccountId,
      code: `${prefix}CASH${String(stamp).slice(-4)}`,
      name: `${prefix} Collector Cash`,
      registerType: "DRAWER",
      sessionMode: "OPTIONAL",
      currencyCode: functionalCurrencyCode,
      status: "ACTIVE",
      allowNegative: false,
      varianceGainAccountId: fxGainAccountId,
      varianceLossAccountId: fxLossAccountId,
      maxTxnAmount: null,
      requiresApprovalOverAmount: null,
      userId,
    },
    runQuery: query,
  });
  assert(collectorCashRegisterId > 0, "Failed to create collector cash register");

  const documentCounters = new Map();
  function nextCounter(key) {
    const next = Number(documentCounters.get(key) || 0) + 1;
    documentCounters.set(key, next);
    return next;
  }

  async function createOpenItem({
    operatingUnitId = null,
    amountTxn,
    amountBase = amountTxn,
    currencyCode = functionalCurrencyCode,
    documentNo = null,
  }) {
    const sequenceNo = nextCounter("document");
    const resolvedDocumentNo =
      documentNo || `${prefix}-DOC-${String(stamp).slice(-4)}-${sequenceNo}`;
    const fxRateSnapshot =
      Number(amountTxn || 0) > 0 ? Number(amountBase || 0) / Number(amountTxn || 1) : 1;

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
       ) VALUES (?, ?, ?, 'AR', 'INVOICE', ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        counterpartyId,
        `${prefix}DOC`,
        TEST_FISCAL_YEAR,
        sequenceNo,
        resolvedDocumentNo,
        TEST_DATE,
        TEST_DUE_DATE,
        amountTxn,
        amountBase,
        amountTxn,
        amountBase,
        currencyCode,
        roundAmount(fxRateSnapshot).toFixed(10),
        `${prefix}CP${stamp}`,
        `${prefix} Counterparty ${stamp}`,
        currencyCode,
        roundAmount(fxRateSnapshot).toFixed(10),
        operatingUnitId,
      ]
    );
    const documentId = await fetchSingleId(
      `SELECT id
       FROM cari_documents
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND document_no = ?
       LIMIT 1`,
      [tenantId, legalEntityId, resolvedDocumentNo]
    );
    assert(documentId > 0, `Failed to create document ${resolvedDocumentNo}`);

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
       ) VALUES (?, ?, ?, ?, 1, 'OPEN', ?, ?, ?, ?, ?, ?, 0.000000, 0.000000, ?)`,
      [
        tenantId,
        legalEntityId,
        counterpartyId,
        documentId,
        TEST_DATE,
        TEST_DUE_DATE,
        amountTxn,
        amountBase,
        amountTxn,
        amountBase,
        currencyCode,
      ]
    );
    const openItemId = await fetchSingleId(
      `SELECT id
       FROM cari_open_items
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND document_id = ?
       LIMIT 1`,
      [tenantId, legalEntityId, documentId]
    );
    assert(openItemId > 0, `Failed to create open item for ${resolvedDocumentNo}`);

    return {
      documentId,
      openItemId,
      operatingUnitId: operatingUnitId || null,
      amountTxn: roundAmount(amountTxn),
      amountBase: roundAmount(amountBase),
      currencyCode,
      documentNo: resolvedDocumentNo,
    };
  }

  async function createBankStatementLine({
    contextKey,
    amount,
    currencyCode = functionalCurrencyCode,
    description = `${prefix} ${contextKey} bank line`,
  }) {
    const importId = bankImportIds[contextKey];
    const bankAccount = bankAccounts[contextKey];
    assert(importId > 0, `Missing bank import for context ${contextKey}`);
    assert(bankAccount?.bankAccountId > 0, `Missing bank account for context ${contextKey}`);

    const nextLineNo = Number(bankLineCounters.get(importId) || 0) + 1;
    bankLineCounters.set(importId, nextLineNo);
    const referenceNo = `${prefix}-${contextKey}-REF-${String(stamp).slice(-4)}-${nextLineNo}`;
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNMATCHED')`,
      [
        tenantId,
        legalEntityId,
        bankAccount.operatingUnitId,
        importId,
        bankAccount.bankAccountId,
        nextLineNo,
        TEST_DATE,
        TEST_DATE,
        description,
        referenceNo,
        roundAmount(amount),
        currencyCode,
        roundAmount(amount),
        uniqueToken(`${prefix}_LINE_`).slice(0, 80),
      ]
    );
    const lineId = await fetchSingleId(
      `SELECT id
       FROM bank_statement_lines
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND import_id = ?
         AND line_no = ?
       LIMIT 1`,
      [tenantId, legalEntityId, importId, nextLineNo]
    );
    assert(lineId > 0, `Failed to create ${contextKey} bank statement line`);

    return {
      id: lineId,
      bankAccountId: bankAccount.bankAccountId,
      glAccountId: bankAccount.glAccountId,
      operatingUnitId: bankAccount.operatingUnitId,
      referenceNo,
      amount: roundAmount(amount),
      currencyCode,
    };
  }

  async function upsertFxRate({
    fromCurrencyCode,
    toCurrencyCode = functionalCurrencyCode,
    rateDate = TEST_DATE,
    rate,
  }) {
    await query(
      `INSERT INTO fx_rates (
          tenant_id,
          rate_date,
          from_currency_code,
          to_currency_code,
          rate_type,
          rate
       ) VALUES (?, ?, ?, ?, 'SPOT', ?)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate)`,
      [tenantId, rateDate, fromCurrencyCode, toCurrencyCode, rate]
    );
  }

  async function loadJournalLines(journalEntryId) {
    const result = await query(
      `SELECT
          line_no,
          account_id,
          operating_unit_id,
          amount_txn,
          debit_base,
          credit_base,
          description
       FROM journal_lines
       WHERE journal_entry_id = ?
       ORDER BY line_no ASC`,
      [journalEntryId]
    );
    return result.rows || [];
  }

  return {
    tenantId,
    userId,
    legalEntityId,
    bookId,
    coaId,
    functionalCurrencyCode,
    counterpartyId,
    ownerOperatingUnitId,
    collectorOperatingUnitId,
    missingCollectorOperatingUnitId,
    collectorCashRegisterId,
    accounts: {
      arControlAccountId,
      arOffsetAccountId,
      fxGainAccountId,
      fxLossAccountId,
      centralBankGlAccountId,
      collectorBankGlAccountId,
      missingCollectorBankGlAccountId,
      collectorCashGlAccountId,
      centralDueFromOwnerAccountId,
      centralDueToOwnerAccountId,
      ownerDueFromCentralAccountId,
      ownerDueToCentralAccountId,
      centralDueFromCollectorAccountId,
      centralDueToCollectorAccountId,
      collectorDueFromCentralAccountId,
      collectorDueToCentralAccountId,
      ownerDueFromCollectorAccountId,
      ownerDueToCollectorAccountId,
      collectorDueFromOwnerAccountId,
      collectorDueToOwnerAccountId,
    },
    bankAccounts,
    createOpenItem,
    createBankStatementLine,
    upsertFxRate,
    loadJournalLines,
  };
}
