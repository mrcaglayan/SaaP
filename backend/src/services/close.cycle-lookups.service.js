import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertConsolidationGroupBelongsToTenant,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import { hasScopeAccessForContext } from "./authz.scope.service.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function resolveLookupScopeContext(actorCtx = {}) {
  return (
    actorCtx?.req?.rbac?.visibilityScopeContext ||
    actorCtx?.req?.rbac?.permissionScopeContext ||
    null
  );
}

function hasAccessForLookup(scopeContext, scopeKind, scopeId) {
  if (!scopeContext) {
    return true;
  }
  return hasScopeAccessForContext(scopeContext, scopeKind, scopeId);
}

function mapLegalEntityLookupRow(row) {
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || "").trim() || null,
    name: String(row.name || "").trim() || null,
    groupCompanyId: parsePositiveInt(row.group_company_id),
    countryId: parsePositiveInt(row.country_id),
    status: String(row.status || "").trim().toUpperCase() || null,
  };
}

function mapConsolidationGroupLookupRow(row) {
  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || "").trim() || null,
    name: String(row.name || "").trim() || null,
    groupCompanyId: parsePositiveInt(row.group_company_id),
    calendarId: parsePositiveInt(row.calendar_id),
    presentationCurrencyCode:
      String(row.presentation_currency_code || "").trim().toUpperCase() || null,
    status: String(row.status || "").trim().toUpperCase() || null,
  };
}

function mapFiscalPeriodLookupRow(row) {
  return {
    id: parsePositiveInt(row.id),
    calendarId: parsePositiveInt(row.calendar_id),
    fiscalYear: Number(row.fiscal_year || 0) || null,
    periodNo: Number(row.period_no || 0) || null,
    periodName: String(row.period_name || "").trim() || null,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
  };
}

function buildIdPlaceholders(ids = []) {
  return ids.map(() => "?").join(", ");
}

async function listProvisionableEntityCalendarIds({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT DISTINCT b.calendar_id
     FROM books b
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND b.book_type = 'LOCAL'
       AND b.calendar_id IS NOT NULL
     ORDER BY b.calendar_id ASC`,
    [tenantId, legalEntityId],
  );

  return Array.from(
    new Set(
      (result.rows || [])
        .map((row) => parsePositiveInt(row?.calendar_id))
        .filter(Boolean),
    ),
  );
}

async function listFiscalPeriodsForCalendarIds({
  calendarIds = [],
  runQuery = query,
}) {
  if (!calendarIds.length) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       id,
       calendar_id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date
     FROM fiscal_periods
     WHERE calendar_id IN (${buildIdPlaceholders(calendarIds)})
     ORDER BY end_date DESC, id DESC`,
    calendarIds,
  );

  return (result.rows || []).map(mapFiscalPeriodLookupRow);
}

/**
 * Return the cycle-creation scope options that the actor can both see and act
 * on. This keeps the manager route close-owned instead of depending on
 * unrelated org or consolidation-admin browse APIs.
 */
export async function listCloseCycleScopeOptions(actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const scopeContext = resolveLookupScopeContext(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const [legalEntityResult, consolidationGroupResult] = await Promise.all([
    runQuery(
      `SELECT
         id,
         code,
         name,
         group_company_id,
         country_id,
         status
       FROM legal_entities
       WHERE tenant_id = ?
       ORDER BY code ASC, name ASC, id ASC`,
      [tenantId],
    ),
    runQuery(
      `SELECT
         id,
         code,
         name,
         group_company_id,
         calendar_id,
         presentation_currency_code,
         status
       FROM consolidation_groups
       WHERE tenant_id = ?
       ORDER BY code ASC, name ASC, id ASC`,
      [tenantId],
    ),
  ]);

  const legalEntities = (legalEntityResult.rows || [])
    .filter((row) => hasAccessForLookup(scopeContext, "legal_entity", row.id))
    .map(mapLegalEntityLookupRow);
  const consolidationGroups = (consolidationGroupResult.rows || [])
    .filter((row) =>
      hasAccessForLookup(scopeContext, "group", row.group_company_id),
    )
    .map(mapConsolidationGroupLookupRow);

  return {
    legalEntities,
    consolidationGroups,
  };
}

/**
 * Return create-form fiscal periods from a close-owned lookup seam.
 *
 * Entity-scoped creation stays aligned with the same LOCAL-book eligibility
 * used later by provisioning. That avoids surfacing tenant-wide period choices
 * that can never produce a provisionable entity cycle once the user clicks
 * create and later provisions the cycle.
 */
export async function listCloseCycleCreateFiscalPeriods(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const scopeContext = resolveLookupScopeContext(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const scopeKind = toUpperText(
    filters?.scopeKind ||
      (filters?.consolidationGroupId ? "CONSOLIDATION_GROUP" : "LEGAL_ENTITY"),
  );

  if (scopeKind === "CONSOLIDATION_GROUP") {
    const consolidationGroupId = parsePositiveInt(filters?.consolidationGroupId);
    if (!consolidationGroupId) {
      throw badRequest("consolidationGroupId is required for consolidation-group fiscal periods");
    }

    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      consolidationGroupId,
      "consolidationGroupId",
    );
    if (
      !hasAccessForLookup(scopeContext, "group", group.group_company_id)
    ) {
      throw forbidden("Consolidation group is outside your close-cycle scope");
    }

    const result = await runQuery(
      `SELECT
         id,
         calendar_id,
         fiscal_year,
         period_no,
         period_name,
         start_date,
         end_date
       FROM fiscal_periods
       WHERE calendar_id = ?
       ORDER BY end_date DESC, id DESC`,
      [parsePositiveInt(group.calendar_id)],
    );

    const rows = (result.rows || []).map(mapFiscalPeriodLookupRow);
    return {
      rows,
      total: rows.length,
      calendarIds: [parsePositiveInt(group.calendar_id)].filter(Boolean),
    };
  }

  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  if (!legalEntityId) {
    return {
      rows: [],
      total: 0,
      calendarIds: [],
    };
  }

  const entity = await assertLegalEntityBelongsToTenant(
    tenantId,
    legalEntityId,
    "legalEntityId",
  );
  if (!hasAccessForLookup(scopeContext, "legal_entity", entity.id)) {
    throw forbidden("Legal entity is outside your close-cycle scope");
  }

  const calendarIds = await listProvisionableEntityCalendarIds({
    tenantId,
    legalEntityId,
    runQuery,
  });
  if (!calendarIds.length) {
    // Keep the create catalog honest for entity cycles. Operators can still hit
    // the explicit provision-time empty-scope validation through direct API use,
    // but the normal manager flow should not advertise impossible period picks.
    return {
      rows: [],
      total: 0,
      calendarIds: [],
    };
  }

  const rows = await listFiscalPeriodsForCalendarIds({
    calendarIds,
    runQuery,
  });
  return {
    rows,
    total: rows.length,
    calendarIds,
  };
}

export default {
  listCloseCycleScopeOptions,
  listCloseCycleCreateFiscalPeriods,
};
