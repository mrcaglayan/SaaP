import { query } from "../db.js";
import { parsePositiveInt, resolveTenantId } from "../routes/_utils.js";

const VALID_SCOPE_TYPES = new Set([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

const SCOPE_KIND_TO_KEY = {
  group: "groups",
  country: "countries",
  legal_entity: "legalEntities",
  operating_unit: "operatingUnits",
};

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function normalizeScope(scope, tenantId) {
  if (!scope) {
    return null;
  }

  const scopeType = String(scope.scopeType || "").toUpperCase();
  const scopeId = parsePositiveInt(scope.scopeId);

  if (!VALID_SCOPE_TYPES.has(scopeType)) {
    throw badRequest(`Invalid RBAC scopeType: ${scopeType}`);
  }
  if (!scopeId) {
    throw badRequest("RBAC scopeId must be a positive integer");
  }
  if (scopeType === "TENANT" && scopeId !== tenantId) {
    throw forbidden("Tenant scope does not match authenticated tenant");
  }

  return { scopeType, scopeId };
}

function addScopeId(set, value) {
  const parsed = parsePositiveInt(value);
  if (parsed) {
    set.add(parsed);
  }
}

function parseScopeRows(rows) {
  const allow = {
    tenant: false,
    groups: new Set(),
    countries: new Set(),
    legalEntities: new Set(),
    operatingUnits: new Set(),
  };
  const deny = {
    tenant: false,
    groups: new Set(),
    countries: new Set(),
    legalEntities: new Set(),
    operatingUnits: new Set(),
  };

  for (const row of rows) {
    const effect = String(row.effect || "").toUpperCase();
    const scopeType = String(row.scope_type || "").toUpperCase();
    const scopeId = parsePositiveInt(row.scope_id);
    if (!VALID_SCOPE_TYPES.has(scopeType) || !scopeId || !["ALLOW", "DENY"].includes(effect)) {
      continue;
    }

    const target = effect === "ALLOW" ? allow : deny;

    if (scopeType === "TENANT") {
      target.tenant = true;
      continue;
    }
    if (scopeType === "GROUP") {
      target.groups.add(scopeId);
      continue;
    }
    if (scopeType === "COUNTRY") {
      target.countries.add(scopeId);
      continue;
    }
    if (scopeType === "LEGAL_ENTITY") {
      target.legalEntities.add(scopeId);
      continue;
    }
    if (scopeType === "OPERATING_UNIT") {
      target.operatingUnits.add(scopeId);
    }
  }

  return { allow, deny };
}

async function loadHierarchy(tenantId) {
  const [groupResult, entityResult, unitResult] = await Promise.all([
    query("SELECT id FROM group_companies WHERE tenant_id = ?", [tenantId]),
    query(
      `SELECT id, group_company_id, country_id
       FROM legal_entities
       WHERE tenant_id = ?`,
      [tenantId]
    ),
    query(
      `SELECT id, legal_entity_id
       FROM operating_units
       WHERE tenant_id = ?`,
      [tenantId]
    ),
  ]);

  const groupIds = new Set();
  const countryIds = new Set();
  const legalEntityIds = new Set();
  const operatingUnitIds = new Set();

  const entityById = new Map();
  const legalEntityIdsByGroupId = new Map();
  const legalEntityIdsByCountryId = new Map();
  const operatingUnitIdsByLegalEntityId = new Map();

  for (const row of groupResult.rows) {
    addScopeId(groupIds, row.id);
  }

  for (const row of entityResult.rows) {
    const id = parsePositiveInt(row.id);
    const groupId = parsePositiveInt(row.group_company_id);
    const countryId = parsePositiveInt(row.country_id);
    if (!id || !groupId || !countryId) {
      continue;
    }

    legalEntityIds.add(id);
    groupIds.add(groupId);
    countryIds.add(countryId);
    entityById.set(id, { id, groupId, countryId });

    if (!legalEntityIdsByGroupId.has(groupId)) {
      legalEntityIdsByGroupId.set(groupId, new Set());
    }
    legalEntityIdsByGroupId.get(groupId).add(id);

    if (!legalEntityIdsByCountryId.has(countryId)) {
      legalEntityIdsByCountryId.set(countryId, new Set());
    }
    legalEntityIdsByCountryId.get(countryId).add(id);
  }

  for (const row of unitResult.rows) {
    const id = parsePositiveInt(row.id);
    const legalEntityId = parsePositiveInt(row.legal_entity_id);
    if (!id || !legalEntityId) {
      continue;
    }

    operatingUnitIds.add(id);
    if (!operatingUnitIdsByLegalEntityId.has(legalEntityId)) {
      operatingUnitIdsByLegalEntityId.set(legalEntityId, new Set());
    }
    operatingUnitIdsByLegalEntityId.get(legalEntityId).add(id);
  }

  return {
    groupIds,
    countryIds,
    legalEntityIds,
    operatingUnitIds,
    entityById,
    legalEntityIdsByGroupId,
    legalEntityIdsByCountryId,
    operatingUnitIdsByLegalEntityId,
  };
}

function mergeSet(target, source) {
  for (const value of source) {
    target.add(value);
  }
}

function removeSet(target, source) {
  for (const value of source) {
    target.delete(value);
  }
}

function buildScopeContext(tenantId, scopeRows, hierarchy) {
  const { allow, deny } = parseScopeRows(scopeRows);

  if (deny.tenant) {
    return {
      tenantId,
      sourceRows: scopeRows.length,
      tenantWide: false,
      groups: new Set(),
      countries: new Set(),
      legalEntities: new Set(),
      operatingUnits: new Set(),
    };
  }

  const groups = new Set();
  const countries = new Set();
  const legalEntities = new Set();
  const operatingUnits = new Set();

  if (allow.tenant) {
    mergeSet(groups, hierarchy.groupIds);
    mergeSet(countries, hierarchy.countryIds);
    mergeSet(legalEntities, hierarchy.legalEntityIds);
    mergeSet(operatingUnits, hierarchy.operatingUnitIds);
  }

  mergeSet(groups, allow.groups);
  mergeSet(countries, allow.countries);
  mergeSet(legalEntities, allow.legalEntities);
  mergeSet(operatingUnits, allow.operatingUnits);

  for (const groupId of allow.groups) {
    const entityIds = hierarchy.legalEntityIdsByGroupId.get(groupId);
    if (entityIds) {
      mergeSet(legalEntities, entityIds);
    }
  }
  for (const countryId of allow.countries) {
    const entityIds = hierarchy.legalEntityIdsByCountryId.get(countryId);
    if (entityIds) {
      mergeSet(legalEntities, entityIds);
    }
  }
  for (const legalEntityId of legalEntities) {
    const unitIds = hierarchy.operatingUnitIdsByLegalEntityId.get(legalEntityId);
    if (unitIds) {
      mergeSet(operatingUnits, unitIds);
    }
  }

  removeSet(groups, deny.groups);
  removeSet(countries, deny.countries);
  removeSet(legalEntities, deny.legalEntities);
  removeSet(operatingUnits, deny.operatingUnits);

  for (const groupId of deny.groups) {
    const entityIds = hierarchy.legalEntityIdsByGroupId.get(groupId);
    if (entityIds) {
      removeSet(legalEntities, entityIds);
      for (const entityId of entityIds) {
        const unitIds = hierarchy.operatingUnitIdsByLegalEntityId.get(entityId);
        if (unitIds) {
          removeSet(operatingUnits, unitIds);
        }
      }
    }
  }

  for (const countryId of deny.countries) {
    const entityIds = hierarchy.legalEntityIdsByCountryId.get(countryId);
    if (entityIds) {
      removeSet(legalEntities, entityIds);
      for (const entityId of entityIds) {
        const unitIds = hierarchy.operatingUnitIdsByLegalEntityId.get(entityId);
        if (unitIds) {
          removeSet(operatingUnits, unitIds);
        }
      }
    }
  }

  for (const legalEntityId of deny.legalEntities) {
    const unitIds = hierarchy.operatingUnitIdsByLegalEntityId.get(legalEntityId);
    if (unitIds) {
      removeSet(operatingUnits, unitIds);
    }
  }

  for (const legalEntityId of legalEntities) {
    const entity = hierarchy.entityById.get(legalEntityId);
    if (entity) {
      addScopeId(groups, entity.groupId);
      addScopeId(countries, entity.countryId);
    }
  }

  const tenantWide =
    allow.tenant &&
    !deny.tenant &&
    deny.groups.size === 0 &&
    deny.countries.size === 0 &&
    deny.legalEntities.size === 0 &&
    deny.operatingUnits.size === 0;

  return {
    tenantId,
    sourceRows: scopeRows.length,
    tenantWide,
    groups,
    countries,
    legalEntities,
    operatingUnits,
  };
}

function getScopeSetByType(scopeContext, scopeType) {
  if (scopeType === "GROUP") {
    return scopeContext.groups;
  }
  if (scopeType === "COUNTRY") {
    return scopeContext.countries;
  }
  if (scopeType === "LEGAL_ENTITY") {
    return scopeContext.legalEntities;
  }
  if (scopeType === "OPERATING_UNIT") {
    return scopeContext.operatingUnits;
  }
  return null;
}

function isScopeAllowed(scopeContext, requestedScope) {
  if (!requestedScope) {
    return (
      scopeContext.tenantWide ||
      scopeContext.groups.size > 0 ||
      scopeContext.countries.size > 0 ||
      scopeContext.legalEntities.size > 0 ||
      scopeContext.operatingUnits.size > 0
    );
  }

  if (requestedScope.scopeType === "TENANT") {
    return scopeContext.tenantWide;
  }

  const set = getScopeSetByType(scopeContext, requestedScope.scopeType);
  if (!set) {
    return false;
  }
  return set.has(requestedScope.scopeId);
}

async function getUserDataScopeRows(userId, tenantId) {
  try {
    const result = await query(
      `SELECT effect, scope_type, scope_id
       FROM data_scopes
       WHERE tenant_id = ?
         AND user_id = ?`,
      [tenantId, userId]
    );
    return result.rows || [];
  } catch (err) {
    if (err?.errno === 1146) {
      return [];
    }
    throw err;
  }
}

export function getScopeContext(req) {
  return req.rbac?.scopeContext || null;
}

function scopeKeyFromKind(scopeKind) {
  const normalizedKind = String(scopeKind || "").toLowerCase();
  return SCOPE_KIND_TO_KEY[normalizedKind] || null;
}

export function hasScopeAccess(req, scopeKind, scopeId) {
  const context = getScopeContext(req);
  if (!context) {
    return false;
  }
  if (context.tenantWide) {
    return true;
  }

  const key = scopeKeyFromKind(scopeKind);
  const parsedId = parsePositiveInt(scopeId);
  if (!key || !parsedId) {
    return false;
  }

  return context[key].has(parsedId);
}

export function assertScopeAccess(req, scopeKind, scopeId, label = "scope") {
  if (!hasScopeAccess(req, scopeKind, scopeId)) {
    throw forbidden(`Access denied for ${label}`);
  }
}

export function buildScopeFilter(req, scopeKind, columnName, params) {
  const context = getScopeContext(req);
  if (!context) {
    return "1 = 0";
  }
  if (context.tenantWide) {
    return "1 = 1";
  }

  const key = scopeKeyFromKind(scopeKind);
  if (!key) {
    throw badRequest(`Unsupported scope kind: ${scopeKind}`);
  }

  const ids = Array.from(context[key]);
  if (ids.length === 0) {
    return "1 = 0";
  }

  params.push(...ids);
  return `${columnName} IN (${ids.map(() => "?").join(", ")})`;
}

export function requirePermission(permissionCode, options = {}) {
  const normalizedPermissionCode = String(permissionCode || "").trim();
  if (!normalizedPermissionCode) {
    throw new Error("permissionCode is required");
  }

  const resolveScope = options.resolveScope;

  return async (req, res, next) => {
    try {
      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) {
        throw badRequest("Authenticated user is required");
      }

      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const permissionResult = await query(
        `SELECT urs.effect, urs.scope_type, urs.scope_id
         FROM user_role_scopes urs
         JOIN roles r ON r.id = urs.role_id
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE urs.user_id = ?
           AND urs.tenant_id = ?
           AND p.code = ?`,
        [userId, tenantId, normalizedPermissionCode]
      );

      const permissionRows = permissionResult.rows || [];
      if (permissionRows.length === 0) {
        throw forbidden(`Missing permission: ${normalizedPermissionCode}`);
      }

      const hierarchy = await loadHierarchy(tenantId);
      const permissionScopeContext = buildScopeContext(
        tenantId,
        permissionRows,
        hierarchy
      );

      let requestedScope = null;
      if (typeof resolveScope === "function") {
        const rawScope = await resolveScope(req, tenantId);
        requestedScope = normalizeScope(rawScope, tenantId);
      }

      if (!isScopeAllowed(permissionScopeContext, requestedScope)) {
        throw forbidden(`Missing permission: ${normalizedPermissionCode}`);
      }

      const dataScopeRows = await getUserDataScopeRows(userId, tenantId);
      const scopeRowsForData =
        dataScopeRows.length > 0 ? dataScopeRows : permissionRows;
      const scopeContext = buildScopeContext(tenantId, scopeRowsForData, hierarchy);

      if (requestedScope && !isScopeAllowed(scopeContext, requestedScope)) {
        throw forbidden(`Data scope denied: ${normalizedPermissionCode}`);
      }
      if (!requestedScope && !isScopeAllowed(scopeContext, null)) {
        throw forbidden(`Data scope denied: ${normalizedPermissionCode}`);
      }

      req.rbac = {
        permissionCode: normalizedPermissionCode,
        tenantId,
        requestedScope,
        source: dataScopeRows.length > 0 ? "data_scopes" : "permission_scopes",
        permissionScopeContext,
        scopeContext,
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
