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

function queryParam(name, schema, required = false, description = `${name}`) {
  return {
    in: "query",
    name,
    required,
    description,
    schema,
  };
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const TAG_DESCRIPTION_MAP = new Map([
  ["Org", "Organization hierarchy and fiscal structure management."],
  ["Security", "Role and permission assignment APIs."],
  ["GL", "General ledger setup and journal workflows."],
  ["FX", "Foreign exchange rate management."],
  ["Cari", "Cari (AR/AP) documents, settlements, bank links, and reporting endpoints."],
  ["Contracts", "Contract lifecycle, line management, and document-link workflows."],
  ["RevenueRecognition", "Revenue recognition schedule, run, accrual, and reporting endpoints."],
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
  if (normalizedPath.startsWith("/api/v1/cari")) {
    return "Cari";
  }
  if (normalizedPath.startsWith("/api/v1/contracts")) {
    return "Contracts";
  }
  if (normalizedPath.startsWith("/api/v1/revenue-recognition")) {
    return "RevenueRecognition";
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

function collectDirectRouterEndpoints(router, mountPath = "/") {
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
    }
  }

  return endpoints;
}

function parseDefaultImports(moduleSource, moduleDir) {
  const imports = new Map();
  const importRegex = /import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'](\.[^"']+)["'];?/g;
  let match;
  while ((match = importRegex.exec(moduleSource))) {
    const importName = match[1];
    const importPath = path.resolve(moduleDir, match[2]);
    imports.set(importName, importPath);
  }
  return imports;
}

function parseAppMountedRouters(indexSource) {
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

function parseRouterMountedRouters(moduleSource) {
  const mounts = [];
  const mountRegex =
    /router\.use\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;
  let match;
  while ((match = mountRegex.exec(moduleSource))) {
    mounts.push({
      mountPath: normalizeApiPath(match[1]),
      routerImportName: match[2],
    });
  }
  return mounts;
}

async function discoverRouterModuleRoutes({
  modulePath,
  mountPath,
  moduleCache,
  seenModules,
}) {
  const normalizedMountPath = normalizeApiPath(mountPath);
  const visitKey = `${modulePath}::${normalizedMountPath}`;
  if (seenModules.has(visitKey)) {
    return [];
  }
  seenModules.add(visitKey);

  let importedModule = moduleCache.get(modulePath);
  if (!importedModule) {
    importedModule = await import(pathToFileURL(modulePath).href);
    moduleCache.set(modulePath, importedModule);
  }

  const router = importedModule?.default;
  const discovered = collectDirectRouterEndpoints(router, normalizedMountPath);

  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleDir = path.dirname(modulePath);
  const imports = parseDefaultImports(moduleSource, moduleDir);
  const nestedMounts = parseRouterMountedRouters(moduleSource);

  for (const nestedMount of nestedMounts) {
    const nestedModulePath = imports.get(nestedMount.routerImportName);
    if (!nestedModulePath) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const nestedRoutes = await discoverRouterModuleRoutes({
      modulePath: nestedModulePath,
      mountPath: joinRoutePaths(normalizedMountPath, nestedMount.mountPath),
      moduleCache,
      seenModules,
    });
    discovered.push(...nestedRoutes);
  }

  return discovered;
}

async function discoverExpressRoutes(indexFilePath) {
  const indexSource = fs.readFileSync(indexFilePath, "utf8");
  const indexDir = path.dirname(indexFilePath);
  const routeImports = parseDefaultImports(indexSource, indexDir);
  const mounts = parseAppMountedRouters(indexSource);

  const moduleCache = new Map();
  const seenModules = new Set();
  const discovered = [];

  for (const mount of mounts) {
    const modulePath = routeImports.get(mount.routerImportName);
    if (!modulePath) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const routes = await discoverRouterModuleRoutes({
      modulePath,
      mountPath: mount.mountPath,
      moduleCache,
      seenModules,
    });
    discovered.push(...routes);
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

function mergeOperationParameters(operation, parametersToAppend) {
  if (!operation || !Array.isArray(parametersToAppend) || parametersToAppend.length === 0) {
    return;
  }

  const existing = Array.isArray(operation.parameters) ? operation.parameters : [];
  const seen = new Set(
    existing.map((parameter) => `${String(parameter?.in)}:${String(parameter?.name)}`)
  );

  const merged = [...existing];
  for (const parameter of parametersToAppend) {
    const key = `${String(parameter?.in)}:${String(parameter?.name)}`;
    if (seen.has(key)) {
      continue;
    }
    merged.push(parameter);
    seen.add(key);
  }
  operation.parameters = merged;
}

function applyCariOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Cari");
  const paths = specObject.paths || {};

  const reportCommonQueryParams = [
    queryParam("asOfDate", { type: "string", format: "date" }, false, "As-of date cutoff"),
    queryParamInt("legalEntityId", false, "Legal entity filter"),
    queryParamInt("counterpartyId", false, "Counterparty filter"),
    queryParam(
      "role",
      { type: "string", enum: ["CUSTOMER", "VENDOR", "BOTH"] },
      false,
      "Counterparty role filter"
    ),
    queryParam(
      "status",
      { type: "string", enum: ["OPEN", "PARTIALLY_SETTLED", "SETTLED", "ALL"] },
      false,
      "As-of status filter"
    ),
    queryParam("includeDetails", { type: "boolean" }, false, "Include detailed rows"),
    queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
    queryParam("offset", nonNegativeInt, false, "Page offset"),
  ];

  const reportDirectionParam = queryParam(
    "direction",
    { type: "string", enum: ["AR", "AP"] },
    false,
    "Cari direction filter"
  );
  const documentListQueryParams = [
    queryParamInt("legalEntityId", false, "Legal entity filter"),
    queryParamInt("counterpartyId", false, "Counterparty filter"),
    queryParam("direction", { type: "string", enum: ["AR", "AP"] }, false, "Document direction filter"),
    queryParam(
      "documentType",
      { type: "string", enum: ["INVOICE", "DEBIT_NOTE", "CREDIT_NOTE", "PAYMENT", "ADJUSTMENT"] },
      false,
      "Document type filter"
    ),
    queryParam(
      "status",
      {
        type: "string",
        enum: ["DRAFT", "POSTED", "REVERSED", "CANCELLED", "PARTIALLY_SETTLED", "SETTLED"],
      },
      false,
      "Document status filter"
    ),
    queryParam("dateFrom", { type: "string", format: "date" }, false, "Document date lower bound"),
    queryParam("dateTo", { type: "string", format: "date" }, false, "Document date upper bound"),
    queryParam(
      "documentDateFrom",
      { type: "string", format: "date" },
      false,
      "Legacy alias for dateFrom"
    ),
    queryParam(
      "documentDateTo",
      { type: "string", format: "date" },
      false,
      "Legacy alias for dateTo"
    ),
    queryParam("q", { type: "string" }, false, "Document no / counterparty search"),
    queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
    queryParam("offset", nonNegativeInt, false, "Page offset"),
  ];
  const auditQueryParams = [
    queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
    queryParamInt("legalEntityId", false, "Legal entity scope filter"),
    queryParam("action", { type: "string" }, false, "Action code filter (supports prefix with *)"),
    queryParam("resourceType", { type: "string" }, false, "Resource type filter"),
    queryParam("resourceId", { type: "string" }, false, "Resource id filter"),
    queryParamInt("actorUserId", false, "Actor user filter"),
    queryParam("requestId", { type: "string" }, false, "Request id filter"),
    queryParam(
      "createdFrom",
      { type: "string", format: "date-time" },
      false,
      "Created-at lower bound"
    ),
    queryParam(
      "createdTo",
      { type: "string", format: "date-time" },
      false,
      "Created-at upper bound"
    ),
    queryParam("includePayload", { type: "boolean" }, false, "Include payload_json in rows"),
    queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
    queryParam("offset", nonNegativeInt, false, "Page offset"),
  ];

  const reportRouteOverrides = new Map([
    [
      "/api/v1/cari/reports/aging",
      {
        summary: "Cari aging report (generic direction)",
        parameters: [reportDirectionParam, ...reportCommonQueryParams],
      },
    ],
    [
      "/api/v1/cari/reports/ar-aging",
      {
        summary: "Cari AR aging report",
        parameters: reportCommonQueryParams,
      },
    ],
    [
      "/api/v1/cari/reports/ap-aging",
      {
        summary: "Cari AP aging report",
        parameters: reportCommonQueryParams,
      },
    ],
    [
      "/api/v1/cari/reports/open-items",
      {
        summary: "Cari open-items report",
        parameters: [reportDirectionParam, ...reportCommonQueryParams],
      },
    ],
    [
      "/api/v1/cari/reports/statement",
      {
        summary: "Cari counterparty statement report",
        parameters: [reportDirectionParam, ...reportCommonQueryParams],
      },
    ],
  ]);

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!String(pathName).startsWith("/api/v1/cari")) {
      continue;
    }

    for (const methodName of Object.keys(pathItem || {})) {
      const method = String(methodName || "").toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      const operation = pathItem[methodName];
      operation.tags = ["Cari"];

      if (typeof operation.summary === "string" && operation.summary.startsWith("Auto-generated:")) {
        operation.summary = `Cari endpoint: ${method} ${pathName}`;
      }

      if (method === "GET" && !operation.responses?.["200"]) {
        operation.responses = withStandardResponses("200", "Cari response");
      }
    }
  }

  for (const [pathName, override] of reportRouteOverrides.entries()) {
    const operation = paths[pathName]?.get;
    if (!operation) {
      continue;
    }
    operation.summary = override.summary;
    mergeOperationParameters(operation, override.parameters);
    operation.responses = withStandardResponses("200", `${override.summary} response`);
  }

  const auditOperation = paths["/api/v1/cari/audit"]?.get;
  if (auditOperation) {
    auditOperation.summary = "Cari audit visibility endpoint";
    mergeOperationParameters(auditOperation, auditQueryParams);
    auditOperation.responses = withStandardResponses("200", "Cari audit entries");
  }

  const documentsListOperation = paths["/api/v1/cari/documents"]?.get;
  if (documentsListOperation) {
    documentsListOperation.summary = "List cari documents";
    mergeOperationParameters(documentsListOperation, documentListQueryParams);
    documentsListOperation.responses = withStandardResponses("200", "Cari document list");
  }
}

function applyContractsOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Contracts");
  const paths = specObject.paths || {};

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!String(pathName).startsWith("/api/v1/contracts")) {
      continue;
    }
    for (const methodName of Object.keys(pathItem || {})) {
      const method = String(methodName || "").toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      const operation = pathItem[methodName];
      operation.tags = ["Contracts"];
      if (typeof operation.summary === "string" && operation.summary.startsWith("Auto-generated:")) {
        operation.summary = `Contracts endpoint: ${method} ${pathName}`;
      }
    }
  }

  const listOperation = paths["/api/v1/contracts"]?.get;
  if (listOperation) {
    listOperation.summary = "List contracts (summary rows only)";
    mergeOperationParameters(listOperation, [
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("counterpartyId", false, "Counterparty filter"),
      queryParam("contractType", { type: "string", enum: ["CUSTOMER", "VENDOR"] }, false, "Contract type filter"),
      queryParam(
        "status",
        { type: "string", enum: ["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED", "CANCELLED"] },
        false,
        "Contract status filter"
      ),
      queryParam("q", { type: "string" }, false, "Contract no/notes search"),
      queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ]);
    listOperation.responses = withStandardResponses(
      "200",
      "Contract list",
      "#/components/schemas/ContractListResponse"
    );
  }

  const createOperation = paths["/api/v1/contracts"]?.post;
  if (createOperation) {
    createOperation.summary = "Create contract with nested lines[]";
    createOperation.requestBody = bodyFromRef("#/components/schemas/ContractUpsertInput");
    createOperation.responses = {
      "201": jsonResponse("#/components/schemas/ContractMutationResponse", "Contract created"),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const detailOperation = paths["/api/v1/contracts/{contractId}"]?.get;
  if (detailOperation) {
    detailOperation.summary = "Get contract detail with full lines[]";
    detailOperation.responses = withStandardResponses(
      "200",
      "Contract detail",
      "#/components/schemas/ContractDetailResponse"
    );
  }

  const updateOperation = paths["/api/v1/contracts/{contractId}"]?.put;
  if (updateOperation) {
    updateOperation.summary = "Update draft contract with atomic full-replace lines[]";
    updateOperation.requestBody = bodyFromRef("#/components/schemas/ContractUpsertInput");
    updateOperation.responses = withStandardResponses(
      "200",
      "Contract updated",
      "#/components/schemas/ContractMutationResponse"
    );
  }

  const lifecycleMappings = [
    ["/api/v1/contracts/{contractId}/activate", "Activate contract"],
    ["/api/v1/contracts/{contractId}/suspend", "Suspend contract"],
    ["/api/v1/contracts/{contractId}/close", "Close contract"],
    ["/api/v1/contracts/{contractId}/cancel", "Cancel contract"],
  ];
  for (const [pathName, summary] of lifecycleMappings) {
    const operation = paths[pathName]?.post;
    if (!operation) {
      continue;
    }
    operation.summary = summary;
    operation.responses = withStandardResponses(
      "200",
      `${summary} response`,
      "#/components/schemas/ContractMutationResponse"
    );
  }

  const linkOperation = paths["/api/v1/contracts/{contractId}/link-document"]?.post;
  if (linkOperation) {
    linkOperation.summary = "Create immutable contract-document link row";
    linkOperation.requestBody = bodyFromRef("#/components/schemas/ContractLinkDocumentInput");
    linkOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/ContractLinkMutationResponse",
        "Contract-document link created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const documentsOperation = paths["/api/v1/contracts/{contractId}/documents"]?.get;
  if (documentsOperation) {
    documentsOperation.summary = "List contract-document links with minimal document summary";
    documentsOperation.responses = withStandardResponses(
      "200",
      "Contract-document links",
      "#/components/schemas/ContractDocumentsResponse"
    );
  }
}

function applyRevenueRecognitionOperationOverrides(specObject) {
  ensureTagPresent(specObject, "RevenueRecognition");
  const paths = specObject.paths || {};

  const listQueryParams = [
    queryParamInt("legalEntityId", false, "Legal entity filter"),
    queryParamInt("fiscalPeriodId", false, "Fiscal period filter"),
    queryParam(
      "accountFamily",
      {
        type: "string",
        enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
      },
      false,
      "Accounting family filter"
    ),
    queryParam(
      "status",
      { type: "string", enum: ["DRAFT", "READY", "POSTED", "REVERSED"] },
      false,
      "Run/schedule status filter"
    ),
    queryParam("q", { type: "string" }, false, "Search by source uid / run no"),
    queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
    queryParam("offset", nonNegativeInt, false, "Page offset"),
  ];

  const reportQueryParams = [
    queryParamInt("legalEntityId", false, "Legal entity filter"),
    queryParamInt("fiscalPeriodId", false, "Fiscal period filter"),
    queryParam(
      "accountFamily",
      {
        type: "string",
        enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
      },
      false,
      "Accounting family filter"
    ),
    queryParam("asOfDate", { type: "string", format: "date" }, false, "As-of date"),
    queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
    queryParam("offset", nonNegativeInt, false, "Page offset"),
  ];

  const purposeCodeList = [
    "PREPAID_EXP_SHORT_ASSET",
    "PREPAID_EXP_LONG_ASSET",
    "ACCR_REV_SHORT_ASSET",
    "ACCR_REV_LONG_ASSET",
    "DEFREV_SHORT_LIABILITY",
    "DEFREV_LONG_LIABILITY",
    "ACCR_EXP_SHORT_LIABILITY",
    "ACCR_EXP_LONG_LIABILITY",
    "DEFREV_REVENUE",
    "DEFREV_RECLASS",
    "PREPAID_EXPENSE",
    "PREPAID_RECLASS",
    "ACCR_REV_REVENUE",
    "ACCR_REV_RECLASS",
    "ACCR_EXP_EXPENSE",
    "ACCR_EXP_RECLASS",
  ];

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!String(pathName).startsWith("/api/v1/revenue-recognition")) {
      continue;
    }
    for (const methodName of Object.keys(pathItem || {})) {
      const method = String(methodName || "").toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      const operation = pathItem[methodName];
      operation.tags = ["RevenueRecognition"];
      if (typeof operation.summary === "string" && operation.summary.startsWith("Auto-generated:")) {
        operation.summary = `Revenue-recognition endpoint: ${method} ${pathName}`;
      }
    }
  }

  const listSchedulesOperation = paths["/api/v1/revenue-recognition/schedules"]?.get;
  if (listSchedulesOperation) {
    listSchedulesOperation.summary = "List revenue-recognition schedules";
    mergeOperationParameters(listSchedulesOperation, listQueryParams);
    listSchedulesOperation.responses = withStandardResponses(
      "200",
      "Revenue-recognition schedules",
      "#/components/schemas/RevenueScheduleListResponse"
    );
  }

  const generateScheduleOperation = paths["/api/v1/revenue-recognition/schedules/generate"]?.post;
  if (generateScheduleOperation) {
    generateScheduleOperation.summary = "Generate revenue-recognition schedule";
    generateScheduleOperation.description =
      "PR-17B keeps schedule generation deterministic with tenant/legal-entity scope controls.";
    generateScheduleOperation.requestBody = bodyFromRef(
      "#/components/schemas/RevenueScheduleGenerateInput"
    );
    generateScheduleOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/RevenueScheduleMutationResponse",
        "Schedule generated"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const listRunsOperation = paths["/api/v1/revenue-recognition/runs"]?.get;
  if (listRunsOperation) {
    listRunsOperation.summary = "List revenue-recognition runs";
    mergeOperationParameters(listRunsOperation, listQueryParams);
    listRunsOperation.responses = withStandardResponses(
      "200",
      "Revenue-recognition runs",
      "#/components/schemas/RevenueRunListResponse"
    );
  }

  const createRunOperation = paths["/api/v1/revenue-recognition/runs"]?.post;
  if (createRunOperation) {
    createRunOperation.summary = "Create revenue-recognition run";
    createRunOperation.description =
      "PR-17B creates runs and run-lines with duplicate open-line guard for reruns.";
    createRunOperation.requestBody = bodyFromRef("#/components/schemas/RevenueRunCreateInput");
    createRunOperation.responses = {
      "201": jsonResponse("#/components/schemas/RevenueRunMutationResponse", "Run created"),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const postRunOperation = paths["/api/v1/revenue-recognition/runs/{runId}/post"]?.post;
  if (postRunOperation) {
    postRunOperation.summary = "Post revenue-recognition run";
    postRunOperation.description =
      `PR-17B posts DEFREV/PREPAID runs with period-open + setup guards. ` +
      `Purpose-code setup must include: ${purposeCodeList.join(", ")}.`;
    postRunOperation.responses = {
      "200": jsonResponse("#/components/schemas/RevenueRunPostResponse", "Run posted"),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const reverseRunOperation = paths["/api/v1/revenue-recognition/runs/{runId}/reverse"]?.post;
  if (reverseRunOperation) {
    reverseRunOperation.summary = "Reverse revenue-recognition run";
    reverseRunOperation.description =
      `PR-17B creates a posted reversal journal/run and marks original run REVERSED. ` +
      `Purpose-code setup must include: ${purposeCodeList.join(", ")}.`;
    reverseRunOperation.requestBody = bodyFromRef(
      "#/components/schemas/RevenueRunReverseInput",
      false
    );
    reverseRunOperation.responses = {
      "201": jsonResponse("#/components/schemas/RevenueRunReverseResponse", "Run reversed"),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const generateAccrualOperation = paths["/api/v1/revenue-recognition/accruals/generate"]?.post;
  if (generateAccrualOperation) {
    generateAccrualOperation.summary = "Generate accrual run (ACCRUED_REVENUE / ACCRUED_EXPENSE)";
    generateAccrualOperation.description =
      "PR-17C accrual generation endpoint. Permission: revenue.run.create.";
    generateAccrualOperation.requestBody = bodyFromRef(
      "#/components/schemas/RevenueAccrualGenerateInput"
    );
    generateAccrualOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/RevenueAccrualGenerateResponse",
        "Accrual generated"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const settleAccrualOperation =
    paths["/api/v1/revenue-recognition/accruals/{accrualId}/settle"]?.post;
  if (settleAccrualOperation) {
    settleAccrualOperation.summary = "Settle posted accrual (due-boundary + period-open guarded)";
    settleAccrualOperation.description =
      "PR-17C accrual settle endpoint. Permission: revenue.run.post.";
    settleAccrualOperation.requestBody = bodyFromRef(
      "#/components/schemas/RevenueAccrualSettleInput",
      false
    );
    settleAccrualOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/RevenueAccrualSettleResponse",
        "Accrual settled"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const reverseAccrualOperation =
    paths["/api/v1/revenue-recognition/accruals/{accrualId}/reverse"]?.post;
  if (reverseAccrualOperation) {
    reverseAccrualOperation.summary = "Reverse settled accrual";
    reverseAccrualOperation.description =
      "PR-17C accrual reverse endpoint. Permission: revenue.run.reverse.";
    reverseAccrualOperation.requestBody = bodyFromRef(
      "#/components/schemas/RevenueAccrualReverseInput",
      false
    );
    reverseAccrualOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/RevenueAccrualReverseResponse",
        "Accrual reversed"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const reportPathMappings = [
    [
      "/api/v1/revenue-recognition/reports/future-year-rollforward",
      "Future-year rollforward report",
      "PR-17D rollforward view with short/long maturity rollups and subledger-vs-GL reconciliation.",
    ],
    [
      "/api/v1/revenue-recognition/reports/deferred-revenue-split",
      "Deferred revenue split report",
      "PR-17D deferred-revenue split for short-term vs long-term balances (380/480 families).",
    ],
    [
      "/api/v1/revenue-recognition/reports/accrual-split",
      "Accrual split report",
      "PR-17D accrual split for accrued revenue/expense with maturity separation and reconciliation payload.",
    ],
    [
      "/api/v1/revenue-recognition/reports/prepaid-expense-split",
      "Prepaid expense split report",
      "PR-17D prepaid split endpoint for short/long prepaid balances (180/280).",
    ],
  ];
  for (const [pathName, summary, description] of reportPathMappings) {
    const operation = paths[pathName]?.get;
    if (!operation) {
      continue;
    }
    operation.summary = summary;
    operation.description = description;
    mergeOperationParameters(operation, reportQueryParams);
    operation.responses = withStandardResponses(
      "200",
      `${summary} response`,
      "#/components/schemas/RevenueReportResponse"
    );
  }
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
    {
      name: "Cari",
      description: "Cari (AR/AP) documents, settlements, bank links, and reporting endpoints.",
    },
    {
      name: "Contracts",
      description: "Contract lifecycle, line management, and document-link workflows.",
    },
    {
      name: "RevenueRecognition",
      description: "Revenue recognition schedule, run, accrual, and reporting endpoints.",
    },
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
        summary:
          "Run company onboarding bootstrap flow (includes default Cari payment terms)",
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
    "/api/v1/onboarding/payment-terms/bootstrap": {
      post: {
        tags: ["Onboarding"],
        operationId: "bootstrapOnboardingPaymentTerms",
        summary: "Bootstrap default or custom Cari payment terms by legal entity",
        requestBody: bodyFromRef(
          "#/components/schemas/OnboardingPaymentTermsBootstrapInput",
          false
        ),
        responses: withStandardResponses(
          "201",
          "Cari payment-term bootstrap result",
          "#/components/schemas/OnboardingPaymentTermsBootstrapResponse"
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
      OnboardingPaymentTermTemplateInput: {
        type: "object",
        properties: {
          code: { type: "string", minLength: 1, maxLength: 50 },
          name: { type: "string", minLength: 1, maxLength: 255 },
          dueDays: nonNegativeInt,
          graceDays: nonNegativeInt,
          isEndOfMonth: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        },
      },
      OnboardingPaymentTermsBootstrapInput: {
        type: "object",
        properties: {
          tenantId: intId,
          legalEntityId: intId,
          legalEntityIds: {
            type: "array",
            items: intId,
          },
          terms: {
            type: "array",
            items: { $ref: "#/components/schemas/OnboardingPaymentTermTemplateInput" },
          },
        },
      },
      OnboardingPaymentTermsBootstrapEntityResult: {
        type: "object",
        properties: {
          legalEntityId: intId,
          createdCount: nonNegativeInt,
          skippedCount: nonNegativeInt,
        },
        required: ["legalEntityId", "createdCount", "skippedCount"],
      },
      OnboardingPaymentTermsBootstrapResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          tenantId: intId,
          defaultsUsed: { type: "boolean" },
          legalEntityIds: {
            type: "array",
            items: intId,
          },
          termTemplates: {
            type: "array",
            items: { $ref: "#/components/schemas/OnboardingPaymentTermTemplateInput" },
          },
          createdCount: nonNegativeInt,
          skippedCount: nonNegativeInt,
          perLegalEntity: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingPaymentTermsBootstrapEntityResult",
            },
          },
        },
        required: [
          "ok",
          "tenantId",
          "defaultsUsed",
          "legalEntityIds",
          "termTemplates",
          "createdCount",
          "skippedCount",
          "perLegalEntity",
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
          autoProvisionDefaults: { type: "boolean" },
          fiscalYear: { type: "integer", minimum: 1 },
          paymentTerms: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingPaymentTermTemplateInput",
            },
          },
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
      RevenueScheduleGenerateInput: {
        type: "object",
        properties: {
          legalEntityId: intId,
          fiscalPeriodId: intId,
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
          },
          maturityBucket: { type: "string", enum: ["SHORT_TERM", "LONG_TERM"] },
          maturityDate: { type: "string", format: "date" },
          reclassRequired: { type: "boolean" },
          currencyCode,
          fxRate: { type: "number", exclusiveMinimum: 0, nullable: true },
          amountTxn: { type: "number", minimum: 0 },
          amountBase: { type: "number", minimum: 0 },
          sourceEventUid: { type: "string", maxLength: 160, nullable: true },
        },
        required: [
          "legalEntityId",
          "fiscalPeriodId",
          "accountFamily",
          "maturityBucket",
          "maturityDate",
          "currencyCode",
          "amountTxn",
          "amountBase",
        ],
      },
      RevenueScheduleRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          fiscalPeriodId: intId,
          sourceEventUid: { type: "string" },
          status: { type: "string", enum: ["DRAFT", "READY", "POSTED", "REVERSED"] },
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
          },
          maturityBucket: { type: "string", enum: ["SHORT_TERM", "LONG_TERM"] },
          maturityDate: { type: "string", format: "date" },
          reclassRequired: { type: "boolean" },
          currencyCode,
          fxRate: { type: "number", nullable: true },
          amountTxn: { type: "number" },
          amountBase: { type: "number" },
          periodStartDate: { type: "string", format: "date" },
          periodEndDate: { type: "string", format: "date" },
          createdByUserId: intId,
          postedJournalEntryId: { ...intId, nullable: true },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
          lineCount: { type: "integer", minimum: 0, nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "fiscalPeriodId",
          "sourceEventUid",
          "status",
          "accountFamily",
          "maturityBucket",
          "maturityDate",
          "reclassRequired",
          "currencyCode",
          "amountTxn",
          "amountBase",
          "periodStartDate",
          "periodEndDate",
          "createdByUserId",
        ],
      },
      RevenueScheduleListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/RevenueScheduleRow" },
          },
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "rows", "total", "limit", "offset"],
      },
      RevenueScheduleMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueScheduleRow" },
          scaffolded: { type: "boolean" },
        },
        required: ["tenantId", "row"],
      },
      RevenueRunCreateInput: {
        type: "object",
        properties: {
          legalEntityId: intId,
          fiscalPeriodId: intId,
          scheduleId: { ...intId, nullable: true },
          runNo: { type: "string", maxLength: 80, nullable: true },
          sourceRunUid: { type: "string", maxLength: 160, nullable: true },
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
          },
          maturityBucket: { type: "string", enum: ["SHORT_TERM", "LONG_TERM"] },
          maturityDate: { type: "string", format: "date" },
          reclassRequired: { type: "boolean" },
          currencyCode,
          fxRate: { type: "number", exclusiveMinimum: 0, nullable: true },
          totalAmountTxn: { type: "number", minimum: 0 },
          totalAmountBase: { type: "number", minimum: 0 },
        },
        required: [
          "legalEntityId",
          "fiscalPeriodId",
          "accountFamily",
          "maturityBucket",
          "maturityDate",
          "currencyCode",
          "totalAmountTxn",
          "totalAmountBase",
        ],
      },
      RevenueAccrualGenerateInput: {
        type: "object",
        properties: {
          legalEntityId: intId,
          fiscalPeriodId: intId,
          scheduleId: { ...intId, nullable: true },
          runNo: { type: "string", maxLength: 80, nullable: true },
          sourceRunUid: { type: "string", maxLength: 160, nullable: true },
          accountFamily: {
            type: "string",
            enum: ["ACCRUED_REVENUE", "ACCRUED_EXPENSE"],
          },
          maturityBucket: { type: "string", enum: ["SHORT_TERM", "LONG_TERM"] },
          maturityDate: { type: "string", format: "date" },
          reclassRequired: { type: "boolean" },
          currencyCode,
          fxRate: { type: "number", exclusiveMinimum: 0, nullable: true },
          totalAmountTxn: { type: "number", minimum: 0 },
          totalAmountBase: { type: "number", minimum: 0 },
        },
        required: [
          "legalEntityId",
          "fiscalPeriodId",
          "accountFamily",
          "maturityBucket",
          "maturityDate",
          "currencyCode",
          "totalAmountTxn",
          "totalAmountBase",
        ],
      },
      RevenueRunReverseInput: {
        type: "object",
        properties: {
          reversalPeriodId: { ...intId, nullable: true },
          reason: { type: "string", maxLength: 255, nullable: true },
        },
      },
      RevenueAccrualSettleInput: {
        type: "object",
        properties: {
          settlementPeriodId: { ...intId, nullable: true },
        },
      },
      RevenueAccrualReverseInput: {
        type: "object",
        properties: {
          reversalPeriodId: { ...intId, nullable: true },
          reason: { type: "string", maxLength: 255, nullable: true },
        },
      },
      RevenueRunRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          scheduleId: { ...intId, nullable: true },
          fiscalPeriodId: intId,
          runNo: { type: "string" },
          sourceRunUid: { type: "string" },
          status: { type: "string", enum: ["DRAFT", "READY", "POSTED", "REVERSED"] },
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
          },
          maturityBucket: { type: "string", enum: ["SHORT_TERM", "LONG_TERM"] },
          maturityDate: { type: "string", format: "date" },
          reclassRequired: { type: "boolean" },
          currencyCode,
          fxRate: { type: "number", nullable: true },
          totalAmountTxn: { type: "number" },
          totalAmountBase: { type: "number" },
          periodStartDate: { type: "string", format: "date" },
          periodEndDate: { type: "string", format: "date" },
          reversalOfRunId: { ...intId, nullable: true },
          postedJournalEntryId: { ...intId, nullable: true },
          reversalJournalEntryId: { ...intId, nullable: true },
          createdByUserId: intId,
          postedByUserId: { ...intId, nullable: true },
          reversedByUserId: { ...intId, nullable: true },
          postedAt: { type: "string", nullable: true },
          reversedAt: { type: "string", nullable: true },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
          lineCount: { type: "integer", minimum: 0, nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "fiscalPeriodId",
          "runNo",
          "sourceRunUid",
          "status",
          "accountFamily",
          "maturityBucket",
          "maturityDate",
          "reclassRequired",
          "currencyCode",
          "totalAmountTxn",
          "totalAmountBase",
          "periodStartDate",
          "periodEndDate",
          "createdByUserId",
        ],
      },
      RevenueRunListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/RevenueRunRow" },
          },
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "rows", "total", "limit", "offset"],
      },
      RevenueRunMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueRunRow" },
          scaffolded: { type: "boolean" },
        },
        required: ["tenantId", "row"],
      },
      RevenueAccrualGenerateResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueRunRow" },
        },
        required: ["tenantId", "row"],
      },
      RevenueRunPostJournalSummary: {
        type: "object",
        properties: {
          journalEntryId: intId,
          journalNo: { type: "string" },
          lineCount: { type: "integer", minimum: 1 },
          totalDebitBase: { type: "number" },
          totalCreditBase: { type: "number" },
        },
        required: [
          "journalEntryId",
          "journalNo",
          "lineCount",
          "totalDebitBase",
          "totalCreditBase",
        ],
      },
      RevenueRunPostResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueRunRow" },
          journal: { $ref: "#/components/schemas/RevenueRunPostJournalSummary" },
          subledgerEntryCount: { type: "integer", minimum: 0 },
        },
        required: ["tenantId", "row", "journal", "subledgerEntryCount"],
      },
      RevenueAccrualSettleResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueRunRow" },
          journal: { $ref: "#/components/schemas/RevenueRunPostJournalSummary" },
          subledgerEntryCount: { type: "integer", minimum: 0 },
        },
        required: ["tenantId", "row", "journal", "subledgerEntryCount"],
      },
      RevenueRunReverseJournalSummary: {
        type: "object",
        properties: {
          originalPostedJournalEntryId: intId,
          reversalJournalEntryId: intId,
          reversalJournalNo: { type: "string" },
          lineCount: { type: "integer", minimum: 1 },
          totalDebitBase: { type: "number" },
          totalCreditBase: { type: "number" },
        },
        required: [
          "originalPostedJournalEntryId",
          "reversalJournalEntryId",
          "reversalJournalNo",
          "lineCount",
          "totalDebitBase",
          "totalCreditBase",
        ],
      },
      RevenueRunReverseResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueRunRow" },
          reversalRun: { $ref: "#/components/schemas/RevenueRunRow" },
          journal: { $ref: "#/components/schemas/RevenueRunReverseJournalSummary" },
        },
        required: ["tenantId", "row", "reversalRun", "journal"],
      },
      RevenueAccrualReverseResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/RevenueRunRow" },
          reversalRun: { $ref: "#/components/schemas/RevenueRunRow" },
          journal: { $ref: "#/components/schemas/RevenueRunReverseJournalSummary" },
        },
        required: ["tenantId", "row", "reversalRun", "journal"],
      },
      RevenueReportSummary: {
        type: "object",
        properties: {
          openingAmountTxn: { type: "number" },
          openingAmountBase: { type: "number" },
          movementAmountTxn: { type: "number" },
          movementAmountBase: { type: "number" },
          closingAmountTxn: { type: "number" },
          closingAmountBase: { type: "number" },
          shortTermAmountTxn: { type: "number" },
          shortTermAmountBase: { type: "number" },
          longTermAmountTxn: { type: "number" },
          longTermAmountBase: { type: "number" },
          totalAmountTxn: { type: "number" },
          totalAmountBase: { type: "number" },
          grossMovementAmountTxn: { type: "number" },
          grossMovementAmountBase: { type: "number" },
          entryCount: { type: "integer", minimum: 0 },
          journalCount: { type: "integer", minimum: 0 },
        },
        required: [
          "openingAmountTxn",
          "openingAmountBase",
          "movementAmountTxn",
          "movementAmountBase",
          "closingAmountTxn",
          "closingAmountBase",
          "shortTermAmountTxn",
          "shortTermAmountBase",
          "longTermAmountTxn",
          "longTermAmountBase",
          "totalAmountTxn",
          "totalAmountBase",
          "grossMovementAmountTxn",
          "grossMovementAmountBase",
          "entryCount",
          "journalCount",
        ],
      },
      RevenueReportReconciliationRow: {
        type: "object",
        properties: {
          legalEntityId: intId,
          fiscalPeriodId: intId,
          currencyCode,
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
          },
          subledgerAmountBase: { type: "number" },
          glAmountBase: { type: "number" },
          differenceBase: { type: "number" },
          journalCount: { type: "integer", minimum: 0 },
          matches: { type: "boolean" },
        },
        required: [
          "legalEntityId",
          "fiscalPeriodId",
          "currencyCode",
          "accountFamily",
          "subledgerAmountBase",
          "glAmountBase",
          "differenceBase",
          "journalCount",
          "matches",
        ],
      },
      RevenueReportReconciliation: {
        type: "object",
        properties: {
          totalGroups: { type: "integer", minimum: 0 },
          matchedGroups: { type: "integer", minimum: 0 },
          unmatchedGroups: { type: "integer", minimum: 0 },
          differenceBaseTotal: { type: "number" },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/RevenueReportReconciliationRow" },
          },
          reconciled: { type: "boolean" },
        },
        required: [
          "totalGroups",
          "matchedGroups",
          "unmatchedGroups",
          "differenceBaseTotal",
          "rows",
          "reconciled",
        ],
      },
      RevenueReportResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          reportCode: { type: "string" },
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "ACCRUED_REVENUE", "ACCRUED_EXPENSE", "PREPAID_EXPENSE"],
            nullable: true,
          },
          legalEntityId: { ...intId, nullable: true },
          fiscalPeriodId: { ...intId, nullable: true },
          asOfDate: { type: "string", format: "date", nullable: true },
          windowStartDate: { type: "string", format: "date", nullable: true },
          windowEndDate: { type: "string", format: "date", nullable: true },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/AnyObject" },
          },
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
          summary: { $ref: "#/components/schemas/RevenueReportSummary" },
          reconciliation: { $ref: "#/components/schemas/RevenueReportReconciliation" },
          reconciled: { type: "boolean" },
          scaffolded: { type: "boolean" },
        },
        required: [
          "tenantId",
          "reportCode",
          "rows",
          "total",
          "limit",
          "offset",
          "summary",
          "reconciliation",
          "reconciled",
          "scaffolded",
        ],
      },
      RevenuePurposeCodeCatalog: {
        type: "object",
        properties: {
          purposeCodes: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "PREPAID_EXP_SHORT_ASSET",
                "PREPAID_EXP_LONG_ASSET",
                "ACCR_REV_SHORT_ASSET",
                "ACCR_REV_LONG_ASSET",
                "DEFREV_SHORT_LIABILITY",
                "DEFREV_LONG_LIABILITY",
                "ACCR_EXP_SHORT_LIABILITY",
                "ACCR_EXP_LONG_LIABILITY",
                "DEFREV_REVENUE",
                "DEFREV_RECLASS",
                "PREPAID_EXPENSE",
                "PREPAID_RECLASS",
                "ACCR_REV_REVENUE",
                "ACCR_REV_RECLASS",
                "ACCR_EXP_EXPENSE",
                "ACCR_EXP_RECLASS",
              ],
            },
          },
        },
        required: ["purposeCodes"],
      },
      ContractLineInput: {
        type: "object",
        properties: {
          lineNo: { type: "integer", minimum: 1, nullable: true },
          description: { type: "string", minLength: 1, maxLength: 255 },
          lineAmountTxn: { type: "number", exclusiveMinimum: 0 },
          lineAmountBase: { type: "number", exclusiveMinimum: 0 },
          recognitionMethod: {
            type: "string",
            enum: ["STRAIGHT_LINE", "MILESTONE", "MANUAL"],
          },
          recognitionStartDate: { type: "string", format: "date", nullable: true },
          recognitionEndDate: { type: "string", format: "date", nullable: true },
          deferredAccountId: { ...intId, nullable: true },
          revenueAccountId: { ...intId, nullable: true },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"], nullable: true },
        },
        required: ["description", "lineAmountTxn", "lineAmountBase"],
      },
      ContractUpsertInput: {
        type: "object",
        properties: {
          legalEntityId: intId,
          counterpartyId: intId,
          contractNo: { type: "string", minLength: 1, maxLength: 80 },
          contractType: { type: "string", enum: ["CUSTOMER", "VENDOR"] },
          currencyCode,
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date", nullable: true },
          notes: { type: "string", maxLength: 500, nullable: true },
          lines: {
            type: "array",
            items: { $ref: "#/components/schemas/ContractLineInput" },
          },
        },
        required: [
          "legalEntityId",
          "counterpartyId",
          "contractNo",
          "contractType",
          "currencyCode",
          "startDate",
          "lines",
        ],
      },
      ContractSummaryRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          counterpartyId: intId,
          contractNo: { type: "string" },
          contractType: { type: "string", enum: ["CUSTOMER", "VENDOR"] },
          status: {
            type: "string",
            enum: ["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED", "CANCELLED"],
          },
          currencyCode,
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date", nullable: true },
          totalAmountTxn: { type: "number" },
          totalAmountBase: { type: "number" },
          notes: { type: "string", nullable: true },
          createdByUserId: intId,
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
          lineCount: { type: "integer", minimum: 0, nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "counterpartyId",
          "contractNo",
          "contractType",
          "status",
          "currencyCode",
          "startDate",
          "totalAmountTxn",
          "totalAmountBase",
          "createdByUserId",
        ],
      },
      ContractLineRow: {
        type: "object",
        properties: {
          id: intId,
          lineNo: { type: "integer", minimum: 1 },
          description: { type: "string" },
          lineAmountTxn: { type: "number" },
          lineAmountBase: { type: "number" },
          recognitionMethod: {
            type: "string",
            enum: ["STRAIGHT_LINE", "MILESTONE", "MANUAL"],
          },
          recognitionStartDate: { type: "string", format: "date", nullable: true },
          recognitionEndDate: { type: "string", format: "date", nullable: true },
          deferredAccountId: { ...intId, nullable: true },
          revenueAccountId: { ...intId, nullable: true },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
        },
        required: [
          "id",
          "lineNo",
          "description",
          "lineAmountTxn",
          "lineAmountBase",
          "recognitionMethod",
          "status",
        ],
      },
      ContractDetailRow: {
        allOf: [
          { $ref: "#/components/schemas/ContractSummaryRow" },
          {
            type: "object",
            properties: {
              lines: {
                type: "array",
                items: { $ref: "#/components/schemas/ContractLineRow" },
              },
            },
            required: ["lines"],
          },
        ],
      },
      ContractListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/ContractSummaryRow" },
          },
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "rows", "total", "limit", "offset"],
      },
      ContractDetailResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/ContractDetailRow" },
        },
        required: ["tenantId", "row"],
      },
      ContractMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/ContractSummaryRow" },
        },
        required: ["tenantId", "row"],
      },
      ContractLinkDocumentInput: {
        type: "object",
        properties: {
          cariDocumentId: intId,
          linkType: { type: "string", enum: ["BILLING", "ADVANCE", "ADJUSTMENT"] },
          linkedAmountTxn: { type: "number", exclusiveMinimum: 0 },
          linkedAmountBase: { type: "number", exclusiveMinimum: 0 },
        },
        required: ["cariDocumentId", "linkType", "linkedAmountTxn", "linkedAmountBase"],
      },
      ContractDocumentLinkRow: {
        type: "object",
        properties: {
          linkType: { type: "string", enum: ["BILLING", "ADVANCE", "ADJUSTMENT"] },
          linkedAmountTxn: { type: "number" },
          linkedAmountBase: { type: "number" },
          createdAt: { type: "string", nullable: true },
          createdByUserId: intId,
          cariDocumentId: intId,
          documentNo: { type: "string", nullable: true },
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          status: { type: "string", nullable: true },
          documentDate: { type: "string", format: "date", nullable: true },
          amountTxn: { type: "number", nullable: true },
          amountBase: { type: "number", nullable: true },
        },
        required: [
          "linkType",
          "linkedAmountTxn",
          "linkedAmountBase",
          "createdByUserId",
          "cariDocumentId",
        ],
      },
      ContractDocumentsResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          contractId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/ContractDocumentLinkRow" },
          },
        },
        required: ["tenantId", "contractId", "rows"],
      },
      ContractLinkMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/ContractDocumentLinkRow" },
        },
        required: ["tenantId", "row"],
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
applyCariOperationOverrides(spec);
applyContractsOperationOverrides(spec);
applyRevenueRecognitionOperationOverrides(spec);

const targetPath = path.resolve(backendRoot, "openapi.yaml");
fs.writeFileSync(targetPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
console.log(
  `Generated ${targetPath} (auto-documented operations added: ${autoDocumentedOperationCount})`
);
