import express from "express";
import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  getScopeContext,
  requirePermission,
} from "../middleware/rbac.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import {
  assertCurrencyExists,
  assertCountryExists,
  assertFiscalCalendarBelongsToTenant,
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";

const router = express.Router();
const DEFAULT_GL_ACCOUNTS = [
  {
    code: "1000",
    name: "Cash and Cash Equivalents",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "1100",
    name: "Accounts Receivable",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "2000",
    name: "Accounts Payable",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "3000",
    name: "Retained Earnings",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  },
  {
    code: "4000",
    name: "Revenue",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    code: "5000",
    name: "Operating Expense",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
];

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeCode(rawValue, fallback = "DEFAULT", maxLength = 50) {
  const normalized = String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safe = normalized || fallback;
  return safe.slice(0, maxLength);
}

function normalizeName(rawValue, fallback = "Default Name", maxLength = 255) {
  const normalized = String(rawValue || "").trim();
  return (normalized || fallback).slice(0, maxLength);
}

function parseBooleanValue(rawValue, defaultValue = false) {
  if (rawValue === undefined || rawValue === null) {
    return defaultValue;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "number") {
    return rawValue !== 0;
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  return Boolean(rawValue);
}

function parseOptionalNonNegativeNumber(rawValue, label, defaultValue = null) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a non-negative number`);
  }
  return parsed;
}

function generateAutoJournalNo(prefix = "TAA") {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1_679_616)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0");
  return `${String(prefix).slice(0, 8).toUpperCase()}-${stamp}-${rand}`.slice(0, 40);
}

function normalizeMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function toCommitmentJournalFailureMessage(reason) {
  switch (String(reason || "")) {
    case "CAPITAL_SUB_ACCOUNT_REQUIRED":
      return "capitalSubAccountId is required to create commitment journal";
    case "AUTH_USER_REQUIRED":
      return "Authenticated user is required to create commitment journal";
    case "NO_OPEN_BOOK_PERIOD":
      return "No OPEN book/fiscal period found for legalEntityId";
    case "UNPAID_CAPITAL_ACCOUNT_NOT_FOUND":
      return "Missing active postable debit-side 501* equity account for commitment journal";
    default:
      return "Commitment journal could not be created";
  }
}

function toJournalContextRow(row) {
  if (!row) {
    return null;
  }
  return {
    bookId: parsePositiveInt(row.book_id),
    bookCode: String(row.book_code || ""),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    startDate: String(row.start_date || ""),
    endDate: String(row.end_date || ""),
    baseCurrencyCode: String(row.base_currency_code || "USD").toUpperCase(),
  };
}

async function resolveOpenBookPeriodForLegalEntity(
  tx,
  tenantId,
  legalEntityId,
  asOfDate
) {
  const currentResult = await tx.query(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.base_currency_code,
       fp.id AS fiscal_period_id,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND ? BETWEEN fp.start_date AND fp.end_date
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     ORDER BY b.id, fp.start_date DESC
     LIMIT 1`,
    [tenantId, legalEntityId, asOfDate]
  );
  const current = toJournalContextRow(currentResult.rows[0]);
  if (current) {
    return current;
  }

  const pastResult = await tx.query(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.base_currency_code,
       fp.id AS fiscal_period_id,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND fp.start_date <= ?
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     ORDER BY fp.start_date DESC
     LIMIT 1`,
    [tenantId, legalEntityId, asOfDate]
  );
  const past = toJournalContextRow(pastResult.rows[0]);
  if (past) {
    return past;
  }

  const futureResult = await tx.query(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.base_currency_code,
       fp.id AS fiscal_period_id,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND fp.start_date > ?
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     ORDER BY fp.start_date ASC
     LIMIT 1`,
    [tenantId, legalEntityId, asOfDate]
  );
  return toJournalContextRow(futureResult.rows[0]);
}

