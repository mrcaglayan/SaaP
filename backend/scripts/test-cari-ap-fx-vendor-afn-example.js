import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { assignTestFullAccessRoleToUser } from "./ex05-test-helpers.js";

const PORT = Number(process.env.CARI_AP_FX_VENDOR_EXAMPLE_TEST_PORT || 3142);
const BASE_URL =
  process.env.CARI_AP_FX_VENDOR_EXAMPLE_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 25_000;
const TEST_PASSWORD = "CariApFxVendor#12345";
const TEST_FISCAL_YEAR = 2026;
const INVOICE_DATE = "2026-03-07";
const DUE_DATE = "2026-04-07";
const SETTLEMENT_DATE = "2026-04-07";
const INVOICE_AMOUNT_USD = 1000;
const HISTORICAL_RATE = 65;
const SETTLEMENT_RATE = 70;
const HISTORICAL_BASE_AFN = 65_000;
const SETTLEMENT_BASE_AFN = 70_000;
const REALIZED_FX_LOSS_AFN = 5_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

async function apiRequest({
  token,
  method = "GET",
  requestPath,
  body,
  expectedStatus,
}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Cookie = token;
  }

  const response = await fetch(`${BASE_URL}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  const setCookieHeader = response.headers.get("set-cookie");
  const cookie = setCookieHeader
    ? String(setCookieHeader).split(";")[0].trim()
    : null;

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${requestPath} expected ${expectedStatus}, got ${response.status}. response=${JSON.stringify(
        json
      )}`
    );
  }

  return {
    status: response.status,
    json,
    cookie,
  };
}

function startServerProcess() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      CARI_SETTLEMENT_FX_FALLBACK_MODE: "EXACT_ONLY",
      CARI_SETTLEMENT_FX_FALLBACK_MAX_DAYS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  return child;
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // wait for startup
    }
    await sleep(350);
  }
  throw new Error(`Server did not start within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function login(email, password) {
  const response = await apiRequest({
    method: "POST",
    requestPath: "/auth/login",
    body: { email, password },
    expectedStatus: 200,
  });
  assert(Boolean(response.cookie), `Login cookie missing for ${email}`);
  return response.cookie;
}

async function createTenant(code, name) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [code, name]
  );
  const result = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [code]
  );
  const tenantId = toNumber(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant id for ${code}`);
  return tenantId;
}

