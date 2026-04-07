
import { createClient } from "redis";
import { query } from "../db.js";
import { logWarn } from "../observability/logger.js";
import { badRequest, parsePositiveInt, resolveTenantId } from "../routes/_utils.js";
export const VALID_AUTHZ_SCOPE_TYPES = new Set([
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
const RBAC_CACHE_TTL_MS = parsePositiveIntEnv(process.env.RBAC_CACHE_TTL_MS, 30_000);const RBAC_HIERARCHY_CACHE_TTL_MS = parsePositiveIntEnv(
  process.env.RBAC_HIERARCHY_CACHE_TTL_MS,
  60_000
);const RBAC_CACHE_MAX_ENTRIES = parsePositiveIntEnv(
  process.env.RBAC_CACHE_MAX_ENTRIES,
  10_000
);const RBAC_CACHE_STORE_MODE = normalizeCacheStoreMode(process.env.RBAC_CACHE_STORE);const RBAC_CACHE_REDIS_URL = String(
  process.env.RBAC_CACHE_REDIS_URL || process.env.REDIS_URL || ""
).trim();const RBAC_CACHE_REDIS_CONNECT_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.RBAC_CACHE_REDIS_CONNECT_TIMEOUT_MS,
  1_500
);const RBAC_REDIS_LOG_COOLDOWN_MS = 60 * 1000;const MEMORY_TENANT_VERSION_TTL_MS = parsePositiveIntEnv(
  process.env.RBAC_CACHE_TENANT_VERSION_TTL_MS,
  5_000
);const USER_ROLE_SCOPE_SCHEMA_CACHE_TTL_MS = parsePositiveIntEnv(
  process.env.RBAC_SCOPE_SCHEMA_CACHE_TTL_MS,
  30_000
);
const memoryPermissionBundleCache = new Map();const memoryHierarchyCache = new Map();const memoryTenantVersionCache = new Map();const memoryTenantVersionExpiryCache = new Map();
let rbacRedisClient = null;let rbacRedisConnectPromise = null;let resolvedRbacCacheBackend = null; // "redis" | "memory"
let lastRedisErrorLogAt = 0;let cachedHasUserRoleScopeEffectiveDates = null;let cachedUserRoleScopeEffectiveDatesCheckedAt = 0;
function parsePositiveIntEnv(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;}
function normalizeCacheStoreMode(value) {
  const normalized = String(value || "auto")
    .trim()
    .toLowerCase();
  if (["auto", "redis", "memory"].includes(normalized)) {
    return normalized;
  }
  return "auto";}
function shouldAttemptRbacRedis() {
  if (RBAC_CACHE_STORE_MODE === "memory") {
    return false;
  }
  return Boolean(RBAC_CACHE_REDIS_URL);}
function logRbacRedisWarn(message, err = null) {
  const now = Date.now();
  if (now - lastRedisErrorLogAt < RBAC_REDIS_LOG_COOLDOWN_MS) {
    return;
  }
  lastRedisErrorLogAt = now;
  logWarn("[rbac-cache] Redis warning", { detail: message }, err || null);}
async function connectRbacRedisClient() {
  if (!shouldAttemptRbacRedis()) {
    return null;
  }
  if (rbacRedisClient?.isOpen) {
    return rbacRedisClient;
  }
  if (!rbacRedisConnectPromise) {
    rbacRedisConnectPromise = (async () => {
      const client = createClient({
        url: RBAC_CACHE_REDIS_URL,
        socket: {
          connectTimeout: RBAC_CACHE_REDIS_CONNECT_TIMEOUT_MS,
          reconnectStrategy: () => false,
        },
      });
      client.on("error", (err) => {
        logRbacRedisWarn("Redis client error. Falling back to in-memory RBAC cache.", err);
      });
      try {
        await client.connect();
        rbacRedisClient = client;
        return rbacRedisClient;
      } catch (err) {
        try {
          if (client.isOpen) {
            await client.quit();
          }
        } catch {
          // Ignore redis disconnect failures.
        }
        logRbacRedisWarn("Could not connect to Redis. Falling back to in-memory RBAC cache.", err);
        return null;
      }
    })();
  }
  try {
    return await rbacRedisConnectPromise;
  } finally {
    rbacRedisConnectPromise = null;
  }}
function useMemoryCacheFallback(err = null) {
  resolvedRbacCacheBackend = "memory";
  if (err) {
    logRbacRedisWarn("Redis operation failed. Using in-memory RBAC cache.", err);
  }}
async function resolveRbacCacheBackend() {
  if (resolvedRbacCacheBackend) {
    return resolvedRbacCacheBackend;
  }
  if (RBAC_CACHE_STORE_MODE === "memory") {
    resolvedRbacCacheBackend = "memory";
    return resolvedRbacCacheBackend;
  }
  if (!shouldAttemptRbacRedis()) {
    resolvedRbacCacheBackend = "memory";
    return resolvedRbacCacheBackend;
  }
  const client = await connectRbacRedisClient();
  if (client) {
    resolvedRbacCacheBackend = "redis";
    return resolvedRbacCacheBackend;
  }
  resolvedRbacCacheBackend = "memory";
  return resolvedRbacCacheBackend;}
function getMemoryCacheEntry(cache, key) {
  const item = cache.get(key);
  if (!item) {
    return null;
  }
  if (Number(item.expiresAt || 0) <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;}
function pruneMemoryCache(cache) {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (Number(item?.expiresAt || 0) <= now) {
      cache.delete(key);
    }
  }
  if (cache.size <= RBAC_CACHE_MAX_ENTRIES) {
    return;
  }
  const overflow = cache.size - RBAC_CACHE_MAX_ENTRIES;
  const oldestKeys = Array.from(cache.entries())
    .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
    .slice(0, overflow)
    .map(([key]) => key);
  for (const key of oldestKeys) {
    cache.delete(key);
  }}
function setMemoryCacheEntry(cache, key, value, ttlMs) {
  const now = Date.now();
  cache.set(key, {
    value,
    updatedAt: now,
    expiresAt: now + ttlMs,
  });
  pruneMemoryCache(cache);}
function toPositiveVersion(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;}
function setMemoryTenantVersion(tenantId, version) {
  memoryTenantVersionCache.set(tenantId, version);
  memoryTenantVersionExpiryCache.set(tenantId, Date.now() + MEMORY_TENANT_VERSION_TTL_MS);}
function getMemoryTenantVersion(tenantId) {
  const expiresAt = Number(memoryTenantVersionExpiryCache.get(tenantId) || 0);
  if (expiresAt > Date.now()) {
    return toPositiveVersion(memoryTenantVersionCache.get(tenantId));
  }
  return null;}
function buildTenantVersionRedisKey(tenantId) {
  return `rbac:version:tenant:${tenantId}`;}
function buildPermissionBundleCacheKey(tenantId, userId, permissionCode, tenantVersion) {
  return `rbac:perm:v${tenantVersion}:t${tenantId}:u${userId}:p:${permissionCode}`;}
function buildHierarchyCacheKey(tenantId, tenantVersion) {
  return `rbac:hier:v${tenantVersion}:t${tenantId}`;}
function purgeTenantScopedMemoryEntries(tenantId) {
  const tenantMarker = `:t${tenantId}:`;
  for (const key of memoryPermissionBundleCache.keys()) {
    if (key.includes(tenantMarker)) {
      memoryPermissionBundleCache.delete(key);
    }
  }
  for (const key of memoryHierarchyCache.keys()) {
    if (key.includes(tenantMarker)) {
      memoryHierarchyCache.delete(key);
    }
  }}
function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;}
function serializeScopeContext(scopeContext) {
  if (!scopeContext) {
    return null;
  }
  return {
    tenantId: parsePositiveInt(scopeContext.tenantId),
    sourceRows: Number(scopeContext.sourceRows || 0),
    tenantWide: Boolean(scopeContext.tenantWide),
    groups: Array.from(scopeContext.groups || []),
    countries: Array.from(scopeContext.countries || []),
    legalEntities: Array.from(scopeContext.legalEntities || []),
    operatingUnits: Array.from(scopeContext.operatingUnits || []),
  };}