async function resolveUnpaidCapitalDebitAccount(
  tx,
  tenantId,
  legalEntityId
) {
  const result = await tx.query(
    `SELECT
       a.id,
       a.code,
       a.name
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE
       AND a.account_type = 'EQUITY'
       AND a.normal_side = 'DEBIT'
       AND a.code LIKE '501%'
       AND NOT EXISTS (
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       )
     ORDER BY CASE WHEN a.code = '501' THEN 0 ELSE 1 END, LENGTH(a.code), a.code
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
  };
}

async function createShareholderCommitmentDraftJournal(tx, payload) {
  const amount = normalizeMoney(payload.amount);
  if (amount <= 0) {
    return {
      attempted: false,
      created: false,
      reason: "NO_COMMITTED_CAPITAL_INCREASE",
      amount: 0,
    };
  }

  if (!payload.capitalSubAccountId) {
    return {
      attempted: true,
      created: false,
      reason: "CAPITAL_SUB_ACCOUNT_REQUIRED",
      amount,
    };
  }

  if (!payload.userId) {
    return {
      attempted: true,
      created: false,
      reason: "AUTH_USER_REQUIRED",
      amount,
    };
  }

  const today = toIsoDate(new Date());
  const journalContext = await resolveOpenBookPeriodForLegalEntity(
    tx,
    payload.tenantId,
    payload.legalEntityId,
    today
  );
  if (!journalContext?.bookId || !journalContext?.fiscalPeriodId) {
    return {
      attempted: true,
      created: false,
      reason: "NO_OPEN_BOOK_PERIOD",
      amount,
    };
  }

  const unpaidCapitalAccount = await resolveUnpaidCapitalDebitAccount(
    tx,
    payload.tenantId,
    payload.legalEntityId
  );
  if (!unpaidCapitalAccount?.id) {
    return {
      attempted: true,
      created: false,
      reason: "UNPAID_CAPITAL_ACCOUNT_NOT_FOUND",
      amount,
      bookId: journalContext.bookId,
      fiscalPeriodId: journalContext.fiscalPeriodId,
    };
  }

  const entryDate =
    today >= journalContext.startDate && today <= journalContext.endDate
      ? today
      : journalContext.startDate;
  const documentDate = entryDate;
  const journalNo = generateAutoJournalNo("TAAHHUT");
  const description = `Shareholder commitment (${payload.shareholderCode})`;
  const referenceNo = `SHAREHOLDER_COMMITMENT:${payload.shareholderId}:${Date.now()}`.slice(
    0,
    100
  );
  const currencyCode = String(
    journalContext.baseCurrencyCode || payload.currencyCode || "USD"
  ).toUpperCase();

  const entryResult = await tx.query(
    `INSERT INTO journal_entries (
        tenant_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        journal_no,
        source_type,
        status,
        entry_date,
        document_date,
        currency_code,
        description,
        reference_no,
        total_debit_base,
        total_credit_base,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      journalContext.bookId,
      journalContext.fiscalPeriodId,
      journalNo,
      entryDate,
      documentDate,
      currencyCode,
      description,
      referenceNo,
      amount,
      amount,
      payload.userId,
    ]
  );
  const journalEntryId = parsePositiveInt(entryResult.rows.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create shareholder commitment journal");
  }

  await tx.query(
    `INSERT INTO journal_lines (
        journal_entry_id,
        line_no,
        account_id,
        operating_unit_id,
        counterparty_legal_entity_id,
        description,
        currency_code,
        amount_txn,
        debit_base,
        credit_base,
        tax_code
      )
      VALUES (?, 1, ?, NULL, NULL, ?, ?, ?, ?, 0, NULL)`,
    [
      journalEntryId,
      unpaidCapitalAccount.id,
      `Shareholder commitment receivable (${payload.shareholderCode})`,
      currencyCode,
      amount,
      amount,
    ]
  );

  await tx.query(
    `INSERT INTO journal_lines (
        journal_entry_id,
        line_no,
        account_id,
        operating_unit_id,
        counterparty_legal_entity_id,
        description,
        currency_code,
        amount_txn,
        debit_base,
        credit_base,
        tax_code
      )
      VALUES (?, 2, ?, NULL, NULL, ?, ?, ?, 0, ?, NULL)`,
    [
      journalEntryId,
      payload.capitalSubAccountId,
      `Committed capital (${payload.shareholderCode})`,
      currencyCode,
      amount * -1,
      amount,
    ]
  );

  return {
    attempted: true,
    created: true,
    reason: null,
    journalEntryId,
    journalNo,
    bookId: journalContext.bookId,
    bookCode: journalContext.bookCode,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    entryDate,
    amount,
    debitAccountId: unpaidCapitalAccount.id,
    debitAccountCode: unpaidCapitalAccount.code,
    creditAccountId: payload.capitalSubAccountId,
  };
}