async function createUserWithRole({
  tenantId,
  roleCode,
  email,
  passwordHash,
  name,
}) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
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
  assert(userId > 0, `Failed to resolve user id for ${email}`);

  if (roleCode) {
    const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
    const roleId = toNumber(roleResult.rows?.[0]?.id);
    assert(roleId > 0, `Role not found: ${roleCode}`);

    await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
     )
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE effect = VALUES(effect)`,
      [tenantId, userId, roleId, tenantId]
    );
  }

  return { userId, email };
}

async function createUserWithFullAccess({
  tenantId,
  email,
  passwordHash,
  name,
}) {
  const user = await createUserWithRole({
    tenantId,
    roleCode: null,
    email,
    passwordHash,
    name,
  });
  await assignTestFullAccessRoleToUser(tenantId, user.userId);
  return user;
}

async function createOrgFixtures({ tenantId, stamp }) {
  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'AF'
     LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  const functionalCurrencyCode = toUpper(
    countryResult.rows?.[0]?.default_currency_code || "AFN"
  );
  assert(countryId > 0, "AF country row is required");
  assert(functionalCurrencyCode === "AFN", "AF legal entity must use AFN");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `AFXGC${stamp}`, `AP FX Vendor Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `AFXGC${stamp}`]
  );
  const groupCompanyId = toNumber(groupResult.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Group company create failed");

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      groupCompanyId,
      `AFXLE${stamp}`,
      `AP FX Vendor Entity ${stamp}`,
      countryId,
      functionalCurrencyCode,
    ]
  );
  const legalEntityResult = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `AFXLE${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Legal entity create failed");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     )
     VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `AFXCAL${stamp}`, `AP FX Vendor Calendar ${stamp}`]
  );
  const calendarResult = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `AFXCAL${stamp}`]
  );
  const calendarId = toNumber(calendarResult.rows?.[0]?.id);
  assert(calendarId > 0, "Fiscal calendar create failed");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
     )
     VALUES (?, ?, 1, 'FY2026', '2026-01-01', '2026-12-31', FALSE)
     ON DUPLICATE KEY UPDATE period_name = VALUES(period_name)`,
    [calendarId, TEST_FISCAL_YEAR]
  );
  const fiscalPeriodResult = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND fiscal_year = ?
       AND period_no = 1
     LIMIT 1`,
    [calendarId, TEST_FISCAL_YEAR]
  );
  const fiscalPeriodId = toNumber(fiscalPeriodResult.rows?.[0]?.id);
  assert(fiscalPeriodId > 0, "Fiscal period create failed");

  await query(
    `INSERT INTO books (
        tenant_id,
        legal_entity_id,
        calendar_id,
        code,
        name,
        book_type,
        base_currency_code
     )
     VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
    [
      tenantId,
      legalEntityId,
      calendarId,
      `AFXBOOK${stamp}`,
      `AP FX Vendor Book ${stamp}`,
      functionalCurrencyCode,
    ]
  );
  const bookResult = await query(
    `SELECT id
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `AFXBOOK${stamp}`]
  );
  const bookId = toNumber(bookResult.rows?.[0]?.id);
  assert(bookId > 0, "Book create failed");

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `AFXCOA${stamp}`, `AP FX Vendor COA ${stamp}`]
  );
  const coaResult = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `AFXCOA${stamp}`]
  );
  const coaId = toNumber(coaResult.rows?.[0]?.id);
  assert(coaId > 0, "COA create failed");

  const accountPrefix = `AFX${String(stamp).slice(-5)}`;
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
     )
     VALUES
       (?, ?, ?, 'EXPENSE', 'DEBIT', TRUE, NULL, TRUE),
       (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, NULL, TRUE),
       (?, ?, ?, 'ASSET', 'DEBIT', TRUE, NULL, TRUE),
       (?, ?, ?, 'REVENUE', 'CREDIT', TRUE, NULL, TRUE),
       (?, ?, ?, 'EXPENSE', 'DEBIT', TRUE, NULL, TRUE),
       (?, ?, ?, 'ASSET', 'DEBIT', TRUE, NULL, TRUE)`,
    [
      coaId,
      `${accountPrefix}01`,
      "Purchases",
      coaId,
      `${accountPrefix}02`,
      "Accounts Payable",
      coaId,
      `${accountPrefix}03`,
      "Bank",
      coaId,
      `${accountPrefix}04`,
      "FX Gain",
      coaId,
      `${accountPrefix}05`,
      "FX Loss",
      coaId,
      `${accountPrefix}06`,
      "Cash",
    ]
  );
  const accountRows = await query(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN (?, ?, ?, ?, ?, ?)
     ORDER BY code`,
    [
      coaId,
      `${accountPrefix}01`,
      `${accountPrefix}02`,
      `${accountPrefix}03`,
      `${accountPrefix}04`,
      `${accountPrefix}05`,
      `${accountPrefix}06`,
    ]
  );
  const accountByCode = new Map(
    (accountRows.rows || []).map((row) => [String(row.code), toNumber(row.id)])
  );
  const purchasesAccountId = accountByCode.get(`${accountPrefix}01`);
  const apControlAccountId = accountByCode.get(`${accountPrefix}02`);
  const bankAccountId = accountByCode.get(`${accountPrefix}03`);
  const fxGainAccountId = accountByCode.get(`${accountPrefix}04`);
  const fxLossAccountId = accountByCode.get(`${accountPrefix}05`);
  const cashAccountId = accountByCode.get(`${accountPrefix}06`);
  assert(purchasesAccountId > 0, "Purchases account missing");
  assert(apControlAccountId > 0, "AP control account missing");
  assert(bankAccountId > 0, "Bank account missing");
  assert(fxGainAccountId > 0, "FX gain account missing");
  assert(fxLossAccountId > 0, "FX loss account missing");
  assert(cashAccountId > 0, "Cash account missing");

  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES
       (?, ?, 'CARI_AP_CONTROL', ?),
       (?, ?, 'CARI_AP_OFFSET', ?),
       (?, ?, 'CARI_SETTLEMENT_FX_GAIN', ?),
       (?, ?, 'CARI_SETTLEMENT_FX_LOSS', ?)
     ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
    [
      tenantId,
      legalEntityId,
      apControlAccountId,
      tenantId,
      legalEntityId,
      purchasesAccountId,
      tenantId,
      legalEntityId,
      fxGainAccountId,
      tenantId,
      legalEntityId,
      fxLossAccountId,
    ]
  );

  await query(
    `INSERT INTO payment_terms (
        tenant_id,
        legal_entity_id,
        code,
        name,
        due_days,
        grace_days,
        status
     )
     VALUES (?, ?, ?, ?, 30, 0, 'ACTIVE')`,
    [tenantId, legalEntityId, `AFXTERM${stamp}`, `AP FX Vendor Term ${stamp}`]
  );
  const paymentTermResult = await query(
    `SELECT id
     FROM payment_terms
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `AFXTERM${stamp}`]
  );
  const paymentTermId = toNumber(paymentTermResult.rows?.[0]?.id);
  assert(paymentTermId > 0, "Payment term create failed");

  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        default_payment_term_id,
        status
     )
     VALUES (?, ?, ?, ?, FALSE, TRUE, 'USD', ?, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `AFXVEND${stamp}`,
      `AP FX Vendor ${stamp}`,
      paymentTermId,
    ]
  );
  const counterpartyResult = await query(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `AFXVEND${stamp}`]
  );
  const counterpartyId = toNumber(counterpartyResult.rows?.[0]?.id);
  assert(counterpartyId > 0, "Vendor counterparty create failed");

  return {
    tenantId,
    legalEntityId,
    fiscalPeriodId,
    bookId,
    paymentTermId,
    counterpartyId,
    functionalCurrencyCode,
    purchasesAccountId,
    apControlAccountId,
    bankAccountId,
    fxGainAccountId,
    fxLossAccountId,
    cashAccountId,
  };
}