function hydrateScopeContext(payload) {
  if (!payload) {
    return null;
  }
  return {
    tenantId: parsePositiveInt(payload.tenantId),
    sourceRows: Number(payload.sourceRows || 0),
    tenantWide: Boolean(payload.tenantWide),
    groups: new Set((payload.groups || []).map((id) => parsePositiveInt(id)).filter(Boolean)),
    countries: new Set(
      (payload.countries || []).map((id) => parsePositiveInt(id)).filter(Boolean)
    ),
    legalEntities: new Set(
      (payload.legalEntities || []).map((id) => parsePositiveInt(id)).filter(Boolean)
    ),
    operatingUnits: new Set(
      (payload.operatingUnits || []).map((id) => parsePositiveInt(id)).filter(Boolean)
    ),
  };}
function serializeHierarchy(hierarchy) {
  if (!hierarchy) {
    return null;
  }
  return {
    groupIds: Array.from(hierarchy.groupIds || []),
    countryIds: Array.from(hierarchy.countryIds || []),
    legalEntityIds: Array.from(hierarchy.legalEntityIds || []),
    operatingUnitIds: Array.from(hierarchy.operatingUnitIds || []),
    entityById: Array.from(hierarchy.entityById?.entries() || []),
    legalEntityIdsByGroupId: Array.from(
      hierarchy.legalEntityIdsByGroupId?.entries() || []
    ).map(([key, values]) => [key, Array.from(values || [])]),
    legalEntityIdsByCountryId: Array.from(
      hierarchy.legalEntityIdsByCountryId?.entries() || []
    ).map(([key, values]) => [key, Array.from(values || [])]),
    operatingUnitIdsByLegalEntityId: Array.from(
      hierarchy.operatingUnitIdsByLegalEntityId?.entries() || []
    ).map(([key, values]) => [key, Array.from(values || [])]),
  };}