async function resolveLegalEntityByCode(tx, tenantId, code) {
  const result = await tx.query(
    `SELECT id, code, name, functional_currency_code
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Unable to resolve legal entity after upsert");
  }

  const id = parsePositiveInt(row.id);
  if (!id) {
    throw new Error("Invalid legal entity id");
  }

  return {
    id,
    code: String(row.code || ""),
    name: String(row.name || ""),
    functionalCurrencyCode: String(row.functional_currency_code || "USD").toUpperCase(),
  };
}

async function resolveOrCreateDefaultFiscalCalendar(tx, tenantId) {
  const existing = await tx.query(
    `SELECT id, code, name, year_start_month, year_start_day
     FROM fiscal_calendars
     WHERE tenant_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      id: parsePositiveInt(row.id),
      code: String(row.code || ""),
      name: String(row.name || ""),
      yearStartMonth: Number(row.year_start_month || 1),
      yearStartDay: Number(row.year_start_day || 1),
      created: false,
    };
  }

  const code = "MAIN";
  const name = "Main Calendar";
  const yearStartMonth = 1;
  const yearStartDay = 1;
  await tx.query(
    `INSERT INTO fiscal_calendars (
        tenant_id, code, name, year_start_month, year_start_day
     )
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       year_start_month = VALUES(year_start_month),
       year_start_day = VALUES(year_start_day)`,
    [tenantId, code, name, yearStartMonth, yearStartDay]
  );

  const created = await tx.query(
    `SELECT id, code, name, year_start_month, year_start_day
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = created.rows[0];
  if (!row) {
    throw new Error("Unable to resolve fiscal calendar");
  }

  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    yearStartMonth: Number(row.year_start_month || 1),
    yearStartDay: Number(row.year_start_day || 1),
    created: true,
  };
}

async function ensureFiscalPeriodsForYear(tx, calendar, fiscalYear) {
  let created = 0;
  for (let i = 0; i < 12; i += 1) {
    const periodNo = i + 1;
    const existing = await tx.query(
      `SELECT id
       FROM fiscal_periods
       WHERE calendar_id = ?
         AND fiscal_year = ?
         AND period_no = ?
         AND is_adjustment = FALSE
       LIMIT 1`,
      [calendar.id, fiscalYear, periodNo]
    );
    if (existing.rows[0]) {
      continue;
    }

    const monthOffset = calendar.yearStartMonth - 1 + i;
    const start = new Date(Date.UTC(fiscalYear, monthOffset, calendar.yearStartDay));
    const nextStart = new Date(
      Date.UTC(fiscalYear, monthOffset + 1, calendar.yearStartDay)
    );
    const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
    const periodName = `P${String(periodNo).padStart(2, "0")}`;

    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO fiscal_periods (
          calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
       )
       VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
      [calendar.id, fiscalYear, periodNo, periodName, toIsoDate(start), toIsoDate(end)]
    );
    created += 1;
  }
  return created;
}

async function resolveOrCreateDefaultCoa(tx, tenantId, legalEntity) {
  const existing = await tx.query(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND scope = 'LEGAL_ENTITY'
     ORDER BY id
     LIMIT 1`,
    [tenantId, legalEntity.id]
  );
  if (existing.rows[0]) {
    return {
      id: parsePositiveInt(existing.rows[0].id),
      code: String(existing.rows[0].code || ""),
      created: false,
    };
  }

  const code = normalizeCode(`COA-${legalEntity.code}`, `COA-${legalEntity.id}`);
  const name = normalizeName(`${legalEntity.name} CoA`, "Default CoA");
  await tx.query(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
     )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       legal_entity_id = VALUES(legal_entity_id),
       scope = VALUES(scope)`,
    [tenantId, legalEntity.id, code, name]
  );

  const resolved = await tx.query(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = resolved.rows[0];
  if (!row) {
    throw new Error("Unable to resolve chart of accounts");
  }

  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    created: true,
  };
}

async function ensureDefaultAccountsForCoa(tx, coaId) {
  const existing = await tx.query(
    `SELECT COUNT(*) AS count
     FROM accounts
     WHERE coa_id = ?`,
    [coaId]
  );
  const existingCount = Number(existing.rows[0]?.count || 0);
  if (existingCount > 0) {
    return 0;
  }

  let created = 0;
  for (const account of DEFAULT_GL_ACCOUNTS) {
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO accounts (
          coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id
       )
       VALUES (?, ?, ?, ?, ?, TRUE, NULL)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_type = VALUES(account_type),
         normal_side = VALUES(normal_side),
         allow_posting = VALUES(allow_posting)`,
      [
        coaId,
        String(account.code).trim(),
        String(account.name).trim(),
        String(account.accountType).toUpperCase(),
        String(account.normalSide).toUpperCase(),
      ]
    );
    created += 1;
  }
  return created;
}