async function createAndPostDocument({
  token,
  fixtures,
  counterpartyId = fixtures.counterpartyId,
  paymentTermId = fixtures.paymentTermId,
  direction = "AP",
  documentType = "INVOICE",
  documentDate,
  dueDate,
  amountTxn,
  amountBase,
  currencyCode,
  fxRate,
}) {
  const createResponse = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/cari/documents",
    body: {
      legalEntityId: fixtures.legalEntityId,
      counterpartyId,
      paymentTermId,
      direction,
      documentType,
      documentDate,
      dueDate,
      amountTxn,
      amountBase,
      currencyCode,
      fxRate,
    },
    expectedStatus: 201,
  });
  const documentId = toNumber(createResponse.json?.row?.id);
  assert(documentId > 0, "Draft document id missing");

  await apiRequest({
    token,
    method: "POST",
    requestPath: `/api/v1/cari/documents/${documentId}/post`,
    body: {},
    expectedStatus: 200,
  });

  const openItemResult = await query(
    `SELECT id
     FROM cari_open_items
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND document_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [fixtures.tenantId, fixtures.legalEntityId, documentId]
  );
  const openItemId = toNumber(openItemResult.rows?.[0]?.id);
  assert(openItemId > 0, "Open item missing after post");

  return { documentId, openItemId };
}

async function createCounterparty({
  tenantId,
  legalEntityId,
  paymentTermId,
  code,
  name,
  currencyCode = "USD",
}) {
  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        default_payment_term_id,
        status
     )
     VALUES (?, ?, ?, ?, FALSE, TRUE, ?, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name, currencyCode, paymentTermId]
  );
  const result = await query(
    `SELECT id
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const counterpartyId = toNumber(result.rows?.[0]?.id);
  assert(counterpartyId > 0, "Counterparty create failed");
  return counterpartyId;
}

async function createBankStatementLineFixture({
  tenantId,
  legalEntityId,
  createdByUserId,
  bankGlAccountId,
  currencyCode,
  txnDate,
  amount,
  stamp,
  suffix,
}) {
  const normalizedSuffix = String(suffix || "A").trim() || "A";
  const bankAccountCode = `AFXBANK${stamp}${normalizedSuffix}`.slice(0, 60);
  await query(
    `INSERT INTO bank_accounts (
        tenant_id,
        legal_entity_id,
        code,
        name,
        currency_code,
        gl_account_id,
        bank_name,
        branch_name,
        iban,
        account_no,
        is_active,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [
      tenantId,
      legalEntityId,
      bankAccountCode,
      `AP FX Vendor Bank ${normalizedSuffix}`,
      currencyCode,
      bankGlAccountId,
      "Smoke Bank",
      "Main",
      `AF${String(stamp).slice(-20).padStart(20, "0")}`.slice(0, 22),
      `${stamp}${normalizedSuffix}`.slice(0, 80),
      createdByUserId,
    ]
  );
  const bankAccountResult = await query(
    `SELECT id
     FROM bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, bankAccountCode]
  );
  const bankAccountMasterId = toNumber(bankAccountResult.rows?.[0]?.id);
  assert(bankAccountMasterId > 0, "Bank account fixture missing");

  const fileChecksum = `afx-vendor-bank-${stamp}-${normalizedSuffix}`.padEnd(64, "0").slice(0, 64);
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
        raw_meta_json,
        imported_by_user_id
      )
      VALUES (?, ?, ?, 'CSV', ?, ?, 'IMPORTED', 1, 1, 0, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      bankAccountMasterId,
      `afx-vendor-bank-${stamp}-${normalizedSuffix}.csv`,
      fileChecksum,
      JSON.stringify({ source: "cari-ap-fx-vendor-example" }),
      createdByUserId,
    ]
  );
  const importResult = await query(
    `SELECT id
     FROM bank_statement_imports
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND bank_account_id = ?
       AND file_checksum = ?
     LIMIT 1`,
    [tenantId, legalEntityId, bankAccountMasterId, fileChecksum]
  );
  const importId = toNumber(importResult.rows?.[0]?.id);
  assert(importId > 0, "Bank statement import fixture missing");

  const lineHash = `AFX-BANK-LINE-${stamp}-${normalizedSuffix}`.padEnd(64, "0").slice(0, 64);
  await query(
    `INSERT INTO bank_statement_lines (
        tenant_id,
        legal_entity_id,
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
        recon_status,
        raw_row_json
      )
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'UNMATCHED', ?)`,
    [
      tenantId,
      legalEntityId,
      importId,
      bankAccountMasterId,
      txnDate,
      txnDate,
      `Vendor payment ${normalizedSuffix}`,
      `AFX-BANK-REF-${stamp}-${normalizedSuffix}`,
      amount,
      currencyCode,
      amount,
      lineHash,
      JSON.stringify({ source: "cari-ap-fx-vendor-example" }),
    ]
  );
  const lineResult = await query(
    `SELECT id
     FROM bank_statement_lines
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND import_id = ?
       AND line_hash = ?
     LIMIT 1`,
    [tenantId, legalEntityId, importId, lineHash]
  );
  const bankStatementLineId = toNumber(lineResult.rows?.[0]?.id);
  assert(bankStatementLineId > 0, "Bank statement line fixture missing");

  return {
    bankAccountMasterId,
    bankStatementLineId,
  };
}

async function insertFxRate({
  tenantId,
  rateDate,
  fromCurrencyCode,
  toCurrencyCode,
  rate,
}) {
  await query(
    `INSERT INTO fx_rates (
        tenant_id,
        rate_date,
        from_currency_code,
        to_currency_code,
        rate_type,
        rate,
        source,
        is_locked
     )
     VALUES (?, ?, ?, ?, 'SPOT', ?, 'TEST', FALSE)
     ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source), is_locked = VALUES(is_locked)`,
    [tenantId, rateDate, fromCurrencyCode, toCurrencyCode, rate]
  );
}

