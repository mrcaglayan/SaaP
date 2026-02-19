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
    const conditions = ["tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "legal_entity_id", params));

    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         id,
         tenant_id,
         legal_entity_id,
         code,
         name,
         shareholder_type,
         tax_id,
         ownership_pct,
         committed_capital,
         paid_capital,
         currency_code,
         status,
         notes,
         created_at,
         updated_at
       FROM shareholders
       WHERE ${conditions.join(" AND ")}
       ORDER BY legal_entity_id, code`,
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
    const paidCapital = parseOptionalNonNegativeNumber(
      req.body.paidCapital,
      "paidCapital",
      0
    );
    if (paidCapital > committedCapital) {
      throw badRequest("paidCapital cannot exceed committedCapital");
    }

    const currencyCode = String(
      req.body.currencyCode || legalEntity.functional_currency_code || "USD"
    )
      .trim()
      .toUpperCase();
    await assertCurrencyExists(currencyCode, "currencyCode");

    const taxId = req.body.taxId ? String(req.body.taxId).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;

    await query(
      `INSERT INTO shareholders (
          tenant_id,
          legal_entity_id,
          code,
          name,
          shareholder_type,
          tax_id,
          ownership_pct,
          committed_capital,
          paid_capital,
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
         paid_capital = VALUES(paid_capital),
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
        paidCapital,
        currencyCode,
        status,
        notes,
      ]
    );

    const result = await query(
      `SELECT id
       FROM shareholders
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, legalEntityId, code]
    );

    return res.status(201).json({
      ok: true,
      id: parsePositiveInt(result.rows[0]?.id) || null,
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
