import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const errorResponseRef = { $ref: "#/components/responses/ErrorResponse" };
const createdResponseRef = { $ref: "#/components/responses/CreatedResponse" };
const okResponseRef = { $ref: "#/components/responses/OkResponse" };

const intId = { type: "integer", minimum: 1 };
const nonNegativeInt = { type: "integer", minimum: 0 };
const shortText = { type: "string", minLength: 1 };
const currencyCode = { type: "string", minLength: 3, maxLength: 3 };

function jsonResponse(schemaRef, description) {
  return {
    description,
    content: {
      "application/json": {
        schema: schemaRef.startsWith("#/")
          ? { $ref: schemaRef }
          : { type: "object", additionalProperties: true },
      },
    },
  };
}

function withStandardResponses(successCode, successDescription, successSchemaRef = "#/components/schemas/AnyObject") {
  return {
    [successCode]: jsonResponse(successSchemaRef, successDescription),
    "400": errorResponseRef,
    "401": errorResponseRef,
    "403": errorResponseRef,
  };
}

function bodyFromRef(schemaRef, required = true) {
  return {
    required,
    content: {
      "application/json": {
        schema: { $ref: schemaRef },
      },
    },
  };
}

function pathParam(name, description = `${name} identifier`) {
  return {
    in: "path",
    name,
    required: true,
    description,
    schema: intId,
  };
}