async function createCashRegister({
  token,
  tenantId,
  legalEntityId,
  accountId,
  code,
  name,
  currencyCode,
}) {
  const response = await apiRequest({
    token,
    method: "POST",
    requestPath: "/api/v1/cash/registers",
    body: {
      tenantId,
      legalEntityId,
      ownershipScope: "CENTRAL",
      accountId,
      code,
      name,
      registerType: "DRAWER",
      sessionMode: "OPTIONAL",
      currencyCode,
      status: "ACTIVE",
    },
    expectedStatus: 200,
  });
  const registerId = toNumber(response.json?.row?.id);
  assert(registerId > 0, "Cash register create failed");
  return registerId;
}

async function getDocument(tenantId, documentId) {
  const result = await query(
    `SELECT id, status, posted_journal_entry_id
     FROM cari_documents
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, documentId]
  );
  return result.rows?.[0] || null;
}

async function getOpenItem(tenantId, openItemId) {
  const result = await query(
    `SELECT
        id,
        status,
        residual_amount_txn,
        residual_amount_base,
        settled_amount_txn,
        settled_amount_base
     FROM cari_open_items
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, openItemId]
  );
  return result.rows?.[0] || null;
}

async function getSettlementBatch(tenantId, settlementBatchId) {
  const result = await query(
    `SELECT
        id,
        status,
        settlement_fx_rate,
        settlement_fx_source,
        realized_fx_net_base,
        posted_journal_entry_id,
        cash_transaction_id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, settlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function getCashTransaction(tenantId, cashTransactionId) {
  const result = await query(
    `SELECT
        id,
        status,
        posted_journal_entry_id,
        linked_cari_settlement_batch_id
     FROM cash_transactions
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, cashTransactionId]
  );
  return result.rows?.[0] || null;
}