function hydrateHierarchy(payload) {
  if (!payload) {
    return null;
  }
  const entityById = new Map();
  for (const row of payload.entityById || []) {
    const id = parsePositiveInt(row?.[0]);
    const value = row?.[1] || {};
    const groupId = parsePositiveInt(value.groupId);
    const countryId = parsePositiveInt(value.countryId);
    if (!id || !groupId || !countryId) {
      continue;
    }
    entityById.set(id, { id, groupId, countryId });
  }
  const legalEntityIdsByGroupId = new Map();
  for (const row of payload.legalEntityIdsByGroupId || []) {
    const key = parsePositiveInt(row?.[0]);
    if (!key) {
      continue;
    }
    legalEntityIdsByGroupId.set(
      key,
      new Set((row?.[1] || []).map((id) => parsePositiveInt(id)).filter(Boolean))
    );
  }
  const legalEntityIdsByCountryId = new Map();
  for (const row of payload.legalEntityIdsByCountryId || []) {
    const key = parsePositiveInt(row?.[0]);
    if (!key) {
      continue;
    }
    legalEntityIdsByCountryId.set(
      key,
      new Set((row?.[1] || []).map((id) => parsePositiveInt(id)).filter(Boolean))
    );
  }
  const operatingUnitIdsByLegalEntityId = new Map();
  for (const row of payload.operatingUnitIdsByLegalEntityId || []) {
    const key = parsePositiveInt(row?.[0]);
    if (!key) {
      continue;
    }
    operatingUnitIdsByLegalEntityId.set(
      key,
      new Set((row?.[1] || []).map((id) => parsePositiveInt(id)).filter(Boolean))
    );
  }
  return {
    groupIds: new Set((payload.groupIds || []).map((id) => parsePositiveInt(id)).filter(Boolean)),
    countryIds: new Set(
      (payload.countryIds || []).map((id) => parsePositiveInt(id)).filter(Boolean)
    ),
    legalEntityIds: new Set(
      (payload.legalEntityIds || []).map((id) => parsePositiveInt(id)).filter(Boolean)
    ),
    operatingUnitIds: new Set(
      (payload.operatingUnitIds || []).map((id) => parsePositiveInt(id)).filter(Boolean)
    ),
    entityById,
    legalEntityIdsByGroupId,
    legalEntityIdsByCountryId,
    operatingUnitIdsByLegalEntityId,
  };}
function serializePermissionBundle(bundle) {
  return {
    missingPermission: Boolean(bundle?.missingPermission),
    source: String(bundle?.source || ""),
    permissionScopeContext: serializeScopeContext(bundle?.permissionScopeContext),
    visibilityScopeContext: serializeScopeContext(bundle?.visibilityScopeContext),
    scopeContext: serializeScopeContext(bundle?.scopeContext),
  };}
function hydratePermissionBundle(payload) {
  if (!payload) {
    return null;
  }
  return {
    missingPermission: Boolean(payload.missingPermission),
    source: String(payload.source || ""),
    permissionScopeContext: hydrateScopeContext(payload.permissionScopeContext),
    visibilityScopeContext: hydrateScopeContext(payload.visibilityScopeContext),
    scopeContext: hydrateScopeContext(payload.scopeContext),
  };}
async function getRedisClientForCache() {
  const backend = await resolveRbacCacheBackend();
  if (backend !== "redis") {
    return null;
  }
  return connectRbacRedisClient();}
async function getTenantCacheVersion(tenantId) {
  const localVersion = getMemoryTenantVersion(tenantId);
  if (localVersion) {
    return localVersion;
  }
  const client = await getRedisClientForCache();
  if (client) {
    try {
      const versionKey = buildTenantVersionRedisKey(tenantId);
      const raw = await client.get(versionKey);
      if (raw) {
        const parsed = toPositiveVersion(raw);
        setMemoryTenantVersion(tenantId, parsed);
        return parsed;
      }
      await client.set(versionKey, "1", { NX: true });
      setMemoryTenantVersion(tenantId, 1);
      return 1;
    } catch (err) {
      useMemoryCacheFallback(err);
    }
  }
  const current = toPositiveVersion(memoryTenantVersionCache.get(tenantId));
  setMemoryTenantVersion(tenantId, current);
  return current;}
