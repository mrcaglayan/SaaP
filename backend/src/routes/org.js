import express from "express";
import { query } from "../db.js";
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
  assertCountryExists,
  assertFiscalCalendarBelongsToTenant,
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";

const router = express.Router();

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
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

    const countryParams = [tenantId];
    const countryEntityFilter = buildScopeFilter(
      req,
      "legal_entity",
      "le.id",
      countryParams
    );

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
         JOIN legal_entities le ON le.country_id = c.id
         WHERE le.tenant_id = ?
           AND ${countryEntityFilter}
         GROUP BY c.id, c.iso2, c.iso3, c.name, c.default_currency_code
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

    const params = [tenantId];
    const countryEntityFilter = buildScopeFilter(req, "legal_entity", "le.id", params);

    const result = await query(
      `SELECT c.id, c.iso2, c.iso3, c.name, c.default_currency_code
       FROM countries c
       JOIN legal_entities le ON le.country_id = c.id
       WHERE le.tenant_id = ?
         AND ${countryEntityFilter}
       GROUP BY c.id, c.iso2, c.iso3, c.name, c.default_currency_code
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

    const { code, name, taxId, functionalCurrencyCode } = req.body;
    const result = await query(
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
        String(code).trim(),
        String(name).trim(),
        taxId ? String(taxId).trim() : null,
        countryId,
        String(functionalCurrencyCode).trim().toUpperCase(),
        intercompanyEnabled,
        partnerRequired,
      ]
    );

    return res.status(201).json({
      ok: true,
      id: result.rows.insertId || null,
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
