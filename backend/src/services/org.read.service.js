import {
  fetchFiscalCalendarById,
  fetchFiscalCalendarRows,
  fetchFiscalPeriodRows,
  fetchCountryRows,
  fetchCurrencyRows,
  fetchGroupCompanyRows,
  fetchLegalEntityRows,
  fetchOperatingUnitCurrentAccountConfigRows,
  fetchOperatingUnitPartnerCurrentAccountRows,
  fetchOperatingUnitRows,
  fetchShareholderJournalConfigRows,
  fetchShareholderRows,
  fetchTreeCountryRows,
  fetchTreeGroupRows,
  fetchTreeLegalEntityRows,
  fetchTreeOperatingUnitRows,
} from "./org.read.queries.js";
import { getVisibilityScope } from "../middleware/rbac.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { buildVisibilityScopeWhereClause } from "./authz.scope.service.js";

function buildLegalEntityVisibilityFilter(req, tenantId, params) {
  const scopeContext = getVisibilityScope(req);
  if (!scopeContext) {
    return "1 = 0";
  }
  if (scopeContext.tenantWide) {
    return "1 = 1";
  }

  const clauses = [];
  const directScopeClause = buildVisibilityScopeWhereClause(scopeContext, params, {
    GROUP: { idColumn: "group_company_id" },
    COUNTRY: { idColumn: "country_id" },
    LEGAL_ENTITY: { idColumn: "id" },
  });
  if (directScopeClause !== "1 = 0") {
    clauses.push(directScopeClause);
  }

  const operatingUnitIds = Array.from(scopeContext.operatingUnits || []).filter(Boolean);
  if (operatingUnitIds.length > 0) {
    params.push(tenantId, ...operatingUnitIds);
    clauses.push(
      `id IN (
        SELECT DISTINCT ou.legal_entity_id
        FROM operating_units ou
        WHERE ou.tenant_id = ?
          AND ou.id IN (${operatingUnitIds.map(() => "?").join(", ")})
      )`
    );
  }

  if (clauses.length === 0) {
    return "1 = 0";
  }
  return `(${clauses.join(" OR ")})`;
}

function normalizeNodeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeOptionalNodeText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function compactMeta(meta = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function buildTreeNode({
  key,
  scopeType,
  scopeId,
  label,
  code = null,
  selectable = false,
  pathLabels = [],
  meta = {},
  children = [],
}) {
  return {
    key,
    scopeType,
    scopeId,
    label,
    code,
    selectable: Boolean(selectable),
    pathLabels: pathLabels
      .map((item) => normalizeNodeText(item))
      .filter(Boolean),
    meta: compactMeta(meta),
    children,
  };
}

function buildSelectableIdSet(scopeContext, key, fallbackIds) {
  if (scopeContext?.tenantWide) {
    return new Set(fallbackIds);
  }
  return new Set(
    Array.from(scopeContext?.[key] || [])
      .map((value) => parsePositiveInt(value))
      .filter(Boolean)
  );
}

function pushNestedMapValue(targetMap, key, value) {
  if (!targetMap.has(key)) {
    targetMap.set(key, []);
  }
  targetMap.get(key).push(value);
}

function buildCountryBranchKey(groupId, countryId) {
  return `COUNTRY:${countryId}:GROUP:${groupId}`;
}

function collectRelevantOrgTreeCountryIds(scopeContext, legalEntityRows = []) {
  const relevantCountryIds = new Set();

  for (const row of legalEntityRows) {
    const countryId = parsePositiveInt(row?.country_id);
    if (countryId) {
      relevantCountryIds.add(countryId);
    }
  }

  for (const countryId of Array.from(scopeContext?.countries || [])) {
    const parsedCountryId = parsePositiveInt(countryId);
    if (parsedCountryId) {
      relevantCountryIds.add(parsedCountryId);
    }
  }

  return relevantCountryIds;
}

function filterOrgTreeCountryRows(countryRows = [], relevantCountryIds = new Set()) {
  if (!(relevantCountryIds instanceof Set) || relevantCountryIds.size === 0) {
    return [];
  }

  return countryRows.filter((row) => relevantCountryIds.has(parsePositiveInt(row?.id)));
}

/**
 * Build the canonical nested org-tree response from backend-owned rows and the
 * request visibility scope. Ancestor-only nodes stay in the tree for
 * navigation, but remain non-selectable unless the current visibility scope
 * explicitly includes them.
 */
export function buildNestedOrgTreeResponse({
  tenantId,
  scopeContext,
  groups,
  countries,
  legalEntities,
  operatingUnits,
  tenantLabel = "Tenant",
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw new Error("tenantId must be a positive integer");
  }

  const resolvedTenantLabel = normalizeNodeText(tenantLabel, "Tenant");
  const groupRows = Array.isArray(groups) ? groups : [];
  const countryRows = Array.isArray(countries) ? countries : [];
  const legalEntityRows = Array.isArray(legalEntities) ? legalEntities : [];
  const operatingUnitRows = Array.isArray(operatingUnits) ? operatingUnits : [];
  const relevantCountryIds = collectRelevantOrgTreeCountryIds(scopeContext, legalEntityRows);

  const groupIds = [];
  const groupRowsById = new Map();
  for (const row of groupRows) {
    const groupId = parsePositiveInt(row?.id);
    if (!groupId || groupRowsById.has(groupId)) {
      continue;
    }
    groupRowsById.set(groupId, row);
    groupIds.push(groupId);
  }

  const countryIds = [];
  const countryRowsById = new Map();
  const countryOrder = new Map();
  for (const row of countryRows) {
    const countryId = parsePositiveInt(row?.id);
    if (!countryId || countryRowsById.has(countryId) || !relevantCountryIds.has(countryId)) {
      continue;
    }
    countryRowsById.set(countryId, row);
    countryOrder.set(countryId, countryOrder.size);
    countryIds.push(countryId);
  }

  const legalEntityIds = [];
  const legalEntityRowsById = new Map();
  for (const row of legalEntityRows) {
    const legalEntityId = parsePositiveInt(row?.id);
    if (!legalEntityId || legalEntityRowsById.has(legalEntityId)) {
      continue;
    }
    legalEntityRowsById.set(legalEntityId, row);
    legalEntityIds.push(legalEntityId);
  }

  const operatingUnitIds = [];
  const operatingUnitRowsById = new Map();
  for (const row of operatingUnitRows) {
    const operatingUnitId = parsePositiveInt(row?.id);
    if (!operatingUnitId || operatingUnitRowsById.has(operatingUnitId)) {
      continue;
    }
    operatingUnitRowsById.set(operatingUnitId, row);
    operatingUnitIds.push(operatingUnitId);
  }

  const selectableGroupIds = buildSelectableIdSet(scopeContext, "groups", groupIds);
  const selectableCountryIds = buildSelectableIdSet(scopeContext, "countries", countryIds);
  const selectableLegalEntityIds = buildSelectableIdSet(
    scopeContext,
    "legalEntities",
    legalEntityIds
  );
  const selectableOperatingUnitIds = buildSelectableIdSet(
    scopeContext,
    "operatingUnits",
    operatingUnitIds
  );

  const includedGroupIds = new Set(selectableGroupIds);
  const includedCountryIds = new Set(selectableCountryIds);
  const includedLegalEntityIds = new Set(selectableLegalEntityIds);
  const includedOperatingUnitIds = new Set(selectableOperatingUnitIds);

  for (const operatingUnitId of includedOperatingUnitIds) {
    const row = operatingUnitRowsById.get(operatingUnitId);
    const legalEntityId = parsePositiveInt(row?.legal_entity_id);
    if (legalEntityId) {
      includedLegalEntityIds.add(legalEntityId);
    }
  }

  for (const legalEntityId of includedLegalEntityIds) {
    const row = legalEntityRowsById.get(legalEntityId);
    const groupId = parsePositiveInt(row?.group_company_id);
    const countryId = parsePositiveInt(row?.country_id);
    if (groupId) {
      includedGroupIds.add(groupId);
    }
    if (countryId) {
      includedCountryIds.add(countryId);
    }
  }

  const operatingUnitsByLegalEntityId = new Map();
  for (const row of operatingUnitRows) {
    const operatingUnitId = parsePositiveInt(row?.id);
    const legalEntityId = parsePositiveInt(row?.legal_entity_id);
    if (!operatingUnitId || !legalEntityId || !includedOperatingUnitIds.has(operatingUnitId)) {
      continue;
    }
    pushNestedMapValue(operatingUnitsByLegalEntityId, legalEntityId, row);
  }

  const legalEntitiesByGroupId = new Map();
  for (const row of legalEntityRows) {
    const legalEntityId = parsePositiveInt(row?.id);
    const groupId = parsePositiveInt(row?.group_company_id);
    if (!legalEntityId || !groupId || !includedLegalEntityIds.has(legalEntityId)) {
      continue;
    }
    pushNestedMapValue(legalEntitiesByGroupId, groupId, row);
  }

  const attachedCountryIds = new Set();
  const attachedLegalEntityIds = new Set();
  const attachedOperatingUnitIds = new Set();

  const buildOperatingUnitNode = (row, pathLabels) => {
    const operatingUnitId = parsePositiveInt(row?.id);
    const label = normalizeNodeText(
      row?.name,
      normalizeNodeText(row?.code, `Operating Unit ${operatingUnitId}`)
    );
    return buildTreeNode({
      key: `OPERATING_UNIT:${operatingUnitId}`,
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
      label,
      code: normalizeOptionalNodeText(row?.code),
      selectable: selectableOperatingUnitIds.has(operatingUnitId),
      pathLabels: [...pathLabels, label],
      meta: {
        legalEntityId: parsePositiveInt(row?.legal_entity_id),
        unitType: normalizeOptionalNodeText(row?.unit_type),
        hasSubledger: row?.has_subledger ?? null,
        status: normalizeOptionalNodeText(row?.status),
        capitalSelfBalancingReady: row?.capital_self_balancing_ready ?? null,
        crossContextSelfBalancingReady: row?.cross_context_self_balancing_ready ?? null,
      },
    });
  };

  const buildLegalEntityNode = (row, pathLabels) => {
    const legalEntityId = parsePositiveInt(row?.id);
    const label = normalizeNodeText(
      row?.name,
      normalizeNodeText(row?.code, `Legal Entity ${legalEntityId}`)
    );
    const unitNodes = (operatingUnitsByLegalEntityId.get(legalEntityId) || []).map((unitRow) => {
      const operatingUnitId = parsePositiveInt(unitRow?.id);
      if (operatingUnitId) {
        attachedOperatingUnitIds.add(operatingUnitId);
      }
      return buildOperatingUnitNode(unitRow, [...pathLabels, label]);
    });

    return buildTreeNode({
      key: `LEGAL_ENTITY:${legalEntityId}`,
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      label,
      code: normalizeOptionalNodeText(row?.code),
      selectable: selectableLegalEntityIds.has(legalEntityId),
      pathLabels: [...pathLabels, label],
      meta: {
        groupCompanyId: parsePositiveInt(row?.group_company_id),
        countryId: parsePositiveInt(row?.country_id),
        taxId: normalizeOptionalNodeText(row?.tax_id),
        functionalCurrencyCode: normalizeOptionalNodeText(row?.functional_currency_code),
        status: normalizeOptionalNodeText(row?.status),
        isIntercompanyEnabled: row?.is_intercompany_enabled ?? null,
        intercompanyPartnerRequired: row?.intercompany_partner_required ?? null,
      },
      children: unitNodes,
    });
  };

  const buildCountryNode = ({ groupRow = null, countryRow, legalEntityRows: nestedEntityRows }) => {
    const groupId = parsePositiveInt(groupRow?.id);
    const countryId = parsePositiveInt(countryRow?.id);
    const groupLabel = groupRow
      ? normalizeNodeText(
          groupRow?.name,
          normalizeNodeText(groupRow?.code, `Group ${groupId}`)
        )
      : null;
    const countryLabel = normalizeNodeText(
      countryRow?.name,
      normalizeNodeText(countryRow?.iso2, `Country ${countryId}`)
    );
    const basePathLabels = groupLabel
      ? [resolvedTenantLabel, groupLabel, countryLabel]
      : [resolvedTenantLabel, countryLabel];
    const nestedLegalEntityNodes = nestedEntityRows.map((entityRow) => {
      const legalEntityId = parsePositiveInt(entityRow?.id);
      if (legalEntityId) {
        attachedLegalEntityIds.add(legalEntityId);
      }
      return buildLegalEntityNode(entityRow, basePathLabels);
    });

    return buildTreeNode({
      key: groupId ? buildCountryBranchKey(groupId, countryId) : `COUNTRY:${countryId}`,
      scopeType: "COUNTRY",
      scopeId: countryId,
      label: countryLabel,
      code: normalizeOptionalNodeText(countryRow?.iso2),
      selectable: selectableCountryIds.has(countryId),
      pathLabels: basePathLabels,
      meta: {
        iso2: normalizeOptionalNodeText(countryRow?.iso2),
        iso3: normalizeOptionalNodeText(countryRow?.iso3),
        defaultCurrencyCode: normalizeOptionalNodeText(countryRow?.default_currency_code),
      },
      children: nestedLegalEntityNodes,
    });
  };

  const rootChildren = [];

  for (const groupId of groupIds) {
    if (!includedGroupIds.has(groupId)) {
      continue;
    }
    const groupRow = groupRowsById.get(groupId);
    const groupLabel = normalizeNodeText(
      groupRow?.name,
      normalizeNodeText(groupRow?.code, `Group ${groupId}`)
    );
    const groupPathLabels = [resolvedTenantLabel, groupLabel];

    const entitiesForGroup = legalEntitiesByGroupId.get(groupId) || [];
    const entitiesByCountryId = new Map();
    for (const entityRow of entitiesForGroup) {
      const countryId = parsePositiveInt(entityRow?.country_id);
      if (!countryId) {
        continue;
      }
      pushNestedMapValue(entitiesByCountryId, countryId, entityRow);
    }

    // Country placement under groups is navigation-only. Selecting the node
    // still resolves to plain COUNTRY scope semantics without introducing a
    // composite GROUP+COUNTRY scope.
    const countryNodes = Array.from(entitiesByCountryId.entries())
      .sort(
        ([leftCountryId], [rightCountryId]) =>
          (countryOrder.get(leftCountryId) ?? Number.MAX_SAFE_INTEGER) -
          (countryOrder.get(rightCountryId) ?? Number.MAX_SAFE_INTEGER)
      )
      .map(([countryId, nestedEntityRows]) => {
        attachedCountryIds.add(countryId);
        const countryRow =
          countryRowsById.get(countryId) ||
          {
            id: countryId,
            iso2: null,
            iso3: null,
            name: `Country ${countryId}`,
            default_currency_code: null,
          };
        return buildCountryNode({
          groupRow,
          countryRow,
          legalEntityRows: nestedEntityRows,
        });
      });

    rootChildren.push(
      buildTreeNode({
        key: `GROUP:${groupId}`,
        scopeType: "GROUP",
        scopeId: groupId,
        label: groupLabel,
        code: normalizeOptionalNodeText(groupRow?.code),
        selectable: selectableGroupIds.has(groupId),
        pathLabels: groupPathLabels,
        meta: {},
        children: countryNodes,
      })
    );
  }

  for (const countryId of countryIds) {
    if (!includedCountryIds.has(countryId) || attachedCountryIds.has(countryId)) {
      continue;
    }
    const countryRow = countryRowsById.get(countryId);
    rootChildren.push(
      buildCountryNode({
        groupRow: null,
        countryRow,
        legalEntityRows: [],
      })
    );
  }

  for (const legalEntityId of legalEntityIds) {
    if (!includedLegalEntityIds.has(legalEntityId) || attachedLegalEntityIds.has(legalEntityId)) {
      continue;
    }
    const row = legalEntityRowsById.get(legalEntityId);
    rootChildren.push(buildLegalEntityNode(row, [resolvedTenantLabel]));
  }

  for (const operatingUnitId of operatingUnitIds) {
    if (
      !includedOperatingUnitIds.has(operatingUnitId) ||
      attachedOperatingUnitIds.has(operatingUnitId)
    ) {
      continue;
    }
    const row = operatingUnitRowsById.get(operatingUnitId);
    rootChildren.push(buildOperatingUnitNode(row, [resolvedTenantLabel]));
  }

  return {
    tenantId: normalizedTenantId,
    shape: "nested",
    root: buildTreeNode({
      key: `TENANT:${normalizedTenantId}`,
      scopeType: "TENANT",
      scopeId: normalizedTenantId,
      label: resolvedTenantLabel,
      code: null,
      selectable: Boolean(scopeContext?.tenantWide),
      pathLabels: [resolvedTenantLabel],
      meta: {},
      children: rootChildren,
    }),
  };
}

async function listFlatOrgTree({ req, tenantId, buildScopeFilter }) {
  const scopeContext = getVisibilityScope(req);
  const groupParams = [];
  const groupFilter = buildScopeFilter(req, "group", "id", groupParams);

  const entityParams = [];
  const entityFilter = buildScopeFilter(req, "legal_entity", "id", entityParams);

  const unitParams = [];
  const unitFilter = buildScopeFilter(req, "operating_unit", "ou.id", unitParams);

  const [groups, countries, legalEntities, operatingUnits] = await Promise.all([
    fetchTreeGroupRows({
      tenantId,
      scopeFilter: groupFilter,
      params: groupParams,
    }),
    fetchTreeCountryRows({
      scopeFilter: "1 = 1",
      params: [],
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
  const relevantCountryIds = collectRelevantOrgTreeCountryIds(scopeContext, legalEntities);

  return {
    groups,
    countries: filterOrgTreeCountryRows(countries, relevantCountryIds),
    legalEntities,
    operatingUnits,
  };
}

async function listNestedOrgTree({ req, tenantId }) {
  const scopeContext = getVisibilityScope(req);
  const [groups, countries, legalEntities, operatingUnits] = await Promise.all([
    fetchTreeGroupRows({
      tenantId,
      scopeFilter: "1 = 1",
      params: [],
    }),
    fetchTreeCountryRows({
      scopeFilter: "1 = 1",
      params: [],
    }),
    fetchTreeLegalEntityRows({
      tenantId,
      scopeFilter: "1 = 1",
      params: [],
    }),
    fetchTreeOperatingUnitRows({
      tenantId,
      scopeFilter: "1 = 1",
      params: [],
    }),
  ]);

  return buildNestedOrgTreeResponse({
    tenantId,
    scopeContext,
    groups,
    countries: filterOrgTreeCountryRows(
      countries,
      collectRelevantOrgTreeCountryIds(scopeContext, legalEntities)
    ),
    legalEntities,
    operatingUnits,
  });
}

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

/**
 * List legal entities visible to the current actor, including entities that
 * are reachable indirectly through group/country scope or scoped operating
 * units.
 */
export async function listLegalEntities({
  req,
  tenantId,
  filters,
}) {
  const { countryId, groupCompanyId, status } = filters;

  const params = [tenantId];
  const conditions = ["tenant_id = ?"];
  conditions.push(buildLegalEntityVisibilityFilter(req, tenantId, params));

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

/**
 * List operating units visible to the current actor, optionally narrowed by
 * parent legal entity and/or explicit operating-unit id filters.
 */
export async function listOperatingUnits({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const { legalEntityId, operatingUnitId } = filters;

  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  }

  const params = [tenantId];
  const conditions = ["ou.tenant_id = ?"];
  // Keep the legal-entity filter listable for OU-scoped request users. The
  // row-level operating-unit visibility filter still prevents cross-scope reads.
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

export async function listOperatingUnitCurrentAccountConfigs({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertLegalEntityBelongsToTenant,
  assertScopeAccess,
}) {
  const { legalEntityId } = filters;

  if (legalEntityId) {
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }

  const params = [tenantId];
  const conditions = ["le.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "le.id", params));

  if (legalEntityId) {
    conditions.push("le.id = ?");
    params.push(legalEntityId);
  }

  return fetchOperatingUnitCurrentAccountConfigRows({
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

/**
 * Return the legacy flat org tree or the additive canonical nested tree,
 * depending on the requested shape.
 */
export async function listOrgTree({
  req,
  tenantId,
  buildScopeFilter,
  shape = "flat",
}) {
  if (shape === "nested") {
    return listNestedOrgTree({ req, tenantId });
  }
  return listFlatOrgTree({ req, tenantId, buildScopeFilter });
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