async function getLatestSettlementAllocation(tenantId, settlementBatchId) {
  const result = await query(
    `SELECT
        id,
        open_item_id,
        allocation_amount_doc_txn,
        allocation_amount_settlement_txn,
        applied_cross_rate
     FROM cari_settlement_allocations
     WHERE tenant_id = ?
       AND settlement_batch_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, settlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function getJournalDetail({ token, journalEntryId }) {
  const response = await apiRequest({
    token,
    requestPath: `/api/v1/gl/journals/${journalEntryId}`,
    expectedStatus: 200,
  });
  return response.json?.row || null;
}

function findLineByAccountId(lines, accountId) {
  return (Array.isArray(lines) ? lines : []).find(
    (line) => toNumber(line?.account_id || line?.accountId) === toNumber(accountId)
  );
}

async function reverseCashTransaction({ token, tenantId, transactionId }) {
  return apiRequest({
    token,
    method: "POST",
    requestPath: `/api/v1/cash/transactions/${transactionId}/reverse`,
    body: {
      tenantId,
      reverseReason: "Shared settlement journal reversal check",
    },
    expectedStatus: 200,
  });
}

async function reverseSettlement({ token, settlementBatchId, reversalDate }) {
  return apiRequest({
    token,
    method: "POST",
    requestPath: `/api/v1/cari/settlements/${settlementBatchId}/reverse`,
    body: {
      reversalDate,
      reason: "Shared settlement journal reversal check",
    },
    expectedStatus: 201,
  });
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(`AFXV_${stamp}`, `AP FX Vendor Example ${stamp}`);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await createUserWithFullAccess({
    tenantId,
    email: `afx_vendor_${stamp}@example.com`,
    passwordHash,
    name: "AP FX Vendor Accountant",
  });

  const fixtures = await createOrgFixtures({ tenantId, stamp });
  const server = startServerProcess();
  let serverStopped = false;

  try {
    await waitForServer();
    const token = await login(user.email, TEST_PASSWORD);

    const document = await createAndPostDocument({
      token,
      fixtures,
      direction: "AP",
      documentDate: INVOICE_DATE,
      dueDate: DUE_DATE,
      amountTxn: INVOICE_AMOUNT_USD,
      amountBase: HISTORICAL_BASE_AFN,
      currencyCode: "USD",
      fxRate: HISTORICAL_RATE,
    });

    const postedDocument = await getDocument(tenantId, document.documentId);
    const documentJournalEntryId = toNumber(postedDocument?.posted_journal_entry_id);
    assert(documentJournalEntryId > 0, "Posted AP document must persist posted_journal_entry_id");

    const documentJournal = await getJournalDetail({
      token,
      journalEntryId: documentJournalEntryId,
    });
    assert(Boolean(documentJournal), "Posted AP document journal detail must load");
    const documentLines = Array.isArray(documentJournal?.lines) ? documentJournal.lines : [];
    assert(documentLines.length === 2, "AP invoice journal must have 2 lines");
    const purchasesLine = findLineByAccountId(documentLines, fixtures.purchasesAccountId);
    const apInvoiceLine = findLineByAccountId(documentLines, fixtures.apControlAccountId);
    assert(Boolean(purchasesLine), "AP invoice journal must debit purchases");
    assert(Boolean(apInvoiceLine), "AP invoice journal must credit AP control");
    assert(
      amountsEqual(purchasesLine?.debit_base, HISTORICAL_BASE_AFN) &&
        amountsEqual(purchasesLine?.credit_base, 0) &&
        amountsEqual(purchasesLine?.amount_txn, INVOICE_AMOUNT_USD),
      "AP invoice purchases line must debit 65,000 AFN and carry 1,000 USD txn amount"
    );
    assert(
      amountsEqual(apInvoiceLine?.debit_base, 0) &&
        amountsEqual(apInvoiceLine?.credit_base, HISTORICAL_BASE_AFN) &&
        amountsEqual(apInvoiceLine?.amount_txn, INVOICE_AMOUNT_USD * -1),
      "AP invoice AP control line must credit 65,000 AFN and carry -1,000 USD txn amount"
    );

    await insertFxRate({
      tenantId,
      rateDate: SETTLEMENT_DATE,
      fromCurrencyCode: "USD",
      toCurrencyCode: "AFN",
      rate: SETTLEMENT_RATE,
    });

    const applyResponse = await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: fixtures.legalEntityId,
        counterpartyId: fixtures.counterpartyId,
        direction: "AP",
        settlementDate: SETTLEMENT_DATE,
        currencyCode: "USD",
        incomingAmountTxn: INVOICE_AMOUNT_USD,
        idempotencyKey: `AFX-VENDOR-SETTLE-${stamp}`,
        autoAllocate: false,
        useUnappliedCash: false,
        allocations: [{ openItemId: document.openItemId, amountTxn: INVOICE_AMOUNT_USD }],
        paymentChannel: "MANUAL",
        offsetAccountId: fixtures.bankAccountId,
      },
      expectedStatus: 201,
    });

    const settlementBatchId = toNumber(applyResponse.json?.row?.id);
    assert(settlementBatchId > 0, "Settlement batch id missing");
    assert(
      amountsEqual(applyResponse.json?.fx?.settlementFxRate, SETTLEMENT_RATE),
      "Settlement response must use 70 AFN exact-date SPOT rate"
    );
    assert(
      amountsEqual(applyResponse.json?.fx?.realizedGainLossBase, REALIZED_FX_LOSS_AFN),
      "Settlement response realizedGainLossBase must be 5,000 AFN"
    );
    assert(
      toNumber(applyResponse.json?.metrics?.journalPurposeAccounts?.offsetAccountId) ===
        fixtures.bankAccountId,
      "Manual AP settlement must use the requested offsetAccountId"
    );

    const settlementRow = await getSettlementBatch(tenantId, settlementBatchId);
    assert(Boolean(settlementRow), "Settlement batch row missing");
    assert(toUpper(settlementRow?.status) === "POSTED", "Settlement batch must be POSTED");
    assert(
      amountsEqual(settlementRow?.settlement_fx_rate, SETTLEMENT_RATE),
      "Settlement row must persist settlement_fx_rate=70"
    );
    assert(
      toUpper(settlementRow?.settlement_fx_source) === "FX_TABLE_EXACT_SPOT",
      "Settlement row must persist FX_TABLE_EXACT_SPOT source"
    );
    assert(
      amountsEqual(settlementRow?.realized_fx_net_base, REALIZED_FX_LOSS_AFN),
      "Settlement row must persist realized_fx_net_base=5,000 AFN"
    );

    const settlementJournalEntryId =
      toNumber(applyResponse.json?.journal?.journalEntryId) ||
      toNumber(settlementRow?.posted_journal_entry_id);
    assert(settlementJournalEntryId > 0, "Settlement journal entry id missing");
    assert(
      settlementJournalEntryId === toNumber(settlementRow?.posted_journal_entry_id),
      "API settlement journalEntryId must match cari_settlement_batches.posted_journal_entry_id"
    );

    const settlementJournal = await getJournalDetail({
      token,
      journalEntryId: settlementJournalEntryId,
    });
    assert(Boolean(settlementJournal), "Settlement journal detail must load");
    const settlementLines = Array.isArray(settlementJournal?.lines)
      ? settlementJournal.lines
      : [];
    assert(settlementLines.length === 3, "Settlement journal must have 3 lines");

    const apSettlementLine = findLineByAccountId(settlementLines, fixtures.apControlAccountId);
    const fxLossLine = findLineByAccountId(settlementLines, fixtures.fxLossAccountId);
    const bankLine = findLineByAccountId(settlementLines, fixtures.bankAccountId);
    assert(Boolean(apSettlementLine), "Settlement journal must debit AP control");
    assert(Boolean(fxLossLine), "Settlement journal must debit FX loss");
    assert(Boolean(bankLine), "Settlement journal must credit manual bank offset");

    assert(
      amountsEqual(apSettlementLine?.debit_base, HISTORICAL_BASE_AFN) &&
        amountsEqual(apSettlementLine?.credit_base, 0),
      "Settlement AP control line must debit 65,000 AFN"
    );
    assert(
      amountsEqual(fxLossLine?.debit_base, REALIZED_FX_LOSS_AFN) &&
        amountsEqual(fxLossLine?.credit_base, 0),
      "Settlement FX loss line must debit 5,000 AFN"
    );
    assert(
      amountsEqual(bankLine?.debit_base, 0) &&
        amountsEqual(bankLine?.credit_base, SETTLEMENT_BASE_AFN) &&
        amountsEqual(bankLine?.amount_txn, INVOICE_AMOUNT_USD * -1),
      "Settlement manual offset line must credit 70,000 AFN and carry -1,000 USD txn amount"
    );

    const cashRegisterId = await createCashRegister({
      token,
      tenantId,
      legalEntityId: fixtures.legalEntityId,
      accountId: fixtures.cashAccountId,
      code: `AFXCASH${stamp}`,
      name: `AP FX Cash ${stamp}`,
      currencyCode: "USD",
    });
    const cashSettlementDate = "2026-04-09";
    const cashLinkedDocument = await createAndPostDocument({
      token,
      fixtures,
      direction: "AP",
      documentDate: "2026-03-09",
      dueDate: cashSettlementDate,
      amountTxn: INVOICE_AMOUNT_USD,
      amountBase: HISTORICAL_BASE_AFN,
      currencyCode: "USD",
      fxRate: HISTORICAL_RATE,
    });
    await insertFxRate({
      tenantId,
      rateDate: cashSettlementDate,
      fromCurrencyCode: "USD",
      toCurrencyCode: "AFN",
      rate: SETTLEMENT_RATE,
    });
    const cashApplyResponse = await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: fixtures.legalEntityId,
        counterpartyId: fixtures.counterpartyId,
        direction: "AP",
        settlementDate: cashSettlementDate,
        currencyCode: "USD",
        incomingAmountTxn: INVOICE_AMOUNT_USD,
        idempotencyKey: `AFX-VENDOR-CASH-${stamp}`,
        autoAllocate: false,
        useUnappliedCash: false,
        allocations: [{ openItemId: cashLinkedDocument.openItemId, amountTxn: INVOICE_AMOUNT_USD }],
        paymentChannel: "CASH",
        linkedCashTransaction: {
          registerId: cashRegisterId,
          counterAccountId: fixtures.apControlAccountId,
          bookDate: cashSettlementDate,
          txnDatetime: `${cashSettlementDate}T09:00:00`,
          idempotencyKey: `AFX-VENDOR-CASH-TXN-${stamp}`,
          integrationEventUid: `AFX-VENDOR-CASH-EVT-${stamp}`,
        },
      },
      expectedStatus: 201,
    });
    const cashSettlementBatchId = toNumber(cashApplyResponse.json?.row?.id);
    assert(cashSettlementBatchId > 0, "Cash-linked settlement batch id missing");
    const cashSettlementRow = await getSettlementBatch(tenantId, cashSettlementBatchId);
    const cashTransactionId =
      toNumber(cashApplyResponse.json?.row?.cashTransactionId) ||
      toNumber(cashSettlementRow?.cash_transaction_id);
    assert(cashTransactionId > 0, "Cash-linked settlement must create/link cash transaction");
    const cashTransactionRow = await getCashTransaction(tenantId, cashTransactionId);
    assert(Boolean(cashTransactionRow), "Cash-linked cash transaction row missing");
    const cashSettlementJournalEntryId = toNumber(cashSettlementRow?.posted_journal_entry_id);
    assert(cashSettlementJournalEntryId > 0, "Cash-linked settlement must persist a journal id");
    assert(
      cashSettlementJournalEntryId === toNumber(cashTransactionRow?.posted_journal_entry_id),
      "Cash-linked settlement and cash transaction must share one posted journal"
    );
    const cashSettlementJournal = await getJournalDetail({
      token,
      journalEntryId: cashSettlementJournalEntryId,
    });
    const cashSettlementLines = Array.isArray(cashSettlementJournal?.lines)
      ? cashSettlementJournal.lines
      : [];
    assert(cashSettlementLines.length === 3, "Cash-linked shared journal must have 3 lines");
    const cashApLine = findLineByAccountId(cashSettlementLines, fixtures.apControlAccountId);
    const cashFxLossLine = findLineByAccountId(cashSettlementLines, fixtures.fxLossAccountId);
    const cashRegisterLine = findLineByAccountId(cashSettlementLines, fixtures.cashAccountId);
    assert(Boolean(cashApLine), "Cash-linked shared journal must debit AP control");
    assert(Boolean(cashFxLossLine), "Cash-linked shared journal must debit FX loss");
    assert(Boolean(cashRegisterLine), "Cash-linked shared journal must credit the cash register account");
    assert(
      amountsEqual(cashApLine?.debit_base, HISTORICAL_BASE_AFN) &&
        amountsEqual(cashFxLossLine?.debit_base, REALIZED_FX_LOSS_AFN) &&
        amountsEqual(cashRegisterLine?.credit_base, SETTLEMENT_BASE_AFN) &&
        amountsEqual(cashRegisterLine?.amount_txn, INVOICE_AMOUNT_USD * -1),
      "Cash-linked shared journal must post AP 65,000 / FX loss 5,000 / cash 70,000"
    );

    await reverseCashTransaction({
      token,
      tenantId,
      transactionId: cashTransactionId,
    });
    await reverseSettlement({
      token,
      settlementBatchId: cashSettlementBatchId,
      reversalDate: "2026-04-10",
    });
    const reversedCashSettlementRow = await getSettlementBatch(tenantId, cashSettlementBatchId);
    const reopenedCashOpenItem = await getOpenItem(tenantId, cashLinkedDocument.openItemId);
    assert(
      toUpper(reversedCashSettlementRow?.status) === "REVERSED",
      "Cash-linked settlement must reverse cleanly after reversing the cash transaction"
    );
    assert(
      toUpper(reopenedCashOpenItem?.status) === "OPEN" &&
        amountsEqual(reopenedCashOpenItem?.residual_amount_txn, INVOICE_AMOUNT_USD) &&
        amountsEqual(reopenedCashOpenItem?.residual_amount_base, HISTORICAL_BASE_AFN),
      "Reversing the shared cash/settlement journal flow must fully reopen the AP open item"
    );

    const bankApplyInvoiceDate = "2026-03-08";
    const bankApplyDueDate = "2026-04-08";
    const bankApplySettlementDate = "2026-04-08";
    await insertFxRate({
      tenantId,
      rateDate: bankApplySettlementDate,
      fromCurrencyCode: "USD",
      toCurrencyCode: "AFN",
      rate: SETTLEMENT_RATE,
    });
    const bankApplyDocument = await createAndPostDocument({
      token,
      fixtures,
      direction: "AP",
      documentDate: bankApplyInvoiceDate,
      dueDate: bankApplyDueDate,
      amountTxn: INVOICE_AMOUNT_USD,
      amountBase: HISTORICAL_BASE_AFN,
      currencyCode: "USD",
      fxRate: HISTORICAL_RATE,
    });
    const bankStatementFixture = await createBankStatementLineFixture({
      tenantId,
      legalEntityId: fixtures.legalEntityId,
      createdByUserId: user.userId,
      bankGlAccountId: fixtures.bankAccountId,
      currencyCode: "USD",
      txnDate: bankApplySettlementDate,
      amount: INVOICE_AMOUNT_USD * -1,
      stamp,
      suffix: "B",
    });
    const bankApplyResponse = await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/bank/apply",
      body: {
        legalEntityId: fixtures.legalEntityId,
        counterpartyId: fixtures.counterpartyId,
        direction: "AP",
        settlementDate: bankApplySettlementDate,
        currencyCode: "USD",
        incomingAmountTxn: INVOICE_AMOUNT_USD,
        bankApplyIdempotencyKey: `AFX-VENDOR-BANK-APPLY-${stamp}`,
        autoAllocate: false,
        useUnappliedCash: false,
        allocations: [{ openItemId: bankApplyDocument.openItemId, amountTxn: INVOICE_AMOUNT_USD }],
        bankStatementLineId: bankStatementFixture.bankStatementLineId,
        bankTransactionRef: `AFX-VENDOR-BANK-${stamp}`,
      },
      expectedStatus: 201,
    });
    const bankApplyBatchId = toNumber(bankApplyResponse.json?.row?.id);
    assert(bankApplyBatchId > 0, "Bank apply settlement batch id missing");
    assert(
      toNumber(bankApplyResponse.json?.metrics?.journalPurposeAccounts?.offsetAccountId) ===
        fixtures.bankAccountId,
      "Bank apply must derive the offset account from bankStatementLineId"
    );

    const bankApplyRow = await getSettlementBatch(tenantId, bankApplyBatchId);
    const bankApplyJournalEntryId =
      toNumber(bankApplyResponse.json?.journal?.journalEntryId) ||
      toNumber(bankApplyRow?.posted_journal_entry_id);
    assert(bankApplyJournalEntryId > 0, "Bank apply journal entry id missing");
    const bankApplyJournal = await getJournalDetail({
      token,
      journalEntryId: bankApplyJournalEntryId,
    });
    assert(Boolean(bankApplyJournal), "Bank apply journal detail must load");
    const bankApplyLines = Array.isArray(bankApplyJournal?.lines) ? bankApplyJournal.lines : [];
    const bankApplyBankLine = findLineByAccountId(bankApplyLines, fixtures.bankAccountId);
    assert(Boolean(bankApplyBankLine), "Bank apply journal must credit the bank GL account");
    assert(
      amountsEqual(bankApplyBankLine?.debit_base, 0) &&
        amountsEqual(bankApplyBankLine?.credit_base, SETTLEMENT_BASE_AFN) &&
        amountsEqual(bankApplyBankLine?.amount_txn, INVOICE_AMOUNT_USD * -1),
      "Bank apply offset line must credit 70,000 AFN and carry -1,000 USD txn amount"
    );

    const roundedCounterpartyId = await createCounterparty({
      tenantId,
      legalEntityId: fixtures.legalEntityId,
      paymentTermId: fixtures.paymentTermId,
      code: `AFXVENDRND${stamp}`,
      name: `AP FX Vendor Rounding ${stamp}`,
    });
    const roundedDocument = await createAndPostDocument({
      token,
      fixtures,
      counterpartyId: roundedCounterpartyId,
      direction: "AP",
      documentDate: "2026-03-10",
      dueDate: "2026-04-12",
      amountTxn: 10_000,
      amountBase: 650_000,
      currencyCode: "USD",
      fxRate: HISTORICAL_RATE,
    });
    await insertFxRate({
      tenantId,
      rateDate: "2026-04-10",
      fromCurrencyCode: "USD",
      toCurrencyCode: "AFN",
      rate: 70,
    });
    await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: fixtures.legalEntityId,
        counterpartyId: roundedCounterpartyId,
        direction: "AP",
        settlementDate: "2026-04-10",
        currencyCode: "AFN",
        incomingAmountTxn: 50_000,
        idempotencyKey: `AFX-ROUNDING-STEP1-${stamp}`,
        autoAllocate: true,
        useUnappliedCash: false,
        allocations: [],
        paymentChannel: "MANUAL",
        offsetAccountId: fixtures.bankAccountId,
      },
      expectedStatus: 201,
    });
    await insertFxRate({
      tenantId,
      rateDate: "2026-04-11",
      fromCurrencyCode: "USD",
      toCurrencyCode: "AFN",
      rate: 70,
    });
    await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: fixtures.legalEntityId,
        counterpartyId: roundedCounterpartyId,
        direction: "AP",
        settlementDate: "2026-04-11",
        currencyCode: "USD",
        incomingAmountTxn: 9_000,
        idempotencyKey: `AFX-ROUNDING-STEP2-${stamp}`,
        autoAllocate: true,
        useUnappliedCash: false,
        allocations: [],
        paymentChannel: "MANUAL",
        offsetAccountId: fixtures.bankAccountId,
      },
      expectedStatus: 201,
    });
    await insertFxRate({
      tenantId,
      rateDate: "2026-04-12",
      fromCurrencyCode: "USD",
      toCurrencyCode: "AFN",
      rate: 100,
    });
    const roundedCloseResponse = await apiRequest({
      token,
      method: "POST",
      requestPath: "/api/v1/cari/settlements/apply",
      body: {
        legalEntityId: fixtures.legalEntityId,
        counterpartyId: roundedCounterpartyId,
        direction: "AP",
        settlementDate: "2026-04-12",
        currencyCode: "AFN",
        incomingAmountTxn: 28_571,
        idempotencyKey: `AFX-ROUNDING-STEP3-${stamp}`,
        autoAllocate: true,
        useUnappliedCash: false,
        allocations: [],
        paymentChannel: "MANUAL",
        offsetAccountId: fixtures.bankAccountId,
      },
      expectedStatus: 201,
    });
    const roundedCloseSettlementBatchId = toNumber(roundedCloseResponse.json?.row?.id);
    assert(roundedCloseSettlementBatchId > 0, "Rounded close settlement batch id missing");
    const roundedOpenItem = await getOpenItem(tenantId, roundedDocument.openItemId);
    assert(Boolean(roundedOpenItem), "Rounded close open item missing");
    assert(
      toUpper(roundedOpenItem?.status) === "SETTLED" &&
        amountsEqual(roundedOpenItem?.residual_amount_txn, 0) &&
        amountsEqual(roundedOpenItem?.residual_amount_base, 0),
      "A sub-cent FX residual must auto-close and mark the AP open item SETTLED"
    );
    const roundedCloseAllocation = await getLatestSettlementAllocation(
      tenantId,
      roundedCloseSettlementBatchId
    );
    assert(
      toNumber(roundedCloseAllocation?.allocation_amount_doc_txn) > 285.71,
      "Rounded close allocation must consume the full residual document amount, not leave a tiny remainder"
    );

    console.log(
      "CARI AP FX vendor AFN example passed (manual offset, bank apply, shared cash journal, and tiny residual closure all post correctly)."
    );
    console.log(
      JSON.stringify(
        {
          tenantId,
          legalEntityId: fixtures.legalEntityId,
          counterpartyId: fixtures.counterpartyId,
          documentId: document.documentId,
          openItemId: document.openItemId,
          documentJournalEntryId,
          settlementBatchId,
          settlementJournalEntryId,
          cashRegisterId,
          cashSettlementBatchId,
          cashSettlementJournalEntryId,
          cashTransactionId,
          bankApplyBatchId,
          bankApplyJournalEntryId,
          roundedCloseSettlementBatchId,
          documentJournalLines: documentLines.map((line) => ({
            accountId: toNumber(line.account_id),
            accountCode: line.account_code || null,
            debitBase: toNumber(line.debit_base),
            creditBase: toNumber(line.credit_base),
            amountTxn: toNumber(line.amount_txn),
            currencyCode: line.currency_code || null,
          })),
          settlementJournalLines: settlementLines.map((line) => ({
            accountId: toNumber(line.account_id),
            accountCode: line.account_code || null,
            debitBase: toNumber(line.debit_base),
            creditBase: toNumber(line.credit_base),
            amountTxn: toNumber(line.amount_txn),
            currencyCode: line.currency_code || null,
          })),
          cashSettlementJournalLines: cashSettlementLines.map((line) => ({
            accountId: toNumber(line.account_id),
            accountCode: line.account_code || null,
            debitBase: toNumber(line.debit_base),
            creditBase: toNumber(line.credit_base),
            amountTxn: toNumber(line.amount_txn),
            currencyCode: line.currency_code || null,
          })),
          bankApplyJournalLines: bankApplyLines.map((line) => ({
            accountId: toNumber(line.account_id),
            accountCode: line.account_code || null,
            debitBase: toNumber(line.debit_base),
            creditBase: toNumber(line.credit_base),
            amountTxn: toNumber(line.amount_txn),
            currencyCode: line.currency_code || null,
          })),
          roundedResidualOpenItem: {
            status: roundedOpenItem?.status || null,
            residualAmountTxn: toNumber(roundedOpenItem?.residual_amount_txn),
            residualAmountBase: toNumber(roundedOpenItem?.residual_amount_base),
          },
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill();
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error("CARI AP FX vendor AFN example test failed.");
  console.error(error);
  process.exit(1);
});
