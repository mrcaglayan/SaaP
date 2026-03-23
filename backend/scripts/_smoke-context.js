import { query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";

const DEFAULT_SHARED_TENANT_CODE = "SMOKE_SHARED";
const DEFAULT_SHARED_TENANT_NAME = "Shared Smoke Tenant";
const DEFAULT_SHARED_GROUP_CODE = "SMOKE_GC";
const DEFAULT_SHARED_GROUP_NAME = "Shared Smoke Group";
const DEFAULT_SHARED_LEGAL_ENTITY_CODE = "SMOKE_LE";
const DEFAULT_SHARED_LEGAL_ENTITY_NAME = "Shared Smoke Legal Entity";
const DEFAULT_FUNCTIONAL_CURRENCY_CODE = "USD";
const DEFAULT_COUNTRY_ISO2 = "US";

const ACCOUNT_BLUEPRINTS = Object.freeze([
  {
    key: "assetPrimary",
    code: "150000",
    name: "Smoke Asset Primary",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "assetReserve",
    code: "257000",
    name: "Smoke Asset Reserve",
    accountType: "ASSET",
    normalSide: "CREDIT",
  },
  {
    key: "expensePrimary",
    code: "770000",
    name: "Smoke Expense Primary",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    key: "expenseSecondary",
    code: "632000",
    name: "Smoke Expense Secondary",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    key: "revenuePrimary",
    code: "600000",
    name: "Smoke Revenue Primary",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    key: "liabilityPrimary",
    code: "300000",
    name: "Smoke Liability Primary",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "cashClearing",
    code: "100000",
    name: "Smoke Cash Clearing",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "bankClearing",
    code: "102000",
    name: "Smoke Bank Clearing",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "onAccountAsset",
    code: "159000",
    name: "Smoke On-Account Asset",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "onAccountLiability",
    code: "340000",
    name: "Smoke On-Account Liability",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "arControl",
    code: "120000",
    name: "Smoke AR Control",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "arOffset",
    code: "600100",
    name: "Smoke AR Offset",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    key: "apControl",
    code: "320000",
    name: "Smoke AP Control",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "apOffset",
    code: "770100",
    name: "Smoke AP Offset",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    key: "fxGain",
    code: "646000",
    name: "Smoke FX Gain",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    key: "fxLoss",
    code: "656000",
    name: "Smoke FX Loss",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
  {
    key: "ouACentralDueFrom",
    code: "135101",
    name: "Smoke OU-A Central Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "ouACentralDueTo",
    code: "335101",
    name: "Smoke OU-A Central Due To",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "ouBCentralDueFrom",
    code: "135102",
    name: "Smoke OU-B Central Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "ouBCentralDueTo",
    code: "335102",
    name: "Smoke OU-B Central Due To",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "ouCCentralDueFrom",
    code: "135103",
    name: "Smoke OU-C Central Due From",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "ouCCentralDueTo",
    code: "335103",
    name: "Smoke OU-C Central Due To",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "ouAToBDueFrom",
    code: "136101",
    name: "Smoke OU-A Due From OU-B",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "ouAToBDueTo",
    code: "336101",
    name: "Smoke OU-A Due To OU-B",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    key: "ouBToADueFrom",
    code: "136102",
    name: "Smoke OU-B Due From OU-A",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    key: "ouBToADueTo",
    code: "336102",
    name: "Smoke OU-B Due To OU-A",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
]);

const PURPOSE_MAPPINGS = Object.freeze([
  ["CARI_AR_CONTROL", "arControl"],
  ["CARI_AR_OFFSET", "arOffset"],
  ["CARI_AP_CONTROL", "apControl"],
  ["CARI_AP_OFFSET", "apOffset"],
  ["CARI_SETTLEMENT_FX_GAIN", "fxGain"],
  ["CARI_SETTLEMENT_FX_LOSS", "fxLoss"],
  ["CARI_AR_CONTROL_CASH", "arControl"],
  ["CARI_AR_OFFSET_CASH", "bankClearing"],
  ["CARI_AP_CONTROL_CASH", "apControl"],
  ["CARI_AP_OFFSET_CASH", "bankClearing"],
  ["CARI_AR_CONTROL_MANUAL", "arControl"],
  ["CARI_AR_OFFSET_MANUAL", "cashClearing"],
  ["CARI_AP_CONTROL_MANUAL", "apControl"],
  ["CARI_AP_OFFSET_MANUAL", "cashClearing"],
  ["CARI_AR_CONTROL_ON_ACCOUNT", "arControl"],
  ["CARI_AR_OFFSET_ON_ACCOUNT", "onAccountLiability"],
  ["CARI_AP_CONTROL_ON_ACCOUNT", "apControl"],
  ["CARI_AP_OFFSET_ON_ACCOUNT", "onAccountAsset"],
]);

const OPERATING_UNIT_BLUEPRINTS = Object.freeze([
  {
    key: "ouA",
    code: "SMKOUA",
    name: "Smoke OU A",
    centralDueFromKey: "ouACentralDueFrom",
    centralDueToKey: "ouACentralDueTo",
  },
  {
    key: "ouB",
    code: "SMKOUB",
    name: "Smoke OU B",
    centralDueFromKey: "ouBCentralDueFrom",
    centralDueToKey: "ouBCentralDueTo",
  },
  {
    key: "ouC",
    code: "SMKOUC",
    name: "Smoke OU C",
    centralDueFromKey: "ouCCentralDueFrom",
    centralDueToKey: "ouCCentralDueTo",
  },
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseOptionalPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function scopedCode(base, suffix) {
  return `${base}${suffix}`.slice(0, 50).toUpperCase();
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildMonthlyPeriods(fiscalYear) {
  return Array.from({ length: 12 }, (_, index) => {
    const monthIndex = index;
    const startDate = new Date(Date.UTC(fiscalYear, monthIndex, 1));
    const endDate = new Date(Date.UTC(fiscalYear, monthIndex + 1, 0));
    return {
      fiscalYear,
      periodNo: index + 1,
      periodName: `${fiscalYear}-P${String(index + 1).padStart(2, "0")}`,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    };
  });
}

function getCurrentFiscalYears() {
  const currentYear = new Date().getUTCFullYear();
  return [currentYear - 1, currentYear, currentYear + 1];
}

function readEnvPair(tenantVarName, legalEntityVarName) {
  const tenantId = parseOptionalPositiveInt(process.env[tenantVarName]);
  const legalEntityId = parseOptionalPositiveInt(process.env[legalEntityVarName]);
  if ((tenantId && !legalEntityId) || (!tenantId && legalEntityId)) {
    throw new Error(
      `Set both ${tenantVarName} and ${legalEntityVarName}, or neither of them.`
    );
  }
  return tenantId && legalEntityId ? { tenantId, legalEntityId } : null;
}

function assertAllowedTenant(tenantId, sourceLabel) {
  if (
    tenantId === 1 &&
    !parseBooleanEnv(process.env.ALLOW_TENANT_1_SMOKES, false)
  ) {
    throw new Error(
      `${sourceLabel} resolved tenant 1. Refusing to run against tenant 1 unless ALLOW_TENANT_1_SMOKES=true.`
    );
  }
}

async function resolveUsCountryRow() {
  const result = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = ?
      LIMIT 1`,
    [DEFAULT_COUNTRY_ISO2]
  );
  const row = result.rows?.[0];
  assert(row, `Country ${DEFAULT_COUNTRY_ISO2} is required for smoke bootstrap`);
  return {
    countryId: toPositiveInt(row.id),
    currencyCode:
      normalizeUpper(row.default_currency_code).slice(0, 3) ||
      DEFAULT_FUNCTIONAL_CURRENCY_CODE,
  };
}

async function ensureTenantByCode(code, name) {
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [code, name]
  );
  const result = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [code]
  );
  const tenantId = toPositiveInt(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to resolve tenant ${code}`);
  return tenantId;
}

async function resolveLegalEntityRow(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id, functional_currency_code
       FROM legal_entities
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  return result.rows?.[0] || null;
}

async function ensureGroupCompany({ tenantId, code, name }) {
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [tenantId, code, name]
  );
  const result = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const groupCompanyId = toPositiveInt(result.rows?.[0]?.id);
  assert(groupCompanyId > 0, `Failed to resolve group company ${code}`);
  return groupCompanyId;
}

async function ensureSharedTenantAndLegalEntity() {
  const { countryId, currencyCode: countryCurrencyCode } = await resolveUsCountryRow();
  const tenantId = await ensureTenantByCode(
    DEFAULT_SHARED_TENANT_CODE,
    DEFAULT_SHARED_TENANT_NAME
  );

  await seedCore({
    ensureDefaultTenantIfMissing: true,
  });

  const groupCompanyId = await ensureGroupCompany({
    tenantId,
    code: DEFAULT_SHARED_GROUP_CODE,
    name: DEFAULT_SHARED_GROUP_NAME,
  });

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       group_company_id = VALUES(group_company_id),
       name = VALUES(name),
       country_id = VALUES(country_id),
       functional_currency_code = VALUES(functional_currency_code),
       status = VALUES(status)`,
    [
      tenantId,
      groupCompanyId,
      DEFAULT_SHARED_LEGAL_ENTITY_CODE,
      DEFAULT_SHARED_LEGAL_ENTITY_NAME,
      countryId,
      countryCurrencyCode,
    ]
  );

  const result = await query(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, DEFAULT_SHARED_LEGAL_ENTITY_CODE]
  );
  const legalEntityId = toPositiveInt(result.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to resolve shared smoke legal entity");

  return {
    tenantId,
    legalEntityId,
  };
}

async function ensureFunctionalCurrency({ tenantId, legalEntityId }) {
  const legalEntityRow = await resolveLegalEntityRow(tenantId, legalEntityId);
  assert(
    legalEntityRow,
    `Legal entity ${legalEntityId} not found for tenant ${tenantId}`
  );

  const currencyCode =
    normalizeUpper(legalEntityRow.functional_currency_code).slice(0, 3) ||
    DEFAULT_FUNCTIONAL_CURRENCY_CODE;

  if (!normalizeUpper(legalEntityRow.functional_currency_code)) {
    await query(
      `UPDATE legal_entities
          SET functional_currency_code = ?
        WHERE tenant_id = ?
          AND id = ?`,
      [currencyCode, tenantId, legalEntityId]
    );
  }

  return currencyCode;
}

async function ensureCalendar(tenantId, legalEntityId) {
  const targetCalendarCode = scopedCode("SMKCAL", legalEntityId);
  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     ) VALUES (?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       year_start_month = VALUES(year_start_month),
       year_start_day = VALUES(year_start_day)`,
    [tenantId, targetCalendarCode, `Smoke Calendar ${legalEntityId}`]
  );

  const result = await query(
    `SELECT id
       FROM fiscal_calendars
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, targetCalendarCode]
  );
  const calendarId = toPositiveInt(result.rows?.[0]?.id);
  assert(calendarId > 0, `Failed to resolve smoke calendar ${targetCalendarCode}`);
  return calendarId;
}

async function ensureBookAndPeriods({ tenantId, legalEntityId, currencyCode }) {
  let result = await query(
    `SELECT b.id, b.calendar_id
       FROM books b
      WHERE b.tenant_id = ?
        AND b.legal_entity_id = ?
        AND b.book_type = 'LOCAL'
      ORDER BY CASE WHEN b.code = ? THEN 0 ELSE 1 END,
               b.id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, scopedCode("SMKBOOK", legalEntityId)]
  );

  let bookId = toPositiveInt(result.rows?.[0]?.id);
  let calendarId = toPositiveInt(result.rows?.[0]?.calendar_id);

  if (!calendarId) {
    calendarId = await ensureCalendar(tenantId, legalEntityId);
  }

  if (!bookId) {
    const bookCode = scopedCode("SMKBOOK", legalEntityId);
    await query(
      `INSERT INTO books (
          tenant_id,
          legal_entity_id,
          calendar_id,
          code,
          name,
          book_type,
          base_currency_code
       ) VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)
       ON DUPLICATE KEY UPDATE
         calendar_id = VALUES(calendar_id),
         name = VALUES(name),
         base_currency_code = VALUES(base_currency_code)`,
      [
        tenantId,
        legalEntityId,
        calendarId,
        bookCode,
        `Smoke Local Book ${legalEntityId}`,
        currencyCode,
      ]
    );
    result = await query(
      `SELECT id, calendar_id
         FROM books
        WHERE tenant_id = ?
          AND code = ?
        LIMIT 1`,
      [tenantId, bookCode]
    );
    bookId = toPositiveInt(result.rows?.[0]?.id);
    calendarId = toPositiveInt(result.rows?.[0]?.calendar_id);
  } else {
    await query(
      `UPDATE books
          SET base_currency_code = COALESCE(NULLIF(base_currency_code, ''), ?)
        WHERE id = ?
          AND tenant_id = ?`,
      [currencyCode, bookId, tenantId]
    );
  }

  assert(bookId > 0, `Failed to resolve LOCAL book for tenant ${tenantId}, LE ${legalEntityId}`);
  assert(calendarId > 0, `Failed to resolve calendar for tenant ${tenantId}, LE ${legalEntityId}`);

  for (const fiscalYear of getCurrentFiscalYears()) {
    for (const period of buildMonthlyPeriods(fiscalYear)) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO fiscal_periods (
            calendar_id,
            fiscal_year,
            period_no,
            period_name,
            start_date,
            end_date,
            is_adjustment
         ) VALUES (?, ?, ?, ?, ?, ?, FALSE)
         ON DUPLICATE KEY UPDATE
           period_name = VALUES(period_name),
           start_date = VALUES(start_date),
           end_date = VALUES(end_date),
           is_adjustment = VALUES(is_adjustment)`,
        [
          calendarId,
          period.fiscalYear,
          period.periodNo,
          period.periodName,
          period.startDate,
          period.endDate,
        ]
      );
    }
  }

  return { bookId, calendarId };
}

async function ensureLegalEntityCoa({ tenantId, legalEntityId }) {
  let result = await query(
    `SELECT id
       FROM charts_of_accounts
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND scope = 'LEGAL_ENTITY'
      ORDER BY CASE WHEN code = ? THEN 0 ELSE 1 END,
               id ASC
      LIMIT 1`,
    [tenantId, legalEntityId, scopedCode("SMKCOA", legalEntityId)]
  );
  let coaId = toPositiveInt(result.rows?.[0]?.id);
  if (!coaId) {
    const code = scopedCode("SMKCOA", legalEntityId);
    await query(
      `INSERT INTO charts_of_accounts (
          tenant_id,
          legal_entity_id,
          scope,
          code,
          name
       ) VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name)`,
      [tenantId, legalEntityId, code, `Smoke CoA ${legalEntityId}`]
    );
    result = await query(
      `SELECT id
         FROM charts_of_accounts
        WHERE tenant_id = ?
          AND code = ?
        LIMIT 1`,
      [tenantId, code]
    );
    coaId = toPositiveInt(result.rows?.[0]?.id);
  }
  assert(coaId > 0, `Failed to resolve CoA for tenant ${tenantId}, LE ${legalEntityId}`);
  return coaId;
}

async function ensureAccount({ coaId, blueprint }) {
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
     ) VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       account_type = VALUES(account_type),
       normal_side = VALUES(normal_side),
       allow_posting = VALUES(allow_posting),
       is_active = VALUES(is_active)`,
    [
      coaId,
      blueprint.code,
      blueprint.name,
      blueprint.accountType,
      blueprint.normalSide,
    ]
  );
  const result = await query(
    `SELECT id
       FROM accounts
      WHERE coa_id = ?
        AND code = ?
      LIMIT 1`,
    [coaId, blueprint.code]
  );
  const accountId = toPositiveInt(result.rows?.[0]?.id);
  assert(accountId > 0, `Failed to resolve account ${blueprint.code}`);
  return accountId;
}

async function ensureAccounts({ coaId }) {
  const accountIds = {};
  for (const blueprint of ACCOUNT_BLUEPRINTS) {
    // eslint-disable-next-line no-await-in-loop
    accountIds[blueprint.key] = await ensureAccount({ coaId, blueprint });
  }
  return accountIds;
}

async function ensurePurposeMappings({ tenantId, legalEntityId, accountIds }) {
  for (const [purposeCode, accountKey] of PURPOSE_MAPPINGS) {
    const accountId = toPositiveInt(accountIds[accountKey]);
    assert(accountId > 0, `Account ${accountKey} missing for purpose ${purposeCode}`);
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO journal_purpose_accounts (
          tenant_id,
          legal_entity_id,
          purpose_code,
          account_id
       ) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id)`,
      [tenantId, legalEntityId, purposeCode, accountId]
    );
  }
}

async function ensureOperatingUnit({ tenantId, legalEntityId, blueprint }) {
  const code = scopedCode(blueprint.code, legalEntityId);
  await query(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        status
     ) VALUES (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       legal_entity_id = VALUES(legal_entity_id),
       name = VALUES(name),
       unit_type = VALUES(unit_type),
       has_subledger = VALUES(has_subledger),
       status = VALUES(status)`,
    [tenantId, legalEntityId, code, `${blueprint.name} ${legalEntityId}`]
  );
  const result = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const operatingUnitId = toPositiveInt(result.rows?.[0]?.id);
  assert(operatingUnitId > 0, `Failed to resolve operating unit ${code}`);
  return operatingUnitId;
}