async function resolveOrCreateDefaultBook(tx, tenantId, legalEntity, calendarId) {
  const existing = await tx.query(
    `SELECT id, code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId, legalEntity.id]
  );
  if (existing.rows[0]) {
    return {
      id: parsePositiveInt(existing.rows[0].id),
      code: String(existing.rows[0].code || ""),
      created: false,
    };
  }

  const code = normalizeCode(`BOOK-${legalEntity.code}`, `BOOK-${legalEntity.id}`);
  const name = normalizeName(`${legalEntity.name} Book`, "Default Book");
  const baseCurrencyCode = normalizeCode(
    legalEntity.functionalCurrencyCode || "USD",
    "USD",
    3
  );
  await tx.query(
    `INSERT INTO books (
        tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code
     )
     VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       calendar_id = VALUES(calendar_id),
       base_currency_code = VALUES(base_currency_code)`,
    [tenantId, legalEntity.id, calendarId, code, name, baseCurrencyCode]
  );

  const resolved = await tx.query(
    `SELECT id, code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntity.id, code]
  );
  const row = resolved.rows[0];
  if (!row) {
    throw new Error("Unable to resolve book");
  }

  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    created: true,
  };
}

async function autoProvisionLegalEntityGl(tx, tenantId, legalEntity, fiscalYear) {
  const calendar = await resolveOrCreateDefaultFiscalCalendar(tx, tenantId);
  const fiscalPeriodsCreated = await ensureFiscalPeriodsForYear(tx, calendar, fiscalYear);
  const coa = await resolveOrCreateDefaultCoa(tx, tenantId, legalEntity);
  const accountsCreated = await ensureDefaultAccountsForCoa(tx, coa.id);
  const book = await resolveOrCreateDefaultBook(tx, tenantId, legalEntity, calendar.id);

  return {
    calendarId: calendar.id,
    calendarCode: calendar.code,
    coaId: coa.id,
    coaCode: coa.code,
    bookId: book.id,
    bookCode: book.code,
    created: {
      fiscalCalendars: calendar.created ? 1 : 0,
      fiscalPeriods: fiscalPeriodsCreated,
      chartsOfAccounts: coa.created ? 1 : 0,
      accounts: accountsCreated,
      books: book.created ? 1 : 0,
    },
  };
}

router.get(
  "/tree",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupParams = [tenantId];
    const groupFilter = buildScopeFilter(req, "group", "id", groupParams);

    const entityParams = [tenantId];
    const entityFilter = buildScopeFilter(req, "legal_entity", "id", entityParams);

    const unitParams = [tenantId];
    const unitFilter = buildScopeFilter(req, "operating_unit", "id", unitParams);

    const countryParams = [];
    const countryFilter = buildScopeFilter(req, "country", "c.id", countryParams);

    const [groups, countries, entities, units] = await Promise.all([
      query(
        `SELECT id, code, name, created_at
         FROM group_companies
         WHERE tenant_id = ?
           AND ${groupFilter}
         ORDER BY id`,
        groupParams
      ),
      query(
        `SELECT c.id, c.iso2, c.iso3, c.name, c.default_currency_code
         FROM countries c
         WHERE ${countryFilter}
         ORDER BY c.name`,
        countryParams
      ),
      query(
        `SELECT
           id,
           group_company_id,
           code,
           name,
           tax_id,
           country_id,
           functional_currency_code,
           status,
           is_intercompany_enabled,
           intercompany_partner_required
         FROM legal_entities
         WHERE tenant_id = ?
           AND ${entityFilter}
         ORDER BY id`,
        entityParams
      ),
      query(
        `SELECT id, legal_entity_id, code, name, unit_type, has_subledger, status
         FROM operating_units
         WHERE tenant_id = ?
           AND ${unitFilter}
         ORDER BY id`,
        unitParams
      ),
    ]);

    return res.json({
      tenantId,
      groups: groups.rows,
      countries: countries.rows,
      legalEntities: entities.rows,
      operatingUnits: units.rows,
      rbacSource: req.rbac?.source || null,
      tenantWideScope: Boolean(getScopeContext(req)?.tenantWide),
    });
  })
);

