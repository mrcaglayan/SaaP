import { query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueToken(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

const FIXTURE_POSTING_DATE = "2026-03-13";

async function fetchSingleId(sql, params) {
  const result = await query(sql, params);
  return toNumber(result.rows?.[0]?.id);
}

async function createTenantAndUsers(prefix) {
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
  const approverEmail = `${tenantCode.toLowerCase()}.approver@example.com`;
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, '!', ?, 'ACTIVE')`,
    [tenantId, email, `${prefix} Inventory User`]
  );
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, '!', ?, 'ACTIVE')`,
    [tenantId, approverEmail, `${prefix} Inventory Approver`]
  );
  const userId = await fetchSingleId(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND email = ?
      LIMIT 1`,
    [tenantId, email]
  );
  const approverUserId = await fetchSingleId(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND email = ?
      LIMIT 1`,
    [tenantId, approverEmail]
  );
  assert(userId > 0, `Failed to create ${prefix} user`);
  assert(approverUserId > 0, `Failed to create ${prefix} approver`);

  return {
    tenantId,
    userId,
    approverUserId,
    stamp: Date.now(),
  };
}

async function loadCountryContext() {
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
  assert(countryId > 0, "US country row is required for inventory OU smoke fixture");
  return {
    countryId,
    functionalCurrencyCode,
  };
}

async function createGroupCompany({ tenantId, code, name }) {
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, code, name]
  );
  const groupCompanyId = await fetchSingleId(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  assert(groupCompanyId > 0, `Failed to create group company ${code}`);
  return groupCompanyId;
}

async function createLegalEntity({
  tenantId,
  groupCompanyId,
  code,
  name,
  countryId,
  functionalCurrencyCode,
}) {
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
    [tenantId, groupCompanyId, code, name, countryId, functionalCurrencyCode]
  );
  const legalEntityId = await fetchSingleId(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  assert(legalEntityId > 0, `Failed to create legal entity ${code}`);
  return legalEntityId;
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

async function createFiscalCalendar({ tenantId, code, name }) {
  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     ) VALUES (?, ?, ?, 1, 1)`,
    [tenantId, code, name]
  );
  const calendarId = await fetchSingleId(
    `SELECT id
       FROM fiscal_calendars
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  assert(calendarId > 0, `Failed to create fiscal calendar ${code}`);
  return calendarId;
}

async function createBook({
  tenantId,
  legalEntityId,
  calendarId,
  code,
  name,
  functionalCurrencyCode,
}) {
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
    [tenantId, legalEntityId, calendarId, code, name, functionalCurrencyCode]
  );
  const bookId = await fetchSingleId(
    `SELECT id
       FROM books
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  assert(bookId > 0, `Failed to create book ${code}`);
  return bookId;
}

async function createFiscalPeriod({ calendarId }) {
  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
     ) VALUES (?, 2026, 1, '2026-FULL', '2026-01-01', '2026-12-31', FALSE)
     ON DUPLICATE KEY UPDATE period_name = VALUES(period_name)`,
    [calendarId]
  );
}

async function createChartOfAccounts({
  tenantId,
  legalEntityId,
  code,
  name,
}) {
  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     ) VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, code, name]
  );
  const coaId = await fetchSingleId(
    `SELECT id
       FROM charts_of_accounts
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  assert(coaId > 0, `Failed to create chart of accounts ${code}`);
  return coaId;
}

/**
 * Creates a fresh tenant-scoped fixture with two legal entities and one active
 * operating unit under each legal entity so OU ownership/transfer smoke tests
 * do not depend on incidental data left behind by earlier suites.
 */
export async function createInventoryOuCrossEntityFixture({ prefix = "INVOU" } = {}) {
  const bootstrap = await createTenantAndUsers(prefix);
  const { tenantId, userId, approverUserId, stamp } = bootstrap;
  const { countryId, functionalCurrencyCode } = await loadCountryContext();

  const groupCompanyId = await createGroupCompany({
    tenantId,
    code: `${prefix}GC${stamp}`.slice(0, 50),
    name: `${prefix} Group ${stamp}`,
  });

  const legalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: `${prefix}LEA${stamp}`.slice(0, 50),
    name: `${prefix} Legal Entity A ${stamp}`,
    countryId,
    functionalCurrencyCode,
  });
  const alternateLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: `${prefix}LEB${stamp}`.slice(0, 50),
    name: `${prefix} Legal Entity B ${stamp}`,
    countryId,
    functionalCurrencyCode,
  });

  const operatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId,
    code: `${prefix}OUA${stamp}`.slice(0, 50),
    name: `${prefix} Operating Unit A ${stamp}`,
  });
  const mismatchOperatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId: alternateLegalEntityId,
    code: `${prefix}OUB${stamp}`.slice(0, 50),
    name: `${prefix} Operating Unit B ${stamp}`,
  });

  return {
    tenantId,
    userId,
    approverUserId,
    legalEntityId,
    operatingUnitId,
    mismatchOperatingUnitId,
    alternateLegalEntityId,
  };
}

/**
 * Creates a fresh tenant with one legal entity, one legal-entity chart of
 * accounts, and an open LOCAL book/period so OU inventory smoke tests can run
 * against a clean accounting context instead of ambient state from earlier
 * suites.
 */
export async function createInventoryOuAccountingFixture({ prefix = "INVOUCTX" } = {}) {
  const bootstrap = await createTenantAndUsers(prefix);
  const { tenantId, userId, approverUserId, stamp } = bootstrap;
  const { countryId, functionalCurrencyCode } = await loadCountryContext();

  const groupCompanyId = await createGroupCompany({
    tenantId,
    code: `${prefix}GC${stamp}`.slice(0, 50),
    name: `${prefix} Group ${stamp}`,
  });
  const legalEntityCode = `${prefix}LE${stamp}`.slice(0, 50);
  const legalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    code: legalEntityCode,
    name: `${prefix} Legal Entity ${stamp}`,
    countryId,
    functionalCurrencyCode,
  });

  const calendarId = await createFiscalCalendar({
    tenantId,
    code: `${prefix}CAL${stamp}`.slice(0, 50),
    name: `${prefix} Calendar ${stamp}`,
  });
  await createFiscalPeriod({ calendarId });
  const bookId = await createBook({
    tenantId,
    legalEntityId,
    calendarId,
    code: `${prefix}BOOK${stamp}`.slice(0, 50),
    name: `${prefix} Book ${stamp}`,
    functionalCurrencyCode,
  });
  const coaId = await createChartOfAccounts({
    tenantId,
    legalEntityId,
    code: `${prefix}COA${stamp}`.slice(0, 50),
    name: `${prefix} CoA ${stamp}`,
  });

  return {
    tenantId,
    userId,
    approverUserId,
    legalEntityId,
    legalEntityCode,
    functionalCurrencyCode,
    bookId,
    coaId,
    postingDate: FIXTURE_POSTING_DATE,
  };
}