async function ensureOperatingUnits({ tenantId, legalEntityId, accountIds }) {
  const operatingUnitIds = {};
  for (const blueprint of OPERATING_UNIT_BLUEPRINTS) {
    // eslint-disable-next-line no-await-in-loop
    const operatingUnitId = await ensureOperatingUnit({
      tenantId,
      legalEntityId,
      blueprint,
    });
    operatingUnitIds[blueprint.key] = operatingUnitId;
    // eslint-disable-next-line no-await-in-loop
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
        accountIds[blueprint.centralDueFromKey],
        accountIds[blueprint.centralDueToKey],
        accountIds[blueprint.centralDueFromKey],
        accountIds[blueprint.centralDueToKey],
        tenantId,
        legalEntityId,
        operatingUnitId,
      ]
    );
  }

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
      operatingUnitIds.ouA,
      operatingUnitIds.ouB,
      accountIds.ouAToBDueFrom,
      accountIds.ouAToBDueTo,
      tenantId,
      legalEntityId,
      operatingUnitIds.ouB,
      operatingUnitIds.ouA,
      accountIds.ouBToADueFrom,
      accountIds.ouBToADueTo,
    ]
  );

  return operatingUnitIds;
}

async function prepareSmokeContext({ tenantId, legalEntityId, sourceLabel }) {
  assertAllowedTenant(tenantId, sourceLabel);
  const legalEntityRow = await resolveLegalEntityRow(tenantId, legalEntityId);
  assert(
    legalEntityRow,
    `${sourceLabel} resolved tenantId=${tenantId}, legalEntityId=${legalEntityId}, but that legal entity does not exist.`
  );

  const currencyCode = await ensureFunctionalCurrency({ tenantId, legalEntityId });
  await ensureBookAndPeriods({ tenantId, legalEntityId, currencyCode });
  const coaId = await ensureLegalEntityCoa({ tenantId, legalEntityId });
  const accountIds = await ensureAccounts({ coaId });
  await ensurePurposeMappings({ tenantId, legalEntityId, accountIds });
  const operatingUnitIds = await ensureOperatingUnits({
    tenantId,
    legalEntityId,
    accountIds,
  });

  return {
    tenantId,
    legalEntityId,
    currencyCode,
    sourceOuId: operatingUnitIds.ouA,
    targetOuId: operatingUnitIds.ouB,
  };
}