async function getCachedJson(cache, key, ttlMs) {
  const memoryHit = getMemoryCacheEntry(cache, key);
  if (memoryHit) {
    return memoryHit;
  }
  const client = await getRedisClientForCache();
  if (!client) {
    return null;
  }
  try {
    const raw = await client.get(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    setMemoryCacheEntry(cache, key, parsed, ttlMs);
    return parsed;
  } catch (err) {
    useMemoryCacheFallback(err);
    return null;
  }}
async function setCachedJson(cache, key, value, ttlMs) {
  setMemoryCacheEntry(cache, key, value, ttlMs);
  const client = await getRedisClientForCache();
  if (!client) {
    return;
  }
  try {
    await client.set(key, JSON.stringify(value), { PX: ttlMs });
  } catch (err) {
    useMemoryCacheFallback(err);
  }}
function addScopeId(set, value) {
  const parsed = parsePositiveInt(value);
  if (parsed) {
    set.add(parsed);
  }}
async function loadHierarchyFromDb(tenantId, runQuery = query) {
  const [groupResult, entityResult, unitResult] = await Promise.all([
    runQuery("SELECT id FROM group_companies WHERE tenant_id = ?", [tenantId]),
    runQuery(
      `SELECT id, group_company_id, country_id
       FROM legal_entities
       WHERE tenant_id = ?`,
      [tenantId]
    ),
    runQuery(
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
  for (const row of groupResult.rows || []) {
    addScopeId(groupIds, row.id);
  }
  for (const row of entityResult.rows || []) {
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
  for (const row of unitResult.rows || []) {
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
  };}
/**
 * Load the tenant org hierarchy used for hierarchy-aware scope expansion and diagnostics.
 */
export async function loadHierarchy({ tenantId, tenantVersion = null, runQuery = query }) {
  if (runQuery !== query) {
    return loadHierarchyFromDb(tenantId, runQuery);
  }
  const resolvedTenantVersion = tenantVersion || (await getTenantCacheVersion(tenantId));
  const hierarchyCacheKey = buildHierarchyCacheKey(tenantId, resolvedTenantVersion);
  const cached = await getCachedJson(
    memoryHierarchyCache,
    hierarchyCacheKey,
    RBAC_HIERARCHY_CACHE_TTL_MS
  );
  if (cached) {
    const hydrated = hydrateHierarchy(cached);
    if (hydrated) {
      return hydrated;
    }
  }
  const fresh = await loadHierarchyFromDb(tenantId, query);
  await setCachedJson(
    memoryHierarchyCache,
    hierarchyCacheKey,
    serializeHierarchy(fresh),
    RBAC_HIERARCHY_CACHE_TTL_MS
  );
  return fresh;}
function mergeSet(target, source) {
  for (const value of source) {
    target.add(value);
  }}
function removeSet(target, source) {
  for (const value of source) {
    target.delete(value);
  }}
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
  for (const row of rows || []) {
    const effect = String(row.effect || "").toUpperCase();
    const scopeType = String(row.scope_type || "").toUpperCase();
    const scopeId = parsePositiveInt(row.scope_id);
    if (
      !VALID_AUTHZ_SCOPE_TYPES.has(scopeType) ||
      !scopeId ||
      !["ALLOW", "DENY"].includes(effect)
    ) {
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
  return { allow, deny };}
function buildScopeContext(tenantId, scopeRows, hierarchy) {
  const { allow, deny } = parseScopeRows(scopeRows);
  if (deny.tenant) {
    return {
      tenantId,
      sourceRows: Array.isArray(scopeRows) ? scopeRows.length : 0,
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
    sourceRows: Array.isArray(scopeRows) ? scopeRows.length : 0,
    tenantWide,
    groups,
    countries,
    legalEntities,
    operatingUnits,
  };}
async function getUserRoleScopeEffectiveDateSupport(runQuery = query) {
  const now = Date.now();
  if (
    runQuery === query &&
    cachedHasUserRoleScopeEffectiveDates !== null &&
    now - cachedUserRoleScopeEffectiveDatesCheckedAt < USER_ROLE_SCOPE_SCHEMA_CACHE_TTL_MS
  ) {
    return cachedHasUserRoleScopeEffectiveDates;
  }
  const result = await runQuery(
    `SELECT COUNT(*) AS column_count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'user_role_scopes'
       AND column_name IN ('effective_from', 'effective_to')`
  );
  const supported = Number(result.rows?.[0]?.column_count || 0) >= 2;
  if (runQuery === query) {
    cachedHasUserRoleScopeEffectiveDates = supported;
    cachedUserRoleScopeEffectiveDatesCheckedAt = now;
  }
  return supported;}
function normalizeAsOfDate(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);}
async function buildUserRoleScopeEffectiveDateGuard(runQuery = query, asOfDate = null) {
  const supported = await getUserRoleScopeEffectiveDateSupport(runQuery);
  if (!supported) {
    return { sql: "", params: [] };
  }
  const effectiveOn = normalizeAsOfDate(asOfDate);
  return {
    sql:
      " AND (urs.effective_from IS NULL OR urs.effective_from <= ?)" +
      " AND (urs.effective_to IS NULL OR urs.effective_to >= ?)",
    params: [effectiveOn, effectiveOn],
  };}
/**
 * Build the reusable SQL guard for raw `user_role_scopes` queries that should
 * only consider assignments effective on one date.
 */
export async function getUserRoleScopeEffectiveDateGuard(
  runQueryOrOptions = query,
  asOfDate = null
) {
  const { runQuery, asOfDate: optionAsOfDate } =
    normalizeRunQueryOptions(runQueryOrOptions);
  return buildUserRoleScopeEffectiveDateGuard(
    runQuery,
    asOfDate ?? optionAsOfDate ?? null
  );
}
async function getUserDataScopeRows(userId, tenantId, runQuery = query) {
  try {
    const result = await runQuery(
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
  }}
async function loadPermissionRows({
  userId,
  tenantId,
  permissionCode,
  runQuery = query,
  asOfDate = null,
}) {
  const effectiveGuard = await buildUserRoleScopeEffectiveDateGuard(runQuery, asOfDate);
  const permissionResult = await runQuery(
    `SELECT urs.effect, urs.scope_type, urs.scope_id
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.user_id = ?
       AND urs.tenant_id = ?
       AND p.code = ?${effectiveGuard.sql}`,
    [userId, tenantId, permissionCode, ...effectiveGuard.params]
  );
  return permissionResult.rows || [];}

async function loadAllPermissionRows({
  userId,
  tenantId,
  runQuery = query,
  asOfDate = null,
}) {
  const effectiveGuard = await buildUserRoleScopeEffectiveDateGuard(runQuery, asOfDate);
  const permissionResult = await runQuery(
    `SELECT p.code, urs.effect, urs.scope_type, urs.scope_id
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.user_id = ?
       AND urs.tenant_id = ?${effectiveGuard.sql}
     ORDER BY p.code ASC, urs.id ASC`,
    [userId, tenantId, ...effectiveGuard.params]
  );
  return permissionResult.rows || [];
}

function summarizeScopeContext(scopeContext) {
  if (!scopeContext) {
    return null;
  }

  const scopeTypes = [];
  const scopeIdsByType = {};

  if (scopeContext.tenantWide) {
    scopeTypes.push("TENANT");
    scopeIdsByType.TENANT = [parsePositiveInt(scopeContext.tenantId)];
  }
  if (scopeContext.groups.size > 0) {
    scopeTypes.push("GROUP");
    scopeIdsByType.GROUP = Array.from(scopeContext.groups).sort((left, right) => left - right);
  }
  if (scopeContext.countries.size > 0) {
    scopeTypes.push("COUNTRY");
    scopeIdsByType.COUNTRY = Array.from(scopeContext.countries).sort((left, right) => left - right);
  }
  if (scopeContext.legalEntities.size > 0) {
    scopeTypes.push("LEGAL_ENTITY");
    scopeIdsByType.LEGAL_ENTITY = Array.from(scopeContext.legalEntities).sort(
      (left, right) => left - right
    );
  }
  if (scopeContext.operatingUnits.size > 0) {
    scopeTypes.push("OPERATING_UNIT");
    scopeIdsByType.OPERATING_UNIT = Array.from(scopeContext.operatingUnits).sort(
      (left, right) => left - right
    );
  }

  return {
    tenantWide: Boolean(scopeContext.tenantWide),
    scopeTypes,
    scopeIdsByType,
  };
}

function buildPermissionEntitlementRows(permissionCode, scopeContext, visibilityNarrowed) {
  if (!scopeContext) {
    return [];
  }

  const rows = [];
  if (scopeContext.tenantWide) {
    rows.push({
      code: permissionCode,
      scopeType: "TENANT",
      scopeIds: [parsePositiveInt(scopeContext.tenantId)],
      visibilityNarrowed,
    });
  }

  const scopedSets = [
    ["GROUP", scopeContext.groups],
    ["COUNTRY", scopeContext.countries],
    ["LEGAL_ENTITY", scopeContext.legalEntities],
    ["OPERATING_UNIT", scopeContext.operatingUnits],
  ];

  for (const [scopeType, ids] of scopedSets) {
    const scopeIds = Array.from(ids || []).sort((left, right) => left - right);
    if (scopeIds.length === 0) {
      continue;
    }
    rows.push({
      code: permissionCode,
      scopeType,
      scopeIds,
      visibilityNarrowed,
    });
  }

  return rows;
}

function normalizeVisibilityOverrides(dataScopeRows = []) {
  return (Array.isArray(dataScopeRows) ? dataScopeRows : [])
    .map((row) => ({
      scopeType: String(row?.scope_type || "").toUpperCase(),
      scopeId: parsePositiveInt(row?.scope_id),
      effect: String(row?.effect || "").toUpperCase(),
    }))
    .filter(
      (row) =>
        VALID_AUTHZ_SCOPE_TYPES.has(row.scopeType) &&
        row.scopeId &&
        (row.effect === "ALLOW" || row.effect === "DENY")
    )
    .sort((left, right) => {
      if (left.scopeType !== right.scopeType) {
        return left.scopeType.localeCompare(right.scopeType);
      }
      if (left.scopeId !== right.scopeId) {
        return left.scopeId - right.scopeId;
      }
      return left.effect.localeCompare(right.effect);
    });
}
function getRequestPermissionBundleCache(req) {
  if (!req._rbacPermissionBundleCache) {
    req._rbacPermissionBundleCache = new Map();
  }
  return req._rbacPermissionBundleCache;}
function normalizeRunQueryOptions(runQueryOrOptions = query) {
  if (typeof runQueryOrOptions === "function") {
    return { runQuery: runQueryOrOptions, asOfDate: null };
  }
  if (runQueryOrOptions && typeof runQueryOrOptions === "object") {
    return {
      runQuery:
        typeof runQueryOrOptions.runQuery === "function" ? runQueryOrOptions.runQuery : query,
      asOfDate: runQueryOrOptions.asOfDate || null,
    };
  }
  return { runQuery: query, asOfDate: null };}
async function loadPermissionBundleDirect({
  userId,
  tenantId,
  permissionCode,
  runQuery = query,
  asOfDate = null,
}) {
  const permissionRows = await loadPermissionRows({
    userId,
    tenantId,
    permissionCode,
    runQuery,
    asOfDate,
  });
  if (permissionRows.length === 0) {
    return {
      missingPermission: true,
      source: "",
      permissionScopeContext: null,
      visibilityScopeContext: null,
      scopeContext: null,
    };
  }
  const hierarchy = await loadHierarchy({ tenantId, runQuery });
  const dataScopeRows = await getUserDataScopeRows(userId, tenantId, runQuery);
  const permissionScopeContext = buildScopeContext(tenantId, permissionRows, hierarchy);
  const visibilityScopeContext =
    dataScopeRows.length > 0 ? buildScopeContext(tenantId, dataScopeRows, hierarchy) : null;
  // Effective scope: visibility-narrowed when present, otherwise permission scope.
  // Kept in the bundle for the access-debugger diagnostics contract and cached
  // bundle serialization. Runtime code should use the explicit variants instead.
  const scopeContext = visibilityScopeContext || permissionScopeContext;
  return {
    missingPermission: false,
    source: dataScopeRows.length > 0 ? "data_scopes" : "permission_scopes",
    permissionScopeContext,
    visibilityScopeContext,
    scopeContext,
  };}
/**
 * Load the cached permission/data-scope bundle for one user and permission code.
 */
export async function loadPermissionBundle({
  userId,
  tenantId,
  permissionCode,
  runQuery = query,
  asOfDate = null,
}) {
  if (runQuery !== query || asOfDate) {
    return loadPermissionBundleDirect({
      userId,
      tenantId,
      permissionCode,
      runQuery,
      asOfDate,
    });
  }
  const tenantVersion = await getTenantCacheVersion(tenantId);
  const permissionCacheKey = buildPermissionBundleCacheKey(
    tenantId,
    userId,
    permissionCode,
    tenantVersion
  );
  const cached = await getCachedJson(
    memoryPermissionBundleCache,
    permissionCacheKey,
    RBAC_CACHE_TTL_MS
  );
  const hydratedCached = hydratePermissionBundle(cached);
  if (hydratedCached) {
    return hydratedCached;
  }
  const fresh = await loadPermissionBundleDirect({
    userId,
    tenantId,
    permissionCode,
    runQuery: query,
  });
  await setCachedJson(
    memoryPermissionBundleCache,
    permissionCacheKey,
    serializePermissionBundle(fresh),
    RBAC_CACHE_TTL_MS
  );
  return fresh;}
/**
 * Load the request-local cached permission bundle used by RBAC middleware.
 */
export async function getPermissionBundleForRequest(req, userId, tenantId, permissionCode) {
  const tenantVersion = await getTenantCacheVersion(tenantId);
  const requestCacheKey = `${tenantVersion}:${tenantId}:${userId}:${permissionCode}`;
  const requestCache = getRequestPermissionBundleCache(req);
  if (requestCache.has(requestCacheKey)) {
    return requestCache.get(requestCacheKey);
  }
  const bundle = await loadPermissionBundle({ userId, tenantId, permissionCode });
  requestCache.set(requestCacheKey, bundle);
  return bundle;}
/**
 * Normalize one explicit scope payload into a validated authz scope object.
 */
export function normalizeAuthzScope(scope, tenantId) {
  if (!scope) {
    return null;
  }
  const scopeType = String(scope.scopeType || "").toUpperCase();
  const scopeId = parsePositiveInt(scope.scopeId);
  if (!VALID_AUTHZ_SCOPE_TYPES.has(scopeType)) {
    throw badRequest(`Invalid RBAC scopeType: ${scopeType}`);
  }
  if (!scopeId) {
    throw badRequest("RBAC scopeId must be a positive integer");
  }
  if (scopeType === "TENANT" && scopeId !== tenantId) {
    throw forbidden("Tenant scope does not match authenticated tenant");
  }
  return { scopeType, scopeId };}
/**
 * Resolve the current request's already-validated requested RBAC scope, if any.
 */
export function resolveRequestScope(req, tenantId = resolveTenantId(req)) {
  if (!tenantId || !req?.rbac?.requestedScope) {
    return null;
  }
  return normalizeAuthzScope(req.rbac.requestedScope, tenantId);}
/**
 * Resolve the most specific available row/request scope from known scope ids.
 */
export function resolveRowScope({
  tenantId = null,
  groupCompanyId = null,
  groupId = null,
  countryId = null,
  legalEntityId = null,
  operatingUnitId = null,
  allowTenantScope = false,
} = {}) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (normalizedOperatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: normalizedOperatingUnitId,
      scopeKind: "operating_unit",
    };
  }
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  if (normalizedLegalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: normalizedLegalEntityId,
      scopeKind: "legal_entity",
    };
  }
  const normalizedCountryId = parsePositiveInt(countryId);
  if (normalizedCountryId) {
    return {
      scopeType: "COUNTRY",
      scopeId: normalizedCountryId,
      scopeKind: "country",
    };
  }
  const normalizedGroupId = parsePositiveInt(groupCompanyId) || parsePositiveInt(groupId);
  if (normalizedGroupId) {
    return {
      scopeType: "GROUP",
      scopeId: normalizedGroupId,
      scopeKind: "group",
    };
  }
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (allowTenantScope && normalizedTenantId) {
    return {
      scopeType: "TENANT",
      scopeId: normalizedTenantId,
      scopeKind: "tenant",
    };
  }
  return null;}
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
  return null;}
/**
 * Check whether one resolved scope context allows the requested scope.
 */
export function isScopeAllowed(scopeContext, requestedScope) {
  if (!scopeContext) {
    return false;
  }
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
  return set.has(requestedScope.scopeId);}
/**
 * Returns whether `containerScope` covers `requestedScope`, including
 * hierarchy-aware cases such as COUNTRY -> LEGAL_ENTITY or LEGAL_ENTITY ->
 * OPERATING_UNIT.
 */
export async function doesScopeIncludeScope(
  tenantId,
  containerScope,
  requestedScope,
  runQueryOrOptions = query
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    return false;
  }

  const normalizedContainerScope = normalizeAuthzScope(
    containerScope,
    normalizedTenantId
  );
  const normalizedRequestedScope = normalizeAuthzScope(
    requestedScope,
    normalizedTenantId
  );
  if (!normalizedContainerScope || !normalizedRequestedScope) {
    return false;
  }

  const { runQuery } = normalizeRunQueryOptions(runQueryOrOptions);
  const hierarchy = await loadHierarchy({
    tenantId: normalizedTenantId,
    runQuery,
  });
  const containerContext = buildScopeContext(
    normalizedTenantId,
    [
      {
        scope_type: normalizedContainerScope.scopeType,
        scope_id: normalizedContainerScope.scopeId,
        effect: "ALLOW",
      },
    ],
    hierarchy
  );
  return isScopeAllowed(containerContext, normalizedRequestedScope);
}
/**
 * Return the request's explicit visibility/data-scope context.
 *
 * This is nullable by design. `null` means visibility is not narrowed beyond
 * permission scope. Use `getVisibilityScope()` from rbac.js middleware for the
 * common pattern of falling back to permission scope when visibility is null.
 */
export function getVisibilityScopeContext(req) {
  return req?.rbac?.visibilityScopeContext || null;}
/**
 * Return the request's permission-scope context.
 *
 * Permission scope determines where the user can *act*. Use this for mutation
 * and authorization guards rather than the visibility/effective scope.
 */
export function getPermissionScopeContext(req) {
  return req?.rbac?.permissionScopeContext || null;}
function scopeKeyFromKind(scopeKind) {
  const normalizedKind = String(scopeKind || "").toLowerCase();
  return SCOPE_KIND_TO_KEY[normalizedKind] || null;}
/**
 * Check one scope-kind/id pair against a resolved visibility scope context.
 */
export function hasScopeAccessForContext(scopeContext, scopeKind, scopeId) {
  if (!scopeContext) {
    return false;
  }
  if (scopeContext.tenantWide) {
    return true;
  }
  const key = scopeKeyFromKind(scopeKind);
  const parsedId = parsePositiveInt(scopeId);
  if (!key || !parsedId) {
    return false;
  }
  return scopeContext[key].has(parsedId);}
/**
 * Assert one scope-kind/id pair against a resolved visibility scope context.
 */
export function assertScopeAccessForContext(
  scopeContext,
  scopeKind,
  scopeId,
  label = "scope"
) {
  if (!hasScopeAccessForContext(scopeContext, scopeKind, scopeId)) {
    throw forbidden(`Access denied for ${label}`);
  }}
/**
 * Build a scope-aware SQL filter for one specific scope-kind column.
 */
export function buildScopeFilterFromContext(scopeContext, scopeKind, columnName, params) {
  if (!scopeContext) {
    return "1 = 0";
  }
  if (scopeContext.tenantWide) {
    return "1 = 1";
  }
  const key = scopeKeyFromKind(scopeKind);
  if (!key) {
    throw badRequest(`Unsupported scope kind: ${scopeKind}`);
  }
  const ids = Array.from(scopeContext[key]);
  if (ids.length === 0) {
    return "1 = 0";
  }
  params.push(...ids);
  return `${columnName} IN (${ids.map(() => "?").join(", ")})`;}
/**
 * Build a reusable OR-clause for diagnostics or row visibility queries.
 */
export function buildVisibilityScopeWhereClause(scopeContext, params, columnMap = {}) {
  if (!scopeContext) {
    return "1 = 0";
  }
  if (scopeContext.tenantWide) {
    return "1 = 1";
  }
  const clauses = [];
  const configs = [
    ["GROUP", scopeContext.groups, columnMap.GROUP || null],
    ["COUNTRY", scopeContext.countries, columnMap.COUNTRY || null],
    ["LEGAL_ENTITY", scopeContext.legalEntities, columnMap.LEGAL_ENTITY || null],
    ["OPERATING_UNIT", scopeContext.operatingUnits, columnMap.OPERATING_UNIT || null],
  ];
  for (const [scopeType, set, config] of configs) {
    if (!config) {
      continue;
    }
    const ids = Array.from(set || []).filter(Boolean);
    if (ids.length === 0) {
      continue;
    }
    params.push(...ids);
    if (config.typeColumn) {
      clauses.push(
        `(${config.typeColumn} = '${scopeType}' AND ${config.idColumn} IN (${ids
          .map(() => "?")
          .join(", ")}))`
      );
      continue;
    }
    clauses.push(`(${config.idColumn} IN (${ids.map(() => "?").join(", ")}))`);
  }
  if (clauses.length === 0) {
    return "1 = 0";
  }
  return `(${clauses.join(" OR ")})`;}
/**
 * Load the user's currently effective permission code list for `/me` and similar endpoints.
 */
export async function loadUserPermissionCodes({
  tenantId,
  userId,
  runQuery = query,
  asOfDate = null,
}) {
  if (!parsePositiveInt(tenantId) || !parsePositiveInt(userId)) {
    return [];
  }
  const effectiveGuard = await buildUserRoleScopeEffectiveDateGuard(runQuery, asOfDate);
  const permissionResult = await runQuery(
    `SELECT
       p.code,
       SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END) AS allow_count,
       SUM(
         CASE
           WHEN urs.effect = 'DENY' AND urs.scope_type = 'TENANT' THEN 1
           ELSE 0
         END
       ) AS tenant_deny_count
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.user_id = ?
       AND urs.tenant_id = ?${effectiveGuard.sql}
     GROUP BY p.code
     HAVING allow_count > 0
        AND tenant_deny_count = 0
     ORDER BY p.code`,
    [userId, tenantId, ...effectiveGuard.params]
  );
  return (permissionResult.rows || [])
    .map((row) => String(row.code || "").trim())
    .filter(Boolean);}

/**
 * Return the stable `/api/me/entitlements` contract, even when entitlement
 * tables are not yet present or the user has no effective permission rows.
 */
export function buildEmptyEntitlementsResponse(tenantId = null, userId = null) {
  return {
    tenantId: parsePositiveInt(tenantId),
    userId: parsePositiveInt(userId),
    permissions: [],
    visibilityOverrides: [],
    scopeSummary: {
      permissionScopeContext: null,
      visibilityScopeContext: null,
    },
    isVisibilityNarrowed: false,
    maskedFields: [],
  };
}

/**
 * Load the explicit action-scope vs visibility-scope entitlement summary for
 * `/api/me/entitlements`.
 */
export async function loadUserEntitlements({
  tenantId,
  userId,
  runQuery = query,
  asOfDate = null,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedTenantId || !normalizedUserId) {
    return buildEmptyEntitlementsResponse(normalizedTenantId, normalizedUserId);
  }

  try {
    const permissionCodes = await loadUserPermissionCodes({
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      runQuery,
      asOfDate,
    });
    const allPermissionRows = await loadAllPermissionRows({
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      runQuery,
      asOfDate,
    });
    const dataScopeRows = await getUserDataScopeRows(normalizedUserId, normalizedTenantId, runQuery);
    const hierarchy = await loadHierarchy({ tenantId: normalizedTenantId, runQuery });
    const visibilityScopeContext =
      dataScopeRows.length > 0
        ? buildScopeContext(normalizedTenantId, dataScopeRows, hierarchy)
        : null;

    const permissionRowsByCode = new Map();
    for (const row of allPermissionRows) {
      const permissionCode = String(row?.code || "").trim();
      if (!permissionCode) {
        continue;
      }
      if (!permissionRowsByCode.has(permissionCode)) {
        permissionRowsByCode.set(permissionCode, []);
      }
      permissionRowsByCode.get(permissionCode).push(row);
    }

    const allEffectivePermissionRows = [];
    const permissionEntries = [];
    for (const permissionCode of permissionCodes) {
      const permissionRows = permissionRowsByCode.get(permissionCode) || [];
      allEffectivePermissionRows.push(...permissionRows);
      const permissionScopeContext = buildScopeContext(
        normalizedTenantId,
        permissionRows,
        hierarchy
      );
      permissionEntries.push(
        ...buildPermissionEntitlementRows(
          permissionCode,
          permissionScopeContext,
          Boolean(visibilityScopeContext)
        )
      );
    }

    const overallPermissionScopeContext =
      allEffectivePermissionRows.length > 0
        ? buildScopeContext(normalizedTenantId, allEffectivePermissionRows, hierarchy)
        : null;

    return {
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      permissions: permissionEntries,
      visibilityOverrides: normalizeVisibilityOverrides(dataScopeRows),
      scopeSummary: {
        permissionScopeContext: summarizeScopeContext(overallPermissionScopeContext),
        visibilityScopeContext: summarizeScopeContext(visibilityScopeContext),
      },
      isVisibilityNarrowed: Boolean(visibilityScopeContext),
      maskedFields: [],
    };
  } catch (err) {
    if (err?.errno === 1146) {
      return buildEmptyEntitlementsResponse(normalizedTenantId, normalizedUserId);
    }
    throw err;
  }
}
/**
 * Check whether one user holds one permission at one concrete org scope.
 */
export async function checkUserHasPermissionAtScope(
  userId,
  tenantId,
  permissionCode,
  scopeType,
  scopeId,
  runQueryOrOptions = query
) {
  const normalizedUserId = parsePositiveInt(userId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedCode = String(permissionCode || "").trim();
  if (!normalizedUserId || !normalizedTenantId || !normalizedCode) {
    return false;
  }
  const requestedScope = normalizeAuthzScope(
    { scopeType, scopeId },
    normalizedTenantId
  );
  const { runQuery, asOfDate } = normalizeRunQueryOptions(runQueryOrOptions);
  const bundle = await loadPermissionBundle({
    userId: normalizedUserId,
    tenantId: normalizedTenantId,
    permissionCode: normalizedCode,
    runQuery,
    asOfDate,
  });
  if (bundle?.missingPermission || !bundle?.permissionScopeContext) {
    return false;
  }
  return isScopeAllowed(bundle.permissionScopeContext, requestedScope);}
/**
 * Find users who currently hold one permission at one concrete org scope.
 */
export async function findUsersWithPermissionAtScope(
  tenantId,
  permissionCode,
  scopeType,
  scopeId,
  runQueryOrOptions = query
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedCode = String(permissionCode || "").trim();
  if (!normalizedTenantId || !normalizedCode) {
    return [];
  }
  const requestedScope = normalizeAuthzScope(
    { scopeType, scopeId },
    normalizedTenantId
  );
  const { runQuery, asOfDate } = normalizeRunQueryOptions(runQueryOrOptions);
  const effectiveGuard = await buildUserRoleScopeEffectiveDateGuard(runQuery, asOfDate);
  const permissionResult = await runQuery(
    `SELECT urs.user_id, urs.effect, urs.scope_type, urs.scope_id
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.tenant_id = ?
       AND p.code = ?${effectiveGuard.sql}
     ORDER BY urs.user_id ASC, urs.id ASC`,
    [normalizedTenantId, normalizedCode, ...effectiveGuard.params]
  );
  const rows = permissionResult.rows || [];
  if (rows.length === 0) {
    return [];
  }
  const hierarchy = await loadHierarchy({ tenantId: normalizedTenantId, runQuery });
  const rowsByUserId = new Map();
  for (const row of rows) {
    const normalizedUserId = parsePositiveInt(row.user_id);
    if (!normalizedUserId) {
      continue;
    }
    if (!rowsByUserId.has(normalizedUserId)) {
      rowsByUserId.set(normalizedUserId, []);
    }
    rowsByUserId.get(normalizedUserId).push(row);
  }
  const matchedUserIds = [];
  for (const [matchedUserId, userRows] of rowsByUserId.entries()) {
    const permissionScopeContext = buildScopeContext(normalizedTenantId, userRows, hierarchy);
    if (isScopeAllowed(permissionScopeContext, requestedScope)) {
      matchedUserIds.push(matchedUserId);
    }
  }
  return matchedUserIds;}
/**
 * Invalidate cached RBAC/authz bundles for one tenant after role or scope changes.
 */
export async function invalidateAuthzScopeCache(tenantId) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    return;
  }
  const currentVersion = toPositiveVersion(memoryTenantVersionCache.get(normalizedTenantId));
  const nextVersion = currentVersion + 1;
  setMemoryTenantVersion(normalizedTenantId, nextVersion);
  purgeTenantScopedMemoryEntries(normalizedTenantId);
  const client = await getRedisClientForCache();
  if (!client) {
    return;
  }
  try {
    const redisVersion = await client.incr(buildTenantVersionRedisKey(normalizedTenantId));
    setMemoryTenantVersion(normalizedTenantId, toPositiveVersion(redisVersion));
  } catch (err) {
    useMemoryCacheFallback(err);
  }}