function queryParamInt(name, required = false, description = `${name}`) {
  return {
    in: "query",
    name,
    required,
    description,
    schema: intId,
  };
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const TAG_DESCRIPTION_MAP = new Map([
  ["Org", "Organization hierarchy and fiscal structure management."],
  ["Security", "Role and permission assignment APIs."],
  ["GL", "General ledger setup and journal workflows."],
  ["FX", "Foreign exchange rate management."],
  ["Intercompany", "Intercompany relationship and reconciliation endpoints."],
  ["Consolidation", "Consolidation setup, runs, and report endpoints."],
  ["Onboarding", "Tenant/company bootstrap flow endpoints."],
  ["Cash", "Cash register, session, transaction, and exception workflows."],
  ["Auth", "Session and identity endpoints."],
  ["Provider", "Provider control-plane administration endpoints."],
  ["System", "System health and operational endpoints."],
]);

function normalizeApiPath(input) {
  const normalized = String(input || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");

  if (!normalized) {
    return "/";
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
  return withoutTrailingSlash || "/";
}

function joinRoutePaths(basePath, routePath) {
  return normalizeApiPath(`${basePath || ""}/${routePath || ""}`);
}

function sanitizeToken(value) {
  return String(value || "")
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
}

function toPascalCase(value) {
  const words = sanitizeToken(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "Item";
  }
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function ensureUniqueOperationId(baseOperationId, usedOperationIds) {
  let operationId = baseOperationId;
  let suffix = 2;
  while (usedOperationIds.has(operationId)) {
    operationId = `${baseOperationId}${suffix}`;
    suffix += 1;
  }
  usedOperationIds.add(operationId);
  return operationId;
}

function buildOperationId(method, endpointPath, usedOperationIds) {
  const parts = endpointPath
    .split("/")
    .filter(Boolean)
    .map((segment) => toPascalCase(segment));
  const baseOperationId = `${String(method || "").toLowerCase()}${parts.join("")}` || "operation";
  return ensureUniqueOperationId(baseOperationId, usedOperationIds);
}

function extractPathParamNames(endpointPath) {
  const matches = endpointPath.matchAll(/\{([A-Za-z0-9_]+)\}/g);
  return Array.from(matches, (match) => match[1]);
}

function inferTagFromPath(endpointPath) {
  const normalizedPath = normalizeApiPath(endpointPath);
  if (normalizedPath === "/health") {
    return "System";
  }
  if (normalizedPath.startsWith("/auth") || normalizedPath.startsWith("/me")) {
    return "Auth";
  }
  if (normalizedPath.startsWith("/api/v1/provider")) {
    return "Provider";
  }
  if (normalizedPath.startsWith("/api/v1/cash")) {
    return "Cash";
  }
  if (normalizedPath.startsWith("/api/v1/org")) {
    return "Org";
  }
  if (normalizedPath.startsWith("/api/v1/security") || normalizedPath.startsWith("/api/v1/rbac")) {
    return "Security";
  }
  if (normalizedPath.startsWith("/api/v1/gl")) {
    return "GL";
  }
  if (normalizedPath.startsWith("/api/v1/fx")) {
    return "FX";
  }
  if (normalizedPath.startsWith("/api/v1/intercompany")) {
    return "Intercompany";
  }
  if (normalizedPath.startsWith("/api/v1/consolidation")) {
    return "Consolidation";
  }
  if (normalizedPath.startsWith("/api/v1/onboarding")) {
    return "Onboarding";
  }
  return "System";
}

function ensureTagPresent(specObject, tagName) {
  if (!Array.isArray(specObject.tags)) {
    specObject.tags = [];
  }
  if (specObject.tags.some((tag) => tag.name === tagName)) {
    return;
  }
  specObject.tags.push({
    name: tagName,
    description: TAG_DESCRIPTION_MAP.get(tagName) || "Auto-documented endpoints.",
  });
}

function buildOperationSecurity(endpointPath) {
  const normalizedPath = normalizeApiPath(endpointPath);
  if (
    normalizedPath === "/health" ||
    normalizedPath.startsWith("/auth/") ||
    normalizedPath === "/api/v1/provider/auth/login"
  ) {
    return [];
  }
  if (normalizedPath === "/api/v1/provider/tenants/bootstrap") {
    return [{ providerApiKey: [] }];
  }
  return null;
}

function collectRouterEndpoints(router, mountPath = "/") {
  if (!router || !Array.isArray(router.stack)) {
    return [];
  }

  const endpoints = [];
  for (const layer of router.stack) {
    const route = layer?.route;
    if (route?.path) {
      const routePaths = Array.isArray(route.path) ? route.path : [route.path];
      for (const routePath of routePaths) {
        const fullPath = joinRoutePaths(mountPath, String(routePath));
        const methods = route.methods || {};
        for (const [methodName, enabled] of Object.entries(methods)) {
          const method = String(methodName || "").toUpperCase();
          if (enabled && HTTP_METHODS.has(method)) {
            endpoints.push({ method, path: fullPath });
          }
        }
      }
      continue;
    }

    if (layer?.name === "router" && layer?.handle?.stack) {
      const nestedMount = typeof layer.path === "string" ? layer.path : "/";
      endpoints.push(...collectRouterEndpoints(layer.handle, joinRoutePaths(mountPath, nestedMount)));
    }
  }

  return endpoints;
}

function parseRouteModuleImports(indexSource, indexDir) {
  const imports = new Map();
  const importRegex = /import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'](\.\/routes\/[^"']+)["'];?/g;
  let match;
  while ((match = importRegex.exec(indexSource))) {
    const importName = match[1];
    const importPath = path.resolve(indexDir, match[2]);
    imports.set(importName, importPath);
  }
  return imports;
}

function parseMountedRouters(indexSource) {
  const mounts = [];
  const mountRegex =
    /app\.use\(\s*["']([^"']+)["']\s*,\s*(?:requireAuth\s*,\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;
  let match;
  while ((match = mountRegex.exec(indexSource))) {
    mounts.push({
      mountPath: normalizeApiPath(match[1]),
      routerImportName: match[2],
    });
  }
  return mounts;
}

async function discoverExpressRoutes(indexFilePath) {
  const indexSource = fs.readFileSync(indexFilePath, "utf8");
  const indexDir = path.dirname(indexFilePath);
  const routeImports = parseRouteModuleImports(indexSource, indexDir);
  const mounts = parseMountedRouters(indexSource);

  const moduleCache = new Map();
  const discovered = [];

  for (const mount of mounts) {
    const modulePath = routeImports.get(mount.routerImportName);
    if (!modulePath) {
      continue;
    }

    let importedModule = moduleCache.get(modulePath);
    if (!importedModule) {
      importedModule = await import(pathToFileURL(modulePath).href);
      moduleCache.set(modulePath, importedModule);
    }

    const router = importedModule?.default;
    discovered.push(...collectRouterEndpoints(router, mount.mountPath));
  }

  discovered.push({ method: "GET", path: "/health" });

  const deduped = new Map();
  for (const endpoint of discovered) {
    const key = `${endpoint.method} ${normalizeApiPath(endpoint.path)}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        method: endpoint.method,
        path: normalizeApiPath(endpoint.path),
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const pathCompare = a.path.localeCompare(b.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return a.method.localeCompare(b.method);
  });
}

function buildFallbackOperation(specObject, endpoint, usedOperationIds) {
  const tagName = inferTagFromPath(endpoint.path);
  ensureTagPresent(specObject, tagName);

  const pathParams = extractPathParamNames(endpoint.path).map((paramName) =>
    pathParam(paramName, `${paramName} identifier`)
  );

  const operation = {
    tags: [tagName],
    operationId: buildOperationId(endpoint.method, endpoint.path, usedOperationIds),
    summary: `Auto-generated: ${endpoint.method} ${endpoint.path}`,
    responses: withStandardResponses("200", "Successful response"),
  };

  if (pathParams.length > 0) {
    operation.parameters = pathParams;
  }

  if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
    operation.requestBody = bodyFromRef("#/components/schemas/AnyObject", false);
  }

  const operationSecurity = buildOperationSecurity(endpoint.path);
  if (operationSecurity !== null) {
    operation.security = operationSecurity;
  }

  return operation;
}

function collectExistingOperationIds(specObject) {
  const operationIds = new Set();
  const paths = specObject.paths || {};
  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem || {})) {
      if (operation?.operationId) {
        operationIds.add(operation.operationId);
      }
    }
  }
  return operationIds;
}

function collectDocumentedRouteKeys(specObject) {
  const keys = new Set();
  const paths = specObject.paths || {};
  for (const [pathName, pathItem] of Object.entries(paths)) {
    const normalizedPath = normalizeApiPath(pathName);
    for (const methodName of Object.keys(pathItem || {})) {
      const method = String(methodName || "").toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      keys.add(`${method} ${normalizedPath}`);
    }
  }
  return keys;
}

async function appendUndocumentedRoutes(specObject, indexFilePath) {
  const discoveredRoutes = await discoverExpressRoutes(indexFilePath);
  const documentedRouteKeys = collectDocumentedRouteKeys(specObject);
  const usedOperationIds = collectExistingOperationIds(specObject);

  let appendedCount = 0;
  for (const route of discoveredRoutes) {
    const routeKey = `${route.method} ${normalizeApiPath(route.path)}`;
    if (documentedRouteKeys.has(routeKey)) {
      continue;
    }

    const pathName = normalizeApiPath(route.path);
    const methodName = route.method.toLowerCase();
    if (!specObject.paths[pathName]) {
      specObject.paths[pathName] = {};
    }

    specObject.paths[pathName][methodName] = buildFallbackOperation(
      specObject,
      route,
      usedOperationIds
    );

    documentedRouteKeys.add(routeKey);
    appendedCount += 1;
  }

  return appendedCount;
}

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Global Multi-Entity ERP API",
    version: "0.4.0",
    description: "API contract for global multi-entity accounting endpoints under /api/v1.",
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "https://api.global-ledger.com",
      description: "Production",
    },
  ],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Org", description: "Organization hierarchy and fiscal structure management." },
    { name: "Security", description: "Role and permission assignment APIs." },
    { name: "GL", description: "General ledger setup and journal workflows." },
    { name: "FX", description: "Foreign exchange rate management." },
    { name: "Intercompany", description: "Intercompany relationship and reconciliation endpoints." },
    { name: "Consolidation", description: "Consolidation setup, runs, and report endpoints." },
    { name: "Onboarding", description: "Tenant/company bootstrap flow endpoints." },
  ],
  paths: {
    "/api/v1/org/tree": {
      get: {
        tags: ["Org"],
        operationId: "getOrgTree",
        summary: "Get organization tree",
        parameters: [queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT")],
        responses: withStandardResponses("200", "Organization tree", "#/components/schemas/OrgTreeResponse"),
      },
    },
    "/api/v1/org/group-companies": {
      get: {
        tags: ["Org"],
        operationId: "listGroupCompanies",
        summary: "List group companies",
        parameters: [queryParamInt("tenantId", false, "Tenant identifier")],
        responses: withStandardResponses("200", "Group company list"),
      },
      post: {
        tags: ["Org"],
        operationId: "upsertGroupCompany",
        summary: "Create or update group company",
        requestBody: bodyFromRef("#/components/schemas/GroupCompanyInput"),
        responses: {
          "201": jsonResponse("#/components/schemas/GroupCompanyResponse", "Group company created or updated"),
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/org/legal-entities": {
      get: {
        tags: ["Org"],
        operationId: "listLegalEntities",
        summary: "List legal entities",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("groupCompanyId", false, "Group company identifier"),
          queryParamInt("countryId", false, "Country identifier"),
          {
            in: "query",
            name: "status",
            required: false,
            schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          },
        ],
        responses: withStandardResponses("200", "Legal entity list"),
      },
      post: {
        tags: ["Org"],
        operationId: "upsertLegalEntity",
        summary: "Create or update legal entity",
        requestBody: bodyFromRef("#/components/schemas/LegalEntityInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/org/operating-units": {
      get: {
        tags: ["Org"],
        operationId: "listOperatingUnits",
        summary: "List operating units",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
        ],
        responses: withStandardResponses("200", "Operating unit list"),
      },
      post: {
        tags: ["Org"],
        operationId: "upsertOperatingUnit",
        summary: "Create or update operating unit",
        requestBody: bodyFromRef("#/components/schemas/OperatingUnitInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/org/countries": {
      get: {
        tags: ["Org"],
        operationId: "listScopedCountries",
        summary: "List countries visible in scope",
        parameters: [queryParamInt("tenantId", false, "Tenant identifier")],
        responses: withStandardResponses("200", "Country list"),
      },
    },
    "/api/v1/org/fiscal-calendars": {
      get: {
        tags: ["Org"],
        operationId: "listFiscalCalendars",
        summary: "List fiscal calendars",
        parameters: [queryParamInt("tenantId", false, "Tenant identifier")],
        responses: withStandardResponses("200", "Fiscal calendars"),
      },
      post: {
        tags: ["Org"],
        operationId: "upsertFiscalCalendar",
        summary: "Create or update fiscal calendar",
        requestBody: bodyFromRef("#/components/schemas/FiscalCalendarInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/org/fiscal-calendars/{calendarId}/periods": {
      get: {
        tags: ["Org"],
        operationId: "listFiscalPeriods",
        summary: "List fiscal periods for a calendar",
        parameters: [
          pathParam("calendarId", "Fiscal calendar identifier"),
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("fiscalYear", false, "Fiscal year"),
        ],
        responses: withStandardResponses("200", "Fiscal periods"),
      },
    },
    "/api/v1/org/fiscal-periods/generate": {
      post: {
        tags: ["Org"],
        operationId: "generateFiscalPeriods",
        summary: "Generate fiscal periods",
        requestBody: bodyFromRef("#/components/schemas/FiscalPeriodGenerateInput"),
        responses: withStandardResponses(
          "201",
          "Fiscal periods generated",
          "#/components/schemas/FiscalPeriodGenerateResponse"
        ),
      },
    },
    "/api/v1/security/roles": {
      get: {
        tags: ["Security"],
        operationId: "listRoles",
        summary: "List roles",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          {
            in: "query",
            name: "includePermissions",
            required: false,
            schema: { type: "boolean" },
          },
        ],
        responses: withStandardResponses("200", "Role list"),
      },
      post: {
        tags: ["Security"],
        operationId: "upsertRole",
        summary: "Create or update role",
        requestBody: bodyFromRef("#/components/schemas/RoleInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/security/roles/{roleId}/permissions": {
      get: {
        tags: ["Security"],
        operationId: "listRolePermissions",
        summary: "List permissions of role",
        parameters: [pathParam("roleId", "Role identifier")],
        responses: withStandardResponses("200", "Role permissions"),
      },
      post: {
        tags: ["Security"],
        operationId: "assignRolePermissions",
        summary: "Assign permissions to role",
        parameters: [pathParam("roleId", "Role identifier")],
        requestBody: bodyFromRef("#/components/schemas/RolePermissionsInput"),
        responses: {
          "201": jsonResponse("#/components/schemas/RolePermissionsResponse", "Permissions assigned"),
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
      put: {
        tags: ["Security"],
        operationId: "replaceRolePermissions",
        summary: "Replace permissions of role",
        parameters: [pathParam("roleId", "Role identifier")],
        requestBody: bodyFromRef("#/components/schemas/RolePermissionsInput"),
        responses: withStandardResponses("200", "Role permissions replaced"),
      },
    },
    "/api/v1/security/role-assignments": {
      get: {
        tags: ["Security"],
        operationId: "listRoleAssignments",
        summary: "List role assignments",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("userId", false, "User identifier"),
          queryParamInt("roleId", false, "Role identifier"),
          queryParamInt("scopeId", false, "Scope identifier"),
          {
            in: "query",
            name: "scopeType",
            required: false,
            schema: { type: "string", enum: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"] },
          },
        ],
        responses: withStandardResponses("200", "Role assignment list"),
      },
      post: {
        tags: ["Security"],
        operationId: "assignRoleToUserScope",
        summary: "Assign role to user scope",
        requestBody: bodyFromRef("#/components/schemas/RoleAssignmentInput"),
        responses: {
          "201": okResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/security/role-assignments/{assignmentId}": {
      delete: {
        tags: ["Security"],
        operationId: "deleteRoleAssignment",
        summary: "Delete role assignment",
        parameters: [pathParam("assignmentId", "Assignment identifier")],
        responses: withStandardResponses("200", "Role assignment deleted", "#/components/schemas/Ok"),
      },
    },
    "/api/v1/security/role-assignments/{assignmentId}/scope": {
      put: {
        tags: ["Security"],
        operationId: "replaceRoleAssignmentScope",
        summary: "Replace scope/effect of an existing role assignment",
        parameters: [pathParam("assignmentId", "Assignment identifier")],
        requestBody: bodyFromRef(
          "#/components/schemas/RoleAssignmentScopeReplaceInput"
        ),
        responses: withStandardResponses(
          "200",
          "Role assignment scope replaced"
        ),
      },
    },
    "/api/v1/security/permissions": {
      get: {
        tags: ["Security"],
        operationId: "listPermissions",
        summary: "List permissions",
        parameters: [
          {
            in: "query",
            name: "q",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: withStandardResponses("200", "Permission list"),
      },
    },
    "/api/v1/security/users": {
      get: {
        tags: ["Security"],
        operationId: "listSecurityUsers",
        summary: "List tenant users for RBAC administration",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          {
            in: "query",
            name: "q",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: withStandardResponses("200", "User list"),
      },
    },
    "/api/v1/security/data-scopes": {
      get: {
        tags: ["Security"],
        operationId: "listDataScopes",
        summary: "List data scopes",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("userId", false, "User identifier"),
          queryParamInt("scopeId", false, "Scope identifier"),
          {
            in: "query",
            name: "scopeType",
            required: false,
            schema: { type: "string", enum: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"] },
          },
        ],
        responses: withStandardResponses("200", "Data scope list"),
      },
      post: {
        tags: ["Security"],
        operationId: "upsertDataScope",
        summary: "Create/update data scope",
        requestBody: bodyFromRef("#/components/schemas/AnyObject"),
        responses: withStandardResponses("201", "Data scope upserted", "#/components/schemas/Ok"),
      },
    },
    "/api/v1/security/data-scopes/{dataScopeId}": {
      delete: {
        tags: ["Security"],
        operationId: "deleteDataScope",
        summary: "Delete data scope",
        parameters: [pathParam("dataScopeId", "Data scope identifier")],
        responses: withStandardResponses("200", "Data scope deleted", "#/components/schemas/Ok"),
      },
    },
    "/api/v1/security/data-scopes/users/{userId}/replace": {
      put: {
        tags: ["Security"],
        operationId: "replaceUserDataScopes",
        summary: "Replace all data scopes for a user",
        parameters: [pathParam("userId", "User identifier")],
        requestBody: bodyFromRef("#/components/schemas/DataScopeReplaceInput"),
        responses: withStandardResponses("200", "User data scopes replaced"),
      },
    },
    "/api/v1/rbac/audit-logs": {
      get: {
        tags: ["Security"],
        operationId: "listRbacAuditLogs",
        summary: "List RBAC audit logs",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("page", false, "Page number"),
          queryParamInt("pageSize", false, "Page size"),
          queryParamInt("scopeId", false, "Scope identifier"),
          queryParamInt("actorUserId", false, "Actor user identifier"),
          queryParamInt("targetUserId", false, "Target user identifier"),
          {
            in: "query",
            name: "scopeType",
            required: false,
            schema: {
              type: "string",
              enum: [
                "TENANT",
                "GROUP",
                "COUNTRY",
                "LEGAL_ENTITY",
                "OPERATING_UNIT",
              ],
            },
          },
          {
            in: "query",
            name: "action",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "resourceType",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "createdFrom",
            required: false,
            schema: { type: "string", format: "date-time" },
          },
          {
            in: "query",
            name: "createdTo",
            required: false,
            schema: { type: "string", format: "date-time" },
          },
        ],
        responses: withStandardResponses(
          "200",
          "RBAC audit logs",
          "#/components/schemas/RbacAuditLogListResponse"
        ),
      },
    },
    "/api/v1/gl/books": {
      get: {
        tags: ["GL"],
        operationId: "listBooks",
        summary: "List books",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
        ],
        responses: withStandardResponses("200", "Books"),
      },
      post: {
        tags: ["GL"],
        operationId: "upsertBook",
        summary: "Create or update accounting book",
        requestBody: bodyFromRef("#/components/schemas/BookInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/gl/coas": {
      get: {
        tags: ["GL"],
        operationId: "listChartOfAccounts",
        summary: "List chart of accounts",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
          {
            in: "query",
            name: "scope",
            required: false,
            schema: { type: "string", enum: ["LEGAL_ENTITY", "GROUP"] },
          },
        ],
        responses: withStandardResponses("200", "Chart of accounts list"),
      },
      post: {
        tags: ["GL"],
        operationId: "upsertChartOfAccounts",
        summary: "Create or update chart of accounts",
        requestBody: bodyFromRef("#/components/schemas/CoaInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/gl/accounts": {
      get: {
        tags: ["GL"],
        operationId: "listAccounts",
        summary: "List accounts",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("coaId", false, "Chart of accounts identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
          {
            in: "query",
            name: "includeInactive",
            required: false,
            schema: { type: "boolean" },
          },
        ],
        responses: withStandardResponses("200", "Accounts list"),
      },
      post: {
        tags: ["GL"],
        operationId: "upsertAccount",
        summary: "Create or update account",
        requestBody: bodyFromRef("#/components/schemas/AccountInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/gl/account-mappings": {
      post: {
        tags: ["GL"],
        operationId: "upsertAccountMapping",
        summary: "Create or update account mapping",
        requestBody: bodyFromRef("#/components/schemas/AccountMappingInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/gl/journals": {
      get: {
        tags: ["GL"],
        operationId: "listJournals",
        summary: "List journals",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("bookId", false, "Book identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
          queryParamInt("fiscalPeriodId", false, "Fiscal period identifier"),
          {
            in: "query",
            name: "status",
            required: false,
            schema: { type: "string", enum: ["DRAFT", "POSTED", "REVERSED"] },
          },
        ],
        responses: withStandardResponses("200", "Journal list"),
      },
      post: {
        tags: ["GL"],
        operationId: "createJournal",
        summary: "Create draft journal",
        requestBody: bodyFromRef("#/components/schemas/JournalCreateInput"),
        responses: withStandardResponses("201", "Journal created", "#/components/schemas/JournalCreateResponse"),
      },
    },
    "/api/v1/gl/journals/{journalId}": {
      get: {
        tags: ["GL"],
        operationId: "getJournalById",
        summary: "Get journal with lines",
        parameters: [pathParam("journalId", "Journal identifier")],
        responses: withStandardResponses("200", "Journal detail"),
      },
    },
    "/api/v1/gl/journals/{journalId}/post": {
      post: {
        tags: ["GL"],
        operationId: "postJournal",
        summary: "Post draft journal",
        parameters: [pathParam("journalId", "Journal identifier")],
        responses: withStandardResponses("200", "Post result", "#/components/schemas/PostJournalResponse"),
      },
    },
    "/api/v1/gl/journals/{journalId}/reverse": {
      post: {
        tags: ["GL"],
        operationId: "reverseJournal",
        summary: "Reverse posted journal",
        parameters: [pathParam("journalId", "Journal identifier")],
        requestBody: bodyFromRef("#/components/schemas/AnyObject", false),
        responses: withStandardResponses("201", "Reversal created"),
      },
    },
    "/api/v1/gl/trial-balance": {
      get: {
        tags: ["GL"],
        operationId: "getTrialBalance",
        summary: "Get trial balance by book and period",
        parameters: [
          queryParamInt("bookId", true, "Book identifier"),
          queryParamInt("fiscalPeriodId", true, "Fiscal period identifier"),
        ],
        responses: withStandardResponses("200", "Trial balance", "#/components/schemas/TrialBalanceResponse"),
      },
    },
    "/api/v1/gl/period-closing/runs": {
      get: {
        tags: ["GL"],
        operationId: "listPeriodCloseRuns",
        summary: "List period close runs",
        parameters: [
          queryParamInt("bookId", false, "Book identifier"),
          queryParamInt("fiscalPeriodId", false, "Fiscal period identifier"),
          {
            in: "query",
            name: "status",
            required: false,
            schema: {
              type: "string",
              enum: ["IN_PROGRESS", "COMPLETED", "FAILED", "REOPENED"],
            },
          },
          {
            in: "query",
            name: "includeLines",
            required: false,
            schema: { type: "boolean" },
          },
        ],
        responses: withStandardResponses(
          "200",
          "Period close runs",
          "#/components/schemas/AnyObject"
        ),
      },
    },
    "/api/v1/gl/period-closing/{bookId}/{periodId}/close-run": {
      post: {
        tags: ["GL"],
        operationId: "runPeriodClose",
        summary: "Execute period close run",
        parameters: [
          pathParam("bookId", "Book identifier"),
          pathParam("periodId", "Fiscal period identifier"),
        ],
        requestBody: bodyFromRef("#/components/schemas/AnyObject", false),
        responses: {
          "200": jsonResponse(
            "#/components/schemas/AnyObject",
            "Idempotent close run hit"
          ),
          "201": jsonResponse(
            "#/components/schemas/AnyObject",
            "Period close run executed"
          ),
          "400": errorResponseRef,
          "401": errorResponseRef,
          "403": errorResponseRef,
        },
      },
    },
    "/api/v1/gl/period-closing/{bookId}/{periodId}/reopen": {
      post: {
        tags: ["GL"],
        operationId: "reopenPeriodClose",
        summary: "Reopen latest completed period close run",
        parameters: [
          pathParam("bookId", "Book identifier"),
          pathParam("periodId", "Fiscal period identifier"),
        ],
        requestBody: bodyFromRef("#/components/schemas/AnyObject"),
        responses: withStandardResponses(
          "201",
          "Period close run reopened",
          "#/components/schemas/AnyObject"
        ),
      },
    },
    "/api/v1/gl/period-statuses/{bookId}/{periodId}/close": {
      post: {
        tags: ["GL"],
        operationId: "closePeriod",
        summary: "Set period close status",
        parameters: [
          pathParam("bookId", "Book identifier"),
          pathParam("periodId", "Fiscal period identifier"),
        ],
        requestBody: bodyFromRef("#/components/schemas/PeriodCloseInput", false),
        responses: withStandardResponses("201", "Period status updated", "#/components/schemas/PeriodCloseResponse"),
      },
    },
    "/api/v1/fx/rates/bulk-upsert": {
      post: {
        tags: ["FX"],
        operationId: "bulkUpsertFxRates",
        summary: "Bulk upsert FX rates",
        requestBody: bodyFromRef("#/components/schemas/FxBulkUpsertInput"),
        responses: withStandardResponses("201", "FX rates upserted", "#/components/schemas/FxBulkUpsertResponse"),
      },
    },
    "/api/v1/fx/rates": {
      get: {
        tags: ["FX"],
        operationId: "getFxRates",
        summary: "Query FX rates",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          { in: "query", name: "dateFrom", required: false, schema: { type: "string", format: "date" } },
          { in: "query", name: "dateTo", required: false, schema: { type: "string", format: "date" } },
          { in: "query", name: "fromCurrencyCode", required: false, schema: currencyCode },
          { in: "query", name: "toCurrencyCode", required: false, schema: currencyCode },
          { in: "query", name: "rateType", required: false, schema: { type: "string", enum: ["SPOT", "AVERAGE", "CLOSING"] } },
        ],
        responses: withStandardResponses("200", "FX rate list", "#/components/schemas/FxRatesResponse"),
      },
    },
    "/api/v1/intercompany/pairs": {
      post: {
        tags: ["Intercompany"],
        operationId: "upsertIntercompanyPair",
        summary: "Create or update intercompany pair",
        requestBody: bodyFromRef("#/components/schemas/IntercompanyPairInput"),
        responses: {
          "201": jsonResponse("#/components/schemas/IntercompanyPairResponse", "Intercompany pair created or updated"),
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/intercompany/entity-flags": {
      get: {
        tags: ["Intercompany"],
        operationId: "listIntercompanyEntityFlags",
        summary: "List legal entity intercompany flags",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
        ],
        responses: withStandardResponses("200", "Intercompany entity flags"),
      },
    },
    "/api/v1/intercompany/entity-flags/{legalEntityId}": {
      patch: {
        tags: ["Intercompany"],
        operationId: "updateIntercompanyEntityFlags",
        summary: "Update intercompany flags for legal entity",
        parameters: [pathParam("legalEntityId", "Legal entity identifier")],
        requestBody: bodyFromRef("#/components/schemas/AnyObject"),
        responses: withStandardResponses("200", "Intercompany flags updated"),
      },
    },
    "/api/v1/intercompany/reconcile": {
      post: {
        tags: ["Intercompany"],
        operationId: "reconcileIntercompany",
        summary: "Reconcile intercompany balances",
        requestBody: bodyFromRef("#/components/schemas/AnyObject", false),
        responses: {
          "200": jsonResponse(
            "#/components/schemas/IntercompanyReconcileResponse",
            "Intercompany reconciliation result"
          ),
          "400": errorResponseRef,
          "401": errorResponseRef,
          "501": jsonResponse("#/components/schemas/Error", "Not implemented"),
        },
      },
    },
    "/api/v1/consolidation/groups": {
      get: {
        tags: ["Consolidation"],
        operationId: "listConsolidationGroups",
        summary: "List consolidation groups",
        parameters: [queryParamInt("tenantId", false, "Tenant identifier")],
        responses: withStandardResponses("200", "Consolidation group list"),
      },
      post: {
        tags: ["Consolidation"],
        operationId: "upsertConsolidationGroup",
        summary: "Create or update consolidation group",
        requestBody: bodyFromRef("#/components/schemas/ConsolidationGroupInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/consolidation/groups/{groupId}/coa-mappings": {
      get: {
        tags: ["Consolidation"],
        operationId: "listGroupCoaMappings",
        summary: "List group CoA mappings",
        parameters: [
          pathParam("groupId", "Consolidation group identifier"),
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
        ],
        responses: withStandardResponses("200", "Group CoA mapping list"),
      },
      post: {
        tags: ["Consolidation"],
        operationId: "upsertGroupCoaMapping",
        summary: "Create or update group CoA mapping",
        parameters: [pathParam("groupId", "Consolidation group identifier")],
        requestBody: bodyFromRef("#/components/schemas/AnyObject"),
        responses: withStandardResponses("201", "Group CoA mapping upserted"),
      },
    },
    "/api/v1/consolidation/groups/{groupId}/elimination-placeholders": {
      get: {
        tags: ["Consolidation"],
        operationId: "listEliminationPlaceholders",
        summary: "List elimination placeholders",
        parameters: [
          pathParam("groupId", "Consolidation group identifier"),
          queryParamInt("tenantId", false, "Tenant identifier"),
        ],
        responses: withStandardResponses("200", "Elimination placeholder list"),
      },
      post: {
        tags: ["Consolidation"],
        operationId: "upsertEliminationPlaceholder",
        summary: "Create or update elimination placeholder",
        parameters: [pathParam("groupId", "Consolidation group identifier")],
        requestBody: bodyFromRef("#/components/schemas/AnyObject"),
        responses: withStandardResponses("201", "Elimination placeholder upserted"),
      },
    },
    "/api/v1/consolidation/groups/{groupId}/members": {
      post: {
        tags: ["Consolidation"],
        operationId: "upsertConsolidationGroupMember",
        summary: "Add or update consolidation group member",
        parameters: [pathParam("groupId", "Consolidation group identifier")],
        requestBody: bodyFromRef("#/components/schemas/ConsolidationMemberInput"),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
        },
      },
    },
    "/api/v1/consolidation/runs": {
      get: {
        tags: ["Consolidation"],
        operationId: "listConsolidationRuns",
        summary: "List consolidation runs",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt(
            "consolidationGroupId",
            false,
            "Consolidation group identifier"
          ),
          queryParamInt("fiscalPeriodId", false, "Fiscal period identifier"),
          {
            in: "query",
            name: "status",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: withStandardResponses("200", "Consolidation run list"),
      },
      post: {
        tags: ["Consolidation"],
        operationId: "createConsolidationRun",
        summary: "Start consolidation run",
        requestBody: bodyFromRef("#/components/schemas/ConsolidationRunInput"),
        responses: withStandardResponses(
          "201",
          "Consolidation run created",
          "#/components/schemas/ConsolidationRunResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}": {
      get: {
        tags: ["Consolidation"],
        operationId: "getConsolidationRun",
        summary: "Get consolidation run details",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        responses: withStandardResponses("200", "Consolidation run details"),
      },
    },
    "/api/v1/consolidation/runs/{runId}/execute": {
      post: {
        tags: ["Consolidation"],
        operationId: "executeConsolidationRun",
        summary: "Execute consolidation run",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        requestBody: bodyFromRef(
          "#/components/schemas/ConsolidationRunExecuteInput",
          false
        ),
        responses: withStandardResponses(
          "200",
          "Consolidation run executed",
          "#/components/schemas/ConsolidationRunExecuteResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/eliminations": {
      get: {
        tags: ["Consolidation"],
        operationId: "listConsolidationEliminations",
        summary: "List consolidation eliminations",
        parameters: [
          pathParam("runId", "Consolidation run identifier"),
          {
            in: "query",
            name: "status",
            required: false,
            schema: { type: "string", enum: ["ALL", "DRAFT", "POSTED"] },
          },
          {
            in: "query",
            name: "includeLines",
            required: false,
            schema: { type: "boolean" },
          },
        ],
        responses: withStandardResponses(
          "200",
          "Elimination list",
          "#/components/schemas/AnyObject"
        ),
      },
      post: {
        tags: ["Consolidation"],
        operationId: "createEliminationEntry",
        summary: "Create elimination entry",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        requestBody: bodyFromRef("#/components/schemas/EliminationCreateInput"),
        responses: withStandardResponses(
          "201",
          "Elimination entry created",
          "#/components/schemas/EliminationCreateResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/eliminations/{eliminationEntryId}/post": {
      post: {
        tags: ["Consolidation"],
        operationId: "postEliminationEntry",
        summary: "Post elimination entry",
        parameters: [
          pathParam("runId", "Consolidation run identifier"),
          pathParam("eliminationEntryId", "Elimination entry identifier"),
        ],
        responses: withStandardResponses(
          "200",
          "Elimination entry posted",
          "#/components/schemas/AnyObject"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/adjustments": {
      get: {
        tags: ["Consolidation"],
        operationId: "listConsolidationAdjustments",
        summary: "List consolidation adjustments",
        parameters: [
          pathParam("runId", "Consolidation run identifier"),
          {
            in: "query",
            name: "status",
            required: false,
            schema: { type: "string", enum: ["ALL", "DRAFT", "POSTED"] },
          },
        ],
        responses: withStandardResponses(
          "200",
          "Adjustment list",
          "#/components/schemas/AnyObject"
        ),
      },
      post: {
        tags: ["Consolidation"],
        operationId: "createConsolidationAdjustment",
        summary: "Create consolidation adjustment",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        requestBody: bodyFromRef("#/components/schemas/AdjustmentCreateInput"),
        responses: withStandardResponses(
          "201",
          "Adjustment created",
          "#/components/schemas/AdjustmentCreateResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/adjustments/{adjustmentId}/post": {
      post: {
        tags: ["Consolidation"],
        operationId: "postConsolidationAdjustment",
        summary: "Post consolidation adjustment",
        parameters: [
          pathParam("runId", "Consolidation run identifier"),
          pathParam("adjustmentId", "Adjustment identifier"),
        ],
        responses: withStandardResponses(
          "200",
          "Consolidation adjustment posted",
          "#/components/schemas/AnyObject"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/finalize": {
      post: {
        tags: ["Consolidation"],
        operationId: "finalizeConsolidationRun",
        summary: "Finalize consolidation run",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        responses: withStandardResponses(
          "200",
          "Consolidation run finalized",
          "#/components/schemas/FinalizeRunResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/reports/trial-balance": {
      get: {
        tags: ["Consolidation"],
        operationId: "getConsolidationTrialBalance",
        summary: "Get consolidation trial balance report",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        responses: withStandardResponses(
          "200",
          "Consolidation trial balance report",
          "#/components/schemas/ConsolidationTrialBalanceResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/reports/summary": {
      get: {
        tags: ["Consolidation"],
        operationId: "getConsolidationSummaryReport",
        summary: "Get consolidation summary report",
        parameters: [
          pathParam("runId", "Consolidation run identifier"),
          {
            in: "query",
            name: "groupBy",
            required: false,
            schema: {
              type: "string",
              enum: ["account", "entity", "account_entity"],
            },
          },
        ],
        responses: withStandardResponses(
          "200",
          "Consolidation summary report",
          "#/components/schemas/ConsolidationSummaryReportResponse"
        ),
      },
    },
    "/api/v1/consolidation/runs/{runId}/reports/balance-sheet": {
      get: {
        tags: ["Consolidation"],
        operationId: "getConsolidationBalanceSheet",
        summary: "Get consolidated balance sheet report",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        responses: {
          "200": jsonResponse("#/components/schemas/BalanceSheetResponse", "Consolidated balance sheet"),
          "400": errorResponseRef,
          "401": errorResponseRef,
          "501": jsonResponse("#/components/schemas/Error", "Not implemented"),
        },
      },
    },
    "/api/v1/consolidation/runs/{runId}/reports/income-statement": {
      get: {
        tags: ["Consolidation"],
        operationId: "getConsolidationIncomeStatement",
        summary: "Get consolidated income statement report",
        parameters: [pathParam("runId", "Consolidation run identifier")],
        responses: {
          "200": jsonResponse("#/components/schemas/IncomeStatementResponse", "Consolidated income statement"),
          "400": errorResponseRef,
          "401": errorResponseRef,
          "501": jsonResponse("#/components/schemas/Error", "Not implemented"),
        },
      },
    },
    "/api/v1/onboarding/company-bootstrap": {
      post: {
        tags: ["Onboarding"],
        operationId: "bootstrapCompany",
        summary: "Run company onboarding bootstrap flow",
        requestBody: bodyFromRef("#/components/schemas/AnyObject"),
        responses: withStandardResponses("201", "Company bootstrap result"),
      },
    },
    "/api/v1/onboarding/readiness": {
      get: {
        tags: ["Onboarding"],
        operationId: "getTenantReadiness",
        summary: "Get tenant setup readiness snapshot",
        parameters: [
          queryParamInt(
            "tenantId",
            false,
            "Tenant identifier; optional if available in JWT"
          ),
        ],
        responses: withStandardResponses(
          "200",
          "Tenant readiness snapshot",
          "#/components/schemas/TenantReadinessResponse"
        ),
      },
    },
    "/api/v1/onboarding/readiness/bootstrap-baseline": {
      post: {
        tags: ["Onboarding"],
        operationId: "bootstrapTenantReadinessBaseline",
        summary: "Create missing baseline setup for tenant readiness",
        requestBody: bodyFromRef(
          "#/components/schemas/TenantReadinessBootstrapInput",
          false
        ),
        responses: withStandardResponses(
          "201",
          "Tenant readiness baseline bootstrap result",
          "#/components/schemas/TenantReadinessBootstrapResponse"
        ),
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      providerApiKey: {
        type: "apiKey",
        in: "header",
        name: "X-Provider-Key",
      },
    },
    responses: {
      ErrorResponse: {
        description: "Error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      CreatedResponse: {
        description: "Created",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Created" },
          },
        },
      },
      OkResponse: {
        description: "Ok",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Ok" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
      Ok: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
        },
        required: ["ok"],
      },
      Created: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          id: { type: "integer", nullable: true },
        },
        required: ["ok"],
      },
      AnyObject: {
        type: "object",
        additionalProperties: true,
      },
      TenantReadinessCheck: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          minimum: nonNegativeInt,
          count: nonNegativeInt,
          ready: { type: "boolean" },
        },
        required: ["key", "label", "minimum", "count", "ready"],
      },
      TenantReadinessCounts: {
        type: "object",
        properties: {
          groupCompanies: nonNegativeInt,
          legalEntities: nonNegativeInt,
          fiscalCalendars: nonNegativeInt,
          fiscalPeriods: nonNegativeInt,
          books: nonNegativeInt,
          chartsOfAccounts: nonNegativeInt,
          accounts: nonNegativeInt,
        },
        required: [
          "groupCompanies",
          "legalEntities",
          "fiscalCalendars",
          "fiscalPeriods",
          "books",
          "chartsOfAccounts",
          "accounts",
        ],
      },
      TenantReadinessResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          ready: { type: "boolean" },
          checks: {
            type: "array",
            items: { $ref: "#/components/schemas/TenantReadinessCheck" },
          },
          counts: { $ref: "#/components/schemas/TenantReadinessCounts" },
          missingKeys: {
            type: "array",
            items: { type: "string" },
          },
          generatedAt: { type: "string", format: "date-time" },
        },
        required: [
          "tenantId",
          "ready",
          "checks",
          "counts",
          "missingKeys",
          "generatedAt",
        ],
      },
      TenantReadinessBootstrapInput: {
        type: "object",
        properties: {
          fiscalYear: { type: "integer", minimum: 1 },
        },
      },
      TenantReadinessStatus: {
        type: "object",
        properties: {
          ready: { type: "boolean" },
          missingKeys: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["ready", "missingKeys"],
      },
      TenantReadinessBootstrapCreated: {
        type: "object",
        properties: {
          groupCompanies: nonNegativeInt,
          legalEntities: nonNegativeInt,
          fiscalCalendars: nonNegativeInt,
          fiscalPeriods: nonNegativeInt,
          chartsOfAccounts: nonNegativeInt,
          accounts: nonNegativeInt,
          books: nonNegativeInt,
        },
        required: [
          "groupCompanies",
          "legalEntities",
          "fiscalCalendars",
          "fiscalPeriods",
          "chartsOfAccounts",
          "accounts",
          "books",
        ],
      },
      TenantReadinessBootstrapResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          tenantId: intId,
          fiscalYear: { type: "integer", minimum: 1 },
          created: {
            $ref: "#/components/schemas/TenantReadinessBootstrapCreated",
          },
          readinessBefore: {
            $ref: "#/components/schemas/TenantReadinessStatus",
          },
          readinessAfter: {
            $ref: "#/components/schemas/TenantReadinessStatus",
          },
        },
        required: [
          "ok",
          "tenantId",
          "fiscalYear",
          "created",
          "readinessBefore",
          "readinessAfter",
        ],
      },
      TrialBalanceRow: {
        type: "object",
        properties: {
          account_id: intId,
          account_code: { type: "string" },
          account_name: { type: "string" },
          debit_total: { type: "number" },
          credit_total: { type: "number" },
          balance: { type: "number" },
        },
        required: ["account_id", "account_code", "account_name", "debit_total", "credit_total", "balance"],
      },
      FxRateRow: {
        type: "object",
        properties: {
          id: intId,
          rate_date: { type: "string", format: "date" },
          from_currency_code: currencyCode,
          to_currency_code: currencyCode,
          rate_type: { type: "string", enum: ["SPOT", "AVERAGE", "CLOSING"] },
          rate: { type: "number" },
          source: { type: "string", nullable: true },
          is_locked: { type: "boolean" },
        },
        required: [
          "id",
          "rate_date",
          "from_currency_code",
          "to_currency_code",
          "rate_type",
          "rate",
          "is_locked",
        ],
      },
      OrgTreeResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          groups: { type: "array", items: { type: "object", additionalProperties: true } },
          countries: { type: "array", items: { type: "object", additionalProperties: true } },
          legalEntities: { type: "array", items: { type: "object", additionalProperties: true } },
          operatingUnits: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        required: ["tenantId", "groups", "countries", "legalEntities", "operatingUnits"],
      },
      FiscalPeriodGenerateResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          calendarId: intId,
          fiscalYear: { type: "integer", minimum: 1 },
          periodsGenerated: { type: "integer", minimum: 1 },
        },
        required: ["ok", "calendarId", "fiscalYear", "periodsGenerated"],
      },
      JournalCreateResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          journalEntryId: intId,
          journalNo: { type: "string" },
          totalDebit: { type: "number" },
          totalCredit: { type: "number" },
        },
        required: ["ok", "journalEntryId", "journalNo", "totalDebit", "totalCredit"],
      },
      PostJournalResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          journalId: intId,
          posted: { type: "boolean" },
        },
        required: ["ok", "journalId", "posted"],
      },
      TrialBalanceResponse: {
        type: "object",
        properties: {
          bookId: intId,
          fiscalPeriodId: intId,
          rows: { type: "array", items: { $ref: "#/components/schemas/TrialBalanceRow" } },
        },
        required: ["bookId", "fiscalPeriodId", "rows"],
      },
      PeriodCloseResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          bookId: intId,
          fiscalPeriodId: intId,
          status: { type: "string", enum: ["OPEN", "SOFT_CLOSED", "HARD_CLOSED"] },
        },
        required: ["ok", "bookId", "fiscalPeriodId", "status"],
      },
      FxBulkUpsertResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          tenantId: intId,
          upserted: { type: "integer", minimum: 0 },
        },
        required: ["ok", "tenantId", "upserted"],
      },
      FxRatesResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: { type: "array", items: { $ref: "#/components/schemas/FxRateRow" } },
        },
        required: ["tenantId", "rows"],
      },
      IntercompanyPairResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          id: { type: "integer", nullable: true },
          tenantId: intId,
        },
        required: ["ok", "tenantId"],
      },
      IntercompanyReconcileResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          message: { type: "string" },
          items: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["ok", "message", "items"],
      },
      EliminationCreateResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          eliminationEntryId: { type: "integer", nullable: true },
          lineCount: { type: "integer", minimum: 1 },
        },
        required: ["ok", "lineCount"],
      },
      AdjustmentCreateResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          adjustmentId: { type: "integer", nullable: true },
        },
        required: ["ok"],
      },
      FinalizeRunResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          runId: intId,
          status: { type: "string" },
        },
        required: ["ok", "runId", "status"],
      },
      ConsolidationTrialBalanceResponse: {
        type: "object",
        properties: {
          runId: intId,
          rows: { type: "array", items: { $ref: "#/components/schemas/TrialBalanceRow" } },
        },
        required: ["runId", "rows"],
      },
      BalanceSheetResponse: {
        type: "object",
        properties: {
          runId: intId,
          rows: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        required: ["runId", "rows"],
      },
      IncomeStatementResponse: {
        type: "object",
        properties: {
          runId: intId,
          rows: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        required: ["runId", "rows"],
      },
      ConsolidationRunExecuteResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          runId: intId,
          status: { type: "string" },
          preferredRateType: {
            type: "string",
            enum: ["SPOT", "AVERAGE", "CLOSING"],
          },
          insertedRowCount: { type: "integer", minimum: 0 },
          totals: { type: "object", additionalProperties: true },
        },
        required: ["ok", "runId", "status", "insertedRowCount"],
      },
      ConsolidationSummaryReportResponse: {
        type: "object",
        properties: {
          runId: intId,
          groupBy: {
            type: "string",
            enum: ["account", "entity", "account_entity"],
          },
          run: { type: "object", additionalProperties: true },
          totals: { type: "object", additionalProperties: true },
          rows: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["runId", "groupBy", "totals", "rows"],
      },
      RbacAuditLogListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          filters: { type: "object", additionalProperties: true },
          pagination: { type: "object", additionalProperties: true },
          rows: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["tenantId", "pagination", "rows"],
      },
      JournalLineInput: {
        type: "object",
        properties: {
          accountId: intId,
          operatingUnitId: { ...intId, nullable: true },
          counterpartyLegalEntityId: { ...intId, nullable: true },
          description: { type: "string", nullable: true },
          currencyCode,
          amountTxn: { type: "number" },
          debitBase: { type: "number" },
          creditBase: { type: "number" },
          taxCode: { type: "string", nullable: true },
        },
        required: ["accountId", "debitBase", "creditBase"],
      },
      FxRateInput: {
        type: "object",
        properties: {
          rateDate: { type: "string", format: "date" },
          fromCurrencyCode: currencyCode,
          toCurrencyCode: currencyCode,
          rateType: { type: "string", enum: ["SPOT", "AVERAGE", "CLOSING"] },
          value: { type: "number" },
          source: { type: "string", nullable: true },
        },
        required: ["rateDate", "fromCurrencyCode", "toCurrencyCode", "rateType", "value"],
      },
      EliminationLineInput: {
        type: "object",
        properties: {
          accountId: intId,
          legalEntityId: { ...intId, nullable: true },
          counterpartyLegalEntityId: { ...intId, nullable: true },
          debitAmount: { type: "number" },
          creditAmount: { type: "number" },
          currencyCode,
          description: { type: "string", nullable: true },
        },
        required: ["accountId"],
      },
      GroupCompanyInput: {
        type: "object",
        properties: {
          tenantId: intId,
          code: shortText,
          name: shortText,
        },
        required: ["code", "name"],
      },
      GroupCompanyResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          id: { type: "integer", nullable: true },
          tenantId: intId,
          code: shortText,
          name: shortText,
        },
        required: ["ok", "tenantId", "code", "name"],
      },
      LegalEntityInput: {
        type: "object",
        properties: {
          tenantId: intId,
          groupCompanyId: intId,
          code: shortText,
          name: shortText,
          taxId: { type: "string", nullable: true },
          countryId: intId,
          functionalCurrencyCode: currencyCode,
        },
        required: ["groupCompanyId", "code", "name", "countryId", "functionalCurrencyCode"],
      },
      OperatingUnitInput: {
        type: "object",
        properties: {
          tenantId: intId,
          legalEntityId: intId,
          code: shortText,
          name: shortText,
          unitType: { type: "string", enum: ["BRANCH", "PLANT", "STORE", "DEPARTMENT", "OTHER"] },
          hasSubledger: { type: "boolean" },
        },
        required: ["legalEntityId", "code", "name"],
      },
      FiscalCalendarInput: {
        type: "object",
        properties: {
          tenantId: intId,
          code: shortText,
          name: shortText,
          yearStartMonth: { type: "integer", minimum: 1, maximum: 12 },
          yearStartDay: { type: "integer", minimum: 1, maximum: 31 },
        },
        required: ["code", "name", "yearStartMonth", "yearStartDay"],
      },
      FiscalPeriodGenerateInput: {
        type: "object",
        properties: {
          calendarId: intId,
          fiscalYear: { type: "integer", minimum: 1 },
        },
        required: ["calendarId", "fiscalYear"],
      },
      RoleInput: {
        type: "object",
        properties: {
          tenantId: intId,
          code: shortText,
          name: shortText,
          isSystem: { type: "boolean" },
        },
        required: ["code", "name"],
      },
      RolePermissionsInput: {
        type: "object",
        properties: {
          permissionCodes: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
        },
        required: ["permissionCodes"],
      },
      RolePermissionsResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          roleId: intId,
          assignedPermissionCount: { type: "integer", minimum: 0 },
        },
        required: ["ok", "roleId", "assignedPermissionCount"],
      },
      RoleAssignmentInput: {
        type: "object",
        properties: {
          tenantId: intId,
          userId: intId,
          roleId: intId,
          scopeType: { type: "string", enum: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"] },
          scopeId: intId,
          effect: { type: "string", enum: ["ALLOW", "DENY"] },
        },
        required: ["userId", "roleId", "scopeType", "scopeId", "effect"],
      },
      RoleAssignmentScopeReplaceInput: {
        type: "object",
        properties: {
          scopeType: {
            type: "string",
            enum: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"],
          },
          scopeId: intId,
          effect: { type: "string", enum: ["ALLOW", "DENY"] },
        },
        required: ["scopeType", "scopeId", "effect"],
      },
      DataScopeItemInput: {
        type: "object",
        properties: {
          scopeType: {
            type: "string",
            enum: ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"],
          },
          scopeId: intId,
          effect: { type: "string", enum: ["ALLOW", "DENY"] },
        },
        required: ["scopeType", "scopeId", "effect"],
      },
      DataScopeReplaceInput: {
        type: "object",
        properties: {
          scopes: {
            type: "array",
            items: { $ref: "#/components/schemas/DataScopeItemInput" },
          },
        },
        required: ["scopes"],
      },
      BookInput: {
        type: "object",
        properties: {
          tenantId: intId,
          legalEntityId: intId,
          calendarId: intId,
          code: shortText,
          name: shortText,
          bookType: { type: "string", enum: ["LOCAL", "GROUP"] },
          baseCurrencyCode: currencyCode,
        },
        required: ["legalEntityId", "calendarId", "code", "name", "baseCurrencyCode"],
      },
      CoaInput: {
        type: "object",
        properties: {
          tenantId: intId,
          legalEntityId: { ...intId, nullable: true },
          scope: { type: "string", enum: ["LEGAL_ENTITY", "GROUP"] },
          code: shortText,
          name: shortText,
        },
        required: ["scope", "code", "name"],
      },
      AccountInput: {
        type: "object",
        properties: {
          coaId: intId,
          code: shortText,
          name: shortText,
          accountType: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] },
          normalSide: { type: "string", enum: ["DEBIT", "CREDIT"] },
          allowPosting: { type: "boolean" },
          parentAccountId: { ...intId, nullable: true },
        },
        required: ["coaId", "code", "name", "accountType", "normalSide"],
      },
      AccountMappingInput: {
        type: "object",
        properties: {
          tenantId: intId,
          sourceAccountId: intId,
          targetAccountId: intId,
          mappingType: { type: "string", enum: ["LOCAL_TO_GROUP"] },
        },
        required: ["sourceAccountId", "targetAccountId"],
      },
      JournalCreateInput: {
        type: "object",
        properties: {
          tenantId: intId,
          legalEntityId: intId,
          bookId: intId,
          fiscalPeriodId: intId,
          journalNo: { type: "string", nullable: true },
          sourceType: { type: "string", enum: ["MANUAL", "SYSTEM", "INTERCOMPANY", "ELIMINATION", "ADJUSTMENT"] },
          entryDate: { type: "string", format: "date" },
          documentDate: { type: "string", format: "date" },
          currencyCode,
          description: { type: "string", nullable: true },
          referenceNo: { type: "string", nullable: true },
          lines: {
            type: "array",
            minItems: 2,
            items: { $ref: "#/components/schemas/JournalLineInput" },
          },
        },
        required: ["legalEntityId", "bookId", "fiscalPeriodId", "entryDate", "documentDate", "currencyCode", "lines"],
      },
      PeriodCloseInput: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["OPEN", "SOFT_CLOSED", "HARD_CLOSED"] },
          note: { type: "string", nullable: true },
        },
      },
      FxBulkUpsertInput: {
        type: "object",
        properties: {
          tenantId: intId,
          rates: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/FxRateInput" },
          },
        },
        required: ["rates"],
      },
      IntercompanyPairInput: {
        type: "object",
        properties: {
          tenantId: intId,
          fromLegalEntityId: intId,
          toLegalEntityId: intId,
          receivableAccountId: { ...intId, nullable: true },
          payableAccountId: { ...intId, nullable: true },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        },
        required: ["fromLegalEntityId", "toLegalEntityId"],
      },
      ConsolidationGroupInput: {
        type: "object",
        properties: {
          tenantId: intId,
          groupCompanyId: intId,
          calendarId: intId,
          code: shortText,
          name: shortText,
          presentationCurrencyCode: currencyCode,
        },
        required: ["groupCompanyId", "calendarId", "code", "name", "presentationCurrencyCode"],
      },
      ConsolidationMemberInput: {
        type: "object",
        properties: {
          legalEntityId: intId,
          consolidationMethod: { type: "string", enum: ["FULL", "EQUITY", "PROPORTIONATE"] },
          ownershipPct: { type: "number" },
          effectiveFrom: { type: "string", format: "date" },
          effectiveTo: { type: "string", format: "date", nullable: true },
        },
        required: ["legalEntityId", "effectiveFrom"],
      },
      ConsolidationRunInput: {
        type: "object",
        properties: {
          consolidationGroupId: intId,
          fiscalPeriodId: intId,
          runName: shortText,
          presentationCurrencyCode: currencyCode,
        },
        required: ["consolidationGroupId", "fiscalPeriodId", "runName", "presentationCurrencyCode"],
      },
      ConsolidationRunResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          runId: { type: "integer", nullable: true },
        },
        required: ["ok"],
      },
      ConsolidationRunExecuteInput: {
        type: "object",
        properties: {
          rateType: {
            type: "string",
            enum: ["SPOT", "AVERAGE", "CLOSING"],
          },
        },
      },
      EliminationCreateInput: {
        type: "object",
        properties: {
          description: shortText,
          referenceNo: { type: "string", nullable: true },
          lines: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/EliminationLineInput" },
          },
        },
        required: ["description", "lines"],
      },
      AdjustmentCreateInput: {
        type: "object",
        properties: {
          adjustmentType: { type: "string", enum: ["TOPSIDE", "RECLASS", "MANUAL_FX"] },
          legalEntityId: { ...intId, nullable: true },
          accountId: intId,
          debitAmount: { type: "number" },
          creditAmount: { type: "number" },
          currencyCode,
          description: shortText,
        },
        required: ["accountId", "currencyCode", "description", "debitAmount", "creditAmount"],
      },
    },
  },
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");
const indexRouteFilePath = path.resolve(backendRoot, "src", "index.js");

const autoDocumentedOperationCount = await appendUndocumentedRoutes(
  spec,
  indexRouteFilePath
);

const targetPath = path.resolve(backendRoot, "openapi.yaml");
fs.writeFileSync(targetPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
console.log(
  `Generated ${targetPath} (auto-documented operations added: ${autoDocumentedOperationCount})`
);