export async function resolveOrPrepareSmokeContext({ prefix }) {
  const normalizedPrefix = normalizeUpper(prefix);
  assert(normalizedPrefix, "Smoke context prefix is required");

  await seedCore({
    ensureDefaultTenantIfMissing: true,
  });

  const explicit = readEnvPair(
    `${normalizedPrefix}_SMOKE_TENANT_ID`,
    `${normalizedPrefix}_SMOKE_LEGAL_ENTITY_ID`
  );
  if (explicit) {
    return prepareSmokeContext({
      tenantId: explicit.tenantId,
      legalEntityId: explicit.legalEntityId,
      sourceLabel: `${normalizedPrefix}_SMOKE_*`,
    });
  }

  const sharedDefault = readEnvPair(
    "SMOKE_DEFAULT_TENANT_ID",
    "SMOKE_DEFAULT_LEGAL_ENTITY_ID"
  );
  if (sharedDefault) {
    return prepareSmokeContext({
      tenantId: sharedDefault.tenantId,
      legalEntityId: sharedDefault.legalEntityId,
      sourceLabel: "SMOKE_DEFAULT_*",
    });
  }

  const shared = await ensureSharedTenantAndLegalEntity();
  return prepareSmokeContext({
    tenantId: shared.tenantId,
    legalEntityId: shared.legalEntityId,
    sourceLabel: "shared smoke tenant",
  });
}
