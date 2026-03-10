import {
  fetchFiscalCalendarById,
  fetchFiscalCalendarRows,
  fetchFiscalPeriodRows,
  fetchCountryRows,
  fetchCurrencyRows,
  fetchGroupCompanyRows,
  fetchLegalEntityRows,
  fetchOperatingUnitPartnerCurrentAccountRows,
  fetchOperatingUnitRows,
  fetchShareholderJournalConfigRows,
  fetchShareholderRows,
  fetchTreeCountryRows,
  fetchTreeGroupRows,
  fetchTreeLegalEntityRows,
  fetchTreeOperatingUnitRows,
} from "./org.read.queries.js";
import { badRequest } from "../routes/_utils.js";

export async function listGroupCompanies({ req, tenantId, buildScopeFilter }) {
  const params = [];
  const scopeFilter = buildScopeFilter(req, "group", "id", params);
  return fetchGroupCompanyRows({
    tenantId,
    scopeFilter,
    params,
  });
}

export async function listCountries({ req, buildScopeFilter }) {
  const params = [];
  const scopeFilter = buildScopeFilter(req, "country", "c.id", params);
  return fetchCountryRows({
    scopeFilter,
    params,
  });
}

export async function listCurrencies() {
  return fetchCurrencyRows();
}

export async function listLegalEntities({
  req,
  tenantId,
  filters,
  buildScopeFilter,
}) {
  const { countryId, groupCompanyId, status } = filters;

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

  return fetchLegalEntityRows({
    conditions,
    params,
  });
}

export async function listOperatingUnits({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const { legalEntityId, operatingUnitId } = filters;

  if (legalEntityId) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }
  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  }

  const params = [tenantId];
  const conditions = ["ou.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "operating_unit", "ou.id", params));

  if (legalEntityId) {
    conditions.push("ou.legal_entity_id = ?");
    params.push(legalEntityId);
  }
  if (operatingUnitId) {
    conditions.push("ou.id = ?");
    params.push(operatingUnitId);
  }

  return fetchOperatingUnitRows({
    conditions,
    params,
  });
}

export async function listOperatingUnitPartnerCurrentAccounts({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  const { legalEntityId, operatingUnitId, partnerOperatingUnitId } = filters;

  if (legalEntityId) {
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }
  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  }
  if (partnerOperatingUnitId) {
    assertScopeAccess(req, "operating_unit", partnerOperatingUnitId, "partnerOperatingUnitId");
  }

  const params = [tenantId];
  const conditions = ["map.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "operating_unit", "map.operating_unit_id", params));

  if (legalEntityId) {
    conditions.push("map.legal_entity_id = ?");
    params.push(legalEntityId);
  }
  if (operatingUnitId) {
    conditions.push("map.operating_unit_id = ?");
    params.push(operatingUnitId);
  }
  if (partnerOperatingUnitId) {
    conditions.push("map.partner_operating_unit_id = ?");
    params.push(partnerOperatingUnitId);
  }

  return fetchOperatingUnitPartnerCurrentAccountRows({
    conditions,
    params,
  });
}

export async function listFiscalCalendars({ tenantId }) {
  return fetchFiscalCalendarRows({ tenantId });
}

export async function listFiscalCalendarPeriods({ tenantId, filters }) {
  const { calendarId, fiscalYear } = filters;
  const calendar = await fetchFiscalCalendarById({
    tenantId,
    calendarId,
  });
  if (!calendar) {
    throw badRequest("Calendar not found for tenant");
  }

  const conditions = ["calendar_id = ?"];
  const params = [calendarId];

  if (fiscalYear) {
    conditions.push("fiscal_year = ?");
    params.push(fiscalYear);
  }

  const rows = await fetchFiscalPeriodRows({
    conditions,
    params,
  });

  return {
    calendar,
    fiscalYear: fiscalYear || null,
    rows,
  };
}

export async function listOrgTree({ req, tenantId, buildScopeFilter }) {
  const groupParams = [];
  const groupFilter = buildScopeFilter(req, "group", "id", groupParams);

  const entityParams = [];
  const entityFilter = buildScopeFilter(req, "legal_entity", "id", entityParams);

  const unitParams = [];
  const unitFilter = buildScopeFilter(req, "operating_unit", "ou.id", unitParams);

  const countryParams = [];
  const countryFilter = buildScopeFilter(req, "country", "c.id", countryParams);

  const [groups, countries, legalEntities, operatingUnits] = await Promise.all([
    fetchTreeGroupRows({
      tenantId,
      scopeFilter: groupFilter,
      params: groupParams,
    }),
    fetchTreeCountryRows({
      scopeFilter: countryFilter,
      params: countryParams,
    }),
    fetchTreeLegalEntityRows({
      tenantId,
      scopeFilter: entityFilter,
      params: entityParams,
    }),
    fetchTreeOperatingUnitRows({
      tenantId,
      scopeFilter: unitFilter,
      params: unitParams,
    }),
  ]);

  return {
    groups,
    countries,
    legalEntities,
    operatingUnits,
  };
}

export async function listShareholderJournalConfigs({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
  capitalPurposeCode,
  commitmentPurposeCode,
}) {
  const { legalEntityId } = filters;

  if (legalEntityId) {
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }

  const params = [capitalPurposeCode, commitmentPurposeCode, tenantId];
  const conditions = ["le.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "le.id", params));

  if (legalEntityId) {
    conditions.push("le.id = ?");
    params.push(legalEntityId);
  }

  return fetchShareholderJournalConfigRows({
    conditions,
    params,
  });
}

export async function listShareholders({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  const { legalEntityId, status } = filters;

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

  return fetchShareholderRows({
    conditions,
    params,
  });
}