router.get(
  "/group-companies",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const params = [tenantId];
    const scopeFilter = buildScopeFilter(req, "group", "id", params);

    const result = await query(
      `SELECT id, tenant_id, code, name, created_at
       FROM group_companies
       WHERE tenant_id = ?
         AND ${scopeFilter}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/countries",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const params = [];
    const countryFilter = buildScopeFilter(req, "country", "c.id", params);

    const result = await query(
      `SELECT c.id, c.iso2, c.iso3, c.name, c.default_currency_code
       FROM countries c
       WHERE ${countryFilter}
       ORDER BY c.name`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/currencies",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await query(
      `SELECT code, name, minor_units
       FROM currencies
       ORDER BY code`
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/legal-entities",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const countryId = parsePositiveInt(req.query.countryId);
    const groupCompanyId = parsePositiveInt(req.query.groupCompanyId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;

    const params = [tenantId];
    const conditions = ["tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "id", params));

    if (countryId) {
      conditions.push("country_id = ?");
      params.push(countryId);
    }
    if (groupCompanyId) {
      conditions.push("group_company_id = ?");
      params.push(groupCompanyId);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         id,
         tenant_id,
         group_company_id,
         code,
         name,
         tax_id,
         country_id,
         functional_currency_code,
         status,
         is_intercompany_enabled,
         intercompany_partner_required,
         created_at,
         updated_at
       FROM legal_entities
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/operating-units",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const params = [tenantId];
    const conditions = ["tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "operating_unit", "id", params));

    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT
         id,
         tenant_id,
         legal_entity_id,
         code,
         name,
         unit_type,
         has_subledger,
         status,
         created_at
       FROM operating_units
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/fiscal-calendars",
  requirePermission("org.fiscal_calendar.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await query(
      `SELECT id, code, name, year_start_month, year_start_day, created_at
       FROM fiscal_calendars
       WHERE tenant_id = ?
       ORDER BY id`,
      [tenantId]
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/fiscal-calendars/:calendarId/periods",
  requirePermission("org.fiscal_period.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const calendarId = parsePositiveInt(req.params.calendarId);
    if (!calendarId) {
      throw badRequest("calendarId must be a positive integer");
    }

    const fiscalYear = parsePositiveInt(req.query.fiscalYear);

    const calendarResult = await query(
      `SELECT id, code, name
       FROM fiscal_calendars
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [calendarId, tenantId]
    );
    const calendar = calendarResult.rows[0];
    if (!calendar) {
      throw badRequest("Calendar not found for tenant");
    }

    const conditions = ["calendar_id = ?"];
    const params = [calendarId];

    if (fiscalYear) {
      conditions.push("fiscal_year = ?");
      params.push(fiscalYear);
    }

    const periodsResult = await query(
      `SELECT id, calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
       FROM fiscal_periods
       WHERE ${conditions.join(" AND ")}
       ORDER BY fiscal_year, period_no, is_adjustment`,
      params
    );

    return res.json({
      tenantId,
      calendar,
      fiscalYear: fiscalYear || null,
      rows: periodsResult.rows,
    });
  })
);

router.post(
  "/group-companies",
  requirePermission("org.group_company.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["code", "name"]);
    const { code, name } = req.body;

    const existingResult = await query(
      `SELECT id
       FROM group_companies
       WHERE tenant_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, String(code).trim()]
    );
    const existingId = parsePositiveInt(existingResult.rows[0]?.id);
    if (existingId) {
      assertScopeAccess(req, "group", existingId, "groupCompanyId");
    } else if (!getScopeContext(req)?.tenantWide) {
      throw badRequest(
        "Creating a new group company requires tenant-wide data scope"
      );
    }

    const result = await query(
      `INSERT INTO group_companies (tenant_id, code, name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
      [tenantId, String(code).trim(), String(name).trim()]
    );

    return res.status(201).json({
      ok: true,
      id: result.rows.insertId || existingId || null,
      tenantId,
      code,
      name,
    });
  })
);

router.post(
  "/legal-entities",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const groupCompanyId = parsePositiveInt(req.body?.groupCompanyId);
      if (groupCompanyId) {
        return { scopeType: "GROUP", scopeId: groupCompanyId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, [
      "groupCompanyId",
      "code",
      "name",
      "countryId",
      "functionalCurrencyCode",
    ]);

    const groupCompanyId = parsePositiveInt(req.body.groupCompanyId);
    const countryId = parsePositiveInt(req.body.countryId);

    if (!groupCompanyId || !countryId) {
      throw badRequest("groupCompanyId and countryId must be positive integers");
    }

    await assertGroupCompanyBelongsToTenant(tenantId, groupCompanyId, "groupCompanyId");
    await assertCountryExists(countryId, "countryId");

    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
    assertScopeAccess(req, "country", countryId, "countryId");

    const intercompanyEnabled =
      req.body.isIntercompanyEnabled === undefined
        ? true
        : Boolean(req.body.isIntercompanyEnabled);
    const partnerRequired = Boolean(req.body.intercompanyPartnerRequired);
    const autoProvisionDefaults = parseBooleanValue(
      req.body.autoProvisionDefaults,
      false
    );
    const fiscalYear =
      parsePositiveInt(req.body.fiscalYear) || new Date().getUTCFullYear();

    const { code, name, taxId, functionalCurrencyCode } = req.body;
    const normalizedCode = String(code || "").trim();
    const normalizedName = String(name || "").trim();
    if (!normalizedCode || !normalizedName) {
      throw badRequest("code and name are required");
    }
    const normalizedFunctionalCurrencyCode = String(functionalCurrencyCode || "")
      .trim()
      .toUpperCase();
    await assertCurrencyExists(
      normalizedFunctionalCurrencyCode,
      "functionalCurrencyCode"
    );
    const operationResult = await withTransaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO legal_entities (
            tenant_id,
            group_company_id,
            code,
            name,
            tax_id,
            country_id,
            functional_currency_code,
            is_intercompany_enabled,
            intercompany_partner_required
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           tax_id = VALUES(tax_id),
           country_id = VALUES(country_id),
           functional_currency_code = VALUES(functional_currency_code),
           group_company_id = VALUES(group_company_id),
           is_intercompany_enabled = VALUES(is_intercompany_enabled),
           intercompany_partner_required = VALUES(intercompany_partner_required)`,
        [
          tenantId,
          groupCompanyId,
          normalizedCode,
          normalizedName,
          taxId ? String(taxId).trim() : null,
          countryId,
          normalizedFunctionalCurrencyCode,
          intercompanyEnabled,
          partnerRequired,
        ]
      );

      const legalEntity = await resolveLegalEntityByCode(
        tx,
        tenantId,
        normalizedCode
      );
      let provisioning = null;
      if (autoProvisionDefaults) {
        provisioning = await autoProvisionLegalEntityGl(
          tx,
          tenantId,
          legalEntity,
          fiscalYear
        );
      }

      return {
        legalEntity,
        provisioning,
        insertId: result.rows.insertId || null,
      };
    });

    return res.status(201).json({
      ok: true,
      id: operationResult.insertId || operationResult.legalEntity.id,
      legalEntityId: operationResult.legalEntity.id,
      autoProvisionDefaults,
      fiscalYear,
      provisioning: operationResult.provisioning,
    });
  })
);

router.get(
  "/shareholders",
  requirePermission("org.tree.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    if (status && !["ACTIVE", "INACTIVE"].includes(status)) {
      throw badRequest("status must be ACTIVE or INACTIVE");
    }

    if (legalEntityId) {
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const params = [tenantId];
    const conditions = ["s.tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "s.legal_entity_id", params));

    if (legalEntityId) {
      conditions.push("s.legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (status) {
      conditions.push("s.status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         s.id,
         s.tenant_id,
         s.legal_entity_id,
         s.code,
         s.name,
         s.shareholder_type,
         s.tax_id,
         s.ownership_pct,
         s.committed_capital,
         CASE
           WHEN c.id IS NULL THEN 0
           ELSE COALESCE(pc.paid_capital_calculated, 0)
         END AS paid_capital,
         CASE WHEN c.id IS NULL THEN NULL ELSE s.capital_sub_account_id END AS capital_sub_account_id,
         s.currency_code,
         s.status,
         s.notes,
         s.created_at,
         s.updated_at,
         CASE WHEN c.id IS NULL THEN NULL ELSE a.code END AS capital_sub_account_code,
         CASE WHEN c.id IS NULL THEN NULL ELSE a.name END AS capital_sub_account_name,
         CASE WHEN c.id IS NULL THEN NULL ELSE a.account_type END AS capital_sub_account_type
       FROM shareholders s
       LEFT JOIN accounts a ON a.id = s.capital_sub_account_id
       LEFT JOIN charts_of_accounts c
         ON c.id = a.coa_id
        AND c.tenant_id = s.tenant_id
       LEFT JOIN (
         SELECT
           je.tenant_id,
           je.legal_entity_id,
           jl.account_id,
           SUM(jl.credit_base) AS paid_capital_calculated
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         WHERE je.status = 'POSTED'
         GROUP BY je.tenant_id, je.legal_entity_id, jl.account_id
       ) pc
         ON pc.tenant_id = s.tenant_id
        AND pc.legal_entity_id = s.legal_entity_id
        AND pc.account_id = s.capital_sub_account_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY s.legal_entity_id, s.code`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.post(
  "/shareholders",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["legalEntityId", "code", "name"]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }

    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId"
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const code = String(req.body.code || "").trim().toUpperCase();
    const name = String(req.body.name || "").trim();
    if (!code || !name) {
      throw badRequest("code and name are required");
    }

    const shareholderType = String(
      req.body.shareholderType || "INDIVIDUAL"
    ).toUpperCase();
    if (!["INDIVIDUAL", "CORPORATE"].includes(shareholderType)) {
      throw badRequest("shareholderType must be INDIVIDUAL or CORPORATE");
    }

    const status = String(req.body.status || "ACTIVE").toUpperCase();
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw badRequest("status must be ACTIVE or INACTIVE");
    }

    const ownershipPct = parseOptionalNonNegativeNumber(
      req.body.ownershipPct,
      "ownershipPct",
      null
    );
    if (ownershipPct !== null && ownershipPct > 100) {
      throw badRequest("ownershipPct cannot exceed 100");
    }

    const committedCapital = parseOptionalNonNegativeNumber(
      req.body.committedCapital,
      "committedCapital",
      0
    );

    const currencyCode = String(
      req.body.currencyCode || legalEntity.functional_currency_code || "USD"
    )
      .trim()
      .toUpperCase();
    await assertCurrencyExists(currencyCode, "currencyCode");

    const taxId = req.body.taxId ? String(req.body.taxId).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const capitalSubAccountId = req.body.capitalSubAccountId
      ? parsePositiveInt(req.body.capitalSubAccountId)
      : null;
    const autoCommitmentJournal = parseBooleanValue(
      req.body.autoCommitmentJournal,
      true
    );
    const userId = parsePositiveInt(req.user?.userId);
    if (req.body.capitalSubAccountId && !capitalSubAccountId) {
      throw badRequest("capitalSubAccountId must be a positive integer");
    }
    if (autoCommitmentJournal && committedCapital > 0 && !capitalSubAccountId) {
      throw badRequest(
        "capitalSubAccountId is required when committedCapital is greater than 0"
      );
    }

    const operation = await withTransaction(async (tx) => {
      const existingResult = await tx.query(
        `SELECT id, committed_capital, capital_sub_account_id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND code = ?
         LIMIT 1
         FOR UPDATE`,
        [tenantId, legalEntityId, code]
      );
      const existing = existingResult.rows[0] || null;

      if (capitalSubAccountId) {
        const accountResult = await tx.query(
          `SELECT
             a.id,
             a.code,
             a.account_type,
             a.allow_posting,
             a.is_active,
             EXISTS(
               SELECT 1
               FROM accounts child
               WHERE child.parent_account_id = a.id
                 AND child.is_active = TRUE
             ) AS has_active_children,
             c.legal_entity_id
           FROM accounts a
           JOIN charts_of_accounts c ON c.id = a.coa_id
           WHERE a.id = ?
             AND c.tenant_id = ?
           LIMIT 1`,
          [capitalSubAccountId, tenantId]
        );
        const account = accountResult.rows[0];
        if (!account) {
          throw badRequest("capitalSubAccountId not found for tenant");
        }
        if (parsePositiveInt(account.legal_entity_id) !== legalEntityId) {
          throw badRequest(
            "capitalSubAccountId must belong to the selected legalEntityId"
          );
        }
        if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
          throw badRequest("capitalSubAccountId must reference an EQUITY account");
        }
        if (!Boolean(account.is_active)) {
          throw badRequest("capitalSubAccountId must reference an active account");
        }
        if (!Boolean(account.allow_posting)) {
          throw badRequest("capitalSubAccountId must reference a postable account");
        }
        if (Boolean(account.has_active_children)) {
          throw badRequest("capitalSubAccountId must reference a leaf sub-account");
        }

        const mappingConflict = await tx.query(
          `SELECT id
           FROM shareholders
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND capital_sub_account_id = ?
             AND id <> ?
           LIMIT 1`,
          [tenantId, legalEntityId, capitalSubAccountId, parsePositiveInt(existing?.id) || 0]
        );
        if (mappingConflict.rows[0]) {
          throw badRequest(
            "capitalSubAccountId is already assigned to another shareholder"
          );
        }
      }

      await tx.query(
        `INSERT INTO shareholders (
            tenant_id,
            legal_entity_id,
            code,
            name,
            shareholder_type,
            tax_id,
            ownership_pct,
            committed_capital,
            capital_sub_account_id,
            currency_code,
            status,
            notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           shareholder_type = VALUES(shareholder_type),
           tax_id = VALUES(tax_id),
           ownership_pct = VALUES(ownership_pct),
           committed_capital = VALUES(committed_capital),
           capital_sub_account_id = VALUES(capital_sub_account_id),
           currency_code = VALUES(currency_code),
           status = VALUES(status),
           notes = VALUES(notes)`,
        [
          tenantId,
          legalEntityId,
          code,
          name,
          shareholderType,
          taxId,
          ownershipPct,
          committedCapital,
          capitalSubAccountId,
          currencyCode,
          status,
          notes,
        ]
      );

      const savedResult = await tx.query(
        `SELECT id, committed_capital, capital_sub_account_id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, legalEntityId, code]
      );
      const saved = savedResult.rows[0] || null;
      const shareholderId = parsePositiveInt(saved?.id);
      const previousCommittedCapital = normalizeMoney(existing?.committed_capital || 0);
      const currentCommittedCapital = normalizeMoney(saved?.committed_capital || 0);
      const committedCapitalDelta = normalizeMoney(
        currentCommittedCapital - previousCommittedCapital
      );

      let commitmentJournal = {
        attempted: false,
        created: false,
        reason: autoCommitmentJournal ? null : "DISABLED",
        amount: committedCapitalDelta > 0 ? committedCapitalDelta : 0,
      };

      if (autoCommitmentJournal) {
        if (committedCapitalDelta > 0) {
          commitmentJournal = await createShareholderCommitmentDraftJournal(tx, {
            tenantId,
            legalEntityId,
            userId,
            shareholderId,
            shareholderCode: code,
            shareholderName: name,
            amount: committedCapitalDelta,
            currencyCode,
            capitalSubAccountId:
              parsePositiveInt(saved?.capital_sub_account_id) || capitalSubAccountId,
          });
          if (!commitmentJournal.created) {
            throw badRequest(
              toCommitmentJournalFailureMessage(commitmentJournal.reason)
            );
          }
        } else if (committedCapitalDelta < 0) {
          commitmentJournal = {
            attempted: true,
            created: false,
            reason: "COMMITTED_CAPITAL_DECREASE_REQUIRES_MANUAL_REVERSAL",
            amount: Math.abs(committedCapitalDelta),
          };
        } else {
          commitmentJournal = {
            attempted: true,
            created: false,
            reason: "NO_COMMITTED_CAPITAL_INCREASE",
            amount: 0,
          };
        }
      }

      return {
        shareholderId: shareholderId || null,
        committedCapitalDelta,
        commitmentJournal,
      };
    });

    return res.status(201).json({
      ok: true,
      id: operation.shareholderId,
      committedCapitalDelta: operation.committedCapitalDelta,
      commitmentJournal: operation.commitmentJournal,
      autoCommitmentJournal,
    });
  })
);

router.post(
  "/operating-units",
  requirePermission("org.operating_unit.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["legalEntityId", "code", "name"]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }

    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const { code, name, unitType = "BRANCH", hasSubledger = false } = req.body;
    const result = await query(
      `INSERT INTO operating_units (
          tenant_id, legal_entity_id, code, name, unit_type, has_subledger
        )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         unit_type = VALUES(unit_type),
         has_subledger = VALUES(has_subledger)`,
      [
        tenantId,
        legalEntityId,
        String(code).trim(),
        String(name).trim(),
        String(unitType).toUpperCase(),
        Boolean(hasSubledger),
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/fiscal-calendars",
  requirePermission("org.fiscal_calendar.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["code", "name", "yearStartMonth", "yearStartDay"]);

    const yearStartMonth = parsePositiveInt(req.body.yearStartMonth);
    const yearStartDay = parsePositiveInt(req.body.yearStartDay);

    if (!yearStartMonth || yearStartMonth > 12) {
      throw badRequest("yearStartMonth must be between 1 and 12");
    }
    if (!yearStartDay || yearStartDay > 31) {
      throw badRequest("yearStartDay must be between 1 and 31");
    }

    const { code, name } = req.body;
    const result = await query(
      `INSERT INTO fiscal_calendars (
          tenant_id, code, name, year_start_month, year_start_day
        )
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         year_start_month = VALUES(year_start_month),
         year_start_day = VALUES(year_start_day)`,
      [tenantId, String(code).trim(), String(name).trim(), yearStartMonth, yearStartDay]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/fiscal-periods/generate",
  requirePermission("org.fiscal_period.generate"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["calendarId", "fiscalYear"]);

    const calendarId = parsePositiveInt(req.body.calendarId);
    const fiscalYear = parsePositiveInt(req.body.fiscalYear);
    if (!calendarId || !fiscalYear) {
      throw badRequest("calendarId and fiscalYear must be positive integers");
    }

    const calendar = await assertFiscalCalendarBelongsToTenant(
      tenantId,
      calendarId,
      "calendarId"
    );

    for (let i = 0; i < 12; i += 1) {
      const monthOffset = calendar.year_start_month - 1 + i;
      const start = new Date(Date.UTC(fiscalYear, monthOffset, calendar.year_start_day));
      const nextStart = new Date(
        Date.UTC(fiscalYear, monthOffset + 1, calendar.year_start_day)
      );
      const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
      const periodNo = i + 1;
      const periodName = `P${String(periodNo).padStart(2, "0")}`;

      await query(
        `INSERT INTO fiscal_periods (
            calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
         )
         VALUES (?, ?, ?, ?, ?, ?, FALSE)
         ON DUPLICATE KEY UPDATE
           period_name = VALUES(period_name),
           start_date = VALUES(start_date),
           end_date = VALUES(end_date)`,
        [calendarId, fiscalYear, periodNo, periodName, toIsoDate(start), toIsoDate(end)]
      );
    }

    return res.status(201).json({
      ok: true,
      calendarId,
      fiscalYear,
      periodsGenerated: 12,
    });
  })
);

export default router;
